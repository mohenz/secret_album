import logging
import sys
from http.server import ThreadingHTTPServer
from logging.handlers import TimedRotatingFileHandler

from .config import LOG_ROOT


def setup(name: str, level: int = logging.INFO) -> None:
    """local/<name>.log에 하루 단위로 순환 기록하고 14일 보관한다."""
    LOG_ROOT.mkdir(parents=True, exist_ok=True)
    formatter = logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")
    file_handler = TimedRotatingFileHandler(LOG_ROOT / f"{name}.log", when="midnight", backupCount=14, encoding="utf-8", delay=True)
    file_handler.setFormatter(formatter)
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(file_handler)
    if sys.stderr is not None and sys.stderr.isatty():
        console = logging.StreamHandler()
        console.setFormatter(formatter)
        root.addHandler(console)
    root.setLevel(level)


class QuietThreadingHTTPServer(ThreadingHTTPServer):
    """클라이언트가 먼저 연결을 끊은 경우는 오류 추적 대신 한 줄 기록만 남긴다."""

    daemon_threads = True

    def handle_error(self, request, client_address) -> None:
        error = sys.exc_info()[1]
        if isinstance(error, (ConnectionResetError, BrokenPipeError, ConnectionAbortedError, TimeoutError)):
            logging.getLogger("album.server").debug("client disconnected %s: %s", client_address[0], error)
            return
        logging.getLogger("album.server").exception("request error from %s", client_address[0])
