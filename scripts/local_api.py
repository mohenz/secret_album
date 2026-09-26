from __future__ import annotations

from http.server import ThreadingHTTPServer

from album_api.config import Settings
from album_api.handler import AlbumRequestHandler

Handler = AlbumRequestHandler


def main() -> None:
    settings = Settings.from_environment()
    server = ThreadingHTTPServer((settings.api_host, settings.api_port), Handler)
    print(f"비밀앨범 API: http://{settings.api_host}:{settings.api_port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

