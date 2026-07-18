package com.hml.mediaplayer.viewmodel

import android.app.Application
import android.os.SystemClock
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.hml.mediaplayer.core.AppContainer
import com.hml.mediaplayer.data.ApiException
import com.hml.mediaplayer.data.AuthUser
import com.hml.mediaplayer.data.CachedMusicFile
import com.hml.mediaplayer.data.CacheStats
import com.hml.mediaplayer.data.Track
import com.hml.mediaplayer.data.TrackCacheManager
import com.hml.mediaplayer.data.TrackLyrics
import com.hml.mediaplayer.data.TrackQuality
import com.hml.mediaplayer.playback.AndroidAudioPlayer
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class HomeTab(val label: String) {
    LIBRARY("曲库"),
    LYRICS("歌词"),
    PROFILE("我"),
}

data class PlayerUiState(
    val apiBaseUrl: String = "",
    val user: AuthUser? = null,
    val selectedTab: HomeTab = HomeTab.LIBRARY,
    val quality: TrackQuality = TrackQuality.LOSSLESS,
    val tracks: List<Track> = emptyList(),
    val currentTrack: Track? = null,
    val currentLyrics: TrackLyrics? = null,
    val currentPositionMs: Long = 0L,
    val durationMs: Long = 0L,
    val bufferedPositionMs: Long = 0L,
    val isPlaying: Boolean = false,
    val isBuffering: Boolean = false,
    val sourceFromCache: Boolean = false,
    val playbackStoppedBySleepTimer: Boolean = false,
    val playbackToken: String? = null,
    val cachedTrackIds: Set<Long> = emptySet(),
    val cachedMusicFiles: List<CachedMusicFile> = emptyList(),
    val cacheStats: CacheStats = CacheStats(),
    val cacheLimitGb: Int = (TrackCacheManager.DEFAULT_MAX_CACHE_BYTES / TrackCacheManager.GIB).toInt(),
    val maxCacheLimitGb: Int = 20,
    val canCacheMoreMusic: Boolean = true,
    val sleepTimerMinutes: Int = 30,
    val sleepTimerRemainingSeconds: Long? = null,
    val cachingTrackId: Long? = null,
    val cacheProgress: Float? = null,
    val isLoading: Boolean = false,
    val errorMessage: String? = null,
)

class PlayerViewModel(application: Application) : AndroidViewModel(application) {
    private val container = AppContainer(application)
    private val repository = container.musicRepository
    private val cacheManager = container.cacheManager
    private val audioPlayer = AndroidAudioPlayer(application)
    private val initialCacheLimits = cacheLimitSnapshot()
    private var sleepTimerEndsAtElapsedMs: Long? = null

    private val _uiState = MutableStateFlow(
        PlayerUiState(
            apiBaseUrl = container.sessionStore.apiBaseUrl,
            cacheStats = cacheManager.stats().copy(maxBytes = initialCacheLimits.selectedGb * TrackCacheManager.GIB),
            cacheLimitGb = initialCacheLimits.selectedGb,
            maxCacheLimitGb = initialCacheLimits.maximumGb,
            canCacheMoreMusic = initialCacheLimits.canCacheMore,
        ),
    )
    val uiState: StateFlow<PlayerUiState> = _uiState.asStateFlow()

    init {
        bootstrap()
        observeAudioPlayer()
        startPositionTicker()
    }

    fun updateApiBaseUrl(value: String) {
        container.sessionStore.apiBaseUrl = value
        _uiState.update { it.copy(apiBaseUrl = container.sessionStore.apiBaseUrl) }
    }

    fun login(phone: String, password: String) {
        launchCatching {
            val user = repository.login(phone, password)
            _uiState.update { it.copy(user = user, selectedTab = HomeTab.LIBRARY) }
            refreshTracks()
        }
    }

    fun logout() {
        viewModelScope.launch {
            val token = _uiState.value.playbackToken
            if (!token.isNullOrBlank()) {
                runCatching { container.api.releasePlaybackSession(token) }
            }
            audioPlayer.releasePlaybackResources()
            sleepTimerEndsAtElapsedMs = null
            repository.logout()
            val cacheLimits = cacheLimitSnapshot()
            _uiState.update {
                PlayerUiState(
                    apiBaseUrl = container.sessionStore.apiBaseUrl,
                    cacheStats = cacheManager.stats().copy(maxBytes = cacheLimits.selectedGb * TrackCacheManager.GIB),
                    cacheLimitGb = cacheLimits.selectedGb,
                    maxCacheLimitGb = cacheLimits.maximumGb,
                    canCacheMoreMusic = cacheLimits.canCacheMore,
                )
            }
        }
    }

    fun selectTab(tab: HomeTab) {
        _uiState.update { it.copy(selectedTab = tab) }
    }

    fun selectQuality(quality: TrackQuality) {
        _uiState.update { it.copy(quality = quality) }
        refreshTracks()
    }

    fun refreshTracks() {
        launchCatching {
            val tracks = repository.tracks(_uiState.value.quality)
            _uiState.update { it.copy(tracks = tracks) }
            refreshCacheState()
        }
    }

    fun playTrack(track: Track) {
        launchCatching {
            val user = requireUser()
            val previousToken = _uiState.value.playbackToken
            val source = repository.preparePlayableSource(user, track)
            if (!previousToken.isNullOrBlank() && previousToken != source.playbackToken) {
                runCatching { container.api.releasePlaybackSession(previousToken) }
            }
            audioPlayer.play(source)
            val lyrics = runCatching { repository.lyrics(track) }.getOrNull()
            _uiState.update {
                it.copy(
                    currentTrack = track,
                    currentLyrics = lyrics,
                    currentPositionMs = 0L,
                    durationMs = 0L,
                    bufferedPositionMs = 0L,
                    sourceFromCache = source.fromCache,
                    playbackStoppedBySleepTimer = false,
                    playbackToken = source.playbackToken,
                )
            }
        }
    }

    fun playPrevious() {
        playNeighbor(offset = -1)
    }

    fun playNext() {
        playNeighbor(offset = 1)
    }

    fun togglePlayback() {
        val state = _uiState.value
        if (state.playbackStoppedBySleepTimer) {
            state.currentTrack?.let(::playTrack)
            return
        }
        audioPlayer.toggle()
    }

    fun startSleepTimer(minutes: Int) {
        val normalizedMinutes = minutes.coerceIn(SLEEP_TIMER_MIN_MINUTES, SLEEP_TIMER_MAX_MINUTES)
        sleepTimerEndsAtElapsedMs = SystemClock.elapsedRealtime() + normalizedMinutes * 60_000L
        _uiState.update {
            it.copy(
                sleepTimerMinutes = normalizedMinutes,
                sleepTimerRemainingSeconds = normalizedMinutes * 60L,
            )
        }
    }

    fun stopSleepTimer() {
        sleepTimerEndsAtElapsedMs = null
        _uiState.update { it.copy(sleepTimerRemainingSeconds = null) }
    }

    fun seekTo(positionMs: Long) {
        audioPlayer.seekTo(positionMs)
    }

    fun cacheCurrentTrack() {
        val track = _uiState.value.currentTrack ?: return
        cacheTrack(track)
    }

    fun cacheTrack(track: Track) {
        launchCatching {
            val user = requireUser()
            _uiState.update { it.copy(cachingTrackId = track.id, cacheProgress = 0f) }
            try {
                repository.cacheLosslessFlac(user, track) { downloaded, total ->
                    val progress = total?.takeIf { it > 0L }?.let { (downloaded.toDouble() / it).toFloat().coerceIn(0f, 1f) }
                    _uiState.update { it.copy(cacheProgress = progress) }
                }
            } finally {
                _uiState.update { it.copy(cachingTrackId = null, cacheProgress = null) }
            }
            refreshCacheState()
        }
    }

    fun clearCache() {
        launchCatching {
            val stats = cacheManager.clear()
            val cacheLimits = cacheLimitSnapshot()
            _uiState.update {
                it.copy(
                    cacheStats = stats.copy(maxBytes = cacheLimits.selectedGb * TrackCacheManager.GIB),
                    cachedTrackIds = emptySet(),
                    cachedMusicFiles = emptyList(),
                    cacheLimitGb = cacheLimits.selectedGb,
                    maxCacheLimitGb = cacheLimits.maximumGb,
                    canCacheMoreMusic = cacheLimits.canCacheMore,
                )
            }
        }
    }

    fun loadCachedMusicFiles() {
        launchCatching {
            val user = requireUser()
            val entries = cacheManager.cachedEntriesFor(user)
            val currentTracks = _uiState.value.tracks
            val losslessTracks = if (_uiState.value.quality == TrackQuality.LOSSLESS) {
                currentTracks
            } else {
                runCatching { repository.tracks(TrackQuality.LOSSLESS) }.getOrDefault(emptyList())
            }
            val tracksById = (currentTracks + losslessTracks).associateBy { it.id }
            val files = entries.map { entry ->
                val track = tracksById[entry.trackId]
                CachedMusicFile(
                    trackId = entry.trackId,
                    title = track?.title?.takeIf { it.isNotBlank() } ?: "歌曲 #${entry.trackId}",
                    artist = track?.artist?.takeIf { it.isNotBlank() } ?: "未知歌手",
                    sizeBytes = entry.sizeBytes,
                )
            }.sortedWith(compareBy(CachedMusicFile::title, CachedMusicFile::artist))
            val cacheLimits = cacheLimitSnapshot()
            val stats = cacheManager.statsForUser(user).copy(maxBytes = cacheLimits.selectedGb * TrackCacheManager.GIB)
            _uiState.update {
                it.copy(
                    cachedTrackIds = files.mapTo(mutableSetOf()) { file -> file.trackId },
                    cachedMusicFiles = files,
                    cacheStats = stats,
                    cacheLimitGb = cacheLimits.selectedGb,
                    maxCacheLimitGb = cacheLimits.maximumGb,
                    canCacheMoreMusic = cacheLimits.canCacheMore,
                )
            }
        }
    }

    fun removeCachedMusicFiles(trackIds: Set<Long>) {
        if (trackIds.isEmpty()) {
            return
        }
        launchCatching {
            val user = requireUser()
            cacheManager.removeTracks(user, trackIds)
            val remainingEntries = cacheManager.cachedEntriesFor(user)
            val previousFiles = _uiState.value.cachedMusicFiles.associateBy { it.trackId }
            val currentTracks = _uiState.value.tracks.associateBy { it.id }
            val remainingFiles = remainingEntries.map { entry ->
                previousFiles[entry.trackId]?.copy(sizeBytes = entry.sizeBytes)
                    ?: currentTracks[entry.trackId]?.let { track ->
                        CachedMusicFile(
                            trackId = entry.trackId,
                            title = track.title.ifBlank { "歌曲 #${entry.trackId}" },
                            artist = track.artist.ifBlank { "未知歌手" },
                            sizeBytes = entry.sizeBytes,
                        )
                    }
                    ?: CachedMusicFile(
                        trackId = entry.trackId,
                        title = "歌曲 #${entry.trackId}",
                        artist = "未知歌手",
                        sizeBytes = entry.sizeBytes,
                    )
            }.sortedWith(compareBy(CachedMusicFile::title, CachedMusicFile::artist))
            val cacheLimits = cacheLimitSnapshot()
            val stats = cacheManager.statsForUser(user).copy(maxBytes = cacheLimits.selectedGb * TrackCacheManager.GIB)
            _uiState.update {
                it.copy(
                    cachedTrackIds = remainingFiles.mapTo(mutableSetOf()) { file -> file.trackId },
                    cachedMusicFiles = remainingFiles,
                    cacheStats = stats,
                    cacheLimitGb = cacheLimits.selectedGb,
                    maxCacheLimitGb = cacheLimits.maximumGb,
                    canCacheMoreMusic = cacheLimits.canCacheMore,
                )
            }
        }
    }

    fun setCacheLimitGb(value: Int) {
        runCatching { cacheManager.updateCacheLimitGb(value) }
            .onFailure { error ->
                _uiState.update { it.copy(errorMessage = error.message ?: "存储空间不足") }
            }
        refreshCacheState()
    }

    fun refreshCacheStorageLimits() {
        refreshCacheState()
    }

    fun clearError() {
        _uiState.update { it.copy(errorMessage = null) }
    }

    fun coverUrl(track: Track): String? {
        return repository.coverUrl(track)
    }

    fun authToken(): String {
        return container.sessionStore.authToken
    }

    private fun bootstrap() {
        if (container.sessionStore.authToken.isBlank()) {
            return
        }
        launchCatching {
            val user = repository.currentUser()
            _uiState.update { it.copy(user = user) }
            refreshTracks()
        }
    }

    private fun observeAudioPlayer() {
        viewModelScope.launch {
            audioPlayer.state.collect { audioState ->
                _uiState.update {
                    it.copy(
                        isPlaying = audioState.isPlaying,
                        isBuffering = audioState.isBuffering,
                        durationMs = audioState.durationMs,
                        bufferedPositionMs = if (it.sourceFromCache && audioState.durationMs > 0L) {
                            audioState.durationMs
                        } else {
                            audioState.bufferedPositionMs
                        },
                        errorMessage = audioState.errorMessage ?: it.errorMessage,
                    )
                }
            }
        }
    }

    private fun startPositionTicker() {
        viewModelScope.launch {
            while (true) {
                delay(250)
                updateSleepTimer()
                _uiState.update {
                    val currentPositionMs = audioPlayer.currentPositionMs()
                    val durationMs = audioPlayer.durationMs()
                    val bufferedPositionMs = if (it.sourceFromCache && durationMs > 0L) {
                        durationMs
                    } else {
                        audioPlayer.bufferedPositionMs().coerceAtLeast(currentPositionMs)
                    }
                    it.copy(
                        currentPositionMs = currentPositionMs,
                        durationMs = durationMs,
                        bufferedPositionMs = bufferedPositionMs,
                    )
                }
            }
        }
    }

    private suspend fun updateSleepTimer() {
        val endsAtMs = sleepTimerEndsAtElapsedMs ?: return
        val remainingMs = endsAtMs - SystemClock.elapsedRealtime()
        if (remainingMs <= 0L) {
            val state = _uiState.value
            val playbackToken = state.playbackToken
            sleepTimerEndsAtElapsedMs = null
            audioPlayer.releasePlaybackResources()
            _uiState.update {
                it.copy(
                    currentPositionMs = 0L,
                    durationMs = 0L,
                    bufferedPositionMs = 0L,
                    isPlaying = false,
                    isBuffering = false,
                    sourceFromCache = false,
                    playbackStoppedBySleepTimer = state.currentTrack != null,
                    playbackToken = null,
                    sleepTimerRemainingSeconds = null,
                )
            }
            if (!playbackToken.isNullOrBlank()) {
                runCatching { container.api.releasePlaybackSession(playbackToken) }
            }
            return
        }
        val remainingSeconds = (remainingMs + 999L) / 1_000L
        if (_uiState.value.sleepTimerRemainingSeconds != remainingSeconds) {
            _uiState.update { it.copy(sleepTimerRemainingSeconds = remainingSeconds) }
        }
    }

    private fun refreshCacheState() {
        val user = _uiState.value.user
        val tracks = _uiState.value.tracks
        val cachedIds = if (user == null) emptySet() else cacheManager.cachedIdsFor(user, tracks)
        val cacheLimits = cacheLimitSnapshot()
        val stats = (if (user == null) cacheManager.stats() else cacheManager.statsForUser(user))
            .copy(maxBytes = cacheLimits.selectedGb * TrackCacheManager.GIB)
        _uiState.update {
            it.copy(
                cachedTrackIds = cachedIds,
                cacheStats = stats,
                cacheLimitGb = cacheLimits.selectedGb,
                maxCacheLimitGb = cacheLimits.maximumGb,
                canCacheMoreMusic = cacheLimits.canCacheMore,
            )
        }
    }

    private fun cacheLimitSnapshot(): CacheLimitSnapshot {
        val maximumGb = cacheManager.maxSelectableCacheGb()
        return CacheLimitSnapshot(
            selectedGb = cacheManager.normalizedCacheLimitGb(maximumGb),
            maximumGb = maximumGb,
            canCacheMore = cacheManager.hasReservedStorageAvailable(),
        )
    }

    private data class CacheLimitSnapshot(
        val selectedGb: Int,
        val maximumGb: Int,
        val canCacheMore: Boolean,
    )

    private companion object {
        const val SLEEP_TIMER_MIN_MINUTES = 1
        const val SLEEP_TIMER_MAX_MINUTES = 360
    }

    private fun playNeighbor(offset: Int) {
        val state = _uiState.value
        val current = state.currentTrack ?: return
        val index = state.tracks.indexOfFirst { it.id == current.id }
        if (index < 0 || state.tracks.isEmpty()) {
            return
        }
        val nextIndex = Math.floorMod(index + offset, state.tracks.size)
        playTrack(state.tracks[nextIndex])
    }

    private fun requireUser(): AuthUser {
        return _uiState.value.user ?: throw IllegalStateException("请先登录")
    }

    private fun launchCatching(block: suspend () -> Unit) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null) }
            runCatching { block() }
                .onFailure { error ->
                    if (error is ApiException && error.status == 401) {
                        container.sessionStore.clearAuth()
                    }
                    _uiState.update { it.copy(errorMessage = error.message ?: "操作失败") }
                }
            _uiState.update { it.copy(isLoading = false) }
        }
    }

    override fun onCleared() {
        val token = _uiState.value.playbackToken
        if (!token.isNullOrBlank()) {
            viewModelScope.launch {
                runCatching { container.api.releasePlaybackSession(token) }
            }
        }
        audioPlayer.release()
        super.onCleared()
    }
}
