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

On phones, **+ → Record video** opens the phone's own camera app in video mode and **+ → Take photo** opens it for photos; the file is sent exactly as the camera saved it. Photos and videos are never re-encoded (photos default to original quality; the "Send photos in original quality" setting can turn on smaller photos). Files up to 2 GB upload in encrypted 8 MiB pieces (past Cloud Run's 32 MiB request limit) and stream with seeking. Set `MEDIA_BUCKET` to store the pieces in Google Cloud Storage; without it they go in the database. On computers, Record video uses the in-app recorder (browser encoder).

Before release, check two physical phones over Wi-Fi and cellular: answer/decline, camera flip, camera off/on, screen share, network changes, recorded video playback on the other device, and Chrome notifications with the app backgrounded. Automated tests do not measure end-to-end latency or sensor image quality.

## Buzz (live news tab)

**Chats | Buzz** tabs sit at the bottom of the main page. Buzz is one combined feed of real stories, mixed for the reader's city (Hyderabad, Bengaluru, Mumbai, Delhi, Chennai, Kolkata, Pune, or all of India): about a third local, then India, tech, business, world, cricket and cinema, interleaved so no publisher dominates.

Architecture: publisher RSS/Atom feeds + Hacker News API → server collectors (`server/buzz/collect.js`, per-source polling, ETag/Last-Modified, timeouts, size limits, redirect checks, Retry-After + exponential backoff) → normalised rows in MySQL (`feed_sources`, `feed_items`, `feed_likes`, `feed_reposts`, `feed_comments`) → per-region ranking (`server/buzz/index.js`) → `GET /api/feed` → the app checks every 5 s while Buzz is on screen (one request at a time), merges new stories at the top without moving the reader, and keeps the last feed in local storage for offline use.

- Sources live in `server/buzz/sources.js` — adding one is a single entry (plus an adapter only for a new API type). The in-app **Sources & status** section shows each source's live status.
- Collection runs in the background on the server (Cloud Run keeps one instance running with CPU always on), so the feed stays fresh when nobody has it open. Set `BUZZ_COLLECT=off` to disable.
- Popularity labels use real signals only: Hacker News points/comments, Google News top-story position, and likes/comments/reposts on Ping Me. Nothing is claimed to be "the most viral on the internet".
- Missing images/summaries are read from the article's Open Graph tags, only on the publisher's own site. Summaries are the publisher's own sentences, never invented.
- Optional, disabled until credentials are set: YouTube popular videos (`YOUTUBE_API_KEY`) and Reddit (`REDDIT_CLIENT_ID` + `REDDIT_CLIENT_SECRET`). These adapters are stubs until those keys exist.
- Google Trends (India + each city's state) adds what people are searching for right now, with real search volumes; the same story covered by several outlets is grouped into one card ("Covered by N outlets") and ranked higher.
- Publisher logos are fetched once from each publisher's own site and stored in the database (`/api/feed/logo/:id`).
- Known source status: 43 feeds working; Moneycontrol returns HTTP 403 to servers and Ars Technica blocks logo requests (both handled gracefully).

## Admin portal (owner only)

Open **/admin** (e.g. `https://<your-app>/admin`) and enter `ADMIN_KEY` from `.env` (at least 16 characters). It is separate from Ping Me sign-in, so using it on a laptop never signs your phone out (one-device rule). The key sets a 30-day admin cookie; login attempts are rate-limited.

It shows: total / new users, daily / weekly / monthly active users, stickiness, who is online right now and which screen they're on, time by screen, weekly retention cohorts (day 1, week 2, month 2) for the app and for Buzz, devices (iPhone / Android / computer, installed app vs browser), messages and calls per day, and Buzz stats (readers, stories seen/opened, open rate, likes/comments/reposts, top stories, top sources, cities).

Privacy: only activity is recorded (screen + duration, app opens, Buzz story ids seen/opened). Message text and calls are never recorded. Raw events are kept 120 days (`analytics_events`); daily summaries (`user_days`) and device type (`user_devices`) stay.
