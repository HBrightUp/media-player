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
  lyrics JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE tracks ADD COLUMN IF NOT EXISTS lyrics JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS tracks_title_idx ON tracks (lower(title));
CREATE INDEX IF NOT EXISTS tracks_artist_idx ON tracks (lower(artist));
CREATE INDEX IF NOT EXISTS tracks_album_idx ON tracks (lower(album));
