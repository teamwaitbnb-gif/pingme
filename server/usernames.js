// Username rules. Goal: every username is clearly distinct from every other one.
//  • 3–24 chars, starts with a letter, only a–z 0–9 . _
//  • no doubled / leading / trailing separators ("a..b", "_ab", "ab.")
//  • reserved words (admin, support, pingme…) can't be taken
//  • look-alikes collide: "john.doe", "john_doe", "johndoe", "j0hnd0e" are all the SAME name
//    for uniqueness, so nobody can impersonate someone with a near-identical handle.

const RESERVED = new Set([
  'admin', 'administrator', 'root', 'system', 'sys', 'support', 'help', 'helpdesk', 'info', 'contact',
  'pingme', 'ping', 'meetme', 'official', 'verified', 'moderator', 'mod', 'staff', 'team', 'security', 'privacy',
  'api', 'www', 'web', 'app', 'mail', 'email', 'null', 'undefined', 'none', 'nobody', 'everyone', 'here',
  'all', 'channel', 'apple', 'google', 'icloud', 'settings', 'login', 'logout', 'signin', 'signup',
  'register', 'account', 'accounts', 'billing', 'owner', 'bot', 'notifications', 'noreply', 'abuse',
]);

const PATTERN = /^[a-z][a-z0-9._]{2,23}$/;

function normalize(input) {
  return String(input || '').normalize('NFKC').trim().toLowerCase().replace(/^@+/, '');
}

// Canonical "skeleton" used only for uniqueness.
function canonical(u) {
  return normalize(u)
    .replace(/[._]/g, '')
    .replace(/0/g, 'o').replace(/1/g, 'l').replace(/3/g, 'e').replace(/5/g, 's')
    .replace(/rn/g, 'm').replace(/vv/g, 'w');
}

// Returns null if valid, otherwise a human-readable reason.
function validate(u) {
  if (u.length < 3) return 'Username must be at least 3 characters';
  if (u.length > 24) return 'Username must be 24 characters or fewer';
  if (!/^[a-z]/.test(u)) return 'Username must start with a letter';
  if (!PATTERN.test(u)) return 'Use only letters, numbers, period (.) and underscore (_)';
  if (/[._]{2}/.test(u)) return 'Periods and underscores can’t be next to each other';
  if (/[._]$/.test(u)) return 'Username can’t end with a period or underscore';
  const c = canonical(u);
  if (c.length < 3) return 'Username must contain at least 3 letters or numbers';
  if (RESERVED.has(c) || /^(pingme|meetme|official|support|admin|security)/.test(c)) return 'That username is reserved';
  return null;
}

// Build candidate usernames from a name or a taken username.
function suggestionsFor(seed) {
  let base = normalize(seed).replace(/[^a-z0-9._ ]/g, '').replace(/\s+/g, '.').replace(/[._]{2,}/g, '.').replace(/^[^a-z]+/, '').replace(/[._]+$/, '');
  if (base.length < 3) base = (base + 'user').slice(0, 8);
  base = base.slice(0, 18).replace(/[._]+$/, '');
  const parts = base.split(/[._]/).filter(Boolean);
  const out = new Set();
  const year = String(new Date().getFullYear()).slice(2);
  const rnd = () => Math.floor(10 + Math.random() * 989);
  if (parts.length > 1) { out.add(parts.join('.')); out.add(parts.join('_')); out.add(parts[0] + parts[parts.length - 1][0]); }
  out.add(base);
  out.add(`${base.replace(/[._]/g, '')}${rnd()}`);
  out.add(`${base}.${year}`);
  out.add(`${base}_${rnd()}`);
  out.add(`the.${base.replace(/[._]/g, '')}`.slice(0, 24));
  out.add(`${base.replace(/[._]/g, '')}.hq`.slice(0, 24));
  for (let i = 0; i < 6; i++) out.add(`${base.replace(/[._]/g, '')}${rnd()}`);
  return [...out].map((s) => s.slice(0, 24).replace(/[._]+$/, '')).filter((s) => !validate(s));
}

// "@name" handles in a message (lowercase, without a trailing full stop). Emails don't count.
function mentionsIn(text) {
  return new Set([...String(text || '').matchAll(/(?:^|[^\w@])@([a-z0-9_.]{3,24})/gi)].map((m) => m[1].replace(/\.+$/, '').toLowerCase()).filter((x) => x.length >= 3));
}

module.exports = { mentionsIn, normalize, canonical, validate, suggestionsFor, RESERVED };
