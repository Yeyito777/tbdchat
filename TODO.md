# tbdchat — V1 TODO

Goal: Aurelio and Fede can DM, voice call, and screen share through tbdchat,
replacing Discord for day-to-day work.

---

## Connection & Identity

- [x] Generate persistent identity (ECDSA P-256 keypair) on first launch, stored in localStorage
- [x] Display your ID as a short shareable code (first 8 hex chars of SHA-256 of public key)
- [x] Friend list persisted in localStorage (name + public key + addedAt)
- [x] Add friend flow: connect via copy-paste → save as friend after connection
- [ ] Auto-reconnect: when you reopen the app, attempt to re-establish connections with known friends
- [x] Connection status indicator per friend (online/offline)

## Chat (Text DMs)

- [x] Basic P2P text messaging over WebRTC DataChannel
- [x] Copy-paste signaling to establish connection
- [x] JSON protocol for all DataChannel messages ({type: 'chat'|'identity'|'call-*'|'screen-*'|'file-*'})
- [x] Message history persisted locally (IndexedDB)
- [x] Timestamps on messages (HH:MM format)
- [x] Date separators (Today/Yesterday/date)
- [x] Multi-line messages (Shift+Enter for newline, Enter to send)
- [x] Link detection (clickable URLs, open in new tab)
- [x] Sidebar message previews (last message + timestamp + count badge)
- [ ] Unread message count / notifications
- [ ] Basic markdown or at least code blocks (backtick rendering)
- [ ] Message delivery status (sent/delivered)

## Voice & Video Calls

- [x] 1:1 voice call (WebRTC MediaStream with renegotiation over DataChannel)
- [x] Call UI: calling state, ringing with accept/reject, hang up
- [x] Mute/unmute microphone toggle
- [x] Call duration timer (M:SS format)
- [x] Error handling for getUserMedia failures
- [ ] 1:1 video call
- [ ] Camera on/off toggle
- [ ] Audio device selection (mic/speaker)

## Screen Sharing

- [x] Share screen via getDisplayMedia() with video + audio tracks
- [x] Remote video display (autoPlay, playsInline, max 60vh)
- [x] Stop sharing button (red accent)
- [x] Auto-cleanup when browser's "Stop sharing" button is clicked
- [x] SDP renegotiation over DataChannel for adding/removing tracks

## File Sharing

- [x] Send files over DataChannel (16KB chunks with backpressure)
- [x] Drag-and-drop file sending on chat area (blue overlay)
- [x] 📎 button file picker
- [x] File message bubbles (📎 icon + filename + size + download link)
- [x] Transfer progress bar with percentage
- [x] 100MB max file size validation
- [x] File messages persisted in IndexedDB (metadata only)

## UX / Polish

- [x] Friend list sidebar (220px, dark bg)
- [x] Conversation view per friend
- [x] ICE gathering timeout (10s) with "Generating invite code..." loading state
- [x] Error handling with auto-dismissing error bars (4s timeout)
- [ ] Browser notifications for incoming messages/calls (Notification API)
- [ ] Sound effects for incoming message / call ring
- [ ] Dark theme (done) / light theme toggle
- [ ] Mobile responsive layout
- [ ] Emoji picker or at minimum emoji rendering

## Infra / Deployment

- [ ] Static build deployable to GitHub Pages or any CDN (zero backend)
- [ ] PWA manifest + service worker for "install to homescreen"
- [ ] STUN/TURN server fallback config (for restrictive NATs)
  - Google STUN is free but no TURN — may need a self-hosted TURN for reliability

## Known Issues / Tech Debt

- [ ] ICE gathering can take up to 40s in some environments (10s timeout mitigates but may lose candidates)
- [ ] Both tabs on same origin share localStorage (identity collision) — not an issue in real usage
- [ ] No offline message delivery — both must be online (accepted tradeoff for V1)
- [ ] Object URLs from file transfers aren't revoked (intentional — needed for download links during session)
- [ ] Auto-reconnect not implemented — must redo handshake each session

---

## Priority order for dogfooding (DONE)

1. ~~**Persistent identity + friend list**~~ ✅
2. ~~**Voice calls**~~ ✅
3. ~~**Screen sharing**~~ ✅
4. ~~**Message history**~~ ✅
5. ~~**File sharing**~~ ✅

## What's left for comfortable daily use

1. **Auto-reconnect** — biggest remaining pain point
2. **Browser notifications** — so you don't miss messages
3. **GitHub Pages deployment** — so Fede can just open a URL
