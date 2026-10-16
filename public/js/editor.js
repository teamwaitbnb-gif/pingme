// Editing for photos and videos taken in the Ping Me camera.
//  • Photos: crop (free / 1:1 / 4:5 / 16:9) + rotate, draw, text, filters — rendered at full resolution
//    and saved at very high JPEG quality (only when something was actually edited).
//  • Videos: trim start/end and mute. Stored as playback instructions next to the untouched original,
//    so the video is never re-encoded and loses no quality.
import { h, icon, registerLayer, fmtDur } from './ui.js';

const FILTERS = [
  ['Original', ''], ['Vivid', 'saturate(1.35) contrast(1.08)'], ['Warm', 'sepia(0.22) saturate(1.2) brightness(1.03)'],
  ['Cool', 'hue-rotate(-12deg) saturate(1.1) brightness(1.04)'], ['Mono', 'grayscale(1) contrast(1.12)'], ['Fade', 'contrast(0.9) brightness(1.08) saturate(0.8)'],
];
const COLORS = ['#ffffff', '#000000', '#ff3b30', '#ff9500', '#ffd60a', '#34c759', '#0a84ff', '#bf5af2'];
const ASPECTS = [['Free', null], ['1:1', 1], ['4:5', 4 / 5], ['16:9', 16 / 9]];

const ctxFilterWorks = (() => { try { const c = document.createElement('canvas').getContext('2d'); c.filter = 'grayscale(1)'; return c.filter === 'grayscale(1)'; } catch { return false; } })();

// Pixel fallback for browsers without canvas filters (older Safari).
function filterPixels(ctx, w, hh, name) {
  if (name === 'Original') return;
  const img = ctx.getImageData(0, 0, w, hh), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], g = d[i + 1], b = d[i + 2];
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    if (name === 'Mono') { const v = (l - 128) * 1.12 + 128; r = g = b = v; }
    else if (name === 'Vivid') { r = l + (r - l) * 1.35; g = l + (g - l) * 1.35; b = l + (b - l) * 1.35; r = (r - 128) * 1.08 + 128; g = (g - 128) * 1.08 + 128; b = (b - 128) * 1.08 + 128; }
    else if (name === 'Warm') { r = r * 1.08 + 10; g = g * 1.02 + 4; b = b * 0.9; }
    else if (name === 'Cool') { r = r * 0.92; g = g * 1.01 + 2; b = b * 1.1 + 8; }
    else if (name === 'Fade') { r = l + (r - l) * 0.8; g = l + (g - l) * 0.8; b = l + (b - l) * 0.8; r = (r - 128) * 0.9 + 140; g = (g - 128) * 0.9 + 140; b = (b - 128) * 0.9 + 140; }
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
  ctx.putImageData(img, 0, 0);
}

function rotated(bmp, rot, maxEdge = Infinity) {
  const k = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k), hh = Math.round(bmp.height * k);
  const c = document.createElement('canvas');
  const side = rot % 2 === 1;
  c.width = side ? hh : w; c.height = side ? w : hh;
  const x = c.getContext('2d');
  x.translate(c.width / 2, c.height / 2);
  x.rotate((rot * Math.PI) / 2);
  x.drawImage(bmp, -w / 2, -hh / 2, w, hh);
  return c;
}

// Draw the edited picture into a W×H canvas: crop → filter → drawings → text.
function paint(out, src, st) {
  const x = out.getContext('2d');
  const { crop } = st;
  x.save();
  if (ctxFilterWorks && st.filter !== 'Original') x.filter = FILTERS.find((f) => f[0] === st.filter)[1];
  x.drawImage(src, crop.x * src.width, crop.y * src.height, crop.w * src.width, crop.h * src.height, 0, 0, out.width, out.height);
  x.restore();
  if (!ctxFilterWorks) filterPixels(x, out.width, out.height, st.filter);
  // Drawings and text are stored in rotated-image space (0..1) so they stay put when you crop.
  const toOut = ([nx, ny]) => [((nx - crop.x) / crop.w) * out.width, ((ny - crop.y) / crop.h) * out.height];
  const scale = out.width / crop.w; // px per unit of image width
  x.lineCap = 'round'; x.lineJoin = 'round';
  for (const s of st.strokes) {
    x.strokeStyle = s.color; x.lineWidth = s.width * scale;
    x.beginPath();
    s.pts.forEach((p, i) => { const [px, py] = toOut(p); if (i) x.lineTo(px, py); else x.moveTo(px, py); });
    if (s.pts.length === 1) { const [px, py] = toOut(s.pts[0]); x.lineTo(px + 0.1, py); }
    x.stroke();
  }
  for (const t of st.texts) {
    const [px, py] = toOut([t.x, t.y]);
    const fs = t.size * scale;
    x.font = `700 ${fs}px -apple-system, Roboto, "Segoe UI", sans-serif`;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineWidth = fs * 0.14; x.strokeStyle = t.color === '#000000' ? 'rgba(255,255,255,.85)' : 'rgba(0,0,0,.55)';
    x.strokeText(t.text, px, py);
    x.fillStyle = t.color; x.fillText(t.text, px, py);
  }
}

// Always edits the ORIGINAL photo with the previous edit state, so a crop can be widened back out
// and drawings / text / filters can be changed later. Resolves { file, state } (or null = cancelled).
export async function editPhoto(file, startTool = 'crop', prev = null) {
  const full = await createImageBitmap(file);
  return new Promise((resolve) => {
    const st = prev ? JSON.parse(JSON.stringify(prev)) : { rot: 0, crop: { x: 0, y: 0, w: 1, h: 1 }, filter: 'Original', strokes: [], texts: [], color: '#ff3b30', aspect: null };
    let tool = 'crop', disp = rotated(full, st.rot, 1600), drawing = null, dragText = null, cropDrag = null;
    const view = h('canvas', { class: 'ed-canvas' });
    const stage = h('div', { class: 'ed-stage' }, view);
    const cropBox = h('div', { class: 'ed-crop', hidden: true }, ...['tl', 'tr', 'bl', 'br'].map((k) => h('i', { 'data-h': k })));
    stage.append(cropBox);
    const toolBar = h('div', { class: 'ed-tools' });
    const options = h('div', { class: 'ed-options' });
    const root = h('div', { class: 'ed', role: 'dialog', 'aria-label': 'Edit photo' },
      h('div', { class: 'ed-top' },
        h('button', { class: 'ed-ic', 'aria-label': 'Cancel', onclick: () => finish(null) }, icon('x')),
        h('button', { class: 'ed-ic', 'aria-label': 'Reset all edits', onclick: () => { Object.assign(st, { rot: 0, crop: { x: 0, y: 0, w: 1, h: 1 }, filter: 'Original', strokes: [], texts: [], aspect: null }); disp = rotated(full, 0, 1600); setTool(tool); } }, icon('undo')),
        h('button', { class: 'ed-ic ok', 'aria-label': 'Done', onclick: () => finish(true) }, icon('check'))),
      stage, options, toolBar);
    const unregister = registerLayer(() => finish(null));
    document.body.append(root);

    // Fit the (cropped) picture into the stage.
    function layout() {
      const box = stage.getBoundingClientRect();
      const showFull = tool === 'crop';
      const cw = (showFull ? 1 : st.crop.w) * disp.width, ch = (showFull ? 1 : st.crop.h) * disp.height;
      const k = Math.min(box.width / cw, box.height / ch);
      view.style.width = Math.round(cw * k) + 'px'; view.style.height = Math.round(ch * k) + 'px';
      view.width = Math.round(cw * k * Math.min(2, devicePixelRatio || 1)); view.height = Math.round(ch * k * Math.min(2, devicePixelRatio || 1));
      paint(view, disp, showFull ? { ...st, crop: { x: 0, y: 0, w: 1, h: 1 }, strokes: st.strokes, texts: st.texts } : st);
      if (showFull) placeCrop();
    }
    function placeCrop() {
      const r = view.getBoundingClientRect(), s = stage.getBoundingClientRect();
      cropBox.hidden = false;
      Object.assign(cropBox.style, { left: (r.left - s.left + st.crop.x * r.width) + 'px', top: (r.top - s.top + st.crop.y * r.height) + 'px', width: st.crop.w * r.width + 'px', height: st.crop.h * r.height + 'px' });
    }
    // Screen point → rotated-image coordinates (0..1).
    function toImg(e) {
      const r = view.getBoundingClientRect();
      const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
      return tool === 'crop' ? [fx, fy] : [st.crop.x + fx * st.crop.w, st.crop.y + fy * st.crop.h];
    }

    function setTool(t) {
      tool = t;
      toolBar.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
      cropBox.hidden = t !== 'crop';
      options.replaceChildren(...optionsFor(t));
      requestAnimationFrame(layout);
    }
    function optionsFor(t) {
      if (t === 'crop') return [
        h('button', { class: 'ed-chip', onclick: rotate }, icon('undo'), 'Rotate'),
        ...ASPECTS.map(([label, a]) => h('button', { class: 'ed-chip' + (st.aspect === a ? ' on' : ''), onclick: () => setAspect(a) }, label)),
        h('button', { class: 'ed-chip', onclick: () => { st.crop = { x: 0, y: 0, w: 1, h: 1 }; st.aspect = null; setTool('crop'); } }, 'Reset')];
      if (t === 'draw' || t === 'text') return [
        ...COLORS.map((c) => h('button', { class: 'ed-color' + (st.color === c ? ' on' : ''), style: { background: c }, 'aria-label': 'Colour', onclick: () => { st.color = c; options.replaceChildren(...optionsFor(t)); } })),
        t === 'draw'
          ? h('button', { class: 'ed-chip', onclick: () => { st.strokes.pop(); layout(); } }, icon('undo'), 'Undo')
          : h('button', { class: 'ed-chip', onclick: addText }, icon('plus'), 'Add text')];
      if (t === 'filter') return FILTERS.map(([name]) => h('button', { class: 'ed-filter' + (st.filter === name ? ' on' : ''), onclick: () => { st.filter = name; options.replaceChildren(...optionsFor(t)); layout(); } }, filterThumb(name), name));
      return [];
    }
    function filterThumb(name) {
      const c = h('canvas', { width: 64, height: 64 });
      const k = Math.max(64 / disp.width, 64 / disp.height);
      const x = c.getContext('2d');
      if (ctxFilterWorks && name !== 'Original') x.filter = FILTERS.find((f) => f[0] === name)[1];
      x.drawImage(disp, (64 - disp.width * k) / 2, (64 - disp.height * k) / 2, disp.width * k, disp.height * k);
      if (!ctxFilterWorks) filterPixels(x, 64, 64, name);
      return c;
    }

    function rotate() {
      st.rot = (st.rot + 3) % 4; // 90° anticlockwise
      const r = ([x, y]) => [y, 1 - x];
      for (const s of st.strokes) s.pts = s.pts.map(r);
      for (const t of st.texts) [t.x, t.y] = r([t.x, t.y]);
      const c = st.crop; st.crop = { x: c.y, y: 1 - c.x - c.w, w: c.h, h: c.w };
      disp = rotated(full, st.rot, 1600);
      if (st.aspect) setAspect(st.aspect); else layout();
    }
    function setAspect(a) {
      st.aspect = a;
      if (a) {
        const imgA = disp.width / disp.height; // aspect of the whole picture
        let w = 1, hh = imgA / a; if (hh > 1) { hh = 1; w = a / imgA; }
        st.crop = { x: (1 - w) / 2, y: (1 - hh) / 2, w, h: hh };
      }
      options.replaceChildren(...optionsFor('crop'));
      layout();
    }
    function addText() {
      const input = h('input', { class: 'ed-input', placeholder: 'Type something', maxlength: 80, enterkeyhint: 'done' });
      const wrap = h('div', { class: 'ed-typing' }, input);
      const done = () => {
        const v = input.value.trim();
        wrap.remove();
        if (v) { st.texts.push({ text: v, x: st.crop.x + st.crop.w / 2, y: st.crop.y + st.crop.h / 2, color: st.color, size: 0.07 * st.crop.w }); layout(); }
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(); });
      input.addEventListener('blur', done);
      root.append(wrap);
      input.focus();
    }

    // Pointer handling for draw / move text / crop handles.
    view.addEventListener('pointerdown', (e) => {
      if (tool === 'draw') { drawing = { color: st.color, width: 0.008 * st.crop.w, pts: [toImg(e)] }; st.strokes.push(drawing); try { view.setPointerCapture(e.pointerId); } catch {} layout(); }
      else if (tool === 'text') {
        const [px, py] = toImg(e);
        dragText = st.texts.slice().reverse().find((t) => Math.abs(t.x - px) < t.size * t.text.length * 0.3 && Math.abs(t.y - py) < t.size * 0.8) || null;
        if (dragText) try { view.setPointerCapture(e.pointerId); } catch {}
      }
    });
    view.addEventListener('pointermove', (e) => {
      if (drawing) { drawing.pts.push(toImg(e)); layout(); }
      else if (dragText) { [dragText.x, dragText.y] = toImg(e); layout(); }
    });
    const up = () => { drawing = null; dragText = null; };
    view.addEventListener('pointerup', up); view.addEventListener('pointercancel', up);

    cropBox.addEventListener('pointerdown', (e) => {
      const r = view.getBoundingClientRect();
      cropDrag = { handle: e.target.dataset.h || 'move', sx: e.clientX, sy: e.clientY, start: { ...st.crop }, rw: r.width, rh: r.height };
      try { cropBox.setPointerCapture(e.pointerId); } catch {}
      e.preventDefault();
    });
    cropBox.addEventListener('pointermove', (e) => {
      if (!cropDrag) return;
      const dx = (e.clientX - cropDrag.sx) / cropDrag.rw, dy = (e.clientY - cropDrag.sy) / cropDrag.rh;
      const s = cropDrag.start, MIN = 0.1;
      let { x, y, w, h: hh } = s;
      if (cropDrag.handle === 'move') { x = Math.min(1 - w, Math.max(0, s.x + dx)); y = Math.min(1 - hh, Math.max(0, s.y + dy)); }
      else {
        if (cropDrag.handle.includes('l')) { x = Math.min(s.x + s.w - MIN, Math.max(0, s.x + dx)); w = s.x + s.w - x; }
        if (cropDrag.handle.includes('r')) w = Math.min(1 - s.x, Math.max(MIN, s.w + dx));
        if (cropDrag.handle.includes('t')) { y = Math.min(s.y + s.h - MIN, Math.max(0, s.y + dy)); hh = s.y + s.h - y; }
        if (cropDrag.handle.includes('b')) hh = Math.min(1 - s.y, Math.max(MIN, s.h + dy));
        if (st.aspect) { // keep the chosen shape
          const imgA = disp.width / disp.height;
          hh = Math.min(1 - y, (w * imgA) / st.aspect);
          w = (hh * st.aspect) / imgA;
        }
      }
      st.crop = { x, y, w, h: hh };
      placeCrop();
    });
    cropBox.addEventListener('pointerup', () => { cropDrag = null; });

    toolBar.append(...[['crop', 'crop', 'Crop'], ['draw', 'edit', 'Draw'], ['text', 'text', 'Text'], ['filter', 'sparkle', 'Filters']].map(([t, ic, label]) =>
      h('button', { 'data-t': t, 'aria-label': label, title: label, onclick: () => setTool(t) }, icon(ic))));
    addEventListener('resize', layout);

    async function finish(apply) {
      unregister();
      removeEventListener('resize', layout);
      const edited = st.rot || st.filter !== 'Original' || st.strokes.length || st.texts.length || st.crop.w < 0.999 || st.crop.h < 0.999;
      if (!apply) { root.remove(); full.close?.(); return resolve(null); }
      if (!edited) { root.remove(); full.close?.(); return resolve({ file, state: st, edited: false }); }
      // Full-resolution render.
      const src = rotated(full, st.rot);
      const out = document.createElement('canvas');
      out.width = Math.round(st.crop.w * src.width); out.height = Math.round(st.crop.h * src.height);
      paint(out, src, st);
      const blob = await new Promise((r) => out.toBlob(r, 'image/jpeg', 0.95));
      root.remove(); full.close?.();
      resolve({ file: blob ? new File([blob], file.name.replace(/\.\w+$/, '') + '-edit.jpg', { type: 'image/jpeg' }) : file, state: st, edited: true });
    }
    setTool(startTool);
  });
}

// Trim + mute for a video: returns { trim: [start, end] | null, muted } — no re-encoding.
export function editVideo(file, current = {}) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = h('video', { class: 'ed-video', src: url, playsinline: true, autoplay: true, loop: false, muted: !!current.muted });
    v.muted = !!current.muted;
    let dur = 0, s = current.trim?.[0] || 0, e = current.trim?.[1] || 0, muted = !!current.muted, drag = null;
    const range = h('div', { class: 'tr-range' });
    const hs = h('i', { class: 'tr-h' }), he = h('i', { class: 'tr-h' });
    const head = h('b', { class: 'tr-head' });
    const bar = h('div', { class: 'tr-bar' }, range, hs, he, head);
    const label = h('div', { class: 'tr-label' });
    const muteBtn = h('button', { class: 'ed-chip' + (muted ? ' on' : ''), onclick: () => { muted = !muted; v.muted = muted; muteBtn.classList.toggle('on', muted); muteBtn.replaceChildren(icon(muted ? 'mute' : 'vol'), muted ? 'Muted' : 'Sound on'); } }, icon(muted ? 'mute' : 'vol'), muted ? 'Muted' : 'Sound on');
    const root = h('div', { class: 'ed', role: 'dialog', 'aria-label': 'Trim video' },
      h('div', { class: 'ed-top' },
        h('button', { class: 'ed-ic', 'aria-label': 'Cancel', onclick: () => finish(false) }, icon('x')),
        h('button', { class: 'ed-ic', 'aria-label': 'Use the whole video', onclick: () => { s = 0; e = dur; v.currentTime = 0; draw(); } }, icon('undo')),
        h('button', { class: 'ed-ic ok', 'aria-label': 'Done', onclick: () => finish(true) }, icon('check'))),
      h('div', { class: 'ed-stage' }, v),
      h('div', { class: 'ed-options column' }, label, bar, h('div', { class: 'ed-row' }, muteBtn)));
    const unregister = registerLayer(() => finish(false));
    document.body.append(root);

    const draw = () => {
      if (!dur) return;
      const a = (s / dur) * 100, b = (e / dur) * 100;
      Object.assign(range.style, { left: a + '%', width: (b - a) + '%' });
      hs.style.left = a + '%'; he.style.left = b + '%';
      head.style.left = ((v.currentTime || 0) / dur) * 100 + '%';
      label.textContent = `${fmtDur(s)} – ${fmtDur(e)} · ${fmtDur(e - s)} selected`;
    };
    v.addEventListener('loadedmetadata', () => {
      dur = v.duration;
      if (!e || e > dur) e = dur;
      v.currentTime = s;
      draw();
    });
    v.addEventListener('timeupdate', () => { if (dur && v.currentTime >= e - 0.05) { v.currentTime = s; v.play().catch(() => {}); } draw(); });
    v.addEventListener('click', () => (v.paused ? v.play() : v.pause()));
    const at = (x) => { const r = bar.getBoundingClientRect(); return Math.max(0, Math.min(1, (x - r.left) / r.width)) * dur; };
    bar.addEventListener('pointerdown', (ev) => {
      if (!dur) return;
      const t = at(ev.clientX);
      drag = Math.abs(t - s) < Math.abs(t - e) ? 's' : 'e';
      try { bar.setPointerCapture(ev.pointerId); } catch {}
    });
    bar.addEventListener('pointermove', (ev) => {
      if (!drag) return;
      const t = at(ev.clientX);
      if (drag === 's') s = Math.min(t, e - 0.5); else e = Math.max(t, s + 0.5);
      v.currentTime = drag === 's' ? s : Math.max(s, e - 1);
      draw();
    });
    bar.addEventListener('pointerup', () => { drag = null; v.play().catch(() => {}); });

    function finish(apply) {
      unregister();
      v.pause(); URL.revokeObjectURL(url); root.remove();
      if (!apply) return resolve(null);
      const trimmed = dur && (s > 0.05 || e < dur - 0.05);
      resolve({ trim: trimmed ? [Math.round(s * 100) / 100, Math.round(e * 100) / 100] : null, muted });
    }
  });
}

// Play a sent video with its trim/mute instructions applied.
export function applyVideoEdits(v, att) {
  if (!att) return;
  if (att.muted) { v.muted = true; v.defaultMuted = true; }
  const t = att.trim;
  if (!Array.isArray(t)) return;
  const [s, e] = t;
  const clamp = () => { if (v.currentTime < s - 0.05 || v.currentTime > e) v.currentTime = s; };
  v.addEventListener('loadedmetadata', clamp);
  v.addEventListener('play', clamp);
  v.addEventListener('seeking', () => { if (v.currentTime < s - 0.05) v.currentTime = s; if (v.currentTime > e) v.currentTime = e - 0.1; });
  v.addEventListener('timeupdate', () => { if (v.currentTime >= e) { v.pause(); v.currentTime = s; } });
}

// A trimmed video plays as a real clip: its own length, progress bar and seeking limited to the clip.
export function clipPlayer(src, att, { autoplay = true } = {}) {
  const [s, e] = Array.isArray(att?.trim) ? att.trim : [0, null];
  const v = h('video', { src: src + (src.startsWith('blob:') ? '' : `#t=${s}`), playsinline: true, autoplay, preload: 'metadata' });
  if (att?.muted) { v.muted = true; v.defaultMuted = true; }
  const fill = h('i'), knob = h('b');
  const bar = h('div', { class: 'clip-bar' }, h('div', { class: 'clip-track' }, fill), knob);
  const time = h('span', { class: 'clip-time' }, '0:00');
  const playBtn = h('button', { class: 'clip-play', 'aria-label': 'Play' }, icon('play', 'fill'));
  const root = h('div', { class: 'clip' }, v, h('div', { class: 'clip-ui' }, playBtn, bar, time));
  const end = () => e ?? v.duration ?? 0;
  const len = () => Math.max(0.1, end() - s);
  const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  const draw = () => {
    const p = Math.max(0, Math.min(1, (v.currentTime - s) / len()));
    fill.style.width = p * 100 + '%'; knob.style.left = p * 100 + '%';
    time.textContent = `${fmt(Math.max(0, v.currentTime - s))} / ${fmt(len())}`;
    playBtn.replaceChildren(icon(v.paused ? 'play' : 'pause', 'fill'));
  };
  v.addEventListener('loadedmetadata', () => { if (v.currentTime < s) v.currentTime = s; draw(); });
  v.addEventListener('timeupdate', () => { if (v.currentTime >= end() - 0.03) { v.pause(); v.currentTime = s; } draw(); });
  v.addEventListener('play', () => { if (v.currentTime < s || v.currentTime >= end()) v.currentTime = s; draw(); });
  v.addEventListener('pause', draw);
  const toggle = () => (v.paused ? v.play().catch(() => {}) : v.pause());
  playBtn.addEventListener('click', (ev) => { ev.stopPropagation(); toggle(); });
  v.addEventListener('click', (ev) => { ev.stopPropagation(); toggle(); });
  const seek = (ev) => { const r = bar.getBoundingClientRect(); v.currentTime = s + Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * len(); draw(); };
  let dragging = false;
  bar.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); dragging = true; try { bar.setPointerCapture(ev.pointerId); } catch {} seek(ev); });
  bar.addEventListener('pointermove', (ev) => { if (dragging) seek(ev); });
  bar.addEventListener('pointerup', () => { dragging = false; });
  root.video = v;
  return root;
}
