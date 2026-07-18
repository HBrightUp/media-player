package library

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"unicode/utf16"
	"unicode/utf8"

	"github.com/hml/media-player/backend/internal/models"
	"golang.org/x/text/encoding/simplifiedchinese"
)

const maxEmbeddedCoverBytes = 8 * 1024 * 1024

var supportedAudioFormats = map[string]bool{
	".aac":  true,
	".aif":  true,
	".aiff": true,
	".flac": true,
	".m4a":  true,
	".mp3":  true,
	".ogg":  true,
	".wav":  true,
}

var losslessAudioFormats = map[string]bool{
	".aif":  true,
	".aiff": true,
	".flac": true,
	".wav":  true,
}

var lossyAudioFormats = map[string]bool{
	".aac": true,
	".m4a": true,
	".mp3": true,
	".ogg": true,
}

type Scanner struct {
	store       trackStore
	lyricsRoots []string
	mu          sync.Mutex
}

type trackStore interface {
	UpsertTrack(context.Context, models.Track) (int64, error)
	ReplaceTrackLyrics(context.Context, int64, *models.TrackLyrics) error
	DeleteTracksUnderRootExceptPaths(context.Context, string, []string, []string) error
}

type ScanRoot struct {
	MusicRoot   string
	LyricsRoots []string
	Quality     string
	Formats     map[string]bool
}

type tags struct {
	Title  string
	Artist string
	Album  string
	Lyrics []models.LyricLine
	Cover  *models.TrackCover
}

func NewScanner(store trackStore, lyricsRoot ...string) *Scanner {
	roots := make([]string, 0, len(lyricsRoot))
	for _, root := range lyricsRoot {
		root = strings.TrimSpace(root)
		if root != "" {
			if absolute, err := filepath.Abs(root); err == nil {
				root = absolute
			}
			roots = append(roots, root)
		}
	}
	return &Scanner{store: store, lyricsRoots: roots}
}

func (s *Scanner) Scan(ctx context.Context, root string) (models.ScanResult, error) {
	return s.ScanRoots(ctx, []ScanRoot{{
		MusicRoot:   root,
		LyricsRoots: s.lyricsRoots,
		Formats:     supportedAudioFormats,
	}})
}

func (s *Scanner) ScanMP3(ctx context.Context, root string) (models.ScanResult, error) {
	return s.ScanRoots(ctx, []ScanRoot{{
		MusicRoot:   root,
		LyricsRoots: s.lyricsRoots,
		Quality:     models.TrackQualityLossy,
		Formats:     map[string]bool{".mp3": true},
	}})
}

func LosslessScanRoot(musicRoot string, lyricsRoots ...string) ScanRoot {
	return ScanRoot{
		MusicRoot:   musicRoot,
		LyricsRoots: lyricsRoots,
		Quality:     models.TrackQualityLossless,
		Formats:     losslessAudioFormats,
	}
}

func LossyScanRoot(musicRoot string, lyricsRoots ...string) ScanRoot {
	return ScanRoot{
		MusicRoot:   musicRoot,
		LyricsRoots: lyricsRoots,
		Quality:     models.TrackQualityLossy,
		Formats:     lossyAudioFormats,
	}
}

func (s *Scanner) ScanRoots(ctx context.Context, specs []ScanRoot) (models.ScanResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	result := models.ScanResult{}
	rootLabels := make([]string, 0, len(specs))
	scannedRoots := 0

	for _, spec := range specs {
		musicRoot := strings.TrimSpace(spec.MusicRoot)
		if musicRoot == "" {
			continue
		}
		absRoot, err := filepath.Abs(musicRoot)
		if err != nil {
			recordScanError(&result, musicRoot, fmt.Errorf("resolve music directory: %w", err))
			continue
		}
		info, err := os.Stat(absRoot)
		if err != nil {
			recordScanError(&result, absRoot, fmt.Errorf("read music directory: %w", err))
			continue
		}
		if !info.IsDir() {
			recordScanError(&result, absRoot, fmt.Errorf("%s is not a directory", absRoot))
			continue
		}

		formats := spec.Formats
		if len(formats) == 0 {
			formats = supportedAudioFormats
		}
		quality := strings.TrimSpace(strings.ToLower(spec.Quality))
		lyricsRoots := normalizeLyricsRoots(spec.LyricsRoots)
		labelQuality := quality
		if labelQuality == "" {
			labelQuality = "mixed"
		}
		rootLabels = append(rootLabels, fmt.Sprintf("%s:%s", labelQuality, absRoot))
		scannedRoots++
		seenPaths := make([]string, 0)
		traversalIncomplete := false
		protectedRoots := nestedScanRootPrefixes(absRoot, specs)
		protectedRootSet := make(map[string]bool, len(protectedRoots))
		for _, prefix := range protectedRoots {
			protectedRootSet[prefix] = true
		}

		err = filepath.WalkDir(absRoot, func(path string, entry fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				recordScanError(&result, path, walkErr)
				if entry == nil || entry.IsDir() {
					traversalIncomplete = true
				}
				return nil
			}
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if entry.IsDir() {
				if path != absRoot && protectedRootSet[filepath.Clean(path)+string(os.PathSeparator)] {
					return filepath.SkipDir
				}
				return nil
			}

			ext := strings.ToLower(filepath.Ext(path))
			if !formats[ext] {
				return nil
			}
			result.Found++
			seenPaths = append(seenPaths, path)

			track, lyrics, err := buildTrack(absRoot, path, ext, lyricsRoots, quality)
			if err != nil {
				recordScanError(&result, path, err)
				return nil
			}
			trackID, err := s.store.UpsertTrack(ctx, track)
			if err != nil {
				recordScanError(&result, path, err)
				return nil
			}
			if err := s.store.ReplaceTrackLyrics(ctx, trackID, lyrics); err != nil {
				recordScanError(&result, path, err)
				return nil
			}
			result.Imported++
			return nil
		})
		if err != nil {
			return result, err
		}
		if traversalIncomplete {
			continue
		}
		if err := s.store.DeleteTracksUnderRootExceptPaths(ctx, absRoot, seenPaths, protectedRoots); err != nil {
			return result, fmt.Errorf("remove missing tracks under %s: %w", absRoot, err)
		}
	}
	result.RootPath = strings.Join(rootLabels, ";")
	if scannedRoots == 0 {
		return result, errors.New("music directory is required")
	}
	return result, nil
}

func nestedScanRootPrefixes(root string, specs []ScanRoot) []string {
	root = filepath.Clean(root)
	prefixes := make([]string, 0)
	seen := make(map[string]bool)
	for _, spec := range specs {
		candidate := strings.TrimSpace(spec.MusicRoot)
		if candidate == "" {
			continue
		}
		absolute, err := filepath.Abs(candidate)
		if err != nil {
			continue
		}
		absolute = filepath.Clean(absolute)
		relative, err := filepath.Rel(root, absolute)
		if err != nil || relative == "." || relative == ".." || strings.HasPrefix(relative, ".."+string(os.PathSeparator)) {
			continue
		}
		prefix := absolute + string(os.PathSeparator)
		if !seen[prefix] {
			seen[prefix] = true
			prefixes = append(prefixes, prefix)
		}
	}
	return prefixes
}

func recordScanError(result *models.ScanResult, path string, err error) {
	result.Skipped++
	if len(result.Errors) >= 8 {
		return
	}
	result.Errors = append(result.Errors, fmt.Sprintf("%s: %v", path, err))
}

func normalizeTrackQuality(quality string) string {
	switch strings.TrimSpace(strings.ToLower(quality)) {
	case models.TrackQualityLossy:
		return models.TrackQualityLossy
	default:
		return models.TrackQualityLossless
	}
}

func trackQualityFromExtension(ext string) string {
	if lossyAudioFormats[strings.ToLower(ext)] {
		return models.TrackQualityLossy
	}
	return models.TrackQualityLossless
}

func normalizeLyricsRoots(roots []string) []string {
	normalized := make([]string, 0, len(roots))
	seen := make(map[string]bool, len(roots))
	for _, root := range roots {
		root = strings.TrimSpace(root)
		if root == "" {
			continue
		}
		if absolute, err := filepath.Abs(root); err == nil {
			root = absolute
		}
		if seen[root] {
			continue
		}
		seen[root] = true
		normalized = append(normalized, root)
	}
	return normalized
}

func buildTrack(root, path, ext string, lyricsRoots []string, quality string) (models.Track, *models.TrackLyrics, error) {
	info, err := os.Stat(path)
	if err != nil {
		return models.Track{}, nil, err
	}

	filename := filepath.Base(path)
	metadata := readTags(path, ext)
	nameMetadata := tagsFromFilename(filename)

	title := firstAudioNameText(metadata.Title, nameMetadata.Title, strings.TrimSuffix(filename, filepath.Ext(filename)))
	artist := firstAudioNameText(metadata.Artist, nameMetadata.Artist, "未知歌手")
	album := firstText(metadata.Album, "未知专辑")
	lyrics := firstTrackLyrics(
		readLyricsDirectories(root, path, lyricsRoots),
		readSidecarLyrics(path),
		trackLyricsFromLines(metadata.Lyrics, "embedded", ""),
	)

	relativePath, err := filepath.Rel(root, path)
	if err != nil {
		relativePath = filename
	}

	return models.Track{
		Path:         path,
		RelativePath: relativePath,
		Filename:     filename,
		Title:        title,
		Artist:       artist,
		Album:        album,
		Format:       strings.TrimPrefix(ext, "."),
		Quality:      normalizeTrackQuality(firstText(quality, trackQualityFromExtension(ext))),
		SizeBytes:    info.Size(),
		ModifiedAt:   info.ModTime(),
		Cover:        metadata.Cover,
	}, lyrics, nil
}

func readTags(path, ext string) tags {
	var metadata tags
	if id3v2Tags, err := readID3v2(path); err == nil {
		metadata = mergeTags(metadata, id3v2Tags)
	}
	if ext == ".mp3" {
		if id3v1Tags, err := readID3v1(path); err == nil {
			metadata = mergeTags(metadata, id3v1Tags)
		}
	}
	if ext == ".mp3" || ext == ".m4a" || ext == ".aac" {
		if mp4Tags, err := readMP4Tags(path); err == nil {
			metadata = mergeTags(metadata, mp4Tags)
		}
	}
	if ext == ".flac" {
		if flacTags, err := readFLACTags(path); err == nil {
			metadata = mergeTags(metadata, flacTags)
		}
	}
	return metadata
}

func mergeTags(primary, fallback tags) tags {
	primary.Title = firstText(primary.Title, fallback.Title)
	primary.Artist = firstText(primary.Artist, fallback.Artist)
	primary.Album = firstText(primary.Album, fallback.Album)
	primary.Lyrics = firstLyrics(primary.Lyrics, fallback.Lyrics)
	primary.Cover = firstCover(primary.Cover, fallback.Cover)
	return primary
}

func tagsFromFilename(filename string) tags {
	base := strings.TrimSpace(strings.TrimSuffix(filename, filepath.Ext(filename)))
	for _, separator := range []string{" - ", "-", "—", "–", "_"} {
		artist, title, ok := strings.Cut(base, separator)
		if ok {
			artist = cleanAudioNamePart(artist)
			title = cleanAudioNamePart(title)
			if artist != "" && title != "" {
				return tags{
					Title:  title,
					Artist: artist,
				}
			}
		}
	}
	return tags{Title: cleanAudioNamePart(base)}
}

func firstAudioNameText(values ...string) string {
	for _, value := range values {
		if text := cleanAudioNamePart(value); text != "" {
			return text
		}
	}
	return ""
}

func firstText(values ...string) string {
	for _, value := range values {
		if text := trimText(value); text != "" {
			return text
		}
	}
	return ""
}

func firstLyrics(values ...[]models.LyricLine) []models.LyricLine {
	for _, value := range values {
		lines := compactLyrics(value)
		if len(lines) > 0 {
			return lines
		}
	}
	return []models.LyricLine{}
}

func firstCover(values ...*models.TrackCover) *models.TrackCover {
	for _, value := range values {
		if value != nil && value.MimeType != "" && len(value.Data) > 0 {
			return value
		}
	}
	return nil
}

func newTrackCover(mimeType string, data []byte) *models.TrackCover {
	if len(data) == 0 || len(data) > maxEmbeddedCoverBytes {
		return nil
	}
	mimeType = detectCoverMimeType(mimeType, data)
	if !strings.HasPrefix(mimeType, "image/") {
		return nil
	}
	copied := append([]byte(nil), data...)
	sum := sha256.Sum256(copied)
	return &models.TrackCover{
		MimeType:  mimeType,
		Data:      copied,
		Hash:      hex.EncodeToString(sum[:]),
		SizeBytes: int64(len(copied)),
	}
}

func detectCoverMimeType(mimeType string, data []byte) string {
	mimeType = strings.ToLower(strings.TrimSpace(strings.Trim(mimeType, "\x00")))
	switch {
	case len(data) >= 3 && bytes.Equal(data[:3], []byte{0xFF, 0xD8, 0xFF}):
		return "image/jpeg"
	case len(data) >= 8 && bytes.Equal(data[:8], []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1A, '\n'}):
		return "image/png"
	case len(data) >= 12 && string(data[:4]) == "RIFF" && string(data[8:12]) == "WEBP":
		return "image/webp"
	case len(data) >= 6 && (string(data[:6]) == "GIF87a" || string(data[:6]) == "GIF89a"):
		return "image/gif"
	}
	switch mimeType {
	case "image/jpg", "jpg", "jpeg":
		return "image/jpeg"
	case "png":
		return "image/png"
	case "webp":
		return "image/webp"
	case "gif":
		return "image/gif"
	}
	if strings.HasPrefix(mimeType, "image/") {
		return mimeType
	}
	return ""
}

func firstTrackLyrics(values ...*models.TrackLyrics) *models.TrackLyrics {
	for _, value := range values {
		if value == nil {
			continue
		}
		value.Lines = compactLyrics(value.Lines)
		if len(value.Lines) == 0 {
			continue
		}
		if value.Format == "" {
			value.Format = lyricFormat(value.Lines)
		}
		if value.Content == "" {
			value.Content = lyricContent(value.Lines)
		}
		return value
	}
	return nil
}

func compactLyrics(lines []models.LyricLine) []models.LyricLine {
	if len(lines) == 0 {
		return nil
	}
	result := make([]models.LyricLine, 0, len(lines))
	for _, line := range lines {
		line.Text = trimText(line.Text)
		if line.Text == "" {
			continue
		}
		result = append(result, line)
	}
	sort.SliceStable(result, func(i, j int) bool {
		if result[i].TimeSeconds == nil {
			return false
		}
		if result[j].TimeSeconds == nil {
			return true
		}
		return *result[i].TimeSeconds < *result[j].TimeSeconds
	})
	return result
}

func readLyricsDirectories(root, audioPath string, lyricsRoots []string) *models.TrackLyrics {
	for _, lyricsRoot := range lyricsRoots {
		if lyrics := readLyricsDirectory(root, audioPath, lyricsRoot); lyrics != nil {
			return lyrics
		}
	}
	return nil
}

func readLyricsDirectory(root, audioPath, lyricsRoot string) *models.TrackLyrics {
	if lyricsRoot == "" {
		return nil
	}
	relativePath, err := filepath.Rel(root, audioPath)
	if err != nil {
		relativePath = filepath.Base(audioPath)
	}
	baseRelativePath := strings.TrimSuffix(relativePath, filepath.Ext(relativePath))
	baseFilename := strings.TrimSuffix(filepath.Base(audioPath), filepath.Ext(audioPath))
	candidates := lyricsPathCandidates(lyricsRoot, baseRelativePath, baseFilename)
	for _, candidate := range candidates {
		if lyrics := readLRCFile(candidate, "lyrics_directory"); lyrics != nil {
			return lyrics
		}
	}
	lyricsDir := filepath.Join(lyricsRoot, filepath.Dir(baseRelativePath))
	if lyrics := readTitleSuffixLyrics(lyricsDir, baseFilename); lyrics != nil {
		return lyrics
	}
	return nil
}

func lyricsPathCandidates(lyricsRoot string, baseRelativePath string, baseFilename string) []string {
	bases := []string{baseRelativePath, baseFilename}
	extensions := []string{".lrc", ".LRC", ".txt", ".TXT"}
	candidates := make([]string, 0, len(bases)*len(extensions))
	seen := make(map[string]bool, len(bases)*len(extensions))
	for _, base := range bases {
		base = strings.TrimSpace(base)
		if base == "" {
			continue
		}
		for _, extension := range extensions {
			candidate := filepath.Join(lyricsRoot, base+extension)
			if seen[candidate] {
				continue
			}
			seen[candidate] = true
			candidates = append(candidates, candidate)
		}
	}
	return candidates
}

func readTitleSuffixLyrics(lyricsDir string, baseFilename string) *models.TrackLyrics {
	entries, err := os.ReadDir(lyricsDir)
	if err != nil {
		return nil
	}
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Name() < entries[j].Name()
	})
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		extension := strings.ToLower(filepath.Ext(name))
		if extension != ".lrc" && extension != ".txt" {
			continue
		}
		base := strings.TrimSuffix(name, filepath.Ext(name))
		if !isLyricsTitleMatch(base, baseFilename) {
			continue
		}
		if lyrics := readLRCFile(filepath.Join(lyricsDir, name), "lyrics_directory"); lyrics != nil {
			return lyrics
		}
	}
	return nil
}

func isLyricsTitleMatch(lyricsBase string, audioBase string) bool {
	lyricsBase = strings.TrimSpace(lyricsBase)
	audioBase = strings.TrimSpace(audioBase)
	if lyricsBase == "" || audioBase == "" {
		return false
	}
	if strings.EqualFold(lyricsBase, audioBase) {
		return true
	}
	return strings.HasSuffix(strings.ToLower(lyricsBase), "-"+strings.ToLower(audioBase))
}

func readSidecarLyrics(path string) *models.TrackLyrics {
	base := strings.TrimSuffix(path, filepath.Ext(path))
	for _, candidate := range []string{base + ".lrc", base + ".LRC", base + ".txt", base + ".TXT"} {
		if lyrics := readLRCFile(candidate, "sidecar"); lyrics != nil {
			return lyrics
		}
	}
	return nil
}

func readLRCFile(path, source string) *models.TrackLyrics {
	content, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	text := decodeTextFile(content)
	lines := parseLRC(text)
	if len(lines) == 0 {
		lines = lyricsFromPlainText(stripLRCMetadata(text))
	}
	if len(lines) == 0 {
		return nil
	}
	lines = mergeKaraokeTimeline(path, lines)
	sourcePath := path
	return &models.TrackLyrics{
		Format:     lyricFormat(lines),
		Content:    text,
		Lines:      lines,
		Source:     source,
		SourcePath: &sourcePath,
	}
}

type karaokeTimeline struct {
	Version int                `json:"version"`
	Lines   []models.LyricLine `json:"lines"`
}

func mergeKaraokeTimeline(lyricsPath string, lines []models.LyricLine) []models.LyricLine {
	timelinePath := strings.TrimSuffix(lyricsPath, filepath.Ext(lyricsPath)) + ".karaoke.json"
	content, err := os.ReadFile(timelinePath)
	if err != nil {
		return lines
	}

	var timeline karaokeTimeline
	if json.Unmarshal(content, &timeline) != nil || timeline.Version != 1 {
		return lines
	}

	for _, timedLine := range timeline.Lines {
		if timedLine.TimeSeconds == nil || len(timedLine.Words) == 0 {
			continue
		}
		words := validKaraokeWords(timedLine.Words)
		if len(words) == 0 {
			continue
		}
		for index := range lines {
			if lines[index].TimeSeconds == nil || trimText(lines[index].Text) != trimText(timedLine.Text) {
				continue
			}
			delta := *lines[index].TimeSeconds - *timedLine.TimeSeconds
			if delta < -0.02 || delta > 0.02 {
				continue
			}
			lines[index].Words = words
			break
		}
	}
	return lines
}

func validKaraokeWords(words []models.LyricWord) []models.LyricWord {
	result := make([]models.LyricWord, 0, len(words))
	lastStart := -1.0
	for _, word := range words {
		if word.Text == "" || word.StartSeconds < 0 || word.EndSeconds < word.StartSeconds || word.StartSeconds < lastStart {
			return nil
		}
		result = append(result, word)
		lastStart = word.StartSeconds
	}
	return result
}

func parseLRC(content string) []models.LyricLine {
	var lines []models.LyricLine
	for _, rawLine := range strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n") {
		rawLine = strings.TrimSpace(rawLine)
		if rawLine == "" {
			continue
		}

		var timestamps []float64
		for strings.HasPrefix(rawLine, "[") {
			end := strings.Index(rawLine, "]")
			if end < 0 {
				break
			}
			token := rawLine[1:end]
			rawLine = strings.TrimSpace(rawLine[end+1:])
			if timestamp, ok := parseLRCTimestamp(token); ok {
				timestamps = append(timestamps, timestamp)
			}
		}
		if rawLine == "" || len(timestamps) == 0 {
			continue
		}
		for _, timestamp := range timestamps {
			if isLyricMetadataText(rawLine, &timestamp) {
				continue
			}
			value := timestamp
			lines = append(lines, models.LyricLine{
				TimeSeconds: &value,
				Text:        rawLine,
			})
		}
	}
	return compactLyrics(lines)
}

var lyricCreditLabelHints = []string{
	"作词", "词", "作曲", "曲", "编曲", "编配", "制作", "制作人", "制作统筹", "制作公司",
	"监制", "混音", "母带", "录音", "配唱", "人声编辑", "音频编辑", "和声", "和音",
	"吉他", "贝斯", "鼓", "键盘", "乐队", "音乐总监", "项目总监", "总监", "弦乐",
	"古筝", "箫", "笛", "长笛", "二胡", "琵琶", "出品", "出品人", "出品公司",
	"出品发行公司", "发行", "发行公司", "音乐出品发行公司", "厂牌", "运营", "企划",
	"策划", "统筹", "商务", "宣传", "封面", "设计", "节目", "节目名", "来源", "鸣谢",
}

var lyricEnglishCreditLabelHints = []string{
	"publisher", "producer", "projectdirector", "director", "arrangement", "arranged", "mixing", "mixed",
	"mastering", "mastered", "vocal", "lyrics", "composed", "written",
}

func isLyricMetadataText(text string, timestamp *float64) bool {
	text = strings.TrimSpace(text)
	if text == "" {
		return true
	}
	lowered := strings.ToLower(text)
	if strings.HasPrefix(lowered, "lrc by") ||
		strings.HasPrefix(lowered, "offset:") ||
		strings.HasPrefix(lowered, "re:") ||
		strings.HasPrefix(lowered, "ve:") ||
		strings.HasPrefix(lowered, "ti:") ||
		strings.HasPrefix(lowered, "ar:") ||
		strings.HasPrefix(lowered, "al:") ||
		strings.HasPrefix(lowered, "by:") {
		return true
	}
	if strings.Contains(text, "未经著作权人") ||
		strings.Contains(text, "不得以任何方式") ||
		strings.Contains(text, "著作权权利保留") ||
		strings.Contains(text, "未经许可") {
		return true
	}
	if strings.HasSuffix(text, "：") || strings.HasSuffix(text, ":") {
		if len([]rune(text)) <= 16 {
			return true
		}
	}
	if timestamp != nil && *timestamp < 5 && len([]rune(text)) <= 60 && strings.Contains(text, "《") {
		return true
	}
	if timestamp != nil && *timestamp < 12 && (strings.Contains(text, " - ") || (strings.Contains(text, "-") && len([]rune(text)) <= 40)) {
		return true
	}
	if index := strings.IndexAny(text, ":："); index > 0 && index <= 96 {
		rawLabel := text[:index]
		label := compactLyricCreditLabel(rawLabel)
		for _, hint := range lyricCreditLabelHints {
			if strings.Contains(label, hint) {
				return true
			}
		}
		englishLabel := compactASCII(strings.ToLower(rawLabel))
		for _, hint := range lyricEnglishCreditLabelHints {
			if strings.Contains(englishLabel, hint) {
				return true
			}
		}
	}
	return false
}

func compactLyricCreditLabel(value string) string {
	return strings.Map(func(r rune) rune {
		if r <= 127 {
			if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
				return -1
			}
			switch r {
			case ' ', '\t', '\n', '\r', '(', ')', '/', '.', '_', '-':
				return -1
			}
		}
		switch r {
		case '（', '）':
			return -1
		}
		return r
	}, value)
}

func compactASCII(value string) string {
	return strings.Map(func(r rune) rune {
		if r >= 'a' && r <= 'z' {
			return r
		}
		return -1
	}, value)
}

func trackLyricsFromLines(lines []models.LyricLine, source, sourcePath string) *models.TrackLyrics {
	lines = compactLyrics(lines)
	if len(lines) == 0 {
		return nil
	}
	var path *string
	if sourcePath != "" {
		path = &sourcePath
	}
	return &models.TrackLyrics{
		Format:     lyricFormat(lines),
		Content:    lyricContent(lines),
		Lines:      lines,
		Source:     source,
		SourcePath: path,
	}
}

func lyricFormat(lines []models.LyricLine) string {
	for _, line := range lines {
		if line.TimeSeconds != nil {
			return "lrc"
		}
	}
	return "plain"
}

func lyricContent(lines []models.LyricLine) string {
	if lyricFormat(lines) == "lrc" {
		var builder strings.Builder
		for index, line := range lines {
			if line.TimeSeconds == nil {
				continue
			}
			if builder.Len() > 0 || index > 0 {
				builder.WriteByte('\n')
			}
			builder.WriteString(formatLRCTimestamp(*line.TimeSeconds))
			builder.WriteString(line.Text)
		}
		return builder.String()
	}

	var builder strings.Builder
	for index, line := range lines {
		if index > 0 {
			builder.WriteByte('\n')
		}
		builder.WriteString(line.Text)
	}
	return builder.String()
}

func formatLRCTimestamp(seconds float64) string {
	if seconds < 0 {
		seconds = 0
	}
	minutes := int(seconds) / 60
	remaining := seconds - float64(minutes*60)
	return fmt.Sprintf("[%02d:%05.2f]", minutes, remaining)
}

func stripLRCMetadata(content string) string {
	var builder strings.Builder
	for _, rawLine := range strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n") {
		line := strings.TrimSpace(rawLine)
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, "[") && strings.Contains(line, ":") && strings.HasSuffix(line, "]") {
			continue
		}
		if builder.Len() > 0 {
			builder.WriteByte('\n')
		}
		builder.WriteString(line)
	}
	return builder.String()
}

func decodeTextFile(content []byte) string {
	if utf8.Valid(content) {
		return strings.TrimPrefix(string(content), "\ufeff")
	}
	if decoded, err := simplifiedchinese.GB18030.NewDecoder().String(string(content)); err == nil {
		return strings.TrimPrefix(decoded, "\ufeff")
	}
	return string(content)
}

func parseLRCTimestamp(value string) (float64, bool) {
	minuteText, rest, ok := strings.Cut(value, ":")
	if !ok {
		return 0, false
	}
	minutes, err := strconv.Atoi(minuteText)
	if err != nil || minutes < 0 {
		return 0, false
	}
	seconds, err := strconv.ParseFloat(rest, 64)
	if err != nil || seconds < 0 {
		return 0, false
	}
	return float64(minutes)*60 + seconds, true
}

func lyricsFromPlainText(text string) []models.LyricLine {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	var lines []models.LyricLine
	for _, line := range strings.Split(text, "\n") {
		line = trimText(line)
		if line == "" {
			continue
		}
		lines = append(lines, models.LyricLine{Text: line})
	}
	return compactLyrics(lines)
}

func readFLACTags(path string) (tags, error) {
	file, err := os.Open(path)
	if err != nil {
		return tags{}, err
	}
	defer file.Close()

	header := make([]byte, 4)
	if _, err := io.ReadFull(file, header); err != nil {
		return tags{}, err
	}
	if string(header) != "fLaC" {
		return tags{}, errors.New("missing flac marker")
	}

	var metadata tags
	for {
		blockHeader := make([]byte, 4)
		if _, err := io.ReadFull(file, blockHeader); err != nil {
			return metadata, err
		}
		isLast := blockHeader[0]&0x80 != 0
		blockType := blockHeader[0] & 0x7F
		blockSize := int(blockHeader[1])<<16 | int(blockHeader[2])<<8 | int(blockHeader[3])
		if blockSize > maxEmbeddedCoverBytes+1024 {
			if _, err := io.CopyN(io.Discard, file, int64(blockSize)); err != nil {
				return metadata, err
			}
			if isLast {
				break
			}
			continue
		}
		block := make([]byte, blockSize)
		if _, err := io.ReadFull(file, block); err != nil {
			return metadata, err
		}
		if blockType == 6 {
			metadata.Cover = firstCover(metadata.Cover, decodeFLACPictureBlock(block))
		}
		if isLast {
			break
		}
	}
	return metadata, nil
}

func decodeFLACPictureBlock(block []byte) *models.TrackCover {
	if len(block) < 32 {
		return nil
	}
	offset := 4
	mimeLength := int(binary.BigEndian.Uint32(block[offset : offset+4]))
	offset += 4
	if mimeLength < 0 || offset+mimeLength+4 > len(block) {
		return nil
	}
	mimeType := string(block[offset : offset+mimeLength])
	offset += mimeLength
	descriptionLength := int(binary.BigEndian.Uint32(block[offset : offset+4]))
	offset += 4
	if descriptionLength < 0 || offset+descriptionLength+20 > len(block) {
		return nil
	}
	offset += descriptionLength + 16
	dataLength := int(binary.BigEndian.Uint32(block[offset : offset+4]))
	offset += 4
	if dataLength <= 0 || dataLength > maxEmbeddedCoverBytes || offset+dataLength > len(block) {
		return nil
	}
	return newTrackCover(mimeType, block[offset:offset+dataLength])
}

type mp4Atom struct {
	typ        string
	offset     int64
	size       int64
	headerSize int64
}

func readMP4Tags(path string) (tags, error) {
	file, err := os.Open(path)
	if err != nil {
		return tags{}, err
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		return tags{}, err
	}
	if info.Size() < 12 {
		return tags{}, errors.New("invalid mp4 size")
	}

	header := make([]byte, 12)
	if _, err := file.ReadAt(header, 0); err != nil {
		return tags{}, err
	}
	if string(header[4:8]) != "ftyp" {
		return tags{}, errors.New("missing mp4 ftyp atom")
	}

	var metadata tags
	if err := parseMP4Atoms(file, 0, info.Size(), 0, &metadata); err != nil {
		return tags{}, err
	}
	return metadata, nil
}

func parseMP4Atoms(reader io.ReaderAt, start, end int64, depth int, metadata *tags) error {
	if depth > 8 {
		return nil
	}
	for offset := start; offset+8 <= end; {
		atom, ok := readMP4Atom(reader, offset, end)
		if !ok {
			break
		}
		payloadStart := atom.offset + atom.headerSize
		payloadEnd := atom.offset + atom.size

		switch atom.typ {
		case "moov", "udta", "ilst":
			if err := parseMP4Atoms(reader, payloadStart, payloadEnd, depth+1, metadata); err != nil {
				return err
			}
		case "meta":
			if payloadStart+4 <= payloadEnd {
				if err := parseMP4Atoms(reader, payloadStart+4, payloadEnd, depth+1, metadata); err != nil {
					return err
				}
			}
		case "\xa9nam":
			metadata.Title = firstText(metadata.Title, readMP4TextAtom(reader, payloadStart, payloadEnd))
		case "\xa9ART", "aART":
			metadata.Artist = firstText(metadata.Artist, readMP4TextAtom(reader, payloadStart, payloadEnd))
		case "\xa9alb":
			metadata.Album = firstText(metadata.Album, readMP4TextAtom(reader, payloadStart, payloadEnd))
		case "\xa9lyr":
			metadata.Lyrics = firstLyrics(metadata.Lyrics, lyricsFromPlainText(readMP4TextAtom(reader, payloadStart, payloadEnd)))
		case "covr":
			metadata.Cover = firstCover(metadata.Cover, readMP4CoverAtom(reader, payloadStart, payloadEnd))
		}

		offset += atom.size
	}
	return nil
}

func readMP4Atom(reader io.ReaderAt, offset, limit int64) (mp4Atom, bool) {
	header := make([]byte, 16)
	if _, err := reader.ReadAt(header[:8], offset); err != nil {
		return mp4Atom{}, false
	}

	size := int64(binary.BigEndian.Uint32(header[0:4]))
	headerSize := int64(8)
	if size == 1 {
		if _, err := reader.ReadAt(header[8:16], offset+8); err != nil {
			return mp4Atom{}, false
		}
		size = int64(binary.BigEndian.Uint64(header[8:16]))
		headerSize = 16
	} else if size == 0 {
		size = limit - offset
	}
	if size < headerSize || offset+size > limit {
		return mp4Atom{}, false
	}

	return mp4Atom{
		typ:        string(header[4:8]),
		offset:     offset,
		size:       size,
		headerSize: headerSize,
	}, true
}

func readMP4TextAtom(reader io.ReaderAt, start, end int64) string {
	for offset := start; offset+16 <= end; {
		atom, ok := readMP4Atom(reader, offset, end)
		if !ok {
			break
		}
		if atom.typ == "data" {
			textStart := atom.offset + atom.headerSize + 8
			textEnd := atom.offset + atom.size
			if textStart >= textEnd || textEnd-textStart > 1024*1024 {
				return ""
			}
			buffer := make([]byte, textEnd-textStart)
			if _, err := reader.ReadAt(buffer, textStart); err != nil {
				return ""
			}
			return trimText(string(buffer))
		}
		offset += atom.size
	}
	return ""
}

func readMP4CoverAtom(reader io.ReaderAt, start, end int64) *models.TrackCover {
	for offset := start; offset+16 <= end; {
		atom, ok := readMP4Atom(reader, offset, end)
		if !ok {
			break
		}
		if atom.typ == "data" {
			dataStart := atom.offset + atom.headerSize + 8
			dataEnd := atom.offset + atom.size
			if dataStart >= dataEnd || dataEnd-dataStart > maxEmbeddedCoverBytes {
				return nil
			}
			buffer := make([]byte, dataEnd-dataStart)
			if _, err := reader.ReadAt(buffer, dataStart); err != nil {
				return nil
			}
			return newTrackCover("", buffer)
		}
		offset += atom.size
	}
	return nil
}

func readID3v2(path string) (tags, error) {
	file, err := os.Open(path)
	if err != nil {
		return tags{}, err
	}
	defer file.Close()

	header := make([]byte, 10)
	if _, err := io.ReadFull(file, header); err != nil {
		return tags{}, err
	}
	if string(header[0:3]) != "ID3" {
		return tags{}, errors.New("missing id3 header")
	}

	version := header[3]
	if version < 2 || version > 4 {
		return tags{}, fmt.Errorf("unsupported id3 version: %d", version)
	}
	flags := header[5]
	tagSize := synchsafeToInt(header[6:10])
	if tagSize <= 0 || tagSize > 10*1024*1024 {
		return tags{}, errors.New("invalid id3 size")
	}

	body := make([]byte, tagSize)
	if _, err := io.ReadFull(file, body); err != nil {
		return tags{}, err
	}
	if flags&0x80 != 0 {
		body = removeID3Unsynchronisation(body)
	}

	var metadata tags
	offset := id3v2FrameStart(body, version, flags)
	for {
		if version == 2 {
			if offset+6 > len(body) {
				break
			}
			frameID := string(body[offset : offset+3])
			if !validFrameID(frameID) {
				break
			}
			frameSize := int(body[offset+3])<<16 | int(body[offset+4])<<8 | int(body[offset+5])
			if frameSize <= 0 || offset+6+frameSize > len(body) {
				break
			}

			payload := body[offset+6 : offset+6+frameSize]
			switch frameID {
			case "TT2":
				metadata.Title = firstText(metadata.Title, decodeTextFrame(payload))
			case "TP1":
				metadata.Artist = firstText(metadata.Artist, decodeTextFrame(payload))
			case "TAL":
				metadata.Album = firstText(metadata.Album, decodeTextFrame(payload))
			case "ULT":
				metadata.Lyrics = firstLyrics(metadata.Lyrics, decodeUnsyncedLyricsFrame(payload))
			case "SLT":
				metadata.Lyrics = firstLyrics(metadata.Lyrics, decodeSyncedLyricsFrame(payload))
			case "PIC":
				metadata.Cover = firstCover(metadata.Cover, decodeID3v22PictureFrame(payload))
			}
			offset += 6 + frameSize
			continue
		}

		if offset+10 > len(body) {
			break
		}
		frameID := string(body[offset : offset+4])
		if !validFrameID(frameID) {
			break
		}

		var frameSize int
		if version == 4 {
			frameSize = synchsafeToInt(body[offset+4 : offset+8])
		} else {
			frameSize = int(binary.BigEndian.Uint32(body[offset+4 : offset+8]))
		}
		if frameSize <= 0 || offset+10+frameSize > len(body) {
			break
		}

		payload := body[offset+10 : offset+10+frameSize]
		switch frameID {
		case "TIT2":
			metadata.Title = firstText(metadata.Title, decodeTextFrame(payload))
		case "TPE1":
			metadata.Artist = firstText(metadata.Artist, decodeTextFrame(payload))
		case "TALB":
			metadata.Album = firstText(metadata.Album, decodeTextFrame(payload))
		case "USLT":
			metadata.Lyrics = firstLyrics(metadata.Lyrics, decodeUnsyncedLyricsFrame(payload))
		case "SYLT":
			metadata.Lyrics = firstLyrics(metadata.Lyrics, decodeSyncedLyricsFrame(payload))
		case "APIC":
			metadata.Cover = firstCover(metadata.Cover, decodeID3AttachedPictureFrame(payload))
		}
		offset += 10 + frameSize
	}
	return metadata, nil
}

func validFrameID(frameID string) bool {
	if len(frameID) != 3 && len(frameID) != 4 {
		return false
	}
	for _, r := range frameID {
		if (r < 'A' || r > 'Z') && (r < '0' || r > '9') {
			return false
		}
	}
	return true
}

func id3v2FrameStart(body []byte, version, flags byte) int {
	if flags&0x40 == 0 {
		return 0
	}
	if version == 3 && len(body) >= 4 {
		size := int(binary.BigEndian.Uint32(body[:4]))
		if size >= 0 && 4+size <= len(body) {
			return 4 + size
		}
	}
	if version == 4 && len(body) >= 4 {
		size := synchsafeToInt(body[:4])
		if size >= 4 && size <= len(body) {
			return size
		}
	}
	return 0
}

func removeID3Unsynchronisation(data []byte) []byte {
	result := make([]byte, 0, len(data))
	for index := 0; index < len(data); index++ {
		result = append(result, data[index])
		if data[index] == 0xFF && index+1 < len(data) && data[index+1] == 0x00 {
			index++
		}
	}
	return result
}

func synchsafeToInt(data []byte) int {
	if len(data) != 4 {
		return 0
	}
	return int(data[0]&0x7F)<<21 | int(data[1]&0x7F)<<14 | int(data[2]&0x7F)<<7 | int(data[3]&0x7F)
}

func readID3v1(path string) (tags, error) {
	file, err := os.Open(path)
	if err != nil {
		return tags{}, err
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		return tags{}, err
	}
	if info.Size() < 128 {
		return tags{}, errors.New("missing id3v1 tag")
	}

	tag := make([]byte, 128)
	if _, err := file.ReadAt(tag, info.Size()-128); err != nil {
		return tags{}, err
	}
	if string(tag[:3]) != "TAG" {
		return tags{}, errors.New("missing id3v1 tag")
	}
	return tags{
		Title:  decodeLegacyText(tag[3:33]),
		Artist: decodeLegacyText(tag[33:63]),
		Album:  decodeLegacyText(tag[63:93]),
	}, nil
}

func decodeTextFrame(payload []byte) string {
	if len(payload) == 0 {
		return ""
	}
	encoding := payload[0]
	return decodeID3TextBytes(encoding, payload[1:])
}

func decodeID3TextBytes(encoding byte, text []byte) string {
	switch encoding {
	case 0:
		return decodeLegacyText(text)
	case 1:
		return strings.TrimSpace(decodeUTF16(text, false))
	case 2:
		return strings.TrimSpace(decodeUTF16(text, true))
	case 3:
		if utf8.Valid(text) {
			return trimText(string(text))
		}
		return decodeLegacyText(text)
	default:
		return decodeLegacyText(text)
	}
}

func decodeUnsyncedLyricsFrame(payload []byte) []models.LyricLine {
	if len(payload) < 4 {
		return nil
	}
	encoding := payload[0]
	_, lyricBytes := splitID3TerminatedText(payload[4:], encoding)
	return lyricsFromPlainText(decodeID3TextBytes(encoding, lyricBytes))
}

func decodeSyncedLyricsFrame(payload []byte) []models.LyricLine {
	if len(payload) < 6 {
		return nil
	}
	encoding := payload[0]
	timestampFormat := payload[4]
	if timestampFormat != 2 {
		return nil
	}

	_, rest := splitID3TerminatedText(payload[6:], encoding)
	var lines []models.LyricLine
	for len(rest) > 4 {
		textBytes, remaining := splitID3TerminatedText(rest, encoding)
		if len(remaining) < 4 {
			break
		}
		timestamp := float64(binary.BigEndian.Uint32(remaining[:4])) / 1000
		remaining = remaining[4:]
		text := decodeID3TextBytes(encoding, textBytes)
		if text != "" {
			lines = append(lines, models.LyricLine{
				TimeSeconds: &timestamp,
				Text:        text,
			})
		}
		rest = remaining
	}
	return compactLyrics(lines)
}

func decodeID3AttachedPictureFrame(payload []byte) *models.TrackCover {
	if len(payload) < 5 {
		return nil
	}
	encoding := payload[0]
	mimeEnd := bytes.IndexByte(payload[1:], 0)
	if mimeEnd < 0 {
		return nil
	}
	mimeType := string(payload[1 : 1+mimeEnd])
	offset := 1 + mimeEnd + 1
	if offset >= len(payload) {
		return nil
	}
	offset++
	_, data := splitID3TerminatedText(payload[offset:], encoding)
	return newTrackCover(mimeType, data)
}

func decodeID3v22PictureFrame(payload []byte) *models.TrackCover {
	if len(payload) < 6 {
		return nil
	}
	encoding := payload[0]
	imageFormat := strings.ToLower(string(payload[1:4]))
	offset := 5
	_, data := splitID3TerminatedText(payload[offset:], encoding)
	return newTrackCover(imageFormat, data)
}

func splitID3TerminatedText(data []byte, encoding byte) ([]byte, []byte) {
	terminator := []byte{0}
	if encoding == 1 || encoding == 2 {
		terminator = []byte{0, 0}
	}
	index := bytes.Index(data, terminator)
	if index < 0 {
		return data, nil
	}
	return data[:index], data[index+len(terminator):]
}

func decodeUTF16(data []byte, defaultBigEndian bool) string {
	if len(data) < 2 {
		return ""
	}
	bigEndian := defaultBigEndian
	if bytes.HasPrefix(data, []byte{0xFE, 0xFF}) {
		bigEndian = true
		data = data[2:]
	} else if bytes.HasPrefix(data, []byte{0xFF, 0xFE}) {
		data = data[2:]
	}

	u16 := make([]uint16, 0, len(data)/2)
	for i := 0; i+1 < len(data); i += 2 {
		var value uint16
		if bigEndian {
			value = binary.BigEndian.Uint16(data[i : i+2])
		} else {
			value = binary.LittleEndian.Uint16(data[i : i+2])
		}
		if value == 0 {
			break
		}
		u16 = append(u16, value)
	}
	return trimText(string(utf16.Decode(u16)))
}

func decodeLegacyText(data []byte) string {
	data = bytes.Trim(data, "\x00 ")
	if len(data) == 0 {
		return ""
	}
	if utf8.Valid(data) {
		return trimText(string(data))
	}
	if decoded, err := simplifiedchinese.GB18030.NewDecoder().String(string(data)); err == nil {
		if text := trimText(decoded); text != "" {
			return text
		}
	}

	runes := make([]rune, 0, len(data))
	for _, value := range data {
		if value == 0 {
			continue
		}
		runes = append(runes, rune(value))
	}
	return trimText(string(runes))
}

func trimText(value string) string {
	value = strings.TrimSpace(value)
	value = strings.Trim(value, "\x00")
	value = strings.ReplaceAll(value, "\x00", " ")
	return strings.TrimSpace(value)
}

func cleanAudioNamePart(value string) string {
	text := trimText(value)
	text = strings.NewReplacer("\u200b", "", "\u200c", "", "\u200d", "", "\ufeff", "").Replace(text)
	for index := 0; index < 4; index++ {
		previous := text
		text = stripTrailingHashToken(text)
		text = trimAudioNameTailSeparators(text)
		if text == previous {
			break
		}
	}
	return text
}

func stripTrailingHashToken(value string) string {
	text := trimText(value)
	if stripped, ok := stripTrailingBracketedHash(text); ok {
		return stripped
	}
	if stripped, ok := stripTrailingSeparatedHash(text); ok {
		return stripped
	}
	return text
}

func stripTrailingBracketedHash(value string) (string, bool) {
	runes := []rune(trimText(value))
	end := trimRightSpaceRunes(runes)
	if end == 0 {
		return "", false
	}
	opening, ok := matchingOpeningBracket(runes[end-1])
	if !ok {
		return "", false
	}
	start := end - 2
	for start >= 0 && runes[start] != opening {
		start--
	}
	if start < 0 {
		return "", false
	}
	token := string(runes[start+1 : end-1])
	if !isLikelyHashToken(token) {
		return "", false
	}
	prefix := trimAudioNameTailSeparators(string(runes[:start]))
	if prefix == "" {
		return "", false
	}
	return prefix, true
}

func stripTrailingSeparatedHash(value string) (string, bool) {
	runes := []rune(trimText(value))
	end := trimRightSpaceRunes(runes)
	start := end
	for start > 0 && isASCIIHexRune(runes[start-1]) {
		start--
	}
	if start == end || !isLikelyHashToken(string(runes[start:end])) {
		return "", false
	}
	separatorStart := start
	for separatorStart > 0 && isAudioNameTailSeparator(runes[separatorStart-1]) {
		separatorStart--
	}
	if separatorStart == start || separatorStart == 0 {
		return "", false
	}
	return string(runes[:separatorStart]), true
}

func trimAudioNameTailSeparators(value string) string {
	runes := []rune(trimText(value))
	end := len(runes)
	for end > 0 && isAudioNameTailSeparator(runes[end-1]) {
		end--
	}
	return trimText(string(runes[:end]))
}

func trimRightSpaceRunes(runes []rune) int {
	end := len(runes)
	for end > 0 && strings.TrimSpace(string(runes[end-1])) == "" {
		end--
	}
	return end
}

func matchingOpeningBracket(closing rune) (rune, bool) {
	switch closing {
	case ']':
		return '[', true
	case ')':
		return '(', true
	case '}':
		return '{', true
	case '】':
		return '【', true
	case '）':
		return '（', true
	default:
		return 0, false
	}
}

func isAudioNameTailSeparator(r rune) bool {
	return r == '-' || r == '_' || r == '.' || strings.TrimSpace(string(r)) == ""
}

func isLikelyHashToken(value string) bool {
	token := trimText(value)
	runes := []rune(token)
	if len(runes) < 8 || len(runes) > 64 {
		return false
	}
	hasHexAlpha := false
	for _, r := range runes {
		if !isASCIIHexRune(r) {
			return false
		}
		if (r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F') {
			hasHexAlpha = true
		}
	}
	return hasHexAlpha || len(runes) >= 12
}

func isASCIIHexRune(r rune) bool {
	return (r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F')
}

func ParseTrackID(path string) (int64, bool) {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) != 4 || parts[0] != "api" || parts[1] != "tracks" || parts[3] != "stream" {
		return 0, false
	}
	id, err := strconv.ParseInt(parts[2], 10, 64)
	return id, err == nil && id > 0
}

func ContentType(format string) string {
	switch strings.ToLower(format) {
	case "aac":
		return "audio/aac"
	case "aif", "aiff":
		return "audio/aiff"
	case "flac":
		return "audio/flac"
	case "m4a":
		return "audio/mp4"
	case "mp3":
		return "audio/mpeg"
	case "ogg":
		return "audio/ogg"
	case "wav":
		return "audio/wav"
	default:
		return "application/octet-stream"
	}
}
