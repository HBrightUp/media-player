package com.hml.mediaplayer.playback

import android.content.Context
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

data class AudioPlayerState(
    val currentTrack: Track? = null,
    val isPlaying: Boolean = false,
    val isBuffering: Boolean = false,
    val durationMs: Long = 0L,
    val bufferedPositionMs: Long = 0L,
    val errorMessage: String? = null,
)

class AndroidAudioPlayer(context: Context) : Player.Listener {
    private val appContext = context.applicationContext
    private var player: ExoPlayer? = createPlayer()

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

    fun releasePlaybackResources() {
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
            it.addListener(this)
        }
    }

    override fun onIsPlayingChanged(isPlaying: Boolean) {
        _state.update { it.copy(isPlaying = isPlaying) }
    }

    override fun onPlaybackStateChanged(playbackState: Int) {
        _state.update {
            it.copy(
                isBuffering = playbackState == Player.STATE_BUFFERING,
                durationMs = durationMs(),
                bufferedPositionMs = bufferedPositionMs(),
            )
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
