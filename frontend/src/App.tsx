import { type FormEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  addFavoriteTrack,
  getFavoriteTracks,
  getTrackLyrics,
  getTracks,
  loginUser,
  removeFavoriteTrack,
  registerUser,
  scanLibrary,
  sendPresenceHeartbeat,
  sendPresenceOffline,
  streamURL
} from "./api";
import type { AuthUser, LyricLine, Track, TrackLyrics } from "./types";

type PlaybackMode = "all" | "one" | "shuffle";
type AppPage = "music" | "lyrics" | "discover" | "profile";
type AuthMode = "register" | "login";
type AuthSession = {
  userId?: number;
  phone: string;
  nickname: string;
  expiresAt: number;
  createdAt: string;
};
type AuthReadResult = {
  session: AuthSession | null;
  expired: boolean;
};
type AuthFormState = {
  nickname: string;
  phone: string;
  password: string;
};
type TrackContextMenu = {
  track: Track;
  x: number;
  y: number;
};
type LongPressStart = {
  pointerId: number;
  x: number;
  y: number;
};
type LyricsStatus = "idle" | "loading" | "ready" | "empty" | "error";
type LyricsScrollState = {
  trackID: number | null;
  top: number;
};

const musicTabs = ["音乐列表", "收藏", "歌曲搜索"] as const;
type MusicTab = (typeof musicTabs)[number];
const appPages: Array<{ id: AppPage; label: string }> = [
  { id: "music", label: "音乐" },
  { id: "lyrics", label: "歌词" },
  { id: "discover", label: "发现" },
  { id: "profile", label: "我" }
];
const playbackModes: PlaybackMode[] = ["all", "one", "shuffle"];
const playbackModeLabels: Record<PlaybackMode, string> = {
  all: "列表循环",
  one: "单曲循环",
  shuffle: "随机播放"
};
const authSessionStorageKey = "media-player-auth-session";
const authProfileStorageKey = "media-player-auth-profile";
const presenceSessionStorageKey = "media-player-presence-session";
const authSessionDurationMs = 7 * 24 * 60 * 60 * 1000;
const presenceHeartbeatIntervalMs = 25_000;
const libraryAutoRefreshIntervalMs = 12_000;
const nicknameMaxLength = 20;
const passwordMinLength = 6;
const passwordMaxLength = 64;
const mainlandPhonePattern = /^1[3-9]\d{9}$/;
const longPressDelayMs = 520;
const longPressMoveTolerancePx = 10;
const contextMenuWidth = 132;
const contextMenuHeight = 54;
const contextMenuMargin = 8;

function App() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressStartRef = useRef<LongPressStart | null>(null);
  const suppressNextClickRef = useRef(false);
  const initialAuthRef = useRef<AuthReadResult | null>(null);
  const initialAuthProfileRef = useRef<AuthFormState | null>(null);
  const presenceSessionIdRef = useRef<string | null>(null);
  const lyricsScrollStateRef = useRef<LyricsScrollState>({ trackID: null, top: 0 });
  if (!initialAuthRef.current) {
    initialAuthRef.current = readAuthSession();
  }
  if (!initialAuthProfileRef.current) {
    initialAuthProfileRef.current = readAuthProfile();
  }
  if (!presenceSessionIdRef.current) {
    presenceSessionIdRef.current = readPresenceSessionID();
  }
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playbackQueue, setPlaybackQueue] = useState<Track[]>([]);
  const [currentTrackId, setCurrentTrackId] = useState<number | null>(null);
  const [trackLyrics, setTrackLyrics] = useState<TrackLyrics | null>(null);
  const [lyricsStatus, setLyricsStatus] = useState<LyricsStatus>("idle");
  const [authSession, setAuthSession] = useState<AuthSession | null>(initialAuthRef.current.session);
  const [authMode, setAuthMode] = useState<AuthMode>(() => (initialAuthRef.current?.expired || initialAuthProfileRef.current?.phone ? "login" : "register"));
  const [authForm, setAuthForm] = useState<AuthFormState>(() => initialAuthProfileRef.current ?? createEmptyAuthForm());
  const [authMessage, setAuthMessage] = useState(initialAuthRef.current.expired ? "登录已过期，请重新登录" : "");
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [showAuthPassword, setShowAuthPassword] = useState(false);
  const [onlineCount, setOnlineCount] = useState<number | null>(null);
  const [isOnlineCountUnavailable, setIsOnlineCountUnavailable] = useState(false);
  const [activePage, setActivePage] = useState<AppPage>("music");
  const [activeTab, setActiveTab] = useState<MusicTab>("音乐列表");
  const [favoriteTrackIds, setFavoriteTrackIds] = useState<Set<number>>(() => new Set());
  const [trackContextMenu, setTrackContextMenu] = useState<TrackContextMenu | null>(null);
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>("all");
  const [isPlaybackModeMenuOpen, setIsPlaybackModeMenuOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [isLibraryFiltered, setIsLibraryFiltered] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [toastMessage, setToastMessage] = useState("");
  const [loadMessage, setLoadMessage] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(12);
  const [duration, setDuration] = useState(185);

  const currentTrack = useMemo(() => {
    if (!playbackQueue.length) {
      return null;
    }
    return playbackQueue.find((track) => track.id === currentTrackId) ?? playbackQueue[0];
  }, [currentTrackId, playbackQueue]);

  useEffect(() => {
    void refreshLibrary();
  }, []);

  useEffect(() => {
    if (activeTab !== "音乐列表" || isSearchOpen || isLoading || isScanning || isLibraryFiltered) {
      return;
    }

    let isCancelled = false;
    let isRefreshing = false;
    const refreshTracksSilently = async () => {
      if (isRefreshing || document.visibilityState === "hidden") {
        return;
      }
      isRefreshing = true;
      try {
        const payload = await getTracks();
        if (!isCancelled) {
          syncLibraryTracks(payload.tracks);
          setLoadMessage("");
        }
      } catch {
        // Keep the current list visible during transient network or backend restarts.
      } finally {
        isRefreshing = false;
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshTracksSilently();
      }
    };

    const intervalId = window.setInterval(() => {
      void refreshTracksSilently();
    }, libraryAutoRefreshIntervalMs);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [activeTab, isSearchOpen, isLoading, isScanning, isLibraryFiltered]);

  useEffect(() => {
    if (!authSession?.userId) {
      setFavoriteTrackIds(new Set());
      return;
    }
    void refreshFavoriteTracks({ showList: activePage === "music" && activeTab === "收藏" });
  }, [authSession?.userId]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
      cancelLongPress();
    };
  }, []);

  useEffect(() => {
    if (!trackContextMenu) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setTrackContextMenu(null);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [trackContextMenu]);

  useEffect(() => {
    if (!isPlaybackModeMenuOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsPlaybackModeMenuOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isPlaybackModeMenuOpen]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const result = readAuthSession();
      setAuthSession((previous) => {
        if (previous && !result.session) {
          setAuthMessage("登录已过期，请重新登录");
        }
        return result.session;
      });
    }, 30_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    const sessionID = presenceSessionIdRef.current;
    if (!authSession || !sessionID) {
      setOnlineCount(null);
      setIsOnlineCountUnavailable(false);
      return;
    }

    let isCancelled = false;
    const reportPresence = async () => {
      try {
        const payload = await sendPresenceHeartbeat({
          session_id: sessionID,
          user_id: authSession.userId,
          phone: authSession.phone
        });
        if (!isCancelled) {
          setOnlineCount(payload.online_count);
          setIsOnlineCountUnavailable(false);
        }
      } catch {
        if (!isCancelled) {
          setIsOnlineCountUnavailable(true);
        }
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void reportPresence();
      }
    };

    void reportPresence();
    const intervalId = window.setInterval(() => {
      void reportPresence();
    }, presenceHeartbeatIntervalMs);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      void sendPresenceOffline({ session_id: sessionID }).catch(() => undefined);
    };
  }, [authSession?.userId, authSession?.phone]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) {
      return;
    }

    setCurrentTime(currentTrack.stream_url ? 0 : 12);
    setDuration(currentTrack.duration_seconds ?? 185);

    if (!currentTrack.stream_url) {
      audio.pause();
      setIsPlaying(false);
      return;
    }
  }, [currentTrack]);

  useEffect(() => {
    if (!currentTrack?.id) {
      setTrackLyrics(null);
      setLyricsStatus("idle");
      return;
    }

    let isCancelled = false;
    setLyricsStatus("loading");
    setTrackLyrics(null);
    void getTrackLyrics(currentTrack.id)
      .then((payload) => {
        if (isCancelled) {
          return;
        }
        const lines = normalizeLyricLines(payload.lines);
        setTrackLyrics({ ...payload, lines });
        setLyricsStatus(lines.length ? "ready" : "empty");
      })
      .catch(() => {
        if (!isCancelled) {
          setTrackLyrics(null);
          setLyricsStatus("error");
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [currentTrack?.id]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack?.stream_url) {
      return;
    }
    if (isPlaying) {
      void audio.play().catch(() => setIsPlaying(false));
    } else {
      audio.pause();
    }
  }, [currentTrack, isPlaying]);

  const activeDuration = duration || currentTrack?.duration_seconds || 185;

	function syncLibraryTracks(nextTracks: Track[], { resetQueue = false }: { resetQueue?: boolean } = {}) {
		setTracks((previous) => (areTrackListsEqual(previous, nextTracks) ? previous : nextTracks));
		setPlaybackQueue((previous) => {
			if (resetQueue || !previous.length) {
				return nextTracks;
			}
			const mergedQueue = mergePlaybackQueue(previous, nextTracks);
			return areTrackListsEqual(previous, mergedQueue) ? previous : mergedQueue;
		});
		setCurrentTrackId((previous) => {
			if (previous && nextTracks.some((track) => track.id === previous)) {
        return previous;
      }
      return nextTracks[0]?.id ?? null;
    });
  }

  async function refreshLibrary({ scan = false }: { scan?: boolean } = {}) {
    setIsLoading(true);
    setIsScanning(scan);
    setLoadMessage("");
    setIsLibraryFiltered(false);
    if (scan) {
      clearCurrentLibrary();
    }
    try {
      if (scan) {
        await scanLibrary();
      }
      const payload = await getTracks();
      syncLibraryTracks(payload.tracks, { resetQueue: scan });
    } catch (error) {
      setTracks([]);
      if (scan) {
        setCurrentTrackId(null);
      }
      setLoadMessage(error instanceof Error ? error.message : "本地音乐列表加载失败");
    } finally {
      setIsLoading(false);
      setIsScanning(false);
    }
  }

  async function refreshFavoriteTracks({ showList = false }: { showList?: boolean } = {}) {
    if (!authSession?.userId) {
      setFavoriteTrackIds(new Set());
      if (showList) {
        setTracks([]);
        setLoadMessage("请先登录后查看收藏");
      }
      return;
    }

    if (showList) {
      setIsLoading(true);
      setLoadMessage("");
    }
    try {
      const payload = await getFavoriteTracks(authSession.userId);
      setFavoriteTrackIds(new Set(payload.tracks.map((track) => track.id)));
      if (showList) {
        setTracks(payload.tracks);
      }
    } catch (error) {
      if (showList) {
        setTracks([]);
        setLoadMessage(error instanceof Error ? error.message : "收藏列表加载失败");
      }
    } finally {
      if (showList) {
        setIsLoading(false);
      }
    }
  }

  function clearCurrentLibrary() {
    audioRef.current?.pause();
    setTracks([]);
    setPlaybackQueue([]);
    setCurrentTrackId(null);
    setTrackLyrics(null);
    setLyricsStatus("idle");
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }

  function handleTabClick(tab: MusicTab) {
    setActiveTab(tab);
    setActivePage("music");
    setIsPlaybackModeMenuOpen(false);
    if (tab === "音乐列表") {
      setIsLibraryFiltered(false);
      setIsSearchOpen(false);
      setTrackContextMenu(null);
      void refreshLibrary();
      return;
    }
    if (tab === "收藏") {
      setIsLibraryFiltered(false);
      setIsSearchOpen(false);
      setTrackContextMenu(null);
      void refreshFavoriteTracks({ showList: true });
      return;
    }
    setSearchQuery("");
    setIsSearchOpen(true);
    setTrackContextMenu(null);
  }

  function handlePageClick(page: AppPage) {
    setActivePage(page);
    setIsPlaybackModeMenuOpen(false);
    setTrackContextMenu(null);
    if (page === "lyrics") {
      setIsSearchOpen(false);
      return;
    }
    if (page !== "music") {
      setIsSearchOpen(false);
      setActiveTab("音乐列表");
    }
  }

  function updateAuthForm(field: keyof AuthFormState, value: string | boolean) {
    setAuthForm((previous) => ({ ...previous, [field]: normalizeAuthField(field, value) }));
    setAuthMessage("");
  }

  function handleAuthModeChange(mode: AuthMode) {
    setAuthMode(mode);
    setAuthMessage("");
    setShowAuthPassword(false);
  }

  function handleAuthCloseAttempt() {
    setAuthMessage("请先登录或注册后继续");
  }

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationMessage = getAuthValidationMessage(authMode, authForm);
    if (validationMessage) {
      setAuthMessage(validationMessage);
      return;
    }

    setIsAuthSubmitting(true);
    try {
      const phone = normalizePhone(authForm.phone);
      const response =
        authMode === "register"
          ? await registerUser({
              nickname: authForm.nickname.trim(),
              phone,
              password: authForm.password
            })
          : await loginUser({
              phone,
              password: authForm.password
            });
      const nextSession = createAuthSession(response.user);
      persistAuthSession(nextSession);
      persistAuthProfile(response.user);
      setAuthSession(nextSession);
      setAuthForm((previous) => ({
        ...previous,
        nickname: response.user.nickname,
        phone: response.user.phone,
        password: ""
      }));
      setAuthMessage("");
    setShowAuthPassword(false);
    setActivePage("music");
    setIsPlaybackModeMenuOpen(false);
  } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : "提交失败，请稍后再试");
    } finally {
      setIsAuthSubmitting(false);
    }
  }

  function handleLogout() {
    removeLocalStorage(authSessionStorageKey);
    setAuthSession(null);
    setAuthMode("login");
    setAuthForm((previous) => ({ ...previous, password: "" }));
    setAuthMessage("");
    setShowAuthPassword(false);
    setActivePage("music");
    setIsSearchOpen(false);
    setActiveTab("音乐列表");
    setFavoriteTrackIds(new Set());
    setTrackContextMenu(null);
    setIsPlaybackModeMenuOpen(false);
  }

  function closeSearchDialog() {
    setIsSearchOpen(false);
    setActiveTab("音乐列表");
  }

  function showToast(message: string) {
    setToastMessage(message);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage("");
      toastTimerRef.current = null;
    }, 3000);
  }

  async function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const keyword = searchQuery.trim();
    if (!keyword) {
      showToast("音乐不存在");
      return;
    }

    setIsSearching(true);
    try {
      const payload = await getTracks();
      const matchedTracks = payload.tracks.filter((track) => trackMatchesQuery(track, keyword));
      if (!matchedTracks.length) {
        showToast("音乐不存在");
        return;
      }

      audioRef.current?.pause();
      setIsPlaying(false);
      setTracks(matchedTracks);
      setPlaybackQueue(matchedTracks);
      setCurrentTrackId(matchedTracks[0].id);
      setLoadMessage("");
      setIsLibraryFiltered(true);
      setIsSearchOpen(false);
      setActiveTab("音乐列表");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "音乐不存在");
    } finally {
      setIsSearching(false);
    }
  }

  function handleTrackClick(track: Track) {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    playTrack(track);
  }

  function handleRowPointerDown(event: ReactPointerEvent<HTMLButtonElement>, track: Track) {
    if (event.pointerType === "mouse") {
      return;
    }
    cancelLongPress();
    const { clientX, clientY } = event;
    longPressStartRef.current = {
      pointerId: event.pointerId,
      x: clientX,
      y: clientY
    };
    longPressTimerRef.current = window.setTimeout(() => {
      suppressNextClickRef.current = true;
      longPressTimerRef.current = null;
      longPressStartRef.current = null;
      openTrackMenu(track, clientX, clientY);
    }, longPressDelayMs);
  }

  function handleRowPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.pointerType === "mouse" || !longPressStartRef.current) {
      return;
    }
    if (event.pointerId !== longPressStartRef.current.pointerId) {
      return;
    }
    const deltaX = Math.abs(event.clientX - longPressStartRef.current.x);
    const deltaY = Math.abs(event.clientY - longPressStartRef.current.y);
    if (deltaX > longPressMoveTolerancePx || deltaY > longPressMoveTolerancePx) {
      cancelLongPress();
    }
  }

  function handleRowContextMenu(event: ReactMouseEvent<HTMLButtonElement>, track: Track) {
    event.preventDefault();
    cancelLongPress();
    openTrackMenu(track, event.clientX, event.clientY);
  }

  function cancelLongPress() {
    longPressStartRef.current = null;
    if (!longPressTimerRef.current) {
      return;
    }
    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  }

  function openTrackMenu(track: Track, clientX: number, clientY: number) {
    const maxX = Math.max(contextMenuMargin, window.innerWidth - contextMenuWidth - contextMenuMargin);
    const maxY = Math.max(contextMenuMargin, window.innerHeight - contextMenuHeight - contextMenuMargin);
    setIsPlaybackModeMenuOpen(false);
    setTrackContextMenu({
      track,
      x: Math.min(Math.max(contextMenuMargin, clientX), maxX),
      y: Math.min(Math.max(contextMenuMargin, clientY), maxY)
    });
  }

  async function toggleFavorite(track: Track) {
    if (!authSession?.userId) {
      setTrackContextMenu(null);
      showToast("请先登录后收藏");
      return;
    }

    const wasFavorite = favoriteTrackIds.has(track.id);
    setTrackContextMenu(null);
    setFavoriteTrackIds((previous) => {
      const next = new Set(previous);
      if (wasFavorite) {
        next.delete(track.id);
      } else {
        next.add(track.id);
      }
      return next;
    });
    if (wasFavorite && activeTab === "收藏") {
      setTracks((previous) => previous.filter((item) => item.id !== track.id));
    }

    try {
      if (wasFavorite) {
        await removeFavoriteTrack(authSession.userId, track.id);
        showToast("已取消收藏");
      } else {
        await addFavoriteTrack({ user_id: authSession.userId, track_id: track.id });
        showToast("已收藏");
      }
      if (activeTab === "收藏") {
        void refreshFavoriteTracks({ showList: true });
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "收藏操作失败");
      void refreshFavoriteTracks({ showList: activeTab === "收藏" });
    }
  }

  function playTrack(track: Track) {
    setPlaybackQueue(tracks.length ? tracks : [track]);
    setCurrentTrackId(track.id);
    setIsPlaying(Boolean(track.stream_url));
  }

  function playTrackFromQueue(track: Track) {
    setCurrentTrackId(track.id);
    setIsPlaying(Boolean(track.stream_url));
  }

  function togglePlay() {
    const trackToPlay = currentTrack ?? playbackQueue[0] ?? tracks[0] ?? null;
    if (!trackToPlay) {
      setIsPlaying(false);
      return;
    }
    if (!currentTrack) {
      if (!playbackQueue.length && tracks.length) {
        setPlaybackQueue(tracks);
      }
      setCurrentTrackId(trackToPlay.id);
    }
    if (!trackToPlay.stream_url) {
      setIsPlaying(false);
      return;
    }
    setIsPlaying((value) => !value);
  }

  function stepTrack(direction: 1 | -1) {
    if (!playbackQueue.length) {
      return;
    }
    if (direction === 1 && playbackMode === "shuffle") {
      playRandomTrack();
      return;
    }
    const currentIndex = Math.max(
      0,
      playbackQueue.findIndex((track) => track.id === currentTrack?.id)
    );
    const nextIndex = (currentIndex + direction + playbackQueue.length) % playbackQueue.length;
    playTrackFromQueue(playbackQueue[nextIndex]);
  }

  function playRandomTrack() {
    if (!playbackQueue.length) {
      return;
    }
    if (playbackQueue.length === 1) {
      playTrackFromQueue(playbackQueue[0]);
      return;
    }

    const currentIndex = playbackQueue.findIndex((track) => track.id === currentTrack?.id);
    const randomRange = currentIndex >= 0 ? playbackQueue.length - 1 : playbackQueue.length;
    let nextIndex = Math.floor(Math.random() * randomRange);
    if (currentIndex >= 0 && nextIndex >= currentIndex) {
      nextIndex += 1;
    }
    playTrackFromQueue(playbackQueue[nextIndex]);
  }

  function selectPlaybackMode(mode: PlaybackMode) {
    setPlaybackMode(mode);
    setIsPlaybackModeMenuOpen(false);
  }

  function handleEnded() {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (playbackMode === "one") {
      audio.currentTime = 0;
      void audio.play();
      return;
    }
    if (playbackMode === "shuffle") {
      playRandomTrack();
      return;
    }
    stepTrack(1);
  }

  function handleSeek(value: string) {
    const nextTime = Number(value);
    if (!Number.isFinite(nextTime)) {
      return;
    }
    if (audioRef.current && currentTrack?.stream_url) {
      audioRef.current.currentTime = nextTime;
    }
    setCurrentTime(nextTime);
  }

  function updateLyricsScrollPosition(trackID: number, top: number) {
    lyricsScrollStateRef.current = { trackID, top };
  }

  const emptyMessage = loadMessage || (activeTab === "收藏" ? "暂无收藏歌曲" : "暂无本地音乐");
  const isAuthVisible = !authSession;
  const canSubmitAuth = !isAuthSubmitting && isAuthFormReady(authMode, authForm);
  const playingTrackId = isPlaying ? currentTrack?.id ?? null : null;
  const activeMenuTrack = trackContextMenu?.track ?? null;
  const isActiveMenuTrackFavorite = activeMenuTrack ? favoriteTrackIds.has(activeMenuTrack.id) : false;
  const lyricLines = trackLyrics?.lines ?? [];
  const activeLyricIndex = getActiveLyricIndex(lyricLines, currentTime);

  return (
    <main className="player-screen" aria-label="MediaPlayer">
      <div className="top-line" />
      <section className="app-page-area" aria-label="当前页面">
        {activePage === "music" ? (
          <section className="music-page" aria-label="音乐">
            <nav className="mode-tabs" aria-label="播放器视图">
              {musicTabs.map((tab) => (
                <button key={tab} className={tab === activeTab ? "active" : ""} type="button" aria-current={tab === activeTab ? "page" : undefined} onClick={() => handleTabClick(tab)}>
                  {tab}
                </button>
              ))}
            </nav>

            <section className="song-table" aria-label="本地音乐列表" aria-busy={isLoading}>
              <div className="table-head">
                <span />
                <span>歌曲</span>
                <span>歌手</span>
                <span>专辑</span>
              </div>
              <div className="table-body">
                {tracks.map((track, index) => (
                  <button
                    key={track.id}
                    type="button"
                    className={`table-row ${track.id === playingTrackId ? "active" : ""}`}
                    aria-current={track.id === playingTrackId ? "true" : undefined}
                    onClick={() => handleTrackClick(track)}
                    onContextMenu={(event) => handleRowContextMenu(event, track)}
                    onPointerDown={(event) => handleRowPointerDown(event, track)}
                    onPointerMove={handleRowPointerMove}
                    onPointerUp={cancelLongPress}
                    onPointerCancel={cancelLongPress}
                    onPointerLeave={cancelLongPress}
                    onDragStart={(event) => event.preventDefault()}
                  >
                    <span className="row-index">{index + 1}</span>
                    <span className="row-title">{track.title}</span>
                    <span>{track.artist}</span>
                    <span>{track.album}</span>
                  </button>
                ))}
                {!tracks.length ? <div className="empty-table">{isLoading ? (isScanning ? "正在重新检查音乐文件夹" : activeTab === "收藏" ? "正在加载收藏歌曲" : "正在加载本地音乐列表") : emptyMessage}</div> : null}
              </div>
            </section>

            {trackContextMenu ? (
              <div className="context-menu-layer" role="presentation" onPointerDown={() => setTrackContextMenu(null)}>
                <div
                  className="track-context-menu"
                  role="menu"
                  aria-label="歌曲操作"
                  style={{ left: trackContextMenu.x, top: trackContextMenu.y }}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <button type="button" role="menuitem" onClick={() => void toggleFavorite(trackContextMenu.track)}>
                    {isActiveMenuTrackFavorite ? "取消收藏" : "收藏"}
                  </button>
                </div>
              </div>
            ) : null}

            {isSearchOpen ? (
              <div className="search-dialog-backdrop" role="presentation" onClick={closeSearchDialog}>
                <form
                  className="search-dialog"
                  role="dialog"
                  aria-modal="true"
                  aria-label="歌曲搜索"
                  onClick={(event) => event.stopPropagation()}
                  onSubmit={handleSearchSubmit}
                >
                  <h2>歌曲搜索</h2>
                  <input
                    className="search-input"
                    type="search"
                    value={searchQuery}
                    placeholder="输入音乐名称"
                    aria-label="音乐名称"
                    autoFocus
                    onChange={(event) => setSearchQuery(event.target.value)}
                  />
                  <div className="search-actions">
                    <button type="button" onClick={closeSearchDialog}>
                      取消
                    </button>
                    <button className="primary" type="submit" disabled={isSearching}>
                      {isSearching ? "检查中" : "确认"}
                    </button>
                  </div>
                </form>
              </div>
            ) : null}

            {toastMessage ? (
              <div className="toast-message" role="status">
                {toastMessage}
              </div>
            ) : null}

            <footer className="control-bar">
              <div className="transport">
                <button type="button" aria-label="上一首" onClick={() => stepTrack(-1)}>
                  <PreviousIcon />
                </button>
                <button className="play-toggle" type="button" aria-label={isPlaying ? "暂停" : "播放"} onClick={togglePlay}>
                  {isPlaying ? <PauseIcon /> : <PlayIcon />}
                </button>
                <button type="button" aria-label="下一首" onClick={() => stepTrack(1)}>
                  <NextIcon />
                </button>
                <div className="playback-mode-picker">
                  <button
                    className={`playback-mode-button mode-${playbackMode}`}
                    type="button"
                    aria-label={`播放模式：${playbackModeLabels[playbackMode]}`}
                    aria-haspopup="menu"
                    aria-expanded={isPlaybackModeMenuOpen}
                    title={playbackModeLabels[playbackMode]}
                    onClick={() => setIsPlaybackModeMenuOpen((value) => !value)}
                  >
                    <PlaybackModeIcon mode={playbackMode} />
                  </button>
                  {isPlaybackModeMenuOpen ? (
                    <>
                      <button className="playback-mode-menu-scrim" type="button" aria-label="关闭播放模式菜单" onClick={() => setIsPlaybackModeMenuOpen(false)} />
                      <div className="playback-mode-menu" role="menu" aria-label="选择播放模式" onPointerDown={(event) => event.stopPropagation()}>
                        {playbackModes.map((mode) => (
                          <button
                            key={mode}
                            className={mode === playbackMode ? "active" : ""}
                            type="button"
                            role="menuitemradio"
                            aria-checked={mode === playbackMode}
                            onClick={() => selectPlaybackMode(mode)}
                          >
                            <PlaybackModeIcon mode={mode} />
                            <span>{playbackModeLabels[mode]}</span>
                          </button>
                        ))}
                      </div>
                    </>
                  ) : null}
                </div>
              </div>

              <div className="progress-group">
                <span>{formatDuration(currentTime)}</span>
                <input
                  type="range"
                  min="0"
                  max={Math.max(activeDuration, currentTime, 1)}
                  value={Math.min(currentTime, Math.max(activeDuration, currentTime, 1))}
                  onChange={(event) => handleSeek(event.target.value)}
                  aria-label="播放进度"
                />
                <span>{formatDuration(activeDuration)}</span>
              </div>
            </footer>
          </section>
        ) : activePage === "lyrics" ? (
          <FullLyricsPage
            status={lyricsStatus}
            currentTrack={currentTrack}
            lines={lyricLines}
            activeLineIndex={activeLyricIndex}
            currentTime={currentTime}
            duration={activeDuration}
            savedScroll={lyricsScrollStateRef.current}
            onScrollPositionChange={updateLyricsScrollPosition}
          />
        ) : (
          <EmptyPage
            page={activePage}
            authSession={authSession}
            onlineCount={onlineCount}
            isOnlineCountUnavailable={isOnlineCountUnavailable}
            onLogout={handleLogout}
          />
        )}
      </section>

      <nav className="bottom-tabs" aria-label="底部页面导航">
        {appPages.map((page) => (
          <button
            key={page.id}
            className={page.id === activePage ? "active" : ""}
            type="button"
            aria-current={page.id === activePage ? "page" : undefined}
            onClick={() => handlePageClick(page.id)}
          >
            <PageIcon page={page.id} />
            <span>{page.label}</span>
          </button>
        ))}
      </nav>

      <audio
        ref={audioRef}
        src={currentTrack?.stream_url ? streamURL(currentTrack) : undefined}
        preload="metadata"
        onLoadedMetadata={(event) => {
          const nextDuration = event.currentTarget.duration;
          setDuration(Number.isFinite(nextDuration) ? nextDuration : 0);
        }}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={handleEnded}
      />

      {isAuthVisible ? (
        <AuthPage
          mode={authMode}
          form={authForm}
          message={authMessage}
          canSubmit={canSubmitAuth}
          isSubmitting={isAuthSubmitting}
          showPassword={showAuthPassword}
          onChange={updateAuthForm}
          onCloseAttempt={handleAuthCloseAttempt}
          onModeChange={handleAuthModeChange}
          onSubmit={handleAuthSubmit}
          onTogglePassword={() => setShowAuthPassword((value) => !value)}
        />
      ) : null}
    </main>
  );
}

function trackMatchesQuery(track: Track, keyword: string) {
  const normalizedKeyword = keyword.toLocaleLowerCase();
  return [track.title, track.filename, track.relative_path].some((value) =>
    value.toLocaleLowerCase().includes(normalizedKeyword)
  );
}

function areTrackListsEqual(previous: Track[], next: Track[]) {
  if (previous.length !== next.length) {
    return false;
  }
  return previous.every((track, index) => {
    const nextTrack = next[index];
    return (
      track.id === nextTrack.id &&
      track.title === nextTrack.title &&
      track.artist === nextTrack.artist &&
      track.album === nextTrack.album &&
      track.format === nextTrack.format &&
      track.size_bytes === nextTrack.size_bytes &&
      track.modified_at === nextTrack.modified_at
    );
  });
}

function mergePlaybackQueue(previousQueue: Track[], nextTracks: Track[]) {
  if (!nextTracks.length) {
    return [];
  }

  const nextByID = new Map(nextTracks.map((track) => [track.id, track]));
  const queuedIDs = new Set<number>();
  const syncedQueue = previousQueue.flatMap((track) => {
    const nextTrack = nextByID.get(track.id);
    if (!nextTrack) {
      return [];
    }
    queuedIDs.add(nextTrack.id);
    return [nextTrack];
  });
  const newTracks = nextTracks.filter((track) => !queuedIDs.has(track.id));

  return syncedQueue.length ? [...syncedQueue, ...newTracks] : nextTracks;
}

function FullLyricsPage({
  status,
  currentTrack,
  lines,
  activeLineIndex,
  currentTime,
  duration,
  savedScroll,
  onScrollPositionChange
}: {
  status: LyricsStatus;
  currentTrack: Track | null;
  lines: LyricLine[];
  activeLineIndex: number;
  currentTime: number;
  duration: number;
  savedScroll: LyricsScrollState;
  onScrollPositionChange: (trackID: number, top: number) => void;
}) {
  const activeLineRef = useRef<HTMLParagraphElement | null>(null);
  const lyricsListRef = useRef<HTMLDivElement | null>(null);
  const skipNextAutoScrollRef = useRef(true);
  const ignoreScrollRef = useRef(false);
  const ignoreScrollTimerRef = useRef<number | null>(null);
  const userScrollPausedUntilRef = useRef(0);

  useEffect(() => {
    return () => {
      if (ignoreScrollTimerRef.current) {
        window.clearTimeout(ignoreScrollTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    skipNextAutoScrollRef.current = true;
    const lyricsList = lyricsListRef.current;
    if (!lyricsList) {
      return;
    }
    markProgrammaticLyricsScroll(90);
    lyricsList.scrollTop = currentTrack && savedScroll.trackID === currentTrack.id ? savedScroll.top : 0;
  }, [currentTrack?.id, lines.length, savedScroll.trackID]);

  useEffect(() => {
    if (!currentTrack || activeLineIndex < 0) {
      return;
    }
    if (skipNextAutoScrollRef.current) {
      skipNextAutoScrollRef.current = false;
      return;
    }
    if (Date.now() < userScrollPausedUntilRef.current) {
      return;
    }
    markProgrammaticLyricsScroll(900);
    activeLineRef.current?.scrollIntoView({
      block: "center",
      behavior: "smooth"
    });
  }, [activeLineIndex, currentTrack?.id]);

  function markProgrammaticLyricsScroll(delayMs: number) {
    ignoreScrollRef.current = true;
    if (ignoreScrollTimerRef.current) {
      window.clearTimeout(ignoreScrollTimerRef.current);
    }
    ignoreScrollTimerRef.current = window.setTimeout(() => {
      ignoreScrollRef.current = false;
      ignoreScrollTimerRef.current = null;
    }, delayMs);
  }

  function handleLyricsScroll(top: number) {
    if (!currentTrack) {
      return;
    }
    onScrollPositionChange(currentTrack.id, top);
    if (!ignoreScrollRef.current) {
      userScrollPausedUntilRef.current = Date.now() + 6000;
    }
  }

  let content: ReactNode;
  if (!currentTrack) {
    content = <div className="full-lyrics-empty">请选择歌曲</div>;
  } else if (status === "loading") {
    content = <div className="full-lyrics-empty">正在加载歌词</div>;
  } else if (status === "error") {
    content = <div className="full-lyrics-empty">歌词加载失败</div>;
  } else if (!lines.length) {
    content = <div className="full-lyrics-empty">暂无歌词</div>;
  } else {
    content = (
      <div className="full-lyrics-list" aria-label="完整歌词" ref={lyricsListRef} onScroll={(event) => handleLyricsScroll(event.currentTarget.scrollTop)}>
        {lines.map((line, index) => (
          <p
            key={`${index}-${line.text}`}
            ref={index === activeLineIndex ? activeLineRef : undefined}
            className={index === activeLineIndex ? "active" : ""}
          >
            {line.text}
          </p>
        ))}
      </div>
    );
  }

  return (
    <section className="lyrics-page" aria-label="歌词">
      <header className="lyrics-page-header">
        <h1>歌词</h1>
        <div className="lyrics-track-meta">
          <strong>{currentTrack?.title ?? "未选择歌曲"}</strong>
          <span>{currentTrack ? currentTrack.artist : "--"}</span>
        </div>
        <div className="lyrics-page-time">
          <span>{formatDuration(currentTime)}</span>
          <span>{formatDuration(duration)}</span>
        </div>
      </header>
      <section className="lyrics-page-body" aria-live="polite">
        {content}
      </section>
    </section>
  );
}

function normalizeLyricLines(lines: LyricLine[]) {
  return lines
    .map((line) => ({
      time_seconds: typeof line.time_seconds === "number" && Number.isFinite(line.time_seconds) ? line.time_seconds : null,
      text: line.text.trim()
    }))
    .filter((line) => line.text)
    .sort((a, b) => {
      if (a.time_seconds === null) {
        return 1;
      }
      if (b.time_seconds === null) {
        return -1;
      }
      return a.time_seconds - b.time_seconds;
    });
}

function getActiveLyricIndex(lines: LyricLine[], currentTime: number) {
  let activeIndex = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const time = lines[index].time_seconds;
    if (time === null) {
      continue;
    }
    if (time > currentTime + 0.25) {
      break;
    }
    activeIndex = index;
  }
  if (activeIndex >= 0) {
    return activeIndex;
  }
  return lines.some((line) => line.time_seconds !== null) ? -1 : 0;
}

function readAuthSession(): AuthReadResult {
  const rawSession = readLocalStorage(authSessionStorageKey);
  if (!rawSession) {
    return { session: null, expired: false };
  }

  try {
    const parsed = JSON.parse(rawSession) as Partial<AuthSession>;
    const expiresAt = typeof parsed.expiresAt === "number" ? parsed.expiresAt : 0;
    const userId = typeof parsed.userId === "number" ? parsed.userId : undefined;
    const phone = typeof parsed.phone === "string" ? parsed.phone : "";
    const nickname = typeof parsed.nickname === "string" ? parsed.nickname : "";
    const createdAt = typeof parsed.createdAt === "string" ? parsed.createdAt : "";

    if (!phone || !nickname || !createdAt || expiresAt <= Date.now()) {
      removeLocalStorage(authSessionStorageKey);
      return { session: null, expired: Boolean(expiresAt) };
    }

    return { session: { userId, phone, nickname, expiresAt, createdAt }, expired: false };
  } catch {
    removeLocalStorage(authSessionStorageKey);
    return { session: null, expired: false };
  }
}

function readAuthProfile(): AuthFormState {
  const rawProfile = readLocalStorage(authProfileStorageKey);
  if (!rawProfile) {
    return createEmptyAuthForm();
  }

  try {
    const parsed = JSON.parse(rawProfile) as Partial<AuthFormState>;
    return {
      ...createEmptyAuthForm(),
      nickname: typeof parsed.nickname === "string" ? parsed.nickname : "",
      phone: typeof parsed.phone === "string" ? parsed.phone : ""
    };
  } catch {
    return createEmptyAuthForm();
  }
}

function createEmptyAuthForm(): AuthFormState {
  return {
    nickname: "",
    phone: "",
    password: ""
  };
}

function readPresenceSessionID() {
  const existing = readLocalStorage(presenceSessionStorageKey);
  if (existing && existing.length <= 128) {
    return existing;
  }
  const sessionID = createPresenceSessionID();
  writeLocalStorage(presenceSessionStorageKey, sessionID);
  return sessionID;
}

function createPresenceSessionID() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `presence-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isAuthFormReady(mode: AuthMode, form: AuthFormState) {
  return getAuthValidationMessage(mode, form) === "";
}

function getAuthValidationMessage(mode: AuthMode, form: AuthFormState) {
  const nickname = form.nickname.trim();
  const phone = normalizePhone(form.phone);

  if (mode === "register" && !nickname) {
    return "请填写昵称";
  }
  if (mode === "register" && Array.from(nickname).length > nicknameMaxLength) {
    return `昵称不能超过${nicknameMaxLength}个字符`;
  }
  if (!mainlandPhonePattern.test(phone)) {
    return "请输入有效的中国大陆手机号码";
  }
  if (form.password.length < passwordMinLength || form.password.length > passwordMaxLength) {
    return `密码长度需为${passwordMinLength}-${passwordMaxLength}位`;
  }
  return "";
}

function createAuthSession(user: AuthUser): AuthSession {
  return {
    userId: user.id,
    phone: user.phone,
    nickname: user.nickname,
    createdAt: new Date().toISOString(),
    expiresAt: Date.now() + authSessionDurationMs
  };
}

function persistAuthSession(session: AuthSession) {
  writeLocalStorage(authSessionStorageKey, JSON.stringify(session));
}

function persistAuthProfile(user: Pick<AuthUser, "nickname" | "phone">) {
  writeLocalStorage(
    authProfileStorageKey,
    JSON.stringify({
      nickname: user.nickname.trim(),
      phone: normalizePhone(user.phone)
    })
  );
}

function normalizePhone(phone: string) {
  return phone.replace(/\D/g, "");
}

function normalizeAuthField(field: keyof AuthFormState, value: string | boolean) {
  if (typeof value !== "string") {
    return value;
  }
  if (field === "nickname") {
    return Array.from(value).slice(0, nicknameMaxLength).join("");
  }
  if (field === "phone") {
    return normalizePhone(value).slice(0, 11);
  }
  if (field === "password") {
    return value.slice(0, passwordMaxLength);
  }
  return value;
}

function readLocalStorage(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Local storage can be unavailable in private browsing modes.
  }
}

function removeLocalStorage(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Local storage can be unavailable in private browsing modes.
  }
}

function formatDuration(seconds?: number | null) {
  if (!seconds || seconds < 0 || !Number.isFinite(seconds)) {
    return "00:00";
  }
  const rounded = Math.floor(seconds);
  const minutes = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function EmptyPage({
  page,
  authSession,
  onlineCount,
  isOnlineCountUnavailable,
  onLogout
}: {
  page: Exclude<AppPage, "music" | "lyrics">;
  authSession: AuthSession | null;
  onlineCount: number | null;
  isOnlineCountUnavailable: boolean;
  onLogout: () => void;
}) {
  const pageContent: Record<Exclude<AppPage, "music" | "lyrics">, { title: string; message: string }> = {
    discover: { title: "发现", message: "暂无推荐" },
    profile: { title: "我", message: authSession ? authSession.nickname || authSession.phone : "未登录" }
  };
  const content = pageContent[page];

  return (
    <section className="simple-page" aria-label={content.title}>
      <header className="simple-page-header">
        <h1>{content.title}</h1>
      </header>
      {page === "profile" && authSession ? (
        <div className="profile-page-content">
          <div className="profile-name">{content.message}</div>
          <div className="online-stat" aria-label="当前APP在线总人数">
            <span>当前APP在线总人数</span>
            <strong>{isOnlineCountUnavailable || onlineCount === null ? "--" : onlineCount}</strong>
            <span>{isOnlineCountUnavailable ? "暂不可用" : onlineCount === null ? "同步中" : "人"}</span>
          </div>
          <button className="logout-button" type="button" onClick={onLogout}>
            退出登录
          </button>
        </div>
      ) : (
        <div className="simple-page-empty">{content.message}</div>
      )}
    </section>
  );
}

function AuthPage({
  mode,
  form,
  message,
  canSubmit,
  isSubmitting,
  showPassword,
  onChange,
  onCloseAttempt,
  onModeChange,
  onSubmit,
  onTogglePassword
}: {
  mode: AuthMode;
  form: AuthFormState;
  message: string;
  canSubmit: boolean;
  isSubmitting: boolean;
  showPassword: boolean;
  onChange: (field: keyof AuthFormState, value: string | boolean) => void;
  onCloseAttempt: () => void;
  onModeChange: (mode: AuthMode) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onTogglePassword: () => void;
}) {
  const isRegister = mode === "register";

  return (
    <section className="auth-gate" role="dialog" aria-modal="true" aria-label={isRegister ? "手机号注册" : "手机号登录"}>
      <div className="auth-panel">
        <button className="auth-close-button" type="button" aria-label="关闭登录页" onClick={onCloseAttempt}>
          <CloseIcon />
        </button>

        <div className="auth-content">
          <h1>{isRegister ? "用手机号注册" : "手机号登录"}</h1>

          {isRegister ? (
            <button className="auth-avatar" type="button" aria-label="上传头像">
              <CameraIcon />
            </button>
          ) : null}

          <form className="auth-form" onSubmit={onSubmit}>
            <div className="auth-fields">
              {isRegister ? (
                <AuthField
                  label="昵称"
                  name="nickname"
                  placeholder="请填写昵称"
                  value={form.nickname}
                  maxLength={nicknameMaxLength}
                  onChange={(value) => onChange("nickname", value)}
                />
              ) : null}
              <div className="auth-row">
                <span className="auth-label">国家/地区</span>
                <span className="auth-region">中国大陆（+86）</span>
              </div>
              <AuthField
                label="手机号"
                name="phone"
                placeholder="请填写手机号码"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={form.phone}
                maxLength={11}
                onChange={(value) => onChange("phone", value)}
              />
              <AuthField
                label="密码"
                name="password"
                placeholder={isRegister ? "请设置密码" : "请输入密码"}
                type={showPassword ? "text" : "password"}
                autoComplete={isRegister ? "new-password" : "current-password"}
                value={form.password}
                maxLength={passwordMaxLength}
                onChange={(value) => onChange("password", value)}
                trailing={
                  <button
                    className="password-visibility-button"
                    type="button"
                    aria-label={showPassword ? "隐藏密码" : "显示密码"}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={onTogglePassword}
                  >
                    {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                }
              />
            </div>

            <div className="auth-footer">
              {message ? <p className="auth-message">{message}</p> : null}
              <button className="auth-submit" type="submit" disabled={!canSubmit}>
                {isSubmitting ? "提交中" : isRegister ? "注册" : "登录"}
              </button>
              <button className="auth-mode-toggle" type="button" onClick={() => onModeChange(isRegister ? "login" : "register")}>
                {isRegister ? "已有账号？手机号登录" : "没有账号？手机号注册"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}

function AuthField({
  label,
  name,
  placeholder,
  value,
  type = "text",
  inputMode,
  autoComplete,
  maxLength,
  trailing,
  onChange
}: {
  label: string;
  name: string;
  placeholder: string;
  value: string;
  type?: string;
  inputMode?: "text" | "tel";
  autoComplete?: string;
  maxLength?: number;
  trailing?: ReactNode;
  onChange: (value: string) => void;
}) {
  return (
    <label className="auth-row">
      <span className="auth-label">{label}</span>
      <span className={trailing ? "auth-input-wrap has-action" : "auth-input-wrap"}>
        <input
          className="auth-input"
          type={type}
          name={name}
          inputMode={inputMode}
          autoComplete={autoComplete}
          placeholder={placeholder}
          value={value}
          maxLength={maxLength}
          onChange={(event) => onChange(event.target.value)}
        />
        {trailing}
      </span>
    </label>
  );
}

function IconBase({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

function CloseIcon() {
  return (
    <IconBase>
      <path d="M5 5l14 14M19 5 5 19" />
    </IconBase>
  );
}

function CameraIcon() {
  return (
    <IconBase>
      <path d="M7 8h1.8L10 6h4l1.2 2H17a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-5a3 3 0 0 1 3-3z" />
      <circle cx="12" cy="13.5" r="3" />
    </IconBase>
  );
}

function EyeIcon() {
  return (
    <IconBase>
      <path d="M2.5 12s3.3-6 9.5-6 9.5 6 9.5 6-3.3 6-9.5 6-9.5-6-9.5-6z" />
      <circle cx="12" cy="12" r="2.8" />
    </IconBase>
  );
}

function EyeOffIcon() {
  return (
    <IconBase>
      <path d="M3 3l18 18" />
      <path d="M10.6 5.2A10.5 10.5 0 0 1 12 5c6.2 0 9.5 7 9.5 7a16.2 16.2 0 0 1-2.6 3.4" />
      <path d="M6.2 6.9C3.8 8.6 2.5 12 2.5 12s3.3 7 9.5 7a9.8 9.8 0 0 0 4.3-1" />
      <path d="M9.8 9.8a3 3 0 0 0 4.4 4.4" />
    </IconBase>
  );
}

function MusicIcon() {
  return (
    <IconBase>
      <path d="M9 18V5l10-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="16" cy="16" r="3" />
    </IconBase>
  );
}

function DiscoverIcon() {
  return (
    <IconBase>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2.1 4.9-4.9 2.1 2.1-4.9z" />
    </IconBase>
  );
}

function LyricsIcon() {
  return (
    <IconBase>
      <path d="M7 4h10M7 8h10M7 12h7M7 16h5" />
      <path d="M4 4v16M20 4v16" />
    </IconBase>
  );
}

function ProfileIcon() {
  return (
    <IconBase>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
    </IconBase>
  );
}

function PageIcon({ page }: { page: AppPage }) {
  if (page === "lyrics") {
    return <LyricsIcon />;
  }
  if (page === "discover") {
    return <DiscoverIcon />;
  }
  if (page === "profile") {
    return <ProfileIcon />;
  }
  return <MusicIcon />;
}

function PreviousIcon() {
  return (
    <IconBase>
      <path d="M6 5v14M19 6 9 12l10 6z" />
    </IconBase>
  );
}

function NextIcon() {
  return (
    <IconBase>
      <path d="M18 5v14M5 6l10 6-10 6z" />
    </IconBase>
  );
}

function PlayIcon() {
  return (
    <IconBase>
      <path d="M8 5v14l11-7z" />
    </IconBase>
  );
}

function PauseIcon() {
  return (
    <IconBase>
      <path d="M8 5v14M16 5v14" />
    </IconBase>
  );
}

function RepeatIcon() {
  return (
    <IconBase>
      <path d="M17 2.5 21 6l-4 3.5M3 11V9a3 3 0 0 1 3-3h15M7 21.5 3 18l4-3.5M21 13v2a3 3 0 0 1-3 3H3" />
    </IconBase>
  );
}

function RepeatOneIcon() {
  return (
    <IconBase>
      <path d="M17 2.5 21 6l-4 3.5M3 11V9a3 3 0 0 1 3-3h15M7 21.5 3 18l4-3.5M21 13v2a3 3 0 0 1-3 3H3" />
      <text x="12" y="13" textAnchor="middle" dominantBaseline="middle" fontSize="7" fontWeight="800">
        1
      </text>
    </IconBase>
  );
}

function ShuffleIcon() {
  return (
    <IconBase>
      <path d="M17 3h4v4" />
      <path d="M3 7h2.5a5 5 0 0 1 4.2 2.3l4.6 7.4A5 5 0 0 0 18.5 19H21" />
      <path d="M3 19h2.5a5 5 0 0 0 4.2-2.3l.8-1.3" />
      <path d="M13.2 8.2l1.1-1.7A5 5 0 0 1 18.5 4H21" />
      <path d="M17 15h4v4" />
    </IconBase>
  );
}

function PlaybackModeIcon({ mode }: { mode: PlaybackMode }) {
  if (mode === "one") {
    return <RepeatOneIcon />;
  }
  if (mode === "all") {
    return <RepeatIcon />;
  }
  return <ShuffleIcon />;
}

export default App;
