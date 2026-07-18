package com.hml.mediaplayer.data

import android.net.Uri

enum class UserRole(val apiValue: String, val label: String) {
    SUPER_ADMIN("super_admin", "超级管理员"),
    ADMIN("admin", "管理员"),
    VIP("vip", "VIP"),
    USER("user", "普通用户");

    companion object {
        fun fromApi(value: String?): UserRole {
            return entries.firstOrNull { it.apiValue == value?.trim()?.lowercase() } ?: USER
        }
    }
}

val UserRole.canPlayLossless: Boolean
    get() = this == UserRole.SUPER_ADMIN || this == UserRole.ADMIN || this == UserRole.VIP

enum class TrackQuality(val apiValue: String, val label: String) {
    LOSSLESS("lossless", "高品质"),
    LOSSY("lossy", "轻音乐");

    companion object {
        fun fromApi(value: String?): TrackQuality {
            return entries.firstOrNull { it.apiValue == value?.trim()?.lowercase() } ?: LOSSY
        }
    }
}

data class AuthUser(
    val id: Long,
    val phone: String,
    val countryCode: String,
    val nickname: String,
    val role: UserRole,
    val createdAt: String,
)

data class AuthResult(
    val user: AuthUser,
    val token: String?,
    val expiresAt: String?,
)

data class LyricWord(
    val text: String,
    val startSeconds: Double,
    val endSeconds: Double,
)

data class LyricLine(
    val timeSeconds: Double?,
    val text: String,
    val words: List<LyricWord> = emptyList(),
)

data class Track(
    val id: Long,
    val relativePath: String,
    val filename: String,
    val title: String,
    val artist: String,
    val album: String,
    val format: String,
    val quality: TrackQuality,
    val sizeBytes: Long,
    val durationSeconds: Double?,
    val modifiedAt: String,
    val streamUrl: String,
    val coverUrl: String?,
)

val Track.isLosslessFlac: Boolean
    get() = quality == TrackQuality.LOSSLESS && format.equals("flac", ignoreCase = true)

data class TrackLyrics(
    val trackId: Long,
    val format: String,
    val content: String,
    val lines: List<LyricLine>,
    val source: String,
    val updatedAt: String?,
)

data class PlaybackSession(
    val token: String,
    val expiresAt: String,
    val state: String,
    val trackId: Long,
    val streamTicket: String?,
    val streamTicketExpiresAt: String?,
)

data class PlayableSource(
    val track: Track,
    val uri: Uri,
    val fromCache: Boolean,
    val playbackToken: String?,
)

data class CacheStats(
    val fileCount: Int = 0,
    val totalBytes: Long = 0L,
    val maxBytes: Long = TrackCacheManager.DEFAULT_MAX_CACHE_BYTES,
)

data class CachedFileEntry(
    val trackId: Long,
    val sizeBytes: Long,
)

data class CachedMusicFile(
    val trackId: Long,
    val title: String,
    val artist: String,
    val sizeBytes: Long,
)
