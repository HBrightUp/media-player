import type {
  AuthResponse,
  ChatMessagesResponse,
  ChatRoomsResponse,
  LibrarySetting,
  LibrarySettingResponse,
  LoginRequest,
  MarkChatReadRequest,
  PresenceRequest,
  PresenceResponse,
  RecallChatMessageResponse,
  RegisterRequest,
  ScanResult,
  SendChatMessageRequest,
  SendChatMessageResponse,
  Track
} from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";
const requestTimeoutMs = 30_000;
const authRequestTimeoutMs = 12_000;
const scanRequestTimeoutMs = 120_000;

type TracksResponse = {
  tracks: Track[];
};
type RequestOptions = {
  timeoutMs?: number;
};

async function request<T>(path: string, init?: RequestInit, options: RequestOptions = {}): Promise<T> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    throw new Error("网络不可用，请检查连接后重试");
  }

  const controller = new AbortController();
  const timeoutID = window.setTimeout(() => controller.abort(), options.timeoutMs ?? requestTimeoutMs);
  let response: Response;

  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {})
      }
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("请求超时，请检查网络后重试");
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      throw new Error("网络不可用，请检查连接后重试");
    }
    throw new Error("网络连接失败，请稍后重试");
  } finally {
    window.clearTimeout(timeoutID);
  }

  if (!response.ok) {
    let message = "请求失败";
    try {
      const payload = (await response.json()) as { error?: string };
      message = payload.error ?? message;
    } catch {
      if (response.status === 500) {
        message = "后端服务未启动或不可访问";
      } else {
        message = response.statusText || message;
      }
    }
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

export function streamURL(track: Track): string {
  return `${API_BASE}${track.stream_url}`;
}

export function getTracks(): Promise<TracksResponse> {
  return request<TracksResponse>("/api/tracks");
}

export function getLibrarySetting(): Promise<LibrarySetting> {
  return request<LibrarySetting>("/api/settings/library");
}

export function setLibraryPath(path: string): Promise<LibrarySettingResponse> {
  return request<LibrarySettingResponse>("/api/settings/library", {
    method: "PUT",
    body: JSON.stringify({ path })
  });
}

export function scanLibrary(): Promise<ScanResult> {
  return request<ScanResult>("/api/library/scan", {
    method: "POST"
  }, {
    timeoutMs: scanRequestTimeoutMs
  });
}

export function registerUser(payload: RegisterRequest): Promise<AuthResponse> {
  return request<AuthResponse>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(payload)
  }, {
    timeoutMs: authRequestTimeoutMs
  });
}

export function loginUser(payload: LoginRequest): Promise<AuthResponse> {
  return request<AuthResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(payload)
  }, {
    timeoutMs: authRequestTimeoutMs
  });
}

export function sendPresenceHeartbeat(payload: PresenceRequest): Promise<PresenceResponse> {
  return request<PresenceResponse>("/api/presence/heartbeat", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function sendPresenceOffline(payload: PresenceRequest): Promise<PresenceResponse> {
  return request<PresenceResponse>("/api/presence/offline", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getChatRooms(): Promise<ChatRoomsResponse> {
  return request<ChatRoomsResponse>("/api/chat/rooms");
}

export function getChatMessages(roomID: number, limit = 50, beforeID?: number, query?: string): Promise<ChatMessagesResponse> {
  const params = new URLSearchParams({ room_id: String(roomID), limit: String(limit) });
  if (beforeID && beforeID > 0) {
    params.set("before_id", String(beforeID));
  }
  if (query?.trim()) {
    params.set("q", query.trim());
  }
  return request<ChatMessagesResponse>(`/api/chat/messages?${params.toString()}`);
}

export function sendChatMessage(payload: SendChatMessageRequest): Promise<SendChatMessageResponse> {
  return request<SendChatMessageResponse>("/api/chat/messages", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function recallChatMessage(messageID: number, userID?: number): Promise<RecallChatMessageResponse> {
  const params = new URLSearchParams();
  if (userID && userID > 0) {
    params.set("user_id", String(userID));
  }
  return request<RecallChatMessageResponse>(`/api/chat/messages/${messageID}?${params.toString()}`, {
    method: "DELETE"
  });
}

export function markChatRead(payload: MarkChatReadRequest): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>("/api/chat/read", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function chatWebSocketURL(options: { roomID: number; userID?: number; nickname?: string; phone?: string }): string {
  const base = API_BASE || window.location.origin;
  const url = new URL("/api/chat/ws", base);
  url.searchParams.set("room_id", String(options.roomID));
  if (options.userID && options.userID > 0) {
    url.searchParams.set("user_id", String(options.userID));
  }
  if (options.nickname) {
    url.searchParams.set("nickname", options.nickname);
  }
  if (options.phone) {
    url.searchParams.set("phone", options.phone);
  }
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}
