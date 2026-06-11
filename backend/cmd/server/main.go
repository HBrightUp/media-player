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

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("load config: %v", err)
	}
	ctx := context.Background()

	store, err := database.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("database: %v", err)
	}
	defer store.Close()

	if err := store.Migrate(ctx); err != nil {
		log.Fatalf("migrate database: %v", err)
	}

	scanner := library.NewScanner(store)
	if cfg.ConfigPath != "" {
		log.Printf("loaded config from %s", cfg.ConfigPath)
	}
	if cfg.MusicDirectory != "" {
		if _, err := store.SetSetting(ctx, "music_directory", cfg.MusicDirectory); err != nil {
			log.Printf("save configured music directory: %v", err)
		}
		result, err := scanner.ScanMP3(ctx, cfg.MusicDirectory)
		if err != nil {
			log.Printf("startup mp3 scan failed for %s: %v", cfg.MusicDirectory, err)
		} else {
			log.Printf("startup mp3 scan complete: root=%s found=%d imported=%d skipped=%d", result.RootPath, result.Found, result.Imported, result.Skipped)
			for _, scanErr := range result.Errors {
				log.Printf("startup mp3 scan skipped: %s", scanErr)
			}
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

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop

	shutdownCtx, cancel := httpapi.ShutdownContext()
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Printf("shutdown: %v", err)
	}
}
