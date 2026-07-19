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
	}}, audioFileArea{ID: "lossy_music"})
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

func TestManagedFileFromTrackUsesFilenamePartsBeforeMetadata(t *testing.T) {
	file := managedFileFromTrack(models.Track{
		ID:       1253,
		Filename: "孟庭苇-冬季来台北看雨.mp3",
		Artist:   "???",
		Title:    "????????",
		Format:   "mp3",
		Quality:  models.TrackQualityLossy,
	}, "lossy_music")

	if file.Artist != "孟庭苇" {
		t.Fatalf("artist = %q, want filename artist", file.Artist)
	}
	if file.Title != "冬季来台北看雨" {
		t.Fatalf("title = %q, want filename title", file.Title)
	}
	if file.Area != "lossy_music" {
		t.Fatalf("area = %q, want lossy_music", file.Area)
	}
}

func TestKaraokeLyricsUseSongBaseForImportMatching(t *testing.T) {
	if kind := audioImportFileKind("T.R.Y-不是因为寂寞才想你.karaoke.json"); kind != "lyrics" {
		t.Fatalf("audioImportFileKind = %q, want lyrics", kind)
	}
	if kind := audioImportFileKind("T.R.Y-不是因为寂寞才想你.json"); kind != "" {
		t.Fatalf("audioImportFileKind for plain json = %q, want unsupported", kind)
	}
	if base := normalizedImportBase("T.R.Y-不是因为寂寞才想你.karaoke.json"); base != "t.r.y-不是因为寂寞才想你" {
		t.Fatalf("normalizedImportBase = %q", base)
	}
	if ext := lyricTargetExtension("T.R.Y-不是因为寂寞才想你.karaoke.json"); ext != karaokeLyricExtension {
		t.Fatalf("lyricTargetExtension = %q, want %q", ext, karaokeLyricExtension)
	}
}

func TestTrackLyricsExistenceSeparatesMainAndKaraokeFiles(t *testing.T) {
	root := t.TempDir()
	track := models.Track{
		Filename: "刀郎-西海情歌.flac",
		Artist:   "刀郎",
		Title:    "西海情歌",
	}
	if err := os.WriteFile(filepath.Join(root, "刀郎-西海情歌.lrc"), []byte("[00:01.00]歌词"), 0o644); err != nil {
		t.Fatal(err)
	}

	if !trackHasAreaLyricFile(root, track) {
		t.Fatal("trackHasAreaLyricFile = false, want true for lrc")
	}
	if trackHasAreaKaraokeLyricFile(root, track) {
		t.Fatal("trackHasAreaKaraokeLyricFile = true, want false before karaoke timeline exists")
	}

	if err := os.WriteFile(filepath.Join(root, "刀郎-西海情歌.karaoke.json"), []byte(`{"version":1}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if !trackHasAreaKaraokeLyricFile(root, track) {
		t.Fatal("trackHasAreaKaraokeLyricFile = false, want true after karaoke timeline exists")
	}
}

func TestRenameAreaLyricsRenamesKaraokeTimeline(t *testing.T) {
	root := t.TempDir()
	track := models.Track{Filename: "刀郎-西海情歌.flac"}
	oldPath := filepath.Join(root, "刀郎-西海情歌.karaoke.json")
	if err := os.WriteFile(oldPath, []byte(`{"version":1}`), 0o644); err != nil {
		t.Fatal(err)
	}

	renameAreaLyrics(root, track, "刀郎-新的西海情歌")

	if fileExists(oldPath) {
		t.Fatal("old karaoke timeline still exists after rename")
	}
	if !fileExists(filepath.Join(root, "刀郎-新的西海情歌.karaoke.json")) {
		t.Fatal("new karaoke timeline does not exist after rename")
	}
}

func TestAudioTargetBaseRejectsNamesThatBecomeIncompleteAfterSanitizing(t *testing.T) {
	if _, err := audioTargetBase("朋友在", "///"); err == nil {
		t.Fatal("audioTargetBase accepted a title that sanitizes to empty")
	}
	if _, err := audioTargetBase("///", "冬季来台北看雨"); err == nil {
		t.Fatal("audioTargetBase accepted an artist that sanitizes to empty")
	}
}

func TestAudioTargetBaseBuildsSafeArtistTitleFilename(t *testing.T) {
	targetBase, err := audioTargetBase("孟庭苇", "冬季来台北看雨")
	if err != nil {
		t.Fatal(err)
	}
	if targetBase != "孟庭苇-冬季来台北看雨" {
		t.Fatalf("target base = %q", targetBase)
	}
}
