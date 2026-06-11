package httpapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/hml/media-player/backend/internal/database"
	"github.com/hml/media-player/backend/internal/library"
	"github.com/jackc/pgx/v5"
)

const musicDirectoryKey = "music_directory"

type Server struct {
	store      *database.Store
	scanner    *library.Scanner
	corsOrigin string
}

type setLibraryRequest struct {
	Path string `json:"path"`
}

func New(store *database.Store, scanner *library.Scanner, corsOrigin string) *Server {
	return &Server{
		store:      store,
		scanner:    scanner,
		corsOrigin: corsOrigin,
	}
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", s.handleHealth)
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
