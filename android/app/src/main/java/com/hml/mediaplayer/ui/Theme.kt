package com.hml.mediaplayer.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val HmlDarkColors = darkColorScheme(
    primary = Color(0xFF9DE5FF),
    onPrimary = Color(0xFF06223E),
    secondary = Color(0xFFB7EAF0),
    background = Color(0xFF2B5A70),
    surface = Color(0xFF1D445B),
    surfaceVariant = Color(0xFF4A7587),
    onBackground = Color(0xFFEAF6FF),
    onSurface = Color(0xFFF3FAFF),
    onSurfaceVariant = Color(0xFFDCEBFF),
)

@Composable
fun HmlMusicTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = HmlDarkColors,
        typography = Typography(),
        content = content,
    )
}
