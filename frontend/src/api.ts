import type {
  AudioFileAccessResponse,
  AudioFileImportReport,
  AudioFileRenameRequest,
  AudioFilesResponse,
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
  ScanResult,
  Track,
  TrackMembershipsResponse,
  TrackLyrics
} from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";
const requestTimeoutMs = 30_000;
const authRequestTimeoutMs = 12_000;
const scanRequestTimeoutMs = 120_000;
const audioFileRequestTimeoutMs = 30 * 60_000;

type TracksResponse = {
  tracks: Track[];
};
type FavoriteCategoriesResponse = {
  categories: FavoriteCategory[];
};
type RequestOptions = {
  timeoutMs?: number;
};

export class ApiError extends Error {
  status: number;
  retryAfterSeconds: number | null;

  constructor(message: string, status: number, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function audioAccessHeaders(accessToken: string) {
  return {
    "X-Audio-Access-Token": accessToken
  };
}

async function request<T>(path: string, init?: RequestInit, options: RequestOptions = {}): Promise<T> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    throw new Error("网络不可用，请检查连接后重试");
  }

  const controller = new AbortController();
  const timeoutID = window.setTimeout(() => controller.abort(), options.timeoutMs ?? requestTimeoutMs);
  let response: Response;

  try {
    const headers = new Headers(init?.headers);
    const isFormData = typeof FormData !== "undefined" && init?.body instanceof FormData;
    if (!isFormData && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers
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
    throw new ApiError(message, response.status, parseRetryAfterSeconds(response.headers.get("Retry-After")));
  }

  return response.json() as Promise<T>;
}

function parseRetryAfterSeconds(value: string | null) {
  if (!value) {
    return null;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.ceil(seconds);
  }
  const retryAt = Date.parse(value);
  if (!Number.isFinite(retryAt)) {
    return null;
  }
  return Math.max(1, Math.ceil((retryAt - Date.now()) / 1000));
}

export function streamURL(track: Track): string {
  return `${API_BASE}${track.stream_url}`;
}

export function getTracks(): Promise<TracksResponse> {
  return request<TracksResponse>("/api/tracks");
}

export function refreshTracks(userID: number): Promise<TracksResponse> {
  return request<TracksResponse>(`/api/tracks/refresh?user_id=${encodeURIComponent(String(userID))}`, {
    method: "POST"
  });
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

export function getTrackMemberships(userID: number): Promise<TrackMembershipsResponse> {
  return request<TrackMembershipsResponse>(`/api/track-memberships?user_id=${encodeURIComponent(String(userID))}`);
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

export function authorizeAudioFileAccess(userID: number, password: string): Promise<AudioFileAccessResponse> {
  return request<AudioFileAccessResponse>("/api/audio-files/authorize", {
    method: "POST",
    body: JSON.stringify({
      user_id: userID,
      password
    })
  }, {
    timeoutMs: authRequestTimeoutMs
  });
}

export function getAudioFiles(userID: number, accessToken: string): Promise<AudioFilesResponse> {
  return request<AudioFilesResponse>(`/api/audio-files?user_id=${encodeURIComponent(String(userID))}`, {
    headers: audioAccessHeaders(accessToken)
  });
}

export function importAudioFolder(userID: number, files: File[], accessToken: string): Promise<AudioFileImportReport> {
  const formData = new FormData();
  const manifest = files.map((file, index) => {
    const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    return {
      field_name: `file_${index}`,
      relative_path: relativePath,
      size: file.size
    };
  });
  formData.append("manifest", JSON.stringify({ files: manifest }));
  files.forEach((file, index) => {
    formData.append(`file_${index}`, file, file.name);
  });

  return request<AudioFileImportReport>(
    `/api/audio-files/import?user_id=${encodeURIComponent(String(userID))}`,
    {
      method: "POST",
      body: formData,
      headers: audioAccessHeaders(accessToken)
    },
    {
      timeoutMs: audioFileRequestTimeoutMs
    }
  );
}

export function renameAudioFile(trackID: number, payload: AudioFileRenameRequest, accessToken: string): Promise<{ ok: boolean; scan: ScanResult }> {
  return request<{ ok: boolean; scan: ScanResult }>(`/api/audio-files/${encodeURIComponent(String(trackID))}?user_id=${encodeURIComponent(String(payload.user_id))}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
    headers: audioAccessHeaders(accessToken)
  }, {
    timeoutMs: scanRequestTimeoutMs
  });
}

export function deleteAudioFile(userID: number, trackID: number, accessToken: string): Promise<{ ok: boolean; scan: ScanResult }> {
  return request<{ ok: boolean; scan: ScanResult }>(`/api/audio-files/${encodeURIComponent(String(trackID))}?user_id=${encodeURIComponent(String(userID))}`, {
    method: "DELETE",
    headers: audioAccessHeaders(accessToken)
  }, {
    timeoutMs: scanRequestTimeoutMs
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
