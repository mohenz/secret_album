BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), login_id text NOT NULL UNIQUE,
 display_name text NOT NULL, password_hash text NOT NULL,
 role text NOT NULL DEFAULT 'viewer' CHECK (role IN ('owner','viewer')),
 totp_secret text, totp_enabled boolean NOT NULL DEFAULT false,
 recovery_codes jsonb NOT NULL DEFAULT '[]', failed_login_count integer NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
 locked_until timestamptz, disabled_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
 id text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL, user_agent text, ip inet, revoked_at timestamptz
);
CREATE TABLE IF NOT EXISTS models (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, stage_name text, bio text,
 cover_photo_id uuid, is_favorite boolean NOT NULL DEFAULT false, deleted_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS albums (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), model_id uuid NOT NULL REFERENCES models(id),
 title text NOT NULL, description text, shot_on date, location text, cover_photo_id uuid,
 visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','shared')),
 deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS photos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), album_id uuid NOT NULL REFERENCES albums(id),
 model_id uuid NOT NULL REFERENCES models(id), original_filename text NOT NULL, mime_type text NOT NULL,
 byte_size bigint NOT NULL CHECK (byte_size >= 0), sha256 text NOT NULL UNIQUE CHECK (length(sha256)=64),
 width integer CHECK (width > 0), height integer CHECK (height > 0), taken_at timestamptz,
 camera text, lens text, exposure jsonb NOT NULL DEFAULT '{}', exif jsonb NOT NULL DEFAULT '{}',
 dominant_color text, caption text, is_pause boolean NOT NULL DEFAULT false,
 position numeric(14,4) NOT NULL DEFAULT 0,
 status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','ready','failed')),
 error text, deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
DO $$ BEGIN ALTER TABLE models ADD CONSTRAINT models_cover_photo_fk FOREIGN KEY (cover_photo_id) REFERENCES photos(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE albums ADD CONSTRAINT albums_cover_photo_fk FOREIGN KEY (cover_photo_id) REFERENCES photos(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS tags (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS photo_tags (photo_id uuid NOT NULL REFERENCES photos(id) ON DELETE CASCADE, tag_id uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE, PRIMARY KEY(photo_id,tag_id));
CREATE TABLE IF NOT EXISTS favorites (user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, photo_id uuid NOT NULL REFERENCES photos(id) ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,photo_id));
CREATE TABLE IF NOT EXISTS album_shares (album_id uuid NOT NULL REFERENCES albums(id) ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, can_download boolean NOT NULL DEFAULT false, PRIMARY KEY(album_id,user_id));
CREATE TABLE IF NOT EXISTS app_settings (key text PRIMARY KEY, value jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS audit_logs (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, user_id uuid REFERENCES users(id) ON DELETE SET NULL, action text NOT NULL, target_type text, target_id uuid, detail jsonb NOT NULL DEFAULT '{}', ip inet, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS background_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_type text NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed')),
 payload jsonb NOT NULL DEFAULT '{}', result jsonb, error text, attempts integer NOT NULL DEFAULT 0,
 max_attempts integer NOT NULL DEFAULT 3, run_after timestamptz NOT NULL DEFAULT now(),
 locked_by text, locked_at timestamptz, started_at timestamptz, finished_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS photos_album_position_active_idx ON photos(album_id,position) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS photos_model_taken_idx ON photos(model_id,taken_at DESC);
CREATE INDEX IF NOT EXISTS photos_taken_idx ON photos(taken_at DESC);
CREATE INDEX IF NOT EXISTS albums_model_shot_idx ON albums(model_id,shot_on DESC);
CREATE INDEX IF NOT EXISTS sessions_user_active_idx ON sessions(user_id,expires_at) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS jobs_claim_idx ON background_jobs(status,run_after,created_at) WHERE status='queued';
CREATE INDEX IF NOT EXISTS models_name_trgm_idx ON models USING gin(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS models_stage_name_trgm_idx ON models USING gin(stage_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS albums_title_trgm_idx ON albums USING gin(title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS tags_name_trgm_idx ON tags USING gin(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS photos_caption_trgm_idx ON photos USING gin(caption gin_trgm_ops);

INSERT INTO app_settings(key,value) VALUES ('session_idle_minutes','15'),('trash_retention_days','30'),('media_cache_enabled','true') ON CONFLICT(key) DO NOTHING;
COMMIT;

