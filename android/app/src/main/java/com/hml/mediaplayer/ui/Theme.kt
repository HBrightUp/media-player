package com.hml.mediaplayer.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val HmlDarkColors = darkColorScheme(
    primary = Color(0xFF9DE5FF),
    onPrimary = Color(0xFF06223E),
    secondary = Color(0xFF73B1DA),
    background = Color(0xFF071A30),
    surface = Color(0xFF09264C),
    surfaceVariant = Color(0xFF0C365C),
    onBackground = Color(0xFFEAF6FF),
    onSurface = Color(0xFFF3FAFF),
    onSurfaceVariant = Color(0xFFC5D8E8),
)

@Composable
fun HmlMusicTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = HmlDarkColors,
        typography = Typography(),
        content = content,
    )
}
