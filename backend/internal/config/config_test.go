package config

import (
	"testing"
	"time"
)

func TestParseNestedLibraryQualityDirectories(t *testing.T) {
	values, _, err := parseConfigContentForTest(`
library:
  shared_lyrics_directory: "D:/Lyrics/Common"
  lossless:
    music_directory: "D:/Music"
    lyrics_directory: "D:/Lyrics/Lossless"
  lossy:
    music_directory: "D:/MusicLossy"
    lyrics_directory: "D:/Lyrics/Lossy"
  watch_poll_interval: "2m"
client_apps:
  directory: "D:/Apps"
`)
	if err != nil {
		t.Fatal(err)
	}

	var cfg Config
	if err := applyYAML(&cfg, values); err != nil {
		t.Fatal(err)
	}

	if cfg.SharedLyricsDirectory != "D:/Lyrics/Common" {
		t.Fatalf("shared lyrics = %q", cfg.SharedLyricsDirectory)
	}
	if cfg.LosslessMusicDirectory != "D:/Music" {
		t.Fatalf("lossless music = %q", cfg.LosslessMusicDirectory)
	}
	if cfg.LosslessLyricsDirectory != "D:/Lyrics/Lossless" {
		t.Fatalf("lossless lyrics = %q", cfg.LosslessLyricsDirectory)
	}
	if cfg.LossyMusicDirectory != "D:/MusicLossy" {
		t.Fatalf("lossy music = %q", cfg.LossyMusicDirectory)
	}
	if cfg.LossyLyricsDirectory != "D:/Lyrics/Lossy" {
		t.Fatalf("lossy lyrics = %q", cfg.LossyLyricsDirectory)
	}
	if cfg.ClientAppsDirectory != "D:/Apps" {
		t.Fatalf("client apps = %q", cfg.ClientAppsDirectory)
	}
	if cfg.LibraryWatchPollInterval != 2*time.Minute {
		t.Fatalf("poll interval = %s", cfg.LibraryWatchPollInterval)
	}
}

func parseConfigContentForTest(content string) (map[string]string, string, error) {
	values, err := parseSimpleYAML(content)
	return values, "", err
}
