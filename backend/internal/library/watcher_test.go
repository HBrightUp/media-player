package library

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestSnapshotLibraryRootsDetectsAudioAndLyricChanges(t *testing.T) {
	root := t.TempDir()
	lyricsRoot := t.TempDir()

	initial, err := snapshotLibraryRoots(root, lyricsRoot)
	if err != nil {
		t.Fatal(err)
	}

	audioPath := filepath.Join(root, "artist-song.flac")
	if err := os.WriteFile(audioPath, []byte("audio"), 0o644); err != nil {
		t.Fatal(err)
	}
	lyricPath := filepath.Join(lyricsRoot, "artist-song.lrc")
	if err := os.WriteFile(lyricPath, []byte("[00:01.00]line"), 0o644); err != nil {
		t.Fatal(err)
	}

	changed, err := snapshotLibraryRoots(root, lyricsRoot)
	if err != nil {
		t.Fatal(err)
	}
	if snapshotsEqual(initial, changed) {
		t.Fatal("snapshot did not detect added audio and lyric files")
	}

	time.Sleep(time.Millisecond)
	if err := os.WriteFile(audioPath, []byte("audio changed"), 0o644); err != nil {
		t.Fatal(err)
	}
	modified, err := snapshotLibraryRoots(root, lyricsRoot)
	if err != nil {
		t.Fatal(err)
	}
	if snapshotsEqual(changed, modified) {
		t.Fatal("snapshot did not detect modified audio file")
	}
}

func TestSnapshotLibraryRootsIgnoresUnsupportedFiles(t *testing.T) {
	root := t.TempDir()

	initial, err := snapshotLibraryRoots(root, "")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "notes.md"), []byte("ignore me"), 0o644); err != nil {
		t.Fatal(err)
	}
	next, err := snapshotLibraryRoots(root, "")
	if err != nil {
		t.Fatal(err)
	}
	if !snapshotsEqual(initial, next) {
		t.Fatal("snapshot changed for unsupported file")
	}
}
