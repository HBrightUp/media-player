package httpapi

import (
	"context"
	"database/sql"
	"strconv"
	"strings"
	"time"

	"github.com/hml/media-player/backend/internal/database"
	"github.com/redis/go-redis/v9"
)

type redisRuntimeStore struct {
	client    *redis.Client
	keyPrefix string
}

func newRedisRuntimeStore(client *redis.Client, keyPrefix string) *redisRuntimeStore {
	return &redisRuntimeStore{
		client:    client,
		keyPrefix: normalizeRedisKeyPrefix(keyPrefix),
	}
}

func normalizeRedisKeyPrefix(keyPrefix string) string {
	keyPrefix = strings.Trim(strings.TrimSpace(keyPrefix), ":")
	if keyPrefix == "" {
		return "media-player"
	}
	return keyPrefix
}

func (s *redisRuntimeStore) key(parts ...string) string {
	return s.keyPrefix + ":" + strings.Join(parts, ":")
}

func (s *redisRuntimeStore) authSessionKey(tokenHash string) string {
	return s.key("auth", "session", tokenHash)
}

func (s *redisRuntimeStore) playbackSessionKey(tokenHash string) string {
	return s.key("playback", "session", tokenHash)
}

func (s *redisRuntimeStore) playbackActiveUserKey(userID int64) string {
	return s.key("playback", "active-user", strconv.FormatInt(userID, 10))
}

func (s *redisRuntimeStore) playbackAuthSessionKey(authSessionTokenHash string) string {
	return s.key("playback", "auth-session", authSessionTokenHash)
}

func (s *redisRuntimeStore) streamTicketKey(ticketHash string) string {
	return s.key("stream", "ticket", ticketHash)
}

func (s *redisRuntimeStore) streamTicketByPlaybackKey(playbackTokenHash string) string {
	return s.key("stream", "ticket-by-playback", playbackTokenHash)
}

func redisTTL(now time.Time, expiresAt time.Time) time.Duration {
	ttl := expiresAt.Sub(now)
	if ttl < time.Second {
		return time.Second
	}
	return ttl
}

func redisUnixMilli(value time.Time) string {
	return strconv.FormatInt(value.UTC().UnixMilli(), 10)
}

func redisTimeFromMilli(value string) (time.Time, error) {
	millis, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
	if err != nil {
		return time.Time{}, err
	}
	return time.UnixMilli(millis).UTC(), nil
}

func (s *redisRuntimeStore) CreateAuthSession(ctx context.Context, userID int64, phone string, tokenHash string, now time.Time, expiresAt time.Time, ipAddress string, userAgent string) error {
	tokenHash = strings.TrimSpace(tokenHash)
	if tokenHash == "" || userID <= 0 {
		return sql.ErrNoRows
	}

	record := database.AuthSessionRecord{
		TokenHash:  tokenHash,
		UserID:     userID,
		Phone:      strings.TrimSpace(phone),
		ExpiresAt:  expiresAt.UTC(),
		CreatedAt:  now.UTC(),
		LastSeenAt: now.UTC(),
		IPAddress:  strings.TrimSpace(ipAddress),
		UserAgent:  strings.TrimSpace(userAgent),
	}
	fields := map[string]any{
		"token_hash":   record.TokenHash,
		"user_id":      strconv.FormatInt(record.UserID, 10),
		"phone":        record.Phone,
		"expires_at":   redisUnixMilli(record.ExpiresAt),
		"created_at":   redisUnixMilli(record.CreatedAt),
		"last_seen_at": redisUnixMilli(record.LastSeenAt),
		"ip_address":   record.IPAddress,
		"user_agent":   record.UserAgent,
	}
	ttl := redisTTL(now, expiresAt)
	pipe := s.client.Pipeline()
	pipe.HSet(ctx, s.authSessionKey(tokenHash), fields)
	pipe.Expire(ctx, s.authSessionKey(tokenHash), ttl)
	_, err := pipe.Exec(ctx)
	return err
}

func (s *redisRuntimeStore) TouchAuthSession(ctx context.Context, tokenHash string, now time.Time) (int64, error) {
	tokenHash = strings.TrimSpace(tokenHash)
	if tokenHash == "" {
		return 0, sql.ErrNoRows
	}
	fields, err := s.client.HGetAll(ctx, s.authSessionKey(tokenHash)).Result()
	if err != nil {
		return 0, err
	}
	if len(fields) == 0 {
		return 0, sql.ErrNoRows
	}
	record, err := redisAuthSessionRecord(fields)
	if err != nil {
		_ = s.client.Del(ctx, s.authSessionKey(tokenHash)).Err()
		return 0, sql.ErrNoRows
	}
	if !now.Before(record.ExpiresAt) {
		_ = s.client.Del(ctx, s.authSessionKey(tokenHash)).Err()
		return 0, sql.ErrNoRows
	}

	pipe := s.client.Pipeline()
	pipe.HSet(ctx, s.authSessionKey(tokenHash), "last_seen_at", redisUnixMilli(now))
	pipe.Expire(ctx, s.authSessionKey(tokenHash), redisTTL(now, record.ExpiresAt))
	if _, err := pipe.Exec(ctx); err != nil {
		return 0, err
	}
	return record.UserID, nil
}

func (s *redisRuntimeStore) EndAuthSession(ctx context.Context, tokenHash string, now time.Time) (database.AuthSessionRecord, error) {
	tokenHash = strings.TrimSpace(tokenHash)
	if tokenHash == "" {
		return database.AuthSessionRecord{}, sql.ErrNoRows
	}
	fields, err := s.client.HGetAll(ctx, s.authSessionKey(tokenHash)).Result()
	if err != nil {
		return database.AuthSessionRecord{}, err
	}
	if len(fields) == 0 {
		return database.AuthSessionRecord{}, sql.ErrNoRows
	}
	record, err := redisAuthSessionRecord(fields)
	if err != nil {
		_ = s.client.Del(ctx, s.authSessionKey(tokenHash)).Err()
		return database.AuthSessionRecord{}, sql.ErrNoRows
	}
	record.LastSeenAt = now.UTC()
	if err := s.client.Del(ctx, s.authSessionKey(tokenHash)).Err(); err != nil {
		return database.AuthSessionRecord{}, err
	}
	return record, nil
}

func (s *redisRuntimeStore) AuthSessionLastSeenByUser(ctx context.Context, now time.Time) (map[int64]time.Time, error) {
	lastSeenByUser := make(map[int64]time.Time)
	var cursor uint64
	for {
		keys, nextCursor, err := s.client.Scan(ctx, cursor, s.authSessionKey("*"), 100).Result()
		if err != nil {
			return nil, err
		}
		for _, key := range keys {
			fields, err := s.client.HGetAll(ctx, key).Result()
			if err != nil {
				return nil, err
			}
			if len(fields) == 0 {
				continue
			}
			record, err := redisAuthSessionRecord(fields)
			if err != nil || !now.Before(record.ExpiresAt) {
				continue
			}
			if previous, ok := lastSeenByUser[record.UserID]; !ok || record.LastSeenAt.After(previous) {
				lastSeenByUser[record.UserID] = record.LastSeenAt
			}
		}
		if nextCursor == 0 {
			break
		}
		cursor = nextCursor
	}
	return lastSeenByUser, nil
}

func redisAuthSessionRecord(fields map[string]string) (database.AuthSessionRecord, error) {
	userID, err := strconv.ParseInt(defaultString(fields["user_id"], "0"), 10, 64)
	if err != nil {
		return database.AuthSessionRecord{}, err
	}
	expiresAt, err := redisTimeFromMilli(fields["expires_at"])
	if err != nil {
		return database.AuthSessionRecord{}, err
	}
	createdAt, err := redisTimeFromMilli(defaultString(fields["created_at"], fields["last_seen_at"]))
	if err != nil {
		return database.AuthSessionRecord{}, err
	}
	lastSeenAt, err := redisTimeFromMilli(defaultString(fields["last_seen_at"], fields["created_at"]))
	if err != nil {
		return database.AuthSessionRecord{}, err
	}
	return database.AuthSessionRecord{
		TokenHash:  strings.TrimSpace(fields["token_hash"]),
		UserID:     userID,
		Phone:      strings.TrimSpace(fields["phone"]),
		ExpiresAt:  expiresAt,
		CreatedAt:  createdAt,
		LastSeenAt: lastSeenAt,
		IPAddress:  strings.TrimSpace(fields["ip_address"]),
		UserAgent:  strings.TrimSpace(fields["user_agent"]),
	}, nil
}

func (s *redisRuntimeStore) CreatePlaybackSession(ctx context.Context, create database.PlaybackSessionCreate) (database.PlaybackSessionRecord, error) {
	tokenHash := strings.TrimSpace(create.TokenHash)
	if tokenHash == "" {
		return database.PlaybackSessionRecord{}, sql.ErrNoRows
	}
	userID := create.UserID
	activeKey := s.playbackActiveUserKey(userID)
	if previousTokenHash, err := s.client.Get(ctx, activeKey).Result(); err == nil && previousTokenHash != "" && previousTokenHash != tokenHash {
		_ = s.deletePlaybackSession(ctx, strings.TrimSpace(previousTokenHash))
	} else if err != nil && err != redis.Nil {
		return database.PlaybackSessionRecord{}, err
	}

	record := database.PlaybackSessionRecord{
		TokenHash:  tokenHash,
		UserID:     userID,
		DeviceID:   strings.TrimSpace(create.DeviceID),
		TabID:      strings.TrimSpace(create.TabID),
		DeviceName: strings.TrimSpace(create.DeviceName),
		TrackID:    create.TrackID,
		State:      database.NormalizePlaybackState(create.State),
		ExpiresAt:  create.ExpiresAt.UTC(),
		LastSeenAt: create.Now.UTC(),
		CreatedAt:  create.Now.UTC(),
	}

	fields := map[string]any{
		"token_hash":              record.TokenHash,
		"user_id":                 strconv.FormatInt(record.UserID, 10),
		"auth_session_token_hash": strings.TrimSpace(create.AuthSessionTokenHash),
		"device_id":               record.DeviceID,
		"tab_id":                  record.TabID,
		"device_name":             record.DeviceName,
		"track_id":                strconv.FormatInt(record.TrackID, 10),
		"state":                   record.State,
		"expires_at":              redisUnixMilli(record.ExpiresAt),
		"last_seen_at":            redisUnixMilli(record.LastSeenAt),
		"created_at":              redisUnixMilli(record.CreatedAt),
	}

	ttl := redisTTL(create.Now, create.ExpiresAt)
	pipe := s.client.Pipeline()
	pipe.HSet(ctx, s.playbackSessionKey(tokenHash), fields)
	pipe.Expire(ctx, s.playbackSessionKey(tokenHash), ttl)
	pipe.Set(ctx, activeKey, tokenHash, ttl)
	if authSessionTokenHash := strings.TrimSpace(create.AuthSessionTokenHash); authSessionTokenHash != "" {
		authKey := s.playbackAuthSessionKey(authSessionTokenHash)
		pipe.SAdd(ctx, authKey, tokenHash)
		pipe.Expire(ctx, authKey, authSessionTTL)
	}
	if _, err := pipe.Exec(ctx); err != nil {
		return database.PlaybackSessionRecord{}, err
	}
	return record, nil
}

func (s *redisRuntimeStore) HeartbeatPlaybackSession(ctx context.Context, heartbeat database.PlaybackSessionHeartbeat) (database.PlaybackSessionRecord, error) {
	tokenHash := strings.TrimSpace(heartbeat.TokenHash)
	record, err := s.getPlaybackSessionRecord(ctx, tokenHash)
	if err != nil {
		return database.PlaybackSessionRecord{}, err
	}
	if record.UserID != heartbeat.UserID || record.DeviceID != strings.TrimSpace(heartbeat.DeviceID) || record.TabID != strings.TrimSpace(heartbeat.TabID) {
		return database.PlaybackSessionRecord{}, sql.ErrNoRows
	}
	if ok, err := s.isActivePlaybackSession(ctx, record.UserID, tokenHash); err != nil {
		return database.PlaybackSessionRecord{}, err
	} else if !ok {
		return database.PlaybackSessionRecord{}, sql.ErrNoRows
	}

	if heartbeat.TrackID > 0 {
		record.TrackID = heartbeat.TrackID
	}
	record.State = database.NormalizePlaybackState(heartbeat.State)
	record.ExpiresAt = heartbeat.ExpiresAt.UTC()
	record.LastSeenAt = heartbeat.Now.UTC()
	ttl := redisTTL(heartbeat.Now, heartbeat.ExpiresAt)

	pipe := s.client.Pipeline()
	pipe.HSet(ctx, s.playbackSessionKey(tokenHash), map[string]any{
		"track_id":     strconv.FormatInt(record.TrackID, 10),
		"state":        record.State,
		"expires_at":   redisUnixMilli(record.ExpiresAt),
		"last_seen_at": redisUnixMilli(record.LastSeenAt),
	})
	pipe.Expire(ctx, s.playbackSessionKey(tokenHash), ttl)
	pipe.Set(ctx, s.playbackActiveUserKey(record.UserID), tokenHash, ttl)
	if _, err := pipe.Exec(ctx); err != nil {
		return database.PlaybackSessionRecord{}, err
	}
	return record, nil
}

func (s *redisRuntimeStore) TouchPlaybackSession(ctx context.Context, tokenHash string, userID int64, now time.Time, expiresAt time.Time) (database.PlaybackSessionRecord, error) {
	tokenHash = strings.TrimSpace(tokenHash)
	record, err := s.getPlaybackSessionRecord(ctx, tokenHash)
	if err != nil {
		return database.PlaybackSessionRecord{}, err
	}
	if record.UserID != userID {
		return database.PlaybackSessionRecord{}, sql.ErrNoRows
	}
	if ok, err := s.isActivePlaybackSession(ctx, record.UserID, tokenHash); err != nil {
		return database.PlaybackSessionRecord{}, err
	} else if !ok {
		return database.PlaybackSessionRecord{}, sql.ErrNoRows
	}

	record.ExpiresAt = expiresAt.UTC()
	record.LastSeenAt = now.UTC()
	ttl := redisTTL(now, expiresAt)
	pipe := s.client.Pipeline()
	pipe.HSet(ctx, s.playbackSessionKey(tokenHash), map[string]any{
		"expires_at":   redisUnixMilli(record.ExpiresAt),
		"last_seen_at": redisUnixMilli(record.LastSeenAt),
	})
	pipe.Expire(ctx, s.playbackSessionKey(tokenHash), ttl)
	pipe.Set(ctx, s.playbackActiveUserKey(record.UserID), tokenHash, ttl)
	if _, err := pipe.Exec(ctx); err != nil {
		return database.PlaybackSessionRecord{}, err
	}
	return record, nil
}

func (s *redisRuntimeStore) ReleasePlaybackSession(ctx context.Context, tokenHash string, userID int64) (database.PlaybackSessionRecord, error) {
	tokenHash = strings.TrimSpace(tokenHash)
	record, err := s.getPlaybackSessionRecord(ctx, tokenHash)
	if err != nil {
		return database.PlaybackSessionRecord{}, err
	}
	if record.UserID != userID {
		return database.PlaybackSessionRecord{}, sql.ErrNoRows
	}
	if err := s.deletePlaybackSession(ctx, tokenHash); err != nil {
		return database.PlaybackSessionRecord{}, err
	}
	return record, nil
}

func (s *redisRuntimeStore) RevokePlaybackSessionsForAuthSession(ctx context.Context, authSessionTokenHash string) error {
	authSessionTokenHash = strings.TrimSpace(authSessionTokenHash)
	if authSessionTokenHash == "" {
		return nil
	}
	authKey := s.playbackAuthSessionKey(authSessionTokenHash)
	tokenHashes, err := s.client.SMembers(ctx, authKey).Result()
	if err != nil && err != redis.Nil {
		return err
	}
	for _, tokenHash := range tokenHashes {
		if err := s.deletePlaybackSession(ctx, strings.TrimSpace(tokenHash)); err != nil {
			return err
		}
	}
	return s.client.Del(ctx, authKey).Err()
}

func (s *redisRuntimeStore) isActivePlaybackSession(ctx context.Context, userID int64, tokenHash string) (bool, error) {
	activeTokenHash, err := s.client.Get(ctx, s.playbackActiveUserKey(userID)).Result()
	if err == redis.Nil {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return strings.TrimSpace(activeTokenHash) == strings.TrimSpace(tokenHash), nil
}

func (s *redisRuntimeStore) deletePlaybackSession(ctx context.Context, tokenHash string) error {
	if tokenHash == "" {
		return nil
	}
	record, err := s.getPlaybackSessionRecord(ctx, tokenHash)
	if err != nil && !errorsIsNoRows(err) {
		return err
	}
	if err := s.RevokeStreamTicket(ctx, tokenHash); err != nil {
		return err
	}
	pipe := s.client.Pipeline()
	pipe.Del(ctx, s.playbackSessionKey(tokenHash))
	if err == nil {
		if activeTokenHash, getErr := s.client.Get(ctx, s.playbackActiveUserKey(record.UserID)).Result(); getErr == nil && strings.TrimSpace(activeTokenHash) == tokenHash {
			pipe.Del(ctx, s.playbackActiveUserKey(record.UserID))
		} else if getErr != nil && getErr != redis.Nil {
			return getErr
		}
	}
	_, execErr := pipe.Exec(ctx)
	return execErr
}

func (s *redisRuntimeStore) getPlaybackSessionRecord(ctx context.Context, tokenHash string) (database.PlaybackSessionRecord, error) {
	tokenHash = strings.TrimSpace(tokenHash)
	if tokenHash == "" {
		return database.PlaybackSessionRecord{}, sql.ErrNoRows
	}
	fields, err := s.client.HGetAll(ctx, s.playbackSessionKey(tokenHash)).Result()
	if err != nil {
		return database.PlaybackSessionRecord{}, err
	}
	if len(fields) == 0 {
		return database.PlaybackSessionRecord{}, sql.ErrNoRows
	}
	return redisPlaybackSessionRecord(fields)
}

func redisPlaybackSessionRecord(fields map[string]string) (database.PlaybackSessionRecord, error) {
	userID, err := strconv.ParseInt(fields["user_id"], 10, 64)
	if err != nil {
		return database.PlaybackSessionRecord{}, err
	}
	trackID, err := strconv.ParseInt(defaultString(fields["track_id"], "0"), 10, 64)
	if err != nil {
		return database.PlaybackSessionRecord{}, err
	}
	expiresAt, err := redisTimeFromMilli(fields["expires_at"])
	if err != nil {
		return database.PlaybackSessionRecord{}, err
	}
	lastSeenAt, err := redisTimeFromMilli(fields["last_seen_at"])
	if err != nil {
		return database.PlaybackSessionRecord{}, err
	}
	createdAt, err := redisTimeFromMilli(defaultString(fields["created_at"], fields["last_seen_at"]))
	if err != nil {
		return database.PlaybackSessionRecord{}, err
	}
	return database.PlaybackSessionRecord{
		TokenHash:  strings.TrimSpace(fields["token_hash"]),
		UserID:     userID,
		DeviceID:   strings.TrimSpace(fields["device_id"]),
		TabID:      strings.TrimSpace(fields["tab_id"]),
		DeviceName: strings.TrimSpace(fields["device_name"]),
		TrackID:    trackID,
		State:      database.NormalizePlaybackState(fields["state"]),
		ExpiresAt:  expiresAt,
		LastSeenAt: lastSeenAt,
		CreatedAt:  createdAt,
	}, nil
}

func (s *redisRuntimeStore) GrantStreamTicket(ctx context.Context, userID int64, playbackTokenHash string, now time.Time) (string, time.Time, error) {
	playbackTokenHash = strings.TrimSpace(playbackTokenHash)
	expiresAt := now.Add(streamTicketTTL)
	if playbackTokenHash == "" {
		return "", time.Time{}, sql.ErrNoRows
	}

	byPlaybackKey := s.streamTicketByPlaybackKey(playbackTokenHash)
	existingToken, err := s.client.Get(ctx, byPlaybackKey).Result()
	if err == nil && strings.TrimSpace(existingToken) != "" {
		ticketHash := hashAuthSessionToken(existingToken)
		if exists, existsErr := s.client.Exists(ctx, s.streamTicketKey(ticketHash)).Result(); existsErr != nil {
			return "", time.Time{}, existsErr
		} else if exists > 0 {
			if err := s.setStreamTicket(ctx, existingToken, ticketHash, userID, playbackTokenHash, now, expiresAt); err != nil {
				return "", time.Time{}, err
			}
			return existingToken, expiresAt, nil
		}
	} else if err != nil && err != redis.Nil {
		return "", time.Time{}, err
	}

	token, tokenHash, err := newAuthSessionToken(streamTicketTokenSize)
	if err != nil {
		return "", time.Time{}, err
	}
	if err := s.setStreamTicket(ctx, token, tokenHash, userID, playbackTokenHash, now, expiresAt); err != nil {
		return "", time.Time{}, err
	}
	return token, expiresAt, nil
}

func (s *redisRuntimeStore) setStreamTicket(ctx context.Context, token string, tokenHash string, userID int64, playbackTokenHash string, now time.Time, expiresAt time.Time) error {
	ttl := redisTTL(now, expiresAt)
	pipe := s.client.Pipeline()
	pipe.HSet(ctx, s.streamTicketKey(tokenHash), map[string]any{
		"user_id":             strconv.FormatInt(userID, 10),
		"playback_token_hash": playbackTokenHash,
		"expires_at":          redisUnixMilli(expiresAt),
	})
	pipe.Expire(ctx, s.streamTicketKey(tokenHash), ttl)
	pipe.Set(ctx, s.streamTicketByPlaybackKey(playbackTokenHash), token, ttl)
	_, err := pipe.Exec(ctx)
	return err
}

func (s *redisRuntimeStore) ValidateStreamTicket(ctx context.Context, token string, now time.Time) (streamTicketGrant, bool, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return streamTicketGrant{}, false, nil
	}
	tokenHash := hashAuthSessionToken(token)
	fields, err := s.client.HGetAll(ctx, s.streamTicketKey(tokenHash)).Result()
	if err != nil {
		return streamTicketGrant{}, false, err
	}
	if len(fields) == 0 {
		return streamTicketGrant{}, false, nil
	}
	expiresAt, err := redisTimeFromMilli(fields["expires_at"])
	if err != nil {
		_ = s.client.Del(ctx, s.streamTicketKey(tokenHash)).Err()
		return streamTicketGrant{}, false, nil
	}
	if !now.Before(expiresAt) {
		_ = s.client.Del(ctx, s.streamTicketKey(tokenHash), s.streamTicketByPlaybackKey(fields["playback_token_hash"])).Err()
		return streamTicketGrant{}, false, nil
	}
	userID, err := strconv.ParseInt(fields["user_id"], 10, 64)
	if err != nil {
		return streamTicketGrant{}, false, nil
	}
	playbackTokenHash := strings.TrimSpace(fields["playback_token_hash"])
	if playbackTokenHash == "" {
		return streamTicketGrant{}, false, nil
	}
	return streamTicketGrant{
		UserID:            userID,
		PlaybackTokenHash: playbackTokenHash,
		ExpiresAt:         expiresAt,
	}, true, nil
}

func (s *redisRuntimeStore) RevokeStreamTicket(ctx context.Context, playbackTokenHash string) error {
	playbackTokenHash = strings.TrimSpace(playbackTokenHash)
	if playbackTokenHash == "" {
		return nil
	}
	byPlaybackKey := s.streamTicketByPlaybackKey(playbackTokenHash)
	token, err := s.client.Get(ctx, byPlaybackKey).Result()
	if err != nil && err != redis.Nil {
		return err
	}
	keys := []string{byPlaybackKey}
	if strings.TrimSpace(token) != "" {
		keys = append(keys, s.streamTicketKey(hashAuthSessionToken(token)))
	}
	return s.client.Del(ctx, keys...).Err()
}

func defaultString(value string, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func errorsIsNoRows(err error) bool {
	return err == sql.ErrNoRows
}
