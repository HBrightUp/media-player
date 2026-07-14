package models

import (
	"strings"
	"time"
)

type User struct {
	ID              int64     `json:"id"`
	Phone           string    `json:"phone"`
	CountryCode     string    `json:"country_code"`
	Nickname        string    `json:"nickname"`
	Role            string    `json:"role"`
	PasswordHash    string    `json:"-"`
	PasswordSalt    string    `json:"-"`
	TermsAcceptedAt time.Time `json:"terms_accepted_at"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

const (
	UserRoleSuperAdmin = "super_admin"
	UserRoleAdmin      = "admin"
	UserRoleVIP        = "vip"
	UserRoleUser       = "user"
)

func NormalizeUserRole(role string) string {
	switch strings.TrimSpace(strings.ToLower(role)) {
	case UserRoleSuperAdmin:
		return UserRoleSuperAdmin
	case UserRoleAdmin:
		return UserRoleAdmin
	case UserRoleVIP:
		return UserRoleVIP
	default:
		return UserRoleUser
	}
}

func UserCanManageUsers(role string) bool {
	return NormalizeUserRole(role) == UserRoleSuperAdmin
}

func UserCanManageAudioFiles(role string) bool {
	switch NormalizeUserRole(role) {
	case UserRoleSuperAdmin, UserRoleAdmin:
		return true
	default:
		return false
	}
}

func UserCanPlayLossless(role string) bool {
	switch NormalizeUserRole(role) {
	case UserRoleSuperAdmin, UserRoleAdmin, UserRoleVIP:
		return true
	default:
		return false
	}
}
