# tbdchat — V1 TODO

Goal: Aurelio and Fede can DM, voice call, and screen share through tbdchat,
replacing Discord for day-to-day work.

---

## Connection & Identity

- [ ] Generate persistent identity (Ed25519 keypair) on first launch, stored in localStorage
- [ ] Display your ID as a short shareable code (e.g. truncated public key hash)
- [ ] Friend list persisted in localStorage (name + public key + last known connection info)
- [ ] Add friend flow: paste their code → they paste yours → mutual confirmation
- [ ] Auto-reconnect: when you reopen the app, attempt to re-establish connections with known friends
- [ ] Connection status indicator per friend (online/offline/connecting)

## Chat (Text DMs)

- [x] Basic P2P text messaging over WebRTC DataChannel
- [x] Copy-paste signaling to establish connection
- [ ] Message history persisted locally (IndexedDB)
- [ ] Timestamps on messages
- [ ] Unread message count / notifications
- [ ] Multi-line messages (Shift+Enter for newline, Enter to send)
- [ ] Link detection (clickable URLs)
- [ ] Basic markdown or at least code blocks (backtick rendering)
- [ ] Message delivery status (sent/delivered)

## Voice & Video Calls

- [ ] 1:1 voice call (WebRTC MediaStream over existing peer connection)
- [ ] Call UI: ringing state, accept/reject, hang up
- [ ] Mute/unmute microphone
- [ ] 1:1 video call
- [ ] Camera on/off toggle
- [ ] Audio device selection (mic/speaker)

## Screen Sharing

- [ ] Share screen via `getDisplayMedia()` sent as video track
- [ ] Viewer sees shared screen in main area, chat in sidebar
- [ ] Stop sharing button
- [ ] Audio sharing option (system audio capture)

## UX / Polish

- [ ] Friend list sidebar (not just a single chat view)
- [ ] Conversation view per friend
- [ ] Browser notifications for incoming messages/calls (Notification API)
- [ ] Sound effects for incoming message / call ring
- [ ] Dark theme (done) / light theme toggle
- [ ] Mobile responsive layout
- [ ] Drag-and-drop file sending over DataChannel
- [ ] Emoji picker or at minimum emoji rendering

## Infra / Deployment

- [ ] Static build deployable to GitHub Pages or any CDN (zero backend)
- [ ] PWA manifest + service worker for "install to homescreen"
- [ ] STUN/TURN server fallback config (for restrictive NATs)
  - Google STUN is free but no TURN — may need a self-hosted TURN for reliability

## Known Issues / Tech Debt

- [ ] ICE gathering is slow (~10-15s) — show a spinner/progress during "generating invite"
- [ ] Offer/answer blobs are ~1KB base64 — consider compression for QR code support later
- [ ] No encryption beyond WebRTC's built-in DTLS-SRTP — fine for now, E2E is inherent to P2P
- [ ] No offline message delivery — both must be online (accepted tradeoff for V1)
- [ ] `data-full` attributes and `window.__tbd*` debug globals should be removed before release

---

## Priority order for dogfooding

1. **Persistent identity + friend list** — so you don't redo the handshake every session
2. **Auto-reconnect** — open app → already connected to Fede
3. **Voice calls** — replace Discord calls
4. **Screen sharing** — replace Discord screen share
5. **Message history** — so you don't lose context on reload
6. **File sharing** — send code snippets, screenshots, etc.
