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
	SizeBytes       int64       `json:"size_bytes"`
	DurationSeconds *int        `json:"duration_seconds"`
	ModifiedAt      time.Time   `json:"modified_at"`
	StreamURL       string      `json:"stream_url"`
	Lyrics          []LyricLine `json:"lyrics"`
}

type LyricLine struct {
	TimeSeconds *float64 `json:"time_seconds"`
	Text        string   `json:"text"`
}

type LibrarySetting struct {
	Path      string    `json:"path"`
	UpdatedAt time.Time `json:"updated_at"`
}

type ScanResult struct {
	RootPath string   `json:"root_path"`
	Found    int      `json:"found"`
	Imported int      `json:"imported"`
	Skipped  int      `json:"skipped"`
	Errors   []string `json:"errors,omitempty"`
}
