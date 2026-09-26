import logging
import sys
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
