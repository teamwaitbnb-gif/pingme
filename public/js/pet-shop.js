import { h, openSheet, toast, confirmDialog } from './ui.js';
import { api } from './core.js';
import { petPreview } from './pet.js';

export async function openPetShop() {
  let data, busy = false, closed = false;
  const balance = h('strong', { class: 'pc-balance' }, '…');
  const live = e => { if (data) { data.balance = e.detail.balance; balance.textContent = `${data.balance} PingCoins`; } };
  addEventListener('pm:pingcoins', live);
  const sheet = openSheet({ title: 'Pet shop', full: true, left: { label: 'Done' }, onClose: () => { closed = true; removeEventListener('pm:pingcoins', live); } });
  sheet.body.append(h('p', { role: 'status' }, 'Opening the pet shop…'));
  async function update(body) {
    if (busy) return;
    busy = true; sheet.body.setAttribute('aria-busy', 'true');
    sheet.body.querySelectorAll('button').forEach(b => b.disabled = true);
    try { data = await api('POST', '/api/pets/me', body); dispatchEvent(new Event('pm:personal-pet')); }
    catch (e) { toast(e.message, { error: true }); }
    finally { busy = false; sheet.body.removeAttribute('aria-busy'); if (!closed) draw(); }
  }
  function draw() {
    balance.textContent = `${data.balance} PingCoins`;
    const active = data.owned[data.active];
    const grid = h('div', { class: 'ps-grid' });
    for (const item of data.catalog) {
      const owned = data.owned[item.kind], selected = data.active === item.kind;
      const preview = petPreview(owned || item);
      grid.append(h('article', { class: 'ps-card' + (selected ? ' selected' : '') },
        h('div', { class: 'ps-art', 'aria-hidden': 'true' }, preview),
        h('h3', null, owned?.name || item.name), h('span', { class: 'ps-species' }, item.kind),
        h('p', null, item.description),
        h('button', { class: 'ps-button', disabled: !owned && data.balance < item.price,
          onclick: async () => {
            if (!owned && !await confirmDialog(`Adopt ${item.name} for ${item.price} PingCoins? Only you will see your companion in chats.`, { ok: 'Adopt' })) return;
            update({ action: owned ? 'equip' : 'buy', kind: item.kind });
          } }, selected && !data.hidden ? 'With you ✓' : owned ? 'Bring along' : `${item.price} PingCoins`)));
    }
    const studio = active ? h('section', { class: 'ps-studio' },
      h('div', { class: 'ps-studio-head' }, h('div', null, h('h3', null, 'Make them yours'), h('p', null, 'Every style is included.')), h('div', { class: 'ps-mini', 'aria-hidden': 'true' }, petPreview(active)))) : null;
    if (active) {
      const name = h('input', { class: 'field', value: active.name, maxlength: 20, 'aria-label': 'Pet name' });
      studio.append(h('form', { class: 'ps-name', onsubmit: e => { e.preventDefault(); update({ action: 'customize', name: name.value }); } }, name, h('button', { class: 'ps-button', type: 'submit' }, 'Save name')));
      const choices = (label, values, key, current) => h('div', { class: 'ps-options' }, h('b', null, label), h('div', { class: 'ps-chips' }, ...values.map(v => h('button', { class: 'ps-chip', 'aria-pressed': current === v ? 'true' : 'false', onclick: () => update({ action: 'customize', [key]: v }) }, v || 'none'))));
      studio.append(choices('Coat', data.colors, 'color', active.color), choices('Outfit', [null, ...data.outfits], 'outfit', active.outfit),
        h('div', { class: 'ps-chips' }, h('button', { class: 'ps-chip', 'aria-pressed': String(active.glasses), onclick: () => update({ action: 'customize', glasses: !active.glasses }) }, 'Sunglasses'),
          h('button', { class: 'ps-chip', onclick: () => update({ action: 'visibility', hidden: !data.hidden }) }, data.hidden ? 'Show in chats' : 'Hide in chats')));
    }
    sheet.body.replaceChildren(h('div', { class: 'ps-wrap' },
      h('header', { class: 'ps-hero' }, h('span', { class: 'ps-eyebrow' }, 'A LITTLE COMPANY'), h('h2', null, 'Your chats. Your companion.'), h('p', null, 'A little friend for every conversation. Just for you, even in groups.'), balance),
      data.backfill?.coins ? h('div', { class: 'ps-backpay' }, '🎉 ', h('b', null, `${data.backfill.coins} PingCoins`), ` added for your chats before the shop opened — ${data.backfill.days} day${data.backfill.days === 1 ? '' : 's'} of messages${data.backfill.callCoins ? ' and calls' : ''}.`) : null,
      studio, h('h3', { class: 'ps-section-title' }, 'Find your companion'), grid,
      h('section', { class: 'ps-earn' }, h('h3', null, 'Good conversations give back.'),
        h('p', null, 'Earn 2 PingCoins for a message to other people (once per minute), and 10 for participating in a call lasting at least a minute (once per 10 minutes).'),
        h('small', null, 'Up to 100 PingCoins daily · resets at midnight UTC. Text, photos, voice notes and other messages count. Coins have no cash value.'))));
  }
  try { data = await api('GET', '/api/pets/me'); if (!closed) draw(); }
  catch (e) { if (!closed) sheet.body.replaceChildren(h('p', { role: 'alert' }, e.message), h('button', { class: 'ps-button', onclick: () => { sheet.close(); openPetShop(); } }, 'Try again')); }
}
