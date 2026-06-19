package library

import (
	"path/filepath"
	"strings"
)

// StandardAudioNameParts returns the artist and title that should be used for
// imported audio files. It mirrors scanner metadata precedence so imported
// filenames and scanned track metadata stay aligned.
func StandardAudioNameParts(path, relativePath string) (string, string) {
	ext := strings.ToLower(filepath.Ext(path))
	filename := filepath.Base(relativePath)
	if filename == "." || filename == string(filepath.Separator) || filename == "" {
		filename = filepath.Base(path)
	}

	metadata := readTags(path, ext)
	nameMetadata := tagsFromFilename(filename)
	title := firstAudioNameText(metadata.Title, nameMetadata.Title)
	artist := firstAudioNameText(metadata.Artist, nameMetadata.Artist)
	return artist, title
}

// StandardAudioNamePartsFromFilename returns the artist and title inferred from
// a user-provided filename without reading embedded metadata.
func StandardAudioNamePartsFromFilename(relativePath string) (string, string) {
	filename := filepath.Base(relativePath)
	if filename == "." || filename == string(filepath.Separator) || filename == "" {
		return "", ""
	}
	nameMetadata := tagsFromFilename(filename)
	title := firstAudioNameText(nameMetadata.Title)
	artist := firstAudioNameText(nameMetadata.Artist)
	return artist, title
}
