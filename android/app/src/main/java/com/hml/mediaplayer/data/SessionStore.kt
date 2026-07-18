package com.hml.mediaplayer.data

import android.content.Context
import android.os.Build
import com.hml.mediaplayer.BuildConfig
import java.util.UUID

class SessionStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("hml_android_session", Context.MODE_PRIVATE)

    var apiBaseUrl: String
        get() = prefs.getString(KEY_API_BASE_URL, null)?.trimEnd('/') ?: BuildConfig.API_BASE_URL.trimEnd('/')
        set(value) {
            prefs.edit().putString(KEY_API_BASE_URL, value.trim().trimEnd('/')).apply()
        }

    var authToken: String
        get() = prefs.getString(KEY_AUTH_TOKEN, "") ?: ""
        set(value) {
            prefs.edit().putString(KEY_AUTH_TOKEN, value.trim()).apply()
        }

    val deviceId: String
        get() = prefs.getString(KEY_DEVICE_ID, null) ?: "android-${UUID.randomUUID()}".also {
            prefs.edit().putString(KEY_DEVICE_ID, it).apply()
        }

    val tabId: String
        get() = prefs.getString(KEY_TAB_ID, null) ?: "app-${UUID.randomUUID()}".also {
            prefs.edit().putString(KEY_TAB_ID, it).apply()
        }

    val deviceName: String
        get() = listOf(Build.MANUFACTURER, Build.MODEL)
            .joinToString(" ")
            .replace(Regex("\\s+"), " ")
            .trim()
            .ifBlank { "Android APP" }

    fun clearAuth() {
        prefs.edit().remove(KEY_AUTH_TOKEN).apply()
    }

    companion object {
        private const val KEY_API_BASE_URL = "api_base_url"
        private const val KEY_AUTH_TOKEN = "auth_token"
        private const val KEY_DEVICE_ID = "device_id"
        private const val KEY_TAB_ID = "tab_id"
    }
}
