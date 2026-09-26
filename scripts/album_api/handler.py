import json
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlsplit

from .config import Settings
from .database import ping


class AlbumRequestHandler(BaseHTTPRequestHandler):
    server_version = "SecretAlbum/0.1"
    settings = Settings.from_environment()

    def do_GET(self) -> None:
        started = time.perf_counter()
        path = urlsplit(self.path).path
        if path == "/health":
            self._json(HTTPStatus.OK, {"status": "ok", "service": "secret_album_api"})
        elif path == "/ready":
            ready, detail = ping()
            self._json(
                HTTPStatus.OK if ready else HTTPStatus.SERVICE_UNAVAILABLE,
                {"status": "ready" if ready else "not_ready", "database": detail},
            )
        else:
            self._json(HTTPStatus.NOT_FOUND, {"error": {"code": "not_found", "message": "요청한 경로가 없습니다."}})
        elapsed_ms = (time.perf_counter() - started) * 1000
        if elapsed_ms >= self.settings.slow_request_ms:
            self.log_message("slow request %.1fms %s", elapsed_ms, path)

    def do_OPTIONS(self) -> None:
        origin = self.headers.get("Origin")
        if origin not in self.settings.web_origins:
            self._json(HTTPStatus.FORBIDDEN, {"error": {"code": "origin_denied", "message": "허용되지 않은 출처입니다."}})
            return
        self.send_response(HTTPStatus.NO_CONTENT)
        self._cors(origin)
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def _json(self, status: HTTPStatus, payload: object) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        origin = self.headers.get("Origin")
        if origin in self.settings.web_origins:
            self._cors(origin)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(body)

    def _cors(self, origin: str) -> None:
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Credentials", "true")
        self.send_header("Vary", "Origin")

