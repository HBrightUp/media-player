package library

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"unicode/utf16"
	"unicode/utf8"

	"github.com/hml/media-player/backend/internal/database"
	"github.com/hml/media-player/backend/internal/models"
	"golang.org/x/text/encoding/simplifiedchinese"
)

var supportedAudioFormats = map[string]bool{
	".aac":  true,
	".flac": true,
	".m4a":  true,
	".mp3":  true,
	".ogg":  true,
	".wav":  true,
}

type Scanner struct {
	store *database.Store
}

type tags struct {
	Title  string
	Artist string
	Album  string
	Lyrics []models.LyricLine
}

func NewScanner(store *database.Store) *Scanner {
	return &Scanner{store: store}
}

func (s *Scanner) Scan(ctx context.Context, root string) (models.ScanResult, error) {
	return s.scanFormats(ctx, root, supportedAudioFormats)
}

func (s *Scanner) ScanMP3(ctx context.Context, root string) (models.ScanResult, error) {
	return s.scanFormats(ctx, root, map[string]bool{".mp3": true})
}

func (s *Scanner) scanFormats(ctx context.Context, root string, formats map[string]bool) (models.ScanResult, error) {
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return models.ScanResult{}, fmt.Errorf("resolve music directory: %w", err)
	}

	info, err := os.Stat(absRoot)
	if err != nil {
		return models.ScanResult{}, fmt.Errorf("read music directory: %w", err)
	}
	if !info.IsDir() {
		return models.ScanResult{}, fmt.Errorf("%s is not a directory", absRoot)
	}

	result := models.ScanResult{RootPath: absRoot}
	err = filepath.WalkDir(absRoot, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			recordScanError(&result, path, walkErr)
			return nil
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if entry.IsDir() {
			return nil
		}

		ext := strings.ToLower(filepath.Ext(path))
		if !formats[ext] {
			return nil
		}
		result.Found++

		track, err := buildTrack(absRoot, path, ext)
		if err != nil {
			recordScanError(&result, path, err)
			return nil
		}
		if _, err := s.store.UpsertTrack(ctx, track); err != nil {
			recordScanError(&result, path, err)
			return nil
		}
		result.Imported++
		return nil
	})
	if err != nil {
		return result, err
	}
	return result, nil
}

func recordScanError(result *models.ScanResult, path string, err error) {
	result.Skipped++
	if len(result.Errors) >= 8 {
		return
	}
	result.Errors = append(result.Errors, fmt.Sprintf("%s: %v", path, err))
}

func buildTrack(root, path, ext string) (models.Track, error) {
	info, err := os.Stat(path)
	if err != nil {
		return models.Track{}, err
	}

	filename := filepath.Base(path)
	metadata := readTags(path, ext)
	nameMetadata := tagsFromFilename(filename)

	title := firstText(metadata.Title, nameMetadata.Title, strings.TrimSuffix(filename, filepath.Ext(filename)))
	artist := firstText(metadata.Artist, nameMetadata.Artist, "未知歌手")
	album := firstText(metadata.Album, "未知专辑")
	lyrics := firstLyrics(metadata.Lyrics, readSidecarLyrics(path))

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
		SizeBytes:    info.Size(),
		ModifiedAt:   info.ModTime(),
		Lyrics:       lyrics,
	}, nil
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
	return metadata
}

func mergeTags(primary, fallback tags) tags {
	primary.Title = firstText(primary.Title, fallback.Title)
	primary.Artist = firstText(primary.Artist, fallback.Artist)
	primary.Album = firstText(primary.Album, fallback.Album)
	primary.Lyrics = firstLyrics(primary.Lyrics, fallback.Lyrics)
	return primary
}

func tagsFromFilename(filename string) tags {
	base := strings.TrimSpace(strings.TrimSuffix(filename, filepath.Ext(filename)))
	for _, separator := range []string{" - ", "-", "—", "–", "_"} {
		artist, title, ok := strings.Cut(base, separator)
		if ok {
			artist = strings.TrimSpace(artist)
			title = strings.TrimSpace(title)
			if artist != "" && title != "" {
				return tags{
					Title:  title,
					Artist: artist,
				}
			}
		}
	}
	return tags{Title: base}
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

func readSidecarLyrics(path string) []models.LyricLine {
	base := strings.TrimSuffix(path, filepath.Ext(path))
	for _, candidate := range []string{base + ".lrc", base + ".LRC"} {
		content, err := os.ReadFile(candidate)
		if err == nil {
			return parseLRC(string(content))
		}
	}
	return nil
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
			value := timestamp
			lines = append(lines, models.LyricLine{
				TimeSeconds: &value,
				Text:        rawLine,
			})
		}
	}
	return compactLyrics(lines)
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
