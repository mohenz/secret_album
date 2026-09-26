"""화면 확인용 데모 사진 등록. 사진은 코드로 직접 그린 풍경 이미지다(외부 사진 없음).

  .\\.venv\\Scripts\\python.exe scripts\\seed_demo.py            "Demo Gallery" 모델과 앨범 5개, 사진 약 45장 등록
  .\\.venv\\Scripts\\python.exe scripts\\seed_demo.py --remove   데모 모델·앨범·사진과 파일을 모두 지운다

실제 사진과 섞이지 않도록 모델 이름 "Demo Gallery"로 묶는다. 처리(파생 이미지)는 실행 중인 Worker가 한다.
"""

import argparse
import hashlib
import io
import math
import random
import sys
from datetime import date, timedelta
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))

from admin_create import load_env  # noqa: E402
from album_api import database, jobs, media, repository  # noqa: E402
from album_api.config import Settings  # noqa: E402

DEMO_MODEL = "Demo Gallery"
SIZES = [(2400, 1600), (1600, 2400), (1920, 2400), (2560, 1440), (2000, 2000), (2400, 1350)]


# ---------------------------------------------------------------- 그리기 도구
def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def vertical_gradient(draw, width, height, stops, top=0, bottom=None):
    bottom = height if bottom is None else bottom
    span = max(1, bottom - top)
    for y in range(top, bottom):
        t = (y - top) / span
        for (p0, c0), (p1, c1) in zip(stops, stops[1:]):
            if p0 <= t <= p1:
                draw.line([(0, y), (width, y)], fill=lerp(c0, c1, (t - p0) / max(1e-6, p1 - p0)))
                break


def ridge(rng, width, base, amplitude, roughness):
    points, phase = [], [rng.uniform(0, math.tau) for _ in range(4)]
    for x in range(0, width + 8, 8):
        y = base
        for i, ph in enumerate(phase):
            y += math.sin(x / (width / (1.5 + i * roughness)) + ph) * amplitude / (i + 1)
        y += rng.uniform(-amplitude * 0.04, amplitude * 0.04)
        points.append((x, y))
    return points


def fill_below(draw, points, width, height, color):
    draw.polygon(points + [(width, height), (0, height)], fill=color)


# ---------------------------------------------------------------- 장면
def mountains(rng, w, h):
    from PIL import Image, ImageDraw, ImageFilter

    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    warm = rng.choice([(255, 170, 120), (255, 196, 150), (250, 150, 130)])
    vertical_gradient(d, w, h, [(0, (40, 52, 96)), (0.45, (150, 120, 150)), (0.7, warm), (1, warm)])
    sun_x, sun_y, r = rng.uniform(0.25, 0.75) * w, h * rng.uniform(0.5, 0.62), min(w, h) * 0.06
    glow = Image.new("L", (w, h), 0)
    ImageDraw.Draw(glow).ellipse([sun_x - r * 5, sun_y - r * 5, sun_x + r * 5, sun_y + r * 5], fill=110)
    glow = glow.filter(ImageFilter.GaussianBlur(r * 2))
    img.paste(Image.new("RGB", (w, h), (255, 226, 190)), mask=glow)
    d = ImageDraw.Draw(img)
    d.ellipse([sun_x - r, sun_y - r, sun_x + r, sun_y + r], fill=(255, 240, 214))
    d = ImageDraw.Draw(img)
    layers = [(0.58, 0.10, (104, 96, 140)), (0.66, 0.09, (74, 70, 110)), (0.75, 0.08, (48, 46, 78)), (0.85, 0.06, (26, 26, 46))]
    for base, amp, color in layers:
        fill_below(d, ridge(rng, w, h * base, h * amp, rng.uniform(0.6, 1.4)), w, h, color)
    return img


def seaside(rng, w, h):
    from PIL import Image, ImageDraw, ImageFilter

    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    horizon = int(h * rng.uniform(0.45, 0.6))
    vertical_gradient(d, w, h, [(0, (18, 30, 70)), (0.6, (70, 96, 150)), (1, (230, 170, 150))], 0, horizon)
    vertical_gradient(d, w, h, [(0, (40, 60, 100)), (1, (8, 14, 34))], horizon, h)
    moon_x, moon_y, r = rng.uniform(0.2, 0.8) * w, horizon * rng.uniform(0.3, 0.6), min(w, h) * 0.035
    d.ellipse([moon_x - r, moon_y - r, moon_x + r, moon_y + r], fill=(250, 240, 220))
    for i in range(160):
        y = horizon + (h - horizon) * (i / 160) ** 1.6
        spread = 6 + (y - horizon) * 0.25
        x = moon_x + rng.uniform(-spread, spread)
        d.line([(x - spread * 0.3, y), (x + spread * 0.3, y)], fill=(210, 200, 190), width=max(1, int(h / 900)))
    for _ in range(90):
        y = rng.uniform(horizon + 4, h)
        x = rng.uniform(0, w)
        length = rng.uniform(20, 120) * (y - horizon) / (h - horizon + 1) + 10
        d.line([(x, y), (x + length, y)], fill=(70, 96, 140), width=1)
    img = img.filter(ImageFilter.GaussianBlur(1.2))
    ImageDraw.Draw(img).rectangle([0, horizon, w, horizon + max(1, h // 700)], fill=(160, 150, 170))
    return img


def city_night(rng, w, h):
    from PIL import Image, ImageChops, ImageDraw, ImageFilter

    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    vertical_gradient(d, w, h, [(0, (6, 8, 20)), (0.7, (24, 20, 44)), (1, (40, 26, 40))])
    bokeh = Image.new("RGB", (w, h), (0, 0, 0))
    bd = ImageDraw.Draw(bokeh)
    palette = [(255, 180, 90), (255, 120, 90), (120, 170, 255), (255, 220, 160), (200, 120, 255)]
    for _ in range(rng.randint(70, 120)):
        r = rng.uniform(0.01, 0.05) * min(w, h)
        x, y = rng.uniform(0, w), rng.uniform(h * 0.15, h)
        c = rng.choice(palette)
        k = rng.uniform(0.25, 0.8)
        bd.ellipse([x - r, y - r, x + r, y + r], fill=tuple(int(v * k) for v in c))
    bokeh = bokeh.filter(ImageFilter.GaussianBlur(min(w, h) * 0.006))
    img = ImageChops.add(img, bokeh)
    d = ImageDraw.Draw(img)
    x = 0
    while x < w:
        bw = rng.uniform(0.04, 0.1) * w
        bh = rng.uniform(0.15, 0.4) * h
        d.rectangle([x, h - bh, x + bw, h], fill=(10, 10, 18))
        for _ in range(int(bw * bh / 9000)):
            wx, wy = rng.uniform(x + 4, x + bw - 8), rng.uniform(h - bh + 8, h - 8)
            if rng.random() < 0.55:
                d.rectangle([wx, wy, wx + 5, wy + 7], fill=rng.choice([(255, 210, 140), (180, 200, 255)]))
        x += bw + rng.uniform(0, 0.01) * w
    return img


def forest(rng, w, h):
    from PIL import Image, ImageDraw, ImageFilter

    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    vertical_gradient(d, w, h, [(0, (214, 222, 218)), (0.55, (170, 186, 178)), (1, (120, 138, 128))])
    for depth, color in enumerate([(150, 166, 158), (112, 132, 122), (74, 94, 84), (36, 50, 44)]):
        layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        ld = ImageDraw.Draw(layer)
        base = h * (0.72 + depth * 0.08)
        ld.rectangle([0, base - 2, w, h], fill=color + (255,))
        for _ in range(8 + depth * 5):
            cx = rng.uniform(-0.05, 1.05) * w
            th = h * rng.uniform(0.18, 0.34) * (1 + depth * 0.35)
            tw = th * rng.uniform(0.16, 0.24)
            ld.polygon([(cx, base - th), (cx - tw, base + 2), (cx + tw, base + 2)], fill=color + (255,))
        layer = layer.filter(ImageFilter.GaussianBlur(max(0, 5 - depth * 1.5)))
        img.paste(layer, (0, 0), layer)
        fog = Image.new("RGBA", (w, h), (220, 228, 224, 46))
        img.paste(fog, (0, 0), fog)
    return img


def dunes(rng, w, h):
    from PIL import Image, ImageDraw, ImageFilter

    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    vertical_gradient(d, w, h, [(0, (70, 120, 190)), (0.55, (230, 190, 150)), (1, (240, 200, 160))])
    shades = [(222, 160, 110), (200, 130, 86), (176, 106, 70), (150, 84, 56), (120, 64, 44)]
    for i, color in enumerate(shades):
        base = h * (0.5 + i * 0.1)
        pts = ridge(rng, w, base, h * (0.08 - i * 0.008), 0.5)
        fill_below(d, pts, w, h, color)
        shadow = [(x, y + h * 0.012) for x, y in pts]
        d.line(shadow, fill=tuple(int(c * 0.82) for c in color), width=max(2, h // 300))
    return img.filter(ImageFilter.GaussianBlur(1))


ALBUMS = [
    ("Mountain Dawn", "Layered ridges at first light.", "Alpine ridge", mountains, 10),
    ("Coastal Blue Hour", "Moonlit tides and quiet horizons.", "East coast", seaside, 9),
    ("City Lights", "Night streets dissolving into bokeh.", "Downtown", city_night, 9),
    ("Forest Mist", "Pines fading into morning fog.", "Northern woods", forest, 8),
    ("Desert Dunes", "Warm ridges under an open sky.", "Dune field", dunes, 8),
]


def render(scene, seed, size):
    rng = random.Random(seed)
    image = scene(rng, *size)
    buffer = io.BytesIO()
    image.save(buffer, "JPEG", quality=88)
    return buffer.getvalue()


def remove(settings: Settings) -> None:
    with database.transaction() as cursor:
        cursor.execute("SELECT id FROM models WHERE name = %s", (DEMO_MODEL,))
        ids = [str(r["id"]) for r in cursor.fetchall()]
        if not ids:
            print("데모 데이터가 없습니다.")
            return
        cursor.execute("UPDATE models SET deleted_at = COALESCE(deleted_at, now()) WHERE id = ANY(%s::uuid[])", (ids,))
        cursor.execute("UPDATE albums SET deleted_at = COALESCE(deleted_at, now()), trashed_with = model_id WHERE model_id = ANY(%s::uuid[])", (ids,))
        cursor.execute("UPDATE photos SET deleted_at = COALESCE(deleted_at, now()), trashed_with = model_id WHERE model_id = ANY(%s::uuid[])", (ids,))
        files = repository.purge(cursor, None, "model", ids)
    for item in files:
        media.remove_photo_files(settings.media_root, item["id"], item["created_at"], item["ext"])
    print(f"데모 사진 {len(files)}장과 모델·앨범을 지웠습니다.")


def seed(settings: Settings) -> None:
    with database.transaction() as cursor:
        cursor.execute("SELECT id FROM models WHERE name = %s AND deleted_at IS NULL", (DEMO_MODEL,))
        if cursor.fetchone():
            print("이미 데모 데이터가 있습니다. 다시 만들려면 --remove 후 실행해 주세요.")
            return
        cursor.execute("SELECT id FROM users WHERE role = 'owner' ORDER BY created_at LIMIT 1")
        owner = cursor.fetchone()
        cursor.execute("INSERT INTO models(name, stage_name, bio) VALUES (%s, %s, %s) RETURNING id",
                       (DEMO_MODEL, "Generated scenes", "Procedurally drawn landscapes for previewing the gallery layout."))
        model_id = str(cursor.fetchone()["id"])
    total = 0
    for index, (title, description, location, scene, count) in enumerate(ALBUMS):
        with database.transaction() as cursor:
            cursor.execute(
                "INSERT INTO albums(model_id, title, description, shot_on, location) VALUES (%s, %s, %s, %s, %s) RETURNING id",
                (model_id, title, description, date.today() - timedelta(days=index * 9 + 2), location),
            )
            album_id = str(cursor.fetchone()["id"])
        for n in range(count):
            size = SIZES[(n + index) % len(SIZES)]
            data = render(scene, f"{title}-{n}", size)
            upload = {"sha256": hashlib.sha256(data).hexdigest(), "size": len(data), "mime": "image/jpeg", "ext": "jpg"}
            settings.upload_root.mkdir(parents=True, exist_ok=True)
            temp = settings.upload_root / f"demo-{upload['sha256'][:16]}.part"
            temp.write_bytes(data)
            upload["temp"] = temp
            with database.transaction() as cursor:
                photo = repository.create_photo(cursor, None, album_id, f"{title.lower().replace(' ', '-')}-{n + 1:02d}.jpg", upload)
                media.commit_original(temp, media.original_path(settings.media_root, photo["id"], photo["created_at"], "jpg"))
                if n == count // 2:
                    cursor.execute("UPDATE photos SET is_pause = true WHERE id = %s", (photo["id"],))
                if owner and n in (1, 4):
                    cursor.execute("INSERT INTO favorites(user_id, photo_id) VALUES (%s, %s) ON CONFLICT DO NOTHING", (owner["id"], photo["id"]))
                jobs.enqueue(cursor, "photo.process", {"photo_id": photo["id"]})
            total += 1
        print(f"{title}: {count}장 등록")
    print(f"데모 사진 {total}장을 등록했습니다. Worker가 처리하면 화면에 나타납니다.")


def main() -> int:
    parser = argparse.ArgumentParser(description="데모 사진 등록")
    parser.add_argument("--remove", action="store_true")
    args = parser.parse_args()
    load_env()
    settings = Settings.from_environment()
    remove(settings) if args.remove else seed(settings)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
