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
  accepted: boolean;
};

export type LoginRequest = {
  phone: string;
  password: string;
  accepted: boolean;
};

export type PresenceRequest = {
  session_id: string;
  user_id?: number;
  phone?: string;
};

export type PresenceResponse = {
  online_count: number;
};

export type ChatRoom = {
  id: number;
  name: string;
  description: string;
  created_at: string;
};

export type ChatMember = {
  user_id?: number;
  nickname: string;
  phone?: string;
};

export type ChatRoomsResponse = {
  rooms: ChatRoom[];
};

export type ChatMessageType = "text" | "image" | "audio";

export type ChatMessage = {
  id: number;
  room_id: number;
  user_id?: number;
  nickname: string;
  content: string;
  message_type: ChatMessageType;
  attachment_name?: string;
  attachment_mime?: string;
  attachment_data?: string;
  mentions: string[];
  read_by: number[];
  recalled_at?: string;
  created_at: string;
};

export type ChatMessagesResponse = {
  messages: ChatMessage[];
  has_more: boolean;
};

export type SendChatMessageRequest = {
  room_id: number;
  user_id?: number;
  phone?: string;
  nickname: string;
  content: string;
  message_type: ChatMessageType;
  attachment_name?: string;
  attachment_mime?: string;
  attachment_data?: string;
  mentions: string[];
};

export type SendChatMessageResponse = {
  message: ChatMessage;
};

export type RecallChatMessageResponse = {
  message: ChatMessage;
};

export type MarkChatReadRequest = {
  room_id: number;
  user_id?: number;
};
