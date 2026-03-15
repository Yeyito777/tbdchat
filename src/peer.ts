/**
 * Minimal WebRTC peer connection manager.
 * Handles offer/answer exchange, DataChannel messaging, identity exchange,
 * and 1:1 voice calls over the same peer connection.
 */

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

/** Protocol messages sent over the DataChannel as JSON. */
export type DCMessage =
  | { type: "identity"; shortId: string }
  | { type: "chat"; text: string }
  | { type: "call-start" }
  | { type: "call-accept" }
  | { type: "call-end" }
  | { type: "screen-start" }
  | { type: "screen-stop" }
  | { type: "_renego-offer"; sdp: RTCSessionDescriptionInit }
  | { type: "_renego-answer"; sdp: RTCSessionDescriptionInit };

export type PeerEvents = {
  onMessage: (msg: string) => void;
  onConnected: () => void;
  onDisconnected: () => void;
  onChannelOpen?: () => void;
  onIdentity?: (shortId: string) => void;
  onCallStart?: () => void;
  onCallAccept?: () => void;
  onCallEnd?: () => void;
  onScreenStart?: () => void;
  onScreenStop?: () => void;
  onRemoteStream?: (stream: MediaStream | null) => void;
};

export class Peer {
  pc: RTCPeerConnection;
  dc: RTCDataChannel | null = null;
  private events: PeerEvents;
  private iceDone: Promise<void>;
  private _localShortId: string | null = null;

  // Voice call state
  private localStream: MediaStream | null = null;
  private remoteAudio: HTMLAudioElement | null = null;
  private senders: RTCRtpSender[] = [];

  // Screen share state
  private screenStream: MediaStream | null = null;
  private screenSenders: RTCRtpSender[] = [];
  private remoteVideoStream: MediaStream | null = null;

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

    // Handle incoming remote tracks (audio for calls, video for screen share)
    this.pc.ontrack = (e) => {
      if (e.track.kind === "audio") {
        if (!this.remoteAudio) {
          this.remoteAudio = new Audio();
          this.remoteAudio.autoplay = true;
        }
        this.remoteAudio.srcObject = e.streams[0] ?? new MediaStream([e.track]);
      } else if (e.track.kind === "video") {
        this.remoteVideoStream = e.streams[0] ?? new MediaStream([e.track]);
        this.events.onRemoteStream?.(this.remoteVideoStream);
      }
    };
  }

  /** Set the local short ID to send on channel open. */
  setLocalShortId(id: string) {
    this._localShortId = id;
  }

  /** Send a typed protocol message over the data channel. */
  private sendDC(msg: DCMessage) {
    if (this.dc?.readyState === "open") {
      this.dc.send(JSON.stringify(msg));
    }
  }

  private setupChannel() {
    if (!this.dc) return;
    this.dc.onopen = () => {
      this.events.onChannelOpen?.();
      // Send identity message
      if (this._localShortId) {
        this.sendDC({ type: "identity", shortId: this._localShortId });
      }
    };
    this.dc.onmessage = (e) => {
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(e.data) as Record<string, unknown>;
      } catch {
        // Legacy plain-text message — treat as chat text
        this.events.onMessage(e.data);
        return;
      }

      if (!parsed || typeof parsed !== "object" || !("type" in parsed)) {
        this.events.onMessage(e.data);
        return;
      }

      switch (parsed.type) {
        case "identity":
          if ("shortId" in parsed && typeof parsed.shortId === "string") {
            this.events.onIdentity?.(parsed.shortId);
          }
          break;
        case "chat":
          if ("text" in parsed && typeof parsed.text === "string") {
            this.events.onMessage(parsed.text);
          }
          break;
        case "call-start":
          this.events.onCallStart?.();
          break;
        case "call-accept":
          this.events.onCallAccept?.();
          break;
        case "call-end":
          this.cleanupCall();
          this.events.onCallEnd?.();
          break;
        case "screen-start":
          this.events.onScreenStart?.();
          break;
        case "screen-stop":
          this.remoteVideoStream = null;
          this.events.onRemoteStream?.(null);
          this.events.onScreenStop?.();
          break;
        case "_renego-offer":
          this.handleRenegoOffer(parsed.sdp as RTCSessionDescriptionInit);
          break;
        case "_renego-answer":
          this.pc.setRemoteDescription(parsed.sdp as RTCSessionDescriptionInit).catch(console.error);
          break;
      }
    };
  }

  /** Handle a renegotiation offer from the remote side. */
  private async handleRenegoOffer(sdp: RTCSessionDescriptionInit) {
    try {
      await this.pc.setRemoteDescription(sdp);
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      this.sendDC({ type: "_renego-answer", sdp: this.pc.localDescription! });
    } catch (err) {
      console.error("Renegotiation failed:", err);
    }
  }

  /** Renegotiate SDP after adding/removing tracks. */
  private async renegotiate(): Promise<void> {
    try {
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      this.sendDC({ type: "_renego-offer", sdp: this.pc.localDescription! });
    } catch (err) {
      console.error("Renegotiation offer failed:", err);
    }
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

  /** Send a text message over the data channel (wrapped in chat protocol). */
  send(msg: string) {
    this.sendDC({ type: "chat", text: msg });
  }

  // ─── Voice call methods ───────────────────────────────────────────

  /**
   * Start an outgoing call.
   * Gets microphone, adds tracks to the peer connection, renegotiates, sends call-start signal.
   */
  async startCall(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.localStream = stream;

    for (const track of stream.getAudioTracks()) {
      const sender = this.pc.addTrack(track, stream);
      this.senders.push(sender);
    }

    await this.renegotiate();
    this.sendDC({ type: "call-start" });
  }

  /**
   * Accept an incoming call.
   * Gets microphone, adds tracks, renegotiates, sends call-accept signal.
   */
  async acceptCall(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.localStream = stream;

    for (const track of stream.getAudioTracks()) {
      const sender = this.pc.addTrack(track, stream);
      this.senders.push(sender);
    }

    await this.renegotiate();
    this.sendDC({ type: "call-accept" });
  }

  /**
   * End the current call (local action). Cleans up and notifies remote.
   */
  endCall(): void {
    this.cleanupCall();
    this.sendDC({ type: "call-end" });
  }

  /**
   * Reject an incoming call (same wire message as ending).
   */
  rejectCall(): void {
    this.sendDC({ type: "call-end" });
  }

  /**
   * Toggle the local microphone mute state.
   * Returns the new muted state (true = muted).
   */
  toggleMute(): boolean {
    if (!this.localStream) return true;
    const track = this.localStream.getAudioTracks()[0];
    if (!track) return true;
    track.enabled = !track.enabled;
    return !track.enabled;
  }

  /** Whether the local mic is currently muted. */
  get isMuted(): boolean {
    if (!this.localStream) return true;
    const track = this.localStream.getAudioTracks()[0];
    return !track || !track.enabled;
  }

  /** Clean up local call resources (does NOT send call-end signal). */
  private cleanupCall(): void {
    for (const sender of this.senders) {
      try {
        this.pc.removeTrack(sender);
      } catch {
        // Ignore if already removed
      }
    }
    this.senders = [];

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        track.stop();
      }
      this.localStream = null;
    }

    if (this.remoteAudio) {
      this.remoteAudio.srcObject = null;
      this.remoteAudio = null;
    }
  }

  // ─── Screen share methods ─────────────────────────────────────────

  /**
   * Start sharing the screen.
   * Calls getDisplayMedia, adds video+audio tracks, renegotiates, signals remote.
   */
  async startScreenShare(): Promise<void> {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    });
    this.screenStream = stream;

    for (const track of stream.getTracks()) {
      const sender = this.pc.addTrack(track, stream);
      this.screenSenders.push(sender);

      // Auto-cleanup when user clicks browser's "Stop sharing" button
      track.addEventListener("ended", () => {
        if (this.screenStream) {
          this.stopScreenShare();
          this.events.onScreenStop?.();
        }
      });
    }

    await this.renegotiate();
    this.sendDC({ type: "screen-start" });
  }

  /**
   * Stop sharing the screen.
   * Removes tracks, stops the stream, notifies remote.
   */
  stopScreenShare(): void {
    for (const sender of this.screenSenders) {
      try {
        this.pc.removeTrack(sender);
      } catch {
        // Ignore if already removed
      }
    }
    this.screenSenders = [];

    if (this.screenStream) {
      for (const track of this.screenStream.getTracks()) {
        track.stop();
      }
      this.screenStream = null;
    }

    this.renegotiate().catch(console.error);
    this.sendDC({ type: "screen-stop" });
  }

  /** Whether we are currently sharing our screen. */
  get isScreenSharing(): boolean {
    return this.screenStream !== null;
  }

  /** Clean up screen share resources (does NOT send screen-stop signal). */
  private cleanupScreenShare(): void {
    for (const sender of this.screenSenders) {
      try {
        this.pc.removeTrack(sender);
      } catch {
        // Ignore
      }
    }
    this.screenSenders = [];

    if (this.screenStream) {
      for (const track of this.screenStream.getTracks()) {
        track.stop();
      }
      this.screenStream = null;
    }

    this.remoteVideoStream = null;
  }

  /** Clean up everything. */
  destroy() {
    this.cleanupCall();
    this.cleanupScreenShare();
    this.dc?.close();
    this.pc.close();
  }
}
