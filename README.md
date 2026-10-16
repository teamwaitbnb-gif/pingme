# Ping Me

Private messaging + HD calls, installable on iPhone and Android as the **Ping Me** home-screen app (PWA).
Node.js + Socket.IO + WebRTC. Messages, names, photos and files are encrypted (AES-256-GCM) before they're stored in MySQL.

## Run locally

```bash
npm install
npm start            # http://localhost:8080
```
`.env` holds the database login, the encryption key (`PINGME_KEY`) and the Google client ID. Missing secrets are created by `npm run setup`.
The `meetme` database and all tables are created and upgraded automatically on start.

## Google sign-in

`GOOGLE_CLIENT_ID` is already in `.env`. In [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials), open that OAuth client and add:
- **Authorized JavaScript origins:** `http://localhost:8080` and your live URL (e.g. `https://ping-me-xxxxx.a.run.app`)
- **Authorized redirect URIs:** `https://YOUR-LIVE-URL/api/oauth/google/callback` (used by the installed app)

Also set `PUBLIC_URL=https://YOUR-LIVE-URL` in `.env` once deployed. New Google users choose a username and enter their birthday on first sign-in.

## Deploy from Google Cloud Shell

1. Zip this folder **including `.env`** and upload it in Cloud Shell (⋮ → Upload).
2. Run:
   ```bash
   unzip Meet-me.zip -d ping-me && cd ping-me
   gcloud config set project YOUR_PROJECT_ID
   ./deploy.sh
   ```
3. Open the printed `https://…run.app` link on your phone → it asks to add **Ping Me** to the Home Screen.

**Back up `PINGME_KEY`.** It encrypts all stored data — if it's lost, messages can't be decrypted.

## Settings in `.env`

| Key | What it does |
|---|---|
| `INVITE_ONLY=true` | Golden Keys launch: sign-up needs an invite code; everyone gets 3 (the first account is exempt) |
| `RECOVERY_DELAY_MIN=30` | Safety delay after 3 friends approve an account recovery (the owner can cancel during it) |
| `TURN_URLS / TURN_USERNAME / TURN_CREDENTIAL` | TURN relay so calls connect on strict mobile/office networks |

## What's inside

On first sign-in everyone sees every feature with an on/off switch (also in **Settings → Features**).

**Messaging** — screenshot-proof messages (text drawn as moving noise: readable live, static in screenshots) · eyes-only (front camera + on-device face detection: shows only while exactly one face looks, hides if someone peeks) · vanish after read (timer starts when everyone has read it; longer messages get more time) · intent tags (venting / advice / urgent / FYI / good news) · promise tracker ("I'll send it tomorrow" → automatic reminder with Undo) · scam radar (fake KYC, OTP, UPI collect, job, lottery, "digital arrest", APK links — runs on the phone) · scheduled messages · disappearing timers · reactions, replies, edit, unsend, polls, voice notes, files, location, effects · search with live suggestions.

**Calls** — HD audio/video (up to 1080p, VP9/AV1/H.264, Opus FEC) · verified calls (device keys sign the call's encryption fingerprints: "✓ same device as before", or a warning for a new device) · reason to call (people who never chatted with you must say why first) · whisper mode · call rewind (replay the last 30 s, kept only in memory) · spatial audio in group calls · screen share, minimise, PiP, live stats.

**Safety & security** — silent SOS (hold 2 s: live location to trusted contacts + a normal-looking call) · safety check-in (alerts a chat if you don't tap "I'm safe") · app lock + duress PIN (hides chosen chats, badges and notifications) · friend recovery (3 of up to 5 trusted contacts approve, then a safety delay; no SMS, so no SIM-swap) · Golden Keys invites · birthday at sign-up (13+; friends only ever see "🎂 today").

**Fun** — Chat Wrapped (monthly / yearly shareable card) · group pets that grow and get lonely · Who's Right? votes with a shareable result card · Verified Real photos (the in-app camera signs the exact image bytes; recipients see "✓ Verified Real").

### Not included
Bluetooth/Wi-Fi-Direct mesh messaging, AR "holo" calls, live sign-language translation, face-rebuilding video on 2G, AI deepfake-voice detection, auto-blurring documents in video, an AI that replies for you, and lag-free group singing need native apps and/or large on-device AI models. Messages are encrypted at rest with a server-held key — not end-to-end.

## Layout

```
server/index.js        API, realtime, calls, workers
server/features.js     reminders, check-ins, SOS, device keys, invites, recovery, Wrapped/pet stats
server/usernames.js    unique-username rules           server/oauth.js        Google ID-token verification
public/js/app.js       app shell, chats, composer      public/js/sheets.js    settings & feature screens
public/js/call.js      WebRTC calls                    public/js/secure.js    screenshot-proof + eyes-only
public/js/smart.js     scam radar + promise tracker    public/js/keys.js      device keys (verified calls/photos)
public/js/lock.js      app lock + duress PIN           public/js/onboarding.js  first-run feature setup
```

## Call and camera quality checks

`npm test` runs media lifecycle, signaling race, and notification regression tests without a database.

Calls default to 1080p at 30 fps with the browser's codec preferences. Explicit 4K remains available where the camera supports it; mobile call capture stays capped at 1080p. Group calls share an upload budget across peers. TURN must be configured for reliable calls across carrier NAT; reconnecting the signaling socket still ends the current call.

Choose **+ → Record video** for capture at up to 4K/30 fps with a bitrate based on the actual camera resolution, a preview, and no extra compression during upload. The browser chooses a supported camera mode and encoder, so this cannot guarantee parity with a phone's native camera processing, HDR, or stabilization. For native camera output, record in the phone camera app and attach the original file through **Photos & Videos**. The current upload limit is 45 MiB; the recorder stops near that limit and reports oversized clips without reducing their quality.

Before release, check two physical phones over Wi-Fi and cellular: answer/decline, camera flip, camera off/on, screen share, network changes, recorded video playback on the other device, and Chrome notifications with the app backgrounded. Automated tests do not measure end-to-end latency or sensor image quality.
