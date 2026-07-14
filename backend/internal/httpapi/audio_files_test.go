package httpapi

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"

	"github.com/hml/media-player/backend/internal/models"
)

func TestUploadIsFLACUsesContentSignature(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "song.wav")
	if err := os.WriteFile(path, []byte("fLaC\x00\x00\x00\x22"), 0o644); err != nil {
		t.Fatal(err)
	}

	upload := uploadedAudioImportFile{
		TempPath: path,
		Ext:      ".wav",
	}
	if !uploadIsFLAC(upload) {
		t.Fatal("uploadIsFLAC = false, want true for FLAC content with non-FLAC extension")
	}
}

func TestFileHasFLACSignatureAfterID3Header(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "song.flac")
	content := append([]byte{'I', 'D', '3', 4, 0, 0, 0, 0, 0, 3}, []byte("abc")...)
	content = append(content, []byte("fLaC\x00\x00\x00\x22")...)
	if err := os.WriteFile(path, content, 0o644); err != nil {
		t.Fatal(err)
	}

	if !fileHasFLACSignature(path) {
		t.Fatal("fileHasFLACSignature = false, want true after ID3 header")
	}
}

func TestBuildServerAudioSetUsesCompleteFilenameHashAndFilenameParts(t *testing.T) {
	filename := "周华健-雨人.mp3"
	entries := buildServerAudioSet([]models.Track{{
		Filename: filename,
		Artist:   "元数据歌手",
		Title:    "元数据歌曲",
		Format:   "mp3",
	}}, "lossy_music")
	if len(entries) != 1 {
		t.Fatalf("len(entries) = %d, want 1", len(entries))
	}

	hash := sha256.Sum256([]byte(filename))
	if entries[0].FilenameHash != hex.EncodeToString(hash[:]) {
		t.Fatalf("hash = %q, want SHA-256 of complete filename", entries[0].FilenameHash)
	}
	if entries[0].Artist != "周华健" {
		t.Fatalf("artist = %q, want %q", entries[0].Artist, "周华健")
	}
	if entries[0].Title != "雨人" {
		t.Fatalf("title = %q, want %q", entries[0].Title, "雨人")
	}
	if entries[0].Extension != "mp3" {
		t.Fatalf("extension = %q, want %q", entries[0].Extension, "mp3")
	}
	if entries[0].Area != "lossy_music" {
		t.Fatalf("area = %q, want %q", entries[0].Area, "lossy_music")
	}
}
