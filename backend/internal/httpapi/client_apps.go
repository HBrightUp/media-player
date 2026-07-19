package httpapi

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

const clientAppStatusAvailable = "available"
const clientAppStatusComingSoon = "coming_soon"

var androidAPKVersionPattern = regexp.MustCompile(`(?i)^media-player-v([0-9]+(?:\.[0-9]+){0,3}(?:[-+][A-Za-z0-9._-]+)?)\.apk$`)

type clientAppPlatformSpec struct {
	ID            string
	Title         string
	Description   string
	MinSystem     string
	Extensions    []string
	VersionRegexp *regexp.Regexp
	ReleaseNotes  []string
}

type clientAppRelease struct {
	Platform     string   `json:"platform"`
	Title        string   `json:"title"`
	Description  string   `json:"description"`
	Status       string   `json:"status"`
	VersionCode  *int     `json:"version_code"`
	VersionName  string   `json:"version_name"`
	FileName     string   `json:"file_name"`
	DownloadURL  string   `json:"download_url"`
	SizeBytes    *int64   `json:"size_bytes"`
	SHA256       string   `json:"sha256"`
	ReleaseDate  string   `json:"release_date"`
	MinSystem    string   `json:"min_system"`
	ReleaseNotes []string `json:"release_notes"`
}

type clientAppCandidate struct {
	Path        string
	Info        fs.FileInfo
	VersionName string
}

var clientAppPlatforms = []clientAppPlatformSpec{
	{
		ID:            "android",
		Title:         "Android",
		Description:   "HML Media Player Android 版",
		MinSystem:     "Android 8.0+",
		Extensions:    []string{".apk"},
		VersionRegexp: androidAPKVersionPattern,
		ReleaseNotes: []string{
			"支持高品质/轻音乐播放",
			"支持歌词页面、收藏和自定义分类",
			"支持本地缓存与迷你播放器",
		},
	},
	{
		ID:           "ios",
		Title:        "iPhone / iPad",
		Description:  "未来可接入 App Store 或 TestFlight",
		MinSystem:    "待定",
		Extensions:   []string{".ipa"},
		ReleaseNotes: []string{"iOS 客户端规划中"},
	},
	{
		ID:           "windows",
		Title:        "Windows",
		Description:  "未来提供 Windows 桌面安装包",
		MinSystem:    "待定",
		Extensions:   []string{".exe", ".msi", ".zip"},
		ReleaseNotes: []string{"Windows 桌面版规划中"},
	},
	{
		ID:           "macos",
		Title:        "macOS",
		Description:  "未来提供 macOS 版本",
		MinSystem:    "待定",
		Extensions:   []string{".dmg", ".pkg", ".zip"},
		ReleaseNotes: []string{"macOS 桌面版规划中"},
	},
	{
		ID:           "linux",
		Title:        "Linux",
		Description:  "未来提供 Linux 桌面版本",
		MinSystem:    "待定",
		Extensions:   []string{".appimage", ".deb", ".rpm", ".tar.gz", ".zip"},
		ReleaseNotes: []string{"Linux 桌面版规划中"},
	},
}

func (s *Server) handleClientApps(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}

	releases := make([]clientAppRelease, 0, len(clientAppPlatforms))
	for _, spec := range clientAppPlatforms {
		releases = append(releases, s.clientAppRelease(spec))
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"apps": releases,
	})
}

func (s *Server) handleClientAppRoute(w http.ResponseWriter, r *http.Request) {
	path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/client-apps/"), "/")
	parts := strings.Split(path, "/")
	if len(parts) != 2 {
		http.NotFound(w, r)
		return
	}

	spec, ok := clientAppPlatformByID(parts[0])
	if !ok {
		http.NotFound(w, r)
		return
	}

	switch parts[1] {
	case "latest":
		if r.Method != http.MethodGet {
			methodNotAllowed(w)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"app": s.clientAppRelease(spec),
		})
	case "download":
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			methodNotAllowed(w)
			return
		}
		s.serveClientAppDownload(w, r, spec)
	default:
		http.NotFound(w, r)
	}
}

func (s *Server) clientAppRelease(spec clientAppPlatformSpec) clientAppRelease {
	release := clientAppRelease{
		Platform:     spec.ID,
		Title:        spec.Title,
		Description:  spec.Description,
		Status:       clientAppStatusComingSoon,
		MinSystem:    spec.MinSystem,
		ReleaseNotes: spec.ReleaseNotes,
	}

	candidate, ok := s.latestClientAppCandidate(spec)
	if !ok {
		return release
	}

	size := candidate.Info.Size()
	sha, err := sha256File(candidate.Path)
	if err != nil {
		return release
	}

	release.Status = clientAppStatusAvailable
	release.VersionName = candidate.VersionName
	release.FileName = candidate.Info.Name()
	release.DownloadURL = fmt.Sprintf("/api/client-apps/%s/download", spec.ID)
	release.SizeBytes = &size
	release.SHA256 = sha
	release.ReleaseDate = candidate.Info.ModTime().Local().Format("2006-01-02")
	return release
}

func (s *Server) serveClientAppDownload(w http.ResponseWriter, r *http.Request, spec clientAppPlatformSpec) {
	candidate, ok := s.latestClientAppCandidate(spec)
	if !ok {
		writeError(w, http.StatusNotFound, "客户端安装包未发布")
		return
	}

	file, err := os.Open(candidate.Path)
	if err != nil {
		writeError(w, http.StatusNotFound, "客户端安装包不存在")
		return
	}
	defer file.Close()

	w.Header().Set("Content-Type", clientAppContentType(candidate.Info.Name()))
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", candidate.Info.Name()))
	w.Header().Set("Cache-Control", "public, max-age=60")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, candidate.Info.Name(), candidate.Info.ModTime(), file)
}

func (s *Server) latestClientAppCandidate(spec clientAppPlatformSpec) (clientAppCandidate, bool) {
	root := strings.TrimSpace(s.clientAppsDirectory)
	if root == "" {
		return clientAppCandidate{}, false
	}

	platformDir := filepath.Join(root, spec.ID)
	if !pathWithin(root, platformDir) {
		return clientAppCandidate{}, false
	}

	entries, err := os.ReadDir(platformDir)
	if err != nil {
		return clientAppCandidate{}, false
	}

	candidates := make([]clientAppCandidate, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if !clientAppExtensionAllowed(name, spec.Extensions) {
			continue
		}
		fullPath := filepath.Join(platformDir, name)
		if !pathWithin(platformDir, fullPath) {
			continue
		}
		info, err := entry.Info()
		if err != nil || info.Size() <= 0 {
			continue
		}
		candidates = append(candidates, clientAppCandidate{
			Path:        fullPath,
			Info:        info,
			VersionName: clientAppVersionName(name, spec),
		})
	}

	if len(candidates) == 0 {
		return clientAppCandidate{}, false
	}

	sort.Slice(candidates, func(i, j int) bool {
		versionCompare := compareVersionNames(candidates[i].VersionName, candidates[j].VersionName)
		if versionCompare != 0 {
			return versionCompare > 0
		}
		return candidates[i].Info.ModTime().After(candidates[j].Info.ModTime())
	})
	return candidates[0], true
}

func clientAppPlatformByID(id string) (clientAppPlatformSpec, bool) {
	for _, spec := range clientAppPlatforms {
		if spec.ID == id {
			return spec, true
		}
	}
	return clientAppPlatformSpec{}, false
}

func clientAppExtensionAllowed(name string, extensions []string) bool {
	lowerName := strings.ToLower(name)
	for _, extension := range extensions {
		if strings.HasSuffix(lowerName, strings.ToLower(extension)) {
			return true
		}
	}
	return false
}

func clientAppVersionName(name string, spec clientAppPlatformSpec) string {
	if spec.VersionRegexp == nil {
		return ""
	}
	matches := spec.VersionRegexp.FindStringSubmatch(name)
	if len(matches) < 2 {
		return ""
	}
	return matches[1]
}

func compareVersionNames(left, right string) int {
	leftParts := numericVersionParts(left)
	rightParts := numericVersionParts(right)
	if len(leftParts) == 0 && len(rightParts) == 0 {
		return 0
	}
	if len(leftParts) == 0 {
		return -1
	}
	if len(rightParts) == 0 {
		return 1
	}
	maxLen := len(leftParts)
	if len(rightParts) > maxLen {
		maxLen = len(rightParts)
	}
	for index := 0; index < maxLen; index++ {
		leftValue := 0
		if index < len(leftParts) {
			leftValue = leftParts[index]
		}
		rightValue := 0
		if index < len(rightParts) {
			rightValue = rightParts[index]
		}
		if leftValue > rightValue {
			return 1
		}
		if leftValue < rightValue {
			return -1
		}
	}
	return 0
}

func numericVersionParts(version string) []int {
	version = strings.TrimSpace(version)
	if version == "" {
		return nil
	}
	if prefix, _, found := strings.Cut(version, "-"); found {
		version = prefix
	}
	if prefix, _, found := strings.Cut(version, "+"); found {
		version = prefix
	}
	rawParts := strings.Split(version, ".")
	parts := make([]int, 0, len(rawParts))
	for _, rawPart := range rawParts {
		value, err := strconv.Atoi(rawPart)
		if err != nil {
			break
		}
		parts = append(parts, value)
	}
	return parts
}

func sha256File(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()

	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func clientAppContentType(filename string) string {
	lowerName := strings.ToLower(filename)
	switch {
	case strings.HasSuffix(lowerName, ".apk"):
		return "application/vnd.android.package-archive"
	case strings.HasSuffix(lowerName, ".dmg"):
		return "application/x-apple-diskimage"
	case strings.HasSuffix(lowerName, ".msi"):
		return "application/x-msi"
	case strings.HasSuffix(lowerName, ".zip"):
		return "application/zip"
	default:
		return "application/octet-stream"
	}
}

func pathWithin(root, path string) bool {
	root = strings.TrimSpace(root)
	path = strings.TrimSpace(path)
	if root == "" || path == "" {
		return false
	}
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return false
	}
	absPath, err := filepath.Abs(path)
	if err != nil {
		return false
	}
	relative, err := filepath.Rel(absRoot, absPath)
	if err != nil {
		return false
	}
	return relative == "." || (relative != ".." && !strings.HasPrefix(relative, ".."+string(os.PathSeparator)))
}
