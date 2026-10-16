// Usage analytics for the owner's admin portal: which screen is open and for how long, plus Buzz
// stories seen/opened. Activity only — never message text, never call content.
import { isIOS, isAndroid, isStandalone } from './ui.js';

let api = null, socket = null, queue = [], base = 'chats', overlays = [], since = 0, started = false;
const sid = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-6);
const platform = isIOS() ? 'ios' : isAndroid() ? 'android' : /Mobi/i.test(navigator.userAgent) ? 'other' : 'desktop';
const current = () => overlays[overlays.length - 1] || base;

function endSegment() {
  if (!since) return;
  const secs = Math.round((Date.now() - since) / 1000);
  if (secs >= 1) queue.push({ t: 'screen', s: current(), v: secs });
  since = 0;
}
function beginSegment() {
  if (document.hidden) return;
  since = Date.now();
  socket?.connected && socket.emit('screen', { s: current(), p: platform, a: isStandalone() });
}

export function track(ev) { if (started) queue.push(ev); }

function flush(keepalive = false) {
  if (!api || !queue.length) return;
  const events = queue.splice(0, 60);
  fetch('/api/t', { method: 'POST', keepalive, credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-pingme': '1' }, body: JSON.stringify({ sid, events }) })
    .catch(() => { if (queue.length < 300) queue.unshift(...events); });
}

export function initAnalytics(opts) {
  ({ api, socket } = opts);
  if (started) return;
  started = true;
  queue.push({ t: 'session', p: platform, a: isStandalone() });
  beginSegment();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { endSegment(); flush(true); } else beginSegment();
  });
  addEventListener('pagehide', () => { endSegment(); flush(true); });
  setInterval(() => { if (!document.hidden) { endSegment(); beginSegment(); } flush(); }, 20000);
}

export function setSocket(s) { socket = s; s?.on('connect', () => s.emit('screen', { s: current(), p: platform, a: isStandalone() })); }

// The main screen: chats list, a chat, a group, or Buzz.
export function setScreen(name) {
  if (name === base && !overlays.length) return;
  endSegment(); base = name; beginSegment();
}
// Full-screen things on top (call, camera, settings) — push when opened, pop when closed.
export function pushScreen(name) { endSegment(); overlays.push(name); beginSegment(); }
export function popScreen(name) {
  const i = overlays.lastIndexOf(name);
  if (i < 0) return;
  endSegment(); overlays.splice(i, 1); beginSegment();
}
