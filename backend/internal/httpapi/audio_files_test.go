package httpapi

import (
	"os"
	"path/filepath"
	"testing"
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
