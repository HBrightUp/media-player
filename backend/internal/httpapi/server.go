package httpapi

import (
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

const musicDirectoryKey = "music_directory"
const (
	nicknameMaxRunes         = 20
	favoriteCategoryMaxRunes = 16
	passwordMinLength        = 6
	passwordMaxLength        = 64
	passwordHashRounds       = 100_000
	passwordHashLength       = 32
	presenceTTL              = 75 * time.Second
)

var mainlandPhonePattern = regexp.MustCompile(`^1[3-9]\d{9}$`)

type Server struct {
	store      *database.Store
	scanner    *library.Scanner
	corsOrigin string
	presence   *presenceTracker
}

type setLibraryRequest struct {
	Path string `json:"path"`
}

type registerRequest struct {
	Nickname string `json:"nickname"`
	Phone    string `json:"phone"`
	Password string `json:"password"`
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
	UserID    int64  `json:"user_id"`
	Phone     string `json:"phone"`
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

func New(store *database.Store, scanner *library.Scanner, corsOrigin string) *Server {
	return &Server{
		store:      store,
		scanner:    scanner,
		corsOrigin: corsOrigin,
		presence:   newPresenceTracker(),
	}
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", s.handleHealth)
	mux.HandleFunc("/api/auth/register", s.handleRegister)
	mux.HandleFunc("/api/auth/login", s.handleLogin)
	mux.HandleFunc("/api/presence/heartbeat", s.handlePresenceHeartbeat)
	mux.HandleFunc("/api/presence/offline", s.handlePresenceOffline)
	mux.HandleFunc("/api/settings/library", s.handleLibrarySetting)
	mux.HandleFunc("/api/library/scan", s.handleScan)
	mux.HandleFunc("/api/favorites", s.handleFavorites)
	mux.HandleFunc("/api/favorites/", s.handleFavoriteRoute)
	mux.HandleFunc("/api/favorite-categories", s.handleFavoriteCategories)
	mux.HandleFunc("/api/favorite-categories/", s.handleFavoriteCategoryRoute)
	mux.HandleFunc("/api/tracks", s.handleTracks)
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

	var request registerRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	nickname, phone, password, err := validateRegisterRequest(request)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	hash, salt, err := hashPassword(password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "创建用户失败")
		return
	}

	user, err := s.store.CreateUser(r.Context(), models.User{
		Phone:        phone,
		CountryCode:  "+86",
		Nickname:     nickname,
		PasswordHash: hash,
		PasswordSalt: salt,
	})
	if errors.Is(err, database.ErrUserAlreadyExists) {
		writeError(w, http.StatusConflict, "手机号已注册，请直接登录")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "创建用户失败")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"user": publicUser(user),
	})
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
	user, err := s.store.GetUserByPhone(r.Context(), phone)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusUnauthorized, "手机号或密码不正确")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "登录失败")
		return
	}
	if !verifyPassword(password, user.PasswordSalt, user.PasswordHash) {
		writeError(w, http.StatusUnauthorized, "手机号或密码不正确")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"user": publicUser(user),
	})
}

func (s *Server) handlePresenceHeartbeat(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
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

	phone := normalizePresencePhone(request.Phone)
	user, hasUser := s.resolvePresenceUser(r.Context(), request.UserID, phone)
	if hasUser {
		request.UserID = user.ID
		phone = user.Phone
	}
	snapshot := s.presence.Touch(sessionID, request.UserID, phone, user.Nickname, time.Now())
	writePresenceResponse(w, snapshot, hasUser && user.Nickname == "Bright")
}

func (s *Server) handlePresenceOffline(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
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

	snapshot := s.presence.Remove(sessionID, time.Now())
	writePresenceResponse(w, snapshot, false)
}

func (s *Server) resolvePresenceUser(ctx context.Context, userID int64, phone string) (models.User, bool) {
	if userID > 0 {
		user, err := s.store.GetUserByID(ctx, userID)
		if err == nil && (phone == "" || user.Phone == phone) {
			return user, true
		}
	}
	if phone != "" {
		user, err := s.store.GetUserByPhone(ctx, phone)
		if err == nil {
			return user, true
		}
	}
	return models.User{}, false
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

	setting, err := s.store.GetSetting(r.Context(), musicDirectoryKey)
	if errors.Is(err, sql.ErrNoRows) || setting.Path == "" {
		writeError(w, http.StatusBadRequest, "请先设置音乐目录")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "读取音乐目录失败")
		return
	}
	result, err := s.scanner.Scan(r.Context(), setting.Path)
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
	tracks, err := s.store.ListTracks(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "读取歌曲列表失败")
		return
	}
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
		if request.TrackID <= 0 {
			writeError(w, http.StatusBadRequest, "歌曲标识不正确")
			return
		}
		if err := s.store.AddFavoriteTrack(r.Context(), request.UserID, request.TrackID); err != nil {
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
		name, err := validateFavoriteCategoryName(request.Name)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		category, err := s.store.CreateFavoriteCategory(r.Context(), request.UserID, name)
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
		if request.TrackID <= 0 {
			writeError(w, http.StatusBadRequest, "歌曲标识不正确")
			return
		}
		if err := s.store.AddFavoriteTrackToCategory(r.Context(), request.UserID, categoryID, request.TrackID); err != nil {
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
	default:
		http.NotFound(w, r)
	}
}

func (s *Server) handleTrackLyrics(w http.ResponseWriter, r *http.Request, id int64) {
	lyrics, err := s.store.GetTrackLyrics(r.Context(), id)
	if errors.Is(err, pgx.ErrNoRows) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "读取歌词失败")
		return
	}
	writeJSON(w, http.StatusOK, lyrics)
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
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, track.Filename, info.ModTime(), file)
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

func validateRegisterRequest(request registerRequest) (string, string, string, error) {
	nickname := strings.TrimSpace(request.Nickname)
	if nickname == "" {
		return "", "", "", errors.New("昵称不能为空")
	}
	if utf8.RuneCountInString(nickname) > nicknameMaxRunes {
		return "", "", "", fmt.Errorf("昵称不能超过%d个字符", nicknameMaxRunes)
	}
	phone, err := validatePhone(request.Phone)
	if err != nil {
		return "", "", "", err
	}
	password, err := validatePassword(request.Password)
	if err != nil {
		return "", "", "", err
	}
	return nickname, phone, password, nil
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

func normalizePresencePhone(phone string) string {
	normalized := strings.TrimSpace(phone)
	normalized = strings.ReplaceAll(normalized, " ", "")
	normalized = strings.ReplaceAll(normalized, "-", "")
	return normalized
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

func (p *presenceTracker) Remove(sessionID string, now time.Time) presenceSnapshot {
	p.mu.Lock()
	defer p.mu.Unlock()

	delete(p.sessions, sessionID)
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
	if parts[3] != "stream" && parts[3] != "lyrics" {
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
		"created_at":   user.CreatedAt,
	}
}

func (s *Server) withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := s.corsOrigin
		if origin == "" {
			origin = "*"
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
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
