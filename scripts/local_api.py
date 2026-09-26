import logging

from album_api import database, logs
from album_api.config import Settings
from album_api.handler import AlbumRequestHandler

Handler = AlbumRequestHandler


def main() -> None:
    logs.setup("api")
    settings = Settings.from_environment()
    database.configure(settings.db_pool_size)
    server = logs.QuietThreadingHTTPServer((settings.api_host, settings.api_port), Handler)
    logging.getLogger("album.api").info("비밀앨범 API: http://%s:%s", settings.api_host, settings.api_port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
