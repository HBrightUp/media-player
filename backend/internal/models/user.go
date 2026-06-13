package models

import "time"

type User struct {
	ID              int64     `json:"id"`
	Phone           string    `json:"phone"`
	CountryCode     string    `json:"country_code"`
	Nickname        string    `json:"nickname"`
	PasswordHash    string    `json:"-"`
	PasswordSalt    string    `json:"-"`
	TermsAcceptedAt time.Time `json:"terms_accepted_at"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}
