import type {
  AuthResponse,
  FavoriteCategory,
  FavoriteCategoryRequest,
  FavoriteCategoryTrackRequest,
  FavoriteRequest,
  LibrarySetting,
  LibrarySettingResponse,
  LoginRequest,
  PresenceRequest,
  PresenceResponse,
  RegisterRequest,
  ScanResult,
  Track,
  TrackLyrics
} from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";
const requestTimeoutMs = 30_000;
const authRequestTimeoutMs = 12_000;
const scanRequestTimeoutMs = 120_000;

type TracksResponse = {
  tracks: Track[];
};
type FavoriteCategoriesResponse = {
  categories: FavoriteCategory[];
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

export function getTrackLyrics(trackID: number): Promise<TrackLyrics> {
  return request<TrackLyrics>(`/api/tracks/${encodeURIComponent(String(trackID))}/lyrics`);
}

export function getFavoriteTracks(userID: number, categoryID?: number): Promise<TracksResponse> {
  const params = new URLSearchParams({ user_id: String(userID) });
  if (categoryID) {
    params.set("category_id", String(categoryID));
  }
  return request<TracksResponse>(`/api/favorites?${params.toString()}`);
}

export function addFavoriteTrack(payload: FavoriteRequest): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>("/api/favorites", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function removeFavoriteTrack(userID: number, trackID: number): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/favorites/${encodeURIComponent(String(trackID))}?user_id=${encodeURIComponent(String(userID))}`, {
    method: "DELETE"
  });
}

export function getFavoriteCategories(userID: number): Promise<FavoriteCategoriesResponse> {
  return request<FavoriteCategoriesResponse>(`/api/favorite-categories?user_id=${encodeURIComponent(String(userID))}`);
}

export function createFavoriteCategory(payload: FavoriteCategoryRequest): Promise<{ category: FavoriteCategory }> {
  return request<{ category: FavoriteCategory }>("/api/favorite-categories", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function deleteFavoriteCategory(userID: number, categoryID: number): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/favorite-categories/${encodeURIComponent(String(categoryID))}?user_id=${encodeURIComponent(String(userID))}`, {
    method: "DELETE"
  });
}

export function addFavoriteTrackToCategory(categoryID: number, payload: FavoriteCategoryTrackRequest): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/favorite-categories/${encodeURIComponent(String(categoryID))}/tracks`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function removeFavoriteTrackFromCategory(userID: number, categoryID: number, trackID: number): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(
    `/api/favorite-categories/${encodeURIComponent(String(categoryID))}/tracks/${encodeURIComponent(String(trackID))}?user_id=${encodeURIComponent(String(userID))}`,
    {
      method: "DELETE"
    }
  );
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
