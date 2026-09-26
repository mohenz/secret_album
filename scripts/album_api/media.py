"""사진 파일 저장·검사·파생 이미지 생성·경로 계산.

파일 경로에는 사용자 입력을 쓰지 않는다. 모든 경로는 photo_id(UUID)로 서버가 계산하고,
결과가 저장소 안인지 다시 확인한다.
"""

import hashlib
import logging
import os
import shutil
import uuid
from datetime import datetime
from fractions import Fraction
from pathlib import Path

from .config import DERIVED_VARIANTS, Settings

logger = logging.getLogger("album.media")

CHUNK = 1024 * 1024


class MediaError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def detect_image_type(head: bytes) -> tuple[str, str] | None:
    """매직 넘버로 형식을 판정한다. (MIME, 확장자) 또는 None."""
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg", "jpg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png", "png"
    if len(head) >= 12 and head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp", "webp"
    if len(head) >= 12 and head[4:8] == b"ftyp" and head[8:12] in {b"heic", b"heix", b"hevc", b"heim", b"heis", b"mif1", b"msf1"}:
        return "image/heic", "heic"
    return None


def validate_uuid(value: str) -> str:
    try:
        return str(uuid.UUID(value))
    except (ValueError, AttributeError, TypeError) as exc:
        raise MediaError(404, "not_found", "요청한 사진이 없습니다.") from exc


def _inside(root: Path, path: Path) -> Path:
    resolved_root = root.resolve()
    resolved = path.resolve()
    if resolved != resolved_root and resolved_root not in resolved.parents:
        raise MediaError(400, "invalid_media_path", "허용되지 않은 파일 경로입니다.")
    return resolved


def original_path(media_root: Path, photo_id: str, created_at: datetime, ext: str) -> Path:
    photo_id = validate_uuid(photo_id)
    if ext not in {"jpg", "png", "webp", "heic"}:
        raise MediaError(400, "invalid_media_path", "허용되지 않은 파일 형식입니다.")
    return _inside(media_root, media_root / "originals" / f"{created_at:%Y}" / f"{created_at:%m}" / f"{photo_id}.{ext}")


def derived_dir(media_root: Path, photo_id: str) -> Path:
    photo_id = validate_uuid(photo_id)
    return _inside(media_root, media_root / "derived" / photo_id[:2] / photo_id)


def derived_path(media_root: Path, photo_id: str, variant: str) -> Path:
    if variant not in {name for name, _, _ in DERIVED_VARIANTS}:
        raise MediaError(404, "not_found", "요청한 이미지 크기가 없습니다.")
    return derived_dir(media_root, photo_id) / f"{variant}.webp"


def receive_upload(stream, length: int, settings: Settings) -> dict:
    """요청 본문을 임시 파일로 저장하면서 SHA-256을 계산한다."""
    if length <= 0:
        raise MediaError(411, "length_required", "파일 크기 정보가 없습니다. 다시 업로드해 주세요.")
    if length > settings.max_upload_bytes:
        limit_mb = settings.max_upload_bytes // (1024 * 1024)
        raise MediaError(413, "file_too_large", f"파일이 {limit_mb}MB를 넘어 업로드하지 못했습니다. 크기를 줄여 다시 시도해 주세요.")
    settings.upload_root.mkdir(parents=True, exist_ok=True)
    temp = settings.upload_root / f"{uuid.uuid4()}.part"
    digest = hashlib.sha256()
    received = 0
    head = b""
    try:
        with temp.open("wb") as handle:
            while received < length:
                chunk = stream.read(min(CHUNK, length - received))
                if not chunk:
                    break
                if len(head) < 32:
                    head += chunk[: 32 - len(head)]
                digest.update(chunk)
                handle.write(chunk)
                received += len(chunk)
        if received != length:
            raise MediaError(400, "incomplete_upload", "업로드가 중간에 끊겼습니다. 다시 시도해 주세요.")
        kind = detect_image_type(head)
        if kind is None:
            raise MediaError(415, "unsupported_type", "지원하지 않는 파일 형식입니다. JPEG·PNG·WebP·HEIC 사진만 올릴 수 있습니다.")
    except BaseException:
        temp.unlink(missing_ok=True)
        raise
    return {"temp": temp, "sha256": digest.hexdigest(), "size": received, "mime": kind[0], "ext": kind[1]}


def commit_original(temp: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    os.replace(temp, target)


def remove_photo_files(media_root: Path, photo_id: str, created_at: datetime, ext: str) -> None:
    original_path(media_root, photo_id, created_at, ext).unlink(missing_ok=True)
    directory = derived_dir(media_root, photo_id)
    if directory.exists():
        shutil.rmtree(directory, ignore_errors=True)


def _register_heif() -> None:
    try:
        from pillow_heif import register_heif_opener

        register_heif_opener()
    except ImportError:
        pass


def _ratio(value) -> float | None:
    try:
        if isinstance(value, tuple) and len(value) == 2:
            return float(Fraction(value[0], value[1])) if value[1] else None
        return float(value)
    except (TypeError, ValueError, ZeroDivisionError):
        return None


def _clean(value) -> str | None:
    if value is None:
        return None
    text = str(value).replace("\x00", "").strip()
    return text[:120] or None


def extract_metadata(image) -> dict:
    exif = image.getexif()
    ifd = exif.get_ifd(0x8769) if exif else {}
    taken = ifd.get(0x9003) or exif.get(0x0132) if exif else None
    taken_at = None
    if taken:
        try:
            taken_at = datetime.strptime(str(taken).strip()[:19], "%Y:%m:%d %H:%M:%S").isoformat()
        except ValueError:
            taken_at = None
    exposure: dict = {}
    shutter = _ratio(ifd.get(0x829A))
    if shutter:
        exposure["shutter"] = f"1/{round(1 / shutter)}초" if shutter < 1 else f"{shutter:g}초"
    aperture = _ratio(ifd.get(0x829D))
    if aperture:
        exposure["aperture"] = f"f/{round(aperture, 1):g}"
    iso = ifd.get(0x8827)
    if iso:
        exposure["iso"] = int(iso[0] if isinstance(iso, tuple) else iso)
    focal = _ratio(ifd.get(0x920A))
    if focal:
        exposure["focal"] = f"{focal:g}mm"
    raw = {}
    for key, name in ((0x010F, "make"), (0x0110, "model"), (0x0131, "software")):
        if exif and exif.get(key):
            raw[name] = _clean(exif.get(key))
    return {
        "taken_at": taken_at,
        "camera": _clean(exif.get(0x0110)) if exif else None,
        "lens": _clean(ifd.get(0xA434)),
        "exposure": exposure,
        "exif": raw,
    }


def process_photo(media_root: Path, photo_id: str, created_at: datetime, ext: str) -> dict:
    """원본에서 파생 이미지 3종을 만들고 메타데이터를 돌려준다. 파생 이미지에는 EXIF(GPS 포함)가 없다."""
    from PIL import Image, ImageOps

    _register_heif()
    source = original_path(media_root, photo_id, created_at, ext)
    if not source.exists():
        raise MediaError(404, "original_missing", "원본 파일이 없습니다.")
    with Image.open(source) as opened:
        metadata = extract_metadata(opened)
        image = ImageOps.exif_transpose(opened)
        if image.mode not in {"RGB", "RGBA"}:
            image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
        width, height = image.size
        target_dir = derived_dir(media_root, photo_id)
        target_dir.mkdir(parents=True, exist_ok=True)
        longest = max(width, height)
        for name, limit, quality in DERIVED_VARIANTS:
            variant = image.copy()
            if longest > limit:
                variant.thumbnail((limit, limit), Image.Resampling.LANCZOS)
            temp = target_dir / f"{name}.webp.tmp"
            variant.save(temp, "WEBP", quality=quality, method=4)
            os.replace(temp, target_dir / f"{name}.webp")
        swatch = image.convert("RGB").resize((1, 1), Image.Resampling.BOX).getpixel((0, 0))
    metadata.update({"width": width, "height": height, "dominant_color": "#{:02x}{:02x}{:02x}".format(*swatch)})
    return metadata


def disk_usage(media_root: Path) -> dict:
    media_root.mkdir(parents=True, exist_ok=True)
    usage = shutil.disk_usage(media_root)
    return {"total": usage.total, "used": usage.used, "free": usage.free}
