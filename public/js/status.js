// Work status: Available / In a meeting / Busy / Away / On leave, an optional note, and when it ends.
// Shown to others in the chat header and next to the name in the chat list. Busy also silences your
// notifications (except @mentions and urgent messages).
import { h, icon, openSheet, toast } from './ui.js';
import { S, api } from './core.js';

export const STATUS = {
  available: { label: 'Available', color: '#34c759' },
  meeting: { label: 'In a meeting', color: '#ff9500' },
  busy: { label: 'Busy', color: '#ff3b30', sub: 'Notifications muted, except @mentions and urgent' },
  away: { label: 'Away', color: '#ffcc00' },
  leave: { label: 'On leave', color: '#8e8e93' },
};

const fmtUntil = (t) => {
  const d = new Date(t), now = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return time;
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) + (d.getHours() || d.getMinutes() ? ' ' + time : '');
};
export function statusText(st) {
  if (!st || !STATUS[st.kind] || (st.until && st.until < Date.now())) return '';
  const base = st.text || STATUS[st.kind].label;
  return st.until && st.kind !== 'available' ? `${base} · until ${fmtUntil(st.until)}` : base;
}
export const statusDot = (st) => (st && STATUS[st.kind] && !(st.until && st.until < Date.now()) ? h('i', { class: 'st-dot', style: { background: STATUS[st.kind].color }, title: statusText(st) }) : null);

// The picker (from Settings or tapping your own status).
export function openStatusPicker(onChange) {
  const cur = S.me?.settings?.status && !(S.me.settings.status.until && S.me.settings.status.until < Date.now()) ? S.me.settings.status : null;
  let kind = cur?.kind || null, text = cur?.text || '', clear = 'none';
  const endOfDay = () => { const d = new Date(); d.setHours(23, 59, 0, 0); return d.getTime(); };
  const endOfWeek = () => { const d = new Date(); d.setDate(d.getDate() + ((7 - d.getDay()) % 7)); d.setHours(23, 59, 0, 0); return d.getTime(); };
  const UNTIL = [['none', 'Don’t clear'], ['30m', '30 minutes'], ['1h', '1 hour'], ['4h', '4 hours'], ['today', 'Today'], ['week', 'This week']];
  const untilOf = (c) => ({ none: null, '30m': Date.now() + 30 * 60000, '1h': Date.now() + 3600e3, '4h': Date.now() + 4 * 3600e3, today: endOfDay(), week: endOfWeek() }[c]);
  const note = h('input', { class: 'inl', placeholder: 'What are you up to? (optional)', maxlength: 80, value: text, oninput: (e) => (text = e.target.value) });
  const s = openSheet({ title: 'Your status', left: { label: 'Cancel' }, right: { label: 'Save', onClick: async (close) => {
    try {
      const status = kind ? { kind, text: text.trim(), until: untilOf(clear) } : null;
      const { user } = await api('PATCH', '/api/me', { settings: { status } });
      S.me = user; close(); onChange?.(); toast(kind ? `Status: ${statusText(status) || STATUS[kind].label}` : 'Status cleared', { timeout: 1800 });
    } catch (e) { toast(e.message, { error: true }); }
  } } });
  const draw = () => s.body.replaceChildren(
    h('div', { class: 'group' }, Object.entries(STATUS).map(([k, v]) => h('button', { class: 'cell' + (kind === k ? ' on' : ''), onclick: () => { kind = kind === k ? null : k; draw(); } },
      h('i', { class: 'st-dot lg', style: { background: v.color } }), h('span', { class: 'lb' }, v.label, v.sub ? h('small', null, v.sub) : null), kind === k ? icon('check') : null))),
    h('div', { class: 'group' }, h('div', { class: 'cell' }, note)),
    kind && kind !== 'available' ? h('div', { class: 'group-label' }, 'Clear after') : null,
    kind && kind !== 'available' ? h('div', { class: 'st-until' }, UNTIL.map(([v, l]) => h('button', { class: clear === v ? 'on' : '', onclick: () => { clear = v; draw(); } }, l))) : null,
    h('div', { class: 'group-foot' }, 'People you chat with see your status in the chat. Tap a selected status again to clear it.'));
  draw();
}
