"""background_jobs 작업 큐와 작업 핸들러 (cinetube local_worker와 같은 구조)."""

import logging
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from . import auth, database, media, repository
from .config import JOB_BACKOFF_SECONDS, JOB_MAX_ATTEMPTS, JOB_STALE_SECONDS, Settings

logger = logging.getLogger("album.jobs")

JobHandler = Callable[[Settings, dict], dict]
JOB_HANDLERS: dict[str, JobHandler] = {}


def handler(job_type: str):
    def register(fn: JobHandler) -> JobHandler:
        JOB_HANDLERS[job_type] = fn
        return fn

    return register


def enqueue(cursor, job_type: str, payload: dict, run_after: datetime | None = None) -> str:
    from psycopg.types.json import Jsonb

    if job_type not in JOB_HANDLERS:
        raise ValueError(f"Unknown job type: {job_type}")
    cursor.execute(
        "INSERT INTO background_jobs(job_type, payload, max_attempts, run_after) VALUES (%s, %s, %s, COALESCE(%s, now())) RETURNING id",
        (job_type, Jsonb(payload), JOB_MAX_ATTEMPTS, run_after),
    )
    return str(cursor.fetchone()["id"])


CLAIM_SQL = """
WITH claimed AS (
  SELECT id FROM background_jobs
  WHERE status = 'queued' AND run_after <= now()
  ORDER BY run_after, created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
UPDATE background_jobs j
SET status = 'running', attempts = j.attempts + 1, locked_by = %s, locked_at = now(),
    started_at = COALESCE(j.started_at, now()), updated_at = now()
FROM claimed WHERE j.id = claimed.id
RETURNING j.id, j.job_type, j.payload, j.attempts, j.max_attempts
"""


def claim(worker_id: str) -> dict | None:
    with database.transaction() as cursor:
        cursor.execute(CLAIM_SQL, (worker_id,))
        return cursor.fetchone()


def backoff_seconds(attempts: int) -> int:
    index = min(max(attempts, 1), len(JOB_BACKOFF_SECONDS)) - 1
    return JOB_BACKOFF_SECONDS[index]


def finish(job: dict, result: dict) -> None:
    from psycopg.types.json import Jsonb

    with database.transaction() as cursor:
        cursor.execute(
            "UPDATE background_jobs SET status = 'succeeded', result = %s, error = NULL, finished_at = now(), locked_by = NULL, updated_at = now() WHERE id = %s",
            (Jsonb(result), job["id"]),
        )


def fail(job: dict, message: str, retry: bool = True) -> bool:
    """실패 기록. 재시도하면 True."""
    will_retry = retry and job["attempts"] < job["max_attempts"]
    with database.transaction() as cursor:
        if will_retry:
            cursor.execute(
                "UPDATE background_jobs SET status = 'queued', error = %s, run_after = now() + %s, locked_by = NULL, updated_at = now() WHERE id = %s",
                (message[:1000], timedelta(seconds=backoff_seconds(job["attempts"])), job["id"]),
            )
        else:
            cursor.execute(
                "UPDATE background_jobs SET status = 'failed', error = %s, finished_at = now(), locked_by = NULL, updated_at = now() WHERE id = %s",
                (message[:1000], job["id"]),
            )
    return will_retry


def run_one(settings: Settings, worker_id: str) -> bool:
    """작업 하나를 처리한다. 처리할 작업이 없으면 False."""
    job = claim(worker_id)
    if job is None:
        return False
    fn = JOB_HANDLERS.get(job["job_type"])
    if fn is None:
        fail(job, f"Unknown job type: {job['job_type']}", retry=False)
        return True
    try:
        result = fn(settings, job["payload"])
    except PermanentJobError as exc:
        logger.warning("job %s %s permanent failure: %s", job["id"], job["job_type"], exc)
        fail(job, str(exc), retry=False)
        on_final_failure(job, str(exc))
    except Exception as exc:  # 핸들러 오류는 재시도 규칙에 따른다.
        logger.exception("job %s %s failed", job["id"], job["job_type"])
        if not fail(job, f"{type(exc).__name__}: {exc}"):
            on_final_failure(job, str(exc))
    else:
        finish(job, result or {})
    return True


def recover_stale(stale_seconds: int = JOB_STALE_SECONDS) -> int:
    with database.transaction() as cursor:
        cursor.execute(
            "UPDATE background_jobs SET status = 'queued', locked_by = NULL, updated_at = now() "
            "WHERE status = 'running' AND locked_at < now() - %s",
            (timedelta(seconds=stale_seconds),),
        )
        return cursor.rowcount


def stats() -> dict:
    with database.transaction() as cursor:
        cursor.execute("SELECT status, count(*) AS n FROM background_jobs GROUP BY status")
        counts = {row["status"]: row["n"] for row in cursor.fetchall()}
        cursor.execute("SELECT min(run_after) AS oldest FROM background_jobs WHERE status = 'queued'")
        oldest = cursor.fetchone()["oldest"]
    return {"counts": counts, "oldest_queued": oldest.isoformat() if oldest else None}


def list_jobs(status: str | None, limit: int) -> list[dict]:
    with database.transaction() as cursor:
        if status:
            cursor.execute(
                "SELECT id, job_type, status, attempts, error, run_after, created_at, finished_at FROM background_jobs WHERE status = %s ORDER BY created_at DESC LIMIT %s",
                (status, limit),
            )
        else:
            cursor.execute(
                "SELECT id, job_type, status, attempts, error, run_after, created_at, finished_at FROM background_jobs ORDER BY created_at DESC LIMIT %s",
                (limit,),
            )
        return [
            {**row, "id": str(row["id"]), "run_after": row["run_after"].isoformat(), "created_at": row["created_at"].isoformat(),
             "finished_at": row["finished_at"].isoformat() if row["finished_at"] else None}
            for row in cursor.fetchall()
        ]


def get_job(job_id: str) -> dict | None:
    job_id = repository.parse_uuid(job_id, "job")
    with database.transaction() as cursor:
        cursor.execute("SELECT id, job_type, status, attempts, error, result, created_at, finished_at FROM background_jobs WHERE id = %s", (job_id,))
        row = cursor.fetchone()
    if row is None:
        return None
    return {**row, "id": str(row["id"]), "created_at": row["created_at"].isoformat(), "finished_at": row["finished_at"].isoformat() if row["finished_at"] else None}


class PermanentJobError(Exception):
    """재시도해도 결과가 같은 실패."""


def on_final_failure(job: dict, message: str) -> None:
    if job["job_type"] in {"photo.process", "photo.rebuild"}:
        photo_id = job["payload"].get("photo_id")
        if photo_id:
            with database.transaction() as cursor:
                repository.mark_failed(cursor, photo_id, f"Couldn't process this photo: {message}")


# ---------------------------------------------------------------- 작업 핸들러

@handler("photo.process")
def process_photo(settings: Settings, payload: dict) -> dict:
    photo_id = payload["photo_id"]
    with database.transaction() as cursor:
        info = repository.photo_file_info(cursor, photo_id)
    if info is None:
        return {"skipped": "deleted"}
    try:
        metadata = media.process_photo(settings.media_root, str(info["id"]), info["created_at"], info["original_ext"])
    except media.MediaError as exc:
        raise PermanentJobError(exc.message) from exc
    except OSError as exc:
        # 손상 파일·지원하지 않는 형식은 재시도해도 같다.
        if "cannot identify image file" in str(exc) or "truncated" in str(exc).lower():
            raise PermanentJobError("The photo file is damaged or in an unreadable format. Check the original and upload it again.") from exc
        raise
    with database.transaction() as cursor:
        repository.mark_processed(cursor, photo_id, metadata)
    return {"width": metadata["width"], "height": metadata["height"]}


@handler("photo.rebuild")
def rebuild_photo(settings: Settings, payload: dict) -> dict:
    return process_photo(settings, payload)


@handler("trash.purge")
def purge_trash(settings: Settings, payload: dict) -> dict:
    with database.transaction() as cursor:
        days = int(repository.setting_value(cursor, "trash_retention_days", 30))
        files = repository.purge(cursor, None, None, None, older_than_days=days)
    for item in files:
        media.remove_photo_files(settings.media_root, item["id"], item["created_at"], item["ext"])
    return {"purged_photos": len(files), "retention_days": days}


@handler("session.cleanup")
def cleanup_sessions(settings: Settings, payload: dict) -> dict:
    with database.transaction() as cursor:
        return {"deleted": auth.cleanup_sessions(cursor)}


@handler("jobs.cleanup")
def cleanup_jobs(settings: Settings, payload: dict) -> dict:
    with database.transaction() as cursor:
        cursor.execute("DELETE FROM background_jobs WHERE status = 'succeeded' AND finished_at < now() - interval '7 days'")
        return {"deleted": cursor.rowcount}


@handler("uploads.cleanup")
def cleanup_uploads(settings: Settings, payload: dict) -> dict:
    """중단된 업로드 임시 파일(하루 지난 것)을 지운다."""
    removed = 0
    cutoff = datetime.now(UTC).timestamp() - 86400
    if settings.upload_root.exists():
        for path in settings.upload_root.glob("*.part"):
            if path.stat().st_mtime < cutoff:
                path.unlink(missing_ok=True)
                removed += 1
    return {"removed": removed}


MAINTENANCE_JOBS = ("trash.purge", "session.cleanup", "jobs.cleanup", "uploads.cleanup")


def schedule_maintenance() -> bool:
    """하루 한 번 정리 작업을 등록한다. 여러 Worker가 동시에 불러도 한 번만 등록된다."""
    from psycopg.types.json import Jsonb

    today = datetime.now(UTC).astimezone().date().isoformat()
    with database.transaction() as cursor:
        cursor.execute("SELECT value FROM app_settings WHERE key = 'maintenance_last_run' FOR UPDATE")
        row = cursor.fetchone()
        if row and row["value"] == today:
            return False
        cursor.execute(
            "INSERT INTO app_settings(key, value) VALUES ('maintenance_last_run', %s) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
            (Jsonb(today),),
        )
        for job_type in MAINTENANCE_JOBS:
            enqueue(cursor, job_type, {})
    return True
