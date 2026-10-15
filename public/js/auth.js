// Sign in / sign up: username + password or Sign in with Google, the "choose your username"
// step for new Google accounts, and password recovery through trusted friends.
import { h, icon, toast, isStandalone, store } from './ui.js';
import { S, api } from './core.js';

let onSignedIn = () => {};
export function setSignedInHandler(fn) { onSignedIn = fn; }

const app = () => document.getElementById('app');

const scripts = new Map();
function loadScript(src) {
  if (!scripts.has(src)) {
    scripts.set(src, new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.async = true; s.onload = res;
      s.onerror = () => { scripts.delete(src); rej(new Error('Could not load sign-in — check your connection')); };
      document.head.append(s);
    }));
  }
  return scripts.get(src);
}

export const GOOGLE_LOGO = '<svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';

// ───── provider flows ─────

async function startProvider(link) {
  return api('GET', '/api/oauth/start' + (link ? '?link=1' : ''));
}

async function handleIdToken(provider, idToken, { link = false } = {}) {
  const r = await api('POST', `/api/oauth/${provider}`, { idToken, link });
  return handleOauthResult(r);
}

export async function handleOauthResult(r) {
  if (r.kind === 'login') { S.me = r.user; onSignedIn(); }
  else if (r.kind === 'linked') {
    toast('Google is now linked to your account');
    const { user } = await api('GET', '/api/me');
    S.me = user;
    window.dispatchEvent(new Event('mm:me-changed'));
  } else if (r.kind === 'signup') showChooseUsername(r);
}

// Google requires its own rendered button for ID-token sign-in.
export async function googleButton(container, { link = false } = {}) {
  if (!S.config.googleClientId) {
    container.replaceChildren(h('button', { class: 'btn social google', type: 'button', onclick: () => toast('Sign in with Google isn’t set up on this server yet (GOOGLE_CLIENT_ID).', { error: true, timeout: 5000 }) },
      h('span', { html: GOOGLE_LOGO }), 'Continue with Google'));
    return;
  }
  container.replaceChildren(h('div', { class: 'btn social google', style: { pointerEvents: 'none', opacity: '0.6' } }, h('span', { html: GOOGLE_LOGO }), 'Continue with Google'));
  try {
    await loadScript('https://accounts.google.com/gsi/client');
    const { nonce, redirect } = await startProvider(link);
    const standalone = isStandalone();
    window.google.accounts.id.initialize({
      client_id: S.config.googleClientId,
      nonce,
      ux_mode: standalone ? 'redirect' : 'popup',
      login_uri: redirect.google,
      callback: standalone ? undefined : (resp) => handleIdToken('google', resp.credential, { link }).catch((e) => toast(e.message, { error: true })),
      auto_select: false,
      itp_support: true,
    });
    const dark = matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light' || document.documentElement.dataset.theme === 'dark';
    container.replaceChildren();
    window.google.accounts.id.renderButton(container, {
      type: 'standard', theme: dark ? 'filled_black' : 'outline', size: 'large', shape: 'pill',
      text: 'continue_with', logo_alignment: 'center', width: Math.min(400, Math.max(240, container.clientWidth || 340)),
    });
  } catch (e) {
    container.replaceChildren(h('button', { class: 'btn social google', type: 'button', onclick: () => googleButton(container, { link }) }, h('span', { html: GOOGLE_LOGO }), 'Retry Google sign-in'));
  }
}

// ───── birthday + invite ─────

function birthField() {
  const max = new Date(); max.setFullYear(max.getFullYear() - 13);
  const input = h('input', { class: 'field date', type: 'date', required: true, max: max.toISOString().slice(0, 10), min: '1900-01-01', 'aria-label': 'Date of birth' });
  return { input, el: h('label', { class: 'field-label' }, h('span', null, 'Date of birth'), input) };
}

function inviteField() {
  if (!S.config.inviteOnly) return null;
  const input = h('input', { class: 'field', placeholder: 'Invite code (PING-XXXX-XXXX)', autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false', maxlength: 20, value: store.get('inviteCode', '') });
  return { input, el: input };
}

const logo = () => h('img', { class: 'brand-logo', src: '/icons/logo.svg', alt: 'pingme' });

// ───── username field with live availability ─────

export function usernameField({ value = '', nameSource = () => '', autofocus = false } = {}) {
  const input = h('input', { class: 'field', placeholder: 'Username', autocomplete: 'username', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', maxlength: 24, value });
  const status = h('div', { class: 'uname-status' });
  const sugg = h('div', { class: 'sugg' });
  let timer = null, seq = 0, state = { ok: false, username: '' };
  const check = async () => {
    const v = input.value.trim().toLowerCase().replace(/^@/, '');
    if (v !== input.value) input.value = v;
    if (!v) { status.textContent = ''; status.className = 'uname-status'; sugg.replaceChildren(); state = { ok: false, username: '' }; return; }
    const my = ++seq;
    try {
      const r = await api('GET', `/api/username/check?u=${encodeURIComponent(v)}&name=${encodeURIComponent(nameSource() || '')}`);
      if (my !== seq) return;
      state = { ok: r.ok, username: r.username };
      status.className = 'uname-status ' + (r.ok ? 'ok' : 'bad');
      status.replaceChildren(r.ok ? icon('check') : icon('x'), r.ok ? `@${r.username} is available` : r.reason);
      sugg.replaceChildren(...(r.suggestions || []).map((s) => h('button', { type: 'button', onclick: () => { input.value = s; check(); } }, '@' + s)));
    } catch {}
  };
  input.addEventListener('input', () => { clearTimeout(timer); state.ok = false; timer = setTimeout(check, 300); });
  if (value) check();
  if (autofocus) setTimeout(() => input.focus(), 150);
  return { input, el: h('div', { class: 'uname-wrap' }, input, status, sugg), state: () => state, check };
}

// ───── screens ─────

export function showAuth(mode = 'login') {
  const err = h('div', { class: 'err' });
  const name = h('input', { class: 'field', placeholder: 'Your name', autocomplete: 'name', maxlength: 60 });
  const uf = mode === 'register' ? usernameField({ nameSource: () => name.value }) : null;
  const username = uf ? uf.input : h('input', { class: 'field', placeholder: 'Username', autocomplete: 'username', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', maxlength: 40 });
  const password = h('input', { class: 'field', type: 'password', placeholder: 'Password', autocomplete: mode === 'login' ? 'current-password' : 'new-password', maxlength: 200 });
  const birth = mode === 'register' ? birthField() : null;
  const invite = mode === 'register' ? inviteField() : null;
  const btn = h('button', { class: 'btn', type: 'submit' }, mode === 'login' ? 'Sign in' : 'Create account');
  const google = h('div', { class: 'gbtn' });
  const form = h('form', { class: 'card', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    err.textContent = '';
    if (mode === 'register') {
      if (!name.value.trim()) return (err.textContent = 'Please enter your name');
      if (!birth.input.value) return (err.textContent = 'Please enter your date of birth');
      if (password.value.length < 8) return (err.textContent = 'Password must be at least 8 characters');
    }
    btn.disabled = true;
    try {
      const body = { username: username.value.trim(), password: password.value };
      if (mode === 'register') Object.assign(body, { name: name.value.trim(), birth: birth.input.value, invite: invite?.input.value.trim() });
      const { user } = await api('POST', mode === 'login' ? '/api/login' : '/api/register', body);
      S.me = user;
      onSignedIn();
    } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
  } },
    logo(),
    h('p', { class: 'sub' }, mode === 'login' ? 'Welcome back' : 'Create your account'),
    google,
    h('div', { class: 'divider' }, h('span', null, 'or')),
    mode === 'register' ? name : null,
    uf ? uf.el : username,
    password,
    birth?.el,
    invite?.el,
    err, btn,
    mode === 'login' ? h('a', { href: '#', class: 'link small center', onclick: (e) => { e.preventDefault(); showRecovery(); } }, 'Forgot password? Recover with friends') : null,
    h('div', { class: 'switch' }, mode === 'login' ? 'New here? ' : 'Have an account? ',
      h('a', { href: '#', class: 'link', onclick: (e) => { e.preventDefault(); showAuth(mode === 'login' ? 'register' : 'login'); } }, mode === 'login' ? 'Create an account' : 'Sign in')),
    h('div', { class: 'lock' }, icon('lock'), 'Messages and files are encrypted at rest'));
  app().replaceChildren(h('div', { class: 'auth' }, form));
  googleButton(google);
}

export function showChooseUsername({ ticket, name: suggestedName = '', suggestions = [] }) {
  const err = h('div', { class: 'err' });
  const name = h('input', { class: 'field', placeholder: 'Your name', autocomplete: 'name', maxlength: 60, value: suggestedName || '' });
  const uf = usernameField({ value: suggestions[0] || '', nameSource: () => name.value, autofocus: !!suggestedName });
  const birth = birthField();
  const invite = inviteField();
  const btn = h('button', { class: 'btn', type: 'submit' }, 'Continue');
  const form = h('form', { class: 'card', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    err.textContent = '';
    if (!name.value.trim()) return (err.textContent = 'Please enter your name');
    if (!birth.input.value) return (err.textContent = 'Please enter your date of birth');
    btn.disabled = true;
    try {
      const { user } = await api('POST', '/api/oauth/complete', { ticket, username: uf.input.value.trim(), name: name.value.trim(), birth: birth.input.value, invite: invite?.input.value.trim() });
      S.me = user;
      onSignedIn();
    } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
  } },
    logo(),
    h('h1', null, 'Almost there'),
    h('p', { class: 'sub' }, 'Signed in with Google. Pick the username people will find you by.'),
    name, uf.el, birth.el, invite?.el, err, btn,
    h('div', { class: 'switch' }, h('a', { href: '#', class: 'link', onclick: (e) => { e.preventDefault(); showAuth('login'); } }, 'Cancel')));
  app().replaceChildren(h('div', { class: 'auth' }, form));
}

// ───── recovery through trusted friends ─────
// 3 of your trusted contacts approve in their app, a short safety delay passes (your signed-in
// devices can cancel during it), then you choose a new password. No SMS → no SIM-swap takeovers.

export function showRecovery() {
  const saved = store.get('recovery', null);
  if (saved?.id && saved?.secret) return showRecoveryStatus(saved);
  const err = h('div', { class: 'err' });
  const username = h('input', { class: 'field', placeholder: 'Your username', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', maxlength: 40 });
  const btn = h('button', { class: 'btn', type: 'submit' }, 'Ask my friends');
  const form = h('form', { class: 'card', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    err.textContent = ''; btn.disabled = true;
    try {
      const r = await api('POST', '/api/recovery/start', { username: username.value.trim() });
      const rec = { id: r.id, secret: r.secret, friends: r.friends, delayMin: r.delayMin };
      store.set('recovery', rec);
      showRecoveryStatus(rec);
    } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
  } },
    logo(),
    h('h1', null, 'Recover with friends'),
    h('p', { class: 'sub' }, 'We’ll ask your trusted contacts to confirm it’s you. 3 approvals unlock a new password.'),
    username, err, btn,
    h('div', { class: 'switch' }, h('a', { href: '#', class: 'link', onclick: (e) => { e.preventDefault(); showAuth('login'); } }, 'Back to sign in')));
  app().replaceChildren(h('div', { class: 'auth' }, form));
}

function showRecoveryStatus(rec) {
  const err = h('div', { class: 'err' });
  const info = h('div', { class: 'rec-status' }, h('div', { class: 'spinner' }));
  const pw = h('input', { class: 'field', type: 'password', placeholder: 'New password', autocomplete: 'new-password', hidden: true });
  const btn = h('button', { class: 'btn', type: 'submit', hidden: true }, 'Set new password');
  let timer = null;
  const stop = () => clearInterval(timer);
  const form = h('form', { class: 'card', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    err.textContent = ''; btn.disabled = true;
    try {
      const { user } = await api('POST', `/api/recovery/${rec.id}/complete`, { secret: rec.secret, password: pw.value });
      store.del('recovery'); stop();
      S.me = user; onSignedIn();
    } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
  } },
    logo(), h('h1', null, 'Waiting for friends'), info, pw, err, btn,
    h('div', { class: 'switch' }, h('a', { href: '#', class: 'link', onclick: (e) => { e.preventDefault(); stop(); store.del('recovery'); showAuth('login'); } }, 'Cancel and go back')));
  app().replaceChildren(h('div', { class: 'auth' }, form));
  const poll = async () => {
    if (!form.isConnected) return stop();
    try {
      const st = await api('GET', `/api/recovery/${rec.id}/status?secret=${encodeURIComponent(rec.secret)}`);
      const dots = h('div', { class: 'rec-dots' }, ...Array.from({ length: st.needed }, (_, i) => h('span', { class: i < st.approvals ? 'on' : '' })));
      if (st.status === 'approved') {
        const wait = Math.max(0, st.readyAt - Date.now());
        if (wait > 0) info.replaceChildren(dots, h('p', null, `Approved by your friends. For your safety, you can set a new password in ${Math.ceil(wait / 60000)} min.`));
        else { info.replaceChildren(dots, h('p', null, 'Approved! Choose a new password.')); pw.hidden = false; btn.hidden = false; stop(); }
      } else if (st.status === 'pending') {
        info.replaceChildren(dots, h('p', null, `${st.approvals} of ${st.needed} friends approved. Ask them to open Ping Me — they’ll see your request.`));
      } else {
        info.replaceChildren(h('p', null, `This request was ${st.status}. Start again if you still need to.`));
        store.del('recovery'); stop();
      }
    } catch { info.replaceChildren(h('p', null, 'This request has expired. Start again.')); store.del('recovery'); stop(); }
  };
  poll();
  timer = setInterval(poll, 5000);
}
