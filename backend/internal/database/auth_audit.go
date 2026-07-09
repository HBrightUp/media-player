package database

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type AuthAuditEvent struct {
	EventType        string
	UserID           int64
	Phone            string
	SessionTokenHash string
	IPAddress        string
	UserAgent        string
	Success          bool
	FailureReason    string
	Metadata         map[string]any
}

type AuthSessionRecord struct {
	TokenHash  string
	UserID     int64
	Phone      string
	ExpiresAt  time.Time
	CreatedAt  time.Time
	LastSeenAt time.Time
	IPAddress  string
	UserAgent  string
}

func (s *Store) RecordAuthAuditLog(ctx context.Context, event AuthAuditEvent) error {
	metadata := event.Metadata
	if metadata == nil {
		metadata = map[string]any{}
	}
	metadataJSON, err := json.Marshal(metadata)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, `
		INSERT INTO auth_audit_logs (
			event_type,
			user_id,
			phone,
			session_token_hash,
			ip_address,
			user_agent,
			success,
			failure_reason,
			metadata
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`,
		event.EventType,
		nullableInt64(event.UserID),
		nullableString(event.Phone),
		nullableString(event.SessionTokenHash),
		nullableString(event.IPAddress),
		nullableString(event.UserAgent),
		event.Success,
		nullableString(event.FailureReason),
		metadataJSON,
	)
	return err
}

func (s *Store) TouchAuthSession(ctx context.Context, tokenHash string, now time.Time) (int64, error) {
	var userID int64
	err := s.pool.QueryRow(ctx, `
		UPDATE auth_sessions
		SET last_seen_at = $2,
			offline_recorded_at = NULL,
			updated_at = $2
		WHERE token_hash = $1
			AND expires_at > $2
			AND ended_at IS NULL
		RETURNING user_id
	`, tokenHash, now).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, sql.ErrNoRows
	}
	return userID, err
}

func (s *Store) EndAuthSession(ctx context.Context, tokenHash string, reason string, now time.Time) (AuthSessionRecord, error) {
	row := s.pool.QueryRow(ctx, `
		WITH ended AS (
			UPDATE auth_sessions
			SET ended_at = $2,
				ended_reason = $3,
				updated_at = $2
			WHERE token_hash = $1
				AND ended_at IS NULL
			RETURNING token_hash, user_id, expires_at, created_at, last_seen_at, ip_address, user_agent
		)
		SELECT
			e.token_hash,
			e.user_id,
			u.phone,
			e.expires_at,
			e.created_at,
			e.last_seen_at,
			COALESCE(e.ip_address, ''),
			COALESCE(e.user_agent, '')
		FROM ended e
		JOIN users u ON u.id = e.user_id
	`, tokenHash, now, reason)
	return scanAuthSessionRecord(row)
}

func (s *Store) MarkExpiredAuthSessions(ctx context.Context, now time.Time) ([]AuthSessionRecord, error) {
	rows, err := s.pool.Query(ctx, `
		WITH ended AS (
			UPDATE auth_sessions
			SET ended_at = $1,
				ended_reason = 'session_expired',
				updated_at = $1
			WHERE expires_at <= $1
				AND ended_at IS NULL
			RETURNING token_hash, user_id, expires_at, created_at, last_seen_at, ip_address, user_agent
		)
		SELECT
			e.token_hash,
			e.user_id,
			u.phone,
			e.expires_at,
			e.created_at,
			e.last_seen_at,
			COALESCE(e.ip_address, ''),
			COALESCE(e.user_agent, '')
		FROM ended e
		JOIN users u ON u.id = e.user_id
	`, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanAuthSessionRecords(rows)
}

func (s *Store) MarkOfflineTimedOutAuthSessions(ctx context.Context, cutoff time.Time, now time.Time) ([]AuthSessionRecord, error) {
	rows, err := s.pool.Query(ctx, `
		WITH offline AS (
			UPDATE auth_sessions
			SET offline_recorded_at = $2,
				updated_at = $2
			WHERE last_seen_at < $1
				AND expires_at > $2
				AND ended_at IS NULL
				AND offline_recorded_at IS NULL
			RETURNING token_hash, user_id, expires_at, created_at, last_seen_at, ip_address, user_agent
		)
		SELECT
			o.token_hash,
			o.user_id,
			u.phone,
			o.expires_at,
			o.created_at,
			o.last_seen_at,
			COALESCE(o.ip_address, ''),
			COALESCE(o.user_agent, '')
		FROM offline o
		JOIN users u ON u.id = o.user_id
	`, cutoff, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanAuthSessionRecords(rows)
}

func scanAuthSessionRecords(rows pgx.Rows) ([]AuthSessionRecord, error) {
	records := make([]AuthSessionRecord, 0)
	for rows.Next() {
		record, err := scanAuthSessionRecord(rows)
		if err != nil {
			return nil, err
		}
		records = append(records, record)
	}
	return records, rows.Err()
}

func scanAuthSessionRecord(row rowScanner) (AuthSessionRecord, error) {
	var record AuthSessionRecord
	err := row.Scan(
		&record.TokenHash,
		&record.UserID,
		&record.Phone,
		&record.ExpiresAt,
		&record.CreatedAt,
		&record.LastSeenAt,
		&record.IPAddress,
		&record.UserAgent,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return AuthSessionRecord{}, sql.ErrNoRows
	}
	return record, err
}

func nullableString(value string) any {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return value
}

func nullableInt64(value int64) any {
	if value <= 0 {
		return nil
	}
	return value
}
