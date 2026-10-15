// Generates Ping Me's own sound set (original, synthesized — no licensing issues).
// Run: node scripts/gen-sounds.js   → writes public/sounds/*.wav
const fs = require('fs');
const path = require('path');

const RATE = 32000;
const out = path.join(__dirname, '..', 'public', 'sounds');
fs.mkdirSync(out, { recursive: true });

function render(seconds, fn, peakDb = -6) {
  const n = Math.round(seconds * RATE);
  const buf = new Float32Array(n);
  fn(buf);
  // Normalise to a calm, consistent level and fade the last 30ms (no clicks).
  let peak = 0;
  for (const v of buf) peak = Math.max(peak, Math.abs(v));
  const g = peak ? Math.pow(10, peakDb / 20) / peak : 1;
  const fade = Math.round(0.03 * RATE);
  for (let i = 0; i < n; i++) buf[i] *= g * Math.min(1, (n - i) / fade);
  return buf;
}

// Soft bell: pure sine + a faint octave, slow-ish attack, smooth exponential decay.
function bell(buf, t0, freq, { amp = 1, decay = 0.5, attack = 0.012 } = {}) {
  const start = Math.round(t0 * RATE);
  const len = Math.min(buf.length - start, Math.round(decay * 7 * RATE));
  for (let i = 0; i < len; i++) {
    const t = i / RATE;
    const env = Math.min(1, t / attack) * Math.exp(-t / decay);
    buf[start + i] += amp * env * (Math.sin(2 * Math.PI * freq * t) + 0.12 * Math.sin(4 * Math.PI * freq * t) * Math.exp(-t / (decay * 0.4)));
  }
}

function wav(name, data) {
  const pcm = Buffer.alloc(data.length * 2);
  for (let i = 0; i < data.length; i++) pcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(data[i] * 32767))), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(path.join(out, name), Buffer.concat([h, pcm]));
  console.log('wrote', name, `${((44 + pcm.length) / 1024).toFixed(0)} KB`);
}

const N = { C5: 523.25, E5: 659.25, G5: 783.99, A5: 880, C6: 1046.5, D6: 1174.7, E6: 1318.5 };

// Incoming message: two soft notes, a gentle rising fifth.
wav('message.wav', render(1.1, (b) => {
  bell(b, 0.0, N.G5, { amp: 0.8, decay: 0.28 });
  bell(b, 0.11, N.D6, { amp: 1, decay: 0.42 });
}, -8));

// Message in the chat you're viewing: one quiet drop.
wav('tick.wav', render(0.45, (b) => bell(b, 0, N.E6, { amp: 1, decay: 0.09, attack: 0.006 }), -12));

// Sent: a small, soft pop (short upward glide).
wav('sent.wav', render(0.18, (b) => {
  let phase = 0;
  for (let i = 0; i < b.length; i++) {
    const t = i / RATE, f = 520 + 380 * Math.min(1, t / 0.06);
    phase += (2 * Math.PI * f) / RATE;
    b[i] = Math.sin(phase) * Math.min(1, t / 0.008) * Math.exp(-t / 0.045);
  }
}, -12));

// Ringtone (loops): slow, warm arpeggio with breathing room.
wav('ringtone.wav', render(3.6, (b) => {
  [[0, N.C5], [0.32, N.E5], [0.64, N.G5], [0.96, N.C6]].forEach(([t, f]) => bell(b, t, f, { amp: 0.9, decay: 0.55, attack: 0.02 }));
  bell(b, 1.6, N.G5, { amp: 0.6, decay: 0.6, attack: 0.02 });
}, -7));

// Outgoing ring-back (loops): one soft tone every 3 seconds.
wav('ringback.wav', render(3.0, (b) => {
  for (let i = 0; i < RATE * 1.1; i++) {
    const t = i / RATE;
    const env = Math.min(1, t / 0.08) * Math.min(1, (1.1 - t) / 0.2);
    b[i] = env * (Math.sin(2 * Math.PI * 440 * t) + 0.6 * Math.sin(2 * Math.PI * 480 * t));
  }
}, -14));

// The Ping: a soft, warm double "knock-knock" with a little shimmer — thinking of you.
wav('ping.wav', render(1.2, (b) => {
  bell(b, 0.0, N.C6, { amp: 0.9, decay: 0.16, attack: 0.006 });
  bell(b, 0.16, N.C6, { amp: 0.9, decay: 0.16, attack: 0.006 });
  bell(b, 0.38, N.E6, { amp: 0.6, decay: 0.5 });
  bell(b, 0.38, N.G5, { amp: 0.4, decay: 0.6 });
}, -8));

// Call connected / ended: two gentle notes up / down.
wav('join.wav', render(0.7, (b) => { bell(b, 0, N.E5, { decay: 0.18 }); bell(b, 0.1, N.A5, { decay: 0.25 }); }, -10));
wav('end.wav', render(0.7, (b) => { bell(b, 0, N.A5, { decay: 0.18 }); bell(b, 0.12, N.E5, { decay: 0.28 }); }, -10));
