package com.hml.mediaplayer.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

class ApiException(message: String, val status: Int) : Exception(message)

class MediaPlayerApi(private val sessionStore: SessionStore) {
    suspend fun login(phone: String, password: String): AuthResult {
        val body = JSONObject()
            .put("phone", phone.trim())
            .put("password", password)
        return JsonDecoders.authResult(requestJson("/api/auth/login", method = "POST", body = body, timeoutMs = AUTH_TIMEOUT_MS))
    }

    suspend fun logout() {
        requestJson("/api/auth/logout", method = "POST", body = JSONObject(), timeoutMs = AUTH_TIMEOUT_MS)
    }

    suspend fun currentUser(): AuthUser {
        val payload = requestJson("/api/auth/me", timeoutMs = AUTH_TIMEOUT_MS)
        return JsonDecoders.authUser(payload.getJSONObject("user"))
    }

    suspend fun tracks(quality: TrackQuality): List<Track> {
        val query = URLEncoder.encode(quality.apiValue, Charsets.UTF_8.name())
        return JsonDecoders.tracks(requestJson("/api/tracks?quality=$query"))
    }

    suspend fun favoriteTracks(userId: Long, categoryId: Long? = null): List<Track> {
        val categoryQuery = categoryId?.let { "&category_id=$it" }.orEmpty()
        return JsonDecoders.tracks(requestJson("/api/favorites?user_id=$userId$categoryQuery"))
    }

    suspend fun trackMemberships(userId: Long): TrackMemberships {
        return JsonDecoders.trackMemberships(requestJson("/api/track-memberships?user_id=$userId"))
    }

    suspend fun addFavoriteTrack(userId: Long, trackId: Long) {
        requestJson(
            "/api/favorites",
            method = "POST",
            body = JSONObject()
                .put("user_id", userId)
                .put("track_id", trackId),
        )
    }

    suspend fun removeFavoriteTrack(userId: Long, trackId: Long) {
        requestJson("/api/favorites/$trackId?user_id=$userId", method = "DELETE")
    }

    suspend fun favoriteCategories(userId: Long): List<FavoriteCategory> {
        return JsonDecoders.favoriteCategories(requestJson("/api/favorite-categories?user_id=$userId"))
    }

    suspend fun createFavoriteCategory(userId: Long, name: String): FavoriteCategory {
        val payload = requestJson(
            "/api/favorite-categories",
            method = "POST",
            body = JSONObject()
                .put("user_id", userId)
                .put("name", name),
        )
        return JsonDecoders.favoriteCategory(payload.getJSONObject("category"))
    }

    suspend fun renameFavoriteCategory(userId: Long, categoryId: Long, name: String): FavoriteCategory {
        val payload = requestJson(
            "/api/favorite-categories/$categoryId",
            method = "POST",
            body = JSONObject()
                .put("user_id", userId)
                .put("name", name),
        )
        return JsonDecoders.favoriteCategory(payload.getJSONObject("category"))
    }

    suspend fun deleteFavoriteCategory(userId: Long, categoryId: Long) {
        requestJson("/api/favorite-categories/$categoryId?user_id=$userId", method = "DELETE")
    }

    suspend fun addFavoriteTrackToCategory(userId: Long, categoryId: Long, trackId: Long) {
        requestJson(
            "/api/favorite-categories/$categoryId/tracks",
            method = "POST",
            body = JSONObject()
                .put("user_id", userId)
                .put("track_id", trackId),
        )
    }

    suspend fun removeFavoriteTrackFromCategory(userId: Long, categoryId: Long, trackId: Long) {
        requestJson(
            "/api/favorite-categories/$categoryId/tracks/$trackId?user_id=$userId",
            method = "DELETE",
        )
    }

    suspend fun lyrics(trackId: Long): TrackLyrics {
        return JsonDecoders.trackLyrics(lyricsPayload(trackId))
    }

    suspend fun lyricsPayload(trackId: Long): JSONObject {
        return requestJson("/api/tracks/$trackId/lyrics")
    }

    suspend fun claimPlaybackSession(trackId: Long): PlaybackSession {
        val body = JSONObject()
            .put("track_id", trackId)
            .put("device_id", sessionStore.deviceId)
            .put("tab_id", sessionStore.tabId)
            .put("device_name", sessionStore.deviceName)
        return JsonDecoders.playbackSession(
            requestJson("/api/playback/session", method = "POST", body = body, timeoutMs = AUTH_TIMEOUT_MS),
        )
    }

    suspend fun heartbeatPlaybackSession(token: String, trackId: Long?, state: String): PlaybackSession {
        val body = JSONObject()
            .put("token", token)
            .put("device_id", sessionStore.deviceId)
            .put("tab_id", sessionStore.tabId)
            .put("state", state)
        if (trackId != null) {
            body.put("track_id", trackId)
        }
        return JsonDecoders.playbackSession(
            requestJson("/api/playback/heartbeat", method = "POST", body = body, timeoutMs = AUTH_TIMEOUT_MS),
        )
    }

    suspend fun releasePlaybackSession(token: String) {
        requestJson(
            "/api/playback/release",
            method = "POST",
            body = JSONObject().put("token", token),
            timeoutMs = AUTH_TIMEOUT_MS,
        )
    }

    fun absoluteUrl(pathOrUrl: String): String {
        if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
            return pathOrUrl
        }
        val path = if (pathOrUrl.startsWith("/")) pathOrUrl else "/$pathOrUrl"
        return "${sessionStore.apiBaseUrl}$path"
    }

    fun coverUrl(track: Track): String? {
        return track.coverUrl?.let { absoluteUrl(it) }
    }

    fun streamUrl(track: Track, streamTicket: String?): String {
        val base = absoluteUrl(track.streamUrl)
        val ticket = streamTicket?.trim()
        if (ticket.isNullOrBlank()) {
            return base
        }
        val encoded = URLEncoder.encode(ticket, Charsets.UTF_8.name())
        val separator = if (base.contains("?")) "&" else "?"
        return "$base${separator}stream_ticket=$encoded"
    }

    suspend fun downloadToFile(absoluteUrl: String, outputFile: File, onProgress: (downloadedBytes: Long, totalBytes: Long?) -> Unit) {
        withContext(Dispatchers.IO) {
            val connection = openConnection(absoluteUrl, timeoutMs = DOWNLOAD_TIMEOUT_MS)
            connection.requestMethod = "GET"
            val status = connection.responseCode
            if (status !in 200..299) {
                throw apiError(connection, status)
            }
            val totalBytes = connection.contentLengthLong.takeIf { it >= 0L }
            var downloaded = 0L
            connection.inputStream.use { input ->
                outputFile.outputStream().use { output ->
                    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) {
                            break
                        }
                        output.write(buffer, 0, count)
                        downloaded += count
                        onProgress(downloaded, totalBytes)
                    }
                }
            }
        }
    }

    private suspend fun requestJson(
        path: String,
        method: String = "GET",
        body: JSONObject? = null,
        timeoutMs: Int = REQUEST_TIMEOUT_MS,
    ): JSONObject {
        return withContext(Dispatchers.IO) {
            val connection = openConnection(absoluteUrl(path), timeoutMs)
            connection.requestMethod = method
            connection.setRequestProperty("Accept", "application/json")
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                val bytes = body.toString().toByteArray(Charsets.UTF_8)
                connection.setRequestProperty("Content-Length", bytes.size.toString())
                connection.outputStream.use { it.write(bytes) }
            }

            val status = connection.responseCode
            if (status !in 200..299) {
                throw apiError(connection, status)
            }
            val text = connection.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
            if (text.isBlank()) {
                JSONObject()
            } else {
                JSONObject(text)
            }
        }
    }

    private fun openConnection(absoluteUrl: String, timeoutMs: Int): HttpURLConnection {
        val connection = URL(absoluteUrl).openConnection() as HttpURLConnection
        connection.connectTimeout = timeoutMs
        connection.readTimeout = timeoutMs
        val token = sessionStore.authToken
        if (token.isNotBlank()) {
            connection.setRequestProperty("Authorization", "Bearer $token")
        }
        return connection
    }

    private fun apiError(connection: HttpURLConnection, status: Int): ApiException {
        val errorBody = runCatching {
            (connection.errorStream ?: connection.inputStream)
                .bufferedReader(Charsets.UTF_8)
                .use { it.readText() }
        }.getOrDefault("")
        val message = runCatching {
            JSONObject(errorBody).optString("error")
        }.getOrNull()?.takeIf { it.isNotBlank() } ?: "请求失败（HTTP $status）"
        return ApiException(message, status)
    }

    companion object {
        private const val REQUEST_TIMEOUT_MS = 30_000
        private const val AUTH_TIMEOUT_MS = 12_000
        private const val DOWNLOAD_TIMEOUT_MS = 30 * 60_000
    }
}
