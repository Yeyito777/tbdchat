import { useState, useRef, useEffect } from "react";
import { Peer } from "./peer";

type Message = { from: "me" | "them"; text: string; ts: number };
type Stage = "home" | "create-waiting" | "join-waiting" | "chat";

export default function App() {
  const [stage, setStage] = useState<Stage>("home");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [offerText, setOfferText] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [answerText, setAnswerText] = useState("");
  const [copied, setCopied] = useState(false);
  const peerRef = useRef<Peer | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function makePeer() {
    const peer = new Peer({
      onMessage: (text) =>
        setMessages((m) => [...m, { from: "them", text, ts: Date.now() }]),
      onConnected: () => setStage("chat"),
      onDisconnected: () => {
        setStage("home");
        peerRef.current = null;
      },
    });
    peerRef.current = peer;
    return peer;
  }

  // --- CALLER FLOW ---
  async function handleCreate() {
    const peer = makePeer();
    const offer = await peer.createOffer();
    setOfferText(offer);
    (window as any).__tbdOffer = offer;
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
    (window as any).__tbdAnswer = answer;
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

  // --- RENDER ---
  if (stage === "home") {
    return (
      <div style={styles.container}>
        <h1 style={styles.title}>tbdchat</h1>
        <p style={styles.subtitle}>P2P chat. No servers. No bullshit.</p>
        <div style={styles.homeButtons}>
          <button style={styles.btn} onClick={handleCreate}>
            Create invite
          </button>
          <div style={styles.divider}>or join with a code</div>
          <textarea
            style={styles.textarea}
            placeholder="Paste invite code here..."
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
          />
          <button style={styles.btn} onClick={handleJoin} disabled={!pasteText.trim()}>
            Join
          </button>
        </div>
      </div>
    );
  }

  if (stage === "create-waiting") {
    return (
      <div style={styles.container}>
        <h1 style={styles.title}>tbdchat</h1>
        <p style={styles.subtitle}>Step 1: Send this invite code to your friend</p>
        <div style={styles.codeBox}>
          <code style={styles.code} data-full={offerText}>{offerText.slice(0, 80)}...</code>
          <button style={styles.btnSmall} onClick={() => copyToClipboard(offerText)}>
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
        <p style={{ ...styles.subtitle, marginTop: 32 }}>
          Step 2: Paste their response code
        </p>
        <textarea
          style={styles.textarea}
          placeholder="Paste their response code here..."
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
        />
        <button
          style={styles.btn}
          onClick={handleAcceptAnswer}
          disabled={!pasteText.trim()}
        >
          Connect
        </button>
      </div>
    );
  }

  if (stage === "join-waiting") {
    return (
      <div style={styles.container}>
        <h1 style={styles.title}>tbdchat</h1>
        <p style={styles.subtitle}>
          Send this response code back to your friend
        </p>
        <div style={styles.codeBox}>
          <code style={styles.code} data-full={answerText}>{answerText.slice(0, 80)}...</code>
          <button style={styles.btnSmall} onClick={() => copyToClipboard(answerText)}>
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
        <p style={styles.subtitle}>Waiting for connection...</p>
      </div>
    );
  }

  // stage === "chat"
  return (
    <div style={styles.chatContainer}>
      <div style={styles.chatHeader}>
        <span style={styles.dot} />
        <span>Connected — P2P</span>
      </div>
      <div style={styles.chatMessages}>
        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              ...styles.bubble,
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
        style={styles.chatInput}
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
      >
        <input
          style={styles.input}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          autoFocus
        />
        <button style={styles.sendBtn} type="submit">
          Send
        </button>
      </form>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    height: "100%",
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
  dot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "#22c55e",
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
};
