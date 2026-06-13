import { type FormEvent, type KeyboardEvent, type ReactNode, type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  chatWebSocketURL,
  getChatMessages,
  getChatRooms,
  getTracks,
  loginUser,
  markChatRead,
  recallChatMessage,
  registerUser,
  scanLibrary,
  sendChatMessage,
  sendPresenceHeartbeat,
  sendPresenceOffline,
  streamURL
} from "./api";
import type { AuthUser, ChatMember, ChatMessage, ChatMessageType, ChatRoom, Track } from "./types";

type RepeatMode = "off" | "one" | "all";
type AppPage = "music" | "chat" | "discover" | "profile";
type AuthMode = "register" | "login";
type AuthSession = {
  userId?: number;
  phone: string;
  nickname: string;
  expiresAt: number;
  createdAt: string;
};
type AuthReadResult = {
  session: AuthSession | null;
  expired: boolean;
};
type AuthFormState = {
  nickname: string;
  phone: string;
  password: string;
  accepted: boolean;
};
type ChatAttachment = {
  messageType: Exclude<ChatMessageType, "text">;
  name: string;
  mime: string;
  data: string;
};

const tabs = ["音乐列表", "歌曲搜索"];
const appPages: Array<{ id: AppPage; label: string }> = [
  { id: "music", label: "音乐" },
  { id: "chat", label: "聊天室" },
  { id: "discover", label: "发现" },
  { id: "profile", label: "我" }
];
const repeatModes: RepeatMode[] = ["off", "one", "all"];
const repeatModeLabels: Record<RepeatMode, string> = {
  off: "顺序播放",
  one: "单曲循环",
  all: "列表循环"
};
const authSessionStorageKey = "media-player-auth-session";
const authProfileStorageKey = "media-player-auth-profile";
const presenceSessionStorageKey = "media-player-presence-session";
const authSessionDurationMs = 7 * 24 * 60 * 60 * 1000;
const presenceHeartbeatIntervalMs = 25_000;
const nicknameMaxLength = 20;
const passwordMinLength = 6;
const passwordMaxLength = 64;
const chatMessageMaxLength = 500;
const chatHistoryPageSize = 50;
const chatAttachmentMaxBytes = 1_500_000;
const chatRecallWindowMs = 20_000;
const chatVoiceMaxDurationMs = 60_000;
const chatVoiceMinDurationMs = 450;
const emojiOptions = ["😀", "😄", "😂", "🤣", "😊", "😍", "😘", "😎", "😭", "😡", "👍", "👏", "🙏", "🎵", "🔥", "🌟", "💬", "💯"];
const voiceMimeTypeCandidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
const mentionTriggerPattern = /(^|\s)@([^\s@]{0,20})$/u;
const hiddenChatRoomNames = new Set(["音乐闲聊", "发现"]);
const mainlandPhonePattern = /^1[3-9]\d{9}$/;

function App() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mentionAudioContextRef = useRef<AudioContext | null>(null);
  const mentionToneLastPlayedAtRef = useRef(0);
  const toastTimerRef = useRef<number | null>(null);
  const initialAuthRef = useRef<AuthReadResult | null>(null);
  const initialAuthProfileRef = useRef<AuthFormState | null>(null);
  const presenceSessionIdRef = useRef<string | null>(null);
  const chatThreadRef = useRef<HTMLElement | null>(null);
  const chatMessagesEndRef = useRef<HTMLDivElement | null>(null);
  const chatScrollRestoreRef = useRef<number | null>(null);
  const chatShouldStickToBottomRef = useRef(true);
  const chatImageInputRef = useRef<HTMLInputElement | null>(null);
  const voiceRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const voiceStreamRef = useRef<MediaStream | null>(null);
  const voiceStartedAtRef = useRef(0);
  const voiceAutoStopTimerRef = useRef<number | null>(null);
  const isVoiceStartingRef = useRef(false);
  const isVoicePressingRef = useRef(false);
  const shouldSendVoiceRef = useRef(false);
  if (!initialAuthRef.current) {
    initialAuthRef.current = readAuthSession();
  }
  if (!initialAuthProfileRef.current) {
    initialAuthProfileRef.current = readAuthProfile();
  }
  if (!presenceSessionIdRef.current) {
    presenceSessionIdRef.current = readPresenceSessionID();
  }
  const [tracks, setTracks] = useState<Track[]>([]);
  const [currentTrackId, setCurrentTrackId] = useState<number | null>(null);
  const [authSession, setAuthSession] = useState<AuthSession | null>(initialAuthRef.current.session);
  const [authMode, setAuthMode] = useState<AuthMode>(() => (initialAuthRef.current?.expired || initialAuthProfileRef.current?.phone ? "login" : "register"));
  const [authForm, setAuthForm] = useState<AuthFormState>(() => initialAuthProfileRef.current ?? createEmptyAuthForm());
  const [authMessage, setAuthMessage] = useState(initialAuthRef.current.expired ? "登录已过期，请重新登录" : "");
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [showAuthPassword, setShowAuthPassword] = useState(false);
  const [onlineCount, setOnlineCount] = useState<number | null>(null);
  const [isOnlineCountUnavailable, setIsOnlineCountUnavailable] = useState(false);
  const [activePage, setActivePage] = useState<AppPage>("music");
  const [chatRooms, setChatRooms] = useState<ChatRoom[]>([]);
  const [activeChatRoomId, setActiveChatRoomId] = useState<number | null>(null);
  const [chatMembers, setChatMembers] = useState<ChatMember[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [hasMoreChatMessages, setHasMoreChatMessages] = useState(false);
  const [chatDraft, setChatDraft] = useState("");
  const [chatAttachment, setChatAttachment] = useState<ChatAttachment | null>(null);
  const [chatSearchInput, setChatSearchInput] = useState("");
  const [chatSearchQuery, setChatSearchQuery] = useState("");
  const [isEmojiOpen, setIsEmojiOpen] = useState(false);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [isChatLoadingEarlier, setIsChatLoadingEarlier] = useState(false);
  const [isChatSending, setIsChatSending] = useState(false);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [chatError, setChatError] = useState("");
  const [chatNowMs, setChatNowMs] = useState(() => Date.now());
  const [activeTab, setActiveTab] = useState(tabs[0]);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [toastMessage, setToastMessage] = useState("");
  const [loadMessage, setLoadMessage] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(12);
  const [duration, setDuration] = useState(185);

  const currentTrack = useMemo(() => {
    if (!tracks.length) {
      return null;
    }
    return tracks.find((track) => track.id === currentTrackId) ?? tracks[0];
  }, [currentTrackId, tracks]);
  const visibleChatRooms = useMemo(() => chatRooms.filter(isVisibleChatRoom), [chatRooms]);

  useEffect(() => {
    void refreshLibrary();
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

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
    const sessionID = presenceSessionIdRef.current;
    if (!authSession || !sessionID) {
      setOnlineCount(null);
      setIsOnlineCountUnavailable(false);
      return;
    }

    let isCancelled = false;
    const reportPresence = async () => {
      try {
        const payload = await sendPresenceHeartbeat({
          session_id: sessionID,
          user_id: authSession.userId,
          phone: authSession.phone
        });
        if (!isCancelled) {
          setOnlineCount(payload.online_count);
          setIsOnlineCountUnavailable(false);
        }
      } catch {
        if (!isCancelled) {
          setIsOnlineCountUnavailable(true);
        }
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
      isCancelled = true;
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

    setCurrentTime(currentTrack.stream_url ? 0 : 12);
    setDuration(currentTrack.duration_seconds ?? 185);

    if (!currentTrack.stream_url) {
      audio.pause();
      setIsPlaying(false);
      return;
    }

    if (isPlaying) {
      void audio.play().catch(() => setIsPlaying(false));
    } else {
      audio.pause();
    }
  }, [currentTrack, isPlaying]);

  useEffect(() => {
    if (activePage !== "chat" || !authSession) {
      return;
    }

    let isCancelled = false;
    getChatRooms()
      .then((payload) => {
        if (isCancelled) {
          return;
        }
        const visibleRooms = payload.rooms.filter(isVisibleChatRoom);
        setChatRooms(visibleRooms);
        setActiveChatRoomId((previous) => {
          if (previous && visibleRooms.some((room) => room.id === previous)) {
            return previous;
          }
          return visibleRooms[0]?.id ?? null;
        });
      })
      .catch((error) => {
        if (!isCancelled) {
          setChatError(error instanceof Error ? error.message : "聊天室加载失败");
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [activePage, authSession?.userId, authSession?.phone]);

  useEffect(() => {
    if (activePage !== "chat" || !activeChatRoomId || visibleChatRooms.some((room) => room.id === activeChatRoomId)) {
      return;
    }

    setActiveChatRoomId(visibleChatRooms[0]?.id ?? null);
    setChatMembers([]);
    setChatMessages([]);
    setHasMoreChatMessages(false);
    setChatSearchInput("");
    setChatSearchQuery("");
    setChatAttachment(null);
    setIsEmojiOpen(false);
  }, [activePage, activeChatRoomId, visibleChatRooms]);

  useEffect(() => {
    if (activePage !== "chat" || !authSession || !activeChatRoomId) {
      return;
    }

    let isCancelled = false;
    setIsChatLoading(true);
    setChatError("");
    chatShouldStickToBottomRef.current = true;
    getChatMessages(activeChatRoomId, chatHistoryPageSize, undefined, chatSearchQuery)
      .then((payload) => {
        if (!isCancelled) {
          setChatMessages(payload.messages);
          setHasMoreChatMessages(payload.has_more);
        }
      })
      .catch((error) => {
        if (!isCancelled) {
          setChatError(error instanceof Error ? error.message : "聊天记录加载失败");
          setHasMoreChatMessages(false);
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsChatLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [activePage, authSession?.userId, authSession?.phone, activeChatRoomId, chatSearchQuery]);

  useEffect(() => {
    if (activePage !== "chat" || !authSession || !activeChatRoomId) {
      return;
    }

    let isCancelled = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;

    const connect = () => {
      socket = new WebSocket(
        chatWebSocketURL({
          roomID: activeChatRoomId,
          userID: authSession.userId,
          nickname: authSession.nickname,
          phone: authSession.phone
        })
      );
      socket.addEventListener("open", () => {
        if (!isCancelled) {
          setChatError("");
        }
      });
      socket.addEventListener("message", (event) => {
        const payload = parseChatSocketEvent(event.data);
        if (!payload) {
          return;
        }
        if (payload.type === "message" && shouldPlayMentionNotification(payload.message, authSession)) {
          playMentionNotificationTone(mentionAudioContextRef, mentionToneLastPlayedAtRef);
        }
        if ((payload.type === "message" || payload.type === "recall") && payload.message) {
          appendChatMessage(payload.message);
          return;
        }
        if (payload.type === "members" && payload.room_id === activeChatRoomId && payload.members) {
          setChatMembers(payload.members);
          return;
        }
        if (payload.type === "read" && payload.room_id === activeChatRoomId && payload.user_id) {
          markMessagesReadBy(payload.user_id);
        }
      });
      socket.addEventListener("close", () => {
        if (isCancelled) {
          return;
        }
        reconnectTimer = window.setTimeout(connect, 2500);
      });
      socket.addEventListener("error", () => {
        if (!isCancelled) {
          setChatError("聊天室连接中断，正在重连");
        }
      });
    };

    connect();

    return () => {
      isCancelled = true;
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }
      socket?.close();
    };
  }, [activePage, authSession?.userId, authSession?.phone, authSession?.nickname, activeChatRoomId]);

  useLayoutEffect(() => {
    if (activePage === "chat") {
      const thread = chatThreadRef.current;
      const restoreOffset = chatScrollRestoreRef.current;
      if (thread && restoreOffset !== null) {
        thread.scrollTop = thread.scrollHeight - restoreOffset;
        chatScrollRestoreRef.current = null;
        return;
      }
      if (chatShouldStickToBottomRef.current) {
        chatMessagesEndRef.current?.scrollIntoView({ block: "end" });
        chatShouldStickToBottomRef.current = false;
      }
    }
  }, [activePage, chatMessages.length]);

  useEffect(() => {
    if (activePage !== "chat") {
      return;
    }

    const handleResize = () => {
      if (chatScrollRestoreRef.current !== null) {
        return;
      }
      window.requestAnimationFrame(() => {
        chatMessagesEndRef.current?.scrollIntoView({ block: "end" });
      });
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [activePage]);

  useEffect(() => {
    if (activePage !== "chat") {
      return;
    }

    setChatNowMs(Date.now());
    const intervalId = window.setInterval(() => {
      setChatNowMs(Date.now());
    }, 1_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [activePage]);

  useEffect(() => {
    if (activePage !== "chat" || !authSession?.userId || !activeChatRoomId || !chatMessages.length) {
      return;
    }

    void markChatRead({
      room_id: activeChatRoomId,
      user_id: authSession.userId
    }).catch(() => undefined);
  }, [activePage, authSession?.userId, activeChatRoomId, chatMessages.at(-1)?.id]);

  useEffect(() => {
    return () => {
      clearVoiceAutoStopTimer();
      shouldSendVoiceRef.current = false;
      const recorder = voiceRecorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
      }
      stopVoiceStream();
    };
  }, []);

  useEffect(() => {
    const primeMentionAudio = () => {
      resumeMentionAudioContext(mentionAudioContextRef);
    };

    window.addEventListener("pointerdown", primeMentionAudio, { passive: true });
    window.addEventListener("keydown", primeMentionAudio);
    return () => {
      window.removeEventListener("pointerdown", primeMentionAudio);
      window.removeEventListener("keydown", primeMentionAudio);
      const context = mentionAudioContextRef.current;
      mentionAudioContextRef.current = null;
      void context?.close().catch(() => undefined);
    };
  }, []);

  const activeDuration = duration || currentTrack?.duration_seconds || 185;

  function appendChatMessage(message: ChatMessage) {
    chatShouldStickToBottomRef.current = true;
    setChatMessages((previous) => mergeChatMessage(previous, message));
  }

  function markMessagesReadBy(userId: number) {
    setChatMessages((previous) =>
      previous.map((message) => {
        if (message.user_id === userId || message.read_by.includes(userId)) {
          return message;
        }
        return { ...message, read_by: [...message.read_by, userId] };
      })
    );
  }

  async function loadEarlierChatMessages() {
    const firstMessageID = chatMessages[0]?.id;
    if (!activeChatRoomId || !firstMessageID || isChatLoadingEarlier || isChatLoading || !hasMoreChatMessages) {
      return;
    }

    const thread = chatThreadRef.current;
    chatScrollRestoreRef.current = thread ? thread.scrollHeight - thread.scrollTop : null;
    setIsChatLoadingEarlier(true);
    setChatError("");
    try {
      const payload = await getChatMessages(activeChatRoomId, chatHistoryPageSize, firstMessageID, chatSearchQuery);
      setChatMessages((previous) => mergeChatMessages(payload.messages, previous));
      setHasMoreChatMessages(payload.has_more);
    } catch (error) {
      chatScrollRestoreRef.current = null;
      setChatError(error instanceof Error ? error.message : "更早聊天记录加载失败");
    } finally {
      setIsChatLoadingEarlier(false);
    }
  }

  async function refreshLibrary({ scan = false }: { scan?: boolean } = {}) {
    setIsLoading(true);
    setIsScanning(scan);
    setLoadMessage("");
    if (scan) {
      clearCurrentLibrary();
    }
    try {
      if (scan) {
        await scanLibrary();
      }
      const payload = await getTracks();
      setTracks(payload.tracks);
      setCurrentTrackId((previous) => {
        if (!scan && previous && payload.tracks.some((track) => track.id === previous)) {
          return previous;
        }
        return payload.tracks[0]?.id ?? null;
      });
    } catch (error) {
      setTracks([]);
      setCurrentTrackId(null);
      setLoadMessage(error instanceof Error ? error.message : "本地音乐列表加载失败");
    } finally {
      setIsLoading(false);
      setIsScanning(false);
    }
  }

  function clearCurrentLibrary() {
    audioRef.current?.pause();
    setTracks([]);
    setCurrentTrackId(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }

  function handleTabClick(tab: string) {
    setActiveTab(tab);
    setActivePage("music");
    if (tab === "音乐列表") {
      setIsSearchOpen(false);
      void refreshLibrary({ scan: true });
      return;
    }
    setSearchQuery("");
    setIsSearchOpen(true);
  }

  function handlePageClick(page: AppPage) {
    setActivePage(page);
    if (page !== "music") {
      setIsSearchOpen(false);
      setActiveTab(tabs[0]);
    }
  }

  function handleChatRoomClick(roomID: number) {
    if (roomID === activeChatRoomId) {
      return;
    }
    setActiveChatRoomId(roomID);
    setChatMembers([]);
    setChatMessages([]);
    setHasMoreChatMessages(false);
    setChatSearchInput("");
    setChatSearchQuery("");
    setChatAttachment(null);
    setIsEmojiOpen(false);
    chatShouldStickToBottomRef.current = true;
  }

  function handleChatSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setChatSearchQuery(chatSearchInput.trim());
  }

  function clearChatSearch() {
    setChatSearchInput("");
    setChatSearchQuery("");
  }

  function handleMentionMember(member: ChatMember) {
    setChatDraft((previous) => applyMentionToDraft(previous, member.nickname));
    setChatError("");
    setIsEmojiOpen(false);
  }

  function clearVoiceAutoStopTimer() {
    if (voiceAutoStopTimerRef.current) {
      window.clearTimeout(voiceAutoStopTimerRef.current);
      voiceAutoStopTimerRef.current = null;
    }
  }

  function stopVoiceStream() {
    voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
    voiceStreamRef.current = null;
  }

  async function handleVoiceRecordStart() {
    isVoicePressingRef.current = true;
    if (isVoiceStartingRef.current || isRecordingVoice || isChatSending) {
      return;
    }
    if (!authSession) {
      setChatError("请先登录后录音");
      return;
    }
    if (!activeChatRoomId) {
      setChatError("请选择聊天室");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setChatError(window.isSecureContext ? "当前浏览器不支持录音" : "当前地址不支持录音，请使用 HTTPS 或 localhost");
      return;
    }

    isVoiceStartingRef.current = true;
    setChatError("");
    setIsEmojiOpen(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!isVoicePressingRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const mimeType = selectVoiceMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      voiceChunksRef.current = [];
      voiceStreamRef.current = stream;
      voiceStartedAtRef.current = Date.now();
      voiceRecorderRef.current = recorder;
      shouldSendVoiceRef.current = false;

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) {
          voiceChunksRef.current.push(event.data);
        }
      });
      recorder.addEventListener("stop", () => {
        void finishVoiceRecording(recorder.mimeType || mimeType);
      });
      recorder.addEventListener("error", () => {
        setChatError("录音失败，请重试");
        setIsRecordingVoice(false);
        clearVoiceAutoStopTimer();
        stopVoiceStream();
      });

      recorder.start();
      setIsRecordingVoice(true);
      clearVoiceAutoStopTimer();
      voiceAutoStopTimerRef.current = window.setTimeout(() => {
        handleVoiceRecordEnd();
      }, chatVoiceMaxDurationMs);
    } catch (error) {
      stopVoiceStream();
      setIsRecordingVoice(false);
      setChatError(error instanceof DOMException && error.name === "NotAllowedError" ? "麦克风权限未开启，请允许浏览器使用麦克风" : "无法使用麦克风，请检查设备和权限");
    } finally {
      isVoiceStartingRef.current = false;
    }
  }

  function handleVoiceRecordEnd() {
    isVoicePressingRef.current = false;
    const recorder = voiceRecorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      return;
    }
    shouldSendVoiceRef.current = true;
    recorder.stop();
  }

  async function finishVoiceRecording(mimeType: string) {
    const durationMs = Date.now() - voiceStartedAtRef.current;
    const chunks = voiceChunksRef.current;
    const shouldSend = shouldSendVoiceRef.current;
    voiceRecorderRef.current = null;
    voiceChunksRef.current = [];
    shouldSendVoiceRef.current = false;
    setIsRecordingVoice(false);
    clearVoiceAutoStopTimer();
    stopVoiceStream();

    if (!shouldSend) {
      return;
    }
    if (durationMs < chatVoiceMinDurationMs || !chunks.length) {
      setChatError("录音时间太短，请按住后再松开");
      return;
    }
    if (!authSession || !activeChatRoomId) {
      setChatError("请先登录并选择聊天室");
      return;
    }

    const blobType = mimeType || chunks[0]?.type || "audio/webm";
    const voiceBlob = new Blob(chunks, { type: blobType });
    if (voiceBlob.size > chatAttachmentMaxBytes) {
      setChatError("录音过长，请控制在 1.5MB 以内");
      return;
    }

    setIsChatSending(true);
    setChatError("");
    try {
      const data = await readFileAsDataURL(voiceBlob);
      const durationLabel = formatVoiceDuration(durationMs);
      const payload = await sendChatMessage({
        room_id: activeChatRoomId,
        user_id: authSession.userId,
        phone: authSession.phone,
        nickname: authSession.nickname,
        content: `语音消息 ${durationLabel}`,
        message_type: "audio",
        attachment_name: `voice-${Date.now()}.${audioExtensionForMimeType(voiceBlob.type)}`,
        attachment_mime: voiceBlob.type,
        attachment_data: data,
        mentions: []
      });
      appendChatMessage(payload.message);
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "语音发送失败");
    } finally {
      setIsChatSending(false);
    }
  }

  async function sendEmojiMessage(emoji: string) {
    if (isChatSending) {
      return;
    }
    if (!authSession) {
      setChatError("请先登录后发送表情");
      return;
    }
    if (!activeChatRoomId) {
      setChatError("请选择聊天室");
      return;
    }

    setIsChatSending(true);
    setChatError("");
    try {
      const payload = await sendChatMessage({
        room_id: activeChatRoomId,
        user_id: authSession.userId,
        phone: authSession.phone,
        nickname: authSession.nickname,
        content: emoji,
        message_type: "text",
        mentions: []
      });
      appendChatMessage(payload.message);
      setIsEmojiOpen(false);
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "表情发送失败");
    } finally {
      setIsChatSending(false);
    }
  }

  async function handleChatFileSelected(file: File | null, messageType: Exclude<ChatMessageType, "text">) {
    if (!file) {
      return;
    }
    if (file.size > chatAttachmentMaxBytes) {
      setChatError("文件过大，请选择 1.5MB 以内的图片或音频");
      return;
    }
    if (messageType === "image" && !file.type.startsWith("image/")) {
      setChatError("请选择图片文件");
      return;
    }
    if (messageType === "audio" && !file.type.startsWith("audio/")) {
      setChatError("请选择音频文件");
      return;
    }

    try {
      const data = await readFileAsDataURL(file);
      setChatAttachment({
        messageType,
        name: file.name,
        mime: file.type,
        data
      });
      setChatError("");
    } catch {
      setChatError("读取文件失败");
    }
  }

  async function handleRecallMessage(message: ChatMessage) {
    if (!authSession?.userId) {
      setChatError("请先登录后撤回消息");
      return;
    }
    if (!isMessageRecallable(message, Date.now())) {
      setChatError("消息已超过20秒，不能撤回");
      return;
    }

    try {
      const payload = await recallChatMessage(message.id, authSession.userId);
      appendChatMessage(payload.message);
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "撤回消息失败");
    }
  }

  async function handleChatSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = chatDraft.trim();
    if (!authSession) {
      setChatError("请先登录后发送消息");
      return;
    }
    if (!activeChatRoomId) {
      setChatError("请选择聊天室");
      return;
    }
    if (!content && !chatAttachment) {
      setChatError("消息不能为空");
      return;
    }
    if (Array.from(content).length > chatMessageMaxLength) {
      setChatError(`消息不能超过${chatMessageMaxLength}个字符`);
      return;
    }

    setIsChatSending(true);
    setChatError("");
    try {
      const payload = await sendChatMessage({
        room_id: activeChatRoomId,
        user_id: authSession.userId,
        phone: authSession.phone,
        nickname: authSession.nickname,
        content,
        message_type: chatAttachment?.messageType ?? "text",
        attachment_name: chatAttachment?.name,
        attachment_mime: chatAttachment?.mime,
        attachment_data: chatAttachment?.data,
        mentions: extractMentions(content, chatMembers)
      });
      appendChatMessage(payload.message);
      setChatDraft("");
      setChatAttachment(null);
      setIsEmojiOpen(false);
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "消息发送失败");
    } finally {
      setIsChatSending(false);
    }
  }

  function handleChatDraftKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  function updateAuthForm(field: keyof AuthFormState, value: string | boolean) {
    setAuthForm((previous) => ({ ...previous, [field]: normalizeAuthField(field, value) }));
    setAuthMessage("");
  }

  function handleAuthModeChange(mode: AuthMode) {
    setAuthMode(mode);
    setAuthMessage("");
    setShowAuthPassword(false);
  }

  function handleAuthCloseAttempt() {
    setAuthMessage("请先登录或注册后继续");
  }

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationMessage = getAuthValidationMessage(authMode, authForm);
    if (validationMessage) {
      setAuthMessage(validationMessage);
      return;
    }

    setIsAuthSubmitting(true);
    try {
      const phone = normalizePhone(authForm.phone);
      const response =
        authMode === "register"
          ? await registerUser({
              nickname: authForm.nickname.trim(),
              phone,
              password: authForm.password,
              accepted: authForm.accepted
            })
          : await loginUser({
              phone,
              password: authForm.password,
              accepted: authForm.accepted
            });
      const nextSession = createAuthSession(response.user);
      persistAuthSession(nextSession);
      persistAuthProfile(response.user);
      setAuthSession(nextSession);
      setAuthForm((previous) => ({
        ...previous,
        nickname: response.user.nickname,
        phone: response.user.phone,
        password: "",
        accepted: false
      }));
      setAuthMessage("");
      setShowAuthPassword(false);
      setActivePage("music");
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : "提交失败，请稍后再试");
    } finally {
      setIsAuthSubmitting(false);
    }
  }

  function handleLogout() {
    removeLocalStorage(authSessionStorageKey);
    setAuthSession(null);
    setAuthMode("login");
    setAuthForm((previous) => ({ ...previous, password: "", accepted: false }));
    setAuthMessage("");
    setShowAuthPassword(false);
    setActivePage("music");
    setIsSearchOpen(false);
    setActiveTab(tabs[0]);
  }

  function closeSearchDialog() {
    setIsSearchOpen(false);
    setActiveTab("音乐列表");
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

  async function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const keyword = searchQuery.trim();
    if (!keyword) {
      showToast("音乐不存在");
      return;
    }

    setIsSearching(true);
    try {
      const payload = await getTracks();
      const matchedTracks = payload.tracks.filter((track) => trackMatchesQuery(track, keyword));
      if (!matchedTracks.length) {
        showToast("音乐不存在");
        return;
      }

      audioRef.current?.pause();
      setIsPlaying(false);
      setTracks(matchedTracks);
      setCurrentTrackId(matchedTracks[0].id);
      setLoadMessage("");
      setIsSearchOpen(false);
      setActiveTab("音乐列表");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "音乐不存在");
    } finally {
      setIsSearching(false);
    }
  }

  function playTrack(track: Track) {
    setCurrentTrackId(track.id);
    setIsPlaying(Boolean(track.stream_url));
  }

  function togglePlay() {
    if (!currentTrack && tracks[0]) {
      setCurrentTrackId(tracks[0].id);
    }
    if (!currentTrack?.stream_url) {
      setIsPlaying(false);
      return;
    }
    setIsPlaying((value) => !value);
  }

  function stepTrack(direction: 1 | -1) {
    if (!tracks.length) {
      return;
    }
    const currentIndex = Math.max(
      0,
      tracks.findIndex((track) => track.id === currentTrack?.id)
    );
    const nextIndex = (currentIndex + direction + tracks.length) % tracks.length;
    playTrack(tracks[nextIndex]);
  }

  function handleEnded() {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (repeatMode === "one") {
      audio.currentTime = 0;
      void audio.play();
      return;
    }
    if (repeatMode === "off" && currentTrack?.id === tracks.at(-1)?.id) {
      setIsPlaying(false);
      return;
    }
    stepTrack(1);
  }

  function handleSeek(value: string) {
    const nextTime = Number(value);
    if (!Number.isFinite(nextTime)) {
      return;
    }
    if (audioRef.current && currentTrack?.stream_url) {
      audioRef.current.currentTime = nextTime;
    }
    setCurrentTime(nextTime);
  }

  const emptyMessage = loadMessage || "暂无本地 MP3 音乐";
  const isAuthVisible = !authSession;
  const canSubmitAuth = !isAuthSubmitting && isAuthFormReady(authMode, authForm);
  const playingTrackId = isPlaying ? currentTrack?.id ?? null : null;

  return (
    <main className="player-screen" aria-label="MediaPlayer">
      <div className="top-line" />
      <section className="app-page-area" aria-label="当前页面">
        {activePage === "music" ? (
          <section className="music-page" aria-label="音乐">
            <header className="app-header">
              <h1>MediaPlayer</h1>
            </header>

            <nav className="mode-tabs" aria-label="播放器视图">
              {tabs.map((tab) => (
                tab === "音乐列表" ? (
                  <div key={tab} className={`mode-tab-label ${tab === activeTab ? "active" : ""}`} aria-label="音乐列表">
                    {tab}
                  </div>
                ) : (
                  <button key={tab} className={tab === activeTab ? "active" : ""} type="button" onClick={() => handleTabClick(tab)}>
                    {tab}
                  </button>
                )
              ))}
            </nav>

            <section className="song-table" aria-label="本地音乐列表" aria-busy={isLoading}>
              <div className="table-head">
                <span />
                <span>歌曲</span>
                <span>歌手</span>
                <span>专辑</span>
              </div>
              <div className="table-body">
                {tracks.map((track, index) => (
                  <button
                    key={track.id}
                    type="button"
                    className={`table-row ${track.id === playingTrackId ? "active" : ""}`}
                    aria-current={track.id === playingTrackId ? "true" : undefined}
                    onClick={() => playTrack(track)}
                  >
                    <span className="row-index">{index + 1}</span>
                    <span className="row-title">{track.title}</span>
                    <span>{track.artist}</span>
                    <span>{track.album}</span>
                  </button>
                ))}
                {!tracks.length ? <div className="empty-table">{isLoading ? (isScanning ? "正在重新检查音乐文件夹" : "正在加载本地音乐列表") : emptyMessage}</div> : null}
              </div>
            </section>

            {isSearchOpen ? (
              <div className="search-dialog-backdrop" role="presentation" onClick={closeSearchDialog}>
                <form
                  className="search-dialog"
                  role="dialog"
                  aria-modal="true"
                  aria-label="歌曲搜索"
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
                <button className="play-toggle" type="button" aria-label={isPlaying ? "暂停" : "播放"} onClick={togglePlay}>
                  {isPlaying ? <PauseIcon /> : <PlayIcon />}
                </button>
                <button type="button" aria-label="下一首" onClick={() => stepTrack(1)}>
                  <NextIcon />
                </button>
                <button
                  className={`repeat-mode-button mode-${repeatMode}`}
                  type="button"
                  aria-label={`播放模式：${repeatModeLabels[repeatMode]}`}
                  title={repeatModeLabels[repeatMode]}
                  onClick={() => setRepeatMode(nextRepeatMode(repeatMode))}
                >
                  <RepeatModeIcon mode={repeatMode} />
                </button>
              </div>

              <div className="progress-group">
                <span>{formatDuration(currentTime)}</span>
                <input
                  type="range"
                  min="0"
                  max={Math.max(activeDuration, currentTime, 1)}
                  value={Math.min(currentTime, Math.max(activeDuration, currentTime, 1))}
                  onChange={(event) => handleSeek(event.target.value)}
                  aria-label="播放进度"
                />
                <span>{formatDuration(activeDuration)}</span>
              </div>
            </footer>
          </section>
        ) : activePage === "chat" ? (
          <ChatPage
            authSession={authSession}
            rooms={visibleChatRooms}
            activeRoomId={activeChatRoomId}
            members={chatMembers}
            messages={chatMessages}
            hasMore={hasMoreChatMessages}
            draft={chatDraft}
            attachment={chatAttachment}
            searchInput={chatSearchInput}
            searchQuery={chatSearchQuery}
            isEmojiOpen={isEmojiOpen}
            isLoading={isChatLoading}
            isLoadingEarlier={isChatLoadingEarlier}
            isSending={isChatSending}
            nowMs={chatNowMs}
            error={chatError}
            threadRef={chatThreadRef}
            messagesEndRef={chatMessagesEndRef}
            imageInputRef={chatImageInputRef}
            onRoomClick={handleChatRoomClick}
            onSearchInputChange={setChatSearchInput}
            onSearchSubmit={handleChatSearchSubmit}
            onClearSearch={clearChatSearch}
            onDraftChange={(value) => {
              setChatDraft(Array.from(value).slice(0, chatMessageMaxLength).join(""));
              setChatError("");
              if (getActiveMentionQuery(value) !== null) {
                setIsEmojiOpen(false);
              }
            }}
            onDraftKeyDown={handleChatDraftKeyDown}
            onEmojiToggle={() => setIsEmojiOpen((value) => !value)}
            onEmojiSelect={(emoji) => {
              void sendEmojiMessage(emoji);
            }}
            isVoiceRecording={isRecordingVoice}
            onVoiceRecordStart={() => {
              void handleVoiceRecordStart();
            }}
            onVoiceRecordEnd={handleVoiceRecordEnd}
            onMentionMember={handleMentionMember}
            onFileSelected={handleChatFileSelected}
            onClearAttachment={() => setChatAttachment(null)}
            onLoadEarlier={loadEarlierChatMessages}
            onRecallMessage={handleRecallMessage}
            onSubmit={handleChatSubmit}
          />
        ) : (
          <EmptyPage
            page={activePage}
            authSession={authSession}
            onlineCount={onlineCount}
            isOnlineCountUnavailable={isOnlineCountUnavailable}
            onLogout={handleLogout}
          />
        )}
      </section>

      <nav className="bottom-tabs" aria-label="底部页面导航">
        {appPages.map((page) => (
          <button
            key={page.id}
            className={page.id === activePage ? "active" : ""}
            type="button"
            aria-current={page.id === activePage ? "page" : undefined}
            onClick={() => handlePageClick(page.id)}
          >
            <PageIcon page={page.id} />
            <span>{page.label}</span>
          </button>
        ))}
      </nav>

      <audio
        ref={audioRef}
        src={currentTrack?.stream_url ? streamURL(currentTrack) : undefined}
        preload="metadata"
        onLoadedMetadata={(event) => {
          const nextDuration = event.currentTarget.duration;
          setDuration(Number.isFinite(nextDuration) ? nextDuration : 0);
        }}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={handleEnded}
      />

      {isAuthVisible ? (
        <AuthPage
          mode={authMode}
          form={authForm}
          message={authMessage}
          canSubmit={canSubmitAuth}
          isSubmitting={isAuthSubmitting}
          showPassword={showAuthPassword}
          onChange={updateAuthForm}
          onCloseAttempt={handleAuthCloseAttempt}
          onModeChange={handleAuthModeChange}
          onSubmit={handleAuthSubmit}
          onTogglePassword={() => setShowAuthPassword((value) => !value)}
        />
      ) : null}
    </main>
  );
}

function nextRepeatMode(mode: RepeatMode): RepeatMode {
  const currentIndex = repeatModes.indexOf(mode);
  return repeatModes[(currentIndex + 1) % repeatModes.length];
}

function trackMatchesQuery(track: Track, keyword: string) {
  const normalizedKeyword = keyword.toLocaleLowerCase();
  return [track.title, track.filename, track.relative_path].some((value) =>
    value.toLocaleLowerCase().includes(normalizedKeyword)
  );
}

function mergeChatMessage(messages: ChatMessage[], message: ChatMessage) {
  return mergeChatMessages(messages, [message]);
}

function mergeChatMessages(messages: ChatMessage[], incomingMessages: ChatMessage[]) {
  if (!incomingMessages.length) {
    return messages;
  }

  const messageByID = new Map<number, ChatMessage>();
  for (const message of messages) {
    messageByID.set(message.id, message);
  }
  for (const message of incomingMessages) {
    messageByID.set(message.id, message);
  }
  return Array.from(messageByID.values()).sort((left, right) => left.id - right.id);
}

function isVisibleChatRoom(room: ChatRoom) {
  return !hiddenChatRoomNames.has(room.name);
}

type ChatSocketEvent =
  | { type: "message" | "recall"; message: ChatMessage }
  | { type: "members"; room_id: number; members: ChatMember[] }
  | { type: "read"; room_id: number; user_id: number };

function parseChatSocketEvent(data: unknown): ChatSocketEvent | null {
  if (typeof data !== "string") {
    return null;
  }
  try {
    const payload = JSON.parse(data) as {
      type?: string;
      room_id?: number;
      user_id?: number;
      message?: Partial<ChatMessage>;
      members?: Partial<ChatMember>[];
    };
    if (payload.type === "members" && typeof payload.room_id === "number" && Array.isArray(payload.members)) {
      return {
        type: "members",
        room_id: payload.room_id,
        members: payload.members
          .filter((member) => typeof member.nickname === "string")
          .map((member) => ({
            user_id: typeof member.user_id === "number" ? member.user_id : undefined,
            nickname: String(member.nickname),
            phone: typeof member.phone === "string" ? member.phone : undefined
          }))
      };
    }
    if (payload.type === "read" && typeof payload.room_id === "number" && typeof payload.user_id === "number") {
      return {
        type: "read",
        room_id: payload.room_id,
        user_id: payload.user_id
      };
    }
    if (payload.type !== "message" && payload.type !== "recall") {
      return null;
    }
    const message = normalizeChatMessage(payload.message);
    return message ? { type: payload.type, message } : null;
  } catch {
    return null;
  }
}

function normalizeChatMessage(message?: Partial<ChatMessage>): ChatMessage | null {
  if (!message) {
    return null;
  }
  if (
    typeof message.id !== "number" ||
    typeof message.room_id !== "number" ||
    typeof message.nickname !== "string" ||
    typeof message.content !== "string" ||
    typeof message.created_at !== "string"
  ) {
    return null;
  }
  const messageType = message.message_type === "image" || message.message_type === "audio" ? message.message_type : "text";
  return {
    id: message.id,
    room_id: message.room_id,
    user_id: typeof message.user_id === "number" ? message.user_id : undefined,
    nickname: message.nickname,
    content: message.content,
    message_type: messageType,
    attachment_name: typeof message.attachment_name === "string" ? message.attachment_name : undefined,
    attachment_mime: typeof message.attachment_mime === "string" ? message.attachment_mime : undefined,
    attachment_data: typeof message.attachment_data === "string" ? message.attachment_data : undefined,
    mentions: Array.isArray(message.mentions) ? message.mentions.filter((mention): mention is string => typeof mention === "string") : [],
    read_by: Array.isArray(message.read_by) ? message.read_by.filter((userID): userID is number => typeof userID === "number") : [],
    recalled_at: typeof message.recalled_at === "string" ? message.recalled_at : undefined,
    created_at: message.created_at
  };
}

function isMessageRecallable(message: ChatMessage, nowMs: number) {
  const createdAtMs = new Date(message.created_at).getTime();
  if (!Number.isFinite(createdAtMs)) {
    return false;
  }
  return nowMs - createdAtMs <= chatRecallWindowMs;
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
    const createdAt = typeof parsed.createdAt === "string" ? parsed.createdAt : "";

    if (!phone || !nickname || !createdAt || expiresAt <= Date.now()) {
      removeLocalStorage(authSessionStorageKey);
      return { session: null, expired: Boolean(expiresAt) };
    }

    return { session: { userId, phone, nickname, expiresAt, createdAt }, expired: false };
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
    password: "",
    accepted: false
  };
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

function createPresenceSessionID() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `presence-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isAuthFormReady(mode: AuthMode, form: AuthFormState) {
  return getAuthValidationMessage(mode, form) === "";
}

function getAuthValidationMessage(mode: AuthMode, form: AuthFormState) {
  const nickname = form.nickname.trim();
  const phone = normalizePhone(form.phone);

  if (mode === "register" && !nickname) {
    return "请填写昵称";
  }
  if (mode === "register" && Array.from(nickname).length > nicknameMaxLength) {
    return `昵称不能超过${nicknameMaxLength}个字符`;
  }
  if (!mainlandPhonePattern.test(phone)) {
    return "请输入有效的中国大陆手机号码";
  }
  if (form.password.length < passwordMinLength || form.password.length > passwordMaxLength) {
    return `密码长度需为${passwordMinLength}-${passwordMaxLength}位`;
  }
  if (!form.accepted) {
    return "请先同意软件许可及服务协议";
  }
  return "";
}

function createAuthSession(user: AuthUser): AuthSession {
  return {
    userId: user.id,
    phone: user.phone,
    nickname: user.nickname,
    createdAt: new Date().toISOString(),
    expiresAt: Date.now() + authSessionDurationMs
  };
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

function normalizePhone(phone: string) {
  return phone.replace(/\D/g, "");
}

function normalizeAuthField(field: keyof AuthFormState, value: string | boolean) {
  if (typeof value !== "string") {
    return value;
  }
  if (field === "nickname") {
    return Array.from(value).slice(0, nicknameMaxLength).join("");
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

function formatChatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function readFileAsDataURL(file: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function selectVoiceMimeType() {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return "";
  }
  return voiceMimeTypeCandidates.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? "";
}

function audioExtensionForMimeType(mimeType: string) {
  if (mimeType.includes("mp4")) {
    return "m4a";
  }
  if (mimeType.includes("ogg")) {
    return "ogg";
  }
  return "webm";
}

function formatVoiceDuration(durationMs: number) {
  return `${Math.max(1, Math.round(durationMs / 1000))}秒`;
}

function getMentionAudioContext(contextRef: { current: AudioContext | null }) {
  if (contextRef.current) {
    return contextRef.current;
  }

  const AudioContextConstructor =
    window.AudioContext ?? (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) {
    return null;
  }

  contextRef.current = new AudioContextConstructor();
  return contextRef.current;
}

function resumeMentionAudioContext(contextRef: { current: AudioContext | null }) {
  const context = getMentionAudioContext(contextRef);
  if (!context || context.state !== "suspended") {
    return;
  }

  void context.resume().catch(() => undefined);
}

function playMentionNotificationTone(contextRef: { current: AudioContext | null }, lastPlayedAtRef: { current: number }) {
  const now = Date.now();
  if (now - lastPlayedAtRef.current < 700) {
    return;
  }
  lastPlayedAtRef.current = now;

  const context = getMentionAudioContext(contextRef);
  if (!context) {
    return;
  }

  const playTone = () => {
    const toneSteps = [
      { delay: 0, duration: 0.11, frequency: 880 },
      { delay: 0.12, duration: 0.14, frequency: 1174 }
    ];

    for (const step of toneSteps) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const startAt = context.currentTime + step.delay;
      const stopAt = startAt + step.duration;

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(step.frequency, startAt);
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.16, startAt + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, stopAt);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(startAt);
      oscillator.stop(stopAt + 0.02);
      oscillator.addEventListener("ended", () => {
        oscillator.disconnect();
        gain.disconnect();
      });
    }
  };

  if (context.state === "suspended") {
    void context.resume().then(playTone).catch(() => undefined);
    return;
  }

  playTone();
}

function shouldPlayMentionNotification(message: ChatMessage, authSession: AuthSession | null) {
  if (!authSession || message.recalled_at) {
    return false;
  }
  if (authSession.userId && message.user_id === authSession.userId) {
    return false;
  }
  if (!message.user_id && normalizeMentionName(message.nickname) === normalizeMentionName(authSession.nickname)) {
    return false;
  }

  const currentNickname = normalizeMentionName(authSession.nickname);
  if (!currentNickname) {
    return false;
  }

  const mentionedNames = new Set(message.mentions.map(normalizeMentionName).filter(Boolean));
  return mentionedNames.has(currentNickname) || contentMentionsNickname(message.content, currentNickname);
}

function normalizeMentionName(value: string) {
  return value.trim().replace(/^@/u, "").toLocaleLowerCase();
}

function contentMentionsNickname(content: string, normalizedNickname: string) {
  for (const match of content.matchAll(/@([^\s@]{1,20})/gu)) {
    if (normalizeMentionName(match[1]) === normalizedNickname) {
      return true;
    }
  }
  return false;
}

function getActiveMentionQuery(content: string) {
  const match = mentionTriggerPattern.exec(content);
  return match ? match[2] : null;
}

function applyMentionToDraft(content: string, nickname: string) {
  const mentionText = `@${nickname} `;
  const match = mentionTriggerPattern.exec(content);
  if (!match) {
    const spacer = content && !/\s$/u.test(content) ? " " : "";
    return Array.from(`${content}${spacer}${mentionText}`).slice(0, chatMessageMaxLength).join("");
  }

  const prefix = `${content.slice(0, match.index)}${match[1]}`;
  return Array.from(`${prefix}${mentionText}`).slice(0, chatMessageMaxLength).join("");
}

function getMentionSuggestions(query: string | null, members: ChatMember[]) {
  if (query === null || !members.length) {
    return [];
  }
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const uniqueMembers = Array.from(new Map(members.map((member) => [member.nickname, member])).values());
  const matchedMembers = normalizedQuery
    ? uniqueMembers.filter((member) => member.nickname.toLocaleLowerCase().includes(normalizedQuery))
    : uniqueMembers;

  return matchedMembers
    .sort((left, right) => {
      if (!normalizedQuery) {
        return left.nickname.localeCompare(right.nickname, "zh-CN");
      }
      const leftName = left.nickname.toLocaleLowerCase();
      const rightName = right.nickname.toLocaleLowerCase();
      const leftStarts = leftName.startsWith(normalizedQuery);
      const rightStarts = rightName.startsWith(normalizedQuery);
      if (leftStarts !== rightStarts) {
        return leftStarts ? -1 : 1;
      }
      return left.nickname.localeCompare(right.nickname, "zh-CN");
    })
    .slice(0, 8);
}

function extractMentions(content: string, members: ChatMember[]) {
  const knownNames = new Set(members.map((member) => member.nickname));
  const mentions = new Set<string>();
  for (const match of content.matchAll(/@([^\s@]{1,20})/g)) {
    const name = match[1];
    if (knownNames.has(name)) {
      mentions.add(name);
    }
  }
  return Array.from(mentions);
}

function renderChatMessageContent(message: ChatMessage) {
  return (
    <>
      {message.message_type === "image" && message.attachment_data ? (
        <img className="chat-message-image" src={message.attachment_data} alt={message.attachment_name || "聊天图片"} />
      ) : null}
      {message.message_type === "audio" && message.attachment_data ? (
        <audio className="chat-message-audio" src={message.attachment_data} controls preload="metadata" />
      ) : null}
      <p>{renderMentionedText(message.content)}</p>
    </>
  );
}

function renderMentionedText(content: string) {
  const parts = content.split(/(@[^\s@]{1,20})/g);
  return parts.map((part, index) => {
    if (part.startsWith("@")) {
      return (
        <mark key={`${part}-${index}`} className="chat-mention">
          {part}
        </mark>
      );
    }
    return <span key={`${part}-${index}`}>{part}</span>;
  });
}

function ChatPage({
  authSession,
  rooms,
  activeRoomId,
  members,
  messages,
  hasMore,
  draft,
  attachment,
  searchInput,
  searchQuery,
  isEmojiOpen,
  nowMs,
  isLoading,
  isLoadingEarlier,
  isSending,
  error,
  threadRef,
  messagesEndRef,
  imageInputRef,
  onRoomClick,
  onSearchInputChange,
  onSearchSubmit,
  onClearSearch,
  onDraftChange,
  onDraftKeyDown,
  onEmojiToggle,
  onEmojiSelect,
  isVoiceRecording,
  onVoiceRecordStart,
  onVoiceRecordEnd,
  onMentionMember,
  onFileSelected,
  onClearAttachment,
  onLoadEarlier,
  onRecallMessage,
  onSubmit
}: {
  authSession: AuthSession | null;
  rooms: ChatRoom[];
  activeRoomId: number | null;
  members: ChatMember[];
  messages: ChatMessage[];
  hasMore: boolean;
  draft: string;
  attachment: ChatAttachment | null;
  searchInput: string;
  searchQuery: string;
  isEmojiOpen: boolean;
  nowMs: number;
  isLoading: boolean;
  isLoadingEarlier: boolean;
  isSending: boolean;
  error: string;
  threadRef: RefObject<HTMLElement | null>;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  imageInputRef: RefObject<HTMLInputElement | null>;
  onRoomClick: (roomID: number) => void;
  onSearchInputChange: (value: string) => void;
  onSearchSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClearSearch: () => void;
  onDraftChange: (value: string) => void;
  onDraftKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onEmojiToggle: () => void;
  onEmojiSelect: (value: string) => void;
  isVoiceRecording: boolean;
  onVoiceRecordStart: () => void;
  onVoiceRecordEnd: () => void;
  onMentionMember: (member: ChatMember) => void;
  onFileSelected: (file: File | null, messageType: Exclude<ChatMessageType, "text">) => void;
  onClearAttachment: () => void;
  onLoadEarlier: () => void;
  onRecallMessage: (message: ChatMessage) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const canSend = Boolean(authSession && activeRoomId && (draft.trim() || attachment) && !isSending && !isVoiceRecording);
  const roomMembersLabel = members.length ? `${members.length} 人在房间` : "房间成员同步中";
  const chatStatusMessage = isVoiceRecording ? "正在录音，松开发送" : error;
  const activeMentionQuery = getActiveMentionQuery(draft);
  const mentionSuggestions = getMentionSuggestions(activeMentionQuery, members);
  const isMentionSuggesting = activeMentionQuery !== null && mentionSuggestions.length > 0;

  return (
    <section className="chat-page" aria-label="聊天室">
      <header className="simple-page-header chat-page-header">
        <div className="chat-title-block">
          <h1>聊天室</h1>
          <span>{roomMembersLabel}</span>
        </div>
      </header>

      <section className="chat-tools" aria-label="聊天室工具">
        <nav className="chat-room-tabs" aria-label="聊天室房间">
          {rooms.map((room) => (
            <button
              key={room.id}
              className={room.id === activeRoomId ? "active" : ""}
              type="button"
              onClick={() => onRoomClick(room.id)}
            >
              {room.name}
            </button>
          ))}
        </nav>
        <form className="chat-search" onSubmit={onSearchSubmit}>
          <input
            type="search"
            value={searchInput}
            placeholder="搜索消息"
            aria-label="搜索消息"
            onChange={(event) => onSearchInputChange(event.target.value)}
          />
          {searchQuery ? (
            <button type="button" onClick={onClearSearch}>
              清除
            </button>
          ) : null}
          <button type="submit">搜索</button>
        </form>
      </section>

      <section className="chat-main">
        <section ref={threadRef} className="chat-thread" aria-label="聊天消息" aria-busy={isLoading || isLoadingEarlier}>
          {searchQuery ? <div className="chat-search-chip">搜索：{searchQuery}</div> : null}
          {isLoading && !messages.length ? <div className="chat-empty">正在加载聊天记录</div> : null}
          {!isLoading && !messages.length ? <div className="chat-empty">{searchQuery ? "没有找到相关消息" : "还没有消息，打个招呼吧"}</div> : null}
          {messages.length && hasMore ? (
            <button className="chat-history-button" type="button" disabled={isLoadingEarlier} onClick={onLoadEarlier}>
              {isLoadingEarlier ? "正在加载" : "加载更早消息"}
            </button>
          ) : null}
          {messages.map((message) => {
            const isOwn = Boolean(authSession?.userId && message.user_id === authSession.userId);
            const isRecalled = Boolean(message.recalled_at);
            const canRecall = isOwn && !isRecalled && isMessageRecallable(message, nowMs);
            return (
              <article
                key={message.id}
                className={`chat-message ${isOwn ? "own" : ""} ${isRecalled ? "recalled" : ""} ${canRecall ? "recallable" : ""}`}
              >
                <div className="chat-message-meta">
                  <span>{isOwn ? "我" : message.nickname}</span>
                  <time dateTime={message.created_at}>{formatChatTime(message.created_at)}</time>
                  {isOwn && !isRecalled ? <span>{message.read_by.length ? "已读" : "未读"}</span> : null}
                </div>
                {isRecalled ? <p>消息已撤回</p> : renderChatMessageContent(message)}
                {canRecall ? (
                  <button className="chat-recall-button" type="button" onClick={() => onRecallMessage(message)}>
                    撤回
                  </button>
                ) : null}
              </article>
            );
          })}
          <div ref={messagesEndRef} />
        </section>

        <aside className="chat-members" aria-label="在线成员列表">
          <div className="chat-members-title">在线成员</div>
          <div className="chat-members-list">
            {members.map((member) => (
              <button key={`${member.user_id ?? member.phone ?? member.nickname}`} type="button" onClick={() => onMentionMember(member)}>
                <span>{member.nickname.slice(0, 1).toUpperCase()}</span>
                <strong>{member.nickname}</strong>
              </button>
            ))}
            {!members.length ? <div className="chat-members-empty">暂无成员</div> : null}
          </div>
        </aside>
      </section>

      <footer className="chat-composer-wrap">
        {chatStatusMessage ? (
          <div className={`chat-error ${isVoiceRecording ? "recording" : ""}`} role="status">
            {chatStatusMessage}
          </div>
        ) : null}
        {isMentionSuggesting ? (
          <div className="chat-mention-panel" aria-label="选择在线用户">
            {mentionSuggestions.map((member) => (
              <button key={`${member.user_id ?? member.phone ?? member.nickname}`} type="button" onClick={() => onMentionMember(member)}>
                <span>{member.nickname.slice(0, 1).toUpperCase()}</span>
                <strong>{member.nickname}</strong>
              </button>
            ))}
          </div>
        ) : isEmojiOpen ? (
          <div className="chat-emoji-panel" aria-label="表情选择">
            {emojiOptions.map((emoji) => (
              <button key={emoji} type="button" onClick={() => onEmojiSelect(emoji)}>
                {emoji}
              </button>
            ))}
          </div>
        ) : null}
        {attachment ? (
          <div className="chat-attachment-preview">
            <span>{attachment.messageType === "image" ? "图片" : "语音"}</span>
            <strong>{attachment.name}</strong>
            <button type="button" onClick={onClearAttachment}>
              移除
            </button>
          </div>
        ) : null}
        <form className="chat-composer" onSubmit={onSubmit}>
          <label className="chat-input-shell">
            <span className="sr-only">输入聊天内容</span>
            <textarea
              value={draft}
              rows={1}
              maxLength={chatMessageMaxLength}
              placeholder="输入消息，Enter 发送"
              onChange={(event) => onDraftChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && mentionSuggestions[0]) {
                  event.preventDefault();
                  onMentionMember(mentionSuggestions[0]);
                  return;
                }
                onDraftKeyDown(event);
              }}
            />
          </label>
          <button
            className="chat-image-button"
            type="button"
            disabled={!authSession || !activeRoomId || isSending || isVoiceRecording}
            aria-label="选择图片"
            title="图片"
            onClick={() => imageInputRef.current?.click()}
          >
            <ImageIcon />
          </button>
          <button
            className={`chat-voice-button ${isVoiceRecording ? "recording" : ""}`}
            type="button"
            disabled={!authSession || !activeRoomId || (isSending && !isVoiceRecording)}
            aria-label={isVoiceRecording ? "松开发送语音" : "按住录音"}
            title={isVoiceRecording ? "松开发送语音" : "按住录音"}
            onContextMenu={(event) => event.preventDefault()}
            onPointerDown={(event) => {
              if (event.pointerType === "mouse" && event.button !== 0) {
                return;
              }
              event.preventDefault();
              event.currentTarget.setPointerCapture?.(event.pointerId);
              onVoiceRecordStart();
            }}
            onPointerUp={(event) => {
              event.preventDefault();
              if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
              onVoiceRecordEnd();
            }}
            onPointerCancel={(event) => {
              if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
              onVoiceRecordEnd();
            }}
          >
            <MicIcon />
          </button>
          <button
            className={`chat-emoji-button ${isEmojiOpen ? "active" : ""}`}
            type="button"
            disabled={!authSession || !activeRoomId || isSending || isVoiceRecording}
            aria-label="打开表情包"
            title="表情包"
            onClick={onEmojiToggle}
          >
            <SmileIcon />
          </button>
          <button className="chat-send-button" type="submit" disabled={!canSend} aria-label="发送消息">
            <PlusIcon />
          </button>
          <input
            ref={imageInputRef}
            className="chat-file-input"
            type="file"
            accept="image/*"
            onChange={(event) => {
              void onFileSelected(event.target.files?.[0] ?? null, "image");
              event.currentTarget.value = "";
            }}
          />
        </form>
        <div className="chat-count">
          {Array.from(draft).length}/{chatMessageMaxLength}
        </div>
      </footer>
    </section>
  );
}

function EmptyPage({
  page,
  authSession,
  onlineCount,
  isOnlineCountUnavailable,
  onLogout
}: {
  page: Exclude<AppPage, "music" | "chat">;
  authSession: AuthSession | null;
  onlineCount: number | null;
  isOnlineCountUnavailable: boolean;
  onLogout: () => void;
}) {
  const pageContent: Record<Exclude<AppPage, "music" | "chat">, { title: string; message: string }> = {
    discover: { title: "发现", message: "暂无推荐" },
    profile: { title: "我", message: authSession ? authSession.nickname || authSession.phone : "未登录" }
  };
  const content = pageContent[page];

  return (
    <section className="simple-page" aria-label={content.title}>
      <header className="simple-page-header">
        <h1>{content.title}</h1>
      </header>
      {page === "profile" && authSession ? (
        <div className="profile-page-content">
          <div className="profile-name">{content.message}</div>
          <div className="online-stat" aria-label="当前APP在线总人数">
            <span>当前APP在线总人数</span>
            <strong>{isOnlineCountUnavailable || onlineCount === null ? "--" : onlineCount}</strong>
            <span>{isOnlineCountUnavailable ? "暂不可用" : onlineCount === null ? "同步中" : "人"}</span>
          </div>
          <button className="logout-button" type="button" onClick={onLogout}>
            退出登录
          </button>
        </div>
      ) : (
        <div className="simple-page-empty">{content.message}</div>
      )}
    </section>
  );
}

function AuthPage({
  mode,
  form,
  message,
  canSubmit,
  isSubmitting,
  showPassword,
  onChange,
  onCloseAttempt,
  onModeChange,
  onSubmit,
  onTogglePassword
}: {
  mode: AuthMode;
  form: AuthFormState;
  message: string;
  canSubmit: boolean;
  isSubmitting: boolean;
  showPassword: boolean;
  onChange: (field: keyof AuthFormState, value: string | boolean) => void;
  onCloseAttempt: () => void;
  onModeChange: (mode: AuthMode) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onTogglePassword: () => void;
}) {
  const isRegister = mode === "register";

  return (
    <section className="auth-gate" role="dialog" aria-modal="true" aria-label={isRegister ? "手机号注册" : "手机号登录"}>
      <div className="auth-panel">
        <button className="auth-close-button" type="button" aria-label="关闭登录页" onClick={onCloseAttempt}>
          <CloseIcon />
        </button>

        <div className="auth-content">
          <h1>{isRegister ? "用手机号注册" : "手机号登录"}</h1>

          {isRegister ? (
            <button className="auth-avatar" type="button" aria-label="上传头像">
              <CameraIcon />
            </button>
          ) : null}

          <form className="auth-form" onSubmit={onSubmit}>
            <div className="auth-fields">
              {isRegister ? (
                <AuthField
                  label="昵称"
                  name="nickname"
                  placeholder="请填写昵称"
                  value={form.nickname}
                  maxLength={nicknameMaxLength}
                  onChange={(value) => onChange("nickname", value)}
                />
              ) : null}
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
                placeholder={isRegister ? "请设置密码" : "请输入密码"}
                type={showPassword ? "text" : "password"}
                autoComplete={isRegister ? "new-password" : "current-password"}
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
              <label className="auth-agreement">
                <input
                  type="checkbox"
                  checked={form.accepted}
                  onChange={(event) => onChange("accepted", event.target.checked)}
                  aria-label="同意软件许可及服务协议"
                />
                <span className="auth-checkmark" aria-hidden="true" />
                <span>
                  我已阅读并同意 <span className="auth-agreement-link">《软件许可及服务协议》</span>
                </span>
              </label>
              <p className="auth-note">本页面收集的信息仅用于注册账号</p>
              <button className="auth-submit" type="submit" disabled={!canSubmit}>
                {isSubmitting ? "提交中" : isRegister ? "同意并继续" : "同意并登录"}
              </button>
              <button className="auth-mode-toggle" type="button" onClick={() => onModeChange(isRegister ? "login" : "register")}>
                {isRegister ? "已有账号？手机号登录" : "没有账号？手机号注册"}
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

function IconBase({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

function CloseIcon() {
  return (
    <IconBase>
      <path d="M5 5l14 14M19 5 5 19" />
    </IconBase>
  );
}

function CameraIcon() {
  return (
    <IconBase>
      <path d="M7 8h1.8L10 6h4l1.2 2H17a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-5a3 3 0 0 1 3-3z" />
      <circle cx="12" cy="13.5" r="3" />
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

function MusicIcon() {
  return (
    <IconBase>
      <path d="M9 18V5l10-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="16" cy="16" r="3" />
    </IconBase>
  );
}

function ChatIcon() {
  return (
    <IconBase>
      <path d="M4 5.5A3.5 3.5 0 0 1 7.5 2h9A3.5 3.5 0 0 1 20 5.5v6A3.5 3.5 0 0 1 16.5 15H12l-5 4v-4A3 3 0 0 1 4 12z" />
      <path d="M8 7h8M8 11h5" />
    </IconBase>
  );
}

function DiscoverIcon() {
  return (
    <IconBase>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2.1 4.9-4.9 2.1 2.1-4.9z" />
    </IconBase>
  );
}

function ProfileIcon() {
  return (
    <IconBase>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
    </IconBase>
  );
}

function PageIcon({ page }: { page: AppPage }) {
  if (page === "chat") {
    return <ChatIcon />;
  }
  if (page === "discover") {
    return <DiscoverIcon />;
  }
  if (page === "profile") {
    return <ProfileIcon />;
  }
  return <MusicIcon />;
}

function PlusIcon() {
  return (
    <IconBase>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </IconBase>
  );
}

function ImageIcon() {
  return (
    <IconBase>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 15 4.5-4.5 3.5 3.5 2-2 5 5" />
      <circle cx="8.5" cy="9.5" r="1.2" />
    </IconBase>
  );
}

function SmileIcon() {
  return (
    <IconBase>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 14s1.5 2 4 2 4-2 4-2" />
      <path d="M9 9h.01" />
      <path d="M15 9h.01" />
    </IconBase>
  );
}

function MicIcon() {
  return (
    <IconBase>
      <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
      <path d="M8 21h8" />
    </IconBase>
  );
}

function PreviousIcon() {
  return (
    <IconBase>
      <path d="M6 5v14M19 6 9 12l10 6z" />
    </IconBase>
  );
}

function NextIcon() {
  return (
    <IconBase>
      <path d="M18 5v14M5 6l10 6-10 6z" />
    </IconBase>
  );
}

function PlayIcon() {
  return (
    <IconBase>
      <path d="M8 5v14l11-7z" />
    </IconBase>
  );
}

function PauseIcon() {
  return (
    <IconBase>
      <path d="M8 5v14M16 5v14" />
    </IconBase>
  );
}

function RepeatIcon() {
  return (
    <IconBase>
      <path d="M17 2.5 21 6l-4 3.5M3 11V9a3 3 0 0 1 3-3h15M7 21.5 3 18l4-3.5M21 13v2a3 3 0 0 1-3 3H3" />
    </IconBase>
  );
}

function RepeatOneIcon() {
  return (
    <IconBase>
      <path d="M17 2.5 21 6l-4 3.5M3 11V9a3 3 0 0 1 3-3h15M7 21.5 3 18l4-3.5M21 13v2a3 3 0 0 1-3 3H3" />
      <text x="12" y="13" textAnchor="middle" dominantBaseline="middle" fontSize="7" fontWeight="800">
        1
      </text>
    </IconBase>
  );
}

function SequenceIcon() {
  return (
    <IconBase>
      <path d="M4 7h9M4 12h9M4 17h6M16 9l4 3-4 3M20 12h-6" />
    </IconBase>
  );
}

function RepeatModeIcon({ mode }: { mode: RepeatMode }) {
  if (mode === "one") {
    return <RepeatOneIcon />;
  }
  if (mode === "all") {
    return <RepeatIcon />;
  }
  return <SequenceIcon />;
}

export default App;
