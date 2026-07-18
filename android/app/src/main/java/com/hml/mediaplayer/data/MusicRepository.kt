package com.hml.mediaplayer.data

import android.net.Uri

class MusicRepository(
    private val api: MediaPlayerApi,
    private val sessionStore: SessionStore,
    private val cacheManager: TrackCacheManager,
) {
    suspend fun login(phone: String, password: String): AuthUser {
        val result = api.login(phone, password)
        sessionStore.authToken = result.token.orEmpty()
        return result.user
    }

    suspend fun logout() {
        runCatching { api.logout() }
        sessionStore.clearAuth()
    }

    suspend fun currentUser(): AuthUser {
        return api.currentUser()
    }

    suspend fun tracks(quality: TrackQuality): List<Track> {
        return api.tracks(quality)
    }

    suspend fun lyrics(track: Track): TrackLyrics {
        return api.lyrics(track.id)
    }

    suspend fun preparePlayableSource(user: AuthUser, track: Track): PlayableSource {
        if (track.quality == TrackQuality.LOSSLESS && !user.role.canPlayLossless) {
            throw IllegalStateException("当前用户无权播放高品质音乐")
        }

        val localUri = cacheManager.playableUriFor(user, track)
        if (localUri != null) {
            return PlayableSource(
                track = track,
                uri = localUri,
                fromCache = true,
                playbackToken = null,
            )
        }

        val playbackSession = api.claimPlaybackSession(track.id)
        return PlayableSource(
            track = track,
            uri = Uri.parse(api.streamUrl(track, playbackSession.streamTicket)),
            fromCache = false,
            playbackToken = playbackSession.token,
        )
    }

    suspend fun cacheLosslessFlac(
        user: AuthUser,
        track: Track,
        onProgress: (downloadedBytes: Long, totalBytes: Long?) -> Unit,
    ): CacheStats {
        if (!track.isLosslessFlac) {
            throw IllegalStateException("当前只缓存高品质 FLAC 文件")
        }
        if (!user.role.canPlayLossless) {
            throw IllegalStateException("当前用户无权缓存高品质音乐")
        }
        val playbackSession = api.claimPlaybackSession(track.id)
        return try {
            val streamUrl = api.streamUrl(track, playbackSession.streamTicket)
            cacheManager.cacheTrack(user, track) { file ->
                api.downloadToFile(streamUrl, file) { downloadedBytes, totalBytes ->
                    cacheManager.ensureReservedStorageAvailable()
                    onProgress(downloadedBytes, totalBytes)
                }
            }
        } finally {
            runCatching { api.releasePlaybackSession(playbackSession.token) }
        }
    }

    fun coverUrl(track: Track): String? {
        return api.coverUrl(track)
    }
}
