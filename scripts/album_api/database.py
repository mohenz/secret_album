from __future__ import annotations

import os
from contextlib import closing


def connection_parameters() -> dict[str, object]:
    return {
        "host": os.getenv("PGHOST", "127.0.0.1"),
        "port": int(os.getenv("PGPORT", "54328")),
        "user": os.getenv("PGUSER", "album_app"),
        "password": os.getenv("PGPASSWORD", ""),
        "dbname": os.getenv("PGDATABASE", "secret_album"),
        "connect_timeout": 2,
    }


def ping() -> tuple[bool, str]:
    try:
        import psycopg
    except ImportError:
        return False, "psycopg 패키지가 설치되지 않았습니다."

    try:
        with closing(psycopg.connect(**connection_parameters())) as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
                cursor.fetchone()
    except Exception as exc:  # 준비 상태에서 진단 메시지를 제공한다.
        return False, str(exc)
    return True, "ok"
