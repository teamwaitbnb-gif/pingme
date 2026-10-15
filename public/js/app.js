import {
  h, icon, esc, avatar, toast, actionSheet, confirmDialog, closeTop, registerLayer, longPress, richText, emojiCount,
  fmtTime, fmtListTime, fmtDay, fmtDur, fmtSize, lastSeenText, isIOS, isAndroid, isMobile, isStandalone, store,
} from './ui.js';
import { compressImage, videoMeta, VoiceRecorder, player, playScreenEffect, sounds, SCREEN_EFFECTS, BUBBLE_EFFECTS } from './media.js';
import { initCalls } from './call.js';
import { showAuth as renderAuth, showChooseUsername, setSignedInHandler, showJoin } from './auth.js';
import {
  S, api, upload, emit, user, userAvatar, fileUrl, otherMember, chatTitle, chatAvatar, isMuted, isBlocked, mergeUsers, prefs, applyPrefs, feature,
} from './core.js';
import {
  openSettings, openNewMessage, openChatInfo, openViewer, openForward, openPoll, openSchedule, openScheduledList,
  openEmojiPicker, openMessageInfo, sendLocation, muteMenu, openSendOptions,
  openMessageOptions, openWhosRight, openVerifiedCamera, openSafety, openRecoveryRequests, shareWhosRight,
  openUs, openLetterComposer, openInviteLink, openUpgrade, viewLetter,
} from './sheets.js';
import { showOnboarding } from './onboarding.js';
import { lockEnabled, showLock, isHidden } from './lock.js';
import { secureText, openEyesOnly } from './secure.js';
import { scanScam, detectPromise, INTENTS } from './smart.js';
import { verifyPhoto } from './keys.js';
import { ensurePermission } from './perm.js';

const app = document.getElementById('app');
const TAPBACKS = ['❤️', '👍', '👎', '😂', '‼️', '❓'];
let deferredInstall = null;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; });

// iOS keyboard: keep the app sized to the visible viewport so the composer stays above the keyboard.
if (window.visualViewport) {
  const vv = window.visualViewport;
  const fit = () => {
    app.style.height = vv.height + 'px';
    app.style.bottom = 'auto';
    app.style.transform = vv.offsetTop ? `translateY(${vv.offsetTop}px)` : '';
    // Keyboard open → no home-indicator padding under the composer (removes the gap above the keyboard).
    document.documentElement.classList.toggle('kb-open', window.innerHeight - vv.height > 120);
    if (conv.nearBottom) scrollToBottom();
  };
  vv.addEventListener('resize', fit);
  vv.addEventListener('scroll', fit);
}

// Keep the app pinned like a native app: no page rubber-banding, no pinch / double-tap zoom.
// Only real scroll areas (lists, chats, sheets) move.
const SCROLLERS = '.msgs, .sb-list, .sheet-body, .onboard-in, .actions .grp, .ctx .menu, .tray, .people-row, .story-strip, .emoji-grid, .eo-content, textarea, .tabs, .chips, .opts-bar, .sugg-row, .stats, .gate, .auth, .vb, .st-text, .lockscreen, .wrapped';
document.addEventListener('touchmove', (e) => {
  if (e.touches.length > 1) { if (!e.target.closest('.vb')) e.preventDefault(); return; }
  if (!e.target.closest(SCROLLERS)) e.preventDefault();
}, { passive: false });
['gesturestart', 'gesturechange'].forEach((ev) => document.addEventListener(ev, (e) => { if (!e.target.closest?.('.vb')) e.preventDefault(); }, { passive: false }));

// ═══════════════════════════ boot ═══════════════════════════

async function boot() {
  applyPrefs();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  try { S.config = await api('GET', '/api/config'); } catch {}
  setSignedInHandler(startApp);
  // Results of a Google/Apple redirect sign-in come back in the URL.
  const params = new URLSearchParams(location.search);
  const authError = params.get('authError');
  const linked = params.get('linked');
  let signup = null;
  const m = /^#signup=([\w-]+)/.exec(location.hash);
  if (m) {
    try {
      const bin = atob(m[1].replace(/-/g, '+').replace(/_/g, '/'));
      signup = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
    } catch {}
  }
  if (authError || linked || m) history.replaceState(null, '', '/');
  const join = /^\/join\/([\w-]+)/.exec(location.pathname);
  if (join) return showJoin(join[1]);
  // Never nag people who already installed Ping Me (or opened it from a home-screen shortcut).
  const needGate = !isStandalone() && !store.get('installed', false) && !sessionStorage.getItem('mm:gate-skip') && !signup && !authError;
  if (needGate) await showInstallGate();
  if (signup?.ticket) return showChooseUsername(signup);
  let me = null;
  try { ({ user: me } = await api('GET', '/api/session')); } catch {}
  if (me) {
    S.me = me;
    const go = () => { startApp(); if (linked) toast('Google is now linked to your account'); };
    if (lockEnabled()) showLock(go); else go();
  } else {
    showAuth();
    if (authError) toast(authError, { error: true, timeout: 6000 });
  }
}

function showAuth(mode) {
  S.socket?.disconnect();
  S.socket = null;
  S.current = null;
  renderAuth(mode);
}

// ─────── "Add Ping Me to your Home Screen" ───────
export function showInstallGate({ force = false } = {}) {
  return new Promise((resolve) => {
    const ios = isIOS(), android = isAndroid();
    const iosSafari = ios && !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);
    const done = () => { sessionStorage.setItem('mm:gate-skip', '1'); gate.remove(); resolve(); };
    let steps;
    if (ios) {
      steps = [
        h('div', { class: 'step' }, h('span', { class: 'n' }, '1'), h('span', null, 'Tap ', icon('iosshare'), iosSafari ? ' Share in the toolbar below' : ' Share (in the address bar or ⋯ menu)')),
        h('div', { class: 'step' }, h('span', { class: 'n' }, '2'), h('span', null, 'Scroll and tap ', icon('addsq'), ' ', h('b', null, 'Add to Home Screen'))),
        h('div', { class: 'step' }, h('span', { class: 'n' }, '3'), h('span', null, 'Tap ', h('b', null, 'Add'), ', then open ', h('b', null, 'Ping Me'), ' from your Home Screen')),
      ];
    } else {
      steps = [
        h('div', { class: 'step' }, h('span', { class: 'n' }, '1'), h('span', null, 'Tap the ', icon('dotsv'), ' menu in your browser')),
        h('div', { class: 'step' }, h('span', { class: 'n' }, '2'), h('span', null, 'Tap ', h('b', null, android ? 'Install app' : 'Install Ping Me'), android ? ' — if asked, choose ' : '', android ? h('b', null, 'Install') : null, android ? ' (not “Create shortcut”)' : '')),
        h('div', { class: 'step' }, h('span', { class: 'n' }, '3'), h('span', null, 'Open ', h('b', null, 'Ping Me'), ' from your home screen')),
      ];
    }
    const installBtn = h('button', { class: 'btn', onclick: async () => {
      if (!deferredInstall) return;
      deferredInstall.prompt();
      const { outcome } = await deferredInstall.userChoice.catch(() => ({}));
      deferredInstall = null;
      if (outcome === 'accepted') { store.set('installed', true); toast('Ping Me installed! Open it from your home screen.'); done(); }
    } }, icon('download'), 'Install Ping Me');
    const gate = h('div', { class: 'gate' },
      h('img', { class: 'app-icon', src: '/icons/icon-512.png', alt: 'Ping Me' }),
      h('h1', null, 'Add Ping Me'),
      h('p', null, 'Install Ping Me on your Home Screen for the full app experience — full screen, notifications for messages and calls, and one-tap access.'),
      h('div', { class: 'steps' }, steps),
      h('div', { class: 'gate-actions' },
        deferredInstall || !ios ? installBtn : null,
        h('button', { class: 'btn secondary', onclick: done }, force ? 'Close' : 'Continue in browser')),
      iosSafari ? h('div', { class: 'arrow' }, icon('down')) : null);
    if (!deferredInstall) installBtn.hidden = true;
    addEventListener('beforeinstallprompt', () => { installBtn.hidden = false; }, { once: true });
    addEventListener('appinstalled', () => { store.set('installed', true); toast('Ping Me installed!'); done(); }, { once: true });
    document.body.append(gate);
  });
}

addEventListener('mm:unauthorized', () => { if (S.me) { S.me = null; showAuth(); } });
addEventListener('mm:me-changed', () => { if (S.me && els.meBtn) refreshMe(S.me); });

// ═══════════════════════════ main app ═══════════════════════════

const els = {};
const conv = { nearBottom: true, newBelow: 0, nodes: new Map(), chatId: null };

let globalsBound = false;
function startApp() {
  app.replaceChildren();
  S.chats.clear(); S.msgs.clear(); S.current = null;
  if (!S.me.settings?.onboarded) setTimeout(() => showOnboarding(() => { renderList(); askNotificationsOnce(true); }), 50);
  const pendingJoin = sessionStorage.getItem('pm:join');
  if (pendingJoin) {
    sessionStorage.removeItem('pm:join');
    api('POST', `/api/guest-links/${pendingJoin}/accept`, {}).then((r) => loadChats().then(() => openChat(r.chatId))).catch((e) => toast(e.message, { error: true }));
  }
  const search = h('input', { type: 'search', placeholder: 'Search', enterkeyhint: 'search', autocomplete: 'off' });
  const clearBtn = h('button', { class: 'clear', hidden: true, onclick: () => { search.value = ''; onSearch(''); } }, icon('xc'));
  els.meBtn = h('button', { class: 'me-btn', title: 'Account & settings', 'aria-label': 'Settings', onclick: () => openSettings() });
  els.list = h('div', { class: 'sb-list' });
  els.title = h('div', { class: 'sb-title' }, 'Messages');
  els.safetyBar = h('div', { class: 'safety-bar', hidden: true });
  els.sidebar = h('aside', { class: 'sidebar' },
    h('div', { class: 'sb-head' },
      h('img', { class: 'sb-logo', src: '/icons/logo-h.svg', alt: 'pingme' }),
      h('div', { class: 'spacer' }),
      h('button', { class: 'icon-btn', title: 'New message', 'aria-label': 'New message', onclick: () => openNewMessage() }, icon('compose')),
      els.meBtn),
    els.title,
    els.safetyBar,
    h('div', { class: 'sb-search' }, icon('search'), search, clearBtn),
    els.list);
  els.conv = h('section', { class: 'conv' });
  els.main = h('div', { class: 'main' }, els.sidebar, els.conv);
  app.append(els.main);
  let st;
  search.addEventListener('input', () => { clearBtn.hidden = !search.value; clearTimeout(st); st = setTimeout(() => onSearch(search.value), 150); });
  search.addEventListener('focus', () => { S.searchFocus = true; renderList(); });
  search.addEventListener('blur', () => setTimeout(() => { S.searchFocus = false; if (!search.value) renderList(); }, 200));
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter' && search.value.trim()) saveRecentSearch(search.value.trim()); });
  els.search = search;
  renderMeBtn();
  renderEmptyConv();
  connectSocket();
  S.calls = initCalls({
    socket: S.socket,
    config: () => S.config,
    me: () => S.me,
    user: (id) => S.users.get(id),
    chat: (id) => S.chats.get(id),
    chatTitle, chatAvatar, userAvatar,
  });
  loadChats().then(() => { handleUrl(); loadSafety(); checkRecovery(); if (S.me.settings?.onboarded) askNotificationsOnce(); });
  setupPush(false);
  history.replaceState({ root: true }, '');
  if (globalsBound) return;
  globalsBound = true;
  navigator.serviceWorker?.addEventListener('message', (e) => {
    if (e.data?.type === 'open' && S.me) handleUrl(new URL(e.data.url, location.origin));
  });
  addEventListener('popstate', onPopState);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.me) { markRead(); updateBadge(); clearChatNotifications(S.current); } });
  addEventListener('focus', () => S.me && markRead());
  addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (!closeTop() && S.current && innerWidth <= 760) history.back(); } });
  addEventListener('mm:unlocked', () => { if (S.current && isHidden(S.current)) closeChat(); S.msgs.clear(); loadChats().then(() => { if (S.current) loadMessages(S.current, { reset: true }); }); });
  setInterval(tickCountdowns, 1000);
}

function renderMeBtn() {
  els.meBtn.replaceChildren(avatar({ id: S.me.id, name: S.me.name, src: S.me.avatarV ? `/api/avatar/u/${S.me.id}?v=${S.me.avatarV}` : null, size: 34 }));
}

export function refreshMe(me) {
  S.me = me;
  mergeUsers([{ id: me.id, name: me.name, username: me.username, avatarV: me.avatarV, bio: me.bio }]);
  renderMeBtn();
  renderList();
  if (S.current) renderMessages();
}

async function handleUrl(url = new URL(location.href)) {
  const p = url.searchParams;
  const add = p.get('add');
  const chat = Number(p.get('chat'));
  if (p.get('recovery') || p.get('recoveryAlert')) openRecoveryRequests();
  if (p.get('new')) openNewMessage();
  if (p.get('search')) setTimeout(() => els.search?.focus(), 300);
  if (add && add !== S.me.username) {
    try {
      const { user: u } = await api('GET', '/api/users/lookup?u=' + encodeURIComponent(add));
      await startDirect(u);
    } catch (e) { toast(e.message, { error: true }); }
  } else if (chat && S.chats.has(chat)) {
    openChat(chat);
    if (p.get('reply')) setTimeout(() => els.ta?.focus(), 400);
  }
  if (url === undefined || url.href === location.href) history.replaceState(history.state, '', '/');
}

export async function startDirect(u) {
  mergeUsers([u]);
  const { chat, users } = await api('POST', '/api/chats', { type: 'direct', userId: u.id });
  mergeUsers(users);
  S.chats.set(chat.id, chat);
  renderList();
  openChat(chat.id);
}

// ─────── socket ───────

function connectSocket() {
  const socket = io({ transports: ['websocket', 'polling'], withCredentials: true });
  S.socket = socket;
  let wasConnected = false;
  socket.on('connect', () => {
    if (wasConnected) resync();
    wasConnected = true;
  });
  socket.on('connect_error', (e) => { if (e.message === 'unauthorized') { S.me = null; showAuth(); } });
  socket.on('msg:new', onNewMessage);
  socket.on('msg:update', (m) => { upsertMessage(m); updateChatPreview(m.chatId, m); });
  socket.on('msg:remove', ({ chatId, id }) => {
    const st = S.msgs.get(chatId);
    if (st) { st.list = st.list.filter((m) => m.id !== id); if (S.current === chatId) renderMessages(); }
    const c = S.chats.get(chatId);
    if (c?.lastMessage?.id === id) refreshChat(chatId);
  });
  socket.on('msg:reactions', ({ chatId, id, reactions, by, emoji }) => {
    const st = S.msgs.get(chatId);
    const m = st?.list.find((x) => x.id === id);
    if (m) { m.reactions = reactions; if (S.current === chatId) renderMessages(); }
    if (by !== S.me.id && emoji && m?.senderId === S.me.id && S.current !== chatId && !isMuted(S.chats.get(chatId))) {
      toast(null, { node: h('div', { class: 'row' }, h('span', { style: { fontSize: '22px' } }, emoji), h('span', null, `${user(by).name} reacted to your message`)), onClick: () => openChat(chatId) });
    }
  });
  socket.on('receipt', ({ chatId, userId, lastRead, lastDelivered }) => {
    const c = S.chats.get(chatId);
    if (!c) return;
    const m = c.members.find((x) => x.id === userId);
    if (m) {
      if (lastRead) m.lastRead = Math.max(m.lastRead, lastRead);
      if (lastDelivered) m.lastDelivered = Math.max(m.lastDelivered, lastDelivered);
    }
    if (userId === S.me.id && lastRead && c.lastMessage && lastRead >= c.lastMessage.id) { c.unread = 0; renderList(); updateBadge(); }
    if (S.current === chatId) renderMessages();
  });
  socket.on('typing', ({ chatId, userId, on }) => setTyping(chatId, userId, on));
  socket.on('presence', ({ userId, online, lastSeen }) => {
    const u = S.users.get(userId);
    if (!u) return;
    u.online = online; u.lastSeen = lastSeen;
    renderList();
    if (S.current && otherMember(S.chats.get(S.current)) === userId) renderHeader();
  });
  socket.on('user:update', (u) => {
    mergeUsers([u]);
    if (u.id === S.me.id) { S.me = { ...S.me, name: u.name, bio: u.bio, avatarV: u.avatarV }; renderMeBtn(); }
    renderList();
    if (S.current) { renderHeader(); renderMessages(); }
  });
  socket.on('chat:changed', ({ chatId }) => refreshChat(chatId));
  socket.on('scheduled:sent', ({ chatId }) => loadScheduled(chatId));
  socket.on('us:changed', ({ chatId }) => { if (S.current === chatId) renderUsBar(); });
  socket.on('msg:expiry', ({ chatId, id, expiresAt }) => {
    const m = S.msgs.get(chatId)?.list.find((x) => x.id === id);
    if (m) { m.expiresAt = expiresAt; if (S.current === chatId) renderMessages(); }
  });
  socket.on('reminder', (r) => showReminder(r));
  socket.on('checkin:fired', () => { S.checkin = null; renderSafetyBar(); toast('Your safety check-in time passed — your chat was alerted.', { error: true, timeout: 6000 }); });
  socket.on('recovery:request', () => {
    sounds.message();
    toast('A friend needs help recovering their account — tap to review', { onClick: openRecoveryRequests, timeout: 8000 });
  });
  socket.on('recovery:alert', () => openRecoveryRequests({ alert: true }));
}

async function resync() {
  await loadChats();
  const id = S.current;
  if (!id) return;
  const st = S.msgs.get(id);
  if (!st || st.gapAfter) return loadMessages(id, { reset: true });
  const last = [...st.list].reverse().find((m) => typeof m.id === 'number');
  if (last) {
    try {
      const { messages } = await api('GET', `/api/chats/${id}/messages?after=${last.id}&limit=100`);
      messages.forEach((m) => upsertMessage(m, false));
      renderMessages();
      markRead();
    } catch {}
  }
}

// ─────── chats ───────

async function loadChats() {
  try {
    const { chats, users, blocked } = await api('GET', '/api/chats');
    mergeUsers(users);
    S.blocked = new Set(blocked);
    const keep = new Set(chats.map((c) => c.id));
    for (const id of S.chats.keys()) if (!keep.has(id)) S.chats.delete(id);
    for (const c of chats) S.chats.set(c.id, c);
    renderList();
    updateBadge();
    if (S.current && !S.chats.has(S.current)) closeChat();
    else if (S.current) renderHeader();
  } catch (e) { if (e.status !== 401) toast(e.message, { error: true }); }
}

export async function refreshChat(chatId) {
  try {
    const { chat, users } = await api('GET', `/api/chats/${chatId}`);
    mergeUsers(users);
    S.chats.set(chat.id, chat);
    if (S.current === chatId) { renderHeader(); renderComposerState(); renderMessages(); }
  } catch (e) {
    if (e.status === 403 || e.status === 404) {
      S.chats.delete(chatId);
      S.msgs.delete(chatId);
      if (S.current === chatId) closeChat();
    }
  }
  renderList();
  updateBadge();
}

function sortedChats() {
  return [...S.chats.values()].filter((c) => !isHidden(c.id)).sort((a, b) => (b.lastMessage?.createdAt || b.lastMsgAt) - (a.lastMessage?.createdAt || a.lastMsgAt));
}

function updateBadge() {
  const n = [...S.chats.values()].reduce((s, c) => s + (isMuted(c) || isHidden(c.id) ? 0 : c.unread || 0), 0);
  try { if (n) navigator.setAppBadge?.(n); else navigator.clearAppBadge?.(); } catch {}
  document.title = n ? `(${n}) Ping Me` : 'Ping Me';
  return n;
}

function chatPreview(c) {
  const typers = [...(S.typing.get(c.id)?.keys() || [])];
  if (typers.length) return h('span', { class: 'typing-dots' }, h('i'), h('i'), h('i'));
  const m = c.lastMessage;
  if (!m) return c.type === 'group' ? 'Group created' : 'Say hi';
  if (m.kind === 'system') return systemText(m, c);
  let p = m.effect === 'ink' && !m.deleted ? 'Invisible Ink' : m.preview || '';
  if (m.deleted) p = 'Message unsent';
  const who = m.kind === 'call' ? '' : m.senderId === S.me.id ? 'You: ' : c.type === 'group' ? user(m.senderId).name.split(' ')[0] + ': ' : '';
  const ic = m.deleted ? null : m.eyes ? 'eye' : m.secure ? 'shield' : m.sos ? 'lifebuoy'
    : { image: 'camera', video: 'video', audio: 'mic', file: 'file', location: 'map', poll: 'poll', call: m.call?.video ? 'video' : 'phone' }[m.kind];
  return h('span', { class: 'pv' }, who, ic ? icon(ic, 'pv-ic') : null, p);
}

export function renderList() {
  if (!els.list) return;
  const q = S.search.trim().toLowerCase();
  const all = sortedChats();
  const frag = [];
  const archivedCount = all.filter((c) => c.archived).length;
  els.title.textContent = S.showArchived ? 'Archived' : '';
  els.title.hidden = !S.showArchived;

  if (q) {
    frag.push(searchSuggestions(q, all));
    const matches = all.filter((c) => chatTitle(c).toLowerCase().includes(q) || c.members.some((m) => (user(m.id).username || '').includes(q.replace(/^@/, ''))));
    if (matches.length) frag.push(h('div', { class: 'section-label' }, 'Conversations'), matches.map(chatRow));
    if (els.searchResults?.q === q && els.searchResults.items.length) {
      frag.push(h('div', { class: 'section-label' }, 'Messages'));
      for (const r of els.searchResults.items) {
        const c = S.chats.get(r.chatId);
        if (!c) continue;
        const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig');
        frag.push(h('div', { class: 'result-item', onclick: () => openChat(r.chatId, { around: r.id }) },
          h('div', { class: 't' }, h('b', null, chatTitle(c)), h('span', null, fmtListTime(r.createdAt))),
          h('div', { html: esc((r.senderId === S.me.id ? 'You: ' : c.type === 'group' ? user(r.senderId).name + ': ' : '') + r.preview).replace(re, '<mark>$1</mark>') })));
      }
    }
    if (frag.length === 1 && !frag[0].childElementCount) frag.push(h('div', { class: 'empty-list' }, icon('search'), `No results for “${S.search}”`));
    els.list.replaceChildren(...frag.flat());
    return;
  }
  if (S.searchFocus && !S.showArchived) frag.push(searchStarters(all));

  if (S.showArchived) {
    frag.push(h('button', { class: 'cell accent', onclick: () => { S.showArchived = false; renderList(); } }, icon('back'), h('span', { class: 'lb' }, 'Back to Messages')));
    const arch = all.filter((c) => c.archived);
    frag.push(arch.length ? arch.map(chatRow) : h('div', { class: 'empty-list' }, 'No archived conversations'));
    els.list.replaceChildren(...frag.flat());
    return;
  }

  if (S.config.vapidPublicKey && 'Notification' in window && Notification.permission === 'default' && !store.get('pushBannerDismissed') && (isStandalone() || !isIOS())) {
    frag.push(h('div', { class: 'sb-banner' }, icon('bell'),
      h('div', { class: 'spacer', style: { cursor: 'pointer' }, onclick: () => setupPush(true) }, h('b', null, 'Turn on notifications'), 'Get alerted for new messages and calls.'),
      h('button', { class: 'x', 'aria-label': 'Dismiss', onclick: () => { store.set('pushBannerDismissed', true); renderList(); } }, icon('x'))));
  }

  if (S.me.settings?.guest) {
    frag.push(h('button', { class: 'guest-card', onclick: openUpgrade },
      h('img', { src: '/icons/hand.svg', alt: '' }),
      h('div', null, h('b', null, 'Save your Ping Me account'), h('span', null, 'Keep your chats on every device and get the app.')),
      icon('chev')));
  }
  const visible = all.filter((c) => !c.archived);
  const pinned = visible.filter((c) => c.pinned);
  const rest = visible.filter((c) => !c.pinned);
  if (pinned.length) frag.push(h('div', { class: 'pins' }, pinned.map(pinTile)));
  if (archivedCount) {
    frag.push(h('button', { class: 'cell', onclick: () => { S.showArchived = true; renderList(); } },
      h('span', { class: 'ci', style: { background: '#8e8e93' } }, icon('archive')), h('span', { class: 'lb' }, 'Archived'), h('span', { class: 'val' }, String(archivedCount), icon('chev'))));
  }
  frag.push(rest.map(chatRow));
  if (!visible.length) {
    frag.push(h('div', { class: 'empty-list' }, icon('msg'), h('div', null, h('b', null, 'No messages yet')),
      h('div', null, 'Message someone by username, or send a link — they can reply without installing anything.'),
      h('button', { class: 'btn invite-btn', onclick: () => openInviteLink() }, icon('link'), 'Invite with a link')));
  }
  els.list.replaceChildren(...frag.flat());
}

function chatRow(c) {
  const other = otherMember(c);
  const u = other ? S.users.get(other) : null;
  const row = h('div', { class: 'chat-item' + (S.current === c.id ? ' active' : ''), onclick: () => openChat(c.id) },
    h('span', { class: 'ub-dot' + (c.unread && !isMuted(c) ? '' : ' none') }),
    avatar({ id: c.type === 'group' ? c.id : other, name: chatTitle(c), src: chatAvatar(c), size: 50, online: u?.online, group: c.type === 'group' }),
    h('div', { class: 'body' },
      h('div', { class: 'top' },
        h('span', { class: 'name' }, chatTitle(c), u?.birthdayToday ? icon('gift', 'bday') : null, c.streak >= 2 && feature('usSpace') ? h('span', { class: 'streak', title: `${c.streak}-day streak` }, icon('fire'), c.streak) : null),
        h('span', { class: 'time' }, isMuted(c) ? icon('belloff') : null, c.lastMessage ? fmtListTime(c.lastMessage.createdAt) : '', c.unread ? h('span', { class: 'badge', style: isMuted(c) ? { background: 'var(--text3)' } : null }, c.unread > 99 ? '99+' : c.unread) : null)),
      h('div', { class: 'prev' }, chatPreview(c))));
  longPress(row, () => chatMenu(c));
  return row;
}

function pinTile(c) {
  const other = otherMember(c);
  const typing = S.typing.get(c.id)?.size;
  const el = h('div', { class: 'pin' + (S.current === c.id ? ' active' : ''), onclick: () => openChat(c.id) },
    avatar({ id: c.type === 'group' ? c.id : other, name: chatTitle(c), src: chatAvatar(c), size: 72, group: c.type === 'group' }),
    c.unread && !isMuted(c) ? h('span', { class: 'ub' }) : null,
    typing ? h('span', { class: 'typing-bubble' }, h('i'), h('i'), h('i')) : null,
    h('span', { class: 'nm' }, chatTitle(c)));
  longPress(el, () => chatMenu(c));
  return el;
}

async function chatMenu(c) {
  const r = await actionSheet({
    title: chatTitle(c),
    align: 'left',
    actions: [
      { label: c.pinned ? 'Unpin' : 'Pin', icon: 'pin', value: 'pin' },
      { label: c.unread ? 'Mark as Read' : 'Mark as Unread', icon: 'unread', value: 'read' },
      { label: isMuted(c) ? 'Unmute' : 'Mute', icon: isMuted(c) ? 'bell' : 'belloff', value: 'mute' },
      { label: c.archived ? 'Unarchive' : 'Archive', icon: 'archive', value: 'archive' },
      { label: 'Delete Conversation', icon: 'trash', value: 'delete', danger: true },
    ],
  });
  if (!r) return;
  try {
    if (r === 'pin') { c.pinned = !c.pinned; await api('PATCH', `/api/chats/${c.id}/prefs`, { pinned: c.pinned }); }
    if (r === 'read') {
      if (c.unread) { if (c.lastMessage) S.socket.emit('chat:read', { chatId: c.id, messageId: c.lastMessage.id }); c.unread = 0; }
      else { await api('POST', `/api/chats/${c.id}/unread`); c.unread = 1; }
    }
    if (r === 'mute') await muteMenu(c);
    if (r === 'archive') { c.archived = !c.archived; await api('PATCH', `/api/chats/${c.id}/prefs`, { archived: c.archived }); if (c.archived && S.current === c.id) closeChat(); }
    if (r === 'delete') await deleteConversation(c);
  } catch (e) { toast(e.message, { error: true }); }
  renderList();
  updateBadge();
}

export async function deleteConversation(c) {
  const ok = await confirmDialog(c.type === 'group' ? 'Delete this conversation and leave the group?' : 'Delete this conversation? It will be removed from your devices.', { ok: 'Delete', danger: true });
  if (!ok) return;
  await api('DELETE', `/api/chats/${c.id}`);
  S.msgs.delete(c.id);
  if (S.current === c.id) closeChat();
  if (c.type === 'group') S.chats.delete(c.id); else { c.archived = true; c.lastMessage = null; c.unread = 0; }
  renderList();
}

// ─────── search suggestions ───────
// As you type: word completions (from your chats, names and recent searches), matching people,
// a "Find @username" shortcut, then conversations and message results.

const recentSearches = () => store.get('recentSearches', []);
function saveRecentSearch(q) {
  store.set('recentSearches', [q, ...recentSearches().filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 8));
}
function setSearch(v) {
  els.search.value = v;
  els.search.focus();
  onSearch(v);
}

function vocabulary() {
  const freq = new Map();
  const add = (w, n = 1) => { const k = w.toLowerCase(); if (k.length >= 3) freq.set(k, (freq.get(k) || 0) + n); };
  for (const r of recentSearches()) add(r, 6);
  for (const c of S.chats.values()) { for (const w of chatTitle(c).split(/\s+/)) add(w, 4); }
  for (const u of S.users.values()) { if (u.username) add('@' + u.username, 3); for (const w of (u.name || '').split(/\s+/)) add(w, 3); }
  for (const st of S.msgs.values()) for (const m of st.list.slice(-400)) {
    if (m.secure || m.eyes || !m.text) continue;
    for (const w of m.text.match(/[\p{L}\p{N}@][\p{L}\p{N}._-]{2,24}/gu) || []) add(w);
  }
  for (const r of els.searchResults?.items || []) for (const w of (r.preview || '').match(/[\p{L}\p{N}][\p{L}\p{N}._-]{2,24}/gu) || []) add(w);
  return freq;
}

function searchSuggestions(q, chats) {
  const box = h('div', { class: 'suggest' });
  const completions = [...vocabulary()].filter(([w]) => w.startsWith(q) && w !== q).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([w]) => w);
  if (completions.length) {
    box.append(h('div', { class: 'sugg-row' }, completions.map((w) => h('button', { class: 'sugg-chip', onclick: () => setSearch(w) }, icon('search'), h('span', null, h('b', null, w.slice(0, q.length)), w.slice(q.length))))));
  }
  const uq = q.replace(/^@/, '');
  const people = [...S.users.values()].filter((u) => u.id !== S.me.id && !u.deleted && ((u.username || '').startsWith(uq) || (u.name || '').toLowerCase().split(/\s+/).some((p) => p.startsWith(uq)))).slice(0, 5);
  if (people.length) {
    box.append(h('div', { class: 'section-label' }, 'People'), h('div', { class: 'people-row' }, people.map((u) => h('button', { class: 'person', onclick: () => { saveRecentSearch(u.name); startDirect(u).catch((e) => toast(e.message, { error: true })); } },
      avatar({ id: u.id, name: u.name, src: userAvatar(u.id), size: 52, online: u.online }), h('span', null, u.name.split(' ')[0])))));
  }
  if (/^@?[a-z][a-z0-9._]{2,23}$/.test(q) && !people.some((u) => u.username === uq)) {
    box.append(h('button', { class: 'cell find-user', onclick: async () => {
      try { const { user: u } = await api('GET', '/api/users/lookup?u=' + encodeURIComponent(uq)); saveRecentSearch('@' + u.username); await startDirect(u); }
      catch (e) { toast(e.message, { error: true }); }
    } }, h('span', { class: 'ci' }, icon('useradd')), h('span', { class: 'lb' }, `Find @${uq}`, h('small', null, 'Start a conversation by username')), icon('chev')));
  }
  return box;
}

function searchStarters(chats) {
  const recent = recentSearches();
  const frequent = chats.filter((c) => c.type === 'direct' && otherMember(c)).slice(0, 6);
  const box = h('div', { class: 'suggest' });
  if (recent.length) {
    box.append(h('div', { class: 'section-label row' }, 'Recent', h('span', { class: 'spacer' }), h('button', { class: 'link small', onmousedown: (e) => e.preventDefault(), onclick: () => { store.del('recentSearches'); renderList(); } }, 'Clear')),
      h('div', { class: 'sugg-row' }, recent.map((r) => h('button', { class: 'sugg-chip', onmousedown: (e) => e.preventDefault(), onclick: () => setSearch(r) }, icon('clock'), r))));
  }
  if (frequent.length) {
    box.append(h('div', { class: 'section-label' }, 'Suggested'), h('div', { class: 'people-row' }, frequent.map((c) => {
      const u = user(otherMember(c));
      return h('button', { class: 'person', onmousedown: (e) => e.preventDefault(), onclick: () => openChat(c.id) }, avatar({ id: u.id, name: u.name, src: userAvatar(u.id), size: 52, online: u.online }), h('span', null, u.name.split(' ')[0]));
    })));
  }
  if (!recent.length) box.append(h('div', { class: 'sugg-hint' }, 'Search names, @usernames, words in messages, or links.'));
  return box;
}

async function onSearch(v) {
  S.search = v;
  renderList();
  const q = v.trim().toLowerCase();
  if (q.length < 2) { els.searchResults = null; return; }
  try {
    const { results } = await api('GET', '/api/search?q=' + encodeURIComponent(q));
    if (S.search.trim().toLowerCase() !== q) return;
    els.searchResults = { q, items: results };
    renderList();
  } catch {}
}

// ═══════════════════════════ conversation ═══════════════════════════

function renderEmptyConv() {
  els.conv.replaceChildren(h('div', { class: 'empty-conv' }, h('div', null, icon('msg'), h('div', null, 'Select a conversation'))));
}

export function openChat(id, { around = null, push = true } = {}) {
  const chat = S.chats.get(id);
  if (!chat || isHidden(id)) return;
  closeTop();
  const switching = S.current !== id;
  if (switching) saveDraft();
  S.current = id;
  if (chat.archived && !around) chat.archived = false;
  if (push && innerWidth <= 760 && !history.state?.chat) history.pushState({ chat: id }, '');
  els.main.classList.add('show-conv');
  if (switching || !els.msgs) buildConv(chat);
  renderList();
  const st = S.msgs.get(id);
  if (around) {
    if (st?.list.some((m) => m.id === around)) { renderMessages(); flashMessage(around); }
    else loadMessages(id, { around });
  } else if (!st || !st.loaded) loadMessages(id, { reset: true });
  else { renderMessages(); scrollToBottom(); markRead(); }
  loadScheduled(id);
  clearChatNotifications(id);
}

export function closeChat() {
  saveDraft();
  S.current = null;
  els.main?.classList.remove('show-conv');
  setTimeout(() => { if (!S.current) { els.msgs = null; renderEmptyConv(); } }, innerWidth <= 760 ? 340 : 0);
  renderList();
}

function onPopState(e) {
  if (closeTop()) {
    if (S.current && innerWidth <= 760) history.pushState({ chat: S.current }, '');
    return;
  }
  if (S.current && !e.state?.chat) closeChat();
}

function buildConv(chat) {
  conv.nodes.clear();
  conv.chatId = chat.id;
  conv.nearBottom = true;
  conv.newBelow = 0;
  conv.reply = null;
  conv.editing = null;
  conv.tray = [];
  conv.sendAt = null;
  conv.opts = { intent: null, secure: false, eyes: false, vanish: false };
  els.head = h('header', { class: 'cv-head' });
  els.usBar = h('button', { class: 'us-bar', hidden: true, onclick: () => openUs(S.chats.get(S.current), renderUsBar) });
  els.pinBar = h('div', { class: 'pinned-bar', hidden: true });
  els.msgs = h('div', { class: 'msgs', role: 'log', 'aria-live': 'polite' });
  els.typingRow = h('div', { class: 'typing-row', hidden: true });
  els.jump = h('button', { class: 'jump-btn', hidden: true, 'aria-label': 'Scroll to latest', onclick: () => { const st = S.msgs.get(S.current); if (st?.gapAfter) loadMessages(S.current, { reset: true }); else scrollToBottom(true); } }, icon('down'));
  els.composerWrap = h('div', { class: 'composer-wrap' });
  els.conv.replaceChildren(els.head, els.usBar, els.pinBar, els.msgs, els.typingRow, els.jump, els.composerWrap);
  els.msgs.addEventListener('scroll', onScroll, { passive: true });
  setupDrop();
  renderHeader();
  renderUsBar();
  renderComposer();
  renderTyping();
}

export function renderHeader() {
  const chat = S.chats.get(S.current);
  if (!chat || !els.head) return;
  const other = otherMember(chat);
  const u = other ? user(other) : null;
  const typers = [...(S.typing.get(chat.id)?.keys() || [])];
  let status = '', on = false;
  if (typers.length) status = chat.type === 'group' ? `${typers.map((t) => user(t).name.split(' ')[0]).join(', ')} typing…` : 'typing…';
  else if (chat.type === 'group') status = `${chat.members.length} members`;
  else if (u) { status = lastSeenText(u) || (u.username ? '@' + u.username : ''); on = !!u.online; }
  if (u?.deleted) status = 'Account deleted';
  const unreadElsewhere = [...S.chats.values()].reduce((s, c) => s + (c.id !== chat.id && !isMuted(c) ? c.unread || 0 : 0), 0);
  els.head.replaceChildren(
    h('button', { class: 'back', 'aria-label': 'Back', onclick: () => (history.state?.chat ? history.back() : closeChat()) }, icon('back'), unreadElsewhere ? h('span', { class: 'badge' }, unreadElsewhere) : null),
    h('div', { class: 'cv-who', onclick: () => openChatInfo(chat.id) },
      avatar({ id: chat.type === 'group' ? chat.id : other, name: chatTitle(chat), src: chatAvatar(chat), size: 38, online: on, group: chat.type === 'group' }),
      h('div', { class: 'txt' },
        h('div', { class: 'nm' }, chatTitle(chat), isMuted(chat) ? icon('belloff') : null, chat.disappearSecs ? icon('timer') : null, icon('chev')),
        h('div', { class: 'st' + (on && !typers.length ? ' on' : '') }, status))),
    chat.type === 'direct' && feature('ping') && !isBlocked(chat) && !u?.deleted ? h('button', { class: 'icon-btn ping-btn', title: 'Send a Ping — thinking of you', 'aria-label': 'Send a Ping', onclick: () => sendPing(chat) }, h('img', { src: '/icons/hand.svg', alt: '' })) : null,
    isBlocked(chat) || u?.deleted ? null : h('button', { class: 'icon-btn', title: 'Audio call', 'aria-label': 'Audio call', onclick: () => S.calls.start(chat.id, false) }, icon('phone')),
    isBlocked(chat) || u?.deleted ? null : h('button', { class: 'icon-btn', title: 'Video call', 'aria-label': 'Video call', onclick: () => S.calls.start(chat.id, true) }, icon('video')));
  renderPinnedBar();
}

function renderPinnedBar() {
  const st = S.msgs.get(S.current);
  const pinned = st?.list.filter((m) => m.pinned && !m.deleted) || [];
  if (!pinned.length) { els.pinBar.hidden = true; return; }
  const last = pinned[pinned.length - 1];
  els.pinBar.hidden = false;
  els.pinBar.replaceChildren(h('span', { class: 'bar' }), icon('pin'),
    h('div', { class: 't' }, h('b', null, pinned.length > 1 ? `${pinned.length} pinned messages` : 'Pinned message'), last.preview || ''));
  els.pinBar.onclick = () => {
    const i = Number(els.pinBar.dataset.i || 0) % pinned.length;
    els.pinBar.dataset.i = i + 1;
    jumpTo(pinned[pinned.length - 1 - i].id);
  };
}

async function loadMessages(chatId, { reset = false, around = null, older = false } = {}) {
  let st = S.msgs.get(chatId);
  if (!st || reset || around) { st = { list: st && !reset && !around ? st.list : [], hasMore: true, loading: false, gapAfter: false, loaded: false }; S.msgs.set(chatId, st); }
  if (st.loading) return;
  st.loading = true;
  if (!st.list.length && S.current === chatId) els.msgs.replaceChildren(h('div', { class: 'loader' }, h('div', { class: 'spinner' })));
  try {
    let url = `/api/chats/${chatId}/messages?limit=60`;
    if (around) url += `&around=${around}`;
    else if (older) { const first = st.list.find((m) => typeof m.id === 'number'); if (first) url += `&before=${first.id}`; }
    const { messages, hasMore } = await api('GET', url);
    if (around) { st.list = messages; st.hasMore = true; st.gapAfter = true; conv.nodes.clear(); }
    else if (older) { st.list = [...messages, ...st.list]; st.hasMore = hasMore; }
    else { st.list = [...messages, ...st.list.filter((m) => m.pending)]; st.hasMore = hasMore; st.gapAfter = false; conv.nodes.clear(); }
    st.loaded = true;
    if (around && messages.length && messages[messages.length - 1].id === S.chats.get(chatId)?.lastMessage?.id) st.gapAfter = false;
  } catch (e) { toast(e.message, { error: true }); }
  st.loading = false;
  if (S.current !== chatId) return;
  if (older) {
    const prevH = els.msgs.scrollHeight, prevTop = els.msgs.scrollTop;
    renderMessages();
    els.msgs.scrollTop = prevTop + (els.msgs.scrollHeight - prevH);
  } else {
    if (els.msgs.querySelector('.loader')) els.msgs.replaceChildren();
    renderMessages();
    if (around) flashMessage(around); else scrollToBottom();
    markRead();
  }
  renderPinnedBar();
}

function onScroll() {
  const el = els.msgs;
  const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
  conv.nearBottom = dist < 120;
  if (conv.nearBottom) { conv.newBelow = 0; markRead(); }
  els.jump.hidden = dist < 400 && !S.msgs.get(S.current)?.gapAfter;
  els.jump.replaceChildren(icon('down'), conv.newBelow ? h('span', { class: 'badge' }, conv.newBelow) : null);
  const st = S.msgs.get(S.current);
  if (st && el.scrollTop < 300 && st.hasMore && !st.loading && st.loaded) loadMessages(S.current, { older: true });
  if (st?.gapAfter && dist < 200 && !st.loading) loadNewer(S.current);
}

async function loadNewer(chatId) {
  const st = S.msgs.get(chatId);
  const last = [...st.list].reverse().find((m) => typeof m.id === 'number');
  if (!last) return;
  st.loading = true;
  try {
    const { messages } = await api('GET', `/api/chats/${chatId}/messages?after=${last.id}&limit=60`);
    st.list.push(...messages.filter((m) => !st.list.some((x) => x.id === m.id)));
    if (messages.length < 60) st.gapAfter = false;
  } catch {}
  st.loading = false;
  if (S.current === chatId) renderMessages();
}

export function scrollToBottom(smooth = false) {
  if (!els.msgs) return;
  requestAnimationFrame(() => {
    els.msgs.scrollTo({ top: els.msgs.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    conv.nearBottom = true; conv.newBelow = 0;
    if (els.jump) els.jump.hidden = true;
  });
}

export function jumpTo(id) {
  const st = S.msgs.get(S.current);
  if (st?.list.some((m) => m.id === id)) flashMessage(id);
  else loadMessages(S.current, { around: id });
}

function flashMessage(id) {
  requestAnimationFrame(() => {
    const el = els.msgs?.querySelector(`.m[data-id="${id}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  });
}

export function markRead() {
  const id = S.current;
  if (!id || document.hidden || !conv.nearBottom) return;
  const chat = S.chats.get(id);
  const st = S.msgs.get(id);
  if (!chat || !st || st.gapAfter) return;
  const last = [...st.list].reverse().find((m) => typeof m.id === 'number');
  const me = chat.members.find((m) => m.id === S.me.id);
  if (last && me && last.id > me.lastRead) {
    me.lastRead = last.id;
    S.socket.emit('chat:read', { chatId: id, messageId: last.id });
  }
  if (chat.unread) { chat.unread = 0; renderList(); updateBadge(); }
}

// ─────── typing ───────

function setTyping(chatId, userId, on) {
  if (!S.typing.has(chatId)) S.typing.set(chatId, new Map());
  const m = S.typing.get(chatId);
  clearTimeout(m.get(userId));
  if (on) m.set(userId, setTimeout(() => setTyping(chatId, userId, false), 6000));
  else m.delete(userId);
  renderList();
  if (S.current === chatId) { renderHeader(); renderTyping(); }
}

function renderTyping() {
  const typers = [...(S.typing.get(S.current)?.keys() || [])];
  els.typingRow.hidden = !typers.length;
  if (!typers.length) return;
  const chat = S.chats.get(S.current);
  els.typingRow.replaceChildren(h('span', { class: 'typing-bubble' }, h('i'), h('i'), h('i')),
    chat?.type === 'group' ? typers.map((t) => user(t).name.split(' ')[0]).join(', ') : '');
  if (conv.nearBottom) scrollToBottom();
}

// ─────── messages ───────

async function onNewMessage(m) {
  if (isHidden(m.chatId)) return;
  let chat = S.chats.get(m.chatId);
  let fresh = false;
  if (!chat) {
    await refreshChat(m.chatId);
    chat = S.chats.get(m.chatId);
    fresh = true; // server already counted this message as unread
  }
  const mine = m.senderId === S.me.id;
  const st = S.msgs.get(m.chatId);
  if (st && st.loaded && !st.gapAfter) upsertMessage(m, false);
  if (chat) {
    chat.lastMessage = m;
    chat.lastMsgAt = m.createdAt;
    if (chat.archived && m.kind !== 'system') chat.archived = false;
    const viewing = S.current === m.chatId && !document.hidden && conv.nearBottom;
    if (!mine && m.kind !== 'system' && !viewing && !fresh) chat.unread = (chat.unread || 0) + 1;
    if (m.kind !== 'system' && m.kind !== 'call' && chat.type === 'direct' && S.current === m.chatId) setTimeout(renderUsBar, 300);
    if (!mine) setTyping(m.chatId, m.senderId, false);
  }
  if (S.current === m.chatId) {
    const atBottom = conv.nearBottom;
    renderMessages();
    if (atBottom || mine) scrollToBottom(true);
    else { conv.newBelow++; els.jump.hidden = false; onScroll(); }
    markRead();
    if (!mine && SCREEN_EFFECTS[m.effect] && !document.hidden) playScreenEffect(m.effect);
    if (mine && SCREEN_EFFECTS[m.effect]) playScreenEffect(m.effect);
  }
  if (!mine && m.kind === 'ping' && !document.hidden) { sounds.ping(); playPingEffect(); }
  if (!mine && m.kind === 'letter' && S.current === m.chatId) renderUsBar();
  if (!mine && m.kind !== 'system' && chat && !isMuted(chat) && !m.silent && !document.hidden) {
    const inThisChat = S.current === m.chatId;
    if (prefs().sounds && m.kind !== 'ping') inThisChat ? sounds.tick() : sounds.message();
    if (!inThisChat) showBanner(chat, m);
  }
  renderList();
  updateBadge();
}

function updateChatPreview(chatId, m) {
  const c = S.chats.get(chatId);
  if (c?.lastMessage?.id === m.id) { c.lastMessage = { ...c.lastMessage, ...m }; renderList(); }
}

export function upsertMessage(m, render = true) {
  const st = S.msgs.get(m.chatId);
  if (!st) return;
  let i = st.list.findIndex((x) => x.id === m.id || (m.clientId && x.clientId === m.clientId));
  if (i >= 0) {
    const old = st.list[i];
    if (old.att && old.localUrl && m.att) S.localMedia.set(m.att.id, old.localUrl);
    st.list[i] = { ...m, clientId: undefined };
  } else {
    // insert in id order (pending items stay at the end)
    let j = st.list.length;
    while (j > 0 && (st.list[j - 1].pending || (typeof st.list[j - 1].id === 'number' && st.list[j - 1].id > m.id))) j--;
    st.list.splice(j, 0, m);
  }
  if (render && S.current === m.chatId) renderMessages();
}

function systemText(m, chat) {
  const s = m.sys || {};
  const who = m.senderId === S.me.id ? 'You' : user(m.senderId).name;
  const names = (ids) => (ids || []).map((id) => (id === S.me.id ? 'you' : user(id).name)).join(', ');
  switch (s.type) {
    case 'created': return `${who} created the group “${s.title}”`;
    case 'renamed': return `${who} named the conversation “${s.title}”`;
    case 'photo': return `${who} changed the group photo`;
    case 'added': return `${who} added ${names(s.users)}`;
    case 'removed': return `${who} removed ${names([s.user])}`;
    case 'left': return `${who === 'You' ? 'You' : user(s.user).name} left the conversation`;
    case 'disappear': return s.secs ? `${who} turned on disappearing messages (${({ 30: '30 seconds', 300: '5 minutes', 3600: '1 hour', 86400: '24 hours', 604800: '7 days', 7776000: '90 days' })[s.secs]})` : `${who} turned off disappearing messages`;
    default: return '';
  }
}

function sameGroup(a, b) {
  if (!a || !b) return false;
  if (a.senderId !== b.senderId) return false;
  if (['system', 'call'].includes(a.kind) || ['system', 'call'].includes(b.kind)) return false;
  return Math.abs(b.createdAt - a.createdAt) < 5 * 60000;
}

function receiptStatus(m, chat) {
  if (m.pending) return m.failed ? 'failed' : 'Sending…';
  const others = chat.members.filter((x) => x.id !== S.me.id);
  if (!others.length) return 'Sent';
  const read = others.filter((x) => x.lastRead >= m.id);
  const deliv = others.filter((x) => x.lastDelivered >= m.id);
  if (chat.type === 'direct') return read.length ? 'Read' : deliv.length ? 'Delivered' : 'Sent';
  if (read.length === others.length) return 'Read by everyone';
  if (read.length) return `Read by ${read.length} of ${others.length}`;
  return deliv.length ? 'Delivered' : 'Sent';
}

export function renderMessages() {
  const chatId = S.current;
  const chat = S.chats.get(chatId);
  const st = S.msgs.get(chatId);
  if (!chat || !st || !els.msgs) return;
  const list = st.list;
  const lastMineIdx = (() => { for (let i = list.length - 1; i >= 0; i--) if (list[i].senderId === S.me.id && !['system', 'call'].includes(list[i].kind)) return i; return -1; })();
  const nodes = [];
  if (st.hasMore && list.length) nodes.push(getNode('loader', 'loader', () => h('div', { class: 'loader' }, h('div', { class: 'spinner' }))));
  else nodes.push(getNode('top-pad', 'top', () => h('div', { class: 'top-pad' })));
  if (!st.hasMore) {
    nodes.push(getNode('intro', chatTitle(chat) + chat.avatarV, () => h('div', { class: 'sys intro' },
      avatar({ id: chat.type === 'group' ? chat.id : otherMember(chat), name: chatTitle(chat), src: chatAvatar(chat), size: 64, group: chat.type === 'group' }),
      h('div', { style: { fontWeight: '600', color: 'var(--text)', marginTop: '8px', fontSize: '17px' } }, chatTitle(chat)),
      h('div', null, chat.type === 'group' ? `${chat.members.length} members` : user(otherMember(chat))?.username ? '@' + user(otherMember(chat)).username : ''),
      h('div', { style: { marginTop: '6px', display: 'inline-flex', gap: '4px', alignItems: 'center' } }, icon('lock'), 'Messages are encrypted at rest'))));
  }
  for (let i = 0; i < list.length; i++) {
    const m = list[i], prev = list[i - 1], next = list[i + 1];
    if (!prev || m.createdAt - prev.createdAt > 3600000 || new Date(m.createdAt).toDateString() !== new Date(prev.createdAt).toDateString()) {
      nodes.push(getNode('d' + m.id, String(Math.floor(m.createdAt / 60000)), () => h('div', { class: 'day', html: fmtDay(m.createdAt) })));
    }
    if (m.kind === 'system') { nodes.push(getNode('m' + m.id, 's' + m.id, () => h('div', { class: 'sys', 'data-id': m.id }, systemText(m, chat)))); continue; }
    if (m.kind === 'ping') { nodes.push(getNode('m' + (m.clientId || m.id), 'p' + m.id + (m.pending ? 'x' : ''), () => pingRow(m, chat))); continue; }
    const first = !sameGroup(prev, m) || (prev && m.createdAt - prev.createdAt > 3600000);
    const last = !sameGroup(m, next) || (next && next.createdAt - m.createdAt > 3600000);
    const status = i === lastMineIdx ? receiptStatus(m, chat) : '';
    const key = [m.id, m.editedAt, m.deleted, m.pinned, first, last, status, m.progress, m.failed, JSON.stringify(m.reactions || []), JSON.stringify(m.poll?.votes || {}), user(m.senderId).avatarV, user(m.senderId).name, m.replyTo?.preview, m.att?.id, m.expiresAt, m.readTtl, m.vr?.sig, scamV, m.intent].join('|');
    nodes.push(getNode('m' + (m.clientId || m.id), key, () => buildMessage(m, { first, last, status, chat })));
  }
  // Reconcile children with minimal DOM moves.
  const container = els.msgs;
  let cur = container.firstChild;
  for (const n of nodes) {
    if (n === cur) cur = cur.nextSibling;
    else container.insertBefore(n, cur);
  }
  while (cur) { const nx = cur.nextSibling; cur.remove(); cur = nx; }
  const live = new Set(nodes);
  for (const [k, v] of conv.nodes) if (!live.has(v.el)) conv.nodes.delete(k);
  renderPinnedBar();
}

function getNode(id, key, build) {
  const c = conv.nodes.get(id);
  if (c && c.key === key) return c.el;
  const el = build();
  conv.nodes.set(id, { key, el });
  return el;
}

function buildMessage(m, { first, last, status, chat }) {
  const mine = m.senderId === S.me.id;
  const u = user(m.senderId);
  const cls = ['m', mine ? 'me' : '', first ? 'first' : '', last ? 'last' : '', m.reactions?.length ? 'has-react' : '', m.deleted ? 'unsent' : '', m.pending ? 'pending' : ''].join(' ');
  const el = h('div', { class: cls, 'data-id': m.id });
  if (chat.type === 'group' && !mine) el.append(avatar({ id: m.senderId, name: u.name, src: userAvatar(m.senderId), size: 30 }));
  const col = h('div', { class: 'col' });
  el.append(col);
  if (chat.type === 'group' && !mine && first && m.kind !== 'call') col.append(h('div', { class: 'sender' }, u.name));
  if (m.forwarded && !m.deleted) col.append(h('div', { class: 'fwd' }, icon('fwd'), 'Forwarded'));
  if (m.intent && INTENTS[m.intent] && !m.deleted) col.append(h('div', { class: 'intent intent-' + m.intent, title: INTENTS[m.intent].hint }, icon(INTENTS[m.intent].icon), INTENTS[m.intent].label));
  if (m.replyTo && !m.deleted) {
    const r = m.replyTo;
    col.append(h('div', { class: 'quote', onclick: () => !r.missing && jumpTo(r.id) },
      r.attId ? h('img', { src: fileUrl({ id: r.attId }), alt: '' }) : null,
      h('div', { class: 'qt' }, h('b', null, r.missing ? '' : r.senderId === S.me.id ? 'You' : user(r.senderId).name), r.missing ? 'Original message unavailable' : r.preview)));
  }
  const bw = h('div', { class: 'bw' + (m.sos ? ' sos' : ''), style: { position: 'relative', maxWidth: '100%' } });
  col.append(bw);
  const bubble = buildBubble(m, mine, chat);
  bw.append(bubble);
  if (m.pinned && !m.deleted) bw.append(h('span', { class: 'pin-ic' }, icon('pin', 'fill')));
  if (m.reactions?.length) bw.append(buildReactions(m));
  if (m.vr && m.att && !m.deleted) col.append(verifiedBadge(m));
  if (m.whosRight && !m.deleted && !m.pending) col.append(h('button', { class: 'mini-btn', onclick: () => shareWhosRight(m, chat) }, icon('share'), 'Share result'));
  if (!mine && !m.deleted && m.kind === 'text' && !m.secure && !m.eyes && feature('scamRadar') && !scamDismissed().has(m.id)) {
    const scam = scanScam(m.text);
    if (scam) col.append(scamCard(m, scam));
  }
  if (m.readTtl && !m.deleted) {
    col.append(m.expiresAt
      ? h('div', { class: 'vanish', 'data-exp': m.expiresAt, 'data-chat': m.chatId, 'data-mid': m.id }, icon('hourglass'), h('span', { class: 'vt' }, `Vanishing in ${Math.max(0, Math.ceil((m.expiresAt - Date.now()) / 1000))}s`))
      : h('div', { class: 'vanish' }, icon('hourglass'), mine ? 'Vanishes after it’s read' : 'Vanishes after you read it'));
  }

  const info = [];
  if (last || m.editedAt) {
    if (last && !m.pending) info.push(h('span', null, fmtTime(m.createdAt)));
    if (m.editedAt && !m.deleted) info.push(h('span', { class: 'ed', onclick: () => openMessageInfo(m) }, 'Edited'));
    if (m.expiresAt && !m.readTtl) info.push(icon('timer'));
    if (m.silent && mine) info.push(icon('belloff'));
  }
  if (info.length) col.append(h('div', { class: 'info' }, info));
  if (status) {
    col.append(status === 'failed'
      ? h('div', { class: 'status failed', onclick: () => retrySend(m) }, 'Not Delivered — tap to retry')
      : h('div', { class: 'status' }, status));
  }

  if (m.kind !== 'call' && !m.pending) {
    longPress(bw, () => openMessageMenu(m, el));
    let lastTap = 0;
    bw.addEventListener('click', (e) => {
      if (m.eyes || e.target.closest('a, button, .voice, .poll, .media-box')) return;
      const t = Date.now();
      if (t - lastTap < 300) { quickReact(m); lastTap = 0; } else lastTap = t;
    });
    if (!m.deleted) attachSwipeReply(el, m);
  }
  if (!m.pending && m._fresh !== false && m.effect && BUBBLE_EFFECTS[m.effect] && m.effect !== 'ink' && Date.now() - m.createdAt < 8000) {
    bubble.classList.add('fx-' + m.effect);
    m._fresh = false;
  }
  return el;
}

function buildBubble(m, mine, chat) {
  if (m.deleted) return h('div', { class: 'bubble' }, mine ? 'You unsent a message' : `${user(m.senderId).name.split(' ')[0]} unsent a message`);
  if (m.eyes) {
    return h('button', { class: 'bubble eyes-bubble', type: 'button', onclick: (e) => { e.stopPropagation(); if (!m.pending) openEyes(m, mine); } },
      icon('eye'), h('span', null, h('b', null, 'Eyes-only'), h('small', null, mine ? 'Tap to view what you sent' : 'Tap to open · only while you’re looking')));
  }
  if (m.secure && m.kind === 'text') {
    const b = h('div', { class: 'bubble secure-bubble tail' });
    b.append(secureText(m.text, { maxWidth: Math.min(260, innerWidth * 0.6), color: mine ? 'var(--me-text)' : 'var(--them-text)' }),
      h('div', { class: 'secure-note' }, icon('shield'), 'Screenshot-proof'));
    return b;
  }
  const ink = m.effect === 'ink' && !m._revealed;
  const withInk = (b) => {
    if (!ink) return b;
    b.classList.add('ink');
    b.append(h('span', { class: 'sparkle' }));
    b.addEventListener('click', (e) => { e.stopPropagation(); m._revealed = true; b.classList.remove('ink'); b.querySelector('.sparkle')?.remove(); setTimeout(() => { m._revealed = false; if (b.isConnected) { b.classList.add('ink'); b.append(h('span', { class: 'sparkle' })); } }, 8000); }, { once: true });
    return b;
  };
  switch (m.kind) {
    case 'text': {
      const n = emojiCount(m.text);
      const b = h('div', { class: 'bubble' + (n ? ` emoji e${n}` : ' tail'), html: n ? esc(m.text) : richText(m.text) });
      return withInk(b);
    }
    case 'image':
    case 'video': {
      const box = mediaBox(m);
      const b = h('div', { class: 'bubble media' + (m.text ? ' with-text' : '') }, box, m.text ? h('div', { class: 'cap', html: richText(m.text) }) : null);
      return withInk(b);
    }
    case 'audio': return h('div', { class: 'bubble' }, voiceEl(m));
    case 'file': {
      const ext = (m.att?.name?.split('.').pop() || 'file').slice(0, 4);
      return h('div', { class: 'bubble' + (m.text ? '' : '') },
        h('a', { class: 'file-card', href: m.pending ? '#' : fileUrl(m.att) + '?dl=1', download: m.att?.name || 'file', onclick: (e) => e.stopPropagation() },
          h('span', { class: 'fi' }, ext),
          h('span', { style: { minWidth: 0 } }, h('div', { class: 'fn' }, m.att?.name || 'File'), h('div', { class: 'fs' }, m.pending ? `Uploading ${Math.round((m.progress || 0) * 100)}%` : fmtSize(m.att?.size || 0)))),
        m.text ? h('div', { class: 'cap', style: { padding: '0 13px 8px' }, html: richText(m.text) }) : null);
    }
    case 'location': {
      const { lat, lng } = m.loc;
      const z = 15, n = 2 ** z;
      const x = Math.floor(((lng + 180) / 360) * n);
      const y = Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n);
      const href = isIOS() ? `https://maps.apple.com/?ll=${lat},${lng}&q=${lat},${lng}` : `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
      return h('div', { class: 'bubble media' },
        h('a', { class: 'loc-card', href, target: '_blank', rel: 'noopener', onclick: (e) => e.stopPropagation() },
          h('div', { class: 'map', style: { backgroundImage: `url(https://tile.openstreetmap.org/${z}/${x}/${y}.png)` } }),
          h('div', { class: 'lt' }, h('b', null, m.loc.label || 'Shared location'), h('span', { class: 'muted small' }, `${lat.toFixed(5)}, ${lng.toFixed(5)}${m.loc.acc ? ` · ±${Math.round(m.loc.acc)}m` : ''}`))));
    }
    case 'poll': return h('div', { class: 'bubble' }, pollEl(m, chat));
    case 'letter': return letterCard(m, mine);
    case 'call': {
      const c = m.call || {};
      const missed = c.missed;
      const label = missed ? (m.senderId === S.me.id ? (c.reason === 'declined' ? 'Declined' : c.reason === 'busy' ? 'Busy' : 'No answer') : 'Missed') : '';
      return h('div', { class: 'bubble' },
        h('div', { class: 'call-pill' + (missed && m.senderId !== S.me.id ? ' missed' : '') },
          h('span', { class: 'ci' }, icon(c.video ? 'video' : 'phone')),
          h('div', null, h('div', { class: 'ct' }, `${missed ? (m.senderId === S.me.id ? '' : 'Missed ') : ''}${c.video ? 'Video' : 'Audio'} call`), h('div', { class: 'cs' }, missed ? label : fmtDur(c.dur))),
          isBlocked(chat) ? null : h('button', { onclick: (e) => { e.stopPropagation(); S.calls.start(chat.id, !!c.video); } }, 'Call')));
    }
    default: return h('div', { class: 'bubble' }, m.text || '');
  }
}

// ─────── the Ping ───────
function pingRow(m, chat) {
  const mine = m.senderId === S.me.id;
  const other = user(otherMember(chat) || m.senderId).name.split(' ')[0];
  return h('div', { class: 'ping-row' + (mine ? ' me' : ''), 'data-id': m.id },
    h('img', { class: 'ping-hand', src: '/icons/hand.svg', alt: '' }),
    h('div', null, h('b', null, mine ? `You pinged ${other}` : `${user(m.senderId).name.split(' ')[0]} pinged you`), h('small', null, `Thinking of you · ${fmtTime(m.createdAt)}`)));
}

async function sendPing(chat) {
  navigator.vibrate?.(20);
  sounds.ping();
  playPingEffect(true);
  try { await emit('msg:send', { chatId: chat.id, kind: 'ping' }); }
  catch (e) { toast(e.message, { error: true }); }
}

function playPingEffect(small = false) {
  document.querySelector('.ping-fx')?.remove();
  const fx = h('div', { class: 'ping-fx' + (small ? ' small' : '') }, h('img', { src: '/icons/hand.svg', alt: '' }));
  document.body.append(fx);
  setTimeout(() => fx.remove(), small ? 900 : 1900);
}

// ─────── open-when letters ───────
function letterCard(m, mine) {
  const l = m.letter || {};
  const state = mine
    ? (l.openedAt ? `Opened ${fmtListTime(l.openedAt)}` : l.locked ? `Unlocks ${new Date(l.unlockAt).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}` : 'Not opened yet')
    : (l.locked ? `Opens on ${new Date(l.unlockAt).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}` : l.openedAt ? 'Tap to read again' : 'Tap to open');
  return h('button', { class: 'bubble letter' + (l.locked && !mine ? ' locked' : ''), type: 'button', onclick: (e) => { e.stopPropagation(); if (!m.pending) viewLetter(m); } },
    h('span', { class: 'env' }, icon(l.locked && !mine ? 'lock' : 'mail')),
    h('span', { class: 'lt' }, h('small', null, 'Open-when letter'), h('b', null, l.title || 'Letter'), h('em', null, state)));
}

// ─────── Us strip under the header ───────
async function renderUsBar() {
  const chat = S.chats.get(S.current);
  if (!els.usBar) return;
  if (!chat || chat.type !== 'direct' || !feature('usSpace')) { els.usBar.hidden = true; return; }
  try {
    const us = await api('GET', `/api/chats/${chat.id}/us`);
    if (S.current !== chat.id) return;
    S.us = us;
    els.usBar.hidden = false;
    els.usBar.replaceChildren(
      h('span', { class: 'us-pill' }, icon('heart'), 'Us'),
      h('span', null, `${us.days} day${us.days === 1 ? '' : 's'}`),
      us.streak ? h('span', { class: 'us-streak' }, icon('fire'), us.streak) : null,
      us.anniversary && us.anniversary.inDays <= 30 ? h('span', null, us.anniversary.inDays === 0 ? 'Anniversary today!' : `Anniversary in ${us.anniversary.inDays}d`) : null,
      !us.bothToday && us.streak ? h('span', { class: 'us-hint' }, 'Chat today to keep it') : null,
      h('span', { class: 'spacer' }), icon('chev'));
  } catch { els.usBar.hidden = true; }
}

function openEyes(m, mine) {
  const render = () => {
    if (m.kind === 'text') return h('div', { class: 'eo-text' }, m.text);
    if (m.kind === 'image') return h('img', { src: fileUrl(m.att), alt: '' });
    return h('video', { src: fileUrl(m.att), controls: true, playsinline: true, autoplay: true });
  };
  if (mine) { // the sender can always re-read what they sent
    const box = h('div', { class: 'eo', role: 'dialog' }, h('div', { class: 'eo-top' }, h('button', { class: 'eo-close', 'aria-label': 'Close', onclick: () => box.remove() }, icon('x')), h('div', { class: 'eo-title' }, icon('eye'), 'You sent (eyes-only)')), h('div', { class: 'eo-content' }, render()));
    document.body.append(box);
    return;
  }
  openEyesOnly(render);
}

function verifiedBadge(m) {
  const el = h('div', { class: 'vr checking' }, icon('shield'), 'Checking photo…');
  verifyPhoto(m, fileUrl(m.att)).then((ok) => {
    el.className = 'vr ' + (ok ? 'ok' : 'bad');
    el.replaceChildren(icon(ok ? 'check' : 'x'), ok ? 'Verified Real — taken live in Ping Me, unedited' : 'Couldn’t verify this photo');
  });
  return el;
}

const scamDismissed = () => new Set(store.get('scamDismissed', []));
let scamV = 0;
function scamCard(m, scam) {
  const why = h('p', { hidden: true }, scam.why);
  return h('div', { class: 'scam' },
    h('div', { class: 'scam-t' }, icon('flag'), h('b', null, scam.title)),
    why,
    h('div', { class: 'scam-a' },
      h('button', { onclick: () => { why.hidden = !why.hidden; } }, 'Why?'),
      h('button', { onclick: () => { store.set('scamDismissed', [...scamDismissed(), m.id].slice(-500)); scamV++; renderMessages(); } }, 'Dismiss')));
}

function tickCountdowns() {
  let expired = false;
  for (const el of document.querySelectorAll('.vanish[data-exp]')) {
    const left = Math.ceil((Number(el.dataset.exp) - Date.now()) / 1000);
    if (left <= 0) {
      const st = S.msgs.get(Number(el.dataset.chat));
      if (st) { st.list = st.list.filter((x) => x.id !== Number(el.dataset.mid)); expired = true; }
    } else { const vt = el.querySelector('.vt'); if (vt) vt.textContent = `Vanishing in ${left}s`; }
  }
  if (expired) renderMessages();
}

function mediaBox(m) {
  const w = m.att?.w || 4, hh = m.att?.h || 3;
  const maxW = Math.min(300, innerWidth * 0.7);
  const ratio = Math.min(1.6, Math.max(0.5, hh / w));
  const box = h('div', { class: 'media-box', style: { width: maxW + 'px', height: Math.round(maxW * ratio) + 'px' } });
  const src = m.localUrl || fileUrl(m.att);
  if (m.kind === 'image') box.append(h('img', { src, alt: m.att?.name || 'Photo', loading: 'lazy', decoding: 'async' }));
  else {
    const v = h('video', { src: src + (src.startsWith('blob:') ? '' : '#t=0.1'), preload: 'metadata', muted: true, playsinline: true });
    v.muted = true;
    box.append(v, h('div', { class: 'play' }, h('span', null, icon('play', 'fill'))), m.att?.dur ? h('span', { class: 'dur' }, fmtDur(m.att.dur)) : null);
  }
  if (m.pending) box.append(h('div', { class: 'progress' }, m.failed ? 'Failed' : `${Math.round((m.progress || 0) * 100)}%`));
  else box.addEventListener('click', (e) => { e.stopPropagation(); if (m.effect === 'ink' && !m._revealed) return; openViewer(m); });
  return box;
}

function voiceEl(m) {
  const wave = m.att?.wave?.length ? m.att.wave : Array(40).fill(0.3);
  const bars = wave.map((v) => h('i', { style: { height: Math.max(12, v * 100) + '%' } }));
  const pb = h('button', { class: 'pb', 'aria-label': 'Play voice message' }, icon('play'));
  const t = h('span', { class: 'vt' }, fmtDur(m.att?.dur || 0));
  const sp = h('button', { class: 'sp', hidden: true, onclick: (e) => { e.stopPropagation(); player.cycleRate(); } }, '1×');
  const waveEl = h('div', { class: 'wave' }, bars);
  const el = h('div', { class: 'voice', 'data-vid': m.id }, pb, waveEl, t, sp);
  const url = m.localUrl || fileUrl(m.att);
  pb.onclick = (e) => { e.stopPropagation(); if (!m.pending) player.toggle(m.id, url); };
  waveEl.onclick = (e) => { e.stopPropagation(); const r = waveEl.getBoundingClientRect(); player.seek(m.id, (e.clientX - r.left) / r.width); };
  el._update = () => {
    const s = player.state(m.id);
    pb.replaceChildren(icon(s.playing ? 'pause' : 'play'));
    const on = Math.round(s.frac * bars.length);
    bars.forEach((b, i) => b.classList.toggle('on', i < on));
    t.textContent = s.t ? fmtDur(s.t) : fmtDur(m.att?.dur || 0);
    sp.hidden = player.id !== m.id;
    sp.textContent = player.rate + '×';
  };
  el._update();
  return el;
}
player.listeners.add(() => document.querySelectorAll('.voice[data-vid]').forEach((el) => el._update?.()));

function pollEl(m, chat) {
  const votes = m.poll.votes || {};
  const voters = new Set(Object.values(votes).flat());
  const total = voters.size;
  const mineSel = new Set(Object.entries(votes).filter(([, ids]) => ids.includes(S.me.id)).map(([k]) => Number(k)));
  return h('div', { class: 'poll' },
    h('div', { class: 'q' }, m.poll.q),
    h('div', { class: 'hint' }, `${m.poll.multi ? 'Select one or more' : 'Select one'} · ${total} vote${total === 1 ? '' : 's'}`),
    m.poll.opts.map((o, i) => {
      const n = (votes[i] || []).length;
      const pct = total ? Math.round((n / total) * 100) : 0;
      return h('div', { class: 'opt' + (mineSel.has(i) ? ' voted' : ''), title: (votes[i] || []).map((id) => user(id).name).join(', '), onclick: (e) => {
        e.stopPropagation();
        const next = new Set(mineSel);
        if (m.poll.multi) { if (next.has(i)) next.delete(i); else next.add(i); }
        else { if (next.has(i)) next.clear(); else { next.clear(); next.add(i); } }
        emit('poll:vote', { id: m.id, options: [...next] }).catch((er) => toast(er.message, { error: true }));
      } },
        h('span', { class: 'fillbar', style: { width: pct + '%' } }),
        h('span', { class: 'ck' }, mineSel.has(i) ? icon('check') : null),
        h('span', { class: 'lb' }, o),
        h('span', { class: 'ct' }, n ? `${n}` : ''));
    }));
}

function buildReactions(m) {
  const groups = new Map();
  for (const r of m.reactions) {
    if (!groups.has(r.emoji)) groups.set(r.emoji, []);
    groups.get(r.emoji).push(r.userId);
  }
  return h('div', { class: 'reacts', onclick: (e) => { e.stopPropagation(); openMessageInfo(m, 'reactions'); } },
    [...groups].slice(0, 4).map(([e, ids]) => h('span', { class: ids.includes(S.me.id) ? 'mine' : '' }, e, ids.length > 1 ? h('small', null, ids.length) : null)));
}

function quickReact(m) {
  const mine = m.reactions?.find((r) => r.userId === S.me.id);
  react(m, mine?.emoji === '❤️' ? null : '❤️');
}

export function react(m, emoji) {
  navigator.vibrate?.(8);
  emit('msg:react', { id: m.id, emoji }).catch((e) => toast(e.message, { error: true }));
}

function attachSwipeReply(el, m) {
  let sx = null, sy = 0, dx = 0, locked = null;
  el.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; dx = 0; locked = null; }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    if (sx === null) return;
    const x = e.touches[0].clientX - sx, y = e.touches[0].clientY - sy;
    if (locked === null && (Math.abs(x) > 8 || Math.abs(y) > 8)) locked = Math.abs(x) > Math.abs(y) && x > 0 ? 'x' : 'y';
    if (locked !== 'x') return;
    dx = Math.min(80, Math.max(0, x));
    el.style.transform = `translateX(${dx}px)`;
  }, { passive: true });
  el.addEventListener('touchend', () => {
    if (locked === 'x') {
      el.style.transition = 'transform .2s'; el.style.transform = '';
      setTimeout(() => (el.style.transition = ''), 220);
      if (dx > 55) { navigator.vibrate?.(10); setReply(m); }
    }
    sx = null;
  });
}

// ─────── message context menu ───────

function openMessageMenu(m, el) {
  if (m.deleted && m.senderId !== S.me.id) return;
  closeTop();
  const mine = m.senderId === S.me.id;
  const myReaction = m.reactions?.find((r) => r.userId === S.me.id)?.emoji;
  const wrap = h('div', { class: 'ctx' });
  let closed = false;
  const unregister = registerLayer(() => close());
  const close = () => {
    if (closed) return;
    closed = true; unregister();
    wrap.style.opacity = '0'; wrap.style.transition = 'opacity .15s';
    setTimeout(() => wrap.remove(), 150);
  };
  const act = (fn) => () => { close(); fn(); };
  const items = [];
  const priv = m.secure || m.eyes;
  if (!m.deleted) {
    items.push(['Reply', 'reply', () => setReply(m)]);
    if (m.text && !priv) items.push(['Copy', 'copy', () => navigator.clipboard?.writeText(m.text).then(() => toast('Copied'))]);
    if (mine && m.text !== undefined && ['text', 'image', 'video', 'file'].includes(m.kind)) items.push(['Edit', 'edit', () => startEdit(m)]);
    items.push([m.pinned ? 'Unpin' : 'Pin', 'pin', () => emit('msg:pin', { id: m.id, pinned: !m.pinned }).catch((e) => toast(e.message, { error: true }))]);
    if (!priv && ['text', 'image', 'video', 'file', 'audio', 'location'].includes(m.kind)) items.push(['Forward', 'fwd', () => openForward(m)]);
    if (m.att && !m.pending && !priv) items.push(['Save', 'download', () => { const a = h('a', { href: fileUrl(m.att).replace(/^blob:.*/, `/api/files/${m.att.id}`) + '?dl=1', download: m.att.name || 'file' }); document.body.append(a); a.click(); a.remove(); }]);
    if (m.text && !priv && 'speechSynthesis' in window) items.push(['Speak', 'speak', () => { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(m.text)); }]);
    if (m.effect && m.effect !== 'ink') items.push(['Replay Effect', 'sparkle', () => { if (SCREEN_EFFECTS[m.effect]) playScreenEffect(m.effect); else { const b = el.querySelector('.bubble'); b?.classList.remove('fx-' + m.effect); void b?.offsetWidth; b?.classList.add('fx-' + m.effect); } }]);
    items.push(['Info', 'info', () => openMessageInfo(m)]);
    if (mine) items.push(['Unsend', 'undo', async () => { if (await confirmDialog('Unsend this message for everyone?', { ok: 'Unsend', danger: true })) emit('msg:unsend', { id: m.id }).catch((e) => toast(e.message, { error: true })); }, true]);
  }
  items.push(['Delete for Me', 'trash', () => emit('msg:hide', { id: m.id }).catch((e) => toast(e.message, { error: true })), true]);

  const preview = el.cloneNode(true);
  preview.querySelectorAll('canvas').forEach((c) => c.replaceWith(h('div', { class: 'secure-ph' }, icon('lock'), 'Private message')));
  preview.classList.remove('first', 'has-react');
  wrap.append(
    h('div', { class: 'bg', onclick: close }),
    h('div', { class: 'stack ' + (mine ? 'me' : 'them') },
      m.deleted ? null : h('div', { class: 'tapbacks' },
        TAPBACKS.map((e) => h('button', { class: myReaction === e ? 'on' : '', onclick: act(() => react(m, myReaction === e ? null : e)) }, e)),
        h('button', { class: 'more', 'aria-label': 'More reactions', onclick: act(async () => { const e = await openEmojiPicker(); if (e) react(m, e); }) }, icon('plus'))),
      h('div', { class: 'preview' }, preview),
      h('div', { class: 'menu' },
        h('div', { class: 'info-line' }, new Date(m.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })),
        items.map(([label, ic, fn, danger]) => h('button', { class: danger ? 'danger' : '', onclick: act(fn) }, label, icon(ic))))));
  document.getElementById('layer').append(wrap);
}

// ═══════════════════════════ composer ═══════════════════════════

function renderComposer() {
  const chat = S.chats.get(S.current);
  els.composerWrap.replaceChildren();
  if (!chat) return;
  els.ctxBar = h('div', { class: 'ctx-bar', hidden: true });
  els.tray = h('div', { class: 'tray', hidden: true });
  els.sched = h('div', { hidden: true });
  els.optsBar = h('div', { class: 'opts-bar', hidden: true });
  els.intentBtn = feature('intentTags') ? h('button', { class: 'intent-btn', 'aria-label': 'Add intent tag', title: 'Intent tag', onclick: pickIntent }, icon('tag')) : null;
  els.ta = h('textarea', { rows: 1, placeholder: 'Message', enterkeyhint: prefs().enterSend ? 'send' : 'enter', 'aria-label': 'Message' });
  els.ta.value = store.get('draft:' + chat.id, '');
  els.sendBtn = h('button', { class: 'send', 'aria-label': 'Send' }, icon('send'));
  els.micBtn = h('button', { class: 'mic', 'aria-label': 'Record voice message', onclick: startRecording }, icon('mic'));
  els.plus = h('button', { class: 'plus', 'aria-label': 'Attach', onclick: plusMenu }, icon('plus'));
  els.fileInput = h('input', { type: 'file', multiple: true, hidden: true, onchange: (e) => { addFiles([...e.target.files]); e.target.value = ''; } });
  els.composer = h('div', { class: 'composer' }, els.plus, h('div', { class: 'inputbox' }, els.intentBtn, els.ta, els.sendBtn, els.micBtn), els.fileInput);
  els.blockedNote = h('div', { class: 'blocked-note', hidden: true });
  els.composerWrap.append(els.sched, els.ctxBar, els.optsBar, els.tray, els.composer, els.blockedNote);

  els.ta.addEventListener('input', () => { autosize(); updateSendBtn(); typingPing(); });
  els.ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && prefs().enterSend) { e.preventDefault(); send(); }
    if (e.key === 'ArrowUp' && !els.ta.value && !conv.editing) {
      const st = S.msgs.get(S.current);
      const lastMine = st && [...st.list].reverse().find((m) => m.senderId === S.me.id && m.kind === 'text' && !m.deleted && !m.pending);
      if (lastMine) { e.preventDefault(); startEdit(lastMine); }
    }
  });
  els.ta.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); addFiles(files); }
  });
  els.ta.addEventListener('focus', () => setTimeout(() => conv.nearBottom && scrollToBottom(), 300));
  longPress(els.sendBtn, () => openSendOptions(), 380);
  els.sendBtn.addEventListener('click', (e) => { e.preventDefault(); send(); });
  // keep keyboard open on mobile when tapping send
  els.sendBtn.addEventListener('mousedown', (e) => e.preventDefault());
  autosize();
  updateSendBtn();
  renderComposerState();
}

function renderComposerState() {
  const chat = S.chats.get(S.current);
  if (!chat || !els.composer) return;
  const blocked = isBlocked(chat);
  const deleted = chat.type === 'direct' && user(otherMember(chat))?.deleted;
  els.composer.hidden = blocked || deleted;
  els.blockedNote.hidden = !(blocked || deleted);
  els.blockedNote.replaceChildren(deleted ? 'This account no longer exists.' : h('span', null, 'You blocked this contact. ', h('a', { href: '#', onclick: async (e) => { e.preventDefault(); await api('DELETE', `/api/blocks/${otherMember(chat)}`); S.blocked.delete(otherMember(chat)); renderComposerState(); renderHeader(); } }, 'Unblock')));
}

function autosize() {
  const ta = els.ta;
  ta.style.height = 'auto';
  ta.style.height = Math.min(160, ta.scrollHeight) + 'px';
}

function updateSendBtn() {
  const has = els.ta.value.trim() || conv.tray.length || conv.editing;
  els.sendBtn.hidden = !has;
  els.micBtn.hidden = !!has;
  els.sendBtn.classList.toggle('sched', !!conv.sendAt);
  els.sendBtn.replaceChildren(icon(conv.editing ? 'check' : 'send'));
}

function saveDraft() {
  if (!els.ta || !conv.chatId) return;
  const v = els.ta.value;
  if (v && !conv.editing) store.set('draft:' + conv.chatId, v); else store.del('draft:' + conv.chatId);
}

let typingTimer = null, lastTypingSent = 0;
function typingPing() {
  const id = S.current;
  if (!els.ta.value) { S.socket.emit('typing', { chatId: id, on: false }); lastTypingSent = 0; return; }
  if (Date.now() - lastTypingSent > 3000) { S.socket.emit('typing', { chatId: id, on: true }); lastTypingSent = Date.now(); }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => { S.socket.emit('typing', { chatId: id, on: false }); lastTypingSent = 0; }, 4000);
}

export function setReply(m) {
  conv.editing = null;
  conv.reply = m;
  renderCtxBar();
  els.ta.focus();
}

function startEdit(m) {
  conv.reply = null;
  conv.editing = m;
  els.ta.value = m.text || '';
  autosize();
  renderCtxBar();
  updateSendBtn();
  els.ta.focus();
}

function renderCtxBar() {
  const r = conv.reply, ed = conv.editing;
  els.ctxBar.hidden = !r && !ed;
  if (!r && !ed) return;
  els.ctxBar.replaceChildren(h('span', { class: 'bar' }),
    h('div', { class: 't' }, h('b', null, ed ? 'Editing message' : `Replying to ${r.senderId === S.me.id ? 'yourself' : user(r.senderId).name}`), h('span', null, (ed || r).preview || (ed || r).text || '')),
    h('button', { class: 'x', 'aria-label': 'Cancel', onclick: () => { if (conv.editing) { els.ta.value = ''; autosize(); } conv.reply = null; conv.editing = null; renderCtxBar(); updateSendBtn(); } }, icon('xc')));
}

export function setSendAt(ts) {
  conv.sendAt = ts;
  els.sched.hidden = !ts;
  els.sched.replaceChildren(ts ? h('div', { class: 'sched-chip', onclick: () => setSendAt(null) }, icon('clock'), `Send ${new Date(ts).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' })}`, icon('x')) : '');
  updateSendBtn();
  renderScheduledLine();
}

async function loadScheduled(chatId) {
  try {
    const { scheduled } = await api('GET', `/api/chats/${chatId}/scheduled`);
    S.scheduled.set(chatId, scheduled.length);
    if (S.current === chatId) renderScheduledLine();
  } catch {}
}

function renderScheduledLine() {
  if (!els.sched) return;
  const n = S.scheduled.get(S.current) || 0;
  els.sched.querySelector('.sched-list')?.remove();
  if (n) {
    els.sched.hidden = false;
    els.sched.append(h('div', { class: 'sched-list', onclick: () => openScheduledList(S.current, () => loadScheduled(S.current)) }, icon('clock'), `${n} scheduled message${n > 1 ? 's' : ''}`, icon('chev')));
  } else if (!conv.sendAt) els.sched.hidden = true;
}

// ─────── message options (private · eyes-only · vanish · intent) ───────

export function setMessageOpts(patch) {
  conv.opts = { ...conv.opts, ...patch };
  if (patch.eyes) conv.opts.secure = false;
  if (patch.secure) conv.opts.eyes = false;
  renderOptsBar();
}
export const messageOpts = () => conv.opts;

function renderOptsBar() {
  if (!els.optsBar) return;
  const o = conv.opts;
  const chips = [];
  const chip = (ic, label, off) => h('span', { class: 'opt-chip' }, icon(ic), label, h('button', { 'aria-label': 'Remove', onclick: () => { off(); renderOptsBar(); } }, icon('x')));
  if (o.intent && INTENTS[o.intent]) chips.push(chip(INTENTS[o.intent].icon, INTENTS[o.intent].label, () => { o.intent = null; }));
  if (o.secure) chips.push(chip('shieldcheck', 'Screenshot-proof', () => { o.secure = false; }));
  if (o.eyes) chips.push(chip('eye', 'Eyes-only', () => { o.eyes = false; }));
  if (o.vanish) chips.push(chip('hourglass', 'Vanish after read', () => { o.vanish = false; }));
  els.optsBar.hidden = !chips.length;
  els.optsBar.replaceChildren(...chips);
  if (els.intentBtn) { els.intentBtn.replaceChildren(icon(o.intent ? INTENTS[o.intent].icon : 'tag')); els.intentBtn.classList.toggle('on', !!o.intent); }
}

async function pickIntent() {
  const r = await actionSheet({
    title: 'How should they read this?', align: 'left',
    actions: [...Object.entries(INTENTS).map(([k, v]) => ({ label: `${v.label} — ${v.hint}`, icon: v.icon, value: k })), conv.opts.intent ? { label: 'No tag', icon: 'x', value: 'none' } : null],
  });
  if (r) setMessageOpts({ intent: r === 'none' ? null : r });
}

async function plusMenu() {
  els.plus.classList.add('open');
  const chat = S.chats.get(S.current);
  const r = await actionSheet({
    align: 'left',
    actions: [
      chat.type === 'direct' && feature('ping') ? { label: 'Send a Ping', icon: 'hand', value: 'ping' } : null,
      chat.type === 'direct' && feature('usSpace') ? { label: 'Write an open-when letter', icon: 'mail', value: 'letter' } : null,
      { label: 'Photos & Videos', icon: 'image', value: 'media' },
      isMobile() ? { label: 'Camera', icon: 'camera', value: 'camera' } : null,
      feature('verifiedCamera') ? { label: 'Verified Real photo', icon: 'shield', value: 'vr' } : null,
      { label: 'Document', icon: 'file', value: 'file' },
      { label: 'Location', icon: 'map', value: 'loc' },
      { label: 'Poll', icon: 'poll', value: 'poll' },
      feature('whosRight') ? { label: 'Who’s Right?', icon: 'users', value: 'whosright' } : null,
      { label: 'Message options', icon: 'sparkle', value: 'opts' },
      { label: 'Send later', icon: 'clock', value: 'sched' },
      feature('sos') || feature('checkIn') ? { label: 'Safety', icon: 'shield', value: 'safety' } : null,
    ],
  });
  els.plus.classList.remove('open');
  const fi = els.fileInput;
  fi.removeAttribute('capture');
  if (r === 'media') { fi.accept = 'image/*,video/*'; fi.click(); }
  if (r === 'camera') { fi.accept = 'image/*,video/*'; fi.setAttribute('capture', 'environment'); fi.click(); }
  if (r === 'file') { fi.accept = ''; fi.click(); }
  if (r === 'loc') sendLocation(chat.id, conv.reply?.id);
  if (r === 'poll') openPoll(chat.id);
  if (r === 'sched') openSchedule();
  if (r === 'opts') openMessageOptions();
  if (r === 'whosright') openWhosRight(chat);
  if (r === 'vr') openVerifiedCamera(chat.id);
  if (r === 'safety') openSafety(chat.id);
  if (r === 'ping') sendPing(chat);
  if (r === 'letter') openLetterComposer(chat);
}

function setupDrop() {
  let hint = null, depth = 0;
  els.conv.addEventListener('dragenter', (e) => { if (!e.dataTransfer?.types.includes('Files')) return; e.preventDefault(); depth++; if (!hint) { hint = h('div', { class: 'drop-hint' }, 'Drop to send'); els.conv.append(hint); } });
  els.conv.addEventListener('dragover', (e) => e.preventDefault());
  els.conv.addEventListener('dragleave', () => { if (--depth <= 0) { hint?.remove(); hint = null; depth = 0; } });
  els.conv.addEventListener('drop', (e) => { e.preventDefault(); hint?.remove(); hint = null; depth = 0; addFiles([...(e.dataTransfer?.files || [])]); });
}

function addFiles(files) {
  for (const f of files) {
    if (f.size > S.config.maxUpload) { toast(`${f.name} is larger than ${fmtSize(S.config.maxUpload)}`, { error: true }); continue; }
    conv.tray.push({ file: f, url: URL.createObjectURL(f), id: Math.random().toString(36).slice(2) });
  }
  renderTray();
  updateSendBtn();
  els.ta.focus();
}

function renderTray() {
  els.tray.hidden = !conv.tray.length;
  const hasImage = conv.tray.some((t) => t.file.type.startsWith('image/'));
  els.tray.replaceChildren(
    ...conv.tray.map((t) => h('div', { class: 'ti' },
      t.file.type.startsWith('image/') ? h('img', { src: t.url, alt: '' }) : t.file.type.startsWith('video/') ? h('video', { src: t.url, muted: true, playsinline: true }) : h('span', null, t.file.name),
      h('button', { class: 'rm', 'aria-label': 'Remove', onclick: () => { URL.revokeObjectURL(t.url); conv.tray = conv.tray.filter((x) => x !== t); renderTray(); updateSendBtn(); } }, icon('x')))),
    hasImage ? h('button', { class: 'hd' + (store.get('sendHD', false) ? ' on' : ''), title: 'Send photos in original quality', onclick: () => { store.set('sendHD', !store.get('sendHD', false)); renderTray(); } }, 'HD') : '');
}

// ─────── sending ───────

let clientSeq = 0;
function pendingMessage(chatId, fields) {
  const clientId = `${Date.now().toString(36)}-${++clientSeq}`;
  return { id: 'c_' + clientId, clientId, chatId, senderId: S.me.id, createdAt: Date.now(), pending: true, reactions: [], ...fields };
}

export async function send(opts = {}) {
  const chatId = S.current;
  if (!chatId) return;
  const text = els.ta.value.trim();
  if (conv.editing) {
    const m = conv.editing;
    conv.editing = null;
    els.ta.value = '';
    autosize(); renderCtxBar(); updateSendBtn();
    if (text !== (m.text || '')) emit('msg:edit', { id: m.id, text }).catch((e) => toast(e.message, { error: true }));
    return;
  }
  if (!text && !conv.tray.length) return;
  const replyTo = conv.reply?.id || null;
  const sendAt = opts.sendAt || conv.sendAt || null;
  const o = conv.opts || {};
  const base = {
    replyTo, effect: opts.effect || null, silent: !!opts.silent, sendAt,
    intent: feature('intentTags') ? o.intent : null,
    secure: feature('secureMessages') && o.secure, eyes: feature('eyesOnly') && o.eyes, vanish: feature('vanishAfterRead') && o.vanish,
  };
  conv.opts = { intent: null, secure: false, eyes: false, vanish: false };
  renderOptsBar();
  const tray = conv.tray;
  conv.tray = []; conv.reply = null;
  els.ta.value = '';
  store.del('draft:' + chatId);
  autosize(); renderTray(); renderCtxBar(); setSendAt(null);
  S.socket.emit('typing', { chatId, on: false });
  if (prefs().sounds) sounds.sent();

  if (!tray.length) {
    await dispatch(chatId, { kind: 'text', text, ...base });
    if (!sendAt && !base.secure && !base.eyes) trackPromise(chatId, text);
    return;
  }
  for (let i = 0; i < tray.length; i++) {
    const caption = i === 0 ? text : '';
    sendFile(chatId, tray[i].file, { ...base, secure: false, text: caption, replyTo: i === 0 ? replyTo : null }, tray[i].url);
  }
}

async function dispatch(chatId, payload, pending) {
  const st = S.msgs.get(chatId);
  if (!payload.sendAt && !pending) {
    pending = pendingMessage(chatId, { kind: payload.kind, text: payload.text, effect: payload.effect, silent: payload.silent, poll: payload.poll, loc: payload.loc,
      intent: payload.intent, secure: !!payload.secure, eyes: !!payload.eyes, readTtl: payload.vanish ? 1 : null,
      replyTo: payload.replyTo ? st?.list.find((x) => x.id === payload.replyTo) && { id: payload.replyTo, senderId: st.list.find((x) => x.id === payload.replyTo).senderId, preview: st.list.find((x) => x.id === payload.replyTo).preview } : null, _payload: payload });
    pending.preview = payload.eyes ? 'Eyes-only message' : payload.secure ? 'Private message' : payload.text;
    if (st) { st.list.push(pending); if (S.current === chatId) { renderMessages(); scrollToBottom(true); } }
  }
  try {
    const res = await emit('msg:send', { chatId, ...payload, clientId: pending?.clientId });
    if (res.scheduled) { toast(`Scheduled for ${new Date(payload.sendAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`); loadScheduled(chatId); return; }
    if (res.message) upsertMessage({ ...res.message, clientId: pending?.clientId });
  } catch (e) {
    if (pending) { pending.failed = true; pending._payload = payload; if (S.current === chatId) renderMessages(); }
    toast(e.message, { error: true });
  }
}

async function sendFile(chatId, file, base, localUrl) {
  const type = file.type || '';
  let kind = type.startsWith('image/') ? 'image' : type.startsWith('video/') ? 'video' : type.startsWith('audio/') ? 'audio' : 'file';
  if (kind === 'audio') kind = 'file';
  const pending = pendingMessage(chatId, { kind, text: base.text, att: { name: file.name, size: file.size, mime: type }, localUrl, progress: 0, effect: base.effect, intent: base.intent, eyes: !!base.eyes, readTtl: base.vanish ? 1 : null });
  const st = S.msgs.get(chatId);
  if (!base.sendAt && st) { st.list.push(pending); if (S.current === chatId) { renderMessages(); scrollToBottom(true); } }
  let blob = file, media = {};
  try {
    if (kind === 'image' && !store.get('sendHD', false)) {
      const r = await compressImage(file);
      blob = r.blob; media = { w: r.w, h: r.h };
      pending.att.w = r.w; pending.att.h = r.h;
    } else if (kind === 'image') {
      const r = await compressImage(file, { maxEdge: 8192, quality: 0.95 });
      media = { w: r.w, h: r.h };
      if (r.blob.size < file.size) blob = r.blob;
    } else if (kind === 'video') {
      media = await videoMeta(file);
      Object.assign(pending.att, media);
    }
    let lastRender = 0;
    const up = await upload(chatId, blob, file.name.replace(/\.(heic|heif|png|jpe?g)$/i, blob.type === 'image/webp' ? '.webp' : blob.type === 'image/jpeg' ? '.jpg' : '$&'), (p) => {
      pending.progress = p;
      if (Date.now() - lastRender > 150 && S.current === chatId) { lastRender = Date.now(); renderMessages(); }
    });
    S.localMedia.set(up.id, localUrl);
    pending.progress = 1;
    await dispatch(chatId, { kind, attachmentId: up.id, media, ...base }, base.sendAt ? null : pending);
  } catch (e) {
    pending.failed = true;
    pending._file = { file, base, localUrl };
    if (S.current === chatId) renderMessages();
    toast(e.message, { error: true });
  }
}

async function retrySend(m) {
  const st = S.msgs.get(m.chatId);
  const r = await actionSheet({ title: 'This message was not delivered.', actions: [{ label: 'Try Again', value: 'retry' }, { label: 'Delete', value: 'del', danger: true }] });
  if (!r) return;
  st.list = st.list.filter((x) => x !== m);
  renderMessages();
  if (r !== 'retry') return;
  if (m._file) sendFile(m.chatId, m._file.file, m._file.base, m._file.localUrl);
  else if (m._payload) dispatch(m.chatId, m._payload);
}

export function sendPayload(chatId, payload) {
  return dispatch(chatId, payload);
}

// ─────── voice recording ───────

async function startRecording() {
  const chatId = S.current;
  if (!(await ensurePermission(['microphone'], 'To record voice messages.'))) return;
  const lvl = h('div', { class: 'lvl' });
  const t = h('span', { class: 't' }, '0:00');
  let rec;
  const finish = () => { els.composerWrap.querySelector('.recorder')?.remove(); els.composer.hidden = false; };
  const ui = h('div', { class: 'recorder' },
    h('button', { class: 'icon-btn cancel', 'aria-label': 'Cancel recording', onclick: () => { rec?.cancel(); finish(); } }, icon('trash')),
    h('span', { class: 'rec-dot' }), t, lvl,
    h('button', { class: 'inputbox send', style: { width: '36px', height: '36px', borderRadius: '50%', background: 'var(--accent)', color: '#fff', display: 'grid', placeItems: 'center', border: 0 }, 'aria-label': 'Send voice message', onclick: async () => {
      if (!rec) return;
      const { blob, dur, wave } = await rec.stop();
      finish();
      if (dur < 0.6) return toast('Hold on — that was too short');
      const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
      const localUrl = URL.createObjectURL(blob);
      const pending = pendingMessage(chatId, { kind: 'audio', att: { dur, wave, size: blob.size }, localUrl, progress: 0 });
      const st = S.msgs.get(chatId);
      st?.list.push(pending);
      if (S.current === chatId) { renderMessages(); scrollToBottom(true); }
      try {
        const up = await upload(chatId, blob, `Voice message.${ext}`, (p) => { pending.progress = p; });
        S.localMedia.set(up.id, localUrl);
        await dispatch(chatId, { kind: 'audio', attachmentId: up.id, media: { dur, wave }, replyTo: conv.reply?.id || null }, pending);
        conv.reply = null; renderCtxBar();
      } catch (e) { pending.failed = true; renderMessages(); toast(e.message, { error: true }); }
    } }, icon('send')));
  els.composer.hidden = true;
  els.composerWrap.append(ui);
  rec = new VoiceRecorder((level, secs) => {
    t.textContent = fmtDur(secs);
    lvl.append(h('i', { style: { height: Math.max(3, level * 30) + 'px' } }));
    if (lvl.children.length > 120) lvl.firstChild.remove();
    if (secs > 600) ui.querySelector('.send')?.click();
  });
  try { await rec.start(); }
  catch (e) { finish(); rec = null; toast(e.name === 'NotAllowedError' ? 'Allow microphone access to record voice messages' : 'Microphone unavailable', { error: true }); }
}

// ═══════════════════════════ promise tracker & reminders ═══════════════════════════

async function trackPromise(chatId, text) {
  if (!feature('promiseTracker')) return;
  const p = detectPromise(text);
  if (!p) return;
  try {
    const short = text.length > 90 ? text.slice(0, 87) + '…' : text;
    const { reminder } = await api('POST', '/api/reminders', { chatId, text: `You said: “${short}”`, remindAt: p.when.getTime() });
    const undo = h('button', { class: 'link', onclick: (e) => { e.stopPropagation(); api('DELETE', `/api/reminders/${reminder.id}`).then(() => toast('Reminder removed')); } }, 'Undo');
    toast(null, { node: h('div', { class: 'row' }, icon('alarm'), h('span', null, `I’ll remind you ${p.label}`), h('span', { class: 'spacer' }), undo), timeout: 6000 });
  } catch {}
}

function showReminder(r) {
  sounds.message();
  const el = h('div', { class: 'nbanner', role: 'alert' },
    h('div', { class: 'nb-main' },
      h('span', { class: 'nb-icon' }, icon('alarm')),
      h('div', { class: 'nb-text' }, h('div', { class: 'nb-top' }, h('img', { src: '/icons/icon-192.png', alt: '' }), h('span', null, 'PING ME'), h('span', { class: 'nb-time' }, 'reminder')), h('b', null, 'Reminder'), h('div', { class: 'nb-body' }, r.text)),
      r.chatId && S.chats.has(r.chatId) ? h('button', { class: 'nb-rbtn', onclick: (e) => { e.stopPropagation(); el.remove(); openChat(r.chatId, r.messageId ? { around: r.messageId } : {}); } }, 'Open') : null));
  el.addEventListener('click', () => el.remove());
  document.body.append(el);
  setTimeout(() => el.remove(), 12000);
}

// ═══════════════════════════ safety bar (check-in / SOS) ═══════════════════════════

async function loadSafety() {
  try {
    const [{ checkin }, { active }] = await Promise.all([api('GET', '/api/checkins'), api('GET', '/api/sos')]);
    S.checkin = checkin; S.sosActive = active;
    if (active && !sosWatch) startSosTracking();
  } catch {}
  renderSafetyBar();
}

export function setCheckin(c) { S.checkin = c; renderSafetyBar(); }

export function renderSafetyBar() {
  if (!els.safetyBar) return;
  const parts = [];
  if (S.sosActive) {
    parts.push(h('div', { class: 'sbar sos' }, icon('lifebuoy'), h('span', null, 'SOS on — sharing live location'), h('button', { onclick: stopSos }, 'Stop')));
  }
  if (S.checkin) {
    const c = S.checkin;
    parts.push(h('div', { class: 'sbar' },
      icon('clock'), h('span', { 'data-due': c.dueAt }, `Check-in due ${new Date(c.dueAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`),
      h('button', { onclick: async () => { await api('POST', `/api/checkins/${c.id}/extend`, { minutes: 30 }).then((r) => setCheckin(r.checkin)).catch((e) => toast(e.message, { error: true })); } }, '+30m'),
      h('button', { class: 'safe', onclick: async () => { await api('POST', `/api/checkins/${c.id}/safe`); setCheckin(null); toast('Glad you’re safe'); } }, 'I’m safe')));
  }
  els.safetyBar.hidden = !parts.length;
  els.safetyBar.replaceChildren(...parts);
}

let sosWatch = null, sosLast = 0;
export function startSosTracking() {
  S.sosActive = true;
  renderSafetyBar();
  if (sosWatch || !navigator.geolocation) return;
  sosWatch = navigator.geolocation.watchPosition((pos) => {
    if (Date.now() - sosLast < 15000) return;
    sosLast = Date.now();
    api('POST', '/api/sos/update', { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy })
      .then((r) => { if (!r.active) stopSosLocal(); }).catch(() => {});
  }, () => {}, { enableHighAccuracy: true, maximumAge: 10000 });
}
function stopSosLocal() {
  if (sosWatch !== null) navigator.geolocation.clearWatch(sosWatch);
  sosWatch = null; S.sosActive = false; renderSafetyBar();
}
async function stopSos() {
  await api('POST', '/api/sos/stop').catch(() => {});
  stopSosLocal();
  toast('SOS stopped — your contacts were told you’re OK');
}

async function checkRecovery() {
  try {
    const { requests } = await api('GET', '/api/recovery/pending');
    if (requests.some((r) => r.mine) ) openRecoveryRequests({ alert: true });
    else if (requests.some((r) => !r.mine && !r.responded)) toast('A friend needs help recovering their account — tap to review', { onClick: openRecoveryRequests, timeout: 8000 });
  } catch {}
}

// ═══════════════════════════ in-app notification banner ═══════════════════════════
// Looks and behaves like a native notification: slides in from the top, swipe up to dismiss,
// tap to open, and "Reply" to answer without leaving what you're doing.

let bannerEl = null, bannerTimer = null;
function showBanner(chat, m) {
  bannerEl?.remove();
  clearTimeout(bannerTimer);
  const group = chat.type === 'group';
  const body = (group ? user(m.senderId).name + ': ' : '') + (m.effect === 'ink' ? 'Invisible Ink' : m.preview || '');
  const replyBox = h('form', { class: 'nb-reply', hidden: true });
  const input = h('input', { placeholder: `Reply to ${group ? chatTitle(chat) : user(m.senderId).name.split(' ')[0]}…`, enterkeyhint: 'send', maxlength: 2000 });
  replyBox.append(input, h('button', { type: 'submit', 'aria-label': 'Send' }, icon('send')));
  const el = h('div', { class: 'nbanner', role: 'alert' },
    h('div', { class: 'nb-main' },
      avatar({ id: group ? chat.id : m.senderId, name: chatTitle(chat), src: chatAvatar(chat), size: 40, group }),
      h('div', { class: 'nb-text' },
        h('div', { class: 'nb-top' }, h('img', { src: '/icons/icon-192.png', alt: '' }), h('span', null, 'PING ME'), h('span', { class: 'nb-time' }, 'now')),
        h('b', null, chatTitle(chat)),
        h('div', { class: 'nb-body' }, body)),
      h('button', { class: 'nb-rbtn', type: 'button' }, 'Reply')),
    replyBox);
  const close = () => {
    clearTimeout(bannerTimer);
    el.classList.add('out');
    setTimeout(() => el.remove(), 260);
    if (bannerEl === el) bannerEl = null;
  };
  const arm = (ms = 5000) => { clearTimeout(bannerTimer); bannerTimer = setTimeout(close, ms); };
  el.querySelector('.nb-main').addEventListener('click', (e) => {
    if (e.target.closest('.nb-rbtn')) return;
    close(); openChat(chat.id);
  });
  el.querySelector('.nb-rbtn').addEventListener('click', () => {
    replyBox.hidden = false; el.querySelector('.nb-rbtn').hidden = true;
    clearTimeout(bannerTimer); input.focus();
  });
  input.addEventListener('blur', () => { if (!input.value) arm(2500); });
  replyBox.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    sendPayload(chat.id, { kind: 'text', text, replyTo: m.id });
    S.socket?.emit('chat:read', { chatId: chat.id, messageId: m.id });
    chat.unread = 0; renderList(); updateBadge();
    if (prefs().sounds) sounds.sent();
    close();
  });
  // swipe up to dismiss
  let sy = null;
  el.addEventListener('touchstart', (e) => { sy = e.touches[0].clientY; }, { passive: true });
  el.addEventListener('touchmove', (e) => { if (sy === null) return; const dy = Math.min(0, e.touches[0].clientY - sy); el.style.transform = `translateY(${dy}px)`; }, { passive: true });
  el.addEventListener('touchend', (e) => { const dy = e.changedTouches[0].clientY - (sy ?? 0); sy = null; if (dy < -30) close(); else el.style.transform = ''; });
  document.body.append(el);
  bannerEl = el;
  arm();
}

async function clearChatNotifications(chatId) {
  if (!chatId) return;
  try {
    const reg = await navigator.serviceWorker?.ready;
    (await reg?.getNotifications({ tag: 'chat-' + chatId }))?.forEach((n) => n.close());
  } catch {}
}

// ═══════════════════════════ push ═══════════════════════════

function b64ToBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function setupPush(ask) {
  if (!S.config.vapidPublicKey || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    if (ask) toast(isIOS() && !isStandalone() ? 'Add Ping Me to your Home Screen first to enable notifications' : 'Notifications are not supported on this browser', { error: true, timeout: 5000 });
    return false;
  }
  if (Notification.permission === 'default' && !ask) return false;
  if (Notification.permission === 'denied') { if (ask) toast('Notifications are blocked — enable them in your browser/system settings', { error: true, timeout: 5000 }); return false; }
  if (ask && Notification.permission !== 'granted') {
    const p = await Notification.requestPermission();
    if (p !== 'granted') { renderList(); return false; }
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(S.config.vapidPublicKey) });
    await api('POST', '/api/push/subscribe', { subscription: sub.toJSON() });
    if (ask) toast('Notifications are on');
    renderList();
    return true;
  } catch (e) {
    if (ask) toast('Could not enable notifications', { error: true });
    return false;
  }
}

// Installed app: ask once (with a tap, as iOS requires) so notifications arrive like any real app.
function askNotificationsOnce(force = false) {
  if (!S.config.vapidPublicKey || !('Notification' in window) || !('PushManager' in window)) return;
  if (Notification.permission !== 'default') return;
  if (!force && (!isStandalone() || sessionStorage.getItem('pm:asked'))) return;
  if (isIOS() && !isStandalone()) return; // iOS only allows web push for home-screen apps
  sessionStorage.setItem('pm:asked', '1');
  const close = () => root.remove();
  const root = h('div', { class: 'notif-ask', onclick: (e) => { if (e.target === root) close(); } },
    h('div', { class: 'notif-card' },
      h('img', { src: '/icons/icon-192.png', alt: '' }),
      h('h2', null, 'Turn on notifications'),
      h('p', null, 'Get messages and calls the moment they arrive — even when Ping Me is closed.'),
      h('div', { class: 'demo' }, h('img', { src: '/icons/icon-192.png', alt: '' }), h('div', null, h('b', null, 'Ping Me'), h('span', null, 'Priya: See you at 8?'))),
      h('button', { class: 'btn', onclick: async () => { close(); await setupPush(true); } }, 'Turn on'),
      h('button', { class: 'later', onclick: close }, 'Not now')));
  document.body.append(root);
}

export async function logout() {
  try {
    const reg = await navigator.serviceWorker?.ready;
    const sub = await reg?.pushManager?.getSubscription();
    await api('POST', '/api/logout', { endpoint: sub?.endpoint });
    await sub?.unsubscribe();
  } catch {}
  for (const k of Object.keys(localStorage)) if (k.startsWith('mm:draft:')) localStorage.removeItem(k);
  location.href = '/';
}

boot();
