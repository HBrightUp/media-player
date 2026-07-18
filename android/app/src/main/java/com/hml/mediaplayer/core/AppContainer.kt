package com.hml.mediaplayer.core

import android.content.Context
import com.hml.mediaplayer.data.MediaPlayerApi
import com.hml.mediaplayer.data.MusicRepository
import com.hml.mediaplayer.data.SessionStore
import com.hml.mediaplayer.data.TrackCacheManager

class AppContainer(context: Context) {
    private val appContext = context.applicationContext

    val sessionStore = SessionStore(appContext)
    val api = MediaPlayerApi(sessionStore)
    val cacheManager = TrackCacheManager(appContext)
    val musicRepository = MusicRepository(api, sessionStore, cacheManager)
}
