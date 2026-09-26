"""정적 화면 서버. web/ 폴더만 제공하고 보안 헤더를 붙인다.

  python scripts\\web_server.py --port 8090 --bind 127.0.0.1
"""

import argparse
import functools
import logging
from http.server import SimpleHTTPRequestHandler
from pathlib import Path

from album_api import logs

WEB_ROOT = Path(__file__).resolve().parents[1] / "web"
logger = logging.getLogger("album.web")


class WebHandler(SimpleHTTPRequestHandler):
    server_version = "SecretAlbumWeb/1.0"
    sys_version = ""
    api_sources = ""
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".html": "text/html; charset=utf-8",
        ".svg": "image/svg+xml",
        ".woff2": "font/woff2",
    }

    api_port = 3051

    def do_GET(self) -> None:
        # API 포트는 서버 설정을 따른다 (web/assets/js/api-config.js는 기본값 파일).
        if self.path.split("?", 1)[0] == "/assets/js/api-config.js":
            body = f"export const API_BASE = `${{location.protocol}}//${{location.hostname}}:{self.api_port}`;\n".encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/javascript; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def list_directory(self, path):  # 폴더 목록은 보여 주지 않는다.
        self.send_error(404, "Not Found")
        return None

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Robots-Tag", "noindex, nofollow")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; "
            f"connect-src 'self' {self.api_sources}; img-src 'self' blob: data: {self.api_sources}; "
            "style-src 'self'; script-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; "
            "frame-ancestors 'none'; form-action 'self'",
        )
        # 배포 직후 새 화면 파일이 바로 반영되도록 매번 재검증한다.
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, format: str, *args) -> None:  # noqa: A002
        logger.info("%s %s", self.client_address[0], format % args)


def main() -> None:
    parser = argparse.ArgumentParser(description="비밀앨범 정적 화면 서버")
    parser.add_argument("--port", type=int, default=8090)
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--api-port", type=int, default=3051)
    args = parser.parse_args()
    logs.setup("web")
    # 화면은 접속한 호스트 이름 그대로 API 포트에 요청한다.
    WebHandler.api_port = args.api_port
    WebHandler.api_sources = f"http://*:{args.api_port} https://*:{args.api_port} http://localhost:{args.api_port} http://127.0.0.1:{args.api_port}"
    server = logs.QuietThreadingHTTPServer((args.bind, args.port), functools.partial(WebHandler, directory=str(WEB_ROOT)))
    logger.info("비밀앨범 화면: http://%s:%s", args.bind, args.port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
