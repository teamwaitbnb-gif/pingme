// PingCoins: your balance, how to earn, your pets (up to three come along into chats and play
// together), a live customising studio, and pets to adopt. Every section redraws on its own and
// changes show instantly (saved in the background), so nothing jumps while you tap.
import { h, icon, openSheet, toast, confirmDialog } from './ui.js';
import { api } from './core.js';
import { petPreview, outfitIcon, coatSwatches } from './pet.js';

// Our own gold PingCoin (the 🪙 emoji is a silver eagle on iPhone).
export function coinIcon(size = 20) {
  const d = document.createElement('span');
  d.className = 'pcoin';
  d.style.width = d.style.height = size + 'px';
  d.innerHTML = '<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18" fill="#f5b400" stroke="#8a5a00" stroke-width="2.4"/><circle cx="20" cy="20" r="13.5" fill="#ffd34d" stroke="#d99100" stroke-width="1.6"/><path d="M15.5 28 V12.5 h6.2 c3.4 0 5.6 2 5.6 5 s-2.2 5 -5.6 5 h-3" fill="none" stroke="#8a5a00" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 15 a12 12 0 0 1 8 -7" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" opacity=".8"/></svg>';
  return d;
}

const OUTFIT_NAMES = { bow: 'Bow', scarf: 'Scarf', crown: 'Crown', party: 'Party hat', nightcap: 'Nightcap' };
const COAT_NAMES = { natural: 'Natural', caramel: 'Caramel', snow: 'Snow', midnight: 'Midnight', rose: 'Rose', lavender: 'Lavender', mint: 'Mint' };

// intro: opened from the PingCoins chip — the explainer is expanded.
export async function openPetShop({ intro = false } = {}) {
  let data = null, sel = null, closed = false;
  let saving = Promise.resolve();
  const live = (e) => { if (data) { data.balance = e.detail.balance; drawWallet(); drawShop(); } };
  addEventListener('pm:pingcoins', live);
  const sheet = openSheet({ title: 'PingCoins', full: true, left: { label: 'Done' }, onClose: () => { closed = true; removeEventListener('pm:pingcoins', live); } });
  const walletEl = h('section', { class: 'pc-wallet' });
  const teamEl = h('section', { class: 'ps-section' });
  const studioEl = h('section', { class: 'ps-section' });
  const shopEl = h('section', { class: 'ps-section' });
  sheet.body.replaceChildren(h('div', { class: 'ps-wrap' }, h('div', { class: 'ps-loading' }, h('div', { class: 'spinner' }))));

  const owned = () => Object.values(data.owned || {});
  const team = () => data.team || [];
  // Send a change in the background (one at a time); on failure, say so and reload the truth.
  function save(body, { redraw = false } = {}) {
    saving = saving.then(async () => {
      try {
        const r = await api('POST', '/api/pets/me', body);
        data = { ...data, ...r };
        dispatchEvent(new Event('pm:personal-pet'));
        if (redraw && !closed) drawAll();
      } catch (e) {
        toast(e.message, { error: true });
        try { data = await api('GET', '/api/pets/me'); if (!closed) drawAll(); } catch {}
      }
    });
    return saving;
  }

  function drawWallet() {
    const info = h('div', { class: 'pc-info', hidden: !intro },
      h('p', null, 'PingCoins are little rewards for chatting with the people you care about. You earn them just by using Ping Me, and spend them on pets that keep you company in your chats.'),
      h('small', null, 'Up to 100 coins a day · resets at midnight UTC · no cash value, can’t be bought'));
    walletEl.replaceChildren(
      h('div', { class: 'pc-card-gold' },
        h('div', { class: 'pc-top' }, h('span', null, 'Your PingCoins'),
          h('button', { class: 'pc-what', onclick: () => { info.hidden = !info.hidden; } }, icon('help'), 'What are these?')),
        h('div', { class: 'pc-balance-big' }, coinIcon(38), h('b', null, Number(data.balance || 0).toLocaleString())),
        h('div', { class: 'pc-earn' },
          h('span', null, icon('msg'), h('b', null, '+2'), ' per message'),
          h('span', null, icon('phone'), h('b', null, '+10'), ' per call'),
          h('span', null, icon('calendar'), h('b', null, '100'), ' a day'))),
      info);
  }

  function drawTeam() {
    const mine = owned();
    if (!mine.length) { teamEl.replaceChildren(); return; }
    const max = data.teamMax || 3;
    teamEl.replaceChildren(
      h('div', { class: 'ps-head' }, h('h3', null, 'Your pets'), h('small', null, `${team().length} of ${max} come along into chats · they play together`)),
      h('div', { class: 'ps-team' }, mine.map((p) => {
        const along = team().includes(p.kind);
        const sw = h('span', { class: 'ps-along' + (along ? ' on' : ''), role: 'button', 'aria-pressed': String(along),
          onclick: (e) => {
            e.stopPropagation();
            if (!along && team().length >= max) return toast(`Up to ${max} pets can come along at once`);
            data.team = along ? team().filter((k) => k !== p.kind) : [...team(), p.kind];
            drawTeam();
            save({ action: 'team', kind: p.kind, on: !along });
          } }, icon(along ? 'check' : 'plus'), along ? 'With you' : 'Bring along');
        return h('div', { class: 'ps-pet' + (sel === p.kind ? ' sel' : ''), role: 'button', tabindex: '0', onclick: () => { sel = p.kind; drawTeam(); drawStudio(); studioEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } },
          h('div', { class: 'ps-pet-art' }, petPreview(p)), h('b', null, p.name), sw);
      })));
  }

  function drawStudio() {
    const p = data.owned?.[sel];
    if (!p) { studioEl.replaceChildren(); return; }
    const stage = h('div', { class: 'ps-stage' }, petPreview(p));
    const opts = h('div');
    const set = (key, value) => {
      p[key] = value;
      stage.replaceChildren(petPreview(p)); drawTeam(); drawOptions();
      save({ action: 'customize', kind: p.kind, [key]: value });
    };
    const name = h('input', { class: 'ps-name-input', value: p.name, maxlength: 20, 'aria-label': 'Name', enterkeyhint: 'done' });
    const saveName = () => {
      const v = name.value.trim();
      if (!v || v === p.name) { name.value = p.name; return; }
      p.name = v; drawTeam();
      save({ action: 'customize', kind: p.kind, name: v });
      toast(`Renamed to ${v}`, { timeout: 1500 });
    };
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); name.blur(); } });
    name.addEventListener('blur', saveName);
    function drawOptions() {
      const sw = coatSwatches(p.kind);
      const coat = p.color || 'natural';
      opts.replaceChildren(
        h('div', { class: 'ps-label' }, 'Coat', h('span', null, COAT_NAMES[coat] || coat)),
        h('div', { class: 'ps-swatches' }, (data.colors || Object.keys(COAT_NAMES)).map((c) =>
          h('button', { class: 'ps-swatch' + (coat === c ? ' on' : ''), title: COAT_NAMES[c] || c, 'aria-label': COAT_NAMES[c] || c, style: { '--sw': sw[c] || '#ccc' }, onclick: () => set('color', c) }, coat === c ? icon('check') : null))),
        h('div', { class: 'ps-label' }, 'Outfit'),
        h('div', { class: 'ps-outfits' }, [null, ...(data.outfits || [])].map((o) =>
          h('button', { class: 'ps-outfit' + ((p.outfit || null) === o ? ' on' : ''), onclick: () => set('outfit', o) }, outfitIcon(o), h('small', null, o ? OUTFIT_NAMES[o] || o : 'None')))),
        h('button', { class: 'ps-toggle' + (p.glasses ? ' on' : ''), 'aria-pressed': String(!!p.glasses), onclick: () => set('glasses', !p.glasses) },
          h('span', { class: 'ps-toggle-ic' }, outfitIcon('glasses')),
          h('span', { class: 'ps-toggle-t' }, h('b', null, 'Sunglasses'), h('small', null, 'Wear them with any outfit')),
          h('i', { class: 'ps-switch' })));
    }
    drawOptions();
    studioEl.replaceChildren(
      h('div', { class: 'ps-head' }, h('h3', null, 'Customise'), h('small', null, 'Changes show right away · everything is included')),
      h('div', { class: 'ps-studio' }, stage, h('label', { class: 'ps-name' }, icon('edit'), name), opts));
  }

  function drawShop() {
    const rest = data.catalog.filter((c) => !data.owned?.[c.kind]);
    shopEl.replaceChildren(
      h('div', { class: 'ps-head' }, h('h3', null, owned().length ? 'Adopt more' : 'Adopt your first pet'), h('small', null, 'Only you see your pets in chats')),
      rest.length ? h('div', { class: 'ps-grid' }, rest.map((c) => {
        const short = c.price - (data.balance || 0);
        return h('article', { class: 'ps-card' },
          h('div', { class: 'ps-art' }, petPreview(c)),
          h('b', { class: 'ps-card-name' }, c.name), h('span', { class: 'ps-species' }, c.kind),
          h('p', null, c.description),
          h('button', { class: 'ps-buy', disabled: short > 0, onclick: () => adopt(c) },
            coinIcon(16), h('span', null, short > 0 ? `${c.price} · need ${short} more` : `Adopt for ${c.price}`)));
      })) : h('div', { class: 'ps-empty' }, icon('heart'), 'You’ve adopted every pet!'));
  }

  async function adopt(c) {
    if (!await confirmDialog(`Adopt ${c.name} for ${c.price} PingCoins? Only you will see your pet in chats.`, { ok: 'Adopt' })) return;
    try {
      data = { ...data, ...(await api('POST', '/api/pets/me', { action: 'buy', kind: c.kind })) };
      sel = c.kind;
      dispatchEvent(new Event('pm:personal-pet'));
      drawAll();
      toast(`${c.name} is yours — say hi in any chat!`, { timeout: 2600 });
      studioEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) { toast(e.message, { error: true }); }
  }

  function drawAll() { drawWallet(); drawTeam(); drawStudio(); drawShop(); }

  try {
    data = await api('GET', '/api/pets/me');
    if (closed) return;
    sel = data.owned?.[data.active] ? data.active : owned()[0]?.kind || null;
    const backpay = data.backfill?.coins ? h('div', { class: 'ps-backpay' }, icon('gift'), h('span', null, h('b', null, `${data.backfill.coins} PingCoins`), ' added for your chats before PingCoins existed.')) : null;
    sheet.body.replaceChildren(h('div', { class: 'ps-wrap' }, walletEl, backpay, teamEl, studioEl, shopEl));
    drawAll();
  } catch (e) {
    if (!closed) sheet.body.replaceChildren(h('div', { class: 'ps-wrap' }, h('p', { role: 'alert' }, e.message), h('button', { class: 'ps-buy', onclick: () => { sheet.close(); openPetShop({ intro }); } }, 'Try again')));
  }
}
