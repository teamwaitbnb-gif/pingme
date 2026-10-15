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

// Incoming message sound is a recorded tone: public/sounds/message.mp3 (not generated here).

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

// Marimba-like mallet: bright attack, wooden overtones that fade fast, warm body.
function mallet(buf, t0, freq, { amp = 1, decay = 0.38 } = {}) {
  const start = Math.round(t0 * RATE);
  const len = Math.min(buf.length - start, Math.round(decay * 6 * RATE));
  for (let i = 0; i < len; i++) {
    const t = i / RATE;
    const env = Math.min(1, t / 0.003) * Math.exp(-t / decay);
    buf[start + i] += amp * env * (
      Math.sin(2 * Math.PI * freq * t)
      + 0.32 * Math.sin(2 * Math.PI * freq * 3.93 * t) * Math.exp(-t / (decay * 0.18))
      + 0.10 * Math.sin(2 * Math.PI * freq * 9.2 * t) * Math.exp(-t / (decay * 0.06)));
  }
}
const M = { B4: 493.88, E5: 659.25, Fs5: 739.99, Gs5: 830.61, B5: 987.77, Cs6: 1108.73, Ds6: 1244.51, E6: 1318.51, E4: 329.63, B3: 246.94, Cs4: 277.18, A3: 220 };

// Ringtone (loops, ~4s): a bright, catchy two-phrase marimba melody over soft bass — clearly a call.
wav('ringtone.wav', render(4.0, (b) => {
  const q = 0.17; // one step
  const phrase = (t0, notes) => notes.forEach(([step, f, a = 1]) => mallet(b, t0 + step * q, f, { amp: a }));
  phrase(0, [[0, M.E5], [1, M.B5], [2, M.Gs5], [3, M.E6, 1.1], [4.5, M.Ds6, 0.9], [5.5, M.B5]]);
  phrase(1.3, [[0, M.E5], [1, M.B5], [2, M.Gs5], [3, M.Cs6, 1.1], [4.5, M.B5, 0.9], [5.5, M.E6, 1.15]]);
  // Bass anchors (quiet) so it sounds full on phone speakers too.
  mallet(b, 0, M.E4, { amp: 0.45, decay: 0.6 }); mallet(b, 0.68, M.B3, { amp: 0.35, decay: 0.5 });
  mallet(b, 1.3, M.Cs4, { amp: 0.45, decay: 0.6 }); mallet(b, 1.98, M.A3 * 1.5, { amp: 0.35, decay: 0.5 });
}, -3));

// Outgoing "calling…" tone (loops): two soft mallet notes every 2.8 seconds.
wav('ringback.wav', render(2.8, (b) => {
  mallet(b, 0, M.B4, { amp: 0.8, decay: 0.45 });
  mallet(b, 0.22, M.E5, { amp: 1, decay: 0.6 });
}, -12));

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
