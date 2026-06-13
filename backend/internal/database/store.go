package database

import (
	"context"
	"database/sql"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/hml/media-player/backend/internal/models"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrUserAlreadyExists = errors.New("user already exists")

//go:embed schema.sql
var initSQL string

type Store struct {
	pool *pgxpool.Pool
}

func New(ctx context.Context, databaseURL string) (*Store, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("create postgres pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping postgres: %w", err)
	}
	return &Store{pool: pool}, nil
}

func (s *Store) Close() {
	s.pool.Close()
}

func (s *Store) Migrate(ctx context.Context) error {
	_, err := s.pool.Exec(ctx, initSQL)
	return err
}

func (s *Store) GetSetting(ctx context.Context, key string) (models.LibrarySetting, error) {
	var setting models.LibrarySetting
	err := s.pool.QueryRow(ctx, `
		SELECT value, updated_at
		FROM settings
		WHERE key = $1
	`, key).Scan(&setting.Path, &setting.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return models.LibrarySetting{}, sql.ErrNoRows
	}
	return setting, err
}

func (s *Store) SetSetting(ctx context.Context, key, value string) (models.LibrarySetting, error) {
	var setting models.LibrarySetting
	err := s.pool.QueryRow(ctx, `
		INSERT INTO settings (key, value, updated_at)
		VALUES ($1, $2, now())
		ON CONFLICT (key)
		DO UPDATE SET value = EXCLUDED.value, updated_at = now()
		RETURNING value, updated_at
	`, key, value).Scan(&setting.Path, &setting.UpdatedAt)
	return setting, err
}

func (s *Store) CreateUser(ctx context.Context, user models.User) (models.User, error) {
	err := s.pool.QueryRow(ctx, `
		INSERT INTO users (
			phone,
			country_code,
			nickname,
			password_hash,
			password_salt,
			terms_accepted_at,
			updated_at
		)
		VALUES ($1, $2, $3, $4, $5, now(), now())
		ON CONFLICT (phone) DO NOTHING
		RETURNING id, phone, country_code, nickname, password_hash, password_salt, terms_accepted_at, created_at, updated_at
	`,
		user.Phone,
		user.CountryCode,
		user.Nickname,
		user.PasswordHash,
		user.PasswordSalt,
	).Scan(
		&user.ID,
		&user.Phone,
		&user.CountryCode,
		&user.Nickname,
		&user.PasswordHash,
		&user.PasswordSalt,
		&user.TermsAcceptedAt,
		&user.CreatedAt,
		&user.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return models.User{}, ErrUserAlreadyExists
	}
	return user, err
}

func (s *Store) GetUserByPhone(ctx context.Context, phone string) (models.User, error) {
	var user models.User
	err := s.pool.QueryRow(ctx, `
		SELECT id, phone, country_code, nickname, password_hash, password_salt, terms_accepted_at, created_at, updated_at
		FROM users
		WHERE phone = $1
	`, phone).Scan(
		&user.ID,
		&user.Phone,
		&user.CountryCode,
		&user.Nickname,
		&user.PasswordHash,
		&user.PasswordSalt,
		&user.TermsAcceptedAt,
		&user.CreatedAt,
		&user.UpdatedAt,
	)
	return user, err
}

func (s *Store) ListChatRooms(ctx context.Context) ([]models.ChatRoom, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, name, description, created_at
		FROM chat_rooms
		WHERE name NOT IN ('音乐闲聊', '发现')
		ORDER BY id
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	rooms := make([]models.ChatRoom, 0)
	for rows.Next() {
		var room models.ChatRoom
		if err := rows.Scan(&room.ID, &room.Name, &room.Description, &room.CreatedAt); err != nil {
			return nil, err
		}
		rooms = append(rooms, room)
	}
	return rooms, rows.Err()
}

func (s *Store) CreateChatMessage(ctx context.Context, message models.ChatMessage, phone string) (models.ChatMessage, error) {
	userID := sql.NullInt64{Int64: message.UserID, Valid: message.UserID > 0}
	mentions, err := json.Marshal(message.Mentions)
	if err != nil {
		return models.ChatMessage{}, fmt.Errorf("marshal mentions: %w", err)
	}
	var readBy []byte
	err = s.pool.QueryRow(ctx, `
		INSERT INTO chat_messages (
			room_id,
			user_id,
			phone,
			nickname,
			content,
			message_type,
			attachment_name,
			attachment_mime,
			attachment_data,
			mentions
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
		RETURNING
			id,
			room_id,
			COALESCE(user_id, 0),
			nickname,
			content,
			message_type,
			attachment_name,
			attachment_mime,
			attachment_data,
			mentions,
			read_by,
			recalled_at,
			created_at
	`,
		message.RoomID,
		userID,
		phone,
		message.Nickname,
		message.Content,
		message.MessageType,
		message.AttachmentName,
		message.AttachmentMime,
		message.AttachmentData,
		mentions,
	).Scan(
		&message.ID,
		&message.RoomID,
		&message.UserID,
		&message.Nickname,
		&message.Content,
		&message.MessageType,
		&message.AttachmentName,
		&message.AttachmentMime,
		&message.AttachmentData,
		&mentions,
		&readBy,
		&message.RecalledAt,
		&message.CreatedAt,
	)
	if err != nil {
		return message, err
	}
	if err := json.Unmarshal(mentions, &message.Mentions); err != nil {
		return models.ChatMessage{}, fmt.Errorf("unmarshal mentions: %w", err)
	}
	if err := json.Unmarshal(readBy, &message.ReadBy); err != nil {
		return models.ChatMessage{}, fmt.Errorf("unmarshal read_by: %w", err)
	}
	return message, err
}

func (s *Store) ListChatMessages(ctx context.Context, roomID int64, limit int, beforeID int64, query string) ([]models.ChatMessage, error) {
	if limit <= 0 {
		limit = 50
	}

	var (
		rows pgx.Rows
		err  error
	)
	if beforeID > 0 {
		rows, err = s.pool.Query(ctx, `
			WITH selected AS (
				SELECT
					id,
					room_id,
					COALESCE(user_id, 0) AS user_id,
					nickname,
					content,
					message_type,
					attachment_name,
					attachment_mime,
					attachment_data,
					mentions,
					read_by,
					recalled_at,
					created_at
				FROM chat_messages
				WHERE room_id = $1
					AND id < $2
					AND (
						$4 = ''
						OR position(lower($4) in lower(content)) > 0
						OR position(lower($4) in lower(nickname)) > 0
					)
				ORDER BY id DESC
				LIMIT $3
			)
			SELECT
				id,
				room_id,
				user_id,
				nickname,
				content,
				message_type,
				attachment_name,
				attachment_mime,
				attachment_data,
				mentions,
				read_by,
				recalled_at,
				created_at
			FROM selected
			ORDER BY id ASC
		`, roomID, beforeID, limit, query)
	} else {
		rows, err = s.pool.Query(ctx, `
			WITH selected AS (
				SELECT
					id,
					room_id,
					COALESCE(user_id, 0) AS user_id,
					nickname,
					content,
					message_type,
					attachment_name,
					attachment_mime,
					attachment_data,
					mentions,
					read_by,
					recalled_at,
					created_at
				FROM chat_messages
				WHERE room_id = $1
					AND (
						$3 = ''
						OR position(lower($3) in lower(content)) > 0
						OR position(lower($3) in lower(nickname)) > 0
					)
				ORDER BY id DESC
				LIMIT $2
			)
			SELECT
				id,
				room_id,
				user_id,
				nickname,
				content,
				message_type,
				attachment_name,
				attachment_mime,
				attachment_data,
				mentions,
				read_by,
				recalled_at,
				created_at
			FROM selected
			ORDER BY id ASC
		`, roomID, limit, query)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	messages := make([]models.ChatMessage, 0)
	for rows.Next() {
		message, err := scanChatMessage(rows)
		if err != nil {
			return nil, err
		}
		messages = append(messages, message)
	}
	return messages, rows.Err()
}

func (s *Store) RecallChatMessage(ctx context.Context, messageID, userID int64) (models.ChatMessage, error) {
	row := s.pool.QueryRow(ctx, `
		UPDATE chat_messages
		SET recalled_at = now()
		WHERE id = $1
			AND user_id = $2
			AND recalled_at IS NULL
		RETURNING
			id,
			room_id,
			COALESCE(user_id, 0),
			nickname,
			content,
			message_type,
			attachment_name,
			attachment_mime,
			attachment_data,
			mentions,
			read_by,
			recalled_at,
			created_at
	`, messageID, userID)
	return scanChatMessage(row)
}

func (s *Store) MarkChatRoomRead(ctx context.Context, roomID, userID int64) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE chat_messages
		SET read_by = read_by || to_jsonb(ARRAY[$2]::bigint[])
		WHERE room_id = $1
			AND recalled_at IS NULL
			AND user_id IS DISTINCT FROM $2
			AND NOT read_by @> to_jsonb(ARRAY[$2]::bigint[])
	`, roomID, userID)
	return err
}

func (s *Store) UpsertTrack(ctx context.Context, track models.Track) (int64, error) {
	var id int64
	lyrics, err := json.Marshal(track.Lyrics)
	if err != nil {
		return 0, fmt.Errorf("marshal lyrics: %w", err)
	}
	err = s.pool.QueryRow(ctx, `
		INSERT INTO tracks (
			path,
			relative_path,
			filename,
			title,
			artist,
			album,
			format,
			size_bytes,
			duration_seconds,
			modified_at,
			lyrics,
			updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
		ON CONFLICT (path)
		DO UPDATE SET
			relative_path = EXCLUDED.relative_path,
			filename = EXCLUDED.filename,
			title = EXCLUDED.title,
			artist = EXCLUDED.artist,
			album = EXCLUDED.album,
			format = EXCLUDED.format,
			size_bytes = EXCLUDED.size_bytes,
			duration_seconds = EXCLUDED.duration_seconds,
			modified_at = EXCLUDED.modified_at,
			lyrics = EXCLUDED.lyrics,
			updated_at = now()
		RETURNING id
	`,
		track.Path,
		track.RelativePath,
		track.Filename,
		track.Title,
		track.Artist,
		track.Album,
		track.Format,
		track.SizeBytes,
		track.DurationSeconds,
		track.ModifiedAt,
		lyrics,
	).Scan(&id)
	return id, err
}

func (s *Store) ClearTracks(ctx context.Context) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM tracks`)
	return err
}

func (s *Store) ListTracks(ctx context.Context) ([]models.Track, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT
			id,
			path,
			relative_path,
			filename,
			title,
			artist,
			album,
			format,
			size_bytes,
			duration_seconds,
			modified_at,
			lyrics
		FROM tracks
		WHERE format = 'mp3'
		ORDER BY lower(title), lower(artist), id
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tracks := make([]models.Track, 0)
	for rows.Next() {
		track, err := scanTrack(rows)
		if err != nil {
			return nil, err
		}
		tracks = append(tracks, track)
	}
	return tracks, rows.Err()
}

func (s *Store) GetTrack(ctx context.Context, id int64) (models.Track, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT
			id,
			path,
			relative_path,
			filename,
			title,
			artist,
			album,
			format,
			size_bytes,
			duration_seconds,
			modified_at,
			lyrics
		FROM tracks
		WHERE id = $1
	`, id)
	return scanTrack(row)
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanChatMessage(row rowScanner) (models.ChatMessage, error) {
	var message models.ChatMessage
	var mentions []byte
	var readBy []byte
	err := row.Scan(
		&message.ID,
		&message.RoomID,
		&message.UserID,
		&message.Nickname,
		&message.Content,
		&message.MessageType,
		&message.AttachmentName,
		&message.AttachmentMime,
		&message.AttachmentData,
		&mentions,
		&readBy,
		&message.RecalledAt,
		&message.CreatedAt,
	)
	if err != nil {
		return models.ChatMessage{}, err
	}
	if len(mentions) == 0 {
		message.Mentions = []string{}
	} else if err := json.Unmarshal(mentions, &message.Mentions); err != nil {
		return models.ChatMessage{}, fmt.Errorf("unmarshal mentions: %w", err)
	}
	if len(readBy) == 0 {
		message.ReadBy = []int64{}
	} else if err := json.Unmarshal(readBy, &message.ReadBy); err != nil {
		return models.ChatMessage{}, fmt.Errorf("unmarshal read_by: %w", err)
	}
	return message, nil
}

func scanTrack(row rowScanner) (models.Track, error) {
	var track models.Track
	var duration sql.NullInt64
	var lyrics []byte
	err := row.Scan(
		&track.ID,
		&track.Path,
		&track.RelativePath,
		&track.Filename,
		&track.Title,
		&track.Artist,
		&track.Album,
		&track.Format,
		&track.SizeBytes,
		&duration,
		&track.ModifiedAt,
		&lyrics,
	)
	if err != nil {
		return models.Track{}, err
	}
	if duration.Valid {
		value := int(duration.Int64)
		track.DurationSeconds = &value
	}
	if len(lyrics) > 0 {
		if err := json.Unmarshal(lyrics, &track.Lyrics); err != nil {
			return models.Track{}, fmt.Errorf("decode lyrics: %w", err)
		}
	}
	if track.Lyrics == nil {
		track.Lyrics = []models.LyricLine{}
	}
	track.StreamURL = fmt.Sprintf("/api/tracks/%d/stream", track.ID)
	return track, nil
}
