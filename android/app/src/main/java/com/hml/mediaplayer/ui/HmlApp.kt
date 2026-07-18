package com.hml.mediaplayer.ui

import android.graphics.BitmapFactory
import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.zIndex
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.hml.mediaplayer.BuildConfig
import com.hml.mediaplayer.R
import com.hml.mediaplayer.data.AuthUser
import com.hml.mediaplayer.data.LyricLine
import com.hml.mediaplayer.data.Track
import com.hml.mediaplayer.data.TrackCacheManager
import com.hml.mediaplayer.data.TrackQuality
import com.hml.mediaplayer.data.isLosslessFlac
import com.hml.mediaplayer.viewmodel.HomeTab
import com.hml.mediaplayer.viewmodel.PlayerUiState
import com.hml.mediaplayer.viewmodel.PlayerViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL
import kotlin.math.roundToInt

@Composable
fun HmlApp(viewModel: PlayerViewModel) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    HmlMusicTheme {
        Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            if (state.user == null) {
                LoginScreen(
                    state = state,
                    onApiBaseUrlChange = viewModel::updateApiBaseUrl,
                    onLogin = viewModel::login,
                    onDismissError = viewModel::clearError,
                )
            } else {
                MainScaffold(
                    state = state,
                    viewModel = viewModel,
                )
            }
        }
    }
}

@Composable
private fun LoginScreen(
    state: PlayerUiState,
    onApiBaseUrlChange: (String) -> Unit,
    onLogin: (String, String) -> Unit,
    onDismissError: () -> Unit,
) {
    var phone by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var apiBaseUrl by rememberSaveable(state.apiBaseUrl) { mutableStateOf(state.apiBaseUrl) }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    listOf(Color(0xFF08233F), Color(0xFF050B14)),
                ),
            )
            .padding(24.dp),
        contentAlignment = Alignment.Center,
    ) {
        ElevatedCard(
            colors = CardDefaults.elevatedCardColors(containerColor = Color(0xCC0B1B2E)),
            shape = RoundedCornerShape(28.dp),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(
                modifier = Modifier.padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Text("登录账号", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Black)
                Text("连接你的私人音乐服务。", color = MaterialTheme.colorScheme.onSurfaceVariant)
                OutlinedTextField(
                    value = apiBaseUrl,
                    onValueChange = {
                        apiBaseUrl = it
                        onApiBaseUrlChange(it)
                    },
                    label = { Text("服务地址") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = phone,
                    onValueChange = { phone = it },
                    label = { Text("手机号") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    label = { Text("密码") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Button(
                    onClick = { onLogin(phone, password) },
                    enabled = !state.isLoading && phone.isNotBlank() && password.isNotBlank(),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    if (state.isLoading) {
                        CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                    } else {
                        Text("登录")
                    }
                }
            }
        }
    }

    ErrorDialog(message = state.errorMessage, onDismiss = onDismissError)
}

@Composable
private fun MainScaffold(state: PlayerUiState, viewModel: PlayerViewModel) {
    var bottomTabsVisible by rememberSaveable { mutableStateOf(false) }
    var profilePage by rememberSaveable { mutableStateOf(ProfilePage.HOME) }
    val lyricsControlsBottomOffset by animateDpAsState(
        targetValue = if (bottomTabsVisible) 104.dp else 42.dp,
        animationSpec = tween(durationMillis = 220),
        label = "lyrics-controls-bottom-offset",
    )
    val lyricsContentBottomPadding by animateDpAsState(
        targetValue = if (bottomTabsVisible) 300.dp else 220.dp,
        animationSpec = tween(durationMillis = 220),
        label = "lyrics-content-bottom-padding",
    )
    val bottomContentClearance by animateDpAsState(
        targetValue = if (bottomTabsVisible) 110.dp else 0.dp,
        animationSpec = tween(durationMillis = 220),
        label = "bottom-content-clearance",
    )
    val revealBottomTabs = { bottomTabsVisible = true }

    LaunchedEffect(bottomTabsVisible, state.selectedTab, state.currentTrack?.id, state.isPlaying) {
        if (bottomTabsVisible) {
            delay(if (state.selectedTab == HomeTab.LYRICS) 2800L else 4200L)
            bottomTabsVisible = false
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
    ) {
        Scaffold(
            containerColor = Color.Transparent,
        ) { padding ->
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .padding(bottom = if (state.selectedTab == HomeTab.LYRICS) 0.dp else bottomContentClearance),
            ) {
                Box(modifier = Modifier.weight(1f)) {
                    when (state.selectedTab) {
                        HomeTab.LIBRARY -> LibraryScreen(state = state, viewModel = viewModel)
                        HomeTab.LYRICS -> {
                            LyricsScreen(
                                state = state,
                                viewModel = viewModel,
                                lyricsBottomPadding = lyricsContentBottomPadding,
                            )
                            LyricsPlaybackControls(
                                state = state,
                                viewModel = viewModel,
                                modifier = Modifier
                                    .align(Alignment.BottomCenter)
                                    .padding(bottom = lyricsControlsBottomOffset),
                            )
                        }
                        HomeTab.PROFILE -> ProfileScreen(
                            state = state,
                            viewModel = viewModel,
                            page = profilePage,
                            onPageChange = { profilePage = it },
                        )
                    }
                }
            }
        }

        FloatingBottomTabs(
            selectedTab = state.selectedTab,
            visible = bottomTabsVisible,
            onReveal = revealBottomTabs,
            onSelect = { tab ->
                revealBottomTabs()
                if (tab == HomeTab.PROFILE) {
                    profilePage = ProfilePage.HOME
                }
                viewModel.selectTab(tab)
            },
            modifier = Modifier.align(Alignment.BottomCenter),
        )
    }

    ErrorDialog(message = state.errorMessage, onDismiss = viewModel::clearError)
}

private val bottomTabs = listOf(HomeTab.LIBRARY, HomeTab.LYRICS, HomeTab.PROFILE)

@Composable
private fun FloatingBottomTabs(
    selectedTab: HomeTab,
    visible: Boolean,
    onReveal: () -> Unit,
    onSelect: (HomeTab) -> Unit,
    modifier: Modifier = Modifier,
) {
    val tabHeight = if (visible) 78.dp else 38.dp
    val containerModifier = modifier
        .fillMaxWidth()
        .zIndex(100f)
        .navigationBarsPadding()
        .padding(start = 24.dp, end = 24.dp, bottom = 16.dp)

    Box(
        modifier = containerModifier,
        contentAlignment = Alignment.BottomCenter,
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(tabHeight),
            contentAlignment = Alignment.BottomCenter,
        ) {
        if (!visible) {
            Box(
                modifier = Modifier
                    .width(156.dp)
                    .height(34.dp)
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                        onClick = onReveal,
                    )
                    .clip(RoundedCornerShape(999.dp))
                    .background(
                        Brush.verticalGradient(
                            listOf(
                                Color(0x1A1B5D86),
                                Color(0x08091E37),
                            ),
                        ),
                    )
                    .border(1.dp, Color(0x22BEEBFF), RoundedCornerShape(999.dp)),
                contentAlignment = Alignment.Center,
            ) {
                Box(
                    modifier = Modifier
                        .width(82.dp)
                        .height(5.dp)
                        .clip(RoundedCornerShape(999.dp))
                        .background(
                            Brush.horizontalGradient(
                                listOf(
                                    Color.Transparent,
                                    Color(0xBFE8FBFF),
                                    Color.Transparent,
                                ),
                            ),
                        ),
                )
            }
        } else {
            Row(
                modifier = Modifier
                    .widthIn(min = 286.dp, max = 360.dp)
                    .alpha(1f)
                    .clip(RoundedCornerShape(24.dp))
                    .background(
                        Brush.linearGradient(
                            listOf(
                                Color(0xEE0C365C),
                                Color(0xEC09264C),
                                Color(0xF0061938),
                            ),
                        ),
                    )
                    .border(
                        width = 1.dp,
                        color = Color(0x42A9E8FF),
                        shape = RoundedCornerShape(24.dp),
                    )
                    .padding(horizontal = 12.dp, vertical = 7.dp),
                horizontalArrangement = Arrangement.SpaceEvenly,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                bottomTabs.forEach { tab ->
                    FloatingBottomTabButton(
                        tab = tab,
                        selected = selectedTab == tab && visible,
                        onClick = {
                            onReveal()
                            onSelect(tab)
                        },
                    )
                }
            }
        }
        }
    }
}

@Composable
private fun FloatingBottomTabButton(
    tab: HomeTab,
    selected: Boolean,
    onClick: () -> Unit,
) {
    val shape = RoundedCornerShape(18.dp)
    val activeBrush = Brush.radialGradient(
        colors = listOf(
            Color(0x52FF78B6),
            Color(0x3327C7FF),
            Color.Transparent,
        ),
    )

    Box(
        modifier = Modifier
            .width(78.dp)
            .height(62.dp)
            .clip(shape)
            .background(if (selected) activeBrush else Brush.verticalGradient(listOf(Color.Transparent, Color.Transparent)))
            .border(
                width = if (selected) 1.dp else 0.dp,
                color = if (selected) Color(0x55BEEBFF) else Color.Transparent,
                shape = shape,
            )
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onClick,
            ),
        contentAlignment = Alignment.Center,
    ) {
        VividPageIcon(
            tab = tab,
            active = selected,
            modifier = Modifier.size(48.dp),
        )
    }
}

@Composable
private fun VividPageIcon(
    tab: HomeTab,
    active: Boolean,
    modifier: Modifier = Modifier,
) {
    val lineColor = if (active) Color(0xFFF2FCFF) else Color(0xBCC5DDEA)
    val accentColor = when (tab) {
        HomeTab.LIBRARY -> Color(0xFF86E5FF)
        HomeTab.LYRICS -> Color(0xFFFF84B8)
        HomeTab.PROFILE -> Color(0xFF9DE5FF)
    }
    val haloColor = if (active) accentColor.copy(alpha = 0.32f) else Color(0x1A9DE5FF)

    Canvas(modifier = modifier) {
        val w = size.width
        val h = size.height
        val strokeWidth = if (active) w * 0.075f else w * 0.062f
        val stroke = Stroke(
            width = strokeWidth,
            cap = StrokeCap.Round,
            join = StrokeJoin.Round,
        )

        drawRoundRect(
            color = haloColor,
            topLeft = Offset(w * 0.11f, h * 0.11f),
            size = Size(w * 0.78f, h * 0.78f),
            cornerRadius = CornerRadius(w * 0.22f, h * 0.22f),
        )

        when (tab) {
            HomeTab.LIBRARY -> {
                drawRoundRect(
                    color = accentColor.copy(alpha = if (active) 0.22f else 0.12f),
                    topLeft = Offset(w * 0.20f, h * 0.18f),
                    size = Size(w * 0.60f, h * 0.62f),
                    cornerRadius = CornerRadius(w * 0.14f, h * 0.14f),
                    style = stroke,
                )
                drawCircle(
                    color = lineColor,
                    radius = w * 0.085f,
                    center = Offset(w * 0.40f, h * 0.60f),
                    style = stroke,
                )
                drawLine(
                    color = lineColor,
                    start = Offset(w * 0.50f, h * 0.59f),
                    end = Offset(w * 0.50f, h * 0.30f),
                    strokeWidth = strokeWidth,
                    cap = StrokeCap.Round,
                )
                drawLine(
                    color = lineColor,
                    start = Offset(w * 0.50f, h * 0.30f),
                    end = Offset(w * 0.68f, h * 0.25f),
                    strokeWidth = strokeWidth,
                    cap = StrokeCap.Round,
                )
                drawLine(
                    color = accentColor.copy(alpha = if (active) 0.95f else 0.58f),
                    start = Offset(w * 0.30f, h * 0.76f),
                    end = Offset(w * 0.70f, h * 0.76f),
                    strokeWidth = strokeWidth * 0.72f,
                    cap = StrokeCap.Round,
                )
            }

            HomeTab.LYRICS -> {
                drawRoundRect(
                    color = accentColor.copy(alpha = if (active) 0.24f else 0.12f),
                    topLeft = Offset(w * 0.20f, h * 0.16f),
                    size = Size(w * 0.60f, h * 0.68f),
                    cornerRadius = CornerRadius(w * 0.13f, h * 0.13f),
                    style = stroke,
                )
                drawLine(
                    color = lineColor,
                    start = Offset(w * 0.34f, h * 0.34f),
                    end = Offset(w * 0.66f, h * 0.34f),
                    strokeWidth = strokeWidth * 0.76f,
                    cap = StrokeCap.Round,
                )
                drawLine(
                    color = lineColor.copy(alpha = 0.82f),
                    start = Offset(w * 0.34f, h * 0.48f),
                    end = Offset(w * 0.62f, h * 0.48f),
                    strokeWidth = strokeWidth * 0.76f,
                    cap = StrokeCap.Round,
                )
                val wave = Path().apply {
                    moveTo(w * 0.28f, h * 0.66f)
                    cubicTo(w * 0.36f, h * 0.54f, w * 0.44f, h * 0.78f, w * 0.52f, h * 0.66f)
                    cubicTo(w * 0.60f, h * 0.54f, w * 0.68f, h * 0.78f, w * 0.76f, h * 0.64f)
                }
                drawPath(
                    path = wave,
                    color = if (active) Color(0xFFFFF3B0) else accentColor.copy(alpha = 0.78f),
                    style = stroke,
                )
            }

            HomeTab.PROFILE -> {
                drawCircle(
                    color = accentColor.copy(alpha = if (active) 0.24f else 0.12f),
                    radius = w * 0.31f,
                    center = Offset(w * 0.50f, h * 0.50f),
                    style = stroke,
                )
                drawCircle(
                    color = lineColor,
                    radius = w * 0.115f,
                    center = Offset(w * 0.50f, h * 0.38f),
                    style = stroke,
                )
                val shoulders = Path().apply {
                    moveTo(w * 0.26f, h * 0.75f)
                    cubicTo(w * 0.32f, h * 0.58f, w * 0.68f, h * 0.58f, w * 0.74f, h * 0.75f)
                }
                drawPath(
                    path = shoulders,
                    color = lineColor,
                    style = stroke,
                )
            }
        }
    }
}

@Composable
private fun LibraryScreen(state: PlayerUiState, viewModel: PlayerViewModel) {
    var actionTrack by remember { mutableStateOf<Track?>(null) }
    val authToken = viewModel.authToken()

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(webBlueGradient()),
    ) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 18.dp, top = 16.dp, end = 18.dp, bottom = 22.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            item {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = 8.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        TrackQuality.entries.forEach { quality ->
                            AssistChip(
                                onClick = { viewModel.selectQuality(quality) },
                                label = { Text(quality.label) },
                                leadingIcon = if (state.quality == quality) {
                                    { Icon(Icons.Default.MusicNote, contentDescription = null, modifier = Modifier.size(18.dp)) }
                                } else {
                                    null
                                },
                            )
                        }
                    }
                    if (state.isLoading) {
                        CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 3.dp)
                    }
                }
            }
            items(state.tracks, key = { it.id }) { track ->
                TrackRow(
                    track = track,
                    coverUrl = viewModel.coverUrl(track),
                    authToken = authToken,
                    isCurrent = state.currentTrack?.id == track.id,
                    onPlay = { viewModel.playTrack(track) },
                    onMore = { actionTrack = track },
                )
            }
        }
    }

    actionTrack?.let { track ->
        TrackActionsDialog(
            track = track,
            isCaching = state.cachingTrackId == track.id,
            cacheProgress = state.cacheProgress,
            canCache = state.canCacheMoreMusic,
            onCache = {
                viewModel.cacheTrack(track)
                actionTrack = null
            },
            onDismiss = { actionTrack = null },
        )
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun TrackRow(
    track: Track,
    coverUrl: String?,
    authToken: String,
    isCurrent: Boolean,
    onPlay: () -> Unit,
    onMore: () -> Unit,
) {
    Surface(
        color = if (isCurrent) Color(0x3339A4FF) else Color.Transparent,
        shape = RoundedCornerShape(22.dp),
        modifier = Modifier
            .fillMaxWidth()
            .combinedClickable(
                onClick = onPlay,
                onLongClick = onMore,
            ),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val titleColor = if (isCurrent) Color.White else Color(0xFFF3FAFF)
            val artistColor = if (isCurrent) Color(0xFFD5F4FF) else Color(0xFFB9D2E6)
            RemoteCoverArt(
                url = coverUrl,
                token = authToken,
                maxImageSizePx = 192,
                modifier = Modifier
                    .size(58.dp)
                    .shadow(8.dp, RoundedCornerShape(16.dp), clip = false)
                    .clip(RoundedCornerShape(16.dp)),
            )
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(
                    text = track.title.ifBlank { "未知歌曲" },
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = if (isCurrent) FontWeight.Black else FontWeight.SemiBold,
                    color = titleColor,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = track.artist.ifBlank { "未知歌手" },
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Medium,
                    color = artistColor,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
private fun TrackActionsDialog(
    track: Track,
    isCaching: Boolean,
    cacheProgress: Float?,
    canCache: Boolean,
    onCache: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(track.title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(track.artist.ifBlank { "未知歌手" }, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (isCaching) {
                    LinearProgressIndicator(
                        progress = { cacheProgress ?: 0f },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        },
        confirmButton = {
            if (track.isLosslessFlac) {
                TextButton(onClick = onCache, enabled = !isCaching && canCache) {
                    Text(
                        when {
                            isCaching -> "缓存中"
                            !canCache -> "空间不足"
                            else -> "缓存到本机"
                        },
                    )
                }
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("关闭")
            }
        },
    )
}

@Composable
private fun LyricsScreen(
    state: PlayerUiState,
    viewModel: PlayerViewModel,
    lyricsBottomPadding: Dp,
) {
    val track = state.currentTrack
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    listOf(Color(0xFF0E3A5A), Color(0xFF071629), Color(0xFF040914)),
                ),
            )
            .padding(20.dp),
    ) {
        if (track == null) {
            EmptyState(title = "还没有播放歌曲", subtitle = "先到曲库选一首歌。")
            return@Box
        }
        Column(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(18.dp),
            ) {
                RemoteCoverArt(
                    url = viewModel.coverUrl(track),
                    token = viewModel.authToken(),
                    modifier = Modifier
                        .size(108.dp)
                        .clip(RoundedCornerShape(26.dp)),
                )
                Column(modifier = Modifier.weight(1f)) {
                    Text(track.title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Black, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Text(track.artist, color = Color(0xFFD7ECFF), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (state.sourceFromCache) {
                        Spacer(Modifier.height(8.dp))
                        AssistChip(
                            onClick = {},
                            label = { Text("本地 FLAC 缓存播放") },
                        )
                    }
                }
            }
            KaraokeLyrics(
                lines = state.currentLyrics?.lines.orEmpty(),
                positionSeconds = state.currentPositionMs / 1000.0,
                modifier = Modifier
                    .weight(1f)
                    .padding(bottom = lyricsBottomPadding),
            )
        }
    }
}

private fun webBlueGradient(): Brush {
    return Brush.verticalGradient(
        listOf(
            Color(0xFF081A37),
            Color(0xFF153E62),
            Color(0xFF071A30),
        ),
    )
}

@Composable
private fun KaraokeLyrics(lines: List<LyricLine>, positionSeconds: Double, modifier: Modifier = Modifier) {
    if (lines.isEmpty()) {
        EmptyState(title = "暂无歌词", subtitle = "服务器暂未返回这首歌的歌词。")
        return
    }

    val timedLines = lines.mapIndexedNotNull { index, line -> line.timeSeconds?.let { index to it } }
    val activeIndex = timedLines.lastOrNull { it.second <= positionSeconds }?.first ?: 0
    val firstVisibleIndex = (activeIndex - 4).coerceAtLeast(0)
    val lastVisibleIndexExclusive = (activeIndex + 5).coerceAtMost(lines.size)
    val visibleLines = lines.subList(firstVisibleIndex, lastVisibleIndexExclusive)

    Column(
        modifier = modifier
            .fillMaxWidth()
            .fillMaxHeight()
            .padding(top = 12.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterVertically),
    ) {
        visibleLines.forEachIndexed { offset, line ->
            val index = firstVisibleIndex + offset
            val isActive = index == activeIndex
            val distanceFromActive = kotlin.math.abs(index - activeIndex)
            Text(
                text = karaokeLineText(line, positionSeconds, isActive),
                style = if (isActive) MaterialTheme.typography.headlineSmall else MaterialTheme.typography.titleMedium,
                fontWeight = if (isActive) FontWeight.Black else FontWeight.Medium,
                color = if (isActive) Color.White else Color(0xFFB7D8F2),
                modifier = Modifier
                    .fillMaxWidth()
                    .alpha(if (distanceFromActive >= 4) 0.72f else 1f),
            )
        }
    }
}

private fun karaokeLineText(line: LyricLine, positionSeconds: Double, isActive: Boolean) = buildAnnotatedString {
    if (line.words.isEmpty()) {
        withStyle(SpanStyle(color = if (isActive) Color.White else Color(0xFFB7D8F2))) {
            append(line.text)
        }
        return@buildAnnotatedString
    }

    line.words.forEach { word ->
        val finished = positionSeconds >= word.endSeconds
        val active = positionSeconds in word.startSeconds..word.endSeconds
        val color = when {
            finished -> Color.White
            active -> Color(0xFFFFF7AD)
            isActive -> Color(0xFFD6ECFF)
            else -> Color(0xFF8FB6D2)
        }
        withStyle(SpanStyle(color = color)) {
            append(word.text)
        }
    }
}

@Composable
private fun ProfileScreen(
    state: PlayerUiState,
    viewModel: PlayerViewModel,
    page: ProfilePage,
    onPageChange: (ProfilePage) -> Unit,
) {
    BackHandler(enabled = page != ProfilePage.HOME) {
        onPageChange(ProfilePage.HOME)
    }

    when (page) {
        ProfilePage.HOME -> ProfileHomeScreen(
            state = state,
            onOpenSettings = { onPageChange(ProfilePage.SETTINGS) },
            onOpenAbout = { onPageChange(ProfilePage.ABOUT) },
        )
        ProfilePage.SETTINGS -> ProfileSettingsScreen(
            state = state,
            viewModel = viewModel,
            onBack = { onPageChange(ProfilePage.HOME) },
        )
        ProfilePage.ABOUT -> ProfileAboutScreen(
            onBack = { onPageChange(ProfilePage.HOME) },
        )
    }
}

private enum class ProfilePage {
    HOME,
    SETTINGS,
    ABOUT,
}

@Composable
private fun ProfileHomeScreen(
    state: PlayerUiState,
    onOpenSettings: () -> Unit,
    onOpenAbout: () -> Unit,
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        state.user?.let { user ->
            item {
                ProfileHeader(user = user)
            }
        }
        item {
            Card(
                shape = RoundedCornerShape(24.dp),
                colors = CardDefaults.cardColors(containerColor = Color(0xFF0A294B)),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column {
                    ProfileMenuItem(
                        icon = Icons.Default.Settings,
                        title = "设置",
                        description = "缓存、播放与账户设置",
                        onClick = onOpenSettings,
                    )
                    HorizontalDivider(
                        modifier = Modifier.padding(start = 68.dp, end = 16.dp),
                        color = Color(0x244DB0D6),
                    )
                    ProfileMenuItem(
                        icon = Icons.Default.Info,
                        title = "关于",
                        description = "版本与产品信息",
                        onClick = onOpenAbout,
                    )
                }
            }
        }
    }
}

@Composable
private fun ProfileMenuItem(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    description: String,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 15.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(40.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(Color(0x267BE7D5)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = Color(0xFF82E8D7),
                modifier = Modifier.size(22.dp),
            )
        }
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text(
                description,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Icon(
            imageVector = Icons.Default.ChevronRight,
            contentDescription = "进入$title",
            tint = Color(0xFF789AB5),
        )
    }
}

@Composable
private fun ProfileSettingsScreen(
    state: PlayerUiState,
    viewModel: PlayerViewModel,
    onBack: () -> Unit,
) {
    var showCacheManager by rememberSaveable { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        viewModel.refreshCacheStorageLimits()
    }

    Box(modifier = Modifier.fillMaxSize()) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 20.dp, top = 20.dp, end = 20.dp, bottom = 88.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            item { ProfileSubpageHeader(title = "设置", onBack = onBack) }
            item {
                CacheSettingsCard(
                    state = state,
                    viewModel = viewModel,
                    onManageMusicFiles = {
                        showCacheManager = true
                        viewModel.loadCachedMusicFiles()
                    },
                )
            }
            item {
                SleepTimerSettings(
                    state = state,
                    onStart = viewModel::startSleepTimer,
                    onStop = viewModel::stopSleepTimer,
                )
            }
        }
        TextButton(
            onClick = viewModel::logout,
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = 20.dp),
        ) {
            Text(
                text = "退出登录",
                fontWeight = FontWeight.Bold,
                style = MaterialTheme.typography.titleMedium,
            )
        }
    }

    if (showCacheManager) {
        CacheManagementDialog(
            state = state,
            onDismiss = { showCacheManager = false },
            onClearSelected = viewModel::removeCachedMusicFiles,
        )
    }
}

@Composable
private fun SleepTimerSettings(
    state: PlayerUiState,
    onStart: (Int) -> Unit,
    onStop: () -> Unit,
) {
    var minutesText by rememberSaveable(state.sleepTimerMinutes) {
        mutableStateOf(state.sleepTimerMinutes.toString())
    }
    val normalizedMinutes = minutesText.toIntOrNull()
        ?.takeIf { it >= 1 }
        ?.coerceAtMost(360)
    val remainingSeconds = state.sleepTimerRemainingSeconds
    val isRunning = remainingSeconds != null

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 4.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "睡眠定时器",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.weight(1f),
                maxLines = 1,
            )
            Box(
                modifier = Modifier
                    .width(58.dp)
                    .height(36.dp)
                    .clip(RoundedCornerShape(9.dp))
                    .background(Color(0x14FFFFFF)),
                contentAlignment = Alignment.Center,
            ) {
                BasicTextField(
                    value = minutesText,
                    onValueChange = { value ->
                        minutesText = value.filter(Char::isDigit).take(3)
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 8.dp),
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    textStyle = MaterialTheme.typography.titleMedium.copy(
                        color = Color(0xFFF1FBFF),
                        fontWeight = FontWeight.Bold,
                        textAlign = TextAlign.Center,
                    ),
                    cursorBrush = SolidColor(Color(0xFF76E7D5)),
                )
            }
            Text(
                text = "分钟",
                style = MaterialTheme.typography.bodySmall,
                color = Color(0xFFA9CCE1),
            )
            TextButton(
                onClick = {
                    if (isRunning) {
                        onStop()
                    } else {
                        normalizedMinutes?.let { minutes ->
                            minutesText = minutes.toString()
                            onStart(minutes)
                        }
                    }
                },
                enabled = isRunning || normalizedMinutes != null,
            ) {
                Text(
                    text = if (isRunning) "关闭定时器" else "开始",
                    color = if (isRunning) Color(0xFFFF9F99) else Color(0xFF84D0FF),
                    fontWeight = FontWeight.Bold,
                )
            }
        }
        if (remainingSeconds != null) {
            Text(
                text = "剩余 ${formatSleepTimerRemaining(remainingSeconds)} 后停止播放",
                style = MaterialTheme.typography.bodySmall,
                color = Color(0xFFB7D8F2),
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

@Composable
private fun CacheSettingsCard(
    state: PlayerUiState,
    viewModel: PlayerViewModel,
    onManageMusicFiles: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 4.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "音乐缓存数据",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.weight(1f),
                    maxLines = 1,
                )
                CompactCacheSlider(
                    value = state.cacheLimitGb.coerceAtLeast(1).toFloat(),
                    maxValue = state.maxCacheLimitGb.coerceAtLeast(1),
                    enabled = state.maxCacheLimitGb > 1,
                    onValueChange = {
                        val selectedGb = it.roundToInt()
                        if (selectedGb != state.cacheLimitGb) {
                            viewModel.setCacheLimitGb(selectedGb)
                        }
                    },
                )
                Surface(
                    color = Color(0x267DE8D6),
                    shape = RoundedCornerShape(999.dp),
                ) {
                    Text(
                        if (state.maxCacheLimitGb < 1) "空间不足" else "${state.cacheLimitGb}G",
                        color = Color(0xFF91EDDE),
                        style = MaterialTheme.typography.labelLarge,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(horizontal = 9.dp, vertical = 5.dp),
                    )
                }
            }
            TextButton(onClick = onManageMusicFiles) {
                Icon(Icons.Default.MusicNote, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text("管理音乐文件")
            }
    }
}

@Composable
private fun CacheManagementDialog(
    state: PlayerUiState,
    onDismiss: () -> Unit,
    onClearSelected: (Set<Long>) -> Unit,
) {
    var selectedTrackIds by remember { mutableStateOf(emptySet<Long>()) }
    val cachedTrackIds = state.cachedMusicFiles.mapTo(mutableSetOf()) { it.trackId }
    val allSelected = cachedTrackIds.isNotEmpty() && selectedTrackIds.containsAll(cachedTrackIds)
    val usageProgress = if (state.cacheStats.maxBytes > 0L) {
        (state.cacheStats.totalBytes.toDouble() / state.cacheStats.maxBytes).toFloat().coerceIn(0f, 1f)
    } else {
        0f
    }

    LaunchedEffect(cachedTrackIds) {
        selectedTrackIds = selectedTrackIds.intersect(cachedTrackIds)
    }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            modifier = Modifier
                .fillMaxWidth(0.92f)
                .fillMaxHeight(0.82f),
            shape = RoundedCornerShape(28.dp),
            color = Color(0xFF092641),
            tonalElevation = 8.dp,
        ) {
            Column(
                modifier = Modifier.padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "管理音乐文件",
                            style = MaterialTheme.typography.headlineSmall,
                            fontWeight = FontWeight.Black,
                        )
                    }
                    IconButton(onClick = onDismiss) {
                        Icon(
                            imageVector = Icons.Default.Close,
                            contentDescription = "关闭",
                            tint = Color(0xFFC8E8F7),
                        )
                    }
                }

                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = "${formatBytes(state.cacheStats.totalBytes)} / ${formatBytes(state.cacheStats.maxBytes)}",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold,
                        color = Color(0xFF93F0DE),
                    )
                    LinearProgressIndicator(
                        progress = { usageProgress },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(6.dp)
                            .clip(CircleShape),
                        color = Color(0xFF71E4D2),
                        trackColor = Color(0xFF234A65),
                    )
                    Row(modifier = Modifier.fillMaxWidth()) {
                        Text(
                            text = "当前缓存 ${formatBytes(state.cacheStats.totalBytes)}",
                            style = MaterialTheme.typography.bodySmall,
                            color = Color(0xFFA9CCE1),
                        )
                        Spacer(modifier = Modifier.weight(1f))
                        Text(
                            text = "容量 ${formatBytes(state.cacheStats.maxBytes)}",
                            style = MaterialTheme.typography.bodySmall,
                            color = Color(0xFFA9CCE1),
                        )
                    }
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = "缓存歌曲",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.weight(1f),
                    )
                    if (cachedTrackIds.isNotEmpty()) {
                        TextButton(
                            onClick = {
                                selectedTrackIds = if (allSelected) emptySet() else cachedTrackIds
                            },
                        ) {
                            Text(if (allSelected) "取消全选" else "全选")
                        }
                    }
                }

                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f),
                    contentAlignment = Alignment.Center,
                ) {
                    when {
                        state.isLoading && state.cachedMusicFiles.isEmpty() -> {
                            CircularProgressIndicator(color = Color(0xFF75E7D5))
                        }
                        state.cachedMusicFiles.isEmpty() -> {
                            Text(
                                text = "暂无缓存音乐",
                                color = Color(0xFF90B6CD),
                            )
                        }
                        else -> {
                            LazyColumn(modifier = Modifier.fillMaxSize()) {
                                items(
                                    items = state.cachedMusicFiles,
                                    key = { it.trackId },
                                ) { file ->
                                    val selected = file.trackId in selectedTrackIds
                                    Row(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .clickable {
                                                selectedTrackIds = if (selected) {
                                                    selectedTrackIds - file.trackId
                                                } else {
                                                    selectedTrackIds + file.trackId
                                                }
                                            }
                                            .padding(vertical = 10.dp),
                                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        Checkbox(
                                            checked = selected,
                                            onCheckedChange = { checked ->
                                                selectedTrackIds = if (checked) {
                                                    selectedTrackIds + file.trackId
                                                } else {
                                                    selectedTrackIds - file.trackId
                                                }
                                            },
                                        )
                                        Column(
                                            modifier = Modifier.weight(1f),
                                            verticalArrangement = Arrangement.spacedBy(2.dp),
                                        ) {
                                            Text(
                                                text = file.title,
                                                fontWeight = FontWeight.SemiBold,
                                                maxLines = 1,
                                                overflow = TextOverflow.Ellipsis,
                                            )
                                            Text(
                                                text = file.artist,
                                                style = MaterialTheme.typography.bodySmall,
                                                color = Color(0xFF9FC4DA),
                                                maxLines = 1,
                                                overflow = TextOverflow.Ellipsis,
                                            )
                                        }
                                        Text(
                                            text = formatBytes(file.sizeBytes),
                                            style = MaterialTheme.typography.labelMedium,
                                            color = Color(0xFF99D7CC),
                                        )
                                    }
                                }
                            }
                        }
                    }
                }

                Button(
                    onClick = {
                        val trackIds = selectedTrackIds
                        selectedTrackIds = emptySet()
                        onClearSelected(trackIds)
                    },
                    enabled = selectedTrackIds.isNotEmpty() && !state.isLoading,
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(16.dp),
                ) {
                    Text(
                        text = if (selectedTrackIds.isEmpty()) "清除" else "清除（${selectedTrackIds.size}）",
                        fontWeight = FontWeight.Bold,
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CompactCacheSlider(
    value: Float,
    maxValue: Int,
    enabled: Boolean,
    onValueChange: (Float) -> Unit,
) {
    val rangeEnd = maxValue.coerceAtLeast(2).toFloat()
    val sliderValue = value.coerceIn(1f, rangeEnd)
    val interactionSource = remember { MutableInteractionSource() }
    val pressed by interactionSource.collectIsPressedAsState()
    val thumbSize by animateDpAsState(
        targetValue = if (pressed) 18.dp else 14.dp,
        animationSpec = tween(durationMillis = 120),
        label = "cache-slider-thumb-size",
    )
    val colors = SliderDefaults.colors(
        thumbColor = Color.Transparent,
        activeTrackColor = Color.Transparent,
        inactiveTrackColor = Color.Transparent,
        activeTickColor = Color.Transparent,
        inactiveTickColor = Color.Transparent,
    )

    Slider(
        value = sliderValue,
        onValueChange = onValueChange,
        enabled = enabled,
        modifier = Modifier
            .width(104.dp)
            .height(32.dp)
            .alpha(if (enabled) 1f else 0.45f),
        valueRange = 1f..rangeEnd,
        steps = (rangeEnd.toInt() - 2).coerceAtLeast(0),
        interactionSource = interactionSource,
        colors = colors,
        thumb = {
            Box(
                modifier = Modifier
                    .size(thumbSize)
                    .clip(CircleShape)
                    .background(
                        Brush.linearGradient(
                            listOf(Color(0xFF77EAD7), Color(0xFF72A8FF)),
                        ),
                    ),
                contentAlignment = Alignment.Center,
            ) {
                Box(
                    modifier = Modifier
                        .size(4.dp)
                        .clip(CircleShape)
                        .background(Color(0xFF0A3455)),
                )
            }
        },
        track = { sliderState ->
            Canvas(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(10.dp),
            ) {
                val trackHeight = 3.dp.toPx()
                val trackTop = (size.height - trackHeight) / 2f
                val progress = ((sliderState.value - 1f) / (rangeEnd - 1f)).coerceIn(0f, 1f)
                val activeWidth = size.width * progress
                drawRoundRect(
                    color = Color(0x4D789BB6),
                    topLeft = Offset(0f, trackTop),
                    size = Size(size.width, trackHeight),
                    cornerRadius = CornerRadius(trackHeight, trackHeight),
                )
                if (activeWidth > 0f) {
                    drawRoundRect(
                        brush = Brush.horizontalGradient(
                            listOf(Color(0xFF65E7D0), Color(0xFF6EABFF)),
                        ),
                        topLeft = Offset(0f, trackTop),
                        size = Size(activeWidth, trackHeight),
                        cornerRadius = CornerRadius(trackHeight, trackHeight),
                    )
                }
            }
        },
    )
}

@Composable
private fun ProfileAboutScreen(onBack: () -> Unit) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item { ProfileSubpageHeader(title = "关于", onBack = onBack) }
        item {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 4.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(18.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("版本号", style = MaterialTheme.typography.titleMedium)
                    Spacer(modifier = Modifier.weight(1f))
                    Text(
                        BuildConfig.VERSION_NAME,
                        color = Color(0xFFD5F4FF),
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                    )
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("发布日期", style = MaterialTheme.typography.titleMedium)
                    Spacer(modifier = Modifier.weight(1f))
                    Text(
                        BuildConfig.RELEASE_DATE,
                        color = Color(0xFFD5F4FF),
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                    )
                }
            }
        }
    }
}

@Composable
private fun ProfileSubpageHeader(title: String, onBack: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(52.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onBack) {
            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
        }
        Text(
            text = title,
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(start = 4.dp),
        )
    }
}

@Composable
private fun ProfileHeader(user: AuthUser) {
    val nickname = user.nickname.trim().ifBlank { "音乐用户" }
    val logoText = nickname.firstOrNull()?.toString()?.uppercase() ?: "H"

    Card(
        shape = RoundedCornerShape(30.dp),
        colors = CardDefaults.cardColors(containerColor = Color.Transparent),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier
                .background(
                    Brush.linearGradient(
                        listOf(
                            Color(0xFF123F6B),
                            Color(0xFF0B3157),
                            Color(0xFF142C52),
                        ),
                    ),
                )
                .padding(20.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(18.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(modifier = Modifier.size(88.dp)) {
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .clip(CircleShape)
                            .background(
                                Brush.linearGradient(
                                    listOf(Color(0xFF64E6D2), Color(0xFF6A9CFF), Color(0xFFF2A86F)),
                                ),
                            )
                            .border(1.dp, Color(0x99E6FBFF), CircleShape),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            text = logoText,
                            color = Color(0xFF082540),
                            style = MaterialTheme.typography.headlineLarge,
                            fontWeight = FontWeight.Black,
                        )
                    }
                    Box(
                        modifier = Modifier
                            .align(Alignment.BottomEnd)
                            .size(28.dp)
                            .clip(CircleShape)
                            .background(Color(0xFF0A2848))
                            .border(1.dp, Color(0xFF77E8D5), CircleShape),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            imageVector = Icons.Default.MusicNote,
                            contentDescription = null,
                            tint = Color(0xFF8AF0DF),
                            modifier = Modifier.size(16.dp),
                        )
                    }
                }

                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(7.dp),
                ) {
                    Text(
                        text = nickname,
                        style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        text = user.phone,
                        color = Color(0xFFC1D9EA),
                        style = MaterialTheme.typography.bodyMedium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Surface(
                        color = Color(0x2E8CEAD8),
                        shape = RoundedCornerShape(999.dp),
                    ) {
                        Text(
                            text = user.role.label,
                            color = Color(0xFF8EF0DE),
                            style = MaterialTheme.typography.labelLarge,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier.padding(horizontal = 11.dp, vertical = 6.dp),
                        )
                    }
                }
            }

        }
    }
}

@Composable
private fun LyricsPlaybackControls(
    state: PlayerUiState,
    viewModel: PlayerViewModel,
    modifier: Modifier = Modifier,
) {
    state.currentTrack ?: return

    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(start = 16.dp, end = 16.dp, bottom = 10.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        WebTransportControls(
            isPlaying = state.isPlaying,
            onPrevious = viewModel::playPrevious,
            onToggle = viewModel::togglePlayback,
            onNext = viewModel::playNext,
        )

        WebStyleProgressGroup(
            positionMs = state.currentPositionMs,
            durationMs = state.durationMs,
            bufferedPositionMs = state.bufferedPositionMs,
            onSeek = viewModel::seekTo,
        )
    }
}

@Composable
private fun WebTransportControls(
    isPlaying: Boolean,
    onPrevious: () -> Unit,
    onToggle: () -> Unit,
    onNext: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        WebTransportButton(
            icon = TransportIconKind.Previous,
            contentDescription = "上一首",
            onClick = onPrevious,
        )
        Spacer(Modifier.width(13.dp))
        WebTransportButton(
            icon = if (isPlaying) TransportIconKind.Pause else TransportIconKind.Play,
            contentDescription = if (isPlaying) "暂停" else "播放",
            isPlayToggle = true,
            onClick = onToggle,
        )
        Spacer(Modifier.width(13.dp))
        WebTransportButton(
            icon = TransportIconKind.Next,
            contentDescription = "下一首",
            onClick = onNext,
        )
    }
}

@Composable
private fun WebTransportButton(
    icon: TransportIconKind,
    contentDescription: String,
    onClick: () -> Unit,
    isPlayToggle: Boolean = false,
) {
    val shape = RoundedCornerShape(if (isPlayToggle) 18.dp else 999.dp)
    val width = if (isPlayToggle) 48.dp else 42.dp
    val height = if (isPlayToggle) 50.dp else 42.dp
    val background = if (isPlayToggle) {
        Brush.radialGradient(
            listOf(
                Color(0xA8FFFFFF),
                Color(0x57FF74DB),
                Color(0x335BE7FF),
            ),
        )
    } else {
        Brush.radialGradient(
            listOf(
                Color(0x1FFFF26F),
                Color(0x335EF5FF),
                Color(0x1FFF54CA),
            ),
        )
    }

    Box(
        modifier = Modifier
            .width(width)
            .height(height)
            .shadow(if (isPlayToggle) 12.dp else 7.dp, shape)
            .clip(shape)
            .background(background)
            .border(
                width = 1.dp,
                color = if (isPlayToggle) Color(0x57FFFFFF) else Color(0x44A9E8FF),
                shape = shape,
            )
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onClick,
            ),
        contentAlignment = Alignment.Center,
    ) {
        WebTransportIcon(
            kind = icon,
            modifier = Modifier.size(if (isPlayToggle) 45.dp else 33.dp),
            contentDescription = contentDescription,
        )
    }
}

private enum class TransportIconKind {
    Previous,
    Next,
    Play,
    Pause,
}

@Composable
private fun WebTransportIcon(
    kind: TransportIconKind,
    modifier: Modifier = Modifier,
    contentDescription: String? = null,
) {
    val fillColor = when (kind) {
        TransportIconKind.Previous,
        TransportIconKind.Next -> Color(0xFFADFF69)
        TransportIconKind.Play -> Color(0xFFFFF15E)
        TransportIconKind.Pause -> Color(0xFF74F2FF)
    }

    Canvas(modifier = modifier) {
        val sx = size.width / 24f
        val sy = size.height / 24f
        fun p(x: Float, y: Float) = Offset(x * sx, y * sy)

        val coreColor = Color(0xF5F9FEFF)
        val accentColor = Color(0xF5FF6FDB)
        val sparkColor = Color(0xFFFFF469)
        val dotColor = Color(0xFFFF70DA)
        val coreStroke = Stroke(width = 1.8f * sx, cap = StrokeCap.Round, join = StrokeJoin.Round)
        val accentStroke = Stroke(width = 1.65f * sx, cap = StrokeCap.Round, join = StrokeJoin.Round)
        val fillStroke = Stroke(width = 0.9f * sx, cap = StrokeCap.Round, join = StrokeJoin.Round)

        fun drawSpark(center: Offset, radius: Float) {
            drawCircle(color = sparkColor, radius = radius, center = center)
            drawCircle(color = Color.White.copy(alpha = 0.86f), radius = radius, center = center, style = Stroke(width = 0.25f * sx))
        }

        when (kind) {
            TransportIconKind.Previous -> {
                val accent = Path().apply {
                    moveTo(18.7f * sx, 6.1f * sy)
                    cubicTo(17.2f * sx, 4.9f * sy, 15.2f * sx, 4.2f * sy, 12.9f * sx, 4.2f * sy)
                }
                drawPath(path = accent, color = accentColor, style = accentStroke)
                drawLine(coreColor, p(7.1f, 6.3f), p(7.1f, 17.7f), strokeWidth = 1.8f * sx, cap = StrokeCap.Round)
                val triangle = Path().apply {
                    moveTo(17.7f * sx, 6.9f * sy)
                    lineTo(9.3f * sx, 12f * sy)
                    lineTo(17.7f * sx, 17.1f * sy)
                    close()
                }
                drawPath(triangle, fillColor)
                drawPath(triangle, Color.White.copy(alpha = 0.98f), style = fillStroke)
                val mark = Path().apply {
                    moveTo(15.8f * sx, 8.6f * sy)
                    lineTo(10.5f * sx, 12f * sy)
                    lineTo(15.8f * sx, 15.4f * sy)
                }
                drawPath(mark, coreColor, style = coreStroke)
                drawSpark(p(5.5f, 5.6f), 1.1f * sx)
            }

            TransportIconKind.Next -> {
                val accent = Path().apply {
                    moveTo(5.3f * sx, 17.9f * sy)
                    cubicTo(6.8f * sx, 19.1f * sy, 8.8f * sx, 19.8f * sy, 11.1f * sx, 19.8f * sy)
                }
                drawPath(path = accent, color = accentColor, style = accentStroke)
                drawLine(coreColor, p(16.9f, 6.3f), p(16.9f, 17.7f), strokeWidth = 1.8f * sx, cap = StrokeCap.Round)
                val triangle = Path().apply {
                    moveTo(6.3f * sx, 6.9f * sy)
                    lineTo(14.7f * sx, 12f * sy)
                    lineTo(6.3f * sx, 17.1f * sy)
                    close()
                }
                drawPath(triangle, fillColor)
                drawPath(triangle, Color.White.copy(alpha = 0.98f), style = fillStroke)
                val mark = Path().apply {
                    moveTo(8.2f * sx, 8.6f * sy)
                    lineTo(13.5f * sx, 12f * sy)
                    lineTo(8.2f * sx, 15.4f * sy)
                }
                drawPath(mark, coreColor, style = coreStroke)
                drawSpark(p(18.5f, 18.4f), 1.1f * sx)
            }

            TransportIconKind.Play -> {
                val orbit = Path().apply {
                    moveTo(5.6f * sx, 15.7f * sy)
                    cubicTo(3.4f * sx, 10.8f * sy, 6.1f * sx, 5.8f * sy, 10.5f * sx, 4.5f * sy)
                }
                drawPath(orbit, accentColor, style = accentStroke)
                val triangle = Path().apply {
                    moveTo(9.3f * sx, 7.1f * sy)
                    cubicTo(9.3f * sx, 6.3f * sy, 10.1f * sx, 5.9f * sy, 10.8f * sx, 6.3f * sy)
                    lineTo(17.8f * sx, 10.5f * sy)
                    cubicTo(18.5f * sx, 10.9f * sy, 18.5f * sx, 11.9f * sy, 17.8f * sx, 12.3f * sy)
                    lineTo(10.8f * sx, 16.5f * sy)
                    cubicTo(10.1f * sx, 16.9f * sy, 9.3f * sx, 16.4f * sy, 9.3f * sx, 15.6f * sy)
                    close()
                }
                drawPath(triangle, fillColor)
                drawPath(triangle, Color.White.copy(alpha = 0.98f), style = fillStroke)
                drawSpark(p(18f, 6.1f), 1.2f * sx)
                drawCircle(dotColor, radius = 0.8f * sx, center = p(6.2f, 18.2f))
            }

            TransportIconKind.Pause -> {
                val radius = CornerRadius(1.25f * sx, 1.25f * sy)
                drawRoundRect(
                    color = fillColor,
                    topLeft = p(7.4f, 6.2f),
                    size = Size(4f * sx, 11.6f * sy),
                    cornerRadius = radius,
                )
                drawRoundRect(
                    color = Color.White.copy(alpha = 0.98f),
                    topLeft = p(7.4f, 6.2f),
                    size = Size(4f * sx, 11.6f * sy),
                    cornerRadius = radius,
                    style = fillStroke,
                )
                drawRoundRect(
                    color = fillColor,
                    topLeft = p(12.8f, 6.2f),
                    size = Size(4f * sx, 11.6f * sy),
                    cornerRadius = radius,
                )
                drawRoundRect(
                    color = Color.White.copy(alpha = 0.98f),
                    topLeft = p(12.8f, 6.2f),
                    size = Size(4f * sx, 11.6f * sy),
                    cornerRadius = radius,
                    style = fillStroke,
                )
                val accent = Path().apply {
                    moveTo(5.9f * sx, 18.3f * sy)
                    cubicTo(8.1f * sx, 20.2f * sy, 13.6f * sx, 20.8f * sy, 18.1f * sx, 17.8f * sy)
                }
                drawPath(accent, accentColor, style = accentStroke)
                drawSpark(p(18.2f, 5.8f), 1.1f * sx)
            }
        }
    }
}

@Composable
private fun WebStyleProgressGroup(
    positionMs: Long,
    durationMs: Long,
    bufferedPositionMs: Long,
    onSeek: (Long) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            text = formatDuration(positionMs),
            color = Color(0xD1FFFFFF),
            style = MaterialTheme.typography.bodySmall,
            fontWeight = FontWeight.ExtraBold,
            modifier = Modifier.width(48.dp),
        )
        WebStyleProgressSlider(
            positionMs = positionMs,
            durationMs = durationMs,
            bufferedPositionMs = bufferedPositionMs,
            onSeek = onSeek,
            modifier = Modifier.weight(1f),
        )
        Text(
            text = formatDuration(durationMs),
            color = Color(0xD1FFFFFF),
            style = MaterialTheme.typography.bodySmall,
            fontWeight = FontWeight.ExtraBold,
            modifier = Modifier.width(48.dp),
        )
    }
}

@Composable
private fun WebStyleProgressSlider(
    positionMs: Long,
    durationMs: Long,
    bufferedPositionMs: Long,
    onSeek: (Long) -> Unit,
    modifier: Modifier = Modifier,
) {
    val progress = if (durationMs > 0) {
        (positionMs.toDouble() / durationMs.toDouble()).toFloat().coerceIn(0f, 1f)
    } else {
        0f
    }
    val bufferedProgress = if (durationMs > 0) {
        (bufferedPositionMs.toDouble() / durationMs.toDouble()).toFloat().coerceIn(progress, 1f)
    } else {
        0f
    }

    Box(
        modifier = modifier
            .height(34.dp)
            .pointerInput(durationMs) {
                detectTapGestures { offset ->
                    if (durationMs > 0 && size.width > 0) {
                        val ratio = (offset.x / size.width).coerceIn(0f, 1f)
                        onSeek((durationMs.toFloat() * ratio).toLong())
                    }
                }
            }
            .pointerInput(durationMs) {
                detectDragGestures(
                    onDragStart = { offset ->
                        if (durationMs > 0 && size.width > 0) {
                            val ratio = (offset.x / size.width).coerceIn(0f, 1f)
                            onSeek((durationMs.toFloat() * ratio).toLong())
                        }
                    },
                    onDrag = { change, _ ->
                        if (durationMs > 0 && size.width > 0) {
                            val ratio = (change.position.x / size.width).coerceIn(0f, 1f)
                            onSeek((durationMs.toFloat() * ratio).toLong())
                            change.consume()
                        }
                    },
                )
            },
    ) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            val trackHeight = 16.dp.toPx()
            val trackTop = (size.height - trackHeight) / 2f
            val trackSize = Size(size.width, trackHeight)
            val radius = CornerRadius(trackHeight / 2f, trackHeight / 2f)
            val fillWidth = (size.width * progress).coerceIn(0f, size.width)
            val visibleFillWidth = if (fillWidth > 0f) fillWidth.coerceAtLeast(10.dp.toPx()).coerceAtMost(size.width) else 0f
            val bufferedWidth = (size.width * bufferedProgress).coerceIn(0f, size.width)
            val visibleBufferedWidth = if (bufferedWidth > 0f) bufferedWidth.coerceAtLeast(10.dp.toPx()).coerceAtMost(size.width) else 0f
            val centerY = size.height / 2f

            drawRoundRect(
                brush = Brush.linearGradient(
                    colors = listOf(Color(0xE00A2247), Color(0xD10D3B67)),
                    start = Offset.Zero,
                    end = Offset(size.width, 0f),
                ),
                topLeft = Offset(0f, trackTop),
                size = trackSize,
                cornerRadius = radius,
            )
            drawRoundRect(
                brush = Brush.verticalGradient(
                    colors = listOf(Color(0x33FFFFFF), Color(0x0AFFFFFF)),
                    startY = trackTop,
                    endY = trackTop + trackHeight,
                ),
                topLeft = Offset(0f, trackTop),
                size = trackSize,
                cornerRadius = radius,
            )
            drawRoundRect(
                color = Color(0x3DB3EFFF),
                topLeft = Offset(0f, trackTop),
                size = trackSize,
                cornerRadius = radius,
                style = Stroke(width = 1.dp.toPx()),
            )

            if (visibleBufferedWidth > 0f) {
                val bufferInset = 3.dp.toPx()
                val bufferHeight = (trackHeight - bufferInset * 2f).coerceAtLeast(1f)
                drawRoundRect(
                    brush = Brush.linearGradient(
                        colors = listOf(
                            Color(0x5583ECFF),
                            Color(0x7AC0F7FF),
                            Color(0x5583ECFF),
                        ),
                        start = Offset(0f, centerY),
                        end = Offset(visibleBufferedWidth, centerY),
                    ),
                    topLeft = Offset(0f, trackTop + bufferInset),
                    size = Size(visibleBufferedWidth, bufferHeight),
                    cornerRadius = CornerRadius(bufferHeight / 2f, bufferHeight / 2f),
                )
                drawRoundRect(
                    color = Color(0x4FC3FAFF),
                    topLeft = Offset(0f, trackTop + bufferInset),
                    size = Size(visibleBufferedWidth, bufferHeight),
                    cornerRadius = CornerRadius(bufferHeight / 2f, bufferHeight / 2f),
                    style = Stroke(width = 1.dp.toPx()),
                )
            }

            val tickWidth = 2.dp.toPx()
            val tickGap = 18.dp.toPx()
            val tickHeight = 5.dp.toPx()
            var tickX = 10.dp.toPx()
            while (tickX < size.width - 10.dp.toPx()) {
                drawRoundRect(
                    color = Color.White.copy(alpha = 0.22f),
                    topLeft = Offset(tickX, centerY - tickHeight / 2f),
                    size = Size(tickWidth, tickHeight),
                    cornerRadius = CornerRadius(tickWidth, tickWidth),
                )
                tickX += tickGap
            }

            if (visibleFillWidth > 0f) {
                drawRoundRect(
                    brush = Brush.linearGradient(
                        colors = listOf(
                            Color(0xFFA9FF64),
                            Color(0xFF70F4FF),
                            Color(0xFFFF60CF),
                        ),
                        start = Offset(0f, centerY),
                        end = Offset(visibleFillWidth, centerY),
                    ),
                    topLeft = Offset(0f, trackTop),
                    size = Size(visibleFillWidth, trackHeight),
                    cornerRadius = radius,
                )
                drawRoundRect(
                    brush = Brush.linearGradient(
                        colors = listOf(Color(0xB8FFFFFF), Color.Transparent),
                        start = Offset(8.dp.toPx(), trackTop),
                        end = Offset(visibleFillWidth, trackTop),
                    ),
                    topLeft = Offset(8.dp.toPx().coerceAtMost(visibleFillWidth), trackTop + 2.dp.toPx()),
                    size = Size((visibleFillWidth - 16.dp.toPx()).coerceAtLeast(0f), 5.dp.toPx()),
                    cornerRadius = CornerRadius(999f, 999f),
                )
            }

            val thumbX = (size.width * progress).coerceIn(0f, size.width)
            drawCircle(
                color = Color(0x2470F4FF),
                radius = 16.dp.toPx(),
                center = Offset(thumbX, centerY),
            )
            drawCircle(
                brush = Brush.linearGradient(
                    colors = listOf(
                        Color(0xFFFFF669),
                        Color(0xFF6FF6FF),
                        Color(0xFFFF5BCB),
                    ),
                    start = Offset(thumbX - 12.dp.toPx(), centerY - 12.dp.toPx()),
                    end = Offset(thumbX + 12.dp.toPx(), centerY + 12.dp.toPx()),
                ),
                radius = 12.dp.toPx(),
                center = Offset(thumbX, centerY),
            )
            drawCircle(
                color = Color.White.copy(alpha = 0.96f),
                radius = 12.dp.toPx(),
                center = Offset(thumbX, centerY),
                style = Stroke(width = 2.dp.toPx()),
            )
            drawCircle(
                color = Color.White.copy(alpha = 0.88f),
                radius = 2.8.dp.toPx(),
                center = Offset(thumbX - 3.dp.toPx(), centerY - 4.dp.toPx()),
            )
            drawCircle(
                color = Color(0x3D072553),
                radius = 3.dp.toPx(),
                center = Offset(thumbX + 4.dp.toPx(), centerY + 4.dp.toPx()),
            )
        }
    }
}

@Composable
private fun RemoteCoverArt(
    url: String?,
    token: String,
    modifier: Modifier = Modifier,
    maxImageSizePx: Int = 512,
) {
    val image by produceState<ImageBitmap?>(initialValue = null, url, token, maxImageSizePx) {
        value = loadImageBitmap(url, token, maxImageSizePx)
    }
    Box(
        modifier = modifier
            .background(
                Brush.linearGradient(
                    listOf(Color(0xFF164E76), Color(0xFF312E81)),
                ),
            ),
        contentAlignment = Alignment.Center,
    ) {
        if (image != null) {
            Image(
                bitmap = image!!,
                contentDescription = "专辑封面",
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            Image(
                painter = painterResource(R.drawable.default_album_art),
                contentDescription = "默认专辑封面",
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}

private suspend fun loadImageBitmap(url: String?, token: String, maxSizePx: Int): ImageBitmap? {
    if (url.isNullOrBlank()) {
        return null
    }
    return withContext(Dispatchers.IO) {
        runCatching {
            val connection = URL(url).openConnection() as HttpURLConnection
            connection.connectTimeout = 12_000
            connection.readTimeout = 30_000
            if (token.isNotBlank()) {
                connection.setRequestProperty("Authorization", "Bearer $token")
            }
            val bytes = connection.inputStream.use { it.readBytes() }
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
                return@runCatching null
            }
            val safeMaxSizePx = maxSizePx.coerceAtLeast(96)
            val decodeOptions = BitmapFactory.Options().apply {
                inSampleSize = calculateCoverInSampleSize(bounds.outWidth, bounds.outHeight, safeMaxSizePx)
            }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, decodeOptions)?.asImageBitmap()
        }.getOrNull()
    }
}

private fun calculateCoverInSampleSize(width: Int, height: Int, maxSizePx: Int): Int {
    var sampleSize = 1
    while (width / sampleSize > maxSizePx || height / sampleSize > maxSizePx) {
        sampleSize *= 2
    }
    return sampleSize
}

@Composable
private fun EmptyState(title: String, subtitle: String) {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(24.dp)) {
            Icon(Icons.Default.MusicNote, contentDescription = null, tint = Color(0xFF7DD3FC), modifier = Modifier.size(48.dp))
            Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Text(subtitle, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ErrorDialog(message: String?, onDismiss: () -> Unit) {
    if (message.isNullOrBlank()) {
        return
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text("知道了")
            }
        },
        title = { Text("提示") },
        text = { Text(message) },
    )
}

private fun formatBytes(bytes: Long): String {
    if (bytes <= 0) {
        return "0 MB"
    }
    val mib = bytes / 1024.0 / 1024.0
    if (mib < 1024) {
        return "${mib.roundToInt()} MB"
    }
    val gib = mib / 1024.0
    return String.format("%.1f GB", gib)
}

private fun formatDuration(ms: Long): String {
    val totalSeconds = (ms / 1000).coerceAtLeast(0)
    val minutes = totalSeconds / 60
    val seconds = totalSeconds % 60
    return "%d:%02d".format(minutes, seconds)
}

private fun formatSleepTimerRemaining(seconds: Long): String {
    val safeSeconds = seconds.coerceAtLeast(0L)
    val hours = safeSeconds / 3_600L
    val minutes = (safeSeconds % 3_600L) / 60L
    val restSeconds = safeSeconds % 60L
    return if (hours > 0L) {
        "$hours:${minutes.toString().padStart(2, '0')}:${restSeconds.toString().padStart(2, '0')}"
    } else {
        "${minutes.toString().padStart(2, '0')}:${restSeconds.toString().padStart(2, '0')}"
    }
}
