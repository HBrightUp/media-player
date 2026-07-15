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
  quality TEXT NOT NULL DEFAULT 'lossless' CHECK (quality IN ('lossless', 'lossy')),
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
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS quality TEXT NOT NULL DEFAULT 'lossless';
ALTER TABLE tracks DROP CONSTRAINT IF EXISTS tracks_quality_check;
ALTER TABLE tracks ADD CONSTRAINT tracks_quality_check CHECK (quality IN ('lossless', 'lossy'));

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE,
  country_code TEXT NOT NULL DEFAULT '+86',
  nickname TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('super_admin', 'admin', 'vip', 'user')),
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  terms_accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';
UPDATE users
SET role = 'user'
WHERE role NOT IN ('super_admin', 'admin', 'vip', 'user');
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('super_admin', 'admin', 'vip', 'user'));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE role = 'super_admin') THEN
    UPDATE users
    SET role = 'super_admin'
    WHERE id = (
      SELECT id
      FROM users
      ORDER BY id
      LIMIT 1
    );
  END IF;
END $$;

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

CREATE TABLE IF NOT EXISTS playback_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  auth_session_token_hash TEXT,
  device_id TEXT NOT NULL,
  tab_id TEXT NOT NULL,
  device_name TEXT NOT NULL DEFAULT '',
  track_id BIGINT REFERENCES tracks(id) ON DELETE SET NULL,
  state TEXT NOT NULL DEFAULT 'playing' CHECK (state IN ('playing', 'paused')),
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE playback_sessions ADD COLUMN IF NOT EXISTS auth_session_token_hash TEXT;
ALTER TABLE playback_sessions ADD COLUMN IF NOT EXISTS device_id TEXT NOT NULL DEFAULT '';
ALTER TABLE playback_sessions ADD COLUMN IF NOT EXISTS tab_id TEXT NOT NULL DEFAULT '';
ALTER TABLE playback_sessions ADD COLUMN IF NOT EXISTS device_name TEXT NOT NULL DEFAULT '';
ALTER TABLE playback_sessions ADD COLUMN IF NOT EXISTS track_id BIGINT REFERENCES tracks(id) ON DELETE SET NULL;
ALTER TABLE playback_sessions ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'playing';
ALTER TABLE playback_sessions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE playback_sessions ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE playback_sessions ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
ALTER TABLE playback_sessions ADD COLUMN IF NOT EXISTS revoked_reason TEXT;
ALTER TABLE playback_sessions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE playback_sessions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE playback_sessions DROP CONSTRAINT IF EXISTS playback_sessions_state_check;
ALTER TABLE playback_sessions ADD CONSTRAINT playback_sessions_state_check CHECK (state IN ('playing', 'paused'));

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
DROP TABLE IF EXISTS note_comments;

CREATE INDEX IF NOT EXISTS tracks_title_idx ON tracks (lower(title));
CREATE INDEX IF NOT EXISTS tracks_artist_idx ON tracks (lower(artist));
CREATE INDEX IF NOT EXISTS tracks_album_idx ON tracks (lower(album));
CREATE INDEX IF NOT EXISTS tracks_quality_title_idx ON tracks (quality, lower(title), lower(artist), id);
CREATE INDEX IF NOT EXISTS users_phone_idx ON users (phone);
CREATE INDEX IF NOT EXISTS users_role_idx ON users (role, id);
CREATE INDEX IF NOT EXISTS playback_sessions_user_active_idx ON playback_sessions (user_id, expires_at DESC) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS playback_sessions_last_seen_idx ON playback_sessions (last_seen_at) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS playback_sessions_auth_session_idx ON playback_sessions (auth_session_token_hash) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS favorite_tracks_user_created_idx ON favorite_tracks (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS favorite_tracks_track_id_idx ON favorite_tracks (track_id);
CREATE UNIQUE INDEX IF NOT EXISTS favorite_categories_user_name_unique_idx ON favorite_categories (user_id, lower(name));
CREATE INDEX IF NOT EXISTS favorite_categories_user_sort_idx ON favorite_categories (user_id, sort_order, id);
CREATE INDEX IF NOT EXISTS favorite_category_tracks_user_category_added_idx ON favorite_category_tracks (user_id, category_id, added_at DESC);
CREATE INDEX IF NOT EXISTS favorite_category_tracks_user_track_idx ON favorite_category_tracks (user_id, track_id);
