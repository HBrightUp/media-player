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
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.drag
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsDraggedAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredHeight
import androidx.compose.foundation.layout.requiredWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
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
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.zIndex
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.hml.mediaplayer.BuildConfig
import com.hml.mediaplayer.R
import com.hml.mediaplayer.data.AuthUser
import com.hml.mediaplayer.data.FavoriteCategory
import com.hml.mediaplayer.data.LyricLine
import com.hml.mediaplayer.data.LyricWord
import com.hml.mediaplayer.data.Track
import com.hml.mediaplayer.data.TrackCacheManager
import com.hml.mediaplayer.data.TrackQuality
import com.hml.mediaplayer.viewmodel.EqualizerPreset
import com.hml.mediaplayer.viewmodel.HomeTab
import com.hml.mediaplayer.viewmodel.LibraryContent
import com.hml.mediaplayer.viewmodel.PlaybackMode
import com.hml.mediaplayer.viewmodel.PlayerUiState
import com.hml.mediaplayer.viewmodel.PlayerViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL
import kotlin.math.abs
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
            .background(webBlueGradient())
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
    val lyricsContentBottomPadding by animateDpAsState(
        targetValue = if (bottomTabsVisible) {
            LibraryBottomClearanceExpanded
        } else {
            LibraryBottomClearanceCollapsed
        },
        animationSpec = tween(durationMillis = 220),
        label = "lyrics-content-bottom-padding",
    )
    val libraryBottomClearance by animateDpAsState(
        targetValue = if (bottomTabsVisible) {
            LibraryBottomClearanceExpanded
        } else {
            LibraryBottomClearanceCollapsed
        },
        animationSpec = tween(durationMillis = 220),
        label = "library-bottom-clearance",
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
        ) { _ ->
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .statusBarsPadding(),
            ) {
                Box(modifier = Modifier.weight(1f)) {
                    when (state.selectedTab) {
                        HomeTab.LIBRARY -> LibraryScreen(
                            state = state,
                            viewModel = viewModel,
                            bottomClearance = libraryBottomClearance,
                        )
                        HomeTab.LYRICS -> {
                            LyricsScreen(
                                state = state,
                                viewModel = viewModel,
                                lyricsBottomPadding = lyricsContentBottomPadding,
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

private val BottomTabsExpandedHeight = 78.dp
private val BottomTabsCollapsedHeight = 54.dp
private val BottomTabsBottomMargin = 16.dp
private val BottomTabsSystemNavigationReserve = 36.dp
private val BottomTabsListGap = 8.dp
private val LibraryBottomClearanceExpanded =
    BottomTabsExpandedHeight + BottomTabsBottomMargin + BottomTabsSystemNavigationReserve + BottomTabsListGap
private val LibraryBottomClearanceCollapsed =
    BottomTabsCollapsedHeight + BottomTabsBottomMargin + BottomTabsSystemNavigationReserve + BottomTabsListGap
private val LibraryHorizontalPadding = 20.dp
private val LibraryTopPadding = 14.dp
private val LibraryHeaderBottomGap = 8.dp
private val LibraryTopTabsMaxWidth = 360.dp
private val LibraryCategoryRailWidth = 76.dp
private val LibraryCategoryGap = 8.dp
private val MusicListMaxWidth = 328.dp
private val MusicListRowHeight = 82.dp
private val MusicListRowSpacing = 3.dp
private val LibraryMiniPlayerHeight = 60.dp
private val LibraryMiniPlayerListGap = 8.dp
private val LibraryMiniPlayerMaxWidth = 292.dp
private val PlayingIndicatorColor = Color(0xFF77F56C)
private const val EqualizerGainMinDb = -9f
private const val EqualizerGainMaxDb = 9f
private const val EqualizerGainStepDb = 0.5f

private data class EqualizerBandSpec(
    val name: String,
    val frequency: String,
)

private val equalizerBandSpecs = listOf(
    EqualizerBandSpec("超低", "31Hz"),
    EqualizerBandSpec("低频", "62Hz"),
    EqualizerBandSpec("低鼓", "125Hz"),
    EqualizerBandSpec("厚度", "250Hz"),
    EqualizerBandSpec("温暖", "500Hz"),
    EqualizerBandSpec("中频", "1k"),
    EqualizerBandSpec("人声", "2k"),
    EqualizerBandSpec("清晰", "4k"),
    EqualizerBandSpec("明亮", "8k"),
    EqualizerBandSpec("空气", "16k"),
)

@Composable
private fun FloatingBottomTabs(
    selectedTab: HomeTab,
    visible: Boolean,
    onReveal: () -> Unit,
    onSelect: (HomeTab) -> Unit,
    modifier: Modifier = Modifier,
) {
    val tabHeight = if (visible) BottomTabsExpandedHeight else BottomTabsCollapsedHeight
    val containerModifier = modifier
        .fillMaxWidth()
        .zIndex(100f)
        .navigationBarsPadding()
        .padding(start = 24.dp, end = 24.dp, bottom = BottomTabsBottomMargin)

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
                    .width(240.dp)
                    .height(54.dp)
                    .pointerInput(Unit) {
                        detectTapGestures { onReveal() }
                    }
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                        onClick = onReveal,
                    ),
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
    Box(
        modifier = Modifier
            .width(78.dp)
            .height(62.dp)
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
private fun LibraryScreen(
    state: PlayerUiState,
    viewModel: PlayerViewModel,
    bottomClearance: Dp,
) {
    var actionTrack by remember { mutableStateOf<Track?>(null) }
    var categoryPickerTrack by remember { mutableStateOf<Track?>(null) }
    var createCategoryVisible by rememberSaveable { mutableStateOf(false) }
    var categoryAction by remember { mutableStateOf<FavoriteCategory?>(null) }
    var renameCategory by remember { mutableStateOf<FavoriteCategory?>(null) }
    var deleteCategory by remember { mutableStateOf<FavoriteCategory?>(null) }
    var playbackModeMenuVisible by rememberSaveable { mutableStateOf(false) }
    var equalizerPanelVisible by rememberSaveable { mutableStateOf(false) }
    val trackListState = rememberLazyListState()
    val activeCategory = state.favoriteCategories.firstOrNull { it.id == state.activeFavoriteCategoryId }
    val membershipsByTrack = remember(state.categoryMemberships) {
        state.categoryMemberships.groupBy { it.trackId }
    }
    val miniPlayerVisible = state.currentTrack != null

    BackHandler(enabled = equalizerPanelVisible) {
        equalizerPanelVisible = false
    }

    LaunchedEffect(trackListState.isScrollInProgress) {
        if (trackListState.isScrollInProgress) {
            actionTrack = null
            categoryPickerTrack = null
            playbackModeMenuVisible = false
            equalizerPanelVisible = false
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(webBlueGradient()),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(
                    start = LibraryHorizontalPadding,
                    top = LibraryTopPadding,
                    end = LibraryHorizontalPadding,
                ),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = LibraryHeaderBottomGap),
                contentAlignment = Alignment.Center,
            ) {
                LibraryTopTabs(
                    state = state,
                    onSelectQuality = viewModel::selectQuality,
                    onSelectFavorites = viewModel::selectFavoriteTracks,
                    modifier = Modifier
                        .widthIn(max = LibraryTopTabsMaxWidth)
                        .fillMaxWidth(),
                )
                if (state.isLoading) {
                    CircularProgressIndicator(
                        modifier = Modifier
                            .align(Alignment.CenterEnd)
                            .size(22.dp),
                        strokeWidth = 3.dp,
                    )
                }
            }

            BoxWithConstraints(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f),
                contentAlignment = Alignment.TopCenter,
            ) {
                val density = LocalDensity.current
                val rowHeightPx = with(density) { MusicListRowHeight.toPx() }
                val rowSpacingPx = with(density) { MusicListRowSpacing.toPx() }
                val availableHeightPx = with(density) { maxHeight.toPx() }.coerceAtLeast(0f)
                val completeRowCount = if (availableHeightPx < rowHeightPx) {
                    0
                } else {
                    ((availableHeightPx + rowSpacingPx) / (rowHeightPx + rowSpacingPx)).toInt()
                }.coerceAtLeast(0)
                val completeListHeight = with(density) {
                    (
                        completeRowCount * rowHeightPx +
                            maxOf(0, completeRowCount - 1) * rowSpacingPx
                    ).toDp()
                }

                if (completeRowCount > 0) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(completeListHeight),
                        horizontalArrangement = Arrangement.spacedBy(LibraryCategoryGap),
                        verticalAlignment = Alignment.Top,
                    ) {
                        FavoriteCategoryRail(
                            categories = state.favoriteCategories,
                            categoryLimit = state.favoriteCategoryLimit,
                            activeCategoryId = state.activeFavoriteCategoryId,
                            canCreate = state.favoriteCategories.size < state.favoriteCategoryLimit,
                            actionCategoryId = categoryAction?.id,
                            onSelectAll = { viewModel.selectFavoriteCategory(null) },
                            onSelectCategory = viewModel::selectFavoriteCategory,
                            onCategoryAction = { categoryAction = it },
                            onRenameCategory = { category ->
                                categoryAction = null
                                renameCategory = category
                            },
                            onDeleteCategory = { category ->
                                categoryAction = null
                                deleteCategory = category
                            },
                            onDismissCategoryAction = { categoryAction = null },
                            onCreate = { createCategoryVisible = true },
                            modifier = Modifier
                                .width(LibraryCategoryRailWidth)
                                .fillMaxHeight(),
                        )

                        Box(
                            modifier = Modifier
                                .weight(1f)
                                .fillMaxHeight(),
                            contentAlignment = Alignment.TopCenter,
                        ) {
                            if (!state.isLoading && state.tracks.isEmpty()) {
                                Text(
                                    text = libraryEmptyText(state, activeCategory),
                                    color = Color(0xFFD8ECF6),
                                    style = MaterialTheme.typography.bodyMedium,
                                    textAlign = TextAlign.Center,
                                    modifier = Modifier.padding(top = 44.dp, start = 8.dp, end = 8.dp),
                                )
                            } else {
                                LazyColumn(
                                    state = trackListState,
                                    modifier = Modifier
                                        .widthIn(max = MusicListMaxWidth)
                                        .fillMaxWidth()
                                        .fillMaxHeight(),
                                    contentPadding = PaddingValues(),
                                    verticalArrangement = Arrangement.spacedBy(MusicListRowSpacing),
                                    horizontalAlignment = Alignment.CenterHorizontally,
                                ) {
                                    items(state.tracks, key = { it.id }) { track ->
                                        val memberships = membershipsByTrack[track.id].orEmpty()
                                        val joinedCategoryIds = memberships.mapTo(mutableSetOf()) { it.categoryId }
                                        val isInActiveCategory = activeCategory?.id?.let(joinedCategoryIds::contains) == true
                                        val actionMenuVisible = actionTrack?.id == track.id
                                        val categoryMenuVisible = categoryPickerTrack?.id == track.id
                                        val isCached = track.id in state.cachedTrackIds
                                        val isCaching = state.cachingTrackId == track.id
                                        Box(modifier = Modifier.fillMaxWidth()) {
                                            TrackRow(
                                                track = track,
                                                isCurrent = state.currentTrack?.id == track.id,
                                                isPlaying = state.currentTrack?.id == track.id && state.isPlaying,
                                                isFavorite = track.id in state.favoriteTrackIds,
                                                showHighQualityBadge = state.libraryContent != LibraryContent.QUALITY && track.quality == TrackQuality.LOSSLESS,
                                                onPlay = {
                                                    playbackModeMenuVisible = false
                                                    equalizerPanelVisible = false
                                                    viewModel.playTrack(track)
                                                },
                                                onMore = {
                                                    categoryPickerTrack = null
                                                    actionTrack = track
                                                },
                                            )
                                            TrackContextMenu(
                                                expanded = actionMenuVisible || categoryMenuVisible,
                                                showingCategories = categoryMenuVisible,
                                                isFavorite = track.id in state.favoriteTrackIds,
                                                isInActiveCategory = isInActiveCategory,
                                                isCached = isCached,
                                                isCaching = isCaching,
                                                cacheActionEnabled = state.cachingTrackId == null || isCached,
                                                categories = state.favoriteCategories,
                                                joinedCategoryIds = joinedCategoryIds,
                                                onToggleFavorite = {
                                                    actionTrack = null
                                                    viewModel.toggleFavorite(track)
                                                },
                                                onShowCategories = {
                                                    actionTrack = null
                                                    if (state.favoriteCategories.isEmpty()) {
                                                        createCategoryVisible = true
                                                    } else {
                                                        categoryPickerTrack = track
                                                    }
                                                },
                                                onAddToCategory = { category ->
                                                    actionTrack = null
                                                    categoryPickerTrack = null
                                                    viewModel.addTrackToFavoriteCategory(track, category)
                                                },
                                                onCacheTrack = {
                                                    actionTrack = null
                                                    categoryPickerTrack = null
                                                    viewModel.cacheTrack(track)
                                                },
                                                onRemoveCachedTrack = {
                                                    actionTrack = null
                                                    categoryPickerTrack = null
                                                    viewModel.removeCachedTrack(track)
                                                },
                                                onRemoveFromCategory = activeCategory
                                                    ?.takeIf { isInActiveCategory }
                                                    ?.let { category ->
                                                        {
                                                            actionTrack = null
                                                            viewModel.removeTrackFromFavoriteCategory(track, category.id)
                                                        }
                                                    },
                                                onDismiss = {
                                                    actionTrack = null
                                                    categoryPickerTrack = null
                                                },
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            if (miniPlayerVisible) {
                Spacer(Modifier.height(LibraryMiniPlayerListGap))
                LibraryMiniPlayerBar(
                    state = state,
                    playbackModeMenuExpanded = playbackModeMenuVisible,
                    equalizerActive = equalizerPanelVisible || state.isEqualizerCustom || state.equalizerPreset != EqualizerPreset.FLAT,
                    onOpenPlaybackMode = {
                        playbackModeMenuVisible = !playbackModeMenuVisible
                        equalizerPanelVisible = false
                    },
                    onDismissPlaybackMode = { playbackModeMenuVisible = false },
                    onSelectPlaybackMode = { mode ->
                        playbackModeMenuVisible = false
                        viewModel.selectPlaybackMode(mode)
                    },
                    onOpenEqualizer = {
                        equalizerPanelVisible = !equalizerPanelVisible
                        playbackModeMenuVisible = false
                    },
                    onPrevious = viewModel::playPrevious,
                    onTogglePlayback = viewModel::togglePlayback,
                    onNext = viewModel::playNext,
                    modifier = Modifier.padding(horizontal = 16.dp),
                )
            }
            Spacer(Modifier.height(bottomClearance))
        }

        if (miniPlayerVisible && equalizerPanelVisible) {
            EqualizerBottomSheet(
                state = state,
                onSelectPreset = viewModel::selectEqualizerPreset,
                onBandGainChange = viewModel::setEqualizerBandGain,
                onDismiss = { equalizerPanelVisible = false },
            )
        }
    }

    renameCategory?.let { category ->
        RenameFavoriteCategoryDialog(
            category = category,
            categoryNameMaxLength = state.favoriteCategoryNameMaxLength,
            isSubmitting = state.isLoading,
            onConfirm = { name ->
                renameCategory = null
                viewModel.renameFavoriteCategory(category, name)
            },
            onDismiss = { renameCategory = null },
        )
    }

    if (createCategoryVisible) {
        CreateFavoriteCategoryDialog(
            categoryCount = state.favoriteCategories.size,
            categoryLimit = state.favoriteCategoryLimit,
            categoryNameMaxLength = state.favoriteCategoryNameMaxLength,
            isSubmitting = state.isLoading,
            onConfirm = { name ->
                createCategoryVisible = false
                viewModel.createFavoriteCategory(name)
            },
            onDismiss = { createCategoryVisible = false },
        )
    }

    deleteCategory?.let { category ->
        DeleteFavoriteCategoryDialog(
            category = category,
            onConfirm = {
                deleteCategory = null
                viewModel.deleteFavoriteCategory(category)
            },
            onDismiss = { deleteCategory = null },
        )
    }
}

@Composable
private fun LibraryMiniPlayerBar(
    state: PlayerUiState,
    playbackModeMenuExpanded: Boolean,
    equalizerActive: Boolean,
    onOpenPlaybackMode: () -> Unit,
    onDismissPlaybackMode: () -> Unit,
    onSelectPlaybackMode: (PlaybackMode) -> Unit,
    onOpenEqualizer: () -> Unit,
    onPrevious: () -> Unit,
    onTogglePlayback: () -> Unit,
    onNext: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val track = state.currentTrack
    val hasTrack = track != null
    val playbackModeIcon = when (state.playbackMode) {
        PlaybackMode.ORDER -> MiniPlayerIconKind.Repeat
        PlaybackMode.REPEAT_ONE -> MiniPlayerIconKind.RepeatOne
        PlaybackMode.SHUFFLE -> MiniPlayerIconKind.Shuffle
    }

    Box(
        modifier = modifier
            .widthIn(max = LibraryMiniPlayerMaxWidth)
            .fillMaxWidth()
            .height(LibraryMiniPlayerHeight)
            .padding(horizontal = 4.dp),
        contentAlignment = Alignment.Center,
    ) {
        Row(
            modifier = Modifier.fillMaxSize(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(9.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    modifier = Modifier.size(38.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    MiniPlayerControlButton(
                        icon = playbackModeIcon,
                        contentDescription = "播放模式：${state.playbackMode.label}",
                        selected = playbackModeMenuExpanded || state.playbackMode != PlaybackMode.ORDER,
                        compact = true,
                        onClick = onOpenPlaybackMode,
                    )
                    PlaybackModeDropdownMenu(
                        expanded = playbackModeMenuExpanded,
                        currentMode = state.playbackMode,
                        onSelect = onSelectPlaybackMode,
                        onDismiss = onDismissPlaybackMode,
                        modifier = Modifier
                            .align(Alignment.TopCenter)
                            .offset(y = (-132).dp)
                            .zIndex(20f),
                    )
                }
                MiniPlayerControlButton(
                    icon = MiniPlayerIconKind.Previous,
                    contentDescription = "上一首",
                    enabled = hasTrack,
                    onClick = onPrevious,
                )
                MiniPlayerControlButton(
                    icon = if (state.isPlaying) MiniPlayerIconKind.Pause else MiniPlayerIconKind.Play,
                    contentDescription = if (state.isPlaying) "暂停" else "播放",
                    enabled = hasTrack,
                    primary = true,
                    onClick = onTogglePlayback,
                )
                MiniPlayerControlButton(
                    icon = MiniPlayerIconKind.Next,
                    contentDescription = "下一曲",
                    enabled = hasTrack,
                    onClick = onNext,
                )
                MiniPlayerControlButton(
                    icon = MiniPlayerIconKind.Equalizer,
                    contentDescription = "音乐均衡器：${equalizerDisplayName(state)}",
                    selected = equalizerActive,
                    compact = true,
                    onClick = onOpenEqualizer,
                )
            }
        }
    }
}

@Composable
private fun EqualizerBottomSheet(
    state: PlayerUiState,
    onSelectPreset: (EqualizerPreset) -> Unit,
    onBandGainChange: (Int, Float) -> Unit,
    onDismiss: () -> Unit,
) {
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(
            usePlatformDefaultWidth = false,
            decorFitsSystemWindows = false,
        ),
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    onClick = onDismiss,
                ),
            contentAlignment = Alignment.BottomCenter,
        ) {
            EqualizerFloatingPanel(
                state = state,
                onSelectPreset = onSelectPreset,
                onBandGainChange = onBandGainChange,
                onDismiss = onDismiss,
                modifier = Modifier
                    .padding(horizontal = 10.dp)
                    .navigationBarsPadding()
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                        onClick = {},
                    ),
            )
        }
    }
}

@Composable
private fun EqualizerFloatingPanel(
    state: PlayerUiState,
    onSelectPreset: (EqualizerPreset) -> Unit,
    onBandGainChange: (Int, Float) -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val sliderHeight = 148.dp
    val panelShape = RoundedCornerShape(24.dp)
    Column(
        modifier = modifier
            .widthIn(max = 390.dp)
            .fillMaxWidth()
            .shadow(24.dp, panelShape, clip = false)
            .clip(panelShape)
            .background(
                Brush.linearGradient(
                    listOf(
                        Color(0xF50C365C),
                        Color(0xF7082548),
                        Color(0xF9051835),
                    ),
                ),
            )
            .border(1.dp, Color(0x52A9E8FF), panelShape)
            .padding(start = 12.dp, top = 9.dp, end = 12.dp, bottom = 14.dp),
        verticalArrangement = Arrangement.spacedBy(11.dp),
    ) {
        Box(
            modifier = Modifier
                .align(Alignment.CenterHorizontally)
                .width(42.dp)
                .height(4.dp)
                .clip(RoundedCornerShape(999.dp))
                .background(Color(0x66DDF7FF)),
        )

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = "音乐均衡器",
                    color = Color(0xFFF4FDFF),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Black,
                    maxLines = 1,
                )
            }
            EqualizerCurrentBadge(label = equalizerDisplayName(state))
            IconButton(
                onClick = onDismiss,
                modifier = Modifier.size(34.dp),
            ) {
                Icon(
                    Icons.Default.Close,
                    contentDescription = "关闭均衡器",
                    tint = Color(0xFFE9FAFF),
                    modifier = Modifier.size(20.dp),
                )
            }
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            EqualizerPreset.values().forEach { preset ->
                EqualizerPresetButton(
                    preset = preset,
                    selected = !state.isEqualizerCustom && preset == state.equalizerPreset,
                    onClick = { onSelectPreset(preset) },
                    modifier = Modifier.weight(1f),
                )
            }
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(3.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            equalizerBandSpecs.forEachIndexed { index, band ->
                EqualizerBandControl(
                    band = band,
                    gainDb = equalizerGainAt(state, index),
                    sliderHeight = sliderHeight,
                    onGainChange = { gainDb -> onBandGainChange(index, gainDb) },
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

@Composable
private fun EqualizerCurrentBadge(label: String) {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(
                Brush.linearGradient(
                    listOf(Color(0xFFFFF469), Color(0xFFB3FF6D), Color(0xFF70F4FF)),
                ),
            )
            .padding(horizontal = 10.dp, vertical = 5.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label,
            color = Color(0xFF07244C),
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Black,
            maxLines = 1,
        )
    }
}

@Composable
private fun EqualizerPresetButton(
    preset: EqualizerPreset,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val interactionSource = remember { MutableInteractionSource() }
    val pressed by interactionSource.collectIsPressedAsState()
    val shape = RoundedCornerShape(10.dp)
    val background = when {
        selected -> Brush.linearGradient(listOf(Color(0xFFFFF469), Color(0xFFB3FF6D)))
        pressed -> Brush.linearGradient(listOf(Color(0x3370F4FF), Color(0x2270F4FF)))
        else -> Brush.linearGradient(listOf(Color(0x16FFFFFF), Color(0x0FFFFFFF)))
    }
    Box(
        modifier = modifier
            .height(32.dp)
            .clip(shape)
            .background(background)
            .border(
                width = 1.dp,
                color = if (selected) Color(0x66FFFFFF) else Color(0x2AA5ECFF),
                shape = shape,
            )
            .clickable(
                interactionSource = interactionSource,
                indication = null,
                onClick = onClick,
            ),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = preset.label,
            color = if (selected) Color(0xFF07244C) else Color(0xDDEEFFFF),
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Black,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 4.dp),
        )
    }
}

@Composable
private fun EqualizerBandControl(
    band: EqualizerBandSpec,
    gainDb: Float,
    sliderHeight: Dp,
    onGainChange: (Float) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            text = formatEqualizerGain(gainDb),
            color = Color(0xFFFFF469),
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Black,
            maxLines = 1,
        )
        EqualizerVerticalSlider(
            gainDb = gainDb,
            onGainChange = onGainChange,
            modifier = Modifier
                .height(sliderHeight)
                .width(28.dp),
        )
        Text(
            text = band.name,
            color = Color(0xEAF4FDFF),
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Black,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.Center,
        )
        Text(
            text = band.frequency,
            color = Color(0x93E2F6F9),
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Bold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun EqualizerVerticalSlider(
    gainDb: Float,
    onGainChange: (Float) -> Unit,
    modifier: Modifier = Modifier,
) {
    val clampedGain = clampEqualizerGainForUi(gainDb)
    val level = equalizerLevelPercent(clampedGain)
    Canvas(
        modifier = modifier
            .pointerInput(Unit) {
                awaitEachGesture {
                    val down = awaitFirstDown(requireUnconsumed = false)
                    fun updateGain(y: Float) {
                        val height = size.height.toFloat().coerceAtLeast(1f)
                        val ratio = 1f - (y / height).coerceIn(0f, 1f)
                        onGainChange(clampEqualizerGainForUi(EqualizerGainMinDb + ratio * (EqualizerGainMaxDb - EqualizerGainMinDb)))
                    }
                    updateGain(down.position.y)
                    drag(down.id) { change ->
                        updateGain(change.position.y)
                        change.consume()
                    }
                }
            },
    ) {
        val trackWidth = 10.dp.toPx()
        val thumbRadius = 10.5.dp.toPx()
        val centerX = size.width / 2f
        val trackTop = thumbRadius
        val trackBottom = size.height - thumbRadius
        val trackHeight = (trackBottom - trackTop).coerceAtLeast(1f)
        val fillTop = trackTop + trackHeight * (1f - level)
        val thumbY = fillTop.coerceIn(trackTop, trackBottom)

        drawRoundRect(
            brush = Brush.verticalGradient(
                listOf(
                    Color(0xB8FF70DA),
                    Color(0xB870F4FF),
                    Color(0xAEB3FF6D),
                ),
            ),
            topLeft = Offset(centerX - trackWidth / 2f, trackTop),
            size = Size(trackWidth, trackHeight),
            cornerRadius = CornerRadius(trackWidth / 2f, trackWidth / 2f),
        )
        drawRoundRect(
            brush = Brush.verticalGradient(
                listOf(Color(0xFFFFF469), Color(0xFF70F4FF)),
            ),
            topLeft = Offset(centerX - trackWidth / 2f, fillTop),
            size = Size(trackWidth, trackBottom - fillTop),
            cornerRadius = CornerRadius(trackWidth / 2f, trackWidth / 2f),
        )
        drawCircle(
            brush = Brush.radialGradient(
                listOf(
                    Color.White,
                    Color(0xFFFFF469),
                    Color(0xFF70F4FF),
                    Color(0xFFFF70DA),
                ),
            ),
            radius = thumbRadius,
            center = Offset(centerX, thumbY),
        )
        drawCircle(
            color = Color(0xD9FFFFFF),
            radius = thumbRadius,
            center = Offset(centerX, thumbY),
            style = Stroke(width = 2.dp.toPx()),
        )
    }
}

private fun equalizerDisplayName(state: PlayerUiState): String {
    return if (state.isEqualizerCustom) "自定义" else state.equalizerPreset.label
}

private fun equalizerGainAt(state: PlayerUiState, index: Int): Float {
    return clampEqualizerGainForUi(state.equalizerGainsDb.getOrElse(index) { 0f })
}

private fun equalizerLevelPercent(gainDb: Float): Float {
    return ((clampEqualizerGainForUi(gainDb) - EqualizerGainMinDb) / (EqualizerGainMaxDb - EqualizerGainMinDb)).coerceIn(0f, 1f)
}

private fun clampEqualizerGainForUi(gainDb: Float): Float {
    return ((gainDb.coerceIn(EqualizerGainMinDb, EqualizerGainMaxDb) / EqualizerGainStepDb).roundToInt() * EqualizerGainStepDb)
}

private fun formatEqualizerGain(gainDb: Float): String {
    val halfSteps = (clampEqualizerGainForUi(gainDb) * 2f).roundToInt()
    if (halfSteps == 0) {
        return "0"
    }
    val sign = if (halfSteps > 0) "+" else ""
    return if (halfSteps % 2 == 0) {
        "$sign${halfSteps / 2}"
    } else {
        "$sign${halfSteps / 2f}"
    }
}

@Composable
private fun PlaybackModeDropdownMenu(
    expanded: Boolean,
    currentMode: PlaybackMode,
    onSelect: (PlaybackMode) -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    if (!expanded) {
        return
    }
    val menuShape = RoundedCornerShape(15.dp)
    Column(
        modifier = modifier
            .requiredWidth(150.dp)
            .requiredHeight(124.dp)
            .shadow(18.dp, menuShape)
            .background(
                Brush.linearGradient(
                    listOf(
                        Color(0xF40B3761),
                        Color(0xF0082548),
                        Color(0xF2051835),
                    ),
                ),
                menuShape,
            )
            .border(1.dp, Color(0x46A9E8FF), menuShape)
            .padding(vertical = 5.dp),
    ) {
        PlaybackMode.values().forEach { mode ->
            PlaybackModeDropdownMenuItem(
                mode = mode,
                selected = mode == currentMode,
                onClick = { onSelect(mode) },
            )
        }
    }
}

@Composable
private fun PlaybackModeDropdownMenuItem(
    mode: PlaybackMode,
    selected: Boolean,
    onClick: () -> Unit,
) {
    val interactionSource = remember { MutableInteractionSource() }
    val pressed by interactionSource.collectIsPressedAsState()
    val itemShape = RoundedCornerShape(10.dp)
    val icon = playbackModeMiniIcon(mode)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(38.dp)
            .padding(horizontal = 6.dp, vertical = 2.dp)
            .clip(itemShape)
            .background(
                when {
                    pressed -> Color(0x3670D7FF)
                    selected -> Color(0x3B0A84FF)
                    else -> Color.Transparent
                },
            )
            .clickable(
                interactionSource = interactionSource,
                indication = null,
                onClick = onClick,
            )
            .padding(horizontal = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        MiniPlayerControlIcon(
            kind = icon,
            modifier = Modifier.size(20.dp),
            contentDescription = null,
        )
        Text(
            text = mode.label,
            color = if (selected) PlayingIndicatorColor else Color(0xF0EFFBFF),
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.Black,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        if (selected) {
            Box(
                modifier = Modifier
                    .size(6.dp)
                    .clip(CircleShape)
                    .background(PlayingIndicatorColor),
            )
        }
    }
}

private fun playbackModeMiniIcon(mode: PlaybackMode): MiniPlayerIconKind {
    return when (mode) {
        PlaybackMode.ORDER -> MiniPlayerIconKind.Repeat
        PlaybackMode.REPEAT_ONE -> MiniPlayerIconKind.RepeatOne
        PlaybackMode.SHUFFLE -> MiniPlayerIconKind.Shuffle
    }
}

@Composable
private fun MiniPlayerControlButton(
    icon: MiniPlayerIconKind,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    selected: Boolean = false,
    enabled: Boolean = true,
    primary: Boolean = false,
    compact: Boolean = false,
) {
    val shape = CircleShape
    val buttonSize = when {
        primary -> 52.dp
        compact -> 38.dp
        else -> 43.dp
    }
    val iconSize = when {
        primary -> 34.dp
        compact -> 23.dp
        else -> 28.dp
    }
    val elevation = when {
        primary -> 13.dp
        selected -> 8.dp
        else -> 4.dp
    }
    val borderColor = when {
        !enabled -> Color(0x1CA9E8FF)
        primary -> Color(0x70FFFFFF)
        selected -> Color(0x72B3FF6D)
        icon == MiniPlayerIconKind.Equalizer -> Color(0x52B3FF6D)
        else -> Color(0x3AA9E8FF)
    }
    val background = when {
        primary -> Brush.radialGradient(
            listOf(
                Color(0xB5FFFFFF),
                Color(0x62FF74DB),
                Color(0x435BE7FF),
            ),
        )
        selected -> Brush.radialGradient(
            listOf(
                Color(0x55FFF469),
                Color(0x486FF6FF),
                Color(0x2DFF5BCB),
            ),
        )
        icon == MiniPlayerIconKind.Equalizer -> Brush.radialGradient(
            listOf(
                Color(0x36B3FF6D),
                Color(0x2E5EEDFF),
                Color(0x1BFF54CA),
            ),
        )
        else -> Brush.radialGradient(
            listOf(
                Color(0x2AB9F7FF),
                Color(0x245EF5FF),
                Color(0x1778E7F2),
            ),
        )
    }

    Box(
        modifier = modifier
            .size(buttonSize)
            .alpha(if (enabled) 1f else 0.42f)
            .shadow(elevation, shape, clip = false)
            .clip(shape)
            .background(background)
            .border(1.dp, borderColor, shape)
            .clickable(
                enabled = enabled,
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onClick,
            ),
        contentAlignment = Alignment.Center,
    ) {
        MiniPlayerControlIcon(
            kind = icon,
            modifier = Modifier.size(iconSize),
            contentDescription = contentDescription,
        )
    }
}

private enum class MiniPlayerIconKind {
    Repeat,
    RepeatOne,
    Shuffle,
    Equalizer,
    Previous,
    Play,
    Pause,
    Next,
}

@Composable
private fun MiniPlayerControlIcon(
    kind: MiniPlayerIconKind,
    modifier: Modifier = Modifier,
    contentDescription: String? = null,
) {
    when (kind) {
        MiniPlayerIconKind.Previous -> WebTransportIcon(
            kind = TransportIconKind.Previous,
            modifier = modifier,
            contentDescription = contentDescription,
        )
        MiniPlayerIconKind.Play -> WebTransportIcon(
            kind = TransportIconKind.Play,
            modifier = modifier,
            contentDescription = contentDescription,
        )
        MiniPlayerIconKind.Pause -> WebTransportIcon(
            kind = TransportIconKind.Pause,
            modifier = modifier,
            contentDescription = contentDescription,
        )
        MiniPlayerIconKind.Next -> WebTransportIcon(
            kind = TransportIconKind.Next,
            modifier = modifier,
            contentDescription = contentDescription,
        )
        else -> Canvas(modifier = modifier) {
            val sx = size.width / 24f
            val sy = size.height / 24f
            fun p(x: Float, y: Float) = Offset(x * sx, y * sy)
            val core = Color(0xF7F9FEFF)
            val cyan = Color(0xFF70F4FF)
            val green = Color(0xFFB3FF6D)
            val yellow = Color(0xFFFFF469)
            val pink = Color(0xFFFF70DA)
            val stroke = Stroke(width = 1.9f * sx, cap = StrokeCap.Round, join = StrokeJoin.Round)
            val accentStroke = Stroke(width = 1.45f * sx, cap = StrokeCap.Round, join = StrokeJoin.Round)

            when (kind) {
                MiniPlayerIconKind.Repeat,
                MiniPlayerIconKind.RepeatOne -> {
                    val top = Path().apply {
                        moveTo(6.2f * sx, 8f * sy)
                        cubicTo(8.1f * sx, 5.9f * sy, 12.8f * sx, 5.8f * sy, 16.3f * sx, 7.7f * sy)
                    }
                    val bottom = Path().apply {
                        moveTo(17.8f * sx, 16f * sy)
                        cubicTo(15.9f * sx, 18.1f * sy, 11.2f * sx, 18.2f * sy, 7.7f * sx, 16.3f * sy)
                    }
                    drawPath(top, color = if (kind == MiniPlayerIconKind.RepeatOne) yellow else cyan, style = stroke)
                    drawPath(bottom, color = core, style = stroke)
                    drawLine(core, p(16.2f, 7.6f), p(13.8f, 5.7f), strokeWidth = 1.8f * sx, cap = StrokeCap.Round)
                    drawLine(core, p(16.2f, 7.6f), p(13.9f, 9.7f), strokeWidth = 1.8f * sx, cap = StrokeCap.Round)
                    drawLine(core, p(7.8f, 16.4f), p(10.2f, 18.3f), strokeWidth = 1.8f * sx, cap = StrokeCap.Round)
                    drawLine(core, p(7.8f, 16.4f), p(10.1f, 14.3f), strokeWidth = 1.8f * sx, cap = StrokeCap.Round)
                    if (kind == MiniPlayerIconKind.RepeatOne) {
                        drawRoundRect(
                            color = green,
                            topLeft = p(11f, 9.2f),
                            size = Size(2.1f * sx, 5.4f * sy),
                            cornerRadius = CornerRadius(1f * sx, 1f * sy),
                        )
                    } else {
                        drawCircle(color = pink, radius = 0.9f * sx, center = p(12f, 12f))
                    }
                }

                MiniPlayerIconKind.Shuffle -> {
                    val upper = Path().apply {
                        moveTo(5.5f * sx, 8.2f * sy)
                        cubicTo(9.1f * sx, 8.2f * sy, 10.3f * sx, 15.8f * sy, 15.4f * sx, 15.8f * sy)
                    }
                    val lower = Path().apply {
                        moveTo(5.5f * sx, 16f * sy)
                        cubicTo(9.5f * sx, 16f * sy, 10.2f * sx, 8.4f * sy, 15.4f * sx, 8.4f * sy)
                    }
                    drawPath(upper, color = green, style = stroke)
                    drawPath(lower, color = core, style = stroke)
                    drawLine(cyan, p(15.4f, 8.4f), p(18.7f, 6.5f), strokeWidth = 1.7f * sx, cap = StrokeCap.Round)
                    drawLine(cyan, p(15.4f, 8.4f), p(18.7f, 10.3f), strokeWidth = 1.7f * sx, cap = StrokeCap.Round)
                    drawLine(cyan, p(15.4f, 15.8f), p(18.7f, 13.9f), strokeWidth = 1.7f * sx, cap = StrokeCap.Round)
                    drawLine(cyan, p(15.4f, 15.8f), p(18.7f, 17.7f), strokeWidth = 1.7f * sx, cap = StrokeCap.Round)
                }

                MiniPlayerIconKind.Equalizer -> {
                    val barWidth = 3.1f * sx
                    val radius = CornerRadius(1.5f * sx, 1.5f * sy)
                    val bars = listOf(
                        Triple(6.2f, 8.4f, 8.8f),
                        Triple(10.4f, 5.6f, 11.6f),
                        Triple(14.6f, 9.8f, 7.4f),
                    )
                    bars.forEachIndexed { index, (x, y, h) ->
                        drawRoundRect(
                            color = when (index) {
                                0 -> green
                                1 -> yellow
                                else -> cyan
                            },
                            topLeft = p(x, y),
                            size = Size(barWidth, h * sy),
                            cornerRadius = radius,
                        )
                    }
                    val wave = Path().apply {
                        moveTo(4.9f * sx, 18.4f * sy)
                        cubicTo(8.2f * sx, 16.7f * sy, 11.6f * sx, 20.1f * sy, 19.1f * sx, 17.6f * sy)
                    }
                    drawPath(wave, color = pink, style = accentStroke)
                }
            }
        }
    }
}

@Composable
private fun LibraryTopTabs(
    state: PlayerUiState,
    onSelectQuality: (TrackQuality) -> Unit,
    onSelectFavorites: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .clip(RoundedCornerShape(24.dp))
            .background(Color(0x1AFFFFFF))
            .padding(4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        LibraryTopTabButton(
            text = TrackQuality.LOSSLESS.label,
            selected = state.libraryContent == LibraryContent.QUALITY && state.quality == TrackQuality.LOSSLESS,
            onClick = { onSelectQuality(TrackQuality.LOSSLESS) },
            modifier = Modifier.weight(1f),
        )
        LibraryTopTabButton(
            text = TrackQuality.LOSSY.label,
            selected = state.libraryContent == LibraryContent.QUALITY && state.quality == TrackQuality.LOSSY,
            onClick = { onSelectQuality(TrackQuality.LOSSY) },
            modifier = Modifier.weight(1f),
        )
        LibraryTopTabButton(
            text = "我喜欢",
            selected = state.libraryContent == LibraryContent.FAVORITES,
            onClick = onSelectFavorites,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun LibraryTopTabButton(
    text: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            .height(44.dp)
            .clip(RoundedCornerShape(20.dp))
            .background(if (selected) Color(0x332EEBD3) else Color.Transparent)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = text,
            color = if (selected) PlayingIndicatorColor else Color(0xFFD8ECF6),
            style = MaterialTheme.typography.titleSmall,
            fontWeight = if (selected) FontWeight.Black else FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun FavoriteCategoryRail(
    categories: List<FavoriteCategory>,
    categoryLimit: Int,
    activeCategoryId: Long?,
    canCreate: Boolean,
    actionCategoryId: Long?,
    onSelectAll: () -> Unit,
    onSelectCategory: (FavoriteCategory) -> Unit,
    onCategoryAction: (FavoriteCategory) -> Unit,
    onRenameCategory: (FavoriteCategory) -> Unit,
    onDeleteCategory: (FavoriteCategory) -> Unit,
    onDismissCategoryAction: () -> Unit,
    onCreate: () -> Unit,
    modifier: Modifier = Modifier,
) {
    LazyColumn(
        modifier = modifier,
        contentPadding = PaddingValues(vertical = 2.dp),
        verticalArrangement = Arrangement.spacedBy(5.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        item(key = "all") {
            FavoriteCategoryRailItem(
                text = "全部",
                badgeText = "${categories.size}/$categoryLimit",
                selected = activeCategoryId == null,
                onClick = onSelectAll,
            )
        }
        items(categories, key = { it.id }) { category ->
            Box(modifier = Modifier.fillMaxWidth()) {
                FavoriteCategoryRailItem(
                    text = category.name,
                    selected = activeCategoryId == category.id,
                    onClick = { onSelectCategory(category) },
                    onLongClick = { onCategoryAction(category) },
                )
                FavoriteCategoryContextMenu(
                    expanded = actionCategoryId == category.id,
                    onRename = { onRenameCategory(category) },
                    onDelete = { onDeleteCategory(category) },
                    onDismiss = onDismissCategoryAction,
                )
            }
        }
        item(key = "create") {
            FavoriteCategoryRailItem(
                text = "＋",
                selected = false,
                enabled = canCreate,
                onClick = onCreate,
            )
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun FavoriteCategoryRailItem(
    text: String,
    badgeText: String? = null,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    onLongClick: (() -> Unit)? = null,
) {
    val textColor = when {
        selected -> PlayingIndicatorColor
        enabled -> Color(0xFFD7ECFF)
        else -> Color(0x66D7ECFF)
    }
    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(42.dp)
            .clip(RoundedCornerShape(18.dp))
            .background(if (selected) Color(0x2A77F56C) else Color(0x0FFFFFFF))
            .combinedClickable(
                enabled = enabled,
                onClick = onClick,
                onLongClick = onLongClick,
            )
            .padding(horizontal = 6.dp),
        contentAlignment = Alignment.Center,
    ) {
        if (badgeText.isNullOrBlank()) {
            Text(
                text = text,
                color = textColor,
                style = MaterialTheme.typography.labelLarge,
                fontWeight = if (selected) FontWeight.Black else FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                textAlign = TextAlign.Center,
            )
        } else {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Text(
                    text = text,
                    color = textColor,
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = if (selected) FontWeight.Black else FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    textAlign = TextAlign.Center,
                )
                Text(
                    text = badgeText,
                    color = textColor,
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.Black,
                    maxLines = 1,
                )
            }
        }
    }
}

private fun libraryEmptyText(state: PlayerUiState, activeCategory: FavoriteCategory?): String {
    val hasCategory = activeCategory != null
    return when (state.libraryContent) {
        LibraryContent.QUALITY -> when (state.quality) {
            TrackQuality.LOSSLESS -> if (hasCategory) "该分类暂无高品质音乐" else "暂无高品质音乐"
            TrackQuality.LOSSY -> if (hasCategory) "该分类暂无轻音乐" else "暂无轻音乐"
        }
        LibraryContent.FAVORITES,
        LibraryContent.CATEGORY -> if (hasCategory) "该分类暂无喜欢的歌曲" else "还没有喜欢的歌曲"
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun TrackRow(
    track: Track,
    isCurrent: Boolean,
    isPlaying: Boolean,
    isFavorite: Boolean,
    showHighQualityBadge: Boolean,
    onPlay: () -> Unit,
    onMore: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        color = if (isCurrent) Color(0x3339A4FF) else Color.Transparent,
        shape = RoundedCornerShape(20.dp),
        modifier = modifier
            .widthIn(max = MusicListMaxWidth)
            .fillMaxWidth()
            .height(MusicListRowHeight)
            .combinedClickable(
                onClick = onPlay,
                onLongClick = onMore,
            ),
    ) {
        Row(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 12.dp, vertical = 7.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val titleColor = if (isCurrent) PlayingIndicatorColor else Color(0xFFF3FAFF)
            val artistColor = if (isCurrent) PlayingIndicatorColor else Color(0xFFB9D2E6)
            val metaColor = if (isCurrent) PlayingIndicatorColor else Color(0xFFB8F3EF)
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(2.dp, Alignment.CenterVertically),
            ) {
                Text(
                    text = track.title.ifBlank { "未知歌曲" },
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = if (isCurrent) FontWeight.Black else FontWeight.SemiBold,
                    color = titleColor,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = track.artist.ifBlank { "未知歌手" },
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Medium,
                        color = artistColor,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    if (showHighQualityBadge) {
                        Text(
                            text = "高品质",
                            color = if (isCurrent) PlayingIndicatorColor else Color(0xFFFFF469),
                            style = MaterialTheme.typography.labelMedium,
                            fontWeight = FontWeight.Black,
                            maxLines = 1,
                        )
                    }
                    if (isFavorite) {
                        Text(
                            text = "我喜欢",
                            color = metaColor,
                            style = MaterialTheme.typography.labelMedium,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1,
                        )
                    }
                }
            }
            if (isCurrent) {
                PlayingEqualizer(
                    active = isPlaying,
                    modifier = Modifier
                        .width(26.dp)
                        .height(24.dp),
                )
            }
        }
    }
}

@Composable
private fun PlayingEqualizer(
    active: Boolean,
    modifier: Modifier = Modifier,
) {
    var phase by remember { mutableStateOf(0f) }

    LaunchedEffect(active) {
        if (!active) {
            phase = 0f
            return@LaunchedEffect
        }
        while (true) {
            withFrameNanos { frameTime ->
                phase = (frameTime / 1_000_000_000f) * 4.2f
            }
        }
    }

    Canvas(modifier = modifier) {
        val barWidth = size.width * 0.18f
        val gap = size.width * 0.16f
        val totalWidth = barWidth * 3f + gap * 2f
        val startX = (size.width - totalWidth) / 2f
        val minHeight = size.height * 0.24f
        val maxHeight = size.height * 0.94f
        val green = PlayingIndicatorColor
        val inactiveGreen = PlayingIndicatorColor
        val phases = listOf(0f, 1.72f, 3.41f)
        val usedHeights = mutableListOf<Float>()

        phases.forEachIndexed { index, offset ->
            val wave = if (active) {
                kotlin.math.sin((phase + offset).toDouble()).toFloat()
            } else {
                listOf(-0.25f, 0.35f, -0.55f)[index]
            }
            val normalized = ((wave + 1f) / 2f).coerceIn(0f, 1f)
            val heightBias = listOf(0.00f, 0.12f, -0.10f)[index]
            var barHeight = (minHeight + (maxHeight - minHeight) * normalized + size.height * heightBias)
                .coerceIn(minHeight, maxHeight)
            usedHeights.forEach { usedHeight ->
                if (kotlin.math.abs(barHeight - usedHeight) < size.height * 0.08f) {
                    barHeight = (barHeight + size.height * (0.11f + index * 0.04f)).coerceIn(minHeight, maxHeight)
                    if (kotlin.math.abs(barHeight - usedHeight) < size.height * 0.08f) {
                        barHeight = (barHeight - size.height * (0.17f + index * 0.03f)).coerceIn(minHeight, maxHeight)
                    }
                }
            }
            usedHeights += barHeight
            val left = startX + index * (barWidth + gap)
            val bounceWave = if (active) {
                kotlin.math.sin((phase * 1.28f + offset * 1.37f).toDouble()).toFloat()
            } else {
                listOf(0.18f, -0.12f, 0.06f)[index]
            }
            val centerY = (size.height / 2f + bounceWave * size.height * 0.16f)
                .coerceIn(barHeight / 2f, size.height - barHeight / 2f)
            val top = (centerY - barHeight / 2f).coerceIn(0f, size.height - barHeight)

            drawRoundRect(
                color = if (active) green else inactiveGreen.copy(alpha = 0.78f),
                topLeft = Offset(left, top),
                size = Size(barWidth, barHeight),
                cornerRadius = CornerRadius(barWidth / 2f, barWidth / 2f),
            )
        }
    }
}

@Composable
private fun TrackContextMenu(
    expanded: Boolean,
    showingCategories: Boolean,
    isFavorite: Boolean,
    isInActiveCategory: Boolean,
    isCached: Boolean,
    isCaching: Boolean,
    cacheActionEnabled: Boolean,
    categories: List<FavoriteCategory>,
    joinedCategoryIds: Set<Long>,
    onToggleFavorite: () -> Unit,
    onShowCategories: () -> Unit,
    onAddToCategory: (FavoriteCategory) -> Unit,
    onCacheTrack: () -> Unit,
    onRemoveCachedTrack: () -> Unit,
    onRemoveFromCategory: (() -> Unit)?,
    onDismiss: () -> Unit,
) {
    val menuShape = RoundedCornerShape(14.dp)
    val cacheActionText = when {
        isCaching -> "缓存中..."
        isCached -> "取消缓存"
        else -> "缓存到本地"
    }
    val menuWidth = contextMenuWidthForLabels(
        labels = if (showingCategories) {
            if (categories.isEmpty()) listOf("暂无分类") else categories.map { it.name }
        } else {
            listOf(
                if (isInActiveCategory && onRemoveFromCategory != null) "移出分类" else if (isFavorite) "取消收藏" else "收藏",
                "加入分类",
                cacheActionText,
            )
        },
        hasTrailingText = showingCategories && categories.any { it.id in joinedCategoryIds },
    )
    DropdownMenu(
        expanded = expanded,
        onDismissRequest = onDismiss,
        modifier = Modifier
            .width(menuWidth)
            .shadow(18.dp, menuShape)
            .background(
                Brush.linearGradient(
                    listOf(
                        Color(0xF00C365C),
                        Color(0xE909264C),
                        Color(0xEB061938),
                    ),
                ),
                menuShape,
            )
            .border(1.dp, Color(0x38A2DCFF), menuShape),
        shape = menuShape,
        containerColor = Color.Transparent,
        tonalElevation = 0.dp,
        shadowElevation = 0.dp,
    ) {
        if (showingCategories) {
            if (categories.isEmpty()) {
                CompactContextMenuItem(
                    text = "暂无分类",
                    enabled = false,
                    onClick = {},
                )
            } else {
                categories.forEach { category ->
                    val joined = category.id in joinedCategoryIds
                    CompactContextMenuItem(
                        text = category.name,
                        trailingText = if (joined) "已加入" else null,
                        selected = joined,
                        centered = false,
                        enabled = !joined,
                        onClick = { onAddToCategory(category) },
                    )
                }
            }
        } else {
            if (isInActiveCategory && onRemoveFromCategory != null) {
                CompactContextMenuItem(
                    text = "移出分类",
                    onClick = onRemoveFromCategory,
                )
            } else {
                CompactContextMenuItem(
                    text = if (isFavorite) "取消收藏" else "收藏",
                    onClick = onToggleFavorite,
                )
            }
            CompactContextMenuItem(
                text = "加入分类",
                onClick = onShowCategories,
            )
            CompactContextMenuItem(
                text = cacheActionText,
                enabled = cacheActionEnabled && !isCaching,
                onClick = if (isCached) onRemoveCachedTrack else onCacheTrack,
            )
        }
    }
}

@Composable
private fun CompactContextMenuItem(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    trailingText: String? = null,
    centered: Boolean = true,
    selected: Boolean = false,
    enabled: Boolean = true,
    contentColor: Color? = null,
) {
    val interactionSource = remember { MutableInteractionSource() }
    val pressed by interactionSource.collectIsPressedAsState()
    val backgroundColor = when {
        pressed -> Color(0x336EB9EE)
        selected -> Color(0x2E0A84FF)
        else -> Color.Transparent
    }
    Row(
        modifier = modifier
            .fillMaxWidth()
            .height(42.dp)
            .padding(horizontal = 6.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(backgroundColor)
            .clickable(
                enabled = enabled,
                interactionSource = interactionSource,
                indication = null,
                onClick = onClick,
            )
            .padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = if (centered && trailingText == null) Arrangement.Center else Arrangement.Start,
    ) {
        Text(
            text = text,
            color = contentColor ?: if (enabled || selected) Color(0xF0EFFBFF) else Color(0x8AEFFBFF),
            style = MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.Bold,
            textAlign = if (centered) TextAlign.Center else TextAlign.Start,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = if (centered && trailingText == null) Modifier else Modifier.weight(1f),
        )
        if (trailingText != null) {
            Text(
                text = trailingText,
                color = Color(0xC484D0FF),
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
            )
        }
    }
}

@Composable
private fun FavoriteCategoryContextMenu(
    expanded: Boolean,
    onRename: () -> Unit,
    onDelete: () -> Unit,
    onDismiss: () -> Unit,
) {
    val menuShape = RoundedCornerShape(14.dp)
    val menuWidth = contextMenuWidthForLabels(listOf("重命名", "删除"))
    DropdownMenu(
        expanded = expanded,
        onDismissRequest = onDismiss,
        offset = DpOffset(x = 66.dp, y = (-4).dp),
        modifier = Modifier
            .width(menuWidth)
            .shadow(18.dp, menuShape)
            .background(
                Brush.linearGradient(
                    listOf(
                        Color(0xF00C365C),
                        Color(0xE909264C),
                        Color(0xEB061938),
                    ),
                ),
                menuShape,
            )
            .border(1.dp, Color(0x38A2DCFF), menuShape),
        shape = menuShape,
        containerColor = Color.Transparent,
        tonalElevation = 0.dp,
        shadowElevation = 0.dp,
    ) {
        CompactContextMenuItem(
            text = "重命名",
            centered = false,
            onClick = onRename,
        )
        CompactContextMenuItem(
            text = "删除",
            centered = false,
            contentColor = Color(0xFFFFB4AB),
            onClick = onDelete,
        )
    }
}

private fun contextMenuWidthForLabels(
    labels: List<String>,
    hasTrailingText: Boolean = false,
): Dp {
    val maxTextUnits = labels.maxOfOrNull(::weightedTextUnits) ?: 0
    val trailingReserve = if (hasTrailingText) 48 else 0
    return (maxTextUnits * 8 + trailingReserve + 36).dp.coerceIn(112.dp, 220.dp)
}

private fun weightedTextUnits(text: String): Int {
    return text.sumOf { char ->
        if (char.code <= 0x7F) 1 else 2
    }
}

@Composable
private fun CompactAppDialog(
    title: String,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
    actions: @Composable () -> Unit,
) {
    val panelShape = RoundedCornerShape(18.dp)
    val backdropInteraction = remember { MutableInteractionSource() }
    val panelInteraction = remember { MutableInteractionSource() }
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color(0x2405172B))
                .clickable(
                    interactionSource = backdropInteraction,
                    indication = null,
                    onClick = onDismiss,
                )
                .padding(24.dp),
            contentAlignment = Alignment.Center,
        ) {
            Column(
                modifier = modifier
                    .widthIn(max = 320.dp)
                    .shadow(18.dp, panelShape)
                    .clip(panelShape)
                    .background(compactOverlayBrush())
                    .border(1.dp, Color(0x38A2DCFF), panelShape)
                    .clickable(
                        interactionSource = panelInteraction,
                        indication = null,
                        onClick = {},
                    )
                    .padding(horizontal = 15.dp, vertical = 13.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text(
                    text = title,
                    color = Color(0xFFF0FBFF),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Black,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                content()
                Row(
                    modifier = Modifier.align(Alignment.End),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    actions()
                }
            }
        }
    }
}

private fun compactOverlayBrush(): Brush {
    return Brush.linearGradient(
        listOf(
            Color(0xF20C365C),
            Color(0xEE09264C),
            Color(0xF0061938),
        ),
    )
}

@Composable
private fun CompactDialogTextField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    maxLength: Int,
) {
    val fieldShape = RoundedCornerShape(11.dp)
    val textLength = value.codePointCount(0, value.length)
    Column(
        modifier = Modifier
            .widthIn(min = 220.dp, max = 280.dp)
            .width(IntrinsicSize.Max),
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        BasicTextField(
            value = value,
            onValueChange = { onValueChange(it.truncateToCodePointLimit(maxLength)) },
            singleLine = true,
            cursorBrush = SolidColor(Color(0xFF8FEFE3)),
            textStyle = MaterialTheme.typography.bodyMedium.copy(
                color = Color(0xFFF1FBFF),
                fontWeight = FontWeight.SemiBold,
            ),
            modifier = Modifier
                .fillMaxWidth()
                .height(42.dp)
                .clip(fieldShape)
                .background(Color(0x2A6EB9EE))
                .border(1.dp, Color(0x42A2DCFF), fieldShape)
                .padding(horizontal = 11.dp),
            decorationBox = { innerTextField ->
                Box(contentAlignment = Alignment.CenterStart) {
                    if (value.isEmpty()) {
                        Text(
                            text = placeholder,
                            color = Color(0x8FD4EAF6),
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    }
                    innerTextField()
                }
            },
        )
        Text(
            text = "名称长度 $textLength/$maxLength",
            color = Color(0xA6B7D8EC),
            style = MaterialTheme.typography.labelSmall,
            modifier = Modifier.align(Alignment.End),
        )
    }
}

@Composable
private fun FavoriteCategoryQuotaLine(
    categoryCount: Int,
    categoryLimit: Int,
) {
    val isFull = categoryCount >= categoryLimit
    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Row(
            modifier = Modifier.widthIn(min = 220.dp, max = 280.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "自定义分类",
                color = Color(0xCCD7ECF6),
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = "$categoryCount/$categoryLimit",
                color = if (isFull) Color(0xFFFFB4AB) else PlayingIndicatorColor,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.Black,
            )
        }
        if (isFull) {
            Text(
                text = "已达上限，请先删除不需要的分类",
                color = Color(0xFFFFB4AB),
                style = MaterialTheme.typography.labelSmall,
            )
        }
    }
}

private fun String.truncateToCodePointLimit(maxCodePoints: Int): String {
    if (maxCodePoints <= 0) return ""
    return if (codePointCount(0, length) <= maxCodePoints) {
        this
    } else {
        substring(0, offsetByCodePoints(0, maxCodePoints))
    }
}

@Composable
private fun CompactDialogAction(
    text: String,
    onClick: () -> Unit,
    enabled: Boolean = true,
    primary: Boolean = false,
    destructive: Boolean = false,
) {
    val interactionSource = remember { MutableInteractionSource() }
    val pressed by interactionSource.collectIsPressedAsState()
    val shape = RoundedCornerShape(10.dp)
    val backgroundColor = when {
        !enabled -> Color(0x102B6C93)
        destructive && pressed -> Color(0x42FF6B73)
        destructive -> Color(0x24FF6B73)
        primary && pressed -> Color(0x5C0A84FF)
        primary -> Color(0x3D0A84FF)
        pressed -> Color(0x336EB9EE)
        else -> Color.Transparent
    }
    Box(
        modifier = Modifier
            .height(34.dp)
            .clip(shape)
            .background(backgroundColor)
            .clickable(
                enabled = enabled,
                interactionSource = interactionSource,
                indication = null,
                onClick = onClick,
            )
            .padding(horizontal = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = text,
            color = when {
                !enabled -> Color(0x70D7EBF6)
                destructive -> Color(0xFFFFB4AB)
                primary -> Color(0xFFEAF9FF)
                else -> Color(0xDDEAF7FF)
            },
            style = MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.Bold,
            maxLines = 1,
        )
    }
}

@Composable
private fun CreateFavoriteCategoryDialog(
    categoryCount: Int,
    categoryLimit: Int,
    categoryNameMaxLength: Int,
    isSubmitting: Boolean,
    onConfirm: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    var name by rememberSaveable { mutableStateOf("") }
    val isCategoryFull = categoryCount >= categoryLimit
    CompactAppDialog(
        title = "新建分类",
        onDismiss = onDismiss,
        content = {
            FavoriteCategoryQuotaLine(
                categoryCount = categoryCount,
                categoryLimit = categoryLimit,
            )
            CompactDialogTextField(
                value = name,
                onValueChange = { name = it },
                placeholder = "分类名称",
                maxLength = categoryNameMaxLength,
            )
        },
        actions = {
            CompactDialogAction(text = "取消", onClick = onDismiss)
            CompactDialogAction(
                text = when {
                    isSubmitting -> "创建中"
                    isCategoryFull -> "已满"
                    else -> "创建"
                },
                onClick = { onConfirm(name) },
                enabled = name.isNotBlank() && !isSubmitting && !isCategoryFull,
                primary = true,
            )
        },
    )
}

@Composable
private fun RenameFavoriteCategoryDialog(
    category: FavoriteCategory,
    categoryNameMaxLength: Int,
    isSubmitting: Boolean,
    onConfirm: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    var name by rememberSaveable(category.id) { mutableStateOf(category.name) }
    val trimmedName = name.trim()

    CompactAppDialog(
        title = "重命名分类",
        onDismiss = onDismiss,
        content = {
            CompactDialogTextField(
                value = name,
                onValueChange = { name = it },
                placeholder = "分类名称",
                maxLength = categoryNameMaxLength,
            )
        },
        actions = {
            CompactDialogAction(text = "取消", onClick = onDismiss)
            CompactDialogAction(
                text = if (isSubmitting) "保存中" else "保存",
                onClick = { onConfirm(name) },
                enabled = trimmedName.isNotBlank() && trimmedName != category.name && !isSubmitting,
                primary = true,
            )
        },
    )
}

@Composable
private fun DeleteFavoriteCategoryDialog(
    category: FavoriteCategory,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    CompactAppDialog(
        title = "删除分类",
        onDismiss = onDismiss,
        content = {
            Text(
                text = "确定删除“${category.name}”吗？歌曲和收藏不会被删除。",
                color = Color(0xD7D9EEF8),
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.widthIn(max = 280.dp),
            )
        },
        actions = {
            CompactDialogAction(text = "取消", onClick = onDismiss)
            CompactDialogAction(text = "删除", onClick = onConfirm, destructive = true)
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
            .background(webBlueGradient())
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
                            label = { Text("本地音乐缓存播放") },
                        )
                    }
                }
                WebTransportButton(
                    icon = if (state.isPlaying) TransportIconKind.Pause else TransportIconKind.Play,
                    contentDescription = if (state.isPlaying) "暂停" else "播放",
                    isPlayToggle = true,
                    onClick = viewModel::togglePlayback,
                )
            }
            LiveKaraokeLyrics(
                lines = state.currentLyrics?.lines.orEmpty(),
                trackId = track.id,
                positionMs = state.currentPositionMs,
                isPlaying = state.isPlaying,
                viewModel = viewModel,
                modifier = Modifier
                    .weight(1f)
                    .padding(bottom = lyricsBottomPadding),
            )
        }
    }
}

@Composable
private fun LiveKaraokeLyrics(
    lines: List<LyricLine>,
    trackId: Long,
    positionMs: Long,
    isPlaying: Boolean,
    viewModel: PlayerViewModel,
    modifier: Modifier = Modifier,
) {
    val livePositionMs by produceState(
        positionMs,
        trackId,
        isPlaying,
        if (isPlaying) 0L else positionMs,
    ) {
        if (!isPlaying) {
            value = positionMs
            return@produceState
        }
        while (true) {
            withFrameNanos { }
            value = viewModel.playbackPositionMs()
        }
    }
    KaraokeLyrics(
        lines = lines,
        positionSeconds = livePositionMs / 1_000.0,
        onSeekAndPlay = { seconds ->
            viewModel.seekToAndPlay((seconds * 1_000).toLong())
        },
        modifier = modifier,
    )
}

private fun webBlueGradient(): Brush {
    return Brush.verticalGradient(
        listOf(
            Color(0xFF8FB6C8),
            Color(0xFF6695A7),
            Color(0xFF48778A),
            Color(0xFF2B5A70),
            Color(0xFF153348),
        ),
    )
}

@Composable
private fun KaraokeLyrics(
    lines: List<LyricLine>,
    positionSeconds: Double,
    onSeekAndPlay: (Double) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (lines.isEmpty()) {
        EmptyState(title = "暂无歌词", subtitle = "服务器暂未返回这首歌的歌词。")
        return
    }

    val timedLines = lines.mapIndexedNotNull { index, line -> line.timeSeconds?.let { index to it } }
    val activeIndex = timedLines.lastOrNull { it.second <= positionSeconds }?.first ?: 0
    val listState = rememberLazyListState()
    val isUserDragging by listState.interactionSource.collectIsDraggedAsState()
    var isBrowsingLyrics by remember(lines) { mutableStateOf(false) }
    var selectedLineIndex by remember(lines) { mutableStateOf<Int?>(null) }
    var manualInteractionVersion by remember(lines) { mutableStateOf(0) }

    LaunchedEffect(activeIndex, isBrowsingLyrics, lines.size) {
        if (!isBrowsingLyrics) {
            listState.scrollToItem((activeIndex - 4).coerceAtLeast(0))
        }
    }

    LaunchedEffect(isUserDragging) {
        if (isUserDragging) {
            isBrowsingLyrics = true
            manualInteractionVersion += 1
        }
    }

    LaunchedEffect(listState) {
        snapshotFlow { listState.isScrollInProgress }.collect { isScrolling ->
            if (!isScrolling && isBrowsingLyrics) {
                selectedLineIndex = centeredTimedLyricIndex(listState, lines)
                manualInteractionVersion += 1
            }
        }
    }

    LaunchedEffect(isBrowsingLyrics, manualInteractionVersion) {
        if (isBrowsingLyrics) {
            delay(5_000L)
            isBrowsingLyrics = false
            selectedLineIndex = null
        }
    }

    LazyColumn(
        state = listState,
        modifier = modifier
            .fillMaxWidth()
            .fillMaxHeight()
            .padding(top = 12.dp),
        contentPadding = PaddingValues(vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterVertically),
    ) {
        items(lines.size) { index ->
            val line = lines[index]
            val isActive = index == activeIndex
            val distanceFromActive = kotlin.math.abs(index - activeIndex)
            val lineTimeSeconds = line.timeSeconds
            val showJumpAction = isBrowsingLyrics &&
                selectedLineIndex == index
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = if (isActive) 42.dp else 34.dp),
                contentAlignment = Alignment.Center,
            ) {
                SmoothKaraokeLine(
                    line = line,
                    lineIndex = index,
                    lines = lines,
                    activeIndex = activeIndex,
                    positionSeconds = positionSeconds,
                    isActive = isActive,
                    distanceFromActive = distanceFromActive,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(end = if (showJumpAction) 88.dp else 0.dp),
                )
                if (showJumpAction && lineTimeSeconds != null) {
                    LyricLineJumpAction(
                        timeSeconds = lineTimeSeconds,
                        onClick = {
                            isBrowsingLyrics = false
                            selectedLineIndex = null
                            onSeekAndPlay(lineTimeSeconds)
                        },
                        modifier = Modifier
                            .align(Alignment.CenterEnd)
                            .padding(end = 4.dp),
                    )
                }
            }
        }
    }
}

private fun centeredTimedLyricIndex(listState: LazyListState, lines: List<LyricLine>): Int? {
    val layoutInfo = listState.layoutInfo
    val visibleItems = layoutInfo.visibleItemsInfo
    if (visibleItems.isEmpty()) {
        return null
    }
    val viewportCenter = (layoutInfo.viewportStartOffset + layoutInfo.viewportEndOffset) / 2
    return visibleItems
        .filter { item -> lines.getOrNull(item.index)?.timeSeconds != null }
        .minByOrNull { item ->
            kotlin.math.abs(item.offset + item.size / 2 - viewportCenter)
        }
        ?.index
}

@Composable
private fun LyricLineJumpAction(
    timeSeconds: Double,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .clip(RoundedCornerShape(999.dp))
            .background(Color(0x33153348))
            .border(1.dp, Color(0x55D6F6FF), RoundedCornerShape(999.dp))
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onClick,
            )
            .padding(horizontal = 9.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Icon(
            imageVector = Icons.Default.PlayArrow,
            contentDescription = null,
            tint = Color(0xFFEAFBFF),
            modifier = Modifier.size(15.dp),
        )
        Text(
            text = formatDuration((timeSeconds * 1_000).toLong()),
            color = Color(0xFFEAFBFF),
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.Bold,
        )
    }
}

@Composable
private fun SmoothKaraokeLine(
    line: LyricLine,
    lineIndex: Int,
    lines: List<LyricLine>,
    activeIndex: Int,
    positionSeconds: Double,
    isActive: Boolean,
    distanceFromActive: Int,
    modifier: Modifier = Modifier,
) {
    val lineText = remember(line) {
        line.text.ifBlank { line.words.joinToString(separator = "") { word -> word.text } }
    }
    val textStyle = if (isActive) MaterialTheme.typography.headlineSmall else MaterialTheme.typography.titleMedium
    val textWeight = if (isActive) FontWeight.Black else FontWeight.Medium
    val lineAlpha = if (distanceFromActive >= 4) 0.72f else 1f

    if (isActive) {
        SmoothKaraokeActiveLine(
            line = line,
            fallbackText = lineText,
            positionSeconds = positionSeconds,
            style = textStyle,
            modifier = modifier
                .fillMaxWidth()
                .alpha(lineAlpha),
        )
    } else {
        Text(
            text = lineText,
            style = textStyle,
            fontWeight = textWeight,
            color = if (lineIndex < activeIndex) Color(0xFFE7F7FF) else Color(0xFFC2DDEE),
            textAlign = TextAlign.Center,
            softWrap = true,
            overflow = TextOverflow.Visible,
            modifier = modifier
                .fillMaxWidth()
                .alpha(lineAlpha),
        )
    }
}

@Composable
private fun SmoothKaraokeActiveLine(
    line: LyricLine,
    fallbackText: String,
    positionSeconds: Double,
    style: androidx.compose.ui.text.TextStyle,
    modifier: Modifier = Modifier,
) {
    val timedText = remember(line, fallbackText) {
        line.words.joinToString(separator = "") { word -> word.text }
            .takeIf { it.isNotEmpty() }
            ?: fallbackText
    }
    val reveal = calculateLyricReveal(
        words = line.words,
        text = timedText,
        positionSeconds = positionSeconds,
    )
    var textLayout by remember(timedText) { mutableStateOf<TextLayoutResult?>(null) }

    Box(modifier = modifier) {
        Text(
            text = timedText,
            style = style,
            fontWeight = FontWeight.Black,
            color = Color(0xFFD6ECFA),
            textAlign = TextAlign.Center,
            softWrap = true,
            overflow = TextOverflow.Visible,
            modifier = Modifier.fillMaxWidth(),
        )
        Text(
            text = timedText,
            style = style,
            fontWeight = FontWeight.Black,
            color = Color(0xFFFFF3C6),
            textAlign = TextAlign.Center,
            softWrap = true,
            overflow = TextOverflow.Visible,
            onTextLayout = { layout ->
                if (textLayout != layout) {
                    textLayout = layout
                }
            },
            modifier = Modifier
                .fillMaxWidth()
                .drawWithContent {
                    val layout = textLayout ?: return@drawWithContent
                    if (reveal.characterOffset >= timedText.length) {
                        drawContent()
                        return@drawWithContent
                    }
                    if (reveal.characterOffset <= 0 && reveal.characterProgress <= 0f) {
                        return@drawWithContent
                    }

                    val offset = reveal.characterOffset.coerceIn(0, timedText.lastIndex)
                    val activeLine = layout.getLineForOffset(offset)
                    for (lineIndex in 0 until activeLine) {
                        clipRect(
                            left = layout.getLineLeft(lineIndex),
                            top = layout.getLineTop(lineIndex),
                            right = layout.getLineRight(lineIndex),
                            bottom = layout.getLineBottom(lineIndex),
                        ) {
                            this@drawWithContent.drawContent()
                        }
                    }

                    val lineStart = layout.getLineStart(activeLine)
                    val lineEnd = layout.getLineEnd(activeLine, visibleEnd = true)
                    val characterOffset = offset.coerceIn(lineStart, lineEnd)
                    val characterStartX = layout.getHorizontalPosition(characterOffset, usePrimaryDirection = true)
                    val nextOffset = (characterOffset + 1).coerceAtMost(lineEnd)
                    val characterEndX = if (nextOffset > characterOffset) {
                        layout.getHorizontalPosition(nextOffset, usePrimaryDirection = true)
                    } else {
                        characterStartX
                    }
                    val revealX = characterStartX +
                        (characterEndX - characterStartX) * reveal.characterProgress
                    val lineLeft = layout.getLineLeft(activeLine)
                    val lineRight = layout.getLineRight(activeLine)
                    clipRect(
                        left = minOf(lineLeft, lineRight),
                        top = layout.getLineTop(activeLine),
                        right = revealX.coerceIn(minOf(lineLeft, lineRight), maxOf(lineLeft, lineRight)),
                        bottom = layout.getLineBottom(activeLine),
                    ) {
                        this@drawWithContent.drawContent()
                    }
                },
        )
    }
}

private data class LyricReveal(
    val characterOffset: Int,
    val characterProgress: Float,
)

private fun calculateLyricReveal(
    words: List<LyricWord>,
    text: String,
    positionSeconds: Double,
): LyricReveal {
    if (words.isEmpty() || text.isEmpty()) {
        return LyricReveal(text.length, 0f)
    }

    var completedCharacters = 0
    words.forEach { word ->
        val characterCount = word.text.length
        if (characterCount <= 0) {
            return@forEach
        }
        if (word.endSeconds <= word.startSeconds) {
            if (positionSeconds < word.startSeconds) {
                return LyricReveal(completedCharacters.coerceAtMost(text.length), 0f)
            }
            completedCharacters += characterCount
            return@forEach
        }
        if (positionSeconds >= word.endSeconds) {
            completedCharacters += characterCount
            return@forEach
        }
        if (positionSeconds <= word.startSeconds) {
            return LyricReveal(completedCharacters.coerceAtMost(text.length), 0f)
        }

        val wordProgress = ((positionSeconds - word.startSeconds) /
            (word.endSeconds - word.startSeconds)).toFloat().coerceIn(0f, 1f)
        val preciseCharacters = characterCount * wordProgress
        val wholeCharacters = preciseCharacters.toInt().coerceIn(0, characterCount)
        return LyricReveal(
            characterOffset = (completedCharacters + wholeCharacters).coerceAtMost(text.length),
            characterProgress = preciseCharacters - wholeCharacters,
        )
    }
    return LyricReveal(text.length, 0f)
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
        modifier = Modifier
            .fillMaxSize()
            .background(webBlueGradient()),
        contentPadding = PaddingValues(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        state.user?.let { user ->
            item {
                ProfileHeader(user = user)
            }
        }
        item {
            Column(modifier = Modifier.fillMaxWidth()) {
                ProfileMenuItem(
                    icon = Icons.Default.Settings,
                    title = "设置",
                    description = "缓存、播放与账户设置",
                    onClick = onOpenSettings,
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
                .size(40.dp),
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

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(webBlueGradient()),
    ) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 20.dp, top = 20.dp, end = 20.dp, bottom = 28.dp),
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
            item {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 20.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    TextButton(onClick = viewModel::logout) {
                        Text(
                            text = "退出登录",
                            fontWeight = FontWeight.Bold,
                            style = MaterialTheme.typography.titleMedium,
                        )
                    }
                }
            }
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
                Text(
                    if (state.maxCacheLimitGb < 1) "空间不足" else "${state.cacheLimitGb}G",
                    color = Color(0xFF91EDDE),
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(horizontal = 5.dp, vertical = 5.dp),
                )
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
    val maxTitleUnits = state.cachedMusicFiles.maxOfOrNull { weightedTextUnits(it.title) } ?: 0
    val adaptiveWidth = (maxTitleUnits * 6 + 130).dp.coerceIn(280.dp, 360.dp)
    val adaptiveHeight = (288 + state.cachedMusicFiles.size.coerceIn(0, 5) * 56).dp
    val panelShape = RoundedCornerShape(18.dp)
    val backdropInteraction = remember { MutableInteractionSource() }
    val panelInteraction = remember { MutableInteractionSource() }

    LaunchedEffect(cachedTrackIds) {
        selectedTrackIds = selectedTrackIds.intersect(cachedTrackIds)
    }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color(0x2405172B))
                .clickable(
                    interactionSource = backdropInteraction,
                    indication = null,
                    onClick = onDismiss,
                )
                .padding(20.dp),
            contentAlignment = Alignment.Center,
        ) {
            Column(
                modifier = Modifier
                    .width(adaptiveWidth)
                    .height(adaptiveHeight)
                    .shadow(18.dp, panelShape)
                    .clip(panelShape)
                    .background(compactOverlayBrush())
                    .border(1.dp, Color(0x38A2DCFF), panelShape)
                    .clickable(
                        interactionSource = panelInteraction,
                        indication = null,
                        onClick = {},
                    )
                    .padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = "管理音乐文件",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Black,
                        color = Color(0xFFF0FBFF),
                        modifier = Modifier.weight(1f),
                    )
                    Box(
                        modifier = Modifier
                            .size(30.dp)
                            .clip(CircleShape)
                            .clickable(onClick = onDismiss),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            imageVector = Icons.Default.Close,
                            contentDescription = "关闭",
                            tint = Color(0xFFC8E8F7),
                            modifier = Modifier.size(18.dp),
                        )
                    }
                }

                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(
                        text = "${formatBytes(state.cacheStats.totalBytes)} / ${formatBytes(state.cacheStats.maxBytes)}",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = Color(0xFF93F0DE),
                    )
                    LinearProgressIndicator(
                        progress = { usageProgress },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(4.dp)
                            .clip(CircleShape),
                        color = Color(0xFF71E4D2),
                        trackColor = Color(0xFF234A65),
                    )
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
                        CompactDialogAction(
                            text = if (allSelected) "取消全选" else "全选",
                            onClick = {
                                selectedTrackIds = if (allSelected) emptySet() else cachedTrackIds
                            },
                        )
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
                                            .padding(vertical = 7.dp),
                                        horizontalArrangement = Arrangement.spacedBy(8.dp),
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
                                            modifier = Modifier.size(30.dp),
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

                val clearEnabled = selectedTrackIds.isNotEmpty() && !state.isLoading
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(38.dp)
                        .clip(RoundedCornerShape(11.dp))
                        .background(if (clearEnabled) Color(0x3D0A84FF) else Color(0x102B6C93))
                        .clickable(enabled = clearEnabled) {
                        val trackIds = selectedTrackIds
                        selectedTrackIds = emptySet()
                        onClearSelected(trackIds)
                        },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = if (selectedTrackIds.isEmpty()) "清除" else "清除（${selectedTrackIds.size}）",
                        fontWeight = FontWeight.Bold,
                        color = if (clearEnabled) Color(0xFFEAF9FF) else Color(0x70D7EBF6),
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
        modifier = Modifier
            .fillMaxSize()
            .background(webBlueGradient()),
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

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 4.dp, vertical = 12.dp),
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
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = logoText,
                        color = Color(0xFF082540),
                        style = MaterialTheme.typography.headlineLarge,
                        fontWeight = FontWeight.Black,
                    )
                }
                Icon(
                    imageVector = Icons.Default.MusicNote,
                    contentDescription = null,
                    tint = Color(0xFF8AF0DF),
                    modifier = Modifier
                        .align(Alignment.BottomEnd)
                        .size(24.dp),
                )
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
                Text(
                    text = user.role.label,
                    color = Color(0xFF8EF0DE),
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.Bold,
                )
            }
        }
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
                Color(0x5778E7F2),
                Color(0x335BE7FF),
            ),
        )
    } else {
        Brush.radialGradient(
            listOf(
                Color(0x1FB9F7FF),
                Color(0x335EF5FF),
                Color(0x1F78E7F2),
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
            TransportIconKind.Next -> Color(0xFFBDF8FF)
            TransportIconKind.Play -> Color(0xFFEAFBFF)
            TransportIconKind.Pause -> Color(0xFF9DF4FF)
        }

    Canvas(modifier = modifier) {
        val sx = size.width / 24f
        val sy = size.height / 24f
        fun p(x: Float, y: Float) = Offset(x * sx, y * sy)

        val coreColor = Color(0xF5F9FEFF)
        val accentColor = Color(0xF56EE8F2)
        val sparkColor = Color(0xFFE8FCFF)
        val dotColor = Color(0xFF8AF2FF)
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
                    listOf(Color(0xFF164E76), Color(0xFF12394F)),
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

@Composable
private fun ErrorDialog(message: String?, onDismiss: () -> Unit) {
    if (message.isNullOrBlank()) {
        return
    }
    CompactAppDialog(
        title = "提示",
        onDismiss = onDismiss,
        content = {
            Text(
                text = message,
                color = Color(0xD7D9EEF8),
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.widthIn(max = 280.dp),
            )
        },
        actions = {
            CompactDialogAction(
                text = "知道了",
                onClick = onDismiss,
                primary = true,
            )
        },
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
