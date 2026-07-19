export type LyricWord = {
  text: string;
  start_seconds: number;
  end_seconds: number;
};

export type LyricLine = {
  time_seconds: number | null;
  text: string;
  words?: LyricWord[];
};

export type Track = {
  id: number;
  relative_path: string;
  filename: string;
  title: string;
  artist: string;
  album: string;
  format: string;
  quality: "lossless" | "lossy";
  size_bytes: number;
  duration_seconds: number | null;
  modified_at: string;
  stream_url: string;
  cover_url?: string;
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

export type UserRole = "super_admin" | "admin" | "vip" | "user";

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
  role: UserRole;
  created_at: string;
};

export type AuthResponse = {
  user: AuthUser;
  token?: string;
  expires_at?: string;
};

export type LoginRequest = {
  phone: string;
  password: string;
};

export type ManagedUser = {
  id: number;
  phone: string;
  country_code: string;
  nickname: string;
  role: UserRole;
  created_at: string;
  updated_at: string;
  last_active_at: string | null;
};

export type ManagedUserRequest = {
  phone: string;
  nickname: string;
  password: string;
  role: Exclude<UserRole, "super_admin">;
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
};

export type OnlineUser = {
  user_id?: number;
  nickname: string;
};

export type PresenceResponse = {
  online_count: number;
  online_users?: OnlineUser[];
};

export type PlaybackSessionState = "playing" | "paused";

export type PlaybackSessionRequest = {
  track_id: number;
  device_id: string;
  tab_id: string;
  device_name: string;
  state?: PlaybackSessionState;
};

export type PlaybackSessionHeartbeatRequest = {
  token: string;
  track_id?: number;
  device_id: string;
  tab_id: string;
  state: PlaybackSessionState;
};

export type PlaybackSessionResponse = {
  ok: boolean;
  token: string;
  expires_at: string;
  state: PlaybackSessionState;
  track_id: number;
  device_id: string;
  tab_id: string;
  device_name: string;
  stream_ticket?: string;
  stream_ticket_expires_at?: string;
};

export type ClientAppPlatform = "android" | "ios" | "windows" | "macos" | "linux";

export type ClientAppStatus = "available" | "coming_soon";

export type ClientAppRelease = {
  platform: ClientAppPlatform;
  title: string;
  description: string;
  status: ClientAppStatus;
  version_code: number | null;
  version_name: string;
  file_name: string;
  download_url: string;
  size_bytes: number | null;
  sha256: string;
  release_date: string;
  min_system: string;
  release_notes: string[];
};

export type ClientAppsResponse = {
  apps: ClientAppRelease[];
};

export type AudioFileImportLimits = {
  max_audio_file_bytes: number;
  max_total_bytes: number;
  max_file_count: number;
  max_lyric_file_bytes: number;
};

export type ServerAudioFile = {
  filename: string;
  filename_hash: string;
  artist: string;
  title: string;
  extension: string;
  area?: AudioFileArea;
  has_lyrics?: boolean;
  has_karaoke_lyrics?: boolean;
};

export type AudioFileArea = "lossless_music" | "lossy_music" | "lossless_lyrics" | "lossy_lyrics" | "shared_lyrics";

export type ServerManagedFile = {
  id: string;
  track_id?: number;
  area: AudioFileArea;
  kind: "audio" | "lyrics";
  quality?: "lossless" | "lossy";
  has_lyrics?: boolean;
  has_karaoke_lyrics?: boolean;
  relative_path: string;
  filename: string;
  title: string;
  artist: string;
  album?: string;
  format: string;
  size_bytes: number;
  modified_at: string;
};

export type AudioFilesResponse = {
  area: AudioFileArea;
  files: ServerManagedFile[];
  server_audio_set?: ServerAudioFile[];
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
  relative_path?: string;
  artist: string;
  title: string;
};

export type NoteFolder = {
  id: number;
  parent_id: number | null;
  owner_user_id: number;
  owner_nickname: string;
  name: string;
  sort_order: number;
  note_count: number;
  can_edit: boolean;
  created_at: string;
  updated_at: string;
};

export type GrowthNote = {
  id: number;
  folder_id: number | null;
  owner_user_id: number;
  owner_nickname: string;
  title: string;
  content: string;
  can_edit: boolean;
  created_at: string;
  updated_at: string;
};

export type NoteFolderRequest = {
  user_id: number;
  parent_id?: number | null;
  name: string;
};

export type GrowthNoteRequest = {
  user_id: number;
  folder_id?: number | null;
  title: string;
  content: string;
};
