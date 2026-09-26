from __future__ import annotations

import signal
import threading


STOP = threading.Event()


def main() -> None:
    def stop(_signum: int, _frame: object) -> None:
        STOP.set()

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    print("비밀앨범 Worker 대기 중", flush=True)
    while not STOP.wait(5):
        pass


if __name__ == "__main__":
    main()

