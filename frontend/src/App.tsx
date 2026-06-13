import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { getTracks, scanLibrary, streamURL } from "./api";
import type { Track } from "./types";

type RepeatMode = "off" | "one" | "all";
type AppPage = "music" | "chat" | "discover" | "profile";

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

function App() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [currentTrackId, setCurrentTrackId] = useState<number | null>(null);
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
          <EmptyPage page={activePage} />
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

function formatDuration(seconds?: number | null) {
  if (!seconds || seconds < 0 || !Number.isFinite(seconds)) {
    return "00:00";
  }
  const rounded = Math.floor(seconds);
  const minutes = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function EmptyPage({ page }: { page: Exclude<AppPage, "music"> }) {
  const pageContent: Record<Exclude<AppPage, "music">, { title: string; message: string }> = {
    chat: { title: "聊天室", message: "暂无消息" },
    discover: { title: "发现", message: "暂无推荐" },
    profile: { title: "我", message: "未登录" }
  };
  const content = pageContent[page];

  return (
    <section className="simple-page" aria-label={content.title}>
      <header className="simple-page-header">
        <h1>{content.title}</h1>
      </header>
      <div className="simple-page-empty">{content.message}</div>
    </section>
  );
}

function IconBase({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {children}
    </svg>
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
