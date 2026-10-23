// QR codes: your own Ping Me code, a camera scanner to add friends, and spotting Ping Me codes
// inside photos people send in a chat. Everything runs on the device.
import { h, icon, toast, avatar, openSheet, registerLayer, confirmDialog } from './ui.js';
import { S, api } from './core.js';
import { ensurePermission } from './perm.js';

const libs = new Map();
function lib(src, global) {
  if (!libs.has(src)) {
    libs.set(src, new Promise((res, rej) => {
      if (window[global]) return res(window[global]);
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = () => res(window[global]);
      s.onerror = () => { libs.delete(src); rej(new Error('Couldn’t load the QR tools — check your connection')); };
      document.head.append(s);
    }));
  }
  return libs.get(src);
}
const encoderLib = () => lib('/vendor/qrcode-generator-1.4.4.js', 'qrcode');
const decoderLib = () => lib('/vendor/jsQR-1.4.0.js', 'jsQR');

export const myCodeUrl = (username) => `${location.origin}/?add=${encodeURIComponent(username)}`;

// The username inside a Ping Me QR code, or null if it isn't one.
export function pingMeUsername(text) {
  try {
    const u = new URL(String(text).trim());
    const add = u.searchParams.get('add');
    if (add && (u.origin === location.origin || /pingme/i.test(u.hostname))) return add.trim().toLowerCase();
  } catch {}
  return null;
}

// Opens a chat with that person (app.js does the lookup).
// A "log in on a computer" code (shown on the computer's sign-in screen).
export function linkCode(text) {
  try {
    const u = new URL(String(text).trim());
    const l = u.searchParams.get('link');
    if (l && /^[\w]{6,20}\.[\w]{6,24}$/.test(l) && (u.origin === location.origin || /pingme/i.test(u.hostname))) return l;
  } catch {}
  return null;
}
// The phone approves a computer: say which computer it is, ask, then link it.
export async function approveLink(link) {
  try {
    const { device } = await api('POST', '/api/link/info', { link });
    const ok = await confirmDialog(`Log in to Ping Me on ${device}?\n\nOnly approve a code shown on your own computer. It will see your chats and get your notifications until you log it out (Settings → Active devices).`, { ok: 'Log in' });
    if (!ok) return;
    await api('POST', '/api/link/approve', { link });
    toast(`${device} is now logged in`, { timeout: 2500 });
  } catch (e) { toast(e.message, { error: true }); }
}

export function addFromCode(username) {
  if (username === S.me?.username) { toast('That’s your own Ping Me code'); return; }
  dispatchEvent(new CustomEvent('pm:add-user', { detail: username }));
}

// ───── drawing ─────

const loadImg = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });

export async function drawCode(text, size = 260) {
  const qrcode = await encoderLib();
  const qr = qrcode(0, 'H'); // high error correction, so the logo in the middle doesn't matter
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount(), quiet = 2;
  const cell = Math.max(4, Math.floor((size * Math.min(3, devicePixelRatio || 1)) / (n + quiet * 2)));
  const px = (n + quiet * 2) * cell;
  const c = h('canvas', { class: 'qr-canvas', width: px, height: px });
  c.style.width = c.style.height = size + 'px';
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = '#000';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) ctx.fillRect((x + quiet) * cell, (y + quiet) * cell, cell, cell);
  const logo = await loadImg('/icons/icon-192.png');
  if (logo) {
    const L = Math.round(px * 0.22), o = (px - L) / 2, pad = Math.round(cell * 0.8);
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.roundRect?.(o - pad, o - pad, L + pad * 2, L + pad * 2, L * 0.28); ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.roundRect?.(o, o, L, L, L * 0.22); ctx.clip();
    ctx.drawImage(logo, o, o, L, L); ctx.restore();
  }
  return c;
}

// ───── decoding ─────

let detector;
async function nativeDetector() {
  if (detector !== undefined) return detector;
  detector = null;
  try {
    if ('BarcodeDetector' in window && (await window.BarcodeDetector.getSupportedFormats()).includes('qr_code')) {
      detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    }
  } catch {}
  return detector;
}

// Every QR text found in an <img>, <video>, <canvas> or ImageBitmap.
export async function decodeQr(source, w, hgt) {
  const d = await nativeDetector();
  if (d) {
    try { return (await d.detect(source)).map((r) => r.rawValue); } catch {}
  }
  const jsQR = await decoderLib();
  const scale = Math.min(1, 1000 / Math.max(w, hgt));
  const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(hgt * scale));
  const c = document.createElement('canvas');
  c.width = cw; c.height = ch;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, cw, ch);
  const r = jsQR(ctx.getImageData(0, 0, cw, ch).data, cw, ch, { inversionAttempts: 'attemptBoth' });
  return r ? [r.data] : [];
}

async function decodeFile(file) {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return [];
  try { return await decodeQr(bmp, bmp.width, bmp.height); } finally { bmp.close?.(); }
}

// Photos in chats: look for a Ping Me code once per photo, one at a time, when the phone is idle.
const seen = new Map(); // message id -> username | null
let queue = Promise.resolve();
export function scanChatImage(msgId, img, onFound) {
  if (seen.has(msgId)) { const u = seen.get(msgId); if (u) onFound(u); return; }
  const run = () => {
    queue = queue.then(() => new Promise((res) => {
      const idle = window.requestIdleCallback || ((f) => setTimeout(f, 50));
      idle(async () => {
        let user = null;
        try {
          if (img.isConnected && img.naturalWidth) {
            for (const t of await decodeQr(img, img.naturalWidth, img.naturalHeight)) { user = pingMeUsername(t); if (user) break; }
          }
        } catch {}
        seen.set(msgId, user);
        if (user && user !== S.me?.username) onFound(user);
        res();
      });
    }));
  };
  if (img.complete && img.naturalWidth) run(); else img.addEventListener('load', run, { once: true });
}

// ───── screens ─────

export async function openMyCode() {
  const me = S.me;
  const url = myCodeUrl(me.username);
  const holder = h('div', { class: 'qr-holder' }, h('div', { class: 'spinner' }));
  const s = openSheet({ title: 'My QR code', left: { label: 'Done' }, className: 'qr-sheet' });
  s.body.append(
    h('div', { class: 'qr-card' },
      avatar({ id: me.id, name: me.name, src: me.avatarV ? `/api/avatar/u/${me.id}?v=${me.avatarV}` : null, size: 64 }),
      h('b', null, me.name),
      h('span', { class: 'muted' }, '@' + me.username),
      holder,
      h('p', { class: 'muted small' }, 'Friends scan this in Ping Me to add you. Works with any phone camera too.')),
    h('div', { class: 'qr-actions' },
      h('button', { class: 'btn', onclick: () => { s.close(); openScanner(); } }, icon('scan'), 'Scan a code'),
      h('button', { class: 'btn secondary', onclick: () => shareCode(holder.querySelector('canvas'), url, me) }, icon('share'), 'Share')));
  try { holder.replaceChildren(await drawCode(url)); } catch (e) { holder.replaceChildren(h('p', { class: 'muted' }, e.message)); }
}

async function shareCode(canvas, url, me) {
  const text = `Add me on Ping Me — @${me.username}`;
  try {
    const blob = canvas && (await new Promise((r) => canvas.toBlob(r, 'image/png')));
    const file = blob && new File([blob], `pingme-${me.username}.png`, { type: 'image/png' });
    if (file && navigator.canShare?.({ files: [file] })) return await navigator.share({ files: [file], text: `${text}\n${url}` });
    if (navigator.share) return await navigator.share({ title: 'Ping Me', text, url });
    await navigator.clipboard.writeText(url);
    toast('Link copied');
  } catch (e) { if (e?.name !== 'AbortError') toast('Couldn’t share', { error: true }); }
}

export async function openScanner() {
  if (!(await ensurePermission(['camera'], 'To scan a friend’s Ping Me QR code. Nothing is recorded or sent.'))) return;
  const video = h('video', { autoplay: true, playsinline: true, muted: true });
  video.muted = true;
  const status = h('div', { class: 'qs-status' }, 'Point your camera at a Ping Me QR code — a friend’s, or the one on your computer to log in there');
  const file = h('input', { type: 'file', accept: 'image/*', hidden: true });
  let stream = null, timer = null, closed = false, busy = false;
  const handle = (texts) => {
    if (closed) return false;
    const link = texts.map(linkCode).find(Boolean);
    if (link) { navigator.vibrate?.(40); close(); approveLink(link); return true; }
    const user = texts.map(pingMeUsername).find(Boolean);
    if (user) {
      navigator.vibrate?.(40);
      close();
      addFromCode(user);
      return true;
    }
    if (texts.length) status.textContent = 'That’s not a Ping Me code';
    return false;
  };
  file.onchange = async () => {
    const f = file.files[0];
    file.value = '';
    if (!f) return;
    status.textContent = 'Looking for a code…';
    const texts = await decodeFile(f).catch(() => []);
    if (!handle(texts) && !texts.length) status.textContent = 'No QR code found in that photo';
  };
  const root = h('div', { class: 'qr-scan', role: 'dialog', 'aria-label': 'Scan QR code' },
    video,
    h('div', { class: 'qs-frame' }, h('i'), h('i'), h('i'), h('i')),
    h('div', { class: 'qs-top' },
      h('button', { class: 'qs-x', 'aria-label': 'Close', onclick: () => close() }, icon('x')),
      h('b', null, 'Scan QR code')),
    h('div', { class: 'qs-bottom' }, status,
      h('div', { class: 'qs-btns' },
        h('button', { onclick: () => file.click() }, icon('image'), 'From photos'),
        h('button', { onclick: () => { close(); openMyCode(); } }, icon('qr'), 'My code'))),
    file);
  const unregister = registerLayer(() => close());
  function close() {
    if (closed) return;
    closed = true;
    unregister();
    clearInterval(timer);
    stream?.getTracks().forEach((t) => t.stop());
    root.remove();
  }
  document.body.append(root);
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    if (closed) return stream.getTracks().forEach((t) => t.stop());
    video.srcObject = stream;
    await video.play().catch(() => {});
    timer = setInterval(async () => {
      if (busy || closed || video.readyState < 2) return;
      busy = true;
      try { handle(await decodeQr(video, video.videoWidth, video.videoHeight)); } catch {}
      busy = false;
    }, 220);
  } catch (e) {
    status.textContent = e?.name === 'NotAllowedError' ? 'Allow camera access to scan — or pick a photo of the code' : 'Camera unavailable — pick a photo of the code instead';
  }
}
