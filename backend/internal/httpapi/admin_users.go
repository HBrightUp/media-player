package httpapi

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/hml/media-player/backend/internal/database"
	"github.com/hml/media-player/backend/internal/models"
	"github.com/jackc/pgx/v5"
)

const nicknameMaxRunes = 24

type adminUserRequest struct {
	Phone    string `json:"phone"`
	Nickname string `json:"nickname"`
	Password string `json:"password"`
	Role     string `json:"role"`
}

type adminUserRoleRequest struct {
	Role string `json:"role"`
}

func (s *Server) handleAdminUsers(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireSuperAdmin(w, r); !ok {
		return
	}

	switch r.Method {
	case http.MethodGet:
		users, err := s.store.ListUsersWithLastActive(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, "读取用户列表失败")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"users": publicManagedUsers(users)})

	case http.MethodPost:
		var request adminUserRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			writeError(w, http.StatusBadRequest, "请求格式不正确")
			return
		}
		phone, err := validatePhone(request.Phone)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		nickname, err := validateNickname(request.Nickname)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		password, err := validatePassword(request.Password)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		role, err := validateAssignableUserRole(request.Role)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		passwordHash, passwordSalt, err := hashPassword(password)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "生成用户密码失败")
			return
		}
		user, err := s.store.CreateUser(r.Context(), models.User{
			Phone:        phone,
			CountryCode:  "+86",
			Nickname:     nickname,
			Role:         role,
			PasswordHash: passwordHash,
			PasswordSalt: passwordSalt,
		})
		if errors.Is(err, database.ErrUserAlreadyExists) {
			writeError(w, http.StatusConflict, "手机号已存在")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "创建用户失败")
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"user": publicManagedUser(user)})

	default:
		methodNotAllowed(w)
	}
}

func (s *Server) handleAdminUserRoute(w http.ResponseWriter, r *http.Request) {
	operator, ok := s.requireSuperAdmin(w, r)
	if !ok {
		return
	}
	userID, ok := parseAdminUserID(r.URL.Path)
	if !ok {
		http.NotFound(w, r)
		return
	}

	switch r.Method {
	case http.MethodPatch:
		s.updateAdminUserRole(w, r, userID)
	case http.MethodDelete:
		s.deleteAdminUser(w, r, operator, userID)
	default:
		methodNotAllowed(w)
	}
}

func (s *Server) updateAdminUserRole(w http.ResponseWriter, r *http.Request, userID int64) {
	var request adminUserRoleRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	role, err := validateAssignableUserRole(request.Role)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	existing, err := s.store.GetUserByID(r.Context(), userID)
	if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "用户不存在")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "读取用户失败")
		return
	}
	if models.NormalizeUserRole(existing.Role) == models.UserRoleSuperAdmin {
		writeError(w, http.StatusForbidden, "不能在这里修改超级管理员")
		return
	}

	user, err := s.store.UpdateUserRole(r.Context(), userID, role)
	if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "用户不存在")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "更新用户角色失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": publicManagedUser(user)})
}

func (s *Server) deleteAdminUser(w http.ResponseWriter, r *http.Request, operator models.User, userID int64) {
	if operator.ID == userID {
		writeError(w, http.StatusForbidden, "不能删除当前登录的超级管理员")
		return
	}

	existing, err := s.store.GetUserByID(r.Context(), userID)
	if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "用户不存在")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "读取用户失败")
		return
	}
	if models.NormalizeUserRole(existing.Role) == models.UserRoleSuperAdmin {
		writeError(w, http.StatusForbidden, "不能删除超级管理员")
		return
	}

	deleted, err := s.store.DeleteUser(r.Context(), userID)
	if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "用户不存在")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "删除用户失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":   true,
		"user": publicManagedUser(deleted),
	})
}

func validateNickname(value string) (string, error) {
	nickname := strings.TrimSpace(value)
	if nickname == "" {
		return "", errors.New("昵称不能为空")
	}
	if utf8.RuneCountInString(nickname) > nicknameMaxRunes {
		return "", errors.New("昵称不能超过24个字符")
	}
	return nickname, nil
}

func validateAssignableUserRole(role string) (string, error) {
	switch strings.TrimSpace(strings.ToLower(role)) {
	case models.UserRoleAdmin:
		return models.UserRoleAdmin, nil
	case models.UserRoleVIP:
		return models.UserRoleVIP, nil
	case models.UserRoleUser:
		return models.UserRoleUser, nil
	default:
		return "", errors.New("只能设置为普通管理员、VIP用户或普通用户")
	}
}

func publicManagedUsers(users []models.User) []map[string]any {
	result := make([]map[string]any, 0, len(users))
	for _, user := range users {
		result = append(result, publicManagedUser(user))
	}
	return result
}

func publicManagedUser(user models.User) map[string]any {
	return map[string]any{
		"id":             user.ID,
		"phone":          user.Phone,
		"country_code":   user.CountryCode,
		"nickname":       user.Nickname,
		"role":           models.NormalizeUserRole(user.Role),
		"created_at":     user.CreatedAt,
		"updated_at":     user.UpdatedAt,
		"last_active_at": user.LastActiveAt,
	}
}

func parseAdminUserID(path string) (int64, bool) {
	const prefix = "/api/admin/users/"
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
