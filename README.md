# Ping Me

Team workspaces, private messaging + HD calls, installable on iPhone and Android as the **Ping Me** home-screen app (PWA).
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
   ./deploy.sh pingme asia-south1
   ```
3. Open the printed `https://…run.app` link on your phone → it asks to add **Ping Me** to the Home Screen.

**Back up `PINGME_KEY`.** It encrypts all stored data — if it's lost, messages can't be decrypted.

## Settings in `.env`

| Key | What it does |
|---|---|
| `INVITE_ONLY=true` | Golden Keys launch: sign-up needs an invite code; everyone gets 3 (the first account is exempt) |
| `RECOVERY_DELAY_MIN=30` | Safety delay after 3 friends approve an account recovery (the owner can cancel during it) |
| `TURN_URLS / TURN_USERNAME / TURN_CREDENTIAL` | TURN relay so calls connect on strict mobile/office networks |
| `ADMIN_KEY` | Password for the owner-only `/admin` portal |

## What's inside

First sign-in introduces organizations, channels, and calls. Optional personal features remain available in **Settings → Features**.

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

`npm test` runs media lifecycle, signaling race, notification, asset, and workspace permission regression tests without a database.
The optional `tests/workspaces.integration.cjs` exercises a disposable localhost server backed by MySQL; set `PINGME_TEST_URL` only to an isolated test instance.

Calls default to 1080p at 30 fps with the browser's codec preferences. Explicit 4K remains available where the camera supports it; mobile call capture stays capped at 1080p. Group calls share an upload budget across peers. TURN must be configured for reliable calls across carrier NAT; reconnecting the signaling socket still ends the current call.

On phones, **+ → Record video** opens the phone's own camera app in video mode and **+ → Take photo** opens it for photos; the file is sent exactly as the camera saved it. Photos and videos are never re-encoded (photos default to original quality; the "Send photos in original quality" setting can turn on smaller photos). Files up to 2 GB upload in encrypted 8 MiB pieces (past Cloud Run's 32 MiB request limit) and stream with seeking. Set `MEDIA_BUCKET` to store the pieces in Google Cloud Storage; without it they go in the database. On computers, Record video uses the in-app recorder (browser encoder).

Before release, check two physical phones over Wi-Fi and cellular: answer/decline, camera flip, camera off/on, screen share, network changes, recorded video playback on the other device, and Chrome notifications with the app backgrounded. Automated tests do not measure end-to-end latency or sensor image quality.

## Organizations and channels

Open **Workspace** in the bottom navigation. Create an organization (you become its owner),
then create channels or invite teammates. A **General** channel is created automatically.
Channels use the existing messaging, file sharing, unread receipts, search, and audio/video calling.
All organization members can access every channel and its message history; private channels are not implemented.

| Role | Permissions |
|---|---|
| Owner | Create channels, invite members/admins, change roles, remove members |
| Admin | Create channels, invite members, remove members |
| Member | Read and post in channels, share files, participate in calls |

Owners can promote another member to owner. The last owner cannot leave or demote themselves.
Invitations are single-use bearer links that expire after seven days; only the token hash is stored.
Owners/admins can revoke pending invitations. Joining requires a signed-in, non-guest account.
Share invitation links only with the intended recipient; they are not bound to an email address.
Removing a member revokes all channel memberships, cancels scheduled channel messages, revokes
their outstanding invitations, and disconnects their sockets to end active access.

The database initializes four additive tables: `workspaces`, `workspace_members`,
`workspace_channels`, and `workspace_invites`. Existing direct and group chats remain available.
Buzz and Friends Map have been removed, including collectors, alerts, routes, and location sharing.
Old feed/location tables are left untouched; this release does not reclaim their existing disk space.
Chat location attachments and previews of externally shared map links remain supported.

This is an initial organization collaboration release, not Microsoft Teams feature parity.
SSO/SCIM, private channels, threaded replies, meeting scheduling, and enterprise retention policies
are not included. Messages remain encrypted at rest with a server-held key, not end-to-end encrypted.

## Deploy this repository

In an existing Cloud Shell checkout with the production `.env` configured:

```bash
git pull --ff-only origin main
gcloud config set project pingme-25461
./deploy.sh pingme asia-south1
```

For a new checkout, first clone `https://github.com/teamwaitbnb-gif/pingme.git` and configure
`.env` using the existing production database credentials and **the same `PINGME_KEY`**.
Secrets are excluded from Git and build uploads. Do not generate a replacement encryption key
for existing data. The script creates a new Cloud Run revision; check `/api/session` after deployment.
Use `MEDIA_BUCKET` for new media uploads to avoid filling MySQL with attachment data again.

## Admin portal (owner only)

Open **/admin** (e.g. `https://<your-app>/admin`) and enter `ADMIN_KEY` from `.env` (at least 16 characters). It is separate from Ping Me sign-in, so using it on a laptop never signs your phone out (one-device rule). The key sets a 30-day admin cookie; login attempts are rate-limited.

It shows: total / new users, daily / weekly / monthly active users, stickiness, who is online right now and which screen they're on, time by screen, weekly retention cohorts (day 1, week 2, month 2) for the app, devices (iPhone / Android / computer, installed app vs browser), messages and calls per day.

Privacy: only activity is recorded (screen + duration, app opens). Message text and calls are never recorded. Raw events are kept 120 days (`analytics_events`); daily summaries (`user_days`) and device type (`user_devices`) stay.

Pages (tabs at the top, or link straight to them):

| Page | Link | What it shows |
|---|---|---|
| Overview | `/admin#overview` | The summary above |
| Speed | `/admin#speed` | "Where it's slow" in plain words; every server route (requests, typical / slowest-5% / worst time, failures); realtime events; database time per query shape and slow queries (> 250 ms); server event-loop delay, CPU, memory, connections, calls; and real speed on phones (app opening time, message send time, requests over 0.7 s). Route history is saved hourly (`perf_hourly`, 90 days). |
| Errors | `/admin#errors` | Crashes on phones (`client_errors`) and errors on the server (`server_errors`), per day, with details |
| Users | `/admin#users` | Everyone, searchable: joined, last seen, messages, active days, minutes, profile photo (when uploaded), photo views, device |
| One person | `/admin#user/<id>` | Profile, privacy settings, devices and sign-ins, messages per day and per conversation (counts only), calls, time per screen, photo views, app speed, errors, and a timeline of everything they did (`activity_log`: sign-up, sign-in, photo/name/username/privacy changes, blocks, groups, calls, incognito) |
| Calls | `/admin#calls` | Calls per day, answered vs missed, talk time, how calls ended, recent calls |
| Activity | `/admin#activity` | The activity log across all accounts, filterable by kind |

Never shown, even to the admin: message text, photos/videos people send, call audio/video, passwords.

### Personal pets and PingCoins

Settings → **Pet shop** lets each account adopt a dog, cat, bunny, fox, panda,
dragon or unicorn. One selected companion follows its owner through direct and
group chats; the existing shared group pet remains separate. Personal pet state
is available only through authenticated `/api/pets/me` routes and owner-only
socket events. Names, coat colors, outfits and layered sunglasses are saved per pet.
All styles are included in the adoption price (40–180 PingCoins).

Server-observed messages to other chat members earn 2 coins, at most once per
minute. Participating in a call that lasts at least 60 seconds earns 10 coins,
at most once per ten minutes. Both share a 100-coin daily cap, resetting at
midnight UTC. System messages and call-log messages do not earn message rewards.
Coins are non-monetary. Wallet changes and purchases lock the encrypted account
row inside a database transaction; adopting an already owned pet never charges again.
The `pet_wallets` table is created by the normal database initialization on restart.

The rotate-phone cover has been removed. The manifest and supported orientation
API request portrait. Browsers that do not implement portrait locking retain a
usable single-conversation phone layout in landscape; web code cannot force an
OS orientation lock on every device. Verify both installed Android and iPhone
Safari/Home Screen modes on physical devices before releasing.
