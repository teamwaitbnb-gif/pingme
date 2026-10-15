// Ping Me service worker: app-shell caching + app-style notifications.
const VERSION = 'pm-v7';
const SHELL = [
  '/', '/index.html', '/css/app.css', '/manifest.webmanifest',
  '/js/app.js', '/js/core.js', '/js/ui.js', '/js/media.js', '/js/call.js', '/js/sheets.js', '/js/auth.js',
  '/js/onboarding.js', '/js/lock.js', '/js/keys.js', '/js/secure.js', '/js/smart.js', '/js/stories.js', '/js/perm.js',
  '/icons/icon.svg', '/icons/logo.svg', '/icons/logo-h.svg', '/icons/hand.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png', '/icons/badge-96.png',
  '/sounds/message.wav', '/sounds/tick.wav', '/sounds/sent.wav', '/sounds/ringtone.wav', '/sounds/ringback.wav', '/sounds/join.wav', '/sounds/end.wav', '/sounds/ping.wav',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION && k !== 'pm-prefs') await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Never cache API / realtime traffic (private, and must be fresh).
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) return;

  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).then((r) => {
      if (r.ok && url.pathname === '/') { const copy = r.clone(); caches.open(VERSION).then((c) => c.put('/index.html', copy)); }
      return r;
    }).catch(() => caches.match('/index.html')));
    return;
  }
  // Network-first so updates show immediately; the cache is the offline fallback.
  e.respondWith(caches.open(VERSION).then(async (c) => {
    try {
      const r = await fetch(e.request);
      if (r.ok) c.put(e.request, r.clone());
      return r;
    } catch {
      return (await c.match(e.request)) || Response.error();
    }
  }));
});

// ───── notifications ─────
// Browsers don't allow custom sounds on system notifications (the OS plays its own), so Ping Me
// uses its own vibration patterns + grouped, actionable notifications, and plays its own sounds
// whenever the app is open.
const VIBRATE_MSG = [40, 60, 40, 60, 120];
const VIBRATE_CALL = [600, 300, 600, 300, 600, 300, 600];
const VIBRATE_PING = [60, 80, 60, 80, 220];
let audioReadyAt = 0; // last time the open app said it can ring by itself
self.addEventListener('message', (e) => { if (e.data?.type === 'audio') audioReadyAt = e.data.ready ? Date.now() : 0; });
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

async function showMessage(d) {
  // Group per chat: stack the latest lines into one notification, like a native app.
  const existing = (await self.registration.getNotifications({ tag: d.tag }))[0];
  const prev = existing?.data?.lines || [];
  const line = d.sender ? `${d.sender}: ${d.body}` : d.body;
  const lines = [...prev, line].slice(-5);
  const count = (existing?.data?.count || 0) + 1;
  existing?.close();
  await self.registration.showNotification(count > 1 ? `${d.title} (${count})` : d.title, {
    body: count > 1 ? lines.join('\n') : line,
    tag: d.tag,
    renotify: true,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    timestamp: d.ts || Date.now(),
    vibrate: d.urgent ? VIBRATE_CALL : d.ping ? VIBRATE_PING : VIBRATE_MSG,
    requireInteraction: !!d.urgent,
    silent: false,
    actions: canActions ? [{ action: 'reply', title: 'Reply' }, { action: 'read', title: 'Mark as Read' }] : undefined,
    data: { url: d.url || '/', chatId: d.chatId, lines, count, type: 'msg' },
  });
}

async function showCall(d) {
  await self.registration.showNotification(d.title || 'Ping Me', {
    body: d.body || 'Incoming call',
    tag: d.tag,
    renotify: true,
    requireInteraction: true,
    silent: false,
    icon: '/icons/icon-192.png',
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
      if ((await hasFocusedClient()) && Date.now() - audioReadyAt < 10 * 60000) return;
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
    await openApp(d.url || '/');
    await updateBadge();
  })());
});

self.addEventListener('notificationclose', (e) => { e.waitUntil(updateBadge()); });
