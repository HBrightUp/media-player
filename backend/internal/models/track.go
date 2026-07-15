package models

import "time"

type Track struct {
	ID              int64       `json:"id"`
	Path            string      `json:"-"`
	RelativePath    string      `json:"relative_path"`
	Filename        string      `json:"filename"`
	Title           string      `json:"title"`
	Artist          string      `json:"artist"`
	Album           string      `json:"album"`
	Format          string      `json:"format"`
	Quality         string      `json:"quality"`
	SizeBytes       int64       `json:"size_bytes"`
	DurationSeconds *int        `json:"duration_seconds"`
	ModifiedAt      time.Time   `json:"modified_at"`
	StreamURL       string      `json:"stream_url"`
	CoverURL        string      `json:"cover_url,omitempty"`
	Cover           *TrackCover `json:"-"`
	Lyrics          []LyricLine `json:"lyrics,omitempty"`
}

type TrackCover struct {
	MimeType  string `json:"mime_type"`
	Data      []byte `json:"-"`
	Hash      string `json:"hash"`
	SizeBytes int64  `json:"size_bytes"`
}

type TrackLyrics struct {
	TrackID     int64       `json:"track_id"`
	Format      string      `json:"format"`
	Content     string      `json:"content"`
	Lines       []LyricLine `json:"lines"`
	Source      string      `json:"source"`
	SourcePath  *string     `json:"-"`
	ContentHash string      `json:"-"`
	UpdatedAt   *time.Time  `json:"updated_at"`
}

type LyricLine struct {
	TimeSeconds *float64 `json:"time_seconds"`
	Text        string   `json:"text"`
}

type LibrarySetting struct {
	Path      string    `json:"path"`
	UpdatedAt time.Time `json:"updated_at"`
}

type FavoriteCategory struct {
	ID        int64     `json:"id"`
	UserID    int64     `json:"user_id"`
	Name      string    `json:"name"`
	SortOrder int       `json:"sort_order"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type TrackCategoryMembership struct {
	TrackID      int64  `json:"track_id"`
	CategoryID   int64  `json:"category_id"`
	CategoryName string `json:"category_name"`
}

type ScanResult struct {
	RootPath string   `json:"root_path"`
	Found    int      `json:"found"`
	Imported int      `json:"imported"`
	Skipped  int      `json:"skipped"`
	Errors   []string `json:"errors,omitempty"`
}

const (
	TrackQualityLossless = "lossless"
	TrackQualityLossy    = "lossy"
)
