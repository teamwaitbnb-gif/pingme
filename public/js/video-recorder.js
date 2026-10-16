import { h, openSheet, toast, fmtDur } from './ui.js';
import { ensurePermission } from './perm.js';

// MP4/H.264 first: plays everywhere (iPhone and Android) without conversion.
const TYPES = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm'];

export function recordingOptions(track) {
  const { width = 1920, height = 1080, frameRate = 30 } = track.getSettings();
  // High bitrate at the actual sensor resolution, without resizing through a canvas.
  return {
    videoBitsPerSecond: Math.round(Math.min(80_000_000, Math.max(8_000_000, width * height * frameRate * 0.20))),
    audioBitsPerSecond: 192000,
  };
}

export class VideoRecorder {
  async open(facing = 'environment', { hd = true } = {}) {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facing }, width: { ideal: hd ? 3840 : 1280 }, height: { ideal: hd ? 2160 : 720 }, frameRate: { ideal: 30, max: 30 }, resizeMode: { ideal: 'none' } },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, sampleRate: { ideal: 48000 }, channelCount: { ideal: 2 } },
    });
    if (this.closed) { stream.getTracks().forEach((t) => t.stop()); return null; }
    this.stream = stream;
    return stream;
  }

  start(maxBytes, onLimit) {
    const options = recordingOptions(this.stream.getVideoTracks()[0]);
    const mimeType = TYPES.find((type) => MediaRecorder.isTypeSupported(type));
    if (mimeType) options.mimeType = mimeType;
    this.rec = new MediaRecorder(this.stream, options);
    this.chunks = []; this.bytes = 0;
    this.result = new Promise((resolve, reject) => {
      this.rec.ondataavailable = ({ data }) => {
        if (!data.size) return;
        this.chunks.push(data); this.bytes += data.size;
        // Reserve room for the final encoded chunk; never silently downsample to fit.
        if (this.bytes >= maxBytes * 0.9 && this.rec.state === 'recording') {
          this.rec.stop(); onLimit?.();
        }
      };
      this.rec.onerror = (event) => { this.release(); reject(event.error || new Error('Recording failed')); };
      this.rec.onstop = () => {
        this.release();
        const blob = new Blob(this.chunks, { type: this.rec.mimeType || mimeType || this.chunks[0]?.type || 'video/webm' });
        this.chunks = [];
        if (!blob.size) return reject(new Error('No video was captured. Please try again.'));
        if (blob.size > maxBytes) return reject(new Error('This recording is too large to send. Please record a shorter clip.'));
        resolve(new File([blob], `ping-me-${Date.now()}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`, { type: blob.type }));
      };
    });
    this.rec.start(250);
    return this.result;
  }

  stop() { if (this.rec?.state === 'recording') this.rec.stop(); return this.result; }
  release() { this.stream?.getTracks().forEach((t) => t.stop()); }
  cancel() { this.closed = true; this.stop(); this.release(); }
}

export async function openVideoRecorder({ maxBytes, onChoose }) {
  if (!(await ensurePermission(['camera', 'microphone'], 'To record a video with sound.'))) return;
  const recorder = new VideoRecorder();
  let closed = false, recording = false, file, url, timer, facing = 'environment';
  const video = h('video', { autoplay: true, playsinline: true, muted: true, class: 'record-preview' });
  video.muted = true;
  const status = h('p', { class: 'muted small', role: 'status', 'aria-live': 'polite' }, 'Opening camera…');
  const button = h('button', { class: 'btn primary', disabled: true }, 'Start recording');
  const flip = h('button', { class: 'btn', disabled: true }, 'Switch camera');
  const choose = h('button', { class: 'btn primary', hidden: true }, 'Use video');
  const sheet = openSheet({ title: 'Record video', left: { label: 'Cancel' },
    body: h('div', null, video, status, h('div', { class: 'record-controls' }, button, flip, choose)),
    onClose: () => { closed = true; clearInterval(timer); recorder.cancel(); video.srcObject = null; video.removeAttribute('src'); video.load(); if (url) URL.revokeObjectURL(url); },
  });
  async function open() {
    button.disabled = flip.disabled = true;
    try {
      const stream = await recorder.open(facing);
      if (!stream || closed) return;
      video.srcObject = stream;
      await video.play().catch(() => {});
      const { width, height } = stream.getVideoTracks()[0].getSettings();
      status.textContent = `${width} × ${height} · High quality · No extra compression`;
      button.disabled = flip.disabled = false;
    } catch (e) { if (!closed) { status.textContent = 'Camera unavailable. You can also attach a video from your phone’s camera app.'; toast(e.message, { error: true }); } }
  }
  flip.onclick = async () => { recorder.release(); facing = facing === 'environment' ? 'user' : 'environment'; await open(); };
  button.onclick = async () => {
    if (recording) { button.disabled = true; recorder.stop(); return; }
    recording = true; flip.hidden = true; button.textContent = 'Stop recording';
    const started = Date.now();
    timer = setInterval(() => { status.textContent = `Recording · ${fmtDur((Date.now() - started) / 1000)}`; }, 500);
    try {
      file = await recorder.start(maxBytes, () => { button.disabled = true; });
      if (closed) return;
      clearInterval(timer); video.srcObject = null; video.muted = false; video.controls = true;
      url = URL.createObjectURL(file); video.src = url; video.pause();
      status.textContent = 'Preview your video · Original recording quality';
      button.hidden = true; choose.hidden = false;
    } catch (e) { if (!closed) { toast(e.message, { error: true }); sheet.close(); } }
    finally { clearInterval(timer); }
  };
  choose.onclick = () => { if (file) { onChoose(file); sheet.close(); } };
  await open();
}
