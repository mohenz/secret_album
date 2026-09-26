"""실제 PostgreSQL로 하는 통합 테스트 준비.

운영 DB(secret_album)와 local/media는 쓰지 않는다. 같은 클러스터에 secret_album_test를
새로 만들고 임시 폴더를 사진 저장소로 쓴다. DB가 꺼져 있으면 테스트를 건너뛴다.
"""

import dataclasses
import http.client
import io
import json
import os
import shutil
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path

from scripts.album_api import auth, database, jobs
from scripts.album_api.config import Settings
from scripts.album_api.handler import SETTING_CACHE, AlbumRequestHandler

ROOT = Path(__file__).resolve().parents[1]
TEST_DB = "secret_album_test"
ORIGIN = "http://127.0.0.1:8090"
_state: dict = {}


def _load_env() -> dict:
    env_file = ROOT / "local" / "album.env"
    values = {}
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8-sig").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                key, value = line.split("=", 1)
                values[key.strip()] = value.strip()
    return values


def setup_live():
    """테스트 DB·서버를 한 번만 준비한다. 준비할 수 없으면 SkipTest."""
    if _state.get("ready"):
        return _state
    if _state.get("skip"):
        raise unittest.SkipTest(_state["skip"])
    env = _load_env()
    if not env.get("PGPASSWORD"):
        _state["skip"] = "local/album.env가 없어 통합 테스트를 건너뜁니다."
        raise unittest.SkipTest(_state["skip"])
    try:
        import psycopg
    except ImportError:
        _state["skip"] = "psycopg가 없어 통합 테스트를 건너뜁니다."
        raise unittest.SkipTest(_state["skip"])
    admin = dict(host=env.get("PGHOST", "127.0.0.1"), port=int(env.get("PGPORT", "54328")), user=env.get("PGUSER", "album_app"), password=env["PGPASSWORD"], connect_timeout=2)
    try:
        with psycopg.connect(dbname="postgres", autocommit=True, **admin) as conn:
            conn.execute(f"DROP DATABASE IF EXISTS {TEST_DB} WITH (FORCE)")
            conn.execute(f"CREATE DATABASE {TEST_DB}")
    except psycopg.OperationalError as exc:
        _state["skip"] = f"PostgreSQL에 연결할 수 없어 통합 테스트를 건너뜁니다: {exc}"
        raise unittest.SkipTest(_state["skip"])
    os.environ.update({"PGHOST": admin["host"], "PGPORT": str(admin["port"]), "PGUSER": admin["user"], "PGPASSWORD": admin["password"], "PGDATABASE": TEST_DB})
    database.configure(8)
    with database.transaction() as cursor:
        database.apply_schema(cursor)

    media_root = Path(tempfile.mkdtemp(prefix="secret_album_test_"))
    settings = dataclasses.replace(
        Settings.from_environment(),
        media_root=media_root,
        web_origins=(ORIGIN,),
        slow_request_ms=60_000,
    )
    AlbumRequestHandler.settings = settings
    AlbumRequestHandler.login_limiter = auth.RateLimiter(per_minute=10_000)
    SETTING_CACHE.clear()
    server = ThreadingHTTPServer(("127.0.0.1", 0), AlbumRequestHandler)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    _state.update(ready=True, server=server, settings=settings, media_root=media_root)
    return _state


def teardown_live() -> None:
    """모든 테스트 모듈이 끝난 뒤 호출해도 되고, 호출하지 않아도 다음 실행 때 DB를 새로 만든다."""
    if not _state.get("ready"):
        return
    _state["server"].shutdown()
    shutil.rmtree(_state["media_root"], ignore_errors=True)


def run_jobs(limit: int = 50) -> int:
    count = 0
    while count < limit and jobs.run_one(_state["settings"], "test-worker"):
        count += 1
    return count


class Client:
    """쿠키를 기억하는 간단한 HTTP 클라이언트."""

    def __init__(self) -> None:
        self.cookie: str | None = None

    def request(self, method: str, path: str, body=None, headers: dict | None = None, raw: bytes | None = None):
        conn = http.client.HTTPConnection("127.0.0.1", _state["server"].server_port, timeout=30)
        hdrs = {"Origin": ORIGIN, **(headers or {})}
        if self.cookie:
            hdrs["Cookie"] = self.cookie
        data = raw
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            hdrs["Content-Type"] = "application/json"
        conn.request(method, path, body=data, headers=hdrs)
        response = conn.getresponse()
        content = response.read()
        set_cookie = response.getheader("Set-Cookie")
        if set_cookie:
            pair = set_cookie.split(";", 1)[0]
            self.cookie = None if pair.endswith("=") else pair
        conn.close()
        payload = None
        if response.getheader("Content-Type", "").startswith("application/json"):
            payload = json.loads(content)
        return response, payload, content

    def json(self, method: str, path: str, body=None, headers=None):
        response, payload, _ = self.request(method, path, body, headers)
        return response.status, payload


def create_user(login_id: str, password: str, role: str = "owner") -> str:
    with database.transaction() as cursor:
        return auth.create_user(cursor, login_id, login_id, password, role)


def login_owner(client: Client, login_id: str, password: str) -> None:
    status, body = client.json("POST", "/auth/login", {"login_id": login_id, "password": password})
    assert status == 200 and body["state"] == "active", body


def sample_jpeg(color=(180, 40, 60), size=(1200, 800), with_gps=True, marker: int = 0) -> bytes:
    from PIL import Image

    image = Image.new("RGB", size, color)
    image.putpixel((marker % size[0], 0), (marker % 256, 0, 0))
    exif = Image.Exif()
    exif[0x0110] = "TEST CAMERA X1"
    exif[0x0112] = 1
    ifd = exif.get_ifd(0x8769)
    ifd[0x9003] = "2026:09:12 14:30:00"
    ifd[0x829A] = (1, 250)
    ifd[0x829D] = (2, 1)
    ifd[0x8827] = 200
    if with_gps:
        gps = exif.get_ifd(0x8825)
        gps[1] = "N"
        gps[2] = (37.0, 33.0, 0.0)
    buffer = io.BytesIO()
    image.save(buffer, "JPEG", exif=exif.tobytes(), quality=90)
    return buffer.getvalue()
