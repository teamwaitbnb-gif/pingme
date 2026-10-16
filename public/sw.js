// Ping Me service worker: app-shell caching + app-style notifications.
const VERSION = 'pm-v43';
const SHELL = [
  '/', '/index.html', '/css/app.css', '/manifest.webmanifest',
  '/js/video-recorder.js', '/js/camera.js', '/js/editor.js', '/js/pet.js', '/js/buzz.js', '/js/analytics.js', '/js/edit-diagnostics.js', '/js/app.js', '/js/core.js', '/js/ui.js', '/js/media.js', '/js/call.js', '/js/sheets.js', '/js/auth.js',
  '/js/onboarding.js', '/js/lock.js', '/js/keys.js', '/js/secure.js', '/js/smart.js', '/js/stories.js', '/js/perm.js', '/js/install.js', '/js/qr.js',
  '/icons/icon.svg', '/icons/logo.svg', '/icons/logo-h.svg', '/icons/hand.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png', '/icons/badge-96.png',
  '/sounds/message.mp3', '/sounds/tick.wav', '/sounds/sent.wav', '/sounds/ringtone.wav', '/sounds/ringback.wav', '/sounds/join.wav', '/sounds/end.wav', '/sounds/ping.wav',
];

self.addEventListener('install', (e) => {
  // Fetch every file fresh (bypassing the browser's HTTP cache) so the saved set is one release.
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION && k !== 'pm-prefs' && k !== FACE_STORE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Never cache API / realtime traffic (private, and must be fresh).
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/') || url.pathname.startsWith('/admin')) return;

  // App files come from this version's complete saved set (installed all at once), so the page never
  // mixes old and new files — mixing caused missing icons and blank screens. A new release installs a
  // new set; the app then reloads itself onto it at a safe moment (see app.js).
  const navigate = e.request.mode === 'navigate';
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    if (!navigate) {
      const hit = await cache.match(e.request, { ignoreSearch: true });
      if (hit) return hit;
      try { const r = await fetch(e.request); if (r.ok) cache.put(e.request, r.clone()).catch(() => {}); return r; } catch { return Response.error(); }
    }
    // The page itself: fresh if the network answers within 3s, otherwise the saved copy.
    const network = fetch(e.request).then((r) => { if (r.ok && url.pathname === '/') cache.put('/index.html', r.clone()).catch(() => {}); return r; });
    const saved = await cache.match('/index.html');
    if (!saved) return network.catch(() => Response.error());
    try {
      const r = await Promise.race([network, new Promise((res) => setTimeout(() => res(null), 3000))]);
      if (r && r.ok) return r;
    } catch {}
    e.waitUntil(network.catch(() => {}));
    return saved;
  })());
});

// ───── notifications ─────
// Browsers don't allow custom sounds on system notifications (the OS plays its own), so Ping Me
// uses its own vibration patterns + grouped, actionable notifications, and plays its own sounds
// whenever the app is open.
const VIBRATE_MSG = [220, 120, 220];                 // noticeable double buzz
const VIBRATE_CALL = [900, 400, 900, 400, 900, 400, 900, 400, 900];
const VIBRATE_PING = [90, 80, 90, 80, 320];
let audioReadyAt = 0; // last time the open app said it can ring by itself
self.addEventListener('message', (e) => {
  if (e.data?.type === 'audio') audioReadyAt = e.data.ready ? Date.now() : 0;
  // The open app hands over its contacts so their faces are ready before any notification arrives.
  if (e.data?.type === 'warm-faces' && Array.isArray(e.data.people)) {
    e.waitUntil((async () => { for (const p of e.data.people.slice(0, 60)) await face(p).catch(() => {}); })());
  }
});
const canActions = typeof Notification !== 'undefined' && 'actions' in Notification.prototype;

async function hasFocusedClient() {
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  return wins.some((w) => w.visibilityState === 'visible' && w.focused);
}

// Duress mode (opened with the duress PIN): stay silent about hidden chats.
async function hiddenByDuress(chatId) {
  try {
    const r = await (await caches.open('pm-prefs')).match('/__duress');
    const v = r ? await r.json() : null;
    return !!(v?.active && v.hidden?.includes(chatId));
  } catch { return false; }
}

// ───── who sent it: their photo, or coloured initials ─────
const GRADS = [['#ff9f0a', '#ff6b00'], ['#30d158', '#0f9d58'], ['#64d2ff', '#0a84ff'], ['#bf5af2', '#7d3cf0'], ['#ff6482', '#ff2d55'], ['#5ac8fa', '#007aff'], ['#ffd60a', '#ff9f0a'], ['#66d4cf', '#30b0c7']];
const faceCache = new Map();
const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);
const canDraw = typeof OffscreenCanvas !== 'undefined';

async function toDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || 'image/png'};base64,${btoa(bin)}`;
}

async function loadBitmap(url) {
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) return null;
  return createImageBitmap(await r.blob());
}

const initials = (name = '') => name.trim().split(/\s+/).slice(0, 2).map((w) => [...w][0] || '').join('').toUpperCase() || '?';

// A round 192px face for the notification's large icon.
// Faces are kept in Cache Storage too, so after the first message the photo shows instantly —
// even on a slow network or after the phone killed the service worker.
const FACE_STORE = 'pm-faces';
async function storedFace(key) {
  try { const r = await (await caches.open(FACE_STORE)).match('/__face/' + encodeURIComponent(key)); return r ? await r.text() : null; } catch { return null; }
}
async function storeFace(key, url) {
  try { await (await caches.open(FACE_STORE)).put('/__face/' + encodeURIComponent(key), new Response(url)); } catch {}
}

async function face(from) {
  if (!from || !canDraw) return '/icons/icon-192.png';
  const key = from.avatar || 'i:' + from.id + ':' + from.name;
  if (faceCache.has(key)) return faceCache.get(key);
  const saved = await storedFace(key);
  if (saved) { faceCache.set(key, saved); return saved; }
  try {
    const S = 192, c = new OffscreenCanvas(S, S), x = c.getContext('2d');
    x.beginPath(); x.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); x.clip();
    const bmp = from.avatar ? await withTimeout(loadBitmap(from.avatar), 4000) : null;
    if (bmp) {
      const k = Math.max(S / bmp.width, S / bmp.height);
      x.drawImage(bmp, (S - bmp.width * k) / 2, (S - bmp.height * k) / 2, bmp.width * k, bmp.height * k);
    } else {
      const g = GRADS[Math.abs(Number(from.id) || 0) % GRADS.length];
      const lg = x.createLinearGradient(0, 0, 0, S); lg.addColorStop(0, g[0]); lg.addColorStop(1, g[1]);
      x.fillStyle = lg; x.fillRect(0, 0, S, S);
      x.fillStyle = '#fff'; x.font = '600 76px -apple-system, Roboto, "Segoe UI", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(initials(from.name), S / 2, S / 2 + 4);
    }
    const url = await toDataUrl(await c.convertToBlob({ type: 'image/png' }));
    if (faceCache.size > 50) faceCache.clear();
    faceCache.set(key, url);
    if (bmp || !from.avatar) storeFace(key, url); // don't save initials as a stand-in for a real photo
    return url;
  } catch { return '/icons/icon-192.png'; }
}

// Big picture for photo messages (downscaled so the notification stays light).
async function picture(url) {
  if (!url || !canDraw) return undefined;
  try {
    const bmp = await withTimeout(loadBitmap(url), 5000);
    if (!bmp) return undefined;
    const k = Math.min(1, 720 / Math.max(bmp.width, bmp.height));
    const c = new OffscreenCanvas(Math.round(bmp.width * k), Math.round(bmp.height * k));
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await toDataUrl(await c.convertToBlob({ type: 'image/jpeg', quality: 0.8 }));
  } catch { return undefined; }
}

// Serialize per chat so simultaneous pushes retain every unread line and count.
const messageQueues = new Map();
function showMessage(d) {
  const key = d.tag || 'ping-me';
  const next = (messageQueues.get(key) || Promise.resolve()).catch(() => {}).then(() => renderMessage({ ...d, tag: key }));
  messageQueues.set(key, next);
  return next.finally(() => { if (messageQueues.get(key) === next) messageQueues.delete(key); });
}

async function renderMessage(d) {
  // One notification per chat that stacks the latest lines, like a native app.
  const existing = (await self.registration.getNotifications({ tag: d.tag }))[0];
  const prev = existing?.data?.lines || [];
  const line = d.sender ? `${d.sender}: ${d.body}` : d.body;
  const lines = [...prev, line].slice(-6);
  const count = (existing?.data?.count || 0) + 1;
  const [icon, image] = await Promise.all([face(d.from), picture(d.image)]);
  existing?.close();
  const name = d.title || 'Ping Me';
  const title = count > 1 ? `${name} · ${count} new messages` : d.urgent ? `${name} · Urgent` : name;
  await self.registration.showNotification(title, {
    body: count > 1 ? lines.join('\n') : line,
    tag: d.tag,
    renotify: true,
    icon,
    image,
    badge: '/icons/badge-96.png',
    timestamp: d.ts || Date.now(),
    vibrate: d.urgent ? VIBRATE_CALL : d.ping ? VIBRATE_PING : VIBRATE_MSG,
    requireInteraction: !!d.urgent,
    silent: false,
    actions: canActions ? [{ action: 'reply', title: 'Reply' }, { action: 'read', title: 'Mark as read' }] : undefined,
    data: { url: d.url || '/', chatId: d.chatId, lines, count, type: 'msg' },
  });
}

async function showCall(d) {
  await self.registration.showNotification(d.title || 'Ping Me', {
    body: (d.video ? 'Incoming video call' : 'Incoming voice call') + (d.body && /—/.test(d.body) ? ` ${d.body.slice(d.body.indexOf('—'))}` : ''),
    tag: d.tag,
    renotify: true,
    requireInteraction: true,
    silent: false,
    icon: await face(d.from),
    badge: '/icons/badge-96.png',
    timestamp: d.ts || Date.now(),
    vibrate: VIBRATE_CALL,
    actions: canActions ? [{ action: 'answer', title: d.video ? 'Answer video' : 'Answer' }, { action: 'decline', title: 'Decline' }] : undefined,
    data: { url: d.url || '/', callId: d.callId, chatId: d.chatId, type: 'call' },
  });
}

async function updateBadge() {
  if (!('setAppBadge' in self.navigator)) return;
  const ns = await self.registration.getNotifications();
  const n = ns.reduce((s, x) => s + (x.data?.type === 'msg' ? x.data.count || 1 : 0), 0);
  if (n) self.navigator.setAppBadge(n).catch(() => {}); else self.navigator.clearAppBadge?.().catch(() => {});
}

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data.json(); } catch { d = { type: 'msg', title: 'Ping Me', body: e.data?.text() || '', tag: 'meetme' }; }
  e.waitUntil((async () => {
    if (d.type === 'call') {
      // The call is re-sent every few seconds while ringing, so the phone keeps sounding like a real call.
      // Stay quiet only when Ping Me is open on screen AND able to play its own ringtone.
      // Skip the system call notification only if the open app confirmed (within 30s) it can ring itself.
      if ((await hasFocusedClient()) && Date.now() - audioReadyAt < 30000) return;
      return showCall(d);
    }
    if (d.type === 'call-ended') {
      const ringing = (await self.registration.getNotifications({ tag: d.tag }))[0];
      ringing?.close();
      // iOS requires every push to show something; show the missed-call note (it's useful anyway).
      return self.registration.showNotification(d.title || 'Ping Me', {
        body: d.body, tag: d.tag, icon: '/icons/icon-192.png', badge: '/icons/badge-96.png', silent: true,
        data: { url: d.url || '/', chatId: d.chatId, type: 'missed' },
      });
    }
    // The open, focused app shows its own banner + Ping Me sound instead.
    if (await hasFocusedClient()) return;
    if (d.chatId && (await hiddenByDuress(d.chatId))) {
      // iOS requires every push to show something — use a generic, chat-less notice.
      return self.registration.showNotification('Ping Me', { body: 'You have a new notification', tag: 'generic', icon: '/icons/icon-192.png', silent: true });
    }
    await showMessage(d);
    await updateBadge();
  })());
});

async function openApp(url) {
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const w of wins) {
    if (new URL(w.url).origin === location.origin) {
      await w.focus();
      w.postMessage({ type: 'open', url });
      return;
    }
  }
  await self.clients.openWindow(url);
}

const apiPost = (path) => fetch(path, { method: 'POST', credentials: 'include', headers: { 'x-pingme': '1' } }).catch(() => {});

self.addEventListener('notificationclick', (e) => {
  const n = e.notification;
  const d = n.data || {};
  n.close();
  e.waitUntil((async () => {
    if (e.action === 'read' && d.chatId) { await apiPost(`/api/chats/${d.chatId}/read`); return updateBadge(); }
    if (e.action === 'decline' && d.callId) return apiPost(`/api/calls/${d.callId}/decline`);
    if (e.action === 'reply' && d.chatId) return openApp(`/?chat=${d.chatId}&reply=1`);
    if (e.action === 'answer' && d.callId) return openApp(`${d.url || '/'}${(d.url || '/').includes('?') ? '&' : '?'}answer=1`);
    await openApp(d.url || '/');
    await updateBadge();
  })());
});

// Browsers occasionally rotate push subscriptions; re-register silently so notifications keep arriving.
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil((async () => {
    try {
      const { vapidPublicKey } = await fetch('/api/config').then((r) => r.json());
      if (!vapidPublicKey) return;
      const pad = '='.repeat((4 - (vapidPublicKey.length % 4)) % 4);
      const key = Uint8Array.from(atob((vapidPublicKey + pad).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
      const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      await fetch('/api/push/subscribe', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json', 'x-pingme': '1' }, body: JSON.stringify({ subscription: sub.toJSON() }) });
    } catch {}
  })());
});

self.addEventListener('notificationclose', (e) => { e.waitUntil(updateBadge()); });
