// Private, account-owned companions. All balances and purchases are serialized in MySQL.
const CATALOG = [
  { kind: 'dog', name: 'Maple', price: 40, description: 'A loyal little sunshine.' },
  { kind: 'cat', name: 'Mochi', price: 40, description: 'Curious, cozy, always nearby.' },
  { kind: 'bunny', name: 'Clover', price: 60, description: 'Small hops. Big heart.' },
  { kind: 'fox', name: 'Ember', price: 90, description: 'Your playful adventure buddy.' },
  { kind: 'panda', name: 'Bao', price: 120, description: 'An expert in taking it easy.' },
  { kind: 'dragon', name: 'Sprout', price: 180, description: 'A little everyday magic.' },
  { kind: 'unicorn', name: 'Luna', price: 180, description: 'Bring a little wonder along.' },
];
const OUTFITS = ['bow', 'scarf', 'crown', 'party', 'nightcap'];
const COLORS = ['natural', 'caramel', 'snow', 'midnight', 'rose', 'lavender', 'mint'];
function fresh() { return { balance: 0, owned: {}, active: null, hidden: false, day: '', earned: 0, last: {} }; }
function award(s, type, now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  if (s.day !== day) { s.day = day; s.earned = 0; }
  const amount = type === 'call' ? 10 : 2;
  const cooldown = type === 'call' ? 600000 : 60000;
  if (s.earned >= 100 || now - (s.last[type] || 0) < cooldown) return 0;
  const coins = Math.min(amount, 100 - s.earned);
  s.last[type] = now; s.earned += coins; s.balance += coins;
  return coins;
}
function mutate(s, body, bad) {
  const { action, kind } = body;
  if (action === 'buy') {
    const item = CATALOG.find(p => p.kind === kind);
    if (!item) throw bad('Choose a pet from the shop');
    if (!s.owned[kind]) {
      if (s.balance < item.price) throw bad('Keep chatting to earn more PingCoins');
      s.balance -= item.price;
      s.owned[kind] = { kind, name: item.name, color: 'natural', outfit: null, glasses: false };
    }
    s.active = kind; s.hidden = false;
  } else if (action === 'equip') {
    if (!CATALOG.some(p => p.kind === kind) || !Object.hasOwn(s.owned, kind)) throw bad('Adopt this pet first');
    s.active = kind; s.hidden = false;
  } else if (action === 'visibility') s.hidden = !!body.hidden;
  else {
    const p = s.owned[s.active];
    if (!p) throw bad('Adopt a pet first');
    if (action === 'customize' || action === 'rename' || action === 'outfit') {
      if (body.name !== undefined) {
        if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 20) throw bad('Use a name with 1–20 characters');
        p.name = body.name.trim();
      }
      if (body.color !== undefined) { if (!COLORS.includes(body.color)) throw bad('Unknown coat color'); p.color = body.color; }
      if (body.outfit !== undefined) { if (body.outfit !== null && !OUTFITS.includes(body.outfit) && body.outfit !== 'glasses') throw bad('Unknown outfit'); p.outfit = body.outfit; }
      if (body.glasses !== undefined) { if (typeof body.glasses !== 'boolean') throw bad('Invalid glasses'); p.glasses = body.glasses; }
    } else if (['feed', 'play', 'poke'].includes(action)) p[action] = Date.now();
    else if (['cage', 'release'].includes(action)) p.caged = action === 'cage';
    else throw bad('Unknown pet action');
  }
}
function view(s) {
  const p = s.owned[s.active];
  const need = (at) => Math.max(15, Math.round(100 - (Date.now() - (at || Date.now())) / 3600000 * 4));
  return { ...s, catalog: CATALOG, colors: COLORS, outfits: OUTFITS,
    pet: !p || s.hidden ? null : { ...p, level: 3, stage: 'Companion', rarity: 'Personal', defaultName: CATALOG.find(i => i.kind === p.kind).name,
      xp: 0, next: null, mood: 'Happy', moodEmoji: '♡', hunger: need(p.feed), happiness: need(p.play), energy: 90,
      outfits: [...OUTFITS, 'glasses'].map(id => ({ id, label: id })), night: false, favorite: null } };
}
module.exports = function ({ app, db, C, auth, wrap, bad, rateLimit, emitToUser }) {
  async function transaction(uid, fn) {
    const conn = await db.pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('INSERT IGNORE INTO pet_wallets (user_id,state_enc) VALUES (?,?)', [uid, C.enc(fresh())]);
      const [[row]] = await conn.query('SELECT state_enc FROM pet_wallets WHERE user_id=? FOR UPDATE', [uid]);
      const s = C.decJson(row.state_enc);
      if (!s) throw new Error('Pet wallet could not be read');
      await fn(s);
      await conn.query('UPDATE pet_wallets SET state_enc=? WHERE user_id=?', [C.enc(s), uid]);
      await conn.commit(); return view(s);
    } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  }
  app.get('/api/pets/me', auth, wrap(async (req, res) => res.json(await transaction(req.uid, () => {}))));
  app.post('/api/pets/me', auth, wrap(async (req, res) => {
    rateLimit('personal-pet:' + req.uid, 60, 60000);
    const result = await transaction(req.uid, s => mutate(s, req.body, bad));
    emitToUser(req.uid, 'personal-pet:changed', { action: req.body.action });
    res.json(result);
  }));
  return { reward: async (uid, type) => {
    let coins = 0;
    const result = await transaction(uid, s => { coins = award(s, type); });
    if (coins) emitToUser(uid, 'pingcoins', { balance: result.balance, coins });
  } };
};
module.exports.award = award;
module.exports.mutate = mutate;
module.exports.fresh = fresh;
