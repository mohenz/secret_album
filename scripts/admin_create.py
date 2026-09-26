"""최초 소유자 계정 생성. 웹 가입 화면은 없고 서버에서 한 번 실행한다.

  .\\.venv\\Scripts\\python.exe scripts\\admin_create.py
  (아이디·표시 이름·비밀번호를 차례로 묻는다. 비밀번호는 화면에 표시되지 않는다.)

자동화용: --login-id, --display-name, --password-stdin (표준 입력 첫 줄을 비밀번호로 사용)
"""

import argparse
import getpass
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))

from album_api import auth, database  # noqa: E402


def load_env() -> None:
    import os

    env_file = SCRIPTS.parent / "local" / "album.env"
    if not env_file.exists():
        raise SystemExit("local/album.env가 없습니다. 먼저 .\\sa.cmd 또는 scripts\\start_local_db.ps1을 실행해 주세요.")
    for line in env_file.read_text(encoding="utf-8-sig").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())


def main() -> int:
    parser = argparse.ArgumentParser(description="비밀앨범 소유자 계정 생성")
    parser.add_argument("--login-id")
    parser.add_argument("--display-name")
    parser.add_argument("--password-stdin", action="store_true")
    parser.add_argument("--role", choices=["owner", "viewer"], default="owner")
    args = parser.parse_args()
    load_env()

    with database.transaction() as cursor:
        cursor.execute("SELECT count(*) AS n FROM users WHERE role = 'owner'")
        owners = cursor.fetchone()["n"]
    if args.role == "owner" and owners > 0:
        print("소유자 계정이 이미 있습니다. 추가 소유자는 만들지 않습니다.", file=sys.stderr)
        return 1

    login_id = args.login_id or input("아이디: ").strip()
    display_name = args.display_name or input("표시 이름: ").strip() or login_id
    if args.password_stdin:
        password = sys.stdin.readline().rstrip("\r\n")
    else:
        password = getpass.getpass("비밀번호(10자 이상): ")
        if getpass.getpass("비밀번호 확인: ") != password:
            print("비밀번호가 서로 다릅니다. 다시 실행해 주세요.", file=sys.stderr)
            return 1
    try:
        with database.transaction() as cursor:
            auth.create_user(cursor, login_id, display_name, password, args.role)
    except auth.AuthError as exc:
        print(exc.message, file=sys.stderr)
        return 1
    print(f"계정을 만들었습니다: {login_id} ({args.role})")
    if args.role == "owner":
        print("처음 로그인할 때 2단계 인증(인증 앱) 등록 화면이 나옵니다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
