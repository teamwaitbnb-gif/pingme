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

// ───── art: chunky cartoon stickers — big head, thick outline, huge glossy eyes (faces right) ─────
const INK = '#2b1d16';
const O = `stroke="${INK}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"`;
const OT = `stroke="${INK}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"`;
function shade(hex, k) { // k < 0 darker, k > 0 lighter
  const n = parseInt(hex.slice(1), 16); const f = (c) => Math.round(k < 0 ? c * (1 + k) : c + (255 - c) * k);
  return '#' + [n >> 16, (n >> 8) & 255, n & 255].map((c) => f(c).toString(16).padStart(2, '0')).join('');
}
const TOON = {
  dog: { fur: '#8b4a22', dark: '#5a2d12', belly: '#f5c98e', muzzle: '#f5c98e' },
  cat: { fur: '#f2892e', dark: '#c9631a', belly: '#ffffff', muzzle: '#ffffff' },
  bunny: { fur: '#fbf3ea', dark: '#e2cfc0', belly: '#ffffff', muzzle: '#ffffff' },
  fox: { fur: '#f07a2a', dark: '#3a2418', belly: '#ffffff', muzzle: '#ffffff' },
  panda: { fur: '#ffffff', dark: '#2b2b2e', belly: '#ffffff', muzzle: '#ffffff' },
  dragon: { fur: '#6fcf6f', dark: '#3a9a4a', belly: '#e9f7b8', muzzle: '#c9efa0' },
  unicorn: { fur: '#fff7fd', dark: '#e3d3ea', belly: '#ffffff', muzzle: '#ffffff' },
};
const COATS = { caramel: '#c58b51', snow: '#eee9e0', midnight: '#555c71', rose: '#d995a1', lavender: '#a599c9', mint: '#8bbba5' };

function quadruped(kind, color = 'natural') {
  const T = { ...(TOON[kind] || TOON.cat) };
  if (COATS[color] && kind !== 'panda') { T.fur = COATS[color]; T.dark = shade(COATS[color], -0.32); }
  const { fur, dark, belly, muzzle } = T;
  const legFill = kind === 'panda' || kind === 'fox' ? dark : fur;
  const leg = (cls, lx) => `<g class="leg ${cls}"><path d="M${lx} 79 h11 v12 a5.5 5.5 0 0 1 -11 0 Z" fill="${legFill}" ${O}/><ellipse cx="${lx + 5.5}" cy="94.2" rx="3.4" ry="1.6" fill="#f7a8b8"/></g>`;
  const tail = {
    dog: `<path d="M28 72 C18 70 14 60 18 52" fill="none" stroke="${INK}" stroke-width="9" stroke-linecap="round"/><path d="M28 72 C18 70 14 60 18 52" fill="none" stroke="${fur}" stroke-width="4.4" stroke-linecap="round"/>`,
    cat: `<path d="M28 76 C10 76 6 58 14 46" fill="none" stroke="${INK}" stroke-width="10" stroke-linecap="round"/><path d="M28 76 C10 76 6 58 14 46" fill="none" stroke="${fur}" stroke-width="5.4" stroke-linecap="round"/><path d="M12 62 l5 -1 M11 54 l5 0" stroke="${dark}" stroke-width="2.6" stroke-linecap="round"/>`,
    bunny: `<circle cx="25" cy="72" r="8" fill="#fff" ${O}/>`,
    fox: `<path d="M30 76 C8 82 0 58 12 44 C18 52 24 62 30 68 Z" fill="${fur}" ${O}/><path d="M12 44 C7 50 6 56 8 60 C12 56 15 50 12 44 Z" fill="#fff" ${OT}/>`,
    panda: `<circle cx="26" cy="72" r="6.5" fill="${dark}" ${O}/>`,
    dragon: `<path d="M30 78 C14 80 8 66 12 54" fill="none" stroke="${INK}" stroke-width="9" stroke-linecap="round"/><path d="M30 78 C14 80 8 66 12 54" fill="none" stroke="${fur}" stroke-width="4.6" stroke-linecap="round"/><path d="M12 54 L4 50 L10 42 L18 48 Z" fill="${dark}" ${OT}/>`,
    unicorn: `<path d="M30 70 C14 68 8 78 8 90 C16 84 22 80 30 76 Z" fill="#c7a8ff" ${OT}/><path d="M30 74 C20 76 16 84 16 94 C22 88 26 84 31 80 Z" fill="#8fd3ff" ${OT}/>`,
  }[kind] || '';
  const earsBack = {
    cat: `<path d="M57 34 L60 9 L78 22 Z" fill="${fur}" ${O}/><path d="M61.5 28 L62.5 16 L72 23 Z" fill="#f7a8b8"/><path d="M107 34 L104 9 L86 22 Z" fill="${fur}" ${O}/><path d="M102.5 28 L101.5 16 L92 23 Z" fill="#f7a8b8"/>`,
    fox: `<path d="M56 34 L58 4 L80 22 Z" fill="${fur}" ${O}/><path d="M58 13 L58 4 L66 11 Z" fill="${dark}"/><path d="M61 27 L61.5 15 L72 22 Z" fill="#fff"/><path d="M108 34 L106 4 L84 22 Z" fill="${fur}" ${O}/><path d="M106 13 L106 4 L98 11 Z" fill="${dark}"/><path d="M103 27 L102.5 15 L92 22 Z" fill="#fff"/>`,
    bunny: `<path d="M68 24 C60 0 63 -12 71 -11 C79 -10 80 6 76 24 Z" fill="${fur}" ${O}/><path d="M70.5 20 C66 4 68 -5 71.5 -5 C75 -5 75.5 6 73.5 20 Z" fill="#f7b6c4"/><path d="M88 24 C88 0 94 -11 101 -8 C107 -4 100 10 94 26 Z" fill="${fur}" ${O}/><path d="M91 20 C92 4 96 -3 99 -2 C101 0 97 10 93 21 Z" fill="#f7b6c4"/>`,
    panda: `<circle cx="61" cy="24" r="9" fill="${dark}" ${O}/><circle cx="103" cy="24" r="9" fill="${dark}" ${O}/>`,
    dragon: `<path d="M64 24 L56 4 L72 18 Z" fill="#f6d36b" ${O}/><path d="M100 24 L108 4 L92 18 Z" fill="#f6d36b" ${O}/>`,
    unicorn: `<path d="M58 32 L62 12 L77 23 Z" fill="${fur}" ${O}/><path d="M106 32 L102 12 L87 23 Z" fill="${fur}" ${O}/><path d="M62 28 L63.5 18 L71 24 Z" fill="#f7b6c4"/><path d="M102 28 L100.5 18 L93 24 Z" fill="#f7b6c4"/>`,
  }[kind] || '';
  const earsFront = kind === 'dog'
    ? `<path d="M60 26 C46 22 41 42 47 58 C54 61 59 50 61 39 Z" fill="${dark}" ${O}/><path d="M104 26 C118 22 123 42 117 58 C110 61 105 50 103 39 Z" fill="${dark}" ${O}/>` : '';
  const marks = {
    dog: `<ellipse cx="70" cy="26" rx="5.5" ry="3.2" fill="${dark}" opacity=".75"/><circle cx="92" cy="25" r="3" fill="${dark}" opacity=".75"/>`,
    cat: `<path d="M76 21 q2 5 0 9 M82 19.5 v10 M88 21 q-2 5 0 9" stroke="${dark}" stroke-width="3" fill="none" stroke-linecap="round"/>`,
    fox: `<path d="M53 50 C60 64 72 66 82 64 C92 66 104 64 111 50 C104 58 92 58 82 56 C72 58 60 58 53 50 Z" fill="#fff"/>`,
    panda: `<ellipse cx="69" cy="48" rx="12" ry="14.5" fill="${dark}" transform="rotate(-24 69 48)"/><ellipse cx="95" cy="48" rx="12" ry="14.5" fill="${dark}" transform="rotate(24 95 48)"/>`,
    unicorn: `<path d="M80 20 L86 -6 L91 20 Z" fill="#f6d36b" ${O}/><path d="M82 13 L89 11 M83 6 L88 4.5" stroke="#d9a92f" stroke-width="1.6"/><path d="M60 26 C52 30 50 44 54 56 C58 44 64 36 72 32 Z" fill="#c7a8ff" ${OT}/><path d="M66 22 C60 26 58 36 60 44 C64 36 68 30 76 28 Z" fill="#8fd3ff" ${OT}/>`,
    dragon: `<path d="M72 22 l3 -6 l3 6 M82 20 l3 -7 l3 7" stroke="${dark}" stroke-width="2.4" fill="none" stroke-linejoin="round"/>`,
  }[kind] || '';
  const bodyExtra = {
    cat: `<path d="M44 60 q3 5 0 10 M52 59 q3 5 0 11 M60 60 q3 5 0 10" stroke="${dark}" stroke-width="3" fill="none" stroke-linecap="round"/>`,
    panda: `<path d="M44 58 C50 56 62 56 68 60 L66 72 C58 68 50 68 44 70 Z" fill="${dark}"/>`,
    dragon: `<path d="M32 62 l4 -7 l4 6 l4 -7 l4 6 l4 -7 l4 6" fill="${dark}" ${OT}/><path class="wing" d="M46 62 C40 40 58 34 66 48 C58 48 54 54 52 64 Z" fill="${dark}" ${O}/>`,
    dog: `<ellipse cx="40" cy="70" rx="7" ry="5" fill="${dark}" opacity=".55"/>`,
  }[kind] || '';
  const whiskers = kind === 'cat' || kind === 'fox' || kind === 'bunny'
    ? `<path d="M64 56 l-11 -2 M64 59.5 l-11 1.5 M100 56 l11 -2 M100 59.5 l11 1.5" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/>` : '';
  const whites = `<ellipse cx="71" cy="45" rx="8" ry="9.2" fill="#fff" ${O}/><ellipse cx="93" cy="45" rx="8" ry="9.2" fill="#fff" ${O}/>`;
  return `
<svg class="pet-svg toon k-${kind}" viewBox="-4 -14 128 116" xmlns="${NS}">
  <ellipse class="pet-shadow" cx="56" cy="97" rx="32" ry="4.5" fill="rgba(0,0,0,.25)"/>
  <g class="tail">${tail}</g>
  <g class="body">
    ${leg('back a', 30)}${leg('back b', 43)}
    <path d="M25 74 C25 60 40 55 55 56 C70 57 77 64 77 75 C77 87 65 92 51 92 C36 92 25 87 25 74 Z" fill="${fur}" ${O}/>
    <path d="M37 84 C45 90 60 90 68 84 C63 80 43 80 37 84 Z" fill="${belly}"/>
    ${bodyExtra}
    ${leg('front a', 55)}${leg('front b', 67)}
    <g class="head">
      ${earsBack}
      <path d="M54 46 C52 26 66 17 82 17 C98 17 112 26 110 46 C110 62 98 72 82 72 C66 72 54 62 54 46 Z" fill="${fur}" ${O}/>
      ${marks}
      <ellipse cx="82" cy="58" rx="15" ry="10.5" fill="${muzzle}"/>
      ${earsFront}
      <ellipse cx="62" cy="56" rx="5" ry="3" fill="#ff8fa3" opacity=".65"/><ellipse cx="102" cy="56" rx="5" ry="3" fill="#ff8fa3" opacity=".65"/>
      <g class="eyes">${whites}
        <g class="eye"><circle cx="72.6" cy="46.4" r="5.7" fill="#1b1410"/><circle cx="70.4" cy="43.6" r="2.2" fill="#fff"/><circle cx="74.8" cy="49" r=".95" fill="#fff"/></g>
        <g class="eye"><circle cx="91.4" cy="46.4" r="5.7" fill="#1b1410"/><circle cx="89.2" cy="43.6" r="2.2" fill="#fff"/><circle cx="93.6" cy="49" r=".95" fill="#fff"/></g>
      </g>
      <g class="eyes-closed"><path d="M64 47 q7 -8 14 0 M86 47 q7 -8 14 0" stroke="${INK}" stroke-width="3.2" fill="none" stroke-linecap="round"/></g>
      <g class="eyes-sad">${whites}<path d="M62 35 l11 4 M102 35 l-11 4" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/><circle cx="71" cy="49" r="4.4" fill="#1b1410"/><circle cx="93" cy="49" r="4.4" fill="#1b1410"/><circle cx="69.6" cy="47.4" r="1.5" fill="#fff"/><circle cx="91.6" cy="47.4" r="1.5" fill="#fff"/></g>
      ${whiskers}
      <path d="M77.2 52.6 h9.6 c0 3.2 -2.6 5.2 -4.8 5.2 c-2.2 0 -4.8 -2 -4.8 -5.2 Z" fill="#1b1410"/><ellipse cx="80.2" cy="53.8" rx="1.6" ry=".9" fill="#fff" opacity=".7"/>
      <path class="mouth" d="M82 57.8 v2.2 c0 3.2 -5 4.2 -7.2 1.2 M82 60 c0 3.2 5 4.2 7.2 1.2" stroke="${INK}" stroke-width="2" fill="none" stroke-linecap="round"/>
      <g class="mouth-open"><path d="M75 60 C75 71 89 71 89 60 C85 62 79 62 75 60 Z" fill="#9b2335" ${OT}/><path d="M78 65.5 C78.5 70.5 85.5 70.5 86 65.5 C84 64 80 64 78 65.5 Z" fill="#ff7a8a"/></g>
    </g>
  </g>
</svg>`;
}

function owl() {
  const whites = `<circle cx="49" cy="40" r="11" fill="#fff" ${O}/><circle cx="71" cy="40" r="11" fill="#fff" ${O}/>`;
  return `
<svg class="pet-svg toon owl" viewBox="-4 -14 128 116" xmlns="${NS}">
  <ellipse class="pet-shadow" cx="60" cy="97" rx="26" ry="4.5" fill="rgba(0,0,0,.25)"/>
  <g class="body">
    <path d="M52 92 l-3 5 M56 92 l0 6 M60 92 l3 5 M64 92 l-3 5 M68 92 l0 6 M72 92 l3 5" stroke="#e8a33d" stroke-width="3.4" stroke-linecap="round"/>
    <g class="wing l"><path d="M37 52 C24 62 28 84 41 88 C41 74 43 62 46 54 Z" fill="#7a5233" ${O}/></g>
    <g class="wing r"><path d="M83 52 C96 62 92 84 79 88 C79 74 77 62 74 54 Z" fill="#7a5233" ${O}/></g>
    <path d="M60 38 C80 38 86 58 84 72 C82 86 72 93 60 93 C48 93 38 86 36 72 C34 58 40 38 60 38 Z" fill="#a8774a" ${O}/>
    <path d="M60 58 C72 58 76 70 74 78 C72 86 66 90 60 90 C54 90 48 86 46 78 C44 70 48 58 60 58 Z" fill="#f4e1c3"/>
    <path d="M53 68 q3 3 6 0 M61 74 q3 3 6 0 M53 80 q3 3 6 0" stroke="#c9a17a" stroke-width="2" fill="none" stroke-linecap="round"/>
    <g class="head">
      <path d="M36 26 L40 8 L52 22 Z M84 26 L80 8 L68 22 Z" fill="#7a5233" ${O}/>
      <path d="M34 40 C34 22 46 16 60 16 C74 16 86 22 86 40 C86 56 74 62 60 62 C46 62 34 56 34 40 Z" fill="#a8774a" ${O}/>
      <ellipse cx="38" cy="52" rx="4.5" ry="2.8" fill="#ff8fa3" opacity=".6"/><ellipse cx="82" cy="52" rx="4.5" ry="2.8" fill="#ff8fa3" opacity=".6"/>
      <g class="eyes">${whites}<g class="eye"><circle cx="50.5" cy="41" r="6.5" fill="#1b1410"/><circle cx="48" cy="38" r="2.4" fill="#fff"/></g><g class="eye"><circle cx="69.5" cy="41" r="6.5" fill="#1b1410"/><circle cx="67" cy="38" r="2.4" fill="#fff"/></g></g>
      <g class="eyes-closed"><path d="M41 42 q8 -8 16 0 M63 42 q8 -8 16 0" stroke="${INK}" stroke-width="3.2" fill="none" stroke-linecap="round"/></g>
      <g class="eyes-sad">${whites}<path d="M38 30 l12 4 M82 30 l-12 4" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/><circle cx="49" cy="44" r="5" fill="#1b1410"/><circle cx="71" cy="44" r="5" fill="#1b1410"/></g>
      <path d="M55 49 L65 49 L60 57 Z" fill="#f2a93b" ${OT}/>
      <g class="mouth-open"><ellipse cx="60" cy="56" rx="3.4" ry="2.6" fill="#9b2335" ${OT}/></g>
    </g>
  </g>
</svg>`;
}

function egg() {
  return `
<svg class="pet-svg toon egg" viewBox="-4 -14 128 116" xmlns="${NS}">
  <ellipse class="pet-shadow" cx="60" cy="97" rx="22" ry="4" fill="rgba(0,0,0,.25)"/>
  <g class="body">
    <path d="M60 22 C80 22 90 56 88 72 C86 88 74 96 60 96 C46 96 34 88 32 72 C30 56 40 22 60 22 Z" fill="#fff6e6" ${O}/>
    <circle cx="50" cy="52" r="5.5" fill="#f6c27a"/><circle cx="71" cy="66" r="6.5" fill="#f6c27a"/><circle cx="54" cy="81" r="4.2" fill="#f6c27a"/><circle cx="72" cy="42" r="3.8" fill="#f6c27a"/>
    <path class="crack" d="M42 62 l6 -5 l5 6 l6 -6 l5 6 l6 -5" stroke="${INK}" stroke-width="2" fill="none" stroke-linejoin="round"/>
    <path d="M46 34 C42 42 40 50 40 56" stroke="#fff" stroke-width="3.4" fill="none" stroke-linecap="round" opacity=".9"/>
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
const ANCHOR = { quad: { top: [82, 19], eyes: [82, 45.5, 22], neck: [76, 72] }, owl: { top: [60, 18], eyes: [60, 40.5, 22], neck: [60, 62] } };
const PROPS = {
  crown: (a) => `<g transform="translate(${a.top[0]} ${a.top[1] + 2})"><path d="M-13 0 L-13 -12 L-6.5 -5 L0 -15 L6.5 -5 L13 -12 L13 0 Z" fill="#f6c343" stroke="#d49b1a" stroke-width="1.5" stroke-linejoin="round"/><circle cx="0" cy="-6" r="2.2" fill="#e5484d"/><circle cx="-8" cy="-4" r="1.6" fill="#3e8ef7"/><circle cx="8" cy="-4" r="1.6" fill="#3ecf8e"/></g>`,
  bow: (a) => `<g transform="translate(${a.top[0] + 10} ${a.top[1] + 3}) rotate(15)"><path d="M0 0 L-10 -7 L-10 7 Z M0 0 L10 -7 L10 7 Z" fill="#ff5c8a" stroke="#d63c6b" stroke-width="1.2" stroke-linejoin="round"/><circle r="3" fill="#d63c6b"/></g>`,
  glasses: (a) => { const [x, y, s] = a.eyes; const w = s * 0.86, hh = w * 0.72; return `<g><rect x="${x - s / 2 - w / 2}" y="${y - hh / 2}" width="${w}" height="${hh}" rx="5" fill="#1d1d1f" stroke="#2b1d16" stroke-width="2"/><rect x="${x + s / 2 - w / 2}" y="${y - hh / 2}" width="${w}" height="${hh}" rx="5" fill="#1d1d1f" stroke="#2b1d16" stroke-width="2"/><path d="M${x - s / 2 + w / 2} ${y - 2} Q${x} ${y - 5} ${x + s / 2 - w / 2} ${y - 2}" stroke="#2b1d16" stroke-width="2.4" fill="none"/><path d="M${x - s / 2 - w / 2 + 3} ${y - hh / 2 + 3} l5 -1" stroke="#fff" stroke-width="1.6" opacity=".7"/></g>`; },
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
export function mountPet({ conv, msgs, chatId, api, me, userName, sounds, personal = false, onCustomize }) {
  const zone = h('div', { class: 'pet-zone' + (personal ? ' personal-pet-zone' : '') });
  const inner = h('div', { class: 'pet-inner' });
  const pet = h('div', { class: 'pet-actor', role: 'button', tabindex: '0', 'aria-label': personal ? 'Your personal pet' : 'Group pet' }, inner);
  pet.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pet.click(); } });
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
    if (state.glasses && state.outfit !== 'glasses') (head || el).append(wear('glasses'));
    if (hat) (head || el).append(wear(hat));
  }
  function draw() {
    if (!state) return;
    kind = state.level === 0 ? 'egg' : state.kind;
    inner.innerHTML = '';
    const art = svg(kind === 'egg' ? egg() : kind === 'owl' ? owl() : quadruped(kind, state.color));
    dress(art);
    inner.append(art);
    eyes = [];
    pet.className = `pet-actor k-${kind} stage-${state.level}` + (state.level >= 5 ? ' legend' : '');
    pet.dataset.mode = mode;
    setCage(state.caged, false);
  }

  async function load() {
    try { ({ pet: state } = await api('GET', `/api/chats/${chatId}/pet`)); } catch { destroy(); return; }
    if (destroyed) return;
    if (!state) { destroy(); return; }
    draw(); fit();
    x = Math.max(10, W() * (personal ? 0.72 : 0.15)); targetX = x; place();
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
    if (drag?.on) { /* following the finger */ }
    else if (fall) fallStep(dt);
    else if (jump) {
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
        if (Math.abs(d) < 2 && Math.abs(vx) < 14) { vx = 0; if (x < 0) facing = 1; else if (x > W() - SIZE()) facing = -1; setMode('idle'); if (!busyPhys) nextThink = Math.min(nextThink, t + 600); }
      }
      place();
    }
    aimEyes(t);
    raf = requestAnimationFrame(loop);
  }
  // Watchdog: if a new message lands on it, it gets out of the way (see-through until it has moved).
  const guard = setInterval(() => {
    if (!state || destroyed || jump || fall || drag?.on || busyPhys || state.caged) { pet.classList.remove('ghost'); return; }
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
    if (!busyPhys) nextThink = performance.now() + ms + 400; // never interrupts feeding / fetch / being held
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

  // ───── real physics: feeding, fetch, petting, picking it up ─────
  const G = 1500; // gravity, px/s²
  let busyPhys = false;
  const queue = []; // a feed or a throw that comes in while it's busy waits its turn
  const hold = () => { busyPhys = true; nextThink = Infinity; };
  const release = (ms = 1500) => {
    busyPhys = false; nextThink = performance.now() + ms;
    const next = queue.shift(); if (next) setTimeout(() => { if (!destroyed && !busyPhys) next(); }, 350);
  };
  const mouthX = () => x + SIZE() * (facing > 0 ? 0.82 : 0.18);
  // A little object that falls, bounces and rolls (used by the bowl, the ball and crumbs).
  function body(el, { px, py, vx = 0, vy = 0, w, hgt, bounce = 0.55, friction = 260, spin = false, onRest }) {
    const o = { el, px, py, vx, vy, w, hgt, rest: false, held: false, rot: 0 };
    let last = performance.now();
    const step = (t) => {
      if (destroyed || !el.isConnected) return;
      const dt = Math.min(0.033, (t - last) / 1000); last = t;
      if (!o.held && !o.rest) {
        const floor = H() - o.hgt - 2;
        o.vy += G * dt; o.px += o.vx * dt; o.py += o.vy * dt;
        if (o.px < 0) { o.px = 0; o.vx = -o.vx * 0.6; } else if (o.px > W() - o.w) { o.px = W() - o.w; o.vx = -o.vx * 0.6; }
        if (o.py >= floor) {
          o.py = floor;
          if (Math.abs(o.vy) > 90) { o.vy = -o.vy * bounce; o.vx *= 0.85; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
          else { o.vy = 0; const f = friction * dt; o.vx = Math.abs(o.vx) <= f ? 0 : o.vx - Math.sign(o.vx) * f; if (!o.vx) { o.rest = true; onRest?.(o); } }
        }
        if (spin) o.rot += (o.vx * dt) / (o.w / 2) * 57.3;
      }
      el.style.transform = `translate(${o.px}px, ${o.py}px)${spin ? ` rotate(${o.rot}deg)` : ''}`;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    return o;
  }
  function crumbs(cx, cy, color, n = 5) {
    for (let i = 0; i < n; i++) {
      const c = h('i', { class: 'pet-crumb', style: { background: color } });
      fx.append(c);
      body(c, { px: cx, py: cy, vx: (Math.random() - 0.5) * 220, vy: -180 - Math.random() * 160, w: 5, hgt: 5, bounce: 0.3, friction: 400, onRest: () => setTimeout(() => c.remove(), 700) });
    }
  }

  // Feeding: a bowl drops in and bounces, the pet trots over and eats it bite by bite.
  function feed(byMe) {
    if (state.caged || kind === 'egg') return;
    if (busyPhys) { if (queue.length < 3) queue.push(() => feed(byMe)); return; }
    hold();
    const s = SIZE(), bw = 46, bh = 26;
    const bowl = h('div', { class: 'pet-bowl' }, h('div', { class: 'pb-food' }), h('div', { class: 'pb-dish' }));
    const food = bowl.firstChild;
    const treat = TREATS[LOOK[kind]?.treat || 'apple'] || TREATS.apple;
    for (let i = 0; i < 4; i++) { const t = h('i'); t.innerHTML = treat; food.append(t); }
    fx.append(bowl);
    const side = x + s / 2 < W() / 2 ? 1 : -1;
    const bx = Math.max(6, Math.min(W() - bw - 6, side > 0 ? x + s + 18 : x - bw - 18));
    if (mode === 'sleep') setMode('idle');
    perch = null; place(); look(bx, 0, 1500); react('perk', 700);
    body(bowl, { px: bx, py: -bh - 10, vx: 0, w: bw, hgt: bh, bounce: 0.32, friction: 900, onRest: () => {
      targetX = side > 0 ? bx - s * 0.74 : bx + bw - s * 0.26;
      facing = side; setMode('run');
      const go = setInterval(() => {
        if (destroyed) return clearInterval(go);
        if (mode === 'run' && Math.abs(targetX - x) > 3) return;
        clearInterval(go);
        facing = side; place(); setMode('eat');
        let left = 4;
        const bite = setInterval(() => {
          if (destroyed) return clearInterval(bite);
          left--; food.lastChild?.remove(); if (byMe) sound('chomp');
          crumbs(bx + bw / 2, H() - bh - 6, '#c8873e', 4);
          if (left > 0) return;
          clearInterval(bite);
          setMode('happy'); burst(HEART, 5);
          bowl.classList.add('gone'); setTimeout(() => bowl.remove(), 600);
          setTimeout(() => { setMode('idle'); release(); }, 1100);
        }, 650);
      }, 60);
    } });
  }

  // Fetch: the ball flies with gravity, bounces, rolls to a stop; the pet chases the ball itself,
  // catches it in its mouth and brings it back.
  function fetchBall(where, byMe) {
    if (state.caged || kind === 'egg') return;
    if (busyPhys) { if (queue.length < 3) queue.push(() => fetchBall(where, byMe)); return; }
    hold();
    const s = SIZE(), r = 22, home = x;
    if (mode === 'sleep') setMode('idle');
    perch = null; place();
    const ball = h('i', { class: 'pet-ball' }); ball.innerHTML = BALL; fx.append(ball);
    const startX = mouthX() - r / 2, startY = y + pet.offsetHeight * 0.35;
    const land = Math.max(10, Math.min(W() - r - 10, 10 + where * (W() - r - 20)));
    const b = body(ball, { px: startX, py: startY, vx: (land - startX) / 1.05, vy: -680, w: r, hgt: r, bounce: 0.62, friction: 230, spin: true });
    if (byMe) sound('chomp');
    react('happy', 400);
    let phase = 'chase';
    const tick = setInterval(() => {
      if (destroyed || !ball.isConnected) return clearInterval(tick);
      if (phase === 'chase') {
        const bc = b.px + r / 2;
        const ahead = bc > x + s / 2 ? 1 : -1;
        targetX = bc - s * (ahead > 0 ? 0.82 : 0.18);
        if (Math.abs(targetX - x) > 4 && mode !== 'run') setMode('run');
        look(bc, b.py, 400);
        const onFloor = b.py >= H() - r - 6;
        if (Math.abs(mouthX() - bc) < 15 && onFloor && Math.abs(b.vx) < 280) {
          phase = 'carry'; b.held = true; b.rest = true; sound(kind);
          targetX = home; facing = home > x ? 1 : -1; setMode('run');
        }
      } else if (phase === 'carry') {
        b.px = mouthX() - r / 2; b.py = y + pet.offsetHeight * 0.42;
        if (mode !== 'run' || Math.abs(targetX - x) < 4) {
          phase = 'done'; clearInterval(tick);
          b.held = false; b.rest = false; b.vx = facing * 70; b.vy = -160;
          setMode('happy'); burst(HEART, 5);
          setTimeout(() => { ball.classList.add('gone'); setTimeout(() => ball.remove(), 500); setMode('idle'); release(); }, 1300);
        }
      }
    }, 30);
    setTimeout(() => { if (phase !== 'done' && ball.isConnected) { clearInterval(tick); ball.remove(); setMode('idle'); release(); } }, 15000);
  }

  // Petting: a hand strokes its head; it closes its eyes and leans into it.
  function stroke() {
    if (state.caged || kind === 'egg') return;
    const s = SIZE();
    const hand = h('div', { class: 'pet-hand' }, '🤚');
    hand.style.left = (x + s * (facing > 0 ? 0.5 : 0.1)) + 'px';
    hand.style.top = (y - 6) + 'px';
    fx.append(hand);
    react('petted', 2000);
    [0, 650, 1300].forEach((d) => setTimeout(() => { burst(HEART, 2); }, d + 300));
    sound(kind);
    setTimeout(() => hand.remove(), 2000);
  }

  // Pick it up: drag it anywhere (legs dangle); let go and it falls, bounces and lands on its feet.
  let fall = null, drag = null, suppressClick = false;
  pet.addEventListener('pointerdown', (e) => {
    if (!state || state.caged) return;
    drag = { sx: e.clientX, sy: e.clientY, on: false, samples: [] };
    pet.setPointerCapture?.(e.pointerId);
  });
  pet.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.on && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 8) return;
    if (!drag.on) { drag.on = true; closeMenu(); jump = null; fall = null; perch = null; vx = 0; hold(); setMode('held'); }
    const zr = zoneRect();
    x = e.clientX - zr.left - SIZE() / 2; y = Math.min(floorY(), e.clientY - zr.top - 12);
    drag.samples.push([performance.now(), x, y]); if (drag.samples.length > 6) drag.samples.shift();
    pet.style.transform = `translate(${x}px, ${y}px)`;
  });
  const endDrag = () => {
    if (!drag) return;
    const d = drag; drag = null;
    if (!d.on) return;
    suppressClick = true; setTimeout(() => { suppressClick = false; }, 300);
    // Held still before letting go → it just drops; a flick throws it.
    const still = !d.samples.length || performance.now() - d.samples[d.samples.length - 1][0] > 120;
    const a = still ? null : d.samples[0], b = still ? null : d.samples[d.samples.length - 1];
    const dt = a && b && b[0] > a[0] ? (b[0] - a[0]) / 1000 : 1;
    fall = { vx: a && b ? Math.max(-900, Math.min(900, (b[1] - a[1]) / dt)) : 0, vy: a && b ? Math.max(-900, Math.min(900, (b[2] - a[2]) / dt)) : 0, from: y };
    setMode('jump');
  };
  pet.addEventListener('pointerup', endDrag);
  pet.addEventListener('pointercancel', endDrag);
  function fallStep(dt) {
    fall.vy += G * dt; x += fall.vx * dt; y += fall.vy * dt;
    if (x < -SIZE() * 0.3) { x = -SIZE() * 0.3; fall.vx = -fall.vx * 0.5; } else if (x > W() - SIZE() * 0.7) { x = W() - SIZE() * 0.7; fall.vx = -fall.vx * 0.5; }
    if (Math.abs(fall.vx) > 30) facing = fall.vx > 0 ? 1 : -1;
    const fy = floorY();
    if (y >= fy) {
      y = fy;
      pet.classList.remove('land'); void pet.offsetWidth; pet.classList.add('land'); setTimeout(() => pet.classList.remove('land'), 220);
      if (fall.vy > 420) { fall.vy = -fall.vy * 0.3; fall.vx *= 0.6; }
      else {
        const high = fy - fall.from > 140;
        fall = null; setMode(high ? 'shake' : 'sit');
        if (high) say('whee!', 1300);
        setTimeout(() => { setMode('idle'); release(800); }, 900);
      }
    }
    pet.style.transform = `translate(${x}px, ${y}px)`;
    inner.style.transform = `scaleX(${facing})`;
  }

  async function act(action, body = {}) {
    closeMenu();
    try { const r = await api('POST', `/api/chats/${chatId}/pet`, { action, ...body }); state = r.pet; draw(); place(); if (personal && action === 'feed') feed(true); if (personal && action === 'play') fetchBall(Math.random(), true); } catch (e) { toast(e.message, { error: true }); }
  }
  async function rename() {
    closeMenu();
    const name = await promptDialog({ title: 'Name your pet', value: state.name, placeholder: state.defaultName, maxlength: 20, ok: 'Save', note: personal ? 'Only you see your companion and its name.' : 'Everyone in this chat sees the new name. Say it in a message and it comes running.' });
    if (name && name.trim() && name.trim() !== state.name) act('rename', { name: name.trim() });
  }
  async function chooseOutfit() {
    closeMenu();
    const choice = await actionSheet({ title: state.nextOutfit ? `More outfits unlock as ${state.name} grows (next: ${state.nextOutfit})` : 'Outfits',
      actions: [...state.outfits.map((o) => ({ label: o.label + (state.outfit === o.id ? ' ✓' : ''), value: o.id })), state.outfit ? { label: 'No outfit', value: 'none' } : null].filter(Boolean) });
    if (choice) act('outfit', { outfit: choice === 'none' ? null : choice });
  }

  function closeMenu() { menu?.remove(); menu = null; }
  // Tap menu: name and mood, three big buttons, a tiny needs line, and ⋯ for everything else.
  function openMenu() {
    closeMenu();
    const L = state, egg = L.level === 0;
    const big = (ic, label, fn) => h('button', { class: 'pm-big', onclick: () => { closeMenu(); fn(); } }, h('span', { class: 'pm-ic' }, ic), h('small', null, label));
    const more = async () => {
      closeMenu();
      const v = await actionSheet({ title: L.name, actions: [
        personal ? { label: 'Style', value: 'style' } : null,
        !egg ? { label: 'Rename', value: 'rename' } : null,
        !egg && L.outfits?.length ? { label: 'Outfit', value: 'outfit' } : null,
        !egg ? { label: L.caged ? 'Let out of cage' : 'Put in cage', value: 'cage' } : null,
        { label: personal ? 'Hide in all chats' : 'Hide for me', value: 'hide', danger: true },
      ].filter(Boolean) });
      if (v === 'style') onCustomize?.(); else if (v === 'rename') rename(); else if (v === 'outfit') chooseOutfit();
      else if (v === 'cage') act(L.caged ? 'release' : 'cage'); else if (v === 'hide') hideForMe();
    };
    menu = h('div', { class: 'pet-menu simple' },
      h('div', { class: 'pm-head' },
        h('div', { class: 'pm-name' }, h('b', null, egg ? 'Mystery egg' : L.name), h('span', null, egg ? `Hatches at 20 messages · ${L.xp}/20` : `${L.moodEmoji} ${L.mood}${L.favorite ? ` · ❤ ${L.favorite.userId === me() ? 'you' : L.favorite.name.split(' ')[0]}` : ''}`)),
        h('button', { class: 'pm-more', 'aria-label': 'More', onclick: more }, '⋯')),
      !egg && !L.caged ? h('div', { class: 'pm-row' },
        big('🍖', 'Feed', () => act('feed')),
        big('🎾', 'Play', () => act('play')),
        big('🤚', 'Pet', () => { stroke(); api('POST', `/api/chats/${chatId}/pet`, { action: 'poke' }).then((r) => { state = r.pet; }).catch(() => {}); })) : null,
      !egg && L.caged ? h('div', { class: 'pm-row' }, big('🔓', 'Let out', () => act('release'))) : null,
      !egg ? h('div', { class: 'pm-needs' }, h('span', null, `🍖 ${L.hunger}`), h('span', null, `💗 ${L.happiness}`), h('span', null, `⚡ ${L.energy}`), h('span', { class: 'pm-tip' }, 'drag to pick up')) : null);
    const s = SIZE();
    zone.append(menu);
    menu.style.left = Math.max(8, Math.min(W() - menu.offsetWidth - 8, x + s / 2 - menu.offsetWidth / 2)) + 'px';
    menu.style.top = Math.max(4, y - menu.offsetHeight - 8) + 'px';
    setTimeout(() => document.addEventListener('pointerdown', outside, { once: true, capture: true }), 0);
  }
  const outside = (e) => { if (menu && !menu.contains(e.target)) closeMenu(); else if (menu) document.addEventListener('pointerdown', outside, { once: true, capture: true }); };

  async function hideForMe() {
    const ok = await actionSheet({ title: personal ? 'Hide your companion in all chats?' : 'Hide the pet in this group?', actions: [{ label: 'Hide for me', value: 'hide' }] });
    if (ok !== 'hide') return;
    if (personal) { try { await api('POST', '', { action: 'visibility', hidden: true }); } catch (e) { toast(e.message); return; } }
    else try { localStorage.setItem('mm:petHidden:' + chatId, '1'); } catch {}
    destroy();
    toast(personal ? 'Companion hidden — show it again in Pet shop' : 'Pet hidden — turn it back on from the group info', { timeout: 3500 });
  }

  // Tap = poke (sound + jump + hearts, everyone sees it), and the little menu.
  pet.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!state || suppressClick) return;
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
    document.removeEventListener('pointerdown', outside, true);
    zone.remove();
  }

  load();
  return { destroy, onMessage, onTyping, onEvent };
}

export const petHidden = (chatId) => { try { return localStorage.getItem('mm:petHidden:' + chatId) === '1'; } catch { return false; } };
export const showPetAgain = (chatId) => { try { localStorage.removeItem('mm:petHidden:' + chatId); } catch {} };

// Shared art keeps previews and companions identical, including layered accessories.
export function petPreview(p) {
  const el = svg(quadruped(p.kind, p.color));
  const head = el.querySelector('.head');
  for (const id of [p.outfit, p.glasses && p.outfit !== 'glasses' ? 'glasses' : null].filter(Boolean)) {
    if (!PROPS[id]) continue;
    const g = document.createElementNS(NS, 'g'); g.innerHTML = PROPS[id](ANCHOR.quad); head.append(g);
  }
  return el;
}
