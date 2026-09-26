from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _integer(name: str, default: int, minimum: int = 1) -> int:
    raw = os.getenv(name, str(default))
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError(f"{name}은(는) 정수여야 합니다.") from exc
    if value < minimum:
        raise ValueError(f"{name}은(는) {minimum} 이상이어야 합니다.")
    return value


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

    @classmethod
    def from_environment(cls) -> "Settings":
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
            media_root=Path(media_value) if media_value else PROJECT_ROOT / "local" / "media",
            max_upload_bytes=_integer("ALBUM_MAX_UPLOAD_BYTES", 209_715_200),
            session_idle_minutes=_integer("ALBUM_SESSION_IDLE_MINUTES", 15),
            session_max_days=_integer("ALBUM_SESSION_MAX_DAYS", 14),
            db_pool_size=_integer("ALBUM_DB_POOL_SIZE", 8),
            worker_concurrency=_integer("ALBUM_WORKER_CONCURRENCY", 3),
            slow_request_ms=_integer("ALBUM_SLOW_REQUEST_MS", 1000),
        )

