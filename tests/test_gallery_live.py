import io
import unittest
from urllib.parse import quote

from tests.live_support import Client, _state, create_user, login_owner, run_jobs, sample_jpeg, setup_live

PASSWORD = "gallery-owner-password"


class GalleryLiveTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        setup_live()
        create_user("owner.gallery", PASSWORD)
        cls.owner = Client()
        login_owner(cls.owner, "owner.gallery", PASSWORD)
        status, model = cls.owner.json("POST", "/models", {"name": "한서윤", "stage_name": "서윤"})
        assert status == 201, model
        cls.model_id = model["id"]
        status, album = cls.owner.json("POST", "/albums", {"model_id": cls.model_id, "title": "가을 성수 스튜디오", "shot_on": "2026-09-12", "location": "서울 성동구 성수동"})
        assert status == 201, album
        cls.album_id = album["id"]

    def upload(self, data: bytes, filename: str = "SEOYUN_0912_0034.jpg", album_id: str | None = None):
        return self.owner.request(
            "PUT", f"/uploads?album_id={album_id or self.album_id}&filename={filename}", raw=data,
            headers={"Content-Type": "application/octet-stream"},
        )

    def test_01_upload_process_and_serve(self):
        response, body, _ = self.upload(sample_jpeg(marker=1))
        self.assertEqual(response.status, 202, body)
        photo_id = body["photo_id"]
        # 처리 전에는 파생 이미지가 없다.
        response, body, _ = self.owner.request("GET", f"/media/{photo_id}/thumb")
        self.assertEqual((response.status, body["error"]["code"]), (404, "processing"))
        self.assertGreaterEqual(run_jobs(), 1)
        status, detail = self.owner.json("GET", f"/photos/{photo_id}")
        self.assertEqual(detail["status"], "ready")
        self.assertEqual((detail["w"], detail["h"]), (1200, 800))
        self.assertEqual(detail["camera"], "TEST CAMERA X1")
        self.assertEqual(detail["exposure"]["shutter"], "1/250 s")
        self.assertTrue(detail["taken_at"].startswith("2026-09-12T14:30"))
        response, _, content = self.owner.request("GET", f"/media/{photo_id}/thumb")
        self.assertEqual(response.status, 200)
        self.assertEqual(response.getheader("Content-Type"), "image/webp")
        self.assertEqual(response.getheader("Cache-Control"), "private, no-cache")
        from PIL import Image

        with Image.open(io.BytesIO(content)) as thumb:
            self.assertEqual(max(thumb.size), 480)
            self.assertFalse(thumb.getexif(), "파생 이미지에는 EXIF(GPS 포함)가 없어야 한다")
        etag = response.getheader("ETag")
        response, _, _ = self.owner.request("GET", f"/media/{photo_id}/thumb", headers={"If-None-Match": etag})
        self.assertEqual(response.status, 304)
        response, _, content = self.owner.request("GET", f"/media/{photo_id}/original")
        self.assertEqual(response.status, 200)
        self.assertEqual(response.getheader("Content-Type"), "image/jpeg")
        self.assertEqual(Client().request("GET", f"/media/{photo_id}/thumb")[0].status, 401)
        type(self).photo_id = photo_id

    def test_02_duplicate_and_bad_type_are_rejected(self):
        response, body, _ = self.upload(sample_jpeg(marker=1))
        self.assertEqual((response.status, body["error"]["code"]), (409, "duplicate"))
        response, body, _ = self.upload(b"not an image at all" * 10, "note.txt")
        self.assertEqual((response.status, body["error"]["code"]), (415, "unsupported_type"))
        self.assertEqual(list((_state["media_root"] / "uploads").glob("*.part")), [], "실패한 업로드 임시 파일이 남으면 안 된다")

    def test_03_album_listing_and_cover(self):
        for marker in (2, 3):
            self.upload(sample_jpeg(color=(20 * marker, 90, 120), size=(800, 1200), marker=marker))
        run_jobs()
        status, photos = self.owner.json("GET", f"/albums/{self.album_id}/photos")
        self.assertEqual(len(photos["items"]), 3)
        self.assertTrue(all(p["status"] == "ready" for p in photos["items"]))
        status, album = self.owner.json("GET", f"/albums/{self.album_id}")
        self.assertEqual((album["photo_count"], album["cover"]["id"]), (3, photos["items"][0]["id"]))
        status, home = self.owner.json("GET", "/home")
        self.assertEqual(home["hero"]["id"], self.album_id)
        status, models = self.owner.json("GET", "/models")
        self.assertEqual(models["items"][0]["photo_count"], 3)
        ids = [p["id"] for p in photos["items"]]
        status, _ = self.owner.json("POST", "/photos/bulk", {"action": "reorder", "ids": list(reversed(ids))})
        self.assertEqual(status, 200)
        status, photos = self.owner.json("GET", f"/albums/{self.album_id}/photos")
        self.assertEqual([p["id"] for p in photos["items"]], list(reversed(ids)))
        type(self).photo_ids = ids
        status, recent = self.owner.json("GET", "/uploads/recent?limit=2")
        self.assertEqual(status, 200)
        self.assertEqual(len(recent["items"]), 2)
        self.assertEqual(recent["items"][0]["album_title"], "가을 성수 스튜디오")

    def test_04_tags_favorites_and_search(self):
        photo_id = self.photo_ids[0]
        status, detail = self.owner.json("PATCH", f"/photos/{photo_id}", {"caption": "창가 역광", "tags": ["흑백", "프로필", "흑백"]})
        self.assertEqual((status, detail["tags"]), (200, ["프로필", "흑백"]))
        self.assertEqual(self.owner.json("PUT", f"/favorites/{photo_id}")[0], 200)
        status, favs = self.owner.json("GET", "/favorites")
        self.assertEqual([p["id"] for p in favs["items"]], [photo_id])
        status, found = self.owner.json("GET", "/search?q=" + quote("흑백"))
        self.assertEqual([t["name"] for t in found["tags"]], ["흑백"])
        self.assertIn(photo_id, [p["id"] for p in found["photos"]])
        status, found = self.owner.json("GET", "/search?q=" + quote("성수"))
        self.assertEqual([a["id"] for a in found["albums"]], [self.album_id])
        status, found = self.owner.json("GET", "/search?q=" + quote("서윤"))
        self.assertEqual([m["id"] for m in found["models"]], [self.model_id])

    def test_05_trash_restore_and_purge(self):
        photo_id = self.photo_ids[1]
        self.assertEqual(self.owner.json("POST", "/photos/bulk", {"action": "trash", "ids": [photo_id]})[0], 200)
        status, photos = self.owner.json("GET", f"/albums/{self.album_id}/photos")
        self.assertNotIn(photo_id, [p["id"] for p in photos["items"]])
        status, trash = self.owner.json("GET", "/trash")
        self.assertIn(photo_id, [t["id"] for t in trash["items"]])
        status, _ = self.owner.json("POST", "/trash/restore", {"type": "photo", "ids": [photo_id]})
        self.assertEqual(status, 200)
        self.owner.json("POST", "/photos/bulk", {"action": "trash", "ids": [photo_id]})
        derived = _state["media_root"] / "derived" / photo_id[:2] / photo_id
        self.assertTrue(derived.exists())
        status, body = self.owner.json("POST", "/trash/purge", {"type": "photo", "ids": [photo_id]})
        self.assertEqual((status, body["purged_photos"]), (200, 1))
        self.assertFalse(derived.exists(), "영구 삭제하면 파생 이미지도 지워져야 한다")
        self.assertEqual(self.owner.json("GET", f"/photos/{photo_id}")[0], 404)

    def test_06_album_trash_cascades_and_parent_rule(self):
        status, album = self.owner.json("POST", "/albums", {"model_id": self.model_id, "title": "제주 협재 해변"})
        album_id = album["id"]
        response, body, _ = self.upload(sample_jpeg(marker=40), album_id=album_id)
        photo_id = body["photo_id"]
        run_jobs()
        self.assertEqual(self.owner.json("DELETE", f"/albums/{album_id}")[0], 200)
        status, trash = self.owner.json("GET", "/trash")
        kinds = {(t["type"], t["id"]) for t in trash["items"]}
        self.assertIn(("album", album_id), kinds)
        self.assertNotIn(("photo", photo_id), kinds, "앨범과 함께 들어간 사진은 따로 보이지 않는다")
        status, body = self.owner.json("POST", "/trash/restore", {"type": "photo", "ids": [photo_id]})
        self.assertEqual((status, body["error"]["code"]), (409, "parent_in_trash"))
        self.assertEqual(self.owner.json("POST", "/trash/restore", {"type": "album", "ids": [album_id]})[0], 200)
        self.assertEqual(self.owner.json("GET", f"/photos/{photo_id}")[0], 200)

    def test_07_viewer_sees_only_shared_albums(self):
        create_user("viewer.one", "viewer-password-1", role="viewer")
        viewer = Client()
        login_owner(viewer, "viewer.one", "viewer-password-1")
        photo_id = self.photo_ids[0]
        self.assertEqual(viewer.json("GET", f"/albums/{self.album_id}")[0], 404)
        self.assertEqual(viewer.request("GET", f"/media/{photo_id}/thumb")[0].status, 404)
        status, albums = viewer.json("GET", "/albums")
        self.assertEqual(albums["total"], 0)
        self.assertEqual(viewer.json("POST", "/models", {"name": "침입"})[0], 403)
        from scripts.album_api import database

        with database.transaction() as cursor:
            cursor.execute("SELECT id FROM users WHERE login_id = 'viewer.one'")
            viewer_id = cursor.fetchone()["id"]
            cursor.execute("INSERT INTO album_shares(album_id, user_id, can_download) VALUES (%s, %s, false)", (self.album_id, viewer_id))
        self.assertEqual(viewer.json("GET", f"/albums/{self.album_id}")[0], 200)
        self.assertEqual(viewer.request("GET", f"/media/{photo_id}/thumb")[0].status, 200)
        self.assertEqual(viewer.request("GET", f"/media/{photo_id}/original")[0].status, 403)
        self.assertEqual(viewer.json("PUT", f"/favorites/{photo_id}")[0], 200)
        self.assertEqual(viewer.json("POST", "/photos/bulk", {"action": "trash", "ids": [photo_id]})[0], 403)

    def test_08_settings_validation(self):
        status, body = self.owner.json("PATCH", "/settings", {"session_idle_minutes": 0})
        self.assertEqual(status, 400)
        status, body = self.owner.json("PATCH", "/settings", {"session_idle_minutes": 30, "blur_thumbnails": True})
        self.assertEqual((status, body["session_idle_minutes"], body["blur_thumbnails"]), (200, 30, True))
        status, body = self.owner.json("PATCH", "/settings", {"unknown": 1})
        self.assertEqual(status, 400)
        status, storage = self.owner.json("GET", "/storage")
        self.assertGreater(storage["disk"]["total"], 0)

    def test_09_invalid_ids_and_path_tricks(self):
        self.assertEqual(self.owner.json("GET", "/albums/not-a-uuid")[0], 404)
        self.assertEqual(self.owner.request("GET", "/media/..%2F..%2Fpostgres/thumb")[0].status, 404)
        self.assertEqual(self.owner.request("GET", f"/media/{self.photo_ids[0]}/secret")[0].status, 404)


if __name__ == "__main__":
    unittest.main()
