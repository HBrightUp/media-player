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
import com.hml.mediaplayer.data.FavoriteCategory
import com.hml.mediaplayer.data.Track
import com.hml.mediaplayer.data.TrackCacheManager
import com.hml.mediaplayer.data.TrackCategoryMembership
import com.hml.mediaplayer.data.TrackLyrics
import com.hml.mediaplayer.data.TrackQuality
import com.hml.mediaplayer.playback.AndroidAudioPlayer
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.roundToInt

enum class HomeTab(val label: String) {
    LIBRARY("曲库"),
    LYRICS("歌词"),
    PROFILE("我"),
}

enum class LibraryContent {
    QUALITY,
    FAVORITES,
    CATEGORY,
}

enum class PlaybackMode(val label: String) {
    ORDER("列表循环"),
    REPEAT_ONE("单曲循环"),
    SHUFFLE("随机播放"),
}

enum class EqualizerPreset(
    val label: String,
    val gainsDb: List<Float>,
) {
    FLAT("默认", listOf(0f, 0f, 0f, 0f, 0f, 0f, 0f, 0f, 0f, 0f)),
    BASS("低音", listOf(3.5f, 3f, 2.5f, 1.2f, -0.5f, -0.8f, 0f, 0.4f, 0.5f, 0.5f)),
    VOCAL("人声", listOf(-1.8f, -1.5f, -1f, -0.5f, -1.2f, 1.2f, 3f, 2.2f, 1f, 0.5f)),
    BRIGHT("明亮", listOf(-1f, -0.8f, -0.5f, -0.3f, 0f, 0.6f, 1.3f, 2f, 2.8f, 3f)),
    NIGHT("夜间", listOf(-2.5f, -2f, -1.6f, -1f, -0.6f, -0.4f, -0.6f, -1f, -1.5f, -2.2f)),
}

const val FAVORITE_CATEGORY_LIMIT = 12
const val FAVORITE_CATEGORY_NAME_MAX_LENGTH = 16

data class PlayerUiState(
    val apiBaseUrl: String = "",
    val user: AuthUser? = null,
    val selectedTab: HomeTab = HomeTab.LIBRARY,
    val quality: TrackQuality = TrackQuality.LOSSLESS,
    val libraryContent: LibraryContent = LibraryContent.QUALITY,
    val librarySourceTracks: List<Track> = emptyList(),
    val tracks: List<Track> = emptyList(),
    val favoriteCategories: List<FavoriteCategory> = emptyList(),
    val favoriteCategoryLimit: Int = FAVORITE_CATEGORY_LIMIT,
    val favoriteCategoryNameMaxLength: Int = FAVORITE_CATEGORY_NAME_MAX_LENGTH,
    val activeFavoriteCategoryId: Long? = null,
    val favoriteTrackIds: Set<Long> = emptySet(),
    val categoryMemberships: List<TrackCategoryMembership> = emptyList(),
    val currentTrack: Track? = null,
    val currentLyrics: TrackLyrics? = null,
    val currentPositionMs: Long = 0L,
    val durationMs: Long = 0L,
    val bufferedPositionMs: Long = 0L,
    val isPlaying: Boolean = false,
    val isBuffering: Boolean = false,
    val sourceFromCache: Boolean = false,
    val playbackStoppedBySleepTimer: Boolean = false,
    val playbackMode: PlaybackMode = PlaybackMode.ORDER,
    val equalizerPreset: EqualizerPreset = EqualizerPreset.FLAT,
    val equalizerGainsDb: List<Float> = EqualizerPreset.FLAT.gainsDb,
    val isEqualizerCustom: Boolean = false,
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
    private var lastHandledPlaybackEndedSignal = 0L

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
            _uiState.update {
                it.copy(
                    user = user,
                    selectedTab = HomeTab.LIBRARY,
                    libraryContent = LibraryContent.QUALITY,
                    activeFavoriteCategoryId = null,
                )
            }
            syncLibraryData()
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
        if (tab == HomeTab.LIBRARY) {
            refreshTracks()
        }
    }

    fun selectQuality(quality: TrackQuality) {
        _uiState.update {
            it.copy(
                quality = quality,
                libraryContent = LibraryContent.QUALITY,
            )
        }
        refreshTracks()
    }

    fun selectFavoriteTracks() {
        _uiState.update {
            it.copy(
                libraryContent = LibraryContent.FAVORITES,
            )
        }
        refreshTracks()
    }

    fun selectFavoriteCategory(category: FavoriteCategory?) {
        _uiState.update {
            val activeCategoryId = category?.id
            it.copy(
                activeFavoriteCategoryId = activeCategoryId,
                tracks = filterTracksByCategory(
                    tracks = it.librarySourceTracks,
                    activeCategoryId = activeCategoryId,
                    categoryMemberships = it.categoryMemberships,
                ),
            )
        }
    }

    fun refreshTracks() {
        launchCatching {
            syncLibraryData()
        }
    }

    fun createFavoriteCategory(rawName: String) {
        val name = rawName.trim()
        if (name.isBlank()) {
            _uiState.update { it.copy(errorMessage = "请输入分类名称") }
            return
        }
        if (name.codePointCount(0, name.length) > FAVORITE_CATEGORY_NAME_MAX_LENGTH) {
            _uiState.update { it.copy(errorMessage = "分类名称不能超过${FAVORITE_CATEGORY_NAME_MAX_LENGTH}个字符") }
            return
        }

        launchCatching {
            val user = requireUser()
            val latestCategories = repository.favoriteCategories(user.id)
            check(latestCategories.size < FAVORITE_CATEGORY_LIMIT) {
                "最多创建${FAVORITE_CATEGORY_LIMIT}个分类"
            }
            check(latestCategories.none { it.name.equals(name, ignoreCase = true) }) {
                "分类名称已存在"
            }
            val category = repository.createFavoriteCategory(user.id, name)
            val categories = sortFavoriteCategories(repository.favoriteCategories(user.id))
            val memberships = repository.trackMemberships(user.id)
            _uiState.update {
                val activeCategoryId = category.id
                it.copy(
                    favoriteCategories = categories,
                    activeFavoriteCategoryId = activeCategoryId,
                    favoriteTrackIds = memberships.favoriteTrackIds,
                    categoryMemberships = memberships.categoryMemberships,
                    tracks = filterTracksByCategory(
                        tracks = it.librarySourceTracks,
                        activeCategoryId = activeCategoryId,
                        categoryMemberships = memberships.categoryMemberships,
                    ),
                )
            }
            refreshCacheState()
        }
    }

    fun deleteFavoriteCategory(category: FavoriteCategory) {
        launchCatching {
            val user = requireUser()
            repository.deleteFavoriteCategory(user.id, category.id)
            val categories = sortFavoriteCategories(repository.favoriteCategories(user.id))
            val memberships = repository.trackMemberships(user.id)
            val state = _uiState.value
            val nextActiveCategoryId = state.activeFavoriteCategoryId.takeIf { it != category.id }
            _uiState.update {
                it.copy(
                    favoriteCategories = categories,
                    activeFavoriteCategoryId = nextActiveCategoryId,
                    favoriteTrackIds = memberships.favoriteTrackIds,
                    categoryMemberships = memberships.categoryMemberships,
                    tracks = filterTracksByCategory(
                        tracks = it.librarySourceTracks,
                        activeCategoryId = nextActiveCategoryId,
                        categoryMemberships = memberships.categoryMemberships,
                    ),
                )
            }
            refreshCacheState()
        }
    }

    fun renameFavoriteCategory(category: FavoriteCategory, rawName: String) {
        val name = rawName.trim()
        if (name.isBlank()) {
            _uiState.update { it.copy(errorMessage = "请输入分类名称") }
            return
        }
        if (name.codePointCount(0, name.length) > FAVORITE_CATEGORY_NAME_MAX_LENGTH) {
            _uiState.update { it.copy(errorMessage = "分类名称不能超过${FAVORITE_CATEGORY_NAME_MAX_LENGTH}个字符") }
            return
        }
        if (name == category.name) {
            return
        }

        launchCatching {
            val user = requireUser()
            val latestCategories = repository.favoriteCategories(user.id)
            check(latestCategories.none { it.id != category.id && it.name.equals(name, ignoreCase = true) }) {
                "分类名称已存在"
            }
            val renamedCategory = repository.renameFavoriteCategory(user.id, category.id, name)
            val categories = sortFavoriteCategories(
                latestCategories.map { currentCategory ->
                    if (currentCategory.id == renamedCategory.id) renamedCategory else currentCategory
                },
            )
            _uiState.update {
                it.copy(
                    favoriteCategories = categories,
                    categoryMemberships = it.categoryMemberships.map { membership ->
                        if (membership.categoryId == renamedCategory.id) {
                            membership.copy(categoryName = renamedCategory.name)
                        } else {
                            membership
                        }
                    },
                )
            }
        }
    }

    fun toggleFavorite(track: Track) {
        launchCatching {
            val user = requireUser()
            val wasFavorite = track.id in _uiState.value.favoriteTrackIds
            if (wasFavorite) {
                repository.removeFavoriteTrack(user.id, track.id)
            } else {
                repository.addFavoriteTrack(user.id, track.id)
            }
            refreshMembershipsAndVisibleFavorites(user.id)
        }
    }

    fun addTrackToFavoriteCategory(track: Track, category: FavoriteCategory) {
        launchCatching {
            val user = requireUser()
            repository.addFavoriteTrackToCategory(user.id, category.id, track.id)
            refreshMembershipsAndVisibleFavorites(user.id, changedCategoryId = category.id)
        }
    }

    fun removeTrackFromFavoriteCategory(track: Track, categoryId: Long) {
        launchCatching {
            val user = requireUser()
            repository.removeFavoriteTrackFromCategory(user.id, categoryId, track.id)
            refreshMembershipsAndVisibleFavorites(user.id, changedCategoryId = categoryId)
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
            val lyrics = runCatching { repository.lyrics(user, track) }.getOrNull()
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

    fun cyclePlaybackMode() {
        _uiState.update {
            val nextMode = when (it.playbackMode) {
                PlaybackMode.ORDER -> PlaybackMode.REPEAT_ONE
                PlaybackMode.REPEAT_ONE -> PlaybackMode.SHUFFLE
                PlaybackMode.SHUFFLE -> PlaybackMode.ORDER
            }
            it.copy(playbackMode = nextMode)
        }
    }

    fun selectPlaybackMode(mode: PlaybackMode) {
        _uiState.update { it.copy(playbackMode = mode) }
    }

    fun selectEqualizerPreset(preset: EqualizerPreset) {
        val gains = normalizeEqualizerGains(preset.gainsDb)
        _uiState.update {
            it.copy(
                equalizerPreset = preset,
                equalizerGainsDb = gains,
                isEqualizerCustom = false,
            )
        }
        audioPlayer.setEqualizerGains(gains)
    }

    fun setEqualizerBandGain(index: Int, gainDb: Float) {
        val currentGains = normalizeEqualizerGains(_uiState.value.equalizerGainsDb)
        if (index !in currentGains.indices) {
            return
        }
        val nextGains = currentGains.toMutableList().also {
            it[index] = clampEqualizerGain(gainDb)
        }
        val matchedPreset = findEqualizerPreset(nextGains)
        _uiState.update {
            it.copy(
                equalizerPreset = matchedPreset ?: EqualizerPreset.FLAT,
                equalizerGainsDb = nextGains,
                isEqualizerCustom = matchedPreset == null,
            )
        }
        audioPlayer.setEqualizerGains(nextGains)
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

    fun seekToAndPlay(positionMs: Long) {
        audioPlayer.seekTo(positionMs)
        audioPlayer.resume()
        _uiState.update { it.copy(playbackStoppedBySleepTimer = false) }
    }

    fun playbackPositionMs(): Long {
        return audioPlayer.currentPositionMs()
    }

    fun cacheCurrentTrack() {
        val track = _uiState.value.currentTrack ?: return
        cacheTrack(track)
    }

    fun cacheTrack(track: Track) {
        val activeCachingTrackId = _uiState.value.cachingTrackId
        if (activeCachingTrackId != null) {
            _uiState.update { it.copy(errorMessage = "已有歌曲正在缓存，请稍后再试") }
            return
        }
        launchCatching {
            val user = requireUser()
            _uiState.update { it.copy(cachingTrackId = track.id, cacheProgress = 0f) }
            try {
                repository.cacheTrack(user, track) { downloaded, total ->
                    val progress = total?.takeIf { it > 0L }?.let { (downloaded.toDouble() / it).toFloat().coerceIn(0f, 1f) }
                    _uiState.update { it.copy(cacheProgress = progress) }
                }
            } finally {
                _uiState.update { it.copy(cachingTrackId = null, cacheProgress = null) }
            }
            refreshCacheState()
        }
    }

    fun removeCachedTrack(track: Track) {
        removeCachedMusicFiles(setOf(track.id))
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
            val currentTracks = _uiState.value.librarySourceTracks.ifEmpty { _uiState.value.tracks }
            val losslessTracks = runCatching { repository.tracks(TrackQuality.LOSSLESS) }.getOrDefault(emptyList())
            val lossyTracks = runCatching { repository.tracks(TrackQuality.LOSSY) }.getOrDefault(emptyList())
            val tracksById = (currentTracks + losslessTracks + lossyTracks).associateBy { it.id }
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
            syncLibraryData()
        }
    }

    private suspend fun syncLibraryData() {
        val user = requireUser()
        val categories = sortFavoriteCategories(repository.favoriteCategories(user.id))
        val memberships = repository.trackMemberships(user.id)
        val snapshot = _uiState.value
        val content = if (snapshot.libraryContent == LibraryContent.CATEGORY) {
            LibraryContent.FAVORITES
        } else {
            snapshot.libraryContent
        }
        val activeCategoryId = snapshot.activeFavoriteCategoryId.takeIf {
            categories.any { category -> category.id == it }
        }
        val sourceTracks = when (content) {
            LibraryContent.QUALITY -> repository.tracks(snapshot.quality)
            LibraryContent.FAVORITES -> repository.favoriteTracks(user.id)
            LibraryContent.CATEGORY -> repository.favoriteTracks(user.id)
        }
        val tracks = filterTracksByCategory(sourceTracks, activeCategoryId, memberships.categoryMemberships)
        _uiState.update {
            it.copy(
                libraryContent = content,
                librarySourceTracks = sourceTracks,
                tracks = tracks,
                favoriteCategories = categories,
                activeFavoriteCategoryId = activeCategoryId,
                favoriteTrackIds = memberships.favoriteTrackIds,
                categoryMemberships = memberships.categoryMemberships,
            )
        }
        refreshCacheState()
    }

    private suspend fun refreshMembershipsAndVisibleFavorites(userId: Long, changedCategoryId: Long? = null) {
        val memberships = repository.trackMemberships(userId)
        val snapshot = _uiState.value
        val shouldRefreshSourceTracks = when (snapshot.libraryContent) {
            LibraryContent.QUALITY -> false
            LibraryContent.FAVORITES -> true
            LibraryContent.CATEGORY -> true
        }
        val sourceTracks = if (shouldRefreshSourceTracks) {
            when (snapshot.libraryContent) {
                LibraryContent.QUALITY -> snapshot.librarySourceTracks
                LibraryContent.FAVORITES -> repository.favoriteTracks(userId)
                LibraryContent.CATEGORY -> repository.favoriteTracks(userId)
            }
        } else {
            snapshot.librarySourceTracks
        }
        val tracks = filterTracksByCategory(sourceTracks, snapshot.activeFavoriteCategoryId, memberships.categoryMemberships)
        _uiState.update {
            it.copy(
                librarySourceTracks = sourceTracks,
                tracks = tracks,
                favoriteTrackIds = memberships.favoriteTrackIds,
                categoryMemberships = memberships.categoryMemberships,
            )
        }
        refreshCacheState()
    }

    private fun sortFavoriteCategories(categories: List<FavoriteCategory>): List<FavoriteCategory> {
        return categories.sortedWith(compareBy<FavoriteCategory> { it.sortOrder }.thenBy { it.id })
    }

    private fun filterTracksByCategory(
        tracks: List<Track>,
        activeCategoryId: Long?,
        categoryMemberships: List<TrackCategoryMembership>,
    ): List<Track> {
        if (activeCategoryId == null) {
            return tracks
        }
        val trackIdsInCategory = categoryMemberships
            .asSequence()
            .filter { it.categoryId == activeCategoryId }
            .mapTo(mutableSetOf()) { it.trackId }
        return tracks.filter { it.id in trackIdsInCategory }
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
                if (
                    audioState.playbackEndedSignal != 0L &&
                    audioState.playbackEndedSignal != lastHandledPlaybackEndedSignal
                ) {
                    lastHandledPlaybackEndedSignal = audioState.playbackEndedSignal
                    handlePlaybackEnded()
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
        const val EQUALIZER_BAND_COUNT = 10
        const val EQUALIZER_GAIN_MIN_DB = -9f
        const val EQUALIZER_GAIN_MAX_DB = 9f
        const val EQUALIZER_GAIN_STEP_DB = 0.5f
    }

    private fun handlePlaybackEnded() {
        playNeighbor(offset = 1, fromPlaybackEnd = true)
    }

    private fun playNeighbor(offset: Int, fromPlaybackEnd: Boolean = false) {
        val state = _uiState.value
        val current = state.currentTrack ?: return
        val index = state.tracks.indexOfFirst { it.id == current.id }
        if (index < 0 || state.tracks.isEmpty()) {
            return
        }
        val nextTrack = when (state.playbackMode) {
            PlaybackMode.REPEAT_ONE -> if (fromPlaybackEnd) {
                current
            } else {
                val nextIndex = Math.floorMod(index + offset, state.tracks.size)
                state.tracks[nextIndex]
            }
            PlaybackMode.SHUFFLE -> {
                if (offset > 0) {
                    val candidates = state.tracks.filter { it.id != current.id }
                    candidates.randomOrNull() ?: current
                } else {
                    val nextIndex = Math.floorMod(index + offset, state.tracks.size)
                    state.tracks[nextIndex]
                }
            }
            PlaybackMode.ORDER -> {
                val nextIndex = Math.floorMod(index + offset, state.tracks.size)
                state.tracks[nextIndex]
            }
        }
        playTrack(nextTrack)
    }

    private fun requireUser(): AuthUser {
        return _uiState.value.user ?: throw IllegalStateException("请先登录")
    }

    private fun normalizeEqualizerGains(gains: List<Float>): List<Float> {
        return List(EQUALIZER_BAND_COUNT) { index ->
            clampEqualizerGain(gains.getOrElse(index) { 0f })
        }
    }

    private fun clampEqualizerGain(gainDb: Float): Float {
        return ((gainDb.coerceIn(EQUALIZER_GAIN_MIN_DB, EQUALIZER_GAIN_MAX_DB) / EQUALIZER_GAIN_STEP_DB).roundToInt() *
            EQUALIZER_GAIN_STEP_DB)
    }

    private fun findEqualizerPreset(gains: List<Float>): EqualizerPreset? {
        return EqualizerPreset.values().firstOrNull { preset ->
            normalizeEqualizerGains(preset.gainsDb).zip(gains).all { (presetGain, gain) ->
                abs(presetGain - gain) < 0.05f
            }
        }
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
