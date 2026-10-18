// Media helpers (photos and videos are always sent in original quality): video metadata, voice notes, screen effects, photo cropper.
import { h, openSheet } from './ui.js';

// ───── images ─────
const webpEncode = (() => {
  try { return document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp'); } catch { return false; }
})();

function loadImg(file) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => { res(img); URL.revokeObjectURL(img.src); };
    img.onerror = rej;
    img.src = URL.createObjectURL(file);
  });
}

export function videoMeta(file) {
  return new Promise((res) => {
    const v = document.createElement('video');
    v.preload = 'metadata'; v.muted = true; v.playsInline = true;
    const url = URL.createObjectURL(file);
    const done = (m) => { URL.revokeObjectURL(url); res(m); };
    v.onloadedmetadata = () => done({ w: v.videoWidth, h: v.videoHeight, dur: v.duration });
    v.onerror = () => done({});
    setTimeout(() => done({}), 5000);
    v.src = url;
  });
}

// Avatar: square crop, 384px, ~40KB.
export async function avatarDataUrl(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => loadImg(file));
  const s = Math.min(bmp.width, bmp.height);
  const c = document.createElement('canvas');
  c.width = c.height = 384;
  c.getContext('2d').drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, 384, 384);
  return c.toDataURL(webpEncode ? 'image/webp' : 'image/jpeg', 0.85);
}

// ───── profile / group photo cropper ─────
// Drag to position, pinch / scroll / slider to zoom, inside a circle. Returns a 1080×1080 HD data URL.
export async function cropImage(file, { title = 'Move and scale' } = {}) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { try { bmp = await loadImg(file); } catch { return null; } }
  const iw = bmp.width, ih = bmp.height;
  const SIZE = 280;
  const canvas = h('canvas', { class: 'crop-canvas', width: SIZE * 2, height: SIZE * 2 });
  canvas.style.width = canvas.style.height = SIZE + 'px';
  const ctx = canvas.getContext('2d');
  const minScale = SIZE / Math.min(iw, ih);
  let scale = minScale, x = (SIZE - iw * scale) / 2, y = (SIZE - ih * scale) / 2;
  const clamp = () => {
    x = Math.min(0, Math.max(SIZE - iw * scale, x));
    y = Math.min(0, Math.max(SIZE - ih * scale, y));
  };
  const draw = () => {
    clamp();
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, x, y, iw * scale, ih * scale);
  };
  const zoomTo = (ns, cx = SIZE / 2, cy = SIZE / 2) => {
    ns = Math.min(minScale * 5, Math.max(minScale, ns));
    x = cx - ((cx - x) / scale) * ns;
    y = cy - ((cy - y) / scale) * ns;
    scale = ns; draw();
    slider.value = String(scale / minScale);
  };
  const slider = h('input', { type: 'range', min: '1', max: '5', step: '0.01', value: '1', class: 'crop-zoom', 'aria-label': 'Zoom' });
  slider.oninput = () => zoomTo(minScale * Number(slider.value));
  // drag + pinch
  const pts = new Map();
  let pinch0 = null;
  canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y), s: scale }; } });
  canvas.addEventListener('pointermove', (e) => {
    const prev = pts.get(e.pointerId);
    if (!prev) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2 && pinch0) { const [a, b] = [...pts.values()]; zoomTo(pinch0.s * Math.hypot(a.x - b.x, a.y - b.y) / pinch0.d); return; }
    x += e.clientX - prev.x; y += e.clientY - prev.y; draw();
  });
  const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch0 = null; };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); const r = canvas.getBoundingClientRect(); zoomTo(scale * (e.deltaY < 0 ? 1.08 : 0.93), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  draw();
  return new Promise((resolve) => {
    let result = null;
    openSheet({
      title, left: { label: 'Cancel' },
      right: { label: 'Choose', onClick: (close) => {
        const out = document.createElement('canvas');
        out.width = out.height = 1080;
        const k = 1080 / SIZE;
        const o = out.getContext('2d');
        o.imageSmoothingQuality = 'high';
        o.drawImage(bmp, x * k, y * k, iw * scale * k, ih * scale * k);
        // HD profile photo; only steps down if it wouldn't fit the upload limit.
        for (const q of [0.95, 0.92, 0.88]) { result = out.toDataURL(webpEncode ? 'image/webp' : 'image/jpeg', q); if (result.length < 1_900_000) break; }
        close();
      } },
      body: h('div', { class: 'crop' },
        h('div', { class: 'crop-frame' }, canvas, h('div', { class: 'crop-mask' })),
        h('div', { class: 'crop-ctrl' }, h('span', null, '−'), slider, h('span', null, '+')),
        h('p', { class: 'muted small center' }, 'Drag to move · pinch, scroll or slide to zoom')),
      onClose: () => { bmp.close?.(); resolve(result); },
    });
  });
}

// ───── voice notes ─────
// AAC/MP4 first: plays everywhere incl. iOS. Opus/WebM as fallback.
const AUDIO_TYPES = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];

export class VoiceRecorder {
  constructor(onLevel) { this.onLevel = onLevel; this.levels = []; }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: { ideal: 48000 } } });
    const type = AUDIO_TYPES.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || '';
    this.rec = new MediaRecorder(this.stream, { mimeType: type || undefined, audioBitsPerSecond: 192000 }); // HD voice
    this.chunks = [];
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.start(250);
    this.startedAt = performance.now();
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ac = new AC();
    const src = this.ac.createMediaStreamSource(this.stream);
    this.an = this.ac.createAnalyser();
    this.an.fftSize = 512;
    src.connect(this.an);
    const buf = new Uint8Array(this.an.fftSize);
    this.timer = setInterval(() => {
      this.an.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += ((v - 128) / 128) ** 2;
      const lvl = Math.min(1, Math.sqrt(sum / buf.length) * 3.2);
      this.levels.push(lvl);
      this.onLevel?.(lvl, (performance.now() - this.startedAt) / 1000);
    }, 80);
  }

  async stop() {
    clearInterval(this.timer);
    const dur = (performance.now() - this.startedAt) / 1000;
    const blob = await new Promise((res) => {
      this.rec.onstop = () => res(new Blob(this.chunks, { type: this.rec.mimeType || 'audio/webm' }));
      this.rec.stop();
    });
    this.cleanup();
    return { blob, dur, wave: downsample(this.levels, 48) };
  }

  cancel() {
    clearInterval(this.timer);
    try { this.rec?.stop(); } catch {}
    this.cleanup();
  }

  cleanup() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ac?.close().catch(() => {});
  }
}

function downsample(arr, n) {
  if (!arr.length) return Array(n).fill(0.1);
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i * arr.length) / n), b = Math.max(a + 1, Math.floor(((i + 1) * arr.length) / n));
    let m = 0;
    for (let j = a; j < b && j < arr.length; j++) m = Math.max(m, arr[j]);
    out.push(Math.round(Math.max(0.08, m) * 100) / 100);
  }
  return out;
}

// One shared player so voice notes keep playing across re-renders, and only one plays at a time.
export const player = {
  audio: null, id: null, rate: 1, listeners: new Set(),
  toggle(id, url) {
    if (this.id === id && this.audio) {
      if (this.audio.paused) this.audio.play(); else this.audio.pause();
      return;
    }
    this.stop();
    this.id = id;
    this.audio = new Audio(url);
    this.audio.playbackRate = this.rate;
    this.audio.preservesPitch = true;
    ['timeupdate', 'play', 'pause', 'ended', 'loadedmetadata'].forEach((ev) => this.audio.addEventListener(ev, () => this.emit()));
    this.audio.addEventListener('ended', () => { this.id = null; this.emit(); });
    this.audio.play().catch(() => {});
  },
  seek(id, frac) { if (this.id === id && this.audio?.duration) this.audio.currentTime = frac * this.audio.duration; },
  cycleRate() { this.rate = this.rate === 1 ? 1.5 : this.rate === 1.5 ? 2 : 1; if (this.audio) this.audio.playbackRate = this.rate; this.emit(); },
  stop() { if (this.audio) { this.audio.pause(); this.audio.src = ''; } this.audio = null; this.id = null; this.emit(); },
  emit() { for (const l of this.listeners) l(); },
  state(id) {
    if (this.id !== id || !this.audio) return { playing: false, t: 0, frac: 0 };
    const d = this.audio.duration || 0;
    return { playing: !this.audio.paused, t: this.audio.currentTime, frac: d ? this.audio.currentTime / d : 0 };
  },
};

// ───── full-screen effects ─────

export const SCREEN_EFFECTS = {
  confetti: 'Confetti', balloons: 'Balloons', hearts: 'Love', fireworks: 'Fireworks', lasers: 'Lasers', celebrate: 'Celebration',
};
export const BUBBLE_EFFECTS = { slam: 'Slam', loud: 'Loud', gentle: 'Gentle', ink: 'Invisible Ink' };

export function playScreenEffect(name) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  document.getElementById('fx-canvas')?.remove();
  const c = document.createElement('canvas');
  c.id = 'fx-canvas';
  const dpr = Math.min(2, devicePixelRatio || 1);
  c.width = innerWidth * dpr; c.height = innerHeight * dpr;
  c.style.width = innerWidth + 'px'; c.style.height = innerHeight + 'px';
  document.body.append(c);
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  const W = innerWidth, H = innerHeight;
  const parts = [];
  const rnd = (a, b) => a + Math.random() * (b - a);
  const colors = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#0a84ff', '#af52de', '#ff2d55'];
  let duration = 3800;

  if (name === 'confetti') {
    for (let i = 0; i < 180; i++) parts.push({ x: rnd(0, W), y: rnd(-H, 0), vx: rnd(-1, 1), vy: rnd(2, 5), r: rnd(0, 6.28), vr: rnd(-0.2, 0.2), w: rnd(6, 11), h: rnd(8, 16), c: colors[i % colors.length] });
  } else if (name === 'balloons') {
    for (let i = 0; i < 26; i++) parts.push({ x: rnd(0, W), y: H + rnd(0, H * 0.8), vy: rnd(-3.2, -1.8), sw: rnd(0, 6.28), s: rnd(36, 64), e: '🎈' });
  } else if (name === 'hearts') {
    for (let i = 0; i < 40; i++) parts.push({ x: rnd(0, W), y: H + rnd(0, H * 0.6), vy: rnd(-3, -1.4), sw: rnd(0, 6.28), s: rnd(22, 52), e: ['❤️', '💖', '💕', '💗'][i % 4] });
  } else if (name === 'celebrate') {
    for (let i = 0; i < 50; i++) parts.push({ x: rnd(0, W), y: rnd(-H * 0.8, 0), vy: rnd(1.5, 4), sw: rnd(0, 6.28), s: rnd(22, 44), e: ['🎉', '✨', '🥳', '⭐️', '🎊'][i % 5] });
  } else if (name === 'fireworks') {
    duration = 4200;
    const burst = (x, y) => { const c = colors[Math.floor(rnd(0, colors.length))]; for (let i = 0; i < 70; i++) { const a = (i / 70) * 6.28, sp = rnd(2, 6); parts.push({ fw: 1, x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, c }); } };
    for (let k = 0; k < 7; k++) setTimeout(() => burst(rnd(W * 0.15, W * 0.85), rnd(H * 0.15, H * 0.5)), k * 450);
  } else if (name === 'lasers') {
    duration = 3200;
  }

  const t0 = performance.now();
  (function frame(t) {
    const el = t - t0;
    ctx.clearRect(0, 0, W, H);
    if (name === 'lasers') {
      ctx.fillStyle = `rgba(0,0,0,${Math.min(0.55, el / 600) * (el > duration - 600 ? (duration - el) / 600 : 1)})`;
      ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < 8; i++) {
        const a = Math.sin(el / 400 + i) * 0.9 + Math.PI / 2;
        ctx.strokeStyle = colors[i % colors.length]; ctx.lineWidth = 4; ctx.shadowBlur = 20; ctx.shadowColor = ctx.strokeStyle;
        ctx.beginPath(); ctx.moveTo(W / 2, -20); ctx.lineTo(W / 2 + Math.cos(a) * H * 1.6, Math.sin(a) * H * 1.6); ctx.stroke();
      }
      ctx.shadowBlur = 0;
    }
    for (const p of parts) {
      if (p.fw) {
        p.x += p.vx; p.y += p.vy; p.vy += 0.05; p.vx *= 0.985; p.life -= 0.012;
        if (p.life <= 0) continue;
        ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = p.c;
        ctx.beginPath(); ctx.arc(p.x, p.y, 2.4, 0, 6.28); ctx.fill();
      } else if (p.e) {
        p.y += p.vy; p.sw += 0.04; ctx.globalAlpha = 1;
        ctx.font = `${p.s}px serif`; ctx.fillText(p.e, p.x + Math.sin(p.sw) * 18, p.y);
      } else {
        p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c;
        ctx.fillRect(-p.w / 2, -p.h / 2 * Math.abs(Math.cos(p.r * 2)), p.w, p.h * Math.abs(Math.cos(p.r * 2)));
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
    if (el < duration) requestAnimationFrame(frame);
    else c.remove();
  })(t0);
}

// ───── sounds ─────
// Ping Me's own sound set (public/sounds, generated by scripts/gen-sounds.js), played through
// Web Audio for low latency. Audio is unlocked on the first tap (iOS/Chrome autoplay rules).

const SOUND_FILES = ['message', 'tick', 'sent', 'ringtone', 'ringback', 'join', 'end', 'ping'];
let actx = null;
const buffers = new Map();

function ac() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!actx || actx.state === 'closed') {
    actx = new AC();
    actx.onstatechange = () => reportAudio();
  }
  // iPhone uses "interrupted" (after calls, other apps' audio, backgrounding) as well as "suspended".
  if (actx.state !== 'running') actx.resume().then(reportAudio).catch(() => {});
  return actx;
}

// Sounds that aren't generated WAVs (the message sound is a recorded notification tone).
const SOUND_EXT = { message: 'mp3' };
const soundUrl = (name) => `/sounds/${name}.${SOUND_EXT[name] || 'wav'}`;

async function loadSounds() {
  const a = ac();
  if (!a) return;
  await Promise.all(SOUND_FILES.map(async (name) => {
    if (buffers.has(name)) return;
    try {
      const data = await fetch(soundUrl(name)).then((r) => r.arrayBuffer());
      buffers.set(name, await new Promise((res, rej) => a.decodeAudioData(data, res, rej)));
    } catch {}
  }));
}

// Audio elements "unlocked" by a tap, used whenever the Web Audio engine isn't running (iPhone only lets
// a page play sound programmatically through elements that were started once during a tap).
const primed = new Map();
function prime() {
  for (const name of SOUND_FILES) {
    if (primed.has(name)) continue;
    const el = new Audio(soundUrl(name));
    el.preload = 'auto'; el.muted = true; el.setAttribute('playsinline', '');
    el.play().then(() => { el.pause(); el.currentTime = 0; el.muted = false; }).catch(() => { el.muted = false; });
    primed.set(name, el);
  }
}

// Every tap (not just the first) re-wakes sound: iPhone silences pages after calls or backgrounding.
['pointerdown', 'keydown', 'touchend'].forEach((ev) => addEventListener(ev, () => {
  const a = ac();
  if (a && (a.state !== 'running' || buffers.size < SOUND_FILES.length)) loadSounds().then(reportAudio);
  if (primed.size < SOUND_FILES.length) prime();
}, { capture: true, passive: true }));

// The service worker skips the system call notification only when the open app can ring by itself —
// so it's told the truth, often, and the claim expires quickly (see sw.js).
function reportAudio() {
  const ok = !!actx && actx.state === 'running' && !document.hidden && buffers.has('ringtone');
  navigator.serviceWorker?.controller?.postMessage({ type: 'audio', ready: ok });
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) ac(); reportAudio(); });
setInterval(() => { if (!document.hidden) reportAudio(); }, 15000);

function play(name, { loop = false, volume = 1 } = {}) {
  const a = ac();
  const buf = buffers.get(name);
  if (!a || !buf || a.state !== 'running') {
    // Engine not running yet: use the tap-unlocked element (or a fresh one as a last resort).
    let el = primed.get(name);
    if (!el || (!el.paused && !loop)) el = el ? el.cloneNode(true) : new Audio(soundUrl(name));
    el.loop = loop; el.volume = volume; el.muted = false;
    try { el.currentTime = 0; } catch {}
    el.play().catch(() => {});
    return { stop: () => { el.pause(); try { el.currentTime = 0; } catch {} el.loop = false; } };
  }
  const src = a.createBufferSource();
  const g = a.createGain();
  g.gain.value = volume;
  src.buffer = buf; src.loop = loop;
  src.connect(g).connect(a.destination);
  src.start();
  return { stop: () => { try { src.stop(); } catch {} } };
}

// Browsers only allow vibration after the person has interacted with the page.
const buzz = (pattern) => { if (navigator.userActivation?.hasBeenActive !== false) navigator.vibrate?.(pattern); };

// For diagnostics/tests: the current Web Audio state.
export const audioState = () => actx?.state || 'none';

export const sounds = {
  _loop: null,
  message() { play('message', { volume: 0.8 }); buzz([180, 100, 180]); },
  tick() { play('tick', { volume: 0.5 }); buzz(60); },
  sent() { play('sent', { volume: 0.45 }); },
  ping() { play('ping', { volume: 0.9 }); buzz([60, 80, 60, 80, 220]); },
  ringtone() {
    this.stopLoop();
    // iPhone: let the ringtone play even when the silent switch is on (like call apps).
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
    this._loop = play('ringtone', { loop: true });
    const ring = () => buzz([800, 400, 800]);
    ring(); this._vib = setInterval(ring, 2600);
  },
  ringback() { this.stopLoop(); this._loop = play('ringback', { loop: true, volume: 0.35 }); },
  stopLoop() {
    this._loop?.stop(); this._loop = null; clearInterval(this._vib); buzz(0);
    try { if (navigator.audioSession) navigator.audioSession.type = 'auto'; } catch {}
  },
  unlocked: () => !!actx && actx.state === 'running',
  // After a call the phone leaves "call audio" mode; bring app sounds back to normal playback.
  afterCall() {
    try { if (navigator.audioSession) navigator.audioSession.type = 'auto'; } catch {}
    setTimeout(() => { ac(); reportAudio(); }, 400);
  },
  hangup() { play('end', { volume: 0.7 }); },
  join() { play('join', { volume: 0.6 }); },
  received() { this.message(); },
};

// ───── small previews for chat bubbles ─────
// Bubbles show a ~480px preview; the full photo/video loads only in the viewer. Full-size 4K/12MP
// images and live <video> elements in a long chat use so much graphics memory that iPhone Safari
// stops drawing parts of the chat (it looked blank and flickered while scrolling).
const THUMB = 480;
function drawThumb(src, w, hgt) {
  const k = Math.min(1, THUMB / Math.max(w, hgt));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(hgt * k));
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob((b) => { c.width = c.height = 0; r(b); }, 'image/jpeg', 0.72));
}

export async function makeThumb(blob, kind, { at = 0.1 } = {}) {
  try {
    if (kind === 'image') {
      const bmp = await createImageBitmap(blob);
      // One decode gives both the preview and the photo's real size (srcW/srcH) for the layout.
      try { const b = await drawThumb(bmp, bmp.width, bmp.height); if (b) { b.srcW = bmp.width; b.srcH = bmp.height; } return b; } finally { bmp.close?.(); }
    }
    if (kind === 'video') {
      // A string is a server URL: the video element streams just the start (range requests).
      const own = typeof blob !== 'string';
      const url = own ? URL.createObjectURL(blob) : blob;
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.preload = 'auto';
      try {
        await new Promise((res, rej) => {
          const t = setTimeout(() => rej(new Error('timeout')), 8000);
          v.onloadeddata = () => { v.currentTime = Math.min(at, Math.max(0, (v.duration || 1) - 0.1)); };
          v.onseeked = () => { clearTimeout(t); res(); };
          v.onerror = () => { clearTimeout(t); rej(new Error('video')); };
          v.src = url;
        });
        return await drawThumb(v, v.videoWidth, v.videoHeight);
      } finally { v.removeAttribute('src'); v.load(); if (own) URL.revokeObjectURL(url); }
    }
  } catch {}
  return null;
}

// Previews for older messages that were sent without one: made on this phone, one at a time,
// only when the bubble scrolls near the screen.
const thumbCache = new Map(); // key → object URL
let thumbQueue = Promise.resolve();
const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { io.unobserve(e.target); e.target._makeThumb?.(); }
}, { rootMargin: '400px 0px' }) : null;

export function lazyThumb(el, { key, url, kind, at, onReady }) {
  if (thumbCache.has(key)) { onReady(thumbCache.get(key)); return; }
  el._makeThumb = () => {
    thumbQueue = thumbQueue.then(async () => {
      if (thumbCache.has(key)) return onReady(thumbCache.get(key));
      if (!el.isConnected) return;
      try {
        const src = kind === 'video' ? url : await (await fetch(url, { credentials: 'same-origin' })).blob();
        const t = await makeThumb(src, kind, { at });
        if (!t) return;
        const u = URL.createObjectURL(t);
        thumbCache.set(key, u);
        onReady(u);
      } catch {}
    });
  };
  if (io) io.observe(el); else el._makeThumb();
}
