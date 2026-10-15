// Private viewing:
//  • Screenshot-proof text — letters are drawn as noise that keeps moving while the background noise
//    stays still. Your eyes see the words through the motion; a screenshot captures only static.
//  • Eyes-only — content shows only while the front camera sees exactly one face; a second face
//    (shoulder-surfer) or no face hides it instantly. Face detection runs on the device.
import { h, icon, registerLayer } from './ui.js';

const CELL = 2; // CSS px per noise cell

function wrapLines(ctx, text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      const test = line + word;
      if (ctx.measureText(test).width > maxW && line.trim()) { out.push(line.trimEnd()); line = word.trimStart(); }
      else line = test;
    }
    out.push(line);
  }
  return out;
}

export function secureText(text, { maxWidth = 240, color = '#000', fontSize = 20 } = {}) {
  const font = `700 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = font;
  const lines = wrapLines(probe, text, maxWidth);
  const lineH = Math.round(fontSize * 1.35);
  const w = Math.ceil(Math.min(maxWidth, Math.max(60, ...lines.map((l) => probe.measureText(l).width))) + 8);
  const hgt = lines.length * lineH + 8;
  // Text mask at cell resolution.
  const gw = Math.ceil(w / CELL), gh = Math.ceil(hgt / CELL);
  const mc = document.createElement('canvas');
  mc.width = w; mc.height = hgt;
  const m = mc.getContext('2d');
  m.font = font; m.fillStyle = '#000'; m.textBaseline = 'top';
  lines.forEach((l, i) => m.fillText(l, 4, 4 + i * lineH + 2));
  const md = m.getImageData(0, 0, w, hgt).data;
  const mask = new Uint8Array(gw * gh);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    const px = Math.min(w - 1, x * CELL + 1), py = Math.min(hgt - 1, y * CELL + 1);
    mask[y * gw + x] = md[(py * w + px) * 4 + 3] > 90 ? 1 : 0;
  }
  const bg = new Uint8Array(gw * gh).map(() => (Math.random() < 0.5 ? 1 : 0));
  const fieldH = gh * 2;
  const field = new Uint8Array(gw * fieldH).map(() => (Math.random() < 0.5 ? 1 : 0));

  const canvas = h('canvas', { class: 'secure-canvas', width: gw, height: gh, 'aria-label': 'Private message (screenshot-proof)' });
  canvas.style.width = gw * CELL + 'px';
  canvas.style.height = gh * CELL + 'px';
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(gw, gh);
  const rgb = parseColor(color);
  let offset = 0, raf = 0, visible = false;
  const frame = () => {
    offset = (offset + 1) % fieldH;
    const d = img.data;
    for (let y = 0; y < gh; y++) {
      const fy = ((y - offset) % fieldH + fieldH) % fieldH;
      for (let x = 0; x < gw; x++) {
        const i = y * gw + x;
        const on = mask[i] ? field[fy * gw + x] : bg[i];
        const o = i * 4;
        d[o] = rgb[0]; d[o + 1] = rgb[1]; d[o + 2] = rgb[2]; d[o + 3] = on ? 255 : 0;
      }
    }
    ctx.putImageData(img, 0, 0);
    if (visible && !document.hidden && canvas.isConnected) raf = requestAnimationFrame(frame);
  };
  const io = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    cancelAnimationFrame(raf);
    if (visible) raf = requestAnimationFrame(frame);
  });
  io.observe(canvas);
  document.addEventListener('visibilitychange', () => { cancelAnimationFrame(raf); if (visible && !document.hidden) raf = requestAnimationFrame(frame); });
  return canvas;
}

function parseColor(c) {
  const el = document.createElement('div');
  el.style.color = c;
  document.body.append(el);
  const m = getComputedStyle(el).color.match(/\d+/g) || [0, 0, 0];
  el.remove();
  return m.slice(0, 3).map(Number);
}

// ───── eyes-only ─────

const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';
let detectorPromise = null;

async function getDetector() {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      if ('FaceDetector' in window) {
        try { const fd = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 4 }); return { count: async (v) => (await fd.detect(v)).length }; } catch {}
      }
      const vision = await import(`${MP}/vision_bundle.mjs`);
      const files = await vision.FilesetResolver.forVisionTasks(`${MP}/wasm`);
      const make = (delegate) => vision.FaceDetector.createFromOptions(files, { baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'VIDEO', minDetectionConfidence: 0.55 });
      const det = await make('GPU').catch(() => make('CPU'));
      return { count: async (v) => det.detectForVideo(v, performance.now()).detections.length };
    })().catch((e) => { detectorPromise = null; throw e; });
  }
  return detectorPromise;
}

export function openEyesOnly(renderContent) {
  const status = h('div', { class: 'eo-status' }, 'Starting face check…');
  const video = h('video', { autoplay: true, playsinline: true, muted: true });
  video.muted = true;
  const content = h('div', { class: 'eo-content hidden' });
  const root = h('div', { class: 'eo', role: 'dialog', 'aria-label': 'Eyes-only message' },
    h('div', { class: 'eo-top' },
      h('button', { class: 'eo-close', 'aria-label': 'Close', onclick: () => close() }, icon('x')),
      h('div', { class: 'eo-title' }, icon('eye'), 'Eyes-only'),
      h('div', { class: 'eo-cam' }, video)),
    content, status);
  let stream = null, timer = null, closed = false;
  const unregister = registerLayer(() => close());
  function close() {
    if (closed) return;
    closed = true; unregister();
    clearInterval(timer);
    stream?.getTracks().forEach((t) => t.stop());
    root.remove();
    document.removeEventListener('visibilitychange', onHide);
  }
  const onHide = () => { if (document.hidden) close(); };
  document.addEventListener('visibilitychange', onHide);
  document.body.append(root);
  const set = (state, msg) => {
    content.classList.toggle('hidden', state !== 'ok');
    content.classList.toggle('blocked', state === 'many');
    status.textContent = msg;
    status.className = 'eo-status ' + state;
  };
  (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      if (closed) return stream.getTracks().forEach((t) => t.stop());
      video.srcObject = stream;
      await video.play().catch(() => {});
      set('wait', 'Loading face check…');
      const det = await getDetector();
      if (closed) return;
      content.replaceChildren(renderContent());
      let busy = false;
      timer = setInterval(async () => {
        if (busy || video.readyState < 2) return;
        busy = true;
        try {
          const n = await det.count(video);
          if (n === 1) set('ok', 'Only you can see this');
          else if (n === 0) set('wait', 'Look at the screen to read');
          else set('many', 'Someone else is looking — hidden');
        } catch {}
        busy = false;
      }, 180);
    } catch (e) {
      set('error', e?.name === 'NotAllowedError' ? 'Allow camera access to open eyes-only messages' : 'Face check isn’t available on this device');
    }
  })();
}
