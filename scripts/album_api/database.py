import logging
import os
import queue
import threading
import time
from collections.abc import Iterator
from contextlib import closing, contextmanager
from pathlib import Path

from .config import MIGRATIONS_ROOT, SCHEMA_FILE

logger = logging.getLogger("album.database")


class PoolTimeoutError(RuntimeError):
    pass


def connection_parameters() -> dict[str, object]:
    return {
        "host": os.getenv("PGHOST", "127.0.0.1"),
        "port": int(os.getenv("PGPORT", "54328")),
        "user": os.getenv("PGUSER", "album_app"),
        "password": os.getenv("PGPASSWORD", ""),
        "dbname": os.getenv("PGDATABASE", "secret_album"),
        "connect_timeout": 3,
    }


def _connect():
    import psycopg
    from psycopg.rows import dict_row

    return psycopg.connect(**connection_parameters(), row_factory=dict_row)


class ConnectionPool:
    """프로세스당 하나. 대여 대기는 시간 제한이 있고, 손상된 연결은 버린다."""

    def __init__(self, max_size: int = 8, wait_timeout: float = 15.0) -> None:
        self.max_size = max_size
        self.wait_timeout = wait_timeout
        self._idle: queue.LifoQueue = queue.LifoQueue()
        self._created = 0
        self._lock = threading.Lock()

    def _acquire(self):
        try:
            return self._idle.get_nowait()
        except queue.Empty:
            pass
        with self._lock:
            if self._created < self.max_size:
                self._created += 1
                try:
                    return _connect()
                except Exception:
                    self._created -= 1
                    raise
        try:
            return self._idle.get(timeout=self.wait_timeout)
        except queue.Empty as exc:
            raise PoolTimeoutError("DB 연결 대기 시간을 초과했습니다. 잠시 후 다시 시도해 주세요.") from exc

    def _discard(self, connection) -> None:
        with self._lock:
            self._created -= 1
        try:
            connection.close()
        except Exception:
            pass

    @contextmanager
    def connection(self) -> Iterator:
        connection = self._acquire()
        if connection.closed:
            self._discard(connection)
            connection = self._acquire()
        broken = False
        try:
            yield connection
        except Exception:
            broken = connection.closed or connection.broken
            raise
        finally:
            if broken or connection.closed:
                self._discard(connection)
            else:
                try:
                    connection.rollback()
                    self._idle.put(connection)
                except Exception:
                    self._discard(connection)

    def close_all(self) -> None:
        while True:
            try:
                self._discard(self._idle.get_nowait())
            except queue.Empty:
                return


_pool: ConnectionPool | None = None
_pool_lock = threading.Lock()


def configure(max_size: int) -> None:
    global _pool
    with _pool_lock:
        if _pool is not None:
            _pool.close_all()
        _pool = ConnectionPool(max_size=max_size)


def pool() -> ConnectionPool:
    global _pool
    with _pool_lock:
        if _pool is None:
            _pool = ConnectionPool()
        return _pool


@contextmanager
def transaction() -> Iterator:
    """커밋되는 트랜잭션. 예외가 나면 롤백한다."""
    with pool().connection() as connection:
        with connection.transaction():
            with connection.cursor() as cursor:
                started = time.perf_counter()
                yield cursor
                elapsed = (time.perf_counter() - started) * 1000
                if elapsed > 2000:
                    logger.warning("slow transaction %.0fms", elapsed)


def ping() -> tuple[bool, str]:
    try:
        import psycopg  # noqa: F401
    except ImportError:
        return False, "psycopg 패키지가 설치되지 않았습니다."
    try:
        with closing(_connect()) as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
                cursor.fetchone()
    except Exception as exc:  # 준비 상태에서 진단 메시지를 제공한다.
        return False, str(exc)
    return True, "ok"


def apply_schema(cursor) -> list[str]:
    """schema.sql과 migrations를 적용한다. 테스트 DB 준비와 start_local_db.ps1이 같은 순서를 쓴다."""
    schema = SCHEMA_FILE.read_text(encoding="utf-8").replace("BEGIN;", "").replace("COMMIT;", "")
    cursor.execute(schema)
    cursor.execute("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())")
    cursor.execute("SELECT name FROM schema_migrations")
    applied = {row["name"] for row in cursor.fetchall()}
    newly: list[str] = []
    for path in sorted(Path(MIGRATIONS_ROOT).glob("*.sql")):
        if path.name in applied:
            continue
        cursor.execute(path.read_text(encoding="utf-8"))
        cursor.execute("INSERT INTO schema_migrations(name) VALUES (%s)", (path.name,))
        newly.append(path.name)
    return newly
