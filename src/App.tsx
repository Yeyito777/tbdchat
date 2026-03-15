import { useState, useRef, useEffect, useCallback } from "react";
import { Peer } from "./peer";
import { initIdentity, getShortId } from "./identity";
import { getFriends, addFriend, removeFriend, getFriend } from "./friends";
import type { Friend } from "./friends";

type Message = { from: "me" | "them"; text: string; ts: number };
type Stage = "home" | "creating" | "create-waiting" | "join-waiting" | "chat";
type SidebarView = "list" | "friend-detail";
type CallState = "idle" | "calling" | "ringing" | "in-call";

export default function App() {
  const [ready, setReady] = useState(false);
  const [shortId, setShortId] = useState("");
  const [stage, setStage] = useState<Stage>("home");
  const [messages, setMessages] = useState<Message[]>([]);
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

  // Call state
  const [callState, setCallState] = useState<CallState>("idle");
  const [muted, setMuted] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [callError, setCallError] = useState<string | null>(null);
  const callTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const peerRef = useRef<Peer | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Init identity on mount
  useEffect(() => {
    initIdentity().then((id) => {
      setShortId(id.shortId);
      setFriends(getFriends());
      setReady(true);
    });
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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

  const refreshFriends = useCallback(() => {
    setFriends(getFriends());
  }, []);

  function resetCallState() {
    setCallState("idle");
    setMuted(false);
    setCallDuration(0);
  }

  function makePeer() {
    const peer = new Peer({
      onMessage: (text) =>
        setMessages((m) => [...m, { from: "them", text, ts: Date.now() }]),
      onConnected: () => setStage("chat"),
      onDisconnected: () => {
        setStage("home");
        setConnectedPeerId(null);
        setRemoteShortId(null);
        setShowSavePrompt(false);
        resetCallState();
        peerRef.current = null;
      },
      onChannelOpen: () => {
        // channel is open
      },
      onIdentity: (id) => {
        setRemoteShortId(id);
        setConnectedPeerId(id);
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
    });
    peer.setLocalShortId(getShortId());
    peerRef.current = peer;
    return peer;
  }

  // --- CALLER FLOW ---
  async function handleCreate() {
    setStage("creating");
    const peer = makePeer();
    const offer = await peer.createOffer();
    setOfferText(offer);
    setStage("create-waiting");
  }

  async function handleAcceptAnswer() {
    if (!peerRef.current || !pasteText.trim()) return;
    await peerRef.current.acceptAnswer(pasteText.trim());
    setPasteText("");
  }

  // --- JOINER FLOW ---
  async function handleJoin() {
    if (!pasteText.trim()) return;
    const peer = makePeer();
    const answer = await peer.acceptOffer(pasteText.trim());
    setAnswerText(answer);
    setPasteText("");
    setStage("join-waiting");
  }

  // --- CHAT ---
  function handleSend() {
    if (!input.trim() || !peerRef.current) return;
    peerRef.current.send(input.trim());
    setMessages((m) => [...m, { from: "me", text: input.trim(), ts: Date.now() }]);
    setInput("");
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
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
        err instanceof Error ? err.message : "Could not access microphone"
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
        err instanceof Error ? err.message : "Could not access microphone"
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

  function formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
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
                <div style={s.friendName}>{f.name}</div>
                <div style={s.friendId}>{f.id}</div>
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
        <div style={s.homeButtons}>
          <button style={s.btn} onClick={handleCreate}>
            Create invite
          </button>
          <div style={s.divider}>or join with a code</div>
          <textarea
            style={s.textarea}
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
        <div style={s.codeBox}>
          <code style={s.code} id="offer-full">{offerText.slice(0, 80)}...</code>
          <input type="hidden" id="offer-data" value={offerText} />
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
          style={s.textarea}
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
          <input type="hidden" id="answer-data" value={answerText} />
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
        <div style={s.chatMessages}>
          {messages.map((m, i) => (
            <div
              key={i}
              style={{
                ...s.bubble,
                alignSelf: m.from === "me" ? "flex-end" : "flex-start",
                background: m.from === "me" ? "#2563eb" : "#262626",
              }}
            >
              {m.text}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
        <form
          style={s.chatInput}
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
        >
          <input
            style={s.input}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message..."
            autoFocus
          />
          <button style={s.sendBtn} type="submit">
            Send
          </button>
        </form>
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
  },
  friendName: {
    fontSize: 14,
    fontWeight: 500,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
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
  textarea: {
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
  chatMessages: {
    flex: 1,
    overflowY: "auto",
    padding: 16,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  bubble: {
    padding: "8px 14px",
    borderRadius: 16,
    maxWidth: "70%",
    fontSize: 15,
    lineHeight: 1.4,
    wordBreak: "break-word",
  },
  chatInput: {
    display: "flex",
    gap: 8,
    padding: 12,
    borderTop: "1px solid #222",
  },
  input: {
    flex: 1,
    padding: "10px 14px",
    background: "#161616",
    color: "#e0e0e0",
    border: "1px solid #333",
    borderRadius: 8,
    fontSize: 15,
    outline: "none",
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
  },
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
