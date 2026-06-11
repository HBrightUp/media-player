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
  lyrics: LyricLine[];
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
