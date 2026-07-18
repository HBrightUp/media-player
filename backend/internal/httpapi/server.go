package httpapi

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/hml/media-player/backend/internal/database"
	"github.com/hml/media-player/backend/internal/library"
	"github.com/hml/media-player/backend/internal/models"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const (
	musicDirectoryKey          = "music_directory"
	losslessMusicDirectoryKey  = "lossless_music_directory"
	losslessLyricsDirectoryKey = "lossless_lyrics_directory"
	lossyMusicDirectoryKey     = "lossy_music_directory"
	lossyLyricsDirectoryKey    = "lossy_lyrics_directory"
	sharedLyricsDirectoryKey   = "shared_lyrics_directory"
)
const (
	favoriteCategoryMaxRunes = 16
	passwordMinLength        = 6
	passwordMaxLength        = 64
	passwordHashRounds       = 100_000
	passwordHashLength       = 32
	loginMaxFails            = 8
	loginLockout             = 2 * time.Minute
	authSessionTTL           = 3 * 24 * time.Hour
	authSessionTokenSize     = 32
	authAuditSweepInterval   = 30 * time.Second
	presenceTTL              = 75 * time.Second
	manualTrackRefreshWindow = time.Minute
	audioFileAccessTTL       = time.Hour
	audioFileAccessMaxFails  = 5
	audioFileAccessLockout   = time.Minute
	audioFileAccessTokenSize = 32
	playbackSessionTTL       = 45 * time.Second
	playbackPauseTTL         = 5 * time.Minute
	playbackSessionTokenSize = 32
)

var mainlandPhonePattern = regexp.MustCompile(`^1[3-9]\d{9}$`)

type Server struct {
	store               *database.Store
	scanner             *library.Scanner
	corsOrigin          string
	presence            *presenceTracker
	loginFailures       *authFailureLimiter
	trackRefreshLimiter *manualRefreshLimiter
	audioFileAccess     *audioFileAccessManager
	streamTickets       *streamTicketManager
	authAuditSweeper    *authAuditSweeper
}

type setLibraryRequest struct {
	Path string `json:"path"`
}

type loginRequest struct {
	Phone    string `json:"phone"`
	Password string `json:"password"`
}

type favoriteRequest struct {
	UserID  int64 `json:"user_id"`
	TrackID int64 `json:"track_id"`
}

type favoriteCategoryRequest struct {
	UserID int64  `json:"user_id"`
	Name   string `json:"name"`
}

type favoriteCategoryTrackRequest struct {
	UserID  int64 `json:"user_id"`
	TrackID int64 `json:"track_id"`
}

type presenceRequest struct {
	SessionID string `json:"session_id"`
}

type presenceResponse struct {
	OnlineCount int                  `json:"online_count"`
	OnlineUsers []presenceOnlineUser `json:"online_users,omitempty"`
}

type presenceSession struct {
	UserID   int64
	Phone    string
	Nickname string
	LastSeen time.Time
}

type presenceSnapshot struct {
	OnlineCount int
	OnlineUsers []presenceOnlineUser
}

type presenceOnlineUser struct {
	UserID   int64  `json:"user_id,omitempty"`
	Nickname string `json:"nickname"`
}

type presenceTracker struct {
	mu       sync.Mutex
	sessions map[string]presenceSession
}

type authFailureLimiter struct {
	mu       sync.Mutex
	failures map[string]authFailure
}

type authFailure struct {
	Count       int
	LockedUntil time.Time
}

type authAuditSweeper struct {
	mu      sync.Mutex
	lastRun time.Time
}

type manualRefreshLimiter struct {
	mu        sync.Mutex
	lastByKey map[string]time.Time
}

type audioFileAccessManager struct {
	mu         sync.Mutex
	tokens     map[string]audioFileAccessGrant
	failures   map[int64]audioFileAccessFailure
	tokenBytes int
	ttl        time.Duration
}

type audioFileAccessGrant struct {
	UserID    int64
	ExpiresAt time.Time
}

type audioFileAccessFailure struct {
	Count       int
	LockedUntil time.Time
}

func New(store *database.Store, scanner *library.Scanner, corsOrigin string) *Server {
	return &Server{
		store:               store,
		scanner:             scanner,
		corsOrigin:          corsOrigin,
		presence:            newPresenceTracker(),
		loginFailures:       newAuthFailureLimiter(),
		trackRefreshLimiter: newManualRefreshLimiter(),
		audioFileAccess:     newAudioFileAccessManager(audioFileAccessTokenSize, audioFileAccessTTL),
		streamTickets:       newStreamTicketManager(streamTicketTTL),
		authAuditSweeper:    &authAuditSweeper{},
	}
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", s.handleHealth)
	mux.HandleFunc("/api/auth/register", s.handleRegister)
	mux.HandleFunc("/api/auth/login", s.handleLogin)
	mux.HandleFunc("/api/auth/me", s.handleAuthMe)
	mux.HandleFunc("/api/auth/logout", s.handleLogout)
	mux.HandleFunc("/api/admin/users", s.handleAdminUsers)
	mux.HandleFunc("/api/admin/users/", s.handleAdminUserRoute)
	mux.HandleFunc("/api/presence/heartbeat", s.handlePresenceHeartbeat)
	mux.HandleFunc("/api/presence/offline", s.handlePresenceOffline)
	mux.HandleFunc("/api/playback/session", s.handlePlaybackSession)
	mux.HandleFunc("/api/playback/heartbeat", s.handlePlaybackHeartbeat)
	mux.HandleFunc("/api/playback/release", s.handlePlaybackRelease)
	mux.HandleFunc("/api/settings/library", s.handleLibrarySetting)
	mux.HandleFunc("/api/library/scan", s.handleScan)
	mux.HandleFunc("/api/favorites", s.handleFavorites)
	mux.HandleFunc("/api/favorites/", s.handleFavoriteRoute)
	mux.HandleFunc("/api/favorite-categories", s.handleFavoriteCategories)
	mux.HandleFunc("/api/favorite-categories/", s.handleFavoriteCategoryRoute)
	mux.HandleFunc("/api/track-memberships", s.handleTrackMemberships)
	mux.HandleFunc("/api/audio-files/authorize", s.handleAudioFileAuthorize)
	mux.HandleFunc("/api/audio-files/import", s.handleAudioFileImport)
	mux.HandleFunc("/api/audio-files", s.handleAudioFiles)
	mux.HandleFunc("/api/audio-files/", s.handleAudioFileRoute)
	mux.HandleFunc("/api/note-folders", s.handleNoteFolders)
	mux.HandleFunc("/api/note-folders/", s.handleNoteFolderRoute)
	mux.HandleFunc("/api/notes", s.handleNotes)
	mux.HandleFunc("/api/notes/", s.handleNoteRoute)
	mux.HandleFunc("/api/tracks", s.handleTracks)
	mux.HandleFunc("/api/tracks/refresh", s.handleTrackRefresh)
	mux.HandleFunc("/api/tracks/", s.handleTrackRoute)
	return s.withCORS(mux)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":   true,
		"time": time.Now().UTC().Format(time.RFC3339),
	})
}

func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}

	writeError(w, http.StatusForbidden, "当前系统已关闭公开注册，请使用已有账号登录")
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}

	var request loginRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	phone, password, err := validateLoginRequest(request)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	clientIP := clientAddress(r)
	userAgent := strings.TrimSpace(r.UserAgent())
	failureKey := authFailureKey(phone, clientIP)
	now := time.Now()
	s.sweepAuthSessions(r.Context(), now)
	if remaining, locked := s.loginFailures.CheckLockout(failureKey, now); locked {
		s.recordAuthAudit(r.Context(), database.AuthAuditEvent{
			EventType:     "login_failure",
			Phone:         phone,
			IPAddress:     clientIP,
			UserAgent:     userAgent,
			Success:       false,
			FailureReason: "locked_out",
			Metadata: map[string]any{
				"retry_after_seconds": int((remaining + time.Second - 1) / time.Second),
			},
		})
		retryAfterSeconds := int((remaining + time.Second - 1) / time.Second)
		w.Header().Set("Retry-After", strconv.Itoa(retryAfterSeconds))
		writeError(w, http.StatusTooManyRequests, fmt.Sprintf("登录失败次数过多，请%d秒后再试", retryAfterSeconds))
		return
	}
	user, err := s.store.GetUserByPhone(r.Context(), phone)
	if errors.Is(err, pgx.ErrNoRows) {
		s.recordAuthAudit(r.Context(), database.AuthAuditEvent{
			EventType:     "login_failure",
			Phone:         phone,
			IPAddress:     clientIP,
			UserAgent:     userAgent,
			Success:       false,
			FailureReason: "user_not_found",
		})
		if s.recordLoginFailure(w, failureKey, now) {
			return
		}
		writeError(w, http.StatusUnauthorized, "手机号或密码不正确")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "登录失败")
		return
	}
	if !verifyPassword(password, user.PasswordSalt, user.PasswordHash) {
		s.recordAuthAudit(r.Context(), database.AuthAuditEvent{
			EventType:     "login_failure",
			UserID:        user.ID,
			Phone:         phone,
			IPAddress:     clientIP,
			UserAgent:     userAgent,
			Success:       false,
			FailureReason: "bad_password",
		})
		if s.recordLoginFailure(w, failureKey, now) {
			return
		}
		writeError(w, http.StatusUnauthorized, "手机号或密码不正确")
		return
	}
	s.loginFailures.Clear(failureKey)
	token, tokenHash, expiresAt, err := s.grantAuthSession(r.Context(), user.ID, now, clientIP, userAgent)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "生成登录会话失败")
		return
	}
	s.recordAuthAudit(r.Context(), database.AuthAuditEvent{
		EventType:        "login_success",
		UserID:           user.ID,
		Phone:            user.Phone,
		SessionTokenHash: tokenHash,
		IPAddress:        clientIP,
		UserAgent:        userAgent,
		Success:          true,
		Metadata: map[string]any{
			"expires_at": expiresAt.UTC().Format(time.RFC3339),
		},
	})
	writeJSON(w, http.StatusOK, map[string]any{
		"user":       publicUser(user),
		"token":      token,
		"expires_at": expiresAt.UTC().Format(time.RFC3339),
	})
}

func (s *Server) handleAuthMe(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	user, ok := s.requireSessionUser(w, r, "请先登录")
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"user": publicUser(user),
	})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}

	now := time.Now()
	s.sweepAuthSessions(r.Context(), now)
	token := authSessionToken(r)
	if strings.TrimSpace(token) != "" {
		tokenHash := hashAuthSessionToken(token)
		session, err := s.store.EndAuthSession(r.Context(), tokenHash, "explicit_logout", now)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusInternalServerError, "退出登录失败")
			return
		}
		if err := s.store.RevokePlaybackSessionsForAuthSession(r.Context(), tokenHash, now, "explicit_logout"); err != nil {
			writeError(w, http.StatusInternalServerError, "退出登录失败")
			return
		}
		if err == nil {
			s.recordAuthAudit(r.Context(), database.AuthAuditEvent{
				EventType:        "logout_explicit",
				UserID:           session.UserID,
				Phone:            session.Phone,
				SessionTokenHash: session.TokenHash,
				IPAddress:        clientAddress(r),
				UserAgent:        strings.TrimSpace(r.UserAgent()),
				Success:          true,
				Metadata:         authSessionAuditMetadata(session),
			})
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok": true,
	})
}

func (s *Server) handlePresenceHeartbeat(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	user, ok := s.requireSessionUser(w, r, "请先登录后上报在线状态")
	if !ok {
		return
	}

	var request presenceRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	sessionID, err := validatePresenceSessionID(request.SessionID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	now := time.Now()
	snapshot := s.presence.Touch(sessionID, user.ID, user.Phone, user.Nickname, now)
	writePresenceResponse(w, snapshot, true)
}

func (s *Server) handlePresenceOffline(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	user, ok := s.requireSessionUser(w, r, "请先登录后更新在线状态")
	if !ok {
		return
	}

	var request presenceRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	sessionID, err := validatePresenceSessionID(request.SessionID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	snapshot := s.presence.RemoveForUser(sessionID, user.ID, time.Now())
	writePresenceResponse(w, snapshot, false)
}

func (s *Server) requireSessionUserID(w http.ResponseWriter, r *http.Request, message string) (int64, bool) {
	userID, ok := s.authSessionUserID(r.Context(), authSessionToken(r), time.Now())
	if !ok {
		writeError(w, http.StatusUnauthorized, message)
		return 0, false
	}
	return userID, true
}

func (s *Server) requireMatchingSessionUserID(w http.ResponseWriter, r *http.Request, requestedUserID int64, message string) (int64, bool) {
	sessionUserID, ok := s.requireSessionUserID(w, r, message)
	if !ok {
		return 0, false
	}
	if requestedUserID > 0 && requestedUserID != sessionUserID {
		writeError(w, http.StatusForbidden, "当前登录用户无权执行此操作")
		return 0, false
	}
	return sessionUserID, true
}

func (s *Server) requiredSessionQueryUserID(w http.ResponseWriter, r *http.Request, message string) (int64, bool) {
	userID, err := validatePositiveID(r.URL.Query().Get("user_id"), "用户")
	if err != nil {
		writeError(w, http.StatusUnauthorized, message)
		return 0, false
	}
	return s.requireMatchingSessionUserID(w, r, userID, message)
}

func (s *Server) grantAuthSession(ctx context.Context, userID int64, now time.Time, ipAddress string, userAgent string) (string, string, time.Time, error) {
	token, tokenHash, err := newAuthSessionToken(authSessionTokenSize)
	if err != nil {
		return "", "", time.Time{}, err
	}
	expiresAt := now.Add(authSessionTTL)
	if err := s.store.CreateAuthSession(ctx, userID, tokenHash, expiresAt, ipAddress, userAgent); err != nil {
		return "", "", time.Time{}, err
	}
	return token, tokenHash, expiresAt, nil
}

func (s *Server) authSessionUserID(ctx context.Context, token string, now time.Time) (int64, bool) {
	token = strings.TrimSpace(token)
	if token == "" {
		return 0, false
	}
	s.sweepAuthSessions(ctx, now)
	userID, err := s.store.TouchAuthSession(ctx, hashAuthSessionToken(token), now)
	return userID, err == nil
}

func authSessionToken(r *http.Request) string {
	authorization := strings.TrimSpace(r.Header.Get("Authorization"))
	if strings.HasPrefix(strings.ToLower(authorization), "bearer ") {
		return strings.TrimSpace(authorization[7:])
	}
	token := strings.TrimSpace(r.Header.Get("X-Session-Token"))
	if token != "" {
		return token
	}
	return ""
}

func newAuthSessionToken(tokenBytes int) (string, string, error) {
	buffer := make([]byte, tokenBytes)
	if _, err := rand.Read(buffer); err != nil {
		return "", "", err
	}
	token := base64.RawURLEncoding.EncodeToString(buffer)
	return token, hashAuthSessionToken(token), nil
}

func hashAuthSessionToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func (s *Server) sweepAuthSessions(ctx context.Context, now time.Time) {
	if s.authAuditSweeper == nil || !s.authAuditSweeper.Allow(now, authAuditSweepInterval) {
		return
	}
	expiredSessions, err := s.store.MarkExpiredAuthSessions(ctx, now)
	if err == nil {
		for _, session := range expiredSessions {
			s.recordAuthAudit(ctx, database.AuthAuditEvent{
				EventType:        "session_expired",
				UserID:           session.UserID,
				Phone:            session.Phone,
				SessionTokenHash: session.TokenHash,
				IPAddress:        session.IPAddress,
				UserAgent:        session.UserAgent,
				Success:          true,
				Metadata:         authSessionAuditMetadata(session),
			})
		}
	}

	offlineSessions, err := s.store.MarkOfflineTimedOutAuthSessions(ctx, now.Add(-presenceTTL), now)
	if err == nil {
		for _, session := range offlineSessions {
			metadata := authSessionAuditMetadata(session)
			metadata["offline_detected_at"] = now.UTC().Format(time.RFC3339)
			s.recordAuthAudit(ctx, database.AuthAuditEvent{
				EventType:        "offline_timeout",
				UserID:           session.UserID,
				Phone:            session.Phone,
				SessionTokenHash: session.TokenHash,
				IPAddress:        session.IPAddress,
				UserAgent:        session.UserAgent,
				Success:          true,
				Metadata:         metadata,
			})
		}
	}
}

func (s *Server) recordAuthAudit(ctx context.Context, event database.AuthAuditEvent) {
	_ = s.store.RecordAuthAuditLog(ctx, event)
}

func authSessionAuditMetadata(session database.AuthSessionRecord) map[string]any {
	return map[string]any{
		"created_at":   session.CreatedAt.UTC().Format(time.RFC3339),
		"expires_at":   session.ExpiresAt.UTC().Format(time.RFC3339),
		"last_seen_at": session.LastSeenAt.UTC().Format(time.RFC3339),
	}
}

func writePresenceResponse(w http.ResponseWriter, snapshot presenceSnapshot, includeUsers bool) {
	response := presenceResponse{
		OnlineCount: snapshot.OnlineCount,
	}
	if includeUsers {
		response.OnlineUsers = snapshot.OnlineUsers
	}
	writeJSON(w, http.StatusOK, response)
}

func (s *Server) handleLibrarySetting(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAudioManager(w, r, "请先登录后管理服务器音频文件"); !ok {
		return
	}

	switch r.Method {
	case http.MethodGet:
		setting, err := s.store.GetSetting(r.Context(), musicDirectoryKey)
		if errors.Is(err, sql.ErrNoRows) {
			writeJSON(w, http.StatusOK, map[string]any{
				"path":       "",
				"updated_at": nil,
			})
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "读取音乐目录失败")
			return
		}
		writeJSON(w, http.StatusOK, setting)

	case http.MethodPut:
		var request setLibraryRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			writeError(w, http.StatusBadRequest, "请求格式不正确")
			return
		}
		path, err := validateDirectory(request.Path)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		setting, err := s.store.SetSetting(r.Context(), musicDirectoryKey, path)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "保存音乐目录失败")
			return
		}
		result, err := s.scanner.Scan(r.Context(), path)
		if err != nil {
			writeError(w, http.StatusInternalServerError, fmt.Sprintf("扫描音乐目录失败: %v", err))
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"setting": setting,
			"scan":    result,
		})

	default:
		methodNotAllowed(w)
	}
}

func (s *Server) handleScan(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	if _, ok := s.requireAudioManager(w, r, "请先登录后管理服务器音频文件"); !ok {
		return
	}

	result, err := s.scanManagedLibrary(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("扫描音乐目录失败: %v", err))
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleTracks(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	quality := strings.TrimSpace(strings.ToLower(r.URL.Query().Get("quality")))
	user, hasUser := s.optionalSessionUser(r)
	var tracks []models.Track
	var err error
	switch quality {
	case "":
		if hasUser && models.UserCanPlayLossless(user.Role) {
			tracks, err = s.store.ListTracks(r.Context())
		} else {
			tracks, err = s.store.ListTracksByQuality(r.Context(), models.TrackQualityLossy)
		}
	case models.TrackQualityLossless:
		if !hasUser || !models.UserCanPlayLossless(user.Role) {
			writeError(w, http.StatusForbidden, "当前用户无权播放高品质")
			return
		}
		tracks, err = s.store.ListTracksByQuality(r.Context(), quality)
	case models.TrackQualityLossy:
		tracks, err = s.store.ListTracksByQuality(r.Context(), quality)
	default:
		writeError(w, http.StatusBadRequest, "音乐类型不正确")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "读取歌曲列表失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"tracks": tracks,
	})
}

func (s *Server) handleTrackRefresh(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}

	userID, err := validatePositiveID(r.URL.Query().Get("user_id"), "用户")
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	userID, ok := s.requireMatchingSessionUserID(w, r, userID, "请先登录后刷新歌单")
	if !ok {
		return
	}
	user, err := s.store.GetUserByID(r.Context(), userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusUnauthorized, "请先登录后刷新歌单")
			return
		}
		writeError(w, http.StatusInternalServerError, "读取用户失败")
		return
	}

	if remaining, ok := s.trackRefreshLimiter.Allow(fmt.Sprintf("user:%d", userID), time.Now(), manualTrackRefreshWindow); !ok {
		retryAfterSeconds := int((remaining + time.Second - 1) / time.Second)
		w.Header().Set("Retry-After", strconv.Itoa(retryAfterSeconds))
		writeError(w, http.StatusTooManyRequests, fmt.Sprintf("歌单刷新太频繁，请%d秒后再试", retryAfterSeconds))
		return
	}

	tracks, err := s.store.ListTracks(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "读取歌曲列表失败")
		return
	}
	tracks = filterTracksForUser(user, tracks)
	writeJSON(w, http.StatusOK, map[string]any{
		"tracks": tracks,
	})
}

func (s *Server) handleFavorites(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		userID, err := validatePositiveID(r.URL.Query().Get("user_id"), "用户")
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		userID, ok := s.requireMatchingSessionUserID(w, r, userID, "请先登录后读取收藏列表")
		if !ok {
			return
		}
		user, err := s.store.GetUserByID(r.Context(), userID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "读取用户失败")
			return
		}
		var tracks []models.Track
		categoryIDText := strings.TrimSpace(r.URL.Query().Get("category_id"))
		if categoryIDText != "" {
			categoryID, err := validatePositiveID(categoryIDText, "分类")
			if err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			tracks, err = s.store.ListFavoriteTracksByCategory(r.Context(), userID, categoryID)
		} else {
			tracks, err = s.store.ListFavoriteTracks(r.Context(), userID)
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "读取收藏列表失败")
			return
		}
		tracks = filterTracksForUser(user, tracks)
		writeJSON(w, http.StatusOK, map[string]any{
			"tracks": tracks,
		})

	case http.MethodPost:
		var request favoriteRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			writeError(w, http.StatusBadRequest, "请求格式不正确")
			return
		}
		if request.UserID <= 0 {
			writeError(w, http.StatusBadRequest, "用户标识不正确")
			return
		}
		userID, ok := s.requireMatchingSessionUserID(w, r, request.UserID, "请先登录后收藏歌曲")
		if !ok {
			return
		}
		if request.TrackID <= 0 {
			writeError(w, http.StatusBadRequest, "歌曲标识不正确")
			return
		}
		user, err := s.store.GetUserByID(r.Context(), userID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "读取用户失败")
			return
		}
		track, err := s.store.GetTrack(r.Context(), request.TrackID)
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "歌曲不存在")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "读取歌曲失败")
			return
		}
		if !userCanAccessTrack(user, track) {
			writeError(w, http.StatusForbidden, "当前用户无权收藏高品质")
			return
		}
		if err := s.store.AddFavoriteTrack(r.Context(), userID, request.TrackID); err != nil {
			if isForeignKeyViolation(err) {
				writeError(w, http.StatusNotFound, "用户或歌曲不存在")
				return
			}
			writeError(w, http.StatusInternalServerError, "收藏歌曲失败")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"ok": true,
		})

	default:
		methodNotAllowed(w)
	}
}

func (s *Server) handleTrackMemberships(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	userID, err := validatePositiveID(r.URL.Query().Get("user_id"), "用户")
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	userID, ok := s.requireMatchingSessionUserID(w, r, userID, "请先登录后读取歌曲状态")
	if !ok {
		return
	}
	favoriteTrackIDs, categoryMemberships, err := s.store.ListTrackMemberships(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "读取歌曲状态失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"favorite_track_ids":   favoriteTrackIDs,
		"category_memberships": categoryMemberships,
	})
}

func (s *Server) handleFavoriteRoute(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		methodNotAllowed(w)
		return
	}
	trackID, ok := parseFavoriteTrackID(r.URL.Path)
	if !ok {
		http.NotFound(w, r)
		return
	}
	userID, err := validatePositiveID(r.URL.Query().Get("user_id"), "用户")
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	userID, ok = s.requireMatchingSessionUserID(w, r, userID, "请先登录后取消收藏")
	if !ok {
		return
	}
	if err := s.store.DeleteFavoriteTrack(r.Context(), userID, trackID); err != nil {
		writeError(w, http.StatusInternalServerError, "取消收藏失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok": true,
	})
}

func (s *Server) handleFavoriteCategories(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		userID, err := validatePositiveID(r.URL.Query().Get("user_id"), "用户")
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		userID, ok := s.requireMatchingSessionUserID(w, r, userID, "请先登录后读取分类")
		if !ok {
			return
		}
		categories, err := s.store.ListFavoriteCategories(r.Context(), userID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "读取分类失败")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"categories": categories,
		})

	case http.MethodPost:
		var request favoriteCategoryRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			writeError(w, http.StatusBadRequest, "请求格式不正确")
			return
		}
		if request.UserID <= 0 {
			writeError(w, http.StatusBadRequest, "用户标识不正确")
			return
		}
		userID, ok := s.requireMatchingSessionUserID(w, r, request.UserID, "请先登录后创建分类")
		if !ok {
			return
		}
		name, err := validateFavoriteCategoryName(request.Name)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		category, err := s.store.CreateFavoriteCategory(r.Context(), userID, name)
		if err != nil {
			if isForeignKeyViolation(err) {
				writeError(w, http.StatusNotFound, "用户不存在")
				return
			}
			if isUniqueViolation(err) {
				writeError(w, http.StatusConflict, "分类名称已存在")
				return
			}
			writeError(w, http.StatusInternalServerError, "创建分类失败")
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{
			"category": category,
		})

	default:
		methodNotAllowed(w)
	}
}

func (s *Server) handleFavoriteCategoryRoute(w http.ResponseWriter, r *http.Request) {
	categoryID, trackID, resource, ok := parseFavoriteCategoryRoute(r.URL.Path)
	if !ok {
		http.NotFound(w, r)
		return
	}

	switch {
	case resource == "category" && r.Method == http.MethodDelete:
		userID, err := validatePositiveID(r.URL.Query().Get("user_id"), "用户")
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		userID, ok = s.requireMatchingSessionUserID(w, r, userID, "请先登录后删除分类")
		if !ok {
			return
		}
		if err := s.store.DeleteFavoriteCategory(r.Context(), userID, categoryID); err != nil {
			writeError(w, http.StatusInternalServerError, "删除分类失败")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"ok": true,
		})

	case resource == "tracks" && r.Method == http.MethodPost:
		var request favoriteCategoryTrackRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			writeError(w, http.StatusBadRequest, "请求格式不正确")
			return
		}
		if request.UserID <= 0 {
			writeError(w, http.StatusBadRequest, "用户标识不正确")
			return
		}
		userID, ok := s.requireMatchingSessionUserID(w, r, request.UserID, "请先登录后加入分类")
		if !ok {
			return
		}
		if request.TrackID <= 0 {
			writeError(w, http.StatusBadRequest, "歌曲标识不正确")
			return
		}
		user, err := s.store.GetUserByID(r.Context(), userID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "读取用户失败")
			return
		}
		track, err := s.store.GetTrack(r.Context(), request.TrackID)
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "歌曲不存在")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "读取歌曲失败")
			return
		}
		if !userCanAccessTrack(user, track) {
			writeError(w, http.StatusForbidden, "当前用户无权加入高品质")
			return
		}
		if err := s.store.AddFavoriteTrackToCategory(r.Context(), userID, categoryID, request.TrackID); err != nil {
			if isForeignKeyViolation(err) {
				writeError(w, http.StatusNotFound, "用户、歌曲或分类不存在")
				return
			}
			writeError(w, http.StatusInternalServerError, "加入分类失败")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"ok": true,
		})

	case resource == "track" && r.Method == http.MethodDelete:
		userID, err := validatePositiveID(r.URL.Query().Get("user_id"), "用户")
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		userID, ok = s.requireMatchingSessionUserID(w, r, userID, "请先登录后移出分类")
		if !ok {
			return
		}
		if err := s.store.DeleteFavoriteTrackFromCategory(r.Context(), userID, categoryID, trackID); err != nil {
			writeError(w, http.StatusInternalServerError, "移出分类失败")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"ok": true,
		})

	default:
		methodNotAllowed(w)
	}
}

func (s *Server) handleTrackRoute(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	id, resource, ok := parseTrackRoute(r.URL.Path)
	if !ok {
		http.NotFound(w, r)
		return
	}
	switch resource {
	case "stream":
		s.streamTrack(w, r, id)
	case "lyrics":
		s.handleTrackLyrics(w, r, id)
	case "cover":
		s.handleTrackCover(w, r, id)
	default:
		http.NotFound(w, r)
	}
}

func (s *Server) handleTrackLyrics(w http.ResponseWriter, r *http.Request, id int64) {
	user, ok := s.requireSessionUser(w, r, "请先登录后读取歌词")
	if !ok {
		return
	}

	lyrics, quality, err := s.store.GetTrackLyricsWithQuality(r.Context(), id)
	if errors.Is(err, pgx.ErrNoRows) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "读取歌词失败")
		return
	}
	if quality == models.TrackQualityLossless && !models.UserCanPlayLossless(user.Role) {
		writeError(w, http.StatusForbidden, "当前用户无权读取高品质歌词")
		return
	}

	w.Header().Set("Cache-Control", "private, max-age=300")
	w.Header().Set("Vary", "Authorization, X-Session-Token")
	etag := trackLyricsETag(lyrics)
	w.Header().Set("ETag", etag)
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	writeJSON(w, http.StatusOK, lyrics)
}

func trackLyricsETag(lyrics models.TrackLyrics) string {
	hash := strings.TrimSpace(lyrics.ContentHash)
	if hash == "" {
		hash = fmt.Sprintf("empty-%d", lyrics.TrackID)
	}
	return `"` + hash + `"`
}

func (s *Server) handleTrackCover(w http.ResponseWriter, r *http.Request, id int64) {
	cover, err := s.store.GetTrackCover(r.Context(), id)
	if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, sql.ErrNoRows) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "读取专辑封面失败")
		return
	}

	w.Header().Set("Content-Type", cover.MimeType)
	w.Header().Set("Cache-Control", "public, max-age=86400")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if cover.Hash != "" {
		etag := `"` + cover.Hash + `"`
		w.Header().Set("ETag", etag)
		if r.Header.Get("If-None-Match") == etag {
			w.WriteHeader(http.StatusNotModified)
			return
		}
	}
	http.ServeContent(w, r, fmt.Sprintf("track-%d-cover", id), time.Time{}, bytes.NewReader(cover.Data))
}

func (s *Server) streamTrack(w http.ResponseWriter, r *http.Request, id int64) {
	track, err := s.store.GetTrack(r.Context(), id)
	if errors.Is(err, pgx.ErrNoRows) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "读取歌曲失败")
		return
	}
	if !s.authorizeTrackStream(w, r, track) {
		return
	}

	file, err := os.Open(track.Path)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "读取音频文件失败")
		return
	}

	w.Header().Set("Content-Type", library.ContentType(track.Format))
	w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=%q", track.Filename))
	w.Header().Set("Cache-Control", "private, no-cache")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, track.Filename, info.ModTime(), file)
}

func (s *Server) authorizeTrackStream(w http.ResponseWriter, r *http.Request, track models.Track) bool {
	if ticket := strings.TrimSpace(r.URL.Query().Get("stream_ticket")); ticket != "" {
		grant, ok := s.streamTickets.Validate(ticket, time.Now())
		if !ok {
			writeError(w, http.StatusUnauthorized, "播放链接已失效，请重新点击播放")
			return false
		}
		user, err := s.store.GetUserByID(r.Context(), grant.UserID)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "播放链接已失效，请重新登录")
			return false
		}
		if !userCanAccessTrack(user, track) {
			writeError(w, http.StatusForbidden, "当前用户无权播放高品质")
			return false
		}
		now := time.Now()
		if _, err := s.store.TouchPlaybackSession(r.Context(), grant.PlaybackTokenHash, user.ID, now, now.Add(playbackSessionTTL)); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				writeError(w, http.StatusConflict, "音乐已在其它设备或页面播放")
			} else {
				writeError(w, http.StatusInternalServerError, "校验播放会话失败")
			}
			return false
		}
		return true
	}

	user, ok := s.requireSessionUser(w, r, "请先登录后播放音乐")
	if !ok {
		return false
	}
	if !userCanAccessTrack(user, track) {
		writeError(w, http.StatusForbidden, "当前用户无权播放高品质")
		return false
	}
	return s.requirePlaybackSessionForStream(w, r, user.ID)
}

func validateDirectory(path string) (string, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return "", errors.New("音乐目录不能为空")
	}
	absolute, err := filepath.Abs(path)
	if err != nil {
		return "", errors.New("无法解析音乐目录")
	}
	info, err := os.Stat(absolute)
	if err != nil {
		return "", errors.New("音乐目录不存在或不可访问")
	}
	if !info.IsDir() {
		return "", errors.New("音乐目录必须是文件夹")
	}
	return absolute, nil
}

func validateLoginRequest(request loginRequest) (string, string, error) {
	phone, err := validatePhone(request.Phone)
	if err != nil {
		return "", "", err
	}
	password, err := validatePassword(request.Password)
	if err != nil {
		return "", "", err
	}
	return phone, password, nil
}

func validatePositiveID(value, label string) (int64, error) {
	id, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
	if err != nil || id <= 0 {
		return 0, fmt.Errorf("%s标识不正确", label)
	}
	return id, nil
}

func validatePhone(phone string) (string, error) {
	normalized := strings.TrimSpace(phone)
	normalized = strings.ReplaceAll(normalized, " ", "")
	normalized = strings.ReplaceAll(normalized, "-", "")
	if !mainlandPhonePattern.MatchString(normalized) {
		return "", errors.New("请输入有效的中国大陆手机号码")
	}
	return normalized, nil
}

func validatePassword(password string) (string, error) {
	if len(password) < passwordMinLength || len(password) > passwordMaxLength {
		return "", fmt.Errorf("密码长度需为%d-%d位", passwordMinLength, passwordMaxLength)
	}
	return password, nil
}

func validatePresenceSessionID(sessionID string) (string, error) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return "", errors.New("会话标识不能为空")
	}
	if len(sessionID) > 128 {
		return "", errors.New("会话标识过长")
	}
	return sessionID, nil
}

func validateFavoriteCategoryName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", errors.New("分类名称不能为空")
	}
	if utf8.RuneCountInString(name) > favoriteCategoryMaxRunes {
		return "", fmt.Errorf("分类名称不能超过%d个字符", favoriteCategoryMaxRunes)
	}
	return name, nil
}

func authFailureKey(phone, address string) string {
	return phone + "|" + address
}

func clientAddress(r *http.Request) string {
	for _, header := range []string{"X-Forwarded-For", "X-Real-IP"} {
		value := strings.TrimSpace(r.Header.Get(header))
		if value == "" {
			continue
		}
		if header == "X-Forwarded-For" {
			value, _, _ = strings.Cut(value, ",")
			value = strings.TrimSpace(value)
		}
		if value != "" {
			return value
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil && host != "" {
		return host
	}
	return strings.TrimSpace(r.RemoteAddr)
}

func (s *Server) recordLoginFailure(w http.ResponseWriter, failureKey string, now time.Time) bool {
	remaining, _, locked := s.loginFailures.RecordFailure(failureKey, now, loginMaxFails, loginLockout)
	if !locked {
		return false
	}
	retryAfterSeconds := int((remaining + time.Second - 1) / time.Second)
	w.Header().Set("Retry-After", strconv.Itoa(retryAfterSeconds))
	writeError(w, http.StatusTooManyRequests, fmt.Sprintf("登录失败次数过多，请%d秒后再试", retryAfterSeconds))
	return true
}

func hashPassword(password string) (string, string, error) {
	saltBytes := make([]byte, 16)
	if _, err := rand.Read(saltBytes); err != nil {
		return "", "", err
	}
	salt := base64.RawStdEncoding.EncodeToString(saltBytes)
	hash := derivePasswordHash([]byte(password), saltBytes)
	return base64.RawStdEncoding.EncodeToString(hash), salt, nil
}

func verifyPassword(password, salt, expectedHash string) bool {
	saltBytes, err := base64.RawStdEncoding.DecodeString(salt)
	if err != nil {
		return false
	}
	expectedBytes, err := base64.RawStdEncoding.DecodeString(expectedHash)
	if err != nil {
		return false
	}
	actualBytes := derivePasswordHash([]byte(password), saltBytes)
	return subtle.ConstantTimeCompare(actualBytes, expectedBytes) == 1
}

func derivePasswordHash(password, salt []byte) []byte {
	hashLength := sha256.Size
	blockCount := (passwordHashLength + hashLength - 1) / hashLength
	derived := make([]byte, 0, blockCount*hashLength)

	for blockIndex := 1; blockIndex <= blockCount; blockIndex++ {
		u := passwordHashBlock(password, salt, blockIndex)
		block := make([]byte, len(u))
		copy(block, u)

		for round := 1; round < passwordHashRounds; round++ {
			u = passwordHashBlock(password, u, 0)
			for index := range block {
				block[index] ^= u[index]
			}
		}
		derived = append(derived, block...)
	}

	return derived[:passwordHashLength]
}

func passwordHashBlock(password, salt []byte, blockIndex int) []byte {
	mac := hmac.New(sha256.New, password)
	mac.Write(salt)
	if blockIndex > 0 {
		var buffer [4]byte
		binary.BigEndian.PutUint32(buffer[:], uint32(blockIndex))
		mac.Write(buffer[:])
	}
	return mac.Sum(nil)
}

func newPresenceTracker() *presenceTracker {
	return &presenceTracker{
		sessions: make(map[string]presenceSession),
	}
}

func newAuthFailureLimiter() *authFailureLimiter {
	return &authFailureLimiter{
		failures: make(map[string]authFailure),
	}
}

func (s *authAuditSweeper) Allow(now time.Time, interval time.Duration) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.lastRun.IsZero() && now.Sub(s.lastRun) < interval {
		return false
	}
	s.lastRun = now
	return true
}

func (l *authFailureLimiter) CheckLockout(key string, now time.Time) (time.Duration, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()

	state, ok := l.failures[key]
	if !ok || state.LockedUntil.IsZero() {
		return 0, false
	}
	if now.Before(state.LockedUntil) {
		return state.LockedUntil.Sub(now), true
	}
	delete(l.failures, key)
	return 0, false
}

func (l *authFailureLimiter) RecordFailure(key string, now time.Time, maxFailures int, lockout time.Duration) (time.Duration, int, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()

	state := l.failures[key]
	if !state.LockedUntil.IsZero() && now.Before(state.LockedUntil) {
		return state.LockedUntil.Sub(now), 0, true
	}
	if !state.LockedUntil.IsZero() && !now.Before(state.LockedUntil) {
		state = authFailure{}
	}

	state.Count++
	if state.Count >= maxFailures {
		state.Count = 0
		state.LockedUntil = now.Add(lockout)
		l.failures[key] = state
		return lockout, 0, true
	}

	l.failures[key] = state
	return 0, maxFailures - state.Count, false
}

func (l *authFailureLimiter) Clear(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.failures, key)
}

func newManualRefreshLimiter() *manualRefreshLimiter {
	return &manualRefreshLimiter{
		lastByKey: make(map[string]time.Time),
	}
}

func (l *manualRefreshLimiter) Allow(key string, now time.Time, window time.Duration) (time.Duration, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()

	if last, ok := l.lastByKey[key]; ok {
		nextAllowedAt := last.Add(window)
		if now.Before(nextAllowedAt) {
			return nextAllowedAt.Sub(now), false
		}
	}

	l.lastByKey[key] = now
	return 0, true
}

func newAudioFileAccessManager(tokenBytes int, ttl time.Duration) *audioFileAccessManager {
	return &audioFileAccessManager{
		tokens:     make(map[string]audioFileAccessGrant),
		failures:   make(map[int64]audioFileAccessFailure),
		tokenBytes: tokenBytes,
		ttl:        ttl,
	}
}

func (m *audioFileAccessManager) CheckLockout(userID int64, now time.Time) (time.Duration, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()

	state, ok := m.failures[userID]
	if !ok || state.LockedUntil.IsZero() {
		return 0, false
	}
	if now.Before(state.LockedUntil) {
		return state.LockedUntil.Sub(now), true
	}
	delete(m.failures, userID)
	return 0, false
}

func (m *audioFileAccessManager) RecordFailure(userID int64, now time.Time, maxFailures int, lockout time.Duration) (time.Duration, int, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()

	state := m.failures[userID]
	if !state.LockedUntil.IsZero() && now.Before(state.LockedUntil) {
		return state.LockedUntil.Sub(now), 0, true
	}
	if !state.LockedUntil.IsZero() && !now.Before(state.LockedUntil) {
		state = audioFileAccessFailure{}
	}

	state.Count++
	if state.Count >= maxFailures {
		state.Count = 0
		state.LockedUntil = now.Add(lockout)
		m.failures[userID] = state
		return lockout, 0, true
	}

	m.failures[userID] = state
	return 0, maxFailures - state.Count, false
}

func (m *audioFileAccessManager) ClearFailures(userID int64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.failures, userID)
}

func (m *audioFileAccessManager) Grant(userID int64, now time.Time) (string, time.Time, error) {
	tokenBytes := make([]byte, m.tokenBytes)
	if _, err := rand.Read(tokenBytes); err != nil {
		return "", time.Time{}, err
	}
	token := base64.RawURLEncoding.EncodeToString(tokenBytes)
	expiresAt := now.Add(m.ttl)

	m.mu.Lock()
	defer m.mu.Unlock()
	m.cleanupExpiredLocked(now)
	m.tokens[token] = audioFileAccessGrant{
		UserID:    userID,
		ExpiresAt: expiresAt,
	}
	return token, expiresAt, nil
}

func (m *audioFileAccessManager) Validate(userID int64, token string, now time.Time) bool {
	token = strings.TrimSpace(token)
	if token == "" {
		return false
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	grant, ok := m.tokens[token]
	if !ok {
		return false
	}
	if grant.UserID != userID || !now.Before(grant.ExpiresAt) {
		delete(m.tokens, token)
		return false
	}
	grant.ExpiresAt = now.Add(m.ttl)
	m.tokens[token] = grant
	return true
}

func (m *audioFileAccessManager) cleanupExpiredLocked(now time.Time) {
	for token, grant := range m.tokens {
		if !now.Before(grant.ExpiresAt) {
			delete(m.tokens, token)
		}
	}
}

func (p *presenceTracker) Touch(sessionID string, userID int64, phone string, nickname string, now time.Time) presenceSnapshot {
	p.mu.Lock()
	defer p.mu.Unlock()

	p.sessions[sessionID] = presenceSession{
		UserID:   userID,
		Phone:    phone,
		Nickname: strings.TrimSpace(nickname),
		LastSeen: now,
	}
	return p.snapshotLocked(now)
}

func (p *presenceTracker) RemoveForUser(sessionID string, userID int64, now time.Time) presenceSnapshot {
	p.mu.Lock()
	defer p.mu.Unlock()

	if session, ok := p.sessions[sessionID]; ok && session.UserID == userID {
		delete(p.sessions, sessionID)
	}
	return p.snapshotLocked(now)
}

func (p *presenceTracker) snapshotLocked(now time.Time) presenceSnapshot {
	cutoff := now.Add(-presenceTTL)
	onlineUsersByKey := make(map[string]presenceOnlineUser)

	for sessionID, session := range p.sessions {
		if session.LastSeen.Before(cutoff) {
			delete(p.sessions, sessionID)
			continue
		}
		onlineUsersByKey[presenceOnlineKey(sessionID, session)] = presenceOnlineUser{
			UserID:   session.UserID,
			Nickname: presenceDisplayName(session),
		}
	}

	onlineUsers := make([]presenceOnlineUser, 0, len(onlineUsersByKey))
	for _, user := range onlineUsersByKey {
		onlineUsers = append(onlineUsers, user)
	}
	sort.Slice(onlineUsers, func(i, j int) bool {
		left := strings.ToLower(onlineUsers[i].Nickname)
		right := strings.ToLower(onlineUsers[j].Nickname)
		if left == right {
			return onlineUsers[i].UserID < onlineUsers[j].UserID
		}
		return left < right
	})

	return presenceSnapshot{
		OnlineCount: len(onlineUsers),
		OnlineUsers: onlineUsers,
	}
}

func presenceOnlineKey(sessionID string, session presenceSession) string {
	if session.UserID > 0 {
		return fmt.Sprintf("user:%d", session.UserID)
	}
	if session.Phone != "" {
		return "phone:" + session.Phone
	}
	return "session:" + sessionID
}

func presenceDisplayName(session presenceSession) string {
	if session.Nickname != "" {
		return session.Nickname
	}
	if session.UserID > 0 {
		return fmt.Sprintf("用户%d", session.UserID)
	}
	return "访客"
}

func parseFavoriteTrackID(path string) (int64, bool) {
	const prefix = "/api/favorites/"
	if !strings.HasPrefix(path, prefix) {
		return 0, false
	}
	idText := strings.TrimPrefix(path, prefix)
	if idText == "" || strings.Contains(idText, "/") {
		return 0, false
	}
	id, err := strconv.ParseInt(idText, 10, 64)
	return id, err == nil && id > 0
}

func parseTrackRoute(path string) (int64, string, bool) {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) != 4 || parts[0] != "api" || parts[1] != "tracks" {
		return 0, "", false
	}
	if parts[3] != "stream" && parts[3] != "lyrics" && parts[3] != "cover" {
		return 0, "", false
	}
	id, err := strconv.ParseInt(parts[2], 10, 64)
	if err != nil || id <= 0 {
		return 0, "", false
	}
	return id, parts[3], true
}

func parseFavoriteCategoryRoute(path string) (int64, int64, string, bool) {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) < 3 || parts[0] != "api" || parts[1] != "favorite-categories" {
		return 0, 0, "", false
	}
	categoryID, err := strconv.ParseInt(parts[2], 10, 64)
	if err != nil || categoryID <= 0 {
		return 0, 0, "", false
	}
	if len(parts) == 3 {
		return categoryID, 0, "category", true
	}
	if len(parts) == 4 && parts[3] == "tracks" {
		return categoryID, 0, "tracks", true
	}
	if len(parts) == 5 && parts[3] == "tracks" {
		trackID, err := strconv.ParseInt(parts[4], 10, 64)
		if err != nil || trackID <= 0 {
			return 0, 0, "", false
		}
		return categoryID, trackID, "track", true
	}
	return 0, 0, "", false
}

func isForeignKeyViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23503"
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func publicUser(user models.User) map[string]any {
	return map[string]any{
		"id":           user.ID,
		"phone":        user.Phone,
		"country_code": user.CountryCode,
		"nickname":     user.Nickname,
		"role":         models.NormalizeUserRole(user.Role),
		"created_at":   user.CreatedAt,
	}
}

func (s *Server) withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := strings.TrimSpace(s.corsOrigin)
		if origin == "" || origin == "*" {
			origin = "*"
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Session-Token, X-Audio-Access-Token, X-Playback-Session-Token")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Expose-Headers", "Retry-After")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]any{
		"error": message,
	})
}

func methodNotAllowed(w http.ResponseWriter) {
	writeError(w, http.StatusMethodNotAllowed, "method not allowed")
}

func ShutdownContext() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), 10*time.Second)
}
