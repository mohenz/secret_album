"""HTTP 라우팅. 인증 외 모든 경로는 세션이 필요하고, 변경 요청은 허용된 Origin만 받는다."""

import json
import logging
import re
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from email.utils import formatdate
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, quote, urlsplit

from . import auth, database, jobs, media, repository
from .config import MAX_JSON_BYTES, SESSION_COOKIE, Settings
from .tables import BULK_ACTIONS

logger = logging.getLogger("album.handler")

PUBLIC, ANY_SESSION, ACTIVE, OWNER = "public", "any", "active", "owner"


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, detail: dict | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.detail = detail or {}


@dataclass
class Request:
    handler: "AlbumRequestHandler"
    method: str
    path: str
    query: dict[str, list[str]]
    params: tuple[str, ...]
    session: auth.SessionInfo | None
    ip: str

    def arg(self, name: str, default: str | None = None) -> str | None:
        values = self.query.get(name)
        return values[0] if values else default

    def int_arg(self, name: str, default: int, low: int, high: int) -> int:
        try:
            return max(low, min(high, int(self.arg(name, str(default)))))
        except (TypeError, ValueError):
            return default

    def json(self) -> dict:
        return self.handler.read_json()


Route = tuple[str, re.Pattern, str, Callable[[Request], object]]
ROUTES: list[Route] = []
UUID = r"([0-9a-fA-F-]{36})"


def route(method: str, pattern: str, level: str):
    def register(fn):
        ROUTES.append((method, re.compile(f"^{pattern}$"), level, fn))
        return fn

    return register


class _SettingCache:
    def __init__(self, ttl: float = 10.0) -> None:
        self.ttl = ttl
        self._value: dict | None = None
        self._at = 0.0
        self._lock = threading.Lock()

    def get(self, cursor) -> dict:
        with self._lock:
            if self._value is None or time.monotonic() - self._at > self.ttl:
                self._value = repository.get_settings(cursor)
                self._at = time.monotonic()
            return self._value

    def clear(self) -> None:
        with self._lock:
            self._value = None


SETTING_CACHE = _SettingCache()


class AlbumRequestHandler(BaseHTTPRequestHandler):
    server_version = "SecretAlbum/1.0"
    sys_version = ""
    protocol_version = "HTTP/1.1"
    settings = Settings.from_environment()
    login_limiter = auth.RateLimiter()
    _pending_cookie: str | None = None
    _body_consumed = False

    # ------------------------------------------------------------ 진입점

    def do_GET(self) -> None:
        self._dispatch("GET")

    def do_POST(self) -> None:
        self._dispatch("POST")

    def do_PUT(self) -> None:
        self._dispatch("PUT")

    def do_PATCH(self) -> None:
        self._dispatch("PATCH")

    def do_DELETE(self) -> None:
        self._dispatch("DELETE")

    def do_OPTIONS(self) -> None:
        origin = self.headers.get("Origin")
        if origin not in self.settings.web_origins:
            self._json(HTTPStatus.FORBIDDEN, {"error": {"code": "origin_denied", "message": "허용되지 않은 출처입니다."}})
            return
        self.send_response(HTTPStatus.NO_CONTENT)
        self._cors(origin)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, format: str, *args) -> None:  # noqa: A002 - 표준 시그니처
        logger.info("%s %s", self.client_address[0], format % args)

    # ------------------------------------------------------------ 처리

    def _dispatch(self, method: str) -> None:
        started = time.perf_counter()
        self._pending_cookie = None
        self._body_consumed = False
        parts = urlsplit(self.path)
        path = parts.path.rstrip("/") or "/"
        try:
            origin = self.headers.get("Origin")
            if method != "GET" and origin is not None and origin not in self.settings.web_origins:
                raise ApiError(403, "origin_denied", "허용되지 않은 출처의 요청입니다.")
            for route_method, pattern, level, fn in ROUTES:
                match = pattern.match(path)
                if match and route_method == method:
                    break
            else:
                if any(pattern.match(path) for _, pattern, _, _ in ROUTES):
                    raise ApiError(405, "method_not_allowed", "허용되지 않은 요청 방식입니다.")
                raise ApiError(404, "not_found", "요청한 경로가 없습니다.")
            request = Request(self, method, path, parse_qs(parts.query), match.groups(), None, self.client_address[0])
            if level != PUBLIC:
                request.session = self._require_session(level)
            result = fn(request)
            if result is not None:
                status, payload = result if isinstance(result, tuple) else (200, result)
                self._json(status, payload)
        except ApiError as exc:
            self._error(exc.status, exc.code, exc.message, exc.detail)
        except auth.AuthError as exc:
            self._error(exc.status, exc.code, exc.message)
        except repository.NotFound as exc:
            self._error(404, "not_found", exc.message)
        except repository.Invalid as exc:
            self._error(403 if exc.code == "forbidden" else 400, exc.code, exc.message)
        except repository.Conflict as exc:
            self._error(409, exc.code, exc.message, exc.detail)
        except media.MediaError as exc:
            self._error(exc.status, exc.code, exc.message)
        except database.PoolTimeoutError as exc:
            self._error(503, "busy", str(exc))
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            self.close_connection = True
        except Exception:
            logger.exception("unhandled error %s %s", method, path)
            self._error(500, "server_error", "서버에서 오류가 났습니다. 잠시 후 다시 시도하고, 계속되면 관리자 로그를 확인해 주세요.")
        finally:
            if not self._body_consumed and (self.headers.get("Content-Length") or "0") not in {"", "0"}:
                # 읽지 않은 요청 본문이 남으면 다음 요청이 깨지므로 연결을 닫는다.
                self.close_connection = True
            elapsed_ms = (time.perf_counter() - started) * 1000
            if elapsed_ms >= self.settings.slow_request_ms:
                logger.warning("slow request %.0fms %s %s", elapsed_ms, method, path)

    def _session_token(self) -> str | None:
        raw = self.headers.get("Cookie")
        if not raw:
            return None
        cookie = SimpleCookie()
        try:
            cookie.load(raw)
        except Exception:
            return None
        morsel = cookie.get(SESSION_COOKIE)
        return morsel.value if morsel else None

    def _require_session(self, level: str) -> auth.SessionInfo:
        with database.transaction() as cursor:
            idle = SETTING_CACHE.get(cursor).get("session_idle_minutes") or self.settings.session_idle_minutes
            session = auth.load_session(cursor, self._session_token(), idle)
        if session is None:
            raise ApiError(401, "unauthenticated", "로그인이 필요합니다. 다시 로그인해 주세요.")
        if level == ANY_SESSION:
            return session
        if session.state == "locked":
            raise ApiError(401, "locked", "화면이 잠겼습니다. 비밀번호를 입력해 잠금을 해제해 주세요.")
        if session.state in {"mfa_required", "totp_setup_required"}:
            raise ApiError(401, session.state, "2단계 인증을 마쳐야 합니다.")
        if level == OWNER and not session.is_owner:
            raise ApiError(403, "forbidden", "이 작업은 소유자만 할 수 있습니다.")
        return session

    # ------------------------------------------------------------ 입출력

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_JSON_BYTES:
            self.close_connection = True
            raise ApiError(413, "body_too_large", "요청 내용이 너무 큽니다.")
        if "application/json" not in (self.headers.get("Content-Type") or ""):
            self.close_connection = True
            raise ApiError(415, "json_required", "JSON 형식으로 보내 주세요.")
        raw = self.rfile.read(length) if length else b"{}"
        self._body_consumed = True
        try:
            payload = json.loads(raw or b"{}")
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise ApiError(400, "invalid_json", "요청 형식이 올바르지 않습니다.") from exc
        if not isinstance(payload, dict):
            raise ApiError(400, "invalid_json", "요청 형식이 올바르지 않습니다.")
        return payload

    def set_session_cookie(self, token: str | None) -> None:
        if token is None:
            self._pending_cookie = f"{SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0"
        else:
            max_age = self.settings.session_max_days * 86400
            secure = "; Secure" if self.settings.cookie_secure else ""
            self._pending_cookie = f"{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={max_age}{secure}"

    def _common_headers(self) -> None:
        origin = self.headers.get("Origin")
        if origin in self.settings.web_origins:
            self._cors(origin)
        else:
            # CORS 응답과 일반 응답이 캐시에서 섞이지 않게 한다.
            self.send_header("Vary", "Origin")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Robots-Tag", "noindex, nofollow")
        if self._pending_cookie:
            self.send_header("Set-Cookie", self._pending_cookie)

    def _json(self, status: int, payload: object) -> None:
        body = json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(status)
        self._common_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _error(self, status: int, code: str, message: str, detail: dict | None = None) -> None:
        payload = {"error": {"code": code, "message": message}}
        if detail:
            payload["error"]["detail"] = detail
        try:
            self._json(status, payload)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            self.close_connection = True

    def _cors(self, origin: str) -> None:
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Credentials", "true")
        self.send_header("Vary", "Origin")

    def send_file(self, path, content_type: str, etag: str, cache: bool, download_name: str | None = None) -> None:
        if self.headers.get("If-None-Match") == etag and cache:
            self.send_response(304)
            self._common_headers()
            self.send_header("ETag", etag)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        size = path.stat().st_size
        self.send_response(200)
        self._common_headers()
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(size))
        self.send_header("ETag", etag)
        # 브라우저는 사진을 보관하되, 쓸 때마다 서버에 세션을 확인받는다(304). 로그아웃·잠금 뒤에는 401이 되어 보이지 않는다.
        self.send_header("Cache-Control", "private, no-cache" if cache else "no-store")
        self.send_header("Last-Modified", formatdate(path.stat().st_mtime, usegmt=True))
        if download_name:
            self.send_header("Content-Disposition", f"attachment; filename*=UTF-8''{quote(download_name)}")
        else:
            self.send_header("Content-Disposition", "inline")
        self.end_headers()
        with path.open("rb") as handle:
            while chunk := handle.read(256 * 1024):
                self.wfile.write(chunk)


# ================================================================ 공통 도우미

def _committing(fn):
    """AuthError가 나도 실패 횟수 같은 기록은 커밋한 뒤 오류를 돌려준다."""
    error = None
    result = None
    with database.transaction() as cursor:
        try:
            result = fn(cursor)
        except auth.AuthError as exc:
            error = exc
    if error:
        raise error
    return result


def _settings_payload(cursor) -> dict:
    values = SETTING_CACHE.get(cursor)
    return {
        "session_idle_minutes": values.get("session_idle_minutes"),
        "blur_thumbnails": values.get("blur_thumbnails"),
        "viewer_controls_hide_seconds": values.get("viewer_controls_hide_seconds"),
    }


# ================================================================ 상태

@route("GET", "/health", PUBLIC)
def health(request: Request):
    return {"status": "ok", "service": "secret_album_api"}


@route("GET", "/ready", PUBLIC)
def ready(request: Request):
    ok, detail = database.ping()
    if not ok:
        logger.warning("ready check failed: %s", detail)
    return (200 if ok else 503), {"status": "ready" if ok else "not_ready", "database": "ok" if ok else "unavailable"}


# ================================================================ 인증

@route("POST", "/auth/login", PUBLIC)
def login(request: Request):
    AlbumRequestHandler.login_limiter.check(request.ip)
    payload = request.json()
    handler = request.handler
    token, state = _committing(
        lambda cursor: auth.login(
            cursor, str(payload.get("login_id") or ""), str(payload.get("password") or ""), request.ip,
            handler.headers.get("User-Agent"), handler.settings.session_max_days,
        )
    )
    handler.set_session_cookie(token)
    return {"state": state}


@route("GET", "/auth/me", ANY_SESSION)
def me(request: Request):
    session = request.session
    with database.transaction() as cursor:
        settings = _settings_payload(cursor)
    return {
        "state": session.state,
        "user": {"login_id": session.login_id, "display_name": session.display_name, "role": session.role, "totp_enabled": session.totp_enabled},
        "settings": settings,
    }


@route("POST", "/auth/otp", ANY_SESSION)
def otp(request: Request):
    session = request.session
    if session.state != "mfa_required":
        raise ApiError(409, "invalid_state", "2단계 인증이 필요한 상태가 아닙니다. 새로고침해 주세요.")
    AlbumRequestHandler.login_limiter.check(request.ip)
    code = str(request.json().get("code") or "")
    _committing(lambda cursor: auth.verify_second_factor(cursor, session, code, request.handler.settings.data_key, request.ip))
    return {"state": "active"}


@route("GET", "/auth/totp/setup", ANY_SESSION)
def totp_setup(request: Request):
    if request.session.state != "totp_setup_required":
        raise ApiError(409, "invalid_state", "2단계 인증을 등록하는 단계가 아닙니다. 새로고침해 주세요.")
    with database.transaction() as cursor:
        return auth.begin_totp_setup(cursor, request.session, request.handler.settings.data_key)


@route("POST", "/auth/totp/enable", ANY_SESSION)
def totp_enable(request: Request):
    if request.session.state != "totp_setup_required":
        raise ApiError(409, "invalid_state", "2단계 인증을 등록하는 단계가 아닙니다. 새로고침해 주세요.")
    AlbumRequestHandler.login_limiter.check(request.ip)
    code = str(request.json().get("code") or "")
    codes = _committing(lambda cursor: auth.enable_totp(cursor, request.session, code, request.handler.settings.data_key, request.ip))
    return {"state": "active", "recovery_codes": codes}


@route("POST", "/auth/unlock", ANY_SESSION)
def unlock(request: Request):
    if request.session.state != "locked":
        return {"state": request.session.state}
    AlbumRequestHandler.login_limiter.check(request.ip)
    password = str(request.json().get("password") or "")
    _committing(lambda cursor: auth.unlock(cursor, request.session, password, request.ip))
    return {"state": "active"}


@route("POST", "/auth/lock", ANY_SESSION)
def lock(request: Request):
    with database.transaction() as cursor:
        auth.lock(cursor, request.session)
    return {"state": "locked"}


@route("POST", "/auth/logout", ANY_SESSION)
def logout(request: Request):
    with database.transaction() as cursor:
        auth.logout(cursor, request.session, request.ip)
    request.handler.set_session_cookie(None)
    return {"state": "logged_out"}


@route("POST", "/auth/password", ACTIVE)
def change_password(request: Request):
    payload = request.json()
    _committing(lambda cursor: auth.change_password(cursor, request.session, str(payload.get("current") or ""), str(payload.get("new") or ""), request.ip))
    return {"changed": True}


@route("POST", "/auth/recovery-codes", ACTIVE)
def recovery_codes(request: Request):
    if not request.session.totp_enabled:
        raise ApiError(409, "totp_not_enabled", "2단계 인증을 먼저 등록해 주세요.")
    with database.transaction() as cursor:
        return {"recovery_codes": auth.regenerate_recovery_codes(cursor, request.session, request.ip)}


@route("GET", "/auth/sessions", ACTIVE)
def sessions(request: Request):
    with database.transaction() as cursor:
        return {"items": auth.list_sessions(cursor, request.session)}


@route("DELETE", "/auth/sessions/([0-9a-f]{16})", ACTIVE)
def revoke_session(request: Request):
    with database.transaction() as cursor:
        auth.revoke_session(cursor, request.session, request.params[0], request.ip)
    return {"revoked": True}


# ================================================================ 감상

@route("GET", "/home", ACTIVE)
def home(request: Request):
    with database.transaction() as cursor:
        return repository.home(cursor, request.session)


@route("GET", "/models", ACTIVE)
def list_models(request: Request):
    with database.transaction() as cursor:
        return {"items": repository.list_models(cursor, request.session, request.arg("sort"))}


@route("POST", "/models", OWNER)
def create_model(request: Request):
    payload = request.json()
    with database.transaction() as cursor:
        return 201, repository.create_model(cursor, request.session, payload)


@route("GET", f"/models/{UUID}", ACTIVE)
def get_model(request: Request):
    with database.transaction() as cursor:
        return repository.get_model(cursor, request.session, request.params[0])


@route("GET", f"/models/{UUID}/photos", ACTIVE)
def model_photos(request: Request):
    with database.transaction() as cursor:
        repository.get_model(cursor, request.session, request.params[0])
        return {"items": repository.model_photos(cursor, request.session, request.params[0])}


@route("PATCH", f"/models/{UUID}", OWNER)
def update_model(request: Request):
    payload = request.json()
    with database.transaction() as cursor:
        return repository.update_model(cursor, request.session, request.params[0], payload)


@route("DELETE", f"/models/{UUID}", OWNER)
def trash_model(request: Request):
    with database.transaction() as cursor:
        repository.trash_model(cursor, request.session, request.params[0])
    return {"trashed": True}


@route("GET", "/albums", ACTIVE)
def list_albums(request: Request):
    with database.transaction() as cursor:
        return repository.list_albums(
            cursor, request.session, request.arg("sort"), request.arg("model_id"),
            limit=request.int_arg("limit", 60, 1, 1000), offset=request.int_arg("offset", 0, 0, 1_000_000),
        )


@route("POST", "/albums", OWNER)
def create_album(request: Request):
    payload = request.json()
    with database.transaction() as cursor:
        return 201, repository.create_album(cursor, request.session, payload)


@route("GET", f"/albums/{UUID}", ACTIVE)
def get_album(request: Request):
    with database.transaction() as cursor:
        return repository.get_album(cursor, request.session, request.params[0])


@route("GET", f"/albums/{UUID}/photos", ACTIVE)
def album_photos(request: Request):
    with database.transaction() as cursor:
        return {"items": repository.album_photos(cursor, request.session, request.params[0])}


@route("PATCH", f"/albums/{UUID}", OWNER)
def update_album(request: Request):
    payload = request.json()
    with database.transaction() as cursor:
        return repository.update_album(cursor, request.session, request.params[0], payload)


@route("DELETE", f"/albums/{UUID}", OWNER)
def trash_album(request: Request):
    with database.transaction() as cursor:
        repository.trash_album(cursor, request.session, request.params[0])
    return {"trashed": True}


@route("GET", f"/photos/{UUID}", ACTIVE)
def get_photo(request: Request):
    with database.transaction() as cursor:
        return repository.get_photo(cursor, request.session, request.params[0])


@route("PATCH", f"/photos/{UUID}", OWNER)
def update_photo(request: Request):
    payload = request.json()
    with database.transaction() as cursor:
        return repository.update_photo(cursor, request.session, request.params[0], payload)


@route("POST", "/photos/bulk", ACTIVE)
def bulk(request: Request):
    payload = request.json()
    action = payload.get("action")
    if action not in BULK_ACTIONS:
        raise ApiError(400, "invalid_action", "지원하지 않는 작업입니다.")
    with database.transaction() as cursor:
        return repository.bulk(cursor, request.session, action, payload.get("ids"), payload)


@route("PUT", f"/favorites/{UUID}", ACTIVE)
def add_favorite(request: Request):
    with database.transaction() as cursor:
        return repository.set_favorite(cursor, request.session, request.params[0], True)


@route("DELETE", f"/favorites/{UUID}", ACTIVE)
def remove_favorite(request: Request):
    with database.transaction() as cursor:
        return repository.set_favorite(cursor, request.session, request.params[0], False)


@route("GET", "/favorites", ACTIVE)
def favorites(request: Request):
    with database.transaction() as cursor:
        return {"items": repository.favorites(cursor, request.session)}


@route("GET", "/search", ACTIVE)
def search(request: Request):
    with database.transaction() as cursor:
        return repository.search(cursor, request.session, request.arg("q", ""))


# ================================================================ 사진 전달

@route("GET", f"/media/{UUID}/(thumb|medium|large|original)", ACTIVE)
def serve_media(request: Request):
    photo_id, variant = request.params
    handler = request.handler
    with database.transaction() as cursor:
        row = repository.media_access(cursor, request.session, photo_id)
        cache = bool(SETTING_CACHE.get(cursor).get("media_cache_enabled"))
    media_root = handler.settings.media_root
    if variant == "original":
        if not (request.session.is_owner or row["can_download"]):
            raise ApiError(403, "forbidden", "원본 다운로드 권한이 없습니다.")
        path = media.original_path(media_root, str(row["id"]), row["created_at"], row["original_ext"])
        content_type = row["mime_type"]
        download = row["original_filename"] if request.arg("download") == "1" else None
    else:
        path = media.derived_path(media_root, str(row["id"]), variant)
        content_type = "image/webp"
        download = None
    if not path.exists():
        if row["status"] == "processing":
            raise ApiError(404, "processing", "사진을 처리하는 중입니다. 잠시 후 다시 확인해 주세요.")
        raise ApiError(404, "not_found", "사진 파일이 없습니다.")
    handler.send_file(path, content_type, f'"{row["id"]}-{variant}-{row["sha256"][:12]}"', cache, download)
    if variant == "original" and download:
        with database.transaction() as cursor:
            repository.audit(cursor, request.session, "photo.download_original", "photo", str(row["id"]), ip=request.ip)
    return None


# ================================================================ 업로드

@route("PUT", "/uploads", OWNER)
def upload(request: Request):
    handler = request.handler
    album_id = request.arg("album_id")
    filename = request.arg("filename", "사진") or "사진"
    try:
        length = int(handler.headers.get("Content-Length") or 0)
    except ValueError:
        length = 0
    if not album_id:
        handler.close_connection = True
        raise ApiError(400, "required", "업로드할 앨범을 선택해 주세요.")
    try:
        received = media.receive_upload(handler.rfile, length, handler.settings)
        handler._body_consumed = True
    except media.MediaError:
        handler.close_connection = True
        raise
    target = None
    try:
        with database.transaction() as cursor:
            photo = repository.create_photo(cursor, request.session, album_id, filename, received)
            target = media.original_path(handler.settings.media_root, photo["id"], photo["created_at"], received["ext"])
            media.commit_original(received["temp"], target)
            job_id = jobs.enqueue(cursor, "photo.process", {"photo_id": photo["id"]})
    except BaseException:
        received["temp"].unlink(missing_ok=True)
        if target is not None:
            target.unlink(missing_ok=True)  # DB 기록 실패 시 보상 처리
        raise
    return 202, {"photo_id": photo["id"], "job_id": job_id, "status": "processing"}


@route("GET", "/uploads/status", OWNER)
def upload_status(request: Request):
    ids = [value for value in (request.arg("ids") or "").split(",") if value]
    with database.transaction() as cursor:
        return {"items": repository.upload_status(cursor, ids)}


# ================================================================ 휴지통·설정·운영

@route("GET", "/trash", OWNER)
def trash_list(request: Request):
    with database.transaction() as cursor:
        items = repository.trash_list(cursor)
        days = repository.setting_value(cursor, "trash_retention_days", 30)
    return {**items, "retention_days": days}


@route("POST", "/trash/restore", OWNER)
def trash_restore(request: Request):
    payload = request.json()
    with database.transaction() as cursor:
        return repository.restore(cursor, request.session, str(payload.get("type")), payload.get("ids"))


@route("POST", "/trash/purge", OWNER)
def trash_purge(request: Request):
    payload = request.json()
    kind = payload.get("type")
    everything = payload.get("all") is True
    if not everything and kind not in {"model", "album", "photo"}:
        raise ApiError(400, "invalid_request", "삭제할 항목을 선택해 주세요.")
    with database.transaction() as cursor:
        files = repository.purge(cursor, request.session, None if everything else kind, None if everything else payload.get("ids"))
    for item in files:
        media.remove_photo_files(request.handler.settings.media_root, item["id"], item["created_at"], item["ext"])
    return {"purged_photos": len(files)}


@route("GET", "/settings", OWNER)
def get_settings(request: Request):
    with database.transaction() as cursor:
        return repository.get_settings(cursor)


@route("PATCH", "/settings", OWNER)
def update_settings(request: Request):
    payload = request.json()
    with database.transaction() as cursor:
        result = repository.update_settings(cursor, request.session, payload)
    SETTING_CACHE.clear()
    return result


@route("GET", "/storage", OWNER)
def storage(request: Request):
    with database.transaction() as cursor:
        stats = repository.storage_stats(cursor)
    return {**stats, "disk": media.disk_usage(request.handler.settings.media_root)}


@route("GET", "/jobs/stats", OWNER)
def job_stats(request: Request):
    return jobs.stats()


@route("GET", "/jobs", OWNER)
def job_list(request: Request):
    status = request.arg("status")
    if status and status not in {"queued", "running", "succeeded", "failed", "canceled"}:
        raise ApiError(400, "invalid_request", "작업 상태 값이 올바르지 않습니다.")
    return {"items": jobs.list_jobs(status, request.int_arg("limit", 50, 1, 500))}


@route("GET", f"/jobs/{UUID}", OWNER)
def job_detail(request: Request):
    job = jobs.get_job(request.params[0])
    if job is None:
        raise ApiError(404, "not_found", "요청한 작업이 없습니다.")
    return job
