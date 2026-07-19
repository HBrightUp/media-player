package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestClientAppsDiscoversAndroidAPK(t *testing.T) {
	root := t.TempDir()
	androidDir := filepath.Join(root, "android")
	if err := os.MkdirAll(androidDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(androidDir, "media-player-v0.1.0.apk"), []byte("apk-content"), 0o644); err != nil {
		t.Fatal(err)
	}

	server := New(nil, nil, "", WithClientAppsDirectory(root))
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/client-apps", nil)
	server.Routes().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}

	var response struct {
		Apps []clientAppRelease `json:"apps"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}

	var android clientAppRelease
	for _, app := range response.Apps {
		if app.Platform == "android" {
			android = app
			break
		}
	}
	if android.Status != clientAppStatusAvailable {
		t.Fatalf("android status = %q", android.Status)
	}
	if android.FileName != "media-player-v0.1.0.apk" {
		t.Fatalf("android filename = %q", android.FileName)
	}
	if android.VersionName != "0.1.0" {
		t.Fatalf("android version = %q", android.VersionName)
	}
	if android.DownloadURL != "/api/client-apps/android/download" {
		t.Fatalf("android download url = %q", android.DownloadURL)
	}
	if android.SizeBytes == nil || *android.SizeBytes != int64(len("apk-content")) {
		t.Fatalf("android size = %v", android.SizeBytes)
	}
	if strings.TrimSpace(android.SHA256) == "" {
		t.Fatal("android sha256 is empty")
	}
}

func TestClientAppDownloadServesLatestAndroidAPK(t *testing.T) {
	root := t.TempDir()
	androidDir := filepath.Join(root, "android")
	if err := os.MkdirAll(androidDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(androidDir, "media-player-v0.1.0.apk"), []byte("apk-content"), 0o644); err != nil {
		t.Fatal(err)
	}

	server := New(nil, nil, "", WithClientAppsDirectory(root))
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/client-apps/android/download", nil)
	server.Routes().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if recorder.Body.String() != "apk-content" {
		t.Fatalf("body = %q", recorder.Body.String())
	}
	if contentType := recorder.Header().Get("Content-Type"); contentType != "application/vnd.android.package-archive" {
		t.Fatalf("content type = %q", contentType)
	}
	if disposition := recorder.Header().Get("Content-Disposition"); !strings.Contains(disposition, `filename="media-player-v0.1.0.apk"`) {
		t.Fatalf("content disposition = %q", disposition)
	}
}
