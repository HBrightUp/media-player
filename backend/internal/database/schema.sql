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

CREATE TABLE IF NOT EXISTS chat_rooms (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO chat_rooms (name, description)
VALUES
  ('大厅', '所有人都能加入的默认聊天室')
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGSERIAL PRIMARY KEY,
  room_id BIGINT REFERENCES chat_rooms(id) ON DELETE CASCADE,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  phone TEXT NOT NULL DEFAULT '',
  nickname TEXT NOT NULL,
  content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 500),
  message_type TEXT NOT NULL DEFAULT 'text',
  attachment_name TEXT NOT NULL DEFAULT '',
  attachment_mime TEXT NOT NULL DEFAULT '',
  attachment_data TEXT NOT NULL DEFAULT '',
  mentions JSONB NOT NULL DEFAULT '[]'::jsonb,
  read_by JSONB NOT NULL DEFAULT '[]'::jsonb,
  recalled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE tracks ADD COLUMN IF NOT EXISTS lyrics JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS room_id BIGINT;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'text';
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachment_name TEXT NOT NULL DEFAULT '';
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachment_mime TEXT NOT NULL DEFAULT '';
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachment_data TEXT NOT NULL DEFAULT '';
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS mentions JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS read_by JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS recalled_at TIMESTAMPTZ;

UPDATE chat_messages
SET room_id = (SELECT id FROM chat_rooms WHERE name = '大厅')
WHERE room_id IS NULL;

ALTER TABLE chat_messages ALTER COLUMN room_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chat_messages_room_id_fkey'
  ) THEN
    ALTER TABLE chat_messages
      ADD CONSTRAINT chat_messages_room_id_fkey
      FOREIGN KEY (room_id) REFERENCES chat_rooms(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chat_messages_message_type_check'
  ) THEN
    ALTER TABLE chat_messages
      ADD CONSTRAINT chat_messages_message_type_check
      CHECK (message_type IN ('text', 'image', 'audio'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS tracks_title_idx ON tracks (lower(title));
CREATE INDEX IF NOT EXISTS tracks_artist_idx ON tracks (lower(artist));
CREATE INDEX IF NOT EXISTS tracks_album_idx ON tracks (lower(album));
CREATE INDEX IF NOT EXISTS users_phone_idx ON users (phone);
CREATE INDEX IF NOT EXISTS chat_rooms_name_idx ON chat_rooms (name);
CREATE INDEX IF NOT EXISTS chat_messages_room_id_idx ON chat_messages (room_id);
CREATE INDEX IF NOT EXISTS chat_messages_user_id_idx ON chat_messages (user_id);
CREATE INDEX IF NOT EXISTS chat_messages_room_id_id_desc_idx ON chat_messages (room_id, id DESC);
DROP INDEX IF EXISTS chat_messages_id_desc_idx;
