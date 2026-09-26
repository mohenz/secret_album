"""백그라운드 작업 Worker. API와 별도 프로세스로 실행한다.

  python scripts\\local_worker.py              상시 실행
  python scripts\\local_worker.py --once       큐가 빌 때까지만 처리
  python scripts\\local_worker.py --concurrency 2
"""

import argparse
import logging
import os
import signal
import socket
import threading
import time

from album_api import database, jobs, logs
from album_api.config import JOB_STALE_SECONDS, Settings

STOP = threading.Event()
logger = logging.getLogger("album.worker")


def default_concurrency() -> int:
    return max(1, min(4, (os.cpu_count() or 2) - 1))


def work_loop(settings: Settings, worker_id: str, poll_interval: float, once: bool) -> None:
    while not STOP.is_set():
        try:
            if jobs.run_one(settings, worker_id):
                continue
        except Exception:
            logger.exception("worker loop error")
            STOP.wait(poll_interval)
            continue
        if once:
            return
        STOP.wait(poll_interval)


def main() -> None:
    parser = argparse.ArgumentParser(description="비밀앨범 백그라운드 작업 Worker")
    parser.add_argument("--once", action="store_true", help="큐가 빌 때까지만 처리하고 종료")
    parser.add_argument("--concurrency", type=int, default=int(os.getenv("ALBUM_WORKER_CONCURRENCY", "0")) or default_concurrency())
    parser.add_argument("--poll-interval", type=float, default=2.0)
    parser.add_argument("--recover-stale", type=int, default=JOB_STALE_SECONDS)
    args = parser.parse_args()

    logs.setup("worker")
    settings = Settings.from_environment()
    database.configure(max(2, args.concurrency + 1))
    worker_id = f"{socket.gethostname()}:{os.getpid()}"

    def stop(_signum: int, _frame: object) -> None:
        STOP.set()

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)

    # DB가 아직 준비되지 않았으면 기다린다 (서버 부팅 직후 등). 종료 신호를 받으면 멈춘다.
    while not STOP.is_set():
        try:
            recovered = jobs.recover_stale(args.recover_stale)
            break
        except Exception as exc:
            logger.warning("database not ready, retrying in 5s: %s", exc)
            STOP.wait(5)
    else:
        return
    if recovered:
        logger.warning("recovered %s stale jobs", recovered)
    logger.info("비밀앨범 Worker 시작 id=%s concurrency=%s", worker_id, args.concurrency)

    threads = [
        threading.Thread(target=work_loop, args=(settings, f"{worker_id}:{i}", args.poll_interval, args.once), daemon=True)
        for i in range(args.concurrency)
    ]
    for thread in threads:
        thread.start()
    last_maintenance_check = 0.0
    while any(thread.is_alive() for thread in threads):
        if not args.once and time.monotonic() - last_maintenance_check > 300:
            last_maintenance_check = time.monotonic()
            try:
                if jobs.schedule_maintenance():
                    logger.info("daily maintenance jobs queued")
            except Exception:
                logger.exception("maintenance scheduling failed")
        if STOP.wait(1):
            break
    for thread in threads:
        thread.join(timeout=60)
    logger.info("비밀앨범 Worker 종료")


if __name__ == "__main__":
    main()
