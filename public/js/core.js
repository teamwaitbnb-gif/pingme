// Shared state + API helpers.
import { store } from './ui.js';
import { track } from './analytics.js';

export const S = {
  me: null,
  config: { iceServers: [], vapidPublicKey: null, maxUpload: 2 * 1024 * 1024 * 1024 },
  users: new Map(),
  groupCalls: new Map(), // chatId → group call going on now
  chats: new Map(),
  blocked: new Set(),
  current: null,
  msgs: new Map(),        // chatId -> { list, hasMore, loading, gapAfter, loaded }
  typing: new Map(),      // chatId -> Map(userId -> timeout)
  scheduled: new Map(),   // chatId -> count
  localMedia: new Map(),  // attachmentId -> blob URL (instant display of what I just sent)
  socket: null,
  calls: null,
  search: '',
  showArchived: false,
};

export class ApiError extends Error { constructor(msg, status) { super(msg); this.status = status; } }

export async function api(method, path, body) {
  const opts = { method, credentials: 'same-origin', headers: { 'x-pingme': '1' } };
  if (body !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
  let res;
  const t0 = performance.now();
  try { res = await fetch(path, opts); }
  catch { throw new ApiError('You appear to be offline', 0); }
  const data = await res.json().catch(() => ({}));
  // Admin Speed page: requests that felt slow on this phone (the address shape, never its contents).
  const took = Math.round(performance.now() - t0);
  if (took > 700) track({ t: 'perf_api', p: method + ' ' + path.split('?')[0].replace(/\/[0-9a-f]{24}(?=\/|$)/gi, '/:hex').replace(/\/\d+(?=\/|$)/g, '/:id'), v: took });
  if (!res.ok) {
    if (res.status === 401 && path !== '/api/login' && path !== '/api/me' && !path.startsWith('/api/me/')) window.dispatchEvent(new Event('mm:unauthorized'));
    throw new ApiError(data.error || 'Request failed', res.status);
  }
  return data;
}

// Files over 8 MiB (original-quality videos) go up in 8 MiB pieces: works past Cloud Run's 32 MiB
// request limit, retries a failed piece instead of the whole file, and never re-encodes anything.
const PIECE = 8 * 1024 * 1024;
export function upload(chatId, blob, name, onProgress) {
  return blob.size > PIECE ? uploadInPieces(chatId, blob, name, onProgress) : uploadWhole(chatId, blob, name, onProgress);
}

function sendPiece(url, body, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.withCredentials = true;
    xhr.setRequestHeader('x-pingme', '1');
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch {}
      reject(new ApiError(data.error || 'Upload failed', xhr.status));
    };
    xhr.onerror = () => reject(new ApiError('Upload failed — check your connection', 0));
    xhr.send(body);
  });
}

async function uploadInPieces(chatId, blob, name, onProgress) {
  const { id, chunkSize, chunks } = await api('POST', '/api/upload/start', { chatId, name: name || 'file', mime: blob.type || 'application/octet-stream', size: blob.size });
  let done = 0;
  for (let i = 0; i < chunks; i++) {
    const piece = blob.slice(i * chunkSize, Math.min(blob.size, (i + 1) * chunkSize));
    for (let attempt = 0; ; attempt++) {
      try {
        await sendPiece(`/api/upload/${id}/${i}`, piece, (loaded) => onProgress?.(Math.min(0.99, (done + loaded) / blob.size)));
        break;
      } catch (e) {
        if (attempt >= 4 || (e.status >= 400 && e.status < 500)) throw e;
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1))); // weak network: wait and retry this piece
      }
    }
    done += piece.size;
  }
  const r = await api('POST', `/api/upload/${id}/finish`);
  onProgress?.(1);
  return r;
}

function uploadWhole(chatId, blob, name, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');
    xhr.withCredentials = true;
    xhr.setRequestHeader('x-pingme', '1');
    xhr.setRequestHeader('x-chat-id', String(chatId));
    xhr.setRequestHeader('x-file-name', encodeURIComponent(name || 'file'));
    xhr.setRequestHeader('content-type', blob.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(data.error || (xhr.status === 413 ? 'File is too large' : 'Upload failed'), xhr.status));
    };
    xhr.onerror = () => reject(new ApiError('Upload failed — check your connection', 0));
    xhr.send(blob);
  });
}

export function emit(event, data) {
  return new Promise((resolve, reject) => {
    if (!S.socket?.connected) return reject(new ApiError('Not connected — retrying…', 0));
    const t0 = performance.now();
    S.socket.timeout(20000).emit(event, data, (err, res) => {
      if (event === 'msg:send' && !err) track({ t: 'perf_send', v: Math.round(performance.now() - t0) }); // message send time
      if (err) return reject(new ApiError('Server did not respond', 0));
      if (!res?.ok) return reject(new ApiError(res?.error || 'Failed', 400));
      resolve(res);
    });
  });
}

export const user = (id) => S.users.get(id) || { id, name: 'Unknown', username: null, avatarV: 0 };
export const userAvatar = (id) => { const u = S.users.get(id); return u?.avatarV ? `/api/avatar/u/${id}?v=${u.avatarV}` : null; };
export const fileUrl = (att) => (att && S.localMedia.get(att.id)) || (att ? `/api/files/${att.id}` : '');

export function otherMember(chat) {
  if (!chat || chat.type !== 'direct') return null;
  const m = chat.members.find((x) => x.id !== S.me.id);
  return m ? m.id : null;
}

export function chatTitle(chat) {
  if (!chat) return '';
  if (chat.type === 'direct') {
    const o = otherMember(chat);
    return o ? user(o).name : 'Conversation';
  }
  if (chat.title && chat.title !== 'Group') return chat.title;
  const names = chat.members.filter((m) => m.id !== S.me.id).map((m) => user(m.id).name.split(' ')[0]);
  return names.length ? names.slice(0, 4).join(', ') + (names.length > 4 ? ` +${names.length - 4}` : '') : chat.title || 'Group';
}

export function chatAvatar(chat) {
  if (!chat) return null;
  if (chat.type === 'group') return chat.avatarV ? `/api/avatar/c/${chat.id}?v=${chat.avatarV}` : null;
  const o = otherMember(chat);
  return o ? userAvatar(o) : null;
}

export const isMuted = (chat) => chat && (chat.mutedUntil === -1 || chat.mutedUntil > Date.now());
export const isBlocked = (chat) => { const o = otherMember(chat); return !!o && S.blocked.has(o); };

export function mergeUsers(list) {
  for (const u of list || []) S.users.set(u.id, { ...(S.users.get(u.id) || {}), ...u });
}

export function prefs() {
  return {
    theme: store.get('theme', 'dark'),
    bubble: store.get('bubble', 'ink'),
    fontSize: store.get('fontSize', 17),
    enterSend: store.get('enterSend', !matchMedia('(pointer: coarse)').matches),
    sounds: store.get('sounds', true),
  };
}

export const BUBBLES = {
  ink: ['var(--ink-me)', 'var(--ink-me2)'],
  blue: ['#0a84ff', '#0a7cff'], green: ['#34c759', '#28b14c'], purple: ['#af52de', '#9a3fd0'], pink: ['#ff375f', '#f02e56'],
  orange: ['#ff9500', '#f28a00'], teal: ['#30b0c7', '#2399ae'], indigo: ['#5856d6', '#4b49c9'], graphite: ['#636366', '#4a4a4f'],
};

export function applyPrefs() {
  const p = prefs();
  const root = document.documentElement;
  if (p.theme === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', p.theme);
  const dark = p.theme === 'dark' || (p.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#000000' : '#ffffff');
  // "Ink" (default) follows the theme: black bubbles in light mode, white in dark — like the logo.
  const ink = p.bubble === 'ink' || !BUBBLES[p.bubble];
  const b = BUBBLES[p.bubble] || BUBBLES.ink;
  root.style.setProperty('--me', b[0]);
  root.style.setProperty('--me2', b[1]);
  for (const k of ['--accent', '--on-accent', '--me-text']) root.style.removeProperty(k);
  if (!ink) {
    root.style.setProperty('--me-text', '#ffffff');
    if (p.bubble !== 'graphite') { root.style.setProperty('--accent', b[0]); root.style.setProperty('--on-accent', '#ffffff'); }
  }
  root.style.setProperty('--fs', p.fontSize + 'px');
}

// Advanced features the user switched on (first-run setup / Settings → Features).
export const feature = (key) => S.me?.settings?.features?.[key] !== false;
