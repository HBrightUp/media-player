//go:build windows

package httpapi

import (
	"errors"
	"syscall"
	"unsafe"
)

var getDiskFreeSpaceEx = syscall.NewLazyDLL("kernel32.dll").NewProc("GetDiskFreeSpaceExW")

func ensureImportDiskSpace(root string, uploads []uploadedAudioImportFile) error {
	var uploadBytes int64
	for _, upload := range uploads {
		uploadBytes += upload.SizeBytes
	}
	requiredBytes := uploadBytes*2 + int64(512*1024*1024)

	rootPath, err := syscall.UTF16PtrFromString(root)
	if err != nil {
		return nil
	}
	var availableBytes uint64
	result, _, _ := getDiskFreeSpaceEx.Call(
		uintptr(unsafe.Pointer(rootPath)),
		uintptr(unsafe.Pointer(&availableBytes)),
		0,
		0,
	)
	if result == 0 {
		return nil
	}
	if availableBytes < uint64(requiredBytes) {
		return errors.New("服务器剩余磁盘空间不足，无法安全导入并转码")
	}
	return nil
}
