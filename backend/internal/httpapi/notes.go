package httpapi

import (
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/hml/media-player/backend/internal/database"
	"github.com/jackc/pgx/v5"
)

const (
	noteTitleMaxLength   = 120
	noteContentMaxLength = 200_000
	folderNameMaxLength  = 40
)

type noteFolderRequest struct {
	UserID   int64  `json:"user_id"`
	ParentID *int64 `json:"parent_id"`
	Name     string `json:"name"`
}

type noteRequest struct {
	UserID   int64  `json:"user_id"`
	FolderID *int64 `json:"folder_id"`
	Title    string `json:"title"`
	Content  string `json:"content"`
}

func (s *Server) handleNoteFolders(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		viewerID := s.optionalSessionUserID(r)
		folders, err := s.store.ListNoteFolders(r.Context(), viewerID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "读取文件夹失败")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"folders": folders})
	case http.MethodPost:
		var request noteFolderRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			writeError(w, http.StatusBadRequest, "请求格式不正确")
			return
		}
		userID, ok := s.requireMatchingSessionUserID(w, r, request.UserID, "请先登录后创建文件夹")
		if !ok {
			return
		}
		name, err := validateNoteText(request.Name, 1, folderNameMaxLength, "文件夹名称")
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		folder, err := s.store.CreateNoteFolder(r.Context(), userID, request.ParentID, name)
		writeNoteMutationResult(w, folder, err, "创建文件夹失败")
	default:
		methodNotAllowed(w)
	}
}

func (s *Server) handleNoteFolderRoute(w http.ResponseWriter, r *http.Request) {
	folderID, ok := pathID(w, strings.TrimPrefix(r.URL.Path, "/api/note-folders/"), "文件夹不存在")
	if !ok {
		return
	}

	switch r.Method {
	case http.MethodPatch, http.MethodPut:
		var request noteFolderRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			writeError(w, http.StatusBadRequest, "请求格式不正确")
			return
		}
		userID, ok := s.requireMatchingSessionUserID(w, r, request.UserID, "请先登录后编辑文件夹")
		if !ok {
			return
		}
		name, err := validateNoteText(request.Name, 1, folderNameMaxLength, "文件夹名称")
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		folder, err := s.store.UpdateNoteFolder(r.Context(), userID, folderID, request.ParentID, name)
		writeNoteMutationResult(w, folder, err, "更新文件夹失败")
	case http.MethodDelete:
		userID, ok := s.requiredSessionQueryUserID(w, r, "请先登录后删除文件夹")
		if !ok {
			return
		}
		err := s.store.DeleteNoteFolder(r.Context(), userID, folderID)
		writeNoteDeleteResult(w, err, "删除文件夹失败")
	default:
		methodNotAllowed(w)
	}
}

func (s *Server) handleNotes(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		viewerID := s.optionalSessionUserID(r)
		folderID, unfiled, err := noteFolderFilter(r)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		query := strings.TrimSpace(r.URL.Query().Get("q"))
		notes, err := s.store.ListNotes(r.Context(), viewerID, folderID, unfiled, query)
		if err != nil {
			log.Printf("list notes failed: viewer_id=%d folder_id=%v unfiled=%t query=%q error=%v", viewerID, folderID, unfiled, query, err)
			writeError(w, http.StatusInternalServerError, "读取文档失败")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"notes": notes})
	case http.MethodPost:
		var request noteRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			writeError(w, http.StatusBadRequest, "请求格式不正确")
			return
		}
		userID, ok := s.requireMatchingSessionUserID(w, r, request.UserID, "请先登录后创建文档")
		if !ok {
			return
		}
		title, content, err := validateNoteDraft(request.Title, request.Content)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		note, err := s.store.CreateNote(r.Context(), userID, request.FolderID, title, content)
		writeNoteMutationResult(w, note, err, "创建文档失败")
	default:
		methodNotAllowed(w)
	}
}

func (s *Server) handleNoteRoute(w http.ResponseWriter, r *http.Request) {
	path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/notes/"), "/")
	parts := strings.Split(path, "/")
	if len(parts) == 0 || parts[0] == "" {
		writeError(w, http.StatusNotFound, "文档不存在")
		return
	}
	noteID, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil || noteID <= 0 {
		writeError(w, http.StatusNotFound, "文档不存在")
		return
	}
	if len(parts) > 1 {
		writeError(w, http.StatusNotFound, "文档不存在")
		return
	}

	switch r.Method {
	case http.MethodGet:
		note, err := s.store.GetNote(r.Context(), s.optionalSessionUserID(r), noteID)
		writeNoteReadResult(w, map[string]any{"note": note}, err, "读取文档失败")
	case http.MethodPatch, http.MethodPut:
		var request noteRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			writeError(w, http.StatusBadRequest, "请求格式不正确")
			return
		}
		userID, ok := s.requireMatchingSessionUserID(w, r, request.UserID, "请先登录后编辑文档")
		if !ok {
			return
		}
		title, content, err := validateNoteDraft(request.Title, request.Content)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		note, err := s.store.UpdateNote(r.Context(), userID, noteID, request.FolderID, title, content)
		writeNoteMutationResult(w, note, err, "更新文档失败")
	case http.MethodDelete:
		userID, ok := s.requiredSessionQueryUserID(w, r, "请先登录后删除文档")
		if !ok {
			return
		}
		err = s.store.DeleteNote(r.Context(), userID, noteID)
		writeNoteDeleteResult(w, err, "删除文档失败")
	default:
		methodNotAllowed(w)
	}
}

func noteFolderFilter(r *http.Request) (*int64, bool, error) {
	value := strings.TrimSpace(r.URL.Query().Get("folder_id"))
	if value == "" || value == "all" {
		return nil, false, nil
	}
	if value == "unfiled" {
		return nil, true, nil
	}
	folderID, err := strconv.ParseInt(value, 10, 64)
	if err != nil || folderID <= 0 {
		return nil, false, errors.New("文件夹不存在")
	}
	return &folderID, false, nil
}

func pathID(w http.ResponseWriter, path string, notFoundMessage string) (int64, bool) {
	id, err := strconv.ParseInt(strings.Trim(path, "/"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusNotFound, notFoundMessage)
		return 0, false
	}
	return id, true
}

func validateNoteDraft(title, content string) (string, string, error) {
	title, err := validateNoteText(title, 1, noteTitleMaxLength, "标题")
	if err != nil {
		return "", "", err
	}
	content = strings.TrimRight(strings.ReplaceAll(content, "\r\n", "\n"), " \t\r\n")
	if len([]rune(content)) > noteContentMaxLength {
		return "", "", errors.New("正文太长")
	}
	return title, content, nil
}

func validateNoteText(value string, minLength, maxLength int, label string) (string, error) {
	value = strings.TrimSpace(value)
	length := len([]rune(value))
	if length < minLength {
		return "", errors.New(label + "不能为空")
	}
	if length > maxLength {
		return "", errors.New(label + "太长")
	}
	return value, nil
}

func writeNoteReadResult(w http.ResponseWriter, payload any, err error, fallback string) {
	if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "文档不存在")
		return
	}
	if err != nil {
		log.Printf("read note failed: fallback=%q error=%v", fallback, err)
		writeError(w, http.StatusInternalServerError, fallback)
		return
	}
	writeJSON(w, http.StatusOK, payload)
}

func writeNoteMutationResult(w http.ResponseWriter, payload any, err error, fallback string) {
	if errors.Is(err, database.ErrForbidden) {
		writeError(w, http.StatusForbidden, "没有权限执行此操作")
		return
	}
	if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "目标不存在")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, fallback)
		return
	}
	writeJSON(w, http.StatusOK, payload)
}

func writeNoteDeleteResult(w http.ResponseWriter, err error, fallback string) {
	if errors.Is(err, database.ErrForbidden) {
		writeError(w, http.StatusForbidden, "没有权限执行此操作")
		return
	}
	if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "目标不存在")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, fallback)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
