package main

import (
	"context"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"runtime/debug"
	"strings"
	"syscall"
	"time"

	"github.com/hml/media-player/backend/internal/config"
	"github.com/hml/media-player/backend/internal/database"
	"github.com/hml/media-player/backend/internal/httpapi"
	"github.com/hml/media-player/backend/internal/library"
	"github.com/hml/media-player/backend/internal/models"
)

func main() {
	if logFile, err := os.OpenFile("backend-service.log", os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644); err == nil {
		defer logFile.Close()
		log.SetOutput(io.MultiWriter(logFile, os.Stderr))
	}
	defer func() {
		if value := recover(); value != nil {
			log.Printf("panic: %v\n%s", value, debug.Stack())
		}
	}()

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("load config: %v", err)
	}
	ctx, stopSignals := signal.NotifyContext(context.Background(), syscall.SIGTERM)
	defer stopSignals()

	store, err := database.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("database: %v", err)
	}
	defer store.Close()

	if err := store.Migrate(ctx); err != nil {
		log.Fatalf("migrate database: %v", err)
	}

	scanner := library.NewScanner(store, cfg.LyricsDirectory, cfg.SharedLyricsDirectory)
	if cfg.ConfigPath != "" {
		log.Printf("loaded config from %s", cfg.ConfigPath)
	}
	scanRoots := configuredScanRoots(cfg)
	saveConfiguredDirectories(ctx, store, cfg)
	if len(scanRoots) > 0 {
		saveAndScanLibrary(ctx, store, scanner, scanRoots, "startup")
		if cfg.LibraryWatchPollInterval > 0 {
			startLibraryWatchers(ctx, scanRoots, cfg.LibraryWatchPollInterval, cfg.LibraryWatchDebounce, func(scanCtx context.Context, reason string) {
				saveAndScanLibrary(scanCtx, store, scanner, scanRoots, reason)
			})
		}
		if cfg.LibraryAutoScanInterval > 0 {
			startLibraryAutoScan(ctx, store, scanner, scanRoots, cfg.LibraryAutoScanInterval)
		}
	}

	api := httpapi.New(store, scanner, cfg.CORSOrigin)
	server := &http.Server{
		Addr:              cfg.Addr,
		Handler:           api.Routes(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		log.Printf("media player API listening on %s", cfg.Addr)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("http server: %v", err)
		}
	}()

	<-ctx.Done()

	shutdownCtx, cancel := httpapi.ShutdownContext()
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Printf("shutdown: %v", err)
	}
}

func configuredScanRoots(cfg config.Config) []library.ScanRoot {
	sharedLyrics := strings.TrimSpace(cfg.SharedLyricsDirectory)
	roots := make([]library.ScanRoot, 0, 2)
	if strings.TrimSpace(cfg.LosslessMusicDirectory) != "" {
		lyricsRoots := compactPaths(cfg.LosslessLyricsDirectory, sharedLyrics)
		roots = append(roots, library.LosslessScanRoot(cfg.LosslessMusicDirectory, lyricsRoots...))
	}
	if strings.TrimSpace(cfg.LossyMusicDirectory) != "" {
		lyricsRoots := compactPaths(cfg.LossyLyricsDirectory, sharedLyrics)
		roots = append(roots, library.LossyScanRoot(cfg.LossyMusicDirectory, lyricsRoots...))
	}
	return roots
}

func compactPaths(paths ...string) []string {
	result := make([]string, 0, len(paths))
	seen := make(map[string]bool, len(paths))
	for _, path := range paths {
		path = strings.TrimSpace(path)
		if path == "" || seen[path] {
			continue
		}
		seen[path] = true
		result = append(result, path)
	}
	return result
}

func saveConfiguredDirectories(ctx context.Context, store *database.Store, cfg config.Config) {
	directories := map[string]string{
		"lossless_music_directory":  cfg.LosslessMusicDirectory,
		"lossless_lyrics_directory": cfg.LosslessLyricsDirectory,
		"lossy_music_directory":     cfg.LossyMusicDirectory,
		"lossy_lyrics_directory":    cfg.LossyLyricsDirectory,
		"shared_lyrics_directory":   cfg.SharedLyricsDirectory,
	}
	for key, path := range directories {
		path = strings.TrimSpace(path)
		if path == "" {
			continue
		}
		if _, err := store.SetSetting(ctx, key, path); err != nil {
			log.Printf("save configured %s skipped: %v", key, err)
		}
	}
}

func startLibraryWatchers(ctx context.Context, roots []library.ScanRoot, pollInterval, debounce time.Duration, onChange func(context.Context, string)) {
	for _, root := range roots {
		if strings.TrimSpace(root.MusicRoot) == "" {
			continue
		}
		if err := library.StartLibraryWatcher(ctx, library.WatcherOptions{
			MusicRoot:    root.MusicRoot,
			LyricsRoots:  root.LyricsRoots,
			PollInterval: pollInterval,
			Debounce:     debounce,
			OnChange:     onChange,
		}); err != nil {
			log.Printf("library watcher disabled for %s: %v", root.MusicRoot, err)
		}
	}
}

func startLibraryAutoScan(ctx context.Context, store *database.Store, scanner *library.Scanner, roots []library.ScanRoot, interval time.Duration) {
	log.Printf("auto audio scan enabled: roots=%s interval=%s", scanRootLabels(roots), interval)
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				saveAndScanLibrary(ctx, store, scanner, roots, "auto")
			}
		}
	}()
}

func saveAndScanLibrary(ctx context.Context, store *database.Store, scanner *library.Scanner, roots []library.ScanRoot, label string) {
	for _, root := range roots {
		if strings.TrimSpace(root.MusicRoot) == "" {
			continue
		}
		settingKey := root.Quality + "_music_directory"
		if _, err := store.SetSetting(ctx, settingKey, root.MusicRoot); err != nil {
			log.Printf("%s audio scan skipped: save configured %s: %v", label, settingKey, err)
			return
		}
	}
	result, err := scanner.ScanRoots(ctx, roots)
	if err != nil {
		log.Printf("%s audio scan failed for %s: %v", label, scanRootLabels(roots), err)
		return
	}
	if label == "startup" {
		logScanResult(label, result)
		for _, scanErr := range result.Errors {
			log.Printf("%s audio scan skipped: %s", label, scanErr)
		}
		return
	}
	logScanResult(label, result)
	for _, scanErr := range result.Errors {
		log.Printf("%s audio scan skipped: %s", label, scanErr)
	}
}

func scanRootLabels(roots []library.ScanRoot) string {
	labels := make([]string, 0, len(roots))
	for _, root := range roots {
		if strings.TrimSpace(root.MusicRoot) == "" {
			continue
		}
		labels = append(labels, root.Quality+":"+root.MusicRoot)
	}
	return strings.Join(labels, ",")
}

func logScanResult(label string, result models.ScanResult) {
	log.Printf("%s audio scan complete: root=%s found=%d imported=%d skipped=%d", label, result.RootPath, result.Found, result.Imported, result.Skipped)
}
