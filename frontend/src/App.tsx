import { type CSSProperties, type FormEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  addFavoriteTrack,
  addFavoriteTrackToCategory,
  createFavoriteCategory,
  deleteFavoriteCategory,
  getFavoriteCategories,
  getFavoriteTracks,
  getTrackMemberships,
  getTrackLyrics,
  getTracks,
  loginUser,
  removeFavoriteTrack,
  removeFavoriteTrackFromCategory,
  registerUser,
  scanLibrary,
  sendPresenceHeartbeat,
  sendPresenceOffline,
  streamURL
} from "./api";
import type { AuthUser, FavoriteCategory, LyricLine, OnlineUser, Track, TrackCategoryMembership, TrackLyrics } from "./types";

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
type CategoryContextMenu = {
  category: FavoriteCategory;
  x: number;
  y: number;
};
type LongPressStart = {
  pointerId: number;
  x: number;
  y: number;
};
type CategoryLongPressStart = LongPressStart & {
  category: FavoriteCategory;
};
type LyricsStatus = "idle" | "loading" | "ready" | "empty" | "error";
type LyricsScrollState = {
  trackID: number | null;
  top: number;
  activeLineIndex: number;
};
type TrackSortKey = "title" | "artist";
type PlaybackQueueScope = { kind: "library" | "favorites" | "category" | "search"; categoryId?: number | null };
type DetachedCurrentTrack = {
  track: Track;
  queueIndex: number;
};

type MusicTab = "音乐列表" | "收藏" | "分类" | "歌曲搜索";
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
const manualLibraryRefreshStorageKey = "media-player-manual-library-refresh-at";
const authSessionDurationMs = 7 * 24 * 60 * 60 * 1000;
const presenceHeartbeatIntervalMs = 25_000;
const manualLibraryRefreshCooldownMs = 60_000;
const nicknameMaxLength = 20;
const passwordMinLength = 6;
const passwordMaxLength = 64;
const mainlandPhonePattern = /^1[3-9]\d{9}$/;
const longPressDelayMs = 520;
const longPressMoveTolerancePx = 10;
const contextMenuWidth = 148;
const trackContextMenuHeight = 148;
const categoryContextMenuHeight = 54;
const contextMenuMargin = 8;
const favoriteCategoryNameMaxLength = 16;
const sleepTimerMinMinutes = 1;
const sleepTimerMaxMinutes = 360;

function App() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressStartRef = useRef<LongPressStart | null>(null);
  const categoryLongPressTimerRef = useRef<number | null>(null);
  const categoryLongPressStartRef = useRef<CategoryLongPressStart | null>(null);
  const suppressNextClickRef = useRef(false);
  const suppressNextCategoryClickRef = useRef(false);
  const initialAuthRef = useRef<AuthReadResult | null>(null);
  const initialAuthProfileRef = useRef<AuthFormState | null>(null);
  const presenceSessionIdRef = useRef<string | null>(null);
  const lyricsScrollStateRef = useRef<LyricsScrollState>({ trackID: null, top: 0, activeLineIndex: -1 });
  const musicListRef = useRef<HTMLDivElement | null>(null);
  const shouldRevealCurrentTrackRef = useRef(false);
  const loadedLibrarySessionKeyRef = useRef<string | null>(null);
  if (!initialAuthRef.current) {
    initialAuthRef.current = readAuthSession();
  }
  if (!initialAuthProfileRef.current) {
    initialAuthProfileRef.current = readAuthProfile();
  }
  if (!presenceSessionIdRef.current) {
    presenceSessionIdRef.current = readPresenceSessionID();
  }
  const [libraryTracks, setLibraryTracks] = useState<Track[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playbackQueue, setPlaybackQueue] = useState<Track[]>([]);
  const [playbackQueueScope, setPlaybackQueueScope] = useState<PlaybackQueueScope>({ kind: "library" });
  const [currentTrackId, setCurrentTrackId] = useState<number | null>(null);
  const [detachedCurrentTrack, setDetachedCurrentTrack] = useState<DetachedCurrentTrack | null>(null);
  const [trackLyrics, setTrackLyrics] = useState<TrackLyrics | null>(null);
  const [lyricsStatus, setLyricsStatus] = useState<LyricsStatus>("idle");
  const [authSession, setAuthSession] = useState<AuthSession | null>(initialAuthRef.current.session);
  const [authMode, setAuthMode] = useState<AuthMode>(() => (initialAuthRef.current?.expired || initialAuthProfileRef.current?.phone ? "login" : "register"));
  const [authForm, setAuthForm] = useState<AuthFormState>(() => initialAuthProfileRef.current ?? createEmptyAuthForm());
  const [authMessage, setAuthMessage] = useState(initialAuthRef.current.expired ? "登录已过期，请重新登录" : "");
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [showAuthPassword, setShowAuthPassword] = useState(false);
  const [onlineCount, setOnlineCount] = useState<number | null>(null);
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [isOnlineCountUnavailable, setIsOnlineCountUnavailable] = useState(false);
  const [lastManualLibraryRefreshAt, setLastManualLibraryRefreshAt] = useState(() => readManualLibraryRefreshAt());
  const [libraryRefreshClock, setLibraryRefreshClock] = useState(() => Date.now());
  const [isManualLibraryRefreshing, setIsManualLibraryRefreshing] = useState(false);
  const [activePage, setActivePage] = useState<AppPage>("music");
  const [activeTab, setActiveTab] = useState<MusicTab>("音乐列表");
  const [activeCategoryId, setActiveCategoryId] = useState<number | null>(null);
  const [musicSortKey, setMusicSortKey] = useState<TrackSortKey | null>(null);
  const [favoriteTrackIds, setFavoriteTrackIds] = useState<Set<number>>(() => new Set());
  const [trackCategoryMembershipMap, setTrackCategoryMembershipMap] = useState<Map<number, TrackCategoryMembership[]>>(() => new Map());
  const [favoriteCategories, setFavoriteCategories] = useState<FavoriteCategory[]>([]);
  const [trackContextMenu, setTrackContextMenu] = useState<TrackContextMenu | null>(null);
  const [categoryContextMenu, setCategoryContextMenu] = useState<CategoryContextMenu | null>(null);
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>("all");
  const [isPlaybackModeMenuOpen, setIsPlaybackModeMenuOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [isLibraryFiltered, setIsLibraryFiltered] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isCategoryDialogOpen, setIsCategoryDialogOpen] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const [isCategorySubmitting, setIsCategorySubmitting] = useState(false);
  const [categoryPickerTrack, setCategoryPickerTrack] = useState<Track | null>(null);
  const [toastMessage, setToastMessage] = useState("");
  const [loadMessage, setLoadMessage] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(12);
  const [duration, setDuration] = useState(185);
  const [sleepTimerMinutes, setSleepTimerMinutes] = useState<number | null>(30);
  const [sleepTimerEndsAt, setSleepTimerEndsAt] = useState<number | null>(null);
  const [sleepTimerNow, setSleepTimerNow] = useState(() => Date.now());

  const currentTrack = useMemo(() => {
    if (!playbackQueue.length) {
      if (detachedCurrentTrack && detachedCurrentTrack.track.id === currentTrackId) {
        return detachedCurrentTrack.track;
      }
      return null;
    }
    const queuedTrack = playbackQueue.find((track) => track.id === currentTrackId);
    if (queuedTrack) {
      return queuedTrack;
    }
    if (detachedCurrentTrack && detachedCurrentTrack.track.id === currentTrackId) {
      return detachedCurrentTrack.track;
    }
    return playbackQueue[0];
  }, [currentTrackId, detachedCurrentTrack, playbackQueue]);

  useEffect(() => {
    if (!detachedCurrentTrack) {
      return;
    }
    if (currentTrackId !== detachedCurrentTrack.track.id || playbackQueue.some((track) => track.id === detachedCurrentTrack.track.id)) {
      setDetachedCurrentTrack(null);
    }
  }, [currentTrackId, detachedCurrentTrack, playbackQueue]);

  const trackCategoryIdSetMap = useMemo(() => {
    const categoryIdSetMap = new Map<number, Set<number>>();
    trackCategoryMembershipMap.forEach((memberships, trackID) => {
      categoryIdSetMap.set(trackID, new Set(memberships.map((membership) => membership.category_id)));
    });
    return categoryIdSetMap;
  }, [trackCategoryMembershipMap]);

  useEffect(() => {
    if (!authSession) {
      loadedLibrarySessionKeyRef.current = null;
      setIsLoading(false);
      return;
    }

    const sessionKey = getAuthSessionKey(authSession);
    if (loadedLibrarySessionKeyRef.current === sessionKey) {
      return;
    }
    loadedLibrarySessionKeyRef.current = sessionKey;
    void refreshLibrary();
  }, [authSession?.userId, authSession?.phone]);

  useEffect(() => {
    if (!authSession?.userId) {
      setFavoriteTrackIds(new Set());
      setTrackCategoryMembershipMap(new Map());
      setFavoriteCategories([]);
      setActiveCategoryId(null);
      return;
    }
    void refreshFavoriteCategories();
    void refreshTrackMemberships();
    void refreshFavoriteTracks({
      showList: activePage === "music" && (activeTab === "收藏" || activeTab === "分类"),
      categoryId: activeTab === "分类" ? activeCategoryId : undefined
    });
  }, [authSession?.userId]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
      cancelLongPress();
      cancelCategoryLongPress();
    };
  }, []);

  useEffect(() => {
    if (!trackContextMenu && !categoryContextMenu) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setTrackContextMenu(null);
        setCategoryContextMenu(null);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [trackContextMenu, categoryContextMenu]);

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

  const manualLibraryRefreshRemainingMs = Math.max(0, lastManualLibraryRefreshAt + manualLibraryRefreshCooldownMs - libraryRefreshClock);
  const manualLibraryRefreshCooldownSeconds = Math.ceil(manualLibraryRefreshRemainingMs / 1000);
  const sleepTimerRemainingSeconds = sleepTimerEndsAt ? Math.max(0, Math.ceil((sleepTimerEndsAt - sleepTimerNow) / 1000)) : null;

  useEffect(() => {
    if (manualLibraryRefreshRemainingMs <= 0) {
      return;
    }

    const timeoutID = window.setTimeout(() => {
      setLibraryRefreshClock(Date.now());
    }, Math.min(1000, manualLibraryRefreshRemainingMs));

    return () => {
      window.clearTimeout(timeoutID);
    };
  }, [manualLibraryRefreshRemainingMs]);

  useEffect(() => {
    if (!sleepTimerEndsAt) {
      return;
    }

    const remainingMs = sleepTimerEndsAt - Date.now();
    if (remainingMs <= 0) {
      audioRef.current?.pause();
      setIsPlaying(false);
      setSleepTimerEndsAt(null);
      setSleepTimerNow(Date.now());
      showToast("睡眠定时器已结束");
      return;
    }

    const timeoutID = window.setTimeout(() => {
      setSleepTimerNow(Date.now());
    }, Math.min(1000, remainingMs));

    return () => {
      window.clearTimeout(timeoutID);
    };
  }, [sleepTimerEndsAt, sleepTimerNow]);

  useLayoutEffect(() => {
    if (activePage !== "music" || activeTab !== "音乐列表" || !shouldRevealCurrentTrackRef.current || !currentTrack?.id) {
      return;
    }

    const musicList = musicListRef.current;
    const row = musicList?.querySelector<HTMLButtonElement>(`[data-track-id="${currentTrack.id}"]`);
    if (!musicList || !row) {
      return;
    }

    scrollElementToListCenter(musicList, row);
    shouldRevealCurrentTrackRef.current = false;
  }, [activePage, activeTab, currentTrack?.id, tracks]);

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
      setOnlineUsers([]);
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
          setOnlineUsers(payload.online_users ?? []);
          setIsOnlineCountUnavailable(false);
        }
      } catch {
        if (!isCancelled) {
          setOnlineUsers([]);
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

  function getActivePlaybackQueueScope(): PlaybackQueueScope {
    if (activeTab === "收藏") {
      return { kind: "favorites" };
    }
    if (activeTab === "分类") {
      return { kind: "category", categoryId: activeCategoryId };
    }
    if (isLibraryFiltered) {
      return { kind: "search" };
    }
    return { kind: "library" };
  }

  function removeTrackFromPlaybackQueueWhen(track: Track, shouldRemove: (scope: PlaybackQueueScope) => boolean) {
    if (!shouldRemove(playbackQueueScope)) {
      return;
    }

    if (currentTrackId === track.id) {
      const queueIndex = playbackQueue.findIndex((item) => item.id === track.id);
      setDetachedCurrentTrack((previous) => {
        if (previous?.track.id === track.id) {
          return previous;
        }
        return {
          track: currentTrack ?? track,
          queueIndex: Math.max(0, queueIndex)
        };
      });
    }
    setPlaybackQueue((previous) => {
      const next = previous.filter((item) => item.id !== track.id);
      return next.length === previous.length ? previous : next;
    });
  }

  function removeTrackFromFavoritePlaybackQueues(track: Track) {
    removeTrackFromPlaybackQueueWhen(track, (scope) => scope.kind === "favorites" || scope.kind === "category");
  }

  function removeTrackFromActiveCategoryPlaybackQueue(track: Track) {
    removeTrackFromPlaybackQueueWhen(
      track,
      (scope) => scope.kind === "category" && scope.categoryId === activeCategoryId
    );
  }

  function getAdjacentQueuedTrack(direction: 1 | -1) {
    if (!playbackQueue.length) {
      return null;
    }
    if (!currentTrack?.id) {
      return direction === 1 ? playbackQueue[0] : playbackQueue[playbackQueue.length - 1];
    }

    const currentIndex = playbackQueue.findIndex((track) => track.id === currentTrack.id);
    if (currentIndex < 0) {
      const detachedIndex = detachedCurrentTrack?.track.id === currentTrack.id ? detachedCurrentTrack.queueIndex : 0;
      if (direction === 1) {
        const nextIndex = detachedIndex >= playbackQueue.length ? 0 : detachedIndex;
        return playbackQueue[nextIndex];
      }
      const previousIndex = detachedIndex <= 0 ? playbackQueue.length - 1 : detachedIndex - 1;
      return playbackQueue[previousIndex];
    }

    const nextIndex = (currentIndex + direction + playbackQueue.length) % playbackQueue.length;
    return playbackQueue[nextIndex];
  }

  function isCurrentTrackQueued() {
    return Boolean(currentTrack?.id && playbackQueue.some((track) => track.id === currentTrack.id));
  }

  function clearDetachedPlayback() {
    setIsPlaying(false);
    if (detachedCurrentTrack) {
      setDetachedCurrentTrack(null);
      setCurrentTrackId(null);
    }
  }

  function syncLibraryTracks(nextTracks: Track[], { resetQueue = false }: { resetQueue?: boolean } = {}) {
    const visibleTracks = sortMusicTracks(nextTracks, musicSortKey);
    setLibraryTracks((previous) => (areTrackListsEqual(previous, nextTracks) ? previous : nextTracks));
    if (activeTab === "音乐列表") {
      setTracks((previous) => (areTrackListsEqual(previous, visibleTracks) ? previous : visibleTracks));
    }
    setPlaybackQueueScope({ kind: "library" });
    setPlaybackQueue((previous) => {
      if (resetQueue || !previous.length) {
        return visibleTracks;
      }
      const mergedQueue = mergePlaybackQueue(previous, visibleTracks);
      return areTrackListsEqual(previous, mergedQueue) ? previous : mergedQueue;
    });
    setCurrentTrackId((previous) => {
      if (previous && nextTracks.some((track) => track.id === previous)) {
        return previous;
      }
      return nextTracks[0]?.id ?? null;
    });
  }

  async function refreshLibrary({
    scan = false,
    keepExistingOnError = false,
    preservePlayback = false
  }: {
    scan?: boolean;
    keepExistingOnError?: boolean;
    preservePlayback?: boolean;
  } = {}) {
    setIsLoading(true);
    setIsScanning(scan);
    setLoadMessage("");
    setIsLibraryFiltered(false);
    if (scan && !preservePlayback) {
      clearCurrentLibrary();
    }
    try {
      if (scan) {
        await scanLibrary();
      }
      const payload = await getTracks();
      syncLibraryTracks(payload.tracks, { resetQueue: scan });
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "本地音乐列表加载失败";
      if (!keepExistingOnError) {
        setLibraryTracks([]);
        if (activeTab === "音乐列表") {
          setTracks([]);
        }
        if (scan) {
          setCurrentTrackId(null);
        }
      }
      setLoadMessage(message);
      return { ok: false, message };
    } finally {
      setIsLoading(false);
      setIsScanning(false);
    }
  }

  async function refreshFavoriteCategories() {
    if (!authSession?.userId) {
      setFavoriteCategories([]);
      return;
    }

    try {
      const payload = await getFavoriteCategories(authSession.userId);
      setFavoriteCategories(sortFavoriteCategories(payload.categories));
    } catch (error) {
      showToast(error instanceof Error ? error.message : "分类加载失败");
    }
  }

  async function refreshTrackMemberships() {
    if (!authSession?.userId) {
      setFavoriteTrackIds(new Set());
      setTrackCategoryMembershipMap(new Map());
      return;
    }

    try {
      const payload = await getTrackMemberships(authSession.userId);
      setFavoriteTrackIds(new Set(payload.favorite_track_ids));
      setTrackCategoryMembershipMap(buildTrackCategoryMembershipMap(payload.category_memberships));
    } catch (error) {
      showToast(error instanceof Error ? error.message : "歌曲状态加载失败");
    }
  }

  function removeTrackCategoryMembership(trackID: number, categoryID: number) {
    setTrackCategoryMembershipMap((previous) => {
      const memberships = previous.get(trackID);
      if (!memberships?.some((membership) => membership.category_id === categoryID)) {
        return previous;
      }
      const next = new Map(previous);
      const remaining = memberships.filter((membership) => membership.category_id !== categoryID);
      if (remaining.length) {
        next.set(trackID, remaining);
      } else {
        next.delete(trackID);
      }
      return next;
    });
  }

  function removeCategoryMemberships(categoryID: number) {
    setTrackCategoryMembershipMap((previous) => {
      let changed = false;
      const next = new Map<number, TrackCategoryMembership[]>();
      previous.forEach((memberships, trackID) => {
        const remaining = memberships.filter((membership) => membership.category_id !== categoryID);
        if (remaining.length !== memberships.length) {
          changed = true;
        }
        if (remaining.length) {
          next.set(trackID, remaining);
        }
      });
      return changed ? next : previous;
    });
  }

  function upsertTrackCategoryMembership(trackID: number, category: FavoriteCategory) {
    setTrackCategoryMembershipMap((previous) => {
      const memberships = previous.get(trackID) ?? [];
      if (memberships.some((membership) => membership.category_id === category.id)) {
        return previous;
      }
      const next = new Map(previous);
      next.set(trackID, [...memberships, { track_id: trackID, category_id: category.id, category_name: category.name }]);
      return next;
    });
  }

  function clearTrackMemberships(trackID: number) {
    setTrackCategoryMembershipMap((previous) => {
      if (!previous.has(trackID)) {
        return previous;
      }
      const next = new Map(previous);
      next.delete(trackID);
      return next;
    });
  }

  async function refreshFavoriteTracks({ showList = false, categoryId }: { showList?: boolean; categoryId?: number | null } = {}) {
    if (!authSession?.userId) {
      setFavoriteTrackIds(new Set());
      if (showList) {
        setTracks([]);
        setLoadMessage(categoryId ? "请先登录后查看分类" : "请先登录后查看收藏");
      }
      return;
    }

    if (showList) {
      setIsLoading(true);
      setLoadMessage("");
    }
    try {
      const payload = await getFavoriteTracks(authSession.userId, categoryId ?? undefined);
      if (categoryId) {
        const favoritesPayload = await getFavoriteTracks(authSession.userId);
        setFavoriteTrackIds(new Set(favoritesPayload.tracks.map((track) => track.id)));
      } else {
        setFavoriteTrackIds(new Set(payload.tracks.map((track) => track.id)));
      }
      if (showList) {
        setTracks(payload.tracks);
      }
    } catch (error) {
      if (showList) {
        setTracks([]);
        setLoadMessage(error instanceof Error ? error.message : categoryId ? "分类歌曲加载失败" : "收藏列表加载失败");
      }
    } finally {
      if (showList) {
        setIsLoading(false);
      }
    }
  }

  function clearCurrentLibrary() {
    audioRef.current?.pause();
    setLibraryTracks([]);
    setTracks([]);
    setPlaybackQueue([]);
    setDetachedCurrentTrack(null);
    setCurrentTrackId(null);
    setTrackLyrics(null);
    setLyricsStatus("idle");
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }

  function handleTabClick(tab: MusicTab) {
    shouldRevealCurrentTrackRef.current = false;
    setActiveTab(tab);
    setActivePage("music");
    setActiveCategoryId(null);
    setIsPlaybackModeMenuOpen(false);
    setCategoryContextMenu(null);
    if (tab === "音乐列表") {
      setIsLibraryFiltered(false);
      setIsSearchOpen(false);
      setTrackContextMenu(null);
      setLoadMessage("");
      setTracks(sortMusicTracks(libraryTracks, musicSortKey));
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

  function handleCustomCategoryClick() {
    setActivePage("music");
    setIsSearchOpen(false);
    setTrackContextMenu(null);
    setCategoryContextMenu(null);
    setIsCategoryDialogOpen(true);
  }

  function handleCategoryClick(category: FavoriteCategory) {
    if (suppressNextCategoryClickRef.current) {
      suppressNextCategoryClickRef.current = false;
      return;
    }
    shouldRevealCurrentTrackRef.current = false;
    setActivePage("music");
    setActiveTab("分类");
    setActiveCategoryId(category.id);
    setIsLibraryFiltered(false);
    setIsSearchOpen(false);
    setTrackContextMenu(null);
    setCategoryContextMenu(null);
    setLoadMessage("");
    void refreshFavoriteTracks({ showList: true, categoryId: category.id });
  }

  function handleMusicSortClick(sortKey: TrackSortKey) {
    if (activeTab !== "音乐列表") {
      return;
    }

    const sortedTracks = sortMusicTracks(libraryTracks, sortKey);
    setMusicSortKey(sortKey);
    setIsLibraryFiltered(false);
    setSearchQuery("");
    setTracks(sortedTracks);
    setPlaybackQueue(sortedTracks);
    setPlaybackQueueScope({ kind: "library" });
    if (currentTrack?.id) {
      shouldRevealCurrentTrackRef.current = true;
    }
  }

  function handlePageClick(page: AppPage) {
    if (page === "music" && activePage !== "music") {
      shouldRevealCurrentTrackRef.current = true;
    }
    setActivePage(page);
    setIsPlaybackModeMenuOpen(false);
    setTrackContextMenu(null);
    setCategoryContextMenu(null);
    if (page === "lyrics") {
      setIsSearchOpen(false);
      return;
    }
    if (page !== "music") {
      setIsSearchOpen(false);
      setActiveTab("音乐列表");
      setActiveCategoryId(null);
      setIsLibraryFiltered(false);
      setTracks(sortMusicTracks(libraryTracks, musicSortKey));
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
    loadedLibrarySessionKeyRef.current = null;
    setAuthSession(null);
    setAuthMode("login");
    setAuthForm((previous) => ({ ...previous, password: "" }));
    setAuthMessage("");
    setShowAuthPassword(false);
    setActivePage("music");
    setIsSearchOpen(false);
    setActiveTab("音乐列表");
    setActiveCategoryId(null);
    setLibraryTracks([]);
    setTracks([]);
    setFavoriteTrackIds(new Set());
    setTrackCategoryMembershipMap(new Map());
    setFavoriteCategories([]);
    setTrackContextMenu(null);
    setCategoryContextMenu(null);
    setIsCategoryDialogOpen(false);
    setCategoryPickerTrack(null);
    setOnlineCount(null);
    setOnlineUsers([]);
    setIsOnlineCountUnavailable(false);
    setIsPlaybackModeMenuOpen(false);
  }

  async function handleManualLibraryRefresh() {
    const now = Date.now();
    const remainingMs = Math.max(0, lastManualLibraryRefreshAt + manualLibraryRefreshCooldownMs - now);
    if (remainingMs > 0) {
      setLibraryRefreshClock(now);
      showToast(`${Math.ceil(remainingMs / 1000)}秒后可再次刷新`);
      return;
    }

    persistManualLibraryRefreshAt(now);
    setLastManualLibraryRefreshAt(now);
    setLibraryRefreshClock(now);
    setIsManualLibraryRefreshing(true);
    try {
      const result = await refreshLibrary({
        scan: true,
        keepExistingOnError: true,
        preservePlayback: true
      });
      if (result.ok) {
        void refreshTrackMemberships();
        void refreshFavoriteTracks({
          showList: activePage === "music" && (activeTab === "收藏" || activeTab === "分类"),
          categoryId: activeTab === "分类" ? activeCategoryId : undefined
        });
        showToast("音乐列表已刷新");
      } else {
        showToast(result.message ?? "音乐列表刷新失败");
      }
    } finally {
      setIsManualLibraryRefreshing(false);
    }
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

  function handleSetSleepTimerMinutes(minutes: number | null) {
    const normalizedMinutes = normalizeSleepTimerMinutes(minutes);
    setSleepTimerMinutes(normalizedMinutes);
    if (!normalizedMinutes) {
      setSleepTimerEndsAt(null);
      setSleepTimerNow(Date.now());
    }
  }

  function handleStartSleepTimer(minutesOverride?: number) {
    const nextMinutes = normalizeSleepTimerMinutes(minutesOverride ?? sleepTimerMinutes);
    if (!nextMinutes) {
      showToast("请选择睡眠定时器时间");
      return;
    }

    if (nextMinutes !== sleepTimerMinutes) {
      setSleepTimerMinutes(nextMinutes);
    }
    const now = Date.now();
    setSleepTimerNow(now);
    setSleepTimerEndsAt(now + nextMinutes * 60_000);
    showToast(`睡眠定时器将在${nextMinutes}分钟后停止播放`);
  }

  function handleStopSleepTimer() {
    setSleepTimerEndsAt(null);
    setSleepTimerNow(Date.now());
    showToast("睡眠定时器已关闭");
  }

  async function handleCreateCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!authSession?.userId) {
      showToast("请先登录后创建分类");
      return;
    }

    const name = categoryName.trim();
    if (!name) {
      showToast("请输入分类名称");
      return;
    }
    if (Array.from(name).length > favoriteCategoryNameMaxLength) {
      showToast(`分类名称不能超过${favoriteCategoryNameMaxLength}个字符`);
      return;
    }
    if (favoriteCategories.some((category) => category.name.localeCompare(name, undefined, { sensitivity: "accent" }) === 0)) {
      showToast("分类名称已存在");
      return;
    }

    setIsCategorySubmitting(true);
    try {
      const payload = await createFavoriteCategory({
        user_id: authSession.userId,
        name
      });
      setFavoriteCategories((previous) => sortFavoriteCategories([...previous, payload.category]));
      setCategoryName("");
      setIsCategoryDialogOpen(false);
      setActiveTab("分类");
      setActiveCategoryId(payload.category.id);
      setIsLibraryFiltered(false);
      setIsSearchOpen(false);
      setTracks([]);
      setLoadMessage("暂无分类歌曲");
      showToast("分类已创建");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "创建分类失败");
    } finally {
      setIsCategorySubmitting(false);
    }
  }

  function closeCategoryDialog() {
    setIsCategoryDialogOpen(false);
    setCategoryName("");
  }

  async function handleDeleteCategory(category: FavoriteCategory) {
    if (!authSession?.userId) {
      setCategoryContextMenu(null);
      showToast("请先登录后删除分类");
      return;
    }

    setCategoryContextMenu(null);
    try {
      await deleteFavoriteCategory(authSession.userId, category.id);
      setFavoriteCategories((previous) => previous.filter((item) => item.id !== category.id));
      removeCategoryMemberships(category.id);
      if (activeTab === "分类" && activeCategoryId === category.id) {
        setActiveTab("收藏");
        setActiveCategoryId(null);
        void refreshFavoriteTracks({ showList: true });
      }
      showToast("分类已删除");
      void refreshTrackMemberships();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "删除分类失败");
      void refreshTrackMemberships();
    }
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
      const matchedTracks = libraryTracks.filter((track) => trackMatchesQuery(track, keyword));
      if (!matchedTracks.length) {
        showToast("音乐不存在");
        return;
      }

      setTracks(matchedTracks);
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

  function handleCategoryPointerDown(event: ReactPointerEvent<HTMLButtonElement>, category: FavoriteCategory) {
    if (event.pointerType === "mouse") {
      return;
    }
    cancelCategoryLongPress();
    const { clientX, clientY } = event;
    categoryLongPressStartRef.current = {
      pointerId: event.pointerId,
      x: clientX,
      y: clientY,
      category
    };
    categoryLongPressTimerRef.current = window.setTimeout(() => {
      suppressNextCategoryClickRef.current = true;
      categoryLongPressTimerRef.current = null;
      categoryLongPressStartRef.current = null;
      openCategoryMenu(category, clientX, clientY);
    }, longPressDelayMs);
  }

  function handleCategoryPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.pointerType === "mouse" || !categoryLongPressStartRef.current) {
      return;
    }
    if (event.pointerId !== categoryLongPressStartRef.current.pointerId) {
      return;
    }
    const deltaX = Math.abs(event.clientX - categoryLongPressStartRef.current.x);
    const deltaY = Math.abs(event.clientY - categoryLongPressStartRef.current.y);
    if (deltaX > longPressMoveTolerancePx || deltaY > longPressMoveTolerancePx) {
      cancelCategoryLongPress();
    }
  }

  function handleCategoryContextMenu(event: ReactMouseEvent<HTMLButtonElement>, category: FavoriteCategory) {
    event.preventDefault();
    cancelCategoryLongPress();
    openCategoryMenu(category, event.clientX, event.clientY);
  }

  function cancelLongPress() {
    longPressStartRef.current = null;
    if (!longPressTimerRef.current) {
      return;
    }
    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  }

  function cancelCategoryLongPress() {
    categoryLongPressStartRef.current = null;
    if (!categoryLongPressTimerRef.current) {
      return;
    }
    window.clearTimeout(categoryLongPressTimerRef.current);
    categoryLongPressTimerRef.current = null;
  }

  function openTrackMenu(track: Track, clientX: number, clientY: number) {
    const maxX = Math.max(contextMenuMargin, window.innerWidth - contextMenuWidth - contextMenuMargin);
    const maxY = Math.max(contextMenuMargin, window.innerHeight - trackContextMenuHeight - contextMenuMargin);
    setIsPlaybackModeMenuOpen(false);
    setCategoryContextMenu(null);
    setTrackContextMenu({
      track,
      x: Math.min(Math.max(contextMenuMargin, clientX), maxX),
      y: Math.min(Math.max(contextMenuMargin, clientY), maxY)
    });
  }

  function openCategoryMenu(category: FavoriteCategory, clientX: number, clientY: number) {
    const maxX = Math.max(contextMenuMargin, window.innerWidth - contextMenuWidth - contextMenuMargin);
    const maxY = Math.max(contextMenuMargin, window.innerHeight - categoryContextMenuHeight - contextMenuMargin);
    setIsPlaybackModeMenuOpen(false);
    setTrackContextMenu(null);
    setCategoryContextMenu({
      category,
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
    if (wasFavorite && (activeTab === "收藏" || activeTab === "分类")) {
      setTracks((previous) => previous.filter((item) => item.id !== track.id));
    }

    try {
      if (wasFavorite) {
        await removeFavoriteTrack(authSession.userId, track.id);
        removeTrackFromFavoritePlaybackQueues(track);
        clearTrackMemberships(track.id);
        showToast("已取消收藏");
      } else {
        await addFavoriteTrack({ user_id: authSession.userId, track_id: track.id });
        showToast("已收藏");
      }
      if (activeTab === "收藏" || activeTab === "分类") {
        void refreshFavoriteTracks({ showList: true, categoryId: activeTab === "分类" ? activeCategoryId : undefined });
      }
      void refreshTrackMemberships();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "收藏操作失败");
      void refreshTrackMemberships();
      void refreshFavoriteTracks({
        showList: activeTab === "收藏" || activeTab === "分类",
        categoryId: activeTab === "分类" ? activeCategoryId : undefined
      });
    }
  }

  function openCategoryPicker(track: Track) {
    setTrackContextMenu(null);
    if (!authSession?.userId) {
      showToast("请先登录后加入分类");
      return;
    }
    if (!favoriteCategories.length) {
      showToast("请先创建分类");
      setIsCategoryDialogOpen(true);
      return;
    }
    setCategoryPickerTrack(track);
  }

  async function addTrackToCategory(category: FavoriteCategory) {
    if (!authSession?.userId || !categoryPickerTrack) {
      setCategoryPickerTrack(null);
      return;
    }

    const track = categoryPickerTrack;
    setCategoryPickerTrack(null);
    try {
      await addFavoriteTrackToCategory(category.id, {
        user_id: authSession.userId,
        track_id: track.id
      });
      setFavoriteTrackIds((previous) => {
        const next = new Set(previous);
        next.add(track.id);
        return next;
      });
      upsertTrackCategoryMembership(track.id, category);
      if (activeTab === "分类" && activeCategoryId === category.id) {
        void refreshFavoriteTracks({ showList: true, categoryId: category.id });
      }
      showToast(`已加入${category.name}`);
      void refreshTrackMemberships();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "加入分类失败");
      void refreshTrackMemberships();
      void refreshFavoriteTracks({ showList: activeTab === "收藏" || activeTab === "分类", categoryId: activeTab === "分类" ? activeCategoryId : undefined });
    }
  }

  async function removeTrackFromCurrentCategory(track: Track) {
    if (!authSession?.userId || !activeCategoryId) {
      setTrackContextMenu(null);
      return;
    }

    setTrackContextMenu(null);
    setTracks((previous) => previous.filter((item) => item.id !== track.id));
    try {
      await removeFavoriteTrackFromCategory(authSession.userId, activeCategoryId, track.id);
      removeTrackFromActiveCategoryPlaybackQueue(track);
      removeTrackCategoryMembership(track.id, activeCategoryId);
      showToast("已移出分类");
      void refreshFavoriteTracks({ showList: true, categoryId: activeCategoryId });
      void refreshTrackMemberships();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "移出分类失败");
      void refreshTrackMemberships();
      void refreshFavoriteTracks({ showList: true, categoryId: activeCategoryId });
    }
  }

  function playTrack(track: Track) {
    setDetachedCurrentTrack(null);
    setPlaybackQueue(tracks.length ? tracks : [track]);
    setPlaybackQueueScope(getActivePlaybackQueueScope());
    setCurrentTrackId(track.id);
    setIsPlaying(Boolean(track.stream_url));
  }

  function playTrackFromQueue(track: Track) {
    setDetachedCurrentTrack(null);
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
        setPlaybackQueueScope(getActivePlaybackQueueScope());
      }
      setDetachedCurrentTrack(null);
      setCurrentTrackId(trackToPlay.id);
    }
    if (!trackToPlay.stream_url) {
      setIsPlaying(false);
      return;
    }
    setIsPlaying((value) => !value);
  }

  function stepTrack(direction: 1 | -1) {
    const nextTrack = getAdjacentQueuedTrack(direction);
    if (!nextTrack) {
      clearDetachedPlayback();
      return;
    }
    if (direction === 1 && playbackMode === "shuffle") {
      playRandomTrack();
      return;
    }
    playTrackFromQueue(nextTrack);
  }

  function playRandomTrack() {
    if (!playbackQueue.length) {
      clearDetachedPlayback();
      return;
    }
    const randomCandidates = currentTrack?.id && playbackQueue.length > 1 ? playbackQueue.filter((track) => track.id !== currentTrack.id) : playbackQueue;
    if (!randomCandidates.length) {
      clearDetachedPlayback();
      return;
    }

    const nextIndex = Math.floor(Math.random() * randomCandidates.length);
    playTrackFromQueue(randomCandidates[nextIndex]);
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
    if (playbackMode === "one" && isCurrentTrackQueued()) {
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

  function updateLyricsScrollPosition(trackID: number, top: number, activeLineIndex: number) {
    lyricsScrollStateRef.current = { trackID, top, activeLineIndex };
  }

  const activeCategory = favoriteCategories.find((category) => category.id === activeCategoryId) ?? null;
  const emptyMessage = loadMessage || (activeTab === "收藏" ? "暂无收藏歌曲" : activeTab === "分类" ? "暂无分类歌曲" : "暂无本地音乐");
  const isAuthVisible = !authSession;
  const canSubmitAuth = !isAuthSubmitting && isAuthFormReady(authMode, authForm);
  const playingTrackId = isPlaying ? currentTrack?.id ?? null : null;
  const activeMenuTrack = trackContextMenu?.track ?? null;
  const isActiveMenuTrackFavorite = activeMenuTrack ? favoriteTrackIds.has(activeMenuTrack.id) : false;
  const isViewingActiveCategory = activeTab === "分类" && Boolean(activeCategory);
  const lyricLines = trackLyrics?.lines ?? [];
  const activeLyricIndex = getActiveLyricIndex(lyricLines, currentTime);
  const canSortMusicColumns = activeTab === "音乐列表";
  const canShowTrackStatus = activeTab === "音乐列表" || activeTab === "收藏" || activeTab === "分类";
  const statusSlotCount = favoriteCategories.length + 1;
  const songTableStyle = canShowTrackStatus
    ? ({ "--status-slot-count": statusSlotCount } as CSSProperties & Record<"--status-slot-count", number>)
    : undefined;
  const currentTrackLabel = currentTrack ? `${currentTrack.artist} - ${currentTrack.title}` : "";

  return (
    <main className="player-screen" aria-label="MediaPlayer">
      <div className="top-line" />
      {currentTrackLabel ? (
        <div className="now-playing-ticker" aria-label={`当前正在播放：${currentTrackLabel}`} aria-live="polite">
          <div className="now-playing-ticker-track">
            <span>{currentTrackLabel}</span>
            <span aria-hidden="true">{currentTrackLabel}</span>
          </div>
        </div>
      ) : null}
      <section className="app-page-area" aria-label="当前页面">
        {activePage === "music" ? (
          <section className="music-page" aria-label="音乐">
            <nav className="mode-tabs" aria-label="播放器视图">
              <button className={activeTab === "音乐列表" ? "active" : ""} type="button" aria-current={activeTab === "音乐列表" ? "page" : undefined} onClick={() => handleTabClick("音乐列表")}>
                音乐列表
              </button>
              <button className={activeTab === "收藏" ? "active" : ""} type="button" aria-current={activeTab === "收藏" ? "page" : undefined} onClick={() => handleTabClick("收藏")}>
                收藏
              </button>
              {favoriteCategories.map((category) => (
                <button
                  key={category.id}
                  className={`user-category-tab ${activeTab === "分类" && activeCategoryId === category.id ? "active" : ""}`}
                  type="button"
                  aria-current={activeTab === "分类" && activeCategoryId === category.id ? "page" : undefined}
                  title={`${category.name}，长按删除`}
                  onClick={() => handleCategoryClick(category)}
                  onContextMenu={(event) => handleCategoryContextMenu(event, category)}
                  onPointerDown={(event) => handleCategoryPointerDown(event, category)}
                  onPointerMove={handleCategoryPointerMove}
                  onPointerUp={cancelCategoryLongPress}
                  onPointerCancel={cancelCategoryLongPress}
                  onPointerLeave={cancelCategoryLongPress}
                  onDragStart={(event) => event.preventDefault()}
                >
                  {category.name}
                </button>
              ))}
              <button className="custom-category-trigger" type="button" onClick={handleCustomCategoryClick}>
                自定义
              </button>
              <button className={activeTab === "歌曲搜索" ? "active search-tab" : "search-tab"} type="button" aria-current={activeTab === "歌曲搜索" ? "page" : undefined} onClick={() => handleTabClick("歌曲搜索")}>
                歌曲搜索
              </button>
            </nav>

            <section className={`song-table ${canShowTrackStatus ? "with-status" : ""}`} style={songTableStyle} aria-label="本地音乐列表" aria-busy={isLoading}>
              <div className="table-head">
                <span />
                {canSortMusicColumns ? (
                  <button
                    className={musicSortKey === "title" ? "active" : ""}
                    type="button"
                    aria-pressed={musicSortKey === "title"}
                    onClick={() => handleMusicSortClick("title")}
                  >
                    歌曲
                  </button>
                ) : (
                  <span>歌曲</span>
                )}
                {canSortMusicColumns ? (
                  <button
                    className={musicSortKey === "artist" ? "active" : ""}
                    type="button"
                    aria-pressed={musicSortKey === "artist"}
                    onClick={() => handleMusicSortClick("artist")}
                  >
                    歌手
                  </button>
                ) : (
                  <span>歌手</span>
                )}
                {canShowTrackStatus ? <span className="table-status-head">状态</span> : null}
              </div>
              <div className="table-body" ref={musicListRef}>
                {tracks.map((track, index) => {
                  const categoryMemberships = trackCategoryMembershipMap.get(track.id) ?? [];
                  const categoryIDSet = trackCategoryIdSetMap.get(track.id);
                  const isTrackFavorite = favoriteTrackIds.has(track.id);
                  const trackStatusLabel = getTrackStatusLabel(isTrackFavorite, categoryMemberships, favoriteCategories);
                  return (
                    <button
                      key={track.id}
                      type="button"
                      data-track-id={track.id}
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
                      <span className="row-artist">{track.artist}</span>
                      {canShowTrackStatus ? (
                        <span className="row-status" aria-label={trackStatusLabel} title={trackStatusLabel}>
                          <span className={`track-status-heart ${isTrackFavorite ? "active" : ""}`} title={isTrackFavorite ? "已收藏" : "未收藏"} aria-hidden="true">
                            <HeartStatusIcon filled={isTrackFavorite} />
                          </span>
                          {favoriteCategories.map((category) => {
                            const isInCategory = categoryIDSet?.has(category.id) ?? false;
                            return (
                              <span key={category.id} className={`track-status-heart ${isInCategory ? "active" : ""}`} title={`${category.name}：${isInCategory ? "已加入" : "未加入"}`} aria-hidden="true">
                                <HeartStatusIcon filled={isInCategory} />
                              </span>
                            );
                          })}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
                {!tracks.length ? (
                  <div className="empty-table">
                    {isLoading ? (isScanning ? "正在重新检查音乐文件夹" : activeTab === "收藏" ? "正在加载收藏歌曲" : activeTab === "分类" ? "正在加载分类歌曲" : "正在加载本地音乐列表") : emptyMessage}
                  </div>
                ) : null}
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
                  <button type="button" role="menuitem" onClick={() => openCategoryPicker(trackContextMenu.track)}>
                    加入分类
                  </button>
                  {isViewingActiveCategory ? (
                    <button type="button" role="menuitem" onClick={() => void removeTrackFromCurrentCategory(trackContextMenu.track)}>
                      移出分类
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {categoryContextMenu ? (
              <div className="context-menu-layer" role="presentation" onPointerDown={() => setCategoryContextMenu(null)}>
                <div
                  className="track-context-menu category-context-menu"
                  role="menu"
                  aria-label="分类操作"
                  style={{ left: categoryContextMenu.x, top: categoryContextMenu.y }}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <button type="button" role="menuitem" onClick={() => void handleDeleteCategory(categoryContextMenu.category)}>
                    删除分类
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

            {isCategoryDialogOpen ? (
              <div className="search-dialog-backdrop" role="presentation" onClick={closeCategoryDialog}>
                <form
                  className="search-dialog category-dialog"
                  role="dialog"
                  aria-modal="true"
                  aria-label="新建分类"
                  onClick={(event) => event.stopPropagation()}
                  onSubmit={handleCreateCategory}
                >
                  <h2>新建分类</h2>
                  <input
                    className="search-input"
                    type="text"
                    value={categoryName}
                    placeholder="输入分类名称"
                    aria-label="分类名称"
                    maxLength={favoriteCategoryNameMaxLength}
                    autoFocus
                    onChange={(event) => setCategoryName(event.target.value)}
                  />
                  <div className="search-actions">
                    <button type="button" onClick={closeCategoryDialog}>
                      取消
                    </button>
                    <button className="primary" type="submit" disabled={isCategorySubmitting}>
                      {isCategorySubmitting ? "创建中" : "确认"}
                    </button>
                  </div>
                </form>
              </div>
            ) : null}

            {categoryPickerTrack ? (
              <div className="search-dialog-backdrop" role="presentation" onClick={() => setCategoryPickerTrack(null)}>
                <div
                  className="search-dialog category-picker-dialog"
                  role="dialog"
                  aria-modal="true"
                  aria-label="加入分类"
                  onClick={(event) => event.stopPropagation()}
                >
                  <h2>加入分类</h2>
                  <div className="category-picker-list">
                    {favoriteCategories.map((category) => (
                      <button key={category.id} className="category-picker-option" type="button" onClick={() => void addTrackToCategory(category)}>
                        {category.name}
                      </button>
                    ))}
                  </div>
                  <div className="search-actions">
                    <button type="button" onClick={() => setCategoryPickerTrack(null)}>
                      取消
                    </button>
                  </div>
                </div>
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
            onlineUsers={onlineUsers}
            isOnlineCountUnavailable={isOnlineCountUnavailable}
            isRefreshingLibrary={isManualLibraryRefreshing || isScanning}
            libraryRefreshCooldownSeconds={manualLibraryRefreshCooldownSeconds}
            sleepTimerMinutes={sleepTimerMinutes}
            sleepTimerRemainingSeconds={sleepTimerRemainingSeconds}
            onSetSleepTimerMinutes={handleSetSleepTimerMinutes}
            onStartSleepTimer={handleStartSleepTimer}
            onStopSleepTimer={handleStopSleepTimer}
            onRefreshLibrary={handleManualLibraryRefresh}
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
            aria-label={page.label}
            aria-current={page.id === activePage ? "page" : undefined}
            title={page.label}
            onClick={() => handlePageClick(page.id)}
          >
            <span className="bottom-tab-icon" aria-hidden="true">
              <PageIcon page={page.id} />
            </span>
            <span className="sr-only">{page.label}</span>
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

function sortMusicTracks(tracks: Track[], sortKey: TrackSortKey | null) {
  if (!sortKey) {
    return tracks;
  }

  const artistCounts = sortKey === "artist" ? countTracksByArtist(tracks) : null;

  return [...tracks].sort((left, right) => {
    if (sortKey === "artist" && artistCounts) {
      const leftCount = artistCounts.get(left.artist) ?? 0;
      const rightCount = artistCounts.get(right.artist) ?? 0;
      if (leftCount !== rightCount) {
        return rightCount - leftCount;
      }
    }

    const primary = compareTrackText(getTrackSortValue(left, sortKey), getTrackSortValue(right, sortKey));
    if (primary !== 0) {
      return primary;
    }

    const title = compareTrackText(left.title, right.title);
    if (title !== 0) {
      return title;
    }

    const filename = compareTrackText(left.filename, right.filename);
    if (filename !== 0) {
      return filename;
    }

    return left.id - right.id;
  });
}

function sortFavoriteCategories(categories: FavoriteCategory[]) {
  return [...categories].sort((left, right) => {
    if (left.sort_order !== right.sort_order) {
      return left.sort_order - right.sort_order;
    }
    return left.id - right.id;
  });
}

function buildTrackCategoryMembershipMap(memberships: TrackCategoryMembership[]) {
  const membershipMap = new Map<number, TrackCategoryMembership[]>();
  for (const membership of memberships) {
    const trackMemberships = membershipMap.get(membership.track_id) ?? [];
    trackMemberships.push(membership);
    membershipMap.set(membership.track_id, trackMemberships);
  }
  return membershipMap;
}

function getTrackStatusLabel(isFavorite: boolean, memberships: TrackCategoryMembership[], categories: FavoriteCategory[]) {
  const categoryIDs = new Set(memberships.map((membership) => membership.category_id));
  const parts = [`收藏：${isFavorite ? "已收藏" : "未收藏"}`];
  for (const category of categories) {
    parts.push(`${category.name}：${categoryIDs.has(category.id) ? "已加入" : "未加入"}`);
  }
  return parts.join("，");
}

function countTracksByArtist(tracks: Track[]) {
  const counts = new Map<string, number>();
  for (const track of tracks) {
    counts.set(track.artist, (counts.get(track.artist) ?? 0) + 1);
  }
  return counts;
}

function getTrackSortValue(track: Track, sortKey: TrackSortKey) {
  return sortKey === "artist" ? track.artist : track.title;
}

function compareTrackText(left: string, right: string) {
  return left.localeCompare(right, "zh-Hans-CN", {
    numeric: true,
    sensitivity: "base"
  });
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

function scrollElementToListCenter(container: HTMLElement, element: HTMLElement) {
  const rowHeight = Math.max(1, element.offsetHeight);
  const centeredTop = element.offsetTop - (container.clientHeight - element.offsetHeight) / 2;
  const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
  const snappedTop = Math.round(centeredTop / rowHeight) * rowHeight;
  container.scrollTop = Math.min(Math.max(0, snappedTop), maxScrollTop);
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
  onScrollPositionChange: (trackID: number, top: number, activeLineIndex: number) => void;
}) {
  const activeLineRef = useRef<HTMLParagraphElement | null>(null);
  const lyricsListRef = useRef<HTMLDivElement | null>(null);
  const initialSyncedLineIndexRef = useRef<number | null>(null);
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

  useLayoutEffect(() => {
    initialSyncedLineIndexRef.current = null;
    const lyricsList = lyricsListRef.current;
    if (!lyricsList) {
      return;
    }
    markProgrammaticLyricsScroll(90);
    const canRestoreSavedPosition = Boolean(
      currentTrack &&
        savedScroll.trackID === currentTrack.id &&
        savedScroll.activeLineIndex === activeLineIndex
    );

    if (canRestoreSavedPosition) {
      lyricsList.scrollTop = savedScroll.top;
      initialSyncedLineIndexRef.current = activeLineIndex;
      return;
    }

    if (currentTrack && activeLineIndex >= 0 && activeLineRef.current) {
      activeLineRef.current.scrollIntoView({
        block: "center",
        behavior: "auto"
      });
      initialSyncedLineIndexRef.current = activeLineIndex;
      return;
    }

    lyricsList.scrollTop = 0;
  }, [currentTrack?.id, lines.length, savedScroll.trackID]);

  useEffect(() => {
    if (!currentTrack || activeLineIndex < 0) {
      return;
    }
    if (initialSyncedLineIndexRef.current === activeLineIndex) {
      initialSyncedLineIndexRef.current = null;
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
    onScrollPositionChange(currentTrack.id, top, activeLineIndex);
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

function getAuthSessionKey(session: AuthSession) {
  return `${session.userId ?? "phone"}:${session.phone}`;
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

function readManualLibraryRefreshAt() {
  const rawValue = readLocalStorage(manualLibraryRefreshStorageKey);
  const timestamp = rawValue ? Number(rawValue) : 0;
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
}

function persistManualLibraryRefreshAt(timestamp: number) {
  writeLocalStorage(manualLibraryRefreshStorageKey, String(timestamp));
}

function normalizeSleepTimerMinutes(minutes: number | null) {
  if (minutes === null || !Number.isFinite(minutes)) {
    return null;
  }
  const roundedMinutes = Math.floor(minutes);
  if (roundedMinutes < sleepTimerMinMinutes) {
    return null;
  }
  return Math.min(roundedMinutes, sleepTimerMaxMinutes);
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

function formatSleepTimerRemaining(seconds: number) {
  const remainingSeconds = Math.max(0, Math.ceil(seconds));
  const hours = Math.floor(remainingSeconds / 3600);
  const minutes = Math.floor((remainingSeconds % 3600) / 60);
  const rest = remainingSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function getOnlineSummary(onlineCount: number | null, onlineUsers: OnlineUser[], isUnavailable: boolean) {
  if (isUnavailable) {
    return "暂不可用";
  }
  if (onlineCount === null) {
    return "同步中";
  }
  if (onlineCount <= 0) {
    return "暂无在线用户";
  }

  const onlineNames = onlineUsers
    .map((user) => user.nickname.trim())
    .filter(Boolean);
  if (!onlineNames.length) {
    return `共 ${onlineCount} 人`;
  }

  return `${onlineNames.join("、")}，共 ${onlineCount} 人`;
}

function EmptyPage({
  page,
  authSession,
  onlineCount,
  onlineUsers,
  isOnlineCountUnavailable,
  isRefreshingLibrary,
  libraryRefreshCooldownSeconds,
  sleepTimerMinutes,
  sleepTimerRemainingSeconds,
  onSetSleepTimerMinutes,
  onStartSleepTimer,
  onStopSleepTimer,
  onRefreshLibrary,
  onLogout
}: {
  page: Exclude<AppPage, "music" | "lyrics">;
  authSession: AuthSession | null;
  onlineCount: number | null;
  onlineUsers: OnlineUser[];
  isOnlineCountUnavailable: boolean;
  isRefreshingLibrary: boolean;
  libraryRefreshCooldownSeconds: number;
  sleepTimerMinutes: number | null;
  sleepTimerRemainingSeconds: number | null;
  onSetSleepTimerMinutes: (minutes: number | null) => void;
  onStartSleepTimer: (minutes?: number) => void;
  onStopSleepTimer: () => void;
  onRefreshLibrary: () => void;
  onLogout: () => void;
}) {
  const pageContent: Record<Exclude<AppPage, "music" | "lyrics">, { title: string; message: string }> = {
    discover: { title: "发现", message: "暂无推荐" },
    profile: { title: "我", message: authSession ? authSession.nickname || authSession.phone : "未登录" }
  };
  const content = pageContent[page];
  const displayOnlineUsers = onlineUsers.length
    ? onlineUsers
    : authSession
      ? [{ user_id: authSession.userId, nickname: content.message }]
      : [];
  const onlineSummary = getOnlineSummary(onlineCount, displayOnlineUsers, isOnlineCountUnavailable);

  return (
    <section className="simple-page" aria-label={content.title}>
      {page === "profile" && authSession ? (
        <div className="profile-page-content">
          <div className="profile-row profile-identity-row">
            <span className="profile-row-title">账号</span>
            <span className="profile-name">{content.message}</span>
          </div>
          <div className="profile-row online-stat" aria-label="当前APP在线用户及总人数">
            <span className="profile-row-title">在线用户</span>
            <span className="online-summary" title={onlineSummary}>{onlineSummary}</span>
          </div>
          <SleepTimerPanel
            minutes={sleepTimerMinutes}
            remainingSeconds={sleepTimerRemainingSeconds}
            onSetMinutes={onSetSleepTimerMinutes}
            onStart={onStartSleepTimer}
            onStop={onStopSleepTimer}
          />
          <div className="profile-row profile-action-row">
            <span className="profile-row-title">音乐列表</span>
            <button
              className="profile-action-button refresh-library-button"
              type="button"
              disabled={isRefreshingLibrary || libraryRefreshCooldownSeconds > 0}
              onClick={onRefreshLibrary}
            >
              {isRefreshingLibrary ? "正在刷新" : "刷新音乐列表"}
            </button>
          </div>
          <div className="profile-row profile-action-row">
            <span className="profile-row-title">登录状态</span>
            <button className="profile-action-button logout-button" type="button" onClick={onLogout}>
              退出登录
            </button>
          </div>
          {libraryRefreshCooldownSeconds > 0 && !isRefreshingLibrary ? <div className="profile-action-hint">{libraryRefreshCooldownSeconds}秒后可再次刷新</div> : null}
        </div>
      ) : (
        <div className="simple-page-empty">{content.message}</div>
      )}
    </section>
  );
}

function SleepTimerPanel({
  minutes,
  remainingSeconds,
  onSetMinutes,
  onStart,
  onStop
}: {
  minutes: number | null;
  remainingSeconds: number | null;
  onSetMinutes: (minutes: number | null) => void;
  onStart: (minutes?: number) => void;
  onStop: () => void;
}) {
  const [customMinutes, setCustomMinutes] = useState(() => String(minutes ?? 30));
  const isRunning = remainingSeconds !== null;
  const customMinutesValue = parseSleepTimerInput(customMinutes);

  useEffect(() => {
    setCustomMinutes(String(minutes ?? 30));
  }, [minutes]);

  function handleCustomSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    handleStartClick();
  }

  function handleStartClick() {
    const nextMinutes = parseSleepTimerInput(customMinutes);
    if (!nextMinutes) {
      return;
    }
    setCustomMinutes(String(nextMinutes));
    onSetMinutes(nextMinutes);
    onStart(nextMinutes);
  }

  function handleCustomChange(value: string) {
    setCustomMinutes(value.replace(/\D/g, "").slice(0, 3));
  }

  const statusText = isRunning
    ? `剩余 ${formatSleepTimerRemaining(remainingSeconds)} 后停止播放`
    : "";

  return (
    <section className="profile-row sleep-timer-panel" aria-label="睡眠定时器">
      <div className="sleep-timer-header">
        <div className="sleep-timer-copy">
          <div className="sleep-timer-title">睡眠定时器</div>
          <div className="sleep-timer-status" aria-live="polite">
            {statusText}
          </div>
        </div>
        <form className="sleep-timer-custom" onSubmit={handleCustomSubmit}>
          <label className="sleep-timer-custom-field">
            <span className="sleep-timer-input-wrap">
              <input
                type="text"
                name="sleep_timer_minutes"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={3}
                value={customMinutes}
                placeholder={`${sleepTimerMinMinutes}-${sleepTimerMaxMinutes}`}
                aria-label="自定义睡眠定时器分钟数"
                onChange={(event) => handleCustomChange(event.target.value)}
              />
              <span className="sleep-timer-unit">分钟</span>
            </span>
          </label>
        </form>
        <button
          className={isRunning ? "sleep-timer-action is-running" : "sleep-timer-action"}
          type="button"
          disabled={!isRunning && !customMinutesValue}
          onClick={isRunning ? onStop : handleStartClick}
        >
          {isRunning ? "关闭定时器" : "开始"}
        </button>
      </div>
    </section>
  );
}

function parseSleepTimerInput(value: string) {
  if (!value.trim()) {
    return null;
  }
  return normalizeSleepTimerMinutes(Number(value));
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
      <path className="icon-accent" d="M5.5 20.4a2.9 2.9 0 1 0 0-5.8 2.9 2.9 0 0 0 0 5.8Zm10-2.1a2.9 2.9 0 1 0 0-5.8 2.9 2.9 0 0 0 0 5.8Z" />
      <path d="M8.4 17.5V5.9l9.9-2.2v11.6" />
      <path className="icon-detail" d="m8.4 8.5 9.9-2.2" />
      <circle cx="5.5" cy="17.5" r="2.9" />
      <circle cx="15.5" cy="15.4" r="2.9" />
    </IconBase>
  );
}

function DiscoverIcon() {
  return (
    <IconBase>
      <circle className="icon-accent" cx="12" cy="12" r="4.2" />
      <circle cx="12" cy="12" r="8.7" />
      <path d="m15.9 8.1-2.2 5.6-5.6 2.2 2.2-5.6z" />
      <path className="icon-detail" d="M12 3.3v1.8M12 18.9v1.8M20.7 12h-1.8M5.1 12H3.3" />
    </IconBase>
  );
}

function LyricsIcon() {
  return (
    <IconBase>
      <path className="icon-accent" d="M6.8 4.1h7l3.7 3.7v12.1H6.8z" />
      <path d="M6.5 4.1h7.4l3.6 3.6v12.2H6.5a2 2 0 0 1-2-2V6.1a2 2 0 0 1 2-2Z" />
      <path className="icon-detail" d="M13.9 4.1v3.6h3.6" />
      <path d="M8.1 10.4h5.5M8.1 13.5h3.9M8.1 16.6h3" />
      <path d="M15.4 16.6v-4.3l3.1-.7v4.3" />
      <circle cx="14.2" cy="16.8" r="1.2" />
      <circle cx="17.3" cy="16.1" r="1.2" />
    </IconBase>
  );
}

function ProfileIcon() {
  return (
    <IconBase>
      <path className="icon-accent" d="M12 12.4a4.1 4.1 0 1 0 0-8.2 4.1 4.1 0 0 0 0 8.2Zm-7.4 7.2c1-3.7 3.6-5.8 7.4-5.8s6.4 2.1 7.4 5.8Z" />
      <circle cx="12" cy="8.3" r="4.1" />
      <path d="M4.6 19.6c1-3.7 3.6-5.8 7.4-5.8s6.4 2.1 7.4 5.8" />
      <path className="icon-detail" d="M8.7 18.5h6.6" />
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

function HeartStatusIcon({ filled }: { filled: boolean }) {
  return (
    <IconBase>
      <path className={filled ? "heart-fill" : undefined} d="M12 20.1s-7.6-4.6-9.1-10A4.5 4.5 0 0 1 11 6.5l1 1.1 1-1.1a4.5 4.5 0 0 1 8.1 3.6c-1.5 5.4-9.1 10-9.1 10z" />
    </IconBase>
  );
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
