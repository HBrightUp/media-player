import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { getTracks, loginUser, registerUser, scanLibrary, sendPresenceHeartbeat, sendPresenceOffline, streamURL } from "./api";
import type { AuthUser, Track } from "./types";

type RepeatMode = "off" | "one" | "all";
type AppPage = "music" | "chat" | "discover" | "profile";
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
  accepted: boolean;
};

const tabs = ["音乐列表", "歌曲搜索"];
const appPages: Array<{ id: AppPage; label: string }> = [
  { id: "music", label: "音乐" },
  { id: "chat", label: "聊天室" },
  { id: "discover", label: "发现" },
  { id: "profile", label: "我" }
];
const repeatModes: RepeatMode[] = ["off", "one", "all"];
const repeatModeLabels: Record<RepeatMode, string> = {
  off: "顺序播放",
  one: "单曲循环",
  all: "列表循环"
};
const authSessionStorageKey = "media-player-auth-session";
const authProfileStorageKey = "media-player-auth-profile";
const presenceSessionStorageKey = "media-player-presence-session";
const authSessionDurationMs = 7 * 24 * 60 * 60 * 1000;
const presenceHeartbeatIntervalMs = 25_000;
const nicknameMaxLength = 20;
const passwordMinLength = 6;
const passwordMaxLength = 64;
const mainlandPhonePattern = /^1[3-9]\d{9}$/;

function App() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const initialAuthRef = useRef<AuthReadResult | null>(null);
  const initialAuthProfileRef = useRef<AuthFormState | null>(null);
  const presenceSessionIdRef = useRef<string | null>(null);
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
  const [currentTrackId, setCurrentTrackId] = useState<number | null>(null);
  const [authSession, setAuthSession] = useState<AuthSession | null>(initialAuthRef.current.session);
  const [authMode, setAuthMode] = useState<AuthMode>(() => (initialAuthRef.current?.expired || initialAuthProfileRef.current?.phone ? "login" : "register"));
  const [authForm, setAuthForm] = useState<AuthFormState>(() => initialAuthProfileRef.current ?? createEmptyAuthForm());
  const [authMessage, setAuthMessage] = useState(initialAuthRef.current.expired ? "登录已过期，请重新登录" : "");
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [showAuthPassword, setShowAuthPassword] = useState(false);
  const [onlineCount, setOnlineCount] = useState<number | null>(null);
  const [isOnlineCountUnavailable, setIsOnlineCountUnavailable] = useState(false);
  const [activePage, setActivePage] = useState<AppPage>("music");
  const [activeTab, setActiveTab] = useState(tabs[0]);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [toastMessage, setToastMessage] = useState("");
  const [loadMessage, setLoadMessage] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(12);
  const [duration, setDuration] = useState(185);

  const currentTrack = useMemo(() => {
    if (!tracks.length) {
      return null;
    }
    return tracks.find((track) => track.id === currentTrackId) ?? tracks[0];
  }, [currentTrackId, tracks]);

  useEffect(() => {
    void refreshLibrary();
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

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

    if (isPlaying) {
      void audio.play().catch(() => setIsPlaying(false));
    } else {
      audio.pause();
    }
  }, [currentTrack, isPlaying]);

  const activeDuration = duration || currentTrack?.duration_seconds || 185;

  async function refreshLibrary({ scan = false }: { scan?: boolean } = {}) {
    setIsLoading(true);
    setIsScanning(scan);
    setLoadMessage("");
    if (scan) {
      clearCurrentLibrary();
    }
    try {
      if (scan) {
        await scanLibrary();
      }
      const payload = await getTracks();
      setTracks(payload.tracks);
      setCurrentTrackId((previous) => {
        if (!scan && previous && payload.tracks.some((track) => track.id === previous)) {
          return previous;
        }
        return payload.tracks[0]?.id ?? null;
      });
    } catch (error) {
      setTracks([]);
      setCurrentTrackId(null);
      setLoadMessage(error instanceof Error ? error.message : "本地音乐列表加载失败");
    } finally {
      setIsLoading(false);
      setIsScanning(false);
    }
  }

  function clearCurrentLibrary() {
    audioRef.current?.pause();
    setTracks([]);
    setCurrentTrackId(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }

  function handleTabClick(tab: string) {
    setActiveTab(tab);
    setActivePage("music");
    if (tab === "音乐列表") {
      setIsSearchOpen(false);
      void refreshLibrary({ scan: true });
      return;
    }
    setSearchQuery("");
    setIsSearchOpen(true);
  }

  function handlePageClick(page: AppPage) {
    setActivePage(page);
    if (page !== "music") {
      setIsSearchOpen(false);
      setActiveTab(tabs[0]);
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
              password: authForm.password,
              accepted: authForm.accepted
            })
          : await loginUser({
              phone,
              password: authForm.password,
              accepted: authForm.accepted
            });
      const nextSession = createAuthSession(response.user);
      persistAuthSession(nextSession);
      persistAuthProfile(response.user);
      setAuthSession(nextSession);
      setAuthForm((previous) => ({
        ...previous,
        nickname: response.user.nickname,
        phone: response.user.phone,
        password: "",
        accepted: false
      }));
      setAuthMessage("");
      setShowAuthPassword(false);
      setActivePage("music");
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
    setAuthForm((previous) => ({ ...previous, password: "", accepted: false }));
    setAuthMessage("");
    setShowAuthPassword(false);
    setActivePage("music");
    setIsSearchOpen(false);
    setActiveTab(tabs[0]);
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
      setCurrentTrackId(matchedTracks[0].id);
      setLoadMessage("");
      setIsSearchOpen(false);
      setActiveTab("音乐列表");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "音乐不存在");
    } finally {
      setIsSearching(false);
    }
  }

  function playTrack(track: Track) {
    setCurrentTrackId(track.id);
    setIsPlaying(Boolean(track.stream_url));
  }

  function togglePlay() {
    if (!currentTrack && tracks[0]) {
      setCurrentTrackId(tracks[0].id);
    }
    if (!currentTrack?.stream_url) {
      setIsPlaying(false);
      return;
    }
    setIsPlaying((value) => !value);
  }

  function stepTrack(direction: 1 | -1) {
    if (!tracks.length) {
      return;
    }
    const currentIndex = Math.max(
      0,
      tracks.findIndex((track) => track.id === currentTrack?.id)
    );
    const nextIndex = (currentIndex + direction + tracks.length) % tracks.length;
    playTrack(tracks[nextIndex]);
  }

  function handleEnded() {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (repeatMode === "one") {
      audio.currentTime = 0;
      void audio.play();
      return;
    }
    if (repeatMode === "off" && currentTrack?.id === tracks.at(-1)?.id) {
      setIsPlaying(false);
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

  const emptyMessage = loadMessage || "暂无本地 MP3 音乐";
  const isAuthVisible = !authSession;
  const canSubmitAuth = !isAuthSubmitting && isAuthFormReady(authMode, authForm);

  return (
    <main className="player-screen" aria-label="MediaPlayer">
      <div className="top-line" />
      <section className="app-page-area" aria-label="当前页面">
        {activePage === "music" ? (
          <section className="music-page" aria-label="音乐">
            <header className="app-header">
              <h1>MediaPlayer</h1>
            </header>

            <nav className="mode-tabs" aria-label="播放器视图">
              {tabs.map((tab) => (
                <button
                  key={tab}
                  className={tab === activeTab ? "active" : ""}
                  type="button"
                  disabled={tab === "音乐列表" && isLoading}
                  onClick={() => handleTabClick(tab)}
                >
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
                    className={`table-row ${track.id === currentTrack?.id ? "active" : ""}`}
                    onClick={() => playTrack(track)}
                  >
                    <span className="row-index">{index + 1}</span>
                    <span className="row-title">{track.title}</span>
                    <span>{track.artist}</span>
                    <span>{track.album}</span>
                  </button>
                ))}
                {!tracks.length ? <div className="empty-table">{isLoading ? (isScanning ? "正在重新检查音乐文件夹" : "正在加载本地音乐列表") : emptyMessage}</div> : null}
              </div>
            </section>

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
                <button
                  className={`repeat-mode-button mode-${repeatMode}`}
                  type="button"
                  aria-label={`播放模式：${repeatModeLabels[repeatMode]}`}
                  title={repeatModeLabels[repeatMode]}
                  onClick={() => setRepeatMode(nextRepeatMode(repeatMode))}
                >
                  <RepeatModeIcon mode={repeatMode} />
                </button>
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

function nextRepeatMode(mode: RepeatMode): RepeatMode {
  const currentIndex = repeatModes.indexOf(mode);
  return repeatModes[(currentIndex + 1) % repeatModes.length];
}

function trackMatchesQuery(track: Track, keyword: string) {
  const normalizedKeyword = keyword.toLocaleLowerCase();
  return [track.title, track.filename, track.relative_path].some((value) =>
    value.toLocaleLowerCase().includes(normalizedKeyword)
  );
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
    password: "",
    accepted: false
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
  if (!form.accepted) {
    return "请先同意软件许可及服务协议";
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
  page: Exclude<AppPage, "music">;
  authSession: AuthSession | null;
  onlineCount: number | null;
  isOnlineCountUnavailable: boolean;
  onLogout: () => void;
}) {
  const pageContent: Record<Exclude<AppPage, "music">, { title: string; message: string }> = {
    chat: { title: "聊天室", message: "暂无消息" },
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
              <label className="auth-agreement">
                <input
                  type="checkbox"
                  checked={form.accepted}
                  onChange={(event) => onChange("accepted", event.target.checked)}
                  aria-label="同意软件许可及服务协议"
                />
                <span className="auth-checkmark" aria-hidden="true" />
                <span>
                  我已阅读并同意 <span className="auth-agreement-link">《软件许可及服务协议》</span>
                </span>
              </label>
              <p className="auth-note">本页面收集的信息仅用于注册账号</p>
              <button className="auth-submit" type="submit" disabled={!canSubmit}>
                {isSubmitting ? "提交中" : isRegister ? "同意并继续" : "同意并登录"}
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

function ChatIcon() {
  return (
    <IconBase>
      <path d="M4 5.5A3.5 3.5 0 0 1 7.5 2h9A3.5 3.5 0 0 1 20 5.5v6A3.5 3.5 0 0 1 16.5 15H12l-5 4v-4A3 3 0 0 1 4 12z" />
      <path d="M8 7h8M8 11h5" />
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

function ProfileIcon() {
  return (
    <IconBase>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
    </IconBase>
  );
}

function PageIcon({ page }: { page: AppPage }) {
  if (page === "chat") {
    return <ChatIcon />;
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

function SequenceIcon() {
  return (
    <IconBase>
      <path d="M4 7h9M4 12h9M4 17h6M16 9l4 3-4 3M20 12h-6" />
    </IconBase>
  );
}

function RepeatModeIcon({ mode }: { mode: RepeatMode }) {
  if (mode === "one") {
    return <RepeatOneIcon />;
  }
  if (mode === "all") {
    return <RepeatIcon />;
  }
  return <SequenceIcon />;
}

export default App;
