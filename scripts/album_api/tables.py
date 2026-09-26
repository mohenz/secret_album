"""허용 값 목록. SQL에 직접 들어가는 정렬식은 반드시 이 표에서만 고른다."""

ALBUM_SORTS = {
    "shot_desc": "a.shot_on DESC NULLS LAST, a.created_at DESC",
    "added_desc": "a.created_at DESC",
    "title_asc": "a.title ASC, a.created_at DESC",
}
DEFAULT_ALBUM_SORT = "shot_desc"

MODEL_SORTS = {
    "name_asc": "m.name ASC",
    "recent_desc": "last_shot DESC NULLS LAST, m.name ASC",
    "photos_desc": "photo_count DESC, m.name ASC",
}
DEFAULT_MODEL_SORT = "name_asc"

BULK_ACTIONS = frozenset(
    {"favorite", "unfavorite", "tag", "untag", "move", "set_album_cover", "set_model_cover", "set_pause", "unset_pause", "trash", "reorder"}
)

TRASH_TYPES = ("model", "album", "photo")

# 설정 화면에서 바꿀 수 있는 값과 허용 범위
SETTING_RULES = {
    "session_idle_minutes": (int, 1, 240),
    "trash_retention_days": (int, 1, 365),
    "media_cache_enabled": (bool, None, None),
    "blur_thumbnails": (bool, None, None),
    "viewer_controls_hide_seconds": (int, 1, 30),
}

MODEL_FIELDS = {"name": 120, "stage_name": 120, "bio": 4000}
ALBUM_FIELDS = {"title": 200, "description": 8000, "location": 200}
PHOTO_TEXT_FIELDS = {"caption": 2000}
TAG_MAX_LENGTH = 40
TAGS_PER_PHOTO = 30
