package com.hml.mediaplayer.playback

import android.content.Context
import android.media.audiofx.Equalizer
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import com.hml.mediaplayer.data.PlayableSource
import com.hml.mediaplayer.data.Track
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlin.math.abs
import kotlin.math.roundToInt

data class AudioPlayerState(
    val currentTrack: Track? = null,
    val isPlaying: Boolean = false,
    val isBuffering: Boolean = false,
    val durationMs: Long = 0L,
    val bufferedPositionMs: Long = 0L,
    val errorMessage: String? = null,
    val playbackEndedSignal: Long = 0L,
)

class AndroidAudioPlayer(context: Context) : Player.Listener {
    private val appContext = context.applicationContext
    private var player: ExoPlayer? = createPlayer()
    private var equalizer: Equalizer? = null
    private var equalizerGainsDb: List<Float> = emptyList()
    private var playbackEndedSignal = 0L

    private val _state = MutableStateFlow(AudioPlayerState())
    val state: StateFlow<AudioPlayerState> = _state.asStateFlow()

    fun play(source: PlayableSource) {
        val activePlayer = player ?: createPlayer().also { player = it }
        val metadata = MediaMetadata.Builder()
            .setTitle(source.track.title)
            .setArtist(source.track.artist)
            .setAlbumTitle(source.track.album)
            .build()
        val mediaItem = MediaItem.Builder()
            .setUri(source.uri)
            .setMediaMetadata(metadata)
            .build()
        activePlayer.setMediaItem(mediaItem)
        activePlayer.prepare()
        syncEqualizerSession(activePlayer)
        activePlayer.play()
        _state.update {
            it.copy(
                currentTrack = source.track,
                isBuffering = true,
                bufferedPositionMs = bufferedPositionMs(),
                errorMessage = null,
            )
        }
    }

    fun toggle() {
        val activePlayer = player ?: return
        if (activePlayer.isPlaying) {
            activePlayer.pause()
        } else {
            activePlayer.play()
        }
    }

    fun resume() {
        player?.play()
    }

    fun pause() {
        player?.pause()
    }

    fun seekTo(positionMs: Long) {
        player?.seekTo(positionMs.coerceAtLeast(0L))
    }

    fun currentPositionMs(): Long {
        return player?.currentPosition?.coerceAtLeast(0L) ?: 0L
    }

    fun durationMs(): Long {
        return player?.duration?.takeUnless { it == C.TIME_UNSET }?.coerceAtLeast(0L) ?: 0L
    }

    fun bufferedPositionMs(): Long {
        return player?.bufferedPosition?.takeUnless { it == C.TIME_UNSET }?.coerceAtLeast(0L) ?: 0L
    }

    fun setEqualizerGains(gainsDb: List<Float>) {
        equalizerGainsDb = gainsDb
        applyEqualizerGains()
    }

    fun releasePlaybackResources() {
        releaseEqualizer()
        player?.let { activePlayer ->
            activePlayer.stop()
            activePlayer.clearMediaItems()
            activePlayer.removeListener(this)
            activePlayer.release()
        }
        player = null
        _state.value = AudioPlayerState()
    }

    fun release() {
        releasePlaybackResources()
    }

    private fun createPlayer(): ExoPlayer {
        return ExoPlayer.Builder(appContext).build().also {
            it.setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(C.USAGE_MEDIA)
                    .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                    .build(),
                true,
            )
            it.addListener(this)
        }
    }

    private fun syncEqualizerSession(activePlayer: ExoPlayer) {
        runCatching {
            val audioSessionId = activePlayer.audioSessionId
            if (audioSessionId != C.AUDIO_SESSION_ID_UNSET) {
                recreateEqualizer(audioSessionId)
            }
        }
    }

    private fun recreateEqualizer(audioSessionId: Int) {
        releaseEqualizer()
        runCatching {
            equalizer = Equalizer(0, audioSessionId).also { audioEffect ->
                applyEqualizerGains(audioEffect)
            }
        }
    }

    private fun applyEqualizerGains(target: Equalizer? = equalizer) {
        val audioEffect = target ?: return
        val gains = equalizerGainsDb
        if (gains.isEmpty()) {
            audioEffect.enabled = false
            return
        }
        val hasEffect = gains.any { abs(it) > 0.05f }
        val range = audioEffect.bandLevelRange
        val minLevel = range.getOrNull(0)?.toInt() ?: -1500
        val maxLevel = range.getOrNull(1)?.toInt() ?: 1500
        val bandCount = audioEffect.numberOfBands.toInt().coerceAtLeast(0)
        for (band in 0 until bandCount) {
            val gainIndex = ((band.toFloat() / bandCount) * gains.size)
                .toInt()
                .coerceIn(0, gains.lastIndex)
            val level = (gains[gainIndex] * 100f)
                .roundToInt()
                .coerceIn(minLevel, maxLevel)
                .toShort()
            runCatching { audioEffect.setBandLevel(band.toShort(), level) }
        }
        audioEffect.enabled = hasEffect
    }

    private fun releaseEqualizer() {
        runCatching { equalizer?.release() }
        equalizer = null
    }

    override fun onIsPlayingChanged(isPlaying: Boolean) {
        _state.update { it.copy(isPlaying = isPlaying) }
    }

    override fun onPlaybackStateChanged(playbackState: Int) {
        if (playbackState == Player.STATE_ENDED) {
            playbackEndedSignal += 1L
        }
        _state.update {
            it.copy(
                isBuffering = playbackState == Player.STATE_BUFFERING,
                durationMs = durationMs(),
                bufferedPositionMs = bufferedPositionMs(),
                playbackEndedSignal = playbackEndedSignal,
            )
        }
    }

    override fun onAudioSessionIdChanged(audioSessionId: Int) {
        if (audioSessionId != C.AUDIO_SESSION_ID_UNSET) {
            recreateEqualizer(audioSessionId)
        }
    }

    override fun onPlayerError(error: PlaybackException) {
        _state.update {
            it.copy(
                isPlaying = false,
                isBuffering = false,
                errorMessage = error.localizedMessage ?: "播放失败",
            )
        }
    }
}
