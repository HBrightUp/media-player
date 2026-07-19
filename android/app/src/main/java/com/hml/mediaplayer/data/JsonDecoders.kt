package com.hml.mediaplayer.data

import org.json.JSONArray
import org.json.JSONObject

internal object JsonDecoders {
    fun authResult(payload: JSONObject): AuthResult {
        return AuthResult(
            user = authUser(payload.getJSONObject("user")),
            token = payload.optNullableString("token"),
            expiresAt = payload.optNullableString("expires_at"),
        )
    }

    fun authUser(payload: JSONObject): AuthUser {
        return AuthUser(
            id = payload.optLong("id"),
            phone = payload.optString("phone"),
            countryCode = payload.optString("country_code"),
            nickname = payload.optString("nickname"),
            role = UserRole.fromApi(payload.optString("role")),
            createdAt = payload.optString("created_at"),
        )
    }

    fun tracks(payload: JSONObject): List<Track> {
        return payload.optJSONArray("tracks").orEmpty().mapObjects { track(it) }
    }

    fun favoriteCategories(payload: JSONObject): List<FavoriteCategory> {
        return payload.optJSONArray("categories").orEmpty().mapObjects { favoriteCategory(it) }
    }

    fun favoriteCategory(payload: JSONObject): FavoriteCategory {
        return FavoriteCategory(
            id = payload.optLong("id"),
            userId = payload.optLong("user_id"),
            name = payload.optString("name"),
            sortOrder = payload.optInt("sort_order"),
            createdAt = payload.optString("created_at"),
            updatedAt = payload.optString("updated_at"),
        )
    }

    fun trackMemberships(payload: JSONObject): TrackMemberships {
        val favoriteTrackIds = payload.optJSONArray("favorite_track_ids").orEmpty().mapLongs().toSet()
        val categoryMemberships = payload.optJSONArray("category_memberships").orEmpty().mapObjects {
            TrackCategoryMembership(
                trackId = it.optLong("track_id"),
                categoryId = it.optLong("category_id"),
                categoryName = it.optString("category_name"),
            )
        }
        return TrackMemberships(
            favoriteTrackIds = favoriteTrackIds,
            categoryMemberships = categoryMemberships,
        )
    }

    fun track(payload: JSONObject): Track {
        return Track(
            id = payload.optLong("id"),
            relativePath = payload.optString("relative_path"),
            filename = payload.optString("filename"),
            title = payload.optString("title").ifBlank { payload.optString("filename") },
            artist = payload.optString("artist").ifBlank { "未知歌手" },
            album = payload.optString("album"),
            format = payload.optString("format"),
            quality = TrackQuality.fromApi(payload.optString("quality")),
            sizeBytes = payload.optLong("size_bytes"),
            durationSeconds = payload.optNullableDouble("duration_seconds"),
            modifiedAt = payload.optString("modified_at"),
            streamUrl = payload.optString("stream_url"),
            coverUrl = payload.optNullableString("cover_url"),
        )
    }

    fun trackLyrics(payload: JSONObject): TrackLyrics {
        return TrackLyrics(
            trackId = payload.optLong("track_id"),
            format = payload.optString("format").ifBlank { "plain" },
            content = payload.optString("content"),
            lines = payload.optJSONArray("lines").orEmpty().mapObjects { lyricLine(it) },
            source = payload.optString("source"),
            updatedAt = payload.optNullableString("updated_at"),
        )
    }

    fun playbackSession(payload: JSONObject): PlaybackSession {
        return PlaybackSession(
            token = payload.optString("token"),
            expiresAt = payload.optString("expires_at"),
            state = payload.optString("state"),
            trackId = payload.optLong("track_id"),
            streamTicket = payload.optNullableString("stream_ticket"),
            streamTicketExpiresAt = payload.optNullableString("stream_ticket_expires_at"),
        )
    }

    private fun lyricLine(payload: JSONObject): LyricLine {
        return LyricLine(
            timeSeconds = payload.optNullableDouble("time_seconds"),
            text = payload.optString("text"),
            words = payload.optJSONArray("words").orEmpty().mapObjects { lyricWord(it) },
        )
    }

    private fun lyricWord(payload: JSONObject): LyricWord {
        return LyricWord(
            text = payload.optString("text"),
            startSeconds = payload.optDouble("start_seconds"),
            endSeconds = payload.optDouble("end_seconds"),
        )
    }
}

private fun JSONArray?.orEmpty(): JSONArray {
    return this ?: JSONArray()
}

private fun <T> JSONArray.mapObjects(transform: (JSONObject) -> T): List<T> {
    val values = ArrayList<T>(length())
    for (index in 0 until length()) {
        values += transform(getJSONObject(index))
    }
    return values
}

private fun JSONArray.mapLongs(): List<Long> {
    val values = ArrayList<Long>(length())
    for (index in 0 until length()) {
        values += optLong(index)
    }
    return values
}

internal fun JSONObject.optNullableString(name: String): String? {
    if (!has(name) || isNull(name)) {
        return null
    }
    return optString(name).takeIf { it.isNotBlank() }
}

internal fun JSONObject.optNullableDouble(name: String): Double? {
    if (!has(name) || isNull(name)) {
        return null
    }
    return optDouble(name)
}
