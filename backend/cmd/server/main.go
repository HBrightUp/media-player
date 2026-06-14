package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/hml/media-player/backend/internal/config"
	"github.com/hml/media-player/backend/internal/database"
	"github.com/hml/media-player/backend/internal/httpapi"
	"github.com/hml/media-player/backend/internal/library"
)

const libraryAutoScanInterval = 15 * time.Second

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("load config: %v", err)
	}
	ctx, stopSignals := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stopSignals()

	store, err := database.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("database: %v", err)
	}
	defer store.Close()

	if err := store.Migrate(ctx); err != nil {
		log.Fatalf("migrate database: %v", err)
	}

	scanner := library.NewScanner(store, cfg.LyricsDirectory)
	if cfg.ConfigPath != "" {
		log.Printf("loaded config from %s", cfg.ConfigPath)
	}
	if cfg.MusicDirectory != "" {
		saveAndScanLibrary(ctx, store, scanner, cfg.MusicDirectory, "startup")
		startLibraryAutoScan(ctx, store, scanner, cfg.MusicDirectory, libraryAutoScanInterval)
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

func startLibraryAutoScan(ctx context.Context, store *database.Store, scanner *library.Scanner, musicDirectory string, interval time.Duration) {
	log.Printf("auto audio scan enabled: root=%s interval=%s", musicDirectory, interval)
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				saveAndScanLibrary(ctx, store, scanner, musicDirectory, "auto")
			}
		}
	}()
}

func saveAndScanLibrary(ctx context.Context, store *database.Store, scanner *library.Scanner, musicDirectory string, label string) {
	if _, err := store.SetSetting(ctx, "music_directory", musicDirectory); err != nil {
		log.Printf("%s audio scan skipped: save configured music directory: %v", label, err)
		return
	}
	result, err := scanner.Scan(ctx, musicDirectory)
	if err != nil {
		log.Printf("%s audio scan failed for %s: %v", label, musicDirectory, err)
		return
	}
	if label == "startup" {
		log.Printf("%s audio scan complete: root=%s found=%d imported=%d skipped=%d", label, result.RootPath, result.Found, result.Imported, result.Skipped)
		for _, scanErr := range result.Errors {
			log.Printf("%s audio scan skipped: %s", label, scanErr)
		}
		return
	}
	if result.Skipped > 0 {
		log.Printf("%s audio scan complete with skipped files: root=%s found=%d skipped=%d", label, result.RootPath, result.Found, result.Skipped)
		for _, scanErr := range result.Errors {
			log.Printf("%s audio scan skipped: %s", label, scanErr)
		}
	}
}
