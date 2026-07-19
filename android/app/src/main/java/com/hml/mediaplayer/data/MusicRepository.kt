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

    suspend fun favoriteTracks(userId: Long, categoryId: Long? = null): List<Track> {
        return api.favoriteTracks(userId, categoryId)
    }

    suspend fun trackMemberships(userId: Long): TrackMemberships {
        return api.trackMemberships(userId)
    }

    suspend fun addFavoriteTrack(userId: Long, trackId: Long) {
        api.addFavoriteTrack(userId, trackId)
    }

    suspend fun removeFavoriteTrack(userId: Long, trackId: Long) {
        api.removeFavoriteTrack(userId, trackId)
    }

    suspend fun favoriteCategories(userId: Long): List<FavoriteCategory> {
        return api.favoriteCategories(userId)
    }

    suspend fun createFavoriteCategory(userId: Long, name: String): FavoriteCategory {
        return api.createFavoriteCategory(userId, name)
    }

    suspend fun renameFavoriteCategory(userId: Long, categoryId: Long, name: String): FavoriteCategory {
        return api.renameFavoriteCategory(userId, categoryId, name)
    }

    suspend fun deleteFavoriteCategory(userId: Long, categoryId: Long) {
        api.deleteFavoriteCategory(userId, categoryId)
    }

    suspend fun addFavoriteTrackToCategory(userId: Long, categoryId: Long, trackId: Long) {
        api.addFavoriteTrackToCategory(userId, categoryId, trackId)
    }

    suspend fun removeFavoriteTrackFromCategory(userId: Long, categoryId: Long, trackId: Long) {
        api.removeFavoriteTrackFromCategory(userId, categoryId, trackId)
    }

    suspend fun lyrics(user: AuthUser, track: Track): TrackLyrics {
        cacheManager.cachedLyricsFor(user, track)?.let { return it }
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

    suspend fun cacheTrack(
        user: AuthUser,
        track: Track,
        onProgress: (downloadedBytes: Long, totalBytes: Long?) -> Unit,
    ): CacheStats {
        if (track.quality == TrackQuality.LOSSLESS && !user.role.canPlayLossless) {
            throw IllegalStateException("当前用户无权缓存高品质音乐")
        }
        val playbackSession = api.claimPlaybackSession(track.id)
        return try {
            val streamUrl = api.streamUrl(track, playbackSession.streamTicket)
            cacheManager.cacheTrack(
                user = user,
                track = track,
                audioWriter = { file ->
                    api.downloadToFile(streamUrl, file) { downloadedBytes, totalBytes ->
                        cacheManager.ensureReservedStorageAvailable()
                        onProgress(downloadedBytes, totalBytes)
                    }
                },
                lyricsWriter = { file ->
                    val lyricsPayload = api.lyricsPayload(track.id)
                    file.writeText(lyricsPayload.toString(), Charsets.UTF_8)
                },
            )
        } finally {
            runCatching { api.releasePlaybackSession(playbackSession.token) }
        }
    }

    fun coverUrl(track: Track): String? {
        return api.coverUrl(track)
    }
}
