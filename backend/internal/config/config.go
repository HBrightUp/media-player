package config

import (
	"bufio"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Addr                     string
	DatabaseURL              string
	CORSOrigin               string
	MusicDirectory           string
	LyricsDirectory          string
	LibraryAutoScanInterval  time.Duration
	LibraryWatchPollInterval time.Duration
	LibraryWatchDebounce     time.Duration
	ConfigPath               string
}

func Load() (Config, error) {
	cfg := Config{
		Addr:                     getenv("SERVER_ADDR", ":8080"),
		DatabaseURL:              getenv("DATABASE_URL", "postgres://media_player:media_player@127.0.0.1:15432/media_player?sslmode=disable"),
		CORSOrigin:               getenv("CORS_ORIGIN", "http://localhost:5173"),
		LibraryWatchPollInterval: time.Minute,
		LibraryWatchDebounce:     30 * time.Second,
	}

	values, path, err := loadYAMLValues()
	if err != nil {
		return Config{}, err
	}
	cfg.ConfigPath = path
	if err := applyYAML(&cfg, values); err != nil {
		return Config{}, err
	}

	cfg.Addr = getenv("SERVER_ADDR", cfg.Addr)
	cfg.DatabaseURL = getenv("DATABASE_URL", cfg.DatabaseURL)
	cfg.CORSOrigin = getenv("CORS_ORIGIN", cfg.CORSOrigin)
	cfg.MusicDirectory = getenv("MUSIC_DIRECTORY", cfg.MusicDirectory)
	cfg.LyricsDirectory = getenv("LYRICS_DIRECTORY", cfg.LyricsDirectory)
	if value := strings.TrimSpace(os.Getenv("LIBRARY_AUTO_SCAN_INTERVAL")); value != "" {
		interval, err := parseDurationValue(value)
		if err != nil {
			return Config{}, err
		}
		cfg.LibraryAutoScanInterval = interval
	}
	if value := strings.TrimSpace(os.Getenv("LIBRARY_WATCH_POLL_INTERVAL")); value != "" {
		interval, err := parseDurationValue(value)
		if err != nil {
			return Config{}, err
		}
		cfg.LibraryWatchPollInterval = interval
	}
	if value := strings.TrimSpace(os.Getenv("LIBRARY_WATCH_DEBOUNCE")); value != "" {
		interval, err := parseDurationValue(value)
		if err != nil {
			return Config{}, err
		}
		cfg.LibraryWatchDebounce = interval
	}
	return cfg, nil
}

func getenv(key, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}

func loadYAMLValues() (map[string]string, string, error) {
	for _, candidate := range configCandidates() {
		content, err := os.ReadFile(candidate)
		if err == nil {
			values, parseErr := parseSimpleYAML(string(content))
			return values, candidate, parseErr
		}
		if !errors.Is(err, os.ErrNotExist) {
			return nil, "", err
		}
	}
	return map[string]string{}, "", nil
}

func configCandidates() []string {
	if explicit := os.Getenv("CONFIG_PATH"); strings.TrimSpace(explicit) != "" {
		return []string{explicit}
	}
	return []string{
		"config.yaml",
		filepath.Join("..", "config.yaml"),
		filepath.Join("backend", "config.yaml"),
	}
}

func parseSimpleYAML(content string) (map[string]string, error) {
	values := make(map[string]string)
	scanner := bufio.NewScanner(strings.NewReader(content))
	section := ""

	for scanner.Scan() {
		raw := scanner.Text()
		line := strings.TrimSpace(stripComment(raw))
		if line == "" {
			continue
		}

		key, value, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		key = normalizeKey(key)
		value = cleanValue(value)

		isNested := len(raw) > 0 && (raw[0] == ' ' || raw[0] == '\t')
		if value == "" && !isNested {
			section = key
			continue
		}
		if isNested && section != "" {
			key = section + "." + key
		} else if !isNested {
			section = ""
		}
		values[key] = value
	}
	return values, scanner.Err()
}

func stripComment(line string) string {
	inSingleQuote := false
	inDoubleQuote := false
	for index, char := range line {
		switch char {
		case '\'':
			if !inDoubleQuote {
				inSingleQuote = !inSingleQuote
			}
		case '"':
			if !inSingleQuote {
				inDoubleQuote = !inDoubleQuote
			}
		case '#':
			if !inSingleQuote && !inDoubleQuote {
				return line[:index]
			}
		}
	}
	return line
}

func cleanValue(value string) string {
	value = strings.TrimSpace(value)
	value = strings.Trim(value, `"'`)
	return os.ExpandEnv(value)
}

func normalizeKey(key string) string {
	key = strings.TrimSpace(strings.ToLower(key))
	key = strings.ReplaceAll(key, "-", "_")
	return key
}

func applyYAML(cfg *Config, values map[string]string) error {
	for key, value := range values {
		if value == "" {
			continue
		}
		switch key {
		case "server_addr", "server.addr", "addr":
			cfg.Addr = value
		case "database_url", "database.url", "db_url":
			cfg.DatabaseURL = value
		case "cors_origin", "server.cors_origin":
			cfg.CORSOrigin = value
		case "music_directory", "default_music_directory", "songs_directory", "library.music_directory", "library.default_directory":
			cfg.MusicDirectory = value
		case "lyrics_directory", "library.lyrics_directory":
			cfg.LyricsDirectory = value
		case "library.auto_scan_interval", "auto_scan_interval":
			interval, err := parseDurationValue(value)
			if err != nil {
				return err
			}
			cfg.LibraryAutoScanInterval = interval
		case "library.watch_poll_interval", "watch_poll_interval":
			interval, err := parseDurationValue(value)
			if err != nil {
				return err
			}
			cfg.LibraryWatchPollInterval = interval
		case "library.watch_debounce", "watch_debounce":
			interval, err := parseDurationValue(value)
			if err != nil {
				return err
			}
			cfg.LibraryWatchDebounce = interval
		}
	}
	return nil
}

func parseDurationValue(value string) (time.Duration, error) {
	value = strings.TrimSpace(value)
	if value == "" || value == "0" {
		return 0, nil
	}
	if seconds, err := strconv.Atoi(value); err == nil {
		if seconds < 0 {
			return 0, errors.New("duration must not be negative")
		}
		return time.Duration(seconds) * time.Second, nil
	}
	duration, err := time.ParseDuration(value)
	if err != nil {
		return 0, err
	}
	if duration < 0 {
		return 0, errors.New("duration must not be negative")
	}
	return duration, nil
}
