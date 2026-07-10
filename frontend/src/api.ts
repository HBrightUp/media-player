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
  GrowthNote,
  GrowthNoteRequest,
  LibrarySetting,
  LibrarySettingResponse,
  LoginRequest,
  NoteFolder,
  NoteFolderRequest,
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
let apiSessionToken = "";

type TracksResponse = {
  tracks: Track[];
};
type FavoriteCategoriesResponse = {
  categories: FavoriteCategory[];
};
type NoteFoldersResponse = {
  folders: NoteFolder[];
};
type GrowthNotesResponse = {
  notes: GrowthNote[];
};
type GrowthNoteResponse = {
  note: GrowthNote;
};
type RequestOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
};
export type UploadProgressSnapshot = {
  loadedBytes: number;
  totalBytes: number | null;
  lengthComputable: boolean;
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

export function setApiSessionToken(token: string | null | undefined) {
  apiSessionToken = token?.trim() ?? "";
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
  let didTimeout = false;
  const abortFromCaller = () => controller.abort();
  if (options.signal?.aborted) {
    controller.abort();
  } else {
    options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  }
  const timeoutID = window.setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, options.timeoutMs ?? requestTimeoutMs);
  let response: Response;

  try {
    const headers = new Headers(init?.headers);
    const isFormData = typeof FormData !== "undefined" && init?.body instanceof FormData;
    if (!isFormData && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    if (apiSessionToken && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${apiSessionToken}`);
    }
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      if (!didTimeout && options.signal?.aborted) {
        throw error;
      }
      throw new Error("请求超时，请检查网络后重试");
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      throw new Error("网络不可用，请检查连接后重试");
    }
    throw new Error("网络连接失败，请稍后重试");
  } finally {
    window.clearTimeout(timeoutID);
    options.signal?.removeEventListener("abort", abortFromCaller);
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

export function coverURL(track: Track): string {
  return track.cover_url ? `${API_BASE}${track.cover_url}` : "";
}

export function getTracks(): Promise<TracksResponse> {
  return request<TracksResponse>("/api/tracks");
}

export function refreshTracks(userID: number): Promise<TracksResponse> {
  return request<TracksResponse>(`/api/tracks/refresh?user_id=${encodeURIComponent(String(userID))}`, {
    method: "POST"
  });
}

export function getTrackLyrics(trackID: number, options: { signal?: AbortSignal } = {}): Promise<TrackLyrics> {
  return request<TrackLyrics>(`/api/tracks/${encodeURIComponent(String(trackID))}/lyrics`, undefined, {
    signal: options.signal
  });
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

export function importAudioFolder(
  userID: number,
  files: File[],
  accessToken: string,
  onProgress?: (snapshot: UploadProgressSnapshot) => void
): Promise<AudioFileImportReport> {
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

  return uploadFormData<AudioFileImportReport>(
    `/api/audio-files/import?user_id=${encodeURIComponent(String(userID))}`,
    formData,
    audioAccessHeaders(accessToken),
    onProgress,
    audioFileRequestTimeoutMs
  );
}

function uploadFormData<T>(
  path: string,
  body: FormData,
  headers: Record<string, string>,
  onProgress: ((snapshot: UploadProgressSnapshot) => void) | undefined,
  timeoutMs: number
): Promise<T> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return Promise.reject(new Error("网络不可用，请检查连接后重试"));
  }

  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}${path}`);
    xhr.timeout = timeoutMs;
    for (const [name, value] of Object.entries(headers)) {
      xhr.setRequestHeader(name, value);
    }
    if (apiSessionToken && !headers.Authorization && !headers.authorization) {
      xhr.setRequestHeader("Authorization", `Bearer ${apiSessionToken}`);
    }

    xhr.upload.onprogress = (event) => {
      onProgress?.({
        loadedBytes: event.loaded,
        totalBytes: event.lengthComputable ? event.total : null,
        lengthComputable: event.lengthComputable
      });
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText || "null") as T);
        } catch {
          reject(new Error("响应格式不正确"));
        }
        return;
      }

      let message = "请求失败";
      try {
        const payload = JSON.parse(xhr.responseText || "{}") as { error?: string };
        message = payload.error ?? message;
      } catch {
        message = xhr.statusText || message;
      }
      reject(new ApiError(message, xhr.status, parseRetryAfterSeconds(xhr.getResponseHeader("Retry-After"))));
    };

    xhr.onerror = () => {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        reject(new Error("网络不可用，请检查连接后重试"));
        return;
      }
      reject(new Error("网络连接失败，请稍后重试"));
    };
    xhr.ontimeout = () => reject(new Error("请求超时，请检查网络后重试"));
    xhr.onabort = () => reject(new Error("上传已取消"));
    xhr.send(body);
  });
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

export function logoutUser(): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>("/api/auth/logout", {
    method: "POST",
    body: JSON.stringify({})
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

export function getNoteFolders(userID?: number): Promise<NoteFoldersResponse> {
  const query = userID ? `?user_id=${encodeURIComponent(String(userID))}` : "";
  return request<NoteFoldersResponse>(`/api/note-folders${query}`);
}

export function createNoteFolder(payload: NoteFolderRequest): Promise<NoteFolder> {
  return request<NoteFolder>("/api/note-folders", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateNoteFolder(folderID: number, payload: NoteFolderRequest): Promise<NoteFolder> {
  return request<NoteFolder>(`/api/note-folders/${encodeURIComponent(String(folderID))}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export function deleteNoteFolder(folderID: number, userID: number): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/note-folders/${encodeURIComponent(String(folderID))}?user_id=${encodeURIComponent(String(userID))}`, {
    method: "DELETE"
  });
}

export function getNotes(options: { userID?: number; folderID?: number | "all" | "unfiled"; query?: string } = {}): Promise<GrowthNotesResponse> {
  const params = new URLSearchParams();
  if (options.userID) {
    params.set("user_id", String(options.userID));
  }
  if (options.folderID !== undefined) {
    params.set("folder_id", String(options.folderID));
  }
  if (options.query) {
    params.set("q", options.query);
  }
  const query = params.toString();
  return request<GrowthNotesResponse>(`/api/notes${query ? `?${query}` : ""}`);
}

export function getNote(noteID: number, userID?: number): Promise<GrowthNoteResponse> {
  const query = userID ? `?user_id=${encodeURIComponent(String(userID))}` : "";
  return request<GrowthNoteResponse>(`/api/notes/${encodeURIComponent(String(noteID))}${query}`);
}

export function createNote(payload: GrowthNoteRequest): Promise<GrowthNote> {
  return request<GrowthNote>("/api/notes", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateNote(noteID: number, payload: GrowthNoteRequest): Promise<GrowthNote> {
  return request<GrowthNote>(`/api/notes/${encodeURIComponent(String(noteID))}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export function deleteNote(noteID: number, userID: number): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/notes/${encodeURIComponent(String(noteID))}?user_id=${encodeURIComponent(String(userID))}`, {
    method: "DELETE"
  });
}
