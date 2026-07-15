package database

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	PlaybackStatePlaying = "playing"
	PlaybackStatePaused  = "paused"
)

type PlaybackSessionCreate struct {
	TokenHash            string
	UserID               int64
	AuthSessionTokenHash string
	DeviceID             string
	TabID                string
	DeviceName           string
	TrackID              int64
	State                string
	Now                  time.Time
	ExpiresAt            time.Time
}

type PlaybackSessionHeartbeat struct {
	TokenHash string
	UserID    int64
	DeviceID  string
	TabID     string
	TrackID   int64
	State     string
	Now       time.Time
	ExpiresAt time.Time
}

type PlaybackSessionRecord struct {
	TokenHash  string
	UserID     int64
	DeviceID   string
	TabID      string
	DeviceName string
	TrackID    int64
	State      string
	ExpiresAt  time.Time
	LastSeenAt time.Time
	CreatedAt  time.Time
}

func (s *Store) CreatePlaybackSession(ctx context.Context, create PlaybackSessionCreate) (PlaybackSessionRecord, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return PlaybackSessionRecord{}, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1::bigint)`, create.UserID); err != nil {
		return PlaybackSessionRecord{}, err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE playback_sessions
		SET revoked_at = $2,
			revoked_reason = 'replaced',
			updated_at = $2
		WHERE user_id = $1
			AND revoked_at IS NULL
			AND expires_at > $2
	`, create.UserID, create.Now); err != nil {
		return PlaybackSessionRecord{}, err
	}

	row := tx.QueryRow(ctx, `
		INSERT INTO playback_sessions (
			token_hash,
			user_id,
			auth_session_token_hash,
			device_id,
			tab_id,
			device_name,
			track_id,
			state,
			expires_at,
			last_seen_at,
			updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
		RETURNING token_hash, user_id, device_id, tab_id, device_name, COALESCE(track_id, 0), state, expires_at, last_seen_at, created_at
	`,
		create.TokenHash,
		create.UserID,
		nullableString(create.AuthSessionTokenHash),
		strings.TrimSpace(create.DeviceID),
		strings.TrimSpace(create.TabID),
		strings.TrimSpace(create.DeviceName),
		nullableInt64(create.TrackID),
		NormalizePlaybackState(create.State),
		create.ExpiresAt,
		create.Now,
	)
	record, err := scanPlaybackSessionRecord(row)
	if err != nil {
		return PlaybackSessionRecord{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return PlaybackSessionRecord{}, err
	}
	return record, nil
}

func (s *Store) HeartbeatPlaybackSession(ctx context.Context, heartbeat PlaybackSessionHeartbeat) (PlaybackSessionRecord, error) {
	row := s.pool.QueryRow(ctx, `
		UPDATE playback_sessions
		SET track_id = COALESCE($5, track_id),
			state = $6,
			expires_at = $7,
			last_seen_at = $8,
			updated_at = $8
		WHERE token_hash = $1
			AND user_id = $2
			AND device_id = $3
			AND tab_id = $4
			AND revoked_at IS NULL
			AND expires_at > $8
		RETURNING token_hash, user_id, device_id, tab_id, device_name, COALESCE(track_id, 0), state, expires_at, last_seen_at, created_at
	`,
		heartbeat.TokenHash,
		heartbeat.UserID,
		strings.TrimSpace(heartbeat.DeviceID),
		strings.TrimSpace(heartbeat.TabID),
		nullableInt64(heartbeat.TrackID),
		NormalizePlaybackState(heartbeat.State),
		heartbeat.ExpiresAt,
		heartbeat.Now,
	)
	return scanPlaybackSessionRecord(row)
}

func (s *Store) TouchPlaybackSession(ctx context.Context, tokenHash string, userID int64, now time.Time, expiresAt time.Time) (PlaybackSessionRecord, error) {
	row := s.pool.QueryRow(ctx, `
		UPDATE playback_sessions
		SET expires_at = $4,
			last_seen_at = $3,
			updated_at = $3
		WHERE token_hash = $1
			AND user_id = $2
			AND revoked_at IS NULL
			AND expires_at > $3
		RETURNING token_hash, user_id, device_id, tab_id, device_name, COALESCE(track_id, 0), state, expires_at, last_seen_at, created_at
	`, tokenHash, userID, now, expiresAt)
	return scanPlaybackSessionRecord(row)
}

func (s *Store) ReleasePlaybackSession(ctx context.Context, tokenHash string, userID int64, reason string, now time.Time) (PlaybackSessionRecord, error) {
	reason = strings.TrimSpace(reason)
	if reason == "" {
		reason = "released"
	}
	row := s.pool.QueryRow(ctx, `
		UPDATE playback_sessions
		SET revoked_at = $3,
			revoked_reason = $4,
			updated_at = $3
		WHERE token_hash = $1
			AND user_id = $2
			AND revoked_at IS NULL
		RETURNING token_hash, user_id, device_id, tab_id, device_name, COALESCE(track_id, 0), state, expires_at, last_seen_at, created_at
	`, tokenHash, userID, now, reason)
	return scanPlaybackSessionRecord(row)
}

func (s *Store) RevokePlaybackSessionsForAuthSession(ctx context.Context, authSessionTokenHash string, now time.Time, reason string) error {
	authSessionTokenHash = strings.TrimSpace(authSessionTokenHash)
	if authSessionTokenHash == "" {
		return nil
	}
	reason = strings.TrimSpace(reason)
	if reason == "" {
		reason = "auth_session_ended"
	}
	_, err := s.pool.Exec(ctx, `
		UPDATE playback_sessions
		SET revoked_at = $2,
			revoked_reason = $3,
			updated_at = $2
		WHERE auth_session_token_hash = $1
			AND revoked_at IS NULL
	`, authSessionTokenHash, now, reason)
	return err
}

func NormalizePlaybackState(state string) string {
	switch strings.TrimSpace(strings.ToLower(state)) {
	case PlaybackStatePaused:
		return PlaybackStatePaused
	default:
		return PlaybackStatePlaying
	}
}

func scanPlaybackSessionRecord(row rowScanner) (PlaybackSessionRecord, error) {
	var record PlaybackSessionRecord
	err := row.Scan(
		&record.TokenHash,
		&record.UserID,
		&record.DeviceID,
		&record.TabID,
		&record.DeviceName,
		&record.TrackID,
		&record.State,
		&record.ExpiresAt,
		&record.LastSeenAt,
		&record.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return PlaybackSessionRecord{}, sql.ErrNoRows
	}
	return record, err
}
