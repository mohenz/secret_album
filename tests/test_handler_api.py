import json
import threading
import unittest
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer

from scripts.album_api.handler import AlbumRequestHandler


class HandlerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), AlbumRequestHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def request(self, path, headers=None):
        connection = HTTPConnection("127.0.0.1", self.server.server_port, timeout=2)
        connection.request("GET", path, headers=headers or {})
        response = connection.getresponse()
        body = json.loads(response.read())
        connection.close()
        return response, body

    def test_health(self):
        response, body = self.request("/health")
        self.assertEqual(response.status, 200)
        self.assertEqual(body["status"], "ok")
        self.assertEqual(response.getheader("Cache-Control"), "no-store")

    def test_unknown_route(self):
        response, body = self.request("/missing")
        self.assertEqual(response.status, 404)
        self.assertEqual(body["error"]["code"], "not_found")

    def test_cors_only_echoes_allowed_origin(self):
        response, _ = self.request("/health", {"Origin": "https://example.invalid"})
        self.assertIsNone(response.getheader("Access-Control-Allow-Origin"))

