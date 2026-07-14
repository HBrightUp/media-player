package library

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	DefaultWatchPollInterval = time.Minute
	DefaultWatchDebounce     = 30 * time.Second
)

var watchedLyricFormats = map[string]bool{
	".lrc": true,
	".txt": true,
}

type WatcherOptions struct {
	MusicRoot    string
	LyricsRoot   string
	LyricsRoots  []string
	PollInterval time.Duration
	Debounce     time.Duration
	OnChange     func(context.Context, string)
}

type fileSnapshot map[string]fileState

type fileState struct {
	Size    int64
	ModTime int64
	IsDir   bool
}

func StartLibraryWatcher(ctx context.Context, options WatcherOptions) error {
	musicRoot := strings.TrimSpace(options.MusicRoot)
	if musicRoot == "" {
		return errors.New("music root is required")
	}
	if options.OnChange == nil {
		return errors.New("change handler is required")
	}
	pollInterval := options.PollInterval
	if pollInterval <= 0 {
		pollInterval = DefaultWatchPollInterval
	}
	debounce := options.Debounce
	if debounce <= 0 {
		debounce = DefaultWatchDebounce
	}

	lyricsRoots := watcherLyricsRoots(options)
	current, err := snapshotLibraryRoots(musicRoot, lyricsRoots)
	if err != nil {
		return err
	}

	go watchLibraryRoots(ctx, current, options, pollInterval, debounce)
	log.Printf("library watcher enabled: music=%s lyrics=%s poll=%s debounce=%s", musicRoot, strings.Join(lyricsRoots, ","), pollInterval, debounce)
	return nil
}

func watchLibraryRoots(ctx context.Context, current fileSnapshot, options WatcherOptions, pollInterval, debounce time.Duration) {
	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()

	var timer *time.Timer
	var timerC <-chan time.Time
	pendingReason := ""

	scheduleScan := func(reason string) {
		pendingReason = reason
		if timer == nil {
			timer = time.NewTimer(debounce)
			timerC = timer.C
			return
		}
		if !timer.Stop() {
			select {
			case <-timer.C:
			default:
			}
		}
		timer.Reset(debounce)
	}

	for {
		select {
		case <-ctx.Done():
			if timer != nil {
				timer.Stop()
			}
			return
		case <-ticker.C:
			next, err := snapshotLibraryRoots(options.MusicRoot, watcherLyricsRoots(options))
			if err != nil {
				log.Printf("library watcher snapshot failed: %v", err)
				continue
			}
			if snapshotsEqual(current, next) {
				continue
			}
			current = next
			scheduleScan("file-change")
		case <-timerC:
			timer = nil
			timerC = nil
			reason := pendingReason
			pendingReason = ""
			if ctx.Err() != nil {
				return
			}
			options.OnChange(ctx, reason)
		}
	}
}

func watcherLyricsRoots(options WatcherOptions) []string {
	roots := make([]string, 0, len(options.LyricsRoots)+1)
	if strings.TrimSpace(options.LyricsRoot) != "" {
		roots = append(roots, options.LyricsRoot)
	}
	roots = append(roots, options.LyricsRoots...)
	return roots
}

func snapshotLibraryRoots(musicRoot string, lyricsRoots []string) (fileSnapshot, error) {
	snapshot := make(fileSnapshot)
	if err := addRootSnapshot(snapshot, "music", musicRoot, true); err != nil {
		return nil, err
	}
	for index, lyricsRoot := range lyricsRoots {
		lyricsRoot = strings.TrimSpace(lyricsRoot)
		if lyricsRoot == "" {
			continue
		}
		if err := addRootSnapshot(snapshot, fmt.Sprintf("lyrics%d", index), lyricsRoot, false); err != nil {
			log.Printf("library watcher skipped lyrics root: %v", err)
		}
	}
	return snapshot, nil
}

func addRootSnapshot(snapshot fileSnapshot, namespace, root string, required bool) error {
	root = strings.TrimSpace(root)
	if root == "" {
		if required {
			return errors.New("root is required")
		}
		return nil
	}
	absolute, err := filepath.Abs(root)
	if err != nil {
		return err
	}
	info, err := os.Stat(absolute)
	if err != nil {
		if required {
			return err
		}
		return nil
	}
	if !info.IsDir() {
		if required {
			return errors.New("root is not a directory")
		}
		return nil
	}

	return filepath.WalkDir(absolute, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return nil
		}
		if entry.IsDir() {
			return nil
		}
		if !isWatchableLibraryFile(path) {
			return nil
		}
		relative, err := filepath.Rel(absolute, path)
		if err != nil {
			relative = filepath.Base(path)
		}
		snapshot[namespace+":"+filepath.ToSlash(relative)] = fileState{
			Size:    info.Size(),
			ModTime: info.ModTime().UnixNano(),
			IsDir:   entry.IsDir(),
		}
		return nil
	})
}

func isWatchableLibraryFile(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	return supportedAudioFormats[ext] || watchedLyricFormats[ext]
}

func snapshotsEqual(left, right fileSnapshot) bool {
	if len(left) != len(right) {
		return false
	}
	for path, leftState := range left {
		rightState, ok := right[path]
		if !ok || rightState != leftState {
			return false
		}
	}
	return true
}
