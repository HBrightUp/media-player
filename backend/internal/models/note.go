package models

import "time"

type NoteFolder struct {
	ID            int64     `json:"id"`
	ParentID      *int64    `json:"parent_id"`
	OwnerUserID   int64     `json:"owner_user_id"`
	OwnerNickname string    `json:"owner_nickname"`
	Name          string    `json:"name"`
	SortOrder     int       `json:"sort_order"`
	NoteCount     int       `json:"note_count"`
	CanEdit       bool      `json:"can_edit"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

type Note struct {
	ID            int64     `json:"id"`
	FolderID      *int64    `json:"folder_id"`
	OwnerUserID   int64     `json:"owner_user_id"`
	OwnerNickname string    `json:"owner_nickname"`
	Title         string    `json:"title"`
	Content       string    `json:"content"`
	CanEdit       bool      `json:"can_edit"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}
