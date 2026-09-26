-- 사진 처리·휴지통·작업 큐 보조 인덱스와 설정
ALTER TABLE photos ADD COLUMN IF NOT EXISTS original_ext text NOT NULL DEFAULT 'jpg';
ALTER TABLE photos ADD COLUMN IF NOT EXISTS processed_at timestamptz;
ALTER TABLE models ADD COLUMN IF NOT EXISTS trashed_with uuid;
ALTER TABLE albums ADD COLUMN IF NOT EXISTS trashed_with uuid;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS trashed_with uuid;
ALTER TABLE background_jobs DROP CONSTRAINT IF EXISTS background_jobs_status_check;
ALTER TABLE background_jobs ADD CONSTRAINT background_jobs_status_check CHECK (status IN ('queued','running','succeeded','failed','canceled'));
CREATE INDEX IF NOT EXISTS photos_deleted_idx ON photos(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS albums_deleted_idx ON albums(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS models_deleted_idx ON models(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS photos_status_idx ON photos(status) WHERE status <> 'ready';
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs(created_at DESC);
INSERT INTO app_settings(key,value) VALUES
 ('blur_thumbnails','false'),
 ('viewer_controls_hide_seconds','3'),
 ('maintenance_last_run','""')
ON CONFLICT(key) DO NOTHING;
