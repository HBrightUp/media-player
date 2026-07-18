package library

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/hml/media-player/backend/internal/models"
)

type scannerStoreStub struct {
	nextTrackID int64
	cleanups    []scannerCleanup
	upserted    []models.Track
}

type scannerCleanup struct {
	root           string
	paths          []string
	protectedRoots []string
}

func (s *scannerStoreStub) UpsertTrack(_ context.Context, track models.Track) (int64, error) {
	s.nextTrackID++
	s.upserted = append(s.upserted, track)
	return s.nextTrackID, nil
}

func (s *scannerStoreStub) ReplaceTrackLyrics(_ context.Context, _ int64, _ *models.TrackLyrics) error {
	return nil
}

func (s *scannerStoreStub) DeleteTracksUnderRootExceptPaths(_ context.Context, root string, paths []string, protectedRoots []string) error {
	s.cleanups = append(s.cleanups, scannerCleanup{
		root:           root,
		paths:          append([]string(nil), paths...),
		protectedRoots: append([]string(nil), protectedRoots...),
	})
	return nil
}

func TestScanRootProtectsNestedConfiguredRootFromCleanup(t *testing.T) {
	parentRoot := t.TempDir()
	nestedRoot := filepath.Join(parentRoot, "mounted-lossy")
	store := &scannerStoreStub{}
	scanner := NewScanner(store)

	if _, err := scanner.ScanRoots(context.Background(), []ScanRoot{
		LosslessScanRoot(parentRoot),
		LossyScanRoot(nestedRoot),
	}); err != nil {
		t.Fatal(err)
	}

	if len(store.cleanups) != 1 {
		t.Fatalf("cleanup calls = %d, want 1", len(store.cleanups))
	}
	wantPrefix := nestedRoot + string(os.PathSeparator)
	if len(store.cleanups[0].protectedRoots) != 1 || store.cleanups[0].protectedRoots[0] != wantPrefix {
		t.Fatalf("protected roots = %q, want [%q]", store.cleanups[0].protectedRoots, wantPrefix)
	}
}

func TestNestedConfiguredRootIsScannedOnlyByItsOwnSpec(t *testing.T) {
	parentRoot := t.TempDir()
	nestedRoot := filepath.Join(parentRoot, "nested")
	if err := os.MkdirAll(nestedRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	audioPath := filepath.Join(nestedRoot, "artist-title.flac")
	if err := os.WriteFile(audioPath, []byte("not a real flac"), 0o644); err != nil {
		t.Fatal(err)
	}
	store := &scannerStoreStub{}
	scanner := NewScanner(store)

	if _, err := scanner.ScanRoots(context.Background(), []ScanRoot{
		LosslessScanRoot(parentRoot),
		LosslessScanRoot(nestedRoot),
	}); err != nil {
		t.Fatal(err)
	}

	if len(store.upserted) != 1 {
		t.Fatalf("upserted tracks = %d, want 1", len(store.upserted))
	}
	if store.upserted[0].Path != audioPath {
		t.Fatalf("upserted path = %q, want %q", store.upserted[0].Path, audioPath)
	}
}

func TestScanRootsCleansOnlySuccessfullyScannedRoots(t *testing.T) {
	validRoot := t.TempDir()
	audioPath := filepath.Join(validRoot, "artist-title.flac")
	if err := os.WriteFile(audioPath, []byte("not a real flac"), 0o644); err != nil {
		t.Fatal(err)
	}
	missingRoot := filepath.Join(t.TempDir(), "missing")
	store := &scannerStoreStub{}
	scanner := NewScanner(store)

	result, err := scanner.ScanRoots(context.Background(), []ScanRoot{
		LosslessScanRoot(validRoot),
		LossyScanRoot(missingRoot),
	})
	if err != nil {
		t.Fatal(err)
	}

	if result.Found != 1 || result.Imported != 1 {
		t.Fatalf("scan result = found:%d imported:%d, want found:1 imported:1", result.Found, result.Imported)
	}
	if len(store.cleanups) != 1 {
		t.Fatalf("cleanup calls = %d, want 1", len(store.cleanups))
	}
	validRoot, err = filepath.Abs(validRoot)
	if err != nil {
		t.Fatal(err)
	}
	if store.cleanups[0].root != validRoot {
		t.Fatalf("cleanup root = %q, want %q", store.cleanups[0].root, validRoot)
	}
	if len(store.cleanups[0].paths) != 1 || store.cleanups[0].paths[0] != audioPath {
		t.Fatalf("cleanup paths = %q, want [%q]", store.cleanups[0].paths, audioPath)
	}
}

func TestScanEmptyRootOnlyCleansThatRoot(t *testing.T) {
	root := t.TempDir()
	store := &scannerStoreStub{}
	scanner := NewScanner(store)

	if _, err := scanner.Scan(context.Background(), root); err != nil {
		t.Fatal(err)
	}

	if len(store.cleanups) != 1 {
		t.Fatalf("cleanup calls = %d, want 1", len(store.cleanups))
	}
	if len(store.cleanups[0].paths) != 0 {
		t.Fatalf("cleanup paths = %q, want none", store.cleanups[0].paths)
	}
}

func TestReadLRCFileMergesKaraokeTimeline(t *testing.T) {
	directory := t.TempDir()
	lyricsPath := filepath.Join(directory, "song.lrc")
	if err := os.WriteFile(lyricsPath, []byte("[00:52.860]我 心砰砰跳跳\n[00:56.000]下一句\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	timeline := `{
  "version": 1,
  "lines": [{
    "time_seconds": 52.86,
    "text": "我 心砰砰跳跳",
    "words": [
      {"text": "我 ", "start_seconds": 52.72, "end_seconds": 53.60},
      {"text": "心", "start_seconds": 53.92, "end_seconds": 54.16}
    ]
  }]
}`
	if err := os.WriteFile(filepath.Join(directory, "song.karaoke.json"), []byte(timeline), 0o644); err != nil {
		t.Fatal(err)
	}

	lyrics := readLRCFile(lyricsPath, "test")
	if lyrics == nil {
		t.Fatal("lyrics = nil")
	}
	if len(lyrics.Lines) != 2 {
		t.Fatalf("lines = %d, want 2", len(lyrics.Lines))
	}
	if len(lyrics.Lines[0].Words) != 2 {
		t.Fatalf("karaoke words = %d, want 2", len(lyrics.Lines[0].Words))
	}
	if lyrics.Lines[0].Words[0].Text != "我 " {
		t.Fatalf("first karaoke word = %q, want %q", lyrics.Lines[0].Words[0].Text, "我 ")
	}
	if len(lyrics.Lines[1].Words) != 0 {
		t.Fatalf("second line karaoke words = %d, want 0", len(lyrics.Lines[1].Words))
	}
}

func TestReadLRCFileFiltersCreditLinesBeforeMergingKaraokeTimeline(t *testing.T) {
	directory := t.TempDir()
	lyricsPath := filepath.Join(directory, "song.lrc")
	content := strings.Join([]string{
		"[00:01.000]项目总监Project Director：庄有豪",
		"[00:02.000]鸣谢：万物体验家/不要音乐",
		"[00:03.000]真正唱出来的一句",
	}, "\n")
	if err := os.WriteFile(lyricsPath, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	timeline := `{
  "version": 1,
  "lines": [{
    "time_seconds": 3.0,
    "text": "真正唱出来的一句",
    "words": [
      {"text": "真正", "start_seconds": 3.02, "end_seconds": 3.40}
    ]
  }]
}`
	if err := os.WriteFile(filepath.Join(directory, "song.karaoke.json"), []byte(timeline), 0o644); err != nil {
		t.Fatal(err)
	}

	lyrics := readLRCFile(lyricsPath, "test")
	if lyrics == nil {
		t.Fatal("lyrics = nil")
	}
	if len(lyrics.Lines) != 1 {
		t.Fatalf("lines = %d, want 1", len(lyrics.Lines))
	}
	if lyrics.Lines[0].Text != "真正唱出来的一句" {
		t.Fatalf("line text = %q, want sung lyric", lyrics.Lines[0].Text)
	}
	if len(lyrics.Lines[0].Words) != 1 {
		t.Fatalf("karaoke words = %d, want 1", len(lyrics.Lines[0].Words))
	}
}

func TestBuildTrackReadsID3v22Album(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "fallback-title.mp3")
	body := appendID3v22Frame(nil, "TT2", utf8TextPayload("Title From V22"))
	body = appendID3v22Frame(body, "TP1", utf8TextPayload("Artist From V22"))
	body = appendID3v22Frame(body, "TAL", utf8TextPayload("Album From V22"))
	content := append(id3Header(2, body), []byte{0xFF, 0xFB, 0x90, 0x64}...)
	if err := os.WriteFile(path, content, 0o644); err != nil {
		t.Fatal(err)
	}

	track, _, err := buildTrack(root, path, ".mp3", nil, "")
	if err != nil {
		t.Fatal(err)
	}

	if track.Title != "Title From V22" {
		t.Fatalf("title = %q, want %q", track.Title, "Title From V22")
	}
	if track.Artist != "Artist From V22" {
		t.Fatalf("artist = %q, want %q", track.Artist, "Artist From V22")
	}
	if track.Album != "Album From V22" {
		t.Fatalf("album = %q, want %q", track.Album, "Album From V22")
	}
}

func TestBuildTrackReadsID3v23Cover(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "cover.mp3")
	coverData := []byte{0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 'J', 'F', 'I', 'F'}
	payload := append([]byte{3}, []byte("image/jpeg")...)
	payload = append(payload, 0, 3, 0)
	payload = append(payload, coverData...)
	body := appendID3v23Frame(nil, "APIC", payload)
	content := append(id3Header(3, body), []byte{0xFF, 0xFB, 0x90, 0x64}...)
	if err := os.WriteFile(path, content, 0o644); err != nil {
		t.Fatal(err)
	}

	track, _, err := buildTrack(root, path, ".mp3", nil, "")
	if err != nil {
		t.Fatal(err)
	}

	if track.Cover == nil {
		t.Fatal("cover = nil, want embedded cover")
	}
	if track.Cover.MimeType != "image/jpeg" {
		t.Fatalf("mime = %q, want image/jpeg", track.Cover.MimeType)
	}
	if string(track.Cover.Data) != string(coverData) {
		t.Fatalf("cover data = %v, want %v", track.Cover.Data, coverData)
	}
}

func TestBuildTrackFallsBackToID3v1Album(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "fallback-title.mp3")
	body := appendID3v23Frame(nil, "TIT2", utf8TextPayload("Title From V23"))
	body = appendID3v23Frame(body, "TPE1", utf8TextPayload("Artist From V23"))
	content := append(id3Header(3, body), []byte{0xFF, 0xFB, 0x90, 0x64}...)
	content = append(content, id3v1Tag("Ignored Title", "Ignored Artist", "Album From V1")...)
	if err := os.WriteFile(path, content, 0o644); err != nil {
		t.Fatal(err)
	}

	track, _, err := buildTrack(root, path, ".mp3", nil, "")
	if err != nil {
		t.Fatal(err)
	}

	if track.Title != "Title From V23" {
		t.Fatalf("title = %q, want %q", track.Title, "Title From V23")
	}
	if track.Artist != "Artist From V23" {
		t.Fatalf("artist = %q, want %q", track.Artist, "Artist From V23")
	}
	if track.Album != "Album From V1" {
		t.Fatalf("album = %q, want %q", track.Album, "Album From V1")
	}
}

func TestBuildTrackDoesNotUseFilenameAsAlbum(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "Artist Name-Song Name.mp3")
	if err := os.WriteFile(path, []byte{0xFF, 0xFB, 0x90, 0x64}, 0o644); err != nil {
		t.Fatal(err)
	}

	track, _, err := buildTrack(root, path, ".mp3", nil, "")
	if err != nil {
		t.Fatal(err)
	}

	if track.Title != "Song Name" {
		t.Fatalf("title = %q, want %q", track.Title, "Song Name")
	}
	if track.Artist != "Artist Name" {
		t.Fatalf("artist = %q, want %q", track.Artist, "Artist Name")
	}
	if track.Album != "未知专辑" {
		t.Fatalf("album = %q, want %q", track.Album, "未知专辑")
	}
}

func TestTagsFromFilenameCleansTrailingHashSuffix(t *testing.T) {
	tags := tagsFromFilename("Artist Name-Song Name-a8f31c9d.wav")
	if tags.Title != "Song Name" {
		t.Fatalf("title = %q, want %q", tags.Title, "Song Name")
	}
	if tags.Artist != "Artist Name" {
		t.Fatalf("artist = %q, want %q", tags.Artist, "Artist Name")
	}

	tags = tagsFromFilename("Another Artist-Another Song_[A1B2C3D4].flac")
	if tags.Title != "Another Song" {
		t.Fatalf("title = %q, want %q", tags.Title, "Another Song")
	}
	if tags.Artist != "Another Artist" {
		t.Fatalf("artist = %q, want %q", tags.Artist, "Another Artist")
	}

	tags = tagsFromFilename("周华健 - 雨人-b21de2f21128.flac")
	if tags.Title != "雨人" {
		t.Fatalf("title = %q, want %q", tags.Title, "雨人")
	}
	if tags.Artist != "周华健" {
		t.Fatalf("artist = %q, want %q", tags.Artist, "周华健")
	}
}

func TestStandardAudioNamePartsCleansMetadataHashSuffix(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "fallback.wav")

	body := appendID3v23Frame(nil, "TIT2", utf8TextPayload("Song Name-a8f31c9d"))
	body = appendID3v23Frame(body, "TPE1", utf8TextPayload("Artist Name_ABCDEF12"))
	content := append(id3Header(3, body), []byte{0xFF, 0xFB, 0x90, 0x64}...)
	if err := os.WriteFile(path, content, 0o644); err != nil {
		t.Fatal(err)
	}

	artist, title := StandardAudioNameParts(path, "fallback.wav")
	if title != "Song Name" {
		t.Fatalf("title = %q, want %q", title, "Song Name")
	}
	if artist != "Artist Name" {
		t.Fatalf("artist = %q, want %q", artist, "Artist Name")
	}
}

func TestBuildTrackReadsLyricsFromConfiguredDirectory(t *testing.T) {
	root := t.TempDir()
	lyricsRoot := t.TempDir()
	audioDir := filepath.Join(root, "artist")
	lyricsDir := filepath.Join(lyricsRoot, "artist")
	if err := os.MkdirAll(audioDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(lyricsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(audioDir, "song.flac")
	if err := os.WriteFile(path, []byte("not a real flac"), 0o644); err != nil {
		t.Fatal(err)
	}
	lyricsPath := filepath.Join(lyricsDir, "song.lrc")
	if err := os.WriteFile(lyricsPath, []byte("[00:01.20]第一句\n[00:03.40]第二句"), 0o644); err != nil {
		t.Fatal(err)
	}

	_, lyrics, err := buildTrack(root, path, ".flac", []string{lyricsRoot}, models.TrackQualityLossless)
	if err != nil {
		t.Fatal(err)
	}

	if lyrics == nil {
		t.Fatal("lyrics = nil, want LRC lyrics")
	}
	if lyrics.Source != "lyrics_directory" {
		t.Fatalf("source = %q, want %q", lyrics.Source, "lyrics_directory")
	}
	if lyrics.Format != "lrc" {
		t.Fatalf("format = %q, want %q", lyrics.Format, "lrc")
	}
	if len(lyrics.Lines) != 2 {
		t.Fatalf("lines = %d, want 2", len(lyrics.Lines))
	}
	if lyrics.Lines[0].Text != "第一句" {
		t.Fatalf("first line = %q, want %q", lyrics.Lines[0].Text, "第一句")
	}
}

func TestBuildTrackReadsLyricsWithArtistPrefix(t *testing.T) {
	root := t.TempDir()
	lyricsRoot := t.TempDir()
	path := filepath.Join(root, "如果这就是爱情.mp3")
	if err := os.WriteFile(path, []byte("not a real mp3"), 0o644); err != nil {
		t.Fatal(err)
	}
	lyricsPath := filepath.Join(lyricsRoot, "张靓颖-如果这就是爱情.lrc")
	if err := os.WriteFile(lyricsPath, []byte("[00:02.00]如果这就是爱情"), 0o644); err != nil {
		t.Fatal(err)
	}

	_, lyrics, err := buildTrack(root, path, ".mp3", []string{lyricsRoot}, models.TrackQualityLossy)
	if err != nil {
		t.Fatal(err)
	}

	if lyrics == nil {
		t.Fatal("lyrics = nil, want prefixed LRC lyrics")
	}
	if len(lyrics.Lines) != 1 {
		t.Fatalf("lines = %d, want 1", len(lyrics.Lines))
	}
	if lyrics.Lines[0].Text != "如果这就是爱情" {
		t.Fatalf("first line = %q, want %q", lyrics.Lines[0].Text, "如果这就是爱情")
	}
}

func utf8TextPayload(text string) []byte {
	return append([]byte{3}, []byte(text)...)
}

func id3Header(version byte, body []byte) []byte {
	header := []byte{'I', 'D', '3', version, 0, 0, 0, 0, 0, 0}
	size := len(body)
	header[6] = byte((size >> 21) & 0x7F)
	header[7] = byte((size >> 14) & 0x7F)
	header[8] = byte((size >> 7) & 0x7F)
	header[9] = byte(size & 0x7F)
	return append(header, body...)
}

func appendID3v22Frame(body []byte, id string, payload []byte) []byte {
	frame := []byte{id[0], id[1], id[2], byte(len(payload) >> 16), byte(len(payload) >> 8), byte(len(payload))}
	frame = append(frame, payload...)
	return append(body, frame...)
}

func appendID3v23Frame(body []byte, id string, payload []byte) []byte {
	frame := []byte{id[0], id[1], id[2], id[3], byte(len(payload) >> 24), byte(len(payload) >> 16), byte(len(payload) >> 8), byte(len(payload)), 0, 0}
	frame = append(frame, payload...)
	return append(body, frame...)
}

func id3v1Tag(title, artist, album string) []byte {
	tag := make([]byte, 128)
	copy(tag[:3], "TAG")
	copyFixed(tag[3:33], title)
	copyFixed(tag[33:63], artist)
	copyFixed(tag[63:93], album)
	return tag
}

func copyFixed(target []byte, value string) {
	copy(target, []byte(value))
}
