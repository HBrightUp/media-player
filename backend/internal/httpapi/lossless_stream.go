package httpapi

import (
	"bytes"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"strings"

	"github.com/hml/media-player/backend/internal/models"
)

func wantsLosslessWAVStream(r *http.Request, track models.Track) bool {
	streamFormat := strings.TrimSpace(strings.ToLower(r.URL.Query().Get("stream_format")))
	return streamFormat == "wav" &&
		track.Quality == models.TrackQualityLossless &&
		strings.EqualFold(track.Format, "flac")
}

func (s *Server) streamLosslessWAV(w http.ResponseWriter, r *http.Request, track models.Track) {
	info, err := os.Stat(track.Path)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	if info.IsDir() {
		http.NotFound(w, r)
		return
	}

	w.Header().Set("Content-Type", "audio/wav")
	w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=%q", losslessWAVFilename(track)))
	w.Header().Set("Cache-Control", "private, no-cache")
	w.Header().Set("Accept-Ranges", "none")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if r.Method == http.MethodHead {
		w.WriteHeader(http.StatusOK)
		return
	}

	command := exec.CommandContext(
		r.Context(),
		"ffmpeg",
		"-hide_banner",
		"-loglevel",
		"error",
		"-i",
		track.Path,
		"-map",
		"0:a:0",
		"-vn",
		"-map_metadata",
		"-1",
		"-f",
		"wav",
		"pipe:1",
	)
	var stderr bytes.Buffer
	command.Stderr = &stderr
	stdout, err := command.StdoutPipe()
	if err != nil {
		log.Printf("prepare lossless wav stream failed: track_id=%d error=%v", track.ID, err)
		writeError(w, http.StatusInternalServerError, "准备无损兼容音频失败")
		return
	}
	if err := command.Start(); err != nil {
		log.Printf("start lossless wav stream failed: track_id=%d error=%v", track.ID, err)
		writeError(w, http.StatusInternalServerError, "启动无损兼容音频失败")
		return
	}

	w.WriteHeader(http.StatusOK)
	_, copyErr := io.Copy(w, stdout)
	waitErr := command.Wait()
	if r.Context().Err() == nil {
		if copyErr != nil {
			log.Printf("copy lossless wav stream failed: track_id=%d error=%v", track.ID, copyErr)
		}
		if waitErr != nil {
			log.Printf("finish lossless wav stream failed: track_id=%d error=%v stderr=%q", track.ID, waitErr, strings.TrimSpace(stderr.String()))
		}
	}
}

func losslessWAVFilename(track models.Track) string {
	filename := strings.TrimSpace(track.Filename)
	if filename == "" {
		filename = fmt.Sprintf("track-%d.flac", track.ID)
	}
	if index := strings.LastIndex(filename, "."); index > 0 {
		filename = filename[:index]
	}
	return filename + ".wav"
}
