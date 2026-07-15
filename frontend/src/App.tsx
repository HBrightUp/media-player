import { memo, type CSSProperties, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject, type UIEvent as ReactUIEvent, type WheelEvent as ReactWheelEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Extension, Mark, findParentNodeClosestToPos } from "@tiptap/core";
import Color from "@tiptap/extension-color";
import FontFamily from "@tiptap/extension-font-family";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import { Table } from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import Underline from "@tiptap/extension-underline";
import { DOMParser as ProseMirrorDOMParser, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  addFavoriteTrack,
  addFavoriteTrackToCategory,
  ApiError,
  authorizeAudioFileAccess,
  createManagedUser,
  createFavoriteCategory,
  createNote,
  createNoteFolder,
  coverURL,
  deleteAudioFile,
  deleteLyricsFile,
  deleteFavoriteCategory,
  deleteManagedUser,
  deleteNote,
  deleteNoteFolder,
  getAudioFiles,
  getCurrentUser,
  getFavoriteCategories,
  getFavoriteTracks,
  getManagedUsers,
  getNote,
  getNoteFolders,
  getNotes,
  getTrackMemberships,
  getTrackLyrics,
  getTracks,
  heartbeatPlaybackSession,
  importAudioFolder,
  claimPlaybackSession,
  releasePlaybackSession,
  loginUser,
  logoutUser,
  refreshTracks,
  removeFavoriteTrack,
  removeFavoriteTrackFromCategory,
  renameAudioFile,
  renameLyricsFile,
  sendPresenceHeartbeat,
  sendPresenceOffline,
  setApiSessionToken,
  streamURL,
  updateManagedUserRole,
  updateNote,
  updateNoteFolder
} from "./api";
import type { UploadProgressSnapshot } from "./api";
import type { AudioFileArea, AudioFileImportItemResult, AudioFileImportLimits, AudioFileImportReport, AuthResponse, AuthUser, FavoriteCategory, GrowthNote, LyricLine, ManagedUser, ManagedUserRequest, NoteFolder, OnlineUser, PlaybackSessionResponse, ServerAudioFile, ServerManagedFile, Track, TrackCategoryMembership, TrackLyrics, UserRole } from "./types";

type PlaybackMode = "all" | "one" | "shuffle";
type AppPage = "music" | "lyrics" | "discover" | "profile";
type AuthSession = {
  userId?: number;
  phone: string;
  nickname: string;
  role: UserRole;
  token?: string;
  expiresAt: number;
  createdAt: string;
};
type AuthReadResult = {
  session: AuthSession | null;
  expired: boolean;
};
type PlaybackSessionState = {
  token: string;
  expiresAt: number;
  trackID: number;
  state: "playing" | "paused";
};
type AuthFormState = {
  nickname: string;
  phone: string;
  password: string;
};
type ManagedUserFormState = {
  phone: string;
  nickname: string;
  password: string;
  role: ManagedUserRequest["role"];
};
type TrackContextMenu = {
  track: Track;
  x: number;
  y: number;
};
type AudioFileContextMenu = {
  track: ServerManagedFile;
  x: number;
  y: number;
};
type AudioFileRenameDraft = {
  track: ServerManagedFile;
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
type AudioImportPreflightFilter = "readyAudio" | "readyLyrics" | "duplicate" | "error" | "ignored";
type AudioImportResultFilter = "importedAudio" | "importedLyrics" | "skipped" | "failed";
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
type AudioImportProgress = {
  uploadedBytes: number;
  totalBytes: number;
  speedBytesPerSecond: number;
};
type AudioImportUploadBatch = {
  files: File[];
  bytes: number;
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
type LyricsVisualizerState = {
  bass: number;
  mid: number;
  treble: number;
  energy: number;
};
type LyricsScenePalette = {
  surface: string;
  toneA: string;
  toneB: string;
  toneC: string;
  thread: string;
};
type TrackSortKey = "title" | "artist";
type ProfileView = "main" | "settings" | "audioFiles" | "users" | "about";
type PlaybackQueueScope = { kind: "library" | "favorites" | "category" | "search"; categoryId?: number | null };
type DetachedCurrentTrack = {
  track: Track;
  queueIndex: number;
};
type BufferedAudioRange = {
  startPercent: number;
  endPercent: number;
};
const equalizerBands = [
  { id: "hz31", label: "31Hz", name: "超低", frequency: 31, filterType: "lowshelf", q: 0.7 },
  { id: "hz62", label: "62Hz", name: "低频", frequency: 62, filterType: "peaking", q: 0.95 },
  { id: "hz125", label: "125Hz", name: "低音", frequency: 125, filterType: "peaking", q: 1 },
  { id: "hz250", label: "250Hz", name: "厚度", frequency: 250, filterType: "peaking", q: 1 },
  { id: "hz500", label: "500Hz", name: "中低", frequency: 500, filterType: "peaking", q: 1 },
  { id: "hz1k", label: "1k", name: "中频", frequency: 1000, filterType: "peaking", q: 1 },
  { id: "hz2k", label: "2k", name: "人声", frequency: 2000, filterType: "peaking", q: 1 },
  { id: "hz4k", label: "4k", name: "明亮", frequency: 4000, filterType: "peaking", q: 1 },
  { id: "hz8k", label: "8k", name: "细节", frequency: 8000, filterType: "peaking", q: 0.95 },
  { id: "hz16k", label: "16k", name: "空气", frequency: 16000, filterType: "highshelf", q: 0.7 }
] as const;
type EqualizerBandId = (typeof equalizerBands)[number]["id"];
type EqualizerGains = Record<EqualizerBandId, number>;
type EqualizerAudioChain = {
  audio: HTMLAudioElement;
  context: AudioContext;
  source: MediaElementAudioSourceNode;
  filters: BiquadFilterNode[];
  analyser: AnalyserNode;
};
type BrowserWindowWithAudioContext = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};
const bufferedRangeChangeTolerancePercent = 0.05;
const bufferedFullCoverageToleranceSeconds = 0.75;
const bufferedRangeMergeGapPercent = 0.25;
const bufferUpdateResumeDelayMs = 900;
const currentTimeCommitIntervalMs = 250;
const audioReadyStateHasFutureData = 3;
const unexpectedPauseResumeDelayMs = 120;
const nextTrackPreloadDelayMs = 700;
const lyricsPrefetchDelayMs = 180;
const trackLyricsCacheMaxEntries = 80;
const fullyBufferedRanges: BufferedAudioRange[] = [{ startPercent: 0, endPercent: 100 }];
const equalizerStorageKey = "media-player-equalizer-gains";
const equalizerGainMin = -9;
const equalizerGainMax = 9;
const equalizerGainStep = 0.5;
const equalizerSmoothingTime = 0.018;
const lyricsVisualizerPaintIntervalMs = 320;
const lyricsVisualizerChangeTolerance = 0.035;
const emptyLyricsVisualizerState: LyricsVisualizerState = { bass: 0, mid: 0, treble: 0, energy: 0 };
const lyricsScenePalettes: LyricsScenePalette[] = [
  { surface: "#0b2f5c", toneA: "116, 196, 255", toneB: "102, 232, 226", toneC: "255, 207, 132", thread: "224, 250, 255" },
  { surface: "#123668", toneA: "139, 181, 255", toneB: "86, 218, 242", toneC: "255, 190, 142", thread: "231, 246, 255" },
  { surface: "#0c3955", toneA: "94, 218, 194", toneB: "116, 191, 255", toneC: "247, 218, 139", thread: "224, 255, 248" },
  { surface: "#153461", toneA: "122, 170, 255", toneB: "248, 159, 188", toneC: "246, 216, 138", thread: "242, 246, 255" },
  { surface: "#0a3a68", toneA: "86, 194, 255", toneB: "144, 232, 184", toneC: "255, 204, 130", thread: "224, 250, 255" },
  { surface: "#163159", toneA: "183, 169, 255", toneB: "110, 224, 236", toneC: "242, 202, 134", thread: "236, 248, 255" }
];

type MusicTab = "高品质" | "轻音乐" | "收藏" | "分类" | "歌曲搜索";
const appPages: Array<{ id: AppPage; label: string }> = [
  { id: "music", label: "音乐" },
  { id: "lyrics", label: "歌词" },
  { id: "discover", label: "文档" },
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
const appVersion = "0.1.0";
const appReleaseDate = "2026.07.10";
const baseProfileViewTabs: { id: ProfileView; label: string }[] = [
  { id: "main", label: "个人" },
  { id: "settings", label: "设置" },
  { id: "about", label: "关于" }
];
const authSessionStorageKey = "media-player-auth-session";
const authProfileStorageKey = "media-player-auth-profile";
const presenceSessionStorageKey = "media-player-presence-session";
const playbackDeviceStorageKey = "media-player-playback-device";
const playbackBroadcastStorageKey = "media-player-playback-broadcast";
const manualLibraryRefreshStorageKey = "media-player-manual-library-refresh-at";
const authSessionFallbackDurationMs = 3 * 24 * 60 * 60 * 1000;
const audioFileAccessUploadExtensionMs = 60 * 60 * 1000;
const presenceHeartbeatIntervalMs = 25_000;
const playbackHeartbeatIntervalMs = 5_000;
const playbackSessionRefreshWindowMs = 15_000;
const manualLibraryRefreshCooldownMs = 60_000;
const lyricsChromeAutoHideMs = 2800;
const passwordMinLength = 6;
const passwordMaxLength = 64;
const mainlandPhonePattern = /^1[3-9]\d{9}$/;
const userRoleLabels: Record<UserRole, string> = {
  super_admin: "超级管理员",
  admin: "普通管理员",
  vip: "VIP用户",
  user: "普通用户"
};
const assignableUserRoles: Array<{ role: ManagedUserRequest["role"]; label: string }> = [
  { role: "admin", label: "普通管理员" },
  { role: "vip", label: "VIP用户" },
  { role: "user", label: "普通用户" }
];

function normalizeUserRole(role?: string | null): UserRole {
  switch (role) {
    case "super_admin":
    case "admin":
    case "vip":
      return role;
    default:
      return "user";
  }
}

function canRoleManageUsers(role?: UserRole | null) {
  return normalizeUserRole(role) === "super_admin";
}

function canRoleManageAudioFiles(role?: UserRole | null) {
  const normalizedRole = normalizeUserRole(role);
  return normalizedRole === "super_admin" || normalizedRole === "admin";
}

function canRolePlayLossless(role?: UserRole | null) {
  return normalizeUserRole(role) !== "user";
}

function getDefaultMusicTab(role?: UserRole | null): MusicTab {
  return canRolePlayLossless(role) ? "高品质" : "轻音乐";
}
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
const audioImportBatchMaxBytes = 160 * 1024 * 1024;
const audioImportBatchMaxFiles = 80;
const losslessAudioFileExtensions = new Set([".flac", ".wav", ".aif", ".aiff"]);
const lossyAudioFileExtensionsForUpload = new Set([".mp3", ".aac", ".m4a", ".ogg"]);
const supportedAudioFileExtensions = new Set([...losslessAudioFileExtensions, ...lossyAudioFileExtensionsForUpload]);
const lossyMusicFormats = new Set(["mp3", "aac", "m4a", "ogg"]);
const supportedLyricFileExtensions = new Set([".lrc", ".txt"]);
type AudioManagerArea = Extract<AudioFileArea, "lossless_music" | "lossy_music">;
const audioFileAreas: Array<{ id: AudioManagerArea; label: string }> = [
  { id: "lossless_music", label: "高品质" },
  { id: "lossy_music", label: "轻音乐" }
];

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

function clampEqualizerGain(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(equalizerGainMax, Math.max(equalizerGainMin, Math.round(value / equalizerGainStep) * equalizerGainStep));
}

function createEqualizerGains(overrides: Partial<EqualizerGains>): EqualizerGains {
  const gains = {} as EqualizerGains;
  for (const band of equalizerBands) {
    gains[band.id] = clampEqualizerGain(overrides[band.id] ?? 0);
  }
  return gains;
}

function migrateLegacyEqualizerGains(storedValue: Partial<Record<EqualizerBandId | "sub" | "bass" | "warmth" | "presence" | "air", unknown>>) {
  const migrated: Partial<EqualizerGains> = {};
  const assignLegacyGain = (bandId: EqualizerBandId, legacyIds: Array<"sub" | "bass" | "warmth" | "presence" | "air">) => {
    if (storedValue[bandId] !== undefined) {
      migrated[bandId] = Number(storedValue[bandId]);
      return;
    }
    for (const legacyId of legacyIds) {
      if (storedValue[legacyId] !== undefined) {
        migrated[bandId] = Number(storedValue[legacyId]);
        return;
      }
    }
  };
  assignLegacyGain("hz31", ["sub"]);
  assignLegacyGain("hz62", ["sub"]);
  assignLegacyGain("hz125", ["bass"]);
  assignLegacyGain("hz250", ["bass"]);
  assignLegacyGain("hz500", ["warmth"]);
  assignLegacyGain("hz1k", ["warmth"]);
  assignLegacyGain("hz2k", ["presence"]);
  assignLegacyGain("hz4k", ["presence"]);
  assignLegacyGain("hz8k", ["air"]);
  assignLegacyGain("hz16k", ["air"]);
  return migrated;
}

const equalizerPresets: Array<{ id: string; label: string; gains: EqualizerGains }> = [
  { id: "flat", label: "默认", gains: createEqualizerGains({}) },
  { id: "bass", label: "低音", gains: createEqualizerGains({ hz31: 3.5, hz62: 3, hz125: 2.5, hz250: 1.2, hz500: -0.5, hz1k: -0.8, hz2k: 0, hz4k: 0.4, hz8k: 0.5, hz16k: 0.5 }) },
  { id: "vocal", label: "人声", gains: createEqualizerGains({ hz31: -1.8, hz62: -1.5, hz125: -1, hz250: -0.5, hz500: -1.2, hz1k: 1.2, hz2k: 3, hz4k: 2.2, hz8k: 1, hz16k: 0.5 }) },
  { id: "bright", label: "明亮", gains: createEqualizerGains({ hz31: -1, hz62: -0.8, hz125: -0.5, hz250: -0.3, hz500: 0, hz1k: 0.6, hz2k: 1.3, hz4k: 2, hz8k: 2.8, hz16k: 3 }) },
  { id: "night", label: "夜间", gains: createEqualizerGains({ hz31: -2.5, hz62: -2, hz125: -1.6, hz250: -1, hz500: -0.6, hz1k: -0.4, hz2k: -0.6, hz4k: -1, hz8k: -1.5, hz16k: -2.2 }) }
];

function readEqualizerGains(): EqualizerGains {
  if (typeof window === "undefined") {
    return createEqualizerGains({});
  }
  try {
    const rawValue = window.localStorage.getItem(equalizerStorageKey);
    if (!rawValue) {
      return createEqualizerGains({});
    }
    const storedValue = JSON.parse(rawValue) as Partial<Record<EqualizerBandId | "sub" | "bass" | "warmth" | "presence" | "air", unknown>>;
    return createEqualizerGains(migrateLegacyEqualizerGains(storedValue));
  } catch {
    return createEqualizerGains({});
  }
}

function persistEqualizerGains(gains: EqualizerGains) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(equalizerStorageKey, JSON.stringify(gains));
  } catch {
    // Equalizer changes should keep working even when storage is unavailable.
  }
}

function getEqualizerPresetId(gains: EqualizerGains) {
  const preset = equalizerPresets.find((option) =>
    equalizerBands.every((band) => Math.abs(option.gains[band.id] - gains[band.id]) < 0.05)
  );
  return preset?.id ?? "custom";
}

function formatEqualizerGain(gain: number) {
  const clampedGain = clampEqualizerGain(gain);
  if (clampedGain === 0) {
    return "0dB";
  }
  return `${clampedGain > 0 ? "+" : ""}${clampedGain.toFixed(clampedGain % 1 === 0 ? 0 : 1)}dB`;
}

function getEqualizerLevelPercent(gain: number) {
  const clampedGain = clampEqualizerGain(gain);
  return ((clampedGain - equalizerGainMin) / (equalizerGainMax - equalizerGainMin)) * 100;
}

function clampVisualizerLevel(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function getFrequencyAverage(frequencyData: Uint8Array<ArrayBuffer>, startRatio: number, endRatio: number) {
  const startIndex = Math.max(0, Math.floor(frequencyData.length * startRatio));
  const endIndex = Math.min(frequencyData.length, Math.max(startIndex + 1, Math.ceil(frequencyData.length * endRatio)));
  let total = 0;
  for (let index = startIndex; index < endIndex; index += 1) {
    total += frequencyData[index] ?? 0;
  }
  return clampVisualizerLevel(total / ((endIndex - startIndex) * 255));
}

function readLyricsVisualizerState(analyser: AnalyserNode, frequencyData: Uint8Array<ArrayBuffer>): LyricsVisualizerState {
  analyser.getByteFrequencyData(frequencyData);
  const bass = getFrequencyAverage(frequencyData, 0, 0.12);
  const mid = getFrequencyAverage(frequencyData, 0.12, 0.48);
  const treble = getFrequencyAverage(frequencyData, 0.48, 1);
  const energy = clampVisualizerLevel((bass * 1.12 + mid + treble * 0.82) / 2.94);
  return { bass, mid, treble, energy };
}

function areLyricsVisualizerStatesClose(first: LyricsVisualizerState, second: LyricsVisualizerState) {
  return (
    Math.abs(first.bass - second.bass) < lyricsVisualizerChangeTolerance &&
    Math.abs(first.mid - second.mid) < lyricsVisualizerChangeTolerance &&
    Math.abs(first.treble - second.treble) < lyricsVisualizerChangeTolerance &&
    Math.abs(first.energy - second.energy) < lyricsVisualizerChangeTolerance
  );
}

function hashLyricsSceneKey(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

function getLyricsScenePalette(track: Track | null) {
  if (!track) {
    return lyricsScenePalettes[0];
  }
  const key = [track.artist, track.title, track.album, track.id].join("|");
  return lyricsScenePalettes[hashLyricsSceneKey(key) % lyricsScenePalettes.length];
}

function IconBase({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

function EqualizerIcon() {
  return (
    <IconBase className="transport-icon equalizer-icon">
      <path className="icon-core" d="M5.4 6.2v11.6" />
      <path className="icon-core" d="M12 4.8v14.4" />
      <path className="icon-core" d="M18.6 7.4v9.2" />
      <rect className="icon-fill" x="3.6" y="8.1" width="3.6" height="4.6" rx="1.2" />
      <rect className="icon-fill" x="10.2" y="12.4" width="3.6" height="4.6" rx="1.2" />
      <rect className="icon-fill" x="16.8" y="5.2" width="3.6" height="4.6" rx="1.2" />
      <path className="icon-accent" d="M4.4 19.3c4.1 1.7 10.9 1.6 15.2-.3" />
      <circle className="icon-spark" cx="19.3" cy="18.7" r="1" />
    </IconBase>
  );
}

function FolderRailIcon() {
  return (
    <IconBase className="growth-rail-icon">
      <path d="M3.5 7.2h6.2l1.8 2h9v8.5a2.1 2.1 0 0 1-2.1 2.1H5.6a2.1 2.1 0 0 1-2.1-2.1V7.2Z" />
      <path d="M3.5 7.2V5.8a1.6 1.6 0 0 1 1.6-1.6h4.1l1.8 2h5.4a1.7 1.7 0 0 1 1.7 1.7v1.3" />
    </IconBase>
  );
}

function FolderTreeIcon() {
  return (
    <IconBase className="growth-tree-svg folder">
      <path className="folder-back" d="M3.1 6.7c0-.9.7-1.6 1.6-1.6h4.1c.5 0 .9.2 1.2.5l1.1 1.1h8.2c.9 0 1.6.7 1.6 1.6v1.1H3.1V6.7Z" />
      <path className="folder-front" d="M3.1 8.4h17.8v8.3c0 1.2-.8 2.1-2 2.1H5.1c-1.2 0-2-.9-2-2.1V8.4Z" />
    </IconBase>
  );
}

function DocumentTreeIcon() {
  return (
    <IconBase className="growth-tree-svg document">
      <path className="document-body" d="M6.2 3.4h8.1l3.5 3.6v13.6H6.2V3.4Z" />
      <path className="document-fold" d="M14.1 3.5V7h3.5" />
      <path className="document-line" d="M9.1 11.3h5.7" />
      <path className="document-line" d="M9.1 14.2h4.4" />
    </IconBase>
  );
}

function App() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const equalizerChainRef = useRef<EqualizerAudioChain | null>(null);
  const lyricsVisualizerFrameRef = useRef<number | null>(null);
  const lyricsVisualizerDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const lyricsVisualizerStateRef = useRef<LyricsVisualizerState>(emptyLyricsVisualizerState);
  const lyricsVisualizerLastPaintAtRef = useRef(0);
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
  const playbackDeviceIdRef = useRef<string | null>(null);
  const playbackTabIdRef = useRef<string | null>(null);
  const playbackBroadcastRef = useRef<BroadcastChannel | null>(null);
  const playbackRequestIdRef = useRef(0);
  const lyricsScrollStateRef = useRef<LyricsScrollState>({ trackID: null, top: 0, activeLineIndex: -1 });
  const lyricsChromeTimerRef = useRef<number | null>(null);
  const musicListRef = useRef<HTMLDivElement | null>(null);
  const musicListScrollSettleTimerRef = useRef<number | null>(null);
  const audioPlayRequestIdRef = useRef(0);
  const currentTimeRef = useRef(12);
  const currentTimeCommitTimerRef = useRef<number | null>(null);
  const currentTimeLastCommittedAtRef = useRef(0);
  const lastAppliedAudioSourceRef = useRef("");
  const playbackIntentRef = useRef(false);
  const ignoreAudioPauseUntilRef = useRef(0);
  const nextTrackPreloadAudioRef = useRef<HTMLAudioElement | null>(null);
  const nextTrackPreloadURLRef = useRef("");
  const nextTrackPreloadTimerRef = useRef<number | null>(null);
  const trackLyricsCacheRef = useRef<Map<number, TrackLyrics>>(new Map());
  const trackLyricsRequestRef = useRef<Map<number, Promise<TrackLyrics>>>(new Map());
  const shouldRevealCurrentTrackRef = useRef(false);
  const loadedLibrarySessionKeyRef = useRef<string | null>(null);
  const seekPointerIdRef = useRef<number | null>(null);
  const equalizerPointerRef = useRef<{ pointerId: number; bandId: EqualizerBandId } | null>(null);
  const bufferUpdateResumeAtRef = useRef(0);
  const isCurrentTrackFullyBufferedRef = useRef(false);
  const audioFolderInputRef = useRef<HTMLInputElement | null>(null);
  const audioImportProgressLastPaintAtRef = useRef(0);
  const audioImportProgressPreviousRef = useRef<{ uploadedBytes: number; capturedAt: number } | null>(null);
  if (!initialAuthRef.current) {
    initialAuthRef.current = readAuthSession();
  }
  if (!initialAuthProfileRef.current) {
    initialAuthProfileRef.current = readAuthProfile();
  }
  if (!presenceSessionIdRef.current) {
    presenceSessionIdRef.current = readPresenceSessionID();
  }
  if (!playbackDeviceIdRef.current) {
    playbackDeviceIdRef.current = readPlaybackDeviceID();
  }
  if (!playbackTabIdRef.current) {
    playbackTabIdRef.current = createPlaybackTabID();
  }
  const [libraryTracks, setLibraryTracks] = useState<Track[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playbackQueue, setPlaybackQueue] = useState<Track[]>([]);
  const [playbackQueueScope, setPlaybackQueueScope] = useState<PlaybackQueueScope>({ kind: "library" });
  const [currentTrackId, setCurrentTrackId] = useState<number | null>(null);
  const [playbackSession, setPlaybackSession] = useState<PlaybackSessionState | null>(null);
  const [detachedCurrentTrack, setDetachedCurrentTrack] = useState<DetachedCurrentTrack | null>(null);
  const [trackLyrics, setTrackLyrics] = useState<TrackLyrics | null>(null);
  const [lyricsStatus, setLyricsStatus] = useState<LyricsStatus>("idle");
  const [authSession, setAuthSession] = useState<AuthSession | null>(initialAuthRef.current.session);
  const [authForm, setAuthForm] = useState<AuthFormState>(() => initialAuthProfileRef.current ?? createEmptyAuthForm());
  const [authMessage, setAuthMessage] = useState(initialAuthRef.current.expired ? "登录已过期，请重新登录" : "");
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [showAuthPassword, setShowAuthPassword] = useState(false);
  const [activePage, setActivePage] = useState<AppPage>("music");
  const [activeTab, setActiveTab] = useState<MusicTab>(() => getDefaultMusicTab(initialAuthRef.current?.session?.role));
  const [activeCategoryId, setActiveCategoryId] = useState<number | null>(null);
  const [musicSortKey, setMusicSortKey] = useState<TrackSortKey | null>(null);
  const [favoriteTrackIds, setFavoriteTrackIds] = useState<Set<number>>(() => new Set());
  const [trackCategoryMembershipMap, setTrackCategoryMembershipMap] = useState<Map<number, TrackCategoryMembership[]>>(() => new Map());
  const [favoriteCategories, setFavoriteCategories] = useState<FavoriteCategory[]>([]);
  const [favoriteTracksCache, setFavoriteTracksCache] = useState<Track[] | null>(null);
  const [categoryTracksCache, setCategoryTracksCache] = useState<Map<number, Track[]>>(() => new Map());
  const [trackContextMenu, setTrackContextMenu] = useState<TrackContextMenu | null>(null);
  const [categoryContextMenu, setCategoryContextMenu] = useState<CategoryContextMenu | null>(null);
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>("all");
  const [isPlaybackModeMenuOpen, setIsPlaybackModeMenuOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [lastManualLibraryRefreshAt, setLastManualLibraryRefreshAt] = useState(() => readManualLibraryRefreshAt());
  const [manualLibraryRefreshClock, setManualLibraryRefreshClock] = useState(() => Date.now());
  const [isManualLibraryRefreshing, setIsManualLibraryRefreshing] = useState(false);
  const [isLibraryFiltered, setIsLibraryFiltered] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(() => (typeof document === "undefined" ? false : Boolean(document.fullscreenElement)));
  const [isFullscreenSupported, setIsFullscreenSupported] = useState(() => (typeof document === "undefined" ? false : Boolean(document.fullscreenEnabled)));
  const [isLyricsChromeVisible, setIsLyricsChromeVisible] = useState(true);
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
  const [isAudioLoading, setIsAudioLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(12);
  const [seekPreviewTime, setSeekPreviewTime] = useState<number | null>(null);
  const [duration, setDuration] = useState(185);
  const [bufferedRanges, setBufferedRanges] = useState<BufferedAudioRange[]>([]);
  const [isEqualizerOpen, setIsEqualizerOpen] = useState(false);
  const [equalizerGains, setEqualizerGains] = useState<EqualizerGains>(() => readEqualizerGains());
  const [lyricsVisualizer, setLyricsVisualizer] = useState<LyricsVisualizerState>(emptyLyricsVisualizerState);
  const [sleepTimerMinutes, setSleepTimerMinutes] = useState<number | null>(30);
  const [sleepTimerEndsAt, setSleepTimerEndsAt] = useState<number | null>(null);
  const [sleepTimerNow, setSleepTimerNow] = useState(() => Date.now());
  const [onlineCount, setOnlineCount] = useState(0);
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [profileView, setProfileView] = useState<ProfileView>("main");
  const [audioFileArea, setAudioFileArea] = useState<AudioManagerArea>("lossless_music");
  const [audioFiles, setAudioFiles] = useState<ServerManagedFile[]>([]);
  const [serverAudioSet, setServerAudioSet] = useState<ServerAudioFile[]>([]);
  const [audioFileLimits, setAudioFileLimits] = useState<AudioFileImportLimits>(defaultAudioFileLimits);
  const [audioFilesMessage, setAudioFilesMessage] = useState("");
  const [audioImportReport, setAudioImportReport] = useState<AudioFileImportReport | null>(null);
  const [audioImportPreflight, setAudioImportPreflight] = useState<AudioImportPreflightReport | null>(null);
  const [audioImportProgress, setAudioImportProgress] = useState<AudioImportProgress | null>(null);
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([]);
  const [managedUsersMessage, setManagedUsersMessage] = useState("");
  const [isManagedUsersLoading, setIsManagedUsersLoading] = useState(false);
  const [isManagedUserSubmitting, setIsManagedUserSubmitting] = useState(false);
  const [managedUserForm, setManagedUserForm] = useState<ManagedUserFormState>(() => createEmptyManagedUserForm());
  const [managedUserDeleteTarget, setManagedUserDeleteTarget] = useState<ManagedUser | null>(null);
  const [isManagedUserDeleting, setIsManagedUserDeleting] = useState(false);
  const [audioFileAccess, setAudioFileAccess] = useState<AudioFileAccessGrant | null>(null);
  const [audioFileAccessDialog, setAudioFileAccessDialog] = useState<AudioFileAccessDialogState>(() => createClosedAudioFileAccessDialog());
  const [audioFileAccessClock, setAudioFileAccessClock] = useState(() => Date.now());
  const [isAudioFilesLoading, setIsAudioFilesLoading] = useState(false);
  const [isAudioImporting, setIsAudioImporting] = useState(false);
  const [audioFileMenu, setAudioFileMenu] = useState<AudioFileContextMenu | null>(null);
  const [audioRenameDraft, setAudioRenameDraft] = useState<AudioFileRenameDraft | null>(null);
  const [audioDeleteTarget, setAudioDeleteTarget] = useState<ServerManagedFile | null>(null);

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
  const currentPlaybackToken = playbackSession?.token ?? "";
  const currentTrackStreamURL = currentTrack?.stream_url && currentPlaybackToken ? streamURL(currentTrack, authSession?.token, currentPlaybackToken) : "";
  const nextTrackToPreload = useMemo(() => {
    if (!isPlaying || playbackMode !== "all" || !currentTrack?.stream_url || playbackQueue.length < 2) {
      return null;
    }
    const nextTrack = getAdjacentQueuedTrack(1);
    return nextTrack?.id === currentTrack.id ? null : nextTrack;
  }, [currentTrack, detachedCurrentTrack, isPlaying, playbackMode, playbackQueue]);
  const nextTrackPreloadURL = nextTrackToPreload?.stream_url && currentPlaybackToken ? streamURL(nextTrackToPreload, authSession?.token, currentPlaybackToken) : "";

  const hasTransientPopup = Boolean(
    trackContextMenu ||
      categoryContextMenu ||
      isPlaybackModeMenuOpen ||
      isEqualizerOpen ||
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
    const preventSystemContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };
    document.addEventListener("contextmenu", preventSystemContextMenu, true);
    return () => {
      document.removeEventListener("contextmenu", preventSystemContextMenu, true);
    };
  }, []);

  useEffect(() => {
    if (!detachedCurrentTrack) {
      return;
    }
    if (currentTrackId !== detachedCurrentTrack.track.id || playbackQueue.some((track) => track.id === detachedCurrentTrack.track.id)) {
      setDetachedCurrentTrack(null);
    }
  }, [currentTrackId, detachedCurrentTrack, playbackQueue]);

  useEffect(() => {
    setApiSessionToken(authSession?.token ?? "");
  }, [authSession?.token]);

  useEffect(() => {
    if (!authSession?.userId) {
      return;
    }
    const handlePlaybackMessage = (message: { type?: string; userId?: number; tabId?: string }) => {
      if (message.type !== "playback-claimed" || message.userId !== authSession.userId || message.tabId === playbackTabIdRef.current) {
        return;
      }
      handlePlaybackTakenOver("音乐已切换到其它页面播放");
    };
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel("media-player-playback");
      playbackBroadcastRef.current = channel;
      channel.onmessage = (event: MessageEvent) => handlePlaybackMessage(event.data as { type?: string; userId?: number; tabId?: string });
      return () => {
        if (playbackBroadcastRef.current === channel) {
          playbackBroadcastRef.current = null;
        }
        channel.close();
      };
    }
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== playbackBroadcastStorageKey || !event.newValue) {
        return;
      }
      try {
        handlePlaybackMessage(JSON.parse(event.newValue) as { type?: string; userId?: number; tabId?: string });
      } catch {
        // Ignore malformed cross-tab messages.
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
    };
  }, [authSession?.userId]);

  useEffect(() => {
    if (activeTab !== "高品质" || canRolePlayLossless(authSession?.role)) {
      return;
    }
    const nextTab = getDefaultMusicTab(authSession?.role);
    const visibleTracks = getLibraryTracksForTab(nextTab, libraryTracks, musicSortKey);
    setActiveTab(nextTab);
    setActiveCategoryId(null);
    setIsLibraryFiltered(false);
    setTracks(visibleTracks);
    preserveCurrentTrackForQueue(visibleTracks);
    setPlaybackQueue(visibleTracks);
    setPlaybackQueueScope({ kind: "library" });
  }, [activeTab, authSession?.role, libraryTracks, musicSortKey]);

  useEffect(() => {
    if (profileView === "audioFiles" && !canRoleManageAudioFiles(authSession?.role)) {
      closeAudioFileOverlays();
      setProfileView("main");
    }
    if (profileView === "users" && !canRoleManageUsers(authSession?.role)) {
      setProfileView("main");
    }
  }, [authSession?.role, profileView]);

  useEffect(() => {
    if (!authSession) {
      loadedLibrarySessionKeyRef.current = null;
      setPlaybackSession(null);
      playbackIntentRef.current = false;
      setIsAudioLoading(false);
      setIsPlaying(false);
      setAudioFileAccess(null);
      setAudioFileAccessDialog(createClosedAudioFileAccessDialog());
      setManagedUsers([]);
      setManagedUsersMessage("");
      setManagedUserForm(createEmptyManagedUserForm());
      setManagedUserDeleteTarget(null);
      setIsManagedUserDeleting(false);
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
      setFavoriteTracksCache(null);
      setCategoryTracksCache(new Map());
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
    if (!authSession?.userId || !playbackSession?.token || !currentTrack?.id || !isPlaying) {
      return;
    }

    const intervalID = window.setInterval(() => {
      void sendPlaybackHeartbeat("playing");
    }, playbackHeartbeatIntervalMs);

    return () => {
      window.clearInterval(intervalID);
    };
  }, [authSession?.userId, playbackSession?.token, currentTrack?.id, isPlaying]);

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
    if (typeof document === "undefined") {
      return;
    }

    function syncFullscreenState() {
      setIsFullscreen(Boolean(document.fullscreenElement));
      setIsFullscreenSupported(Boolean(document.fullscreenEnabled));
    }

    syncFullscreenState();
    document.addEventListener("fullscreenchange", syncFullscreenState);
    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreenState);
    };
  }, []);

  useEffect(() => {
    clearLyricsChromeTimer();
    if (activePage !== "lyrics") {
      setIsLyricsChromeVisible(true);
      return;
    }
    setIsLyricsChromeVisible(true);
    scheduleLyricsChromeHide();
    return clearLyricsChromeTimer;
  }, [activePage]);

  useEffect(() => {
    if (activePage !== "lyrics") {
      return;
    }
    const revealOnKeyDown = () => revealLyricsChrome();
    window.addEventListener("keydown", revealOnKeyDown);
    return () => {
      window.removeEventListener("keydown", revealOnKeyDown);
    };
  }, [activePage]);

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
      clearCurrentTimeCommitTimer();
      clearPendingTrackPlay();
      cancelLongPress();
      cancelCategoryLongPress();
      clearMusicListScrollSettleTimer();
      clearLyricsChromeTimer();
      stopLyricsVisualizer(false);
      disconnectEqualizerAudioChain();
    };
  }, []);

  useEffect(() => {
    persistEqualizerGains(equalizerGains);
    applyEqualizerGains(equalizerGains);
  }, [equalizerGains]);

  useEffect(() => {
    if (activePage !== "lyrics" || !isPlaying || !currentTrack?.stream_url) {
      stopLyricsVisualizer();
      return;
    }

    const context = ensureEqualizerAudioChain();
    const chain = equalizerChainRef.current;
    if (!context || !chain?.analyser) {
      stopLyricsVisualizer();
      return;
    }

    if (context.state === "suspended") {
      void context.resume().catch(() => undefined);
    }

    const analyser = chain.analyser;
    let frequencyData = lyricsVisualizerDataRef.current;
    if (!frequencyData || frequencyData.length !== analyser.frequencyBinCount) {
      frequencyData = new Uint8Array(analyser.frequencyBinCount);
      lyricsVisualizerDataRef.current = frequencyData;
    }

    let isCancelled = false;
    const paintVisualizer = (timestamp: number) => {
      if (isCancelled) {
        return;
      }
      if (timestamp - lyricsVisualizerLastPaintAtRef.current >= lyricsVisualizerPaintIntervalMs) {
        lyricsVisualizerLastPaintAtRef.current = timestamp;
        const nextVisualizer = readLyricsVisualizerState(analyser, frequencyData);
        if (!areLyricsVisualizerStatesClose(lyricsVisualizerStateRef.current, nextVisualizer)) {
          lyricsVisualizerStateRef.current = nextVisualizer;
          setLyricsVisualizer(nextVisualizer);
        }
      }
      lyricsVisualizerFrameRef.current = window.requestAnimationFrame(paintVisualizer);
    };

    lyricsVisualizerFrameRef.current = window.requestAnimationFrame(paintVisualizer);
    return () => {
      isCancelled = true;
      stopLyricsVisualizer();
    };
  }, [activePage, isPlaying, currentTrack?.id, currentTrack?.stream_url]);

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
      playbackIntentRef.current = false;
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
    if (activePage !== "music" || !shouldRevealCurrentTrackRef.current || !currentTrack?.id) {
      return;
    }

    const musicList = musicListRef.current;
    const row = musicList?.querySelector<HTMLButtonElement>(`[data-track-id="${currentTrack.id}"]`);
    if (!musicList || !row) {
      return;
    }

    clearMusicListScrollSettleTimer();
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
    const token = authSession?.token;
    if (!token) {
      return;
    }
    let cancelled = false;

    void getCurrentUser()
      .then((response) => {
        if (cancelled) {
          return;
        }
        setAuthSession((previous) => {
          if (!previous || previous.token !== token) {
            return previous;
          }
          const nextSession: AuthSession = {
            ...previous,
            userId: response.user.id,
            phone: response.user.phone,
            nickname: response.user.nickname,
            role: normalizeUserRole(response.user.role)
          };
          if (
            previous.userId === nextSession.userId &&
            previous.phone === nextSession.phone &&
            previous.nickname === nextSession.nickname &&
            previous.role === nextSession.role
          ) {
            return previous;
          }
          persistAuthSession(nextSession);
          persistAuthProfile(response.user);
          return nextSession;
        });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        if (error instanceof ApiError && error.status === 401) {
          removeLocalStorage(authSessionStorageKey);
          setApiSessionToken("");
          setAuthSession(null);
          setAuthMessage("登录已过期，请重新登录");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authSession?.token]);

  useEffect(() => {
    const sessionID = presenceSessionIdRef.current;
    if (!authSession || !sessionID) {
      setOnlineCount(0);
      setOnlineUsers([]);
      return;
    }

    const reportPresence = async () => {
      try {
        const response = await sendPresenceHeartbeat({
          session_id: sessionID,
          user_id: authSession.userId,
          phone: authSession.phone
        });
        setOnlineCount(response.online_count);
        setOnlineUsers(response.online_users ?? []);
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

    commitCurrentTime(currentTrack.stream_url ? 0 : 12);
    seekPointerIdRef.current = null;
    bufferUpdateResumeAtRef.current = 0;
    isCurrentTrackFullyBufferedRef.current = false;
    setSeekPreviewTime(null);
    setDuration(currentTrack.duration_seconds ?? 185);
    setBufferedRanges([]);

    if (!currentTrack.stream_url) {
      playbackIntentRef.current = false;
      audio.pause();
      setIsAudioLoading(false);
      setIsPlaying(false);
      return;
    }
  }, [currentTrack]);

  useEffect(() => {
    if (activePage !== "lyrics" || !currentTrack?.id) {
      setTrackLyrics(null);
      setLyricsStatus("idle");
      return;
    }

    const trackID = currentTrack.id;
    const cachedLyrics = trackLyricsCacheRef.current.get(trackID);
    if (cachedLyrics) {
      setTrackLyrics(cachedLyrics);
      setLyricsStatus(cachedLyrics.lines.length ? "ready" : "empty");
      return;
    }

    let isStale = false;
    setLyricsStatus("loading");
    setTrackLyrics(null);
    void loadTrackLyrics(trackID)
      .then((lyrics) => {
        if (isStale) {
          return;
        }
        setTrackLyrics(lyrics);
        setLyricsStatus(lyrics.lines.length ? "ready" : "empty");
      })
      .catch((error) => {
        if (isStale || (error instanceof DOMException && error.name === "AbortError")) {
          return;
        }
        setTrackLyrics(null);
        setLyricsStatus("error");
      });

    return () => {
      isStale = true;
    };
  }, [activePage, currentTrack?.id]);

  useEffect(() => {
    if (!authSession?.token || !currentTrack?.id) {
      return;
    }
    const delay = activePage === "lyrics" ? 0 : lyricsPrefetchDelayMs;
    const timerID = window.setTimeout(() => {
      prefetchTrackLyrics(currentTrack);
      prefetchTrackLyrics(nextTrackToPreload);
    }, delay);
    return () => window.clearTimeout(timerID);
  }, [activePage, authSession?.token, currentTrack?.id, nextTrackToPreload?.id]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    playbackIntentRef.current = isPlaying;
    if (!currentTrackStreamURL) {
      lastAppliedAudioSourceRef.current = "";
      audioPlayRequestIdRef.current += 1;
      ignoreAudioPauseUntilRef.current = 0;
      setIsAudioLoading(false);
      if (!audio.paused) {
        audio.pause();
      }
      if (audio.getAttribute("src")) {
        audio.removeAttribute("src");
        audio.load();
      }
      return;
    }
    if (lastAppliedAudioSourceRef.current !== currentTrackStreamURL) {
      lastAppliedAudioSourceRef.current = currentTrackStreamURL;
      if (audio.getAttribute("src") !== currentTrackStreamURL) {
        audio.src = currentTrackStreamURL;
      }
      if (isPlaying) {
        ignoreAudioPauseUntilRef.current = Date.now() + 1200;
        setIsAudioLoading(true);
      }
      audio.load();
    }
    if (isPlaying) {
      prepareEqualizerForPlayback();
      if (audio.readyState < audioReadyStateHasFutureData) {
        setIsAudioLoading(true);
      }
      const playRequestId = audioPlayRequestIdRef.current + 1;
      audioPlayRequestIdRef.current = playRequestId;
      void audio.play().catch((error) => {
        if (audioPlayRequestIdRef.current !== playRequestId) {
          return;
        }
        const errorName = error instanceof Error ? error.name : "";
        if (errorName === "AbortError") {
          return;
        }
        setIsAudioLoading(false);
        setIsPlaying(false);
      });
    } else {
      audioPlayRequestIdRef.current += 1;
      ignoreAudioPauseUntilRef.current = 0;
      setIsAudioLoading(false);
      if (!audio.paused) {
        audio.pause();
      }
    }
  }, [currentTrackStreamURL, isPlaying]);

  useEffect(() => {
    if (typeof Audio === "undefined") {
      return;
    }
    if (nextTrackPreloadTimerRef.current !== null) {
      window.clearTimeout(nextTrackPreloadTimerRef.current);
      nextTrackPreloadTimerRef.current = null;
    }

    if (!nextTrackPreloadURL) {
      const preloadAudio = nextTrackPreloadAudioRef.current;
      if (nextTrackPreloadURLRef.current) {
        nextTrackPreloadURLRef.current = "";
        preloadAudio?.pause();
        preloadAudio?.removeAttribute("src");
        preloadAudio?.load();
      }
      return;
    }

    if (nextTrackPreloadURLRef.current && nextTrackPreloadURLRef.current !== nextTrackPreloadURL) {
      const preloadAudio = nextTrackPreloadAudioRef.current;
      nextTrackPreloadURLRef.current = "";
      preloadAudio?.pause();
      preloadAudio?.removeAttribute("src");
      preloadAudio?.load();
    }

    if (nextTrackPreloadURLRef.current === nextTrackPreloadURL) {
      return;
    }

    nextTrackPreloadTimerRef.current = window.setTimeout(() => {
      const preloadAudio = nextTrackPreloadAudioRef.current ?? new Audio();
      nextTrackPreloadAudioRef.current = preloadAudio;
      preloadAudio.preload = "auto";

      if (nextTrackPreloadURLRef.current === nextTrackPreloadURL) {
        return;
      }

      nextTrackPreloadURLRef.current = nextTrackPreloadURL;
      preloadAudio.src = nextTrackPreloadURL;
      preloadAudio.load();
      nextTrackPreloadTimerRef.current = null;
    }, nextTrackPreloadDelayMs);

    return () => {
      if (nextTrackPreloadTimerRef.current !== null) {
        window.clearTimeout(nextTrackPreloadTimerRef.current);
        nextTrackPreloadTimerRef.current = null;
      }
    };
  }, [nextTrackPreloadURL]);

  useEffect(() => {
    return () => {
      if (nextTrackPreloadTimerRef.current !== null) {
        window.clearTimeout(nextTrackPreloadTimerRef.current);
        nextTrackPreloadTimerRef.current = null;
      }
      const preloadAudio = nextTrackPreloadAudioRef.current;
      if (!preloadAudio) {
        return;
      }
      preloadAudio.pause();
      preloadAudio.removeAttribute("src");
      preloadAudio.load();
      nextTrackPreloadAudioRef.current = null;
      nextTrackPreloadURLRef.current = "";
    };
  }, []);

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
    void sendPlaybackHeartbeat("paused");
    if (detachedCurrentTrack) {
      setDetachedCurrentTrack(null);
      setCurrentTrackId(null);
    }
  }

  function preserveCurrentTrackForQueue(nextQueue: Track[]) {
    if (!currentTrackId || !currentTrack || nextQueue.some((track) => track.id === currentTrack.id)) {
      return;
    }
    const queueIndex = playbackQueue.findIndex((track) => track.id === currentTrack.id);
    setDetachedCurrentTrack((previous) => {
      if (previous?.track.id === currentTrack.id) {
        return previous;
      }
      return {
        track: currentTrack,
        queueIndex: Math.max(0, queueIndex)
      };
    });
  }

  function syncLibraryTracksForTab(
    tab: MusicTab,
    nextTracks: Track[],
    { resetQueue = false, forceVisible = false }: { resetQueue?: boolean; forceVisible?: boolean } = {}
  ) {
    const visibleTracks = getLibraryTracksForTab(tab, nextTracks, musicSortKey);
    setLibraryTracks((previous) => (areTrackListsEqual(previous, nextTracks) ? previous : nextTracks));
    if (forceVisible || isLibraryMusicTab(tab)) {
      setTracks((previous) => (areTrackListsEqual(previous, visibleTracks) ? previous : visibleTracks));
    }
    setPlaybackQueueScope({ kind: "library" });
    const nextQueue = resetQueue || !playbackQueue.length ? visibleTracks : mergePlaybackQueue(playbackQueue, visibleTracks);
    preserveCurrentTrackForQueue(nextQueue);
    setPlaybackQueue((previous) => (areTrackListsEqual(previous, nextQueue) ? previous : nextQueue));
    setCurrentTrackId((previous) => {
      if (previous) {
        return previous;
      }
      return visibleTracks[0]?.id ?? null;
    });
  }

  function syncLibraryTracks(
    nextTracks: Track[],
    { resetQueue = false, forceVisible = false }: { resetQueue?: boolean; forceVisible?: boolean } = {}
  ) {
    syncLibraryTracksForTab(activeTab, nextTracks, { resetQueue, forceVisible });
  }

  async function refreshLibrary({
    keepExistingOnError = false,
    manual = false,
    forceVisible = false,
    targetTab = activeTab
  }: {
    keepExistingOnError?: boolean;
    manual?: boolean;
    forceVisible?: boolean;
    targetTab?: MusicTab;
  } = {}) {
    setIsLoading(true);
    setLoadMessage("");
    setIsLibraryFiltered(false);
    try {
      let payload;
      if (manual) {
        const userID = authSession?.userId;
        if (!userID) {
          throw new Error("请先登录后刷新高品质");
        }
        payload = await refreshTracks(userID);
      } else {
        payload = await getTracks();
      }
      syncLibraryTracksForTab(targetTab, payload.tracks, { forceVisible });
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "本地高品质加载失败";
      if (!keepExistingOnError) {
        setLibraryTracks([]);
        if (isLibraryMusicTab(targetTab)) {
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

  function getCachedFavoriteTracks(categoryId?: number | null) {
    const normalizedCategoryId = categoryId ?? null;
    return normalizedCategoryId === null ? favoriteTracksCache : categoryTracksCache.get(normalizedCategoryId) ?? null;
  }

  function cacheFavoriteTracks(nextTracks: Track[], categoryId?: number | null) {
    const normalizedCategoryId = categoryId ?? null;
    if (normalizedCategoryId === null) {
      setFavoriteTracksCache(nextTracks);
      return;
    }
    setCategoryTracksCache((previous) => {
      const cachedTracks = previous.get(normalizedCategoryId);
      if (cachedTracks && areTrackListsEqual(cachedTracks, nextTracks)) {
        return previous;
      }
      const next = new Map(previous);
      next.set(normalizedCategoryId, nextTracks);
      return next;
    });
  }

  function invalidateFavoriteTrackCache({
    favorites = false,
    categoryId,
    allCategories = false
  }: {
    favorites?: boolean;
    categoryId?: number | null;
    allCategories?: boolean;
  } = {}) {
    if (favorites) {
      setFavoriteTracksCache(null);
    }
    if (allCategories) {
      setCategoryTracksCache(new Map());
      return;
    }
    if (categoryId == null) {
      return;
    }
    setCategoryTracksCache((previous) => {
      if (!previous.has(categoryId)) {
        return previous;
      }
      const next = new Map(previous);
      next.delete(categoryId);
      return next;
    });
  }

  async function refreshFavoriteTracks({
    showList = false,
    categoryId,
    force = false
  }: {
    showList?: boolean;
    categoryId?: number | null;
    force?: boolean;
  } = {}) {
    if (!authSession?.userId) {
      setFavoriteTrackIds(new Set());
      setFavoriteTracksCache(null);
      setCategoryTracksCache(new Map());
      if (showList) {
        setTracks([]);
        setLoadMessage(categoryId != null ? "请先登录后查看分类" : "请先登录后查看收藏");
      }
      return;
    }

    const cachedTracks = force ? null : getCachedFavoriteTracks(categoryId);
    if (cachedTracks && !force) {
      if (showList) {
        setTracks(cachedTracks);
        setLoadMessage("");
        setIsLoading(false);
      }
      syncFavoritePlaybackQueue(cachedTracks, categoryId);
      return;
    }

    if (showList) {
      setIsLoading(!cachedTracks);
      setLoadMessage("");
      if (cachedTracks) {
        setTracks(cachedTracks);
      }
    }
    try {
      const payload = await getFavoriteTracks(authSession.userId, categoryId ?? undefined);
      cacheFavoriteTracks(payload.tracks, categoryId);
      if (categoryId != null) {
        const favoritesPayload = await getFavoriteTracks(authSession.userId);
        setFavoriteTracksCache(favoritesPayload.tracks);
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
        if (cachedTracks) {
          showToast(error instanceof Error ? error.message : categoryId ? "分类歌曲加载失败" : "收藏列表加载失败");
        } else {
          setTracks([]);
          setLoadMessage(error instanceof Error ? error.message : categoryId ? "分类歌曲加载失败" : "收藏列表加载失败");
        }
      }
    } finally {
      if (showList) {
        setIsLoading(false);
      }
    }
  }

  function clearCurrentLibrary() {
    audioPlayRequestIdRef.current += 1;
    releaseCurrentPlaybackSession();
    clearTrackLyricsCache();
    if (nextTrackPreloadTimerRef.current !== null) {
      window.clearTimeout(nextTrackPreloadTimerRef.current);
      nextTrackPreloadTimerRef.current = null;
    }
    if (nextTrackPreloadAudioRef.current) {
      nextTrackPreloadAudioRef.current.pause();
      nextTrackPreloadAudioRef.current.removeAttribute("src");
      nextTrackPreloadAudioRef.current.load();
    }
    nextTrackPreloadURLRef.current = "";
    if (audioRef.current) {
      playbackIntentRef.current = false;
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
      audioRef.current.load();
    }
    lastAppliedAudioSourceRef.current = "";
    setLibraryTracks([]);
    setTracks([]);
    setPlaybackQueue([]);
    setDetachedCurrentTrack(null);
    setCurrentTrackId(null);
    setTrackLyrics(null);
    setLyricsStatus("idle");
    setIsAudioLoading(false);
    setIsPlaying(false);
    commitCurrentTime(0);
    setDuration(0);
  }

  function handleTabClick(tab: MusicTab, target?: HTMLElement) {
    if (tab === "高品质" && !canRolePlayLossless(authSession?.role)) {
      showToast("当前用户无权播放高品质");
      tab = "轻音乐";
    }
    shouldRevealCurrentTrackRef.current = false;
    setActiveTab(tab);
    setActivePage("music");
    setActiveCategoryId(null);
    setIsPlaybackModeMenuOpen(false);
    setIsEqualizerOpen(false);
    setIsCategorySelectorOpen(false);
    setCategorySelectorPosition(null);
    setIsCategoryDialogOpen(false);
    setCategoryDialogPosition(null);
    setCategoryContextMenu(null);
    closeCategoryPicker();
    if (isLibraryMusicTab(tab)) {
      const visibleTracks = getLibraryTracksForTab(tab, libraryTracks, musicSortKey);
      setIsLibraryFiltered(false);
      setIsSearchOpen(false);
      setSearchDialogPosition(null);
      setTrackContextMenu(null);
      setLoadMessage("");
      setTracks(visibleTracks);
      preserveCurrentTrackForQueue(visibleTracks);
      setPlaybackQueue(visibleTracks);
      setPlaybackQueueScope({ kind: "library" });
      if (tab === "轻音乐") {
        void refreshLibrary({ keepExistingOnError: true, forceVisible: true, targetTab: tab });
      }
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
    if (!canRolePlayLossless(authSession?.role)) {
      handleTabClick("轻音乐");
      showToast("当前用户无权播放高品质");
      return;
    }
    const shouldRefreshLibrary = activePage === "music" && activeTab === "高品质" && !isLibraryFiltered;
    handleTabClick("高品质");

    if (!shouldRefreshLibrary) {
      return;
    }
    if (isManualLibraryRefreshing) {
      return;
    }
    if (!authSession?.userId) {
      showToast("请先登录后刷新高品质");
      return;
    }
    if (manualLibraryRefreshRemainingMs > 0) {
      showToast(`高品质刷新太频繁，请${manualLibraryRefreshCooldownSeconds}秒后再试`);
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
      showToast(result.message ?? "高品质刷新失败");
      return;
    }

    const refreshedAt = Date.now();
    setLastManualLibraryRefreshAt(refreshedAt);
    setManualLibraryRefreshClock(refreshedAt);
    writeManualLibraryRefreshAt(refreshedAt);
    showToast("高品质已刷新");
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
    setAudioImportProgress(null);
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

  function extendAudioFileAccessDuringUpload(token: string) {
    if (!authSession?.userId || !token) {
      return;
    }
    const nextExpiresAt = Date.now() + audioFileAccessUploadExtensionMs;
    setAudioFileAccess((previous) => {
      if (!previous || previous.userId !== authSession.userId || previous.token !== token) {
        return previous;
      }
      if (previous.expiresAt >= nextExpiresAt) {
        return previous;
      }
      return { ...previous, expiresAt: nextExpiresAt };
    });
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
    setIsEqualizerOpen(false);
    setIsCategorySelectorOpen(false);
    setCategorySelectorPosition(null);
    setCategoryPickerTrack(null);
    setCategoryPickerPosition(null);
    setIsCategoryDialogOpen(false);
    setCategoryDialogPosition(null);
    setCategoryName("");
    setIsSearchOpen(false);
    setSearchDialogPosition(null);
    setActiveTab((previous) => (previous === "歌曲搜索" ? getDefaultMusicTab(authSession?.role) : previous));
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
    if (!isLibraryMusicTab(activeTab)) {
      return;
    }

    const sortedTracks = getLibraryTracksForTab(activeTab, libraryTracks, sortKey);
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

  async function toggleFullscreen() {
    if (typeof document === "undefined" || !document.fullscreenEnabled) {
      showToast("当前浏览器不支持全屏");
      return;
    }

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      await document.documentElement.requestFullscreen();
    } catch {
      showToast("全屏切换失败");
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
      if (activeTab === "歌曲搜索") {
        const nextTab = getDefaultMusicTab(authSession?.role);
        setActiveTab(nextTab);
        setActiveCategoryId(null);
        setIsLibraryFiltered(false);
        setTracks(getLibraryTracksForTab(nextTab, libraryTracks, musicSortKey));
      }
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
      const nextSession = createAuthSession(response);
      persistAuthSession(nextSession);
      persistAuthProfile(response.user);
      setApiSessionToken(nextSession.token);
      setPlaybackSession(null);
      setFavoriteTracksCache(null);
      setCategoryTracksCache(new Map());
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
      setActiveTab(getDefaultMusicTab(nextSession.role));
      setProfileView("main");
      setIsPlaybackModeMenuOpen(false);
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : "提交失败，请稍后再试");
    } finally {
      setIsAuthSubmitting(false);
    }
  }

  function handleLogout() {
    if (authSession?.token) {
      void logoutUser().catch(() => undefined);
    }
    clearCurrentLibrary();
    setApiSessionToken("");
    removeLocalStorage(authSessionStorageKey);
    loadedLibrarySessionKeyRef.current = null;
    setAuthSession(null);
    setAuthForm((previous) => ({ ...previous, password: "" }));
    setAuthMessage("");
    setShowAuthPassword(false);
    setActivePage("music");
    setOnlineCount(0);
    setOnlineUsers([]);
    setProfileView("main");
    setIsSearchOpen(false);
    setSearchDialogPosition(null);
    setActiveTab(getDefaultMusicTab(null));
    setActiveCategoryId(null);
    setFavoriteTrackIds(new Set());
    setTrackCategoryMembershipMap(new Map());
    setFavoriteCategories([]);
    setFavoriteTracksCache(null);
    setCategoryTracksCache(new Map());
    setAudioFiles([]);
    setServerAudioSet([]);
    setAudioFilesMessage("");
    setAudioImportReport(null);
    setAudioImportPreflight(null);
    setManagedUsers([]);
    setManagedUsersMessage("");
    setManagedUserForm(createEmptyManagedUserForm());
    setManagedUserDeleteTarget(null);
    setIsManagedUserDeleting(false);
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
    setActiveTab(getDefaultMusicTab(authSession?.role));
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

  function cacheTrackLyrics(trackID: number, lyrics: TrackLyrics) {
    const cache = trackLyricsCacheRef.current;
    if (cache.has(trackID)) {
      cache.delete(trackID);
    }
    cache.set(trackID, lyrics);
    while (cache.size > trackLyricsCacheMaxEntries) {
      const oldestKey = cache.keys().next().value;
      if (typeof oldestKey !== "number") {
        break;
      }
      cache.delete(oldestKey);
    }
  }

  function clearTrackLyricsCache(trackID?: number | null) {
    if (typeof trackID === "number") {
      trackLyricsCacheRef.current.delete(trackID);
      trackLyricsRequestRef.current.delete(trackID);
      return;
    }
    trackLyricsCacheRef.current.clear();
    trackLyricsRequestRef.current.clear();
  }

  function normalizeTrackLyricsPayload(payload: TrackLyrics): TrackLyrics {
    return { ...payload, lines: normalizeLyricLines(payload.lines) };
  }

  function loadTrackLyrics(trackID: number, options: { signal?: AbortSignal } = {}) {
    const cachedLyrics = trackLyricsCacheRef.current.get(trackID);
    if (cachedLyrics) {
      return Promise.resolve(cachedLyrics);
    }
    const pendingLyrics = trackLyricsRequestRef.current.get(trackID);
    if (pendingLyrics) {
      return pendingLyrics;
    }
    let request: Promise<TrackLyrics>;
    request = getTrackLyrics(trackID, { signal: options.signal })
      .then((payload) => {
        const normalizedLyrics = normalizeTrackLyricsPayload(payload);
        cacheTrackLyrics(trackID, normalizedLyrics);
        return normalizedLyrics;
      })
      .finally(() => {
        if (trackLyricsRequestRef.current.get(trackID) === request) {
          trackLyricsRequestRef.current.delete(trackID);
        }
      });
    trackLyricsRequestRef.current.set(trackID, request);
    return request;
  }

  function prefetchTrackLyrics(track?: Track | null) {
    if (!track?.id || !track.stream_url || trackLyricsCacheRef.current.has(track.id) || trackLyricsRequestRef.current.has(track.id)) {
      return;
    }
    void loadTrackLyrics(track.id).catch(() => undefined);
  }

  async function refreshAudioFiles({
    silent = false,
    accessToken: providedAccessToken,
    area = audioFileArea
  }: {
    silent?: boolean;
    accessToken?: string;
    area?: AudioFileArea;
  } = {}) {
    const requestArea = normalizeAudioManagerArea(area);
    if (!authSession?.userId) {
      setAudioFiles([]);
      setServerAudioSet([]);
      setAudioFilesMessage("请先登录后管理服务器文件");
      return { ok: false };
    }
    if (!canRoleManageAudioFiles(authSession.role)) {
      setAudioFiles([]);
      setServerAudioSet([]);
      setAudioFilesMessage("当前用户无权管理服务器文件");
      return { ok: false };
    }
    const accessToken = providedAccessToken ?? getValidAudioFileAccessToken();
    if (!accessToken) {
      setAudioFilesMessage("请先验证当前用户密码后再管理服务器文件");
      if (!silent) {
        openAudioFileAccessDialog();
      }
      return { ok: false };
    }

    if (!silent) {
      setIsAudioFilesLoading(true);
    }
    try {
      const payload = await getAudioFiles(authSession.userId, accessToken, requestArea);
      const nextServerAudioSet = buildServerAudioSetFromTracks(payload.files, payload.server_audio_set);
      setAudioFiles(payload.files);
      setServerAudioSet(nextServerAudioSet);
      setAudioFileLimits(payload.limits);
      setAudioFilesMessage("");
      return { ok: true, files: payload.files, serverAudioSet: nextServerAudioSet, limits: payload.limits };
    } catch (error) {
      const message = error instanceof Error ? error.message : "读取服务器文件失败";
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
      showToast("请先登录后管理服务器文件");
      return;
    }
    if (!canRoleManageAudioFiles(authSession.role)) {
      showToast("当前用户无权管理服务器文件");
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
    const managerArea = normalizeAudioManagerArea(audioFileArea);
    if (managerArea !== audioFileArea) {
      setAudioFileArea(managerArea);
    }
    void refreshAudioFiles({ accessToken, area: managerArea });
  }

  function changeAudioFileArea(area: AudioFileArea) {
    const managerArea = normalizeAudioManagerArea(area);
    if (managerArea === audioFileArea || isAudioImporting) {
      return;
    }
    closeAudioFileOverlays();
    setAudioFileArea(managerArea);
    setAudioImportReport(null);
    setAudioImportPreflight(null);
    setAudioImportProgress(null);
    void refreshAudioFiles({ area: managerArea });
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

  async function refreshManagedUsers({ silent = false }: { silent?: boolean } = {}) {
    if (!canRoleManageUsers(authSession?.role)) {
      setManagedUsers([]);
      setManagedUsersMessage("仅超级管理员可以管理用户");
      return { ok: false };
    }
    if (!silent) {
      setIsManagedUsersLoading(true);
    }
    try {
      const payload = await getManagedUsers();
      setManagedUsers(payload.users);
      setManagedUsersMessage("");
      return { ok: true, users: payload.users };
    } catch (error) {
      const message = error instanceof Error ? error.message : "读取用户列表失败";
      setManagedUsersMessage(message);
      if (!silent) {
        showToast(message);
      }
      return { ok: false, message };
    } finally {
      if (!silent) {
        setIsManagedUsersLoading(false);
      }
    }
  }

  function openUserManager() {
    if (!canRoleManageUsers(authSession?.role)) {
      showToast("仅超级管理员可以管理用户");
      return;
    }
    setProfileView("users");
    void refreshManagedUsers();
  }

  function updateManagedUserForm(field: keyof ManagedUserFormState, value: string) {
    setManagedUserForm((previous) => ({
      ...previous,
      [field]: field === "phone" ? normalizePhone(value).slice(0, 11) : field === "password" ? value.slice(0, passwordMaxLength) : value
    }));
    setManagedUsersMessage("");
  }

  async function submitManagedUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canRoleManageUsers(authSession?.role) || isManagedUserSubmitting) {
      return;
    }
    const phone = normalizePhone(managedUserForm.phone);
    if (!mainlandPhonePattern.test(phone)) {
      setManagedUsersMessage("请输入有效的中国大陆手机号码");
      return;
    }
    const nickname = managedUserForm.nickname.trim();
    if (!nickname) {
      setManagedUsersMessage("昵称不能为空");
      return;
    }
    if (managedUserForm.password.length < passwordMinLength || managedUserForm.password.length > passwordMaxLength) {
      setManagedUsersMessage(`密码长度需为${passwordMinLength}-${passwordMaxLength}位`);
      return;
    }

    setIsManagedUserSubmitting(true);
    try {
      const response = await createManagedUser({
        phone,
        nickname,
        password: managedUserForm.password,
        role: managedUserForm.role
      });
      setManagedUsers((previous) => sortManagedUsers([...previous, response.user]));
      setManagedUserForm(createEmptyManagedUserForm());
      setManagedUsersMessage("用户已创建");
    } catch (error) {
      setManagedUsersMessage(error instanceof Error ? error.message : "创建用户失败");
    } finally {
      setIsManagedUserSubmitting(false);
    }
  }

  async function changeManagedUserRole(user: ManagedUser, role: ManagedUserRequest["role"]) {
    if (user.role === "super_admin" || user.role === role || !canRoleManageUsers(authSession?.role)) {
      return;
    }
    try {
      const response = await updateManagedUserRole(user.id, role);
      setManagedUsers((previous) => previous.map((item) => (item.id === response.user.id ? response.user : item)));
      setManagedUsersMessage("用户权限已更新");
    } catch (error) {
      setManagedUsersMessage(error instanceof Error ? error.message : "更新用户权限失败");
      void refreshManagedUsers({ silent: true });
    }
  }

  function openManagedUserDelete(user: ManagedUser) {
    if (user.role === "super_admin" || !canRoleManageUsers(authSession?.role)) {
      return;
    }
    setManagedUserDeleteTarget(user);
    setManagedUsersMessage("");
  }

  function closeManagedUserDelete() {
    if (isManagedUserDeleting) {
      return;
    }
    setManagedUserDeleteTarget(null);
  }

  async function confirmManagedUserDelete() {
    if (!managedUserDeleteTarget || isManagedUserDeleting || !canRoleManageUsers(authSession?.role)) {
      return;
    }
    const target = managedUserDeleteTarget;
    setIsManagedUserDeleting(true);
    try {
      await deleteManagedUser(target.id);
      setManagedUsers((previous) => previous.filter((user) => user.id !== target.id));
      setManagedUserDeleteTarget(null);
      setManagedUsersMessage("用户已删除");
    } catch (error) {
      setManagedUsersMessage(error instanceof Error ? error.message : "删除用户失败");
      void refreshManagedUsers({ silent: true });
    } finally {
      setIsManagedUserDeleting(false);
    }
  }

  function handleChooseAudioFolder() {
    if (isAudioImporting) {
      return;
    }
    setAudioImportPreflight(null);
    setAudioImportProgress(null);
    audioFolderInputRef.current?.click();
  }

  async function handleAudioFolderChange(files: FileList | null) {
    const selectedFiles = Array.from(files ?? []);
    if (!selectedFiles.length) {
      return;
    }
    if (!authSession?.userId) {
      showToast("请先登录后上传服务器文件");
      return;
    }

    setIsAudioFilesLoading(true);
    setAudioFilesMessage("");
    setAudioImportReport(null);
    try {
      const latest = await refreshAudioFiles({ silent: true });
      const latestServerAudioSet = latest.ok && "serverAudioSet" in latest && latest.serverAudioSet ? latest.serverAudioSet : serverAudioSet;
      const limits = latest.ok && "limits" in latest && latest.limits ? latest.limits : audioFileLimits;
      const report = await buildAudioImportPreflight(selectedFiles, latestServerAudioSet, limits, audioFileArea);
      if (!report.items.length) {
        setAudioFilesMessage("文件夹中没有可检查的文件");
        return;
      }
      setAudioImportPreflight(report);
      setAudioFilesMessage(
        report.readyAudioCount > 0 || report.readyLyricCount > 0
          ? `预检完成：${getAudioPreflightUploadSummary(report)}`
          : "预检完成：没有可上传的文件"
      );
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
      setAudioFilesMessage("没有可上传的文件");
      return;
    }

    setIsAudioImporting(true);
    setAudioFilesMessage("");
    setAudioImportReport(null);
    extendAudioFileAccessDuringUpload(accessToken);
    beginAudioImportProgress(audioImportPreflight.totalUploadBytes);
    try {
      const uploadBatches = buildAudioImportUploadBatches(audioImportPreflight, audioFileLimits);
      const report = await importAudioBatches(authSession.userId, uploadBatches, accessToken, audioImportPreflight.totalUploadBytes);
      setAudioImportReport(report);
      setAudioImportPreflight(null);
      setAudioImportProgress(null);
      if ((report.lyrics_imported ?? 0) > 0 || report.imported > 0 || report.converted > 0) {
        clearTrackLyricsCache();
      }
      try {
        await refreshAudioFiles({ silent: true });
        await refreshLibrary({ keepExistingOnError: true });
        setAudioFilesMessage("导入完成，请查看结果报告");
      } catch (refreshError) {
        const refreshMessage = refreshError instanceof Error ? refreshError.message : "刷新音频列表失败";
        setAudioFilesMessage(`导入完成，但刷新列表失败：${refreshMessage}`);
      }
      showToast(`导入完成：歌曲 ${report.imported} 首，歌词 ${report.lyrics_imported ?? 0} 个，跳过 ${report.skipped} 个，失败 ${report.failed} 个`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "上传导入失败";
      setAudioImportReport(buildAudioImportFailureReport(uploadFiles, message));
      setAudioImportPreflight(null);
      setAudioImportProgress(null);
      setAudioFilesMessage("上传失败，请查看结果报告");
      showToast(message);
    } finally {
      setIsAudioImporting(false);
    }
  }

  async function importAudioBatches(userID: number, batches: AudioImportUploadBatch[], accessToken: string, totalUploadBytes: number) {
    if (!batches.length) {
      throw new Error("没有可上传的文件");
    }

    const reports: AudioFileImportReport[] = [];
    let uploadedBeforeBatch = 0;

    for (let index = 0; index < batches.length; index += 1) {
      const batch = batches[index];
      if (batches.length > 1) {
        setAudioFilesMessage(`正在上传第 ${index + 1} / ${batches.length} 批`);
      }
      extendAudioFileAccessDuringUpload(accessToken);

      try {
        const report = await importAudioFolder(userID, batch.files, accessToken, audioFileArea, (snapshot) => {
          updateAudioImportProgress(
            {
              loadedBytes: uploadedBeforeBatch + snapshot.loadedBytes,
              totalBytes: totalUploadBytes,
              lengthComputable: true
            },
            totalUploadBytes
          );
        });
        reports.push(report);
        extendAudioFileAccessDuringUpload(accessToken);
        uploadedBeforeBatch += batch.bytes;
        updateAudioImportProgress(
          {
            loadedBytes: uploadedBeforeBatch,
            totalBytes: totalUploadBytes,
            lengthComputable: true
          },
          totalUploadBytes
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "上传导入失败";
        reports.push(buildAudioImportFailureReport(batch.files, `第 ${index + 1} 批上传失败：${message}`));
        uploadedBeforeBatch += batch.bytes;
        updateAudioImportProgress(
          {
            loadedBytes: uploadedBeforeBatch,
            totalBytes: totalUploadBytes,
            lengthComputable: true
          },
          totalUploadBytes
        );
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          break;
        }
      }
    }

    return mergeAudioImportReports(reports);
  }

  function beginAudioImportProgress(totalBytes: number) {
    const now = Date.now();
    audioImportProgressLastPaintAtRef.current = now;
    audioImportProgressPreviousRef.current = { uploadedBytes: 0, capturedAt: now };
    setAudioImportProgress({
      uploadedBytes: 0,
      totalBytes,
      speedBytesPerSecond: 0
    });
  }

  function updateAudioImportProgress(snapshot: UploadProgressSnapshot, fallbackTotalBytes: number) {
    const now = Date.now();
    const totalBytes = Math.max(snapshot.totalBytes ?? fallbackTotalBytes, snapshot.loadedBytes, 0);
    const isComplete = totalBytes > 0 && snapshot.loadedBytes >= totalBytes;
    if (!isComplete && now - audioImportProgressLastPaintAtRef.current < 200) {
      return;
    }
    const previous = audioImportProgressPreviousRef.current;
    const deltaBytes = previous ? Math.max(0, snapshot.loadedBytes - previous.uploadedBytes) : 0;
    const deltaSeconds = previous ? Math.max((now - previous.capturedAt) / 1000, 0.1) : 0.1;
    audioImportProgressLastPaintAtRef.current = now;
    audioImportProgressPreviousRef.current = { uploadedBytes: snapshot.loadedBytes, capturedAt: now };
    setAudioImportProgress({
      uploadedBytes: snapshot.loadedBytes,
      totalBytes,
      speedBytesPerSecond: deltaBytes / deltaSeconds
    });
  }

  function openAudioFileMenu(track: ServerManagedFile, clientX: number, clientY: number) {
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

  function handleAudioFileContextMenu(event: ReactMouseEvent<HTMLElement>, track: ServerManagedFile) {
    event.preventDefault();
    openAudioFileMenu(track, event.clientX, event.clientY);
  }

  function openAudioRenameDialog(track: ServerManagedFile) {
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
      if (target.kind === "lyrics") {
        await renameLyricsFile({
          user_id: authSession.userId,
          relative_path: target.relative_path,
          artist,
          title
        }, accessToken, target.area);
      } else {
        const trackID = target.track_id ?? Number(target.id);
        await renameAudioFile(trackID, {
          user_id: authSession.userId,
          artist,
          title
        }, accessToken, target.area);
      }
      setAudioRenameDraft(null);
      if (target.kind === "lyrics") {
        clearTrackLyricsCache();
      } else if (target.track_id) {
        clearTrackLyricsCache(target.track_id);
      }
      await refreshAudioFiles({ silent: true });
      await refreshLibrary({ keepExistingOnError: true });
      showToast("文件已重命名");
    } catch (error) {
      setAudioRenameDraft((draft) => (draft ? { ...draft, isSubmitting: false } : draft));
      showToast(error instanceof Error ? error.message : "重命名失败");
    }
  }

  function openAudioDeleteDialog(track: ServerManagedFile) {
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
      if (target.kind === "lyrics") {
        await deleteLyricsFile(authSession.userId, target.relative_path, accessToken, target.area);
      } else {
        await deleteAudioFile(authSession.userId, target.track_id ?? Number(target.id), accessToken, target.area);
      }
      setAudioDeleteTarget(null);
      if (target.kind === "lyrics") {
        clearTrackLyricsCache();
      } else if (target.track_id) {
        clearTrackLyricsCache(target.track_id);
      }
      await refreshAudioFiles({ silent: true });
      await refreshLibrary({ keepExistingOnError: true });
      await refreshTrackMemberships();
      showToast(target.kind === "lyrics" ? "歌词文件已删除" : "音频文件已删除");
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

  function revealCurrentTrackInMusicList() {
    shouldRevealCurrentTrackRef.current = true;
  }

  function applyPlaybackSession(response: PlaybackSessionResponse) {
    const expiresAt = Date.parse(response.expires_at);
    setPlaybackSession({
      token: response.token,
      expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now() + playbackHeartbeatIntervalMs,
      trackID: response.track_id,
      state: response.state
    });
  }

  function broadcastPlaybackClaim() {
    if (!authSession?.userId) {
      return;
    }
    playbackBroadcastRef.current?.postMessage({
      type: "playback-claimed",
      userId: authSession.userId,
      tabId: playbackTabIdRef.current
    });
    if (!playbackBroadcastRef.current) {
      writeLocalStorage(playbackBroadcastStorageKey, JSON.stringify({
        type: "playback-claimed",
        userId: authSession.userId,
        tabId: playbackTabIdRef.current,
        sentAt: Date.now()
      }));
    }
  }

  function handlePlaybackTakenOver(message = "音乐已在其它设备或页面播放") {
    const wasActive = Boolean(isPlaying || isAudioLoading || playbackSession?.token);
    playbackRequestIdRef.current += 1;
    setPlaybackSession(null);
    playbackIntentRef.current = false;
    ignoreAudioPauseUntilRef.current = 0;
    setIsAudioLoading(false);
    setIsPlaying(false);
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
    }
    if (wasActive) {
      showToast(message);
    }
  }

  async function ensurePlaybackSessionForTrack(track: Track, { allowTakeover = true }: { allowTakeover?: boolean } = {}) {
    if (!authSession?.userId) {
      showToast("请先登录后播放音乐");
      return false;
    }
    if (!track.stream_url) {
      return false;
    }

    const deviceID = playbackDeviceIdRef.current ?? readPlaybackDeviceID();
    const tabID = playbackTabIdRef.current ?? createPlaybackTabID();
    playbackDeviceIdRef.current = deviceID;
    playbackTabIdRef.current = tabID;

    if (playbackSession?.token && playbackSession.expiresAt - Date.now() > playbackSessionRefreshWindowMs) {
      try {
        const response = await heartbeatPlaybackSession({
          token: playbackSession.token,
          track_id: track.id,
          device_id: deviceID,
          tab_id: tabID,
          state: "playing"
        });
        applyPlaybackSession(response);
        return true;
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 409) {
          showToast(error instanceof Error ? error.message : "播放会话续期失败");
          return false;
        }
        setPlaybackSession(null);
        if (!allowTakeover) {
          handlePlaybackTakenOver();
          return false;
        }
      }
    }

    try {
      const response = await claimPlaybackSession({
        track_id: track.id,
        device_id: deviceID,
        tab_id: tabID,
        device_name: getPlaybackDeviceName()
      });
      applyPlaybackSession(response);
      broadcastPlaybackClaim();
      return true;
    } catch (error) {
      showToast(error instanceof Error ? error.message : "申请播放权失败");
      return false;
    }
  }

  async function sendPlaybackHeartbeat(state: "playing" | "paused") {
    if (!authSession?.userId || !playbackSession?.token) {
      return false;
    }
    try {
      const response = await heartbeatPlaybackSession({
        token: playbackSession.token,
        track_id: currentTrack?.id,
        device_id: playbackDeviceIdRef.current ?? readPlaybackDeviceID(),
        tab_id: playbackTabIdRef.current ?? createPlaybackTabID(),
        state
      });
      applyPlaybackSession(response);
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        handlePlaybackTakenOver();
        return false;
      }
      if (state === "playing") {
        showToast(error instanceof Error ? error.message : "播放会话续期失败");
      }
      return false;
    }
  }

  function releaseCurrentPlaybackSession() {
    const token = playbackSession?.token;
    setPlaybackSession(null);
    if (token) {
      void releasePlaybackSession(token).catch(() => undefined);
    }
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
      cacheFavoriteTracks([], payload.category.id);
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
      invalidateFavoriteTrackCache({ categoryId: category.id });
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
      const matchedTracks = filterTracksForRole(libraryTracks, authSession?.role).filter((track) => trackMatchesQuery(track, keyword));
      if (!matchedTracks.length) {
        showToast("音乐不存在");
        return;
      }

      setTracks(matchedTracks);
      setLoadMessage("");
      setIsLibraryFiltered(true);
      setIsSearchOpen(false);
      setSearchDialogPosition(null);
      setActiveTab(getDefaultMusicTab(authSession?.role));
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
    setIsEqualizerOpen(false);
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
    setIsEqualizerOpen(false);
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
        invalidateFavoriteTrackCache({ favorites: true, allCategories: true });
        showToast("已取消收藏");
      } else {
        await addFavoriteTrack({ user_id: authSession.userId, track_id: track.id });
        appendTrackToFavoritePlaybackQueue(track);
        invalidateFavoriteTrackCache({ favorites: true });
        showToast("已收藏");
      }
      if (activeTab === "收藏" || activeTab === "分类" || playbackQueueScope.kind === "favorites") {
        void refreshFavoriteTracks({
          showList: activeTab === "收藏" || activeTab === "分类",
          categoryId: activeTab === "分类" ? activeCategoryId : undefined,
          force: true
        });
      }
      void refreshTrackMemberships();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "收藏操作失败");
      void refreshTrackMemberships();
      void refreshFavoriteTracks({
        showList: activeTab === "收藏" || activeTab === "分类",
        categoryId: activeTab === "分类" ? activeCategoryId : undefined,
        force: true
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
      invalidateFavoriteTrackCache({ favorites: true, categoryId: category.id });
      upsertTrackCategoryMembership(track.id, category);
      appendTrackToCategoryPlaybackQueue(track, category.id);
      if (
        (activeTab === "分类" && activeCategoryId === category.id) ||
        (playbackQueueScope.kind === "category" && playbackQueueScope.categoryId === category.id)
      ) {
        void refreshFavoriteTracks({ showList: activeTab === "分类" && activeCategoryId === category.id, categoryId: category.id, force: true });
      }
      showToast(`已加入${category.name}`);
      void refreshTrackMemberships();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "加入分类失败");
      void refreshTrackMemberships();
      void refreshFavoriteTracks({
        showList: activeTab === "收藏" || activeTab === "分类",
        categoryId: activeTab === "分类" ? activeCategoryId : undefined,
        force: true
      });
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
      invalidateFavoriteTrackCache({ categoryId: activeCategoryId });
      showToast("已移出分类");
      void refreshFavoriteTracks({ showList: true, categoryId: activeCategoryId, force: true });
      void refreshTrackMemberships();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "移出分类失败");
      void refreshTrackMemberships();
      void refreshFavoriteTracks({ showList: true, categoryId: activeCategoryId, force: true });
    }
  }

  function playTrack(track: Track) {
    void startTrackPlayback(track, {
      queue: tracks.length ? tracks : [track],
      scope: getActivePlaybackQueueScope(),
      allowTakeover: true
    });
  }

  function playTrackFromQueue(track: Track, { allowTakeover = true }: { allowTakeover?: boolean } = {}) {
    void startTrackPlayback(track, {
      reveal: true,
      allowTakeover
    });
  }

  async function startTrackPlayback(
    track: Track,
    {
      queue,
      scope,
      reveal = false,
      allowTakeover = true
    }: { queue?: Track[]; scope?: PlaybackQueueScope; reveal?: boolean; allowTakeover?: boolean } = {}
  ) {
    const requestID = playbackRequestIdRef.current + 1;
    playbackRequestIdRef.current = requestID;
    clearPendingTrackPlay();
    setDetachedCurrentTrack(null);
    if (queue) {
      setPlaybackQueue(queue);
    }
    if (scope) {
      setPlaybackQueueScope(scope);
    }
    if (reveal) {
      revealCurrentTrackInMusicList();
    }
    setCurrentTrackId(track.id);

    if (!track.stream_url) {
      setIsAudioLoading(false);
      setIsPlaying(false);
      return;
    }

    setIsAudioLoading(true);
    setIsPlaying(false);
    const canPlay = await ensurePlaybackSessionForTrack(track, { allowTakeover });
    if (playbackRequestIdRef.current !== requestID) {
      return;
    }
    if (!canPlay) {
      setIsAudioLoading(false);
      setIsPlaying(false);
      return;
    }
    prepareEqualizerForPlayback();
    setIsAudioLoading(true);
    setIsPlaying(true);
  }

  function togglePlay() {
    clearPendingTrackPlay();
    const trackToPlay = currentTrack ?? playbackQueue[0] ?? tracks[0] ?? null;
    if (!trackToPlay) {
      setIsPlaying(false);
      return;
    }
    if (isPlaying) {
      playbackIntentRef.current = false;
      setIsAudioLoading(false);
      setIsPlaying(false);
      void sendPlaybackHeartbeat("paused");
      return;
    }
    const queue = !currentTrack && !playbackQueue.length && tracks.length ? tracks : undefined;
    void startTrackPlayback(trackToPlay, {
      queue,
      scope: queue ? getActivePlaybackQueueScope() : undefined,
      allowTakeover: true
    });
  }

  function stepTrack(direction: 1 | -1, { allowTakeover = true }: { allowTakeover?: boolean } = {}) {
    const nextTrack = getAdjacentQueuedTrack(direction);
    if (!nextTrack) {
      clearDetachedPlayback();
      return;
    }
    if (direction === 1 && playbackMode === "shuffle") {
      playRandomTrack({ allowTakeover });
      return;
    }
    playTrackFromQueue(nextTrack, { allowTakeover });
  }

  function playRandomTrack({ allowTakeover = true }: { allowTakeover?: boolean } = {}) {
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
    playTrackFromQueue(randomCandidates[nextIndex], { allowTakeover });
  }

  function selectPlaybackMode(mode: PlaybackMode) {
    setPlaybackMode(mode);
    setIsPlaybackModeMenuOpen(false);
  }

  function toggleEqualizerPanel() {
    setIsPlaybackModeMenuOpen(false);
    setIsEqualizerOpen((value) => !value);
  }

  function ensureEqualizerAudioChain(audio = audioRef.current) {
    if (!audio || typeof window === "undefined") {
      return null;
    }
    const existingChain = equalizerChainRef.current;
    if (existingChain?.audio === audio) {
      return existingChain.context;
    }

    const AudioContextConstructor =
      window.AudioContext ?? (window as BrowserWindowWithAudioContext).webkitAudioContext;
    if (!AudioContextConstructor) {
      return null;
    }

    try {
      const context = new AudioContextConstructor();
      const source = context.createMediaElementSource(audio);
      const filters = equalizerBands.map((band) => {
        const filter = context.createBiquadFilter();
        filter.type = band.filterType;
        filter.frequency.value = band.frequency;
        filter.Q.value = band.q;
        filter.gain.value = equalizerGains[band.id];
        return filter;
      });
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.82;

      source.connect(filters[0]);
      for (let index = 0; index < filters.length - 1; index += 1) {
        filters[index].connect(filters[index + 1]);
      }
      filters[filters.length - 1].connect(analyser);
      analyser.connect(context.destination);
      equalizerChainRef.current = { audio, context, source, filters, analyser };
      applyEqualizerGains(equalizerGains, true);
      return context;
    } catch {
      return null;
    }
  }

  function disconnectEqualizerAudioChain() {
    const chain = equalizerChainRef.current;
    if (!chain) {
      return;
    }
    try {
      chain.source.disconnect();
      chain.filters.forEach((filter) => filter.disconnect());
      chain.analyser.disconnect();
    } catch {
      // Disconnection can throw after browser-side audio teardown.
    }
    void chain.context.close().catch(() => undefined);
    equalizerChainRef.current = null;
  }

  function stopLyricsVisualizer(reset = true) {
    if (lyricsVisualizerFrameRef.current !== null) {
      window.cancelAnimationFrame(lyricsVisualizerFrameRef.current);
      lyricsVisualizerFrameRef.current = null;
    }
    lyricsVisualizerLastPaintAtRef.current = 0;
    if (reset) {
      lyricsVisualizerStateRef.current = emptyLyricsVisualizerState;
      setLyricsVisualizer(emptyLyricsVisualizerState);
    }
  }

  function clearCurrentTimeCommitTimer() {
    if (currentTimeCommitTimerRef.current === null) {
      return;
    }
    window.clearTimeout(currentTimeCommitTimerRef.current);
    currentTimeCommitTimerRef.current = null;
  }

  function commitCurrentTime(nextTime: number) {
    clearCurrentTimeCommitTimer();
    currentTimeRef.current = nextTime;
    currentTimeLastCommittedAtRef.current = performance.now();
    setCurrentTime(nextTime);
  }

  function syncCurrentTimeFromAudio(nextTime: number, force = false) {
    currentTimeRef.current = nextTime;
    if (force) {
      commitCurrentTime(nextTime);
      return;
    }
    const now = performance.now();
    const elapsed = now - currentTimeLastCommittedAtRef.current;
    if (elapsed >= currentTimeCommitIntervalMs || currentTimeLastCommittedAtRef.current === 0) {
      commitCurrentTime(nextTime);
      return;
    }
    if (currentTimeCommitTimerRef.current !== null) {
      return;
    }
    currentTimeCommitTimerRef.current = window.setTimeout(() => {
      currentTimeCommitTimerRef.current = null;
      commitCurrentTime(currentTimeRef.current);
    }, currentTimeCommitIntervalMs - elapsed);
  }

  function applyEqualizerGains(gains: EqualizerGains, immediate = false) {
    const chain = equalizerChainRef.current;
    if (!chain) {
      return;
    }
    equalizerBands.forEach((band, index) => {
      const filter = chain.filters[index];
      if (!filter) {
        return;
      }
      const gain = clampEqualizerGain(gains[band.id]);
      if (immediate) {
        filter.gain.setValueAtTime(gain, chain.context.currentTime);
        return;
      }
      filter.gain.setTargetAtTime(gain, chain.context.currentTime, equalizerSmoothingTime);
    });
  }

  function prepareEqualizerForPlayback() {
    const context = ensureEqualizerAudioChain();
    if (context?.state === "suspended") {
      void context.resume().catch(() => undefined);
    }
  }

  function setEqualizerBandGain(bandId: EqualizerBandId, gain: number) {
    const nextGain = clampEqualizerGain(gain);
    setEqualizerGains((previous) => {
      if (previous[bandId] === nextGain) {
        return previous;
      }
      return { ...previous, [bandId]: nextGain };
    });
  }

  function handleEqualizerGainChange(bandId: EqualizerBandId, value: string) {
    setEqualizerBandGain(bandId, Number(value));
  }

  function getEqualizerGainFromPointer(event: ReactPointerEvent<HTMLSpanElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.height) {
      return 0;
    }
    const ratio = Math.min(1, Math.max(0, 1 - (event.clientY - rect.top) / rect.height));
    return equalizerGainMin + ratio * (equalizerGainMax - equalizerGainMin);
  }

  function focusEqualizerInput(event: ReactPointerEvent<HTMLSpanElement>) {
    event.currentTarget.querySelector("input")?.focus();
  }

  function handleEqualizerPointerDown(event: ReactPointerEvent<HTMLSpanElement>, bandId: EqualizerBandId) {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    equalizerPointerRef.current = { pointerId: event.pointerId, bandId };
    focusEqualizerInput(event);
    setEqualizerBandGain(bandId, getEqualizerGainFromPointer(event));
  }

  function handleEqualizerPointerMove(event: ReactPointerEvent<HTMLSpanElement>, bandId: EqualizerBandId) {
    const activePointer = equalizerPointerRef.current;
    if (!activePointer || activePointer.pointerId !== event.pointerId || activePointer.bandId !== bandId) {
      return;
    }
    event.preventDefault();
    setEqualizerBandGain(bandId, getEqualizerGainFromPointer(event));
  }

  function clearEqualizerPointer(event: ReactPointerEvent<HTMLSpanElement>) {
    const activePointer = equalizerPointerRef.current;
    if (!activePointer || activePointer.pointerId !== event.pointerId) {
      return;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    equalizerPointerRef.current = null;
  }

  function selectEqualizerPreset(gains: EqualizerGains) {
    setEqualizerGains(gains);
  }

  function handleEnded() {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (playbackMode === "one" && isCurrentTrackQueued()) {
      audio.currentTime = 0;
      prepareEqualizerForPlayback();
      void audio.play();
      return;
    }
    if (playbackMode === "shuffle") {
      playRandomTrack({ allowTakeover: false });
      return;
    }
    stepTrack(1, { allowTakeover: false });
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
    commitCurrentTime(clampedTime);
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

  function clearLyricsChromeTimer() {
    if (!lyricsChromeTimerRef.current) {
      return;
    }
    window.clearTimeout(lyricsChromeTimerRef.current);
    lyricsChromeTimerRef.current = null;
  }

  function scheduleLyricsChromeHide() {
    if (activePage !== "lyrics") {
      return;
    }
    clearLyricsChromeTimer();
    lyricsChromeTimerRef.current = window.setTimeout(() => {
      setIsLyricsChromeVisible(false);
      lyricsChromeTimerRef.current = null;
    }, lyricsChromeAutoHideMs);
  }

  function revealLyricsChrome() {
    if (activePage !== "lyrics") {
      return;
    }
    setIsLyricsChromeVisible(true);
    scheduleLyricsChromeHide();
  }

  const activeCategory = favoriteCategories.find((category) => category.id === activeCategoryId) ?? null;
  const emptyMessage = loadMessage || (activeTab === "收藏" ? "暂无收藏歌曲" : activeTab === "分类" ? "暂无分类歌曲" : activeTab === "轻音乐" ? "暂无轻音乐" : "暂无高品质");
  const isAuthVisible = !authSession;
  const canSubmitAuth = !isAuthSubmitting && isAuthFormReady(authForm);
  const canCurrentUserPlayLossless = canRolePlayLossless(authSession?.role);
  const playingTrackId = isPlaying ? currentTrack?.id ?? null : null;
  const activeMenuTrack = trackContextMenu?.track ?? null;
  const isActiveMenuTrackFavorite = activeMenuTrack ? favoriteTrackIds.has(activeMenuTrack.id) : false;
  const activeEqualizerPresetId = getEqualizerPresetId(equalizerGains);
  const isViewingActiveCategory = activeTab === "分类" && Boolean(activeCategory);
  const lyricLines = trackLyrics?.lines ?? [];
  const activeLyricIndex = getActiveLyricIndex(lyricLines, currentTime);
  const canSortMusicColumns = isLibraryMusicTab(activeTab);
  const canShowTrackStatus = isLibraryMusicTab(activeTab) || activeTab === "收藏" || activeTab === "分类";
  const statusCategory = activeTab === "分类" ? activeCategory : null;
  const isLyricsPageActive = activePage === "lyrics";
  const playerScreenClassName = [
    "player-screen",
    isLyricsPageActive ? "lyrics-page-active" : "",
    isLyricsPageActive && isLyricsChromeVisible ? "lyrics-chrome-visible" : "",
    isLyricsPageActive && !isLyricsChromeVisible ? "lyrics-chrome-hidden" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <main
      className={playerScreenClassName}
      aria-label="MediaPlayer"
      onPointerMove={revealLyricsChrome}
      onPointerDown={revealLyricsChrome}
      onWheel={revealLyricsChrome}
    >
      <div className="top-line" />
      <section className="app-page-area" aria-label="当前页面">
        {activePage === "music" ? (
          <section className="music-page" aria-label="音乐">
            <nav className="mode-tabs" aria-label="播放器视图">
              {canCurrentUserPlayLossless ? (
                <button
                  className={activeTab === "高品质" ? "active" : ""}
                  type="button"
                  aria-current={activeTab === "高品质" ? "page" : undefined}
                  aria-label={isManualLibraryRefreshing ? "正在刷新高品质" : "刷新高品质"}
                  title={manualLibraryRefreshRemainingMs > 0 ? `${manualLibraryRefreshCooldownSeconds}秒后可刷新高品质` : "刷新高品质"}
                  disabled={isManualLibraryRefreshing}
                  onClick={() => void handleLibraryTabClick()}
                >
                  高品质
                </button>
              ) : null}
              <button className={activeTab === "轻音乐" ? "active" : ""} type="button" aria-current={activeTab === "轻音乐" ? "page" : undefined} onClick={() => handleTabClick("轻音乐")}>
                轻音乐
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
              <button
                className={`fullscreen-toggle ${isFullscreen ? "active" : ""}`}
                type="button"
                aria-label={isFullscreen ? "退出全屏" : "进入全屏"}
                aria-pressed={isFullscreen}
                title={isFullscreen ? "退出全屏" : "进入全屏"}
                disabled={!isFullscreenSupported}
                onClick={() => void toggleFullscreen()}
              >
                <FullscreenIcon active={isFullscreen} />
              </button>
            </nav>

            <section className={`song-table ${canShowTrackStatus ? "with-status" : ""}`} aria-label="本地高品质列表" aria-busy={isLoading}>
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
                    {isLoading ? (activeTab === "收藏" ? "正在加载收藏歌曲" : activeTab === "分类" ? "正在加载分类歌曲" : activeTab === "轻音乐" ? "正在加载轻音乐" : "正在加载高品质") : emptyMessage}
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
                <button
                  className={`play-toggle ${isAudioLoading ? "is-loading" : ""}`}
                  type="button"
                  aria-label={isPlaying ? "暂停" : "播放"}
                  aria-busy={isAudioLoading ? "true" : undefined}
                  onClick={togglePlay}
                >
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
                <div className="equalizer-picker">
                  <button
                    className={`equalizer-button ${isEqualizerOpen ? "active" : ""}`}
                    type="button"
                    aria-label="音乐均衡器"
                    aria-haspopup="dialog"
                    aria-expanded={isEqualizerOpen}
                    title="音乐均衡器"
                    onClick={toggleEqualizerPanel}
                  >
                    <EqualizerIcon />
                  </button>
                  {isEqualizerOpen ? (
                    <>
                      <button className="equalizer-menu-scrim" type="button" aria-label="关闭均衡器" onClick={() => setIsEqualizerOpen(false)} />
                      <div className="equalizer-panel" role="dialog" aria-label="音乐均衡器" onPointerDown={(event) => event.stopPropagation()}>
                        <div className="equalizer-panel-header">
                          <span>音乐均衡器</span>
                          <strong>{activeEqualizerPresetId === "custom" ? "自定义" : equalizerPresets.find((preset) => preset.id === activeEqualizerPresetId)?.label}</strong>
                        </div>
                        <div className="equalizer-presets" role="group" aria-label="均衡器预设">
                          {equalizerPresets.map((preset) => (
                            <button
                              key={preset.id}
                              className={preset.id === activeEqualizerPresetId ? "active" : ""}
                              type="button"
                              aria-pressed={preset.id === activeEqualizerPresetId}
                              onClick={() => selectEqualizerPreset(preset.gains)}
                            >
                              {preset.label}
                            </button>
                          ))}
                        </div>
                        <div className="equalizer-bands">
                          {equalizerBands.map((band) => (
                            <label key={band.id} className="equalizer-band">
                              <span className="equalizer-band-value">{formatEqualizerGain(equalizerGains[band.id])}</span>
                              <span
                                className="equalizer-slider-wrap"
                                style={{ "--eq-level": `${getEqualizerLevelPercent(equalizerGains[band.id])}%` } as CSSProperties}
                                onPointerDown={(event) => handleEqualizerPointerDown(event, band.id)}
                                onPointerMove={(event) => handleEqualizerPointerMove(event, band.id)}
                                onPointerUp={clearEqualizerPointer}
                                onPointerCancel={clearEqualizerPointer}
                                onLostPointerCapture={clearEqualizerPointer}
                              >
                                <span className="equalizer-slider-track" aria-hidden="true" />
                                <span className="equalizer-slider-fill" aria-hidden="true" />
                                <span className="equalizer-slider-thumb" aria-hidden="true" />
                                <input
                                  className="equalizer-slider-input"
                                  type="range"
                                  min={equalizerGainMin}
                                  max={equalizerGainMax}
                                  step={equalizerGainStep}
                                  value={equalizerGains[band.id]}
                                  aria-label={`${band.name} ${band.label}`}
                                  onChange={(event) => handleEqualizerGainChange(band.id, event.target.value)}
                                />
                              </span>
                              <span className="equalizer-band-name">{band.name}</span>
                              <span className="equalizer-band-frequency">{band.label}</span>
                            </label>
                          ))}
                        </div>
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
          <MemoizedFullLyricsPage
            status={lyricsStatus}
            currentTrack={currentTrack}
            lines={lyricLines}
            activeLineIndex={activeLyricIndex}
            visualizer={lyricsVisualizer}
            isPlaying={isPlaying}
            savedScroll={lyricsScrollStateRef.current}
            onScrollPositionChange={updateLyricsScrollPosition}
            onToggleFullscreen={toggleFullscreen}
          />
        ) : activePage === "profile" ? (
          <EmptyPage
            page={activePage}
            authSession={authSession}
            sleepTimerMinutes={sleepTimerMinutes}
            sleepTimerRemainingSeconds={sleepTimerRemainingSeconds}
            onlineCount={onlineCount}
            onlineUsers={onlineUsers}
            onSetSleepTimerMinutes={handleSetSleepTimerMinutes}
            onStartSleepTimer={handleStartSleepTimer}
            onStopSleepTimer={handleStopSleepTimer}
            profileView={profileView}
            onProfileViewChange={setProfileView}
            audioFileArea={audioFileArea}
            audioFiles={audioFiles}
            audioFileLimits={audioFileLimits}
            audioFilesMessage={audioFilesMessage}
            audioImportReport={audioImportReport}
            audioImportPreflight={audioImportPreflight}
            audioImportProgress={audioImportProgress}
            managedUsers={managedUsers}
            managedUsersMessage={managedUsersMessage}
            managedUserForm={managedUserForm}
            managedUserDeleteTarget={managedUserDeleteTarget}
            isAudioFilesLoading={isAudioFilesLoading}
            isAudioImporting={isAudioImporting}
            isManagedUsersLoading={isManagedUsersLoading}
            isManagedUserSubmitting={isManagedUserSubmitting}
            isManagedUserDeleting={isManagedUserDeleting}
            audioFileMenu={audioFileMenu}
            audioRenameDraft={audioRenameDraft}
            audioDeleteTarget={audioDeleteTarget}
            audioFolderInputRef={audioFolderInputRef}
            onOpenAudioFileManager={openAudioFileManager}
            onCloseAudioFileManager={closeAudioFileManager}
            onOpenUserManager={openUserManager}
            onRefreshManagedUsers={() => void refreshManagedUsers()}
            onUpdateManagedUserForm={updateManagedUserForm}
            onSubmitManagedUser={submitManagedUser}
            onChangeManagedUserRole={(user, role) => void changeManagedUserRole(user, role)}
            onOpenManagedUserDelete={openManagedUserDelete}
            onCloseManagedUserDelete={closeManagedUserDelete}
            onConfirmManagedUserDelete={() => void confirmManagedUserDelete()}
            onChooseAudioFolder={handleChooseAudioFolder}
            onAudioFolderChange={handleAudioFolderChange}
            onConfirmAudioImportPreflight={() => void confirmAudioImportPreflight()}
            onCloseAudioImportPreflight={() => setAudioImportPreflight(null)}
            onCloseAudioImportReport={() => setAudioImportReport(null)}
            onRefreshAudioFiles={() => void refreshAudioFiles()}
            onAudioFileAreaChange={changeAudioFileArea}
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
        ) : null}
        <section className="preserved-page-slot" hidden={activePage !== "discover"} aria-hidden={activePage !== "discover"}>
          <MemoizedGrowthNotesPage authSession={authSession} />
        </section>
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
        preload="auto"
        onLoadStart={() => {
          if (playbackIntentRef.current) {
            setIsAudioLoading(true);
          }
        }}
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
        onCanPlay={(event) => {
          updateBufferedRanges(event.currentTarget);
          setIsAudioLoading(false);
        }}
        onCanPlayThrough={(event) => {
          updateBufferedRanges(event.currentTarget);
          setIsAudioLoading(false);
        }}
        onWaiting={() => {
          if (playbackIntentRef.current) {
            setIsAudioLoading(true);
          }
        }}
        onStalled={() => {
          if (playbackIntentRef.current) {
            setIsAudioLoading(true);
          }
        }}
        onTimeUpdate={(event) => {
          syncCurrentTimeFromAudio(event.currentTarget.currentTime);
        }}
        onPlay={() => {
          playbackIntentRef.current = true;
          setIsPlaying(true);
        }}
        onPlaying={() => {
          ignoreAudioPauseUntilRef.current = 0;
          playbackIntentRef.current = true;
          setIsAudioLoading(false);
          setIsPlaying(true);
        }}
        onPause={() => {
          if (playbackIntentRef.current && Date.now() < ignoreAudioPauseUntilRef.current) {
            return;
          }
          const audio = audioRef.current;
          const hasPlayableRemainder =
            Boolean(audio && currentTrackStreamURL && !audio.ended && audio.currentTime < Math.max(0, activeDuration - 0.75));
          if (playbackIntentRef.current && hasPlayableRemainder) {
            const playRequestId = audioPlayRequestIdRef.current + 1;
            audioPlayRequestIdRef.current = playRequestId;
            window.setTimeout(() => {
              const currentAudio = audioRef.current;
              if (!currentAudio || audioPlayRequestIdRef.current !== playRequestId || !playbackIntentRef.current || !currentAudio.paused) {
                return;
              }
              prepareEqualizerForPlayback();
              void currentAudio.play().catch((error) => {
                if (audioPlayRequestIdRef.current !== playRequestId) {
                  return;
                }
                const errorName = error instanceof Error ? error.name : "";
                if (errorName === "AbortError") {
                  return;
                }
                playbackIntentRef.current = false;
                setIsAudioLoading(false);
                setIsPlaying(false);
              });
            }, unexpectedPauseResumeDelayMs);
            return;
          }
          playbackIntentRef.current = false;
          setIsAudioLoading(false);
          setIsPlaying(false);
        }}
        onError={() => {
          playbackIntentRef.current = false;
          setIsAudioLoading(false);
          setIsPlaying(false);
        }}
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

function isLibraryMusicTab(tab: MusicTab) {
  return tab === "高品质" || tab === "轻音乐";
}

function getTrackQuality(track: Track) {
  if (track.quality === "lossless" || track.quality === "lossy") {
    return track.quality;
  }
  const format = normalizeAudioExtension(track.format || getFileExtension(track.filename));
  return lossyMusicFormats.has(format) ? "lossy" : "lossless";
}

function isLosslessMusicTrack(track: Track) {
  return getTrackQuality(track) === "lossless";
}

function isLossyMusicTrack(track: Track) {
  return getTrackQuality(track) === "lossy";
}

function filterTracksForRole(tracks: Track[], role?: UserRole | null) {
  return canRolePlayLossless(role) ? tracks : tracks.filter(isLossyMusicTrack);
}

function getLibraryTracksForTab(tab: MusicTab, tracks: Track[], sortKey: TrackSortKey | null) {
  const filteredTracks = tab === "轻音乐" ? tracks.filter(isLossyMusicTrack) : tracks.filter(isLosslessMusicTrack);
  return sortMusicTracks(filteredTracks, sortKey);
}

function sortFavoriteCategories(categories: FavoriteCategory[]) {
  return [...categories].sort((left, right) => {
    if (left.sort_order !== right.sort_order) {
      return left.sort_order - right.sort_order;
    }
    return left.id - right.id;
  });
}

function sortManagedUsers(users: ManagedUser[]) {
  return [...users].sort((left, right) => left.id - right.id);
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
      track.quality === nextTrack.quality &&
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

type FullLyricsPageProps = {
  status: LyricsStatus;
  currentTrack: Track | null;
  lines: LyricLine[];
  activeLineIndex: number;
  visualizer: LyricsVisualizerState;
  isPlaying: boolean;
  savedScroll: LyricsScrollState;
  onScrollPositionChange: (trackID: number, top: number, activeLineIndex: number) => void;
  onToggleFullscreen: () => void | Promise<void>;
};

function FullLyricsPage({
  status,
  currentTrack,
  lines,
  activeLineIndex,
  visualizer,
  isPlaying,
  savedScroll,
  onScrollPositionChange,
  onToggleFullscreen
}: FullLyricsPageProps) {
  const activeLineRef = useRef<HTMLParagraphElement | null>(null);
  const lyricsListRef = useRef<HTMLDivElement | null>(null);
  const initialSyncedLineIndexRef = useRef<number | null>(null);
  const ignoreScrollRef = useRef(false);
  const ignoreScrollTimerRef = useRef<number | null>(null);
  const followResumeTimerRef = useRef<number | null>(null);
  const lyricsTapStartRef = useRef<{ pointerId: number; x: number; y: number; at: number } | null>(null);
  const lastLyricsTapRef = useRef<{ x: number; y: number; at: number } | null>(null);
  const lyricsFullscreenLockUntilRef = useRef(0);
  const userScrollPausedUntilRef = useRef(0);
  const [isUserBrowsingLyrics, setIsUserBrowsingLyrics] = useState(false);
  const scenePalette = useMemo(() => getLyricsScenePalette(currentTrack), [currentTrack?.album, currentTrack?.artist, currentTrack?.id, currentTrack?.title]);
  const coverImageURL = currentTrack?.cover_url ? coverURL(currentTrack) : "";
  const coverImageStyle = useMemo(
    () =>
      ({
        backgroundImage: coverImageURL ? `url("${coverImageURL.replace(/"/g, '\\"')}")` : undefined
      }) as CSSProperties,
    [coverImageURL]
  );
  const lyricsPaletteStyle = useMemo(
    () =>
      ({
        "--lyrics-surface": scenePalette.surface,
        "--lyrics-tone-a": scenePalette.toneA,
        "--lyrics-tone-b": scenePalette.toneB,
        "--lyrics-tone-c": scenePalette.toneC,
        "--lyrics-thread": scenePalette.thread
      }) as CSSProperties,
    [scenePalette]
  );
  const sceneMotionStyle = useMemo(
    () =>
      ({
        "--lyrics-bass": visualizer.bass.toFixed(3),
        "--lyrics-mid": visualizer.mid.toFixed(3),
        "--lyrics-treble": visualizer.treble.toFixed(3),
        "--lyrics-energy": visualizer.energy.toFixed(3),
        "--lyrics-field-opacity": (0.54 + visualizer.energy * 0.2).toFixed(3),
        "--lyrics-field-breath": (1 + visualizer.bass * 0.05).toFixed(3),
        "--lyrics-thread-opacity": (0.14 + visualizer.mid * 0.24).toFixed(3),
        "--lyrics-glint-opacity": (0.08 + visualizer.treble * 0.22).toFixed(3),
        "--lyrics-horizon-opacity": (0.2 + visualizer.bass * 0.26).toFixed(3),
        "--lyrics-depth-opacity": (0.26 + visualizer.energy * 0.18).toFixed(3),
        "--lyrics-active-glow": `${18 + visualizer.energy * 18}px`,
        "--lyrics-active-halo": `${48 + visualizer.mid * 32}px`,
        "--lyrics-active-warmth": (0.1 + visualizer.treble * 0.18).toFixed(3)
      }) as CSSProperties,
    [visualizer]
  );

  useEffect(() => {
    return () => {
      if (ignoreScrollTimerRef.current) {
        window.clearTimeout(ignoreScrollTimerRef.current);
      }
      if (followResumeTimerRef.current) {
        window.clearTimeout(followResumeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    userScrollPausedUntilRef.current = 0;
    setIsUserBrowsingLyrics(false);
    if (followResumeTimerRef.current) {
      window.clearTimeout(followResumeTimerRef.current);
      followResumeTimerRef.current = null;
    }
  }, [currentTrack?.id]);

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
      syncActiveLyricIntoView("auto");
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
    syncActiveLyricIntoView(shouldReduceMotion() ? "auto" : "smooth");
  }, [activeLineIndex, currentTrack?.id]);

  function syncActiveLyricIntoView(behavior: ScrollBehavior) {
    const lyricsList = lyricsListRef.current;
    const activeLine = activeLineRef.current;
    if (!currentTrack || activeLineIndex < 0 || !lyricsList || !activeLine) {
      return;
    }
    const listRect = lyricsList.getBoundingClientRect();
    const lineRect = activeLine.getBoundingClientRect();
    const centeredTop = lyricsList.scrollTop + lineRect.top - listRect.top - (lyricsList.clientHeight - activeLine.offsetHeight) / 2;
    const maxScrollTop = Math.max(0, lyricsList.scrollHeight - lyricsList.clientHeight);
    const targetTop = Math.min(Math.max(0, centeredTop), maxScrollTop);
    if (Math.abs(targetTop - lyricsList.scrollTop) < 1) {
      return;
    }
    markProgrammaticLyricsScroll(behavior === "smooth" ? 900 : 120);
    lyricsList.scrollTo({
      top: targetTop,
      behavior
    });
  }

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

  function pauseLyricsAutoFollow() {
    userScrollPausedUntilRef.current = Date.now() + 4800;
    setIsUserBrowsingLyrics(true);
    if (followResumeTimerRef.current) {
      window.clearTimeout(followResumeTimerRef.current);
    }
    followResumeTimerRef.current = window.setTimeout(() => {
      followResumeTimerRef.current = null;
      userScrollPausedUntilRef.current = 0;
      setIsUserBrowsingLyrics(false);
      syncActiveLyricIntoView(shouldReduceMotion() ? "auto" : "smooth");
    }, 4800);
  }

  function handleLyricsScroll(top: number) {
    if (!currentTrack) {
      return;
    }
    onScrollPositionChange(currentTrack.id, top, activeLineIndex);
    if (!ignoreScrollRef.current) {
      pauseLyricsAutoFollow();
    }
  }

  function handleLyricsKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const lyricsList = event.currentTarget;
    const maxScrollTop = Math.max(0, lyricsList.scrollHeight - lyricsList.clientHeight);
    let targetTop: number | null = null;

    switch (event.key) {
      case "ArrowDown":
        targetTop = lyricsList.scrollTop + 56;
        break;
      case "ArrowUp":
        targetTop = lyricsList.scrollTop - 56;
        break;
      case "PageDown":
        targetTop = lyricsList.scrollTop + lyricsList.clientHeight * 0.82;
        break;
      case "PageUp":
        targetTop = lyricsList.scrollTop - lyricsList.clientHeight * 0.82;
        break;
      case "Home":
        targetTop = 0;
        break;
      case "End":
        targetTop = maxScrollTop;
        break;
      default:
        return;
    }

    event.preventDefault();
    const clampedTop = Math.min(maxScrollTop, Math.max(0, targetTop));
    if (Math.abs(clampedTop - lyricsList.scrollTop) < 1) {
      return;
    }
    pauseLyricsAutoFollow();
    lyricsList.scrollTo({
      top: clampedTop,
      behavior: shouldReduceMotion() ? "auto" : "smooth"
    });
  }

  function handleLyricsDoubleClick(event: ReactMouseEvent<HTMLElement>) {
    event.preventDefault();
    requestLyricsFullscreenToggle();
  }

  function requestLyricsFullscreenToggle() {
    const now = Date.now();
    if (now < lyricsFullscreenLockUntilRef.current) {
      return;
    }
    lyricsFullscreenLockUntilRef.current = now + 650;
    void onToggleFullscreen();
  }

  function handleLyricsPointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (event.pointerType !== "touch") {
      return;
    }
    lyricsTapStartRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      at: Date.now()
    };
  }

  function handleLyricsPointerUp(event: ReactPointerEvent<HTMLElement>) {
    if (event.pointerType !== "touch") {
      return;
    }
    const tapStart = lyricsTapStartRef.current;
    lyricsTapStartRef.current = null;
    if (!tapStart || tapStart.pointerId !== event.pointerId) {
      return;
    }

    const now = Date.now();
    const movement = Math.hypot(event.clientX - tapStart.x, event.clientY - tapStart.y);
    if (now - tapStart.at > 260 || movement > 12) {
      lastLyricsTapRef.current = null;
      return;
    }

    const lastTap = lastLyricsTapRef.current;
    if (lastTap && now - lastTap.at <= 340 && Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) <= 32) {
      event.preventDefault();
      lastLyricsTapRef.current = null;
      requestLyricsFullscreenToggle();
      return;
    }

    lastLyricsTapRef.current = { x: event.clientX, y: event.clientY, at: now };
  }

  let content: ReactNode;
  if (!currentTrack) {
    content = (
      <div
        className="full-lyrics-empty"
        onPointerDown={handleLyricsPointerDown}
        onPointerUp={handleLyricsPointerUp}
        onDoubleClick={handleLyricsDoubleClick}
      >
        请选择歌曲
      </div>
    );
  } else if (status === "loading") {
    content = (
      <div
        className="full-lyrics-empty"
        onPointerDown={handleLyricsPointerDown}
        onPointerUp={handleLyricsPointerUp}
        onDoubleClick={handleLyricsDoubleClick}
      >
        正在加载歌词
      </div>
    );
  } else if (status === "error") {
    content = (
      <div
        className="full-lyrics-empty"
        onPointerDown={handleLyricsPointerDown}
        onPointerUp={handleLyricsPointerUp}
        onDoubleClick={handleLyricsDoubleClick}
      >
        歌词加载失败
      </div>
    );
  } else if (!lines.length) {
    content = (
      <div
        className="full-lyrics-empty"
        onPointerDown={handleLyricsPointerDown}
        onPointerUp={handleLyricsPointerUp}
        onDoubleClick={handleLyricsDoubleClick}
      >
        暂无歌词
      </div>
    );
  } else {
    content = (
      <div
        className={`full-lyrics-list ${isUserBrowsingLyrics ? "is-user-browsing" : ""}`}
        aria-label="完整歌词"
        ref={lyricsListRef}
        role="region"
        tabIndex={0}
        onScroll={(event) => handleLyricsScroll(event.currentTarget.scrollTop)}
        onKeyDown={handleLyricsKeyDown}
        onPointerDown={handleLyricsPointerDown}
        onPointerUp={handleLyricsPointerUp}
        onDoubleClick={handleLyricsDoubleClick}
      >
        {lines.map((line, index) => {
          const distance = activeLineIndex >= 0 ? Math.abs(index - activeLineIndex) : 0;
          const lineClassName = [
            index === activeLineIndex ? "active" : "",
            distance === 1 ? "near" : "",
            distance > 4 ? "far" : "",
            index < activeLineIndex ? "past" : ""
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <p
              key={`${index}-${line.text}`}
              ref={index === activeLineIndex ? activeLineRef : undefined}
              className={lineClassName}
            >
              {line.text}
            </p>
          );
        })}
      </div>
    );
  }

  return (
    <section className="lyrics-page" style={lyricsPaletteStyle} aria-label="歌词">
      <div className={`lyrics-cinematic-scene ${isPlaying ? "is-playing" : "is-paused"} ${coverImageURL ? "has-cover" : "no-cover"}`} style={sceneMotionStyle} aria-hidden="true">
        <span className="lyrics-cover-art" style={coverImageStyle} />
        {!coverImageURL && currentTrack ? (
          <div className="lyrics-generated-cover">
            <span>{currentTrack.artist}</span>
            <strong>{currentTrack.title}</strong>
          </div>
        ) : null}
        <span className="lyrics-color-field base" />
        <span className="lyrics-color-field lift" />
        <svg className="lyrics-light-threads" viewBox="0 0 1440 420" preserveAspectRatio="none">
          <path className="thread thread-one" d="M-80 236 C 180 156, 318 318, 536 220 S 896 120, 1164 222 S 1432 292, 1520 186" />
          <path className="thread thread-two" d="M-80 182 C 172 256, 344 118, 568 196 S 902 292, 1118 178 S 1392 112, 1520 236" />
          <path className="thread thread-three" d="M-80 286 C 150 220, 336 262, 514 288 S 806 246, 998 286 S 1308 340, 1520 252" />
        </svg>
        <span className="lyrics-stage-light" />
        <span className="lyrics-glass-depth" />
        <span className="lyrics-film-texture" />
      </div>
      <section className="lyrics-page-body" aria-live="polite">
        {content}
      </section>
    </section>
  );
}

const MemoizedFullLyricsPage = memo(FullLyricsPage, (previous, next) => {
  return (
    previous.status === next.status &&
    previous.currentTrack === next.currentTrack &&
    previous.lines === next.lines &&
    previous.activeLineIndex === next.activeLineIndex &&
    previous.visualizer === next.visualizer &&
    previous.isPlaying === next.isPlaying
  );
});

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
    const role = normalizeUserRole(parsed.role);
    const token = typeof parsed.token === "string" ? parsed.token : "";
    const createdAt = typeof parsed.createdAt === "string" ? parsed.createdAt : "";

    if (!phone || !nickname || !createdAt || expiresAt <= Date.now()) {
      removeLocalStorage(authSessionStorageKey);
      return { session: null, expired: Boolean(expiresAt) };
    }

    return { session: { userId, phone, nickname, role, token, expiresAt, createdAt }, expired: false };
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

function createEmptyManagedUserForm(): ManagedUserFormState {
  return {
    phone: "",
    nickname: "",
    password: "",
    role: "user"
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

function readPlaybackDeviceID() {
  const existing = readLocalStorage(playbackDeviceStorageKey);
  if (existing && existing.length <= 128) {
    return existing;
  }
  const deviceID = createPlaybackClientID("device");
  writeLocalStorage(playbackDeviceStorageKey, deviceID);
  return deviceID;
}

function createPlaybackTabID() {
  return createPlaybackClientID("tab");
}

function createPlaybackClientID(prefix: string) {
  if (window.crypto?.randomUUID) {
    return `${prefix}-${window.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getPlaybackDeviceName() {
  if (typeof navigator === "undefined") {
    return "浏览器";
  }
  const platform = navigator.platform?.trim();
  const userAgent = navigator.userAgent || "";
  if (/iPad/i.test(userAgent) || (/Macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1)) {
    return "iPad";
  }
  if (/iPhone/i.test(userAgent)) {
    return "iPhone";
  }
  if (/Android/i.test(userAgent)) {
    return /Mobile/i.test(userAgent) ? "Android 手机" : "Android 平板";
  }
  return platform || "浏览器";
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

function createAuthSession(response: AuthResponse): AuthSession {
  const expiresAt = response.expires_at ? Date.parse(response.expires_at) : Date.now() + authSessionFallbackDurationMs;
  return {
    userId: response.user.id,
    phone: response.user.phone,
    nickname: response.user.nickname,
    role: normalizeUserRole(response.user.role),
    token: response.token?.trim() || "",
    createdAt: new Date().toISOString(),
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now() + authSessionFallbackDurationMs
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

function normalizeAudioFileSearchText(value: string) {
  return value.trim().toLowerCase().replace(/[.\-—–_\s]+/g, "");
}

function getAudioFileSearchTokens(value: string) {
  const compact = normalizeAudioFileSearchText(value);
  if (!compact) {
    return [];
  }
  const separatedTokens = value
    .split(/[.\-—–_\s]+/g)
    .map((token) => normalizeAudioFileSearchText(token))
    .filter(Boolean);
  const tokens = separatedTokens.length > 1 ? separatedTokens : [compact];
  return Array.from(new Set(tokens));
}

function doesTrackMatchAudioFileSearch(track: ServerManagedFile, compactQuery: string, queryTokens: string[]) {
  if (!compactQuery) {
    return true;
  }
  const searchableText = [
    track.title,
    track.artist,
    track.album,
    track.filename,
    track.relative_path,
    track.format,
    getFileExtension(track.filename)
  ]
    .map((value) => normalizeAudioFileSearchText(value ?? ""))
    .join("");
  return searchableText.includes(compactQuery) || queryTokens.every((token) => searchableText.includes(token));
}

function getUploadRelativePath(file: File) {
  return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
}

function isAudioFileArea(area: AudioFileArea) {
  return area === "lossless_music" || area === "lossy_music";
}

function normalizeAudioManagerArea(area: AudioFileArea): AudioManagerArea {
  return area === "lossy_music" ? "lossy_music" : "lossless_music";
}

function isLyricsFileArea(area: AudioFileArea) {
  return !isAudioFileArea(area);
}

function isLossyAudioArea(area: AudioFileArea) {
  return area === "lossy_music";
}

function areaSupportsUploadAudioExtension(area: AudioFileArea, extension: string) {
  if (area === "lossy_music") {
    return lossyAudioFileExtensionsForUpload.has(extension);
  }
  if (area === "lossless_music") {
    return losslessAudioFileExtensions.has(extension);
  }
  return false;
}

function getUploadFileKind(file: File, area: AudioFileArea = "lossless_music") {
  const ext = getFileExtension(getUploadRelativePath(file));
  if (isAudioFileArea(area) && supportedAudioFileExtensions.has(ext)) {
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

async function buildAudioImportPreflight(files: File[], serverAudioSet: ServerAudioFile[], limits: AudioFileImportLimits, area: AudioFileArea): Promise<AudioImportPreflightReport> {
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
    const kind = getUploadFileKind(file, area);
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
      if (isLyricsFileArea(area)) {
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
        readyLyricCount += 1;
        totalUploadBytes += file.size;
        uploadFiles.push(file);
        items.push({
          relativePath,
          displayName,
          kind: "lyrics",
          status: "ready",
          reason: "将保存到当前歌词区域",
          sizeBytes: file.size
        });
      }
      continue;
    }

    if (!areaSupportsUploadAudioExtension(area, getFileExtension(relativePath))) {
      ignoredCount += 1;
      items.push({
        relativePath,
        displayName,
        kind: "audio",
        status: "ignored",
        reason: isLossyAudioArea(area) ? "当前区域只接受轻音乐" : "当前区域只接受高品质",
        sizeBytes: file.size
      });
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

    const targetFilename = buildServerTargetFilenameForUpload(nameParts, area, relativePath);
    const targetBaseKey = normalizeImportBase(targetFilename);
    const duplicate = findServerAudioDuplicate(serverAudioSet, relativePath);
    if (duplicate) {
      duplicateCount += 1;
      audioStatusByBase.set(baseKey, "duplicate");
      audioStatusByBase.set(targetBaseKey, "duplicate");
      items.push({
        relativePath,
        displayName,
        kind: "audio",
        status: "duplicate",
        reason: `服务器已存在 ${duplicate.artist}-${duplicate.title}.${duplicate.extension}，已跳过`,
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
    if (isLyricsFileArea(area) || getUploadFileKind(file, area) !== "lyrics") {
      continue;
    }
    const relativePath = getUploadRelativePath(file);
    const displayName = getDisplayFilename(relativePath);
    const baseKeys = getUploadLyricBaseKeys(relativePath);
    const audioStatus = baseKeys.map((key) => audioStatusByBase.get(key)).find(Boolean);
    const hasReadyUploadAudio = audioStatus === "ready" && baseKeys.some((key) => readyAudioByBase.get(key));
    const serverAudio = findServerAudioForLyric(serverAudioSet, relativePath);
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
    if (!hasReadyUploadAudio && serverAudio) {
      if (serverAudio.has_lyrics) {
        duplicateCount += 1;
        items.push({
          relativePath,
          displayName,
          kind: "lyrics",
          status: "duplicate",
          reason: "服务器已有对应歌词文件，已跳过",
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
        reason: `服务器已有 ${serverAudio.artist}-${serverAudio.title}，将补充歌词`,
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
    if (!hasReadyUploadAudio) {
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

  return {
    files: uploadFiles,
    items,
    readyAudioCount,
    readyLyricCount,
    duplicateCount,
    errorCount,
    ignoredCount,
    totalUploadBytes,
    uploadFileCount: uploadFiles.length,
    blockingMessage: ""
  };
}

function buildAudioImportUploadBatches(report: AudioImportPreflightReport, limits: AudioFileImportLimits): AudioImportUploadBatch[] {
  const maxBatchBytes = Math.max(1, Math.min(limits.max_total_bytes, audioImportBatchMaxBytes));
  const maxBatchFiles = Math.max(1, Math.min(limits.max_file_count, audioImportBatchMaxFiles));
  const filesByRelativePath = new Map(report.files.map((file) => [getUploadRelativePath(file), file]));
  const lyricsByBase = new Map<string, AudioImportPreflightItem[]>();
  const usedLyrics = new Set<string>();
  const groups: File[][] = [];

  for (const item of report.items) {
    if (item.status !== "ready" || item.kind !== "lyrics") {
      continue;
    }
    for (const key of getUploadLyricBaseKeys(item.relativePath)) {
      const lyrics = lyricsByBase.get(key) ?? [];
      lyrics.push(item);
      lyricsByBase.set(key, lyrics);
    }
  }

  for (const item of report.items) {
    if (item.status !== "ready" || item.kind !== "audio") {
      continue;
    }
    const audioFile = filesByRelativePath.get(item.relativePath);
    if (!audioFile) {
      continue;
    }
    const group = [audioFile];
    const keys = new Set([normalizeImportBase(item.relativePath)]);
    if (item.targetFilename) {
      keys.add(normalizeImportBase(item.targetFilename));
    }
    for (const key of keys) {
      for (const lyric of lyricsByBase.get(key) ?? []) {
        if (usedLyrics.has(lyric.relativePath)) {
          continue;
        }
        const lyricFile = filesByRelativePath.get(lyric.relativePath);
        if (!lyricFile) {
          continue;
        }
        usedLyrics.add(lyric.relativePath);
        group.push(lyricFile);
      }
    }
    groups.push(group);
  }

  for (const item of report.items) {
    if (item.status !== "ready" || item.kind !== "lyrics" || usedLyrics.has(item.relativePath)) {
      continue;
    }
    const lyricFile = filesByRelativePath.get(item.relativePath);
    if (lyricFile) {
      groups.push([lyricFile]);
    }
  }

  const batches: AudioImportUploadBatch[] = [];
  let currentFiles: File[] = [];
  let currentBytes = 0;

  for (const group of groups) {
    const groupBytes = group.reduce((total, file) => total + file.size, 0);
    const shouldStartNewBatch =
      currentFiles.length > 0 && (currentBytes + groupBytes > maxBatchBytes || currentFiles.length + group.length > maxBatchFiles);
    if (shouldStartNewBatch) {
      batches.push({ files: currentFiles, bytes: currentBytes });
      currentFiles = [];
      currentBytes = 0;
    }
    currentFiles.push(...group);
    currentBytes += groupBytes;
  }

  if (currentFiles.length) {
    batches.push({ files: currentFiles, bytes: currentBytes });
  }

  return batches;
}

function mergeAudioImportReports(reports: AudioFileImportReport[]): AudioFileImportReport {
  return reports.reduce<AudioFileImportReport>(
    (merged, report) => ({
      imported: merged.imported + report.imported,
      skipped: merged.skipped + report.skipped,
      failed: merged.failed + report.failed,
      converted: merged.converted + report.converted,
      lyrics_imported: (merged.lyrics_imported ?? 0) + (report.lyrics_imported ?? 0),
      lyrics_skipped: (merged.lyrics_skipped ?? 0) + (report.lyrics_skipped ?? 0),
      lyrics_failed: (merged.lyrics_failed ?? 0) + (report.lyrics_failed ?? 0),
      items: [...merged.items, ...report.items],
      scan: report.scan ?? merged.scan
    }),
    {
      imported: 0,
      skipped: 0,
      failed: 0,
      converted: 0,
      lyrics_imported: 0,
      lyrics_skipped: 0,
      lyrics_failed: 0,
      items: []
    }
  );
}

function buildServerAudioSetFromTracks(tracks: ServerManagedFile[], providedSet?: ServerAudioFile[]) {
  if (providedSet?.length) {
    return providedSet;
  }

  const entries: ServerAudioFile[] = [];
  for (const track of tracks) {
    if (track.kind !== "audio") {
      continue;
    }
    const filename = getDisplayFilename(track.filename || track.relative_path);
    const extension = normalizeAudioExtension(getFileExtension(filename) || track.format);
    if (!filename || !extension) {
      continue;
    }

    const nameParts = tagsFromUploadFilename(filename);
    const artist = firstUploadText(nameParts.artist, track.artist);
    const title = firstUploadText(nameParts.title, track.title);
    if (!artist || !title) {
      continue;
    }

    entries.push({
      filename,
      filename_hash: "",
      artist,
      title,
      extension,
      area: track.area,
      has_lyrics: track.has_lyrics
    });
  }
  return entries;
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

function findServerAudioDuplicate(serverAudioSet: ServerAudioFile[], uploadRelativePath: string) {
  const uploadFilename = getDisplayFilename(uploadRelativePath);
  const normalizedUploadName = normalizeAudioImportComparisonText(uploadFilename);
  const uploadExtension = normalizeAudioExtension(getFileExtension(uploadFilename));
  const uploadIsLossless = isLosslessAudioExtension(uploadExtension);

  for (const serverAudio of serverAudioSet) {
    const artist = normalizeAudioImportComparisonText(serverAudio.artist);
    const title = normalizeAudioImportComparisonText(serverAudio.title);
    if (!artist || !title) {
      continue;
    }
    if (!normalizedUploadName.includes(artist) || !normalizedUploadName.includes(title)) {
      continue;
    }

    const serverExtension = normalizeAudioExtension(serverAudio.extension);
    if (!serverExtension || uploadExtension === serverExtension) {
      return serverAudio;
    }
    if (!isLosslessAudioExtension(serverExtension) && uploadIsLossless) {
      continue;
    }
    return serverAudio;
  }

  return null;
}

function findServerAudioForLyric(serverAudioSet: ServerAudioFile[], lyricRelativePath: string) {
  const lyricKeys = new Set(getUploadLyricBaseKeys(lyricRelativePath));
  for (const serverAudio of serverAudioSet) {
    if (getServerAudioBaseKeys(serverAudio).some((key) => lyricKeys.has(key))) {
      return serverAudio;
    }
  }
  return null;
}

function getServerAudioBaseKeys(serverAudio: ServerAudioFile) {
  const keys = new Set<string>();
  const filenameKey = normalizeImportBase(serverAudio.filename);
  if (filenameKey) {
    keys.add(filenameKey);
  }
  if (serverAudio.artist && serverAudio.title) {
    const area = serverAudio.area && isAudioFileArea(serverAudio.area) ? serverAudio.area : "lossless_music";
    const targetFilename = buildServerTargetFilenameForUpload(
      { artist: serverAudio.artist, title: serverAudio.title },
      area,
      serverAudio.filename
    );
    const targetKey = normalizeImportBase(targetFilename);
    if (targetKey) {
      keys.add(targetKey);
    }
  }
  return Array.from(keys);
}

function normalizeAudioImportComparisonText(value: string) {
  return value.trim().toLowerCase().replace(/[.\-—–_\s]+/g, "");
}

function normalizeAudioExtension(value: string) {
  return value.trim().toLowerCase().replace(/^\./, "");
}

function isLosslessAudioExtension(extension: string) {
  return supportedAudioFileExtensions.has(`.${normalizeAudioExtension(extension)}`);
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

function buildServerTargetFilenameForUpload(nameParts: UploadAudioNameParts, area: AudioFileArea = "lossless_music", sourcePath = "") {
  const targetBase = sanitizeServerAudioFilename(`${nameParts.artist}-${nameParts.title}`);
  if (isLossyAudioArea(area)) {
    const sourceExt = getFileExtension(sourcePath);
    const ext = lossyAudioFileExtensionsForUpload.has(sourceExt) ? sourceExt : ".mp3";
    return sanitizeServerAudioFilename(`${targetBase}${ext}`);
  }
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

function getAudioPreflightFilterOptions(report: AudioImportPreflightReport): Array<{ id: AudioImportPreflightFilter; label: string; count: number; className: string }> {
  return [
    { id: "readyAudio", label: "可上传", count: report.readyAudioCount, className: "ready" },
    { id: "readyLyrics", label: "歌词", count: report.readyLyricCount, className: "lyrics" },
    { id: "duplicate", label: "重叠", count: report.duplicateCount, className: "duplicate" },
    { id: "error", label: "错误", count: report.errorCount, className: "error" },
    { id: "ignored", label: "忽略", count: report.ignoredCount, className: "ignored" }
  ];
}

function filterAudioPreflightItems(items: AudioImportPreflightItem[], filter: AudioImportPreflightFilter) {
  return items.filter((item) => {
    switch (filter) {
      case "readyAudio":
        return item.status === "ready" && item.kind === "audio";
      case "readyLyrics":
        return item.status === "ready" && item.kind === "lyrics";
      case "duplicate":
      case "error":
      case "ignored":
        return item.status === filter;
      default:
        return false;
    }
  });
}

function getAudioPreflightEmptyMessage(filter: AudioImportPreflightFilter) {
  switch (filter) {
    case "readyAudio":
      return "没有可上传歌曲";
    case "readyLyrics":
      return "没有匹配歌词";
    case "duplicate":
      return "没有重叠项目";
    case "error":
      return "没有错误项目";
    case "ignored":
      return "没有忽略项目";
    default:
      return "没有项目";
  }
}

function getAudioPreflightUploadSummary(report: AudioImportPreflightReport) {
  if (report.readyAudioCount <= 0) {
    return report.readyLyricCount > 0 ? `将上传歌词 ${report.readyLyricCount} 个` : "没有可上传歌曲";
  }
  if (report.readyLyricCount <= 0) {
    return `将上传 ${report.readyAudioCount} 首歌曲`;
  }
  return `将上传 ${report.readyAudioCount} 首歌曲 + ${report.readyLyricCount} 个歌词`;
}

function getAudioImportResultFilterOptions(report: AudioFileImportReport): Array<{ id: AudioImportResultFilter; label: string; count: number; className: string }> {
  const importedAudioCount = filterAudioImportResultItems(report.items, "importedAudio").length;
  const importedLyricsCount = filterAudioImportResultItems(report.items, "importedLyrics").length;
  const skippedCount = filterAudioImportResultItems(report.items, "skipped").length;
  const failedCount = filterAudioImportResultItems(report.items, "failed").length;
  return [
    { id: "importedAudio", label: "歌曲成功", count: importedAudioCount, className: "imported" },
    { id: "importedLyrics", label: "歌词成功", count: importedLyricsCount, className: "lyrics" },
    { id: "skipped", label: "跳过", count: skippedCount, className: "skipped" },
    { id: "failed", label: "失败", count: failedCount, className: "failed" }
  ];
}

function filterAudioImportResultItems(items: AudioFileImportItemResult[], filter: AudioImportResultFilter) {
  return items.filter((item) => {
    switch (filter) {
      case "importedAudio":
        return item.status === "imported" && getAudioImportResultKindLabel(item) === "音频";
      case "importedLyrics":
        return item.status === "imported" && getAudioImportResultKindLabel(item) === "歌词";
      case "skipped":
      case "failed":
        return item.status === filter;
      default:
        return false;
    }
  });
}

function getAudioImportResultEmptyMessage(filter: AudioImportResultFilter) {
  switch (filter) {
    case "importedAudio":
      return "没有成功导入的歌曲";
    case "importedLyrics":
      return "没有成功导入的歌词";
    case "skipped":
      return "没有跳过项目";
    case "failed":
      return "没有失败项目";
    default:
      return "没有逐项明细";
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

function formatOnlinePresence(users: OnlineUser[], onlineCount: number) {
  const count = Math.max(0, onlineCount, users.length);
  const nicknames = users.map((user) => user.nickname.trim()).filter(Boolean);
  if (nicknames.length > 0) {
    return `${nicknames.join("、")}，共 ${count} 人`;
  }
  if (count > 0) {
    return `共 ${count} 人`;
  }
  return "暂无在线用户";
}

type NoteFolderSelection = number | "all" | "unfiled";
type NoteEditorMode = "edit" | "preview";
type NoteSaveStatus = "idle" | "saving" | "saved" | "error";
type RichEditorActions = {
  exportHtml: () => void;
  exportPdf: () => void;
  print: () => void;
};
type NoteContextMenu =
  | { kind: "scope"; scope: NoteFolderSelection; x: number; y: number }
  | { kind: "folder"; folder: NoteFolder; x: number; y: number }
  | { kind: "note"; note: GrowthNote; x: number; y: number };
type NoteContextMenuDraft =
  | { kind: "scope"; scope: NoteFolderSelection }
  | { kind: "folder"; folder: NoteFolder }
  | { kind: "note"; note: GrowthNote };
type NoteMoveDialog = { kind: "folder"; folder: NoteFolder } | { kind: "note"; note: GrowthNote };
type NoteInfoDialog = { kind: "folder"; folder: NoteFolder } | { kind: "note"; note: GrowthNote };
type NoteCreateFolderDialog = { parentID: number | null };
type NoteCreateNoteDialog = { folderID: number | null };
type NoteRenameDialog = { kind: "folder"; folder: NoteFolder } | { kind: "note"; note: GrowthNote };
type NoteDeleteDialog = { kind: "folder"; folder: NoteFolder } | { kind: "note"; note: GrowthNote };
const noteTreeMinWidth = 190;
const noteTreeMaxWidth = 420;

const FontSize = Extension.create({
  name: "fontSize",
  addGlobalAttributes() {
    return [
      {
        types: ["textStyle"],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element) => element.style.fontSize || null,
            renderHTML: (attributes) => {
              if (!attributes.fontSize) {
                return {};
              }
              return { style: `font-size: ${attributes.fontSize}` };
            }
          }
        }
      }
    ];
  }
});

const RichBlockStyle = Extension.create({
  name: "richBlockStyle",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: (element) => element.style.lineHeight || null,
            renderHTML: (attributes) => {
              if (!attributes.lineHeight) {
                return {};
              }
              return { style: `line-height: ${attributes.lineHeight}` };
            }
          },
          textIndent: {
            default: null,
            parseHTML: (element) => element.style.textIndent || null,
            renderHTML: (attributes) => {
              if (!attributes.textIndent) {
                return {};
              }
              return { style: `text-indent: ${attributes.textIndent}` };
            }
          },
          marginTop: {
            default: null,
            parseHTML: (element) => element.style.marginTop || null,
            renderHTML: (attributes) => {
              if (!attributes.marginTop) {
                return {};
              }
              return { style: `margin-top: ${attributes.marginTop}` };
            }
          },
          marginBottom: {
            default: null,
            parseHTML: (element) => element.style.marginBottom || null,
            renderHTML: (attributes) => {
              if (!attributes.marginBottom) {
                return {};
              }
              return { style: `margin-bottom: ${attributes.marginBottom}` };
            }
          }
        }
      }
    ];
  }
});

const Superscript = Mark.create({
  name: "superscript",
  excludes: "subscript",
  parseHTML() {
    return [{ tag: "sup" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["sup", HTMLAttributes, 0];
  }
});

const Subscript = Mark.create({
  name: "subscript",
  excludes: "superscript",
  parseHTML() {
    return [{ tag: "sub" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["sub", HTMLAttributes, 0];
  }
});

const RichImage = Image.extend({
  addAttributes() {
    const parentAttributes = this.parent?.() ?? {};
    return {
      ...parentAttributes,
      width: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-width") || element.style.width || null,
        renderHTML: (attributes) => {
          if (!attributes.width) {
            return {};
          }
          return { "data-width": attributes.width, style: `width: ${attributes.width}` };
        }
      },
      align: {
        default: "center",
        parseHTML: (element) => element.getAttribute("data-align") || "center",
        renderHTML: (attributes) => ({ "data-align": attributes.align || "center" })
      }
    };
  }
});

function GrowthNotesPage({ authSession }: { authSession: AuthSession | null }) {
  const userID = authSession?.userId;
  const [folders, setFolders] = useState<NoteFolder[]>([]);
  const [notes, setNotes] = useState<GrowthNote[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<NoteFolderSelection>("all");
  const [selectedNoteID, setSelectedNoteID] = useState<number | null>(null);
  const [selectedNote, setSelectedNote] = useState<GrowthNote | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [saveStatus, setSaveStatus] = useState<NoteSaveStatus>("idle");
  const [richEditorActions, setRichEditorActions] = useState<RichEditorActions | null>(null);
  const [isOutlineVisible, setIsOutlineVisible] = useState(false);
  const [outlineItems, setOutlineItems] = useState<RichOutlineItem[]>([]);
  const [isDocumentMenuOpen, setIsDocumentMenuOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isTreeVisible, setIsTreeVisible] = useState(true);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [themeMode, setThemeMode] = useState<"dark" | "light">("light");
  const [contextMenu, setContextMenu] = useState<NoteContextMenu | null>(null);
  const [moveDialog, setMoveDialog] = useState<NoteMoveDialog | null>(null);
  const [infoDialog, setInfoDialog] = useState<NoteInfoDialog | null>(null);
  const [createFolderDialog, setCreateFolderDialog] = useState<NoteCreateFolderDialog | null>(null);
  const [createFolderName, setCreateFolderName] = useState("新的文件夹");
  const [createNoteDialog, setCreateNoteDialog] = useState<NoteCreateNoteDialog | null>(null);
  const [createNoteTitle, setCreateNoteTitle] = useState("未命名文档");
  const [renameDialog, setRenameDialog] = useState<NoteRenameDialog | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteDialog, setDeleteDialog] = useState<NoteDeleteDialog | null>(null);
  const [moveTarget, setMoveTarget] = useState("root");
  const [treeWidth, setTreeWidth] = useState(230);
  const [hasManualTreeWidth, setHasManualTreeWidth] = useState(false);
  const [isTreeResizing, setIsTreeResizing] = useState(false);
  const outlineJumpRef = useRef<RichOutlineJumpHandler | null>(null);
  const selectedNoteIDRef = useRef<number | null>(selectedNoteID);
  const saveStatusResetTimerRef = useRef<number | null>(null);

  const folderChildren = useMemo(() => {
    const map = new Map<number | null, NoteFolder[]>();
    for (const folder of folders) {
      const parentID = folder.parent_id ?? null;
      const siblings = map.get(parentID) ?? [];
      siblings.push(folder);
      map.set(parentID, siblings);
    }
    for (const siblings of map.values()) {
      siblings.sort((first, second) => first.sort_order - second.sort_order || first.name.localeCompare(second.name, "zh-Hans-CN") || first.id - second.id);
    }
    return map;
  }, [folders]);

  const notesByFolder = useMemo(() => {
    const map = new Map<number | null, GrowthNote[]>();
    for (const note of notes) {
      const folderID = note.folder_id ?? null;
      const siblings = map.get(folderID) ?? [];
      siblings.push(note);
      map.set(folderID, siblings);
    }
    return map;
  }, [notes]);

  const suggestedTreeWidth = useMemo(() => {
    let maxWidth = 0;
    const measureName = (name: string, depth: number) => {
      const textWidth = Array.from(name).reduce((total, char) => total + (char.charCodeAt(0) > 255 ? 14 : 8), 0);
      maxWidth = Math.max(maxWidth, 56 + depth * 15 + textWidth);
    };
    const visitFolder = (parentID: number | null, depth: number) => {
      for (const folder of folderChildren.get(parentID) ?? []) {
        measureName(folder.name, depth);
        for (const note of notesByFolder.get(folder.id) ?? []) {
          measureName(note.title, depth + 1);
        }
        visitFolder(folder.id, depth + 1);
      }
    };
    for (const note of notesByFolder.get(null) ?? []) {
      measureName(note.title, 0);
    }
    visitFolder(null, 0);
    return Math.min(noteTreeMaxWidth, Math.max(noteTreeMinWidth, maxWidth || 218));
  }, [folderChildren, notesByFolder]);

  const folderParentByID = useMemo(() => new Map(folders.map((folder) => [folder.id, folder.parent_id ?? null])), [folders]);
  const selectedFolderRecord = typeof selectedFolder === "number" ? folders.find((folder) => folder.id === selectedFolder) ?? null : null;
  const canCreateInSelectedFolder = Boolean(userID) && canCreateInFolder(typeof selectedFolder === "number" ? selectedFolder : null);
  const canEditSelectedNote = Boolean(selectedNote?.can_edit);
  const ownedMoveFolders = folders.filter((folder) => {
    if (!folder.can_edit) {
      return false;
    }
    if (moveDialog?.kind !== "folder") {
      return true;
    }
    return folder.id !== moveDialog.folder.id && !isFolderDescendant(moveDialog.folder.id, folder.id);
  });

  useEffect(() => {
    selectedNoteIDRef.current = selectedNoteID;
  }, [selectedNoteID]);

  useEffect(() => {
    return () => {
      clearSaveStatusResetTimer();
    };
  }, []);

  useEffect(() => {
    void loadFolders();
  }, [userID]);

  useEffect(() => {
    if (!hasManualTreeWidth) {
      setTreeWidth(suggestedTreeWidth);
    }
  }, [hasManualTreeWidth, suggestedTreeWidth]);

  useEffect(() => {
    const timeoutID = window.setTimeout(() => {
      void loadNotes();
    }, 220);
    return () => window.clearTimeout(timeoutID);
  }, [selectedFolder, searchQuery, userID]);

  useEffect(() => {
    clearSaveStatusResetTimer();
    if (!selectedNoteID) {
      setSelectedNote(null);
      setDraftTitle("");
      setDraftContent("");
      setSaveStatus("idle");
      setOutlineItems([]);
      outlineJumpRef.current = null;
      return;
    }
    void loadSelectedNote(selectedNoteID);
  }, [selectedNoteID, userID]);

  useEffect(() => {
    if (selectedNote) {
      return;
    }
    setOutlineItems([]);
    outlineJumpRef.current = null;
  }, [selectedNote]);

  useEffect(() => {
    if (!selectedNote || !selectedNote.can_edit) {
      return;
    }
    if (draftTitle === selectedNote.title && draftContent === selectedNote.content) {
      return;
    }
    const timeoutID = window.setTimeout(() => {
      void saveSelectedNote();
    }, 1000);
    return () => window.clearTimeout(timeoutID);
  }, [draftTitle, draftContent, selectedNote?.id, selectedNote?.updated_at, selectedNote?.can_edit]);

  useEffect(() => {
    const closeFloatingMenus = () => {
      setContextMenu(null);
      setIsDocumentMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu(null);
        setIsProfileMenuOpen(false);
        setIsDocumentMenuOpen(false);
      }
    };
    window.addEventListener("click", closeFloatingMenus);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("scroll", closeFloatingMenus, true);
    return () => {
      window.removeEventListener("click", closeFloatingMenus);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("scroll", closeFloatingMenus, true);
    };
  }, []);

  const handleOutlineItemsChange = useCallback((items: RichOutlineItem[]) => {
    setOutlineItems((current) => (areRichOutlineItemsEqual(current, items) ? current : items));
  }, []);

  const handleOutlineJumpReady = useCallback((jump: RichOutlineJumpHandler | null) => {
    outlineJumpRef.current = jump;
  }, []);

  const handleOutlineItemClick = useCallback((pos: number) => {
    outlineJumpRef.current?.(pos);
  }, []);

  function clearSaveStatusResetTimer() {
    if (saveStatusResetTimerRef.current) {
      window.clearTimeout(saveStatusResetTimerRef.current);
      saveStatusResetTimerRef.current = null;
    }
  }

  function showSavedThenReset() {
    clearSaveStatusResetTimer();
    setSaveStatus("saved");
    saveStatusResetTimerRef.current = window.setTimeout(() => {
      saveStatusResetTimerRef.current = null;
      setSaveStatus("idle");
    }, 1600);
  }

  async function loadFolders() {
    try {
      const payload = await getNoteFolders(userID);
      setFolders(payload.folders);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "文件夹加载失败");
    }
  }

  async function loadNotes() {
    setIsLoading(true);
    try {
      const payload = await getNotes({ userID, folderID: "all", query: searchQuery.trim() });
      setNotes(payload.notes);
      setMessage("");
      if (selectedNoteID && !payload.notes.some((note) => note.id === selectedNoteID)) {
        setSelectedNoteID(payload.notes[0]?.id ?? null);
      } else if (!selectedNoteID && payload.notes.length) {
        setSelectedNoteID(payload.notes[0].id);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "文档加载失败");
    } finally {
      setIsLoading(false);
    }
  }

  async function loadSelectedNote(noteID: number) {
    try {
      const notePayload = await getNote(noteID, userID);
      setSelectedNote(notePayload.note);
      setDraftTitle(notePayload.note.title);
      setDraftContent(notePayload.note.content);
      clearSaveStatusResetTimer();
      setSaveStatus("idle");
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "文档详情加载失败");
    }
  }

  function canCreateInFolder(folderID: number | null) {
    if (!userID) {
      return false;
    }
    if (folderID === null) {
      return true;
    }
    return Boolean(folders.find((folder) => folder.id === folderID)?.can_edit);
  }

  function isFolderDescendant(folderID: number, candidateID: number) {
    let parentID = folderParentByID.get(candidateID) ?? null;
    while (parentID !== null) {
      if (parentID === folderID) {
        return true;
      }
      parentID = folderParentByID.get(parentID) ?? null;
    }
    return false;
  }

  function selectFolder(folder: NoteFolderSelection) {
    setSelectedFolder(folder);
  }

  function selectNote(noteID: number) {
    setSelectedNoteID(noteID);
    const note = notes.find((item) => item.id === noteID);
    if (note) {
      setSelectedFolder(note.folder_id ?? "unfiled");
    }
  }

  function handleCreateFolder(parentID?: number | null) {
    if (!userID) {
      setMessage("请先登录后创建文件夹");
      return;
    }
    if (!canCreateInFolder(parentID ?? null)) {
      setMessage("只能在自己创建的文件夹里新建子文件夹");
      return;
    }
    setCreateFolderName("新的文件夹");
    setCreateFolderDialog({ parentID: parentID ?? null });
    setContextMenu(null);
    setMessage("");
  }

  async function handleConfirmCreateFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!userID || !createFolderDialog) {
      return;
    }
    const parentID = createFolderDialog.parentID;
    if (!canCreateInFolder(parentID)) {
      setMessage("只能在自己创建的文件夹里新建子文件夹");
      return;
    }
    const name = createFolderName.trim();
    if (!name) {
      setMessage("文件夹名称不能为空");
      return;
    }
    try {
      const folder = await createNoteFolder({ user_id: userID, parent_id: parentID, name });
      setFolders((previous) => [...previous, folder]);
      setSelectedFolder(folder.id);
      setCreateFolderDialog(null);
      setCreateFolderName("新的文件夹");
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创建文件夹失败");
    }
  }

  async function handleCopyFolder(folder: NoteFolder) {
    if (!userID) {
      setMessage("请先登录后复制文件夹");
      return;
    }
    const parentID = folder.parent_id ?? null;
    if (!canCreateInFolder(parentID)) {
      setMessage("只能复制到自己可编辑的位置");
      return;
    }
    try {
      const copiedFolder = await createNoteFolder({ user_id: userID, parent_id: parentID, name: `${folder.name} 副本` });
      setFolders((previous) => [...previous, copiedFolder]);
      setSelectedFolder(copiedFolder.id);
      setMessage("已复制文件夹结构，文档内容可单独复制");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "复制文件夹失败");
    }
  }

  function handleRenameFolder(folder: NoteFolder) {
    if (!userID || !folder.can_edit) {
      return;
    }
    setRenameDialog({ kind: "folder", folder });
    setRenameValue(folder.name);
    setContextMenu(null);
    setMessage("");
  }

  async function handleConfirmRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!userID || !renameDialog) {
      return;
    }
    const name = renameValue.trim();
    if (!name) {
      setMessage("名称不能为空");
      return;
    }
    try {
      if (renameDialog.kind === "folder") {
        const folder = renameDialog.folder;
        if (!folder.can_edit || name === folder.name) {
          setRenameDialog(null);
          return;
        }
        const nextFolder = await updateNoteFolder(folder.id, { user_id: userID, parent_id: folder.parent_id, name });
        setFolders((previous) => previous.map((item) => (item.id === nextFolder.id ? nextFolder : item)));
      } else {
        const note = renameDialog.note;
        if (!note.can_edit || name === note.title) {
          setRenameDialog(null);
          return;
        }
        const nextNote = await updateNote(note.id, { user_id: userID, folder_id: note.folder_id, title: name, content: note.content });
        setNotes((previous) => previous.map((item) => (item.id === nextNote.id ? nextNote : item)));
        if (selectedNoteID === nextNote.id) {
          setSelectedNote(nextNote);
          setDraftTitle(nextNote.title);
          setDraftContent(nextNote.content);
        }
      }
      setRenameDialog(null);
      setRenameValue("");
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "重命名失败");
    }
  }

  async function handleDeleteFolder(folder: NoteFolder) {
    if (!userID || !folder.can_edit) {
      return;
    }
    try {
      await deleteNoteFolder(folder.id, userID);
      await loadFolders();
      setDeleteDialog(null);
      if (selectedFolder === folder.id) {
        setSelectedFolder("all");
      }
      void loadNotes();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除文件夹失败");
    }
  }

  function handleCreateNote(folderID?: number | null) {
    if (!userID) {
      setMessage("请先登录后创建文档");
      return;
    }
    const targetFolderID = folderID !== undefined ? folderID : typeof selectedFolder === "number" ? selectedFolder : null;
    if (!canCreateInFolder(targetFolderID)) {
      setMessage("只能在自己创建的文件夹里写文档");
      return;
    }
    setCreateNoteTitle("未命名文档");
    setCreateNoteDialog({ folderID: targetFolderID });
    setContextMenu(null);
    setMessage("");
  }

  async function handleConfirmCreateNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!userID || !createNoteDialog) {
      return;
    }
    const targetFolderID = createNoteDialog.folderID;
    if (!canCreateInFolder(targetFolderID)) {
      setMessage("只能在自己创建的文件夹里写文档");
      return;
    }
    const title = createNoteTitle.trim();
    if (!title) {
      setMessage("文档标题不能为空");
      return;
    }
    try {
      const note = await createNote({
        user_id: userID,
        folder_id: targetFolderID,
        title,
        content: ""
      });
      setNotes((previous) => [note, ...previous]);
      setSelectedNoteID(note.id);
      setSelectedFolder(note.folder_id ?? "unfiled");
      setCreateNoteDialog(null);
      setCreateNoteTitle("未命名文档");
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创建文档失败");
    }
  }

  async function saveSelectedNote() {
    if (!userID || !selectedNote?.can_edit) {
      return;
    }
    const title = draftTitle.trim();
    if (!title) {
      clearSaveStatusResetTimer();
      setSaveStatus("error");
      setMessage("标题不能为空");
      return;
    }
    clearSaveStatusResetTimer();
    setSaveStatus("saving");
    try {
      const note = await updateNote(selectedNote.id, { user_id: userID, folder_id: selectedNote.folder_id, title, content: draftContent });
      setSelectedNote(note);
      setNotes((previous) => previous.map((item) => (item.id === note.id ? note : item)));
      showSavedThenReset();
      setMessage("");
    } catch (error) {
      clearSaveStatusResetTimer();
      setSaveStatus("error");
      setMessage(error instanceof Error ? error.message : "自动保存失败");
    }
  }

  function handleEditorKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat || !selectedNote?.can_edit) {
      return;
    }
    void saveSelectedNote();
  }

  function handleRenameNote(note: GrowthNote) {
    if (!userID || !note.can_edit) {
      return;
    }
    setRenameDialog({ kind: "note", note });
    setRenameValue(note.title);
    setContextMenu(null);
    setMessage("");
  }

  async function handleCopyNote(note: GrowthNote) {
    if (!userID) {
      setMessage("请先登录后复制文档");
      return;
    }
    const targetFolderID = typeof selectedFolder === "number" && canCreateInFolder(selectedFolder) ? selectedFolder : null;
    try {
      const copiedNote = await createNote({
        user_id: userID,
        folder_id: targetFolderID,
        title: `${note.title} 副本`,
        content: note.content
      });
      setNotes((previous) => [copiedNote, ...previous]);
      setSelectedNoteID(copiedNote.id);
      setSelectedFolder(copiedNote.folder_id ?? "unfiled");
      setMessage("已复制为你的文档副本");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "复制文档失败");
    }
  }

  async function handleDeleteNote(note = selectedNote) {
    if (!userID || !note?.can_edit) {
      return;
    }
    try {
      await deleteNote(note.id, userID);
      setNotes((previous) => previous.filter((item) => item.id !== note.id));
      setDeleteDialog(null);
      if (selectedNoteID === note.id) {
        setSelectedNoteID(notes.find((item) => item.id !== note.id)?.id ?? null);
      }
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除文档失败");
    }
  }

  function openContextMenu(event: ReactMouseEvent, menu: NoteContextMenuDraft) {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ ...menu, x: event.clientX, y: event.clientY } as NoteContextMenu);
  }

  function openMoveDialog(target: NoteMoveDialog) {
    setMoveDialog(target);
    const currentParent = target.kind === "folder" ? target.folder.parent_id : target.note.folder_id;
    setMoveTarget(currentParent ? String(currentParent) : "root");
    setContextMenu(null);
  }

  function openInfoDialog(target: NoteInfoDialog) {
    setInfoDialog(target);
    setContextMenu(null);
  }

  function openDeleteDialog(target: NoteDeleteDialog) {
    setDeleteDialog(target);
    setContextMenu(null);
  }

  function getTreeWidthFromPointer(clientX: number) {
    const railWidth = 68;
    const availableMax = Math.max(noteTreeMinWidth, Math.min(noteTreeMaxWidth, window.innerWidth - railWidth - 420));
    return Math.min(availableMax, Math.max(noteTreeMinWidth, clientX - railWidth));
  }

  function handleTreeResizePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setHasManualTreeWidth(true);
    setIsTreeResizing(true);
    setTreeWidth(getTreeWidthFromPointer(event.clientX));
  }

  function handleTreeResizePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!isTreeResizing) {
      return;
    }
    setTreeWidth(getTreeWidthFromPointer(event.clientX));
  }

  function stopTreeResize(event: ReactPointerEvent<HTMLDivElement>) {
    setIsTreeResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  async function handleConfirmMove() {
    if (!userID || !moveDialog) {
      return;
    }
    const targetFolderID = moveTarget === "root" ? null : Number(moveTarget);
    if (!Number.isFinite(targetFolderID ?? 0)) {
      setMessage("目标文件夹不正确");
      return;
    }
    try {
      if (moveDialog.kind === "folder") {
        const folder = moveDialog.folder;
        const movedFolder = await updateNoteFolder(folder.id, { user_id: userID, parent_id: targetFolderID, name: folder.name });
        setFolders((previous) => previous.map((item) => (item.id === movedFolder.id ? movedFolder : item)));
        setSelectedFolder(movedFolder.id);
      } else {
        const note = moveDialog.note;
        const movedNote = await updateNote(note.id, { user_id: userID, folder_id: targetFolderID, title: note.title, content: note.content });
        setNotes((previous) => previous.map((item) => (item.id === movedNote.id ? movedNote : item)));
        setSelectedNoteID(movedNote.id);
        setSelectedFolder(movedNote.folder_id ?? "unfiled");
        if (selectedNoteID === movedNote.id) {
          setSelectedNote(movedNote);
        }
      }
      setMoveDialog(null);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "移动失败");
    }
  }

  function renderNoteNode(note: GrowthNote, depth: number) {
    return (
      <button
        key={note.id}
        className={`growth-tree-row note ${selectedNoteID === note.id ? "active" : ""}`}
        type="button"
        title={note.title}
        style={{ "--tree-depth": depth } as CSSProperties}
        onClick={() => selectNote(note.id)}
        onContextMenu={(event) => openContextMenu(event, { kind: "note", note })}
      >
        <span className="growth-tree-icon">
          <DocumentTreeIcon />
        </span>
        <span className="growth-tree-main">
          <span>{note.title}</span>
        </span>
      </button>
    );
  }

  function renderFolderTree(parentID: number | null, depth = 0): ReactNode {
    const items = folderChildren.get(parentID) ?? [];
    return items.map((folder) => (
      <div key={folder.id} className="growth-folder-branch">
        <button
          type="button"
          className={`growth-tree-row folder ${selectedFolder === folder.id ? "active" : ""}`}
          title={folder.name}
          style={{ "--tree-depth": depth } as CSSProperties}
          onClick={() => selectFolder(folder.id)}
          onDoubleClick={() => void handleCreateNote(folder.id)}
          onContextMenu={(event) => openContextMenu(event, { kind: "folder", folder })}
        >
          <span className="growth-tree-icon">
            <FolderTreeIcon />
          </span>
          <span className="growth-tree-main">
            <span>{folder.name}</span>
          </span>
        </button>
        {(notesByFolder.get(folder.id) ?? []).map((note) => renderNoteNode(note, depth + 1))}
        {renderFolderTree(folder.id, depth + 1)}
      </div>
    ));
  }

  const saveStatusText: Record<NoteSaveStatus, string> = {
    idle: selectedNote?.can_edit ? "保存" : "只读",
    saving: "保存中",
    saved: "已保存",
    error: "保存失败"
  };
  const currentUserName = authSession?.nickname?.trim() || authSession?.phone || "未登录";
  const createFolderParent = createFolderDialog?.parentID ? folders.find((folder) => folder.id === createFolderDialog.parentID) ?? null : null;
  const createNoteParent = createNoteDialog?.folderID ? folders.find((folder) => folder.id === createNoteDialog.folderID) ?? null : null;

  const isOutlinePanelVisible = isOutlineVisible && Boolean(selectedNote);
  const growthPageStyle = { "--growth-tree-width": `${Math.round(treeWidth)}px` } as CSSProperties;

  return (
    <section className={`growth-page ${themeMode === "light" ? "light" : ""} ${isTreeVisible ? "" : "tree-hidden"} ${isTreeResizing ? "tree-resizing" : ""} ${isOutlinePanelVisible ? "outline-visible" : ""}`} style={growthPageStyle} aria-label="个人成长养成记">
      <aside className="growth-sidebar" aria-label="笔记侧边栏">
        <div className="growth-user-area">
          <button className="growth-avatar" type="button" aria-label="用户功能" onClick={(event) => { event.stopPropagation(); setIsProfileMenuOpen((open) => !open); }}>
            {authSession ? getProfileAvatarText(authSession) : "客"}
          </button>
          {isProfileMenuOpen ? (
            <div className="growth-profile-menu" onClick={(event) => event.stopPropagation()}>
              <strong>{currentUserName}</strong>
              <button type="button">个人信息</button>
              <button type="button" onClick={() => setThemeMode((mode) => (mode === "dark" ? "light" : "dark"))}>
                {themeMode === "dark" ? "浅色主题" : "深色主题"}
              </button>
            </div>
          ) : null}
        </div>
        <nav className="growth-rail-actions" aria-label="笔记功能">
          <button className={isTreeVisible ? "active" : ""} type="button" title="我的文件夹" aria-label="我的文件夹" onClick={() => setIsTreeVisible((visible) => !visible)}>
            <FolderRailIcon />
          </button>
        </nav>
      </aside>

      {isTreeVisible ? (
        <section className="growth-tree-panel" aria-label="文件夹树目录" aria-busy={isLoading}>
          <div className="growth-search">
            <input type="search" value={searchQuery} placeholder="搜索笔记 Ctrl+Shift+F" aria-label="搜索文档" onChange={(event) => setSearchQuery(event.target.value)} />
          </div>
          <div className="growth-message" role="status">
            {message}
          </div>
          <div className="growth-tree" onContextMenu={(event) => openContextMenu(event, { kind: "scope", scope: selectedFolder })}>
            {(notesByFolder.get(null) ?? []).map((note) => renderNoteNode(note, 0))}
            {renderFolderTree(null)}
            {!notes.length && !folders.length ? <div className="growth-empty">{isLoading ? "正在加载文档" : "暂无文件夹和文档"}</div> : null}
          </div>
        </section>
      ) : null}

      {isTreeVisible ? (
        <div
          className="growth-tree-resizer"
          role="separator"
          aria-label="调整文件夹区域宽度"
          aria-orientation="vertical"
          aria-valuemin={noteTreeMinWidth}
          aria-valuemax={noteTreeMaxWidth}
          aria-valuenow={Math.round(treeWidth)}
          onPointerDown={handleTreeResizePointerDown}
          onPointerMove={handleTreeResizePointerMove}
          onPointerUp={stopTreeResize}
          onPointerCancel={stopTreeResize}
          onLostPointerCapture={() => setIsTreeResizing(false)}
        />
      ) : null}

      {isOutlinePanelVisible ? (
        <section className="growth-outline-panel" aria-label="文档大纲">
          <header className="growth-outline-header">
            <strong>文档大纲</strong>
            <button type="button" aria-label="关闭文档大纲" onClick={() => setIsOutlineVisible(false)}>
              x
            </button>
          </header>
          <div className="growth-outline-list">
            {outlineItems.length ? (
              outlineItems.map((item) => (
                <button key={`${item.pos}-${item.title}`} className="growth-outline-item" type="button" style={{ "--outline-indent": `${(item.level - 1) * 14}px` } as CSSProperties} onClick={() => handleOutlineItemClick(item.pos)}>
                  <span>{item.title}</span>
                  <small>H{item.level}</small>
                </button>
              ))
            ) : (
              <div className="growth-outline-empty">暂无标题</div>
            )}
          </div>
        </section>
      ) : null}

      <section className="growth-editor" aria-label="文档内容" onKeyDownCapture={handleEditorKeyDown}>
        {selectedNote ? (
          <>
            <header className="growth-editor-titlebar">
              <div className="growth-editor-titlemeta">
                <span className="growth-title-input" title={draftTitle} aria-label="文档标题">
                  {draftTitle}
                </span>
              </div>
              <div className="growth-editor-title-actions" onClick={(event) => event.stopPropagation()}>
                <button type="button" aria-live="polite" disabled={!selectedNote.can_edit || saveStatus === "saving"} onClick={() => void saveSelectedNote()}>
                  {saveStatusText[saveStatus]}
                </button>
                <div className="growth-document-more">
                  <button type="button" className="growth-document-more-button" aria-label="更多文档操作" aria-expanded={isDocumentMenuOpen} onClick={() => setIsDocumentMenuOpen((open) => !open)}>
                    ...
                  </button>
                  {isDocumentMenuOpen ? (
                    <div className="growth-document-menu" role="menu" aria-label="文档操作">
                      <button type="button" role="menuitem" disabled={!richEditorActions} onClick={() => { richEditorActions?.exportHtml(); setIsDocumentMenuOpen(false); }}>导出 HTML</button>
                      <button type="button" role="menuitem" disabled={!richEditorActions} onClick={() => { richEditorActions?.exportPdf(); setIsDocumentMenuOpen(false); }}>导出 PDF</button>
                      <button type="button" role="menuitem" disabled={!richEditorActions} onClick={() => { richEditorActions?.print(); setIsDocumentMenuOpen(false); }}>打印</button>
                    </div>
                  ) : null}
                </div>
              </div>
            </header>
            <RichTextEditor
              content={draftContent}
              editable={canEditSelectedNote}
              onChange={setDraftContent}
              onActionsChange={setRichEditorActions}
              isOutlineOpen={isOutlineVisible}
              onToggleOutline={() => setIsOutlineVisible((visible) => !visible)}
              onOutlineItemsChange={handleOutlineItemsChange}
              onOutlineJumpReady={handleOutlineJumpReady}
            />
          </>
        ) : (
          <div className="growth-empty growth-editor-empty">选择一篇文档查看内容。</div>
        )}
      </section>

      {contextMenu ? (
        <div className="growth-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(event) => event.stopPropagation()}>
          {contextMenu.kind === "folder" ? (
            <>
              <button type="button" onClick={() => { setContextMenu(null); void handleCreateFolder(contextMenu.folder.id); }}>新建文件夹</button>
              <button type="button" onClick={() => { setContextMenu(null); void handleCreateNote(contextMenu.folder.id); }}>新建文档</button>
              <button type="button" onClick={() => openInfoDialog({ kind: "folder", folder: contextMenu.folder })}>文件信息</button>
              <button type="button" disabled={!contextMenu.folder.can_edit} onClick={() => { setContextMenu(null); void handleRenameFolder(contextMenu.folder); }}>重命名</button>
              <button type="button" disabled={!contextMenu.folder.can_edit} onClick={() => openMoveDialog({ kind: "folder", folder: contextMenu.folder })}>移动到</button>
              <button type="button" onClick={() => { setContextMenu(null); void handleCopyFolder(contextMenu.folder); }}>复制</button>
              <button className="danger" type="button" disabled={!contextMenu.folder.can_edit} onClick={() => openDeleteDialog({ kind: "folder", folder: contextMenu.folder })}>删除</button>
            </>
          ) : contextMenu.kind === "note" ? (
            <>
              <button type="button" onClick={() => { selectNote(contextMenu.note.id); setContextMenu(null); }}>打开</button>
              <button type="button" onClick={() => openInfoDialog({ kind: "note", note: contextMenu.note })}>文件信息</button>
              <button type="button" disabled={!contextMenu.note.can_edit} onClick={() => { setContextMenu(null); void handleRenameNote(contextMenu.note); }}>重命名</button>
              <button type="button" disabled={!contextMenu.note.can_edit} onClick={() => openMoveDialog({ kind: "note", note: contextMenu.note })}>移动到</button>
              <button type="button" onClick={() => { setContextMenu(null); void handleCopyNote(contextMenu.note); }}>复制</button>
              <button className="danger" type="button" disabled={!contextMenu.note.can_edit} onClick={() => openDeleteDialog({ kind: "note", note: contextMenu.note })}>删除</button>
            </>
          ) : (
            <>
              <button type="button" disabled={!canCreateInSelectedFolder} onClick={() => { setContextMenu(null); void handleCreateNote(); }}>新建文档</button>
              <button type="button" disabled={!userID} onClick={() => { setContextMenu(null); void handleCreateFolder(typeof contextMenu.scope === "number" ? contextMenu.scope : null); }}>新建文件夹</button>
            </>
          )}
        </div>
      ) : null}

      {moveDialog ? (
        <div className="growth-dialog-backdrop" role="presentation" onClick={() => setMoveDialog(null)}>
          <div className="growth-dialog" role="dialog" aria-modal="true" aria-label="移动到" onClick={(event) => event.stopPropagation()}>
            <strong>移动到</strong>
            <span>{moveDialog.kind === "folder" ? moveDialog.folder.name : moveDialog.note.title}</span>
            <select value={moveTarget} onChange={(event) => setMoveTarget(event.target.value)}>
              <option value="root">{moveDialog.kind === "folder" ? "根目录" : "未归档"}</option>
              {ownedMoveFolders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
            <div>
              <button type="button" onClick={() => setMoveDialog(null)}>取消</button>
              <button type="button" onClick={() => void handleConfirmMove()}>移动</button>
            </div>
          </div>
        </div>
      ) : null}

      {createFolderDialog ? (
        <div className="growth-dialog-backdrop" role="presentation" onClick={() => setCreateFolderDialog(null)}>
          <form className="growth-dialog growth-folder-dialog" role="dialog" aria-modal="true" aria-label="新建文件夹" onClick={(event) => event.stopPropagation()} onSubmit={(event) => void handleConfirmCreateFolder(event)}>
            <strong>新建文件夹</strong>
            <span>{createFolderParent ? `在“${createFolderParent.name}”中新建子文件夹` : "在根目录中新建文件夹"}</span>
            <input value={createFolderName} autoFocus maxLength={80} aria-label="文件夹名称" onChange={(event) => setCreateFolderName(event.target.value)} />
            <div>
              <button type="button" onClick={() => setCreateFolderDialog(null)}>取消</button>
              <button type="submit">创建</button>
            </div>
          </form>
        </div>
      ) : null}

      {createNoteDialog ? (
        <div className="growth-dialog-backdrop" role="presentation" onClick={() => setCreateNoteDialog(null)}>
          <form className="growth-dialog growth-folder-dialog" role="dialog" aria-modal="true" aria-label="新建文档" onClick={(event) => event.stopPropagation()} onSubmit={(event) => void handleConfirmCreateNote(event)}>
            <strong>新建文档</strong>
            <span>{createNoteParent ? `在“${createNoteParent.name}”中新建文档` : "在根目录中新建文档"}</span>
            <input value={createNoteTitle} autoFocus maxLength={120} aria-label="文档标题" onChange={(event) => setCreateNoteTitle(event.target.value)} />
            <div>
              <button type="button" onClick={() => setCreateNoteDialog(null)}>取消</button>
              <button type="submit">创建</button>
            </div>
          </form>
        </div>
      ) : null}

      {renameDialog ? (
        <div className="growth-dialog-backdrop" role="presentation" onClick={() => setRenameDialog(null)}>
          <form className="growth-dialog growth-folder-dialog" role="dialog" aria-modal="true" aria-label={renameDialog.kind === "folder" ? "重命名文件夹" : "重命名文档"} onClick={(event) => event.stopPropagation()} onSubmit={(event) => void handleConfirmRename(event)}>
            <strong>{renameDialog.kind === "folder" ? "重命名文件夹" : "重命名文档"}</strong>
            <span>{renameDialog.kind === "folder" ? "请输入新的文件夹名称" : "请输入新的文档标题"}</span>
            <input value={renameValue} autoFocus maxLength={renameDialog.kind === "folder" ? 80 : 120} aria-label={renameDialog.kind === "folder" ? "文件夹名称" : "文档标题"} onChange={(event) => setRenameValue(event.target.value)} />
            <div>
              <button type="button" onClick={() => setRenameDialog(null)}>取消</button>
              <button type="submit">保存</button>
            </div>
          </form>
        </div>
      ) : null}

      {deleteDialog ? (
        <div className="growth-dialog-backdrop" role="presentation" onClick={() => setDeleteDialog(null)}>
          <div className="growth-dialog growth-delete-dialog" role="dialog" aria-modal="true" aria-label={deleteDialog.kind === "folder" ? "删除文件夹" : "删除文档"} onClick={(event) => event.stopPropagation()}>
            <strong>{deleteDialog.kind === "folder" ? "删除文件夹" : "删除文档"}</strong>
            <span>
              {deleteDialog.kind === "folder"
                ? `确定删除“${deleteDialog.folder.name}”吗？子文件夹会一起删除，里面的文档会移动到未归档。`
                : `确定删除“${deleteDialog.note.title}”吗？删除后这篇文档会消失。`}
            </span>
            <div>
              <button type="button" onClick={() => setDeleteDialog(null)}>取消</button>
              <button className="danger" type="button" onClick={() => void (deleteDialog.kind === "folder" ? handleDeleteFolder(deleteDialog.folder) : handleDeleteNote(deleteDialog.note))}>删除</button>
            </div>
          </div>
        </div>
      ) : null}

      {infoDialog ? (
        <div className="growth-dialog-backdrop" role="presentation" onClick={() => setInfoDialog(null)}>
          <div className="growth-dialog growth-info-dialog" role="dialog" aria-modal="true" aria-label="文件信息" onClick={(event) => event.stopPropagation()}>
            <strong>文件信息</strong>
            {infoDialog.kind === "folder" ? (
              <dl>
                <div>
                  <dt>类型</dt>
                  <dd>文件夹</dd>
                </div>
                <div>
                  <dt>名称</dt>
                  <dd>{infoDialog.folder.name}</dd>
                </div>
                <div>
                  <dt>创建者</dt>
                  <dd>{infoDialog.folder.owner_nickname}</dd>
                </div>
                <div>
                  <dt>文档数量</dt>
                  <dd>{infoDialog.folder.note_count} 篇</dd>
                </div>
                <div>
                  <dt>创建时间</dt>
                  <dd>{formatDateTime(infoDialog.folder.created_at)}</dd>
                </div>
                <div>
                  <dt>更新时间</dt>
                  <dd>{formatDateTime(infoDialog.folder.updated_at)}</dd>
                </div>
              </dl>
            ) : (
              <dl>
                <div>
                  <dt>类型</dt>
                  <dd>文档</dd>
                </div>
                <div>
                  <dt>名称</dt>
                  <dd>{infoDialog.note.title}</dd>
                </div>
                <div>
                  <dt>创建者</dt>
                  <dd>{infoDialog.note.owner_nickname}</dd>
                </div>
                <div>
                  <dt>创建时间</dt>
                  <dd>{formatDateTime(infoDialog.note.created_at)}</dd>
                </div>
                <div>
                  <dt>更新时间</dt>
                  <dd>{formatDateTime(infoDialog.note.updated_at)}</dd>
                </div>
              </dl>
            )}
            <div>
              <button type="button" onClick={() => setInfoDialog(null)}>关闭</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

const MemoizedGrowthNotesPage = memo(GrowthNotesPage);

const richTextExtensions = [
  StarterKit.configure({
    link: false,
    underline: false,
    codeBlock: {
      HTMLAttributes: {
        class: "rich-code-block"
      }
    }
  }),
  RichBlockStyle,
  Underline,
  Superscript,
  Subscript,
  TextStyle,
  FontSize,
  FontFamily.configure({
    types: ["textStyle"]
  }),
  Color.configure({
    types: ["textStyle"]
  }),
  Highlight.configure({
    multicolor: true
  }),
  TextAlign.configure({
    types: ["heading", "paragraph"]
  }),
  Link.configure({
    openOnClick: false,
    autolink: true,
    defaultProtocol: "https"
  }),
  RichImage.configure({
    allowBase64: true,
    HTMLAttributes: {
      class: "growth-rich-image"
    }
  }),
  TaskList,
  TaskItem.configure({
    nested: true
  }),
  Table.configure({
    resizable: true,
    allowTableNodeSelection: true
  }),
  TableRow,
  TableHeader,
  TableCell
];

const richDeletableNodeNames = new Set(["horizontalRule", "image", "table"]);

const richFontFamilies = [
  { label: "默认字体", value: "" },
  { label: "思源黑体", value: "\"Noto Sans SC\", \"Source Han Sans SC\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif" },
  { label: "霞鹜文楷", value: "\"LXGW WenKai Screen\", \"Noto Sans SC\", sans-serif" },
  { label: "微软雅黑", value: "\"Microsoft YaHei\", \"Noto Sans SC\", sans-serif" },
  { label: "苹方", value: "\"PingFang SC\", \"Noto Sans SC\", sans-serif" },
  { label: "黑体", value: "SimHei, \"Microsoft YaHei\", sans-serif" },
  { label: "宋体", value: "SimSun, \"Songti SC\", serif" },
  { label: "仿宋", value: "FangSong, \"FangSong_GB2312\", serif" },
  { label: "楷体", value: "KaiTi, \"Kaiti SC\", serif" },
  { label: "等线", value: "DengXian, \"Microsoft YaHei\", sans-serif" },
  { label: "Arial", value: "Arial, sans-serif" },
  { label: "Helvetica", value: "Helvetica, Arial, sans-serif" },
  { label: "Verdana", value: "Verdana, Geneva, sans-serif" },
  { label: "Tahoma", value: "Tahoma, Geneva, sans-serif" },
  { label: "Times New Roman", value: "\"Times New Roman\", Times, serif" },
  { label: "Georgia", value: "Georgia, \"Times New Roman\", serif" },
  { label: "Consolas", value: "Consolas, \"Courier New\", monospace" },
  { label: "Courier New", value: "\"Courier New\", Courier, monospace" }
];

function getRichFontSelectWidth(label: string) {
  const visualUnits = Array.from(label).reduce((total, char) => {
    if (char === " ") {
      return total + 0.35;
    }
    return total + (/^[\x00-\x7F]$/.test(char) ? 0.62 : 1);
  }, 0);
  return `${Math.round(Math.min(132, Math.max(74, visualUnits * 13 + 28)))}px`;
}

const richFontSizes = ["12", "14", "16", "18", "22", "28", "36"];
type RichHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
const richHeadingLevels: RichHeadingLevel[] = [1, 2, 3, 4, 5, 6];
const richLineHeightOptions = [
  { label: "默认行距", value: "" },
  { label: "1.0", value: "1" },
  { label: "1.15", value: "1.15" },
  { label: "1.5", value: "1.5" },
  { label: "2.0", value: "2" }
];
const richParagraphSpacingOptions = [
  { label: "默认段距", value: "" },
  { label: "紧凑", value: "compact", marginTop: null, marginBottom: "0.35em" },
  { label: "标准", value: "normal", marginTop: null, marginBottom: "0.85em" },
  { label: "宽松", value: "loose", marginTop: "0.45em", marginBottom: "1.25em" },
  { label: "无段距", value: "none", marginTop: "0", marginBottom: "0" }
];
const richPalettePrimary = ["transparent", "#000000", "#ff120d", "#ff9800", "#ffdb00", "#75f000", "#65cdea", "#4038c9", "#df39f2"];
const richPaletteRows = [
  ["#dedede", "#8a8a8a", "#ffc7b8", "#ffdca4", "#ffefbc", "#d9edd1", "#d8f3fb", "#d4c9f4", "#f6d9f6"],
  ["#cfcfcf", "#656565", "#f4a29d", "#ffbc62", "#ffe082", "#b9df99", "#83d6e3", "#9d85e8", "#e778eb"],
  ["#b8b8b8", "#3e3e3e", "#e35d5b", "#ff8a00", "#ffd13a", "#76bc24", "#10b7d4", "#4244b5", "#c33cdf"],
  ["#9b9b9b", "#202020", "#d91109", "#e85e00", "#ffae00", "#5f9800", "#1387ee", "#29369e", "#a91bd2"]
];
const richRecentColors = ["#000000", "transparent", "transparent", "transparent", "transparent", "transparent", "transparent", "transparent", "transparent"];
type RichSelectionBox = { left: number; top: number; width: number; height: number };
type RichContextMenuPosition = { x: number; y: number; imagePos?: number; tablePos?: number; tableClickPos?: number; dividerPos?: number };
type RichDragState = {
  active: boolean;
  pointerId: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
};
type RichTableAction = "addColumnBefore" | "addColumnAfter" | "deleteColumn" | "addRowBefore" | "addRowAfter" | "deleteRow" | "toggleHeaderRow" | "mergeCells" | "splitCell" | "deleteTable";
type RichTextMatch = { from: number; to: number };
type RichOutlineItem = { level: number; title: string; pos: number };
type RichOutlineJumpHandler = (pos: number) => void;
type RichFindDialogMode = "find" | "replace";
type RichFindDialogState = { mode: RichFindDialogMode; seed: number };

function readImageFileAsDataURL(file: File) {
  return new Promise<string>((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("请选择图片文件"));
      return;
    }
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const src = typeof reader.result === "string" ? reader.result : "";
      if (!src) {
        reject(new Error("图片读取失败"));
        return;
      }
      resolve(src);
    });
    reader.addEventListener("error", () => reject(new Error("图片读取失败")));
    reader.readAsDataURL(file);
  });
}

async function insertRichImageFilesIntoView(view: EditorView, files: File[]) {
  const imageType = view.state.schema.nodes.image;
  if (!imageType || !files.length) {
    return;
  }
  for (const file of files) {
    const src = await readImageFileAsDataURL(file);
    const node = imageType.create({ src, alt: file.name, align: "center" });
    view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView());
  }
  view.focus();
}

function getImageFilesFromList(files: FileList | File[]) {
  return Array.from(files).filter((file) => file.type.startsWith("image/"));
}

function getImageFilesFromClipboard(dataTransfer: DataTransfer | null) {
  if (!dataTransfer) {
    return [];
  }
  const files = getImageFilesFromList(dataTransfer.files);
  if (files.length) {
    return files;
  }
  return Array.from(dataTransfer.items)
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
}

function escapeRichPasteHtml(text: string) {
  const element = document.createElement("div");
  element.textContent = text;
  return element.innerHTML;
}

function isSafeRichPasteUrl(value: string, allowImageData = false) {
  const url = value.trim();
  if (!url) {
    return false;
  }
  if (allowImageData && /^data:image\/(?:png|gif|jpe?g|webp|svg\+xml);/i.test(url)) {
    return true;
  }
  if (allowImageData && url.startsWith("blob:")) {
    return true;
  }
  try {
    const parsed = new URL(url, window.location.origin);
    return ["http:", "https:", "mailto:", "tel:"].includes(parsed.protocol);
  } catch {
    return url.startsWith("#") || url.startsWith("/");
  }
}

function isSafeRichPasteLength(value: string) {
  return /^\d+(?:\.\d+)?(?:px|%|em|rem|vw|vh)?$/i.test(value.trim());
}

function hasRichPasteBlockChild(element: Element) {
  return Array.from(element.children).some((child) => {
    const tagName = child.tagName.toLowerCase();
    return ["address", "article", "aside", "blockquote", "div", "figure", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "ol", "p", "pre", "section", "table", "ul"].includes(tagName);
  });
}

function appendRichPasteChildren(parent: HTMLElement | DocumentFragment, source: Element) {
  for (const child of Array.from(source.childNodes)) {
    appendSanitizedRichPasteNode(parent, child);
  }
}

function appendStyledRichPasteChildren(parent: HTMLElement | DocumentFragment, source: HTMLElement) {
  const style = source.style;
  const wrappers: string[] = [];
  const fontWeight = Number.parseInt(style.fontWeight, 10);
  const textDecoration = style.textDecorationLine || style.textDecoration || "";
  if (style.fontWeight === "bold" || Number.isFinite(fontWeight) && fontWeight >= 600) {
    wrappers.push("strong");
  }
  if (style.fontStyle === "italic" || style.fontStyle === "oblique") {
    wrappers.push("em");
  }
  if (textDecoration.includes("underline")) {
    wrappers.push("u");
  }
  if (textDecoration.includes("line-through")) {
    wrappers.push("s");
  }
  let target: HTMLElement | DocumentFragment = parent;
  for (const wrapper of wrappers) {
    const element = document.createElement(wrapper);
    target.append(element);
    target = element;
  }
  appendRichPasteChildren(target, source);
}

function appendSanitizedRichPasteNode(parent: HTMLElement | DocumentFragment, source: Node) {
  if (source.nodeType === Node.TEXT_NODE) {
    const text = (source.textContent ?? "").replace(/\u00a0/g, " ");
    if (text) {
      parent.append(document.createTextNode(text));
    }
    return;
  }
  if (!(source instanceof HTMLElement)) {
    return;
  }
  const sourceTag = source.tagName.toLowerCase();
  if (["base", "head", "iframe", "input", "link", "meta", "noscript", "object", "script", "style", "svg", "title"].includes(sourceTag)) {
    return;
  }
  const tag = sourceTag === "b" ? "strong" : sourceTag === "i" ? "em" : ["del", "strike"].includes(sourceTag) ? "s" : sourceTag;
  if (["br", "hr"].includes(tag)) {
    parent.append(document.createElement(tag));
    return;
  }
  if (tag === "img") {
    const src = source.getAttribute("src") ?? "";
    if (!isSafeRichPasteUrl(src, true)) {
      return;
    }
    const image = document.createElement("img");
    image.setAttribute("src", src);
    const alt = source.getAttribute("alt")?.trim();
    if (alt) {
      image.setAttribute("alt", alt);
    }
    const width = source.getAttribute("data-width") || source.style.width || source.getAttribute("width") || "";
    if (width && isSafeRichPasteLength(width)) {
      const normalizedWidth = /^\d+(?:\.\d+)?$/.test(width) ? `${width}px` : width;
      image.setAttribute("data-width", normalizedWidth);
      image.style.width = normalizedWidth;
    }
    const align = source.getAttribute("data-align");
    if (align && ["left", "center", "right"].includes(align)) {
      image.setAttribute("data-align", align);
    }
    parent.append(image);
    return;
  }
  if (tag === "a") {
    const href = source.getAttribute("href") ?? "";
    if (!isSafeRichPasteUrl(href)) {
      appendRichPasteChildren(parent, source);
      return;
    }
    const link = document.createElement("a");
    link.setAttribute("href", href.trim());
    appendRichPasteChildren(link, source);
    parent.append(link);
    return;
  }
  if (tag === "pre") {
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = (source.textContent ?? "").replace(/\n{3,}/g, "\n\n").trimEnd();
    pre.append(code);
    parent.append(pre);
    return;
  }
  const allowedTags = new Set(["blockquote", "code", "em", "h1", "h2", "h3", "h4", "h5", "h6", "li", "ol", "p", "s", "strong", "sub", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul"]);
  const normalizedTag = tag === "div" && !hasRichPasteBlockChild(source) ? "p" : tag;
  if (!allowedTags.has(normalizedTag)) {
    appendStyledRichPasteChildren(parent, source);
    return;
  }
  const element = document.createElement(normalizedTag);
  if (normalizedTag === "ul" && source.getAttribute("data-type") === "taskList") {
    element.setAttribute("data-type", "taskList");
  }
  if (normalizedTag === "li" && source.hasAttribute("data-checked")) {
    element.setAttribute("data-checked", source.getAttribute("data-checked") === "true" ? "true" : "false");
  }
  if (["td", "th"].includes(normalizedTag)) {
    for (const attribute of ["colspan", "rowspan"]) {
      const value = source.getAttribute(attribute);
      if (value && /^\d+$/.test(value)) {
        element.setAttribute(attribute, value);
      }
    }
  }
  appendStyledRichPasteChildren(element, source);
  if (normalizedTag === "p" && !element.textContent?.trim() && !element.querySelector("br,img")) {
    return;
  }
  parent.append(element);
}

function sanitizeRichPastedHtml(html: string) {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const fragment = document.createDocumentFragment();
  for (const child of Array.from(parsed.body.childNodes)) {
    appendSanitizedRichPasteNode(fragment, child);
  }
  const container = document.createElement("div");
  container.append(fragment);
  container.querySelectorAll("p,li,blockquote").forEach((element) => {
    element.innerHTML = element.innerHTML.replace(/(?:\s*<br\s*\/?>\s*){3,}/gi, "<br><br>");
  });
  return container.innerHTML.trim();
}

function joinRichPasteParagraphLines(lines: string[]) {
  return lines.reduce((result, line) => {
    const text = line.trim();
    if (!result) {
      return text;
    }
    const shouldJoinDirectly = /[\u4e00-\u9fff，。！？；：、“”（）《》]$/.test(result) && /^[\u4e00-\u9fff，。！？；：、“”（）《》]/.test(text);
    return `${result}${shouldJoinDirectly ? "" : " "}${text}`;
  }, "");
}

function createRichPasteHtmlFromPlainText(text: string) {
  const normalizedText = text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u200b-\u200f\u202a-\u202e]/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/\t/g, "  ")
    .split("\n")
    .map((line) => line.replace(/\s+$/g, ""))
    .join("\n")
    .trim();
  if (!normalizedText) {
    return "";
  }
  const singleLineBlockStarter = /^(#{1,6}\s+|>\s+|[-*]\s+\[[ xX]\]\s+|[-*•]\s+|\d+[.)、]\s+|`{3,}|-{3,}$|\*{3,}$|_{3,}$)/.test(normalizedText.trim());
  if (!normalizedText.includes("\n") && !singleLineBlockStarter) {
    return escapeRichPasteHtml(normalizedText);
  }
  const lines = normalizedText.split("\n");
  const blocks: string[] = [];
  let index = 0;
  const isBlank = (line: string) => !line.trim();
  const isBlockStarter = (line: string) => /^(#{1,6}\s+|>\s+|[-*]\s+\[[ xX]\]\s+|[-*•]\s+|\d+[.)、]\s+|`{3,}|-{3,}$|\*{3,}$|_{3,}$)/.test(line.trim());
  while (index < lines.length) {
    while (index < lines.length && isBlank(lines[index])) {
      index += 1;
    }
    if (index >= lines.length) {
      break;
    }
    const trimmed = lines[index].trim();
    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      blocks.push(`<h${heading[1].length}>${escapeRichPasteHtml(heading[2].trim())}</h${heading[1].length}>`);
      index += 1;
      continue;
    }
    if (/^(`{3,}|~~~)/.test(trimmed)) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !/^(`{3,}|~~~)/.test(lines[index].trim())) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push(`<pre><code>${escapeRichPasteHtml(codeLines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd())}</code></pre>`);
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push("<hr>");
      index += 1;
      continue;
    }
    if (trimmed.startsWith(">")) {
      const quoteLines: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith(">")) {
        quoteLines.push(lines[index].trim().replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(`<blockquote><p>${escapeRichPasteHtml(joinRichPasteParagraphLines(quoteLines))}</p></blockquote>`);
      continue;
    }
    const taskMatch = trimmed.match(/^[-*]\s+\[([ xX])\]\s+(.+)$/);
    if (taskMatch) {
      const items: string[] = [];
      while (index < lines.length) {
        const match = lines[index].trim().match(/^[-*]\s+\[([ xX])\]\s+(.+)$/);
        if (!match) {
          break;
        }
        items.push(`<li data-checked="${match[1].toLowerCase() === "x" ? "true" : "false"}"><p>${escapeRichPasteHtml(match[2].trim())}</p></li>`);
        index += 1;
      }
      blocks.push(`<ul data-type="taskList">${items.join("")}</ul>`);
      continue;
    }
    const unorderedMatch = trimmed.match(/^[-*•]\s+(.+)$/);
    if (unorderedMatch) {
      const items: string[] = [];
      while (index < lines.length) {
        const match = lines[index].trim().match(/^[-*•]\s+(.+)$/);
        if (!match) {
          break;
        }
        items.push(`<li><p>${escapeRichPasteHtml(match[1].trim())}</p></li>`);
        index += 1;
      }
      blocks.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    const orderedMatch = trimmed.match(/^(\d+)[.)、]\s+(.+)$/);
    if (orderedMatch) {
      const items: string[] = [];
      const start = Number(orderedMatch[1]);
      while (index < lines.length) {
        const match = lines[index].trim().match(/^\d+[.)、]\s+(.+)$/);
        if (!match) {
          break;
        }
        items.push(`<li><p>${escapeRichPasteHtml(match[1].trim())}</p></li>`);
        index += 1;
      }
      blocks.push(`<ol${start > 1 ? ` start="${start}"` : ""}>${items.join("")}</ol>`);
      continue;
    }
    const paragraphLines: string[] = [];
    while (index < lines.length && !isBlank(lines[index]) && (paragraphLines.length === 0 || !isBlockStarter(lines[index]))) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    blocks.push(`<p>${escapeRichPasteHtml(joinRichPasteParagraphLines(paragraphLines))}</p>`);
  }
  return blocks.join("");
}

function createOptimizedRichPasteHtml(html: string, text: string) {
  const cleanedHtml = html.trim() ? sanitizeRichPastedHtml(html) : "";
  if (cleanedHtml) {
    return cleanedHtml;
  }
  return createRichPasteHtmlFromPlainText(text);
}

function insertRichPasteHtmlIntoView(view: EditorView, html: string) {
  const container = document.createElement("div");
  container.innerHTML = html;
  const slice = ProseMirrorDOMParser.fromSchema(view.state.schema).parseSlice(container);
  view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
  view.focus();
}

function findRichTextMatches(editor: Editor, query: string): RichTextMatch[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) {
    return [];
  }
  const chars: Array<{ char: string; pos: number }> = [];
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) {
      return;
    }
    Array.from(node.text).forEach((char, index) => {
      chars.push({ char: char.toLocaleLowerCase(), pos: pos + index });
    });
  });
  const haystack = chars.map((item) => item.char).join("");
  const matches: RichTextMatch[] = [];
  let index = haystack.indexOf(needle);
  while (index >= 0) {
    const endIndex = index + needle.length - 1;
    if (chars[index] && chars[endIndex]) {
      matches.push({ from: chars[index].pos, to: chars[endIndex].pos + 1 });
    }
    index = haystack.indexOf(needle, index + Math.max(1, needle.length));
  }
  return matches;
}

function selectRichTextMatch(editor: Editor, match: RichTextMatch) {
  const doc = editor.state.doc;
  const from = Math.max(0, Math.min(match.from, doc.content.size));
  const to = Math.max(from, Math.min(match.to, doc.content.size));
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(doc, from, to)).scrollIntoView());
  editor.view.focus();
}

function getRichOutlineItems(editor: Editor): RichOutlineItem[] {
  const items: RichOutlineItem[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== "heading") {
      return;
    }
    const title = node.textContent.trim();
    if (!title) {
      return;
    }
    items.push({ level: Number(node.attrs.level) || 1, title, pos });
  });
  return items;
}

function areRichOutlineItemsEqual(first: RichOutlineItem[], second: RichOutlineItem[]) {
  if (first.length !== second.length) {
    return false;
  }
  return first.every((item, index) => {
    const candidate = second[index];
    return item.level === candidate.level && item.title === candidate.title && item.pos === candidate.pos;
  });
}

function RichTextEditor({
  content,
  editable,
  onChange,
  onActionsChange,
  isOutlineOpen,
  onToggleOutline,
  onOutlineItemsChange,
  onOutlineJumpReady
}: {
  content: string;
  editable: boolean;
  onChange: (content: string) => void;
  onActionsChange?: (actions: RichEditorActions | null) => void;
  isOutlineOpen: boolean;
  onToggleOutline: () => void;
  onOutlineItemsChange?: (items: RichOutlineItem[]) => void;
  onOutlineJumpReady?: (jump: RichOutlineJumpHandler | null) => void;
}) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const replaceImageInputRef = useRef<HTMLInputElement | null>(null);
  const replaceImagePosRef = useRef<number | null>(null);
  const dragStateRef = useRef<RichDragState | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const suppressContextMenuUntilRef = useRef(0);
  const selectedBlocksRef = useRef<HTMLElement[]>([]);
  const [selectionBox, setSelectionBox] = useState<RichSelectionBox | null>(null);
  const [selectionToolbar, setSelectionToolbar] = useState<{ x: number; y: number } | null>(null);
  const [selectedBlockCount, setSelectedBlockCount] = useState(0);
  const [editorContextMenu, setEditorContextMenu] = useState<RichContextMenuPosition | null>(null);
  const [findDialog, setFindDialog] = useState<RichFindDialogState | null>(null);
  function openRichFindDialog(mode: RichFindDialogMode) {
    setEditorContextMenu(null);
    clearRichBlockSelection();
    setFindDialog((current) => ({ mode, seed: (current?.seed ?? 0) + 1 }));
  }
  const editor = useEditor({
    extensions: richTextExtensions,
    content: content || "",
    editable,
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: "growth-rich-editor-content"
      },
      handleClickOn(view, pos, node, nodePos, event, direct) {
        if (!direct || !richDeletableNodeNames.has(node.type.name)) {
          return false;
        }
        event.preventDefault();
        return selectRichNodeInView(view, nodePos);
      },
      handleClick(view, pos, event) {
        if (!(event.target instanceof HTMLElement) || event.target.closest("hr") === null) {
          return false;
        }
        const dividerContext = findRichDeletableNodeNearViewPos(view, pos, "horizontalRule");
        if (!dividerContext) {
          return false;
        }
        event.preventDefault();
        return selectRichNodeInView(view, dividerContext.pos);
      },
      handleDoubleClickOn(view, pos, node, nodePos, event) {
        if (!richDeletableNodeNames.has(node.type.name)) {
          return false;
        }
        event.preventDefault();
        return selectRichNodeInView(view, nodePos);
      },
      handleKeyDown(view, event) {
        if (event.key !== "Backspace" && event.key !== "Delete") {
          return false;
        }
        const { selection } = view.state;
        if (!(selection instanceof NodeSelection) || !richDeletableNodeNames.has(selection.node.type.name)) {
          return false;
        }
        event.preventDefault();
        clearRichBlockSelection();
        setEditorContextMenu(null);
        view.dispatch(view.state.tr.deleteSelection().scrollIntoView());
        return true;
      },
      handlePaste(view, event) {
        if (!editable) {
          return false;
        }
        const imageFiles = getImageFilesFromClipboard(event.clipboardData);
        if (imageFiles.length) {
          event.preventDefault();
          void insertRichImageFilesIntoView(view, imageFiles).catch((error) => window.alert(error instanceof Error ? error.message : "图片读取失败"));
          return true;
        }
        const pasteHtml = createOptimizedRichPasteHtml(event.clipboardData?.getData("text/html") ?? "", event.clipboardData?.getData("text/plain") ?? "");
        if (!pasteHtml) {
          return false;
        }
        event.preventDefault();
        clearRichBlockSelection();
        setEditorContextMenu(null);
        insertRichPasteHtmlIntoView(view, pasteHtml);
        return true;
      },
      handleDrop(view, event) {
        if (!editable) {
          return false;
        }
        const imageFiles = getImageFilesFromList(event.dataTransfer?.files ?? []);
        if (!imageFiles.length) {
          return false;
        }
        event.preventDefault();
        void insertRichImageFilesIntoView(view, imageFiles).catch((error) => window.alert(error instanceof Error ? error.message : "图片读取失败"));
        return true;
      }
    }
  });

  const jumpToOutlineItem = useCallback((pos: number) => {
    if (!editor) {
      return;
    }
    const doc = editor.state.doc;
    const safePos = Math.max(0, Math.min(pos + 1, doc.content.size));
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(doc.resolve(safePos))).scrollIntoView());
    editor.view.focus();
  }, [editor]);

  useEffect(() => {
    if (!editor || !onActionsChange) {
      onActionsChange?.(null);
      return;
    }
    const createDocumentHtml = (title: string) =>
      `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${title}</title><style>body{font-family:Arial,'Noto Sans SC',sans-serif;line-height:1.7;padding:32px;color:#172033}img{max-width:100%;height:auto}table{width:100%;border-collapse:collapse}td,th{border:1px solid #d7dde7;padding:8px}</style></head><body>${editor.getHTML()}</body></html>`;
    const printDocument = (title: string) => {
      const iframe = document.createElement("iframe");
      iframe.setAttribute("title", title);
      iframe.style.position = "fixed";
      iframe.style.right = "0";
      iframe.style.bottom = "0";
      iframe.style.width = "0";
      iframe.style.height = "0";
      iframe.style.border = "0";
      iframe.style.opacity = "0";
      iframe.style.pointerEvents = "none";
      document.body.appendChild(iframe);

      const cleanup = () => {
        window.setTimeout(() => iframe.remove(), 0);
      };
      const printWindow = iframe.contentWindow;
      const frameDocument = iframe.contentDocument ?? printWindow?.document;
      if (!printWindow || !frameDocument) {
        cleanup();
        window.alert("无法创建打印内容");
        return;
      }

      printWindow.addEventListener("afterprint", cleanup, { once: true });
      window.setTimeout(cleanup, 60_000);
      frameDocument.open();
      frameDocument.write(createDocumentHtml(title));
      frameDocument.close();

      try {
        printWindow.focus();
        printWindow.print();
      } catch {
        cleanup();
        window.alert("浏览器未能打开打印面板");
      }
    };
    onActionsChange({
      exportHtml: () => {
        const html = createDocumentHtml("文档导出");
        const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `document-${new Date().toISOString().slice(0, 10)}.html`;
        anchor.click();
        URL.revokeObjectURL(url);
      },
      exportPdf: () => printDocument("导出 PDF"),
      print: () => printDocument("打印文档")
    });
    return () => onActionsChange(null);
  }, [editor, onActionsChange]);

  useEffect(() => {
    if (!editor) {
      return;
    }
    editor.setEditable(editable);
  }, [editable, editor]);

  useEffect(() => {
    if (!editor) {
      return;
    }
    const nextContent = content || "";
    if (editor.getHTML() !== nextContent) {
      editor.commands.setContent(nextContent, { emitUpdate: false });
    }
    onOutlineItemsChange?.(getRichOutlineItems(editor));
  }, [content, editor, onOutlineItemsChange]);

  useEffect(() => {
    if (!editor || !onOutlineItemsChange) {
      return;
    }
    const syncOutlineItems = () => onOutlineItemsChange(getRichOutlineItems(editor));
    syncOutlineItems();
    editor.on("update", syncOutlineItems);
    return () => {
      editor.off("update", syncOutlineItems);
    };
  }, [editor, onOutlineItemsChange]);

  useEffect(() => {
    onOutlineJumpReady?.(editor ? jumpToOutlineItem : null);
    return () => onOutlineJumpReady?.(null);
  }, [editor, jumpToOutlineItem, onOutlineJumpReady]);

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current !== null) {
        window.clearTimeout(longPressTimerRef.current);
      }
      clearRichBlockSelection();
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setEditorContextMenu(null);
      }
      if (!selectedBlocksRef.current.length) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        clearRichBlockSelection();
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        deleteSelectedRichBlocks();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
        event.preventDefault();
        void copySelectedRichBlocks(false);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "x") {
        event.preventDefault();
        void copySelectedRichBlocks(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editor]);

  useEffect(() => {
    const closeContextMenu = () => setEditorContextMenu(null);
    window.addEventListener("click", closeContextMenu);
    window.addEventListener("scroll", closeContextMenu, true);
    window.addEventListener("resize", closeContextMenu);
    return () => {
      window.removeEventListener("click", closeContextMenu);
      window.removeEventListener("scroll", closeContextMenu, true);
      window.removeEventListener("resize", closeContextMenu);
    };
  }, []);

  function getRichEditorRoot() {
    return shellRef.current?.querySelector(".growth-rich-editor-content") as HTMLElement | null;
  }

  function getRichSelectableBlocks() {
    const root = getRichEditorRoot();
    if (!root) {
      return [];
    }
    return Array.from(root.children).filter((element): element is HTMLElement => element instanceof HTMLElement);
  }

  function isExpectedRichDeletableNode(node: ProseMirrorNode, expectedName?: string) {
    return richDeletableNodeNames.has(node.type.name) && (!expectedName || node.type.name === expectedName);
  }

  function findRichDeletableNodeNearViewPos(view: EditorView, pos: number, expectedName?: string) {
    const doc = view.state.doc;
    const safePos = Math.min(Math.max(pos, 0), doc.content.size);
    const candidatePositions = [safePos, safePos - 1, safePos + 1].filter((candidate) => candidate >= 0 && candidate <= doc.content.size);
    const seenPositions = new Set<number>();
    for (const candidate of candidatePositions) {
      if (seenPositions.has(candidate)) {
        continue;
      }
      seenPositions.add(candidate);
      const node = doc.nodeAt(candidate);
      if (node && isExpectedRichDeletableNode(node, expectedName)) {
        return { pos: candidate, node };
      }
    }
    const parent = findParentNodeClosestToPos(doc.resolve(safePos), (node) => isExpectedRichDeletableNode(node, expectedName));
    return parent ? { pos: parent.pos, node: parent.node } : null;
  }

  function findRichDeletableNodeAtClientPoint(clientX: number, clientY: number, expectedName?: string) {
    if (!editor) {
      return null;
    }
    const position = editor.view.posAtCoords({ left: clientX, top: clientY });
    return position ? findRichDeletableNodeNearViewPos(editor.view, position.pos, expectedName) : null;
  }

  function selectRichNodeInView(view: EditorView, nodePos: number) {
    const node = view.state.doc.nodeAt(nodePos);
    if (!node || !richDeletableNodeNames.has(node.type.name)) {
      return false;
    }
    clearRichBlockSelection();
    setEditorContextMenu(null);
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, nodePos)).scrollIntoView());
    view.focus();
    return true;
  }

  function selectRichNodeAtPos(nodePos: number | undefined, expectedName?: string) {
    if (!editor) {
      return false;
    }
    if (nodePos === undefined) {
      return false;
    }
    const node = editor.state.doc.nodeAt(nodePos);
    if (!node || !isExpectedRichDeletableNode(node, expectedName)) {
      return false;
    }
    return selectRichNodeInView(editor.view, nodePos);
  }

  function deleteRichNodeAtPos(nodePos: number | undefined, expectedName?: string) {
    setEditorContextMenu(null);
    if (!editable || !editor || nodePos === undefined) {
      return;
    }
    const node = editor.state.doc.nodeAt(nodePos);
    if (!node || !isExpectedRichDeletableNode(node, expectedName)) {
      return;
    }
    clearRichBlockSelection();
    editor.view.dispatch(editor.state.tr.delete(nodePos, nodePos + node.nodeSize).scrollIntoView());
    editor.view.focus();
  }

  function updateRichImageAtPos(nodePos: number | undefined, attributes: Record<string, string | null>) {
    setEditorContextMenu(null);
    if (!editable || !editor || nodePos === undefined) {
      return;
    }
    const node = editor.state.doc.nodeAt(nodePos);
    if (!node || node.type.name !== "image") {
      return;
    }
    editor.view.dispatch(editor.state.tr.setNodeMarkup(nodePos, undefined, { ...node.attrs, ...attributes }).scrollIntoView());
    editor.view.focus();
  }

  function openReplaceRichImage(nodePos: number | undefined) {
    setEditorContextMenu(null);
    if (!editable || nodePos === undefined) {
      return;
    }
    replaceImagePosRef.current = nodePos;
    replaceImageInputRef.current?.click();
  }

  function handleReplaceRichImageChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    const nodePos = replaceImagePosRef.current;
    replaceImagePosRef.current = null;
    if (!file || !editor || nodePos === null) {
      return;
    }
    void readImageFileAsDataURL(file)
      .then((src) => updateRichImageAtPos(nodePos, { src, alt: file.name }))
      .catch((error) => window.alert(error instanceof Error ? error.message : "图片读取失败"));
  }

  function focusRichTableAtPos(clickPos: number | undefined) {
    if (!editor || clickPos === undefined) {
      return;
    }
    const doc = editor.state.doc;
    const safePos = Math.min(Math.max(clickPos, 0), doc.content.size);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(doc.resolve(safePos))).scrollIntoView());
  }

  function runRichTableCommand(action: RichTableAction, clickPos: number | undefined) {
    setEditorContextMenu(null);
    if (!editable || !editor) {
      return;
    }
    focusRichTableAtPos(clickPos);
    const chain = editor.chain().focus();
    switch (action) {
      case "addColumnBefore":
        chain.addColumnBefore().run();
        break;
      case "addColumnAfter":
        chain.addColumnAfter().run();
        break;
      case "deleteColumn":
        chain.deleteColumn().run();
        break;
      case "addRowBefore":
        chain.addRowBefore().run();
        break;
      case "addRowAfter":
        chain.addRowAfter().run();
        break;
      case "deleteRow":
        chain.deleteRow().run();
        break;
      case "toggleHeaderRow":
        chain.toggleHeaderRow().run();
        break;
      case "mergeCells":
        chain.mergeCells().run();
        break;
      case "splitCell":
        chain.splitCell().run();
        break;
      case "deleteTable":
        chain.deleteTable().run();
        break;
    }
  }

  function clearRichBlockSelection() {
    for (const block of selectedBlocksRef.current) {
      block.classList.remove("rich-block-selected");
    }
    selectedBlocksRef.current = [];
    setSelectedBlockCount(0);
    setSelectionBox(null);
    setSelectionToolbar(null);
  }

  function syncContentFromDom() {
    const root = getRichEditorRoot();
    if (!editor || !root) {
      return;
    }
    const html = root.innerHTML.trim() || "<p></p>";
    editor.commands.setContent(html);
  }

  async function writeRichClipboard(html: string, text: string) {
    const fallbackText = text || html;
    try {
      const ClipboardItemConstructor = window.ClipboardItem;
      if (ClipboardItemConstructor && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItemConstructor({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([fallbackText], { type: "text/plain" })
          })
        ]);
        return;
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(fallbackText);
      }
    } catch {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(fallbackText);
      }
    }
  }

  async function copySelectedRichBlocks(shouldDelete: boolean) {
    const blocks = selectedBlocksRef.current;
    if (!blocks.length) {
      return;
    }
    const html = blocks.map((block) => block.outerHTML).join("");
    const text = blocks.map((block) => block.innerText || block.getAttribute("alt") || "").join("\n").trim();
    await writeRichClipboard(html, text);
    if (shouldDelete) {
      deleteSelectedRichBlocks();
    } else {
      clearRichBlockSelection();
    }
  }

  function deleteSelectedRichBlocks() {
    const blocks = [...selectedBlocksRef.current];
    if (!blocks.length) {
      return;
    }
    for (const block of blocks) {
      block.remove();
    }
    syncContentFromDom();
    clearRichBlockSelection();
  }

  function clearSelectedRichBlockFormats() {
    const blocks = [...selectedBlocksRef.current];
    if (!blocks.length) {
      return;
    }
    for (const block of blocks) {
      const text = (block.innerText || block.textContent || "").trim();
      const paragraph = document.createElement("p");
      paragraph.textContent = text;
      block.replaceWith(paragraph);
    }
    syncContentFromDom();
    clearRichBlockSelection();
  }

  function getRichSelectionPayload() {
    const root = getRichEditorRoot();
    const selection = window.getSelection();
    if (!root || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return null;
    }
    if (!selection.anchorNode || !selection.focusNode || !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) {
      return null;
    }
    const container = document.createElement("div");
    for (let index = 0; index < selection.rangeCount; index += 1) {
      const range = selection.getRangeAt(index);
      const commonNode = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE ? range.commonAncestorContainer : range.commonAncestorContainer.parentNode;
      if (!commonNode || !root.contains(commonNode)) {
        continue;
      }
      container.append(range.cloneContents());
    }
    const text = selection.toString();
    const html = container.innerHTML || text;
    return { html, text };
  }

  async function copyRichSelection() {
    setEditorContextMenu(null);
    if (selectedBlocksRef.current.length) {
      await copySelectedRichBlocks(false);
      return;
    }
    const payload = getRichSelectionPayload();
    if (payload) {
      await writeRichClipboard(payload.html, payload.text);
    }
  }

  async function cutRichSelection() {
    setEditorContextMenu(null);
    if (!editable || !editor) {
      return;
    }
    if (selectedBlocksRef.current.length) {
      await copySelectedRichBlocks(true);
      return;
    }
    const payload = getRichSelectionPayload();
    if (!payload) {
      return;
    }
    await writeRichClipboard(payload.html, payload.text);
    editor.chain().focus().deleteSelection().run();
  }

  async function pasteRichContent(asPlainText: boolean) {
    setEditorContextMenu(null);
    if (!editable || !editor) {
      return;
    }
    clearRichBlockSelection();
    try {
      if (!asPlainText && navigator.clipboard?.read) {
        const clipboardItems = await navigator.clipboard.read();
        for (const item of clipboardItems) {
          if (item.types.includes("text/html")) {
            const html = await (await item.getType("text/html")).text();
            const optimizedHtml = createOptimizedRichPasteHtml(html, "");
            if (optimizedHtml) {
              insertRichPasteHtmlIntoView(editor.view, optimizedHtml);
              return;
            }
          }
        }
      }
      const text = await navigator.clipboard?.readText();
      if (text) {
        const optimizedHtml = createRichPasteHtmlFromPlainText(text);
        if (optimizedHtml) {
          insertRichPasteHtmlIntoView(editor.view, optimizedHtml);
        }
      }
    } catch {
      window.alert("浏览器未允许读取剪贴板，请使用 Ctrl+V 粘贴。");
    }
  }

  function selectAllRichContent() {
    setEditorContextMenu(null);
    clearRichBlockSelection();
    editor?.chain().focus().selectAll().run();
  }

  function insertCurrentTime() {
    setEditorContextMenu(null);
    if (!editable || !editor) {
      return;
    }
    clearRichBlockSelection();
    const currentTime = new Date().toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    });
    editor.chain().focus().insertContent(currentTime).run();
  }

  function showRichWordCount() {
    setEditorContextMenu(null);
    const selectionText = getRichSelectionPayload()?.text.trim() ?? "";
    const targetText = selectionText || editor?.getText() || "";
    const compactText = targetText.replace(/\s+/g, "");
    const charCount = Array.from(compactText).length;
    const chineseCount = Array.from(compactText).filter((char) => /[\u4e00-\u9fff]/.test(char)).length;
    const wordCount = targetText.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g)?.length ?? 0;
    window.alert(`${selectionText ? "选区" : "全文"}字数统计\n\n字符数：${charCount}\n中文字符：${chineseCount}\n英文/数字词：${wordCount}`);
  }

  function updateRichDragSelection(clientX: number, clientY: number) {
    const dragState = dragStateRef.current;
    const shell = shellRef.current;
    if (!dragState || !shell) {
      return;
    }
    dragState.currentX = clientX;
    dragState.currentY = clientY;
    const shellRect = shell.getBoundingClientRect();
    const viewportSelection = {
      left: Math.min(dragState.startX, clientX),
      right: Math.max(dragState.startX, clientX),
      top: Math.min(dragState.startY, clientY),
      bottom: Math.max(dragState.startY, clientY)
    };
    setSelectionBox({
      left: viewportSelection.left - shellRect.left,
      top: viewportSelection.top - shellRect.top,
      width: Math.max(1, viewportSelection.right - viewportSelection.left),
      height: Math.max(1, viewportSelection.bottom - viewportSelection.top)
    });

    const selectedBlocks: HTMLElement[] = [];
    for (const block of getRichSelectableBlocks()) {
      const blockRect = block.getBoundingClientRect();
      const isIntersecting = blockRect.bottom >= viewportSelection.top && blockRect.top <= viewportSelection.bottom && blockRect.right >= viewportSelection.left && blockRect.left <= viewportSelection.right;
      block.classList.toggle("rich-block-selected", isIntersecting);
      if (isIntersecting) {
        selectedBlocks.push(block);
      }
    }
    selectedBlocksRef.current = selectedBlocks;
    setSelectedBlockCount(selectedBlocks.length);
  }

  function handleRichPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!editable || event.button !== 2) {
      return;
    }
    const root = getRichEditorRoot();
    if (!root || !(event.target instanceof Node) || !root.contains(event.target)) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    clearRichBlockSelection();
    dragStateRef.current = {
      active: false,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY
    };
    longPressTimerRef.current = window.setTimeout(() => {
      if (!dragStateRef.current) {
        return;
      }
      dragStateRef.current.active = true;
      suppressContextMenuUntilRef.current = Date.now() + 900;
      updateRichDragSelection(dragStateRef.current.currentX, dragStateRef.current.currentY);
    }, 220);
  }

  function handleRichPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }
    dragState.currentX = event.clientX;
    dragState.currentY = event.clientY;
    if (!dragState.active) {
      return;
    }
    event.preventDefault();
    updateRichDragSelection(event.clientX, event.clientY);
  }

  function finishRichPointerSelection(event: ReactPointerEvent<HTMLDivElement>) {
    const dragState = dragStateRef.current;
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (dragState.active && selectedBlocksRef.current.length) {
      const shellRect = event.currentTarget.getBoundingClientRect();
      setSelectionToolbar({
        x: Math.min(Math.max(12, event.clientX - shellRect.left), shellRect.width - 260),
        y: Math.max(56, event.clientY - shellRect.top + 10)
      });
    } else {
      clearRichBlockSelection();
    }
    setSelectionBox(null);
    dragStateRef.current = null;
  }

  function handleRichContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    const root = getRichEditorRoot();
    const shell = shellRef.current;
    if (!root || !shell || !(event.target instanceof Node) || !root.contains(event.target)) {
      return;
    }
    event.preventDefault();
    if (Date.now() < suppressContextMenuUntilRef.current) {
      setEditorContextMenu(null);
      return;
    }
    const imageContext = findRichDeletableNodeAtClientPoint(event.clientX, event.clientY, "image");
    const tableContext = findRichDeletableNodeAtClientPoint(event.clientX, event.clientY, "table");
    const dividerContext = findRichDeletableNodeAtClientPoint(event.clientX, event.clientY, "horizontalRule");
    const viewPosition = editor?.view.posAtCoords({ left: event.clientX, top: event.clientY });
    const shellRect = shell.getBoundingClientRect();
    const menuWidth = 124;
    const menuHeight = imageContext ? 390 : tableContext ? 432 : dividerContext ? 282 : 224;
    setEditorContextMenu({
      x: Math.min(Math.max(8, event.clientX - shellRect.left), Math.max(8, shellRect.width - menuWidth - 8)),
      y: Math.min(Math.max(8, event.clientY - shellRect.top), Math.max(8, shellRect.height - menuHeight - 8)),
      imagePos: imageContext?.pos,
      tablePos: tableContext?.pos,
      tableClickPos: tableContext ? viewPosition?.pos : undefined,
      dividerPos: dividerContext?.pos
    });
  }

  function handleRichWheel(event: ReactWheelEvent<HTMLDivElement>) {
    const root = getRichEditorRoot();
    if (!root || !(event.target instanceof Node) || !root.contains(event.target)) {
      return;
    }
    const maxScrollTop = Math.max(0, root.scrollHeight - root.clientHeight);
    if (maxScrollTop <= 0 || event.deltaY === 0) {
      return;
    }
    const deltaUnit = event.deltaMode === 1 ? 18 : event.deltaMode === 2 ? root.clientHeight : 1;
    const previousScrollTop = root.scrollTop;
    const nextScrollTop = Math.min(maxScrollTop, Math.max(0, previousScrollTop + event.deltaY * deltaUnit));
    if (nextScrollTop === previousScrollTop) {
      return;
    }
    root.scrollTop = nextScrollTop;
    setEditorContextMenu(null);
    event.preventDefault();
    event.stopPropagation();
  }

  function handleRichEditorKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) {
      return;
    }
    const key = event.key.toLowerCase();
    if (key !== "f" && key !== "r") {
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(".rich-find-dialog")) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    openRichFindDialog(key === "f" ? "find" : "replace");
  }

  if (!editor) {
    return <div className="growth-rich-editor-shell" />;
  }

  return (
    <div
      ref={shellRef}
      className="growth-rich-editor-shell"
      onPointerDown={handleRichPointerDown}
      onPointerMove={handleRichPointerMove}
      onPointerUp={finishRichPointerSelection}
      onPointerCancel={finishRichPointerSelection}
      onContextMenu={handleRichContextMenu}
      onKeyDownCapture={handleRichEditorKeyDown}
      onWheelCapture={handleRichWheel}
    >
      <RichTextToolbar editor={editor} editable={editable} isOutlineOpen={isOutlineOpen} onToggleOutline={onToggleOutline} />
      <EditorContent className="growth-rich-editor-content-frame" editor={editor} />
      {findDialog ? (
        <RichFindReplaceDialog
          editor={editor}
          editable={editable}
          mode={findDialog.mode}
          openSeed={findDialog.seed}
          onClose={() => {
            setFindDialog(null);
            editor.view.focus();
          }}
        />
      ) : null}
      {selectionBox ? <div className="rich-block-selection-box" style={selectionBox} /> : null}
      {editorContextMenu ? (
        <div className="rich-editor-context-menu" style={{ left: editorContextMenu.x, top: editorContextMenu.y }} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
          <button type="button" disabled={!editable} onClick={() => void cutRichSelection()}>剪切</button>
          <button type="button" onClick={() => void copyRichSelection()}>复制</button>
          <button type="button" disabled={!editable} onClick={() => void pasteRichContent(false)}>粘贴</button>
          <button type="button" disabled={!editable} onClick={() => void pasteRichContent(true)}>纯文本粘贴</button>
          {editorContextMenu.imagePos !== undefined ? (
            <>
              <span aria-hidden="true" />
              <button type="button" onClick={() => selectRichNodeAtPos(editorContextMenu.imagePos, "image")}>选中图片</button>
              <button type="button" disabled={!editable} onClick={() => openReplaceRichImage(editorContextMenu.imagePos)}>替换图片</button>
              <button type="button" disabled={!editable} onClick={() => updateRichImageAtPos(editorContextMenu.imagePos, { width: "25%" })}>宽度 25%</button>
              <button type="button" disabled={!editable} onClick={() => updateRichImageAtPos(editorContextMenu.imagePos, { width: "50%" })}>宽度 50%</button>
              <button type="button" disabled={!editable} onClick={() => updateRichImageAtPos(editorContextMenu.imagePos, { width: "100%" })}>宽度 100%</button>
              <button type="button" disabled={!editable} onClick={() => updateRichImageAtPos(editorContextMenu.imagePos, { align: "left" })}>图片左对齐</button>
              <button type="button" disabled={!editable} onClick={() => updateRichImageAtPos(editorContextMenu.imagePos, { align: "center" })}>图片居中</button>
              <button type="button" disabled={!editable} onClick={() => updateRichImageAtPos(editorContextMenu.imagePos, { align: "right" })}>图片右对齐</button>
              <button type="button" disabled={!editable} onClick={() => deleteRichNodeAtPos(editorContextMenu.imagePos, "image")}>删除图片</button>
            </>
          ) : null}
          {editorContextMenu.tablePos !== undefined ? (
            <>
              <span aria-hidden="true" />
              <button type="button" onClick={() => selectRichNodeAtPos(editorContextMenu.tablePos, "table")}>选中表格</button>
              <button type="button" disabled={!editable} onClick={() => runRichTableCommand("addRowBefore", editorContextMenu.tableClickPos)}>上方插入行</button>
              <button type="button" disabled={!editable} onClick={() => runRichTableCommand("addRowAfter", editorContextMenu.tableClickPos)}>下方插入行</button>
              <button type="button" disabled={!editable} onClick={() => runRichTableCommand("deleteRow", editorContextMenu.tableClickPos)}>删除行</button>
              <button type="button" disabled={!editable} onClick={() => runRichTableCommand("addColumnBefore", editorContextMenu.tableClickPos)}>左侧插入列</button>
              <button type="button" disabled={!editable} onClick={() => runRichTableCommand("addColumnAfter", editorContextMenu.tableClickPos)}>右侧插入列</button>
              <button type="button" disabled={!editable} onClick={() => runRichTableCommand("deleteColumn", editorContextMenu.tableClickPos)}>删除列</button>
              <button type="button" disabled={!editable} onClick={() => runRichTableCommand("toggleHeaderRow", editorContextMenu.tableClickPos)}>切换表头行</button>
              <button type="button" disabled={!editable} onClick={() => runRichTableCommand("mergeCells", editorContextMenu.tableClickPos)}>合并单元格</button>
              <button type="button" disabled={!editable} onClick={() => runRichTableCommand("splitCell", editorContextMenu.tableClickPos)}>拆分单元格</button>
              <button type="button" disabled={!editable} onClick={() => runRichTableCommand("deleteTable", editorContextMenu.tableClickPos)}>删除表格</button>
            </>
          ) : null}
          {editorContextMenu.dividerPos !== undefined ? (
            <>
              <span aria-hidden="true" />
              <button type="button" onClick={() => selectRichNodeAtPos(editorContextMenu.dividerPos, "horizontalRule")}>选中分割线</button>
              <button type="button" disabled={!editable} onClick={() => deleteRichNodeAtPos(editorContextMenu.dividerPos, "horizontalRule")}>删除分割线</button>
            </>
          ) : null}
          <span aria-hidden="true" />
          <button type="button" onClick={selectAllRichContent}>全选</button>
          <button type="button" disabled={!editable} onClick={insertCurrentTime}>插入当前时间</button>
          <span aria-hidden="true" />
          <button type="button" onClick={showRichWordCount}>字数统计</button>
        </div>
      ) : null}
      <input ref={replaceImageInputRef} className="sr-only" type="file" accept="image/*" aria-label="替换图片" onChange={handleReplaceRichImageChange} />
      {selectionToolbar ? (
        <div className="rich-block-selection-toolbar" style={{ left: selectionToolbar.x, top: selectionToolbar.y }} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
          <span>{selectedBlockCount} 项</span>
          <button type="button" onClick={() => void copySelectedRichBlocks(false)}>复制</button>
          <button type="button" onClick={() => void copySelectedRichBlocks(true)}>剪切</button>
          <button type="button" onClick={clearSelectedRichBlockFormats}>清除格式</button>
          <button type="button" onClick={deleteSelectedRichBlocks}>删除</button>
          <button type="button" onClick={clearRichBlockSelection}>取消</button>
        </div>
      ) : null}
    </div>
  );
}

function RichFindReplaceDialog({
  editor,
  editable,
  mode,
  openSeed,
  onClose
}: {
  editor: Editor;
  editable: boolean;
  mode: RichFindDialogMode;
  openSeed: number;
  onClose: () => void;
}) {
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const [activeMode, setActiveMode] = useState<RichFindDialogMode>(mode);
  const [findQuery, setFindQuery] = useState("");
  const [replaceQuery, setReplaceQuery] = useState("");
  const [findIndex, setFindIndex] = useState(-1);
  const findMatches = findRichTextMatches(editor, findQuery);
  const selectedFindIndex = findMatches.length && findIndex >= 0 ? Math.min(findIndex, findMatches.length - 1) : -1;
  const displayFindIndex = selectedFindIndex >= 0 ? selectedFindIndex + 1 : 0;
  const statusText = findQuery.trim()
    ? findMatches.length
      ? `找到 ${findMatches.length} 处`
      : "未找到匹配项"
    : "输入关键词开始查找";

  const focusFindInput = () => {
    window.setTimeout(() => {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    });
  };

  useEffect(() => {
    setActiveMode(mode);
    const { selection, doc } = editor.state;
    const selectedText = selection.empty ? "" : doc.textBetween(selection.from, selection.to, "\n").trim();
    if (selectedText) {
      setFindQuery(selectedText);
      setFindIndex(-1);
    }
    focusFindInput();
  }, [editor, mode, openSeed]);

  function selectMatchAtIndex(index: number, matches = findRichTextMatches(editor, findQuery)) {
    if (!matches.length) {
      setFindIndex(-1);
      return;
    }
    const nextIndex = ((index % matches.length) + matches.length) % matches.length;
    setFindIndex(nextIndex);
    selectRichTextMatch(editor, matches[nextIndex]);
  }

  function selectFindMatch(offset: number) {
    const matches = findRichTextMatches(editor, findQuery);
    const baseIndex = findIndex >= 0 ? findIndex : offset > 0 ? -1 : 0;
    selectMatchAtIndex(baseIndex + offset, matches);
  }

  function replaceCurrentMatch() {
    const matches = findRichTextMatches(editor, findQuery);
    const currentIndex = findIndex >= 0 && findIndex < matches.length ? findIndex : 0;
    const currentMatch = matches[currentIndex];
    if (!editable || !currentMatch) {
      return;
    }
    editor.chain().focus().insertContentAt(currentMatch, replaceQuery).run();
    window.setTimeout(() => {
      const nextMatches = findRichTextMatches(editor, findQuery);
      if (!nextMatches.length) {
        setFindIndex(-1);
        return;
      }
      selectMatchAtIndex(Math.min(currentIndex, nextMatches.length - 1), nextMatches);
    });
  }

  function replaceAllMatches() {
    const matches = findRichTextMatches(editor, findQuery);
    if (!editable || !matches.length) {
      return;
    }
    let transaction = editor.state.tr;
    for (const match of [...matches].reverse()) {
      transaction = transaction.insertText(replaceQuery, match.from, match.to);
    }
    editor.view.dispatch(transaction.scrollIntoView());
    editor.view.focus();
    setFindIndex(-1);
  }

  function handleFindSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    selectFindMatch(1);
  }

  function handleDialogKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (!(event.ctrlKey || event.metaKey) || event.altKey) {
      return;
    }
    const key = event.key.toLowerCase();
    if (key !== "f" && key !== "r") {
      return;
    }
    event.preventDefault();
    setActiveMode(key === "f" ? "find" : "replace");
    focusFindInput();
  }

  return (
    <div className="rich-find-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="rich-find-dialog" role="dialog" aria-modal="true" aria-label={activeMode === "replace" ? "查找和替换" : "查找"} onMouseDown={(event) => event.stopPropagation()} onKeyDown={handleDialogKeyDown}>
        <header>
          <div>
            <h2>查找和替换</h2>
            <span>{statusText}</span>
          </div>
          <button className="rich-find-dialog-close" type="button" aria-label="关闭" onClick={onClose}>x</button>
        </header>
        <div className="rich-find-mode-tabs" role="tablist" aria-label="模式">
          <button className={activeMode === "find" ? "active" : ""} type="button" role="tab" aria-selected={activeMode === "find"} onClick={() => { setActiveMode("find"); focusFindInput(); }}>查找</button>
          <button className={activeMode === "replace" ? "active" : ""} type="button" role="tab" aria-selected={activeMode === "replace"} onClick={() => { setActiveMode("replace"); window.setTimeout(() => replaceInputRef.current?.focus()); }}>替换</button>
        </div>
        <form className="rich-find-dialog-body" onSubmit={handleFindSubmit}>
          <label>
            <span>查找内容</span>
            <input ref={findInputRef} value={findQuery} autoComplete="off" onChange={(event) => { setFindQuery(event.target.value); setFindIndex(-1); }} />
          </label>
          {activeMode === "replace" ? (
            <label>
              <span>替换为</span>
              <input ref={replaceInputRef} value={replaceQuery} autoComplete="off" disabled={!editable} onChange={(event) => setReplaceQuery(event.target.value)} />
            </label>
          ) : null}
          <div className="rich-find-dialog-count" aria-live="polite">
            {displayFindIndex}/{findMatches.length}
          </div>
        </form>
        <footer>
          <button type="button" disabled={!findQuery.trim()} onClick={() => selectFindMatch(-1)}>上一个</button>
          <button type="button" disabled={!findQuery.trim()} onClick={() => selectFindMatch(1)}>下一个</button>
          {activeMode === "replace" ? (
            <>
              <button type="button" disabled={!editable || !findMatches.length} onClick={replaceCurrentMatch}>替换</button>
              <button type="button" disabled={!editable || !findMatches.length} onClick={replaceAllMatches}>全部替换</button>
            </>
          ) : null}
        </footer>
      </section>
    </div>
  );
}

function RichTextToolbar({ editor, editable, isOutlineOpen, onToggleOutline }: { editor: Editor; editable: boolean; isOutlineOpen: boolean; onToggleOutline: () => void }) {
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const [openPalette, setOpenPalette] = useState<"text" | "highlight" | null>(null);
  const [isInsertMenuOpen, setIsInsertMenuOpen] = useState(false);
  const [isAlignMenuOpen, setIsAlignMenuOpen] = useState(false);
  const [isLineHeightMenuOpen, setIsLineHeightMenuOpen] = useState(false);
  const [isScriptMenuOpen, setIsScriptMenuOpen] = useState(false);
  const [isIndentMenuOpen, setIsIndentMenuOpen] = useState(false);
  const [selectedFontFamily, setSelectedFontFamily] = useState("");
  const [textColor, setTextColor] = useState("#172033");
  const [highlightColor, setHighlightColor] = useState("#fff3a3");
  const activeHeadingLevel = richHeadingLevels.find((level) => editor.isActive("heading", { level }));
  const paragraphStyle = activeHeadingLevel ? `h${activeHeadingLevel}` : "paragraph";
  const setParagraphStyle = (style: string) => {
    const chain = editor.chain().focus();
    const headingLevel = Number(style.slice(1)) as RichHeadingLevel;
    if (style.startsWith("h") && richHeadingLevels.includes(headingLevel)) {
      chain.setHeading({ level: headingLevel }).run();
    } else {
      chain.setParagraph().run();
    }
  };
  const openImageDialog = () => {
    setOpenPalette(null);
    setIsAlignMenuOpen(false);
    setIsLineHeightMenuOpen(false);
    setIsScriptMenuOpen(false);
    setIsIndentMenuOpen(false);
    setIsInsertMenuOpen(false);
    imageInputRef.current?.click();
  };
  const insertLocalImage = (file: File) => {
    if (!file.type.startsWith("image/")) {
      window.alert("请选择图片文件");
      return;
    }
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const src = typeof reader.result === "string" ? reader.result : "";
      if (!src) {
        window.alert("图片读取失败");
        return;
      }
      editor.chain().focus().setImage({ src, alt: file.name }).run();
    });
    reader.addEventListener("error", () => {
      window.alert("图片读取失败");
    });
    reader.readAsDataURL(file);
  };
  const handleImageFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) {
      return;
    }
    insertLocalImage(file);
  };
  const applyFontSize = (size: string) => {
    if (!size) {
      editor.chain().focus().setMark("textStyle", { fontSize: null }).removeEmptyTextStyle().run();
      return;
    }
    editor.chain().focus().setMark("textStyle", { fontSize: `${size}px` }).run();
  };
  const applyFontFamily = (fontFamily: string) => {
    setSelectedFontFamily(fontFamily);
    editor.chain().focus().setFontFamily(fontFamily).run();
  };
  const blockAttributes = editor.isActive("heading") ? editor.getAttributes("heading") : editor.getAttributes("paragraph");
  const currentLineHeight = typeof blockAttributes.lineHeight === "string" ? blockAttributes.lineHeight : "";
  const currentMarginTop = typeof blockAttributes.marginTop === "string" ? blockAttributes.marginTop : null;
  const currentMarginBottom = typeof blockAttributes.marginBottom === "string" ? blockAttributes.marginBottom : null;
  const currentParagraphSpacing = richParagraphSpacingOptions.find((option) => option.marginTop === currentMarginTop && option.marginBottom === currentMarginBottom)?.value ?? "";
  const currentIndent = Number.parseFloat(String(blockAttributes.textIndent ?? "0")) || 0;
  const setBlockStyle = (attributes: Record<string, string | null>) => {
    editor.chain().focus().updateAttributes("paragraph", attributes).updateAttributes("heading", attributes).run();
  };
  const increaseIndent = () => {
    setBlockStyle({ textIndent: `${Math.min(8, currentIndent + 2)}em` });
    setIsIndentMenuOpen(false);
  };
  const decreaseIndent = () => {
    const nextIndent = Math.max(0, currentIndent - 2);
    setBlockStyle({ textIndent: nextIndent ? `${nextIndent}em` : null });
    setIsIndentMenuOpen(false);
  };
  const setLineHeight = (value: string) => {
    setBlockStyle({ lineHeight: value || null });
    setIsLineHeightMenuOpen(false);
  };
  const setParagraphSpacing = (value: string) => {
    const option = richParagraphSpacingOptions.find((item) => item.value === value);
    setBlockStyle({
      marginTop: option?.marginTop ?? null,
      marginBottom: option?.marginBottom ?? null
    });
  };
  const clearParagraphStyle = () => {
    setBlockStyle({ lineHeight: null, textIndent: null, marginTop: null, marginBottom: null });
  };
  const toggleScriptMark = (mark: "superscript" | "subscript") => {
    editor.chain().focus().toggleMark(mark).run();
    setIsScriptMenuOpen(false);
  };
  const applyLink = () => {
    const currentHref = typeof editor.getAttributes("link").href === "string" ? editor.getAttributes("link").href : "";
    const href = window.prompt("链接地址", currentHref || "https://");
    if (href === null) {
      setIsInsertMenuOpen(false);
      return;
    }
    const nextHref = href.trim();
    if (!nextHref) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      setIsInsertMenuOpen(false);
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: nextHref }).run();
    setIsInsertMenuOpen(false);
  };
  const removeLink = () => {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    setIsInsertMenuOpen(false);
  };
  const openCurrentLink = () => {
    const href = typeof editor.getAttributes("link").href === "string" ? editor.getAttributes("link").href : "";
    if (href) {
      window.open(href, "_blank", "noopener,noreferrer");
    }
    setIsInsertMenuOpen(false);
  };

  useEffect(() => {
    const closeMenus = () => {
      setOpenPalette(null);
      setIsInsertMenuOpen(false);
      setIsAlignMenuOpen(false);
      setIsLineHeightMenuOpen(false);
      setIsScriptMenuOpen(false);
      setIsIndentMenuOpen(false);
    };
    const isFloatingToolTarget = (target: EventTarget | null) => {
      const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
      const floatingTool = element?.closest(".rich-insert-tool, .rich-align-tool, .growth-line-height-tool, .growth-color-tool, .rich-script-tool, .rich-indent-tool");
      return Boolean(floatingTool && toolbarRef.current?.contains(floatingTool));
    };
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!isFloatingToolTarget(event.target)) {
        closeMenus();
      }
    };
    const closeOnClick = (event: MouseEvent) => {
      if (!isFloatingToolTarget(event.target)) {
        closeMenus();
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenus();
      }
    };
    document.addEventListener("pointerdown", closeOnPointerDown, true);
    window.addEventListener("click", closeOnClick);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("scroll", closeMenus, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown, true);
      window.removeEventListener("click", closeOnClick);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("scroll", closeMenus, true);
    };
  }, []);

  const currentAlign = editor.isActive({ textAlign: "center" }) ? "center" : editor.isActive({ textAlign: "right" }) ? "right" : editor.isActive({ textAlign: "justify" }) ? "justify" : "left";
  const selectedFontLabel = richFontFamilies.find((font) => font.value === selectedFontFamily)?.label ?? richFontFamilies[0].label;
  const fontSelectStyle = { "--font-select-width": getRichFontSelectWidth(selectedFontLabel) } as CSSProperties;
  const applyTextAlign = (align: "left" | "center" | "right" | "justify") => {
    editor.chain().focus().setTextAlign(align).run();
    setIsAlignMenuOpen(false);
  };
  const applyTextColor = (color: string) => {
    if (color === "transparent") {
      editor.chain().focus().unsetColor().run();
      setTextColor("#172033");
    } else {
      editor.chain().focus().setColor(color).run();
      setTextColor(color);
    }
    setOpenPalette(null);
  };
  const applyHighlightColor = (color: string) => {
    if (color === "transparent") {
      editor.chain().focus().unsetHighlight().run();
      setHighlightColor("#fff3a3");
    } else {
      editor.chain().focus().setHighlight({ color }).run();
      setHighlightColor(color);
    }
    setOpenPalette(null);
  };

  return (
    <>
    <div className="growth-editor-toolbar-stack">
    <div ref={toolbarRef} className="growth-editor-toolbar" aria-label="富文本工具箱">
      <button type="button" title="撤销" disabled={!editable || !editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>↶</button>
      <button type="button" title="重做" disabled={!editable || !editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>↷</button>
      <button type="button" title="清除格式" disabled={!editable} onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}>Tx</button>
      <button className={isOutlineOpen ? "active" : ""} type="button" title="文档大纲" aria-pressed={isOutlineOpen} onClick={onToggleOutline}>纲</button>
      <div className="rich-insert-tool" onClick={(event) => event.stopPropagation()}>
        <button type="button" title="插入" disabled={!editable} aria-expanded={isInsertMenuOpen} onClick={() => { setOpenPalette(null); setIsAlignMenuOpen(false); setIsLineHeightMenuOpen(false); setIsScriptMenuOpen(false); setIsIndentMenuOpen(false); setIsInsertMenuOpen((open) => !open); }}>
          <InsertToolbarIcon />
          <span>插入</span>
          <small>⌄</small>
        </button>
        {isInsertMenuOpen ? (
          <div className="rich-insert-menu" role="menu" aria-label="插入">
            <button className={editor.isActive("code") ? "active" : ""} type="button" role="menuitem" onClick={() => { editor.chain().focus().toggleCode().run(); setIsInsertMenuOpen(false); }}>
              <InlineCodeToolbarIcon />
              内联代码
            </button>
            <button type="button" role="menuitem" onClick={() => { editor.chain().focus().setCodeBlock().run(); setIsInsertMenuOpen(false); }}>
              <CodeBlockToolbarIcon />
              代码块
            </button>
            <button className={editor.isActive("link") ? "active" : ""} type="button" role="menuitem" disabled={!editable} onClick={applyLink}>
              <LinkToolbarIcon />
              插入或编辑链接
            </button>
            <button type="button" role="menuitem" disabled={!editable || !editor.isActive("link")} onClick={removeLink}>
              <UnlinkToolbarIcon />
              取消链接
            </button>
            <button type="button" role="menuitem" disabled={!editor.isActive("link")} onClick={openCurrentLink}>
              <ExternalLinkToolbarIcon />
              打开链接
            </button>
            <button type="button" role="menuitem" onClick={() => { editor.chain().focus().toggleBlockquote().run(); setIsInsertMenuOpen(false); }}>
              <QuoteToolbarIcon />
              引用
            </button>
            <button type="button" role="menuitem" onClick={() => { editor.chain().focus().setHorizontalRule().run(); setIsInsertMenuOpen(false); }}>
              <DividerToolbarIcon />
              分割线
            </button>
            <button type="button" role="menuitem" onClick={() => { editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); setIsInsertMenuOpen(false); }}>
              <TableToolbarIcon />
              表格
            </button>
            <button type="button" role="menuitem" onClick={openImageDialog}>
              <ImageToolbarIcon />
              图片
            </button>
          </div>
        ) : null}
      </div>
      <span className="growth-toolbar-divider" />
      <select value={paragraphStyle} disabled={!editable} aria-label="段落样式" onChange={(event) => setParagraphStyle(event.target.value)}>
        <option value="paragraph">正文</option>
        {richHeadingLevels.map((level) => (
          <option key={level} value={`h${level}`}>
            标题 {level}
          </option>
        ))}
      </select>
      <select className="rich-font-family-select" disabled={!editable} aria-label="字体" value={selectedFontFamily} style={fontSelectStyle} onChange={(event) => applyFontFamily(event.target.value)}>
        {richFontFamilies.map((font) => (
          <option key={font.label} value={font.value}>
            {font.label}
          </option>
        ))}
      </select>
      <select disabled={!editable} aria-label="字号" defaultValue="16" onChange={(event) => applyFontSize(event.target.value)}>
        {richFontSizes.map((size) => (
          <option key={size} value={size}>
            {size}
          </option>
        ))}
      </select>
      <button className={`rich-format-icon bold ${editor.isActive("bold") ? "active" : ""}`} type="button" title="加粗" disabled={!editable} onClick={() => editor.chain().focus().toggleBold().run()}>B</button>
      <button className={`rich-format-icon italic ${editor.isActive("italic") ? "active" : ""}`} type="button" title="斜体" disabled={!editable} onClick={() => editor.chain().focus().toggleItalic().run()}>I</button>
      <button className={`rich-format-icon underline ${editor.isActive("underline") ? "active" : ""}`} type="button" title="下划线" disabled={!editable} onClick={() => editor.chain().focus().toggleUnderline().run()}>U</button>
      <button className={`rich-format-icon strike ${editor.isActive("strike") ? "active" : ""}`} type="button" title="删除线" disabled={!editable} onClick={() => editor.chain().focus().toggleStrike().run()}>S</button>
      <div className="rich-script-tool" onClick={(event) => event.stopPropagation()}>
        <button className={editor.isActive("superscript") || editor.isActive("subscript") ? "active" : ""} type="button" title="上下标" disabled={!editable} aria-expanded={isScriptMenuOpen} onClick={() => { setOpenPalette(null); setIsInsertMenuOpen(false); setIsAlignMenuOpen(false); setIsLineHeightMenuOpen(false); setIsIndentMenuOpen(false); setIsScriptMenuOpen((open) => !open); }}>
          <ScriptToolbarIcon />
          <span>上下标</span>
          <small>⌄</small>
        </button>
        {isScriptMenuOpen ? (
          <div className="rich-script-menu" role="menu" aria-label="上下标">
            <button className={editor.isActive("superscript") ? "active" : ""} type="button" role="menuitem" onClick={() => toggleScriptMark("superscript")}>
              <SuperscriptToolbarIcon />
              上标
            </button>
            <button className={editor.isActive("subscript") ? "active" : ""} type="button" role="menuitem" onClick={() => toggleScriptMark("subscript")}>
              <SubscriptToolbarIcon />
              下标
            </button>
          </div>
        ) : null}
      </div>
      <ColorPaletteTool
        label="A"
        kind="text"
        title="文字颜色"
        indicatorColor={textColor}
        editable={editable}
        isOpen={openPalette === "text"}
        onToggle={() => { setIsInsertMenuOpen(false); setIsAlignMenuOpen(false); setIsLineHeightMenuOpen(false); setIsScriptMenuOpen(false); setIsIndentMenuOpen(false); setOpenPalette((value) => (value === "text" ? null : "text")); }}
        onSelect={applyTextColor}
        onCustomColor={applyTextColor}
      />
      <ColorPaletteTool
        label="H"
        kind="highlight"
        title="高亮"
        indicatorColor={highlightColor}
        editable={editable}
        isOpen={openPalette === "highlight"}
        onToggle={() => { setIsInsertMenuOpen(false); setIsAlignMenuOpen(false); setIsLineHeightMenuOpen(false); setIsScriptMenuOpen(false); setIsIndentMenuOpen(false); setOpenPalette((value) => (value === "highlight" ? null : "highlight")); }}
        onSelect={applyHighlightColor}
        onCustomColor={applyHighlightColor}
      />
      <span className="growth-toolbar-divider" />
      <button className={editor.isActive("bulletList") ? "active" : ""} type="button" title="无序列表" disabled={!editable} onClick={() => editor.chain().focus().toggleBulletList().run()}><ListToolbarIcon type="bullet" /></button>
      <button className={editor.isActive("orderedList") ? "active" : ""} type="button" title="有序列表" disabled={!editable} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListToolbarIcon type="ordered" /></button>
      <button className={editor.isActive("taskList") ? "active" : ""} type="button" title="任务列表" disabled={!editable} onClick={() => editor.chain().focus().toggleTaskList().run()}>☑</button>
      <span className="growth-toolbar-divider" />
      <div className="rich-align-tool" onClick={(event) => event.stopPropagation()}>
        <button type="button" title="对齐方式" disabled={!editable} aria-expanded={isAlignMenuOpen} onClick={() => { setOpenPalette(null); setIsInsertMenuOpen(false); setIsLineHeightMenuOpen(false); setIsScriptMenuOpen(false); setIsIndentMenuOpen(false); setIsAlignMenuOpen((open) => !open); }}>
          <AlignToolbarIcon type={currentAlign} />
          <small>⌄</small>
        </button>
        {isAlignMenuOpen ? (
          <div className="rich-align-menu" role="menu" aria-label="对齐方式">
            <button className={currentAlign === "left" ? "active" : ""} type="button" role="menuitem" onClick={() => applyTextAlign("left")}>
              <AlignToolbarIcon type="left" />
              左对齐
            </button>
            <button className={currentAlign === "center" ? "active" : ""} type="button" role="menuitem" onClick={() => applyTextAlign("center")}>
              <AlignToolbarIcon type="center" />
              居中
            </button>
            <button className={currentAlign === "right" ? "active" : ""} type="button" role="menuitem" onClick={() => applyTextAlign("right")}>
              <AlignToolbarIcon type="right" />
              右对齐
            </button>
            <button className={currentAlign === "justify" ? "active" : ""} type="button" role="menuitem" onClick={() => applyTextAlign("justify")}>
              <AlignToolbarIcon type="justify" />
              两端对齐
            </button>
          </div>
        ) : null}
      </div>
      <div className="rich-indent-tool" onClick={(event) => event.stopPropagation()}>
        <button className={currentIndent > 0 ? "active" : ""} type="button" title="缩进" disabled={!editable} aria-expanded={isIndentMenuOpen} onClick={() => { setOpenPalette(null); setIsInsertMenuOpen(false); setIsAlignMenuOpen(false); setIsLineHeightMenuOpen(false); setIsScriptMenuOpen(false); setIsIndentMenuOpen((open) => !open); }}>
          <IndentToolbarIcon direction="in" />
          <span>缩进</span>
          <small>⌄</small>
        </button>
        {isIndentMenuOpen ? (
          <div className="rich-indent-menu" role="menu" aria-label="缩进">
            <button type="button" role="menuitem" disabled={currentIndent <= 0} onClick={decreaseIndent}>
              <IndentToolbarIcon direction="out" />
              减少缩进
            </button>
            <button type="button" role="menuitem" disabled={currentIndent >= 8} onClick={increaseIndent}>
              <IndentToolbarIcon direction="in" />
              增加缩进
            </button>
          </div>
        ) : null}
      </div>
      <div className="growth-line-height-tool" onClick={(event) => event.stopPropagation()}>
        <button type="button" title="行距" disabled={!editable} aria-expanded={isLineHeightMenuOpen} onClick={() => { setOpenPalette(null); setIsInsertMenuOpen(false); setIsAlignMenuOpen(false); setIsScriptMenuOpen(false); setIsIndentMenuOpen(false); setIsLineHeightMenuOpen((open) => !open); }}>
          <LineHeightToolbarIcon />
          <small>⌄</small>
        </button>
        {isLineHeightMenuOpen ? (
          <div className="rich-line-height-menu" role="menu" aria-label="行距">
            {richLineHeightOptions.map((option) => (
              <button className={currentLineHeight === option.value ? "active" : ""} key={option.value || "default"} type="button" role="menuitem" onClick={() => setLineHeight(option.value)}>
                {option.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <select value={currentParagraphSpacing} disabled={!editable} aria-label="段落间距" onChange={(event) => setParagraphSpacing(event.target.value)}>
        {richParagraphSpacingOptions.map((option) => (
          <option key={option.value || "default"} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <button type="button" title="清除段落样式" aria-label="清除段落样式" disabled={!editable} onClick={clearParagraphStyle}>
        <ClearParagraphStyleToolbarIcon />
      </button>
    </div>
    </div>
    <input ref={imageInputRef} className="sr-only" type="file" accept="image/*" aria-label="选择本地图片" onChange={handleImageFileChange} />
    </>
  );
}

function ListToolbarIcon({ type }: { type: "bullet" | "ordered" }) {
  return (
    <IconBase className="rich-toolbar-svg list">
      {type === "bullet" ? (
        <>
          <circle cx="5" cy="7" r="1.1" />
          <circle cx="5" cy="12" r="1.1" />
          <circle cx="5" cy="17" r="1.1" />
        </>
      ) : (
        <>
          <path className="ordered-list-number" d="M5.7 4.9v4.2" />
          <path className="ordered-list-number" d="M4.9 5.5 5.7 4.9" />
          <path className="ordered-list-number" d="M4.8 9.1h2" />
          <path className="ordered-list-number" d="M4.7 11.1h2.2v1.7H4.8v1.7h2.2" />
          <path className="ordered-list-number" d="M4.7 16.2h2.2l-1.1 1.3h.5c.7 0 1.1.4 1.1 1s-.5 1-1.4 1H4.7" />
        </>
      )}
      <path d="M9 7h11" />
      <path d="M9 12h11" />
      <path d="M9 17h11" />
    </IconBase>
  );
}

function AlignToolbarIcon({ type }: { type: "left" | "center" | "right" | "justify" }) {
  const lines = type === "left"
    ? ["M4 5.5h16", "M4 9.8h11", "M4 14.2h16", "M4 18.5h12"]
    : type === "center"
      ? ["M4 5.5h16", "M7 9.8h10", "M4 14.2h16", "M6.5 18.5h11"]
      : type === "right"
        ? ["M4 5.5h16", "M9 9.8h11", "M4 14.2h16", "M8 18.5h12"]
        : ["M4 5.5h16", "M4 9.8h16", "M4 14.2h16", "M4 18.5h16"];
  return (
    <IconBase className={`rich-toolbar-svg align ${type}`}>
      {lines.map((line) => (
        <path key={line} d={line} />
      ))}
    </IconBase>
  );
}

function IndentToolbarIcon({ direction }: { direction: "in" | "out" }) {
  return (
    <IconBase className="rich-toolbar-svg">
      <path d="M10 6h10" />
      <path d="M10 12h10" />
      <path d="M10 18h10" />
      {direction === "in" ? <path d="M4 9l4 3-4 3V9Z" /> : <path d="M8 9l-4 3 4 3V9Z" />}
    </IconBase>
  );
}

function LineHeightToolbarIcon() {
  return (
    <IconBase className="rich-toolbar-svg">
      <path d="M9 6h10" />
      <path d="M9 12h10" />
      <path d="M9 18h10" />
      <path d="M5 5v14" />
      <path d="M3.2 7 5 5l1.8 2" />
      <path d="M3.2 17 5 19l1.8-2" />
    </IconBase>
  );
}

function ClearParagraphStyleToolbarIcon() {
  return (
    <IconBase className="rich-toolbar-svg">
      <path d="M6 6h12" />
      <path d="M6 11h9" />
      <path d="M6 16h6" />
      <path d="M15.5 15.5 19 19" />
      <path d="M19 15.5 15.5 19" />
    </IconBase>
  );
}

function ScriptToolbarIcon() {
  return (
    <IconBase className="rich-toolbar-svg rich-script-svg">
      <text x="5" y="15">x</text>
      <text x="13" y="8">2</text>
      <text x="13" y="18">2</text>
    </IconBase>
  );
}

function SuperscriptToolbarIcon() {
  return (
    <IconBase className="rich-menu-icon rich-script-menu-icon">
      <text x="5" y="16">x</text>
      <text x="14" y="9">2</text>
    </IconBase>
  );
}

function SubscriptToolbarIcon() {
  return (
    <IconBase className="rich-menu-icon rich-script-menu-icon">
      <text x="5" y="13">x</text>
      <text x="14" y="18">2</text>
    </IconBase>
  );
}

function LinkToolbarIcon() {
  return (
    <IconBase className="rich-toolbar-svg">
      <path d="M9.5 8.2 8.1 9.6a4 4 0 0 0 5.7 5.7l1.4-1.4" />
      <path d="M14.5 15.8 15.9 14.4a4 4 0 0 0-5.7-5.7L8.8 10.1" />
      <path d="M9.8 14.2 14.2 9.8" />
    </IconBase>
  );
}

function UnlinkToolbarIcon() {
  return (
    <IconBase className="rich-menu-icon">
      <path d="M9 8.5 7.8 9.7a3.8 3.8 0 0 0 4.6 5.9" />
      <path d="M15 15.5 16.2 14.3a3.8 3.8 0 0 0-4.6-5.9" />
      <path d="M5.2 5.2 18.8 18.8" />
    </IconBase>
  );
}

function ExternalLinkToolbarIcon() {
  return (
    <IconBase className="rich-menu-icon">
      <path d="M8 8H6.2a1.7 1.7 0 0 0-1.7 1.7v7.1a1.7 1.7 0 0 0 1.7 1.7h7.1a1.7 1.7 0 0 0 1.7-1.7V15" />
      <path d="M12.5 5.5h6v6" />
      <path d="M18.5 5.5 10.5 13.5" />
    </IconBase>
  );
}

function InsertToolbarIcon() {
  return (
    <IconBase className="rich-insert-icon">
      <circle cx="12" cy="12" r="9.2" />
      <path d="M12 7.5v9" />
      <path d="M7.5 12h9" />
    </IconBase>
  );
}

function InlineCodeToolbarIcon() {
  return (
    <IconBase className="rich-menu-icon">
      <path d="M8.4 8.8 5.2 12l3.2 3.2" />
      <path d="M15.6 8.8 18.8 12l-3.2 3.2" />
      <path d="M10.1 16.2h3.8" />
    </IconBase>
  );
}

function CodeBlockToolbarIcon() {
  return (
    <IconBase className="rich-menu-icon">
      <path d="M9 8 5 12l4 4" />
      <path d="M15 8l4 4-4 4" />
      <path d="M13 6.5 11 17.5" />
    </IconBase>
  );
}

function QuoteToolbarIcon() {
  return (
    <IconBase className="rich-menu-icon">
      <path d="M8.5 8.5c-1.7.8-2.7 2.1-2.7 4.1v3.2h4.7v-4.6H8.1c.1-1 .7-1.8 1.8-2.4" />
      <path d="M16.2 8.5c-1.7.8-2.7 2.1-2.7 4.1v3.2h4.7v-4.6h-2.4c.1-1 .7-1.8 1.8-2.4" />
    </IconBase>
  );
}

function DividerToolbarIcon() {
  return (
    <IconBase className="rich-menu-icon">
      <path d="M5 12h14" />
      <path d="M7 8h10" />
      <path d="M7 16h10" />
    </IconBase>
  );
}

function TableToolbarIcon() {
  return (
    <IconBase className="rich-menu-icon">
      <rect x="4.5" y="5" width="15" height="14" rx="1.5" />
      <path d="M4.5 9.5h15" />
      <path d="M4.5 14h15" />
      <path d="M9.5 5v14" />
      <path d="M14.5 5v14" />
    </IconBase>
  );
}

function ImageToolbarIcon() {
  return (
    <IconBase className="rich-menu-icon">
      <rect x="4.5" y="5" width="15" height="14" rx="1.8" />
      <circle cx="9" cy="9.5" r="1.3" />
      <path d="M6.8 16.5 10.5 13l2.4 2.2 2.1-2.7 3 4" />
    </IconBase>
  );
}

function ColorPaletteTool({
  label,
  kind,
  title,
  indicatorColor,
  editable,
  isOpen,
  onToggle,
  onSelect,
  onCustomColor
}: {
  label: string;
  kind: "text" | "highlight";
  title: string;
  indicatorColor: string;
  editable: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onSelect: (color: string) => void;
  onCustomColor: (color: string) => void;
}) {
  const paletteID = `palette-${title}`;
  return (
    <div className={`growth-color-tool ${kind}`} onClick={(event) => event.stopPropagation()}>
      <button type="button" title={title} disabled={!editable} aria-expanded={isOpen} aria-controls={paletteID} style={{ "--indicator-color": indicatorColor } as CSSProperties} onClick={onToggle}>
        {label}
        <span />
      </button>
      {isOpen ? (
        <div id={paletteID} className="growth-color-palette" role="dialog" aria-label={title}>
          <div className="growth-palette-row primary">
            {richPalettePrimary.map((color, index) => (
              <button
                key={`${color}-${index}`}
                className={color === "transparent" ? "empty" : ""}
                type="button"
                title={color === "transparent" ? "默认" : color}
                style={color === "transparent" ? undefined : { "--swatch-color": color } as CSSProperties}
                onClick={() => onSelect(color)}
              />
            ))}
          </div>
          <div className="growth-palette-matrix">
            {richPaletteRows.flatMap((row, rowIndex) =>
              row.map((color, columnIndex) => (
                <button
                  key={`${rowIndex}-${columnIndex}-${color}`}
                  type="button"
                  title={color}
                  style={{ "--swatch-color": color } as CSSProperties}
                  onClick={() => onSelect(color)}
                />
              ))
            )}
          </div>
          <div className="growth-palette-recent">
            <span>最近使用</span>
            <div>
              {richRecentColors.map((color, index) => (
                <button
                  key={`${color}-${index}`}
                  className={color === "transparent" ? "empty" : ""}
                  type="button"
                  title={color === "transparent" ? "暂无" : color}
                  disabled={color === "transparent"}
                  style={color === "transparent" ? undefined : { "--swatch-color": color } as CSSProperties}
                  onClick={() => onSelect(color)}
                />
              ))}
            </div>
          </div>
          <label className="growth-palette-custom">
            <span>◌</span>
            自定义颜色
            <strong>›</strong>
            <input type="color" onInput={(event) => onCustomColor(event.currentTarget.value)} />
          </label>
        </div>
      ) : null}
    </div>
  );
}

function MarkdownPreview({ content }: { content: string }) {
  const blocks: ReactNode[] = [];
  const lines = content.split("\n");
  let codeLines: string[] = [];
  let isCodeBlock = false;

  lines.forEach((line, index) => {
    if (line.trim().startsWith("```")) {
      if (isCodeBlock) {
        blocks.push(
          <pre key={`code-${index}`}>
            <code>{codeLines.join("\n")}</code>
          </pre>
        );
        codeLines = [];
        isCodeBlock = false;
      } else {
        isCodeBlock = true;
      }
      return;
    }
    if (isCodeBlock) {
      codeLines.push(line);
      return;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      blocks.push(<div key={`blank-${index}`} className="markdown-blank" />);
      return;
    }
    if (trimmed.startsWith("### ")) {
      blocks.push(<h3 key={index}>{renderInlineMarkdown(trimmed.slice(4))}</h3>);
      return;
    }
    if (trimmed.startsWith("## ")) {
      blocks.push(<h2 key={index}>{renderInlineMarkdown(trimmed.slice(3))}</h2>);
      return;
    }
    if (trimmed.startsWith("# ")) {
      blocks.push(<h1 key={index}>{renderInlineMarkdown(trimmed.slice(2))}</h1>);
      return;
    }
    if (trimmed.startsWith("> ")) {
      blocks.push(<blockquote key={index}>{renderInlineMarkdown(trimmed.slice(2))}</blockquote>);
      return;
    }
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      blocks.push(
        <p key={index} className="markdown-list-item">
          {renderInlineMarkdown(trimmed.slice(2))}
        </p>
      );
      return;
    }
    if (/^\d+\.\s+/.test(trimmed)) {
      blocks.push(
        <p key={index} className="markdown-list-item ordered">
          {renderInlineMarkdown(trimmed.replace(/^\d+\.\s+/, ""))}
        </p>
      );
      return;
    }
    if (trimmed === "---" || trimmed === "***") {
      blocks.push(<hr key={index} />);
      return;
    }
    blocks.push(<p key={index}>{renderInlineMarkdown(line)}</p>);
  });

  if (isCodeBlock) {
    blocks.push(
      <pre key="code-tail">
        <code>{codeLines.join("\n")}</code>
      </pre>
    );
  }

  return <div className="growth-markdown-preview">{blocks.length ? blocks : <p className="growth-muted">预览会显示在这里。</p>}</div>;
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith("**")) {
      parts.push(<strong key={`${token}-${match.index}`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      parts.push(<code key={`${token}-${match.index}`}>{token.slice(1, -1)}</code>);
    } else {
      const [, label, href] = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/) ?? [];
      parts.push(
        <a key={`${token}-${match.index}`} href={href} target="_blank" rel="noreferrer">
          {label}
        </a>
      );
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

function getNoteExcerpt(content: string) {
  const text = content
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`[\]()\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, 72) : "还没有正文";
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatLastActiveTime(value?: string | null) {
  if (!value) {
    return "从未活跃";
  }
  return formatDateTime(value) || "从未活跃";
}

function EmptyPage({
  page,
  authSession,
  sleepTimerMinutes,
  sleepTimerRemainingSeconds,
  onlineCount,
  onlineUsers,
  onSetSleepTimerMinutes,
  onStartSleepTimer,
  onStopSleepTimer,
  profileView,
  onProfileViewChange,
  audioFileArea,
  audioFiles,
  audioFileLimits,
  audioFilesMessage,
  audioImportReport,
  audioImportPreflight,
  audioImportProgress,
  managedUsers,
  managedUsersMessage,
  managedUserForm,
  managedUserDeleteTarget,
  isAudioFilesLoading,
  isAudioImporting,
  isManagedUsersLoading,
  isManagedUserSubmitting,
  isManagedUserDeleting,
  audioFileMenu,
  audioRenameDraft,
  audioDeleteTarget,
  audioFolderInputRef,
  onOpenAudioFileManager,
  onCloseAudioFileManager,
  onOpenUserManager,
  onRefreshManagedUsers,
  onUpdateManagedUserForm,
  onSubmitManagedUser,
  onChangeManagedUserRole,
  onOpenManagedUserDelete,
  onCloseManagedUserDelete,
  onConfirmManagedUserDelete,
  onChooseAudioFolder,
  onAudioFolderChange,
  onConfirmAudioImportPreflight,
  onCloseAudioImportPreflight,
  onCloseAudioImportReport,
  onRefreshAudioFiles,
  onAudioFileAreaChange,
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
  onlineCount: number;
  onlineUsers: OnlineUser[];
  onSetSleepTimerMinutes: (minutes: number | null) => void;
  onStartSleepTimer: (minutes?: number) => void;
  onStopSleepTimer: () => void;
  profileView: ProfileView;
  onProfileViewChange: (view: ProfileView) => void;
  audioFileArea: AudioFileArea;
  audioFiles: ServerManagedFile[];
  audioFileLimits: AudioFileImportLimits;
  audioFilesMessage: string;
  audioImportReport: AudioFileImportReport | null;
  audioImportPreflight: AudioImportPreflightReport | null;
  audioImportProgress: AudioImportProgress | null;
  managedUsers: ManagedUser[];
  managedUsersMessage: string;
  managedUserForm: ManagedUserFormState;
  managedUserDeleteTarget: ManagedUser | null;
  isAudioFilesLoading: boolean;
  isAudioImporting: boolean;
  isManagedUsersLoading: boolean;
  isManagedUserSubmitting: boolean;
  isManagedUserDeleting: boolean;
  audioFileMenu: AudioFileContextMenu | null;
  audioRenameDraft: AudioFileRenameDraft | null;
  audioDeleteTarget: ServerManagedFile | null;
  audioFolderInputRef: RefObject<HTMLInputElement | null>;
  onOpenAudioFileManager: () => void;
  onCloseAudioFileManager: () => void;
  onOpenUserManager: () => void;
  onRefreshManagedUsers: () => void;
  onUpdateManagedUserForm: (field: keyof ManagedUserFormState, value: string) => void;
  onSubmitManagedUser: (event: FormEvent<HTMLFormElement>) => void;
  onChangeManagedUserRole: (user: ManagedUser, role: ManagedUserRequest["role"]) => void;
  onOpenManagedUserDelete: (user: ManagedUser) => void;
  onCloseManagedUserDelete: () => void;
  onConfirmManagedUserDelete: () => void;
  onChooseAudioFolder: () => void;
  onAudioFolderChange: (files: FileList | null) => void;
  onConfirmAudioImportPreflight: () => void;
  onCloseAudioImportPreflight: () => void;
  onCloseAudioImportReport: () => void;
  onRefreshAudioFiles: () => void;
  onAudioFileAreaChange: (area: AudioFileArea) => void;
  onAudioFileContextMenu: (event: ReactMouseEvent<HTMLElement>, track: ServerManagedFile) => void;
  onOpenAudioRename: (track: ServerManagedFile) => void;
  onUpdateAudioRename: (field: "artist" | "title", value: string) => void;
  onSubmitAudioRename: (event: FormEvent<HTMLFormElement>) => void;
  onCloseAudioRename: () => void;
  onOpenAudioDelete: (track: ServerManagedFile) => void;
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
  const onlineSummary = formatOnlinePresence(onlineUsers, onlineCount);
  const profileViewTabs: { id: ProfileView; label: string }[] = [
    ...baseProfileViewTabs.slice(0, 2),
    ...(canRoleManageAudioFiles(authSession?.role) ? [{ id: "audioFiles" as const, label: "管理" }] : []),
    ...(canRoleManageUsers(authSession?.role) ? [{ id: "users" as const, label: "用户" }] : []),
    ...baseProfileViewTabs.slice(2)
  ];
  const profileSummaryCard = (
    <div className="profile-summary-card" aria-label="用户信息">
      <div className="profile-summary-avatar" aria-hidden="true">
        {profileAvatarText}
      </div>
      <div className="profile-summary-copy">
        <div className="profile-summary-name">{profileDisplayName}</div>
        <div className="profile-summary-phone">手机号 {profilePhone}</div>
        <div className="profile-summary-role">{userRoleLabels[normalizeUserRole(authSession?.role)]}</div>
      </div>
    </div>
  );
  const profileTabs = (
    <nav className="profile-tabs" aria-label="我的页面分类" role="tablist">
      {profileViewTabs.map((tab) => (
        <button
          key={tab.id}
          className={profileView === tab.id ? "active" : ""}
          type="button"
          role="tab"
          aria-selected={profileView === tab.id}
          aria-current={profileView === tab.id ? "page" : undefined}
          onClick={() => {
            if (tab.id === "audioFiles") {
              onOpenAudioFileManager();
              return;
            }
            if (tab.id === "users") {
              onOpenUserManager();
              return;
            }
            onProfileViewChange(tab.id);
          }}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );

  return (
    <section className="simple-page" aria-label={content.title}>
      {page === "profile" && authSession ? (
        <div className="profile-page-content profile-paged-content">
          <aside className="profile-sidebar">
            {profileSummaryCard}
            {profileTabs}
          </aside>
          <section className="profile-content-panel" aria-label="我的页面内容">
            {profileView === "audioFiles" ? (
              <AudioFileManagerPage
                embedded
                area={audioFileArea}
                files={audioFiles}
                limits={audioFileLimits}
                message={audioFilesMessage}
                report={audioImportReport}
                preflight={audioImportPreflight}
                progress={audioImportProgress}
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
                onAreaChange={onAudioFileAreaChange}
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
            ) : profileView === "users" ? (
              <UserManagementPage
                users={managedUsers}
                form={managedUserForm}
                message={managedUsersMessage}
                deleteTarget={managedUserDeleteTarget}
                isLoading={isManagedUsersLoading}
                isSubmitting={isManagedUserSubmitting}
                isDeleting={isManagedUserDeleting}
                onRefresh={onRefreshManagedUsers}
                onChangeForm={onUpdateManagedUserForm}
                onSubmit={onSubmitManagedUser}
                onChangeRole={onChangeManagedUserRole}
                onOpenDelete={onOpenManagedUserDelete}
                onCloseDelete={onCloseManagedUserDelete}
                onConfirmDelete={onConfirmManagedUserDelete}
              />
            ) : profileView === "settings" ? (
              <div className="profile-tab-panel">
                <SleepTimerPanel
                  minutes={sleepTimerMinutes}
                  remainingSeconds={sleepTimerRemainingSeconds}
                  onSetMinutes={onSetSleepTimerMinutes}
                  onStart={onStartSleepTimer}
                  onStop={onStopSleepTimer}
                />
              </div>
            ) : profileView === "about" ? (
              <div className="profile-tab-panel">
                <div className="profile-row app-version-row" aria-label="软件版本">
                  <span className="profile-row-title">版本号</span>
                  <span className="profile-row-value app-version-value">v{appVersion}</span>
                </div>
                <div className="profile-row app-version-row" aria-label="发布日期">
                  <span className="profile-row-title">发布日期</span>
                  <span className="profile-row-value app-version-value">{appReleaseDate}</span>
                </div>
              </div>
            ) : (
              <div className="profile-tab-panel profile-tab-personal">
                <div className="profile-row online-count-row" aria-label="在线人数">
                  <span className="profile-row-title">在线人数</span>
                  <span className="profile-row-value online-count-value" aria-live="polite" title={onlineSummary}>
                    {onlineSummary}
                  </span>
                </div>
                <div className="profile-logout-area">
                  <button className="profile-action-button logout-button" type="button" onClick={onLogout}>
                    退出登录
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      ) : (
        <div className="simple-page-empty">{content.message}</div>
      )}
    </section>
  );
}

function UserManagementPage({
  users,
  form,
  message,
  deleteTarget,
  isLoading,
  isSubmitting,
  isDeleting,
  onRefresh,
  onChangeForm,
  onSubmit,
  onChangeRole,
  onOpenDelete,
  onCloseDelete,
  onConfirmDelete
}: {
  users: ManagedUser[];
  form: ManagedUserFormState;
  message: string;
  deleteTarget: ManagedUser | null;
  isLoading: boolean;
  isSubmitting: boolean;
  isDeleting: boolean;
  onRefresh: () => void;
  onChangeForm: (field: keyof ManagedUserFormState, value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onChangeRole: (user: ManagedUser, role: ManagedUserRequest["role"]) => void;
  onOpenDelete: (user: ManagedUser) => void;
  onCloseDelete: () => void;
  onConfirmDelete: () => void;
}) {
  return (
    <div className="user-manager-page profile-tab-panel">
      <header className="user-manager-header">
        <div>
          <h2>用户管理</h2>
          <p>创建普通管理员、VIP用户或普通用户</p>
        </div>
        <button type="button" disabled={isLoading || isSubmitting} onClick={onRefresh}>
          {isLoading ? "刷新中" : "刷新"}
        </button>
      </header>

      <form className="user-manager-form" onSubmit={onSubmit}>
        <input
          type="tel"
          inputMode="tel"
          value={form.phone}
          maxLength={11}
          placeholder="手机号"
          aria-label="手机号"
          onChange={(event) => onChangeForm("phone", event.target.value)}
        />
        <input
          type="text"
          value={form.nickname}
          maxLength={24}
          placeholder="昵称"
          aria-label="昵称"
          onChange={(event) => onChangeForm("nickname", event.target.value)}
        />
        <input
          type="password"
          value={form.password}
          maxLength={passwordMaxLength}
          placeholder="初始密码"
          aria-label="初始密码"
          onChange={(event) => onChangeForm("password", event.target.value)}
        />
        <select value={form.role} aria-label="用户角色" onChange={(event) => onChangeForm("role", event.target.value)}>
          {assignableUserRoles.map((option) => (
            <option key={option.role} value={option.role}>
              {option.label}
            </option>
          ))}
        </select>
        <button className="user-manager-primary" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "创建中" : "添加用户"}
        </button>
      </form>

      {message ? <div className="user-manager-message" role="status">{message}</div> : null}

      <section className="user-manager-list" aria-label="用户列表" aria-busy={isLoading}>
        <div className="user-manager-list-head" role="row">
          <span>用户</span>
          <span>角色</span>
          <span>最后活跃</span>
          <span>创建时间</span>
          <span>操作</span>
        </div>
        <div className="user-manager-list-body">
          {users.map((user) => (
            <div key={user.id} className="user-manager-row" role="row">
              <div className="user-manager-user">
                <strong>{user.nickname}</strong>
                <span>{formatProfilePhone(user.phone)}</span>
              </div>
              {user.role === "super_admin" ? (
                <span className="user-role-badge">{userRoleLabels[user.role]}</span>
              ) : (
                <select
                  value={user.role}
                  aria-label={`${user.nickname} 的角色`}
                  onChange={(event) => onChangeRole(user, event.target.value as ManagedUserRequest["role"])}
                >
                  {assignableUserRoles.map((option) => (
                    <option key={option.role} value={option.role}>
                      {option.label}
                    </option>
                  ))}
                </select>
              )}
              {user.last_active_at ? (
                <time className="user-manager-last-active" dateTime={user.last_active_at}>
                  {formatLastActiveTime(user.last_active_at)}
                </time>
              ) : (
                <span className="user-manager-last-active muted">{formatLastActiveTime(user.last_active_at)}</span>
              )}
              <time dateTime={user.created_at}>{formatDateTime(user.created_at)}</time>
              <div className="user-manager-actions">
                {user.role === "super_admin" ? (
                  <span className="user-manager-action-muted">不可删除</span>
                ) : (
                  <button type="button" disabled={isDeleting} onClick={() => onOpenDelete(user)}>
                    删除
                  </button>
                )}
              </div>
            </div>
          ))}
          {!users.length ? <div className="user-manager-empty">{isLoading ? "正在读取用户" : "暂无用户"}</div> : null}
        </div>
      </section>

      {deleteTarget ? (
        <div className="search-dialog-backdrop" role="presentation" onClick={onCloseDelete}>
          <div className="search-dialog user-delete-dialog" role="dialog" aria-modal="true" aria-label="删除用户" onClick={(event) => event.stopPropagation()}>
            <h2>删除用户</h2>
            <p>{deleteTarget.nickname}（{formatProfilePhone(deleteTarget.phone)}）</p>
            <div className="search-actions">
              <button type="button" disabled={isDeleting} onClick={onCloseDelete}>
                取消
              </button>
              <button className="primary danger" type="button" disabled={isDeleting} onClick={onConfirmDelete}>
                {isDeleting ? "删除中" : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AudioFileManagerPage({
  embedded = false,
  area,
  files,
  limits,
  message,
  report,
  preflight,
  progress,
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
  onAreaChange,
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
  embedded?: boolean;
  area: AudioFileArea;
  files: ServerManagedFile[];
  limits: AudioFileImportLimits;
  message: string;
  report: AudioFileImportReport | null;
  preflight: AudioImportPreflightReport | null;
  progress: AudioImportProgress | null;
  isLoading: boolean;
  isImporting: boolean;
  menu: AudioFileContextMenu | null;
  renameDraft: AudioFileRenameDraft | null;
  deleteTarget: ServerManagedFile | null;
  folderInputRef: RefObject<HTMLInputElement | null>;
  onBack: () => void;
  onChooseFolder: () => void;
  onFolderChange: (files: FileList | null) => void;
  onConfirmPreflight: () => void;
  onClosePreflight: () => void;
  onCloseReport: () => void;
  onRefresh: () => void;
  onAreaChange: (area: AudioFileArea) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>, track: ServerManagedFile) => void;
  onOpenRename: (track: ServerManagedFile) => void;
  onUpdateRename: (field: "artist" | "title", value: string) => void;
  onSubmitRename: (event: FormEvent<HTMLFormElement>) => void;
  onCloseRename: () => void;
  onOpenDelete: (track: ServerManagedFile) => void;
  onCloseDelete: () => void;
  onConfirmDelete: () => void;
  onCloseMenu: () => void;
}) {
  const [isSearchDialogOpen, setIsSearchDialogOpen] = useState(false);
  const [audioSearchDraft, setAudioSearchDraft] = useState("");
  const [audioSearchQuery, setAudioSearchQuery] = useState("");
  const compactAudioSearchQuery = normalizeAudioFileSearchText(audioSearchQuery);
  const audioSearchTokens = useMemo(() => getAudioFileSearchTokens(audioSearchQuery), [audioSearchQuery]);
  const hasAudioSearch = compactAudioSearchQuery.length > 0;
  const visibleFiles = useMemo(() => {
    if (!hasAudioSearch) {
      return files;
    }
    return files.filter((track) => doesTrackMatchAudioFileSearch(track, compactAudioSearchQuery, audioSearchTokens));
  }, [audioSearchTokens, compactAudioSearchQuery, files, hasAudioSearch]);
  const audioFileCountLabel = hasAudioSearch
    ? `搜索“${audioSearchQuery.trim()}”：${visibleFiles.length} / ${files.length} 个文件`
    : files.length
      ? `当前 ${files.length} 个文件`
      : "管理服务器文件目录";
  const activeArea = audioFileAreas.find((item) => item.id === area) ?? audioFileAreas[0];

  function openAudioSearchDialog() {
    setAudioSearchDraft(audioSearchQuery);
    setIsSearchDialogOpen(true);
  }

  function closeAudioSearchDialog() {
    setIsSearchDialogOpen(false);
  }

  function submitAudioSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAudioSearchQuery(audioSearchDraft.trim());
    setIsSearchDialogOpen(false);
  }

  function refreshAndClearAudioSearch() {
    setAudioSearchDraft("");
    setAudioSearchQuery("");
    setIsSearchDialogOpen(false);
    onRefresh();
  }

  return (
    <div className={embedded ? "audio-manager-page profile-tab-panel" : "profile-page-content audio-manager-page"}>
      <header className="audio-manager-header">
        <button className="audio-manager-back-button" type="button" aria-label="返回" onClick={onBack}>
          ‹
        </button>
        <div className="audio-manager-heading">
          <h2>服务器文件管理</h2>
          <p title={audioFileCountLabel}>{audioFileCountLabel}</p>
        </div>
      </header>

      <nav className="audio-manager-area-tabs" aria-label="服务器文件区域">
        {audioFileAreas.map((item) => (
          <button
            key={item.id}
            className={area === item.id ? "active" : ""}
            type="button"
            aria-current={area === item.id ? "page" : undefined}
            disabled={isImporting}
            onClick={() => onAreaChange(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

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
          {isImporting ? "导入中" : "选择音乐文件夹"}
        </button>
        <button className="audio-manager-secondary-button" type="button" disabled={isLoading || isImporting} onClick={refreshAndClearAudioSearch}>
          刷新
        </button>
        <button
          className={`audio-manager-secondary-button audio-manager-search-button${hasAudioSearch ? " is-active" : ""}`}
          type="button"
          disabled={isImporting}
          aria-haspopup="dialog"
          aria-expanded={isSearchDialogOpen}
          onClick={openAudioSearchDialog}
        >
          搜索
        </button>
      </div>

      <div className="audio-manager-limits">
        <span>{activeArea.label}</span>
        <span>音频 {formatBytes(limits.max_audio_file_bytes)}</span>
        <span>歌词 {formatBytes(limits.max_lyric_file_bytes)}</span>
        <span>单次 {formatBytes(limits.max_total_bytes)} / {limits.max_file_count} 个</span>
      </div>

      {message ? <div className="audio-manager-message" role="status">{message}</div> : null}
      {preflight ? (
        <AudioImportPreflightDialog
          report={preflight}
          progress={progress}
          isImporting={isImporting}
          onCancel={onClosePreflight}
          onConfirm={onConfirmPreflight}
        />
      ) : null}

      {report ? <AudioImportResultDialog report={report} onClose={onCloseReport} /> : null}

      <section className="audio-file-list" aria-label="服务器文件列表" aria-busy={isLoading || isImporting}>
        <div className="audio-file-list-head" role="row">
          <span>文件</span>
          <span>格式</span>
          <span>大小</span>
          <span>操作</span>
        </div>
        <div className="audio-file-list-body">
          {visibleFiles.map((track) => (
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
          {!visibleFiles.length ? (
            <div className="audio-file-empty">
              {isLoading ? "正在读取服务器文件" : hasAudioSearch ? "未找到匹配文件" : "当前区域暂无文件"}
            </div>
          ) : null}
        </div>
      </section>

      {isSearchDialogOpen ? (
        <div className="search-dialog-backdrop" role="presentation" onClick={closeAudioSearchDialog}>
          <form className="search-dialog audio-file-dialog audio-file-search-dialog" role="dialog" aria-modal="true" aria-label="搜索服务器文件" onClick={(event) => event.stopPropagation()} onSubmit={submitAudioSearch}>
            <h2>搜索文件</h2>
            <input
              className="search-input"
              type="search"
              value={audioSearchDraft}
              placeholder="歌曲、歌手或文件名"
              aria-label="搜索服务器文件"
              autoFocus
              onChange={(event) => setAudioSearchDraft(event.target.value)}
            />
            <div className="search-actions">
              <button type="button" onClick={closeAudioSearchDialog}>
                取消
              </button>
              <button className="primary" type="submit">
                确认
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {menu ? (
        <div className="context-menu-layer" role="presentation" onPointerDown={onCloseMenu}>
          <div
            className="track-context-menu audio-file-context-menu"
            role="menu"
            aria-label="服务器文件操作"
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
          <form className="search-dialog audio-file-dialog" role="dialog" aria-modal="true" aria-label="重命名服务器文件" onClick={(event) => event.stopPropagation()} onSubmit={onSubmitRename}>
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
          <div className="search-dialog audio-file-dialog audio-delete-dialog" role="dialog" aria-modal="true" aria-label="删除服务器文件" onClick={(event) => event.stopPropagation()}>
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
  progress,
  isImporting,
  onCancel,
  onConfirm
}: {
  report: AudioImportPreflightReport;
  progress: AudioImportProgress | null;
  isImporting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const canUpload = report.files.length > 0 && !report.blockingMessage && !isImporting;
  const activeProgress = isImporting ? progress : null;
  const [activeFilter, setActiveFilter] = useState<AudioImportPreflightFilter>(() => (report.readyAudioCount > 0 ? "readyAudio" : "readyLyrics"));
  const filterOptions = getAudioPreflightFilterOptions(report);
  const visibleItems = filterAudioPreflightItems(report.items, activeFilter);

  return (
    <div className="search-dialog-backdrop audio-preflight-backdrop" role="presentation" onClick={isImporting ? undefined : onCancel}>
      <div className="search-dialog audio-preflight-dialog" role="dialog" aria-modal="true" aria-label="上传前检查报告" onClick={(event) => event.stopPropagation()}>
        <h2>上传前检查</h2>
        <div className="audio-preflight-summary" role="status">
          {filterOptions.map((option) => (
            <button
              key={option.id}
              className={`audio-preflight-filter-button ${option.className}${activeFilter === option.id ? " active" : ""}`}
              type="button"
              aria-pressed={activeFilter === option.id}
              onClick={() => setActiveFilter(option.id)}
            >
              {option.label} {option.count}
            </button>
          ))}
        </div>
        <p className="audio-preflight-note">
          确认后只上传可导入音频和匹配歌词；重叠、错误和忽略项不会上传。
        </p>
        {report.blockingMessage ? <div className="audio-preflight-blocking">{report.blockingMessage}</div> : null}
        <div className="audio-preflight-list" role="list">
          {visibleItems.length > 0 ? (
            visibleItems.map((item, index) => (
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
            ))
          ) : (
            <div className="audio-preflight-empty" role="listitem">
              {getAudioPreflightEmptyMessage(activeFilter)}
            </div>
          )}
        </div>
        <div className="audio-preflight-total">
          <span>{getAudioPreflightUploadSummary(report)}</span>
          <span>{formatBytes(report.totalUploadBytes)}</span>
        </div>
        {activeProgress ? <AudioUploadProgressPanel progress={activeProgress} /> : null}
        <div className="search-actions">
          <button type="button" disabled={isImporting} onClick={onCancel}>
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

function AudioUploadProgressPanel({ progress }: { progress: AudioImportProgress }) {
  const progressPercent = progress.totalBytes > 0 ? Math.min(100, Math.max(0, (progress.uploadedBytes / progress.totalBytes) * 100)) : 0;

  return (
    <div className="audio-upload-progress" role="status" aria-live="polite">
      <div className="audio-upload-progress-bar" aria-hidden="true">
        <span style={{ width: `${progressPercent}%` }} />
      </div>
      <div className="audio-upload-progress-meta">
        <span>{formatBytes(progress.uploadedBytes)} / {formatBytes(progress.totalBytes)}</span>
        <strong>{progressPercent.toFixed(progressPercent >= 10 ? 0 : 1)}%</strong>
        <span>{formatBytes(progress.speedBytesPerSecond)}/s</span>
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
  const lyricsSkipped = report.lyrics_skipped ?? 0;
  const lyricsFailed = report.lyrics_failed ?? 0;
  const [activeFilter, setActiveFilter] = useState<AudioImportResultFilter>("importedAudio");
  const filterOptions = getAudioImportResultFilterOptions(report);
  const visibleItems = filterAudioImportResultItems(report.items, activeFilter);

  return (
    <div className="search-dialog-backdrop audio-result-backdrop" role="presentation" onClick={onClose}>
      <div className="search-dialog audio-preflight-dialog audio-result-dialog" role="dialog" aria-modal="true" aria-label="上传结果报告" onClick={(event) => event.stopPropagation()}>
        <h2>上传结果报告</h2>
        <div className="audio-preflight-summary audio-result-summary" role="status">
          {filterOptions.map((option) => (
            <button
              key={option.id}
              className={`audio-preflight-filter-button ${option.className}${activeFilter === option.id ? " active" : ""}`}
              type="button"
              aria-pressed={activeFilter === option.id}
              onClick={() => setActiveFilter(option.id)}
            >
              {option.label} {option.count}
            </button>
          ))}
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
          {visibleItems.length ? (
            visibleItems.map((item, index) => (
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
            <div className="audio-result-empty">{getAudioImportResultEmptyMessage(activeFilter)}</div>
          )}
        </div>
        <div className="audio-preflight-total audio-result-total">
          <span>处理 {totalItems} 个文件</span>
          <span>转码 {report.converted}</span>
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
    <section className="audio-access-gate" role="dialog" aria-modal="true" aria-label="服务器文件管理身份验证">
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

function FullscreenIcon({ active }: { active: boolean }) {
  if (active) {
    return (
      <IconBase>
        <path d="M9 4v5H4" />
        <path d="M15 4v5h5" />
        <path d="M9 20v-5H4" />
        <path d="M15 20v-5h5" />
      </IconBase>
    );
  }
  return (
    <IconBase>
      <path d="M4 9V4h5" />
      <path d="M20 9V4h-5" />
      <path d="M4 15v5h5" />
      <path d="M20 15v5h-5" />
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
