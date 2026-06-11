import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { getTracks, streamURL } from "./api";
import type { LyricLine, Track } from "./types";

type RepeatMode = "off" | "one" | "all";
type TimedLyric = {
  time: number;
  text: string;
};

const tabs = ["正在播放", "播放列表", "歌曲搜索"];

function App() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lyricViewportRef = useRef<HTMLDivElement | null>(null);
  const lyricLineRefs = useRef<(HTMLParagraphElement | null)[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [currentTrackId, setCurrentTrackId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState("正在播放");
  const [repeatMode, setRepeatMode] = useState<RepeatMode>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [loadMessage, setLoadMessage] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(12);
  const [duration, setDuration] = useState(185);
  const [volume, setVolume] = useState(0.72);

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
    if (!audioRef.current) {
      return;
    }
    audioRef.current.volume = volume;
  }, [volume]);

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
  const syncedLyrics = useMemo(() => buildTimedLyrics(currentTrack?.lyrics ?? [], activeDuration), [activeDuration, currentTrack?.id, currentTrack?.lyrics]);
  const activeLyricIndex = useMemo(() => findActiveLyricIndex(syncedLyrics, currentTime), [currentTime, syncedLyrics]);

  useEffect(() => {
    const viewport = lyricViewportRef.current;
    const activeLine = lyricLineRefs.current[activeLyricIndex];
    if (!viewport || !activeLine) {
      return;
    }

    const nextTop = activeLine.offsetTop - viewport.clientHeight / 2 + activeLine.clientHeight / 2;
    viewport.scrollTo({
      top: Math.max(0, nextTop),
      behavior: "smooth"
    });
  }, [activeLyricIndex, currentTrack?.id]);

  async function refreshLibrary() {
    setIsLoading(true);
    setLoadMessage("");
    try {
      const payload = await getTracks();
      setTracks(payload.tracks);
      setCurrentTrackId((previous) => {
        if (previous && payload.tracks.some((track) => track.id === previous)) {
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
      <header className="app-header">
        <h1>MediaPlayer</h1>
      </header>

      <nav className="mode-tabs" aria-label="播放器视图">
        {tabs.map((tab) => (
          <button
            key={tab}
            className={tab === activeTab ? "active" : ""}
            type="button"
            onClick={() => setActiveTab(tab)}
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
          {!tracks.length ? <div className="empty-table">{isLoading ? "正在加载本地音乐列表" : emptyMessage}</div> : null}
        </div>
      </section>

      <aside className="now-panel" aria-label="同步歌词区域">
        <div className="synced-lyrics" ref={lyricViewportRef} aria-label="同步歌词" aria-live="polite">
          <div className="synced-lyrics-inner">
            {syncedLyrics.map((line, index) => (
              <p
                className={index === activeLyricIndex ? "active" : ""}
                key={`${line.time}-${line.text}`}
                ref={(element) => {
                  lyricLineRefs.current[index] = element;
                }}
              >
                {line.text}
              </p>
            ))}
          </div>
        </div>
      </aside>

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
            className={repeatMode !== "off" ? "active" : ""}
            type="button"
            aria-label="循环模式"
            onClick={() => setRepeatMode(nextRepeatMode(repeatMode))}
          >
            <RepeatIcon />
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

        <label className="volume-group">
          <VolumeIcon />
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            onChange={(event) => setVolume(Number(event.target.value))}
            aria-label="音量"
          />
        </label>
      </footer>

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
  if (mode === "all") {
    return "one";
  }
  if (mode === "one") {
    return "off";
  }
  return "all";
}

function buildTimedLyrics(lines: LyricLine[], duration: number): TimedLyric[] {
  const cleanLines = lines.map((line) => ({
    timeSeconds: line.time_seconds,
    text: line.text.trim()
  })).filter((line) => line.text);

  if (!cleanLines.length) {
    return [{ time: 0, text: "暂无歌词" }];
  }

  const safeDuration = Math.max(duration, cleanLines.length);
  const step = safeDuration / cleanLines.length;
  const hasTimestamps = cleanLines.some((line) => typeof line.timeSeconds === "number");
  const timedLines = cleanLines.map((line, index) => ({
    time: hasTimestamps && typeof line.timeSeconds === "number" ? line.timeSeconds : index * step,
    text: line.text
  }));

  return timedLines.sort((first, second) => first.time - second.time);
}

function findActiveLyricIndex(lines: TimedLyric[], currentTime: number) {
  let activeIndex = 0;
  for (let index = 0; index < lines.length; index += 1) {
    if (currentTime >= lines[index].time) {
      activeIndex = index;
    } else {
      break;
    }
  }
  return activeIndex;
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

function IconBase({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {children}
    </svg>
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

function VolumeIcon() {
  return (
    <IconBase>
      <path d="M4 10v4h4l5 4V6l-5 4zM17 9a5 5 0 0 1 0 6" />
    </IconBase>
  );
}

export default App;
