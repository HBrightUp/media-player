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
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/hml/media-player/backend/internal/database"
	"github.com/hml/media-player/backend/internal/library"
	"github.com/hml/media-player/backend/internal/models"
	"github.com/jackc/pgx/v5"
)

const musicDirectoryKey = "music_directory"
const (
	nicknameMaxRunes   = 20
	passwordMinLength  = 6
	passwordMaxLength  = 64
	passwordHashRounds = 100_000
	passwordHashLength = 32
	presenceTTL        = 75 * time.Second
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
	Accepted bool   `json:"accepted"`
}

type loginRequest struct {
	Phone    string `json:"phone"`
	Password string `json:"password"`
	Accepted bool   `json:"accepted"`
}

type presenceRequest struct {
	SessionID string `json:"session_id"`
	UserID    int64  `json:"user_id"`
	Phone     string `json:"phone"`
}

type presenceSession struct {
	UserID   int64
	Phone    string
	LastSeen time.Time
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

	onlineCount := s.presence.Touch(sessionID, request.UserID, normalizePresencePhone(request.Phone), time.Now())
	writeJSON(w, http.StatusOK, map[string]any{
		"online_count": onlineCount,
	})
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

	onlineCount := s.presence.Remove(sessionID, time.Now())
	writeJSON(w, http.StatusOK, map[string]any{
		"online_count": onlineCount,
	})
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

func (s *Server) handleTrackRoute(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	id, ok := library.ParseTrackID(r.URL.Path)
	if !ok {
		http.NotFound(w, r)
		return
	}
	s.streamTrack(w, r, id)
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
	if !request.Accepted {
		return "", "", "", errors.New("请先同意软件许可及服务协议")
	}
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
	if !request.Accepted {
		return "", "", errors.New("请先同意软件许可及服务协议")
	}
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

func (p *presenceTracker) Touch(sessionID string, userID int64, phone string, now time.Time) int {
	p.mu.Lock()
	defer p.mu.Unlock()

	p.sessions[sessionID] = presenceSession{
		UserID:   userID,
		Phone:    phone,
		LastSeen: now,
	}
	return p.onlineCountLocked(now)
}

func (p *presenceTracker) Remove(sessionID string, now time.Time) int {
	p.mu.Lock()
	defer p.mu.Unlock()

	delete(p.sessions, sessionID)
	return p.onlineCountLocked(now)
}

func (p *presenceTracker) onlineCountLocked(now time.Time) int {
	cutoff := now.Add(-presenceTTL)
	onlineKeys := make(map[string]struct{})

	for sessionID, session := range p.sessions {
		if session.LastSeen.Before(cutoff) {
			delete(p.sessions, sessionID)
			continue
		}
		onlineKeys[presenceOnlineKey(sessionID, session)] = struct{}{}
	}

	return len(onlineKeys)
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
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
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
