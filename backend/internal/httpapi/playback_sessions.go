package httpapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/hml/media-player/backend/internal/database"
	"github.com/hml/media-player/backend/internal/models"
	"github.com/jackc/pgx/v5"
)

const (
	streamTicketTTL       = 12 * time.Hour
	streamTicketTokenSize = 32
)

type streamTicketGrant struct {
	UserID            int64
	PlaybackTokenHash string
	ExpiresAt         time.Time
}

type streamTicketManager struct {
	mu               sync.Mutex
	grants           map[string]streamTicketGrant
	tokensByPlayback map[string]string
	ttl              time.Duration
}

func newStreamTicketManager(ttl time.Duration) *streamTicketManager {
	return &streamTicketManager{
		grants:           make(map[string]streamTicketGrant),
		tokensByPlayback: make(map[string]string),
		ttl:              ttl,
	}
}

func (m *streamTicketManager) Grant(userID int64, playbackTokenHash string, now time.Time) (string, time.Time, error) {
	expiresAt := now.Add(m.ttl)
	m.mu.Lock()
	defer m.mu.Unlock()
	m.deleteExpiredLocked(now)
	if token := m.tokensByPlayback[playbackTokenHash]; token != "" {
		tokenHash := hashAuthSessionToken(token)
		if grant, ok := m.grants[tokenHash]; ok {
			grant.UserID = userID
			grant.ExpiresAt = expiresAt
			m.grants[tokenHash] = grant
			return token, expiresAt, nil
		}
		delete(m.tokensByPlayback, playbackTokenHash)
	}
	token, tokenHash, err := newAuthSessionToken(streamTicketTokenSize)
	if err != nil {
		return "", time.Time{}, err
	}
	m.grants[tokenHash] = streamTicketGrant{
		UserID:            userID,
		PlaybackTokenHash: playbackTokenHash,
		ExpiresAt:         expiresAt,
	}
	m.tokensByPlayback[playbackTokenHash] = token
	return token, expiresAt, nil
}

func (m *streamTicketManager) Validate(token string, now time.Time) (streamTicketGrant, bool) {
	token = strings.TrimSpace(token)
	if token == "" {
		return streamTicketGrant{}, false
	}
	tokenHash := hashAuthSessionToken(token)
	m.mu.Lock()
	defer m.mu.Unlock()
	grant, ok := m.grants[tokenHash]
	if !ok {
		return streamTicketGrant{}, false
	}
	if !now.Before(grant.ExpiresAt) {
		delete(m.grants, tokenHash)
		if currentToken := m.tokensByPlayback[grant.PlaybackTokenHash]; currentToken != "" && hashAuthSessionToken(currentToken) == tokenHash {
			delete(m.tokensByPlayback, grant.PlaybackTokenHash)
		}
		return streamTicketGrant{}, false
	}
	return grant, true
}

func (m *streamTicketManager) RevokePlayback(playbackTokenHash string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for tokenHash, grant := range m.grants {
		if grant.PlaybackTokenHash == playbackTokenHash {
			delete(m.grants, tokenHash)
		}
	}
	delete(m.tokensByPlayback, playbackTokenHash)
}

func (m *streamTicketManager) deleteExpiredLocked(now time.Time) {
	for tokenHash, grant := range m.grants {
		if !now.Before(grant.ExpiresAt) {
			delete(m.grants, tokenHash)
			if token := m.tokensByPlayback[grant.PlaybackTokenHash]; token != "" && hashAuthSessionToken(token) == tokenHash {
				delete(m.tokensByPlayback, grant.PlaybackTokenHash)
			}
		}
	}
}

type playbackSessionRequest struct {
	TrackID    int64  `json:"track_id"`
	DeviceID   string `json:"device_id"`
	TabID      string `json:"tab_id"`
	DeviceName string `json:"device_name"`
}

type playbackHeartbeatRequest struct {
	Token    string `json:"token"`
	TrackID  int64  `json:"track_id"`
	DeviceID string `json:"device_id"`
	TabID    string `json:"tab_id"`
	State    string `json:"state"`
}

type playbackReleaseRequest struct {
	Token string `json:"token"`
}

func (s *Server) handlePlaybackSession(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	user, ok := s.requireSessionUser(w, r, "请先登录后播放音乐")
	if !ok {
		return
	}

	var request playbackSessionRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	deviceID, tabID, deviceName, ok := validatePlaybackClient(w, request.DeviceID, request.TabID, request.DeviceName)
	if !ok {
		return
	}
	track, ok := s.requirePlayableTrack(w, r, user, request.TrackID)
	if !ok {
		return
	}

	now := time.Now()
	token, tokenHash, err := newAuthSessionToken(playbackSessionTokenSize)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "生成播放会话失败")
		return
	}
	record, err := s.createPlaybackSession(r.Context(), database.PlaybackSessionCreate{
		TokenHash:            tokenHash,
		UserID:               user.ID,
		AuthSessionTokenHash: hashAuthSessionToken(authSessionToken(r)),
		DeviceID:             deviceID,
		TabID:                tabID,
		DeviceName:           deviceName,
		TrackID:              track.ID,
		State:                database.PlaybackStatePlaying,
		Now:                  now,
		ExpiresAt:            now.Add(playbackSessionTTL),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "申请播放权失败")
		return
	}
	streamTicket, streamTicketExpiresAt, err := s.grantStreamTicket(r.Context(), user.ID, tokenHash, now)
	if err != nil {
		_, _ = s.releasePlaybackSession(r.Context(), tokenHash, user.ID, "stream_ticket_failed", time.Now())
		writeError(w, http.StatusInternalServerError, "生成播放链接失败")
		return
	}
	writePlaybackSessionResponse(w, token, record, streamTicket, streamTicketExpiresAt)
}

func (s *Server) handlePlaybackHeartbeat(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	user, ok := s.requireSessionUser(w, r, "请先登录后续期播放会话")
	if !ok {
		return
	}

	var request playbackHeartbeatRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	token := strings.TrimSpace(request.Token)
	if token == "" {
		writeError(w, http.StatusBadRequest, "播放会话已失效，请重新播放")
		return
	}
	deviceID, tabID, _, ok := validatePlaybackClient(w, request.DeviceID, request.TabID, "")
	if !ok {
		return
	}
	if request.TrackID > 0 {
		if _, ok := s.requirePlayableTrack(w, r, user, request.TrackID); !ok {
			return
		}
	}

	now := time.Now()
	tokenHash := hashAuthSessionToken(token)
	state := database.NormalizePlaybackState(request.State)
	ttl := playbackSessionTTL
	if state == database.PlaybackStatePaused {
		ttl = playbackPauseTTL
	}
	record, err := s.heartbeatPlaybackSession(r.Context(), database.PlaybackSessionHeartbeat{
		TokenHash: tokenHash,
		UserID:    user.ID,
		DeviceID:  deviceID,
		TabID:     tabID,
		TrackID:   request.TrackID,
		State:     state,
		Now:       now,
		ExpiresAt: now.Add(ttl),
	})
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusConflict, "音乐已在其它设备或页面播放")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "续期播放会话失败")
		return
	}
	streamTicket, streamTicketExpiresAt, err := s.grantStreamTicket(r.Context(), user.ID, tokenHash, now)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "生成播放链接失败")
		return
	}
	writePlaybackSessionResponse(w, token, record, streamTicket, streamTicketExpiresAt)
}

func (s *Server) handlePlaybackRelease(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	user, ok := s.requireSessionUser(w, r, "请先登录后释放播放会话")
	if !ok {
		return
	}

	var request playbackReleaseRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	token := strings.TrimSpace(request.Token)
	if token != "" {
		tokenHash := hashAuthSessionToken(token)
		_, err := s.releasePlaybackSession(r.Context(), tokenHash, user.ID, "released", time.Now())
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusInternalServerError, "释放播放会话失败")
			return
		}
		_ = s.revokeStreamTicket(r.Context(), tokenHash)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok": true,
	})
}

func (s *Server) requirePlaybackSessionForStream(w http.ResponseWriter, r *http.Request, userID int64) bool {
	token := playbackSessionToken(r)
	if token == "" {
		writeError(w, http.StatusConflict, "请重新点击播放以获取播放权")
		return false
	}
	now := time.Now()
	_, err := s.touchPlaybackSession(r.Context(), hashAuthSessionToken(token), userID, now, now.Add(playbackSessionTTL))
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusConflict, "音乐已在其它设备或页面播放")
		return false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "校验播放会话失败")
		return false
	}
	return true
}

func (s *Server) createPlaybackSession(ctx context.Context, create database.PlaybackSessionCreate) (database.PlaybackSessionRecord, error) {
	if s.redisRuntime != nil {
		return s.redisRuntime.CreatePlaybackSession(ctx, create)
	}
	return s.store.CreatePlaybackSession(ctx, create)
}

func (s *Server) heartbeatPlaybackSession(ctx context.Context, heartbeat database.PlaybackSessionHeartbeat) (database.PlaybackSessionRecord, error) {
	if s.redisRuntime != nil {
		return s.redisRuntime.HeartbeatPlaybackSession(ctx, heartbeat)
	}
	return s.store.HeartbeatPlaybackSession(ctx, heartbeat)
}

func (s *Server) touchPlaybackSession(ctx context.Context, tokenHash string, userID int64, now time.Time, expiresAt time.Time) (database.PlaybackSessionRecord, error) {
	if s.redisRuntime != nil {
		return s.redisRuntime.TouchPlaybackSession(ctx, tokenHash, userID, now, expiresAt)
	}
	return s.store.TouchPlaybackSession(ctx, tokenHash, userID, now, expiresAt)
}

func (s *Server) releasePlaybackSession(ctx context.Context, tokenHash string, userID int64, reason string, now time.Time) (database.PlaybackSessionRecord, error) {
	if s.redisRuntime != nil {
		return s.redisRuntime.ReleasePlaybackSession(ctx, tokenHash, userID)
	}
	return s.store.ReleasePlaybackSession(ctx, tokenHash, userID, reason, now)
}

func (s *Server) revokePlaybackSessionsForAuthSession(ctx context.Context, authSessionTokenHash string, now time.Time, reason string) error {
	if s.redisRuntime != nil {
		return s.redisRuntime.RevokePlaybackSessionsForAuthSession(ctx, authSessionTokenHash)
	}
	return s.store.RevokePlaybackSessionsForAuthSession(ctx, authSessionTokenHash, now, reason)
}

func (s *Server) grantStreamTicket(ctx context.Context, userID int64, playbackTokenHash string, now time.Time) (string, time.Time, error) {
	if s.redisRuntime != nil {
		return s.redisRuntime.GrantStreamTicket(ctx, userID, playbackTokenHash, now)
	}
	return s.streamTickets.Grant(userID, playbackTokenHash, now)
}

func (s *Server) validateStreamTicket(ctx context.Context, token string, now time.Time) (streamTicketGrant, bool, error) {
	if s.redisRuntime != nil {
		return s.redisRuntime.ValidateStreamTicket(ctx, token, now)
	}
	grant, ok := s.streamTickets.Validate(token, now)
	return grant, ok, nil
}

func (s *Server) revokeStreamTicket(ctx context.Context, playbackTokenHash string) error {
	if s.redisRuntime != nil {
		return s.redisRuntime.RevokeStreamTicket(ctx, playbackTokenHash)
	}
	s.streamTickets.RevokePlayback(playbackTokenHash)
	return nil
}

func (s *Server) requirePlayableTrack(w http.ResponseWriter, r *http.Request, user models.User, trackID int64) (models.Track, bool) {
	if trackID <= 0 {
		writeError(w, http.StatusBadRequest, "歌曲标识不正确")
		return models.Track{}, false
	}
	track, err := s.store.GetTrack(r.Context(), trackID)
	if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "歌曲不存在")
		return models.Track{}, false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "读取歌曲失败")
		return models.Track{}, false
	}
	if !userCanAccessTrack(user, track) {
		writeError(w, http.StatusForbidden, "当前用户无权播放高品质")
		return models.Track{}, false
	}
	return track, true
}

func validatePlaybackClient(w http.ResponseWriter, deviceID string, tabID string, deviceName string) (string, string, string, bool) {
	deviceID = strings.TrimSpace(deviceID)
	tabID = strings.TrimSpace(tabID)
	deviceName = strings.TrimSpace(deviceName)
	if deviceID == "" || len(deviceID) > 128 {
		writeError(w, http.StatusBadRequest, "设备标识不正确")
		return "", "", "", false
	}
	if tabID == "" || len(tabID) > 128 {
		writeError(w, http.StatusBadRequest, "页面标识不正确")
		return "", "", "", false
	}
	if runes := []rune(deviceName); len(runes) > 128 {
		deviceName = string(runes[:128])
	}
	return deviceID, tabID, deviceName, true
}

func playbackSessionToken(r *http.Request) string {
	token := strings.TrimSpace(r.Header.Get("X-Playback-Session-Token"))
	return token
}

func writePlaybackSessionResponse(w http.ResponseWriter, token string, record database.PlaybackSessionRecord, streamTicket string, streamTicketExpiresAt time.Time) {
	w.Header().Set("Cache-Control", "no-store")
	payload := map[string]any{
		"ok":          true,
		"token":       token,
		"expires_at":  record.ExpiresAt.UTC().Format(time.RFC3339),
		"state":       record.State,
		"track_id":    record.TrackID,
		"device_id":   record.DeviceID,
		"tab_id":      record.TabID,
		"device_name": record.DeviceName,
	}
	if streamTicket != "" {
		payload["stream_ticket"] = streamTicket
		payload["stream_ticket_expires_at"] = streamTicketExpiresAt.UTC().Format(time.RFC3339)
	}
	writeJSON(w, http.StatusOK, payload)
}
