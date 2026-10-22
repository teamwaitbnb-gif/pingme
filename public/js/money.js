// Money tab: this month's spending from your own bank SMS (forwarded by your phone to your private
// Ping Me link), sorted into categories, with budgets and every transaction. Everything is encrypted
// and only you see it.
import { h, icon, toast, openSheet, confirmDialog, cell } from './ui.js';

const COLORS = {
  'Food & dining': '#ff6b2c', Groceries: '#34c759', Shopping: '#af52de', Travel: '#0a84ff', Fuel: '#ff9f0a', 'Bills & recharges': '#5ac8fa',
  Rent: '#a2845e', 'EMI & loans': '#ff375f', Entertainment: '#ff2d55', Health: '#30d158', Education: '#5e5ce6', Investments: '#64d2ff',
  Insurance: '#8e8e93', Transfers: '#636366', Cash: '#ffd60a', Income: '#32d74b', Other: '#98989d',
};
const inr = (n, d = 0) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const monthName = (m) => new Date(m + '-01T00:00:00').toLocaleString('en-IN', { month: 'long', year: 'numeric' });
const shift = (m, k) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 1 + k, 1)); return d.toISOString().slice(0, 7); };
const thisMonth = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 7);
const dayLabel = (t) => { const d = new Date(t); const today = new Date(); const y = new Date(Date.now() - 86400e3); return d.toDateString() === today.toDateString() ? 'Today' : d.toDateString() === y.toDateString() ? 'Yesterday' : d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }); };

export function initMoney(ctx) {
  // ctx: { api, socket() }
  let root = null, month = thisMonth(), data = null, link = null, visible = false;

  function mount(container) {
    root = container;
    root.replaceChildren(h('div', { class: 'mn-loading' }, h('span', { class: 'spinner' })));
  }

  async function load() {
    try {
      const [d, l] = await Promise.all([ctx.api('GET', `/api/money/month?month=${month}`), link ? Promise.resolve(link) : ctx.api('GET', '/api/money/link')]);
      data = d; link = l;
      draw();
    } catch (e) { root?.replaceChildren(h('div', { class: 'mn-empty' }, e.message)); }
  }

  // ───── drawing ─────
  function donut(items, total) {
    const R = 54, C = 2 * Math.PI * R;
    let off = 0;
    const segs = items.filter((x) => x.amount > 0).map((x) => {
      const len = (x.amount / total) * C;
      const s = `<circle r="${R}" cx="70" cy="70" fill="none" stroke="${COLORS[x.category] || '#999'}" stroke-width="18" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 70 70)"/>`;
      off += len; return s;
    }).join('');
    const el = h('div', { class: 'mn-donut' });
    el.innerHTML = `<svg viewBox="0 0 140 140">${segs || `<circle r="${R}" cx="70" cy="70" fill="none" stroke="var(--fill)" stroke-width="18"/>`}</svg>`;
    return el;
  }
  function bars() {
    const [y, m] = month.split('-').map(Number);
    const days = new Date(y, m, 0).getDate();
    const vals = Array.from({ length: days }, (_, i) => data.byDay[String(i + 1).padStart(2, '0')] || 0);
    const max = Math.max(1, ...vals);
    const today = month === thisMonth() ? new Date(Date.now() + 5.5 * 3600e3).getUTCDate() : 99;
    return h('div', { class: 'mn-bars' }, vals.map((v, i) => h('i', { class: i + 1 > today ? 'future' : '', title: `${i + 1}: ${inr(v)}`, style: { height: Math.max(3, (v / max) * 100) + '%' } })));
  }

  function draw() {
    if (!root || !data) return;
    const d = data;
    const change = d.prevSpent ? Math.round(((d.spent - d.prevSpent) / d.prevSpent) * 100) : null;
    const spentCats = d.byCategory.filter((c) => !['Transfers', 'Investments'].includes(c.category));
    const totalCats = spentCats.reduce((s, c) => s + c.amount, 0) || 1;
    const budget = d.budgets?.total;
    const byDay = new Map();
    for (const t of d.transactions) { const k = new Date(t.at).toDateString(); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(t); }
    const connected = link?.connected;
    root.replaceChildren(
      h('header', { class: 'mn-head' },
        h('div', { class: 'mn-title' }, h('b', null, 'Money'), h('span', { class: 'mn-lock' }, icon('lock'), 'Only you can see this')),
        h('button', { class: 'mn-btn', 'aria-label': 'Add', onclick: openAdd }, icon('plus'))),
      h('div', { class: 'mn-month' },
        h('button', { 'aria-label': 'Previous month', onclick: () => { month = shift(month, -1); load(); } }, icon('back')),
        h('b', null, monthName(month)),
        h('button', { 'aria-label': 'Next month', disabled: month >= thisMonth(), onclick: () => { month = shift(month, 1); load(); } }, icon('chev'))),
      !connected ? h('button', { class: 'mn-setup', onclick: openSetup },
        h('span', { class: 'mn-setup-ic' }, icon('zap')),
        h('span', { class: 'mn-setup-t' }, h('b', null, 'Track spending automatically'), h('small', null, 'Connect your bank SMS once (1 minute) — every spend shows up here by itself.')), icon('chev')) : null,
      h('section', { class: 'mn-card mn-sum' },
        h('span', { class: 'mn-l' }, 'Spent'),
        h('div', { class: 'mn-big' }, inr(d.spent)),
        change != null ? h('span', { class: 'mn-chg ' + (change > 0 ? 'up' : 'down') }, `${change > 0 ? '↑' : '↓'} ${Math.abs(change)}% vs ${new Date(shift(month, -1) + '-01').toLocaleString('en-IN', { month: 'short' })}`) : null,
        budget ? h('div', { class: 'mn-budget' }, h('div', { class: 'mn-track' }, h('i', { class: d.spent > budget ? 'over' : d.spent > budget * 0.8 ? 'warn' : '', style: { width: Math.min(100, (d.spent / budget) * 100) + '%' } })), h('small', null, d.spent > budget ? `${inr(d.spent - budget)} over your ${inr(budget)} budget` : `${inr(budget - d.spent)} left of ${inr(budget)}`)) : null,
        h('div', { class: 'mn-trio' },
          h('div', null, h('small', null, 'Income'), h('b', { class: 'pos' }, inr(d.income))),
          h('div', null, h('small', null, 'Sent to people'), h('b', null, inr(d.transfers))),
          h('div', null, h('small', null, 'Invested'), h('b', null, inr(d.invested)))),
        bars()),
      spentCats.length ? h('section', { class: 'mn-card' },
        h('div', { class: 'mn-h' }, h('b', null, 'Where it went'), h('button', { class: 'mn-link', onclick: openBudgets }, 'Budgets')),
        h('div', { class: 'mn-cats' }, donut(spentCats, totalCats),
          h('div', { class: 'mn-legend' }, spentCats.slice(0, 7).map((c) => {
            const b = d.budgets?.[c.category];
            return h('div', { class: 'mn-cat' }, h('i', { style: { background: COLORS[c.category] } }), h('span', null, c.category), h('b', null, inr(c.amount)),
              b ? h('div', { class: 'mn-track sm' }, h('i', { class: c.amount > b ? 'over' : c.amount > b * 0.8 ? 'warn' : '', style: { width: Math.min(100, (c.amount / b) * 100) + '%', background: c.amount > b ? '' : COLORS[c.category] } })) : null);
          })))) : null,
      d.topMerchants.length ? h('section', { class: 'mn-card' }, h('div', { class: 'mn-h' }, h('b', null, 'Top places')),
        d.topMerchants.slice(0, 5).map((m) => h('div', { class: 'mn-row' }, h('span', { class: 'mn-av', style: { background: COLORS[m.category] } }, m.name[0].toUpperCase()), h('span', { class: 'mn-t' }, h('b', null, m.name), h('small', null, `${m.count} time${m.count === 1 ? '' : 's'} · ${m.category}`)), h('b', null, inr(m.amount))))) : null,
      h('section', { class: 'mn-card' },
        h('div', { class: 'mn-h' }, h('b', null, 'Transactions'), h('button', { class: 'mn-link', onclick: () => openSetup('paste') }, 'Import past SMS')),
        d.transactions.length ? [...byDay.entries()].map(([k, list]) => h('div', { class: 'mn-day' },
          h('div', { class: 'mn-dayh' }, h('span', null, dayLabel(list[0].at)), h('span', null, inr(list.filter((t) => t.dir === 'debit').reduce((s, t) => s + Number(t.amount), 0)))),
          list.map((t) => h('button', { class: 'mn-row tx', onclick: () => openTx(t) },
            h('span', { class: 'mn-av', style: { background: COLORS[t.category] || '#999' } }, (t.merchant || t.category)[0].toUpperCase()),
            h('span', { class: 'mn-t' }, h('b', null, t.merchant || (t.dir === 'credit' ? 'Money received' : 'Payment')), h('small', null, [t.category, t.ai ? 'auto' : null, t.mode, t.account ? '··' + t.account : null, new Date(t.at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })].filter(Boolean).join(' · '))),
            h('b', { class: t.dir === 'credit' ? 'pos' : '' }, (t.dir === 'credit' ? '+' : '−') + inr(t.amount, 2))))))
          : h('div', { class: 'mn-empty' }, connected ? 'No transactions this month yet.' : 'Connect your bank SMS, or import this month’s SMS, to see your spending here.')),
      h('div', { class: 'mn-foot' }, h('button', { class: 'mn-link', onclick: openSetup }, 'Bank SMS settings'), ' · ', h('button', { class: 'mn-link danger', onclick: deleteAll }, 'Delete all money data')));
  }

  // ───── sheets ─────
  function openTx(t) {
    const s = openSheet({ title: t.merchant || 'Transaction', left: { label: 'Close' } });
    let note = t.note || '';
    const noteEl = h('input', { class: 'inl', placeholder: 'Add a note', value: note, maxlength: 140, oninput: (e) => (note = e.target.value) });
    s.body.append(
      h('div', { class: 'mn-txhead' }, h('div', { class: 'mn-big ' + (t.dir === 'credit' ? 'pos' : '') }, (t.dir === 'credit' ? '+' : '−') + inr(t.amount, 2)),
        h('small', null, [new Date(t.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }), t.bank, t.mode, t.account ? 'a/c ··' + t.account : null].filter(Boolean).join(' · '))),
      h('div', { class: 'group-label' }, 'Category' + (t.merchant ? ` — remembered for ${t.merchant}` : '')),
      h('div', { class: 'mn-catgrid' }, data.categories.map((c) => h('button', { class: 'mn-catbtn' + (c === t.category ? ' on' : ''), style: { '--c': COLORS[c] }, onclick: async () => {
        try { await ctx.api('PATCH', `/api/money/tx/${t.id}`, { category: c }); s.close(); toast(t.merchant ? `${t.merchant} → ${c}` : `Moved to ${c}`, { timeout: 1600 }); load(); } catch (e) { toast(e.message, { error: true }); }
      } }, c))),
      h('div', { class: 'group' }, h('div', { class: 'cell' }, noteEl)),
      h('div', { class: 'mn-btns' },
        h('button', { class: 'btn', onclick: async () => { await ctx.api('PATCH', `/api/money/tx/${t.id}`, { note }).catch(() => {}); s.close(); load(); } }, 'Save note'),
        h('button', { class: 'btn danger', onclick: async () => { if (await confirmDialog('Delete this transaction?', { ok: 'Delete', danger: true })) { await ctx.api('DELETE', `/api/money/tx/${t.id}`); s.close(); load(); } } }, 'Delete')));
  }

  function openAdd() {
    let dir = 'debit', category = null;
    const amount = h('input', { class: 'mn-amt', type: 'number', inputmode: 'decimal', placeholder: '0', min: 0 });
    const merchant = h('input', { class: 'inl', placeholder: 'Where / what (e.g. Swiggy, rent)', maxlength: 40 });
    const s = openSheet({ title: 'Add', left: { label: 'Cancel' }, right: { label: 'Save', onClick: async (close) => {
      const a = Number(amount.value);
      if (!(a > 0)) return toast('Enter an amount');
      try { await ctx.api('POST', '/api/money/tx', { amount: a, dir, merchant: merchant.value, category }); close(); load(); } catch (e) { toast(e.message, { error: true }); }
    } } });
    const draw = () => s.body.replaceChildren(
      h('div', { class: 'mn-seg' }, [['debit', 'Spent'], ['credit', 'Received']].map(([v, l]) => h('button', { class: dir === v ? 'on' : '', onclick: () => { dir = v; draw(); } }, l))),
      h('div', { class: 'mn-amtwrap' }, h('span', null, '₹'), amount),
      h('div', { class: 'group' }, h('div', { class: 'cell' }, merchant)),
      h('div', { class: 'group-label' }, 'Category (optional — guessed from the name)'),
      h('div', { class: 'mn-catgrid' }, data.categories.map((c) => h('button', { class: 'mn-catbtn' + (c === category ? ' on' : ''), style: { '--c': COLORS[c] }, onclick: () => { category = category === c ? null : c; draw(); } }, c))));
    draw();
    setTimeout(() => amount.focus(), 300);
  }

  function openBudgets() {
    const vals = { ...(data.budgets || {}) };
    const s = openSheet({ title: 'Monthly budgets', left: { label: 'Cancel' }, right: { label: 'Save', onClick: async (close) => {
      try { await ctx.api('POST', '/api/money/budgets', { budgets: vals }); close(); load(); } catch (e) { toast(e.message, { error: true }); }
    } } });
    const row = (k, label) => h('div', { class: 'cell' }, h('span', { class: 'lb' }, label), h('input', { class: 'mn-binp', type: 'number', inputmode: 'numeric', placeholder: 'No limit', value: vals[k] || '', oninput: (e) => { vals[k] = Number(e.target.value) || 0; } }));
    s.body.append(h('div', { class: 'group' }, row('total', 'All spending')), h('div', { class: 'group-label' }, 'By category'),
      h('div', { class: 'group' }, data.categories.filter((c) => !['Income', 'Transfers', 'Investments'].includes(c)).map((c) => row(c, c))),
      h('div', { class: 'group-foot' }, 'The bars turn orange at 80% and red when you go over.'));
  }

  async function openSetup(tab = 'iphone') {
    if (typeof tab !== 'string') tab = /iPhone|iPad/.test(navigator.userAgent) ? 'iphone' : /Android/.test(navigator.userAgent) ? 'android' : 'iphone';
    const s = openSheet({ title: 'Connect your bank SMS', left: { label: 'Done' }, full: true });
    const copy = async () => { try { await navigator.clipboard.writeText(link.url); toast('Link copied', { timeout: 1500 }); } catch { prompt('Copy your private link', link.url); } };
    const linkBox = () => h('div', { class: 'mn-linkbox' }, h('code', null, link.url), h('button', { class: 'btn', onclick: copy }, icon('copy'), 'Copy link'));
    const steps = (list) => h('ol', { class: 'mn-steps' }, list.map((x) => h('li', null, ...[].concat(x))));
    const pasteBox = h('textarea', { class: 'mn-paste', placeholder: 'Paste your bank SMS here — one or many at once.' });
    const draw = () => s.body.replaceChildren(
      h('div', { class: 'mn-seg' }, [['iphone', 'iPhone'], ['android', 'Android'], ['paste', 'Past SMS']].map(([v, l]) => h('button', { class: tab === v ? 'on' : '', onclick: () => { tab = v; draw(); } }, l))),
      tab === 'iphone' ? h('div', null,
        h('p', { class: 'mn-p' }, 'iPhone sends each bank SMS to Ping Me by itself, using the Shortcuts app (built in). Set it up once:'),
        steps([
          ['Copy your private link: ', linkBox()],
          ['Open the ', h('b', null, 'Shortcuts'), ' app → ', h('b', null, 'Automation'), ' → ', h('b', null, '+'), ' → ', h('b', null, 'Message'), '.'],
          ['Set ', h('b', null, 'Message Contains'), ' to ', h('b', null, 'Rs'), ' (leave Sender empty). Choose ', h('b', null, 'Run Immediately'), ' → Next.'],
          ['Tap ', h('b', null, 'New Blank Automation'), ', add the action ', h('b', null, 'Get Contents of URL'), ', and paste your link.'],
          ['Tap the arrow on that action: Method ', h('b', null, 'POST'), ', Request Body ', h('b', null, 'JSON'), '. Add field ', h('b', null, 'text'), ' = ', h('b', null, 'Shortcut Input → Content'), ', and field ', h('b', null, 'from'), ' = ', h('b', null, 'Shortcut Input → Sender'), '. Done.'],
          ['Repeat with ', h('b', null, 'INR'), ' instead of Rs, for banks that write INR.'],
        ]),
        h('p', { class: 'mn-note' }, 'Ping Me only keeps bank transactions. OTPs and personal messages are ignored and never stored.')) : null,
      tab === 'android' ? h('div', null,
        h('p', { class: 'mn-p' }, 'Android can forward each bank SMS to Ping Me with a free forwarding app. Set it up once:'),
        steps([
          ['Copy your private link: ', linkBox()],
          ['Install ', h('b', null, 'SMS to URL Forwarder'), ' (free, open source) from the Play Store — or MacroDroid if you already use it.'],
          ['Add a forwarding rule: sender ', h('b', null, '*'), ' (all), and paste your link as the ', h('b', null, 'Webhook URL'), '. Save, and allow SMS access when asked.'],
          ['MacroDroid instead: trigger ', h('b', null, 'SMS Received'), ' → action ', h('b', null, 'HTTP Request'), ': POST to your link, body ', h('code', null, '{"text":"[sms_message]","from":"[sms_number]"}'), '.'],
        ]),
        h('p', { class: 'mn-note' }, 'No app? Long-press any bank SMS → Share → Ping Me, or paste them in “Past SMS”.')) : null,
      tab === 'paste' ? h('div', null,
        h('p', { class: 'mn-p' }, 'Bring in this month’s spending: open your bank’s SMS, copy them (several at once is fine) and paste here.'),
        pasteBox,
        h('button', { class: 'btn', onclick: async (e) => {
          const b = e.currentTarget; b.disabled = true; b.textContent = 'Reading…';
          try { const r = await ctx.api('POST', '/api/money/import', { text: pasteBox.value }); toast(`${r.saved} transaction${r.saved === 1 ? '' : 's'} added${r.duplicates ? ` · ${r.duplicates} already there` : ''}${r.skipped ? ` · ${r.skipped} ignored (not transactions)` : ''}`, { timeout: 3500 }); pasteBox.value = ''; load(); }
          catch (er) { toast(er.message, { error: true }); }
          b.disabled = false; b.textContent = 'Add these';
        } }, 'Add these')) : null,
      tab !== 'paste' ? h('div', { class: 'group', style: { marginTop: '14px' } },
        cell({ icon: 'zap', color: '#34c759', label: 'Send a test SMS', sub: 'Checks your link works', onClick: async () => {
          try {
            const r = await fetch(link.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Rs.1.00 debited from A/c XX0000 to PING ME TEST on ' + new Date().toLocaleDateString('en-GB').replace(/\//g, '-') + '. Ref TEST' + Date.now() }) }).then((x) => x.json());
            toast(r.saved || r.duplicate ? 'Your link works — a ₹1 test was added (you can delete it)' : 'The link answered, but the test wasn’t saved', { timeout: 3500 }); load();
          } catch { toast('Couldn’t reach your link', { error: true }); }
        } }),
        cell({ icon: 'undo', color: '#ff9500', label: 'Reset my link', sub: 'If someone else got it — the old one stops working', onClick: async () => {
          if (!(await confirmDialog('Make a new link? Update it in your Shortcut / forwarder app afterwards.', { ok: 'New link' }))) return;
          const r = await ctx.api('POST', '/api/money/link/reset'); link = { ...link, url: r.url }; draw();
        } })) : null,
      h('div', { class: 'group-foot' }, 'Your link is private: anyone with it could add transactions to your Money tab, so don’t share it. Your money data is encrypted and only you can see it.'));
    draw();
  }

  async function deleteAll() {
    if (!(await confirmDialog('Delete all your money data? Transactions, budgets and your private link are removed for good.', { ok: 'Delete all', danger: true }))) return;
    await ctx.api('POST', '/api/money/delete-all'); link = null; toast('Deleted'); load();
  }

  function bindSocket() {
    const s = ctx.socket();
    if (!s || s._mnBound) return;
    s._mnBound = true;
    s.on('money:new', (t) => { if (visible) { if (month === thisMonth()) load(); toast(`${t.dir === 'credit' ? '+' : '−'}${inr(t.amount)} ${t.merchant || ''} · ${t.category}`, { timeout: 2500 }); } });
    s.on('money:changed', () => { if (visible) load(); });
  }

  return {
    show(container) { visible = true; if (root !== container) mount(container); bindSocket(); load(); },
    hide() { visible = false; },
    openSetup,
  };
}
