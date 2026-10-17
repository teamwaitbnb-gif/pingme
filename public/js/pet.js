// The group pet lives inside the chat: it wanders along the bottom, hops onto message bubbles,
// sleeps when the chat goes quiet, reacts to what people say, and makes its own sound when tapped.
// Anyone can feed it, put it in a cage or let it out — everyone in the group sees the same pet.
import { h, toast, actionSheet, promptDialog } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (markup) => { const d = document.createElement('div'); d.innerHTML = markup.trim(); return d.firstChild; };

// ───── art (all vector, faces right) ─────
const LOOK = {
  cat: { fur: '#9aa3b2', dark: '#6f7889', belly: '#e9edf3', ear: 'point', tail: 'long', stripes: true, treat: 'fish' },
  dog: { fur: '#d9a066', dark: '#a9713c', belly: '#f6e2c6', ear: 'flop', tail: 'short', spot: true, treat: 'bone' },
  bunny: { fur: '#f1ece6', dark: '#cfc6bb', belly: '#ffffff', ear: 'long', tail: 'puff', hop: true, treat: 'carrot' },
  fox: { fur: '#f08a3c', dark: '#c4601e', belly: '#fff4ea', ear: 'point', tail: 'bushy', tips: true, treat: 'berry' },
  panda: { fur: '#ffffff', dark: '#26272b', belly: '#ffffff', ear: 'round', tail: 'puff', patches: true, darkLegs: true, treat: 'bamboo' },
  dragon: { fur: '#5cc98b', dark: '#2f9a63', belly: '#d9f5c8', ear: 'horn', tail: 'spade', spikes: true, wings: true, treat: 'meat' },
  unicorn: { fur: '#fbf7ff', dark: '#d9cdea', belly: '#ffffff', ear: 'point', tail: 'mane', horn: true, mane: true, treat: 'apple' },
};

function quadruped(kind) {
  const L = LOOK[kind];
  const legFill = L.darkLegs ? L.dark : L.fur;
  const ears = {
    point: `<path d="M70 30 L74 12 L84 26 Z" fill="${L.fur}"/><path d="M73 27 L75 17 L80 25 Z" fill="${L.tips ? '#2b2b2b' : '#f4b6c2'}"/>
            <path d="M88 26 L98 12 L100 30 Z" fill="${L.fur}"/><path d="M91 26 L97 17 L98 28 Z" fill="${L.tips ? '#2b2b2b' : '#f4b6c2'}"/>`,
    flop: `<path d="M68 30 C58 30 58 52 66 54 C72 50 74 38 74 32 Z" fill="${L.dark}"/><path d="M96 28 C106 28 108 50 100 53 C94 49 92 38 92 31 Z" fill="${L.dark}"/>`,
    long: `<path d="M74 28 C68 6 72 -6 78 -4 C84 -2 84 14 80 28 Z" fill="${L.fur}"/><path d="M76 24 C72 8 74 0 77 1 C80 2 80 14 78 24 Z" fill="#f4b6c2"/>
           <path d="M86 27 C86 4 92 -6 97 -2 C101 2 96 16 91 28 Z" fill="${L.fur}"/><path d="M88 24 C89 8 93 1 95 3 C97 6 93 16 90 24 Z" fill="#f4b6c2"/>`,
    round: `<circle cx="71" cy="27" r="8" fill="${L.dark}"/><circle cx="97" cy="26" r="8" fill="${L.dark}"/>`,
    horn: `<path d="M72 28 L66 12 L78 24 Z" fill="#f4d58d"/><path d="M94 26 L100 10 L100 26 Z" fill="#f4d58d"/>`,
  }[L.ear];
  const tails = {
    long: `<path d="M30 66 C14 64 10 46 18 36" stroke="${L.fur}" stroke-width="7" fill="none" stroke-linecap="round"/>`,
    short: `<path d="M30 62 C22 58 20 50 24 46" stroke="${L.fur}" stroke-width="7" fill="none" stroke-linecap="round"/>`,
    puff: `<circle cx="28" cy="62" r="8" fill="${L.belly}"/>`,
    bushy: `<path d="M32 66 C10 68 2 46 14 34 C22 44 28 52 32 58 Z" fill="${L.fur}"/><path d="M14 34 C10 40 9 46 11 50 C14 46 16 40 14 34 Z" fill="#fff"/>`,
    spade: `<path d="M30 66 C16 66 12 54 16 44" stroke="${L.fur}" stroke-width="6" fill="none" stroke-linecap="round"/><path d="M16 44 L8 40 L14 34 L20 40 Z" fill="${L.dark}"/>`,
    mane: `<path d="M30 60 C16 58 12 66 10 78 C18 72 24 70 30 66 Z" fill="#c7a8ff"/><path d="M30 63 C20 64 16 72 16 82 C22 76 26 72 31 68 Z" fill="#8fd3ff"/>`,
  }[L.tail];
  return `
<svg class="pet-svg" viewBox="-4 -10 128 112" xmlns="${NS}">
  <ellipse class="pet-shadow" cx="58" cy="96" rx="34" ry="4.5" fill="rgba(0,0,0,.28)"/>
  <g class="tail">${tails}</g>
  <g class="body">
    <g class="leg back a"><rect x="38" y="76" width="9" height="18" rx="4.5" fill="${legFill}"/></g>
    <g class="leg back b"><rect x="62" y="76" width="9" height="18" rx="4.5" fill="${legFill}"/></g>
    ${L.wings ? `<path class="wing" d="M50 58 C46 36 62 30 70 44 C62 44 58 50 56 60 Z" fill="${L.dark}" opacity=".9"/>` : ''}
    <ellipse cx="56" cy="70" rx="30" ry="19" fill="${L.fur}"/>
    <ellipse cx="62" cy="76" rx="18" ry="10" fill="${L.belly}"/>
    ${L.stripes ? `<path d="M44 54 q4 6 0 12 M52 52 q4 7 0 14 M60 52 q4 7 0 14" stroke="${L.dark}" stroke-width="3" fill="none" stroke-linecap="round" opacity=".6"/>` : ''}
    ${L.spot ? `<ellipse cx="46" cy="62" rx="9" ry="7" fill="${L.dark}" opacity=".8"/>` : ''}
    ${L.spikes ? `<path d="M34 56 l5 -8 l5 8 l5 -9 l5 9 l5 -9 l5 9" fill="${L.dark}"/>` : ''}
    ${L.patches ? `<ellipse cx="56" cy="58" rx="22" ry="7" fill="${L.dark}"/>` : ''}
    <g class="leg front a"><rect x="44" y="77" width="9" height="18" rx="4.5" fill="${legFill}"/></g>
    <g class="leg front b"><rect x="70" y="77" width="9" height="18" rx="4.5" fill="${legFill}"/></g>
    ${L.mane ? `<path d="M76 30 C64 30 60 44 62 56 C66 48 70 42 78 40 Z" fill="#c7a8ff"/><path d="M80 32 C72 36 70 46 72 54 C74 46 78 42 84 40 Z" fill="#8fd3ff"/>` : ''}
    <g class="head">
      ${ears}
      <circle cx="84" cy="44" r="21" fill="${L.fur}"/>
      ${L.horn ? `<path d="M86 25 L92 2 L95 25 Z" fill="#f6d36b"/><path d="M88 18 L94 16 M87 12 L93 10" stroke="#e0b647" stroke-width="1.5"/>` : ''}
      ${L.patches ? `<ellipse cx="78" cy="44" rx="6.5" ry="8.5" fill="${L.dark}" transform="rotate(-18 78 44)"/><ellipse cx="96" cy="44" rx="6.5" ry="8.5" fill="${L.dark}" transform="rotate(18 96 44)"/>` : ''}
      <ellipse cx="92" cy="52" rx="11" ry="8" fill="${L.belly}"/>
      <g class="eyes">
        <g class="eye"><circle cx="79" cy="43" r="4.2" fill="#1d1d1f"/><circle cx="80.4" cy="41.6" r="1.4" fill="#fff"/></g>
        <g class="eye"><circle cx="96" cy="43" r="4.2" fill="#1d1d1f"/><circle cx="97.4" cy="41.6" r="1.4" fill="#fff"/></g>
      </g>
      <g class="eyes-closed"><path d="M75 44 q4 3 8 0 M92 44 q4 3 8 0" stroke="#1d1d1f" stroke-width="2.4" fill="none" stroke-linecap="round"/></g>
      <g class="eyes-sad"><path d="M75 41 l8 3 M100 41 l-8 3" stroke="#1d1d1f" stroke-width="2.2" stroke-linecap="round"/><circle cx="79" cy="46" r="3.2" fill="#1d1d1f"/><circle cx="96" cy="46" r="3.2" fill="#1d1d1f"/></g>
      <ellipse cx="73" cy="52" rx="4" ry="2.6" fill="#ff8fa3" opacity=".55"/><ellipse cx="101" cy="52" rx="4" ry="2.6" fill="#ff8fa3" opacity=".55"/>
      <path d="M90 49 h6 l-3 3.5 z" fill="#2b2b2b"/>
      <path class="mouth" d="M93 53 q-3 4 -6 1 M93 53 q3 4 6 1" stroke="#2b2b2b" stroke-width="1.6" fill="none" stroke-linecap="round"/>
      <ellipse class="mouth-open" cx="93" cy="56" rx="3.2" ry="3.6" fill="#7a2232"/>
    </g>
  </g>
</svg>`;
}

function owl() {
  return `
<svg class="pet-svg owl" viewBox="-4 -10 128 112" xmlns="${NS}">
  <ellipse class="pet-shadow" cx="60" cy="96" rx="26" ry="4.5" fill="rgba(0,0,0,.28)"/>
  <g class="body">
    <path d="M52 94 l-4 4 M56 94 l0 5 M60 94 l4 4 M66 94 l-4 4 M70 94 l0 5 M74 94 l4 4" stroke="#e8a33d" stroke-width="3" stroke-linecap="round"/>
    <g class="wing l"><path d="M38 52 C26 62 30 84 42 88 C42 74 44 62 46 54 Z" fill="#7a5a3f"/></g>
    <g class="wing r"><path d="M82 52 C94 62 90 84 78 88 C78 74 76 62 74 54 Z" fill="#7a5a3f"/></g>
    <ellipse cx="60" cy="66" rx="24" ry="28" fill="#a07a56"/>
    <ellipse cx="60" cy="74" rx="15" ry="17" fill="#f1dfc4"/>
    <path d="M52 66 q3 3 6 0 M62 72 q3 3 6 0 M52 80 q3 3 6 0" stroke="#c9a77f" stroke-width="2" fill="none"/>
    <g class="head">
      <path d="M40 28 L44 14 L52 26 Z M80 28 L76 14 L68 26 Z" fill="#7a5a3f"/>
      <ellipse cx="60" cy="38" rx="23" ry="19" fill="#a07a56"/>
      <circle cx="50" cy="38" r="10" fill="#f6ead6"/><circle cx="70" cy="38" r="10" fill="#f6ead6"/>
      <g class="eyes"><g class="eye"><circle cx="50" cy="38" r="5.5" fill="#1d1d1f"/><circle cx="52" cy="36" r="1.8" fill="#fff"/></g><g class="eye"><circle cx="70" cy="38" r="5.5" fill="#1d1d1f"/><circle cx="72" cy="36" r="1.8" fill="#fff"/></g></g>
      <g class="eyes-closed"><path d="M44 39 q6 4 12 0 M64 39 q6 4 12 0" stroke="#1d1d1f" stroke-width="2.6" fill="none" stroke-linecap="round"/></g>
      <g class="eyes-sad"><path d="M43 33 l11 3 M77 33 l-11 3" stroke="#1d1d1f" stroke-width="2.4" stroke-linecap="round"/><circle cx="50" cy="41" r="4" fill="#1d1d1f"/><circle cx="70" cy="41" r="4" fill="#1d1d1f"/></g>
      <path d="M56 46 L64 46 L60 53 Z" fill="#e8a33d"/>
      <ellipse class="mouth-open" cx="60" cy="52" rx="3" ry="2.5" fill="#7a2232"/>
    </g>
  </g>
</svg>`;
}

function egg() {
  return `
<svg class="pet-svg egg" viewBox="-4 -10 128 112" xmlns="${NS}">
  <ellipse class="pet-shadow" cx="60" cy="96" rx="22" ry="4" fill="rgba(0,0,0,.28)"/>
  <g class="body">
    <path d="M60 22 C80 22 90 56 88 72 C86 88 74 96 60 96 C46 96 34 88 32 72 C30 56 40 22 60 22 Z" fill="#fff7ea"/>
    <circle cx="50" cy="52" r="5" fill="#f3c98b"/><circle cx="70" cy="66" r="6" fill="#f3c98b"/><circle cx="54" cy="80" r="4" fill="#f3c98b"/><circle cx="72" cy="42" r="3.5" fill="#f3c98b"/>
    <path class="crack" d="M42 62 l6 -5 l5 6 l6 -6 l5 6 l6 -5" stroke="#c9a77f" stroke-width="2" fill="none"/>
    <path d="M46 34 C42 42 40 50 40 56" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" opacity=".8"/>
  </g>
</svg>`;
}

const CAGE = `
<svg class="pet-cage" viewBox="0 0 140 130" xmlns="${NS}">
  <path d="M10 28 C10 4 130 4 130 28" fill="none" stroke="#c9ccd3" stroke-width="5"/>
  <circle cx="70" cy="6" r="5" fill="none" stroke="#c9ccd3" stroke-width="3"/>
  <rect x="6" y="26" width="128" height="8" rx="4" fill="#9aa0aa"/>
  ${[18, 34, 50, 66, 82, 98, 114].map((x) => `<rect x="${x}" y="32" width="4" height="86" rx="2" fill="#c9ccd3"/>`).join('')}
  <rect x="4" y="116" width="132" height="10" rx="5" fill="#9aa0aa"/>
  <rect class="cage-door" x="50" y="40" width="40" height="70" rx="3" fill="none" stroke="#b3b8c2" stroke-width="3"/>
</svg>`;

// ───── outfits (unlocked as the pet grows) and trick props, drawn on top of the pet ─────
// Anchors per body: top of the head, the eye line (centre + spacing) and the neck.
const ANCHOR = { quad: { top: [84, 24], eyes: [87.5, 43, 17], neck: [80, 63] }, owl: { top: [60, 20], eyes: [60, 38, 20], neck: [60, 56] } };
const PROPS = {
  crown: (a) => `<g transform="translate(${a.top[0]} ${a.top[1] + 2})"><path d="M-13 0 L-13 -12 L-6.5 -5 L0 -15 L6.5 -5 L13 -12 L13 0 Z" fill="#f6c343" stroke="#d49b1a" stroke-width="1.5" stroke-linejoin="round"/><circle cx="0" cy="-6" r="2.2" fill="#e5484d"/><circle cx="-8" cy="-4" r="1.6" fill="#3e8ef7"/><circle cx="8" cy="-4" r="1.6" fill="#3ecf8e"/></g>`,
  bow: (a) => `<g transform="translate(${a.top[0] + 10} ${a.top[1] + 3}) rotate(15)"><path d="M0 0 L-10 -7 L-10 7 Z M0 0 L10 -7 L10 7 Z" fill="#ff5c8a" stroke="#d63c6b" stroke-width="1.2" stroke-linejoin="round"/><circle r="3" fill="#d63c6b"/></g>`,
  glasses: (a) => { const [x, y, s] = a.eyes; return `<g><rect x="${x - s / 2 - 7}" y="${y - 5}" width="14" height="10" rx="4" fill="#1d1d1f" opacity=".92"/><rect x="${x + s / 2 - 7}" y="${y - 5}" width="14" height="10" rx="4" fill="#1d1d1f" opacity=".92"/><path d="M${x - s / 2 + 7} ${y - 1} Q${x} ${y - 4} ${x + s / 2 - 7} ${y - 1}" stroke="#1d1d1f" stroke-width="2" fill="none"/><path d="M${x - s / 2 - 4} ${y - 3} l4 -1" stroke="#fff" stroke-width="1.4" opacity=".6"/></g>`; },
  scarf: (a) => { const [x, y] = a.neck; return `<g><path d="M${x - 16} ${y - 3} Q${x} ${y + 6} ${x + 16} ${y - 3} L${x + 16} ${y + 4} Q${x} ${y + 13} ${x - 16} ${y + 4} Z" fill="#e5484d"/><path d="M${x - 6} ${y + 6} l-3 16 l7 -1 l1 -14 Z" fill="#c93a3f"/><path d="M${x - 12} ${y + 1} l3 4 M${x - 3} ${y + 4} l3 4 M${x + 6} ${y + 3} l3 4" stroke="#fff" stroke-width="1.5" opacity=".5"/></g>`; },
  party: (a) => `<g transform="translate(${a.top[0] - 4} ${a.top[1] + 4}) rotate(-12)"><path d="M-10 0 L0 -26 L10 0 Z" fill="#7c5cff"/><path d="M-6.5 -9 L6.5 -9 M-3.5 -17 L3.5 -17" stroke="#ffd60a" stroke-width="3"/><circle cy="-27" r="3.5" fill="#ff5c8a"/></g>`,
  nightcap: (a) => `<g transform="translate(${a.top[0]} ${a.top[1] + 4})"><path d="M-14 0 C-12 -16 8 -22 18 -8 C20 -2 22 4 24 8 C18 2 12 -2 14 0 Z" fill="#3e63dd"/><path d="M-15 0 L15 0" stroke="#fff" stroke-width="4" stroke-linecap="round"/><circle cx="24" cy="9" r="3.5" fill="#fff"/></g>`,
};
const BALL = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#c6f432" stroke="#9cc21f" stroke-width="1.5"/><path d="M4 7 C10 10 10 16 5 19 M20 5 C14 9 14 15 19 19" stroke="#fff" stroke-width="1.6" fill="none"/></svg>';
const CONFETTI = ['#ff5c8a', '#ffd60a', '#3ecf8e', '#3e8ef7', '#a78bfa'].map((c) => `<svg viewBox="0 0 10 10"><rect width="10" height="6" rx="1.5" fill="${c}"/></svg>`);

const TREATS = {
  fish: '<svg viewBox="0 0 40 24"><path d="M4 12 C12 2 26 2 32 12 C26 22 12 22 4 12 Z" fill="#7fb7e8"/><path d="M32 12 L40 4 L40 20 Z" fill="#5b9bd5"/><circle cx="12" cy="10" r="2" fill="#1d1d1f"/></svg>',
  bone: '<svg viewBox="0 0 44 20"><path d="M8 4 a5 5 0 1 0 0 8 h28 a5 5 0 1 0 0 -8 a5 5 0 1 0 0 8 h-28" fill="#f6efe2" stroke="#d8cdb8" stroke-width="1.5"/></svg>',
  carrot: '<svg viewBox="0 0 30 40"><path d="M15 10 L24 14 L15 40 L6 14 Z" fill="#f39233"/><path d="M15 10 L10 0 M15 10 L15 0 M15 10 L20 0" stroke="#4caf50" stroke-width="3" stroke-linecap="round"/></svg>',
  berry: '<svg viewBox="0 0 30 30"><circle cx="11" cy="18" r="8" fill="#e53950"/><circle cx="20" cy="17" r="7" fill="#c62a43"/><path d="M15 10 L13 2" stroke="#4caf50" stroke-width="3" stroke-linecap="round"/></svg>',
  bamboo: '<svg viewBox="0 0 16 44"><rect x="4" y="0" width="8" height="44" rx="3" fill="#7cc66a"/><path d="M4 14 h8 M4 30 h8" stroke="#4f9a40" stroke-width="2"/><path d="M12 8 C20 4 22 10 16 12" fill="#5fb24f"/></svg>',
  meat: '<svg viewBox="0 0 40 30"><path d="M8 6 C20 -2 36 8 30 20 C24 30 6 26 6 16 Z" fill="#d9534f"/><path d="M28 20 L38 28" stroke="#f6efe2" stroke-width="5" stroke-linecap="round"/></svg>',
  apple: '<svg viewBox="0 0 30 32"><path d="M15 8 C26 2 32 16 24 26 C20 32 10 32 6 26 C-2 16 4 2 15 8 Z" fill="#e53950"/><path d="M15 8 L17 0" stroke="#7a5a3f" stroke-width="2"/><path d="M17 3 C22 0 25 3 22 5" fill="#4caf50"/></svg>',
};
const HEART = '<svg viewBox="0 0 24 22"><path d="M12 21 C-6 9 4 -4 12 5 C20 -4 30 9 12 21 Z" fill="#ff4d6d"/></svg>';

// ───── sounds (synthesised, so every pet sounds like itself) ─────
let actx = null;
function audio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!actx) actx = new AC();
  if (actx.state === 'suspended') actx.resume().catch(() => {});
  return actx;
}
function tone(a, { type = 'sine', from, to, dur, vol = 0.25, delay = 0, filter = null, vibrato = 0 }) {
  const t0 = a.currentTime + delay;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(from, t0);
  if (Array.isArray(to)) to.forEach(([f, t]) => o.frequency.exponentialRampToValueAtTime(f, t0 + t));
  else o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + Math.min(0.04, dur * 0.2));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  let node = o;
  if (vibrato) { const l = a.createOscillator(), lg = a.createGain(); l.frequency.value = vibrato; lg.gain.value = from * 0.06; l.connect(lg).connect(o.frequency); l.start(t0); l.stop(t0 + dur); }
  if (filter) { const f = a.createBiquadFilter(); f.type = filter.type; f.frequency.value = filter.f; f.Q.value = filter.q || 1; node.connect(f); node = f; }
  node.connect(g).connect(a.destination);
  o.start(t0); o.stop(t0 + dur + 0.05);
}
function noise(a, { dur, vol = 0.2, delay = 0, f = 1200, q = 0.8 }) {
  const t0 = a.currentTime + delay;
  const buf = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const s = a.createBufferSource(), bp = a.createBiquadFilter(), g = a.createGain();
  s.buffer = buf; bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q; g.gain.value = vol;
  s.connect(bp).connect(g).connect(a.destination); s.start(t0);
}
const VOICE = {
  cat: (a) => { tone(a, { type: 'sawtooth', from: 480, to: [[820, 0.22], [430, 0.62]], dur: 0.66, vol: 0.16, filter: { type: 'bandpass', f: 1400, q: 1.6 }, vibrato: 7 }); },
  dog: (a) => { for (const d of [0, 0.22]) { tone(a, { type: 'square', from: 300, to: 170, dur: 0.13, vol: 0.12, delay: d, filter: { type: 'lowpass', f: 1200 } }); noise(a, { dur: 0.1, vol: 0.12, delay: d, f: 900 }); } },
  bunny: (a) => { tone(a, { from: 1300, to: 1900, dur: 0.09, vol: 0.12 }); tone(a, { from: 1500, to: 2100, dur: 0.09, vol: 0.1, delay: 0.13 }); },
  fox: (a) => { tone(a, { type: 'sawtooth', from: 650, to: [[1250, 0.08], [700, 0.2]], dur: 0.22, vol: 0.12, filter: { type: 'bandpass', f: 1800, q: 1.2 } }); tone(a, { type: 'sawtooth', from: 700, to: [[1300, 0.07], [760, 0.18]], dur: 0.2, vol: 0.1, delay: 0.26, filter: { type: 'bandpass', f: 1800, q: 1.2 } }); },
  panda: (a) => { tone(a, { type: 'triangle', from: 900, to: [[1400, 0.1], [1000, 0.25]], dur: 0.25, vol: 0.14 }); },
  owl: (a) => { tone(a, { from: 420, to: 380, dur: 0.32, vol: 0.2 }); tone(a, { from: 420, to: 360, dur: 0.5, vol: 0.2, delay: 0.42 }); },
  dragon: (a) => { tone(a, { type: 'sawtooth', from: 110, to: 70, dur: 0.75, vol: 0.18, filter: { type: 'lowpass', f: 600 }, vibrato: 18 }); noise(a, { dur: 0.7, vol: 0.12, f: 300, q: 0.5 }); },
  unicorn: (a) => { tone(a, { type: 'sawtooth', from: 900, to: [[1200, 0.1], [600, 0.6]], dur: 0.62, vol: 0.12, filter: { type: 'bandpass', f: 1500, q: 1 }, vibrato: 14 }); [1568, 2093, 2637].forEach((f, i) => tone(a, { from: f, to: f, dur: 0.4, vol: 0.06, delay: 0.5 + i * 0.08 })); },
  egg: (a) => { noise(a, { dur: 0.05, vol: 0.25, f: 3000, q: 2 }); noise(a, { dur: 0.05, vol: 0.2, f: 2500, q: 2, delay: 0.09 }); },
  chomp: (a) => { for (let i = 0; i < 3; i++) noise(a, { dur: 0.06, vol: 0.18, f: 1600, q: 1.5, delay: i * 0.16 }); },
  cage: (a) => { [880, 1175, 660].forEach((f, i) => tone(a, { type: 'triangle', from: f, to: f * 0.98, dur: 0.35, vol: 0.08, delay: i * 0.05 })); },
};

// ───── the pet ─────
export function mountPet({ conv, msgs, chatId, api, me, userName, sounds }) {
  const zone = h('div', { class: 'pet-zone', 'aria-hidden': 'true' });
  const inner = h('div', { class: 'pet-inner' });
  const pet = h('div', { class: 'pet-actor' }, inner);
  const fx = h('div', { class: 'pet-fx' });
  zone.append(pet, fx);
  conv.append(zone);

  let state = null, kind = 'egg', x = 40, y = 0, targetX = 40, facing = 1, mode = 'idle', perch = null;
  let raf = 0, last = 0, nextThink = 0, lastActivity = Date.now(), destroyed = false, menu = null, cageEl = null;
  const W = () => zone.clientWidth, H = () => zone.clientHeight, SIZE = () => pet.offsetWidth || 84;
  const sound = (name) => { if (sounds()) { const a = audio(); if (a) VOICE[name]?.(a); } };

  function fit() {
    // The pet's world is the message area (it never covers the header or the composer).
    zone.style.top = msgs.offsetTop + 'px';
    zone.style.height = msgs.offsetHeight + 'px';
  }
  const ro = new ResizeObserver(fit); ro.observe(msgs); ro.observe(conv);

  let trick = null; // temporary prop for a trick ('party'), shown over the outfit
  function dress(el) {
    if (kind === 'egg') return;
    const a = ANCHOR[kind === 'owl' ? 'owl' : 'quad'];
    const head = el.querySelector('.head');
    const sleepingAtNight = mode === 'sleep' && state.night;
    const hat = trick || (sleepingAtNight ? 'nightcap' : null);
    const wear = (id) => { const g = document.createElementNS(NS, 'g'); g.setAttribute('class', 'outfit o-' + id); g.innerHTML = PROPS[id](a); return g; };
    if (state.outfit === 'scarf' && head) head.parentNode.insertBefore(wear('scarf'), head);
    if (state.outfit && state.outfit !== 'scarf' && !(hat && ['crown', 'bow'].includes(state.outfit))) (head || el).append(wear(state.outfit));
    if (hat) (head || el).append(wear(hat));
  }
  function draw() {
    if (!state) return;
    kind = state.level === 0 ? 'egg' : state.kind;
    inner.innerHTML = '';
    const art = svg(kind === 'egg' ? egg() : kind === 'owl' ? owl() : quadruped(kind));
    dress(art);
    inner.append(art);
    eyes = [];
    pet.className = `pet-actor k-${kind} stage-${state.level}` + (state.level >= 5 ? ' legend' : '');
    pet.dataset.mode = mode;
    setCage(state.caged, false);
  }

  async function load() {
    try { ({ pet: state } = await api('GET', `/api/chats/${chatId}/pet`)); } catch { zone.remove(); return; }
    if (destroyed) return;
    draw(); fit();
    x = Math.max(10, W() * 0.15); targetX = x; place();
    if ((state.mood === 'Sleeping' || (state.night && state.energy < 35)) && !state.caged) setMode('sleep');
    raf = requestAnimationFrame(loop);
    // Its favourite person gets a hello.
    if (state.favorite?.userId === me() && kind !== 'egg' && !state.caged && mode !== 'sleep') setTimeout(() => { facing = 1; place(); react('happy', 1200); burst(HEART, 5); say(`hi ${userName(me())}!`, 2200); }, 1200);
    needsHint();
  }
  // Now and then it tells you what it needs.
  let hintAt = 0;
  function needsHint() {
    if (!state || kind === 'egg' || state.caged || Date.now() - hintAt < 45000) return;
    if (state.hunger < 25) { hintAt = Date.now(); say('hungry… 🍖', 2400); react('sad', 1400); }
    else if (state.energy < 35 && mode !== 'sleep') { hintAt = Date.now(); say('*yawn*', 1800); }
    else if (state.happiness < 40) { hintAt = Date.now(); say('play with me?', 2200); react('tilt', 1300); }
  }
  const hintTimer = setInterval(needsHint, 50000);

  function setMode(m) {
    const wasSleep = mode === 'sleep';
    mode = m; pet.dataset.mode = m;
    if (state?.night && wasSleep !== (m === 'sleep')) draw(); // nightcap on/off
  }
  // ───── movement: smooth acceleration, real jump arcs, and never sitting on top of messages ─────
  let vx = 0, jump = null, eyes = [], lookAt = null, relocAt = 0;
  const BUSY = new Set(['happy', 'eat', 'react', 'laugh', 'tilt', 'perk', 'dance', 'stretch', 'spin', 'groom', 'sniff', 'yawn', 'look', 'jump']);
  const floorY = () => H() - pet.offsetHeight - 2;
  const zoneRect = () => zone.getBoundingClientRect();
  // Message bubbles (and notices) on screen, in the pet's coordinates.
  function bubbles() {
    const zr = zoneRect(), hh = H();
    const out = [];
    for (const b of msgs.querySelectorAll('.m .bubble, .sys, .day')) {
      const r = b.getBoundingClientRect();
      const t = r.top - zr.top, bb = r.bottom - zr.top;
      if (bb > 0 && t < hh && r.width > 0) out.push({ el: b, l: r.left - zr.left, r: r.right - zr.left, t, b: bb });
    }
    return out;
  }
  const petBox = (px, py) => ({ l: px + SIZE() * 0.12, r: px + SIZE() * 0.88, t: py + pet.offsetHeight * 0.3, b: py + pet.offsetHeight - 4 });
  // How much message area the pet would hide at (px, py) — small overlaps (a corner) don't count.
  function overlapArea(px, py, list = bubbles()) {
    const p = petBox(px, py); let a = 0;
    for (const r of list) {
      if (r.el === perch?.el) continue;
      const w = Math.min(p.r, r.r) - Math.max(p.l, r.l), hh = Math.min(p.b, r.b) - Math.max(p.t, r.t);
      if (w > 0 && hh > 0) a += w * hh;
    }
    return a;
  }
  const covering = (px = x, py = y) => overlapArea(px, py) > 150;
  // Stretches of floor with no message in the way: [minX, maxX] for the pet's left edge.
  function freeSpans() {
    const s = SIZE(), fy = floorY(), bt = fy + pet.offsetHeight * 0.3, bb = fy + pet.offsetHeight;
    const blocks = bubbles().filter((r) => r.t < bb && r.b > bt).map((r) => [r.l - 6, r.r + 6]).sort((p, q) => p[0] - q[0]);
    const spans = []; let cur = 4;
    for (const [l, r] of blocks) { if (l - cur >= s) spans.push([cur, l - s]); cur = Math.max(cur, r); }
    if (W() - 4 - cur >= s) spans.push([cur, W() - 4 - s]);
    return spans;
  }
  // A bubble with room on top (nothing above it where the pet would sit).
  function perchSpots({ avoidLeft = false } = {}) {
    const ph = pet.offsetHeight, s = SIZE();
    return bubbles().filter((r) => r.el.classList.contains('bubble') && r.r - r.l >= s * 0.75 && r.t - ph > 4 && r.t < floorY() - 30 && (!avoidLeft || r.r > W() * 0.5))
      .map((r) => ({ el: r.el, dx: Math.max(0, Math.min(r.r - r.l - s, (r.r - r.l - s) / 2 + (Math.random() - 0.5) * 30)), r }))
      .filter((p) => overlapArea(p.r.l + p.dx, p.r.t - ph + 6) < 150);
  }
  // Where to be: the floor spot that hides the least text, closest to where it is (and away from the
  // bottom-left when someone is typing). In a packed chat it hops onto a bubble with room, or peeks in
  // from the screen edge with most of its body hidden.
  function bestSpot({ avoidLeft = false } = {}) {
    const s = SIZE(), fy = floorY(), list = bubbles(), lo = -s * 0.55, hi = W() - s * 0.45;
    let best = null;
    for (let px = lo; px <= hi; px += 6) {
      const peek = px < 4 || px > W() - s - 4;
      const cost = overlapArea(px, fy, list) + Math.abs(px - x) * 0.08 + (peek ? 700 : 0) + (avoidLeft && px < W() * 0.45 ? 5000 : 0);
      if (!best || cost < best.cost) best = { x: px, cost, peek };
    }
    if (best.cost < 250) return best;
    const ps = perchSpots({ avoidLeft });
    if (ps.length) { const p = ps.sort((u, v) => v.r.t - u.r.t)[0]; return { perch: { el: p.el, dx: p.dx } }; }
    return best;
  }
  function goTo(spot, run = false) {
    if (!spot || jump) return;
    if (spot.perch) return leapTo(spot.perch);
    if (perch) { perch = null; return leapTo(null, spot.x); }
    targetX = spot.x; facing = targetX > x ? 1 : -1;
    if (Math.abs(targetX - x) > 3) setMode(run ? 'run' : LOOK[kind]?.hop ? 'hop' : 'walk');
  }
  // A real jump: a parabola from here to there, squashing on take-off and landing.
  function endOf(p, toX) {
    if (p?.el?.isConnected) { const r = p.el.getBoundingClientRect(), zr = zoneRect(); return [r.left - zr.left + p.dx, r.top - zr.top - pet.offsetHeight + 6]; }
    return [toX ?? x, floorY()];
  }
  function leapTo(p, toX = null) {
    const [tx, ty] = endOf(p, toX);
    facing = tx > x + 2 ? 1 : tx < x - 2 ? -1 : facing;
    const dist = Math.hypot(tx - x, ty - y);
    jump = { fromX: x, fromY: y, p, toX: tx, t0: performance.now() + 120, dur: Math.min(820, 360 + dist * 1.05), h: Math.max(26, Math.min(130, dist * 0.42 + (ty < y ? 30 : 0))) };
    perch = null; vx = 0;
    pet.classList.add('squash'); setTimeout(() => pet.classList.remove('squash'), 120);
    setMode('jump');
  }
  function place() {
    const s = SIZE();
    if (!jump) {
      if (perch) {
        const [px, py] = endOf(perch);
        // Its bubble scrolled away or got covered: hop down.
        if (!perch.el.isConnected || py < -pet.offsetHeight * 0.5 || py > floorY()) { const fx = x; perch = null; leapTo(null, fx); }
        else { x = px; y = py; }
      }
      if (!perch && !jump) y = floorY();
    }
    // It may peek in from either edge (most of its body off-screen) when the chat is packed.
    x = Math.max(-s * 0.55, Math.min(W() - s * 0.45, x));
    pet.classList.toggle('peek', x < 0 || x > W() - s);
    pet.style.transform = `translate(${x}px, ${y}px)`;
    inner.style.transform = `scaleX(${facing})`;
    if (cageEl) { const fy = floorY(); cageEl.style.width = s * 1.36 + 'px'; cageEl.style.transform = `translate(${x - s * 0.18}px, ${fy - s * 0.36}px)`; }
  }
  // Eyes follow your finger, whoever is typing, or the newest message.
  function look(px, py, ms = 2500) { lookAt = { x: px, y: py, until: performance.now() + ms }; }
  function aimEyes(now) {
    if (!eyes.length) eyes = [...inner.querySelectorAll('.eye')];
    let dx = 0, dy = 0;
    if (lookAt && now < lookAt.until && mode !== 'sleep') {
      const cx = x + SIZE() * (facing > 0 ? 0.72 : 0.28), cy = y + pet.offsetHeight * 0.38;
      dx = Math.max(-1, Math.min(1, (lookAt.x - cx) / 90)) * 1.7 * facing;
      dy = Math.max(-1, Math.min(1, (lookAt.y - cy) / 90)) * 1.3;
    }
    for (const e of eyes) for (const c of e.children) c.setAttribute('transform', `translate(${dx.toFixed(2)} ${dy.toFixed(2)})`);
  }
  const onPointer = (e) => { const zr = zoneRect(); look(e.clientX - zr.left, e.clientY - zr.top, 1800); };
  conv.addEventListener('pointermove', onPointer, { passive: true });
  conv.addEventListener('pointerdown', onPointer, { passive: true });

  const IDLES = ['sniff', 'groom', 'look', 'yawn', 'stretch'];
  function think(now) {
    if (state.caged) { setMode(Math.random() < 0.3 ? 'shake' : 'sad'); nextThink = now + 2500 + Math.random() * 2500; return; }
    if (kind === 'egg') { if (covering()) goTo(bestSpot()); setMode(Math.random() < 0.4 ? 'wobble' : 'idle'); nextThink = now + 2500 + Math.random() * 3000; return; }
    // Never settle on top of a message (unless this already is the least-covering spot).
    if (covering()) { const sp = bestSpot(); if (sp.perch || Math.abs(sp.x - x) > 8) { goTo(sp, true); nextThink = now + 1800; return; } }
    if (Date.now() - lastActivity > 4 * 60000 || state.mood === 'Sleeping') { setMode('sleep'); nextThink = now + 15000; return; }
    const r = Math.random();
    if (r < 0.3) {
      const spans = freeSpans();
      if (spans.length) { const [a, b] = spans[Math.floor(Math.random() * spans.length)]; goTo({ x: a + Math.random() * (b - a) }); }
      nextThink = now + 7000;
    } else if (r < 0.42) {
      const ps = perchSpots(); if (ps.length) { const p = ps[Math.floor(Math.random() * ps.length)]; leapTo({ el: p.el, dx: p.dx }); } else setMode('sit');
      nextThink = now + 6000;
    } else if (r < 0.5 && perch) {
      const spans = freeSpans(); if (spans.length) { const [a, b] = spans[0]; leapTo(null, Math.max(a, Math.min(b, x))); }
      nextThink = now + 4000;
    } else if (r < 0.78) {
      const m = Math.random() < 0.06 ? 'spin' : IDLES[Math.floor(Math.random() * IDLES.length)];
      react(m, m === 'stretch' ? 1500 : m === 'spin' ? 900 : 1400);
      if (m === 'look') look(x + (Math.random() < 0.5 ? -200 : 200), y - 60, 1300);
      nextThink = now + 2600 + Math.random() * 2500;
    } else { setMode(Math.random() < 0.5 ? 'sit' : 'idle'); nextThink = now + 3500 + Math.random() * 4000; }
  }

  function loop(t) {
    if (destroyed) return;
    const dt = Math.min(0.05, (t - (last || t)) / 1000); last = t;
    if (jump) {
      const k = Math.max(0, Math.min(1, (t - jump.t0) / jump.dur));
      const [tx, ty] = endOf(jump.p, jump.toX); // the target can scroll mid-air
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      x = jump.fromX + (tx - jump.fromX) * e;
      y = jump.fromY + (ty - jump.fromY) * k - jump.h * 4 * k * (1 - k);
      pet.style.transform = `translate(${x}px, ${y}px)`;
      inner.style.transform = `scaleX(${facing})`;
      if (k >= 1) {
        perch = jump.p && jump.p.el.isConnected ? jump.p : null; jump = null;
        pet.classList.add('land'); setTimeout(() => pet.classList.remove('land'), 220);
        setMode('sit'); nextThink = t + 1400 + Math.random() * 1500;
        place();
      }
    } else {
      if (state && t > nextThink && !BUSY.has(mode)) think(t);
      if ((mode === 'walk' || mode === 'hop' || mode === 'run') && state) {
        perch = null;
        const max = mode === 'run' ? 170 : kind === 'owl' ? 38 : mode === 'hop' ? 82 : 60;
        const d = targetX - x;
        const desired = Math.max(-max, Math.min(max, d * 3.2)); // eases in when it arrives
        vx += (desired - vx) * Math.min(1, dt * 5.5);            // and accelerates smoothly
        x += vx * dt;
        if (Math.abs(vx) > 4) facing = vx > 0 ? 1 : -1;
        pet.style.setProperty('--gait', Math.max(0.13, Math.min(0.48, 20 / Math.max(8, Math.abs(vx)))).toFixed(2) + 's');
        if (Math.abs(d) < 2 && Math.abs(vx) < 14) { vx = 0; if (x < 0) facing = 1; else if (x > W() - SIZE()) facing = -1; setMode('idle'); nextThink = Math.min(nextThink, t + 600); }
      }
      place();
    }
    aimEyes(t);
    raf = requestAnimationFrame(loop);
  }
  // Watchdog: if a new message lands on it, it gets out of the way (see-through until it has moved).
  const guard = setInterval(() => {
    if (!state || destroyed || jump || state.caged) { pet.classList.remove('ghost'); return; }
    const over = covering();
    pet.classList.toggle('ghost', over);
    if (over && !['walk', 'run', 'hop'].includes(mode) && Date.now() - relocAt > 700) {
      relocAt = Date.now();
      const sp = bestSpot();
      if (sp.perch || Math.abs(sp.x - x) > 8) { if (mode === 'sleep') setMode('idle'); goTo(sp, true); }
    }
  }, 350);

  function burst(markup, n = 5, cls = 'up') {
    const s = SIZE();
    for (let i = 0; i < n; i++) {
      const p = h('i', { class: 'pet-particle ' + cls });
      p.innerHTML = markup;
      p.style.left = (x + s * 0.3 + Math.random() * s * 0.5) + 'px';
      p.style.top = (y + 4) + 'px';
      p.style.animationDelay = i * 90 + 'ms';
      p.style.setProperty('--dx', (Math.random() * 60 - 30) + 'px');
      fx.append(p);
      setTimeout(() => p.remove(), 1600 + i * 90);
    }
  }
  function say(text, ms = 1800) {
    const b = h('div', { class: 'pet-say' }, text);
    b.style.left = (x + SIZE() * 0.5) + 'px'; b.style.top = Math.max(0, y - 30) + 'px';
    fx.append(b);
    setTimeout(() => b.remove(), ms);
  }
  function react(m, ms = 1100) {
    if (state?.caged) return;
    setMode(m);
    setTimeout(() => { if (mode === m) setMode('idle'); }, ms);
    nextThink = performance.now() + ms + 400;
  }

  function setCage(on, animate = true) {
    if (on && !cageEl) {
      cageEl = svg(CAGE);
      cageEl.addEventListener('click', (e) => { e.stopPropagation(); openMenu(); });
      zone.append(cageEl);
      if (animate) { cageEl.classList.add('drop'); sound('cage'); }
      targetX = x; setMode('sad');
    } else if (!on && cageEl) {
      cageEl.classList.add('lift');
      const c = cageEl; cageEl = null;
      setTimeout(() => c.remove(), 450);
      if (animate) { setTimeout(() => { setMode('happy'); burst(HEART, 6); sound(kind); }, 250); setTimeout(() => setMode('idle'), 1400); }
    }
    place();
  }

  function feed(byMe) {
    if (state.caged || kind === 'egg') return;
    const treat = h('i', { class: 'pet-treat' });
    treat.innerHTML = TREATS[LOOK[kind]?.treat || 'apple'] || TREATS.apple;
    const tx = Math.max(20, Math.min(W() - 60, x + (Math.random() < 0.5 ? -80 : 120)));
    treat.style.left = tx + 'px';
    fx.append(treat);
    setTimeout(() => { targetX = tx - SIZE() * 0.4; facing = targetX > x ? 1 : -1; setMode('run'); }, 500);
    const check = setInterval(() => {
      if (Math.abs(targetX - x) < 4 || destroyed) {
        clearInterval(check);
        setMode('eat'); if (byMe) sound('chomp');
        setTimeout(() => { treat.remove(); setMode('happy'); burst(HEART, 4); setTimeout(() => setMode('idle'), 900); }, 1300);
      }
    }, 120);
  }

  // Fetch: the ball is thrown across the chat, the pet races after it and brings it back.
  let fetching = false;
  function fetchBall(where, byMe) {
    if (state.caged || kind === 'egg' || fetching) return;
    fetching = true;
    const s = SIZE(), home = x;
    const ball = h('i', { class: 'pet-ball' });
    ball.innerHTML = BALL;
    const bx = Math.max(10, Math.min(W() - 34, 10 + where * (W() - 44)));
    ball.style.setProperty('--from', (x + s / 2) + 'px'); ball.style.setProperty('--to', bx + 'px');
    ball.style.left = bx + 'px';
    fx.append(ball);
    if (byMe) sound('chomp');
    if (mode === 'sleep') setMode('idle');
    perch = null; place();
    setTimeout(() => { targetX = Math.max(4, bx - s * 0.35); facing = targetX > x ? 1 : -1; setMode('run'); }, 450);
    const t = setInterval(() => {
      if (destroyed) return clearInterval(t);
      if (mode !== 'run' || Math.abs(targetX - x) < 4) {
        clearInterval(t);
        ball.classList.add('carried');
        const carry = setInterval(() => { ball.style.left = (x + (facing > 0 ? s * 0.78 : s * 0.02)) + 'px'; }, 30);
        setTimeout(() => { targetX = home; facing = targetX > x ? 1 : -1; setMode('run'); }, 350);
        const back = setInterval(() => {
          if (destroyed || Math.abs(targetX - x) < 4 || mode !== 'run') {
            clearInterval(back); clearInterval(carry);
            ball.classList.add('drop'); setTimeout(() => ball.remove(), 700);
            setMode('happy'); burst(HEART, 5); sound(kind); fetching = false;
            setTimeout(() => setMode('idle'), 1000);
          }
        }, 60);
      }
    }, 60);
  }

  async function act(action, body = {}) {
    closeMenu();
    try { const r = await api('POST', `/api/chats/${chatId}/pet`, { action, ...body }); state = r.pet; draw(); place(); } catch (e) { toast(e.message, { error: true }); }
  }
  async function rename() {
    closeMenu();
    const name = await promptDialog({ title: 'Name your pet', value: state.name, placeholder: state.defaultName, maxlength: 20, ok: 'Save', note: 'Everyone in this chat sees the new name. Say it in a message and it comes running.' });
    if (name && name.trim() && name.trim() !== state.name) act('rename', { name: name.trim() });
  }
  async function chooseOutfit() {
    closeMenu();
    const choice = await actionSheet({ title: state.nextOutfit ? `More outfits unlock as ${state.name} grows (next: ${state.nextOutfit})` : 'Outfits',
      actions: [...state.outfits.map((o) => ({ label: o.label + (state.outfit === o.id ? ' ✓' : ''), value: o.id })), state.outfit ? { label: 'No outfit', value: 'none' } : null].filter(Boolean) });
    if (choice) act('outfit', { outfit: choice === 'none' ? null : choice });
  }

  function closeMenu() { menu?.remove(); menu = null; }
  function openMenu() {
    closeMenu();
    const L = state;
    const bar = (label, v, cls) => h('div', { class: 'pet-need ' + cls }, h('span', null, label), h('div', { class: 'pn-track' }, h('i', { style: { width: v + '%' } })), h('small', null, v));
    menu = h('div', { class: 'pet-menu' },
      h('div', { class: 'pet-menu-top' }, h('b', null, L.level === 0 ? 'Mystery egg' : L.name), L.level > 0 ? h('span', { class: 'pet-rar r-' + L.rarity.toLowerCase() }, L.rarity) : null),
      h('span', null, L.level === 0 ? `Hatches at 20 messages · ${L.xp}/20` : `${L.stage} ${L.moodEmoji} ${L.mood}${L.next ? ` · ${L.xp}/${L.next} to grow` : ''}`),
      L.level > 0 ? h('div', { class: 'pet-needs' }, bar('Food', L.hunger, 'food'), bar('Joy', L.happiness, 'joy'), bar('Energy', L.energy, 'energy')) : null,
      L.favorite ? h('span', { class: 'pet-fav' }, `❤ Loves ${L.favorite.userId === me() ? 'you' : L.favorite.name.split(' ')[0]} most`) : null,
      h('div', { class: 'pet-menu-row' },
        L.level > 0 && !L.caged ? h('button', { onclick: () => act('feed') }, '🍖 Feed') : null,
        L.level > 0 && !L.caged ? h('button', { onclick: () => act('play') }, '🎾 Play') : null,
        L.level > 0 && !L.caged ? h('button', { onclick: () => { closeMenu(); react('happy', 1100); burst(HEART, 6); sound(kind); api('POST', `/api/chats/${chatId}/pet`, { action: 'poke' }).then((r) => { state = r.pet; }).catch(() => {}); } }, '🤚 Pet') : null),
      h('div', { class: 'pet-menu-row small' },
        L.level > 0 ? h('button', { onclick: rename }, 'Rename') : null,
        L.level > 0 && L.outfits.length ? h('button', { onclick: chooseOutfit }, 'Outfit') : null,
        L.level > 0 ? h('button', { onclick: () => act(L.caged ? 'release' : 'cage') }, L.caged ? 'Let out' : 'Cage') : null,
        h('button', { onclick: () => { closeMenu(); hideForMe(); } }, 'Hide')));
    const s = SIZE();
    menu.style.left = Math.max(8, Math.min(W() - 250, x + s / 2 - 120)) + 'px';
    menu.style.top = Math.max(4, y - 190) + 'px';
    zone.append(menu);
    setTimeout(() => document.addEventListener('pointerdown', outside, { once: true, capture: true }), 0);
  }
  const outside = (e) => { if (menu && !menu.contains(e.target)) closeMenu(); else if (menu) document.addEventListener('pointerdown', outside, { once: true, capture: true }); };

  async function hideForMe() {
    const ok = await actionSheet({ title: 'Hide the pet in this group?', actions: [{ label: 'Hide for me', value: 'hide' }] });
    if (ok !== 'hide') return;
    try { localStorage.setItem('mm:petHidden:' + chatId, '1'); } catch {}
    destroy();
    toast('Pet hidden — turn it back on from the group info', { timeout: 3500 });
  }

  // Tap = poke (sound + jump + hearts, everyone sees it), and the little menu.
  pet.addEventListener('click', (e) => {
    e.stopPropagation();
    lastActivity = Date.now();
    if (state.caged) { setMode('shake'); sound(kind === 'egg' ? 'egg' : kind); openMenu(); return; }
    sound(kind === 'egg' ? 'egg' : kind);
    if (kind === 'egg') react('wobble', 900);
    else { react('happy', 1000); burst(HEART, 5); }
    api('POST', `/api/chats/${chatId}/pet`, { action: 'poke' }).then((r) => { state = r.pet; }).catch(() => {});
    openMenu();
  });

  // ───── chat → pet reactions ─────
  function onMessage(m) {
    if (!state || destroyed) return;
    lastActivity = Date.now();
    setTimeout(() => {
      if (destroyed) return;
      const mine = m.senderId === me();
      look(mine ? W() - 40 : 40, H() - 30, 2200);
      if (!jump && covering()) goTo(bestSpot(), true);
    }, 90);
    if (mode === 'sleep') { setMode('idle'); say('!'); }
    if (state.caged || kind === 'egg') { if (kind === 'egg') react('wobble', 800); return; }
    const t = (m.text || '').toLowerCase();
    facing = m.senderId === me() ? 1 : -1;
    place();
    if (state.name && t.includes(state.name.toLowerCase())) { targetX = W() / 2 - SIZE() / 2; setMode('run'); setTimeout(() => { react('happy', 1100); burst(HEART, 6); }, 700); return; }
    // Tricks: party dance, morning stretch, and running to its favourite person's messages.
    if (/(🎉|🎂|🥳|happy birthday|congrats|congratulations|party)/.test(t)) { party(); return; }
    if (/\b(good morning|gm|morning)\b/.test(t) || t.includes('☀')) { react('stretch', 1600); say('morning! ☀️', 2000); return; }
    if (/\b(good night|gn|sleep well)\b/.test(t) || t.includes('🌙')) { react('sit', 1500); say('night night 🌙', 2000); return; }
    if (state.favorite && m.senderId === state.favorite.userId && Math.random() < 0.6) { targetX = facing > 0 ? W() - SIZE() - 12 : 12; setMode('run'); setTimeout(() => { react('happy', 1000); burst(HEART, 4); }, 900); return; }
    if (/(❤|😍|🥰|love|miss you|cute)/.test(t)) { react('happy', 1200); burst(HEART, 6); return; }
    if (/(😂|🤣|haha|lol|lmao|hehe)/.test(t)) { react('laugh', 1200); say('ha!'); return; }
    if (/\?\s*$/.test(t)) { react('tilt', 1300); say('?'); return; }
    if (m.kind === 'image' || m.kind === 'video') { react('react', 900); say('ooh'); return; }
    react('react', 700);
  }
  function party() {
    trick = 'party'; draw(); place();
    react('dance', 3200);
    for (let i = 0; i < 3; i++) setTimeout(() => burst(CONFETTI[Math.floor(Math.random() * CONFETTI.length)], 6, 'confetti'), i * 350);
    say('🎉 yay!', 2200);
    setTimeout(() => { trick = null; draw(); place(); }, 3400);
  }
  // Someone is typing: it perks up, looks at where their message will appear (bottom left) and steps
  // aside — or hops onto an older bubble — so their message never lands under it.
  let typingAt = 0;
  function onTyping() {
    lastActivity = Date.now();
    if (!state || state.caged) return;
    if (mode === 'sleep') setMode('idle');
    look(40, H() - 20, 3000);
    if (Date.now() - typingAt < 2500) return;
    typingAt = Date.now();
    const inTheWay = !perch && x < W() * 0.6;
    if (inTheWay || covering()) goTo(bestSpot({ avoidLeft: true }), true);
    else if (kind !== 'egg') react('perk', 900);
    if (kind !== 'egg' && Math.random() < 0.35) setTimeout(() => say('…', 1200), 400);
  }
  function onEvent(ev) {
    if (!state || ev.chatId !== chatId) return;
    const was = state.caged;
    state = ev.pet;
    if (ev.action === 'cage' || ev.action === 'release') {
      if (was !== state.caged) setCage(state.caged, true);
      if (ev.by !== me()) toast(`${userName(ev.by)} ${state.caged ? 'put ' + (state.name || 'the pet') + ' in the cage' : 'let ' + (state.name || 'the pet') + ' out'}`, { timeout: 2200 });
    } else if (ev.action === 'feed') { feed(ev.by === me()); if (ev.by !== me()) say('yum!'); }
    else if (ev.action === 'play') { fetchBall(ev.throwX ?? Math.random(), ev.by === me()); if (ev.by !== me()) toast(`${userName(ev.by)} is playing fetch with ${state.name}`, { timeout: 2000 }); }
    else if (ev.action === 'rename') { draw(); place(); react('happy', 1200); burst(HEART, 6); say(`I'm ${state.name}!`, 2400); }
    else if (ev.action === 'outfit') { draw(); place(); react('happy', 900); say(state.outfit ? 'how do I look?' : 'ahh, comfy', 1800); }
    else if (ev.action === 'poke' && ev.by !== me()) { react(state.caged ? 'shake' : kind === 'egg' ? 'wobble' : 'happy', 900); if (!state.caged && kind !== 'egg') burst(HEART, 3); }
  }

  // Blink now and then.
  const blink = setInterval(() => { if (mode !== 'sleep') { pet.classList.add('blink'); setTimeout(() => pet.classList.remove('blink'), 140); } }, 3800);

  function destroy() {
    destroyed = true;
    cancelAnimationFrame(raf); clearInterval(blink); clearInterval(hintTimer); clearInterval(guard); ro.disconnect();
    conv.removeEventListener('pointermove', onPointer); conv.removeEventListener('pointerdown', onPointer);
    zone.remove();
  }

  load();
  return { destroy, onMessage, onTyping, onEvent };
}

export const petHidden = (chatId) => { try { return localStorage.getItem('mm:petHidden:' + chatId) === '1'; } catch { return false; } };
export const showPetAgain = (chatId) => { try { localStorage.removeItem('mm:petHidden:' + chatId); } catch {} };
