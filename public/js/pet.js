// The group pet lives inside the chat: it wanders along the bottom, hops onto message bubbles,
// sleeps when the chat goes quiet, reacts to what people say, and makes its own sound when tapped.
// Anyone can feed it, put it in a cage or let it out — everyone in the group sees the same pet.
import { h, toast, actionSheet } from './ui.js';

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

  function draw() {
    if (!state) return;
    kind = state.level === 0 ? 'egg' : state.kind;
    inner.innerHTML = '';
    inner.append(svg(kind === 'egg' ? egg() : kind === 'owl' ? owl() : quadruped(kind)));
    pet.className = `pet-actor k-${kind} stage-${state.level}` + (state.level >= 5 ? ' legend' : '');
    pet.dataset.mode = mode;
    setCage(state.caged, false);
  }

  async function load() {
    try { ({ pet: state } = await api('GET', `/api/chats/${chatId}/pet`)); } catch { zone.remove(); return; }
    if (destroyed) return;
    draw(); fit();
    x = Math.max(10, W() * 0.15); targetX = x; place();
    if (state.mood === 'Sleeping' && !state.caged) setMode('sleep');
    raf = requestAnimationFrame(loop);
  }

  function setMode(m) { mode = m; pet.dataset.mode = m; }
  function place() {
    const s = SIZE();
    x = Math.max(4, Math.min(W() - s - 4, x));
    const floorY = H() - pet.offsetHeight - 2;
    const yy = perch ? Math.max(0, Math.min(floorY, perch.y - pet.offsetHeight + 6)) : floorY;
    y = yy;
    pet.style.transform = `translate(${x}px, ${y}px)`;
    inner.style.transform = `scaleX(${facing})`;
    if (cageEl) { cageEl.style.width = s * 1.36 + 'px'; cageEl.style.transform = `translate(${x - s * 0.18}px, ${floorY - s * 0.36}px)`; }
  }

  // Pick a message bubble on screen to hop onto (or come back down to the floor).
  function bubbleSpot() {
    const zr = zone.getBoundingClientRect();
    const opts = [...msgs.querySelectorAll('.bubble')].map((b) => b.getBoundingClientRect())
      .filter((r) => r.width > 90 && r.top - zr.top > 70 && r.bottom < zr.bottom - 40);
    if (!opts.length) return null;
    const r = opts[Math.floor(Math.random() * opts.length)];
    return { x: r.left - zr.left + Math.random() * Math.max(0, r.width - SIZE()), y: r.top - zr.top };
  }

  function think(now) {
    if (state.caged) { setMode(Math.random() < 0.3 ? 'shake' : 'sad'); nextThink = now + 2500 + Math.random() * 2500; return; }
    if (kind === 'egg') { setMode(Math.random() < 0.4 ? 'wobble' : 'idle'); nextThink = now + 2500 + Math.random() * 3000; return; }
    if (Date.now() - lastActivity > 4 * 60000 || state.mood === 'Sleeping') { perch = null; place(); setMode('sleep'); nextThink = now + 15000; return; }
    const r = Math.random();
    if (r < 0.5) { targetX = 10 + Math.random() * (W() - SIZE() - 20); facing = targetX > x ? 1 : -1; setMode(LOOK[kind]?.hop ? 'hop' : 'walk'); nextThink = now + 9000; }
    else if (r < 0.65) { const spot = bubbleSpot(); if (spot) jumpTo(spot); else setMode('sit'); nextThink = now + 6000; }
    else if (r < 0.75 && perch) { jumpTo(null); nextThink = now + 5000; }
    else { setMode(Math.random() < 0.5 ? 'sit' : 'idle'); nextThink = now + 3500 + Math.random() * 4000; }
  }

  function jumpTo(spot) {
    if (spot) { facing = spot.x > x ? 1 : -1; x = spot.x; }
    perch = spot;
    pet.classList.remove('leap'); void pet.offsetWidth; pet.classList.add('leap');
    place();
    setTimeout(() => { pet.classList.remove('leap'); setMode('sit'); }, 520);
  }

  function loop(t) {
    if (destroyed) return;
    const dt = Math.min(0.05, (t - (last || t)) / 1000); last = t;
    if (state && t > nextThink && !['happy', 'eat', 'react'].includes(mode)) think(t);
    if ((mode === 'walk' || mode === 'hop' || mode === 'run') && state) {
      perch = null;
      const speed = mode === 'run' ? 150 : kind === 'owl' ? 34 : mode === 'hop' ? 70 : 52;
      const d = targetX - x;
      if (Math.abs(d) < 3) setMode('idle');
      else { x += Math.sign(d) * Math.min(Math.abs(d), speed * dt); facing = d > 0 ? 1 : -1; }
      place();
    }
    // Keep a perched pet on its bubble while the chat scrolls; fall off if the bubble moves away.
    if (perch && mode !== 'walk') {
      const floorY = H() - pet.offsetHeight - 2;
      if (perch.y < 0 || perch.y > floorY) { perch = null; place(); }
    }
    raf = requestAnimationFrame(loop);
  }

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

  async function act(action) {
    closeMenu();
    try { const r = await api('POST', `/api/chats/${chatId}/pet`, { action }); state = r.pet; } catch (e) { toast(e.message, { error: true }); }
  }

  function closeMenu() { menu?.remove(); menu = null; }
  function openMenu() {
    closeMenu();
    const L = state;
    menu = h('div', { class: 'pet-menu' },
      h('b', null, L.level === 0 ? 'Mystery egg' : L.name),
      h('span', null, L.level === 0 ? `Hatches at 20 messages · ${L.xp}/20` : `${L.stage} · ${L.mood}${L.next ? ` · ${L.xp}/${L.next}` : ''}`),
      h('div', { class: 'pet-menu-row' },
        L.level > 0 && !L.caged ? h('button', { onclick: () => act('feed') }, 'Feed') : null,
        L.level > 0 ? h('button', { onclick: () => act(L.caged ? 'release' : 'cage') }, L.caged ? 'Let it out' : 'Put in cage') : null,
        h('button', { onclick: () => { closeMenu(); hideForMe(); } }, 'Hide')));
    const s = SIZE();
    menu.style.left = Math.max(8, Math.min(W() - 230, x + s / 2 - 110)) + 'px';
    menu.style.top = Math.max(4, y - 96) + 'px';
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
    api('POST', `/api/chats/${chatId}/pet`, { action: 'poke' }).catch(() => {});
    openMenu();
  });

  // ───── chat → pet reactions ─────
  function onMessage(m) {
    if (!state || destroyed) return;
    lastActivity = Date.now();
    if (mode === 'sleep') { setMode('idle'); say('!'); }
    if (state.caged || kind === 'egg') { if (kind === 'egg') react('wobble', 800); return; }
    const t = (m.text || '').toLowerCase();
    facing = m.senderId === me() ? 1 : -1;
    place();
    if (state.name && t.includes(state.name.toLowerCase())) { targetX = W() / 2 - SIZE() / 2; setMode('run'); setTimeout(() => { react('happy', 1100); burst(HEART, 6); }, 700); return; }
    if (/(❤|😍|🥰|love|miss you|cute)/.test(t)) { react('happy', 1200); burst(HEART, 6); return; }
    if (/(😂|🤣|haha|lol|lmao|hehe)/.test(t)) { react('laugh', 1200); say('ha!'); return; }
    if (/\?\s*$/.test(t)) { react('tilt', 1300); say('?'); return; }
    if (m.kind === 'image' || m.kind === 'video') { react('react', 900); say('ooh'); return; }
    react('react', 700);
  }
  function onTyping() { if (state && mode === 'sleep' && !state.caged) { setMode('idle'); } lastActivity = Date.now(); if (state && !state.caged && kind !== 'egg') react('perk', 900); }
  function onEvent(ev) {
    if (!state || ev.chatId !== chatId) return;
    const was = state.caged;
    state = ev.pet;
    if (ev.action === 'cage' || ev.action === 'release') {
      if (was !== state.caged) setCage(state.caged, true);
      if (ev.by !== me()) toast(`${userName(ev.by)} ${state.caged ? 'put ' + (state.name || 'the pet') + ' in the cage' : 'let ' + (state.name || 'the pet') + ' out'}`, { timeout: 2200 });
    } else if (ev.action === 'feed') { feed(ev.by === me()); if (ev.by !== me()) say('yum!'); }
    else if (ev.action === 'poke' && ev.by !== me()) { react(state.caged ? 'shake' : kind === 'egg' ? 'wobble' : 'happy', 900); if (!state.caged && kind !== 'egg') burst(HEART, 3); }
  }

  // Blink now and then.
  const blink = setInterval(() => { if (mode !== 'sleep') { pet.classList.add('blink'); setTimeout(() => pet.classList.remove('blink'), 140); } }, 3800);

  function destroy() {
    destroyed = true;
    cancelAnimationFrame(raf); clearInterval(blink); ro.disconnect();
    zone.remove();
  }

  load();
  return { destroy, onMessage, onTyping, onEvent };
}

export const petHidden = (chatId) => { try { return localStorage.getItem('mm:petHidden:' + chatId) === '1'; } catch { return false; } };
export const showPetAgain = (chatId) => { try { localStorage.removeItem('mm:petHidden:' + chatId); } catch {} };
