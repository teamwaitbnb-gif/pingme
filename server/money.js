// Money: a personal expense tracker fed by the person's own bank SMS.
// Web apps can't read SMS, so the phone forwards them: an iPhone Shortcuts automation or an Android
// SMS-forwarder posts each bank SMS to the person's private link (/api/money/in/<secret>). Past
// SMS can be pasted in bulk. Each SMS is read once; only the transaction (amount, direction,
// merchant, category, account ending, date) is kept — encrypted — and the SMS text is thrown away.
// Non-transaction SMS (OTPs, offers, reminders) are ignored. Money data never appears in admin.
const crypto = require('crypto');
const { parseSms, categorize, CATEGORIES } = require('./money-parse');

module.exports = function money({ app, db, C, auth, wrap, bad, notFound, toInt, clampStr, rateLimit, emitToUser, push, monitor, publicOrigin }) {
  const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
  const istMonth = (t = Date.now()) => new Date(t + 5.5 * 3600e3).toISOString().slice(0, 7);

  // ───── settings: private link secret, learned merchant categories, budgets ─────
  async function prefsOf(uid) {
    const r = await db.one('SELECT data_enc FROM money_prefs WHERE user_id=?', [uid]);
    return { learned: {}, budgets: {}, secret: null, ...((r && C.decJson(r.data_enc, {})) || {}) };
  }
  const savePrefs = (uid, p) => db.q('INSERT INTO money_prefs (user_id, data_enc, link_hash) VALUES (?,?,?) ON DUPLICATE KEY UPDATE data_enc=VALUES(data_enc), link_hash=VALUES(link_hash)', [uid, C.enc(p), p.secret ? sha('money:' + p.secret) : null]);
  async function linkOf(uid, reset = false) {
    const p = await prefsOf(uid);
    if (!p.secret || reset) { p.secret = crypto.randomBytes(18).toString('base64url'); await savePrefs(uid, p); }
    return p.secret;
  }

  // ───── storing a transaction ─────
  const view = (r) => ({ id: Number(r.id), at: new Date(r.at).getTime(), source: r.source, ...(C.decJson(r.data_enc, {}) || {}) });
  async function save(uid, tx, source, { notify = false } = {}) {
    const p = await prefsOf(uid);
    tx.category = tx.category || categorize(tx, p.learned);
    // The same transaction can arrive twice (SMS + paste, or two SMS from bank and UPI app).
    const key = tx.ref ? `ref:${tx.ref}` : `${tx.dir}:${tx.amount}:${(tx.merchant || '').toLowerCase()}:${tx.account || ''}:${Math.round(tx.at / 120000)}`;
    const hash = sha(uid + ':' + key);
    const data = { amount: tx.amount, dir: tx.dir, merchant: tx.merchant || null, category: tx.category, account: tx.account || null, bank: tx.bank || null, mode: tx.mode || null, balance: tx.balance ?? null, note: tx.note || null, ai: !!tx.ai };
    const r = await db.q('INSERT IGNORE INTO money_tx (user_id, at, data_enc, dedupe, source) VALUES (?,?,?,?,?)', [uid, new Date(tx.at), C.enc(data), hash, source]);
    if (!r.affectedRows) return null;
    const out = { id: Number(r.insertId), at: tx.at, source, ...data };
    emitToUser(uid, 'money:new', out);
    if (notify) {
      const amt = '₹' + Number(tx.amount).toLocaleString('en-IN');
      push.send(uid, { type: 'msg', title: tx.dir === 'debit' ? `${amt} spent${tx.merchant ? ' · ' + tx.merchant : ''}` : `${amt} received${tx.merchant ? ' · ' + tx.merchant : ''}`, body: `${data.category}${tx.account ? ' · a/c ' + tx.account : ''} · tap to see this month`, url: '/?tab=money', tag: 'pm-money' }).catch(() => {});
    }
    if (data.category === 'Other' && data.merchant) aiQueue.add(uid);
    return out;
  }

  // ───── the private link the phone forwards bank SMS to (no login — the secret is the key) ─────
  app.post('/api/money/in/:secret', express_text(), wrap(async (req, res) => {
    const secret = String(req.params.secret || '');
    if (secret.length < 20) throw notFound();
    rateLimit('money-in:' + secret.slice(0, 12), 60, 60000);
    const row = await db.one('SELECT user_id FROM money_prefs WHERE link_hash=?', [sha('money:' + secret)]);
    if (!row) throw notFound('This link was reset — copy the new one from Ping Me → Money');
    const uid = Number(row.user_id);
    const b = typeof req.body === 'object' && req.body ? req.body : {};
    const text = clampStr(String(b.text || b.message || b.body || b.sms || (typeof req.body === 'string' ? req.body : '') || ''), 1200);
    const from = clampStr(String(b.from || b.sender || b.address || ''), 40);
    const tx = parseSms(text, { from });
    if (!tx) return res.json({ ok: true, saved: false, reason: 'not a bank transaction' });
    const out = await save(uid, tx, 'sms', { notify: true });
    monitor?.log?.(uid, 'money-sms', { saved: !!out });
    res.json({ ok: true, saved: !!out, duplicate: !out });
  }));
  // Accepts JSON, form posts and plain text bodies (different forwarder apps send different formats).
  function express_text() {
    return (req, res, next) => {
      if (req.body && Object.keys(req.body).length) return next();
      let data = '';
      req.setEncoding('utf8');
      req.on('data', (c) => { data += c; if (data.length > 20000) req.destroy(); });
      req.on('end', () => {
        try { req.body = JSON.parse(data); } catch {
          const f = Object.fromEntries(new URLSearchParams(data));
          req.body = f.text || f.message || f.sms || f.body ? f : data;
        }
        next();
      });
    };
  }

  // ───── the Money tab ─────
  app.get('/api/money/link', auth, wrap(async (req, res) => {
    const secret = await linkOf(req.uid, req.query.reset === '1');
    const any = await db.one("SELECT 1 x FROM money_tx WHERE user_id=? AND source='sms' LIMIT 1", [req.uid]);
    res.json({ url: `${publicOrigin(req)}/api/money/in/${secret}`, connected: !!any });
  }));
  app.post('/api/money/link/reset', auth, wrap(async (req, res) => {
    const secret = await linkOf(req.uid, true);
    res.json({ url: `${publicOrigin(req)}/api/money/in/${secret}` });
  }));

  // One month: totals, categories, days, top merchants, budgets, and every transaction.
  app.get('/api/money/month', auth, wrap(async (req, res) => {
    const month = /^\d{4}-\d{2}$/.test(String(req.query.month)) ? String(req.query.month) : istMonth();
    const [y, m] = month.split('-').map(Number);
    const from = new Date(Date.UTC(y, m - 1, 1) - 5.5 * 3600e3), to = new Date(Date.UTC(y, m, 1) - 5.5 * 3600e3);
    const prevFrom = new Date(Date.UTC(y, m - 2, 1) - 5.5 * 3600e3);
    const rows = await db.q('SELECT id, at, data_enc, source FROM money_tx WHERE user_id=? AND at >= ? AND at < ? ORDER BY at DESC LIMIT 3000', [req.uid, from, to]);
    const prev = await db.q('SELECT data_enc FROM money_tx WHERE user_id=? AND at >= ? AND at < ?', [req.uid, prevFrom, from]);
    const list = rows.map(view);
    const spent = list.filter((t) => t.dir === 'debit' && t.category !== 'Transfers' && t.category !== 'Investments');
    const sum = (a) => Math.round(a.reduce((s, t) => s + Number(t.amount || 0), 0) * 100) / 100;
    const byCat = {}, byDay = {}, byMerchant = {};
    for (const t of list.filter((x) => x.dir === 'debit')) byCat[t.category] = (byCat[t.category] || 0) + Number(t.amount);
    for (const t of spent) {
      const d = new Date(t.at + 5.5 * 3600e3).toISOString().slice(8, 10);
      byDay[d] = (byDay[d] || 0) + Number(t.amount);
      if (t.merchant) { const k = t.merchant; byMerchant[k] = byMerchant[k] || { name: k, amount: 0, count: 0, category: t.category }; byMerchant[k].amount += Number(t.amount); byMerchant[k].count++; }
    }
    const prevSpent = sum(prev.map((r) => C.decJson(r.data_enc, {})).filter((t) => t?.dir === 'debit' && t.category !== 'Transfers' && t.category !== 'Investments'));
    const p = await prefsOf(req.uid);
    res.json({
      month, categories: CATEGORIES, spent: sum(spent), income: sum(list.filter((t) => t.dir === 'credit' && t.category === 'Income')),
      transfers: sum(list.filter((t) => t.dir === 'debit' && t.category === 'Transfers')), invested: sum(list.filter((t) => t.dir === 'debit' && t.category === 'Investments')),
      prevSpent, byCategory: Object.entries(byCat).map(([category, amount]) => ({ category, amount: Math.round(amount) })).sort((a, b) => b.amount - a.amount),
      byDay, topMerchants: Object.values(byMerchant).sort((a, b) => b.amount - a.amount).slice(0, 8), budgets: p.budgets, transactions: list,
    });
  }));

  // Add by hand.
  app.post('/api/money/tx', auth, wrap(async (req, res) => {
    rateLimit('money-add:' + req.uid, 60, 60000);
    const amount = Number(req.body?.amount);
    if (!(amount > 0) || amount > 1e9) throw bad('Enter an amount');
    const dir = req.body?.dir === 'credit' ? 'credit' : 'debit';
    const at = Number(req.body?.at) > 0 ? Math.min(Date.now(), Number(req.body.at)) : Date.now();
    const category = CATEGORIES.includes(req.body?.category) ? req.body.category : null;
    const out = await save(req.uid, { amount, dir, merchant: clampStr(String(req.body?.merchant || ''), 40).trim() || null, category, note: clampStr(String(req.body?.note || ''), 140).trim() || null, at, ref: 'manual-' + crypto.randomBytes(6).toString('hex') }, 'manual');
    res.json({ tx: out });
  }));

  // Paste past bank SMS (one or many) — this month's history, since forwarding only sees new SMS.
  app.post('/api/money/import', auth, wrap(async (req, res) => {
    rateLimit('money-import:' + req.uid, 10, 60000);
    const raw = String(req.body?.text || '').slice(0, 400000);
    // Split pasted text into separate SMS: blank lines, or a new amount sentence after a date/time stamp.
    const parts = raw.split(/\n\s*\n|\r?\n(?=\s*(?:\[?\d{1,2}[\/\-.]\d{1,2}|\d{1,2}:\d{2}|dear|your|rs\.?|inr|₹|sent|spent|a\/c|acct|upi))/i).map((s) => s.trim()).filter((s) => s.length >= 15).slice(0, 2000);
    let saved = 0, dup = 0, skipped = 0;
    for (const s of parts) {
      const tx = parseSms(s);
      if (!tx) { skipped++; continue; }
      (await save(req.uid, tx, 'paste')) ? saved++ : dup++;
    }
    res.json({ found: parts.length, saved, duplicates: dup, skipped });
  }));

  // Change category (remembered for that merchant from now on), merchant name or note; delete.
  app.patch('/api/money/tx/:id', auth, wrap(async (req, res) => {
    const id = toInt(req.params.id);
    const r = await db.one('SELECT data_enc FROM money_tx WHERE id=? AND user_id=?', [id, req.uid]);
    if (!r) throw notFound();
    const d = C.decJson(r.data_enc, {}) || {};
    if (CATEGORIES.includes(req.body?.category)) {
      d.category = req.body.category; d.ai = false;
      if (d.merchant && req.body.remember !== false) { const p = await prefsOf(req.uid); p.learned[d.merchant.toLowerCase()] = d.category; await savePrefs(req.uid, p); }
    }
    if (typeof req.body?.note === 'string') d.note = clampStr(req.body.note, 140).trim() || null;
    if (typeof req.body?.merchant === 'string' && req.body.merchant.trim()) d.merchant = clampStr(req.body.merchant, 40).trim();
    await db.q('UPDATE money_tx SET data_enc=? WHERE id=? AND user_id=?', [C.enc(d), id, req.uid]);
    // Same merchant this month gets the new category too.
    if (req.body?.category && d.merchant && req.body.remember !== false) {
      for (const o of await db.q('SELECT id, data_enc FROM money_tx WHERE user_id=? AND at > ?', [req.uid, new Date(Date.now() - 62 * 86400e3)])) {
        const od = C.decJson(o.data_enc, {});
        if (od?.merchant?.toLowerCase() === d.merchant.toLowerCase() && od.category !== d.category && od.dir === d.dir) { od.category = d.category; od.ai = false; await db.q('UPDATE money_tx SET data_enc=? WHERE id=?', [C.enc(od), o.id]); }
      }
    }
    res.json({ ok: true });
  }));
  app.delete('/api/money/tx/:id', auth, wrap(async (req, res) => {
    await db.q('DELETE FROM money_tx WHERE id=? AND user_id=?', [toInt(req.params.id), req.uid]);
    res.json({ ok: true });
  }));
  app.post('/api/money/budgets', auth, wrap(async (req, res) => {
    const p = await prefsOf(req.uid);
    const b = {};
    for (const [k, v] of Object.entries(req.body?.budgets || {})) if (CATEGORIES.includes(k) || k === 'total') { const n = Math.round(Number(v)); if (n > 0 && n < 1e8) b[k] = n; }
    p.budgets = b; await savePrefs(req.uid, p);
    res.json({ budgets: b });
  }));
  app.post('/api/money/delete-all', auth, wrap(async (req, res) => {
    await db.q('DELETE FROM money_tx WHERE user_id=?', [req.uid]);
    await db.q('DELETE FROM money_prefs WHERE user_id=?', [req.uid]);
    res.json({ ok: true });
  }));

  // ───── AI for shops the rules don't know (only the shop names are sent — no amounts or accounts) ─────
  const aiQueue = new Set();
  let aiBusy = false;
  async function aiCategorize() {
    if (aiBusy || !aiQueue.size || !process.env.GROQ_API_KEY) return;
    aiBusy = true;
    try {
      for (const uid of [...aiQueue].slice(0, 5)) {
        aiQueue.delete(uid);
        const rows = await db.q('SELECT id, data_enc FROM money_tx WHERE user_id=? AND at > ? ORDER BY at DESC LIMIT 400', [uid, new Date(Date.now() - 62 * 86400e3)]);
        const todo = rows.map((r) => ({ id: r.id, d: C.decJson(r.data_enc, {}) })).filter((x) => x.d?.category === 'Other' && x.d.merchant && x.d.dir === 'debit' && !x.d.aiTried);
        const names = [...new Set(todo.map((x) => x.d.merchant))].slice(0, 40);
        if (!names.length) continue;
        const cats = CATEGORIES.filter((c) => c !== 'Income' && c !== 'Other');
        const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST', signal: AbortSignal.timeout(20000),
          headers: { authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'content-type': 'application/json' },
          body: JSON.stringify({ model: 'openai/gpt-oss-20b', temperature: 0, max_completion_tokens: 1200, reasoning_effort: 'low', response_format: { type: 'json_object' },
            messages: [{ role: 'system', content: `You sort Indian merchant / payee names from bank SMS into spending categories. Categories: ${cats.join(', ')}. A person's name (someone being paid via UPI) is "Transfers". If unsure, use "Other". Reply only with JSON: {"<name>": "<category>", ...}` },
              { role: 'user', content: names.join('\n') }] }),
        }).catch(() => null);
        if (!r?.ok) continue;
        let map = {};
        try { map = JSON.parse((await r.json()).choices?.[0]?.message?.content || '{}'); } catch {}
        for (const x of todo) {
          const c = map[x.d.merchant];
          x.d.aiTried = true;
          if (CATEGORIES.includes(c) && c !== 'Income') { x.d.category = c; x.d.ai = true; }
          await db.q('UPDATE money_tx SET data_enc=? WHERE id=?', [C.enc(x.d), x.id]);
        }
        emitToUser(uid, 'money:changed', {});
      }
    } finally { aiBusy = false; }
  }
  setInterval(() => aiCategorize().catch(() => {}), 20000).unref();

  // Budget alerts at 80% and 100% (checked as transactions arrive, once per category per month).
  // (kept simple: the Money tab shows progress; push alerts come in a later step)
  return { CATEGORIES };
};
