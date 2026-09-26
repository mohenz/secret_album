import os
import unittest
from unittest.mock import patch

from scripts.album_api.config import Settings


class SettingsTests(unittest.TestCase):
    def test_defaults_use_private_local_paths_and_expected_ports(self):
        with patch.dict(os.environ, {}, clear=True):
            settings = Settings.from_environment()
        self.assertEqual(settings.api_port, 3051)
        self.assertEqual(settings.media_root.name, "media")
        self.assertIn("http://127.0.0.1:8090", settings.web_origins)

    def test_invalid_integer_is_rejected(self):
        with patch.dict(os.environ, {"ALBUM_API_PORT": "wrong"}, clear=True):
            with self.assertRaises(ValueError):
                Settings.from_environment()

