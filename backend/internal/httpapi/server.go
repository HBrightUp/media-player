package httpapi

import (
	"bufio"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
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
	nicknameMaxRunes        = 20
	passwordMinLength       = 6
	passwordMaxLength       = 64
	passwordHashRounds      = 100_000
	passwordHashLength      = 32
	presenceTTL             = 75 * time.Second
	chatMessageMaxRunes     = 500
	chatHistoryDefaultLimit = 50
	chatHistoryMaxLimit     = 100
	chatAttachmentMaxBytes  = 2_000_000
	chatMessageTypeText     = "text"
	chatMessageTypeImage    = "image"
	chatMessageTypeAudio    = "audio"
	webSocketOpcodeClose    = 0x8
	webSocketOpcodePing     = 0x9
	webSocketOpcodePong     = 0xA
	webSocketOpcodeText     = 0x1
)

var mainlandPhonePattern = regexp.MustCompile(`^1[3-9]\d{9}$`)

type Server struct {
	store      *database.Store
	scanner    *library.Scanner
	corsOrigin string
	presence   *presenceTracker
	chat       *chatHub
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

type chatMessageRequest struct {
	RoomID         int64    `json:"room_id"`
	UserID         int64    `json:"user_id"`
	Phone          string   `json:"phone"`
	Nickname       string   `json:"nickname"`
	Content        string   `json:"content"`
	MessageType    string   `json:"message_type"`
	AttachmentName string   `json:"attachment_name"`
	AttachmentMime string   `json:"attachment_mime"`
	AttachmentData string   `json:"attachment_data"`
	Mentions       []string `json:"mentions"`
}

type chatReadRequest struct {
	RoomID int64 `json:"room_id"`
	UserID int64 `json:"user_id"`
}

type presenceTracker struct {
	mu       sync.Mutex
	sessions map[string]presenceSession
}

type chatHub struct {
	mu      sync.Mutex
	clients map[*chatClient]struct{}
}

type chatClient struct {
	conn     net.Conn
	roomID   int64
	userID   int64
	nickname string
	phone    string
	mu       sync.Mutex
}

func New(store *database.Store, scanner *library.Scanner, corsOrigin string) *Server {
	return &Server{
		store:      store,
		scanner:    scanner,
		corsOrigin: corsOrigin,
		presence:   newPresenceTracker(),
		chat:       newChatHub(),
	}
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", s.handleHealth)
	mux.HandleFunc("/api/auth/register", s.handleRegister)
	mux.HandleFunc("/api/auth/login", s.handleLogin)
	mux.HandleFunc("/api/presence/heartbeat", s.handlePresenceHeartbeat)
	mux.HandleFunc("/api/presence/offline", s.handlePresenceOffline)
	mux.HandleFunc("/api/chat/rooms", s.handleChatRooms)
	mux.HandleFunc("/api/chat/messages", s.handleChatMessages)
	mux.HandleFunc("/api/chat/messages/", s.handleChatMessageRoute)
	mux.HandleFunc("/api/chat/read", s.handleChatRead)
	mux.HandleFunc("/api/chat/ws", s.handleChatWebSocket)
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

func (s *Server) handleChatRooms(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}

	rooms, err := s.store.ListChatRooms(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "读取聊天室失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"rooms": rooms,
	})
}

func (s *Server) handleChatMessages(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		limit := parsePositiveInt(r.URL.Query().Get("limit"), chatHistoryDefaultLimit, chatHistoryMaxLimit)
		beforeID := parsePositiveInt64(r.URL.Query().Get("before_id"))
		roomID, err := validateChatRoomID(r.URL.Query().Get("room_id"))
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		query := normalizeChatSearchQuery(r.URL.Query().Get("q"))
		messages, err := s.store.ListChatMessages(r.Context(), roomID, limit+1, beforeID, query)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "读取聊天记录失败")
			return
		}
		hasMore := len(messages) > limit
		if hasMore {
			messages = messages[len(messages)-limit:]
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"messages": messages,
			"has_more": hasMore,
		})

	case http.MethodPost:
		var request chatMessageRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			writeError(w, http.StatusBadRequest, "请求格式不正确")
			return
		}
		message, phone, err := validateChatMessageRequest(request)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		message, err = s.store.CreateChatMessage(r.Context(), message, phone)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "发送消息失败")
			return
		}
		s.chat.BroadcastRoom(message.RoomID, map[string]any{
			"type":    "message",
			"message": message,
		})
		writeJSON(w, http.StatusCreated, map[string]any{
			"message": message,
		})

	default:
		methodNotAllowed(w)
	}
}

func (s *Server) handleChatMessageRoute(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		methodNotAllowed(w)
		return
	}
	id, ok := parseIDFromPrefix(r.URL.Path, "/api/chat/messages/")
	if !ok {
		http.NotFound(w, r)
		return
	}
	userID := parsePositiveInt64(r.URL.Query().Get("user_id"))
	if userID <= 0 {
		writeError(w, http.StatusBadRequest, "请先登录后撤回消息")
		return
	}

	message, err := s.store.RecallChatMessage(r.Context(), id, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "消息不存在或不能撤回")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "撤回消息失败")
		return
	}
	s.chat.BroadcastRoom(message.RoomID, map[string]any{
		"type":    "recall",
		"message": message,
	})
	writeJSON(w, http.StatusOK, map[string]any{
		"message": message,
	})
}

func (s *Server) handleChatRead(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}

	var request chatReadRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	if request.RoomID <= 0 || request.UserID <= 0 {
		writeError(w, http.StatusBadRequest, "缺少已读所需的房间或用户信息")
		return
	}
	if err := s.store.MarkChatRoomRead(r.Context(), request.RoomID, request.UserID); err != nil {
		writeError(w, http.StatusInternalServerError, "更新已读状态失败")
		return
	}
	s.chat.BroadcastRoom(request.RoomID, map[string]any{
		"type":    "read",
		"room_id": request.RoomID,
		"user_id": request.UserID,
	})
	writeJSON(w, http.StatusOK, map[string]any{
		"ok": true,
	})
}

func (s *Server) handleChatWebSocket(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	roomID, err := validateChatRoomID(r.URL.Query().Get("room_id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	nickname := strings.TrimSpace(r.URL.Query().Get("nickname"))
	if nickname == "" {
		nickname = "匿名用户"
	}
	if utf8.RuneCountInString(nickname) > nicknameMaxRunes {
		nickname = string([]rune(nickname)[:nicknameMaxRunes])
	}
	if !isWebSocketUpgrade(r) {
		writeError(w, http.StatusBadRequest, "需要 WebSocket 连接")
		return
	}
	key := strings.TrimSpace(r.Header.Get("Sec-WebSocket-Key"))
	if key == "" {
		writeError(w, http.StatusBadRequest, "WebSocket 握手失败")
		return
	}
	hijacker, ok := w.(http.Hijacker)
	if !ok {
		writeError(w, http.StatusInternalServerError, "当前服务不支持 WebSocket")
		return
	}
	conn, rw, err := hijacker.Hijack()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "WebSocket 连接失败")
		return
	}

	accept := webSocketAcceptKey(key)
	_, err = rw.WriteString("HTTP/1.1 101 Switching Protocols\r\n" +
		"Upgrade: websocket\r\n" +
		"Connection: Upgrade\r\n" +
		"Sec-WebSocket-Accept: " + accept + "\r\n\r\n")
	if err != nil {
		conn.Close()
		return
	}
	if err := rw.Flush(); err != nil {
		conn.Close()
		return
	}

	client := &chatClient{
		conn:     conn,
		roomID:   roomID,
		userID:   parsePositiveInt64(r.URL.Query().Get("user_id")),
		nickname: nickname,
		phone:    normalizePresencePhone(r.URL.Query().Get("phone")),
	}
	s.chat.Add(client)
	go s.chat.ReadUntilClose(client, rw.Reader)
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

func validateChatRoomID(value string) (int64, error) {
	roomID := parsePositiveInt64(value)
	if roomID <= 0 {
		return 0, errors.New("请选择聊天室")
	}
	return roomID, nil
}

func validateChatMessageRequest(request chatMessageRequest) (models.ChatMessage, string, error) {
	if request.RoomID <= 0 {
		return models.ChatMessage{}, "", errors.New("请选择聊天室")
	}
	nickname := strings.TrimSpace(request.Nickname)
	if nickname == "" {
		return models.ChatMessage{}, "", errors.New("昵称不能为空")
	}
	if utf8.RuneCountInString(nickname) > nicknameMaxRunes {
		return models.ChatMessage{}, "", fmt.Errorf("昵称不能超过%d个字符", nicknameMaxRunes)
	}

	messageType := strings.TrimSpace(request.MessageType)
	if messageType == "" {
		messageType = chatMessageTypeText
	}
	if messageType != chatMessageTypeText && messageType != chatMessageTypeImage && messageType != chatMessageTypeAudio {
		return models.ChatMessage{}, "", errors.New("消息类型不支持")
	}

	content := strings.TrimSpace(request.Content)
	if content == "" && messageType == chatMessageTypeText {
		return models.ChatMessage{}, "", errors.New("消息不能为空")
	}
	if utf8.RuneCountInString(content) > chatMessageMaxRunes {
		return models.ChatMessage{}, "", fmt.Errorf("消息不能超过%d个字符", chatMessageMaxRunes)
	}
	attachmentName := strings.TrimSpace(request.AttachmentName)
	attachmentMime := strings.TrimSpace(request.AttachmentMime)
	attachmentData := strings.TrimSpace(request.AttachmentData)
	if messageType == chatMessageTypeImage || messageType == chatMessageTypeAudio {
		if attachmentData == "" || attachmentMime == "" {
			return models.ChatMessage{}, "", errors.New("请先选择要发送的文件")
		}
		if len(attachmentData) > chatAttachmentMaxBytes {
			return models.ChatMessage{}, "", errors.New("文件过大，请选择较小的图片或音频")
		}
		if messageType == chatMessageTypeImage && !strings.HasPrefix(attachmentMime, "image/") {
			return models.ChatMessage{}, "", errors.New("请选择图片文件")
		}
		if messageType == chatMessageTypeAudio && !strings.HasPrefix(attachmentMime, "audio/") {
			return models.ChatMessage{}, "", errors.New("请选择音频文件")
		}
		if content == "" {
			if messageType == chatMessageTypeImage {
				content = "[图片]"
			} else {
				content = "[语音]"
			}
		}
	} else {
		attachmentName = ""
		attachmentMime = ""
		attachmentData = ""
	}

	phone := ""
	if strings.TrimSpace(request.Phone) != "" {
		normalized, err := validatePhone(request.Phone)
		if err != nil {
			return models.ChatMessage{}, "", err
		}
		phone = normalized
	}
	if request.UserID <= 0 && phone == "" {
		return models.ChatMessage{}, "", errors.New("请先登录后发送消息")
	}

	return models.ChatMessage{
		RoomID:         request.RoomID,
		UserID:         request.UserID,
		Nickname:       nickname,
		Content:        content,
		MessageType:    messageType,
		AttachmentName: attachmentName,
		AttachmentMime: attachmentMime,
		AttachmentData: attachmentData,
		Mentions:       normalizeMentions(request.Mentions),
	}, phone, nil
}

func normalizeMentions(mentions []string) []string {
	seen := make(map[string]struct{})
	normalized := make([]string, 0, len(mentions))
	for _, mention := range mentions {
		mention = strings.TrimSpace(strings.TrimPrefix(mention, "@"))
		if mention == "" || utf8.RuneCountInString(mention) > nicknameMaxRunes {
			continue
		}
		if _, ok := seen[mention]; ok {
			continue
		}
		seen[mention] = struct{}{}
		normalized = append(normalized, mention)
	}
	return normalized
}

func normalizeChatSearchQuery(query string) string {
	query = strings.TrimSpace(query)
	if utf8.RuneCountInString(query) > 40 {
		query = string([]rune(query)[:40])
	}
	return query
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

func newChatHub() *chatHub {
	return &chatHub{
		clients: make(map[*chatClient]struct{}),
	}
}

func (h *chatHub) Add(client *chatClient) {
	h.mu.Lock()
	h.clients[client] = struct{}{}
	h.mu.Unlock()

	h.BroadcastMembers(client.roomID)
}

func (h *chatHub) Remove(client *chatClient) {
	removed := false
	h.mu.Lock()
	if _, ok := h.clients[client]; ok {
		delete(h.clients, client)
		_ = client.conn.Close()
		removed = true
	}
	h.mu.Unlock()

	if removed {
		h.BroadcastMembers(client.roomID)
	}
}

func (h *chatHub) BroadcastRoom(roomID int64, event map[string]any) {
	payload, err := json.Marshal(event)
	if err != nil {
		return
	}

	h.mu.Lock()
	clients := make([]*chatClient, 0, len(h.clients))
	for client := range h.clients {
		if client.roomID == roomID {
			clients = append(clients, client)
		}
	}
	h.mu.Unlock()

	for _, client := range clients {
		if err := writeWebSocketText(client, payload); err != nil {
			h.Remove(client)
		}
	}
}

func (h *chatHub) BroadcastMembers(roomID int64) {
	h.BroadcastRoom(roomID, map[string]any{
		"type":    "members",
		"room_id": roomID,
		"members": h.Members(roomID),
	})
}

func (h *chatHub) Members(roomID int64) []models.ChatMember {
	h.mu.Lock()
	defer h.mu.Unlock()

	seen := make(map[string]struct{})
	members := make([]models.ChatMember, 0)
	for client := range h.clients {
		if client.roomID != roomID {
			continue
		}
		key := fmt.Sprintf("conn:%p", client)
		if client.userID > 0 {
			key = fmt.Sprintf("user:%d", client.userID)
		} else if client.phone != "" {
			key = "phone:" + client.phone
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		members = append(members, models.ChatMember{
			UserID:   client.userID,
			Nickname: client.nickname,
			Phone:    client.phone,
		})
	}
	return members
}

func (h *chatHub) ReadUntilClose(client *chatClient, reader *bufio.Reader) {
	defer h.Remove(client)

	for {
		opcode, payload, err := readWebSocketFrame(reader)
		if err != nil {
			return
		}
		switch opcode {
		case webSocketOpcodeClose:
			return
		case webSocketOpcodePing:
			if err := writeWebSocketFrame(client, webSocketOpcodePong, payload); err != nil {
				return
			}
		}
	}
}

func parsePositiveInt(value string, fallback int, max int) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || parsed <= 0 {
		return fallback
	}
	if max > 0 && parsed > max {
		return max
	}
	return parsed
}

func parsePositiveInt64(value string) int64 {
	parsed, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
	if err != nil || parsed <= 0 {
		return 0
	}
	return parsed
}

func parseIDFromPrefix(path string, prefix string) (int64, bool) {
	if !strings.HasPrefix(path, prefix) {
		return 0, false
	}
	id := parsePositiveInt64(strings.TrimPrefix(path, prefix))
	return id, id > 0
}

func isWebSocketUpgrade(r *http.Request) bool {
	return strings.EqualFold(r.Header.Get("Upgrade"), "websocket") &&
		headerContainsToken(r.Header.Get("Connection"), "upgrade") &&
		r.Header.Get("Sec-WebSocket-Version") == "13"
}

func headerContainsToken(header string, token string) bool {
	for _, part := range strings.Split(header, ",") {
		if strings.EqualFold(strings.TrimSpace(part), token) {
			return true
		}
	}
	return false
}

func webSocketAcceptKey(key string) string {
	hash := sha1.Sum([]byte(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
	return base64.StdEncoding.EncodeToString(hash[:])
}

func readWebSocketFrame(reader *bufio.Reader) (byte, []byte, error) {
	var header [2]byte
	if _, err := io.ReadFull(reader, header[:]); err != nil {
		return 0, nil, err
	}

	opcode := header[0] & 0x0F
	masked := header[1]&0x80 != 0
	length := uint64(header[1] & 0x7F)
	switch length {
	case 126:
		var extended [2]byte
		if _, err := io.ReadFull(reader, extended[:]); err != nil {
			return 0, nil, err
		}
		length = uint64(binary.BigEndian.Uint16(extended[:]))
	case 127:
		var extended [8]byte
		if _, err := io.ReadFull(reader, extended[:]); err != nil {
			return 0, nil, err
		}
		length = binary.BigEndian.Uint64(extended[:])
	}

	if length > 64*1024 {
		return 0, nil, errors.New("websocket frame too large")
	}

	var maskKey [4]byte
	if masked {
		if _, err := io.ReadFull(reader, maskKey[:]); err != nil {
			return 0, nil, err
		}
	}

	payload := make([]byte, length)
	if length > 0 {
		if _, err := io.ReadFull(reader, payload); err != nil {
			return 0, nil, err
		}
	}
	if masked {
		for index := range payload {
			payload[index] ^= maskKey[index%len(maskKey)]
		}
	}
	return opcode, payload, nil
}

func writeWebSocketText(client *chatClient, payload []byte) error {
	return writeWebSocketFrame(client, webSocketOpcodeText, payload)
}

func writeWebSocketFrame(client *chatClient, opcode byte, payload []byte) error {
	client.mu.Lock()
	defer client.mu.Unlock()

	header := make([]byte, 0, 10)
	header = append(header, 0x80|opcode)
	length := len(payload)
	switch {
	case length < 126:
		header = append(header, byte(length))
	case length <= 65535:
		header = append(header, 126, byte(length>>8), byte(length))
	default:
		header = append(header, 127)
		var extended [8]byte
		binary.BigEndian.PutUint64(extended[:], uint64(length))
		header = append(header, extended[:]...)
	}

	if _, err := client.conn.Write(header); err != nil {
		return err
	}
	if length == 0 {
		return nil
	}
	_, err := client.conn.Write(payload)
	return err
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
