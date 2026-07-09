//go:build !windows

package httpapi

import (
	"errors"
	"syscall"
)

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
