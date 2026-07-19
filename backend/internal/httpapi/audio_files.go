package httpapi

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/hml/media-player/backend/internal/library"
	"github.com/hml/media-player/backend/internal/models"
	"github.com/jackc/pgx/v5"
)

const (
	audioImportMaxAudioFileBytes = int64(200 * 1024 * 1024)
	audioImportMaxTotalBytes     = int64(4 * 1024 * 1024 * 1024)
	audioImportMaxFileCount      = 400
	audioImportMaxLyricFileBytes = int64(2 * 1024 * 1024)
	audioImportRequestSlackBytes = int64(64 * 1024 * 1024)
	audioImportManifestMaxBytes  = int64(1024 * 1024)
	audioImportStaleAge          = 2 * time.Hour
	audioImportTempPattern       = "media-player-import-*"
	karaokeLyricExtension        = ".karaoke.json"
)

var (
	fileNameSpacePattern = regexp.MustCompile(`\s+`)
	audioFileManagerMu   sync.Mutex
)

type audioFileImportManifest struct {
	Files []audioFileImportManifestItem `json:"files"`
}

type audioFileImportManifestItem struct {
	FieldName    string `json:"field_name"`
	RelativePath string `json:"relative_path"`
	Size         int64  `json:"size"`
}

type uploadedAudioImportFile struct {
	FieldName    string
	RelativePath string
	OriginalName string
	TempPath     string
	SizeBytes    int64
	SHA256       string
	Ext          string
	Kind         string
}

type audioFileImportItemResult struct {
	RelativePath   string `json:"relative_path"`
	TargetFilename string `json:"target_filename,omitempty"`
	Status         string `json:"status"`
	Reason         string `json:"reason,omitempty"`
	SizeBytes      int64  `json:"size_bytes,omitempty"`
}

type audioFileImportReport struct {
	Imported       int                         `json:"imported"`
	Skipped        int                         `json:"skipped"`
	Failed         int                         `json:"failed"`
	Converted      int                         `json:"converted"`
	LyricsImported int                         `json:"lyrics_imported"`
	LyricsSkipped  int                         `json:"lyrics_skipped"`
	LyricsFailed   int                         `json:"lyrics_failed"`
	Items          []audioFileImportItemResult `json:"items"`
	Scan           *models.ScanResult          `json:"scan,omitempty"`
}

type audioFileRenameRequest struct {
	UserID int64  `json:"user_id"`
	Artist string `json:"artist"`
	Title  string `json:"title"`
}

type audioFileAuthorizeRequest struct {
	UserID   int64  `json:"user_id"`
	Password string `json:"password"`
}

type audioFileAuthorizeResponse struct {
	Token     string `json:"token"`
	ExpiresAt string `json:"expires_at"`
}

type audioFilesLimitsResponse struct {
	MaxAudioFileBytes int64 `json:"max_audio_file_bytes"`
	MaxTotalBytes     int64 `json:"max_total_bytes"`
	MaxFileCount      int   `json:"max_file_count"`
	MaxLyricFileBytes int64 `json:"max_lyric_file_bytes"`
}

type serverAudioSetEntry struct {
	Filename         string `json:"filename"`
	FilenameHash     string `json:"filename_hash"`
	Artist           string `json:"artist"`
	Title            string `json:"title"`
	Extension        string `json:"extension"`
	Area             string `json:"area,omitempty"`
	HasLyrics        bool   `json:"has_lyrics,omitempty"`
	HasKaraokeLyrics bool   `json:"has_karaoke_lyrics,omitempty"`
}

type audioFileArea struct {
	ID         string
	Label      string
	Kind       string
	Quality    string
	Root       string
	LyricsRoot string
}

type serverManagedFile struct {
	ID           string    `json:"id"`
	TrackID      *int64    `json:"track_id,omitempty"`
	Area         string    `json:"area"`
	Kind         string    `json:"kind"`
	Quality      string    `json:"quality,omitempty"`
	RelativePath string    `json:"relative_path"`
	Filename     string    `json:"filename"`
	Title        string    `json:"title"`
	Artist       string    `json:"artist"`
	Album        string    `json:"album,omitempty"`
	Format       string    `json:"format"`
	SizeBytes    int64     `json:"size_bytes"`
	ModifiedAt   time.Time `json:"modified_at"`
}

type managedLyricsFileRequest struct {
	UserID       int64  `json:"user_id"`
	RelativePath string `json:"relative_path"`
	Artist       string `json:"artist"`
	Title        string `json:"title"`
}

func (s *Server) handleAudioFileAuthorize(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}

	var request audioFileAuthorizeRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	userID, err := validatePositiveID(strconv.FormatInt(request.UserID, 10), "用户")
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	userID, ok := s.requireMatchingSessionUserID(w, r, userID, "请先登录后管理服务器文件")
	if !ok {
		return
	}
	password, err := validatePassword(request.Password)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	now := time.Now()
	if remaining, locked := s.audioFileAccess.CheckLockout(userID, now); locked {
		retryAfterSeconds := int((remaining + time.Second - 1) / time.Second)
		w.Header().Set("Retry-After", strconv.Itoa(retryAfterSeconds))
		writeError(w, http.StatusTooManyRequests, fmt.Sprintf("密码错误次数过多，请%d秒后再试", retryAfterSeconds))
		return
	}

	user, err := s.store.GetUserByID(r.Context(), userID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusUnauthorized, "当前用户无权管理服务器文件")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "校验用户失败")
		return
	}
	if !models.UserCanManageAudioFiles(user.Role) {
		writeError(w, http.StatusForbidden, "当前用户无权管理服务器文件")
		return
	}
	if !verifyPassword(password, user.PasswordSalt, user.PasswordHash) {
		remaining, attemptsLeft, locked := s.audioFileAccess.RecordFailure(userID, now, audioFileAccessMaxFails, audioFileAccessLockout)
		if locked {
			retryAfterSeconds := int((remaining + time.Second - 1) / time.Second)
			w.Header().Set("Retry-After", strconv.Itoa(retryAfterSeconds))
			writeError(w, http.StatusTooManyRequests, fmt.Sprintf("密码错误次数过多，请%d秒后再试", retryAfterSeconds))
			return
		}
		writeError(w, http.StatusUnauthorized, fmt.Sprintf("密码不正确，还可尝试%d次", attemptsLeft))
		return
	}

	s.audioFileAccess.ClearFailures(userID)
	token, expiresAt, err := s.audioFileAccess.Grant(userID, now)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "生成授权失败")
		return
	}
	writeJSON(w, http.StatusOK, audioFileAuthorizeResponse{
		Token:     token,
		ExpiresAt: expiresAt.UTC().Format(time.RFC3339),
	})
}

func (s *Server) handleAudioFiles(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	if _, ok := s.requireAudioFileUser(w, r); !ok {
		return
	}
	area, ok := s.requireAudioFileArea(w, r)
	if !ok {
		return
	}

	files, tracks, err := s.listManagedFiles(r.Context(), area)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "读取服务器文件失败")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"area":             area.ID,
		"files":            files,
		"server_audio_set": buildServerAudioSet(tracks, area),
		"limits":           audioFileLimits(),
	})
}

func (s *Server) listManagedFiles(ctx context.Context, area audioFileArea) ([]serverManagedFile, []models.Track, error) {
	if area.Kind == "audio" {
		tracks, err := s.store.ListTracksByQuality(ctx, area.Quality)
		if err != nil {
			return nil, nil, err
		}
		files := make([]serverManagedFile, 0, len(tracks))
		filteredTracks := make([]models.Track, 0, len(tracks))
		for _, track := range tracks {
			if area.Root != "" && !pathWithinRoot(area.Root, track.Path) {
				continue
			}
			files = append(files, managedFileFromTrack(track, area.ID))
			filteredTracks = append(filteredTracks, track)
		}
		return files, filteredTracks, nil
	}

	files, err := listLyricsManagedFiles(area)
	if err != nil {
		return nil, nil, err
	}
	return files, nil, nil
}

func managedFileFromTrack(track models.Track, areaID string) serverManagedFile {
	trackID := track.ID
	artist, title := managedTrackNameParts(track)
	return serverManagedFile{
		ID:           strconv.FormatInt(track.ID, 10),
		TrackID:      &trackID,
		Area:         areaID,
		Kind:         "audio",
		Quality:      track.Quality,
		RelativePath: track.RelativePath,
		Filename:     track.Filename,
		Title:        title,
		Artist:       artist,
		Album:        track.Album,
		Format:       track.Format,
		SizeBytes:    track.SizeBytes,
		ModifiedAt:   track.ModifiedAt,
	}
}

func managedTrackNameParts(track models.Track) (string, string) {
	filename := strings.TrimSpace(track.Filename)
	if filename == "" {
		filename = filepath.Base(track.RelativePath)
	}
	if artist, title := library.StandardAudioNamePartsFromFilename(filename); artist != "" && title != "" {
		return artist, title
	}

	artist := strings.TrimSpace(track.Artist)
	title := strings.TrimSpace(track.Title)
	if title == "" {
		title = strings.TrimSpace(strings.TrimSuffix(filename, filepath.Ext(filename)))
	}
	return artist, title
}

func listLyricsManagedFiles(area audioFileArea) ([]serverManagedFile, error) {
	var files []serverManagedFile
	err := filepath.WalkDir(area.Root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return nil
		}
		if entry.IsDir() {
			return nil
		}
		lyricExt := lyricTargetExtension(path)
		if lyricExt == "" {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return nil
		}
		relativePath, err := filepath.Rel(area.Root, path)
		if err != nil {
			relativePath = filepath.Base(path)
		}
		filename := filepath.Base(path)
		base := lyricBaseName(filename)
		artist, title := library.StandardAudioNamePartsFromFilename(base + ".lrc")
		if title == "" {
			title = base
		}
		if artist == "" {
			artist = "歌词"
		}
		files = append(files, serverManagedFile{
			ID:           filepath.ToSlash(relativePath),
			Area:         area.ID,
			Kind:         "lyrics",
			RelativePath: relativePath,
			Filename:     filename,
			Title:        title,
			Artist:       artist,
			Format:       strings.TrimPrefix(lyricExt, "."),
			SizeBytes:    info.Size(),
			ModifiedAt:   info.ModTime(),
		})
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Slice(files, func(i, j int) bool {
		left := strings.ToLower(files[i].Filename)
		right := strings.ToLower(files[j].Filename)
		if left != right {
			return left < right
		}
		return files[i].RelativePath < files[j].RelativePath
	})
	return files, nil
}

func buildServerAudioSet(tracks []models.Track, area audioFileArea) []serverAudioSetEntry {
	entries := make([]serverAudioSetEntry, 0, len(tracks))
	for _, track := range tracks {
		filename := strings.TrimSpace(track.Filename)
		if filename == "" {
			filename = filepath.Base(track.RelativePath)
		}
		if filename == "." || filename == string(filepath.Separator) || filename == "" {
			continue
		}

		artist, title := library.StandardAudioNamePartsFromFilename(filename)
		if artist == "" {
			artist = strings.TrimSpace(track.Artist)
		}
		if title == "" {
			title = strings.TrimSpace(track.Title)
		}
		extension := strings.TrimPrefix(strings.ToLower(filepath.Ext(filename)), ".")
		if artist == "" || title == "" || extension == "" {
			continue
		}

		hash := sha256.Sum256([]byte(filename))
		entries = append(entries, serverAudioSetEntry{
			Filename:         filename,
			FilenameHash:     hex.EncodeToString(hash[:]),
			Artist:           artist,
			Title:            title,
			Extension:        extension,
			Area:             area.ID,
			HasLyrics:        trackHasAreaLyricFile(area.LyricsRoot, track),
			HasKaraokeLyrics: trackHasAreaKaraokeLyricFile(area.LyricsRoot, track),
		})
	}
	return entries
}

func (s *Server) handleAudioFileImport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	userID, ok := s.requireAudioFileUser(w, r)
	if !ok {
		return
	}
	area, ok := s.requireAudioFileArea(w, r)
	if !ok {
		return
	}
	root := area.Root

	cleanupStaleAudioImportDirs()

	jobDir, err := os.MkdirTemp("", strings.TrimSuffix(audioImportTempPattern, "*"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "创建导入临时目录失败")
		return
	}
	defer os.RemoveAll(jobDir)

	r.Body = http.MaxBytesReader(w, r.Body, audioImportMaxTotalBytes+audioImportRequestSlackBytes)
	uploads, report, err := readAudioImportMultipart(r, jobDir)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(uploads) == 0 {
		report.Failed++
		report.Items = append(report.Items, audioFileImportItemResult{Status: "failed", Reason: "未选择可导入的文件"})
		writeJSON(w, http.StatusOK, report)
		return
	}
	if err := ensureImportDiskSpace(root, uploads); err != nil {
		writeError(w, http.StatusInsufficientStorage, err.Error())
		return
	}

	audioFileManagerMu.Lock()
	defer audioFileManagerMu.Unlock()

	report, importedTargets, importedLyrics, err := s.importManagedFiles(r.Context(), area, uploads, report)
	if err != nil {
		removeImportedAudioFiles(importedTargets, importedLyrics)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if report.Imported > 0 || report.LyricsImported > 0 {
		scan, err := s.scanManagedLibrary(r.Context())
		if err != nil {
			removeImportedAudioFiles(importedTargets, importedLyrics)
			writeError(w, http.StatusInternalServerError, fmt.Sprintf("导入后扫描音乐库失败: %v", err))
			return
		}
		report.Scan = &scan
	}
	log.Printf(
		"audio file import complete: user_id=%d imported=%d converted=%d skipped=%d failed=%d lyrics_imported=%d lyrics_skipped=%d lyrics_failed=%d",
		userID,
		report.Imported,
		report.Converted,
		report.Skipped,
		report.Failed,
		report.LyricsImported,
		report.LyricsSkipped,
		report.LyricsFailed,
	)
	writeJSON(w, http.StatusOK, report)
}

func (s *Server) handleAudioFileRoute(w http.ResponseWriter, r *http.Request) {
	if strings.Trim(r.URL.Path, "/") == "api/audio-files/lyrics" {
		s.handleLyricsFileRoute(w, r)
		return
	}
	trackID, ok := parseAudioFileRoute(r.URL.Path)
	if !ok {
		http.NotFound(w, r)
		return
	}
	userID, ok := s.requireAudioFileUser(w, r)
	if !ok {
		return
	}
	area, ok := s.requireAudioFileArea(w, r)
	if !ok {
		return
	}
	if area.Kind != "audio" {
		writeError(w, http.StatusBadRequest, "当前区域不是音乐文件")
		return
	}

	audioFileManagerMu.Lock()
	defer audioFileManagerMu.Unlock()

	switch r.Method {
	case http.MethodPatch:
		s.renameAudioFile(w, r, area, trackID, userID)
	case http.MethodDelete:
		s.deleteAudioFile(w, r, area, trackID, userID)
	default:
		methodNotAllowed(w)
	}
}

func (s *Server) renameAudioFile(w http.ResponseWriter, r *http.Request, area audioFileArea, trackID int64, userID int64) {
	var request audioFileRenameRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	artist, title, err := validateAudioNameParts(request.Artist, request.Title)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	track, ok := s.getManagedTrack(w, r, area.Root, trackID)
	if !ok {
		return
	}
	if track.Quality != area.Quality {
		writeError(w, http.StatusForbidden, "只能管理当前区域内的音乐文件")
		return
	}

	currentExt := strings.ToLower(filepath.Ext(track.Path))
	if currentExt == "" {
		currentExt = "." + strings.ToLower(track.Format)
	}
	targetBase, err := audioTargetBase(artist, title)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	targetPath, err := safeMusicPath(filepath.Dir(track.Path), targetBase+currentExt)
	if err != nil {
		writeError(w, http.StatusBadRequest, "文件名不符合规范")
		return
	}
	if !pathWithinRoot(area.Root, targetPath) {
		writeError(w, http.StatusForbidden, "只能管理音乐目录内的文件")
		return
	}
	if targetPath != track.Path {
		if fileExists(targetPath) {
			writeError(w, http.StatusConflict, "目标文件名已存在")
			return
		}
		if err := os.Rename(track.Path, targetPath); err != nil {
			log.Printf("rename audio file failed: user_id=%d track_id=%d area=%s old_path=%q new_path=%q error=%v", userID, trackID, area.ID, track.Path, targetPath, err)
			writeError(w, http.StatusInternalServerError, "重命名音频文件失败")
			return
		}
		renameAreaLyrics(area.LyricsRoot, track, targetBase)
	}

	scan, err := s.scanManagedLibrary(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("重命名后扫描音乐库失败: %v", err))
		return
	}
	log.Printf("audio file renamed: user_id=%d track_id=%d old_path=%q new_path=%q", userID, trackID, track.Path, targetPath)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "scan": scan})
}

func (s *Server) deleteAudioFile(w http.ResponseWriter, r *http.Request, area audioFileArea, trackID int64, userID int64) {
	track, ok := s.getManagedTrack(w, r, area.Root, trackID)
	if !ok {
		return
	}
	if track.Quality != area.Quality {
		writeError(w, http.StatusForbidden, "只能管理当前区域内的音乐文件")
		return
	}
	if err := os.Remove(track.Path); err != nil && !errors.Is(err, os.ErrNotExist) {
		writeError(w, http.StatusInternalServerError, "删除音频文件失败")
		return
	}
	scan, err := s.scanManagedLibrary(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("删除后扫描音乐库失败: %v", err))
		return
	}
	log.Printf("audio file deleted: user_id=%d track_id=%d path=%q", userID, trackID, track.Path)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "scan": scan})
}

func (s *Server) handleLyricsFileRoute(w http.ResponseWriter, r *http.Request) {
	userID, ok := s.requireAudioFileUser(w, r)
	if !ok {
		return
	}
	area, ok := s.requireAudioFileArea(w, r)
	if !ok {
		return
	}
	if area.Kind != "lyrics" {
		writeError(w, http.StatusBadRequest, "当前区域不是歌词文件")
		return
	}

	audioFileManagerMu.Lock()
	defer audioFileManagerMu.Unlock()

	switch r.Method {
	case http.MethodPatch:
		s.renameLyricsFile(w, r, area, userID)
	case http.MethodDelete:
		s.deleteLyricsFile(w, r, area, userID)
	default:
		methodNotAllowed(w)
	}
}

func (s *Server) renameLyricsFile(w http.ResponseWriter, r *http.Request, area audioFileArea, userID int64) {
	var request managedLyricsFileRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	relativePath := cleanImportRelativePath(request.RelativePath)
	if relativePath == "" {
		writeError(w, http.StatusBadRequest, "请选择歌词文件")
		return
	}
	sourcePath, err := safeExistingManagedPath(area.Root, relativePath)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	artist, title, err := validateAudioNameParts(request.Artist, request.Title)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	currentExt := lyricTargetExtension(sourcePath)
	if currentExt == "" {
		writeError(w, http.StatusBadRequest, "歌词文件格式不支持")
		return
	}
	targetBase, err := audioTargetBase(artist, title)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	targetPath, err := safeMusicPath(filepath.Dir(sourcePath), targetBase+currentExt)
	if err != nil {
		writeError(w, http.StatusBadRequest, "文件名不符合规范")
		return
	}
	if !pathWithinRoot(area.Root, targetPath) {
		writeError(w, http.StatusForbidden, "只能管理当前歌词目录内的文件")
		return
	}
	if sourcePath != targetPath {
		if fileExists(targetPath) {
			writeError(w, http.StatusConflict, "目标文件名已存在")
			return
		}
		if err := os.Rename(sourcePath, targetPath); err != nil {
			log.Printf("rename lyrics file failed: user_id=%d area=%s old_path=%q new_path=%q error=%v", userID, area.ID, sourcePath, targetPath, err)
			writeError(w, http.StatusInternalServerError, "重命名歌词文件失败")
			return
		}
	}
	scan, err := s.scanManagedLibrary(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("重命名后扫描音乐库失败: %v", err))
		return
	}
	log.Printf("lyrics file renamed: user_id=%d area=%s old_path=%q new_path=%q", userID, area.ID, sourcePath, targetPath)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "scan": scan})
}

func (s *Server) deleteLyricsFile(w http.ResponseWriter, r *http.Request, area audioFileArea, userID int64) {
	relativePath := cleanImportRelativePath(r.URL.Query().Get("path"))
	if relativePath == "" {
		writeError(w, http.StatusBadRequest, "请选择歌词文件")
		return
	}
	path, err := safeExistingManagedPath(area.Root, relativePath)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		writeError(w, http.StatusInternalServerError, "删除歌词文件失败")
		return
	}
	scan, err := s.scanManagedLibrary(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("删除后扫描音乐库失败: %v", err))
		return
	}
	log.Printf("lyrics file deleted: user_id=%d area=%s path=%q", userID, area.ID, path)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "scan": scan})
}

func (s *Server) importManagedFiles(ctx context.Context, area audioFileArea, uploads []uploadedAudioImportFile, report audioFileImportReport) (audioFileImportReport, []string, []string, error) {
	if area.Kind == "lyrics" {
		return importLyricsFiles(ctx, area, uploads, report)
	}

	root := area.Root
	lyricsByBase := make(map[string][]uploadedAudioImportFile)
	addLyricLookupKey := func(key string, upload uploadedAudioImportFile) {
		if key == "" {
			return
		}
		for _, existing := range lyricsByBase[key] {
			if existing.RelativePath == upload.RelativePath {
				return
			}
		}
		lyricsByBase[key] = append(lyricsByBase[key], upload)
	}
	for _, upload := range uploads {
		if upload.Kind != "lyrics" {
			continue
		}
		addLyricLookupKey(normalizedImportBase(upload.RelativePath), upload)
		if artist, title := library.StandardAudioNamePartsFromFilename(upload.RelativePath); artist != "" && title != "" {
			targetBase := sanitizeAudioFilename(artist + "-" + title)
			addLyricLookupKey(normalizedImportBase(targetBase+".lrc"), upload)
		}
	}
	handledLyricPaths := make(map[string]bool)
	findLyricsForAudio := func(upload uploadedAudioImportFile, targetFilename string) []uploadedAudioImportFile {
		keys := []string{normalizedImportBase(upload.RelativePath)}
		if targetFilename != "" {
			keys = append(keys, normalizedImportBase(targetFilename))
		}
		seen := make(map[string]bool)
		var lyrics []uploadedAudioImportFile
		for _, key := range keys {
			for _, lyric := range lyricsByBase[key] {
				if handledLyricPaths[lyric.RelativePath] || seen[lyric.RelativePath] {
					continue
				}
				seen[lyric.RelativePath] = true
				lyrics = append(lyrics, lyric)
			}
		}
		return lyrics
	}
	addLyricSkipped := func(lyric uploadedAudioImportFile, targetFilename string, reason string) {
		handledLyricPaths[lyric.RelativePath] = true
		report.Skipped++
		report.LyricsSkipped++
		report.Items = append(report.Items, audioFileImportItemResult{
			RelativePath:   lyric.RelativePath,
			TargetFilename: targetFilename,
			Status:         "skipped",
			Reason:         reason,
			SizeBytes:      lyric.SizeBytes,
		})
	}
	addLyricFailed := func(lyric uploadedAudioImportFile, targetFilename string, reason string) {
		handledLyricPaths[lyric.RelativePath] = true
		report.Failed++
		report.LyricsFailed++
		report.Items = append(report.Items, audioFileImportItemResult{
			RelativePath:   lyric.RelativePath,
			TargetFilename: targetFilename,
			Status:         "failed",
			Reason:         reason,
			SizeBytes:      lyric.SizeBytes,
		})
	}
	addLyricImported := func(lyric uploadedAudioImportFile, targetFilename string, reason string) {
		if reason == "" {
			reason = "歌词已随同名音频导入"
		}
		handledLyricPaths[lyric.RelativePath] = true
		report.LyricsImported++
		report.Items = append(report.Items, audioFileImportItemResult{
			RelativePath:   lyric.RelativePath,
			TargetFilename: targetFilename,
			Status:         "imported",
			Reason:         reason,
			SizeBytes:      lyric.SizeBytes,
		})
	}

	var importedTargets []string
	var importedLyrics []string
	var existingTracksByLyricKey map[string]models.Track
	loadExistingTracksByLyricKey := func() (map[string]models.Track, error) {
		if existingTracksByLyricKey != nil {
			return existingTracksByLyricKey, nil
		}
		tracks, err := s.store.ListTracksByQuality(ctx, area.Quality)
		if err != nil {
			return nil, err
		}
		existingTracksByLyricKey = make(map[string]models.Track, len(tracks)*3)
		addTrackKey := func(key string, track models.Track) {
			if key == "" {
				return
			}
			if _, exists := existingTracksByLyricKey[key]; !exists {
				existingTracksByLyricKey[key] = track
			}
		}
		for _, track := range tracks {
			if area.Root != "" && !pathWithinRoot(area.Root, track.Path) {
				continue
			}
			addTrackKey(normalizedImportBase(track.RelativePath), track)
			addTrackKey(normalizedImportBase(track.Filename), track)
			if track.Artist != "" && track.Title != "" {
				targetBase := sanitizeAudioFilename(track.Artist + "-" + track.Title)
				addTrackKey(normalizedImportBase(targetBase+".lrc"), track)
			}
		}
		return existingTracksByLyricKey, nil
	}
	findExistingTrackForLyric := func(lyric uploadedAudioImportFile) (models.Track, bool, error) {
		tracksByKey, err := loadExistingTracksByLyricKey()
		if err != nil {
			return models.Track{}, false, err
		}
		keys := []string{normalizedImportBase(lyric.RelativePath)}
		if artist, title := library.StandardAudioNamePartsFromFilename(lyric.RelativePath); artist != "" && title != "" {
			targetBase := sanitizeAudioFilename(artist + "-" + title)
			keys = append(keys, normalizedImportBase(targetBase+".lrc"))
		}
		for _, key := range keys {
			if track, ok := tracksByKey[key]; ok {
				return track, true, nil
			}
		}
		return models.Track{}, false, nil
	}
	importLyricForExistingTrack := func(lyric uploadedAudioImportFile) (bool, error) {
		if handledLyricPaths[lyric.RelativePath] {
			return true, nil
		}
		track, ok, err := findExistingTrackForLyric(lyric)
		if err != nil {
			return false, err
		}
		if !ok {
			return false, nil
		}
		targetBase := sanitizeAudioFilename(strings.TrimSuffix(track.Filename, filepath.Ext(track.Filename)))
		if targetBase == "" && track.Artist != "" && track.Title != "" {
			targetBase = sanitizeAudioFilename(track.Artist + "-" + track.Title)
		}
		if targetBase == "" {
			addLyricSkipped(lyric, "", "对应音乐文件名不符合规范，歌词已跳过")
			return true, nil
		}
		ext := lyricTargetExtension(lyric.RelativePath)
		if ext == "" {
			addLyricSkipped(lyric, "", "歌词文件格式不支持，已跳过")
			return true, nil
		}
		targetFilename := targetBase + ext
		if strings.TrimSpace(area.LyricsRoot) == "" {
			addLyricSkipped(lyric, targetFilename, "当前区域未配置歌词目录，歌词已跳过")
			return true, nil
		}
		lyricTarget, err := safeMusicPath(area.LyricsRoot, targetFilename)
		if err != nil {
			addLyricSkipped(lyric, targetFilename, "歌词目标文件名不符合规范，已跳过")
			return true, nil
		}
		if fileExists(lyricTarget) {
			addLyricSkipped(lyric, targetFilename, "目标歌词文件已存在，已跳过")
			return true, nil
		}
		if err := copyFile(lyric.TempPath, lyricTarget); err != nil {
			addLyricFailed(lyric, targetFilename, "保存歌词文件失败")
			return true, nil
		}
		importedLyrics = append(importedLyrics, lyricTarget)
		reason := "歌词已补充到服务器已有音乐"
		if ext == karaokeLyricExtension {
			reason = "KTV 逐字时间轴已补充到服务器已有音乐"
		}
		addLyricImported(lyric, targetFilename, reason)
		return true, nil
	}

	for _, upload := range uploads {
		if upload.Kind != "audio" {
			continue
		}
		if ctx.Err() != nil {
			return report, importedTargets, importedLyrics, ctx.Err()
		}

		artist, title := library.StandardAudioNameParts(upload.TempPath, upload.RelativePath)
		artist, title, err := validateAudioNameParts(artist, title)
		if err != nil {
			report.Skipped++
			report.Items = append(report.Items, audioFileImportItemResult{
				RelativePath: upload.RelativePath,
				Status:       "skipped",
				Reason:       "无法识别歌曲名和歌手，请按“歌手-歌曲名称”命名后重新导入",
				SizeBytes:    upload.SizeBytes,
			})
			for _, lyric := range findLyricsForAudio(upload, "") {
				addLyricSkipped(lyric, "", "对应音频无法识别，歌词已跳过")
			}
			continue
		}

		targetBase := sanitizeAudioFilename(artist + "-" + title)
		if !areaSupportsAudioUpload(area, upload) {
			report.Skipped++
			report.Items = append(report.Items, audioFileImportItemResult{
				RelativePath: upload.RelativePath,
				Status:       "skipped",
				Reason:       areaAudioUnsupportedReason(area),
				SizeBytes:    upload.SizeBytes,
			})
			for _, lyric := range findLyricsForAudio(upload, "") {
				addLyricSkipped(lyric, "", "对应音频格式不属于当前区域，歌词已跳过")
			}
			continue
		}
		targetExt := upload.Ext
		if area.Quality == models.TrackQualityLossless {
			targetExt = ".flac"
		}
		targetFilename := targetBase + targetExt
		targetPath, err := safeMusicPath(root, targetFilename)
		if err != nil {
			report.Skipped++
			report.Items = append(report.Items, audioFileImportItemResult{RelativePath: upload.RelativePath, Status: "skipped", Reason: "目标文件名不符合规范", SizeBytes: upload.SizeBytes})
			for _, lyric := range findLyricsForAudio(upload, targetFilename) {
				addLyricSkipped(lyric, "", "对应音频目标文件名不符合规范，歌词已跳过")
			}
			continue
		}
		if fileExists(targetPath) {
			reason := "目标文件名已存在，已跳过"
			if sameFileHash(targetPath, upload.SHA256) {
				reason = "服务器已存在相同文件，已跳过"
			}
			report.Skipped++
			report.Items = append(report.Items, audioFileImportItemResult{RelativePath: upload.RelativePath, TargetFilename: targetFilename, Status: "skipped", Reason: reason, SizeBytes: upload.SizeBytes})
			for _, lyric := range findLyricsForAudio(upload, targetFilename) {
				handled, err := importLyricForExistingTrack(lyric)
				if err != nil {
					return report, importedTargets, importedLyrics, err
				}
				if !handled {
					addLyricSkipped(lyric, targetBase+lyricTargetExtensionOrDefault(lyric.RelativePath), "对应音频已存在，歌词已跳过")
				}
			}
			continue
		}

		if area.Quality == models.TrackQualityLossy {
			if err := copyFile(upload.TempPath, targetPath); err != nil {
				report.Failed++
				report.Items = append(report.Items, audioFileImportItemResult{RelativePath: upload.RelativePath, TargetFilename: targetFilename, Status: "failed", Reason: "保存轻音乐文件失败", SizeBytes: upload.SizeBytes})
				for _, lyric := range findLyricsForAudio(upload, targetFilename) {
					addLyricSkipped(lyric, targetBase+lyricTargetExtensionOrDefault(lyric.RelativePath), "对应音频保存失败，歌词已跳过")
				}
				continue
			}
		} else if uploadIsFLAC(upload) {
			if err := copyFile(upload.TempPath, targetPath); err != nil {
				report.Failed++
				report.Items = append(report.Items, audioFileImportItemResult{RelativePath: upload.RelativePath, TargetFilename: targetFilename, Status: "failed", Reason: "保存 FLAC 文件失败", SizeBytes: upload.SizeBytes})
				for _, lyric := range findLyricsForAudio(upload, targetFilename) {
					addLyricSkipped(lyric, targetBase+lyricTargetExtensionOrDefault(lyric.RelativePath), "对应音频保存失败，歌词已跳过")
				}
				continue
			}
		} else {
			if err := convertLosslessToFLAC(ctx, upload.TempPath, targetPath); err != nil {
				_ = os.Remove(targetPath)
				report.Failed++
				report.Items = append(report.Items, audioFileImportItemResult{RelativePath: upload.RelativePath, TargetFilename: targetFilename, Status: "failed", Reason: err.Error(), SizeBytes: upload.SizeBytes})
				for _, lyric := range findLyricsForAudio(upload, targetFilename) {
					addLyricSkipped(lyric, targetBase+lyricTargetExtensionOrDefault(lyric.RelativePath), "对应音频转码失败，歌词已跳过")
				}
				continue
			}
			report.Converted++
		}
		importedTargets = append(importedTargets, targetPath)

		for _, lyric := range findLyricsForAudio(upload, targetFilename) {
			lyricTargetFilename := targetBase + lyricTargetExtensionOrDefault(lyric.RelativePath)
			if strings.TrimSpace(area.LyricsRoot) == "" {
				addLyricSkipped(lyric, lyricTargetFilename, "当前区域未配置歌词目录，歌词已跳过")
				continue
			}
			lyricTarget, err := safeMusicPath(area.LyricsRoot, lyricTargetFilename)
			if err != nil {
				addLyricSkipped(lyric, lyricTargetFilename, "歌词目标文件名不符合规范，已跳过")
			} else if fileExists(lyricTarget) {
				addLyricSkipped(lyric, lyricTargetFilename, "目标歌词文件已存在，已跳过")
			} else if err := copyFile(lyric.TempPath, lyricTarget); err != nil {
				addLyricFailed(lyric, lyricTargetFilename, "保存歌词文件失败")
			} else {
				importedLyrics = append(importedLyrics, lyricTarget)
				reason := ""
				if lyricTargetExtension(lyric.RelativePath) == karaokeLyricExtension {
					reason = "KTV 逐字时间轴已随同名音频导入"
				}
				addLyricImported(lyric, lyricTargetFilename, reason)
			}
		}

		report.Imported++
		report.Items = append(report.Items, audioFileImportItemResult{
			RelativePath:   upload.RelativePath,
			TargetFilename: targetFilename,
			Status:         "imported",
			SizeBytes:      upload.SizeBytes,
		})
	}
	for _, upload := range uploads {
		if upload.Kind == "lyrics" && !handledLyricPaths[upload.RelativePath] {
			handled, err := importLyricForExistingTrack(upload)
			if err != nil {
				return report, importedTargets, importedLyrics, err
			}
			if handled {
				continue
			}
			addLyricSkipped(upload, "", "未找到同名可导入音频，歌词已跳过")
		}
	}
	return report, importedTargets, importedLyrics, nil
}

func importLyricsFiles(ctx context.Context, area audioFileArea, uploads []uploadedAudioImportFile, report audioFileImportReport) (audioFileImportReport, []string, []string, error) {
	var importedLyrics []string
	for _, upload := range uploads {
		if ctx.Err() != nil {
			return report, nil, importedLyrics, ctx.Err()
		}
		if upload.Kind != "lyrics" {
			report.Skipped++
			report.Items = append(report.Items, audioFileImportItemResult{
				RelativePath: upload.RelativePath,
				Status:       "skipped",
				Reason:       "当前区域只接受歌词文件",
				SizeBytes:    upload.SizeBytes,
			})
			continue
		}
		base := sanitizeAudioFilename(lyricBaseName(upload.RelativePath))
		if base == "" {
			base = sanitizeAudioFilename(lyricBaseName(upload.OriginalName))
		}
		ext := lyricTargetExtension(upload.RelativePath)
		if ext == "" {
			report.Skipped++
			report.LyricsSkipped++
			report.Items = append(report.Items, audioFileImportItemResult{RelativePath: upload.RelativePath, Status: "skipped", Reason: "歌词文件格式不支持，已跳过", SizeBytes: upload.SizeBytes})
			continue
		}
		targetFilename := base + ext
		targetPath, err := safeMusicPath(area.Root, targetFilename)
		if err != nil {
			report.Skipped++
			report.LyricsSkipped++
			report.Items = append(report.Items, audioFileImportItemResult{RelativePath: upload.RelativePath, Status: "skipped", Reason: "歌词目标文件名不符合规范", SizeBytes: upload.SizeBytes})
			continue
		}
		if fileExists(targetPath) {
			report.Skipped++
			report.LyricsSkipped++
			report.Items = append(report.Items, audioFileImportItemResult{RelativePath: upload.RelativePath, TargetFilename: targetFilename, Status: "skipped", Reason: "目标歌词文件已存在，已跳过", SizeBytes: upload.SizeBytes})
			continue
		}
		if err := copyFile(upload.TempPath, targetPath); err != nil {
			report.Failed++
			report.LyricsFailed++
			report.Items = append(report.Items, audioFileImportItemResult{RelativePath: upload.RelativePath, TargetFilename: targetFilename, Status: "failed", Reason: "保存歌词文件失败", SizeBytes: upload.SizeBytes})
			continue
		}
		importedLyrics = append(importedLyrics, targetPath)
		report.LyricsImported++
		report.Items = append(report.Items, audioFileImportItemResult{RelativePath: upload.RelativePath, TargetFilename: targetFilename, Status: "imported", SizeBytes: upload.SizeBytes})
	}
	return report, nil, importedLyrics, nil
}

func readAudioImportMultipart(r *http.Request, jobDir string) ([]uploadedAudioImportFile, audioFileImportReport, error) {
	reader, err := r.MultipartReader()
	if err != nil {
		return nil, audioFileImportReport{}, errors.New("上传请求格式不正确")
	}

	manifestByField := make(map[string]audioFileImportManifestItem)
	report := audioFileImportReport{Items: make([]audioFileImportItemResult, 0)}
	uploads := make([]uploadedAudioImportFile, 0)
	var totalBytes int64
	fileCount := 0

	for {
		part, err := reader.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, report, errors.New("读取上传内容失败")
		}
		fieldName := part.FormName()
		if fieldName == "manifest" {
			manifest, err := readAudioImportManifest(part)
			if err != nil {
				return nil, report, err
			}
			for _, item := range manifest.Files {
				if item.FieldName != "" {
					manifestByField[item.FieldName] = item
				}
			}
			continue
		}
		if !strings.HasPrefix(fieldName, "file_") {
			_, _ = io.Copy(io.Discard, part)
			continue
		}

		fileCount++
		if fileCount > audioImportMaxFileCount {
			return nil, report, fmt.Errorf("单次上传文件数量不能超过%d个", audioImportMaxFileCount)
		}

		manifestItem := manifestByField[fieldName]
		relativePathSource := strings.TrimSpace(manifestItem.RelativePath)
		if relativePathSource == "" {
			relativePathSource = part.FileName()
		}
		relativePath := cleanImportRelativePath(relativePathSource)
		if relativePath == "" {
			relativePath = fieldName
		}
		ext := strings.ToLower(filepath.Ext(relativePath))
		kind := audioImportFileKind(relativePath)
		if kind == "" {
			size, copyErr := countAndDiscard(part)
			totalBytes += size
			if totalBytes > audioImportMaxTotalBytes {
				return nil, report, errors.New("单次上传文件总大小不能超过4GB")
			}
			if copyErr != nil {
				return nil, report, errors.New("读取上传文件失败")
			}
			report.Skipped++
			report.Items = append(report.Items, audioFileImportItemResult{RelativePath: relativePath, Status: "skipped", Reason: "仅支持 FLAC/WAV/AIFF、MP3/AAC/M4A/OGG 音频和 LRC/TXT/KTV JSON 歌词文件", SizeBytes: size})
			continue
		}

		maxBytes := audioImportMaxAudioFileBytes
		if kind == "lyrics" {
			maxBytes = audioImportMaxLyricFileBytes
		}
		tempPath := filepath.Join(jobDir, fmt.Sprintf("%04d%s", fileCount, ext))
		size, hash, err := saveImportPart(part, tempPath, maxBytes)
		totalBytes += size
		if totalBytes > audioImportMaxTotalBytes {
			return nil, report, errors.New("单次上传文件总大小不能超过4GB")
		}
		if err != nil {
			_, _ = io.Copy(io.Discard, part)
			_ = os.Remove(tempPath)
			report.Failed++
			if kind == "lyrics" {
				report.LyricsFailed++
			}
			report.Items = append(report.Items, audioFileImportItemResult{RelativePath: relativePath, Status: "failed", Reason: err.Error(), SizeBytes: size})
			continue
		}
		uploads = append(uploads, uploadedAudioImportFile{
			FieldName:    fieldName,
			RelativePath: relativePath,
			OriginalName: filepath.Base(relativePath),
			TempPath:     tempPath,
			SizeBytes:    size,
			SHA256:       hash,
			Ext:          ext,
			Kind:         kind,
		})
	}
	return uploads, report, nil
}

func readAudioImportManifest(part *multipart.Part) (audioFileImportManifest, error) {
	content, err := io.ReadAll(io.LimitReader(part, audioImportManifestMaxBytes+1))
	if err != nil {
		return audioFileImportManifest{}, errors.New("读取上传清单失败")
	}
	if int64(len(content)) > audioImportManifestMaxBytes {
		return audioFileImportManifest{}, errors.New("上传清单过大")
	}
	var manifest audioFileImportManifest
	if len(strings.TrimSpace(string(content))) == 0 {
		return manifest, nil
	}
	if err := json.Unmarshal(content, &manifest); err != nil {
		return audioFileImportManifest{}, errors.New("上传清单格式不正确")
	}
	return manifest, nil
}

func saveImportPart(part *multipart.Part, target string, maxBytes int64) (int64, string, error) {
	file, err := os.Create(target)
	if err != nil {
		return 0, "", errors.New("创建临时文件失败")
	}
	defer file.Close()

	hash := sha256.New()
	limited := &limitedPartReader{reader: part, max: maxBytes}
	size, err := io.Copy(io.MultiWriter(file, hash), limited)
	if err != nil {
		return size, "", errors.New("保存上传文件失败")
	}
	if limited.exceeded {
		if maxBytes == audioImportMaxLyricFileBytes {
			return size, "", errors.New("单个歌词文件不能超过2MB")
		}
		return size, "", errors.New("单个音频文件不能超过200MB")
	}
	return size, hex.EncodeToString(hash.Sum(nil)), nil
}

type limitedPartReader struct {
	reader   io.Reader
	max      int64
	read     int64
	exceeded bool
}

func (r *limitedPartReader) Read(buffer []byte) (int, error) {
	if r.read >= r.max+1 {
		r.exceeded = true
		return 0, io.EOF
	}
	remaining := r.max + 1 - r.read
	if int64(len(buffer)) > remaining {
		buffer = buffer[:remaining]
	}
	n, err := r.reader.Read(buffer)
	r.read += int64(n)
	if r.read > r.max {
		r.exceeded = true
	}
	return n, err
}

func countAndDiscard(reader io.Reader) (int64, error) {
	return io.Copy(io.Discard, reader)
}

func (s *Server) requireAudioFileUser(w http.ResponseWriter, r *http.Request) (int64, bool) {
	userID, err := audioFileUserID(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err.Error())
		return 0, false
	}
	userID, ok := s.requireMatchingSessionUserID(w, r, userID, "请先登录后管理服务器文件")
	if !ok {
		return 0, false
	}
	user, err := s.store.GetUserByID(r.Context(), userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusForbidden, "当前用户无权管理服务器文件")
			return 0, false
		}
		writeError(w, http.StatusInternalServerError, "校验用户权限失败")
		return 0, false
	}
	if !models.UserCanManageAudioFiles(user.Role) {
		writeError(w, http.StatusForbidden, "当前用户无权管理服务器文件")
		return 0, false
	}
	if !s.audioFileAccess.Validate(userID, audioFileAccessToken(r), time.Now()) {
		writeError(w, http.StatusUnauthorized, "请先验证当前用户密码后再管理服务器文件")
		return 0, false
	}
	return userID, true
}

func audioFileAccessToken(r *http.Request) string {
	token := strings.TrimSpace(r.Header.Get("X-Audio-Access-Token"))
	if token != "" {
		return token
	}
	return strings.TrimSpace(r.URL.Query().Get("audio_access_token"))
}

func audioFileUserID(r *http.Request) (int64, error) {
	userIDText := strings.TrimSpace(r.URL.Query().Get("user_id"))
	if userIDText == "" {
		if strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "multipart/") {
			return 0, errors.New("请先登录后管理服务器文件")
		}
		userIDText = strings.TrimSpace(r.FormValue("user_id"))
	}
	if userIDText == "" {
		return 0, errors.New("请先登录后管理服务器文件")
	}
	return validatePositiveID(userIDText, "用户")
}

func (s *Server) requireMusicRoot(w http.ResponseWriter, r *http.Request) (string, bool) {
	setting, err := s.store.GetSetting(r.Context(), musicDirectoryKey)
	if errors.Is(err, pgx.ErrNoRows) || setting.Path == "" {
		writeError(w, http.StatusBadRequest, "请先设置音乐目录")
		return "", false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "读取音乐目录失败")
		return "", false
	}
	root, err := validateDirectory(setting.Path)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return "", false
	}
	return root, true
}

func (s *Server) requireAudioFileArea(w http.ResponseWriter, r *http.Request) (audioFileArea, bool) {
	areaID := strings.TrimSpace(r.URL.Query().Get("area"))
	if areaID == "" {
		areaID = "lossless_music"
	}
	area, err := s.audioFileArea(r.Context(), areaID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return audioFileArea{}, false
	}
	return area, true
}

func (s *Server) audioFileArea(ctx context.Context, areaID string) (audioFileArea, error) {
	definition, ok := audioFileAreaDefinition(areaID)
	if !ok {
		return audioFileArea{}, errors.New("未知文件区域")
	}
	root, err := s.settingPath(ctx, definition.Root)
	if err != nil {
		return audioFileArea{}, fmt.Errorf("读取%s目录失败", definition.Label)
	}
	if root == "" {
		return audioFileArea{}, fmt.Errorf("请先配置%s目录", definition.Label)
	}
	root, err = validateDirectory(root)
	if err != nil {
		return audioFileArea{}, err
	}
	definition.Root = root
	if definition.LyricsRoot != "" {
		lyricsRoot, err := s.settingPath(ctx, definition.LyricsRoot)
		if err != nil {
			return audioFileArea{}, fmt.Errorf("读取%s歌词目录失败", definition.Label)
		}
		if strings.TrimSpace(lyricsRoot) != "" {
			if validLyricsRoot, err := validateDirectory(lyricsRoot); err == nil {
				definition.LyricsRoot = validLyricsRoot
			} else {
				definition.LyricsRoot = ""
			}
		}
	}
	return definition, nil
}

func audioFileAreaDefinition(areaID string) (audioFileArea, bool) {
	switch areaID {
	case "lossless_music":
		return audioFileArea{ID: areaID, Label: "高品质", Kind: "audio", Quality: models.TrackQualityLossless, Root: losslessMusicDirectoryKey, LyricsRoot: losslessLyricsDirectoryKey}, true
	case "lossy_music":
		return audioFileArea{ID: areaID, Label: "轻音乐", Kind: "audio", Quality: models.TrackQualityLossy, Root: lossyMusicDirectoryKey, LyricsRoot: lossyLyricsDirectoryKey}, true
	case "lossless_lyrics":
		return audioFileArea{ID: areaID, Label: "无损歌词", Kind: "lyrics", Root: losslessLyricsDirectoryKey}, true
	case "lossy_lyrics":
		return audioFileArea{ID: areaID, Label: "有损歌词", Kind: "lyrics", Root: lossyLyricsDirectoryKey}, true
	case "shared_lyrics":
		return audioFileArea{ID: areaID, Label: "公共歌词", Kind: "lyrics", Root: sharedLyricsDirectoryKey}, true
	default:
		return audioFileArea{}, false
	}
}

func (s *Server) settingPath(ctx context.Context, key string) (string, error) {
	setting, err := s.store.GetSetting(ctx, key)
	if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, sql.ErrNoRows) {
		if key == losslessMusicDirectoryKey {
			legacy, legacyErr := s.store.GetSetting(ctx, musicDirectoryKey)
			if legacyErr == nil {
				return legacy.Path, nil
			}
			if !errors.Is(legacyErr, pgx.ErrNoRows) && !errors.Is(legacyErr, sql.ErrNoRows) {
				return "", legacyErr
			}
		}
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return setting.Path, nil
}

func (s *Server) configuredManagedScanRoots(ctx context.Context) []library.ScanRoot {
	sharedLyrics, _ := s.settingPath(ctx, sharedLyricsDirectoryKey)
	var roots []library.ScanRoot
	if losslessMusic, _ := s.settingPath(ctx, losslessMusicDirectoryKey); strings.TrimSpace(losslessMusic) != "" {
		losslessLyrics, _ := s.settingPath(ctx, losslessLyricsDirectoryKey)
		roots = append(roots, library.LosslessScanRoot(losslessMusic, compactPathList(losslessLyrics, sharedLyrics)...))
	}
	if lossyMusic, _ := s.settingPath(ctx, lossyMusicDirectoryKey); strings.TrimSpace(lossyMusic) != "" {
		lossyLyrics, _ := s.settingPath(ctx, lossyLyricsDirectoryKey)
		roots = append(roots, library.LossyScanRoot(lossyMusic, compactPathList(lossyLyrics, sharedLyrics)...))
	}
	return roots
}

func (s *Server) scanManagedLibrary(ctx context.Context) (models.ScanResult, error) {
	roots := s.configuredManagedScanRoots(ctx)
	if len(roots) == 0 {
		return models.ScanResult{}, errors.New("请先配置音乐目录")
	}
	return s.scanner.ScanRoots(ctx, roots)
}

func compactPathList(paths ...string) []string {
	result := make([]string, 0, len(paths))
	seen := make(map[string]bool, len(paths))
	for _, path := range paths {
		path = strings.TrimSpace(path)
		if path == "" || seen[path] {
			continue
		}
		seen[path] = true
		result = append(result, path)
	}
	return result
}

func (s *Server) getManagedTrack(w http.ResponseWriter, r *http.Request, root string, trackID int64) (models.Track, bool) {
	track, err := s.store.GetTrack(r.Context(), trackID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "音频文件不存在")
		return models.Track{}, false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "读取音频文件失败")
		return models.Track{}, false
	}
	if !pathWithinRoot(root, track.Path) {
		writeError(w, http.StatusForbidden, "只能管理音乐目录内的文件")
		return models.Track{}, false
	}
	return track, true
}

func validateAudioNameParts(artist, title string) (string, string, error) {
	artist = strings.TrimSpace(artist)
	title = strings.TrimSpace(title)
	if artist == "" || title == "" {
		return "", "", errors.New("请提供歌手和歌曲名")
	}
	return artist, title, nil
}

func audioTargetBase(artist string, title string) (string, error) {
	artist = sanitizeAudioFilename(artist)
	title = sanitizeAudioFilename(title)
	if artist == "" || title == "" {
		return "", errors.New("歌手和歌曲名不能只包含特殊字符")
	}
	targetBase := sanitizeAudioFilename(artist + "-" + title)
	if targetBase == "" || strings.HasPrefix(targetBase, "-") || strings.HasSuffix(targetBase, "-") {
		return "", errors.New("文件名不符合规范")
	}
	return targetBase, nil
}

func audioImportFileKind(path string) string {
	if isKaraokeLyricFilename(path) {
		return "lyrics"
	}
	switch strings.ToLower(filepath.Ext(path)) {
	case ".flac", ".wav", ".aif", ".aiff", ".mp3", ".aac", ".m4a", ".ogg":
		return "audio"
	case ".lrc", ".txt":
		return "lyrics"
	default:
		return ""
	}
}

func areaSupportsAudioUpload(area audioFileArea, upload uploadedAudioImportFile) bool {
	ext := strings.ToLower(upload.Ext)
	if area.Quality == models.TrackQualityLossy {
		switch ext {
		case ".mp3", ".aac", ".m4a", ".ogg":
			return true
		default:
			return false
		}
	}
	switch ext {
	case ".flac", ".wav", ".aif", ".aiff":
		return true
	case ".mp3":
		return uploadIsFLAC(upload)
	default:
		return false
	}
}

func areaAudioUnsupportedReason(area audioFileArea) string {
	if area.Quality == models.TrackQualityLossy {
		return "轻音乐区仅支持 MP3/AAC/M4A/OGG"
	}
	return "高品质区仅支持 FLAC/WAV/AIFF"
}

func sanitizeAudioFilename(value string) string {
	value = strings.Map(func(r rune) rune {
		if r < 32 || strings.ContainsRune(`\/:*?"<>|`, r) {
			return ' '
		}
		if unicode.IsSpace(r) {
			return ' '
		}
		return r
	}, value)
	value = fileNameSpacePattern.ReplaceAllString(strings.TrimSpace(value), " ")
	value = strings.Trim(value, ". ")
	if len([]rune(value)) > 160 {
		runes := []rune(value)
		value = string(runes[:160])
		value = strings.Trim(value, ". ")
	}
	return value
}

func cleanImportRelativePath(value string) string {
	value = filepath.ToSlash(strings.TrimSpace(value))
	value = strings.TrimLeft(value, "/")
	cleaned := filepath.Clean(filepath.FromSlash(value))
	if cleaned == "." || strings.HasPrefix(cleaned, "..") || filepath.IsAbs(cleaned) {
		return filepath.Base(value)
	}
	return cleaned
}

func normalizedImportBase(path string) string {
	base := lyricBaseName(path)
	base = strings.TrimSpace(strings.ToLower(base))
	return fileNameSpacePattern.ReplaceAllString(base, " ")
}

func isKaraokeLyricFilename(path string) bool {
	return strings.HasSuffix(strings.ToLower(filepath.Base(path)), karaokeLyricExtension)
}

func lyricTargetExtension(path string) string {
	if isKaraokeLyricFilename(path) {
		return karaokeLyricExtension
	}
	switch strings.ToLower(filepath.Ext(path)) {
	case ".lrc":
		return ".lrc"
	case ".txt":
		return ".txt"
	default:
		return ""
	}
}

func lyricTargetExtensionOrDefault(path string) string {
	if ext := lyricTargetExtension(path); ext != "" {
		return ext
	}
	return ".lrc"
}

func lyricBaseName(path string) string {
	base := filepath.Base(path)
	if isKaraokeLyricFilename(base) {
		return strings.TrimSpace(base[:len(base)-len(karaokeLyricExtension)])
	}
	return strings.TrimSpace(strings.TrimSuffix(base, filepath.Ext(base)))
}

func trackHasAreaLyricFile(lyricsRoot string, track models.Track) bool {
	return trackHasAreaLyricExtension(lyricsRoot, track, ".lrc", ".txt")
}

func trackHasAreaKaraokeLyricFile(lyricsRoot string, track models.Track) bool {
	return trackHasAreaLyricExtension(lyricsRoot, track, karaokeLyricExtension)
}

func trackHasAreaLyricExtension(lyricsRoot string, track models.Track, extensions ...string) bool {
	if strings.TrimSpace(lyricsRoot) == "" {
		return false
	}
	for _, base := range trackLyricBaseCandidates(track) {
		for _, ext := range extensions {
			path := filepath.Join(lyricsRoot, base+ext)
			if pathWithinRoot(lyricsRoot, path) && fileExists(path) {
				return true
			}
			upperPath := filepath.Join(lyricsRoot, base+strings.ToUpper(ext))
			if pathWithinRoot(lyricsRoot, upperPath) && fileExists(upperPath) {
				return true
			}
		}
	}
	return false
}

func trackLyricBaseCandidates(track models.Track) []string {
	candidates := make([]string, 0, 3)
	seen := make(map[string]bool, 3)
	add := func(value string) {
		value = strings.TrimSpace(strings.TrimSuffix(value, filepath.Ext(value)))
		if value == "" || seen[value] {
			return
		}
		seen[value] = true
		candidates = append(candidates, value)
	}
	add(track.RelativePath)
	add(track.Filename)
	if track.Artist != "" && track.Title != "" {
		add(sanitizeAudioFilename(track.Artist + "-" + track.Title))
	}
	return candidates
}

func safeMusicPath(root, filename string) (string, error) {
	filename = sanitizeAudioFilename(filename)
	if filename == "" {
		return "", errors.New("empty filename")
	}
	target := filepath.Join(root, filename)
	if !pathWithinRoot(root, target) {
		return "", errors.New("invalid target path")
	}
	return target, nil
}

func safeExistingManagedPath(root, relativePath string) (string, error) {
	relativePath = cleanImportRelativePath(relativePath)
	if relativePath == "" {
		return "", errors.New("文件路径不符合规范")
	}
	target := filepath.Join(root, relativePath)
	if !pathWithinRoot(root, target) {
		return "", errors.New("只能管理当前目录内的文件")
	}
	info, err := os.Stat(target)
	if errors.Is(err, os.ErrNotExist) {
		return "", errors.New("文件不存在")
	}
	if err != nil {
		return "", errors.New("读取文件失败")
	}
	if info.IsDir() {
		return "", errors.New("不能管理文件夹")
	}
	return target, nil
}

func pathWithinRoot(root, path string) bool {
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
	return relative == "." || (!strings.HasPrefix(relative, ".."+string(filepath.Separator)) && relative != "..")
}

func renameAreaLyrics(lyricsRoot string, track models.Track, newBase string) {
	if strings.TrimSpace(lyricsRoot) == "" {
		return
	}
	oldBase := strings.TrimSuffix(track.Filename, filepath.Ext(track.Filename))
	for _, ext := range []string{".lrc", ".LRC", ".txt", ".TXT", karaokeLyricExtension, strings.ToUpper(karaokeLyricExtension)} {
		oldPath := filepath.Join(lyricsRoot, oldBase+ext)
		if !fileExists(oldPath) {
			continue
		}
		newExt := ".lrc"
		if strings.EqualFold(ext, ".txt") {
			newExt = ".txt"
		} else if strings.EqualFold(ext, karaokeLyricExtension) {
			newExt = karaokeLyricExtension
		}
		newPath := filepath.Join(lyricsRoot, newBase+newExt)
		if pathWithinRoot(lyricsRoot, newPath) && !fileExists(newPath) {
			_ = os.Rename(oldPath, newPath)
		}
	}
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func sameFileHash(path, expected string) bool {
	if expected == "" {
		return false
	}
	hash, err := fileSHA256(path)
	return err == nil && hash == expected
}

func fileSHA256(path string) (string, error) {
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

func copyFile(source, target string) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := os.Create(target)
	if err != nil {
		return err
	}
	defer output.Close()
	if _, err := io.Copy(output, input); err != nil {
		return err
	}
	return output.Sync()
}

func uploadIsFLAC(upload uploadedAudioImportFile) bool {
	if upload.Ext == ".flac" {
		return true
	}
	return fileHasFLACSignature(upload.TempPath)
}

func fileHasFLACSignature(path string) bool {
	file, err := os.Open(path)
	if err != nil {
		return false
	}
	defer file.Close()

	header := make([]byte, 10)
	n, err := io.ReadFull(file, header)
	if err != nil && !errors.Is(err, io.ErrUnexpectedEOF) && !errors.Is(err, io.EOF) {
		return false
	}
	if n >= 4 && string(header[:4]) == "fLaC" {
		return true
	}
	if n < 10 || string(header[:3]) != "ID3" {
		return false
	}

	tagSize := int(header[6]&0x7F)<<21 | int(header[7]&0x7F)<<14 | int(header[8]&0x7F)<<7 | int(header[9]&0x7F)
	if tagSize < 0 {
		return false
	}
	if _, err := file.Seek(int64(10+tagSize), io.SeekStart); err != nil {
		return false
	}
	signature := make([]byte, 4)
	if _, err := io.ReadFull(file, signature); err != nil {
		return false
	}
	return string(signature) == "fLaC"
}

func convertLosslessToFLAC(ctx context.Context, source, target string) error {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		return errors.New("服务器未安装 ffmpeg，无法转码为 FLAC")
	}
	command := exec.CommandContext(ctx, "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", source, "-map_metadata", "0", "-c:a", "flac", target)
	output, err := command.CombinedOutput()
	if err != nil {
		message := strings.TrimSpace(string(output))
		if message == "" {
			message = "转码为 FLAC 失败"
		}
		return errors.New(message)
	}
	return nil
}

func removeImportedAudioFiles(audioPaths, lyricPaths []string) {
	for _, path := range append(audioPaths, lyricPaths...) {
		_ = os.Remove(path)
	}
}

func removeSidecarLyrics(audioPath string) {
	base := strings.TrimSuffix(audioPath, filepath.Ext(audioPath))
	for _, ext := range []string{".lrc", ".LRC", ".txt", ".TXT", karaokeLyricExtension, strings.ToUpper(karaokeLyricExtension)} {
		_ = os.Remove(base + ext)
	}
}

func renameSidecarLyrics(oldAudioPath, newAudioPath string) {
	oldBase := strings.TrimSuffix(oldAudioPath, filepath.Ext(oldAudioPath))
	newBase := strings.TrimSuffix(newAudioPath, filepath.Ext(newAudioPath))
	for _, ext := range []string{".lrc", ".LRC", ".txt", ".TXT", karaokeLyricExtension, strings.ToUpper(karaokeLyricExtension)} {
		oldPath := oldBase + ext
		if !fileExists(oldPath) {
			continue
		}
		newExt := ".lrc"
		if strings.EqualFold(ext, ".txt") {
			newExt = ".txt"
		} else if strings.EqualFold(ext, karaokeLyricExtension) {
			newExt = karaokeLyricExtension
		}
		newPath := newBase + newExt
		if !fileExists(newPath) {
			_ = os.Rename(oldPath, newPath)
		}
	}
}

func cleanupStaleAudioImportDirs() {
	tempRoot := os.TempDir()
	entries, err := filepath.Glob(filepath.Join(tempRoot, audioImportTempPattern))
	if err != nil {
		return
	}
	cutoff := time.Now().Add(-audioImportStaleAge)
	sort.Strings(entries)
	for _, entry := range entries {
		info, err := os.Stat(entry)
		if err != nil || !info.IsDir() || info.ModTime().After(cutoff) {
			continue
		}
		_ = os.RemoveAll(entry)
	}
}

func audioFileLimits() audioFilesLimitsResponse {
	return audioFilesLimitsResponse{
		MaxAudioFileBytes: audioImportMaxAudioFileBytes,
		MaxTotalBytes:     audioImportMaxTotalBytes,
		MaxFileCount:      audioImportMaxFileCount,
		MaxLyricFileBytes: audioImportMaxLyricFileBytes,
	}
}

func parseAudioFileRoute(path string) (int64, bool) {
	const prefix = "/api/audio-files/"
	if !strings.HasPrefix(path, prefix) {
		return 0, false
	}
	idText := strings.TrimPrefix(path, prefix)
	if idText == "" || strings.Contains(idText, "/") || idText == "import" {
		return 0, false
	}
	id, err := strconv.ParseInt(idText, 10, 64)
	return id, err == nil && id > 0
}
