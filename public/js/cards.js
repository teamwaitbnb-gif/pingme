// Collectible cards: the look of the Features page and Chat Wrapped. Each card is a tall rounded card
// with a hang-tab slot, a rays-and-stars emblem around an icon, a big title and a number — one bold
// colour per section, swiped through like a deck.
import { h, icon } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';
export const CARD_COLORS = {
  Together: { bg: '#ff5a5f', ink: '#ffffff', glow: '#ffd1d2' },
  Messaging: { bg: '#2f6bff', ink: '#ffffff', glow: '#c9d8ff' },
  Calls: { bg: '#12b76a', ink: '#ffffff', glow: '#b8f2d6' },
  Safety: { bg: '#18181b', ink: '#c6f432', glow: '#c6f432' },
  Fun: { bg: '#c6f432', ink: '#111111', glow: '#ffffff' },
  Purple: { bg: '#8b5cf6', ink: '#ffffff', glow: '#e3d6ff' },
  Orange: { bg: '#ff9f0a', ink: '#1d1300', glow: '#fff1cc' },
};
export const DECK = ['Fun', 'Messaging', 'Together', 'Calls', 'Purple', 'Orange', 'Safety'];

// Rays + dotted ring + stars around an icon (drawn in the card's ink colour).
export function emblem(ic, ink, size = 96) {
  const rays = Array.from({ length: 36 }, (_, i) => {
    const a = (i / 36) * Math.PI * 2, r1 = i % 2 ? 34 : 30, r2 = 47;
    return `<line x1="${50 + Math.cos(a) * r1}" y1="${50 + Math.sin(a) * r1}" x2="${50 + Math.cos(a) * r2}" y2="${50 + Math.sin(a) * r2}" stroke="currentColor" stroke-width="${i % 2 ? 0.6 : 1.1}" opacity=".7"/>`;
  }).join('');
  const dots = Array.from({ length: 18 }, (_, i) => { const a = (i / 18) * Math.PI * 2; return `<circle cx="${50 + Math.cos(a) * 27}" cy="${50 + Math.sin(a) * 27}" r="1.1" fill="currentColor"/>`; }).join('');
  const box = h('div', { class: 'fc-emblem', style: { color: ink, width: size + 'px', height: size + 'px' } });
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 100 100'); s.setAttribute('class', 'fc-rays'); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = `${rays}${dots}<circle cx="50" cy="50" r="22" fill="none" stroke="currentColor" stroke-width="1.4"/>`;
  box.append(s, h('span', { class: 'fc-ic' }, icon(ic)));
  return box;
}
const star = (cls) => h('i', { class: 'fc-star ' + cls }, '✦');

// One card. opts: { kicker, title, text, number, color, ic, big, off, foot, onClick, size }
export function collectCard({ kicker, title, text, number, color = 'Fun', ic = 'sparkle', big = null, off = false, foot = null, onClick = null, size = 'sm' }) {
  const c = CARD_COLORS[color] || CARD_COLORS.Fun;
  const el = h('div', { class: `fcard fc-${size}` + (off ? ' off' : '') + (onClick ? ' tappable' : ''), style: { '--fc-bg': c.bg, '--fc-ink': c.ink, '--fc-glow': c.glow }, onclick: onClick },
    h('span', { class: 'fc-slot', 'aria-hidden': 'true' }),
    star('tl'), star('tr'), star('bl'), star('br'),
    h('div', { class: 'fc-kicker' }, kicker),
    emblem(ic, c.ink, size === 'lg' ? 132 : 82),
    big != null ? h('div', { class: 'fc-big' }, big) : null,
    h('div', { class: 'fc-title' }, title),
    text ? h('div', { class: 'fc-text' }, text) : null,
    h('div', { class: 'fc-foot' }, number != null ? h('span', { class: 'fc-no' }, `No. ${String(number).padStart(2, '0')}`) : h('span'), foot));
  return el;
}

// Features as card decks, one swipeable row per section, each with an on/off switch.
export function featureCards(groups, features, onChange, onOpen) {
  let n = 0;
  return groups.map((g) => {
    const row = h('div', { class: 'fcards' }, g.items.map((it, i) => {
      const [key, ic, title, desc] = it;
      const no = ++n;
      const on = features[key] !== false;
      const sw = h('button', { class: 'fc-switch' + (on ? ' on' : ''), 'aria-pressed': String(on), 'aria-label': `${title}: ${on ? 'on' : 'off'}`,
        onclick: (e) => { e.stopPropagation(); onChange(key, !on); } }, h('i'), on ? 'ON' : 'OFF');
      return collectCard({ kicker: `PING ME · ${g.title.toUpperCase()}`, title, text: desc, number: no, color: g.title, ic, off: !on, foot: sw, onClick: () => onOpen?.(key, i, g) });
    }));
    return h('section', { class: 'fc-section' }, h('div', { class: 'fc-head' }, h('b', null, g.title), h('small', null, `${g.items.length} card${g.items.length === 1 ? '' : 's'} · swipe`)), row);
  });
}

// Draw a card like the on-screen one onto a share canvas (1080×1350 image).
export function paintCard(x, { w, hgt, color = 'Fun', kicker, title, big, sub, lines = [], F }) {
  const c = CARD_COLORS[color] || CARD_COLORS.Fun;
  const pad = 70, cw = w - pad * 2, ch = hgt - pad * 2, r = 54;
  x.fillStyle = '#f3f3f3'; x.fillRect(0, 0, w, hgt);
  x.save();
  x.shadowColor = 'rgba(0,0,0,.25)'; x.shadowBlur = 50; x.shadowOffsetY = 20;
  x.fillStyle = c.bg;
  x.beginPath(); x.roundRect(pad, pad, cw, ch, r); x.fill();
  x.restore();
  // hang-tab slot
  x.fillStyle = '#f3f3f3'; x.beginPath(); x.roundRect(w / 2 - 70, pad + 30, 140, 30, 15); x.fill();
  x.fillStyle = c.ink; x.strokeStyle = c.ink;
  // stars
  x.font = F(400, 44); x.textAlign = 'center';
  [[pad + 50, pad + 70], [w - pad - 50, pad + 70], [pad + 50, hgt - pad - 40], [w - pad - 50, hgt - pad - 40]].forEach(([sx, sy]) => x.fillText('✦', sx, sy));
  // emblem
  const ex = w / 2, ey = pad + 300;
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2, r1 = i % 2 ? 112 : 100, r2 = 142;
    x.globalAlpha = 0.65; x.lineWidth = i % 2 ? 2 : 4;
    x.beginPath(); x.moveTo(ex + Math.cos(a) * r1, ey + Math.sin(a) * r1); x.lineTo(ex + Math.cos(a) * r2, ey + Math.sin(a) * r2); x.stroke();
  }
  x.globalAlpha = 1; x.lineWidth = 5; x.beginPath(); x.arc(ex, ey, 80, 0, Math.PI * 2); x.stroke();
  for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; x.beginPath(); x.arc(ex + Math.cos(a) * 96, ey + Math.sin(a) * 96, 4, 0, Math.PI * 2); x.fill(); }
  x.font = F(800, 96); x.fillText('✦', ex, ey + 34);
  // text
  x.font = F(700, 30); x.letterSpacing = '6px'; x.fillText(kicker, w / 2, pad + 112); x.letterSpacing = '0px';
  let y = ey + 290;
  if (big != null) { x.font = F(900, 150); x.fillText(String(big), w / 2, y); y += 70; }
  x.font = F(800, 58); x.fillText(title, w / 2, y); y += 54;
  if (sub) { x.font = F(500, 32); x.globalAlpha = 0.8; x.fillText(sub.slice(0, 48), w / 2, y); x.globalAlpha = 1; y += 40; }
  x.textAlign = 'left';
  lines.slice(0, 6).forEach(([t, v], i) => {
    const ly = y + 40 + i * 58;
    x.globalAlpha = 0.8; x.font = F(500, 32); x.fillText(t, pad + 80, ly);
    x.globalAlpha = 1; x.font = F(800, 32); x.textAlign = 'right'; x.fillText(String(v).slice(0, 26), w - pad - 80, ly); x.textAlign = 'left';
  });
  x.textAlign = 'center'; x.font = F(600, 28); x.globalAlpha = 0.75; x.fillText('pingme · Chat Wrapped', w / 2, hgt - pad - 34); x.globalAlpha = 1; x.textAlign = 'left';
}
