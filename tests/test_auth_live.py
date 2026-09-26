import unittest

import pyotp

from tests.live_support import Client, _state, create_user, login_owner, setup_live

PASSWORD = "correct-horse-battery"


class AuthLiveTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        setup_live()
        create_user("owner.auth", PASSWORD)

    def test_01_protected_routes_require_session(self):
        client = Client()
        for path in ("/albums", "/models", "/home", "/media/00000000-0000-0000-0000-000000000000/thumb", "/settings"):
            status, body = client.json("GET", path)
            self.assertEqual(status, 401, path)
            self.assertEqual(body["error"]["code"], "unauthenticated")

    def test_02_owner_must_register_totp_then_is_active(self):
        client = Client()
        status, body = client.json("POST", "/auth/login", {"login_id": "owner.auth", "password": PASSWORD})
        self.assertEqual((status, body["state"]), (200, "totp_setup_required"))
        # 2단계 인증 전에는 사진 API를 쓸 수 없다.
        status, body = client.json("GET", "/albums")
        self.assertEqual((status, body["error"]["code"]), (401, "totp_setup_required"))
        status, setup = client.json("GET", "/auth/totp/setup")
        self.assertEqual(status, 200)
        self.assertTrue(setup["uri"].startswith("otpauth://totp/"))
        status, body = client.json("POST", "/auth/totp/enable", {"code": "000000"})
        self.assertEqual(status, 401)
        status, body = client.json("POST", "/auth/totp/enable", {"code": pyotp.TOTP(setup["secret"]).now()})
        self.assertEqual(status, 200)
        self.assertEqual(len(body["recovery_codes"]), 10)
        _state.setdefault("totp", {})["owner.auth"] = setup["secret"]
        _state["recovery"] = body["recovery_codes"]
        status, me = client.json("GET", "/auth/me")
        self.assertEqual((status, me["state"], me["user"]["role"]), (200, "active", "owner"))

    def test_03_second_login_requires_code_and_accepts_recovery_code_once(self):
        client = Client()
        status, body = client.json("POST", "/auth/login", {"login_id": "owner.auth", "password": PASSWORD})
        self.assertEqual(body["state"], "mfa_required")
        code = _state["recovery"][0]
        status, body = client.json("POST", "/auth/otp", {"code": code})
        self.assertEqual(status, 200)
        other = Client()
        other.json("POST", "/auth/login", {"login_id": "owner.auth", "password": PASSWORD})
        status, body = other.json("POST", "/auth/otp", {"code": code})
        self.assertEqual(status, 401, "복구 코드는 한 번만 쓸 수 있어야 한다")

    def test_04_lock_and_unlock(self):
        client = Client()
        login_owner(client, "owner.auth", PASSWORD)
        self.assertEqual(client.json("POST", "/auth/lock")[0], 200)
        status, body = client.json("GET", "/albums")
        self.assertEqual((status, body["error"]["code"]), (401, "locked"))
        self.assertEqual(client.json("POST", "/auth/unlock", {"password": "wrong-password-x"})[0], 401)
        self.assertEqual(client.json("POST", "/auth/unlock", {"password": PASSWORD})[0], 200)
        self.assertEqual(client.json("GET", "/albums")[0], 200)

    def test_05_logout_revokes_session(self):
        client = Client()
        login_owner(client, "owner.auth", PASSWORD)
        cookie = client.cookie
        self.assertEqual(client.json("POST", "/auth/logout")[0], 200)
        self.assertIsNone(client.cookie)
        replay = Client()
        replay.cookie = cookie
        self.assertEqual(replay.json("GET", "/albums")[0], 401)

    def test_06_failed_logins_lock_account_and_do_not_reveal_ids(self):
        create_user("owner.lockout", PASSWORD, role="viewer")
        client = Client()
        status, unknown = client.json("POST", "/auth/login", {"login_id": "no.such.user", "password": "x" * 12})
        status2, wrong = client.json("POST", "/auth/login", {"login_id": "owner.lockout", "password": "x" * 12})
        self.assertEqual((status, status2), (401, 401))
        self.assertEqual(unknown["error"]["message"], wrong["error"]["message"])
        for _ in range(3):
            client.json("POST", "/auth/login", {"login_id": "owner.lockout", "password": "x" * 12})
        status, body = client.json("POST", "/auth/login", {"login_id": "owner.lockout", "password": "x" * 12})
        self.assertEqual((status, body["error"]["code"]), (423, "account_locked"))
        # 잠긴 동안에는 올바른 비밀번호도 거부한다.
        status, body = client.json("POST", "/auth/login", {"login_id": "owner.lockout", "password": PASSWORD})
        self.assertEqual(status, 423)

    def test_07_foreign_origin_is_rejected_for_changes(self):
        client = Client()
        status, body = client.json("POST", "/auth/login", {"login_id": "owner.auth", "password": PASSWORD}, headers={"Origin": "https://evil.example"})
        self.assertEqual((status, body["error"]["code"]), (403, "origin_denied"))
        response, _, _ = client.request("GET", "/health", headers={"Origin": "https://evil.example"})
        self.assertIsNone(response.getheader("Access-Control-Allow-Origin"))
        response, _, _ = client.request("GET", "/health")
        self.assertEqual(response.getheader("Access-Control-Allow-Origin"), "http://127.0.0.1:8090")
        self.assertEqual(response.getheader("Access-Control-Allow-Credentials"), "true")

    def test_08_session_cookie_flags(self):
        client = Client()
        response, _, _ = client.request("POST", "/auth/login", {"login_id": "owner.auth", "password": PASSWORD})
        cookie = response.getheader("Set-Cookie")
        self.assertIn("HttpOnly", cookie)
        self.assertIn("SameSite=Strict", cookie)

    def test_09_password_change_revokes_other_sessions(self):
        create_user("owner.pw", PASSWORD, role="viewer")
        first, second = Client(), Client()
        first.json("POST", "/auth/login", {"login_id": "owner.pw", "password": PASSWORD})
        second.json("POST", "/auth/login", {"login_id": "owner.pw", "password": PASSWORD})
        status, body = first.json("POST", "/auth/password", {"current": PASSWORD, "new": "short"})
        self.assertEqual((status, body["error"]["code"]), (400, "weak_password"))
        status, _ = first.json("POST", "/auth/password", {"current": PASSWORD, "new": "another-long-password"})
        self.assertEqual(status, 200)
        self.assertEqual(second.json("GET", "/auth/me")[0], 401)
        self.assertEqual(first.json("GET", "/auth/me")[0], 200)


if __name__ == "__main__":
    unittest.main()
