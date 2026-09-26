"""원본에서 파생 이미지(thumb·medium·large)를 다시 만든다. 작업은 Worker가 처리한다.

  .\\.venv\\Scripts\\python.exe scripts\\rebuild_derived.py --missing   파생 이미지가 없는 사진만 (복원 뒤)
  .\\.venv\\Scripts\\python.exe scripts\\rebuild_derived.py --all       모든 사진 (규격 변경 뒤)
"""

import argparse
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))

from admin_create import load_env  # noqa: E402
from album_api import database, jobs, media  # noqa: E402
from album_api.config import Settings  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="파생 이미지 재생성 작업 등록")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--missing", action="store_true")
    group.add_argument("--all", action="store_true")
    args = parser.parse_args()
    load_env()
    settings = Settings.from_environment()
    queued = 0
    missing_originals = 0
    with database.transaction() as cursor:
        cursor.execute("SELECT id, created_at, original_ext FROM photos WHERE deleted_at IS NULL ORDER BY created_at")
        for row in cursor.fetchall():
            photo_id = str(row["id"])
            if not media.original_path(settings.media_root, photo_id, row["created_at"], row["original_ext"]).exists():
                missing_originals += 1
                continue
            if args.missing and media.derived_path(settings.media_root, photo_id, "thumb").exists():
                continue
            jobs.enqueue(cursor, "photo.rebuild", {"photo_id": photo_id})
            queued += 1
    print(f"재생성 작업 {queued}건을 등록했습니다. Worker가 처리합니다.")
    if missing_originals:
        print(f"원본 파일이 없는 사진이 {missing_originals}장 있습니다. 백업에서 원본을 되돌려 주세요.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
