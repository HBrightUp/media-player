package library

import (
	"os"
	"path/filepath"
	"testing"
)

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

	track, err := buildTrack(root, path, ".mp3")
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

	track, err := buildTrack(root, path, ".mp3")
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

	track, err := buildTrack(root, path, ".mp3")
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
