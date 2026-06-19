import { type CSSProperties, type FormEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject, type UIEvent as ReactUIEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  addFavoriteTrack,
  addFavoriteTrackToCategory,
  ApiError,
  authorizeAudioFileAccess,
  createFavoriteCategory,
  deleteAudioFile,
  deleteFavoriteCategory,
  getAudioFiles,
  getFavoriteCategories,
  getFavoriteTracks,
  getTrackMemberships,
  getTrackLyrics,
  getTracks,
  importAudioFolder,
  loginUser,
  refreshTracks,
  removeFavoriteTrack,
  removeFavoriteTrackFromCategory,
  renameAudioFile,
  sendPresenceHeartbeat,
  sendPresenceOffline,
  streamURL
} from "./api";
import type { AudioFileImportItemResult, AudioFileImportLimits, AudioFileImportReport, AuthUser, FavoriteCategory, LyricLine, Track, TrackCategoryMembership, TrackLyrics } from "./types";

type PlaybackMode = "all" | "one" | "shuffle";
type AppPage = "music" | "lyrics" | "discover" | "profile";
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
type AudioFileContextMenu = TrackContextMenu;
type AudioFileRenameDraft = {
  track: Track;
  artist: string;
  title: string;
  isSubmitting: boolean;
};
type AudioFileAccessGrant = {
  userId: number;
  token: string;
  expiresAt: number;
};
type AudioFileAccessDialogState = {
  isOpen: boolean;
  password: string;
  message: string;
  isSubmitting: boolean;
  showPassword: boolean;
  lockoutUntil: number | null;
};
type AudioImportPreflightStatus = "ready" | "duplicate" | "error" | "ignored";
type AudioImportPreflightKind = "audio" | "lyrics" | "other";
type AudioImportPreflightItem = {
  relativePath: string;
  displayName: string;
  kind: AudioImportPreflightKind;
  status: AudioImportPreflightStatus;
  reason: string;
  sizeBytes: number;
  targetFilename?: string;
};
type AudioImportPreflightReport = {
  files: File[];
  items: AudioImportPreflightItem[];
  readyAudioCount: number;
  readyLyricCount: number;
  duplicateCount: number;
  errorCount: number;
  ignoredCount: number;
  totalUploadBytes: number;
  uploadFileCount: number;
  blockingMessage: string;
};
type UploadAudioNameParts = {
  artist: string;
  title: string;
};
type UploadAudioTags = Partial<UploadAudioNameParts>;
type CategoryContextMenu = {
  category: FavoriteCategory;
  x: number;
  y: number;
};
type FloatingPanelPosition = {
  x: number;
  y: number;
  width?: number;
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
type ProfileView = "main" | "audioFiles";
type PlaybackQueueScope = { kind: "library" | "favorites" | "category" | "search"; categoryId?: number | null };
type DetachedCurrentTrack = {
  track: Track;
  queueIndex: number;
};
type BufferedAudioRange = {
  startPercent: number;
  endPercent: number;
};
const bufferedRangeChangeTolerancePercent = 0.05;
const bufferedFullCoverageToleranceSeconds = 0.75;
const bufferedRangeMergeGapPercent = 0.25;
const bufferUpdateResumeDelayMs = 900;
const fullyBufferedRanges: BufferedAudioRange[] = [{ startPercent: 0, endPercent: 100 }];

type MusicTab = "音乐列表" | "收藏" | "分类" | "歌曲搜索";
const appPages: Array<{ id: AppPage; label: string }> = [
  { id: "music", label: "音乐" },
  { id: "lyrics", label: "歌词" },
  { id: "discover", label: "发现" },
  { id: "profile", label: "我" }
];
const appPageIconSources: Record<AppPage, string> = {
  music: "/icons/nav-music-vivid.svg",
  lyrics: "/icons/nav-lyrics-vivid.svg",
  discover: "/icons/nav-discover-vivid.svg",
  profile: "/icons/nav-profile-vivid.svg"
};
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
const passwordMinLength = 6;
const passwordMaxLength = 64;
const mainlandPhonePattern = /^1[3-9]\d{9}$/;
const trackPlayClickCooldownMs = 450;
const trackSwitchDebounceWindowMs = 300;
const trackSwitchDebounceDelayMs = 250;
const musicListScrollSettleDelayMs = 160;
const musicListScrollSnapTolerancePx = 1.5;
const longPressDelayMs = 520;
const longPressMoveTolerancePx = 10;
const transientPopupAutoDismissMs = 12_000;
const contextMenuWidth = 148;
const trackContextMenuHeight = 96;
const categoryContextMenuHeight = 54;
const audioFileMenuWidth = 132;
const audioFileMenuHeight = 96;
const categorySelectorPopoverWidth = 104;
const categorySelectorOptionHeight = 43;
const categorySelectorBaseHeight = 18;
const categorySelectorPopoverMaxHeight = 320;
const anchoredDialogWidth = 168;
const anchoredDialogEstimatedHeight = 112;
const contextMenuMargin = 8;
const favoriteCategoryLimit = 12;
const favoriteCategoryNameMaxLength = 16;
const sleepTimerMinMinutes = 1;
const sleepTimerMaxMinutes = 360;
const defaultAudioFileLimits: AudioFileImportLimits = {
  max_audio_file_bytes: 200 * 1024 * 1024,
  max_total_bytes: 4 * 1024 * 1024 * 1024,
  max_file_count: 400,
  max_lyric_file_bytes: 2 * 1024 * 1024
};
const supportedAudioFileExtensions = new Set([".flac", ".wav", ".aif", ".aiff"]);
const supportedLyricFileExtensions = new Set([".lrc", ".txt"]);

function areBufferedRangesEqual(previous: BufferedAudioRange[], next: BufferedAudioRange[]) {
  if (previous.length !== next.length) {
    return false;
  }
  return previous.every((range, index) => {
    const nextRange = next[index];
    return (
      Math.abs(range.startPercent - nextRange.startPercent) <= bufferedRangeChangeTolerancePercent &&
      Math.abs(range.endPercent - nextRange.endPercent) <= bufferedRangeChangeTolerancePercent
    );
  });
}

function isFullyBufferedRangeSet(ranges: BufferedAudioRange[]) {
  return ranges.some(
    (range) =>
      range.startPercent <= bufferedRangeChangeTolerancePercent &&
      range.endPercent >= 100 - bufferedRangeChangeTolerancePercent
  );
}

function mergeBufferedRangeSets(previous: BufferedAudioRange[], next: BufferedAudioRange[]) {
  if (isFullyBufferedRangeSet(previous) || isFullyBufferedRangeSet(next)) {
    return fullyBufferedRanges;
  }

  const sortedRanges = [...previous, ...next]
    .filter((range) => range.endPercent > range.startPercent)
    .sort((first, second) => first.startPercent - second.startPercent);
  const mergedRanges: BufferedAudioRange[] = [];

  for (const range of sortedRanges) {
    const lastRange = mergedRanges[mergedRanges.length - 1];
    if (!lastRange || range.startPercent > lastRange.endPercent + bufferedRangeMergeGapPercent) {
      mergedRanges.push({ ...range });
      continue;
    }
    lastRange.endPercent = Math.max(lastRange.endPercent, range.endPercent);
  }

  return mergedRanges;
}

function isAudioFullyBuffered(audio: HTMLAudioElement, mediaDuration: number) {
  if (!Number.isFinite(mediaDuration) || mediaDuration <= 0 || audio.buffered.length === 0) {
    return false;
  }

  let coveredEnd = 0;
  let hasCoverageFromStart = false;
  for (let index = 0; index < audio.buffered.length; index += 1) {
    const start = Math.max(0, audio.buffered.start(index));
    const end = Math.min(mediaDuration, audio.buffered.end(index));
    if (end <= start) {
      continue;
    }
    if (!hasCoverageFromStart) {
      if (start > bufferedFullCoverageToleranceSeconds) {
        return false;
      }
      coveredEnd = end;
      hasCoverageFromStart = true;
      continue;
    }
    if (start > coveredEnd + bufferedFullCoverageToleranceSeconds) {
      return false;
    }
    coveredEnd = Math.max(coveredEnd, end);
  }

  return hasCoverageFromStart && coveredEnd >= mediaDuration - bufferedFullCoverageToleranceSeconds;
}

function App() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressStartRef = useRef<LongPressStart | null>(null);
  const categoryLongPressTimerRef = useRef<number | null>(null);
  const categoryLongPressStartRef = useRef<CategoryLongPressStart | null>(null);
  const suppressNextClickRef = useRef(false);
  const suppressNextCategoryClickRef = useRef(false);
  const popupActivityTimerRef = useRef<number | null>(null);
  const lastTrackPlayClickRef = useRef<{ trackID: number; clickedAt: number } | null>(null);
  const pendingTrackPlayTimerRef = useRef<number | null>(null);
  const initialAuthRef = useRef<AuthReadResult | null>(null);
  const initialAuthProfileRef = useRef<AuthFormState | null>(null);
  const presenceSessionIdRef = useRef<string | null>(null);
  const lyricsScrollStateRef = useRef<LyricsScrollState>({ trackID: null, top: 0, activeLineIndex: -1 });
  const musicListRef = useRef<HTMLDivElement | null>(null);
  const musicListScrollSettleTimerRef = useRef<number | null>(null);
  const shouldRevealCurrentTrackRef = useRef(false);
  const loadedLibrarySessionKeyRef = useRef<string | null>(null);
  const seekPointerIdRef = useRef<number | null>(null);
  const bufferUpdateResumeAtRef = useRef(0);
  const isCurrentTrackFullyBufferedRef = useRef(false);
  const audioFolderInputRef = useRef<HTMLInputElement | null>(null);
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
  const [authForm, setAuthForm] = useState<AuthFormState>(() => initialAuthProfileRef.current ?? createEmptyAuthForm());
  const [authMessage, setAuthMessage] = useState(initialAuthRef.current.expired ? "登录已过期，请重新登录" : "");
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [showAuthPassword, setShowAuthPassword] = useState(false);
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
  const [lastManualLibraryRefreshAt, setLastManualLibraryRefreshAt] = useState(() => readManualLibraryRefreshAt());
  const [manualLibraryRefreshClock, setManualLibraryRefreshClock] = useState(() => Date.now());
  const [isManualLibraryRefreshing, setIsManualLibraryRefreshing] = useState(false);
  const [isLibraryFiltered, setIsLibraryFiltered] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchDialogPosition, setSearchDialogPosition] = useState<FloatingPanelPosition | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isCategorySelectorOpen, setIsCategorySelectorOpen] = useState(false);
  const [categorySelectorPosition, setCategorySelectorPosition] = useState<FloatingPanelPosition | null>(null);
  const [isCategoryDialogOpen, setIsCategoryDialogOpen] = useState(false);
  const [categoryDialogPosition, setCategoryDialogPosition] = useState<FloatingPanelPosition | null>(null);
  const [categoryName, setCategoryName] = useState("");
  const [isCategorySubmitting, setIsCategorySubmitting] = useState(false);
  const [categoryPickerTrack, setCategoryPickerTrack] = useState<Track | null>(null);
  const [categoryPickerPosition, setCategoryPickerPosition] = useState<FloatingPanelPosition | null>(null);
  const [toastMessage, setToastMessage] = useState("");
  const [loadMessage, setLoadMessage] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(12);
  const [seekPreviewTime, setSeekPreviewTime] = useState<number | null>(null);
  const [duration, setDuration] = useState(185);
  const [bufferedRanges, setBufferedRanges] = useState<BufferedAudioRange[]>([]);
  const [sleepTimerMinutes, setSleepTimerMinutes] = useState<number | null>(30);
  const [sleepTimerEndsAt, setSleepTimerEndsAt] = useState<number | null>(null);
  const [sleepTimerNow, setSleepTimerNow] = useState(() => Date.now());
  const [profileView, setProfileView] = useState<ProfileView>("main");
  const [audioFiles, setAudioFiles] = useState<Track[]>([]);
  const [audioFileLimits, setAudioFileLimits] = useState<AudioFileImportLimits>(defaultAudioFileLimits);
  const [audioFilesMessage, setAudioFilesMessage] = useState("");
  const [audioImportReport, setAudioImportReport] = useState<AudioFileImportReport | null>(null);
  const [audioImportPreflight, setAudioImportPreflight] = useState<AudioImportPreflightReport | null>(null);
  const [audioFileAccess, setAudioFileAccess] = useState<AudioFileAccessGrant | null>(null);
  const [audioFileAccessDialog, setAudioFileAccessDialog] = useState<AudioFileAccessDialogState>(() => createClosedAudioFileAccessDialog());
  const [audioFileAccessClock, setAudioFileAccessClock] = useState(() => Date.now());
  const [isAudioFilesLoading, setIsAudioFilesLoading] = useState(false);
  const [isAudioImporting, setIsAudioImporting] = useState(false);
  const [audioFileMenu, setAudioFileMenu] = useState<AudioFileContextMenu | null>(null);
  const [audioRenameDraft, setAudioRenameDraft] = useState<AudioFileRenameDraft | null>(null);
  const [audioDeleteTarget, setAudioDeleteTarget] = useState<Track | null>(null);

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

  const hasTransientPopup = Boolean(
    trackContextMenu ||
      categoryContextMenu ||
      isPlaybackModeMenuOpen ||
      isSearchOpen ||
      isCategorySelectorOpen ||
      isCategoryDialogOpen ||
      categoryPickerTrack ||
      audioFileMenu ||
      audioRenameDraft ||
      audioDeleteTarget
  );
  const manualLibraryRefreshRemainingMs = Math.max(
    0,
    lastManualLibraryRefreshAt + manualLibraryRefreshCooldownMs - manualLibraryRefreshClock
  );
  const manualLibraryRefreshCooldownSeconds = Math.ceil(manualLibraryRefreshRemainingMs / 1000);
  const audioFileAccessLockoutSeconds = getAudioFileAccessLockoutSeconds(
    audioFileAccessDialog.lockoutUntil,
    audioFileAccessClock
  );

  useEffect(() => {
    if (!detachedCurrentTrack) {
      return;
    }
    if (currentTrackId !== detachedCurrentTrack.track.id || playbackQueue.some((track) => track.id === detachedCurrentTrack.track.id)) {
      setDetachedCurrentTrack(null);
    }
  }, [currentTrackId, detachedCurrentTrack, playbackQueue]);

  useEffect(() => {
    if (!authSession) {
      loadedLibrarySessionKeyRef.current = null;
      setAudioFileAccess(null);
      setAudioFileAccessDialog(createClosedAudioFileAccessDialog());
      setIsLoading(false);
      return;
    }
    setAudioFileAccess((previous) => (previous && previous.userId === authSession.userId ? previous : null));

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
    if (manualLibraryRefreshRemainingMs <= 0) {
      return;
    }

    const timeoutID = window.setTimeout(() => {
      setManualLibraryRefreshClock(Date.now());
    }, Math.min(1000, manualLibraryRefreshRemainingMs));

    return () => {
      window.clearTimeout(timeoutID);
    };
  }, [manualLibraryRefreshRemainingMs]);

  useEffect(() => {
    if (!audioFileAccessDialog.isOpen || !audioFileAccessDialog.lockoutUntil) {
      return;
    }

    const remainingMs = audioFileAccessDialog.lockoutUntil - Date.now();
    if (remainingMs <= 0) {
      setAudioFileAccessDialog((previous) => ({
        ...previous,
        message: "",
        lockoutUntil: null
      }));
      setAudioFileAccessClock(Date.now());
      return;
    }

    const timeoutID = window.setTimeout(() => {
      setAudioFileAccessClock(Date.now());
    }, Math.min(1000, remainingMs));

    return () => {
      window.clearTimeout(timeoutID);
    };
  }, [audioFileAccessDialog.isOpen, audioFileAccessDialog.lockoutUntil, audioFileAccessClock]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
      if (popupActivityTimerRef.current) {
        clearPopupActivityTimer();
      }
      clearPendingTrackPlay();
      cancelLongPress();
      cancelCategoryLongPress();
      clearMusicListScrollSettleTimer();
    };
  }, []);

  useEffect(() => {
    if (!hasTransientPopup) {
      clearPopupActivityTimer();
      return;
    }

    resetPopupActivityTimer();

    const markPopupActivity = () => {
      resetPopupActivityTimer();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeTransientPopups();
        return;
      }
      markPopupActivity();
    };

    document.addEventListener("pointerdown", markPopupActivity, true);
    document.addEventListener("input", markPopupActivity, true);
    document.addEventListener("wheel", markPopupActivity, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      clearPopupActivityTimer();
      document.removeEventListener("pointerdown", markPopupActivity, true);
      document.removeEventListener("input", markPopupActivity, true);
      document.removeEventListener("wheel", markPopupActivity, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [hasTransientPopup]);

  const sleepTimerRemainingSeconds = sleepTimerEndsAt ? Math.max(0, Math.ceil((sleepTimerEndsAt - sleepTimerNow) / 1000)) : null;

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
      return;
    }

    const reportPresence = async () => {
      try {
        await sendPresenceHeartbeat({
          session_id: sessionID,
          user_id: authSession.userId,
          phone: authSession.phone
        });
      } catch {
        // Presence reporting is best effort.
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
    seekPointerIdRef.current = null;
    bufferUpdateResumeAtRef.current = 0;
    isCurrentTrackFullyBufferedRef.current = false;
    setSeekPreviewTime(null);
    setDuration(currentTrack.duration_seconds ?? 185);
    setBufferedRanges([]);

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
  const displayCurrentTime = seekPreviewTime ?? currentTime;
  const progressMax = Math.max(activeDuration, currentTime, displayCurrentTime, 1);
  const progressValue = Math.min(displayCurrentTime, progressMax);
  const progressPercent = progressMax > 0 ? Math.min(100, Math.max(0, (progressValue / progressMax) * 100)) : 0;
  const progressStyle = { "--progress": `${progressPercent}%` } as CSSProperties;

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

  function appendTrackToPlaybackQueueWhen(track: Track, shouldAppend: (scope: PlaybackQueueScope) => boolean) {
    if (!shouldAppend(playbackQueueScope)) {
      return;
    }

    setPlaybackQueue((previous) => {
      if (previous.some((item) => item.id === track.id)) {
        return previous;
      }
      return [...previous, track];
    });
  }

  function appendTrackToFavoritePlaybackQueue(track: Track) {
    appendTrackToPlaybackQueueWhen(track, (scope) => scope.kind === "favorites");
  }

  function appendTrackToCategoryPlaybackQueue(track: Track, categoryID: number) {
    appendTrackToPlaybackQueueWhen(
      track,
      (scope) => scope.kind === "category" && scope.categoryId === categoryID
    );
  }

  function syncFavoritePlaybackQueue(nextTracks: Track[], categoryId?: number | null) {
    const isCategoryQueue = categoryId != null;
    const shouldSync =
      isCategoryQueue
        ? playbackQueueScope.kind === "category" && playbackQueueScope.categoryId === categoryId
        : playbackQueueScope.kind === "favorites";

    if (!shouldSync) {
      return;
    }

    setPlaybackQueue((previous) => {
      if (!previous.length) {
        return nextTracks;
      }
      const mergedQueue = mergePlaybackQueue(previous, nextTracks);
      return areTrackListsEqual(previous, mergedQueue) ? previous : mergedQueue;
    });
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

  function syncLibraryTracks(
    nextTracks: Track[],
    { resetQueue = false, forceVisible = false }: { resetQueue?: boolean; forceVisible?: boolean } = {}
  ) {
    const visibleTracks = sortMusicTracks(nextTracks, musicSortKey);
    setLibraryTracks((previous) => (areTrackListsEqual(previous, nextTracks) ? previous : nextTracks));
    if (forceVisible || activeTab === "音乐列表") {
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
    keepExistingOnError = false,
    manual = false,
    forceVisible = false
  }: {
    keepExistingOnError?: boolean;
    manual?: boolean;
    forceVisible?: boolean;
  } = {}) {
    setIsLoading(true);
    setLoadMessage("");
    setIsLibraryFiltered(false);
    try {
      let payload;
      if (manual) {
        const userID = authSession?.userId;
        if (!userID) {
          throw new Error("请先登录后刷新歌单");
        }
        payload = await refreshTracks(userID);
      } else {
        payload = await getTracks();
      }
      syncLibraryTracks(payload.tracks, { forceVisible });
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "本地音乐列表加载失败";
      if (!keepExistingOnError) {
        setLibraryTracks([]);
        if (activeTab === "音乐列表") {
          setTracks([]);
        }
      }
      setLoadMessage(message);
      return { ok: false, message };
    } finally {
      setIsLoading(false);
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
      syncFavoritePlaybackQueue(payload.tracks, categoryId);
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

  function handleTabClick(tab: MusicTab, target?: HTMLElement) {
    shouldRevealCurrentTrackRef.current = false;
    setActiveTab(tab);
    setActivePage("music");
    setActiveCategoryId(null);
    setIsPlaybackModeMenuOpen(false);
    setIsCategorySelectorOpen(false);
    setCategorySelectorPosition(null);
    setIsCategoryDialogOpen(false);
    setCategoryDialogPosition(null);
    setCategoryContextMenu(null);
    closeCategoryPicker();
    if (tab === "音乐列表") {
      setIsLibraryFiltered(false);
      setIsSearchOpen(false);
      setSearchDialogPosition(null);
      setTrackContextMenu(null);
      setLoadMessage("");
      setTracks(sortMusicTracks(libraryTracks, musicSortKey));
      return;
    }
    if (tab === "收藏") {
      setIsLibraryFiltered(false);
      setIsSearchOpen(false);
      setSearchDialogPosition(null);
      setTrackContextMenu(null);
      void refreshFavoriteTracks({ showList: true });
      return;
    }
    setSearchQuery("");
    setSearchDialogPosition(target ? getAnchoredDialogPosition(target) : null);
    setIsSearchOpen(true);
    setTrackContextMenu(null);
  }

  async function handleLibraryTabClick() {
    handleTabClick("音乐列表");

    if (isManualLibraryRefreshing) {
      return;
    }
    if (!authSession?.userId) {
      showToast("请先登录后刷新歌单");
      return;
    }
    if (manualLibraryRefreshRemainingMs > 0) {
      showToast(`歌单刷新太频繁，请${manualLibraryRefreshCooldownSeconds}秒后再试`);
      return;
    }

    setIsManualLibraryRefreshing(true);
    const result = await refreshLibrary({
      keepExistingOnError: true,
      manual: true,
      forceVisible: true
    });
    setIsManualLibraryRefreshing(false);

    if (!result.ok) {
      showToast(result.message ?? "歌单刷新失败");
      return;
    }

    const refreshedAt = Date.now();
    setLastManualLibraryRefreshAt(refreshedAt);
    setManualLibraryRefreshClock(refreshedAt);
    writeManualLibraryRefreshAt(refreshedAt);
    showToast("歌单已刷新");
  }

  function getCategorySelectorPosition(target: HTMLElement): FloatingPanelPosition {
    const rect = target.getBoundingClientRect();
    const availableWidth = Math.max(0, window.innerWidth - contextMenuMargin * 2);
    const width = Math.min(availableWidth, categorySelectorPopoverWidth);
    const estimatedHeight = Math.min(
      categorySelectorPopoverMaxHeight,
      categorySelectorBaseHeight + favoriteCategories.length * categorySelectorOptionHeight
    );
    const left = Math.min(
      Math.max(contextMenuMargin, rect.left),
      Math.max(contextMenuMargin, window.innerWidth - width - contextMenuMargin)
    );
    const belowTop = rect.bottom + contextMenuMargin;
    const aboveTop = rect.top - estimatedHeight - contextMenuMargin;
    const hasRoomBelow = belowTop + estimatedHeight <= window.innerHeight - contextMenuMargin;
    return {
      x: left,
      y: hasRoomBelow ? belowTop : Math.max(contextMenuMargin, aboveTop),
      width
    };
  }

  function getCenteredCategoryPickerPosition(): FloatingPanelPosition {
    const width = Math.min(Math.max(0, window.innerWidth - contextMenuMargin * 2), categorySelectorPopoverWidth);
    return {
      x: Math.max(contextMenuMargin, Math.round((window.innerWidth - width) / 2)),
      y: Math.max(contextMenuMargin, Math.round(window.innerHeight / 2 - categorySelectorPopoverMaxHeight / 2)),
      width
    };
  }

  function getAnchoredDialogPosition(target: HTMLElement): FloatingPanelPosition {
    const rect = target.getBoundingClientRect();
    const availableWidth = Math.max(0, window.innerWidth - contextMenuMargin * 2);
    const width = Math.min(availableWidth, anchoredDialogWidth);
    const maxX = Math.max(contextMenuMargin, window.innerWidth - width - contextMenuMargin);
    const belowTop = rect.bottom + contextMenuMargin;
    const aboveTop = rect.top - anchoredDialogEstimatedHeight - contextMenuMargin;
    const hasRoomBelow = belowTop + anchoredDialogEstimatedHeight <= window.innerHeight - contextMenuMargin;

    return {
      x: Math.min(Math.max(contextMenuMargin, rect.left), maxX),
      y: hasRoomBelow ? belowTop : Math.max(contextMenuMargin, aboveTop),
      width
    };
  }

  function handleCategorySelectorClick(event: ReactMouseEvent<HTMLButtonElement>) {
    setActivePage("music");
    setIsSearchOpen(false);
    setSearchDialogPosition(null);
    setTrackContextMenu(null);
    setCategoryContextMenu(null);
    closeCategoryPicker();
    setIsCategoryDialogOpen(false);
    setCategoryDialogPosition(null);
    if (!favoriteCategories.length) {
      showToast("请先创建分类");
      setIsCategoryDialogOpen(true);
      return;
    }
    setCategorySelectorPosition(getCategorySelectorPosition(event.currentTarget));
    setIsCategorySelectorOpen(true);
  }

  function closeCategorySelector() {
    setIsCategorySelectorOpen(false);
    setCategorySelectorPosition(null);
  }

  function closeCategoryPicker() {
    setCategoryPickerTrack(null);
    setCategoryPickerPosition(null);
  }

  function closeAudioFileOverlays() {
    setAudioFileMenu(null);
    setAudioImportPreflight(null);
    setAudioRenameDraft(null);
    setAudioDeleteTarget(null);
  }

  function getValidAudioFileAccessToken() {
    if (!authSession?.userId || !audioFileAccess) {
      return null;
    }
    if (audioFileAccess.userId !== authSession.userId || audioFileAccess.expiresAt <= Date.now()) {
      setAudioFileAccess(null);
      return null;
    }
    return audioFileAccess.token;
  }

  function openAudioFileAccessDialog(message = "") {
    setAudioFileAccessDialog({
      isOpen: true,
      password: "",
      message,
      isSubmitting: false,
      showPassword: false,
      lockoutUntil: null
    });
    setAudioFileAccessClock(Date.now());
  }

  function closeAudioFileAccessDialog() {
    setAudioFileAccessDialog(createClosedAudioFileAccessDialog());
  }

  function updateAudioFileAccessPassword(value: string) {
    setAudioFileAccessDialog((previous) => ({
      ...previous,
      password: value.slice(0, passwordMaxLength),
      message: ""
    }));
  }

  function toggleAudioFileAccessPasswordVisibility() {
    setAudioFileAccessDialog((previous) => ({
      ...previous,
      showPassword: !previous.showPassword
    }));
  }

  function clearPopupActivityTimer() {
    if (!popupActivityTimerRef.current) {
      return;
    }
    window.clearTimeout(popupActivityTimerRef.current);
    popupActivityTimerRef.current = null;
  }

  function resetPopupActivityTimer() {
    clearPopupActivityTimer();
    popupActivityTimerRef.current = window.setTimeout(() => {
      closeTransientPopups();
      popupActivityTimerRef.current = null;
    }, transientPopupAutoDismissMs);
  }

  function closeTransientPopups() {
    setTrackContextMenu(null);
    setCategoryContextMenu(null);
    setIsPlaybackModeMenuOpen(false);
    setIsCategorySelectorOpen(false);
    setCategorySelectorPosition(null);
    setCategoryPickerTrack(null);
    setCategoryPickerPosition(null);
    setIsCategoryDialogOpen(false);
    setCategoryDialogPosition(null);
    setCategoryName("");
    setIsSearchOpen(false);
    setSearchDialogPosition(null);
    setActiveTab((previous) => (previous === "歌曲搜索" ? "音乐列表" : previous));
    closeAudioFileOverlays();
  }

  function selectCategory(category: FavoriteCategory) {
    closeCategorySelector();
    handleCategoryClick(category);
  }

  function handleCustomCategoryClick(event: ReactMouseEvent<HTMLButtonElement>) {
    setActivePage("music");
    setIsSearchOpen(false);
    setSearchDialogPosition(null);
    setTrackContextMenu(null);
    setCategoryContextMenu(null);
    setIsCategorySelectorOpen(false);
    setCategorySelectorPosition(null);
    if (favoriteCategories.length >= favoriteCategoryLimit) {
      showToast(`最多创建${favoriteCategoryLimit}个分类`);
      return;
    }
    setCategoryDialogPosition(getAnchoredDialogPosition(event.currentTarget));
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
    setSearchDialogPosition(null);
    setIsCategorySelectorOpen(false);
    setCategorySelectorPosition(null);
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
    setIsCategorySelectorOpen(false);
    setCategorySelectorPosition(null);
    setIsCategoryDialogOpen(false);
    setCategoryDialogPosition(null);
    closeCategoryPicker();
    closeAudioFileOverlays();
    if (page !== "profile") {
      setProfileView("main");
    }
    if (page === "lyrics") {
      setIsSearchOpen(false);
      setSearchDialogPosition(null);
      return;
    }
    if (page !== "music") {
      setIsSearchOpen(false);
      setSearchDialogPosition(null);
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

  function handleAuthCloseAttempt() {
    setAuthMessage("请先登录后继续");
  }

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationMessage = getAuthValidationMessage(authForm);
    if (validationMessage) {
      setAuthMessage(validationMessage);
      return;
    }

    setIsAuthSubmitting(true);
    try {
      const phone = normalizePhone(authForm.phone);
      const response = await loginUser({
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
      setProfileView("main");
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
    setAuthForm((previous) => ({ ...previous, password: "" }));
    setAuthMessage("");
    setShowAuthPassword(false);
    setActivePage("music");
    setProfileView("main");
    setIsSearchOpen(false);
    setSearchDialogPosition(null);
    setActiveTab("音乐列表");
    setActiveCategoryId(null);
    setLibraryTracks([]);
    setTracks([]);
    setFavoriteTrackIds(new Set());
    setTrackCategoryMembershipMap(new Map());
    setFavoriteCategories([]);
    setAudioFiles([]);
    setAudioFilesMessage("");
    setAudioImportReport(null);
    setAudioImportPreflight(null);
    setAudioFileAccess(null);
    setAudioFileAccessDialog(createClosedAudioFileAccessDialog());
    setTrackContextMenu(null);
    setCategoryContextMenu(null);
    setIsCategorySelectorOpen(false);
    setCategorySelectorPosition(null);
    setIsCategoryDialogOpen(false);
    setCategoryDialogPosition(null);
    closeAudioFileOverlays();
    closeCategoryPicker();
    setIsPlaybackModeMenuOpen(false);
  }

  function closeSearchDialog() {
    setIsSearchOpen(false);
    setSearchDialogPosition(null);
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

  async function refreshAudioFiles({
    silent = false,
    accessToken: providedAccessToken
  }: {
    silent?: boolean;
    accessToken?: string;
  } = {}) {
    if (!authSession?.userId) {
      setAudioFiles([]);
      setAudioFilesMessage("请先登录后管理服务器音频文件");
      return { ok: false };
    }
    const accessToken = providedAccessToken ?? getValidAudioFileAccessToken();
    if (!accessToken) {
      setAudioFilesMessage("请先验证当前用户密码后再管理服务器音频文件");
      if (!silent) {
        openAudioFileAccessDialog();
      }
      return { ok: false };
    }

    if (!silent) {
      setIsAudioFilesLoading(true);
    }
    try {
      const payload = await getAudioFiles(authSession.userId, accessToken);
      setAudioFiles(payload.files);
      setAudioFileLimits(payload.limits);
      setAudioFilesMessage("");
      return { ok: true, files: payload.files, limits: payload.limits };
    } catch (error) {
      const message = error instanceof Error ? error.message : "读取服务器音频文件失败";
      setAudioFilesMessage(message);
      if (!silent) {
        showToast(message);
      }
      return { ok: false, message };
    } finally {
      if (!silent) {
        setIsAudioFilesLoading(false);
      }
    }
  }

  function openAudioFileManager() {
    if (!authSession?.userId) {
      showToast("请先登录后管理服务器音频文件");
      return;
    }
    const accessToken = getValidAudioFileAccessToken();
    if (!accessToken) {
      openAudioFileAccessDialog();
      return;
    }
    enterAudioFileManager(accessToken);
  }

  function enterAudioFileManager(accessToken?: string) {
    closeAudioFileOverlays();
    setProfileView("audioFiles");
    setAudioImportReport(null);
    setAudioImportPreflight(null);
    void refreshAudioFiles({ accessToken });
  }

  async function submitAudioFileAccessDialog(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!authSession?.userId || audioFileAccessDialog.isSubmitting || audioFileAccessLockoutSeconds > 0) {
      return;
    }
    const password = audioFileAccessDialog.password;
    if (password.length < passwordMinLength || password.length > passwordMaxLength) {
      setAudioFileAccessDialog((previous) => ({
        ...previous,
        message: `密码长度需为${passwordMinLength}-${passwordMaxLength}位`
      }));
      return;
    }

    setAudioFileAccessDialog((previous) => ({
      ...previous,
      isSubmitting: true,
      message: ""
    }));
    try {
      const response = await authorizeAudioFileAccess(authSession.userId, password);
      const expiresAt = Date.parse(response.expires_at);
      if (!response.token || !Number.isFinite(expiresAt)) {
        throw new Error("授权结果无效，请重试");
      }
      setAudioFileAccess({
        userId: authSession.userId,
        token: response.token,
        expiresAt
      });
      closeAudioFileAccessDialog();
      enterAudioFileManager(response.token);
    } catch (error) {
      setAudioFileAccessDialog((previous) => ({
        ...previous,
        isSubmitting: false,
        message: error instanceof Error ? error.message : "验证失败，请重试",
        lockoutUntil: getAudioFileAccessLockoutUntil(error)
      }));
      setAudioFileAccessClock(Date.now());
    }
  }

  function closeAudioFileManager() {
    closeAudioFileOverlays();
    setProfileView("main");
  }

  function handleChooseAudioFolder() {
    if (isAudioImporting) {
      return;
    }
    setAudioImportPreflight(null);
    audioFolderInputRef.current?.click();
  }

  async function handleAudioFolderChange(files: FileList | null) {
    const selectedFiles = Array.from(files ?? []);
    if (!selectedFiles.length) {
      return;
    }
    if (!authSession?.userId) {
      showToast("请先登录后上传音频文件");
      return;
    }

    setIsAudioFilesLoading(true);
    setAudioFilesMessage("");
    setAudioImportReport(null);
    try {
      const latest = await refreshAudioFiles({ silent: true });
      const serverFiles = latest.ok && "files" in latest && latest.files ? latest.files : audioFiles;
      const limits = latest.ok && "limits" in latest && latest.limits ? latest.limits : audioFileLimits;
      const report = await buildAudioImportPreflight(selectedFiles, serverFiles, limits);
      if (!report.items.length) {
        setAudioFilesMessage("文件夹中没有可检查的文件");
        return;
      }
      setAudioImportPreflight(report);
      setAudioFilesMessage(report.files.length ? "预检完成，请确认报告后上传" : "预检完成：没有可上传的音频文件");
    } catch (error) {
      const message = error instanceof Error ? error.message : "生成上传报告失败";
      setAudioFilesMessage(message);
      showToast(message);
    } finally {
      setIsAudioFilesLoading(false);
    }
  }

  async function confirmAudioImportPreflight() {
    if (!authSession?.userId || !audioImportPreflight) {
      return;
    }
    const uploadFiles = audioImportPreflight.files;
    const accessToken = getValidAudioFileAccessToken();
    if (!accessToken) {
      openAudioFileAccessDialog("授权已过期，请重新验证");
      return;
    }
    if (audioImportPreflight.blockingMessage) {
      setAudioFilesMessage(audioImportPreflight.blockingMessage);
      showToast(audioImportPreflight.blockingMessage);
      return;
    }
    if (!audioImportPreflight.files.length) {
      setAudioFilesMessage("没有可上传的音频文件");
      return;
    }

    setIsAudioImporting(true);
    setAudioFilesMessage("");
    setAudioImportReport(null);
    try {
      const report = await importAudioFolder(authSession.userId, uploadFiles, accessToken);
      setAudioImportReport(report);
      setAudioImportPreflight(null);
      try {
        await refreshAudioFiles({ silent: true });
        await refreshLibrary({ keepExistingOnError: true });
        setAudioFilesMessage("导入完成，请查看结果报告");
      } catch (refreshError) {
        const refreshMessage = refreshError instanceof Error ? refreshError.message : "刷新音频列表失败";
        setAudioFilesMessage(`导入完成，但刷新列表失败：${refreshMessage}`);
      }
      showToast(`导入完成：成功 ${report.imported} 首，跳过 ${report.skipped} 个，失败 ${report.failed} 个`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "上传导入失败";
      setAudioImportReport(buildAudioImportFailureReport(uploadFiles, message));
      setAudioImportPreflight(null);
      setAudioFilesMessage("上传失败，请查看结果报告");
      showToast(message);
    } finally {
      setIsAudioImporting(false);
    }
  }

  function openAudioFileMenu(track: Track, clientX: number, clientY: number) {
    const maxX = Math.max(contextMenuMargin, window.innerWidth - audioFileMenuWidth - contextMenuMargin);
    const maxY = Math.max(contextMenuMargin, window.innerHeight - audioFileMenuHeight - contextMenuMargin);
    setAudioRenameDraft(null);
    setAudioDeleteTarget(null);
    setAudioFileMenu({
      track,
      x: Math.min(Math.max(contextMenuMargin, clientX), maxX),
      y: Math.min(Math.max(contextMenuMargin, clientY), maxY)
    });
  }

  function handleAudioFileContextMenu(event: ReactMouseEvent<HTMLElement>, track: Track) {
    event.preventDefault();
    openAudioFileMenu(track, event.clientX, event.clientY);
  }

  function openAudioRenameDialog(track: Track) {
    setAudioFileMenu(null);
    setAudioRenameDraft({
      track,
      artist: track.artist,
      title: track.title,
      isSubmitting: false
    });
  }

  function updateAudioRenameDraft(field: "artist" | "title", value: string) {
    setAudioRenameDraft((draft) => (draft ? { ...draft, [field]: value } : draft));
  }

  async function submitAudioRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!authSession?.userId || !audioRenameDraft) {
      return;
    }
    const accessToken = getValidAudioFileAccessToken();
    if (!accessToken) {
      openAudioFileAccessDialog("授权已过期，请重新验证");
      return;
    }
    const artist = audioRenameDraft.artist.trim();
    const title = audioRenameDraft.title.trim();
    if (!artist || !title) {
      showToast("请填写歌手和歌曲名");
      return;
    }

    const target = audioRenameDraft.track;
    setAudioRenameDraft((draft) => (draft ? { ...draft, isSubmitting: true } : draft));
    try {
      await renameAudioFile(target.id, {
        user_id: authSession.userId,
        artist,
        title
      }, accessToken);
      setAudioRenameDraft(null);
      await refreshAudioFiles({ silent: true });
      await refreshLibrary({ keepExistingOnError: true });
      showToast("文件已重命名");
    } catch (error) {
      setAudioRenameDraft((draft) => (draft ? { ...draft, isSubmitting: false } : draft));
      showToast(error instanceof Error ? error.message : "重命名失败");
    }
  }

  function openAudioDeleteDialog(track: Track) {
    setAudioFileMenu(null);
    setAudioDeleteTarget(track);
  }

  async function confirmAudioDelete() {
    if (!authSession?.userId || !audioDeleteTarget) {
      return;
    }
    const accessToken = getValidAudioFileAccessToken();
    if (!accessToken) {
      openAudioFileAccessDialog("授权已过期，请重新验证");
      return;
    }
    const target = audioDeleteTarget;
    setIsAudioFilesLoading(true);
    try {
      await deleteAudioFile(authSession.userId, target.id, accessToken);
      setAudioDeleteTarget(null);
      await refreshAudioFiles({ silent: true });
      await refreshLibrary({ keepExistingOnError: true });
      await refreshTrackMemberships();
      showToast("音频文件已删除");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "删除失败");
    } finally {
      setIsAudioFilesLoading(false);
    }
  }

  function clearMusicListScrollSettleTimer() {
    if (!musicListScrollSettleTimerRef.current) {
      return;
    }
    window.clearTimeout(musicListScrollSettleTimerRef.current);
    musicListScrollSettleTimerRef.current = null;
  }

  function handleMusicListScroll(event: ReactUIEvent<HTMLDivElement>) {
    const listElement = event.currentTarget;
    clearMusicListScrollSettleTimer();
    musicListScrollSettleTimerRef.current = window.setTimeout(() => {
      musicListScrollSettleTimerRef.current = null;
      settleMusicListScrollPosition(listElement);
    }, musicListScrollSettleDelayMs);
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
    if (favoriteCategories.length >= favoriteCategoryLimit) {
      showToast(`最多创建${favoriteCategoryLimit}个分类`);
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
      setCategoryDialogPosition(null);
      setIsCategorySelectorOpen(false);
      setCategorySelectorPosition(null);
      setActiveTab("分类");
      setActiveCategoryId(payload.category.id);
      setIsLibraryFiltered(false);
      setIsSearchOpen(false);
      setSearchDialogPosition(null);
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
    setCategoryDialogPosition(null);
    setCategoryName("");
  }

  async function handleDeleteCategory(category: FavoriteCategory) {
    if (!authSession?.userId) {
      setCategoryContextMenu(null);
      showToast("请先登录后删除分类");
      return;
    }

    setCategoryContextMenu(null);
    setIsCategorySelectorOpen(false);
    setCategorySelectorPosition(null);
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
      setSearchDialogPosition(null);
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
    const now = Date.now();
    const lastTrackPlayClick = lastTrackPlayClickRef.current;
    const isCurrentTrack = currentTrack?.id === track.id;
    if (isCurrentTrack && isPlaying) {
      clearPendingTrackPlay();
      return;
    }
    if (isCurrentTrack && !isPlaying) {
      clearPendingTrackPlay();
      lastTrackPlayClickRef.current = { trackID: track.id, clickedAt: now };
      playTrack(track);
      return;
    }
    if (lastTrackPlayClick?.trackID === track.id && now - lastTrackPlayClick.clickedAt < trackPlayClickCooldownMs) {
      return;
    }
    if (lastTrackPlayClick && lastTrackPlayClick.trackID !== track.id && now - lastTrackPlayClick.clickedAt < trackSwitchDebounceWindowMs) {
      scheduleTrackPlay(track, now);
      return;
    }
    clearPendingTrackPlay();
    lastTrackPlayClickRef.current = { trackID: track.id, clickedAt: now };
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

  function clearPendingTrackPlay() {
    if (!pendingTrackPlayTimerRef.current) {
      return;
    }
    window.clearTimeout(pendingTrackPlayTimerRef.current);
    pendingTrackPlayTimerRef.current = null;
  }

  function scheduleTrackPlay(track: Track, clickedAt: number) {
    clearPendingTrackPlay();
    lastTrackPlayClickRef.current = { trackID: track.id, clickedAt };
    pendingTrackPlayTimerRef.current = window.setTimeout(() => {
      pendingTrackPlayTimerRef.current = null;
      playTrack(track);
    }, trackSwitchDebounceDelayMs);
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
        appendTrackToFavoritePlaybackQueue(track);
        showToast("已收藏");
      }
      if (activeTab === "收藏" || activeTab === "分类" || playbackQueueScope.kind === "favorites") {
        void refreshFavoriteTracks({
          showList: activeTab === "收藏" || activeTab === "分类",
          categoryId: activeTab === "分类" ? activeCategoryId : undefined
        });
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

  function openCategoryPicker(track: Track, target?: HTMLElement) {
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
    setCategoryPickerPosition(target ? getCategorySelectorPosition(target) : getCenteredCategoryPickerPosition());
    setCategoryPickerTrack(track);
  }

  async function addTrackToCategory(category: FavoriteCategory) {
    if (!authSession?.userId || !categoryPickerTrack) {
      closeCategoryPicker();
      return;
    }

    const track = categoryPickerTrack;
    closeCategoryPicker();
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
      appendTrackToCategoryPlaybackQueue(track, category.id);
      if (
        (activeTab === "分类" && activeCategoryId === category.id) ||
        (playbackQueueScope.kind === "category" && playbackQueueScope.categoryId === category.id)
      ) {
        void refreshFavoriteTracks({ showList: activeTab === "分类" && activeCategoryId === category.id, categoryId: category.id });
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
    clearPendingTrackPlay();
    setDetachedCurrentTrack(null);
    setPlaybackQueue(tracks.length ? tracks : [track]);
    setPlaybackQueueScope(getActivePlaybackQueueScope());
    setCurrentTrackId(track.id);
    setIsPlaying(Boolean(track.stream_url));
  }

  function playTrackFromQueue(track: Track) {
    clearPendingTrackPlay();
    setDetachedCurrentTrack(null);
    setCurrentTrackId(track.id);
    setIsPlaying(Boolean(track.stream_url));
  }

  function togglePlay() {
    clearPendingTrackPlay();
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
    const clampedTime = clampSeekTime(nextTime);
    if (audioRef.current && currentTrack?.stream_url) {
      audioRef.current.currentTime = clampedTime;
    }
    setCurrentTime(clampedTime);
    setSeekPreviewTime(null);
  }

  function clampSeekTime(value: number) {
    if (!Number.isFinite(value)) {
      return 0;
    }
    return Math.min(progressMax, Math.max(0, value));
  }

  function previewSeek(value: number) {
    setSeekPreviewTime(clampSeekTime(value));
  }

  function clearProgressDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    seekPointerIdRef.current = null;
    bufferUpdateResumeAtRef.current = Date.now() + bufferUpdateResumeDelayMs;
  }

  function updateBufferedRanges(audio: HTMLAudioElement) {
    const mediaDuration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : activeDuration;
    if (isCurrentTrackFullyBufferedRef.current) {
      setBufferedRanges((previous) => (areBufferedRangesEqual(previous, fullyBufferedRanges) ? previous : fullyBufferedRanges));
      return;
    }
    if (seekPointerIdRef.current !== null || Date.now() < bufferUpdateResumeAtRef.current) {
      return;
    }
    if (!mediaDuration) {
      setBufferedRanges((previous) => (previous.length ? [] : previous));
      return;
    }
    if (isAudioFullyBuffered(audio, mediaDuration)) {
      isCurrentTrackFullyBufferedRef.current = true;
      setBufferedRanges((previous) => (areBufferedRangesEqual(previous, fullyBufferedRanges) ? previous : fullyBufferedRanges));
      return;
    }

    const nextRanges: BufferedAudioRange[] = [];
    for (let index = 0; index < audio.buffered.length; index += 1) {
      const start = Math.max(0, audio.buffered.start(index));
      const end = Math.min(mediaDuration, audio.buffered.end(index));
      if (end <= start) {
        continue;
      }
      nextRanges.push({
        startPercent: Math.min(100, Math.max(0, (start / mediaDuration) * 100)),
        endPercent: Math.min(100, Math.max(0, (end / mediaDuration) * 100))
      });
    }
    setBufferedRanges((previous) => {
      const mergedRanges = mergeBufferedRangeSets(previous, nextRanges);
      if (isFullyBufferedRangeSet(mergedRanges)) {
        isCurrentTrackFullyBufferedRef.current = true;
      }
      return areBufferedRangesEqual(previous, mergedRanges) ? previous : mergedRanges;
    });
  }

  function getSeekTimeFromPointer(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width) {
      return 0;
    }
    const progressRatio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    return progressRatio * progressMax;
  }

  function handleProgressPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    seekPointerIdRef.current = event.pointerId;
    bufferUpdateResumeAtRef.current = Date.now() + bufferUpdateResumeDelayMs;
    previewSeek(getSeekTimeFromPointer(event));
  }

  function handleProgressPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (seekPointerIdRef.current !== event.pointerId) {
      return;
    }
    event.preventDefault();
    bufferUpdateResumeAtRef.current = Date.now() + bufferUpdateResumeDelayMs;
    previewSeek(getSeekTimeFromPointer(event));
  }

  function handleProgressPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (seekPointerIdRef.current !== event.pointerId) {
      return;
    }
    event.preventDefault();
    const nextTime = getSeekTimeFromPointer(event);
    clearProgressDrag(event);
    handleSeek(String(nextTime));
  }

  function handleProgressPointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    if (seekPointerIdRef.current !== event.pointerId) {
      return;
    }
    clearProgressDrag(event);
    setSeekPreviewTime(null);
  }

  function handleProgressLostPointerCapture(event: ReactPointerEvent<HTMLDivElement>) {
    if (seekPointerIdRef.current !== event.pointerId) {
      return;
    }
    seekPointerIdRef.current = null;
    setSeekPreviewTime(null);
  }

  function handleProgressInputChange(value: string) {
    const nextTime = Number(value);
    if (!Number.isFinite(nextTime)) {
      return;
    }
    if (seekPointerIdRef.current !== null) {
      previewSeek(nextTime);
      return;
    }
    handleSeek(value);
  }

  function updateLyricsScrollPosition(trackID: number, top: number, activeLineIndex: number) {
    lyricsScrollStateRef.current = { trackID, top, activeLineIndex };
  }

  const activeCategory = favoriteCategories.find((category) => category.id === activeCategoryId) ?? null;
  const emptyMessage = loadMessage || (activeTab === "收藏" ? "暂无收藏歌曲" : activeTab === "分类" ? "暂无分类歌曲" : "暂无本地音乐");
  const isAuthVisible = !authSession;
  const canSubmitAuth = !isAuthSubmitting && isAuthFormReady(authForm);
  const playingTrackId = isPlaying ? currentTrack?.id ?? null : null;
  const activeMenuTrack = trackContextMenu?.track ?? null;
  const isActiveMenuTrackFavorite = activeMenuTrack ? favoriteTrackIds.has(activeMenuTrack.id) : false;
  const isViewingActiveCategory = activeTab === "分类" && Boolean(activeCategory);
  const lyricLines = trackLyrics?.lines ?? [];
  const activeLyricIndex = getActiveLyricIndex(lyricLines, currentTime);
  const canSortMusicColumns = activeTab === "音乐列表";
  const canShowTrackStatus = activeTab === "音乐列表" || activeTab === "收藏" || activeTab === "分类";
  const statusCategory = activeTab === "分类" ? activeCategory : null;
  const currentTrackLabel = currentTrack ? `${currentTrack.artist} - ${currentTrack.title}` : "";

  return (
    <main className="player-screen" aria-label="MediaPlayer">
      <div className="top-line" />
      {activePage !== "music" && currentTrackLabel ? (
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
            {currentTrackLabel ? (
              <div className="now-playing-ticker" aria-label={`当前正在播放：${currentTrackLabel}`} aria-live="polite">
                <div className="now-playing-ticker-track">
                  <span>{currentTrackLabel}</span>
                  <span aria-hidden="true">{currentTrackLabel}</span>
                </div>
              </div>
            ) : null}
            <nav className="mode-tabs" aria-label="播放器视图">
              <button
                className={activeTab === "音乐列表" ? "active" : ""}
                type="button"
                aria-current={activeTab === "音乐列表" ? "page" : undefined}
                aria-label={isManualLibraryRefreshing ? "正在刷新歌单" : "刷新歌单"}
                title={manualLibraryRefreshRemainingMs > 0 ? `${manualLibraryRefreshCooldownSeconds}秒后可刷新歌单` : "刷新歌单"}
                disabled={isManualLibraryRefreshing}
                onClick={() => void handleLibraryTabClick()}
              >
                歌单
              </button>
              <button className={activeTab === "收藏" ? "active" : ""} type="button" aria-current={activeTab === "收藏" ? "page" : undefined} onClick={() => handleTabClick("收藏")}>
                我喜欢
              </button>
              <button
                className="category-select-tab"
                type="button"
                aria-label={activeCategory ? `分类：${activeCategory.name}` : "分类"}
                title={activeCategory ? `当前分类：${activeCategory.name}` : "选择分类"}
                onClick={handleCategorySelectorClick}
              >
                分类
              </button>
              {activeTab === "分类" && activeCategory ? (
                <span className="active-category-name" aria-current="page" aria-label={`当前分类：${activeCategory.name}`} title={activeCategory.name}>
                  <span className="active-category-name-text">{activeCategory.name}</span>
                </span>
              ) : null}
              <button className="custom-category-trigger" type="button" onClick={handleCustomCategoryClick}>
                自定义
              </button>
              <button className={activeTab === "歌曲搜索" ? "active search-tab" : "search-tab"} type="button" aria-current={activeTab === "歌曲搜索" ? "page" : undefined} onClick={(event) => handleTabClick("歌曲搜索", event.currentTarget)}>
                歌曲搜索
              </button>
            </nav>

            <section className={`song-table ${canShowTrackStatus ? "with-status" : ""}`} aria-label="本地音乐列表" aria-busy={isLoading}>
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
              <div className="table-body" ref={musicListRef} onScroll={handleMusicListScroll}>
                {tracks.map((track, index) => {
                  const categoryMemberships = trackCategoryMembershipMap.get(track.id) ?? [];
                  const isTrackFavorite = favoriteTrackIds.has(track.id);
                  const categoryCount = getTrackCategoryCount(categoryMemberships);
                  const trackStatusLabel = getTrackStatusLabel(isTrackFavorite, categoryMemberships, favoriteCategories, statusCategory);
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
                        <span
                          className="row-status"
                          aria-label={trackStatusLabel}
                          title={trackStatusLabel}
                          onClick={(event) => {
                            event.stopPropagation();
                            openCategoryPicker(track, event.currentTarget);
                          }}
                          onPointerDown={(event) => event.stopPropagation()}
                        >
                          <span className={`track-status-heart ${isTrackFavorite ? "active" : ""}`} title={isTrackFavorite ? "已收藏" : "未收藏"} aria-hidden="true">
                            <HeartStatusIcon filled={isTrackFavorite} />
                          </span>
                          <span className={`track-category-count ${categoryCount > 0 ? "active" : ""}`} aria-hidden="true">
                            {categoryCount}
                          </span>
                        </span>
                      ) : null}
                    </button>
                  );
                })}
                {!tracks.length ? (
                  <div className="empty-table">
                    {isLoading ? (activeTab === "收藏" ? "正在加载收藏歌曲" : activeTab === "分类" ? "正在加载分类歌曲" : "正在加载本地音乐列表") : emptyMessage}
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
                  {isViewingActiveCategory ? (
                    <button type="button" role="menuitem" onClick={() => void removeTrackFromCurrentCategory(trackContextMenu.track)}>
                      移出分类
                    </button>
                  ) : (
                    <button type="button" role="menuitem" onClick={() => void toggleFavorite(trackContextMenu.track)}>
                      {isActiveMenuTrackFavorite ? "取消收藏" : "收藏"}
                    </button>
                  )}
                  <button type="button" role="menuitem" onClick={(event) => openCategoryPicker(trackContextMenu.track, event.currentTarget)}>
                    加入分类
                  </button>
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

            {isCategorySelectorOpen ? (
              <div className="search-dialog-backdrop category-selector-backdrop" role="presentation" onClick={closeCategorySelector}>
                <div
                  className="search-dialog category-picker-dialog category-selector-dialog"
                  role="menu"
                  aria-label="自定义分类"
                  style={categorySelectorPosition ? { left: categorySelectorPosition.x, top: categorySelectorPosition.y, width: categorySelectorPosition.width } : undefined}
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="category-picker-list">
                    {favoriteCategories.map((category) => (
                      <button
                        key={category.id}
                        className="category-picker-option category-selector-option"
                        type="button"
                        role="menuitem"
                        title={`${category.name}，长按删除`}
                        onClick={() => selectCategory(category)}
                        onContextMenu={(event) => handleCategoryContextMenu(event, category)}
                        onPointerDown={(event) => handleCategoryPointerDown(event, category)}
                        onPointerMove={handleCategoryPointerMove}
                        onPointerUp={cancelCategoryLongPress}
                        onPointerCancel={cancelCategoryLongPress}
                        onPointerLeave={cancelCategoryLongPress}
                        onDragStart={(event) => event.preventDefault()}
                      >
                        <span className="category-picker-option-name">{category.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}

            {isSearchOpen ? (
              <div className={`search-dialog-backdrop ${searchDialogPosition ? "anchored-dialog-backdrop" : ""}`} role="presentation" onClick={closeSearchDialog}>
                <form
                  className={`search-dialog ${searchDialogPosition ? "anchored-dialog" : ""}`}
                  role="dialog"
                  aria-modal="true"
                  aria-label="歌曲搜索"
                  style={searchDialogPosition ? { left: searchDialogPosition.x, top: searchDialogPosition.y, width: searchDialogPosition.width } : undefined}
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
              <div className={`search-dialog-backdrop ${categoryDialogPosition ? "anchored-dialog-backdrop" : ""}`} role="presentation" onClick={closeCategoryDialog}>
                <form
                  className={`search-dialog category-dialog ${categoryDialogPosition ? "anchored-dialog" : ""}`}
                  role="dialog"
                  aria-modal="true"
                  aria-label="新建分类"
                  style={categoryDialogPosition ? { left: categoryDialogPosition.x, top: categoryDialogPosition.y, width: categoryDialogPosition.width } : undefined}
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
              <div className="search-dialog-backdrop category-selector-backdrop" role="presentation" onClick={closeCategoryPicker}>
                <div
                  className="search-dialog category-picker-dialog category-selector-dialog"
                  role="menu"
                  aria-label="加入分类"
                  style={categoryPickerPosition ? { left: categoryPickerPosition.x, top: categoryPickerPosition.y, width: categoryPickerPosition.width } : undefined}
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="category-picker-list">
                    {favoriteCategories.map((category) => {
                      const pickerTrackMemberships = trackCategoryMembershipMap.get(categoryPickerTrack.id) ?? [];
                      const isInCategory = pickerTrackMemberships.some((membership) => membership.category_id === category.id);
                      return (
                        <button
                          key={category.id}
                          className={`category-picker-option category-selector-option ${isInCategory ? "active" : ""}`}
                          type="button"
                          role="menuitem"
                          aria-current={isInCategory ? "true" : undefined}
                          title={isInCategory ? `${category.name}，已加入` : `加入${category.name}`}
                          disabled={isInCategory}
                          onClick={() => void addTrackToCategory(category)}
                        >
                          <span className="category-picker-option-name">{category.name}</span>
                        </button>
                      );
                    })}
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
                <span>{formatDuration(displayCurrentTime)}</span>
                <div
                  className="progress-slider"
                  style={progressStyle}
                  onPointerDown={handleProgressPointerDown}
                  onPointerMove={handleProgressPointerMove}
                  onPointerUp={handleProgressPointerUp}
                  onPointerCancel={handleProgressPointerCancel}
                  onLostPointerCapture={handleProgressLostPointerCapture}
                >
                  <span className="progress-slider-track" aria-hidden="true">
                    {bufferedRanges.map((range, index) => (
                      <span
                        key={`buffered-range-${index}`}
                        className="progress-slider-buffer"
                        style={{ left: `${range.startPercent}%`, width: `${Math.max(0, range.endPercent - range.startPercent)}%` }}
                      />
                    ))}
                    <span className="progress-slider-fill" />
                  </span>
                  <input
                    className="progress-slider-input"
                    type="range"
                    min="0"
                    max={progressMax}
                    value={progressValue}
                    onChange={(event) => handleProgressInputChange(event.target.value)}
                    aria-label="播放进度"
                  />
                  <span className="progress-slider-thumb" aria-hidden="true" />
                </div>
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
            sleepTimerMinutes={sleepTimerMinutes}
            sleepTimerRemainingSeconds={sleepTimerRemainingSeconds}
            onSetSleepTimerMinutes={handleSetSleepTimerMinutes}
            onStartSleepTimer={handleStartSleepTimer}
            onStopSleepTimer={handleStopSleepTimer}
            profileView={profileView}
            audioFiles={audioFiles}
            audioFileLimits={audioFileLimits}
            audioFilesMessage={audioFilesMessage}
            audioImportReport={audioImportReport}
            audioImportPreflight={audioImportPreflight}
            isAudioFilesLoading={isAudioFilesLoading}
            isAudioImporting={isAudioImporting}
            audioFileMenu={audioFileMenu}
            audioRenameDraft={audioRenameDraft}
            audioDeleteTarget={audioDeleteTarget}
            audioFolderInputRef={audioFolderInputRef}
            onOpenAudioFileManager={openAudioFileManager}
            onCloseAudioFileManager={closeAudioFileManager}
            onChooseAudioFolder={handleChooseAudioFolder}
            onAudioFolderChange={handleAudioFolderChange}
            onConfirmAudioImportPreflight={() => void confirmAudioImportPreflight()}
            onCloseAudioImportPreflight={() => setAudioImportPreflight(null)}
            onCloseAudioImportReport={() => setAudioImportReport(null)}
            onRefreshAudioFiles={() => void refreshAudioFiles()}
            onAudioFileContextMenu={handleAudioFileContextMenu}
            onOpenAudioRename={openAudioRenameDialog}
            onUpdateAudioRename={updateAudioRenameDraft}
            onSubmitAudioRename={submitAudioRename}
            onCloseAudioRename={() => setAudioRenameDraft(null)}
            onOpenAudioDelete={openAudioDeleteDialog}
            onCloseAudioDelete={() => setAudioDeleteTarget(null)}
            onConfirmAudioDelete={() => void confirmAudioDelete()}
            onCloseAudioFileMenu={() => setAudioFileMenu(null)}
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
        preload="auto"
        onLoadedMetadata={(event) => {
          const nextDuration = event.currentTarget.duration;
          setDuration(Number.isFinite(nextDuration) ? nextDuration : 0);
          updateBufferedRanges(event.currentTarget);
        }}
        onDurationChange={(event) => {
          const nextDuration = event.currentTarget.duration;
          setDuration(Number.isFinite(nextDuration) ? nextDuration : 0);
          updateBufferedRanges(event.currentTarget);
        }}
        onProgress={(event) => updateBufferedRanges(event.currentTarget)}
        onCanPlay={(event) => updateBufferedRanges(event.currentTarget)}
        onTimeUpdate={(event) => {
          setCurrentTime(event.currentTarget.currentTime);
        }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={handleEnded}
      />

      {audioFileAccessDialog.isOpen ? (
        <AudioFileAccessModal
          dialog={audioFileAccessDialog}
          lockoutSeconds={audioFileAccessLockoutSeconds}
          onPasswordChange={updateAudioFileAccessPassword}
          onSubmit={submitAudioFileAccessDialog}
          onClose={closeAudioFileAccessDialog}
          onTogglePassword={toggleAudioFileAccessPasswordVisibility}
        />
      ) : null}

      {isAuthVisible ? (
        <AuthPage
          form={authForm}
          message={authMessage}
          canSubmit={canSubmitAuth}
          isSubmitting={isAuthSubmitting}
          showPassword={showAuthPassword}
          onChange={updateAuthForm}
          onCloseAttempt={handleAuthCloseAttempt}
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

function getTrackCategoryCount(memberships: TrackCategoryMembership[]) {
  return new Set(memberships.map((membership) => membership.category_id)).size;
}

function getTrackStatusLabel(isFavorite: boolean, memberships: TrackCategoryMembership[], categories: FavoriteCategory[], activeCategory: FavoriteCategory | null) {
  const categoryIDs = new Set(memberships.map((membership) => membership.category_id));
  const parts = [`收藏：${isFavorite ? "已收藏" : "未收藏"}`];
  if (activeCategory) {
    parts.push(`${activeCategory.name}：已加入`);
    return parts.join("，");
  }

  const joinedCategories = categories
    .filter((category) => categoryIDs.has(category.id))
    .map((category) => category.name);
  parts.push(`分类：${joinedCategories.length ? joinedCategories.join("、") : "无"}`);
  if (joinedCategories.length !== categoryIDs.size) {
    parts.push(`共 ${categoryIDs.size} 个分类`);
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
  const containerTop = container.getBoundingClientRect().top;
  const elementTop = element.getBoundingClientRect().top - containerTop + container.scrollTop;
  const centeredTop = elementTop - (container.clientHeight - element.offsetHeight) / 2;
  const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
  const targetTop = getNearestMusicListRowBoundary(container, Math.min(Math.max(0, centeredTop), maxScrollTop));
  container.scrollTop = targetTop ?? Math.min(Math.max(0, centeredTop), maxScrollTop);
}

function settleMusicListScrollPosition(container: HTMLElement) {
  const targetTop = getNearestMusicListRowBoundary(container, container.scrollTop);
  if (targetTop === null || Math.abs(targetTop - container.scrollTop) <= musicListScrollSnapTolerancePx) {
    return;
  }

  container.scrollTo({
    top: targetTop,
    behavior: shouldReduceMotion() || Math.abs(targetTop - container.scrollTop) < 6 ? "auto" : "smooth"
  });
}

function getNearestMusicListRowBoundary(container: HTMLElement, targetTop: number) {
  const rows = Array.from(container.querySelectorAll<HTMLElement>(".table-row"));
  if (!rows.length || container.clientHeight <= 0) {
    return null;
  }

  const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
  if (maxScrollTop <= musicListScrollSnapTolerancePx) {
    return 0;
  }

  const clampedTargetTop = Math.min(Math.max(0, targetTop), maxScrollTop);
  const containerTop = container.getBoundingClientRect().top;
  const currentScrollTop = container.scrollTop;
  let nearestTop = 0;
  let nearestDistance = Math.abs(clampedTargetTop);
  const bottomDistance = Math.abs(maxScrollTop - clampedTargetTop);

  if (bottomDistance < nearestDistance) {
    nearestTop = maxScrollTop;
    nearestDistance = bottomDistance;
  }

  for (const row of rows) {
    const rowTop = row.getBoundingClientRect().top - containerTop + currentScrollTop;
    const clampedRowTop = Math.min(Math.max(0, rowTop), maxScrollTop);
    const distance = Math.abs(clampedRowTop - clampedTargetTop);
    if (distance < nearestDistance) {
      nearestTop = clampedRowTop;
      nearestDistance = distance;
    }
  }

  return nearestTop;
}

function shouldReduceMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
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

function createClosedAudioFileAccessDialog(): AudioFileAccessDialogState {
  return {
    isOpen: false,
    password: "",
    message: "",
    isSubmitting: false,
    showPassword: false,
    lockoutUntil: null
  };
}

function getAudioFileAccessLockoutSeconds(lockoutUntil: number | null, now = Date.now()) {
  if (!lockoutUntil) {
    return 0;
  }
  return Math.max(0, Math.ceil((lockoutUntil - now) / 1000));
}

function getAudioFileAccessLockoutUntil(error: unknown) {
  if (error instanceof ApiError && error.retryAfterSeconds && error.retryAfterSeconds > 0) {
    return Date.now() + error.retryAfterSeconds * 1000;
  }
  if (error instanceof Error) {
    const match = error.message.match(/请(\d+)秒后再试/);
    if (match) {
      return Date.now() + Number(match[1]) * 1000;
    }
  }
  return null;
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

function isAuthFormReady(form: AuthFormState) {
  return getAuthValidationMessage(form) === "";
}

function getAuthValidationMessage(form: AuthFormState) {
  const phone = normalizePhone(form.phone);

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
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return value;
}

function writeManualLibraryRefreshAt(value: number) {
  writeLocalStorage(manualLibraryRefreshStorageKey, String(value));
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

function formatBytes(bytes?: number | null) {
  const value = Number(bytes ?? 0);
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const precision = size >= 10 || unitIndex === 0 ? 0 : 1;
  return `${size.toFixed(precision)} ${units[unitIndex]}`;
}

function getFileExtension(filename: string) {
  const normalized = filename.trim();
  const dotIndex = normalized.lastIndexOf(".");
  if (dotIndex < 0) {
    return "";
  }
  return normalized.slice(dotIndex).toLowerCase();
}

function getUploadRelativePath(file: File) {
  return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
}

function getUploadFileKind(file: File) {
  const ext = getFileExtension(getUploadRelativePath(file));
  if (supportedAudioFileExtensions.has(ext)) {
    return "audio";
  }
  if (supportedLyricFileExtensions.has(ext)) {
    return "lyrics";
  }
  return "";
}

async function uploadFileLooksFLAC(file: File, relativePath: string) {
  if (getFileExtension(relativePath) === ".flac") {
    return true;
  }
  try {
    const header = new Uint8Array(await file.slice(0, 10).arrayBuffer());
    if (header.length >= 4 && bytesToAscii(header.slice(0, 4)) === "fLaC") {
      return true;
    }
    if (header.length < 10 || bytesToAscii(header.slice(0, 3)) !== "ID3") {
      return false;
    }
    const tagSize = synchsafeToInt(header.slice(6, 10));
    const signature = new Uint8Array(await file.slice(10 + tagSize, 14 + tagSize).arrayBuffer());
    return signature.length === 4 && bytesToAscii(signature) === "fLaC";
  } catch {
    return false;
  }
}

function buildAudioImportFailureReport(files: File[], reason: string): AudioFileImportReport {
  const lyricFailureCount = files.filter((file) => getUploadFileKind(file) === "lyrics").length;
  const items = files.length
    ? files.map((file): AudioFileImportItemResult => ({
        relative_path: getUploadRelativePath(file),
        status: "failed",
        reason,
        size_bytes: file.size
      }))
    : [
        {
          relative_path: "上传请求",
          status: "failed" as const,
          reason
        }
      ];

  return {
    imported: 0,
    skipped: 0,
    failed: items.length,
    converted: 0,
    lyrics_failed: lyricFailureCount,
    items
  };
}

async function buildAudioImportPreflight(files: File[], serverFiles: Track[], limits: AudioFileImportLimits): Promise<AudioImportPreflightReport> {
  const serverKeys = buildServerAudioKeySet(serverFiles);
  const items: AudioImportPreflightItem[] = [];
  const uploadFiles: File[] = [];
  const readyAudioByBase = new Map<string, boolean>();
  const audioStatusByBase = new Map<string, AudioImportPreflightStatus>();
  let readyAudioCount = 0;
  let readyLyricCount = 0;
  let duplicateCount = 0;
  let errorCount = 0;
  let ignoredCount = 0;
  let totalUploadBytes = 0;

  for (const file of files) {
    const kind = getUploadFileKind(file);
    const relativePath = getUploadRelativePath(file);
    const displayName = getDisplayFilename(relativePath);
    if (!kind) {
      ignoredCount += 1;
      items.push({
        relativePath,
        displayName,
        kind: "other",
        status: "ignored",
        reason: "格式不支持，已忽略",
        sizeBytes: file.size
      });
      continue;
    }

    if (kind === "lyrics") {
      continue;
    }

    const baseKey = normalizeImportBase(relativePath);
    if (file.size > limits.max_audio_file_bytes) {
      errorCount += 1;
      audioStatusByBase.set(baseKey, "error");
      items.push({
        relativePath,
        displayName,
        kind: "audio",
        status: "error",
        reason: `超过单个音频 ${formatBytes(limits.max_audio_file_bytes)} 的限制`,
        sizeBytes: file.size
      });
      continue;
    }

    const nameParts = await readStandardUploadAudioNameParts(file);
    if (!nameParts) {
      errorCount += 1;
      audioStatusByBase.set(baseKey, "error");
      items.push({
        relativePath,
        displayName,
        kind: "audio",
        status: "error",
        reason: "无法按服务器规则识别歌曲名和歌手",
        sizeBytes: file.size
      });
      continue;
    }

    const targetFilename = buildServerTargetFilenameForUpload(nameParts);
    const targetBaseKey = normalizeImportBase(targetFilename);
    const identityKey = normalizeAudioIdentity(nameParts.artist, nameParts.title);
    if (serverKeys.has(identityKey) || serverKeys.has(targetBaseKey)) {
      duplicateCount += 1;
      audioStatusByBase.set(baseKey, "duplicate");
      audioStatusByBase.set(targetBaseKey, "duplicate");
      items.push({
        relativePath,
        displayName,
        kind: "audio",
        status: "duplicate",
        reason: `预处理后为 ${targetFilename}，服务器已存在`,
        sizeBytes: file.size,
        targetFilename
      });
      continue;
    }

    readyAudioByBase.set(baseKey, true);
    readyAudioByBase.set(targetBaseKey, true);
    audioStatusByBase.set(baseKey, "ready");
    audioStatusByBase.set(targetBaseKey, "ready");
    readyAudioCount += 1;
    totalUploadBytes += file.size;
    uploadFiles.push(file);
    const sourceIsFLAC = await uploadFileLooksFLAC(file, relativePath);
    items.push({
      relativePath,
      displayName,
      kind: "audio",
      status: "ready",
      reason: sourceIsFLAC ? `将保存为 ${targetFilename}` : `将转为 ${targetFilename}`,
      sizeBytes: file.size,
      targetFilename
    });
  }

  for (const file of files) {
    if (getUploadFileKind(file) !== "lyrics") {
      continue;
    }
    const relativePath = getUploadRelativePath(file);
    const displayName = getDisplayFilename(relativePath);
    const baseKeys = getUploadLyricBaseKeys(relativePath);
    const audioStatus = baseKeys.map((key) => audioStatusByBase.get(key)).find(Boolean);
    if (file.size > limits.max_lyric_file_bytes) {
      errorCount += 1;
      items.push({
        relativePath,
        displayName,
        kind: "lyrics",
        status: "error",
        reason: `超过单个歌词 ${formatBytes(limits.max_lyric_file_bytes)} 的限制`,
        sizeBytes: file.size
      });
      continue;
    }
    if (!audioStatus) {
      ignoredCount += 1;
      items.push({
        relativePath,
        displayName,
        kind: "lyrics",
        status: "ignored",
        reason: "未找到同名音频，已忽略",
        sizeBytes: file.size
      });
      continue;
    }
    if (audioStatus !== "ready" || !baseKeys.some((key) => readyAudioByBase.get(key))) {
      if (audioStatus === "duplicate") {
        duplicateCount += 1;
      } else {
        ignoredCount += 1;
      }
      items.push({
        relativePath,
        displayName,
        kind: "lyrics",
        status: audioStatus === "duplicate" ? "duplicate" : "ignored",
        reason: audioStatus === "duplicate" ? "对应音频服务器已存在，将跳过" : "对应音频不可上传，已忽略",
        sizeBytes: file.size
      });
      continue;
    }

    readyLyricCount += 1;
    totalUploadBytes += file.size;
    uploadFiles.push(file);
    items.push({
      relativePath,
      displayName,
      kind: "lyrics",
      status: "ready",
      reason: "将随同名音频上传",
      sizeBytes: file.size
    });
  }

  let blockingMessage = "";
  if (uploadFiles.length > limits.max_file_count) {
    blockingMessage = `可上传文件数量 ${uploadFiles.length} 个，超过单次 ${limits.max_file_count} 个限制`;
  } else if (totalUploadBytes > limits.max_total_bytes) {
    blockingMessage = `可上传文件总大小 ${formatBytes(totalUploadBytes)}，超过单次 ${formatBytes(limits.max_total_bytes)} 限制`;
  }

  return {
    files: blockingMessage ? [] : uploadFiles,
    items,
    readyAudioCount,
    readyLyricCount,
    duplicateCount,
    errorCount,
    ignoredCount,
    totalUploadBytes,
    uploadFileCount: uploadFiles.length,
    blockingMessage
  };
}

function buildServerAudioKeySet(tracks: Track[]) {
  const keys = new Set<string>();
  for (const track of tracks) {
    keys.add(normalizeAudioIdentity(track.artist, track.title));
    keys.add(normalizeImportBase(track.filename));
    keys.add(normalizeImportBase(track.relative_path || track.filename));
  }
  return keys;
}

async function readStandardUploadAudioNameParts(file: File): Promise<UploadAudioNameParts | null> {
  const relativePath = getUploadRelativePath(file);
  const metadata = await readID3v2AudioTags(file);
  const filenameMetadata = tagsFromUploadFilename(relativePath);
  const title = firstUploadText(metadata.title, filenameMetadata.title);
  const artist = firstUploadText(metadata.artist, filenameMetadata.artist);
  if (!artist || !title) {
    return null;
  }
  return { artist, title };
}

function tagsFromUploadFilename(relativePath: string): UploadAudioTags {
  const baseName = getDisplayFilename(relativePath).replace(/\.[^.]*$/, "").trim();
  for (const separator of [" - ", "-", "—", "–", "_"]) {
    const index = baseName.indexOf(separator);
    if (index <= 0) {
      continue;
    }
    const artist = cleanUploadAudioNamePart(baseName.slice(0, index));
    const title = cleanUploadAudioNamePart(baseName.slice(index + separator.length));
    if (artist && title) {
      return { artist, title };
    }
  }
  return { title: cleanUploadAudioNamePart(baseName) };
}

function firstUploadText(...values: Array<string | undefined>) {
  for (const value of values) {
    const text = cleanUploadAudioNamePart(value ?? "");
    if (text) {
      return text;
    }
  }
  return "";
}

function getUploadLyricBaseKeys(relativePath: string) {
  const keys = new Set<string>();
  const originalKey = normalizeImportBase(relativePath);
  if (originalKey) {
    keys.add(originalKey);
  }
  const nameParts = tagsFromUploadFilename(relativePath);
  if (nameParts.artist && nameParts.title) {
    keys.add(normalizeImportBase(buildServerTargetFilenameForUpload({ artist: nameParts.artist, title: nameParts.title })));
  }
  return Array.from(keys);
}

function cleanUploadAudioNamePart(value: string) {
  let text = trimUploadText(value).replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  for (let index = 0; index < 4; index += 1) {
    const previous = text;
    text = trimUploadNameTailSeparators(stripUploadHashSuffix(text));
    if (text === previous) {
      break;
    }
  }
  return text;
}

function stripUploadHashSuffix(value: string) {
  const bracketMatch = value.match(/^(.*?)[\s._-]*[\[\(【{（]([0-9a-fA-F]{8,64})[\]\)】}）]\s*$/);
  if (bracketMatch && isLikelyUploadHashToken(bracketMatch[2])) {
    const prefix = trimUploadNameTailSeparators(bracketMatch[1]);
    if (prefix) {
      return prefix;
    }
  }

  const bareMatch = value.match(/^(.*?)[\s._-]+([0-9a-fA-F]{8,64})\s*$/);
  if (bareMatch && isLikelyUploadHashToken(bareMatch[2])) {
    const prefix = trimUploadNameTailSeparators(bareMatch[1]);
    if (prefix) {
      return prefix;
    }
  }

  return value;
}

function trimUploadNameTailSeparators(value: string) {
  return trimUploadText(value).replace(/[\s._-]+$/g, "").trim();
}

function isLikelyUploadHashToken(value: string) {
  const token = value.trim();
  if (!/^[0-9a-fA-F]{8,64}$/.test(token)) {
    return false;
  }
  return /[a-fA-F]/.test(token) || token.length >= 12;
}

function buildServerTargetFilenameForUpload(nameParts: UploadAudioNameParts) {
  const targetBase = sanitizeServerAudioFilename(`${nameParts.artist}-${nameParts.title}`);
  return sanitizeServerAudioFilename(`${targetBase}.flac`);
}

function sanitizeServerAudioFilename(value: string) {
  const cleaned = Array.from(value, (char) => {
    const code = char.codePointAt(0) ?? 0;
    if (code < 32 || /[\\/:*?"<>|]/.test(char) || /\s/.test(char)) {
      return " ";
    }
    return char;
  }).join("");
  const collapsed = cleaned.trim().replace(/\s+/g, " ").replace(/^[. ]+|[. ]+$/g, "");
  const runes = Array.from(collapsed);
  if (runes.length <= 160) {
    return collapsed;
  }
  return runes.slice(0, 160).join("").replace(/^[. ]+|[. ]+$/g, "");
}

async function readID3v2AudioTags(file: File): Promise<UploadAudioTags> {
  const header = new Uint8Array(await file.slice(0, 10).arrayBuffer());
  if (header.length < 10 || bytesToAscii(header.slice(0, 3)) !== "ID3") {
    return {};
  }
  const version = header[3];
  if (version < 2 || version > 4) {
    return {};
  }
  const flags = header[5];
  const tagSize = synchsafeToInt(header.slice(6, 10));
  if (tagSize <= 0 || tagSize > 10 * 1024 * 1024) {
    return {};
  }

  const tagBytes = new Uint8Array(await file.slice(10, 10 + tagSize).arrayBuffer());
  const body = flags & 0x80 ? removeID3Unsynchronisation(tagBytes) : tagBytes;
  const tags: UploadAudioTags = {};
  let offset = id3v2FrameStart(body, version, flags);

  for (;;) {
    if (version === 2) {
      if (offset + 6 > body.length) {
        break;
      }
      const frameID = bytesToAscii(body.slice(offset, offset + 3));
      if (!isValidID3FrameID(frameID)) {
        break;
      }
      const frameSize = (body[offset + 3] << 16) | (body[offset + 4] << 8) | body[offset + 5];
      if (frameSize <= 0 || offset + 6 + frameSize > body.length) {
        break;
      }
      const payload = body.slice(offset + 6, offset + 6 + frameSize);
      if (frameID === "TT2") {
        tags.title = firstUploadText(tags.title, decodeID3TextFrame(payload));
      } else if (frameID === "TP1") {
        tags.artist = firstUploadText(tags.artist, decodeID3TextFrame(payload));
      }
      offset += 6 + frameSize;
      continue;
    }

    if (offset + 10 > body.length) {
      break;
    }
    const frameID = bytesToAscii(body.slice(offset, offset + 4));
    if (!isValidID3FrameID(frameID)) {
      break;
    }
    const frameSize = version === 4 ? synchsafeToInt(body.slice(offset + 4, offset + 8)) : uint32BE(body, offset + 4);
    if (frameSize <= 0 || offset + 10 + frameSize > body.length) {
      break;
    }
    const payload = body.slice(offset + 10, offset + 10 + frameSize);
    if (frameID === "TIT2") {
      tags.title = firstUploadText(tags.title, decodeID3TextFrame(payload));
    } else if (frameID === "TPE1") {
      tags.artist = firstUploadText(tags.artist, decodeID3TextFrame(payload));
    }
    offset += 10 + frameSize;
  }

  return tags;
}

function id3v2FrameStart(body: Uint8Array, version: number, flags: number) {
  if ((flags & 0x40) === 0) {
    return 0;
  }
  if (version === 3 && body.length >= 4) {
    const size = uint32BE(body, 0);
    if (size >= 0 && 4 + size <= body.length) {
      return 4 + size;
    }
  }
  if (version === 4 && body.length >= 4) {
    const size = synchsafeToInt(body.slice(0, 4));
    if (size >= 4 && size <= body.length) {
      return size;
    }
  }
  return 0;
}

function removeID3Unsynchronisation(data: Uint8Array) {
  const result: number[] = [];
  for (let index = 0; index < data.length; index += 1) {
    result.push(data[index]);
    if (data[index] === 0xff && index + 1 < data.length && data[index + 1] === 0x00) {
      index += 1;
    }
  }
  return new Uint8Array(result);
}

function synchsafeToInt(data: Uint8Array) {
  if (data.length !== 4) {
    return 0;
  }
  return ((data[0] & 0x7f) << 21) | ((data[1] & 0x7f) << 14) | ((data[2] & 0x7f) << 7) | (data[3] & 0x7f);
}

function uint32BE(data: Uint8Array, offset: number) {
  return ((data[offset] << 24) >>> 0) + (data[offset + 1] << 16) + (data[offset + 2] << 8) + data[offset + 3];
}

function isValidID3FrameID(frameID: string) {
  return /^[A-Z0-9]{3,4}$/.test(frameID);
}

function decodeID3TextFrame(payload: Uint8Array) {
  if (!payload.length) {
    return "";
  }
  return decodeID3TextBytes(payload[0], payload.slice(1));
}

function decodeID3TextBytes(encoding: number, text: Uint8Array) {
  switch (encoding) {
    case 0:
      return decodeLegacyText(text);
    case 1:
      return decodeUTF16Text(text, false);
    case 2:
      return decodeUTF16Text(text, true);
    case 3:
      return decodeTextWith("utf-8", text) || decodeLegacyText(text);
    default:
      return decodeLegacyText(text);
  }
}

function decodeLegacyText(data: Uint8Array) {
  const trimmed = trimZeroAndSpaceBytes(data);
  if (!trimmed.length) {
    return "";
  }
  return decodeTextWith("utf-8", trimmed) || decodeTextWith("gb18030", trimmed) || decodeTextWith("latin1", trimmed);
}

function decodeUTF16Text(data: Uint8Array, forceBigEndian: boolean) {
  let text = data;
  let label = forceBigEndian ? "utf-16be" : "utf-16le";
  if (!forceBigEndian && data.length >= 2) {
    if (data[0] === 0xff && data[1] === 0xfe) {
      text = data.slice(2);
      label = "utf-16le";
    } else if (data[0] === 0xfe && data[1] === 0xff) {
      text = data.slice(2);
      label = "utf-16be";
    }
  }
  return decodeTextWith(label, text);
}

function decodeTextWith(label: string, data: Uint8Array) {
  try {
    return trimUploadText(new TextDecoder(label).decode(data));
  } catch {
    return "";
  }
}

function trimZeroAndSpaceBytes(data: Uint8Array) {
  let start = 0;
  let end = data.length;
  while (start < end && (data[start] === 0 || data[start] === 32)) {
    start += 1;
  }
  while (end > start && (data[end - 1] === 0 || data[end - 1] === 32)) {
    end -= 1;
  }
  return data.slice(start, end);
}

function trimUploadText(value: string) {
  return value.trim().replace(/\0/g, " ").trim();
}

function bytesToAscii(data: Uint8Array) {
  return Array.from(data, (value) => String.fromCharCode(value)).join("");
}

function normalizeAudioIdentity(artist: string, title: string) {
  return normalizeAudioText(`${title}-${artist}`);
}

function normalizeImportBase(path: string) {
  return normalizeAudioText(getDisplayFilename(path).replace(/\.[^.]*$/, ""));
}

function normalizeAudioText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function getDisplayFilename(path: string) {
  const normalized = path.replace(/\\/g, "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

function getAudioPreflightKindLabel(kind: AudioImportPreflightKind) {
  if (kind === "audio") {
    return "音频";
  }
  if (kind === "lyrics") {
    return "歌词";
  }
  return "其它";
}

function getAudioPreflightStatusLabel(status: AudioImportPreflightStatus) {
  switch (status) {
    case "ready":
      return "可上传";
    case "duplicate":
      return "重叠";
    case "error":
      return "错误";
    case "ignored":
      return "忽略";
  }
}

function getAudioImportResultStatusLabel(status: AudioFileImportItemResult["status"]) {
  switch (status) {
    case "imported":
      return "成功";
    case "skipped":
      return "跳过";
    case "failed":
      return "失败";
  }
}

function getAudioImportResultReason(item: AudioFileImportItemResult) {
  if (item.reason) {
    return item.reason;
  }
  if (item.status === "imported") {
    return item.target_filename ? "已保存到服务器音乐目录" : "已导入";
  }
  if (item.status === "skipped") {
    return "服务器已跳过";
  }
  return "导入失败";
}

function getAudioImportResultName(item: AudioFileImportItemResult) {
  return item.target_filename || getDisplayFilename(item.relative_path) || "上传请求";
}

function getAudioImportResultKindLabel(item: AudioFileImportItemResult) {
  const ext = getFileExtension(item.relative_path || item.target_filename || "");
  if (supportedAudioFileExtensions.has(ext)) {
    return "音频";
  }
  if (supportedLyricFileExtensions.has(ext)) {
    return "歌词";
  }
  return "文件";
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

function getProfileAvatarText(authSession: AuthSession) {
  const nickname = authSession.nickname.trim();
  if (nickname) {
    return Array.from(nickname)[0]?.toUpperCase() ?? "我";
  }

  const phone = normalizePhone(authSession.phone);
  return phone ? phone.slice(-2) : "我";
}

function formatProfilePhone(phone: string) {
  const normalized = normalizePhone(phone);
  if (normalized.length === 11) {
    return `${normalized.slice(0, 3)} ${normalized.slice(3, 7)} ${normalized.slice(7)}`;
  }

  return normalized || "未绑定手机号";
}

function EmptyPage({
  page,
  authSession,
  sleepTimerMinutes,
  sleepTimerRemainingSeconds,
  onSetSleepTimerMinutes,
  onStartSleepTimer,
  onStopSleepTimer,
  profileView,
  audioFiles,
  audioFileLimits,
  audioFilesMessage,
  audioImportReport,
  audioImportPreflight,
  isAudioFilesLoading,
  isAudioImporting,
  audioFileMenu,
  audioRenameDraft,
  audioDeleteTarget,
  audioFolderInputRef,
  onOpenAudioFileManager,
  onCloseAudioFileManager,
  onChooseAudioFolder,
  onAudioFolderChange,
  onConfirmAudioImportPreflight,
  onCloseAudioImportPreflight,
  onCloseAudioImportReport,
  onRefreshAudioFiles,
  onAudioFileContextMenu,
  onOpenAudioRename,
  onUpdateAudioRename,
  onSubmitAudioRename,
  onCloseAudioRename,
  onOpenAudioDelete,
  onCloseAudioDelete,
  onConfirmAudioDelete,
  onCloseAudioFileMenu,
  onLogout
}: {
  page: Exclude<AppPage, "music" | "lyrics">;
  authSession: AuthSession | null;
  sleepTimerMinutes: number | null;
  sleepTimerRemainingSeconds: number | null;
  onSetSleepTimerMinutes: (minutes: number | null) => void;
  onStartSleepTimer: (minutes?: number) => void;
  onStopSleepTimer: () => void;
  profileView: ProfileView;
  audioFiles: Track[];
  audioFileLimits: AudioFileImportLimits;
  audioFilesMessage: string;
  audioImportReport: AudioFileImportReport | null;
  audioImportPreflight: AudioImportPreflightReport | null;
  isAudioFilesLoading: boolean;
  isAudioImporting: boolean;
  audioFileMenu: AudioFileContextMenu | null;
  audioRenameDraft: AudioFileRenameDraft | null;
  audioDeleteTarget: Track | null;
  audioFolderInputRef: RefObject<HTMLInputElement | null>;
  onOpenAudioFileManager: () => void;
  onCloseAudioFileManager: () => void;
  onChooseAudioFolder: () => void;
  onAudioFolderChange: (files: FileList | null) => void;
  onConfirmAudioImportPreflight: () => void;
  onCloseAudioImportPreflight: () => void;
  onCloseAudioImportReport: () => void;
  onRefreshAudioFiles: () => void;
  onAudioFileContextMenu: (event: ReactMouseEvent<HTMLElement>, track: Track) => void;
  onOpenAudioRename: (track: Track) => void;
  onUpdateAudioRename: (field: "artist" | "title", value: string) => void;
  onSubmitAudioRename: (event: FormEvent<HTMLFormElement>) => void;
  onCloseAudioRename: () => void;
  onOpenAudioDelete: (track: Track) => void;
  onCloseAudioDelete: () => void;
  onConfirmAudioDelete: () => void;
  onCloseAudioFileMenu: () => void;
  onLogout: () => void;
}) {
  const pageContent: Record<Exclude<AppPage, "music" | "lyrics">, { title: string; message: string }> = {
    discover: { title: "发现", message: "暂无推荐" },
    profile: { title: "我", message: authSession ? authSession.nickname || authSession.phone : "未登录" }
  };
  const content = pageContent[page];
  const profileDisplayName = authSession?.nickname.trim() || authSession?.phone || "未登录";
  const profilePhone = authSession ? formatProfilePhone(authSession.phone) : "";
  const profileAvatarText = authSession ? getProfileAvatarText(authSession) : "";

  return (
    <section className="simple-page" aria-label={content.title}>
      {page === "profile" && authSession ? (
        profileView === "audioFiles" ? (
          <AudioFileManagerPage
            files={audioFiles}
            limits={audioFileLimits}
            message={audioFilesMessage}
            report={audioImportReport}
            preflight={audioImportPreflight}
            isLoading={isAudioFilesLoading}
            isImporting={isAudioImporting}
            menu={audioFileMenu}
            renameDraft={audioRenameDraft}
            deleteTarget={audioDeleteTarget}
            folderInputRef={audioFolderInputRef}
            onBack={onCloseAudioFileManager}
            onChooseFolder={onChooseAudioFolder}
            onFolderChange={onAudioFolderChange}
            onConfirmPreflight={onConfirmAudioImportPreflight}
            onClosePreflight={onCloseAudioImportPreflight}
            onCloseReport={onCloseAudioImportReport}
            onRefresh={onRefreshAudioFiles}
            onContextMenu={onAudioFileContextMenu}
            onOpenRename={onOpenAudioRename}
            onUpdateRename={onUpdateAudioRename}
            onSubmitRename={onSubmitAudioRename}
            onCloseRename={onCloseAudioRename}
            onOpenDelete={onOpenAudioDelete}
            onCloseDelete={onCloseAudioDelete}
            onConfirmDelete={onConfirmAudioDelete}
            onCloseMenu={onCloseAudioFileMenu}
          />
        ) : (
          <div className="profile-page-content">
            <div className="profile-summary-card" aria-label="用户信息">
              <div className="profile-summary-avatar" aria-hidden="true">
                {profileAvatarText}
              </div>
              <div className="profile-summary-copy">
                <div className="profile-summary-name">{profileDisplayName}</div>
                <div className="profile-summary-phone">手机号 {profilePhone}</div>
              </div>
            </div>
            <SleepTimerPanel
              minutes={sleepTimerMinutes}
              remainingSeconds={sleepTimerRemainingSeconds}
              onSetMinutes={onSetSleepTimerMinutes}
              onStart={onStartSleepTimer}
              onStop={onStopSleepTimer}
            />
            <div className="profile-row file-manager-row">
              <span className="profile-row-title">文件管理</span>
              <button className="profile-action-button file-manager-open-button" type="button" onClick={onOpenAudioFileManager}>
                服务器音频文件管理
              </button>
            </div>
            <div className="profile-logout-area">
              <button className="profile-action-button logout-button" type="button" onClick={onLogout}>
                退出登录
              </button>
            </div>
          </div>
        )
      ) : (
        <div className="simple-page-empty">{content.message}</div>
      )}
    </section>
  );
}

function AudioFileManagerPage({
  files,
  limits,
  message,
  report,
  preflight,
  isLoading,
  isImporting,
  menu,
  renameDraft,
  deleteTarget,
  folderInputRef,
  onBack,
  onChooseFolder,
  onFolderChange,
  onConfirmPreflight,
  onClosePreflight,
  onCloseReport,
  onRefresh,
  onContextMenu,
  onOpenRename,
  onUpdateRename,
  onSubmitRename,
  onCloseRename,
  onOpenDelete,
  onCloseDelete,
  onConfirmDelete,
  onCloseMenu
}: {
  files: Track[];
  limits: AudioFileImportLimits;
  message: string;
  report: AudioFileImportReport | null;
  preflight: AudioImportPreflightReport | null;
  isLoading: boolean;
  isImporting: boolean;
  menu: AudioFileContextMenu | null;
  renameDraft: AudioFileRenameDraft | null;
  deleteTarget: Track | null;
  folderInputRef: RefObject<HTMLInputElement | null>;
  onBack: () => void;
  onChooseFolder: () => void;
  onFolderChange: (files: FileList | null) => void;
  onConfirmPreflight: () => void;
  onClosePreflight: () => void;
  onCloseReport: () => void;
  onRefresh: () => void;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>, track: Track) => void;
  onOpenRename: (track: Track) => void;
  onUpdateRename: (field: "artist" | "title", value: string) => void;
  onSubmitRename: (event: FormEvent<HTMLFormElement>) => void;
  onCloseRename: () => void;
  onOpenDelete: (track: Track) => void;
  onCloseDelete: () => void;
  onConfirmDelete: () => void;
  onCloseMenu: () => void;
}) {
  return (
    <div className="profile-page-content audio-manager-page">
      <header className="audio-manager-header">
        <button className="audio-manager-back-button" type="button" aria-label="返回" onClick={onBack}>
          ‹
        </button>
        <div className="audio-manager-heading">
          <h2>服务器音频文件管理</h2>
          <p>{files.length ? `当前 ${files.length} 个音频文件` : "管理服务器音乐目录中的无损音频"}</p>
        </div>
      </header>

      <div className="audio-manager-toolbar">
        <input
          ref={folderInputRef}
          className="sr-only"
          type="file"
          multiple
          {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
          onChange={(event) => {
            onFolderChange(event.currentTarget.files);
            event.currentTarget.value = "";
          }}
        />
        <button className="audio-manager-primary-button" type="button" disabled={isImporting} onClick={onChooseFolder}>
          {isImporting ? "导入中" : "选择文件夹"}
        </button>
        <button className="audio-manager-secondary-button" type="button" disabled={isLoading || isImporting} onClick={onRefresh}>
          刷新
        </button>
      </div>

      <div className="audio-manager-limits">
        <span>音频 {formatBytes(limits.max_audio_file_bytes)}</span>
        <span>歌词 {formatBytes(limits.max_lyric_file_bytes)}</span>
        <span>单次 {formatBytes(limits.max_total_bytes)} / {limits.max_file_count} 个</span>
      </div>

      {message ? <div className="audio-manager-message" role="status">{message}</div> : null}
      {preflight ? (
        <AudioImportPreflightDialog
          report={preflight}
          isImporting={isImporting}
          onCancel={onClosePreflight}
          onConfirm={onConfirmPreflight}
        />
      ) : null}

      {report ? <AudioImportResultDialog report={report} onClose={onCloseReport} /> : null}

      <section className="audio-file-list" aria-label="服务器音频文件列表" aria-busy={isLoading || isImporting}>
        <div className="audio-file-list-head" role="row">
          <span>文件</span>
          <span>格式</span>
          <span>大小</span>
          <span>操作</span>
        </div>
        <div className="audio-file-list-body">
          {files.map((track) => (
            <div
              key={track.id}
              className="audio-file-row"
              role="row"
              onContextMenu={(event) => onContextMenu(event, track)}
              onDragStart={(event) => event.preventDefault()}
            >
              <div className="audio-file-name">
                <span className="audio-file-title">{track.title}</span>
                <span className="audio-file-artist">{track.artist}</span>
              </div>
              <span className="audio-file-format">{track.format || getFileExtension(track.filename).slice(1).toUpperCase()}</span>
              <span className="audio-file-size">{formatBytes(track.size_bytes)}</span>
              <span className="audio-file-actions">
                <button type="button" onClick={() => onOpenRename(track)}>
                  重命名
                </button>
                <button className="danger" type="button" onClick={() => onOpenDelete(track)}>
                  删除
                </button>
              </span>
            </div>
          ))}
          {!files.length ? (
            <div className="audio-file-empty">
              {isLoading ? "正在读取服务器文件" : "暂无服务器音频文件"}
            </div>
          ) : null}
        </div>
      </section>

      {menu ? (
        <div className="context-menu-layer" role="presentation" onPointerDown={onCloseMenu}>
          <div
            className="track-context-menu audio-file-context-menu"
            role="menu"
            aria-label="音频文件操作"
            style={{ left: menu.x, top: menu.y }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <button type="button" role="menuitem" onClick={() => onOpenRename(menu.track)}>
              重命名
            </button>
            <button type="button" role="menuitem" onClick={() => onOpenDelete(menu.track)}>
              删除
            </button>
          </div>
        </div>
      ) : null}

      {renameDraft ? (
        <div className="search-dialog-backdrop" role="presentation" onClick={onCloseRename}>
          <form className="search-dialog audio-file-dialog" role="dialog" aria-modal="true" aria-label="重命名音频文件" onClick={(event) => event.stopPropagation()} onSubmit={onSubmitRename}>
            <h2>重命名</h2>
            <input
              className="search-input"
              type="text"
              value={renameDraft.artist}
              placeholder="歌手"
              aria-label="歌手"
              onChange={(event) => onUpdateRename("artist", event.target.value)}
            />
            <input
              className="search-input"
              type="text"
              value={renameDraft.title}
              placeholder="歌曲名"
              aria-label="歌曲名"
              onChange={(event) => onUpdateRename("title", event.target.value)}
            />
            <div className="search-actions">
              <button type="button" onClick={onCloseRename}>
                取消
              </button>
              <button className="primary" type="submit" disabled={renameDraft.isSubmitting}>
                {renameDraft.isSubmitting ? "处理中" : "确认"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {deleteTarget ? (
        <div className="search-dialog-backdrop" role="presentation" onClick={onCloseDelete}>
          <div className="search-dialog audio-file-dialog audio-delete-dialog" role="dialog" aria-modal="true" aria-label="删除音频文件" onClick={(event) => event.stopPropagation()}>
            <h2>删除文件</h2>
            <p>{deleteTarget.artist} - {deleteTarget.title}</p>
            <div className="search-actions">
              <button type="button" onClick={onCloseDelete}>
                取消
              </button>
              <button className="primary danger" type="button" onClick={onConfirmDelete}>
                删除
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AudioImportPreflightDialog({
  report,
  isImporting,
  onCancel,
  onConfirm
}: {
  report: AudioImportPreflightReport;
  isImporting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const canUpload = report.files.length > 0 && !report.blockingMessage && !isImporting;

  return (
    <div className="search-dialog-backdrop audio-preflight-backdrop" role="presentation" onClick={onCancel}>
      <div className="search-dialog audio-preflight-dialog" role="dialog" aria-modal="true" aria-label="上传前检查报告" onClick={(event) => event.stopPropagation()}>
        <h2>上传前检查</h2>
        <div className="audio-preflight-summary" role="status">
          <span className="ready">可上传 {report.readyAudioCount} 首</span>
          <span className="lyrics">歌词 {report.readyLyricCount}</span>
          <span className="duplicate">重叠 {report.duplicateCount}</span>
          <span className="error">错误 {report.errorCount}</span>
          <span className="ignored">忽略 {report.ignoredCount}</span>
        </div>
        <p className="audio-preflight-note">
          确认后只上传可导入音频和匹配歌词；重叠、错误和忽略项不会上传。
        </p>
        {report.blockingMessage ? <div className="audio-preflight-blocking">{report.blockingMessage}</div> : null}
        <div className="audio-preflight-list" role="list">
          {report.items.map((item, index) => (
            <div key={`${item.relativePath}-${index}`} className={`audio-preflight-item ${item.status}`} role="listitem">
              <div className="audio-preflight-item-main">
                <span className="audio-preflight-item-name" title={item.relativePath}>
                  {item.displayName}
                </span>
                <span className="audio-preflight-item-reason">{item.reason}</span>
              </div>
              <div className="audio-preflight-item-meta">
                <span>{getAudioPreflightKindLabel(item.kind)}</span>
                <span>{formatBytes(item.sizeBytes)}</span>
                <strong>{getAudioPreflightStatusLabel(item.status)}</strong>
              </div>
            </div>
          ))}
        </div>
        <div className="audio-preflight-total">
          <span>将上传 {report.uploadFileCount} 个文件</span>
          <span>{formatBytes(report.totalUploadBytes)}</span>
        </div>
        <div className="search-actions">
          <button type="button" onClick={onCancel}>
            取消
          </button>
          <button className="primary" type="button" disabled={!canUpload} onClick={onConfirm}>
            {isImporting ? "上传中" : "确认上传"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AudioImportResultDialog({
  report,
  onClose
}: {
  report: AudioFileImportReport;
  onClose: () => void;
}) {
  const totalItems = report.items.length;
  const lyricsImported = report.lyrics_imported ?? 0;
  const lyricsSkipped = report.lyrics_skipped ?? 0;
  const lyricsFailed = report.lyrics_failed ?? 0;

  return (
    <div className="search-dialog-backdrop audio-result-backdrop" role="presentation" onClick={onClose}>
      <div className="search-dialog audio-preflight-dialog audio-result-dialog" role="dialog" aria-modal="true" aria-label="上传结果报告" onClick={(event) => event.stopPropagation()}>
        <h2>上传结果报告</h2>
        <div className="audio-preflight-summary audio-result-summary" role="status">
          <span className="imported">歌曲成功 {report.imported}</span>
          <span className="imported">歌词成功 {lyricsImported}</span>
          <span className="converted">转码 {report.converted}</span>
          <span className="skipped">跳过 {report.skipped}</span>
          <span className="failed">失败 {report.failed}</span>
          <span className="detail">明细 {totalItems}</span>
        </div>
        <p className="audio-preflight-note">
          这是服务器最终处理结果；失败和跳过项会在下方显示具体原因。
        </p>
        {report.scan ? (
          <div className="audio-result-scan">
            音乐库已刷新：找到 {report.scan.found} 首，新增 {report.scan.imported} 首，跳过 {report.scan.skipped} 首
          </div>
        ) : null}
        <div className="audio-preflight-list audio-result-list" role="list">
          {report.items.length ? (
            report.items.map((item, index) => (
              <div key={`${item.relative_path}-${index}`} className={`audio-preflight-item audio-result-item ${item.status}`} role="listitem">
                <div className="audio-preflight-item-main">
                  <span className="audio-preflight-item-name" title={item.relative_path}>
                    {getAudioImportResultName(item)}
                  </span>
                  <span className="audio-preflight-item-reason">{getAudioImportResultReason(item)}</span>
                </div>
                <div className="audio-preflight-item-meta">
                  <span>{getAudioImportResultKindLabel(item)}</span>
                  {item.size_bytes ? <span>{formatBytes(item.size_bytes)}</span> : <span>--</span>}
                  <strong>{getAudioImportResultStatusLabel(item.status)}</strong>
                </div>
              </div>
            ))
          ) : (
            <div className="audio-result-empty">没有逐项明细</div>
          )}
        </div>
        <div className="audio-preflight-total audio-result-total">
          <span>处理 {totalItems} 个文件</span>
          <span>歌词跳过 {lyricsSkipped}</span>
          <span>{report.failed || lyricsFailed ? "存在失败项" : "无失败项"}</span>
        </div>
        <div className="search-actions">
          <button className="primary" type="button" onClick={onClose}>
            知道了
          </button>
        </div>
      </div>
    </div>
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

function AudioFileAccessModal({
  dialog,
  lockoutSeconds,
  onPasswordChange,
  onSubmit,
  onClose,
  onTogglePassword
}: {
  dialog: AudioFileAccessDialogState;
  lockoutSeconds: number;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
  onTogglePassword: () => void;
}) {
  const canSubmit = !dialog.isSubmitting && lockoutSeconds <= 0 && dialog.password.length >= passwordMinLength;
  const message = lockoutSeconds > 0 ? `密码错误次数过多，请${lockoutSeconds}秒后再试` : dialog.message;

  return (
    <section className="audio-access-gate" role="dialog" aria-modal="true" aria-label="服务器音频文件管理身份验证">
      <form className="audio-access-panel" onSubmit={onSubmit}>
        <button className="auth-close-button" type="button" aria-label="关闭身份验证" onClick={onClose}>
          <CloseIcon />
        </button>
        <h2>身份验证</h2>
        <label className="auth-row audio-access-row">
          <span className="auth-label">密码</span>
          <span className="auth-input-wrap has-action">
            <input
              className="auth-input"
              name="audio_file_password"
              type={dialog.showPassword ? "text" : "password"}
              autoComplete="current-password"
              value={dialog.password}
              maxLength={passwordMaxLength}
              placeholder="请输入当前用户密码"
              onChange={(event) => onPasswordChange(event.target.value)}
            />
            <button
              className="password-visibility-button"
              type="button"
              aria-label={dialog.showPassword ? "隐藏密码" : "显示密码"}
              onMouseDown={(event) => event.preventDefault()}
              onClick={onTogglePassword}
            >
              {dialog.showPassword ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </span>
        </label>
        {message ? <p className="auth-message audio-access-message">{message}</p> : null}
        <div className="audio-access-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary" type="submit" disabled={!canSubmit}>
            {dialog.isSubmitting ? "验证中" : "确认"}
          </button>
        </div>
      </form>
    </section>
  );
}

function AuthPage({
  form,
  message,
  canSubmit,
  isSubmitting,
  showPassword,
  onChange,
  onCloseAttempt,
  onSubmit,
  onTogglePassword
}: {
  form: AuthFormState;
  message: string;
  canSubmit: boolean;
  isSubmitting: boolean;
  showPassword: boolean;
  onChange: (field: keyof AuthFormState, value: string | boolean) => void;
  onCloseAttempt: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onTogglePassword: () => void;
}) {
  return (
    <section className="auth-gate" role="dialog" aria-modal="true" aria-label="手机号登录">
      <div className="auth-panel">
        <button className="auth-close-button" type="button" aria-label="关闭登录页" onClick={onCloseAttempt}>
          <CloseIcon />
        </button>

        <div className="auth-content">
          <h1>手机号登录</h1>

          <form className="auth-form" onSubmit={onSubmit}>
            <div className="auth-fields">
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
                placeholder="请输入密码"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
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
                {isSubmitting ? "提交中" : "登录"}
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

function IconBase({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
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

function PageIcon({ page }: { page: AppPage }) {
  return <img className="page-icon-image" src={appPageIconSources[page]} alt="" draggable={false} decoding="async" />;
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
    <IconBase className="transport-icon previous-icon">
      <path className="icon-accent" d="M18.7 6.1c-1.5-1.2-3.5-1.9-5.8-1.9" />
      <path className="icon-core" d="M7.1 6.3v11.4" />
      <path className="icon-fill" d="M17.7 6.9 9.3 12l8.4 5.1z" />
      <path className="icon-core icon-mark" d="M15.8 8.6 10.5 12l5.3 3.4" />
      <circle className="icon-spark" cx="5.5" cy="5.6" r="1.1" />
    </IconBase>
  );
}

function NextIcon() {
  return (
    <IconBase className="transport-icon next-icon">
      <path className="icon-accent" d="M5.3 17.9c1.5 1.2 3.5 1.9 5.8 1.9" />
      <path className="icon-core" d="M16.9 6.3v11.4" />
      <path className="icon-fill" d="M6.3 6.9 14.7 12l-8.4 5.1z" />
      <path className="icon-core icon-mark" d="M8.2 8.6 13.5 12l-5.3 3.4" />
      <circle className="icon-spark" cx="18.5" cy="18.4" r="1.1" />
    </IconBase>
  );
}

function PlayIcon() {
  return (
    <IconBase className="transport-icon play-icon">
      <path className="icon-orbit" d="M5.6 15.7C3.4 10.8 6.1 5.8 10.5 4.5" />
      <path className="icon-fill" d="M9.3 7.1c0-.8.8-1.2 1.5-.8l7 4.2c.7.4.7 1.4 0 1.8l-7 4.2c-.7.4-1.5-.1-1.5-.9z" />
      <circle className="icon-spark" cx="18" cy="6.1" r="1.2" />
      <circle className="icon-dot" cx="6.2" cy="18.2" r=".8" />
    </IconBase>
  );
}

function PauseIcon() {
  return (
    <IconBase className="transport-icon pause-icon">
      <rect className="icon-fill" x="7.4" y="6.2" width="4" height="11.6" rx="1.25" />
      <rect className="icon-fill" x="12.8" y="6.2" width="4" height="11.6" rx="1.25" />
      <path className="icon-accent" d="M5.9 18.3c2.2 1.9 7.7 2.5 12.2-.5" />
      <circle className="icon-spark" cx="18.2" cy="5.8" r="1.1" />
    </IconBase>
  );
}

function RepeatIcon() {
  return (
    <IconBase className="transport-icon repeat-icon">
      <path className="icon-core" d="M5.5 10.6V9.4c0-1.9 1.3-3.1 3.3-3.1h8.8" />
      <path className="icon-core" d="M18.5 13.4v1.2c0 1.9-1.3 3.1-3.3 3.1H6.4" />
      <path className="icon-fill" d="M16.5 3.8 20.9 6.3l-4.4 2.5z" />
      <path className="icon-fill" d="M7.5 20.2 3.1 17.7l4.4-2.5z" />
      <circle className="icon-spark" cx="4.8" cy="12" r=".8" />
    </IconBase>
  );
}

function RepeatOneIcon() {
  return (
    <IconBase className="transport-icon repeat-icon repeat-one-icon">
      <path className="icon-core" d="M5.5 10.6V9.4c0-1.9 1.3-3.1 3.3-3.1h8.8" />
      <path className="icon-core" d="M18.5 13.4v1.2c0 1.9-1.3 3.1-3.3 3.1H6.4" />
      <path className="icon-fill" d="M16.5 3.8 20.9 6.3l-4.4 2.5z" />
      <path className="icon-fill" d="M7.5 20.2 3.1 17.7l4.4-2.5z" />
      <text className="icon-number" x="12" y="12.45" textAnchor="middle" dominantBaseline="middle">
        1
      </text>
    </IconBase>
  );
}

function ShuffleIcon() {
  return (
    <IconBase className="transport-icon shuffle-icon">
      <path className="icon-core" d="M4.1 7.3h2.1c2 0 3.2 1.1 4.2 2.8l3.2 5.3c1 1.7 2.2 2.9 4.2 2.9h1.8" />
      <path className="icon-core" d="M4.1 17.3h2.1c2 0 3.2-1.2 4.2-2.9l.6-1" />
      <path className="icon-accent" d="m13.1 9.5.6-1c1-1.7 2.2-2.8 4.2-2.8h1.7" />
      <path className="icon-fill" d="M17.7 3.4 21.5 5.7l-3.8 2.4z" />
      <path className="icon-fill" d="m17.7 15.9 3.8 2.4-3.8 2.3z" />
      <circle className="icon-spark" cx="5.2" cy="12.3" r=".75" />
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
