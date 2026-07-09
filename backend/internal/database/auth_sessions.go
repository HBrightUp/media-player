package database

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

func (s *Store) CreateAuthSession(ctx context.Context, userID int64, tokenHash string, expiresAt time.Time, ipAddress string, userAgent string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO auth_sessions (
			token_hash,
			user_id,
			expires_at,
			last_seen_at,
			ip_address,
			user_agent,
			updated_at
		)
		VALUES ($1, $2, $3, now(), $4, $5, now())
	`, tokenHash, userID, expiresAt, nullableString(ipAddress), nullableString(userAgent))
	return err
}

func (s *Store) GetAuthSessionUserID(ctx context.Context, tokenHash string, now time.Time) (int64, error) {
	var userID int64
	err := s.pool.QueryRow(ctx, `
		SELECT user_id
		FROM auth_sessions
		WHERE token_hash = $1
			AND expires_at > $2
			AND ended_at IS NULL
	`, tokenHash, now).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, sql.ErrNoRows
	}
	return userID, err
}
