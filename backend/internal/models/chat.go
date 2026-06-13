package models

import "time"

type ChatRoom struct {
	ID          int64     `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	CreatedAt   time.Time `json:"created_at"`
}

type ChatMember struct {
	UserID   int64  `json:"user_id,omitempty"`
	Nickname string `json:"nickname"`
	Phone    string `json:"phone,omitempty"`
}

type ChatMessage struct {
	ID             int64      `json:"id"`
	RoomID         int64      `json:"room_id"`
	UserID         int64      `json:"user_id,omitempty"`
	Nickname       string     `json:"nickname"`
	Content        string     `json:"content"`
	MessageType    string     `json:"message_type"`
	AttachmentName string     `json:"attachment_name,omitempty"`
	AttachmentMime string     `json:"attachment_mime,omitempty"`
	AttachmentData string     `json:"attachment_data,omitempty"`
	Mentions       []string   `json:"mentions"`
	ReadBy         []int64    `json:"read_by"`
	RecalledAt     *time.Time `json:"recalled_at,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
}
