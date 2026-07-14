package httpapi

import (
	"database/sql"
	"errors"
	"net/http"
	"time"

	"github.com/hml/media-player/backend/internal/models"
	"github.com/jackc/pgx/v5"
)

func (s *Server) optionalSessionUser(r *http.Request) (models.User, bool) {
	userID, ok := s.authSessionUserID(r.Context(), authSessionToken(r), time.Now())
	if !ok {
		return models.User{}, false
	}
	user, err := s.store.GetUserByID(r.Context(), userID)
	if err != nil {
		return models.User{}, false
	}
	return user, true
}

func (s *Server) requireSessionUser(w http.ResponseWriter, r *http.Request, message string) (models.User, bool) {
	userID, ok := s.requireSessionUserID(w, r, message)
	if !ok {
		return models.User{}, false
	}
	user, err := s.store.GetUserByID(r.Context(), userID)
	if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusUnauthorized, message)
		return models.User{}, false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "校验用户权限失败")
		return models.User{}, false
	}
	return user, true
}

func (s *Server) requireMatchingSessionUser(w http.ResponseWriter, r *http.Request, requestedUserID int64, message string) (models.User, bool) {
	sessionUserID, ok := s.requireMatchingSessionUserID(w, r, requestedUserID, message)
	if !ok {
		return models.User{}, false
	}
	user, err := s.store.GetUserByID(r.Context(), sessionUserID)
	if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusUnauthorized, message)
		return models.User{}, false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "校验用户权限失败")
		return models.User{}, false
	}
	return user, true
}

func (s *Server) requireAudioManager(w http.ResponseWriter, r *http.Request, message string) (models.User, bool) {
	user, ok := s.requireSessionUser(w, r, message)
	if !ok {
		return models.User{}, false
	}
	if !models.UserCanManageAudioFiles(user.Role) {
		writeError(w, http.StatusForbidden, "当前用户无权管理服务器文件")
		return models.User{}, false
	}
	return user, true
}

func (s *Server) requireSuperAdmin(w http.ResponseWriter, r *http.Request) (models.User, bool) {
	user, ok := s.requireSessionUser(w, r, "请先登录后管理用户")
	if !ok {
		return models.User{}, false
	}
	if !models.UserCanManageUsers(user.Role) {
		writeError(w, http.StatusForbidden, "仅超级管理员可以管理用户")
		return models.User{}, false
	}
	return user, true
}

func userCanAccessTrack(user models.User, track models.Track) bool {
	return track.Quality != models.TrackQualityLossless || models.UserCanPlayLossless(user.Role)
}

func filterTracksForUser(user models.User, tracks []models.Track) []models.Track {
	if models.UserCanPlayLossless(user.Role) {
		return tracks
	}
	filtered := make([]models.Track, 0, len(tracks))
	for _, track := range tracks {
		if track.Quality != models.TrackQualityLossless {
			filtered = append(filtered, track)
		}
	}
	return filtered
}
