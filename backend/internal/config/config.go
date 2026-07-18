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
	RedisURL                 string
	RedisAddr                string
	RedisPassword            string
	RedisDB                  int
	RedisKeyPrefix           string
	CORSOrigin               string
	MusicDirectory           string
	LyricsDirectory          string
	SharedLyricsDirectory    string
	LosslessMusicDirectory   string
	LosslessLyricsDirectory  string
	LossyMusicDirectory      string
	LossyLyricsDirectory     string
	LibraryAutoScanInterval  time.Duration
	LibraryWatchPollInterval time.Duration
	LibraryWatchDebounce     time.Duration
	ConfigPath               string
}

func Load() (Config, error) {
	cfg := Config{
		Addr:                     getenv("SERVER_ADDR", ":9000"),
		DatabaseURL:              getenv("DATABASE_URL", "postgres://media_player:media_player@127.0.0.1:15432/media_player?sslmode=disable"),
		RedisAddr:                getenv("REDIS_ADDR", ""),
		RedisKeyPrefix:           "media-player",
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
	cfg.RedisURL = getenv("REDIS_URL", cfg.RedisURL)
	cfg.RedisAddr = getenv("REDIS_ADDR", cfg.RedisAddr)
	cfg.RedisPassword = getenv("REDIS_PASSWORD", cfg.RedisPassword)
	cfg.RedisKeyPrefix = getenv("REDIS_KEY_PREFIX", cfg.RedisKeyPrefix)
	cfg.CORSOrigin = getenv("CORS_ORIGIN", cfg.CORSOrigin)
	cfg.MusicDirectory = getenv("MUSIC_DIRECTORY", cfg.MusicDirectory)
	cfg.LyricsDirectory = getenv("LYRICS_DIRECTORY", cfg.LyricsDirectory)
	cfg.SharedLyricsDirectory = getenv("SHARED_LYRICS_DIRECTORY", cfg.SharedLyricsDirectory)
	cfg.LosslessMusicDirectory = getenv("LOSSLESS_MUSIC_DIRECTORY", cfg.LosslessMusicDirectory)
	cfg.LosslessLyricsDirectory = getenv("LOSSLESS_LYRICS_DIRECTORY", cfg.LosslessLyricsDirectory)
	cfg.LossyMusicDirectory = getenv("LOSSY_MUSIC_DIRECTORY", cfg.LossyMusicDirectory)
	cfg.LossyLyricsDirectory = getenv("LOSSY_LYRICS_DIRECTORY", cfg.LossyLyricsDirectory)
	if cfg.LosslessMusicDirectory == "" {
		cfg.LosslessMusicDirectory = cfg.MusicDirectory
	}
	if cfg.LosslessLyricsDirectory == "" {
		cfg.LosslessLyricsDirectory = cfg.LyricsDirectory
	}
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
	if value := strings.TrimSpace(os.Getenv("REDIS_DB")); value != "" {
		db, err := strconv.Atoi(value)
		if err != nil || db < 0 {
			return Config{}, errors.New("REDIS_DB 必须是非负整数")
		}
		cfg.RedisDB = db
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
	type sectionFrame struct {
		indent int
		key    string
	}
	sections := make([]sectionFrame, 0)

	for scanner.Scan() {
		raw := scanner.Text()
		withoutComment := stripComment(raw)
		line := strings.TrimSpace(withoutComment)
		if line == "" {
			continue
		}

		key, value, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		key = normalizeKey(key)
		value = cleanValue(value)
		indent := leadingIndent(withoutComment)
		for len(sections) > 0 && indent <= sections[len(sections)-1].indent {
			sections = sections[:len(sections)-1]
		}

		fullKey := key
		if len(sections) > 0 {
			parts := make([]string, 0, len(sections)+1)
			for _, section := range sections {
				parts = append(parts, section.key)
			}
			parts = append(parts, key)
			fullKey = strings.Join(parts, ".")
		}
		if value == "" {
			sections = append(sections, sectionFrame{indent: indent, key: key})
			continue
		}
		values[fullKey] = value
	}
	return values, scanner.Err()
}

func leadingIndent(line string) int {
	indent := 0
	for _, char := range line {
		switch char {
		case ' ':
			indent++
		case '\t':
			indent += 2
		default:
			return indent
		}
	}
	return indent
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
		case "redis_url", "redis.url":
			cfg.RedisURL = value
		case "redis_addr", "redis.addr", "redis.address":
			cfg.RedisAddr = value
		case "redis_password", "redis.password":
			cfg.RedisPassword = value
		case "redis_key_prefix", "redis.key_prefix", "redis.prefix":
			cfg.RedisKeyPrefix = value
		case "redis_db", "redis.db":
			db, err := strconv.Atoi(value)
			if err != nil || db < 0 {
				return errors.New("redis.db 必须是非负整数")
			}
			cfg.RedisDB = db
		case "cors_origin", "server.cors_origin":
			cfg.CORSOrigin = value
		case "music_directory", "default_music_directory", "songs_directory", "library.music_directory", "library.default_directory":
			cfg.MusicDirectory = value
		case "lyrics_directory", "library.lyrics_directory":
			cfg.LyricsDirectory = value
		case "shared_lyrics_directory", "library.shared_lyrics_directory", "library.common_lyrics_directory":
			cfg.SharedLyricsDirectory = value
		case "lossless_music_directory", "library.lossless_music_directory", "library.lossless.music_directory", "library.lossless.music":
			cfg.LosslessMusicDirectory = value
		case "lossless_lyrics_directory", "library.lossless_lyrics_directory", "library.lossless.lyrics_directory", "library.lossless.lyrics":
			cfg.LosslessLyricsDirectory = value
		case "lossy_music_directory", "library.lossy_music_directory", "library.lossy.music_directory", "library.lossy.music":
			cfg.LossyMusicDirectory = value
		case "lossy_lyrics_directory", "library.lossy_lyrics_directory", "library.lossy.lyrics_directory", "library.lossy.lyrics":
			cfg.LossyLyricsDirectory = value
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
