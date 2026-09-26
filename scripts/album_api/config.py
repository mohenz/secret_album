import os
from dataclasses import dataclass
from pathlib import Path
from typing import Self


PROJECT_ROOT = Path(__file__).resolve().parents[2]
LOCAL_ROOT = PROJECT_ROOT / "local"
LOG_ROOT = LOCAL_ROOT
MIGRATIONS_ROOT = LOCAL_ROOT / "migrations"
SCHEMA_FILE = LOCAL_ROOT / "schema.sql"
WEB_ROOT = PROJECT_ROOT / "web"

SESSION_COOKIE = "album_session"
LOGIN_MAX_FAILURES = 5
LOGIN_LOCK_MINUTES = 10
LOGIN_RATE_PER_MINUTE = 20
MIN_PASSWORD_LENGTH = 10
RECOVERY_CODE_COUNT = 10
MAX_JSON_BYTES = 1_048_576

# 파생 이미지 규격: (이름, 긴 변 최대 픽셀, WebP 품질)
DERIVED_VARIANTS = (("thumb", 480, 75), ("medium", 1600, 82), ("large", 3200, 85))
MEDIA_VARIANTS = ("thumb", "medium", "large", "original")

JOB_MAX_ATTEMPTS = 3
JOB_BACKOFF_SECONDS = (30, 120, 600)
JOB_STALE_SECONDS = 900


def _integer(name: str, default: int, minimum: int = 1) -> int:
    raw = os.getenv(name, str(default))
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError(f"{name}은(는) 정수여야 합니다.") from exc
    if value < minimum:
        raise ValueError(f"{name}은(는) {minimum} 이상이어야 합니다.")
    return value


def _boolean(name: str, default: bool) -> bool:
    raw = os.getenv(name, "").strip().lower()
    if not raw:
        return default
    return raw not in {"0", "false", "no", "off"}


@dataclass(frozen=True)
class Settings:
    api_host: str
    api_port: int
    web_origins: tuple[str, ...]
    media_root: Path
    max_upload_bytes: int
    session_idle_minutes: int
    session_max_days: int
    db_pool_size: int
    worker_concurrency: int
    slow_request_ms: int
    data_key: str
    cookie_secure: bool

    @classmethod
    def from_environment(cls) -> Self:
        origins = tuple(
            value.strip()
            for value in os.getenv(
                "ALBUM_WEB_ORIGINS",
                "http://localhost:8090,http://127.0.0.1:8090",
            ).split(",")
            if value.strip()
        )
        media_value = os.getenv("ALBUM_MEDIA_ROOT", "").strip()
        return cls(
            api_host=os.getenv("ALBUM_API_HOST", "127.0.0.1"),
            api_port=_integer("ALBUM_API_PORT", 3051),
            web_origins=origins,
            media_root=Path(media_value) if media_value else LOCAL_ROOT / "media",
            max_upload_bytes=_integer("ALBUM_MAX_UPLOAD_BYTES", 209_715_200),
            session_idle_minutes=_integer("ALBUM_SESSION_IDLE_MINUTES", 15),
            session_max_days=_integer("ALBUM_SESSION_MAX_DAYS", 14),
            db_pool_size=_integer("ALBUM_DB_POOL_SIZE", 8),
            worker_concurrency=_integer("ALBUM_WORKER_CONCURRENCY", 3),
            slow_request_ms=_integer("ALBUM_SLOW_REQUEST_MS", 1000),
            data_key=os.getenv("ALBUM_DATA_KEY", "").strip(),
            cookie_secure=_boolean("ALBUM_COOKIE_SECURE", False),
        )

    @property
    def upload_root(self) -> Path:
        # 원본 폴더로 옮길 때 같은 볼륨 안의 이름 변경이 되도록 저장소 안에 둔다.
        return self.media_root / "uploads"
