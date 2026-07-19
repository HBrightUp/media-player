package com.hml.mediaplayer.data

import android.content.Context
import android.net.Uri
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File

class TrackCacheManager(
    context: Context,
) {
    private val appContext = context.applicationContext
    private val prefs = appContext.getSharedPreferences("hml_android_track_cache", Context.MODE_PRIVATE)
    private val cacheRoot: File = appContext.getExternalFilesDir("flac-cache") ?: File(appContext.filesDir, "flac-cache")

    var maxCacheBytes: Long
        get() = prefs.getLong(KEY_MAX_CACHE_BYTES, DEFAULT_MAX_CACHE_BYTES).coerceIn(MIN_CACHE_BYTES, MAX_CACHE_BYTES)
        private set(value) {
            prefs.edit().putLong(KEY_MAX_CACHE_BYTES, value.coerceIn(MIN_CACHE_BYTES, MAX_CACHE_BYTES)).apply()
        }

    fun maxSelectableCacheGb(): Int {
        val currentCacheBytes = stats().totalBytes
        val usableBytes = usableStorageBytes()
        val totalAvailableBytes = if (Long.MAX_VALUE - currentCacheBytes < usableBytes) {
            Long.MAX_VALUE
        } else {
            currentCacheBytes + usableBytes
        }
        val safeCacheBytes = (totalAvailableBytes - RESERVED_STORAGE_BYTES)
            .coerceAtLeast(0L)
            .coerceAtMost(MAX_CACHE_BYTES)
        return (safeCacheBytes / GIB).toInt().coerceIn(0, MAX_CACHE_GB)
    }

    fun normalizedCacheLimitGb(maximumGb: Int = maxSelectableCacheGb()): Int {
        if (maximumGb < MIN_CACHE_GB) {
            return 0
        }
        val configuredGb = (maxCacheBytes / GIB).toInt().coerceIn(MIN_CACHE_GB, MAX_CACHE_GB)
        val normalizedGb = configuredGb.coerceAtMost(maximumGb)
        if (normalizedGb != configuredGb) {
            maxCacheBytes = normalizedGb * GIB
        }
        return normalizedGb
    }

    fun updateCacheLimitGb(requestedGb: Int): Int {
        val maximumGb = maxSelectableCacheGb()
        if (maximumGb < MIN_CACHE_GB) {
            throw IllegalStateException("设备存储空间不足，请至少为系统保留 1G 空间")
        }
        val selectedGb = requestedGb.coerceIn(MIN_CACHE_GB, maximumGb)
        maxCacheBytes = selectedGb * GIB
        return selectedGb
    }

    fun hasReservedStorageAvailable(): Boolean {
        return usableStorageBytes() > RESERVED_STORAGE_BYTES
    }

    fun ensureReservedStorageAvailable() {
        if (!hasReservedStorageAvailable()) {
            throw IllegalStateException("设备存储空间不足，请至少为系统保留 1G 空间")
        }
    }

    fun playableUriFor(user: AuthUser, track: Track): Uri? {
        if (!canUseCache(user, track)) {
            return null
        }
        val file = cacheFile(user, track)
        if (!isValidCachedPackage(track, file, lyricsFile(user, track))) {
            return null
        }
        file.setLastModified(System.currentTimeMillis())
        return Uri.fromFile(file)
    }

    fun isCached(user: AuthUser, track: Track): Boolean {
        return canUseCache(user, track) && isValidCachedPackage(track, cacheFile(user, track), lyricsFile(user, track))
    }

    fun cachedIdsFor(user: AuthUser, tracks: List<Track>): Set<Long> {
        return tracks.asSequence()
            .filter { isCached(user, it) }
            .map { it.id }
            .toSet()
    }

    fun cachedEntriesFor(user: AuthUser): List<CachedFileEntry> {
        val userDir = userCacheDir(user)
        if (!userDir.isDirectory) {
            return emptyList()
        }
        return userDir.walkTopDown()
            .filter { it.isFile && !it.name.endsWith(".download") }
            .mapNotNull { file ->
                cachedTrackId(file)?.let { trackId -> trackId to file.length() }
            }
            .groupBy(keySelector = { it.first }, valueTransform = { it.second })
            .map { (trackId, sizes) ->
                CachedFileEntry(trackId = trackId, sizeBytes = sizes.sum())
            }
    }

    fun cachedLyricsFor(user: AuthUser, track: Track): TrackLyrics? {
        if (!isCached(user, track)) {
            return null
        }
        return runCatching {
            JsonDecoders.trackLyrics(JSONObject(lyricsFile(user, track).readText(Charsets.UTF_8)))
        }.getOrNull()
    }

    suspend fun cacheTrack(
        user: AuthUser,
        track: Track,
        audioWriter: suspend (File) -> Unit,
        lyricsWriter: suspend (File) -> Unit,
    ): CacheStats {
        require(canUseCache(user, track)) { "当前用户无权缓存这首音乐" }
        return withContext(Dispatchers.IO) {
            val userDir = userCacheDir(user).also { it.mkdirs() }
            val finalAudioFile = cacheFile(user, track)
            val finalLyricsFile = lyricsFile(user, track)
            if (isValidCachedPackage(track, finalAudioFile, finalLyricsFile)) {
                return@withContext statsForUser(user)
            }
            val tempAudioFile = File(userDir, "${finalAudioFile.name}.download")
            val tempLyricsFile = File(userDir, "${finalLyricsFile.name}.download")
            tempAudioFile.delete()
            tempLyricsFile.delete()
            ensureSpaceForTrack(track)
            try {
                audioWriter(tempAudioFile)
                if (!isExpectedSize(track, tempAudioFile.length())) {
                    throw IllegalStateException("缓存文件不完整，请稍后重试")
                }
                lyricsWriter(tempLyricsFile)
                if (!isValidLyricsFile(tempLyricsFile)) {
                    throw IllegalStateException("歌词缓存失败，请稍后重试")
                }
                ensureReservedStorageAvailable()
            } catch (error: Throwable) {
                tempAudioFile.delete()
                tempLyricsFile.delete()
                throw error
            }
            deleteCachedTrackFiles(user, track.id)
            try {
                moveTempFile(tempAudioFile, finalAudioFile)
                moveTempFile(tempLyricsFile, finalLyricsFile)
            } catch (error: Throwable) {
                finalAudioFile.delete()
                finalLyricsFile.delete()
                tempAudioFile.delete()
                tempLyricsFile.delete()
                throw error
            }
            val now = System.currentTimeMillis()
            finalAudioFile.setLastModified(now)
            finalLyricsFile.setLastModified(now)
            trimToLimitLocked()
            statsForUser(user)
        }
    }

    suspend fun removeTracks(user: AuthUser, trackIds: Set<Long>): CacheStats {
        return withContext(Dispatchers.IO) {
            if (trackIds.isNotEmpty()) {
                trackIds.forEach { trackId ->
                    deleteCachedTrackFiles(user, trackId, includeDownloads = true)
                }
            }
            statsForUser(user)
        }
    }

    suspend fun clear(): CacheStats {
        return withContext(Dispatchers.IO) {
            cacheRoot.deleteRecursively()
            cacheRoot.mkdirs()
            stats()
        }
    }

    fun stats(): CacheStats {
        val files = cachedFiles()
        val packageCount = cachedTrackPackages(files).size
        return CacheStats(
            fileCount = packageCount,
            totalBytes = files.sumOf { it.length() },
            maxBytes = maxCacheBytes,
        )
    }

    fun statsForUser(user: AuthUser): CacheStats {
        val entries = cachedEntriesFor(user)
        return CacheStats(
            fileCount = entries.size,
            totalBytes = entries.sumOf { it.sizeBytes },
            maxBytes = maxCacheBytes,
        )
    }

    private fun canUseCache(user: AuthUser, track: Track): Boolean {
        return track.quality != TrackQuality.LOSSLESS || user.role.canPlayLossless
    }

    private fun isValidCachedPackage(track: Track, audioFile: File, lyricsFile: File): Boolean {
        return isValidAudioFile(track, audioFile) && isValidLyricsFile(lyricsFile)
    }

    private fun isValidAudioFile(track: Track, file: File): Boolean {
        return file.isFile && isExpectedSize(track, file.length())
    }

    private fun isValidLyricsFile(file: File): Boolean {
        return file.isFile && file.length() > 0L
    }

    private fun isExpectedSize(track: Track, actualBytes: Long): Boolean {
        return track.sizeBytes <= 0L || actualBytes == track.sizeBytes
    }

    private fun cacheFile(user: AuthUser, track: Track): File {
        return File(userCacheDir(user), cacheFileName(track))
    }

    private fun lyricsFile(user: AuthUser, track: Track): File {
        return File(userCacheDir(user), lyricsFileName(track))
    }

    private fun userCacheDir(user: AuthUser): File {
        return File(cacheRoot, "user-${user.id}")
    }

    private fun cacheFileName(track: Track): String {
        val version = Integer.toHexString("${track.modifiedAt}:${track.sizeBytes}".hashCode())
        val extension = track.format.lowercase().ifBlank { "music" }
        return "${track.id}-$version.$extension"
    }

    private fun lyricsFileName(track: Track): String {
        val version = Integer.toHexString("${track.modifiedAt}:${track.sizeBytes}".hashCode())
        return "${track.id}-$version.lyrics.json"
    }

    private fun cachedTrackId(file: File): Long? {
        return file.name.substringBefore('-').toLongOrNull()
    }

    private fun usableStorageBytes(): Long {
        cacheRoot.mkdirs()
        return cacheRoot.usableSpace.coerceAtLeast(0L)
    }

    private fun ensureSpaceForTrack(track: Track) {
        val usableBytes = usableStorageBytes()
        val downloadableBytes = (usableBytes - RESERVED_STORAGE_BYTES).coerceAtLeast(0L)
        if (usableBytes <= RESERVED_STORAGE_BYTES ||
            (track.sizeBytes > 0L && track.sizeBytes > downloadableBytes)
        ) {
            throw IllegalStateException("设备存储空间不足，请至少为系统保留 1G 空间")
        }
    }

    private fun trimToLimitLocked() {
        val max = maxCacheBytes
        val files = cachedFiles()
        var total = files.sumOf { it.length() }
        for (trackPackage in cachedTrackPackages(files).sortedBy { it.lastModified }) {
            if (total <= max) {
                break
            }
            trackPackage.files.forEach { file ->
                val size = file.length()
                if (file.delete()) {
                    total -= size
                }
            }
        }
    }

    private fun cachedFiles(): List<File> {
        return cacheRoot.walkTopDown()
            .filter { it.isFile && !it.name.endsWith(".download") }
            .toList()
    }

    private fun cachedTrackPackages(files: List<File>): List<CachedTrackPackage> {
        return files
            .mapNotNull { file ->
                val trackId = cachedTrackId(file) ?: return@mapNotNull null
                val parentPath = file.parentFile?.absolutePath.orEmpty()
                "$parentPath:$trackId" to file
            }
            .groupBy(keySelector = { it.first }, valueTransform = { it.second })
            .values
            .map { packageFiles ->
                CachedTrackPackage(
                    files = packageFiles,
                    lastModified = packageFiles.minOfOrNull { it.lastModified() } ?: 0L,
                )
            }
    }

    private fun deleteCachedTrackFiles(user: AuthUser, trackId: Long, includeDownloads: Boolean = false) {
        val userDir = userCacheDir(user)
        if (!userDir.isDirectory) {
            return
        }
        userDir.walkTopDown()
            .filter { file ->
                file.isFile &&
                    (includeDownloads || !file.name.endsWith(".download")) &&
                    cachedTrackId(file) == trackId
            }
            .forEach { it.delete() }
    }

    private fun moveTempFile(tempFile: File, finalFile: File) {
        if (!tempFile.renameTo(finalFile)) {
            tempFile.copyTo(finalFile, overwrite = true)
            tempFile.delete()
        }
    }

    private data class CachedTrackPackage(
        val files: List<File>,
        val lastModified: Long,
    )

    companion object {
        const val GIB: Long = 1024L * 1024L * 1024L
        const val DEFAULT_MAX_CACHE_BYTES: Long = 5L * GIB
        const val MIN_CACHE_BYTES: Long = 1L * GIB
        const val MAX_CACHE_BYTES: Long = 20L * GIB
        const val RESERVED_STORAGE_BYTES: Long = 1L * GIB
        private const val MIN_CACHE_GB = 1
        private const val MAX_CACHE_GB = 20
        private const val KEY_MAX_CACHE_BYTES = "max_cache_bytes"
    }
}
