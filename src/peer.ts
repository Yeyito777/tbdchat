/**
 * Minimal WebRTC peer connection manager.
 * Handles offer/answer exchange, DataChannel messaging, and identity exchange.
 */

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

export type PeerEvents = {
  onMessage: (msg: string) => void;
  onConnected: () => void;
  onDisconnected: () => void;
  onChannelOpen?: () => void;
  onIdentity?: (shortId: string) => void;
};

export class Peer {
  pc: RTCPeerConnection;
  dc: RTCDataChannel | null = null;
  private events: PeerEvents;
  private iceDone: Promise<void>;
  private _localShortId: string | null = null;

  constructor(events: PeerEvents) {
    this.events = events;
    this.pc = new RTCPeerConnection(ICE_SERVERS);

    // Wait for ICE gathering to finish (timeout after 10s to avoid hanging)
    this.iceDone = new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(), 10000);
      this.pc.onicecandidate = (e) => {
        if (e.candidate === null) {
          clearTimeout(timeout);
          resolve();
        }
      };
    });

    this.pc.onconnectionstatechange = () => {
      if (this.pc.connectionState === "connected") {
        this.events.onConnected();
      }
      if (
        this.pc.connectionState === "disconnected" ||
        this.pc.connectionState === "failed" ||
        this.pc.connectionState === "closed"
      ) {
        this.events.onDisconnected();
      }
    };

    // Handle incoming data channel (answerer side)
    this.pc.ondatachannel = (e) => {
      this.dc = e.channel;
      this.setupChannel();
    };
  }

  /** Set the local short ID to send on channel open. */
  setLocalShortId(id: string) {
    this._localShortId = id;
  }

  private setupChannel() {
    if (!this.dc) return;
    this.dc.onopen = () => {
      this.events.onChannelOpen?.();
      // Send identity message
      if (this._localShortId) {
        this.dc?.send(JSON.stringify({ type: "identity", shortId: this._localShortId }));
      }
    };
    this.dc.onmessage = (e) => {
      // Try to parse identity messages
      try {
        const parsed = JSON.parse(e.data) as unknown;
        if (
          parsed &&
          typeof parsed === "object" &&
          "type" in parsed &&
          (parsed as Record<string, unknown>).type === "identity" &&
          "shortId" in parsed
        ) {
          this.events.onIdentity?.((parsed as Record<string, unknown>).shortId as string);
          return;
        }
      } catch {
        // Not JSON, treat as regular message
      }
      this.events.onMessage(e.data);
    };
  }

  /** Create an offer (caller side). Returns the offer string to share. */
  async createOffer(): Promise<string> {
    this.dc = this.pc.createDataChannel("chat");
    this.setupChannel();

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await this.iceDone;

    return btoa(JSON.stringify(this.pc.localDescription));
  }

  /** Accept an offer and generate an answer (callee side). Returns answer string to share back. */
  async acceptOffer(offerStr: string): Promise<string> {
    const offer = JSON.parse(atob(offerStr));
    await this.pc.setRemoteDescription(offer);

    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await this.iceDone;

    return btoa(JSON.stringify(this.pc.localDescription));
  }

  /** Complete the connection by accepting the answer (caller side). */
  async acceptAnswer(answerStr: string): Promise<void> {
    const answer = JSON.parse(atob(answerStr));
    await this.pc.setRemoteDescription(answer);
  }

  /** Send a text message over the data channel. */
  send(msg: string) {
    if (this.dc?.readyState === "open") {
      this.dc.send(msg);
    }
  }

  /** Clean up. */
  destroy() {
    this.dc?.close();
    this.pc.close();
  }
}
