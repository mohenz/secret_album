"""로그인·세션.

세션 상태
- active: 사용 가능
- locked: 유휴 시간 초과 또는 직접 잠금. 비밀번호만 다시 입력하면 풀린다.
"""

import hashlib
import secrets
import threading
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from .config import (
    LOGIN_LOCK_MINUTES,
    LOGIN_MAX_FAILURES,
    LOGIN_RATE_PER_MINUTE,
    MIN_PASSWORD_LENGTH,
)

_DUMMY_HASH: str | None = None


class AuthError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def _hasher():
    from argon2 import PasswordHasher

    return PasswordHasher(time_cost=3, memory_cost=65536, parallelism=2)


def hash_password(password: str) -> str:
    return _hasher().hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

    try:
        return _hasher().verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def _dummy_verify(password: str) -> None:
    """없는 아이디도 같은 시간이 걸리게 해 아이디 존재 여부를 드러내지 않는다."""
    global _DUMMY_HASH
    if _DUMMY_HASH is None:
        _DUMMY_HASH = hash_password(secrets.token_urlsafe(16))
    verify_password(_DUMMY_HASH, password)


def validate_new_password(password: str, login_id: str) -> None:
    if len(password) < MIN_PASSWORD_LENGTH:
        raise AuthError(400, "weak_password", f"Password must be at least {MIN_PASSWORD_LENGTH} characters. Please enter a longer password.")
    if login_id and login_id.lower() in password.lower():
        raise AuthError(400, "weak_password", "Password cannot contain your username. Please choose a different password.")


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


class RateLimiter:
    """IP별 분당 요청 수 제한 (프로세스 메모리)."""

    def __init__(self, per_minute: int = LOGIN_RATE_PER_MINUTE) -> None:
        self.per_minute = per_minute
        self._hits: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def check(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            # 1분 넘게 조용한 IP는 지워 메모리가 계속 늘지 않게 한다.
            if len(self._hits) > 1000:
                self._hits = {k: v for k, v in self._hits.items() if v and now - v[-1] < 60}
            hits = [t for t in self._hits.get(key, []) if now - t < 60]
            if len(hits) >= self.per_minute:
                self._hits[key] = hits
                raise AuthError(429, "rate_limited", "Too many requests. Please try again in a minute.")
            hits.append(now)
            self._hits[key] = hits


@dataclass(frozen=True)
class SessionInfo:
    session_id: str
    user_id: str
    login_id: str
    display_name: str
    role: str
    state: str

    @property
    def is_owner(self) -> bool:
        return self.role == "owner"


def _now() -> datetime:
    return datetime.now(UTC)


def _audit(cursor, user_id, action: str, ip: str | None, detail: dict | None = None) -> None:
    from psycopg.types.json import Jsonb

    cursor.execute(
        "INSERT INTO audit_logs(user_id, action, detail, ip) VALUES (%s, %s, %s, %s)",
        (user_id, action, Jsonb(detail or {}), ip),
    )


def create_user(cursor, login_id: str, display_name: str, password: str, role: str = "owner") -> str:
    login_id = login_id.strip()
    if not login_id or len(login_id) > 64 or not all(ch.isalnum() or ch in "._-" for ch in login_id):
        raise AuthError(400, "invalid_login_id", "Username must be up to 64 letters, numbers, periods, underscores, or hyphens.")
    validate_new_password(password, login_id)
    cursor.execute("SELECT 1 FROM users WHERE lower(login_id) = lower(%s)", (login_id,))
    if cursor.fetchone():
        raise AuthError(409, "duplicate_login_id", "That username is already taken. Please choose another.")
    cursor.execute(
        "INSERT INTO users(login_id, display_name, password_hash, role, password_changed_at) VALUES (%s, %s, %s, %s, now()) RETURNING id",
        (login_id, display_name.strip() or login_id, hash_password(password), role),
    )
    user_id = str(cursor.fetchone()["id"])
    _audit(cursor, user_id, "user.create", None, {"role": role})
    return user_id


def login(cursor, login_id: str, password: str, ip: str | None, user_agent: str | None, max_days: int) -> tuple[str, str]:
    """비밀번호 확인 후 새 세션을 만든다. (쿠키 토큰, 세션 상태)를 돌려준다."""
    generic = AuthError(401, "invalid_credentials", "Incorrect username or password. Please try again.")
    cursor.execute(
        "SELECT id, login_id, password_hash, role, failed_login_count, locked_until, disabled_at "
        "FROM users WHERE lower(login_id) = lower(%s) FOR UPDATE",
        ((login_id or "").strip(),),
    )
    user = cursor.fetchone()
    if user is None or user["disabled_at"] is not None:
        _dummy_verify(password or "")
        _audit(cursor, None, "auth.login_failed", ip, {"reason": "unknown_or_disabled"})
        raise generic
    if user["locked_until"] and user["locked_until"] > _now():
        minutes = max(1, int((user["locked_until"] - _now()).total_seconds() // 60) + 1)
        raise AuthError(423, "account_locked", f"Too many failed sign-in attempts ({LOGIN_MAX_FAILURES}). Try again in {minutes} minute(s).")
    if not verify_password(user["password_hash"], password or ""):
        failures = user["failed_login_count"] + 1
        locked_until = _now() + timedelta(minutes=LOGIN_LOCK_MINUTES) if failures >= LOGIN_MAX_FAILURES else None
        cursor.execute(
            "UPDATE users SET failed_login_count = %s, locked_until = %s, updated_at = now() WHERE id = %s",
            (0 if locked_until else failures, locked_until, user["id"]),
        )
        _audit(cursor, user["id"], "auth.login_failed", ip, {"failures": failures})
        if locked_until:
            raise AuthError(423, "account_locked", f"Too many failed sign-in attempts ({LOGIN_MAX_FAILURES}). Try again in {LOGIN_LOCK_MINUTES} minutes.")
        raise generic
    cursor.execute("UPDATE users SET failed_login_count = 0, locked_until = NULL, updated_at = now() WHERE id = %s", (user["id"],))
    if _hasher().check_needs_rehash(user["password_hash"]):
        cursor.execute("UPDATE users SET password_hash = %s WHERE id = %s", (hash_password(password), user["id"]))

    token = secrets.token_urlsafe(32)
    cursor.execute(
        "INSERT INTO sessions(id, user_id, expires_at, user_agent, ip) VALUES (%s, %s, %s, %s, %s)",
        (token_hash(token), user["id"], _now() + timedelta(days=max_days), (user_agent or "")[:300], ip),
    )
    _audit(cursor, user["id"], "auth.login", ip)
    return token, "active"


def load_session(cursor, token: str | None, idle_minutes: int) -> SessionInfo | None:
    if not token:
        return None
    cursor.execute(
        "SELECT s.id, s.last_seen_at, s.expires_at, s.revoked_at, s.locked_at, "
        "u.id AS user_id, u.login_id, u.display_name, u.role, u.disabled_at "
        "FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = %s",
        (token_hash(token),),
    )
    row = cursor.fetchone()
    now = _now()
    if row is None or row["revoked_at"] is not None or row["expires_at"] <= now or row["disabled_at"] is not None:
        return None
    if row["locked_at"] is not None or now - row["last_seen_at"] > timedelta(minutes=idle_minutes):
        state = "locked"
    else:
        state = "active"
        if now - row["last_seen_at"] > timedelta(seconds=30):
            cursor.execute("UPDATE sessions SET last_seen_at = now() WHERE id = %s", (row["id"],))
    return SessionInfo(
        session_id=row["id"],
        user_id=str(row["user_id"]),
        login_id=row["login_id"],
        display_name=row["display_name"],
        role=row["role"],
        state=state,
    )


def unlock(cursor, session: SessionInfo, password: str, ip: str | None) -> None:
    cursor.execute("SELECT password_hash, failed_login_count FROM users WHERE id = %s FOR UPDATE", (session.user_id,))
    user = cursor.fetchone()
    if not verify_password(user["password_hash"], password or ""):
        failures = user["failed_login_count"] + 1
        if failures >= LOGIN_MAX_FAILURES:
            cursor.execute("UPDATE sessions SET revoked_at = now() WHERE id = %s", (session.session_id,))
            cursor.execute(
                "UPDATE users SET failed_login_count = 0, locked_until = now() + %s WHERE id = %s",
                (timedelta(minutes=LOGIN_LOCK_MINUTES), session.user_id),
            )
            _audit(cursor, session.user_id, "auth.unlock_failed_locked", ip)
            raise AuthError(423, "account_locked", f"Unlock failed {LOGIN_MAX_FAILURES} times, so you were signed out. Sign in again in {LOGIN_LOCK_MINUTES} minutes.")
        cursor.execute("UPDATE users SET failed_login_count = %s WHERE id = %s", (failures, session.user_id))
        _audit(cursor, session.user_id, "auth.unlock_failed", ip)
        raise AuthError(401, "invalid_credentials", "Incorrect password. Please try again.")
    cursor.execute("UPDATE users SET failed_login_count = 0 WHERE id = %s", (session.user_id,))
    cursor.execute("UPDATE sessions SET locked_at = NULL, last_seen_at = now() WHERE id = %s", (session.session_id,))
    _audit(cursor, session.user_id, "auth.unlock", ip)


def lock(cursor, session: SessionInfo) -> None:
    cursor.execute("UPDATE sessions SET locked_at = now() WHERE id = %s", (session.session_id,))


def logout(cursor, session: SessionInfo, ip: str | None) -> None:
    cursor.execute("UPDATE sessions SET revoked_at = now() WHERE id = %s", (session.session_id,))
    _audit(cursor, session.user_id, "auth.logout", ip)


def change_password(cursor, session: SessionInfo, current: str, new: str, ip: str | None) -> None:
    cursor.execute("SELECT password_hash FROM users WHERE id = %s FOR UPDATE", (session.user_id,))
    if not verify_password(cursor.fetchone()["password_hash"], current or ""):
        raise AuthError(401, "invalid_credentials", "Current password is incorrect. Please try again.")
    validate_new_password(new or "", session.login_id)
    cursor.execute(
        "UPDATE users SET password_hash = %s, password_changed_at = now(), updated_at = now() WHERE id = %s",
        (hash_password(new), session.user_id),
    )
    # 다른 기기의 세션은 모두 끊는다.
    cursor.execute("UPDATE sessions SET revoked_at = now() WHERE user_id = %s AND id <> %s AND revoked_at IS NULL", (session.user_id, session.session_id))
    _audit(cursor, session.user_id, "auth.password_changed", ip)


def list_sessions(cursor, session: SessionInfo) -> list[dict]:
    cursor.execute(
        "SELECT id, created_at, last_seen_at, user_agent, host(ip) AS ip FROM sessions "
        "WHERE user_id = %s AND revoked_at IS NULL AND expires_at > now() ORDER BY last_seen_at DESC",
        (session.user_id,),
    )
    rows = cursor.fetchall()
    return [
        {
            "id": row["id"][:16],
            "current": row["id"] == session.session_id,
            "created_at": row["created_at"].isoformat(),
            "last_seen_at": row["last_seen_at"].isoformat(),
            "user_agent": row["user_agent"],
            "ip": row["ip"],
        }
        for row in rows
    ]


def revoke_session(cursor, session: SessionInfo, short_id: str, ip: str | None) -> None:
    if not short_id or len(short_id) != 16 or not all(c in "0123456789abcdef" for c in short_id):
        raise AuthError(400, "invalid_session", "Invalid session ID.")
    cursor.execute(
        "UPDATE sessions SET revoked_at = now() WHERE user_id = %s AND left(id, 16) = %s AND revoked_at IS NULL",
        (session.user_id, short_id),
    )
    if cursor.rowcount == 0:
        raise AuthError(404, "not_found", "Session not found. Please refresh the list.")
    _audit(cursor, session.user_id, "auth.session_revoked", ip)


def cleanup_sessions(cursor) -> int:
    cursor.execute("DELETE FROM sessions WHERE expires_at < now() - interval '1 day' OR revoked_at < now() - interval '1 day'")
    return cursor.rowcount
