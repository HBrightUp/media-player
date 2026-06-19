package httpapi

import (
	"context"
	"crypto/sha256"
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
	"syscall"
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
	Filename     string `json:"filename"`
	FilenameHash string `json:"filename_hash"`
	Artist       string `json:"artist"`
	Title        string `json:"title"`
	Extension    string `json:"extension"`
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
		writeError(w, http.StatusUnauthorized, "当前用户无权管理服务器音频文件")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "校验用户失败")
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
	tracks, err := s.store.ListTracks(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "读取服务器音频文件失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"files":            tracks,
		"server_audio_set": buildServerAudioSet(tracks),
		"limits":           audioFileLimits(),
	})
}

func buildServerAudioSet(tracks []models.Track) []serverAudioSetEntry {
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
			Filename:     filename,
			FilenameHash: hex.EncodeToString(hash[:]),
			Artist:       artist,
			Title:        title,
			Extension:    extension,
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
	root, ok := s.requireMusicRoot(w, r)
	if !ok {
		return
	}

	audioFileManagerMu.Lock()
	defer audioFileManagerMu.Unlock()

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
		report.Items = append(report.Items, audioFileImportItemResult{Status: "failed", Reason: "未选择可导入的音频或歌词文件"})
		writeJSON(w, http.StatusOK, report)
		return
	}
	if err := ensureImportDiskSpace(root, uploads); err != nil {
		writeError(w, http.StatusInsufficientStorage, err.Error())
		return
	}

	report, importedTargets, importedLyrics, err := s.importAudioFiles(r.Context(), root, uploads, report)
	if err != nil {
		removeImportedAudioFiles(importedTargets, importedLyrics)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if report.Imported > 0 {
		scan, err := s.scanner.Scan(r.Context(), root)
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
	trackID, ok := parseAudioFileRoute(r.URL.Path)
	if !ok {
		http.NotFound(w, r)
		return
	}
	userID, ok := s.requireAudioFileUser(w, r)
	if !ok {
		return
	}
	root, ok := s.requireMusicRoot(w, r)
	if !ok {
		return
	}

	audioFileManagerMu.Lock()
	defer audioFileManagerMu.Unlock()

	switch r.Method {
	case http.MethodPatch:
		s.renameAudioFile(w, r, root, trackID, userID)
	case http.MethodDelete:
		s.deleteAudioFile(w, r, root, trackID, userID)
	default:
		methodNotAllowed(w)
	}
}

func (s *Server) renameAudioFile(w http.ResponseWriter, r *http.Request, root string, trackID int64, userID int64) {
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
	track, ok := s.getManagedTrack(w, r, root, trackID)
	if !ok {
		return
	}

	currentExt := strings.ToLower(filepath.Ext(track.Path))
	if currentExt == "" {
		currentExt = "." + strings.ToLower(track.Format)
	}
	targetBase := sanitizeAudioFilename(artist + "-" + title)
	targetPath, err := safeMusicPath(filepath.Dir(track.Path), targetBase+currentExt)
	if err != nil {
		writeError(w, http.StatusBadRequest, "文件名不符合规范")
		return
	}
	if !pathWithinRoot(root, targetPath) {
		writeError(w, http.StatusForbidden, "只能管理音乐目录内的文件")
		return
	}
	if targetPath != track.Path {
		if fileExists(targetPath) {
			writeError(w, http.StatusConflict, "目标文件名已存在")
			return
		}
		if err := os.Rename(track.Path, targetPath); err != nil {
			writeError(w, http.StatusInternalServerError, "重命名音频文件失败")
			return
		}
		renameSidecarLyrics(track.Path, targetPath)
	}

	scan, err := s.scanner.Scan(r.Context(), root)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("重命名后扫描音乐库失败: %v", err))
		return
	}
	log.Printf("audio file renamed: user_id=%d track_id=%d old_path=%q new_path=%q", userID, trackID, track.Path, targetPath)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "scan": scan})
}

func (s *Server) deleteAudioFile(w http.ResponseWriter, r *http.Request, root string, trackID int64, userID int64) {
	track, ok := s.getManagedTrack(w, r, root, trackID)
	if !ok {
		return
	}
	if err := os.Remove(track.Path); err != nil && !errors.Is(err, os.ErrNotExist) {
		writeError(w, http.StatusInternalServerError, "删除音频文件失败")
		return
	}
	removeSidecarLyrics(track.Path)
	scan, err := s.scanner.Scan(r.Context(), root)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("删除后扫描音乐库失败: %v", err))
		return
	}
	log.Printf("audio file deleted: user_id=%d track_id=%d path=%q", userID, trackID, track.Path)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "scan": scan})
}

func (s *Server) importAudioFiles(ctx context.Context, root string, uploads []uploadedAudioImportFile, report audioFileImportReport) (audioFileImportReport, []string, []string, error) {
	lyricsByBase := make(map[string]uploadedAudioImportFile)
	addLyricLookupKey := func(key string, upload uploadedAudioImportFile) {
		if key == "" {
			return
		}
		if _, exists := lyricsByBase[key]; !exists {
			lyricsByBase[key] = upload
		}
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
	findLyricForAudio := func(upload uploadedAudioImportFile, targetFilename string) (uploadedAudioImportFile, bool) {
		keys := []string{normalizedImportBase(upload.RelativePath)}
		if targetFilename != "" {
			keys = append(keys, normalizedImportBase(targetFilename))
		}
		for _, key := range keys {
			if lyric, ok := lyricsByBase[key]; ok && !handledLyricPaths[lyric.RelativePath] {
				return lyric, true
			}
		}
		return uploadedAudioImportFile{}, false
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
	addLyricImported := func(lyric uploadedAudioImportFile, targetFilename string) {
		handledLyricPaths[lyric.RelativePath] = true
		report.LyricsImported++
		report.Items = append(report.Items, audioFileImportItemResult{
			RelativePath:   lyric.RelativePath,
			TargetFilename: targetFilename,
			Status:         "imported",
			Reason:         "歌词已随同名音频导入",
			SizeBytes:      lyric.SizeBytes,
		})
	}

	var importedTargets []string
	var importedLyrics []string
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
			if lyric, ok := findLyricForAudio(upload, ""); ok {
				addLyricSkipped(lyric, "", "对应音频无法识别，歌词已跳过")
			}
			continue
		}

		targetBase := sanitizeAudioFilename(artist + "-" + title)
		targetFilename := targetBase + ".flac"
		targetPath, err := safeMusicPath(root, targetFilename)
		if err != nil {
			report.Skipped++
			report.Items = append(report.Items, audioFileImportItemResult{RelativePath: upload.RelativePath, Status: "skipped", Reason: "目标文件名不符合规范", SizeBytes: upload.SizeBytes})
			if lyric, ok := findLyricForAudio(upload, targetFilename); ok {
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
			if lyric, ok := findLyricForAudio(upload, targetFilename); ok {
				addLyricSkipped(lyric, targetBase+".lrc", "对应音频已存在，歌词已跳过")
			}
			continue
		}

		if uploadIsFLAC(upload) {
			if err := copyFile(upload.TempPath, targetPath); err != nil {
				report.Failed++
				report.Items = append(report.Items, audioFileImportItemResult{RelativePath: upload.RelativePath, TargetFilename: targetFilename, Status: "failed", Reason: "保存 FLAC 文件失败", SizeBytes: upload.SizeBytes})
				if lyric, ok := findLyricForAudio(upload, targetFilename); ok {
					addLyricSkipped(lyric, targetBase+".lrc", "对应音频保存失败，歌词已跳过")
				}
				continue
			}
		} else {
			if err := convertLosslessToFLAC(ctx, upload.TempPath, targetPath); err != nil {
				_ = os.Remove(targetPath)
				report.Failed++
				report.Items = append(report.Items, audioFileImportItemResult{RelativePath: upload.RelativePath, TargetFilename: targetFilename, Status: "failed", Reason: err.Error(), SizeBytes: upload.SizeBytes})
				if lyric, ok := findLyricForAudio(upload, targetFilename); ok {
					addLyricSkipped(lyric, targetBase+".lrc", "对应音频转码失败，歌词已跳过")
				}
				continue
			}
			report.Converted++
		}
		importedTargets = append(importedTargets, targetPath)

		if lyric, ok := findLyricForAudio(upload, targetFilename); ok {
			lyricTargetFilename := targetBase + ".lrc"
			lyricTarget, err := safeMusicPath(root, lyricTargetFilename)
			if err != nil {
				addLyricSkipped(lyric, lyricTargetFilename, "歌词目标文件名不符合规范，已跳过")
			} else if fileExists(lyricTarget) {
				addLyricSkipped(lyric, lyricTargetFilename, "目标歌词文件已存在，已跳过")
			} else if err := copyFile(lyric.TempPath, lyricTarget); err != nil {
				addLyricFailed(lyric, lyricTargetFilename, "保存歌词文件失败")
			} else {
				importedLyrics = append(importedLyrics, lyricTarget)
				addLyricImported(lyric, lyricTargetFilename)
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
			addLyricSkipped(upload, "", "未找到同名可导入音频，歌词已跳过")
		}
	}
	return report, importedTargets, importedLyrics, nil
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
		kind := audioImportFileKind(ext)
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
			report.Items = append(report.Items, audioFileImportItemResult{RelativePath: relativePath, Status: "skipped", Reason: "仅支持 FLAC/WAV/AIFF 音频和 LRC/TXT 歌词文件", SizeBytes: size})
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

func ensureImportDiskSpace(root string, uploads []uploadedAudioImportFile) error {
	var uploadBytes int64
	for _, upload := range uploads {
		uploadBytes += upload.SizeBytes
	}
	requiredBytes := uploadBytes*2 + int64(512*1024*1024)
	var stat syscall.Statfs_t
	if err := syscall.Statfs(root, &stat); err != nil {
		return nil
	}
	availableBytes := int64(stat.Bavail) * int64(stat.Bsize)
	if availableBytes < requiredBytes {
		return errors.New("服务器剩余磁盘空间不足，无法安全导入并转码")
	}
	return nil
}

func (s *Server) requireAudioFileUser(w http.ResponseWriter, r *http.Request) (int64, bool) {
	userID, err := audioFileUserID(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err.Error())
		return 0, false
	}
	if _, err := s.store.GetUserByID(r.Context(), userID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusForbidden, "当前用户无权管理服务器音频文件")
			return 0, false
		}
		writeError(w, http.StatusInternalServerError, "校验用户权限失败")
		return 0, false
	}
	if !s.audioFileAccess.Validate(userID, audioFileAccessToken(r), time.Now()) {
		writeError(w, http.StatusUnauthorized, "请先验证当前用户密码后再管理服务器音频文件")
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
			return 0, errors.New("请先登录后管理服务器音频文件")
		}
		userIDText = strings.TrimSpace(r.FormValue("user_id"))
	}
	if userIDText == "" {
		return 0, errors.New("请先登录后管理服务器音频文件")
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

func audioImportFileKind(ext string) string {
	switch ext {
	case ".flac", ".wav", ".aif", ".aiff":
		return "audio"
	case ".lrc", ".txt":
		return "lyrics"
	default:
		return ""
	}
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
	base := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	base = strings.TrimSpace(strings.ToLower(base))
	return fileNameSpacePattern.ReplaceAllString(base, " ")
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
	for _, ext := range []string{".lrc", ".LRC", ".txt", ".TXT"} {
		_ = os.Remove(base + ext)
	}
}

func renameSidecarLyrics(oldAudioPath, newAudioPath string) {
	oldBase := strings.TrimSuffix(oldAudioPath, filepath.Ext(oldAudioPath))
	newBase := strings.TrimSuffix(newAudioPath, filepath.Ext(newAudioPath))
	for _, ext := range []string{".lrc", ".LRC", ".txt", ".TXT"} {
		oldPath := oldBase + ext
		if !fileExists(oldPath) {
			continue
		}
		newExt := ".lrc"
		if strings.EqualFold(ext, ".txt") {
			newExt = ".txt"
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
