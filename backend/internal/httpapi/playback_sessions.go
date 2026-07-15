package httpapi

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/hml/media-player/backend/internal/database"
	"github.com/hml/media-player/backend/internal/models"
	"github.com/jackc/pgx/v5"
)

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
	record, err := s.store.CreatePlaybackSession(r.Context(), database.PlaybackSessionCreate{
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
	writePlaybackSessionResponse(w, token, record)
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
	state := database.NormalizePlaybackState(request.State)
	ttl := playbackSessionTTL
	if state == database.PlaybackStatePaused {
		ttl = playbackPauseTTL
	}
	record, err := s.store.HeartbeatPlaybackSession(r.Context(), database.PlaybackSessionHeartbeat{
		TokenHash: hashAuthSessionToken(token),
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
	writePlaybackSessionResponse(w, token, record)
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
		_, err := s.store.ReleasePlaybackSession(r.Context(), hashAuthSessionToken(token), user.ID, "released", time.Now())
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusInternalServerError, "释放播放会话失败")
			return
		}
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
	_, err := s.store.TouchPlaybackSession(r.Context(), hashAuthSessionToken(token), userID, now, now.Add(playbackSessionTTL))
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
	if token != "" {
		return token
	}
	return strings.TrimSpace(r.URL.Query().Get("playback_token"))
}

func writePlaybackSessionResponse(w http.ResponseWriter, token string, record database.PlaybackSessionRecord) {
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":          true,
		"token":       token,
		"expires_at":  record.ExpiresAt.UTC().Format(time.RFC3339),
		"state":       record.State,
		"track_id":    record.TrackID,
		"device_id":   record.DeviceID,
		"tab_id":      record.TabID,
		"device_name": record.DeviceName,
	})
}
