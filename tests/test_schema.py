from pathlib import Path
import unittest


class SchemaTests(unittest.TestCase):
    def test_required_tables_are_declared(self):
        schema = (Path(__file__).parents[1] / "local" / "schema.sql").read_text(encoding="utf-8").lower()
        required = {
            "users", "sessions", "models", "albums", "photos", "tags", "photo_tags",
            "favorites", "album_shares", "app_settings", "audit_logs", "background_jobs",
        }
        for table in required:
            self.assertIn(f"create table if not exists {table}", schema)

    def test_schema_has_trigram_search_and_active_album_index(self):
        schema = (Path(__file__).parents[1] / "local" / "schema.sql").read_text(encoding="utf-8").lower()
        self.assertIn("create extension if not exists pg_trgm", schema)
        self.assertIn("photos_album_position_active_idx", schema)

