export type LyricLine = {
  time_seconds: number | null;
  text: string;
};

export type Track = {
  id: number;
  relative_path: string;
  filename: string;
  title: string;
  artist: string;
  album: string;
  format: string;
  size_bytes: number;
  duration_seconds: number | null;
  modified_at: string;
  stream_url: string;
  lyrics?: LyricLine[];
};

export type TrackLyrics = {
  track_id: number;
  format: "lrc" | "plain";
  content: string;
  lines: LyricLine[];
  source: string;
  updated_at: string | null;
};

export type LibrarySetting = {
  path: string;
  updated_at: string | null;
};

export type ScanResult = {
  root_path: string;
  found: number;
  imported: number;
  skipped: number;
};

export type LibrarySettingResponse = {
  setting: LibrarySetting;
  scan: ScanResult;
};

export type AuthUser = {
  id: number;
  phone: string;
  country_code: string;
  nickname: string;
  created_at: string;
};

export type AuthResponse = {
  user: AuthUser;
};

export type RegisterRequest = {
  nickname: string;
  phone: string;
  password: string;
};

export type LoginRequest = {
  phone: string;
  password: string;
};

export type FavoriteRequest = {
  user_id: number;
  track_id: number;
};

export type PresenceRequest = {
  session_id: string;
  user_id?: number;
  phone?: string;
};

export type PresenceResponse = {
  online_count: number;
};
