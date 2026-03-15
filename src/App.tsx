import { useState, useRef, useEffect, useCallback } from "react";
import { Peer, MAX_FILE_SIZE } from "./peer";
import { initIdentity, getShortId } from "./identity";
import { getFriends, addFriend, removeFriend, getFriend } from "./friends";
import type { Friend } from "./friends";
import { saveMessage, getMessages } from "./messages";
import type { Message } from "./messages";

type FileInfo = { name: string; size: number; url?: string; fileId: string };
type ChatMessage = { from: "me" | "them"; ts: number; text?: string; file?: FileInfo };
type Stage = "home" | "creating" | "create-waiting" | "join-waiting" | "chat";
type SidebarView = "list" | "friend-detail";
type CallState = "idle" | "calling" | "ringing" | "in-call";

/* ── helpers ─────────────────────────────────────────── */

const URL_RE = /https?:\/\/[^\s<>"']+/g;

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.getHours().toString().padStart(2, "0") + ":" + d.getMinutes().toString().padStart(2, "0");
}

function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function formatDayLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (dayKey(ts) === dayKey(Date.now())) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dayKey(ts) === dayKey(yesterday.getTime())) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

function renderMessageText(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const regex = new RegExp(URL_RE.source, "g");
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const url = match[0];
    parts.push(
      <a key={match.index} href={url} target="_blank" rel="noopener noreferrer" style={{ color: "#60a5fa", textDecoration: "underline", wordBreak: "break-all" }}>
        {url}
      </a>,
    );
    lastIndex = match.index + url.length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts.length === 1 ? parts[0] : parts;
}

/* ── component ───────────────────────────────────────── */

export default function App() {
  const [ready, setReady] = useState(false);
  const [shortId, setShortId] = useState("");
  const [stage, setStage] = useState<Stage>("home");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [offerText, setOfferText] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [answerText, setAnswerText] = useState("");
  const [copied, setCopied] = useState(false);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [sidebarView, setSidebarView] = useState<SidebarView>("list");
  const [selectedFriendId, setSelectedFriendId] = useState<string | null>(null);
  const [remoteShortId, setRemoteShortId] = useState<string | null>(null);
  const [showSavePrompt, setShowSavePrompt] = useState(false);
  const [friendName, setFriendName] = useState("");
  const [connectedPeerId, setConnectedPeerId] = useState<string | null>(null);

  // Sidebar preview: friendId -> { lastText, lastTs, count }
  const [friendPreviews, setFriendPreviews] = useState<Record<string, { lastText: string; lastTs: number; count: number }>>({});

  // Call state
  const [callState, setCallState] = useState<CallState>("idle");
  const [muted, setMuted] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [callError, setCallError] = useState<string | null>(null);
  const callTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Screen share state
  const [screenSharing, setScreenSharing] = useState(false);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  // File transfer state
  const [fileProgress, setFileProgress] = useState<Map<string, { received: number; total: number }>>(new Map());
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const dragCounter = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const peerRef = useRef<Peer | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Keep a ref for connectedPeerId so the onMessage callback always reads latest
  const connectedPeerIdRef = useRef<string | null>(null);

  // Init identity on mount
  useEffect(() => {
    initIdentity().then((id) => {
      setShortId(id.shortId);
      setFriends(getFriends());
      setReady(true);
    });
  }, []);

  // Load friend previews on mount and whenever friends change
  useEffect(() => {
    if (!ready) return;
    const loadPreviews = async () => {
      const fl = getFriends();
      const previews: Record<string, { lastText: string; lastTs: number; count: number }> = {};
      for (const f of fl) {
        const msgs = await getMessages(f.id);
        if (msgs.length > 0) {
          const last = msgs[msgs.length - 1];
          previews[f.id] = { lastText: last.text, lastTs: last.ts, count: msgs.length };
        }
      }
      setFriendPreviews(previews);
    };
    loadPreviews();
  }, [ready, friends]);

  // Load message history when we connect to a peer
  useEffect(() => {
    if (stage === "chat" && connectedPeerId) {
      getMessages(connectedPeerId).then((stored) => {
        const chat: ChatMessage[] = stored.map((m) => {
          if (m.fileName && m.fileSize != null) {
            return { from: m.from, file: { name: m.fileName, size: m.fileSize, fileId: m.id }, ts: m.ts };
          }
          return { from: m.from, text: m.text, ts: m.ts };
        });
        setMessages(chat);
      });
    }
  }, [stage, connectedPeerId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Attach remote video stream to video element
  useEffect(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  // Call duration timer
  useEffect(() => {
    if (callState === "in-call") {
      setCallDuration(0);
      callTimerRef.current = setInterval(() => {
        setCallDuration((d) => d + 1);
      }, 1000);
    } else {
      if (callTimerRef.current) {
        clearInterval(callTimerRef.current);
        callTimerRef.current = null;
      }
      setCallDuration(0);
    }
    return () => {
      if (callTimerRef.current) {
        clearInterval(callTimerRef.current);
        callTimerRef.current = null;
      }
    };
  }, [callState]);

  // Clear call error after 4 seconds
  useEffect(() => {
    if (!callError) return;
    const t = setTimeout(() => setCallError(null), 4000);
    return () => clearTimeout(t);
  }, [callError]);

  // Clear file error after 4 seconds
  useEffect(() => {
    if (!fileError) return;
    const t = setTimeout(() => setFileError(null), 4000);
    return () => clearTimeout(t);
  }, [fileError]);

  // Clear connection error after 5 seconds
  useEffect(() => {
    if (!connectionError) return;
    const t = setTimeout(() => setConnectionError(null), 5000);
    return () => clearTimeout(t);
  }, [connectionError]);

  // Sync connectedPeerId ref
  useEffect(() => {
    connectedPeerIdRef.current = connectedPeerId;
  }, [connectedPeerId]);

  const refreshFriends = useCallback(() => {
    setFriends(getFriends());
  }, []);

  function resetCallState() {
    setCallState("idle");
    setMuted(false);
    setCallDuration(0);
  }

  function resetScreenState() {
    setScreenSharing(false);
    setRemoteStream(null);
  }

  /* persist a text message to IndexedDB + update sidebar preview */
  function persistMessage(friendId: string, from: "me" | "them", text: string, ts: number) {
    const msg: Message = { id: crypto.randomUUID(), friendId, from, text, ts };
    saveMessage(msg);
    setFriendPreviews((prev) => ({
      ...prev,
      [friendId]: {
        lastText: text,
        lastTs: ts,
        count: (prev[friendId]?.count ?? 0) + 1,
      },
    }));
  }

  /* persist a file message to IndexedDB (name+size only, no blob) */
  function persistFileMessage(friendId: string, from: "me" | "them", fileName: string, fileSize: number, ts: number) {
    const previewText = `📎 ${fileName}`;
    const msg: Message = { id: crypto.randomUUID(), friendId, from, text: previewText, ts, fileName, fileSize };
    saveMessage(msg);
    setFriendPreviews((prev) => ({
      ...prev,
      [friendId]: {
        lastText: previewText,
        lastTs: ts,
        count: (prev[friendId]?.count ?? 0) + 1,
      },
    }));
  }

  function makePeer() {
    const peer = new Peer({
      onMessage: (text) => {
        const ts = Date.now();
        setMessages((m) => [...m, { from: "them", text, ts }]);
        // persist – use a ref to get the latest connectedPeerId
        const fid = peerRef.current ? connectedPeerIdRef.current : null;
        if (fid) persistMessage(fid, "them", text, ts);
      },
      onConnected: () => setStage("chat"),
      onDisconnected: () => {
        setStage("home");
        setConnectedPeerId(null);
        setRemoteShortId(null);
        setShowSavePrompt(false);
        resetCallState();
        resetScreenState();
        setFileProgress(new Map());
        peerRef.current = null;
      },
      onChannelOpen: () => {
        // channel is open
      },
      onIdentity: (id) => {
        setRemoteShortId(id);
        setConnectedPeerId(id);
        connectedPeerIdRef.current = id;
        if (!getFriend(id)) {
          setShowSavePrompt(true);
        }
      },
      onCallStart: () => {
        setCallState("ringing");
      },
      onCallAccept: () => {
        setCallState("in-call");
      },
      onCallEnd: () => {
        resetCallState();
      },
      onScreenStart: () => {
        // Remote peer started sharing — stream arrives via onRemoteStream
      },
      onScreenStop: () => {
        setScreenSharing(false);
        setRemoteStream(null);
      },
      onRemoteStream: (stream) => {
        setRemoteStream(stream);
      },

      // ── File transfer callbacks ─────────────────────────
      onFileStart: (meta) => {
        const ts = Date.now();
        setMessages((m) => [
          ...m,
          { from: "them", file: { name: meta.name, size: meta.size, fileId: meta.fileId }, ts },
        ]);
        setFileProgress((prev) => new Map(prev).set(meta.fileId, { received: 0, total: meta.size }));
      },
      onFileProgress: (fileId, received, total) => {
        setFileProgress((prev) => new Map(prev).set(fileId, { received, total }));
      },
      onFileReceived: (file) => {
        // Update the in-memory message with the object URL
        setMessages((msgs) =>
          msgs.map((m) => {
            if (m.file?.fileId === file.fileId) {
              return { ...m, file: { ...m.file, url: file.url } };
            }
            return m;
          }),
        );
        // Remove from progress tracking
        setFileProgress((prev) => {
          const next = new Map(prev);
          next.delete(file.fileId);
          return next;
        });
        // Persist to IndexedDB
        const fid = connectedPeerIdRef.current;
        if (fid) {
          persistFileMessage(fid, "them", file.name, file.size, Date.now());
        }
      },
    });
    peer.setLocalShortId(getShortId());
    peerRef.current = peer;
    return peer;
  }

  // --- CALLER FLOW ---
  async function handleCreate() {
    setStage("creating");
    try {
      const peer = makePeer();
      const offer = await peer.createOffer();
      setOfferText(offer);
      setStage("create-waiting");
    } catch {
      setStage("home");
      setConnectionError("Failed to create invite. Check your network connection.");
      peerRef.current?.destroy();
      peerRef.current = null;
    }
  }

  async function handleAcceptAnswer() {
    if (!peerRef.current || !pasteText.trim()) return;
    try {
      await peerRef.current.acceptAnswer(pasteText.trim());
      setPasteText("");
    } catch {
      setConnectionError("Invalid response code. Make sure you copied it correctly.");
    }
  }

  // --- JOINER FLOW ---
  async function handleJoin() {
    if (!pasteText.trim()) return;
    try {
      const peer = makePeer();
      const answer = await peer.acceptOffer(pasteText.trim());
      setAnswerText(answer);
      setPasteText("");
      setStage("join-waiting");
    } catch {
      setStage("home");
      setConnectionError("Invalid invite code. Make sure you copied it correctly.");
      peerRef.current?.destroy();
      peerRef.current = null;
    }
  }

  // --- CHAT ---
  function handleSend() {
    if (!input.trim() || !peerRef.current) return;
    const text = input.trim();
    const ts = Date.now();
    peerRef.current.send(text);
    setMessages((m) => [...m, { from: "me", text, ts }]);
    if (connectedPeerId) persistMessage(connectedPeerId, "me", text, ts);
    setInput("");
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text).catch(() => {
      // Fallback: select a temporary textarea
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    });
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleSaveFriend() {
    if (!remoteShortId || !friendName.trim()) return;
    addFriend({
      id: remoteShortId,
      name: friendName.trim(),
      publicKey: "",
      addedAt: Date.now(),
    });
    refreshFriends();
    setShowSavePrompt(false);
    setFriendName("");
  }

  function handleRemoveFriend(id: string) {
    removeFriend(id);
    refreshFriends();
    if (selectedFriendId === id) {
      setSidebarView("list");
      setSelectedFriendId(null);
    }
  }

  function handleFriendClick(id: string) {
    setSelectedFriendId(id);
    setSidebarView("friend-detail");
  }

  function handleNewChat() {
    setSidebarView("list");
    setSelectedFriendId(null);
    if (stage === "chat") {
      peerRef.current?.destroy();
      peerRef.current = null;
      setStage("home");
      setMessages([]);
      setConnectedPeerId(null);
      setRemoteShortId(null);
      setShowSavePrompt(false);
      resetCallState();
      resetScreenState();
      setFileProgress(new Map());
    } else {
      setStage("home");
      setOfferText("");
      setAnswerText("");
      setPasteText("");
    }
  }

  // --- CALL ACTIONS ---
  async function handleStartCall() {
    if (!peerRef.current || callState !== "idle") return;
    setCallState("calling");
    setCallError(null);
    try {
      await peerRef.current.startCall();
    } catch (err) {
      setCallState("idle");
      setCallError(
        err instanceof Error ? err.message : "Could not access microphone",
      );
    }
  }

  async function handleAcceptCall() {
    if (!peerRef.current || callState !== "ringing") return;
    setCallError(null);
    try {
      await peerRef.current.acceptCall();
      setCallState("in-call");
    } catch (err) {
      setCallState("idle");
      peerRef.current.rejectCall();
      setCallError(
        err instanceof Error ? err.message : "Could not access microphone",
      );
    }
  }

  function handleRejectCall() {
    if (!peerRef.current) return;
    peerRef.current.rejectCall();
    resetCallState();
  }

  function handleHangUp() {
    if (!peerRef.current) return;
    peerRef.current.endCall();
    resetCallState();
  }

  function handleToggleMute() {
    if (!peerRef.current) return;
    const nowMuted = peerRef.current.toggleMute();
    setMuted(nowMuted);
  }

  // --- SCREEN SHARE ACTIONS ---
  async function handleStartScreenShare() {
    if (!peerRef.current || screenSharing) return;
    try {
      await peerRef.current.startScreenShare();
      setScreenSharing(true);
    } catch (err) {
      if (err instanceof Error && err.name !== "NotAllowedError") {
        setCallError("Screen sharing failed: " + err.message);
      }
    }
  }

  function handleStopScreenShare() {
    if (!peerRef.current) return;
    peerRef.current.stopScreenShare();
    setScreenSharing(false);
  }

  // --- FILE TRANSFER ACTIONS ---
  async function handleFileSend(file: File) {
    if (!peerRef.current) return;
    if (file.size > MAX_FILE_SIZE) {
      setFileError(`File too large (${formatFileSize(file.size)}). Max 100 MB.`);
      return;
    }
    if (file.size === 0) {
      setFileError("Cannot send an empty file.");
      return;
    }

    const fileId = crypto.randomUUID();
    const ts = Date.now();
    const url = URL.createObjectURL(file);

    // Add to chat immediately (with local object URL for re-download)
    setMessages((m) => [
      ...m,
      { from: "me", file: { name: file.name, size: file.size, url, fileId }, ts },
    ]);

    // Persist metadata
    if (connectedPeerId) {
      persistFileMessage(connectedPeerId, "me", file.name, file.size, ts);
    }

    // Start transfer with progress
    setFileProgress((prev) => new Map(prev).set(fileId, { received: 0, total: file.size }));

    try {
      await peerRef.current.sendFile(file, fileId);
    } catch (err) {
      setFileError(err instanceof Error ? err.message : "File send failed");
    }

    // Transfer complete — remove progress entry
    setFileProgress((prev) => {
      const next = new Map(prev);
      next.delete(fileId);
      return next;
    });
  }

  // Drag-and-drop handlers
  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.types.includes("Files")) {
      setDragging(true);
    }
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setDragging(false);
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    dragCounter.current = 0;
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileSend(files[0]);
    }
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSend(file);
    }
    // Reset so the same file can be re-sent
    e.target.value = "";
  }

  function formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  /* textarea auto-grow */
  function handleTextareaInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    const lineHeight = 22;
    const maxHeight = lineHeight * 4 + 20; // 4 lines + padding
    el.style.height = Math.min(el.scrollHeight, maxHeight) + "px";
  }

  function handleTextareaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  if (!ready) return null;

  const selectedFriend = selectedFriendId ? getFriend(selectedFriendId) : null;

  // --- SIDEBAR ---
  const sidebar = (
    <div style={s.sidebar}>
      <div style={s.sidebarHeader}>
        <div style={s.sidebarTitle}>tbdchat</div>
        <div style={s.yourId}>
          <span style={s.idLabel}>You:</span>{" "}
          <span style={s.idValue}>{shortId}</span>
        </div>
      </div>
      <button style={s.newChatBtn} onClick={handleNewChat}>
        + New Chat
      </button>
      <div style={s.friendList}>
        {friends.length === 0 && (
          <div style={s.emptyFriends}>No friends yet</div>
        )}
        {friends.map((f) => {
          const isOnline = connectedPeerId === f.id;
          const isSelected = selectedFriendId === f.id;
          const preview = friendPreviews[f.id];
          return (
            <div
              key={f.id}
              style={{
                ...s.friendItem,
                background: isSelected ? "#222" : "transparent",
              }}
              onClick={() => handleFriendClick(f.id)}
            >
              <span
                style={{
                  ...s.statusDot,
                  background: isOnline ? "#22c55e" : "#555",
                }}
              />
              <div style={s.friendInfo}>
                <div style={s.friendNameRow}>
                  <span style={s.friendName}>{f.name}</span>
                  {preview && (
                    <span style={s.friendTime}>{formatTime(preview.lastTs)}</span>
                  )}
                </div>
                <div style={s.friendPreviewRow}>
                  {preview ? (
                    <span style={s.friendPreview}>
                      {preview.lastText.length > 30 ? preview.lastText.slice(0, 30) + "…" : preview.lastText}
                    </span>
                  ) : (
                    <span style={s.friendId}>{f.id}</span>
                  )}
                  {preview && preview.count > 0 && (
                    <span style={s.friendMsgCount}>{preview.count}</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  // --- CALL BAR (shown below chat header) ---
  const peerLabel = remoteShortId
    ? getFriend(remoteShortId)?.name ?? remoteShortId
    : "Peer";

  let callBar: React.ReactNode = null;
  if (stage === "chat" && callState === "calling") {
    callBar = (
      <div style={s.callBar}>
        <span style={s.callBarText}>📞 Calling {peerLabel}...</span>
        <button style={s.hangUpBtn} onClick={handleHangUp}>
          Hang up
        </button>
      </div>
    );
  } else if (stage === "chat" && callState === "ringing") {
    callBar = (
      <div style={s.callBar}>
        <span style={s.callBarText}>📞 Incoming call from {peerLabel}</span>
        <button style={s.acceptCallBtn} onClick={handleAcceptCall}>
          Accept
        </button>
        <button style={s.hangUpBtn} onClick={handleRejectCall}>
          Reject
        </button>
      </div>
    );
  } else if (stage === "chat" && callState === "in-call") {
    callBar = (
      <div style={s.callBarActive}>
        <span style={s.callBarText}>
          📞 In call — {formatDuration(callDuration)}
        </span>
        <div style={s.callBarActions}>
          <button style={s.muteBtn} onClick={handleToggleMute}>
            {muted ? "🔇" : "🔊"}
          </button>
          <button style={s.hangUpBtn} onClick={handleHangUp}>
            Hang up
          </button>
        </div>
      </div>
    );
  }

  // --- CALL ERROR ---
  const callErrorBar = callError ? (
    <div style={s.callErrorBar}>⚠️ {callError}</div>
  ) : null;

  // --- FILE ERROR ---
  const fileErrorBar = fileError ? (
    <div style={s.fileErrorBar}>⚠️ {fileError}</div>
  ) : null;

  // --- MESSAGES with date separators ---
  function renderMessages() {
    const nodes: React.ReactNode[] = [];
    let lastDay = "";
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      const dk = dayKey(m.ts);
      if (dk !== lastDay) {
        lastDay = dk;
        nodes.push(
          <div key={`sep-${dk}`} style={s.dateSeparator}>
            <div style={s.dateLine} />
            <span style={s.dateLabel}>{formatDayLabel(m.ts)}</span>
            <div style={s.dateLine} />
          </div>,
        );
      }

      if (m.file) {
        // ── File message bubble ────────────────────────
        const progress = fileProgress.get(m.file.fileId);
        const isTransferring = !!progress;
        const pct = progress ? Math.round((progress.received / progress.total) * 100) : 0;

        nodes.push(
          <div
            key={i}
            style={{
              alignSelf: m.from === "me" ? "flex-end" : "flex-start",
              maxWidth: "70%",
            }}
          >
            <div
              style={{
                ...s.fileBubble,
                background: m.from === "me" ? "#1e3a5f" : "#262626",
              }}
            >
              <div style={s.fileIcon}>📎</div>
              <div style={s.fileDetails}>
                <div style={s.fileName}>{m.file.name}</div>
                <div style={s.fileSizeText}>{formatFileSize(m.file.size)}</div>
                {isTransferring && (
                  <>
                    <div style={s.progressContainer}>
                      <div style={{ ...s.progressBar, width: `${pct}%` }} />
                    </div>
                    <div style={s.progressText}>{pct}%</div>
                  </>
                )}
                {m.file.url && !isTransferring && (
                  <a
                    href={m.file.url}
                    download={m.file.name}
                    style={s.downloadLink}
                  >
                    Download
                  </a>
                )}
                {!m.file.url && !isTransferring && (
                  <div style={s.fileExpired}>File not available</div>
                )}
              </div>
            </div>
            <div
              style={{
                ...s.timestamp,
                textAlign: m.from === "me" ? "right" : "left",
              }}
            >
              {formatTime(m.ts)}
            </div>
          </div>,
        );
      } else {
        // ── Text message bubble ────────────────────────
        nodes.push(
          <div
            key={i}
            style={{
              alignSelf: m.from === "me" ? "flex-end" : "flex-start",
              maxWidth: "70%",
            }}
          >
            <div
              style={{
                ...s.bubble,
                background: m.from === "me" ? "#2563eb" : "#262626",
              }}
            >
              {renderMessageText(m.text ?? "")}
            </div>
            <div
              style={{
                ...s.timestamp,
                textAlign: m.from === "me" ? "right" : "left",
              }}
            >
              {formatTime(m.ts)}
            </div>
          </div>,
        );
      }
    }
    return nodes;
  }

  // --- MAIN CONTENT ---
  let mainContent: React.ReactNode;

  if (sidebarView === "friend-detail" && selectedFriend) {
    const isOnline = connectedPeerId === selectedFriend.id;
    mainContent = (
      <div style={s.mainCenter}>
        <div style={s.friendDetailCard}>
          <div style={s.friendDetailName}>{selectedFriend.name}</div>
          <div style={s.friendDetailId}>ID: {selectedFriend.id}</div>
          <div style={s.friendDetailStatus}>
            <span
              style={{
                ...s.statusDot,
                background: isOnline ? "#22c55e" : "#555",
              }}
            />
            {isOnline ? "Online" : "Offline"}
          </div>
          <div style={s.friendDetailDate}>
            Added {new Date(selectedFriend.addedAt).toLocaleDateString()}
          </div>
          <button
            style={s.removeFriendBtn}
            onClick={() => handleRemoveFriend(selectedFriend.id)}
          >
            Remove Friend
          </button>
        </div>
      </div>
    );
  } else if (stage === "creating") {
    mainContent = (
      <div style={s.mainCenter}>
        <h1 style={s.title}>tbdchat</h1>
        <p style={s.subtitle}>Generating invite code...</p>
        <div style={{ color: "#888", fontSize: 13 }}>Gathering network info, this may take a few seconds</div>
      </div>
    );
  } else if (stage === "home") {
    mainContent = (
      <div style={s.mainCenter}>
        <h1 style={s.title}>tbdchat</h1>
        <p style={s.subtitle}>P2P chat. No servers. No bullshit.</p>
        {connectionError && <div style={s.connectionErrorBar}>⚠️ {connectionError}</div>}
        <div style={s.homeButtons}>
          <button style={s.btn} onClick={handleCreate}>
            Create invite
          </button>
          <div style={s.divider}>or join with a code</div>
          <textarea
            style={s.inviteTextarea}
            placeholder="Paste invite code here..."
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
          />
          <button
            style={s.btn}
            onClick={handleJoin}
            disabled={!pasteText.trim()}
          >
            Join
          </button>
        </div>
      </div>
    );
  } else if (stage === "create-waiting") {
    mainContent = (
      <div style={s.mainCenter}>
        <h1 style={s.title}>tbdchat</h1>
        <p style={s.subtitle}>Step 1: Send this invite code to your friend</p>
        {connectionError && <div style={s.connectionErrorBar}>⚠️ {connectionError}</div>}
        <div style={s.codeBox}>
          <code style={s.code}>{offerText.slice(0, 80)}...</code>
          <button
            style={s.btnSmall}
            onClick={() => copyToClipboard(offerText)}
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
        <p style={{ ...s.subtitle, marginTop: 32 }}>
          Step 2: Paste their response code
        </p>
        <textarea
          style={s.inviteTextarea}
          placeholder="Paste their response code here..."
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
        />
        <button
          style={s.btn}
          onClick={handleAcceptAnswer}
          disabled={!pasteText.trim()}
        >
          Connect
        </button>
      </div>
    );
  } else if (stage === "join-waiting") {
    mainContent = (
      <div style={s.mainCenter}>
        <h1 style={s.title}>tbdchat</h1>
        <p style={s.subtitle}>Send this response code back to your friend</p>
        <div style={s.codeBox}>
          <code style={s.code}>{answerText.slice(0, 80)}...</code>
          <button
            style={s.btnSmall}
            onClick={() => copyToClipboard(answerText)}
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
        <p style={s.subtitle}>Waiting for connection...</p>
      </div>
    );
  } else {
    // stage === "chat"
    mainContent = (
      <div style={s.chatContainer}>
        <div style={s.chatHeader}>
          <span style={s.onlineDot} />
          <span style={{ flex: 1 }}>
            Connected — {peerLabel}
          </span>
          {screenSharing ? (
            <button
              style={{ ...s.callBtn, background: "#ef4444", borderColor: "#ef4444", color: "white" }}
              onClick={handleStopScreenShare}
              title="Stop screen share"
            >
              🖥️ Stop
            </button>
          ) : (
            <button
              style={s.callBtn}
              onClick={handleStartScreenShare}
              title="Share screen"
            >
              🖥️
            </button>
          )}
          {callState === "idle" && (
            <button
              style={s.callBtn}
              onClick={handleStartCall}
              title="Start voice call"
            >
              📞
            </button>
          )}
        </div>
        {callBar}
        {callErrorBar}
        {fileErrorBar}
        {showSavePrompt && (
          <div style={s.savePrompt}>
            <span style={s.savePromptText}>
              Save <b>{remoteShortId}</b> as friend?
            </span>
            <input
              style={s.saveNameInput}
              placeholder="Enter a name..."
              value={friendName}
              onChange={(e) => setFriendName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveFriend();
              }}
            />
            <button style={s.btnSmall} onClick={handleSaveFriend}>
              Save
            </button>
            <button
              style={s.btnSmall}
              onClick={() => setShowSavePrompt(false)}
            >
              Dismiss
            </button>
          </div>
        )}
        {remoteStream && (
          <div style={s.screenShareContainer}>
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              style={s.screenShareVideo}
            />
          </div>
        )}
        {/* Chat messages area with drag-and-drop */}
        <div
          style={s.chatMessagesWrapper}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <div style={s.chatMessages}>
            {renderMessages()}
            <div ref={bottomRef} />
          </div>
          {dragging && (
            <div style={s.dropOverlay}>
              <div style={s.dropOverlayText}>📎 Drop file to send</div>
            </div>
          )}
        </div>
        <div style={s.chatInput}>
          <input
            ref={fileInputRef}
            type="file"
            style={{ display: "none" }}
            onChange={handleFileInputChange}
          />
          <button
            style={s.attachBtn}
            onClick={() => fileInputRef.current?.click()}
            title="Send file (max 100 MB)"
          >
            📎
          </button>
          <textarea
            ref={textareaRef}
            style={s.msgTextarea}
            value={input}
            onChange={handleTextareaInput}
            onKeyDown={handleTextareaKeyDown}
            placeholder="Type a message... (Shift+Enter for new line)"
            rows={1}
          />
          <button style={s.sendBtn} onClick={handleSend}>
            Send
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={s.layout}>
      {sidebar}
      <div style={s.main}>{mainContent}</div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  layout: {
    display: "flex",
    height: "100%",
  },
  sidebar: {
    width: 220,
    flexShrink: 0,
    background: "#161616",
    borderRight: "1px solid #222",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  sidebarHeader: {
    padding: "16px 14px 8px",
    borderBottom: "1px solid #222",
  },
  sidebarTitle: {
    fontSize: 20,
    fontWeight: 700,
    letterSpacing: -1,
  },
  yourId: {
    fontSize: 12,
    marginTop: 4,
    color: "#888",
  },
  idLabel: {
    color: "#666",
  },
  idValue: {
    color: "#2563eb",
    fontFamily: "monospace",
    fontWeight: 600,
  },
  newChatBtn: {
    margin: "10px 10px 4px",
    padding: "8px 0",
    background: "#2563eb",
    color: "white",
    border: "none",
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  friendList: {
    flex: 1,
    overflowY: "auto",
    padding: "6px 0",
  },
  emptyFriends: {
    padding: "20px 14px",
    color: "#555",
    fontSize: 13,
    textAlign: "center",
  },
  friendItem: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 14px",
    cursor: "pointer",
    transition: "background 0.1s",
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    flexShrink: 0,
  },
  friendInfo: {
    minWidth: 0,
    flex: 1,
  },
  friendNameRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: 4,
  },
  friendName: {
    fontSize: 14,
    fontWeight: 500,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  friendTime: {
    fontSize: 10,
    color: "#555",
    flexShrink: 0,
  },
  friendPreviewRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 4,
    marginTop: 1,
  },
  friendPreview: {
    fontSize: 12,
    color: "#666",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  friendMsgCount: {
    fontSize: 10,
    color: "#888",
    background: "#2a2a2a",
    borderRadius: 8,
    padding: "1px 5px",
    flexShrink: 0,
  },
  friendId: {
    fontSize: 11,
    color: "#666",
    fontFamily: "monospace",
  },
  main: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  mainCenter: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 8,
  },
  title: {
    fontSize: 48,
    fontWeight: 700,
    letterSpacing: -2,
  },
  subtitle: {
    color: "#888",
    fontSize: 14,
    marginBottom: 16,
  },
  homeButtons: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    width: "100%",
    maxWidth: 400,
  },
  divider: {
    textAlign: "center",
    color: "#555",
    fontSize: 13,
    padding: "8px 0",
  },
  btn: {
    padding: "12px 24px",
    background: "#e0e0e0",
    color: "#0a0a0a",
    border: "none",
    borderRadius: 8,
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
  },
  btnSmall: {
    padding: "6px 16px",
    background: "#333",
    color: "#e0e0e0",
    border: "none",
    borderRadius: 6,
    fontSize: 13,
    cursor: "pointer",
    flexShrink: 0,
  },
  inviteTextarea: {
    width: "100%",
    maxWidth: 400,
    minHeight: 80,
    padding: 12,
    background: "#161616",
    color: "#e0e0e0",
    border: "1px solid #333",
    borderRadius: 8,
    fontSize: 13,
    fontFamily: "monospace",
    resize: "vertical",
  },
  codeBox: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    background: "#161616",
    border: "1px solid #333",
    borderRadius: 8,
    padding: 12,
    width: "100%",
    maxWidth: 400,
  },
  code: {
    fontSize: 12,
    color: "#888",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    flex: 1,
  },
  chatContainer: {
    height: "100%",
    display: "flex",
    flexDirection: "column",
  },
  chatHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "12px 16px",
    borderBottom: "1px solid #222",
    fontSize: 14,
    fontWeight: 600,
  },
  onlineDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "#22c55e",
  },
  callBtn: {
    background: "none",
    border: "1px solid #333",
    borderRadius: 6,
    padding: "4px 10px",
    cursor: "pointer",
    fontSize: 16,
    lineHeight: 1,
    transition: "background 0.15s",
  },
  // Call bar states
  callBar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 16px",
    background: "#1a1a2e",
    borderBottom: "1px solid #222",
    fontSize: 13,
  },
  callBarActive: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "8px 16px",
    background: "#0f2a1a",
    borderBottom: "1px solid #1a4a2a",
    fontSize: 13,
  },
  callBarText: {
    color: "#ccc",
    flex: 1,
  },
  callBarActions: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  muteBtn: {
    background: "#333",
    border: "none",
    borderRadius: 6,
    padding: "5px 12px",
    cursor: "pointer",
    fontSize: 15,
    lineHeight: 1,
  },
  hangUpBtn: {
    background: "#ef4444",
    color: "white",
    border: "none",
    borderRadius: 6,
    padding: "5px 14px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  acceptCallBtn: {
    background: "#22c55e",
    color: "white",
    border: "none",
    borderRadius: 6,
    padding: "5px 14px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  callErrorBar: {
    padding: "6px 16px",
    background: "#2a1a1a",
    borderBottom: "1px solid #442222",
    fontSize: 13,
    color: "#f87171",
  },
  fileErrorBar: {
    padding: "6px 16px",
    background: "#2a1a1a",
    borderBottom: "1px solid #442222",
    fontSize: 13,
    color: "#f87171",
  },
  connectionErrorBar: {
    padding: "8px 16px",
    background: "#2a1a1a",
    border: "1px solid #442222",
    borderRadius: 8,
    fontSize: 13,
    color: "#f87171",
    maxWidth: 400,
    width: "100%",
    textAlign: "center",
  },
  savePrompt: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 16px",
    background: "#1a1a2e",
    borderBottom: "1px solid #222",
    fontSize: 13,
  },
  savePromptText: {
    color: "#aaa",
    whiteSpace: "nowrap",
  },
  saveNameInput: {
    padding: "4px 8px",
    background: "#111",
    color: "#e0e0e0",
    border: "1px solid #333",
    borderRadius: 4,
    fontSize: 13,
    width: 140,
    outline: "none",
  },
  screenShareContainer: {
    background: "#000",
    borderBottom: "1px solid #222",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    flexShrink: 0,
  },
  screenShareVideo: {
    width: "100%",
    maxHeight: "60vh",
    background: "#000",
    display: "block",
  },
  // Wrapper for chat messages + drop overlay
  chatMessagesWrapper: {
    position: "relative",
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  chatMessages: {
    flex: 1,
    overflowY: "auto",
    padding: 16,
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  bubble: {
    padding: "8px 14px",
    borderRadius: 16,
    fontSize: 15,
    lineHeight: 1.4,
    wordBreak: "break-word",
    whiteSpace: "pre-wrap",
  },
  timestamp: {
    fontSize: 11,
    color: "#666",
    marginTop: 2,
    padding: "0 4px",
  },
  dateSeparator: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    margin: "12px 0 8px",
  },
  dateLine: {
    flex: 1,
    height: 1,
    background: "#333",
  },
  dateLabel: {
    fontSize: 12,
    color: "#666",
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  chatInput: {
    display: "flex",
    gap: 8,
    padding: 12,
    borderTop: "1px solid #222",
    alignItems: "flex-end",
  },
  msgTextarea: {
    flex: 1,
    padding: "10px 14px",
    background: "#161616",
    color: "#e0e0e0",
    border: "1px solid #333",
    borderRadius: 8,
    fontSize: 15,
    outline: "none",
    resize: "none",
    lineHeight: "22px",
    maxHeight: 108, // ~4 lines (22*4 + 20 padding)
    overflow: "auto",
    fontFamily: "inherit",
  },
  sendBtn: {
    padding: "10px 20px",
    background: "#2563eb",
    color: "white",
    border: "none",
    borderRadius: 8,
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
    flexShrink: 0,
    alignSelf: "flex-end",
  },
  attachBtn: {
    padding: "10px 12px",
    background: "none",
    border: "1px solid #333",
    borderRadius: 8,
    fontSize: 18,
    cursor: "pointer",
    lineHeight: 1,
    flexShrink: 0,
    alignSelf: "flex-end",
  },
  // ── File message bubble styles ────────────────────────
  fileBubble: {
    padding: "10px 14px",
    borderRadius: 16,
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    minWidth: 200,
  },
  fileIcon: {
    fontSize: 24,
    lineHeight: 1,
    flexShrink: 0,
  },
  fileDetails: {
    flex: 1,
    minWidth: 0,
  },
  fileName: {
    fontSize: 14,
    fontWeight: 600,
    wordBreak: "break-all",
    color: "#e0e0e0",
  },
  fileSizeText: {
    fontSize: 12,
    color: "#999",
    marginTop: 2,
  },
  progressContainer: {
    marginTop: 6,
    height: 4,
    background: "#444",
    borderRadius: 2,
    overflow: "hidden",
  },
  progressBar: {
    height: "100%",
    background: "#2563eb",
    borderRadius: 2,
    transition: "width 0.15s ease",
  },
  progressText: {
    fontSize: 11,
    color: "#999",
    marginTop: 2,
  },
  downloadLink: {
    display: "inline-block",
    marginTop: 6,
    fontSize: 13,
    color: "#60a5fa",
    textDecoration: "none",
    fontWeight: 500,
  },
  fileExpired: {
    fontSize: 12,
    color: "#666",
    fontStyle: "italic",
    marginTop: 4,
  },
  // ── Drop overlay ──────────────────────────────────────
  dropOverlay: {
    position: "absolute",
    inset: 0,
    background: "rgba(37, 99, 235, 0.12)",
    border: "2px dashed #2563eb",
    borderRadius: 8,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
    pointerEvents: "none",
  },
  dropOverlayText: {
    color: "#60a5fa",
    fontSize: 18,
    fontWeight: 600,
  },
  // ── Friend detail ─────────────────────────────────────
  friendDetailCard: {
    background: "#161616",
    border: "1px solid #222",
    borderRadius: 12,
    padding: 32,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 12,
    minWidth: 280,
  },
  friendDetailName: {
    fontSize: 24,
    fontWeight: 700,
  },
  friendDetailId: {
    fontSize: 13,
    color: "#666",
    fontFamily: "monospace",
  },
  friendDetailStatus: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 14,
    color: "#aaa",
  },
  friendDetailDate: {
    fontSize: 12,
    color: "#555",
  },
  removeFriendBtn: {
    marginTop: 12,
    padding: "8px 20px",
    background: "#331111",
    color: "#f87171",
    border: "1px solid #552222",
    borderRadius: 6,
    fontSize: 13,
    cursor: "pointer",
  },
};
