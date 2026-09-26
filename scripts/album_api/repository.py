"""DB 조회·변경. 모든 함수는 호출자가 연 트랜잭션 커서를 받는다.

열람자(viewer)는 album_shares에 있는 앨범과 그 사진·모델만 볼 수 있다.
권한 밖의 대상은 존재 여부를 드러내지 않도록 404로 응답한다.
"""

import uuid
from datetime import date
from typing import Any

from .tables import (
    ALBUM_FIELDS,
    ALBUM_SORTS,
    DEFAULT_ALBUM_SORT,
    DEFAULT_MODEL_SORT,
    MODEL_FIELDS,
    MODEL_SORTS,
    PHOTO_TEXT_FIELDS,
    SETTING_RULES,
    TAG_MAX_LENGTH,
    TAGS_PER_PHOTO,
)

POSITION_STEP = 1024


class NotFound(Exception):
    def __init__(self, message: str = "Item not found. Please refresh the list.") -> None:
        super().__init__(message)
        self.message = message


class Invalid(Exception):
    def __init__(self, message: str, code: str = "invalid_request") -> None:
        super().__init__(message)
        self.message = message
        self.code = code


class Conflict(Exception):
    def __init__(self, message: str, code: str = "conflict", detail: dict | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.detail = detail or {}


# ---------------------------------------------------------------- 공통

def parse_uuid(value: Any, label: str = "item") -> str:
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, TypeError) as exc:
        raise NotFound(f"{label.capitalize()} not found.") from exc


def parse_uuid_list(values: Any, limit: int = 5000) -> list[str]:
    if not isinstance(values, list) or not values:
        raise Invalid("Select at least one item.")
    if len(values) > limit:
        raise Invalid(f"You can process up to {limit} items at once. Split the selection and try again.")
    result = []
    for value in values:
        try:
            result.append(str(uuid.UUID(str(value))))
        except (ValueError, TypeError) as exc:
            raise Invalid("Some selected items have invalid IDs. Refresh and try again.") from exc
    return list(dict.fromkeys(result))


def _text(payload: dict, key: str, limit: int, required: bool = False) -> str | None:
    value = payload.get(key)
    if value is None:
        if required:
            raise Invalid("Please fill in the required field.", "required")
        return None
    if not isinstance(value, str):
        raise Invalid("Invalid input.")
    value = value.strip()
    if required and not value:
        raise Invalid("Please fill in the required field.", "required")
    if len(value) > limit:
        raise Invalid(f"Please use {limit} characters or fewer.", "too_long")
    return value or None


def _date(value: Any) -> date | None:
    if value in (None, ""):
        return None
    try:
        return date.fromisoformat(str(value))
    except ValueError as exc:
        raise Invalid("Invalid date. Use the YYYY-MM-DD format.") from exc


def _iso(value) -> str | None:
    return value.isoformat() if value is not None else None


def visible_album_sql(actor, alias: str = "a") -> tuple[str, dict]:
    if actor.is_owner:
        return "TRUE", {}
    return f"{alias}.id IN (SELECT album_id FROM album_shares WHERE user_id = %(actor_id)s)", {"actor_id": actor.user_id}


def audit(cursor, actor, action: str, target_type: str | None = None, target_id: str | None = None, detail: dict | None = None, ip: str | None = None) -> None:
    from psycopg.types.json import Jsonb

    cursor.execute(
        "INSERT INTO audit_logs(user_id, action, target_type, target_id, detail, ip) VALUES (%s, %s, %s, %s, %s, %s)",
        (actor.user_id if actor else None, action, target_type, target_id, Jsonb(detail or {}), ip),
    )


COVER_JOIN = """
LEFT JOIN LATERAL (
  SELECT p.id, p.dominant_color, p.width, p.height FROM photos p
  WHERE p.status = 'ready' AND p.deleted_at IS NULL
    AND p.album_id = a.id
  ORDER BY (p.id IS NOT DISTINCT FROM a.cover_photo_id) DESC, p.position LIMIT 1
) cover ON TRUE
"""


def _album_card(row: dict) -> dict:
    return {
        "id": str(row["id"]),
        "title": row["title"],
        "model_id": str(row["model_id"]),
        "model_name": row.get("model_name"),
        "shot_on": _iso(row.get("shot_on")),
        "location": row.get("location"),
        "photo_count": row.get("photo_count", 0),
        "visibility": row.get("visibility"),
        "cover": {"id": str(row["cover_id"]), "color": row.get("cover_color"), "w": row.get("cover_w"), "h": row.get("cover_h")} if row.get("cover_id") else None,
    }


def _photo_card(row: dict) -> dict:
    return {
        "id": str(row["id"]),
        "w": row["width"] or 3,
        "h": row["height"] or 2,
        "color": row.get("dominant_color"),
        "pause": row.get("is_pause", False),
        "status": row.get("status", "ready"),
        "fav": bool(row.get("fav")),
        "album_id": str(row["album_id"]) if row.get("album_id") else None,
    }


PHOTO_CARD_COLUMNS = "p.id, p.width, p.height, p.dominant_color, p.is_pause, p.status, p.album_id, (f.photo_id IS NOT NULL) AS fav"


# ---------------------------------------------------------------- 홈

def home(cursor, actor) -> dict:
    visible, params = visible_album_sql(actor)
    params = {**params}
    cursor.execute(
        f"""
        SELECT a.id, a.title, a.model_id, a.shot_on, a.location, a.visibility, m.name AS model_name,
               cover.id AS cover_id, cover.dominant_color AS cover_color, cover.width AS cover_w, cover.height AS cover_h,
               (SELECT count(*) FROM photos p WHERE p.album_id = a.id AND p.deleted_at IS NULL) AS photo_count
        FROM albums a JOIN models m ON m.id = a.model_id {COVER_JOIN}
        WHERE a.deleted_at IS NULL AND m.deleted_at IS NULL AND {visible}
        ORDER BY a.shot_on DESC NULLS LAST, a.created_at DESC LIMIT 9
        """,
        params,
    )
    albums = [_album_card(row) for row in cursor.fetchall()]
    hero = next((album for album in albums if album["cover"]), None)
    models = list_models(cursor, actor, "recent_desc", limit=12)
    cursor.execute(
        f"""
        SELECT {PHOTO_CARD_COLUMNS} FROM favorites f0
        JOIN photos p ON p.id = f0.photo_id JOIN albums a ON a.id = p.album_id
        LEFT JOIN favorites f ON f.photo_id = p.id AND f.user_id = %(actor_id)s
        WHERE f0.user_id = %(actor_id)s AND p.status = 'ready' AND p.deleted_at IS NULL AND a.deleted_at IS NULL AND {visible}
        ORDER BY f0.created_at DESC LIMIT 1
        """,
        {**params, "actor_id": actor.user_id},
    )
    pause = cursor.fetchone()
    return {
        "hero": hero,
        "recent_albums": [album for album in albums if album is not hero][:8],
        "models": models,
        "pause_photo": _photo_card(pause) if pause else None,
    }


# ---------------------------------------------------------------- 모델

def list_models(cursor, actor, sort: str | None = None, limit: int = 500) -> list[dict]:
    order = MODEL_SORTS.get(sort or DEFAULT_MODEL_SORT, MODEL_SORTS[DEFAULT_MODEL_SORT])
    visible, params = visible_album_sql(actor)
    cursor.execute(
        f"""
        SELECT m.id, m.name, m.stage_name, m.is_favorite,
               count(DISTINCT a.id) AS album_count,
               count(p.id) AS photo_count,
               max(a.shot_on) AS last_shot,
               cover.id AS cover_id, cover.dominant_color AS cover_color
        FROM models m
        LEFT JOIN albums a ON a.model_id = m.id AND a.deleted_at IS NULL AND {visible}
        LEFT JOIN photos p ON p.album_id = a.id AND p.deleted_at IS NULL
        LEFT JOIN LATERAL (
          SELECT p2.id, p2.dominant_color FROM photos p2 JOIN albums a2 ON a2.id = p2.album_id
          WHERE p2.status = 'ready' AND p2.deleted_at IS NULL AND a2.deleted_at IS NULL
            AND p2.model_id = m.id
            AND {visible.replace('a.id', 'a2.id')}
          ORDER BY (p2.id IS NOT DISTINCT FROM m.cover_photo_id) DESC, p2.created_at LIMIT 1
        ) cover ON TRUE
        WHERE m.deleted_at IS NULL
        GROUP BY m.id, cover.id, cover.dominant_color
        {"" if actor.is_owner else "HAVING count(DISTINCT a.id) > 0"}
        ORDER BY {order} LIMIT %(limit)s
        """,
        {**params, "limit": limit},
    )
    return [
        {
            "id": str(row["id"]),
            "name": row["name"],
            "stage_name": row["stage_name"],
            "album_count": row["album_count"],
            "photo_count": row["photo_count"],
            "last_shot": _iso(row["last_shot"]),
            "cover": {"id": str(row["cover_id"]), "color": row["cover_color"]} if row["cover_id"] else None,
        }
        for row in cursor.fetchall()
    ]


def get_model(cursor, actor, model_id: str) -> dict:
    model_id = parse_uuid(model_id, "model")
    models = [m for m in list_models(cursor, actor, "name_asc", limit=100000) if m["id"] == model_id]
    if not models:
        raise NotFound("Model not found.")
    model = models[0]
    cursor.execute("SELECT bio, cover_photo_id FROM models WHERE id = %s", (model_id,))
    extra = cursor.fetchone()
    model["bio"] = extra["bio"]
    model["albums"] = list_albums(cursor, actor, "shot_desc", model_id=model_id, limit=1000)["items"]
    return model


def create_model(cursor, actor, payload: dict) -> dict:
    name = _text(payload, "name", MODEL_FIELDS["name"], required=True)
    cursor.execute(
        "INSERT INTO models(name, stage_name, bio) VALUES (%s, %s, %s) RETURNING id",
        (name, _text(payload, "stage_name", MODEL_FIELDS["stage_name"]), _text(payload, "bio", MODEL_FIELDS["bio"])),
    )
    model_id = str(cursor.fetchone()["id"])
    audit(cursor, actor, "model.create", "model", model_id)
    return {"id": model_id}


def update_model(cursor, actor, model_id: str, payload: dict) -> dict:
    model_id = parse_uuid(model_id, "model")
    sets, values = [], []
    for key, limit in MODEL_FIELDS.items():
        if key in payload:
            sets.append(f"{key} = %s")
            values.append(_text(payload, key, limit, required=(key == "name")))
    if "cover_photo_id" in payload:
        cover = parse_uuid(payload["cover_photo_id"], "photo") if payload["cover_photo_id"] else None
        if cover:
            cursor.execute("SELECT 1 FROM photos WHERE id = %s AND model_id = %s AND deleted_at IS NULL", (cover, model_id))
            if not cursor.fetchone():
                raise Invalid("Only this model's photos can be the cover.")
        sets.append("cover_photo_id = %s")
        values.append(cover)
    if not sets:
        raise Invalid("Nothing to change.")
    cursor.execute(f"UPDATE models SET {', '.join(sets)}, updated_at = now() WHERE id = %s AND deleted_at IS NULL", (*values, model_id))
    if cursor.rowcount == 0:
        raise NotFound("Model not found.")
    audit(cursor, actor, "model.update", "model", model_id)
    return {"id": model_id}


def trash_model(cursor, actor, model_id: str) -> None:
    model_id = parse_uuid(model_id, "model")
    cursor.execute("UPDATE models SET deleted_at = now(), trashed_with = NULL WHERE id = %s AND deleted_at IS NULL", (model_id,))
    if cursor.rowcount == 0:
        raise NotFound("Model not found.")
    cursor.execute("UPDATE albums SET deleted_at = now(), trashed_with = %s WHERE model_id = %s AND deleted_at IS NULL", (model_id, model_id))
    cursor.execute("UPDATE photos SET deleted_at = now(), trashed_with = %s WHERE model_id = %s AND deleted_at IS NULL", (model_id, model_id))
    audit(cursor, actor, "model.trash", "model", model_id)


# ---------------------------------------------------------------- 앨범

def list_albums(cursor, actor, sort: str | None = None, model_id: str | None = None, limit: int = 60, offset: int = 0) -> dict:
    order = ALBUM_SORTS.get(sort or DEFAULT_ALBUM_SORT, ALBUM_SORTS[DEFAULT_ALBUM_SORT])
    visible, params = visible_album_sql(actor)
    where = ["a.deleted_at IS NULL", "m.deleted_at IS NULL", visible]
    if model_id:
        where.append("a.model_id = %(model_id)s")
        params = {**params, "model_id": parse_uuid(model_id, "model")}
    clause = " AND ".join(where)
    cursor.execute(f"SELECT count(*) AS n FROM albums a JOIN models m ON m.id = a.model_id WHERE {clause}", params)
    total = cursor.fetchone()["n"]
    cursor.execute(
        f"""
        SELECT a.id, a.title, a.model_id, a.shot_on, a.location, a.visibility, m.name AS model_name,
               cover.id AS cover_id, cover.dominant_color AS cover_color, cover.width AS cover_w, cover.height AS cover_h,
               (SELECT count(*) FROM photos p WHERE p.album_id = a.id AND p.deleted_at IS NULL) AS photo_count
        FROM albums a JOIN models m ON m.id = a.model_id {COVER_JOIN}
        WHERE {clause} ORDER BY {order} LIMIT %(limit)s OFFSET %(offset)s
        """,
        {**params, "limit": max(1, min(limit, 1000)), "offset": max(0, offset)},
    )
    return {"items": [_album_card(row) for row in cursor.fetchall()], "total": total}


def get_album(cursor, actor, album_id: str) -> dict:
    album_id = parse_uuid(album_id, "album")
    visible, params = visible_album_sql(actor)
    cursor.execute(
        f"""
        SELECT a.id, a.title, a.description, a.model_id, a.shot_on, a.location, a.visibility, a.cover_photo_id,
               m.name AS model_name,
               cover.id AS cover_id, cover.dominant_color AS cover_color, cover.width AS cover_w, cover.height AS cover_h,
               (SELECT count(*) FROM photos p WHERE p.album_id = a.id AND p.deleted_at IS NULL) AS photo_count
        FROM albums a JOIN models m ON m.id = a.model_id {COVER_JOIN}
        WHERE a.id = %(album_id)s AND a.deleted_at IS NULL AND m.deleted_at IS NULL AND {visible}
        """,
        {**params, "album_id": album_id},
    )
    row = cursor.fetchone()
    if row is None:
        raise NotFound("Album not found.")
    album = _album_card(row)
    album["description"] = row["description"]
    cursor.execute(
        f"""
        SELECT a.id, a.title, a.model_id, a.shot_on, a.location, a.visibility, m.name AS model_name,
               cover.id AS cover_id, cover.dominant_color AS cover_color, cover.width AS cover_w, cover.height AS cover_h, 0 AS photo_count
        FROM albums a JOIN models m ON m.id = a.model_id {COVER_JOIN}
        WHERE a.model_id = %(model_id)s AND a.id <> %(album_id)s AND a.deleted_at IS NULL AND {visible}
        ORDER BY a.shot_on DESC NULLS LAST, a.created_at DESC LIMIT 1
        """,
        {**params, "model_id": row["model_id"], "album_id": album_id},
    )
    nxt = cursor.fetchone()
    album["next_album"] = _album_card(nxt) if nxt else None
    return album


def create_album(cursor, actor, payload: dict) -> dict:
    model_id = parse_uuid(payload.get("model_id"), "model")
    cursor.execute("SELECT 1 FROM models WHERE id = %s AND deleted_at IS NULL", (model_id,))
    if not cursor.fetchone():
        raise Invalid("Please choose a model.", "required")
    cursor.execute(
        "INSERT INTO albums(model_id, title, description, shot_on, location) VALUES (%s, %s, %s, %s, %s) RETURNING id",
        (
            model_id,
            _text(payload, "title", ALBUM_FIELDS["title"], required=True),
            _text(payload, "description", ALBUM_FIELDS["description"]),
            _date(payload.get("shot_on")),
            _text(payload, "location", ALBUM_FIELDS["location"]),
        ),
    )
    album_id = str(cursor.fetchone()["id"])
    audit(cursor, actor, "album.create", "album", album_id)
    return {"id": album_id}


def update_album(cursor, actor, album_id: str, payload: dict) -> dict:
    album_id = parse_uuid(album_id, "album")
    sets, values = [], []
    for key, limit in ALBUM_FIELDS.items():
        if key in payload:
            sets.append(f"{key} = %s")
            values.append(_text(payload, key, limit, required=(key == "title")))
    if "shot_on" in payload:
        sets.append("shot_on = %s")
        values.append(_date(payload["shot_on"]))
    if "visibility" in payload:
        if payload["visibility"] not in {"private", "shared"}:
            raise Invalid("Invalid visibility value.")
        sets.append("visibility = %s")
        values.append(payload["visibility"])
    if "model_id" in payload:
        new_model = parse_uuid(payload["model_id"], "model")
        cursor.execute("SELECT 1 FROM models WHERE id = %s AND deleted_at IS NULL", (new_model,))
        if not cursor.fetchone():
            raise Invalid("The selected model was not found.")
        sets.append("model_id = %s")
        values.append(new_model)
    if "cover_photo_id" in payload:
        cover = parse_uuid(payload["cover_photo_id"], "photo") if payload["cover_photo_id"] else None
        if cover:
            cursor.execute("SELECT 1 FROM photos WHERE id = %s AND album_id = %s AND deleted_at IS NULL", (cover, album_id))
            if not cursor.fetchone():
                raise Invalid("Only this album's photos can be the cover.")
        sets.append("cover_photo_id = %s")
        values.append(cover)
    if not sets:
        raise Invalid("Nothing to change.")
    cursor.execute(f"UPDATE albums SET {', '.join(sets)}, updated_at = now() WHERE id = %s AND deleted_at IS NULL", (*values, album_id))
    if cursor.rowcount == 0:
        raise NotFound("Album not found.")
    if "model_id" in payload:
        cursor.execute("UPDATE photos SET model_id = %s WHERE album_id = %s", (values[sets.index("model_id = %s")], album_id))
    audit(cursor, actor, "album.update", "album", album_id)
    return {"id": album_id}


def trash_album(cursor, actor, album_id: str) -> None:
    album_id = parse_uuid(album_id, "album")
    cursor.execute("UPDATE albums SET deleted_at = now(), trashed_with = NULL WHERE id = %s AND deleted_at IS NULL", (album_id,))
    if cursor.rowcount == 0:
        raise NotFound("Album not found.")
    cursor.execute("UPDATE photos SET deleted_at = now(), trashed_with = %s WHERE album_id = %s AND deleted_at IS NULL", (album_id, album_id))
    audit(cursor, actor, "album.trash", "album", album_id)


# ---------------------------------------------------------------- 사진

def album_photos(cursor, actor, album_id: str) -> list[dict]:
    get_album(cursor, actor, album_id)  # 권한·존재 확인
    cursor.execute(
        f"""
        SELECT {PHOTO_CARD_COLUMNS} FROM photos p
        LEFT JOIN favorites f ON f.photo_id = p.id AND f.user_id = %(actor_id)s
        WHERE p.album_id = %(album_id)s AND p.deleted_at IS NULL {"" if actor.is_owner else "AND p.status = 'ready'"}
        ORDER BY p.position, p.created_at
        """,
        {"album_id": parse_uuid(album_id, "album"), "actor_id": actor.user_id},
    )
    return [_photo_card(row) for row in cursor.fetchall()]


def model_photos(cursor, actor, model_id: str, limit: int = 5000) -> list[dict]:
    model_id = parse_uuid(model_id, "model")
    visible, params = visible_album_sql(actor)
    cursor.execute(
        f"""
        SELECT {PHOTO_CARD_COLUMNS} FROM photos p JOIN albums a ON a.id = p.album_id
        LEFT JOIN favorites f ON f.photo_id = p.id AND f.user_id = %(actor_id)s
        WHERE p.model_id = %(model_id)s AND p.status = 'ready' AND p.deleted_at IS NULL AND a.deleted_at IS NULL AND {visible}
        ORDER BY p.taken_at DESC NULLS LAST, p.created_at DESC LIMIT %(limit)s
        """,
        {**params, "model_id": model_id, "actor_id": actor.user_id, "limit": limit},
    )
    return [_photo_card(row) for row in cursor.fetchall()]


def get_photo(cursor, actor, photo_id: str) -> dict:
    photo_id = parse_uuid(photo_id, "photo")
    visible, params = visible_album_sql(actor)
    cursor.execute(
        f"""
        SELECT p.*, a.title AS album_title, m.name AS model_name, (f.photo_id IS NOT NULL) AS fav,
               COALESCE(s.can_download, false) AS can_download
        FROM photos p JOIN albums a ON a.id = p.album_id JOIN models m ON m.id = p.model_id
        LEFT JOIN favorites f ON f.photo_id = p.id AND f.user_id = %(actor_id)s
        LEFT JOIN album_shares s ON s.album_id = a.id AND s.user_id = %(actor_id)s
        WHERE p.id = %(photo_id)s AND p.deleted_at IS NULL AND a.deleted_at IS NULL AND {visible}
        """,
        {**params, "photo_id": photo_id, "actor_id": actor.user_id},
    )
    row = cursor.fetchone()
    if row is None:
        raise NotFound("Photo not found.")
    cursor.execute("SELECT t.name FROM photo_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.photo_id = %s ORDER BY t.name", (photo_id,))
    tags = [r["name"] for r in cursor.fetchall()]
    return {
        **_photo_card(row),
        "original_filename": row["original_filename"] if actor.is_owner else None,
        "byte_size": row["byte_size"],
        "mime_type": row["mime_type"],
        "taken_at": _iso(row["taken_at"]),
        "camera": row["camera"],
        "lens": row["lens"],
        "exposure": row["exposure"],
        "caption": row["caption"],
        "album_title": row["album_title"],
        "model_id": str(row["model_id"]),
        "model_name": row["model_name"],
        "tags": tags,
        "error": row["error"] if actor.is_owner else None,
        "can_download": actor.is_owner or row["can_download"],
        "created_at": _iso(row["created_at"]),
    }


def _normalize_tags(values: Any) -> list[str]:
    if not isinstance(values, list):
        raise Invalid("Invalid tags.")
    tags = []
    for value in values:
        if not isinstance(value, str):
            raise Invalid("Invalid tags.")
        tag = " ".join(value.split())
        if not tag:
            continue
        if len(tag) > TAG_MAX_LENGTH:
            raise Invalid(f"Tags must be {TAG_MAX_LENGTH} characters or fewer.", "too_long")
        tags.append(tag)
    tags = list(dict.fromkeys(tags))
    if len(tags) > TAGS_PER_PHOTO:
        raise Invalid(f"A photo can have up to {TAGS_PER_PHOTO} tags.")
    return tags


def _tag_ids(cursor, names: list[str]) -> list[str]:
    ids = []
    for name in names:
        cursor.execute("INSERT INTO tags(name) VALUES (%s) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id", (name,))
        ids.append(str(cursor.fetchone()["id"]))
    return ids


def update_photo(cursor, actor, photo_id: str, payload: dict) -> dict:
    photo_id = parse_uuid(photo_id, "photo")
    cursor.execute("SELECT 1 FROM photos WHERE id = %s AND deleted_at IS NULL", (photo_id,))
    if not cursor.fetchone():
        raise NotFound("Photo not found.")
    if "caption" in payload:
        cursor.execute("UPDATE photos SET caption = %s, updated_at = now() WHERE id = %s", (_text(payload, "caption", PHOTO_TEXT_FIELDS["caption"]), photo_id))
    if "is_pause" in payload:
        cursor.execute("UPDATE photos SET is_pause = %s, updated_at = now() WHERE id = %s", (bool(payload["is_pause"]), photo_id))
    if "tags" in payload:
        tags = _normalize_tags(payload["tags"])
        cursor.execute("DELETE FROM photo_tags WHERE photo_id = %s", (photo_id,))
        for tag_id in _tag_ids(cursor, tags):
            cursor.execute("INSERT INTO photo_tags(photo_id, tag_id) VALUES (%s, %s) ON CONFLICT DO NOTHING", (photo_id, tag_id))
    audit(cursor, actor, "photo.update", "photo", photo_id)
    return get_photo(cursor, actor, photo_id)


def _next_position(cursor, album_id: str) -> float:
    cursor.execute("SELECT COALESCE(max(position), 0) AS p FROM photos WHERE album_id = %s", (album_id,))
    return float(cursor.fetchone()["p"]) + POSITION_STEP


def bulk(cursor, actor, action: str, ids: list[str], payload: dict) -> dict:
    ids = parse_uuid_list(ids)
    if action in {"favorite", "unfavorite"}:
        visible, params = visible_album_sql(actor)
        cursor.execute(
            f"SELECT p.id FROM photos p JOIN albums a ON a.id = p.album_id WHERE p.id = ANY(%(ids)s::uuid[]) AND p.deleted_at IS NULL AND {visible}",
            {**params, "ids": ids},
        )
        allowed = [str(r["id"]) for r in cursor.fetchall()]
        for photo_id in allowed:
            if action == "favorite":
                cursor.execute("INSERT INTO favorites(user_id, photo_id) VALUES (%s, %s) ON CONFLICT DO NOTHING", (actor.user_id, photo_id))
            else:
                cursor.execute("DELETE FROM favorites WHERE user_id = %s AND photo_id = %s", (actor.user_id, photo_id))
        return {"updated": len(allowed)}
    if not actor.is_owner:
        raise Invalid("Only the owner can do this.", "forbidden")
    cursor.execute("SELECT id, album_id, model_id FROM photos WHERE id = ANY(%s::uuid[]) AND deleted_at IS NULL", (ids,))
    rows = cursor.fetchall()
    if len(rows) != len(ids):
        raise NotFound("Some selected photos no longer exist. Refresh and try again.")
    if action in {"tag", "untag"}:
        names = _normalize_tags(payload.get("tags"))
        if not names:
            raise Invalid("Please enter a tag.", "required")
        tag_ids = _tag_ids(cursor, names)
        for photo_id in ids:
            for tag_id in tag_ids:
                if action == "tag":
                    cursor.execute("INSERT INTO photo_tags(photo_id, tag_id) VALUES (%s, %s) ON CONFLICT DO NOTHING", (photo_id, tag_id))
                else:
                    cursor.execute("DELETE FROM photo_tags WHERE photo_id = %s AND tag_id = %s", (photo_id, tag_id))
    elif action == "move":
        target = parse_uuid(payload.get("album_id"), "album")
        cursor.execute("SELECT model_id FROM albums WHERE id = %s AND deleted_at IS NULL", (target,))
        album = cursor.fetchone()
        if album is None:
            raise Invalid("Choose an album to move to.", "required")
        position = _next_position(cursor, target)
        for photo_id in ids:
            cursor.execute("UPDATE photos SET album_id = %s, model_id = %s, position = %s, updated_at = now() WHERE id = %s", (target, album["model_id"], position, photo_id))
            position += POSITION_STEP
        cursor.execute("UPDATE albums SET cover_photo_id = NULL WHERE cover_photo_id = ANY(%s::uuid[]) AND id <> %s", (ids, target))
    elif action == "set_album_cover":
        if len(ids) != 1:
            raise Invalid("Select exactly one photo to use as the cover.")
        cursor.execute("UPDATE albums SET cover_photo_id = %s, updated_at = now() WHERE id = %s", (ids[0], rows[0]["album_id"]))
    elif action == "set_model_cover":
        if len(ids) != 1:
            raise Invalid("Select exactly one photo to use as the model cover.")
        cursor.execute("UPDATE models SET cover_photo_id = %s, updated_at = now() WHERE id = %s", (ids[0], rows[0]["model_id"]))
    elif action in {"set_pause", "unset_pause"}:
        cursor.execute("UPDATE photos SET is_pause = %s, updated_at = now() WHERE id = ANY(%s::uuid[])", (action == "set_pause", ids))
    elif action == "trash":
        cursor.execute("UPDATE photos SET deleted_at = now(), trashed_with = NULL WHERE id = ANY(%s::uuid[])", (ids,))
    elif action == "reorder":
        albums = {str(r["album_id"]) for r in rows}
        if len(albums) != 1:
            raise Invalid("Only photos in the same album can be reordered.")
        for index, photo_id in enumerate(ids, start=1):
            cursor.execute("UPDATE photos SET position = %s WHERE id = %s", (index * POSITION_STEP, photo_id))
    else:
        raise Invalid("Unsupported action.")
    audit(cursor, actor, f"photo.bulk.{action}", "photo", None, {"count": len(ids)})
    return {"updated": len(ids)}


def set_favorite(cursor, actor, photo_id: str, on: bool) -> dict:
    result = bulk(cursor, actor, "favorite" if on else "unfavorite", [photo_id], {})
    if result["updated"] == 0:
        raise NotFound("Photo not found.")
    return {"id": parse_uuid(photo_id), "fav": on}


def favorites(cursor, actor) -> list[dict]:
    visible, params = visible_album_sql(actor)
    cursor.execute(
        f"""
        SELECT {PHOTO_CARD_COLUMNS} FROM favorites f JOIN photos p ON p.id = f.photo_id JOIN albums a ON a.id = p.album_id
        WHERE f.user_id = %(actor_id)s AND p.status = 'ready' AND p.deleted_at IS NULL AND a.deleted_at IS NULL AND {visible}
        ORDER BY f.created_at DESC
        """,
        {**params, "actor_id": actor.user_id},
    )
    return [_photo_card(row) for row in cursor.fetchall()]


def search(cursor, actor, query: str) -> dict:
    query = " ".join((query or "").split())[:80]
    if len(query) < 1:
        return {"query": query, "models": [], "albums": [], "tags": [], "photos": []}
    pattern = "%" + query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    visible, params = visible_album_sql(actor)
    params = {**params, "pattern": pattern, "actor_id": actor.user_id}
    models = [m for m in list_models(cursor, actor, "name_asc", limit=100000) if query.lower() in (m["name"] or "").lower() or query.lower() in (m["stage_name"] or "").lower()][:20]
    cursor.execute(
        f"""
        SELECT a.id, a.title, a.model_id, a.shot_on, a.location, a.visibility, m.name AS model_name,
               cover.id AS cover_id, cover.dominant_color AS cover_color, cover.width AS cover_w, cover.height AS cover_h,
               (SELECT count(*) FROM photos p WHERE p.album_id = a.id AND p.deleted_at IS NULL) AS photo_count
        FROM albums a JOIN models m ON m.id = a.model_id {COVER_JOIN}
        WHERE a.deleted_at IS NULL AND m.deleted_at IS NULL AND {visible}
          AND (a.title ILIKE %(pattern)s OR a.location ILIKE %(pattern)s OR a.description ILIKE %(pattern)s)
        ORDER BY a.shot_on DESC NULLS LAST LIMIT 30
        """,
        params,
    )
    albums = [_album_card(row) for row in cursor.fetchall()]
    cursor.execute(
        f"""
        SELECT t.name, count(*) AS n FROM tags t JOIN photo_tags pt ON pt.tag_id = t.id
        JOIN photos p ON p.id = pt.photo_id JOIN albums a ON a.id = p.album_id
        WHERE t.name ILIKE %(pattern)s AND p.deleted_at IS NULL AND a.deleted_at IS NULL AND {visible}
        GROUP BY t.name ORDER BY n DESC LIMIT 20
        """,
        params,
    )
    tags = [{"name": r["name"], "count": r["n"]} for r in cursor.fetchall()]
    cursor.execute(
        f"""
        SELECT DISTINCT ON (p.id) {PHOTO_CARD_COLUMNS}, p.taken_at FROM photos p JOIN albums a ON a.id = p.album_id
        LEFT JOIN favorites f ON f.photo_id = p.id AND f.user_id = %(actor_id)s
        LEFT JOIN photo_tags pt ON pt.photo_id = p.id LEFT JOIN tags t ON t.id = pt.tag_id
        WHERE p.status = 'ready' AND p.deleted_at IS NULL AND a.deleted_at IS NULL AND {visible}
          AND (p.caption ILIKE %(pattern)s OR t.name ILIKE %(pattern)s)
        ORDER BY p.id LIMIT 300
        """,
        params,
    )
    photos = [_photo_card(row) for row in cursor.fetchall()]
    return {"query": query, "models": models, "albums": albums, "tags": tags, "photos": photos}


# ---------------------------------------------------------------- 업로드

def find_duplicate(cursor, sha256: str) -> dict | None:
    cursor.execute(
        "SELECT p.id, p.album_id, a.title, p.deleted_at FROM photos p JOIN albums a ON a.id = p.album_id WHERE p.sha256 = %s",
        (sha256,),
    )
    row = cursor.fetchone()
    if row is None:
        return None
    return {"photo_id": str(row["id"]), "album_id": str(row["album_id"]), "album_title": row["title"], "in_trash": row["deleted_at"] is not None}


def create_photo(cursor, actor, album_id: str, filename: str, upload: dict) -> dict:
    album_id = parse_uuid(album_id, "album")
    cursor.execute("SELECT model_id FROM albums WHERE id = %s AND deleted_at IS NULL FOR UPDATE", (album_id,))
    album = cursor.fetchone()
    if album is None:
        raise Invalid("Choose an album to upload to.", "required")
    duplicate = find_duplicate(cursor, upload["sha256"])
    if duplicate:
        where = "the trash" if duplicate["in_trash"] else f"the album “{duplicate['album_title']}”"
        raise Conflict(f"Skipped: the same photo is already in {where}.", "duplicate", duplicate)
    safe_name = "".join(ch for ch in (filename or "photo")[:200] if ch.isprintable() and ch not in "\\/:*?\"<>|") or "photo"
    cursor.execute(
        """
        INSERT INTO photos(album_id, model_id, original_filename, mime_type, byte_size, sha256, original_ext, position, status)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'processing') RETURNING id, created_at
        """,
        (album_id, album["model_id"], safe_name, upload["mime"], upload["size"], upload["sha256"], upload["ext"], _next_position(cursor, album_id)),
    )
    row = cursor.fetchone()
    return {"id": str(row["id"]), "created_at": row["created_at"], "album_id": album_id}


def recent_uploads(cursor, limit: int = 200) -> list[dict]:
    """퀵 업로드 화면의 등록 확인 목록. 최근 올린 사진부터."""
    cursor.execute(
        """
        SELECT p.id, p.original_filename, p.status, p.error, p.created_at, p.width, p.height, p.dominant_color,
               p.album_id, a.title AS album_title, m.name AS model_name,
               COALESCE(array_agg(t.name ORDER BY t.name) FILTER (WHERE t.name IS NOT NULL), '{}') AS tags
        FROM photos p JOIN albums a ON a.id = p.album_id JOIN models m ON m.id = p.model_id
        LEFT JOIN photo_tags pt ON pt.photo_id = p.id LEFT JOIN tags t ON t.id = pt.tag_id
        WHERE p.deleted_at IS NULL AND a.deleted_at IS NULL
        GROUP BY p.id, a.title, m.name
        ORDER BY p.created_at DESC LIMIT %s
        """,
        (max(1, min(limit, 1000)),),
    )
    return [
        {
            "id": str(r["id"]), "filename": r["original_filename"], "status": r["status"], "error": r["error"],
            "created_at": _iso(r["created_at"]), "w": r["width"] or 1, "h": r["height"] or 1, "color": r["dominant_color"],
            "album_id": str(r["album_id"]), "album_title": r["album_title"], "model_name": r["model_name"], "tags": list(r["tags"]),
        }
        for r in cursor.fetchall()
    ]


def upload_status(cursor, ids: list[str]) -> list[dict]:
    ids = parse_uuid_list(ids, limit=500)
    cursor.execute("SELECT id, status, error FROM photos WHERE id = ANY(%s::uuid[])", (ids,))
    return [{"id": str(r["id"]), "status": r["status"], "error": r["error"]} for r in cursor.fetchall()]


def photo_file_info(cursor, photo_id: str) -> dict | None:
    cursor.execute("SELECT id, created_at, original_ext, album_id, model_id, status FROM photos WHERE id = %s", (photo_id,))
    return cursor.fetchone()


def mark_processed(cursor, photo_id: str, metadata: dict) -> None:
    from psycopg.types.json import Jsonb

    cursor.execute(
        """
        UPDATE photos SET width = %s, height = %s, taken_at = %s, camera = %s, lens = %s, exposure = %s, exif = %s,
               dominant_color = %s, status = 'ready', error = NULL, processed_at = now(), updated_at = now()
        WHERE id = %s RETURNING album_id, model_id
        """,
        (
            metadata["width"], metadata["height"], metadata["taken_at"], metadata["camera"], metadata["lens"],
            Jsonb(metadata["exposure"]), Jsonb(metadata["exif"]), metadata["dominant_color"], photo_id,
        ),
    )


def mark_failed(cursor, photo_id: str, message: str) -> None:
    cursor.execute("UPDATE photos SET status = 'failed', error = %s, updated_at = now() WHERE id = %s", (message[:500], photo_id))


def media_access(cursor, actor, photo_id: str) -> dict:
    """사진 전달 전 권한 확인. 권한 밖이면 NotFound."""
    photo_id = parse_uuid(photo_id, "photo")
    visible, params = visible_album_sql(actor)
    cursor.execute(
        f"""
        SELECT p.id, p.created_at, p.original_ext, p.mime_type, p.sha256, p.original_filename, p.status, p.deleted_at,
               a.deleted_at AS album_deleted, COALESCE(s.can_download, false) AS can_download
        FROM photos p JOIN albums a ON a.id = p.album_id
        LEFT JOIN album_shares s ON s.album_id = a.id AND s.user_id = %(actor_id)s
        WHERE p.id = %(photo_id)s AND {visible}
        """,
        {**params, "photo_id": photo_id, "actor_id": actor.user_id},
    )
    row = cursor.fetchone()
    if row is None:
        raise NotFound("Photo not found.")
    if (row["deleted_at"] or row["album_deleted"]) and not actor.is_owner:
        raise NotFound("Photo not found.")
    return row


# ---------------------------------------------------------------- 휴지통

def trash_list(cursor) -> dict:
    cursor.execute(
        """
        SELECT m.id, m.name, m.deleted_at,
               (SELECT count(*) FROM photos p WHERE p.trashed_with = m.id) AS photo_count
        FROM models m WHERE m.deleted_at IS NOT NULL ORDER BY m.deleted_at DESC
        """
    )
    models = [{"type": "model", "id": str(r["id"]), "title": r["name"], "deleted_at": _iso(r["deleted_at"]), "photo_count": r["photo_count"]} for r in cursor.fetchall()]
    cursor.execute(
        """
        SELECT a.id, a.title, a.deleted_at, m.name AS model_name,
               (SELECT count(*) FROM photos p WHERE p.trashed_with = a.id) AS photo_count,
               (SELECT p.id FROM photos p WHERE p.album_id = a.id AND p.status = 'ready' ORDER BY p.position LIMIT 1) AS cover_id
        FROM albums a JOIN models m ON m.id = a.model_id
        WHERE a.deleted_at IS NOT NULL AND a.trashed_with IS NULL ORDER BY a.deleted_at DESC
        """
    )
    albums = [
        {"type": "album", "id": str(r["id"]), "title": r["title"], "subtitle": r["model_name"], "deleted_at": _iso(r["deleted_at"]),
         "photo_count": r["photo_count"], "cover_id": str(r["cover_id"]) if r["cover_id"] else None}
        for r in cursor.fetchall()
    ]
    cursor.execute(
        """
        SELECT p.id, p.original_filename, p.deleted_at, p.width, p.height, p.dominant_color, a.title AS album_title, p.status
        FROM photos p JOIN albums a ON a.id = p.album_id
        WHERE p.deleted_at IS NOT NULL AND p.trashed_with IS NULL ORDER BY p.deleted_at DESC LIMIT 2000
        """
    )
    photos = [
        {"type": "photo", "id": str(r["id"]), "title": r["original_filename"], "subtitle": r["album_title"], "deleted_at": _iso(r["deleted_at"]),
         "w": r["width"], "h": r["height"], "color": r["dominant_color"], "status": r["status"]}
        for r in cursor.fetchall()
    ]
    return {"items": models + albums + photos}


def restore(cursor, actor, kind: str, ids: list[str]) -> dict:
    ids = parse_uuid_list(ids)
    restored = 0
    for target in ids:
        if kind == "model":
            cursor.execute("UPDATE models SET deleted_at = NULL WHERE id = %s AND deleted_at IS NOT NULL", (target,))
            if cursor.rowcount:
                cursor.execute("UPDATE albums SET deleted_at = NULL, trashed_with = NULL WHERE trashed_with = %s", (target,))
                cursor.execute("UPDATE photos SET deleted_at = NULL, trashed_with = NULL WHERE trashed_with = %s", (target,))
        elif kind == "album":
            cursor.execute(
                "SELECT m.deleted_at FROM albums a JOIN models m ON m.id = a.model_id WHERE a.id = %s AND a.deleted_at IS NOT NULL", (target,)
            )
            row = cursor.fetchone()
            if row is None:
                continue
            if row["deleted_at"] is not None:
                raise Conflict("The model is in the trash. Restore the model first.", "parent_in_trash")
            cursor.execute("UPDATE albums SET deleted_at = NULL, trashed_with = NULL WHERE id = %s", (target,))
            cursor.execute("UPDATE photos SET deleted_at = NULL, trashed_with = NULL WHERE trashed_with = %s", (target,))
        elif kind == "photo":
            cursor.execute("SELECT a.deleted_at FROM photos p JOIN albums a ON a.id = p.album_id WHERE p.id = %s AND p.deleted_at IS NOT NULL", (target,))
            row = cursor.fetchone()
            if row is None:
                continue
            if row["deleted_at"] is not None:
                raise Conflict("The album is in the trash. Restore the album first.", "parent_in_trash")
            cursor.execute("UPDATE photos SET deleted_at = NULL, trashed_with = NULL WHERE id = %s", (target,))
        else:
            raise Invalid("Invalid item type to restore.")
        restored += 1
    audit(cursor, actor, "trash.restore", kind, None, {"count": restored})
    return {"restored": restored}


def purge(cursor, actor, kind: str | None, ids: list[str] | None, older_than_days: int | None = None) -> list[dict]:
    """영구 삭제할 DB 행을 지우고, 커밋 후 지울 파일 목록을 돌려준다."""
    model_ids: list[str] = []
    album_ids: list[str] = []
    photo_ids: list[str] = []
    if older_than_days is not None:
        cursor.execute("SELECT id FROM models WHERE deleted_at < now() - make_interval(days => %s)", (older_than_days,))
        model_ids = [str(r["id"]) for r in cursor.fetchall()]
        cursor.execute("SELECT id FROM albums WHERE deleted_at < now() - make_interval(days => %s) AND trashed_with IS NULL", (older_than_days,))
        album_ids = [str(r["id"]) for r in cursor.fetchall()]
        cursor.execute("SELECT id FROM photos WHERE deleted_at < now() - make_interval(days => %s) AND trashed_with IS NULL", (older_than_days,))
        photo_ids = [str(r["id"]) for r in cursor.fetchall()]
    elif kind is None:
        cursor.execute("SELECT id FROM models WHERE deleted_at IS NOT NULL")
        model_ids = [str(r["id"]) for r in cursor.fetchall()]
        cursor.execute("SELECT id FROM albums WHERE deleted_at IS NOT NULL AND trashed_with IS NULL")
        album_ids = [str(r["id"]) for r in cursor.fetchall()]
        cursor.execute("SELECT id FROM photos WHERE deleted_at IS NOT NULL AND trashed_with IS NULL")
        photo_ids = [str(r["id"]) for r in cursor.fetchall()]
    else:
        targets = parse_uuid_list(ids or [])
        {"model": model_ids, "album": album_ids, "photo": photo_ids}.get(kind, []).extend(targets)
        if kind not in {"model", "album", "photo"}:
            raise Invalid("Invalid item type to delete.")
    cursor.execute(
        """
        SELECT id, created_at, original_ext FROM photos
        WHERE deleted_at IS NOT NULL AND (id = ANY(%(p)s::uuid[]) OR album_id = ANY(%(a)s::uuid[]) OR model_id = ANY(%(m)s::uuid[]))
        """,
        {"p": photo_ids, "a": album_ids, "m": model_ids},
    )
    files = [{"id": str(r["id"]), "created_at": r["created_at"], "ext": r["original_ext"]} for r in cursor.fetchall()]
    doomed = [f["id"] for f in files]
    cursor.execute("UPDATE models SET cover_photo_id = NULL WHERE cover_photo_id = ANY(%s::uuid[])", (doomed,))
    cursor.execute("UPDATE albums SET cover_photo_id = NULL WHERE cover_photo_id = ANY(%s::uuid[])", (doomed,))
    cursor.execute("DELETE FROM photos WHERE id = ANY(%s::uuid[])", (doomed,))
    cursor.execute("DELETE FROM albums WHERE deleted_at IS NOT NULL AND (id = ANY(%s::uuid[]) OR model_id = ANY(%s::uuid[]))", (album_ids, model_ids))
    cursor.execute("DELETE FROM models WHERE deleted_at IS NOT NULL AND id = ANY(%s::uuid[])", (model_ids,))
    audit(cursor, actor, "trash.purge", kind, None, {"photos": len(files), "albums": len(album_ids), "models": len(model_ids), "auto": older_than_days is not None})
    return files


# ---------------------------------------------------------------- 설정·통계

def get_settings(cursor) -> dict:
    cursor.execute("SELECT key, value FROM app_settings WHERE key = ANY(%s)", (list(SETTING_RULES),))
    values = {row["key"]: row["value"] for row in cursor.fetchall()}
    result = {}
    for key, (kind, _, _) in SETTING_RULES.items():
        value = values.get(key)
        result[key] = kind(value) if value is not None else None
    return result


def update_settings(cursor, actor, payload: dict) -> dict:
    from psycopg.types.json import Jsonb

    for key, value in payload.items():
        if key not in SETTING_RULES:
            raise Invalid("This setting can't be changed.")
        kind, low, high = SETTING_RULES[key]
        if kind is bool:
            if not isinstance(value, bool):
                raise Invalid("Invalid setting value.")
        else:
            if not isinstance(value, int) or isinstance(value, bool) or not (low <= value <= high):
                raise Invalid(f"Enter a number between {low} and {high}.")
        cursor.execute(
            "INSERT INTO app_settings(key, value) VALUES (%s, %s) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
            (key, Jsonb(value)),
        )
    audit(cursor, actor, "settings.update", None, None, {"keys": sorted(payload)})
    return get_settings(cursor)


def storage_stats(cursor) -> dict:
    cursor.execute(
        """
        SELECT count(*) FILTER (WHERE deleted_at IS NULL) AS photos,
               COALESCE(sum(byte_size), 0) AS original_bytes,
               count(*) FILTER (WHERE status = 'processing') AS processing,
               count(*) FILTER (WHERE status = 'failed') AS failed
        FROM photos
        """
    )
    row = cursor.fetchone()
    cursor.execute("SELECT count(*) AS n FROM albums WHERE deleted_at IS NULL")
    albums = cursor.fetchone()["n"]
    cursor.execute("SELECT count(*) AS n FROM models WHERE deleted_at IS NULL")
    models = cursor.fetchone()["n"]
    return {"photos": row["photos"], "albums": albums, "models": models, "original_bytes": int(row["original_bytes"]), "processing": row["processing"], "failed": row["failed"]}


def setting_value(cursor, key: str, default):
    cursor.execute("SELECT value FROM app_settings WHERE key = %s", (key,))
    row = cursor.fetchone()
    return row["value"] if row else default
