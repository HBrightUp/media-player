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

export type LoginRequest = {
  phone: string;
  password: string;
};

export type FavoriteRequest = {
  user_id: number;
  track_id: number;
};

export type FavoriteCategory = {
  id: number;
  user_id: number;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type TrackCategoryMembership = {
  track_id: number;
  category_id: number;
  category_name: string;
};

export type TrackMembershipsResponse = {
  favorite_track_ids: number[];
  category_memberships: TrackCategoryMembership[];
};

export type FavoriteCategoryRequest = {
  user_id: number;
  name: string;
};

export type FavoriteCategoryTrackRequest = {
  user_id: number;
  track_id: number;
};

export type PresenceRequest = {
  session_id: string;
  user_id?: number;
  phone?: string;
};

export type OnlineUser = {
  user_id?: number;
  nickname: string;
};

export type PresenceResponse = {
  online_count: number;
  online_users?: OnlineUser[];
};

export type AudioFileImportLimits = {
  max_audio_file_bytes: number;
  max_total_bytes: number;
  max_file_count: number;
  max_lyric_file_bytes: number;
};

export type AudioFilesResponse = {
  files: Track[];
  limits: AudioFileImportLimits;
};

export type AudioFileAccessResponse = {
  token: string;
  expires_at: string;
};

export type AudioFileImportItemResult = {
  relative_path: string;
  target_filename?: string;
  status: "imported" | "skipped" | "failed";
  reason?: string;
  size_bytes?: number;
};

export type AudioFileImportReport = {
  imported: number;
  skipped: number;
  failed: number;
  converted: number;
  lyrics_imported?: number;
  lyrics_skipped?: number;
  lyrics_failed?: number;
  items: AudioFileImportItemResult[];
  scan?: ScanResult;
};

export type AudioFileRenameRequest = {
  user_id: number;
  artist: string;
  title: string;
};
