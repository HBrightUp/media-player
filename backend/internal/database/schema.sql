CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tracks (
  id BIGSERIAL PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  relative_path TEXT NOT NULL,
  filename TEXT NOT NULL,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  album TEXT NOT NULL,
  format TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  duration_seconds INTEGER,
  modified_at TIMESTAMPTZ NOT NULL,
  cover_mime_type TEXT,
  cover_data BYTEA,
  cover_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE tracks ADD COLUMN IF NOT EXISTS cover_mime_type TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS cover_data BYTEA;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS cover_hash TEXT;

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE,
  country_code TEXT NOT NULL DEFAULT '+86',
  nickname TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  terms_accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  ended_reason TEXT,
  offline_recorded_at TIMESTAMPTZ,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS ended_reason TEXT;
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS offline_recorded_at TIMESTAMPTZ;
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS ip_address TEXT;
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS user_agent TEXT;

CREATE TABLE IF NOT EXISTS auth_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (event_type IN ('login_success', 'login_failure', 'logout_explicit', 'offline_timeout', 'session_expired')),
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  phone TEXT,
  session_token_hash TEXT,
  ip_address TEXT,
  user_agent TEXT,
  success BOOLEAN NOT NULL DEFAULT true,
  failure_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS favorite_tracks (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_id BIGINT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, track_id)
);

CREATE TABLE IF NOT EXISTS favorite_categories (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, user_id)
);

CREATE TABLE IF NOT EXISTS favorite_category_tracks (
  user_id BIGINT NOT NULL,
  category_id BIGINT NOT NULL,
  track_id BIGINT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, category_id, track_id),
  FOREIGN KEY (user_id, track_id) REFERENCES favorite_tracks(user_id, track_id) ON DELETE CASCADE,
  FOREIGN KEY (category_id, user_id) REFERENCES favorite_categories(id, user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS track_lyrics (
  track_id BIGINT PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
  format TEXT NOT NULL CHECK (format IN ('lrc', 'plain')),
  content TEXT NOT NULL,
  lines JSONB NOT NULL DEFAULT '[]'::jsonb,
  source TEXT NOT NULL DEFAULT 'unknown',
  source_path TEXT,
  content_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS note_folders (
  id BIGSERIAL PRIMARY KEY,
  parent_id BIGINT REFERENCES note_folders(id) ON DELETE CASCADE,
  owner_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notes (
  id BIGSERIAL PRIMARY KEY,
  folder_id BIGINT REFERENCES note_folders(id) ON DELETE SET NULL,
  owner_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS note_comments (
  id BIGSERIAL PRIMARY KEY,
  note_id BIGINT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'tracks'
      AND column_name = 'lyrics'
  ) THEN
    INSERT INTO track_lyrics (
      track_id,
      format,
      content,
      lines,
      source,
      content_hash,
      updated_at
    )
    SELECT
      id,
      'lrc',
      lyrics::text,
      lyrics,
      'legacy',
      md5(lyrics::text),
      now()
    FROM tracks
    WHERE jsonb_array_length(lyrics) > 0
    ON CONFLICT (track_id) DO NOTHING;
  END IF;
END $$;

ALTER TABLE tracks DROP COLUMN IF EXISTS lyrics;
DROP TABLE IF EXISTS chat_messages;
DROP TABLE IF EXISTS chat_rooms;

CREATE INDEX IF NOT EXISTS tracks_title_idx ON tracks (lower(title));
CREATE INDEX IF NOT EXISTS tracks_artist_idx ON tracks (lower(artist));
CREATE INDEX IF NOT EXISTS tracks_album_idx ON tracks (lower(album));
CREATE INDEX IF NOT EXISTS users_phone_idx ON users (phone);
CREATE INDEX IF NOT EXISTS auth_sessions_user_expires_idx ON auth_sessions (user_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS auth_sessions_expires_idx ON auth_sessions (expires_at);
CREATE INDEX IF NOT EXISTS auth_sessions_last_seen_idx ON auth_sessions (last_seen_at) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS auth_sessions_offline_pending_idx ON auth_sessions (last_seen_at) WHERE ended_at IS NULL AND offline_recorded_at IS NULL;
CREATE INDEX IF NOT EXISTS auth_audit_logs_user_time_idx ON auth_audit_logs (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS auth_audit_logs_event_time_idx ON auth_audit_logs (event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS auth_audit_logs_phone_time_idx ON auth_audit_logs (phone, occurred_at DESC);
CREATE INDEX IF NOT EXISTS favorite_tracks_user_created_idx ON favorite_tracks (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS favorite_tracks_track_id_idx ON favorite_tracks (track_id);
CREATE UNIQUE INDEX IF NOT EXISTS favorite_categories_user_name_unique_idx ON favorite_categories (user_id, lower(name));
CREATE INDEX IF NOT EXISTS favorite_categories_user_sort_idx ON favorite_categories (user_id, sort_order, id);
CREATE INDEX IF NOT EXISTS favorite_category_tracks_user_category_added_idx ON favorite_category_tracks (user_id, category_id, added_at DESC);
CREATE INDEX IF NOT EXISTS favorite_category_tracks_user_track_idx ON favorite_category_tracks (user_id, track_id);
CREATE INDEX IF NOT EXISTS note_folders_parent_sort_idx ON note_folders (parent_id, sort_order, id);
CREATE INDEX IF NOT EXISTS note_folders_owner_idx ON note_folders (owner_user_id);
CREATE INDEX IF NOT EXISTS notes_folder_updated_idx ON notes (folder_id, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS notes_owner_updated_idx ON notes (owner_user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS notes_search_idx ON notes (lower(title), updated_at DESC);
CREATE INDEX IF NOT EXISTS note_comments_note_created_idx ON note_comments (note_id, created_at, id);
CREATE INDEX IF NOT EXISTS note_comments_user_idx ON note_comments (user_id);
