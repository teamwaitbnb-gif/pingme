// Ping Me camera (WhatsApp-style): full-screen viewfinder, tap the shutter for a photo, hold it for a
// video. Uses the camera at its highest resolution; photos come from the camera's still-photo mode
// where the browser offers it (full sensor resolution), videos are recorded at a high bitrate and
// sent exactly as recorded — nothing is compressed afterwards.
import { h, icon, toast, registerLayer, fmtDur } from './ui.js';
import { ensurePermission } from './perm.js';
import { VideoRecorder } from './video-recorder.js';

const HOLD_MS = 280;

export async function openCamera({ maxBytes, onSend, onGallery }) {
  if (!(await ensurePermission(['camera', 'microphone'], 'To take photos and record videos with sound.'))) return;
  let recorder = null, stream = null, facing = 'environment', torch = false, closed = false;
  let mode = 'photo', recording = false, holdTimer = null, tick = null, startedAt = 0, zoom = null;

  const video = h('video', { class: 'cam-view', autoplay: true, playsinline: true, muted: true });
  video.muted = true;
  const timer = h('div', { class: 'cam-timer', hidden: true });
  const res = h('div', { class: 'cam-res' });
  const flashBtn = h('button', { class: 'cam-icon', 'aria-label': 'Flash', hidden: true, onclick: toggleTorch }, icon('zap'));
  const shutter = h('button', { class: 'cam-shutter', 'aria-label': 'Take photo, hold for video' }, h('span'));
  const hint = h('div', { class: 'cam-hint' }, 'Tap for photo, hold for video');
  const modes = h('div', { class: 'cam-modes' },
    h('button', { class: 'on', 'data-mode': 'photo', onclick: () => setMode('photo') }, 'Photo'),
    h('button', { 'data-mode': 'video', onclick: () => setMode('video') }, 'Video'));
  const root = h('div', { class: 'cam', role: 'dialog', 'aria-label': 'Camera' },
    video,
    h('div', { class: 'cam-top' },
      h('button', { class: 'cam-icon', 'aria-label': 'Close', onclick: () => close() }, icon('x')),
      timer, res, flashBtn),
    h('div', { class: 'cam-bottom' }, hint, modes,
      h('div', { class: 'cam-row' },
        h('button', { class: 'cam-icon big', 'aria-label': 'Choose from gallery', onclick: () => { close(); onGallery?.(); } }, icon('image')),
        shutter,
        h('button', { class: 'cam-icon big', 'aria-label': 'Switch camera', onclick: flip }, icon('flip')))));
  const unregister = registerLayer(() => close());
  document.body.append(root);

  function close() {
    if (closed) return;
    closed = true;
    unregister();
    clearInterval(tick); clearTimeout(holdTimer);
    recorder?.cancel();
    stream?.getTracks().forEach((t) => t.stop());
    root.remove();
  }

  async function start() {
    recorder?.cancel();
    recorder = new VideoRecorder();
    try {
      stream = await recorder.open(facing);
      if (!stream || closed) return;
      video.srcObject = stream;
      video.classList.toggle('mirror', facing === 'user');
      await video.play().catch(() => {});
      const track = stream.getVideoTracks()[0];
      const s = track.getSettings(), caps = track.getCapabilities?.() || {};
      res.textContent = `${Math.max(s.width, s.height) >= 3800 ? '4K' : Math.min(s.width, s.height) >= 1080 ? '1080p' : `${Math.min(s.width, s.height)}p`}`;
      flashBtn.hidden = !caps.torch && facing !== 'environment';
      zoom = caps.zoom ? { min: caps.zoom.min, max: Math.min(caps.zoom.max, 10), value: s.zoom || caps.zoom.min } : null;
    } catch (e) {
      toast(e?.name === 'NotAllowedError' ? 'Allow camera access to use the camera' : 'Camera unavailable', { error: true });
      close();
    }
  }

  function setMode(m) {
    mode = m;
    modes.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    shutter.classList.toggle('video', m === 'video');
    hint.textContent = m === 'video' ? 'Tap to start and stop recording' : 'Tap for photo, hold for video';
  }

  async function flip() {
    if (recording) return;
    facing = facing === 'environment' ? 'user' : 'environment';
    torch = false;
    await start();
  }

  async function toggleTorch() {
    const track = stream?.getVideoTracks()[0];
    const caps = track?.getCapabilities?.() || {};
    torch = !torch;
    flashBtn.classList.toggle('on', torch);
    if (caps.torch) { try { await track.applyConstraints({ advanced: [{ torch }] }); } catch {} }
  }

  // Pinch to zoom (where the camera supports it).
  let pinch = null;
  root.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2 && zoom) pinch = { d: dist(e.touches), z: zoom.value };
  }, { passive: true });
  root.addEventListener('touchmove', (e) => {
    if (!pinch || e.touches.length !== 2) return;
    const z = Math.max(zoom.min, Math.min(zoom.max, pinch.z * (dist(e.touches) / pinch.d)));
    zoom.value = z;
    stream?.getVideoTracks()[0].applyConstraints({ advanced: [{ zoom: z }] }).catch(() => {});
  }, { passive: true });
  root.addEventListener('touchend', () => { pinch = null; });
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

  // Shutter: tap = photo, hold = video (photo mode); tap start/stop (video mode).
  shutter.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (recording) return;
    if (mode === 'video') return;
    holdTimer = setTimeout(() => { holdTimer = null; startRecording(true); }, HOLD_MS);
  });
  shutter.addEventListener('pointerup', (e) => {
    e.preventDefault();
    if (mode === 'video') { if (recording) stopRecording(); else startRecording(false); return; }
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; takePhoto(); }
    else if (recording && root.classList.contains('held')) stopRecording();
  });
  shutter.addEventListener('pointercancel', () => { if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; } else if (recording) stopRecording(); });
  shutter.addEventListener('contextmenu', (e) => e.preventDefault());

  async function takePhoto() {
    const track = stream?.getVideoTracks()[0];
    if (!track) return;
    root.classList.add('snap');
    setTimeout(() => root.classList.remove('snap'), 180);
    let blob = null;
    // Still-photo mode: full sensor resolution (Chrome on Android and others with ImageCapture).
    if ('ImageCapture' in window) {
      try {
        const ic = new window.ImageCapture(track);
        const pc = await ic.getPhotoCapabilities().catch(() => null);
        const settings = {};
        if (pc?.imageWidth?.max) { settings.imageWidth = pc.imageWidth.max; settings.imageHeight = pc.imageHeight.max; }
        if (torch && pc?.fillLightMode?.includes('flash')) settings.fillLightMode = 'flash';
        blob = await ic.takePhoto(settings);
      } catch { blob = null; }
    }
    // Otherwise: the full-resolution camera frame, saved at very high JPEG quality.
    if (!blob) {
      const c = document.createElement('canvas');
      c.width = video.videoWidth; c.height = video.videoHeight;
      const x = c.getContext('2d');
      if (facing === 'user') { x.translate(c.width, 0); x.scale(-1, 1); }
      x.drawImage(video, 0, 0);
      blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.97));
    }
    if (!blob) return toast('Couldn’t take the photo', { error: true });
    preview(new File([blob], `ping-me-${Date.now()}.jpg`, { type: blob.type || 'image/jpeg' }));
  }

  async function startRecording(held) {
    if (recording || !recorder) return;
    recording = true;
    root.classList.add('recording');
    root.classList.toggle('held', held);
    timer.hidden = false;
    startedAt = Date.now();
    timer.textContent = '0:00';
    tick = setInterval(() => { timer.textContent = fmtDur((Date.now() - startedAt) / 1000); }, 250);
    navigator.vibrate?.(30);
    try {
      const file = await recorder.start(maxBytes, () => toast('Reached the size limit — recording stopped'));
      if (!closed) preview(file);
    } catch (e) {
      if (!closed) { toast(e.message, { error: true }); resetRecording(); start(); }
    }
  }

  function stopRecording() {
    if (!recording) return;
    if (Date.now() - startedAt < 600) { setTimeout(stopRecording, 600 - (Date.now() - startedAt)); return; }
    recorder.stop();
  }

  function resetRecording() {
    recording = false;
    clearInterval(tick);
    timer.hidden = true;
    root.classList.remove('recording', 'held');
  }

  // Review before sending (like WhatsApp): Retake or Send.
  function preview(file) {
    resetRecording();
    stream?.getTracks().forEach((t) => t.stop());
    const url = URL.createObjectURL(file);
    const isVideo = file.type.startsWith('video/');
    const media = isVideo
      ? h('video', { class: 'cam-review', src: url, autoplay: true, playsinline: true, loop: true, onclick: (e) => { const v = e.currentTarget; if (v.paused) v.play(); else v.pause(); } })
      : h('img', { class: 'cam-review', src: url, alt: '' });
    const info = h('div', { class: 'cam-res' });
    const showSize = (w, hh) => { info.textContent = `${w}×${hh} · ${(file.size / 1048576).toFixed(1)} MB · original quality`; };
    if (isVideo) media.addEventListener('loadedmetadata', () => showSize(media.videoWidth, media.videoHeight));
    else media.addEventListener('load', () => showSize(media.naturalWidth, media.naturalHeight));
    const review = h('div', { class: 'cam cam-reviewing' },
      media,
      h('div', { class: 'cam-top' },
        h('button', { class: 'cam-icon', 'aria-label': 'Retake', onclick: () => retake() }, icon('x')), info),
      h('div', { class: 'cam-bottom' },
        h('div', { class: 'cam-row end' },
          h('button', { class: 'cam-retake', onclick: () => retake() }, 'Retake'),
          h('button', { class: 'cam-send', 'aria-label': 'Send', onclick: () => { URL.revokeObjectURL(url); review.remove(); close(); onSend(file); } }, icon('send')))));
    root.append(review);
    function retake() { URL.revokeObjectURL(url); review.remove(); start(); }
  }

  await start();
}
