package config

import (
	"bufio"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

type Config struct {
	Addr            string
	DatabaseURL     string
	CORSOrigin      string
	MusicDirectory  string
	LyricsDirectory string
	ConfigPath      string
}

func Load() (Config, error) {
	cfg := Config{
		Addr:        getenv("SERVER_ADDR", ":8080"),
		DatabaseURL: getenv("DATABASE_URL", "postgres://media_player:media_player@127.0.0.1:15432/media_player?sslmode=disable"),
		CORSOrigin:  getenv("CORS_ORIGIN", "http://localhost:5173"),
	}

	values, path, err := loadYAMLValues()
	if err != nil {
		return Config{}, err
	}
	cfg.ConfigPath = path
	applyYAML(&cfg, values)

	cfg.Addr = getenv("SERVER_ADDR", cfg.Addr)
	cfg.DatabaseURL = getenv("DATABASE_URL", cfg.DatabaseURL)
	cfg.CORSOrigin = getenv("CORS_ORIGIN", cfg.CORSOrigin)
	cfg.MusicDirectory = getenv("MUSIC_DIRECTORY", cfg.MusicDirectory)
	cfg.LyricsDirectory = getenv("LYRICS_DIRECTORY", cfg.LyricsDirectory)
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

func applyYAML(cfg *Config, values map[string]string) {
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
		}
	}
}
