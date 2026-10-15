// Sheets & dialogs: settings, new message, chat info, viewer, forward, polls, scheduling…
import {
  h, icon, avatar, toast, openSheet, actionSheet, confirmDialog, promptDialog, toggle, cell,
  fmtSize, fmtDur, lastSeenText, disappearLabel, isIOS, isStandalone, store,
} from './ui.js';
import { avatarDataUrl, SCREEN_EFFECTS, BUBBLE_EFFECTS, playScreenEffect } from './media.js';
import { usernameField, googleButton, GOOGLE_LOGO } from './auth.js';
import { S, api, upload, user, userAvatar, fileUrl, otherMember, chatTitle, chatAvatar, isMuted, mergeUsers, prefs, applyPrefs, BUBBLES, feature } from './core.js';
import {
  openChat, closeChat, renderList, renderHeader, renderMessages, refreshChat, refreshMe, startDirect, deleteConversation,
  send, setSendAt, sendPayload, jumpTo, setupPush, logout, showInstallGate,
  setMessageOpts, messageOpts, setCheckin, startSosTracking,
} from './app.js';
import { featureList, FEATURE_GROUPS } from './onboarding.js';
import { storyStrip } from './stories.js';
import { lockEnabled, hasDuress, setPin, setDuressPin, disableLock, hiddenChats, setHiddenChats, checkPin } from './lock.js';
import { signPhoto } from './keys.js';
import { INTENTS } from './smart.js';

const err = (e) => toast(e.message || String(e), { error: true });
const pickFile = (accept) => new Promise((res) => {
  const i = h('input', { type: 'file', accept });
  i.onchange = () => res(i.files[0] || null);
  i.click();
});

// ═══════════════════════════ settings ═══════════════════════════

export function openSettings() {
  const onMe = () => draw();
  addEventListener('mm:me-changed', onMe);
  const s = openSheet({ title: 'Settings', full: true, left: { label: 'Done' }, onClose: () => removeEventListener('mm:me-changed', onMe) });
  const draw = () => {
    const me = S.me;
    const p = prefs();
    const setPriv = async (k, v) => {
      try { const { user: u } = await api('PATCH', '/api/me', { settings: { [k]: v } }); S.me = u; } catch (e) { err(e); }
    };
    const inviteUrl = `${location.origin}/?add=${me.username}`;
    s.body.replaceChildren(
      h('div', { class: 'profile-top' },
        h('button', { onclick: changeAvatar, 'aria-label': 'Change photo' }, avatar({ id: me.id, name: me.name, src: me.avatarV ? `/api/avatar/u/${me.id}?v=${me.avatarV}` : null, size: 96 })),
        h('button', { class: 'link small', onclick: changeAvatar }, me.avatarV ? 'Edit photo' : 'Add photo'),
        h('h3', null, me.name),
        h('div', { class: 'u' }, '@' + me.username),
        me.bio ? h('div', { class: 'bio' }, me.bio) : null),

      h('div', { class: 'group' },
        cell({ icon: 'user', label: 'Name', value: me.name, chevron: true, onClick: async () => { const v = await promptDialog({ title: 'Your name', value: me.name, maxlength: 60 }); if (v?.trim()) save({ name: v.trim() }); } }),
        cell({ icon: 'text', color: '#8e8e93', label: 'About', value: me.bio ? me.bio.slice(0, 22) + (me.bio.length > 22 ? '…' : '') : 'Add', chevron: true, onClick: async () => { const v = await promptDialog({ title: 'About', value: me.bio, multiline: true, maxlength: 200, placeholder: 'Available' }); if (v !== null) save({ bio: v }); } }),
        cell({ icon: 'link', color: '#34c759', label: 'Share my invite link', sub: inviteUrl.replace(/^https?:\/\//, ''), onClick: () => shareLink(inviteUrl, me) })),

      h('div', { class: 'group-label' }, 'Account'),
      h('div', { class: 'group' },
        cell({ icon: 'user', color: '#5856d6', label: 'Username', value: '@' + me.username, chevron: true, onClick: changeUsername }),
        signInCell('google', '#ffffff', 'Google', GOOGLE_LOGO),
        cell({ icon: 'key', color: '#8e8e93', label: 'Password', value: me.hasPassword ? 'Change' : 'Set', chevron: true, onClick: changePassword }),
        cell({ icon: 'star', color: '#ff2d55', label: 'Birthday', value: me.birth ? new Date(me.birth + 'T12:00:00').toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' }) : 'Add', chevron: true, onClick: changeBirthday })),
      h('div', { class: 'group-foot' }, 'Sign in with Google or your username and password. Friends only ever see that it’s your birthday today — never the date.'),

      h('div', { class: 'group' },
        cell({ icon: 'sparkle', color: '#111111', label: 'Features', sub: 'Turn advanced features on or off', chevron: true, onClick: openFeatures })),

      h('div', { class: 'group-label' }, 'Safety & security'),
      h('div', { class: 'group' },
        cell({ icon: 'users', color: '#34c759', label: 'Trusted contacts', value: `${(me.settings.trusted || []).length}/5`, chevron: true, onClick: () => openTrusted(draw) }),
        cell({ icon: 'lock', color: '#5856d6', label: 'App lock', value: lockEnabled() ? (hasDuress() ? 'On · duress PIN' : 'On') : 'Off', chevron: true, onClick: () => openAppLock(draw) }),
        cell({ icon: 'shield', color: '#ff9500', label: 'Account recovery requests', chevron: true, onClick: () => openRecoveryRequests() }),
        S.config.inviteOnly ? cell({ icon: 'key', color: '#c9a227', label: 'Golden Keys', sub: 'Your 3 invites', chevron: true, onClick: openInvites }) : null),
      h('div', { class: 'group-foot' }, 'Trusted contacts receive your SOS alerts and can help you recover your account (3 of them must approve).'),

      h('div', { class: 'group-label' }, 'Notifications'),
      h('div', { class: 'group' },
        cell({ icon: 'bell', color: '#ff3b30', label: 'Push notifications', sub: notifStatus(), onClick: () => setupPush(true).then(draw) }),
        cell({ icon: 'eye', color: '#ff9500', label: 'Show previews', right: toggle(me.settings.previews, (v) => setPriv('previews', v)) }),
        cell({ icon: 'vol', color: '#ff2d55', label: 'In-app sounds', right: toggle(p.sounds, (v) => store.set('sounds', v)) })),

      h('div', { class: 'group-label' }, 'Privacy'),
      h('div', { class: 'group' },
        cell({ icon: 'check', color: '#0a84ff', label: 'Send read receipts', right: toggle(me.settings.readReceipts, (v) => setPriv('readReceipts', v)) }),
        cell({ icon: 'dots', color: '#5856d6', label: 'Show typing indicator', right: toggle(me.settings.typing, (v) => setPriv('typing', v)) }),
        cell({ icon: 'clock', color: '#34c759', label: 'Show online & last seen', right: toggle(me.settings.lastSeen, (v) => setPriv('lastSeen', v)) }),
        cell({ icon: 'ban', color: '#ff3b30', label: 'Blocked contacts', chevron: true, onClick: openBlocked })),
      h('div', { class: 'group-foot' }, 'If read receipts are off, you won’t send them — people will only see “Delivered”.'),

      h('div', { class: 'group-label' }, 'Calls'),
      h('div', { class: 'group' },
        selectCell('video', '#34c759', 'Video quality', 'callQuality', 'auto', [['auto', 'Auto (up to 4K)'], ['uhd', '4K Ultra HD'], ['fhd', '1080p Full HD'], ['hd', '720p HD'], ['saver', 'Data saver']]),
        selectCell('chart', '#30b0c7', 'Video codec', 'callCodec', 'auto', [['auto', 'Auto (best for device)'], ['vp9', 'VP9'], ['av1', 'AV1 (best compression)'], ['h264', 'H.264 (hardware)']]),
        cell({ icon: 'mic', color: '#ff9500', label: 'Noise suppression', right: toggle(store.get('noiseSuppression', true), (v) => store.set('noiseSuppression', v)) })),
      h('div', { class: 'group-foot' }, 'Calls are peer-to-peer and encrypted in transit (DTLS-SRTP). Auto asks your camera for 4K and adapts to your network — on a weak connection it steps down smoothly instead of freezing.'),

      h('div', { class: 'group-label' }, 'Appearance'),
      h('div', { class: 'group' },
        selectCell('moon', '#5856d6', 'Theme', 'theme', 'auto', [['auto', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']], applyPrefs),
        selectCell('text', '#8e8e93', 'Text size', 'fontSize', 17, [[15, 'Small'], [17, 'Default'], [19, 'Large'], [21, 'Extra large']], () => { applyPrefs(); renderMessages(); }),
        h('div', { class: 'cell ic', style: { cursor: 'default' } }, h('span', { class: 'ci', style: { background: 'var(--me)' } }, icon('palette')), h('span', { class: 'lb' }, 'Bubble color')),
        h('div', { class: 'swatches' }, Object.entries(BUBBLES).map(([k, [a, b]]) => h('button', {
          class: p.bubble === k ? 'on' : '', 'aria-label': k, style: { background: `linear-gradient(${a}, ${b})` },
          onclick: () => { store.set('bubble', k); applyPrefs(); draw(); },
        })))),

      h('div', { class: 'group-label' }, 'Chats'),
      h('div', { class: 'group' },
        cell({ icon: 'send', label: 'Enter key sends', right: toggle(p.enterSend, (v) => store.set('enterSend', v)) }),
        cell({ icon: 'image', color: '#34c759', label: 'Send photos in HD by default', right: toggle(store.get('sendHD', false), (v) => store.set('sendHD', v)) })),

      h('div', { class: 'group-label' }, 'Security'),
      h('div', { class: 'group' },
        cell({ icon: 'device', color: '#0a84ff', label: 'Active devices', chevron: true, onClick: openSessions })),
      h('div', { class: 'group-foot' }, 'All messages, names, photos and files are encrypted with AES-256-GCM before being stored. Passwords are hashed with scrypt.'),

      h('div', { class: 'group' },
        !isStandalone() ? cell({ icon: 'download', color: '#0a84ff', label: 'Add Ping Me to Home Screen', onClick: () => { s.close(); showInstallGate({ force: true }); } }) : null,
        cell({ icon: 'logout', color: '#8e8e93', label: 'Sign out', onClick: async () => { if (await confirmDialog('Sign out of Ping Me on this device?', { ok: 'Sign Out', danger: true })) logout(); } }),
        cell({ icon: 'trash', color: '#ff3b30', label: 'Delete account', danger: true, onClick: deleteAccount })),
      h('div', { class: 'muted small center', style: { margin: '10px 0 20px' } }, 'Ping Me · v1.0'));
  };

  function signInCell(provider, color, label, logo) {
    const link = S.me.links?.find((l) => l.provider === provider);
    return cell({
      iconHtml: logo, color, label,
      sub: link ? (link.email || 'Linked') : null,
      value: link ? 'Linked' : 'Link', chevron: true,
      onClick: () => (link ? unlink(provider, label) : linkProvider(provider)),
    });
  }

  async function unlink(provider, label) {
    if (!(await confirmDialog(`Stop signing in with ${label}?`, { ok: 'Unlink', danger: true }))) return;
    try { const { user: u } = await api('DELETE', `/api/me/links/${provider}`); S.me = u; draw(); } catch (e) { err(e); }
  }

  function linkProvider() {
    const box = h('div', { class: 'gbtn', style: { margin: '10px 0 16px' } });
    openSheet({ title: 'Link Google', left: { label: 'Cancel' }, body: h('div', null, h('p', { class: 'muted small' }, 'Choose the Google account you want to use to sign in to Ping Me.'), box) });
    googleButton(box, { link: true });
  }

  function selectCell(ic, color, label, key, def, options, after) {
    const sel = h('select', { 'aria-label': label }, options.map(([v, l]) => h('option', { value: v }, l)));
    sel.value = String(store.get(key, def));
    sel.onchange = () => { store.set(key, typeof def === 'number' ? Number(sel.value) : sel.value); after?.(); };
    return h('label', { class: 'cell ic' }, h('span', { class: 'ci', style: { background: color } }, icon(ic)), h('span', { class: 'lb' }, label), sel);
  }

  async function save(body) {
    try { const { user: u } = await api('PATCH', '/api/me', body); refreshMe(u); draw(); } catch (e) { err(e); }
  }

  async function changeAvatar() {
    const choice = S.me.avatarV ? await actionSheet({ actions: [{ label: 'Choose photo', value: 'pick' }, { label: 'Remove photo', value: 'rm', danger: true }] }) : 'pick';
    if (choice === 'rm') return save({ avatar: null });
    if (choice !== 'pick') return;
    const f = await pickFile('image/*');
    if (!f) return;
    try { save({ avatar: await avatarDataUrl(f) }); } catch { toast('Could not read that image', { error: true }); }
  }

  draw();
}

function notifStatus() {
  if (!('Notification' in window)) return isIOS() && !isStandalone() ? 'Add to Home Screen to enable' : 'Not supported';
  return { granted: 'On', denied: 'Blocked in system settings', default: 'Tap to turn on' }[Notification.permission];
}

function changeUsername() {
  const uf = usernameField({ value: S.me.username, nameSource: () => S.me.name, autofocus: true });
  openSheet({
    title: 'Username', left: { label: 'Cancel' },
    right: { label: 'Save', onClick: async (close) => {
      const v = uf.input.value.trim().toLowerCase();
      if (v === S.me.username) return close();
      try {
        const { user: u } = await api('POST', '/api/me/username', { username: v });
        refreshMe({ ...S.me, ...u });
        toast(`Your username is now @${u.username}`);
        close();
      } catch (e) { err(e); }
    } },
    body: h('div', null, uf.el, h('p', { class: 'muted small' }, 'Your old invite link stops working. Look-alike names (dots, underscores, 0/o, 1/l) count as the same username.')),
  });
}

async function changeBirthday() {
  const input = h('input', { class: 'field date', type: 'date', value: S.me.birth || '', max: new Date().toISOString().slice(0, 10) });
  openSheet({
    title: 'Birthday', left: { label: 'Cancel' },
    right: { label: 'Save', onClick: async (close) => {
      try { const { user: u } = await api('PATCH', '/api/me', { birth: input.value }); refreshMe(u); window.dispatchEvent(new Event('mm:me-changed')); close(); } catch (e) { err(e); }
    } },
    body: h('div', null, input, h('p', { class: 'muted small' }, 'Used to wish you a happy birthday. Friends only ever see that it’s your birthday today.')),
  });
}

async function shareLink(url, me, text) {
  const data = { title: 'Ping Me', text: text || `Chat with me (${me.name}) on Ping Me`, url };
  if (navigator.share) { try { await navigator.share(data); return; } catch (e) { if (e.name === 'AbortError') return; } }
  await navigator.clipboard?.writeText(url);
  toast('Invite link copied');
}

async function openBlocked() {
  const s = openSheet({ title: 'Blocked', left: { label: 'Back' } });
  const draw = async () => {
    const { users } = await api('GET', '/api/blocks');
    s.body.replaceChildren(users.length
      ? h('div', { class: 'group' }, users.map((u) => h('div', { class: 'user-row' },
        avatar({ id: u.id, name: u.name, src: userAvatar(u.id), size: 40 }),
        h('div', { class: 't' }, h('b', null, u.name), h('small', null, u.username ? '@' + u.username : '')),
        h('button', { class: 'link', onclick: async () => { await api('DELETE', `/api/blocks/${u.id}`); S.blocked.delete(u.id); draw(); renderHeader(); } }, 'Unblock'))))
      : h('div', { class: 'empty-list' }, 'No blocked contacts'));
  };
  draw().catch(err);
}

async function openSessions() {
  const s = openSheet({ title: 'Active devices', left: { label: 'Back' } });
  try {
    const { sessions } = await api('GET', '/api/me/sessions');
    const label = (ua) => {
      if (!ua) return 'Unknown device';
      const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Device';
      const br = /Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
      return `${br} on ${os}`;
    };
    s.body.replaceChildren(
      h('div', { class: 'group' }, sessions.map((x) => cell({ icon: 'device', color: x.current ? '#34c759' : '#8e8e93', label: label(x.ua), sub: x.current ? 'This device' : `Last active ${new Date(x.lastUsed).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}` }))),
      sessions.length > 1 ? h('div', { class: 'group' }, cell({ label: 'Sign out all other devices', danger: true, onClick: async () => {
        if (!(await confirmDialog('Sign out all other devices?', { ok: 'Sign Out', danger: true }))) return;
        await api('POST', '/api/me/sessions/logout-others'); toast('Other devices signed out'); s.close();
      } })) : null);
  } catch (e) { err(e); }
}

async function changePassword() {
  let current = '';
  if (S.me.hasPassword) {
    current = await promptDialog({ title: 'Current password', type: 'password', ok: 'Next' });
    if (!current) return;
  }
  const next = await promptDialog({ title: S.me.hasPassword ? 'New password' : 'Set a password', type: 'password', note: 'At least 8 characters. Other devices will be signed out.' });
  if (!next) return;
  try {
    const { user: u } = await api('POST', '/api/me/password', { current, next });
    S.me = u;
    window.dispatchEvent(new Event('mm:me-changed'));
    toast(current ? 'Password changed' : 'Password set — you can now also sign in with your username');
  } catch (e) { err(e); }
}

async function deleteAccount() {
  if (!(await confirmDialog('Permanently delete your account? Your profile is removed and you leave all conversations. This cannot be undone.', { ok: 'Delete Account', danger: true }))) return;
  let body;
  if (S.me.hasPassword) {
    const password = await promptDialog({ title: 'Confirm with password', type: 'password', ok: 'Delete' });
    if (!password) return;
    body = { password };
  } else {
    const confirm = await promptDialog({ title: 'Type your username to confirm', placeholder: S.me.username, ok: 'Delete' });
    if (!confirm) return;
    body = { confirm };
  }
  try { await api('DELETE', '/api/me', body); location.href = '/'; } catch (e) { err(e); }
}

// ═══════════════════════════ new message / groups ═══════════════════════════

function contacts() {
  const ids = new Set();
  for (const c of S.chats.values()) for (const m of c.members) if (m.id !== S.me.id) ids.add(m.id);
  return [...ids].map((id) => user(id)).filter((u) => !u.deleted).sort((a, b) => a.name.localeCompare(b.name));
}

async function lookup(username) {
  const { user: u } = await api('GET', '/api/users/lookup?u=' + encodeURIComponent(username.trim().replace(/^@/, '')));
  mergeUsers([u]);
  return u;
}

export function openNewMessage() {
  const s = openSheet({ title: 'New Message', left: { label: 'Cancel' }, full: true });
  const input = h('input', { class: 'inl', placeholder: 'username', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'search' });
  const result = h('div');
  const find = async () => {
    const v = input.value.trim();
    if (!v) return;
    result.replaceChildren(h('div', { class: 'loader' }, h('div', { class: 'spinner' })));
    try {
      const u = await lookup(v);
      if (u.id === S.me.id) { result.replaceChildren(h('div', { class: 'empty-list' }, 'That’s you')); return; }
      result.replaceChildren(h('div', { class: 'group' }, h('div', { class: 'user-row' },
        avatar({ id: u.id, name: u.name, src: userAvatar(u.id), size: 40 }),
        h('div', { class: 't' }, h('b', null, u.name), h('small', null, '@' + u.username)),
        h('button', { class: 'link', onclick: () => { s.close(); startDirect(u).catch(err); } }, 'Message'))));
    } catch (e) { result.replaceChildren(h('div', { class: 'empty-list' }, e.message)); }
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') find(); });
  const people = contacts();
  s.body.append(
    h('div', { class: 'group' }, h('label', { class: 'cell' }, h('span', { class: 'muted' }, 'To: @'), input, h('button', { class: 'link', onclick: find }, 'Find'))),
    result,
    h('div', { class: 'group' },
      cell({ icon: 'users', color: '#34c759', label: 'New Group', chevron: true, onClick: () => { s.close(); openNewGroup(); } }),
      cell({ icon: 'link', color: '#0a84ff', label: 'Invite a friend', sub: 'Share your Ping Me link', onClick: () => shareLink(`${location.origin}/?add=${S.me.username}`, S.me) })),
    people.length ? h('div', { class: 'group-label' }, 'Contacts') : null,
    people.length ? h('div', { class: 'group' }, people.map((u) => h('div', { class: 'user-row', style: { cursor: 'pointer' }, onclick: () => { s.close(); startDirect(u).catch(err); } },
      avatar({ id: u.id, name: u.name, src: userAvatar(u.id), size: 40, online: u.online }),
      h('div', { class: 't' }, h('b', null, u.name), h('small', null, u.username ? '@' + u.username : ''))))) : null);
  setTimeout(() => input.focus(), 350);
}

function openNewGroup() {
  const picked = new Map();
  const title = h('input', { class: 'inl', placeholder: 'Group name (optional)', maxlength: 80 });
  const add = h('input', { class: 'inl', placeholder: 'Add by username', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false' });
  const chips = h('div', { class: 'chips' });
  const list = h('div');
  const s = openSheet({
    title: 'New Group', left: { label: 'Cancel' }, full: true,
    right: { label: 'Create', onClick: async (close) => {
      if (!picked.size) return toast('Add at least one person');
      try {
        const { chat, users } = await api('POST', '/api/chats', { type: 'group', title: title.value.trim(), memberIds: [...picked.keys()] });
        mergeUsers(users);
        S.chats.set(chat.id, chat);
        close(); renderList(); openChat(chat.id);
      } catch (e) { err(e); }
    } },
  });
  const draw = () => {
    chips.replaceChildren(...[...picked.values()].map((u) => h('span', { class: 'chip' }, u.name, h('button', { 'aria-label': 'Remove', onclick: () => { picked.delete(u.id); draw(); } }, icon('x')))));
    chips.hidden = !picked.size;
    const people = contacts();
    list.replaceChildren(people.length ? h('div', { class: 'group' }, people.map((u) => h('div', { class: 'user-row', style: { cursor: 'pointer' }, onclick: () => { if (picked.has(u.id)) picked.delete(u.id); else picked.set(u.id, u); draw(); } },
      avatar({ id: u.id, name: u.name, src: userAvatar(u.id), size: 40 }),
      h('div', { class: 't' }, h('b', null, u.name), h('small', null, u.username ? '@' + u.username : '')),
      picked.has(u.id) ? h('span', { style: { color: 'var(--accent)' } }, icon('check')) : null))) : '');
  };
  const addUser = async () => {
    const v = add.value.trim();
    if (!v) return;
    try { const u = await lookup(v); if (u.id !== S.me.id) picked.set(u.id, u); add.value = ''; draw(); } catch (e) { err(e); }
  };
  add.addEventListener('keydown', (e) => { if (e.key === 'Enter') addUser(); });
  s.body.append(
    h('div', { class: 'group' }, h('div', { class: 'cell' }, title)),
    h('div', { class: 'group' }, h('div', { class: 'cell' }, add, h('button', { class: 'link', onclick: addUser }, 'Add')), chips),
    h('div', { class: 'group-label' }, 'Contacts'), list);
  draw();
}

// ═══════════════════════════ chat info ═══════════════════════════

export function muteMenu(chat) {
  return actionSheet({
    title: isMuted(chat) ? 'Notifications are muted' : 'Mute notifications',
    actions: isMuted(chat) ? [{ label: 'Unmute', value: 0 }] : [
      { label: 'For 1 hour', value: 3600e3 }, { label: 'For 8 hours', value: 8 * 3600e3 }, { label: 'For 1 week', value: 7 * 86400e3 }, { label: 'Always', value: -1 },
    ],
  }).then(async (v) => {
    if (v === null) return;
    const until = v === 0 ? 0 : v === -1 ? -1 : Date.now() + v;
    chat.mutedUntil = until;
    await api('PATCH', `/api/chats/${chat.id}/prefs`, { mutedUntil: until });
    renderList(); renderHeader();
  });
}

export function openChatInfo(chatId) {
  const s = openSheet({ title: 'Details', full: true, left: { label: 'Done' } });
  let tab = 'media';
  let media = null;
  const draw = () => {
    const chat = S.chats.get(chatId);
    if (!chat) return s.close();
    const group = chat.type === 'group';
    const other = otherMember(chat);
    const u = other ? user(other) : null;
    const meRole = chat.members.find((m) => m.id === S.me.id)?.role;
    const blocked = other && S.blocked.has(other);
    s.body.replaceChildren(
      h('div', { class: 'profile-top' },
        h('button', { onclick: group ? () => changeGroupPhoto(chat) : null }, avatar({ id: group ? chat.id : other, name: chatTitle(chat), src: chatAvatar(chat), size: 96, group })),
        group ? h('button', { class: 'link small', onclick: () => changeGroupPhoto(chat) }, chat.avatarV ? 'Change photo' : 'Add photo') : null,
        h('h3', null, chatTitle(chat)),
        u ? h('div', { class: 'u' }, u.username ? '@' + u.username : '', u.online ? ' · Online' : lastSeenText(u) ? ' · ' + lastSeenText(u) : '') : h('div', { class: 'u' }, `${chat.members.length} members`),
        u?.bio ? h('div', { class: 'bio' }, u.bio) : null),
      h('div', { class: 'quick' },
        h('button', { onclick: () => { s.close(); S.calls.start(chat.id, false); }, disabled: blocked }, icon('phone'), 'Audio'),
        h('button', { onclick: () => { s.close(); S.calls.start(chat.id, true); }, disabled: blocked }, icon('video'), 'Video'),
        h('button', { onclick: () => muteMenu(chat).then(draw) }, icon(isMuted(chat) ? 'bell' : 'belloff'), isMuted(chat) ? 'Unmute' : 'Mute'),
        h('button', { onclick: () => searchInChat(chat, s) }, icon('search'), 'Search')),

      group && feature('groupPets') ? petCard(chat) : null,
      feature('wrapped') ? h('div', { class: 'group' }, cell({ icon: 'star', color: '#111111', label: 'Chat Wrapped', sub: 'Your month & year together, as a shareable card', chevron: true, onClick: () => openWrapped(chat) })) : null,

      group ? h('div', { class: 'group' },
        cell({ icon: 'edit', label: 'Group name', value: chat.title || 'Add', chevron: true, onClick: async () => {
          const v = await promptDialog({ title: 'Group name', value: chat.title === 'Group' ? '' : chat.title, maxlength: 80 });
          if (v !== null) { await api('PATCH', `/api/chats/${chat.id}`, { title: v }).catch(err); await refreshChat(chat.id); draw(); }
        } })) : null,

      group ? h('div', { class: 'group-label' }, `${chat.members.length} members`) : null,
      group ? h('div', { class: 'group' },
        chat.members.map((m) => { const mu = user(m.id); return h('div', { class: 'user-row', style: { cursor: 'pointer' }, onclick: () => memberMenu(chat, m, meRole).then(draw) },
          avatar({ id: m.id, name: mu.name, src: userAvatar(m.id), size: 40, online: mu.online }),
          h('div', { class: 't' }, h('b', null, m.id === S.me.id ? `${mu.name} (You)` : mu.name), h('small', null, mu.username ? '@' + mu.username : '')),
          m.role === 'admin' ? h('span', { class: 'tag' }, 'Admin') : null); }),
        cell({ icon: 'useradd', label: 'Add people', accent: true, onClick: () => addMembers(chat).then(draw) })) : null,

      h('div', { class: 'group' },
        cell({ icon: 'timer', color: '#5856d6', label: 'Disappearing messages', value: disappearLabel(chat.disappearSecs), chevron: true, onClick: async () => {
          const opts = [0, -1, 30, 300, 3600, 86400, 604800, 7776000];
          const v = await actionSheet({ title: 'New messages disappear after this time. “After read” removes each message once it’s read — longer messages stay a little longer.', actions: opts.map((x) => ({ label: disappearLabel(x) + (x === chat.disappearSecs ? ' ✓' : ''), value: String(x) })) });
          if (v !== null) { await api('PATCH', `/api/chats/${chat.id}`, { disappearSecs: Number(v) }).catch(err); await refreshChat(chat.id); draw(); }
        } }),
        cell({ icon: 'pin', color: '#ff9500', label: 'Pinned messages', chevron: true, onClick: () => openPinned(chat) }),
        cell({ icon: 'pin', color: '#8e8e93', label: chat.pinned ? 'Unpin conversation' : 'Pin conversation', onClick: async () => { chat.pinned = !chat.pinned; await api('PATCH', `/api/chats/${chat.id}/prefs`, { pinned: chat.pinned }); renderList(); draw(); } })),

      h('div', { class: 'tabs' }, [['media', 'Photos'], ['files', 'Files'], ['links', 'Links'], ['voice', 'Voice']].map(([k, l]) => h('button', { class: tab === k ? 'on' : '', onclick: () => { tab = k; draw(); } }, l))),
      mediaSection(),

      h('div', { class: 'group' },
        !group && other ? cell({ icon: 'ban', color: '#ff3b30', label: blocked ? `Unblock ${u.name}` : `Block ${u.name}`, danger: !blocked, onClick: async () => {
          if (blocked) { await api('DELETE', `/api/blocks/${other}`); S.blocked.delete(other); }
          else { if (!(await confirmDialog(`Block ${u.name}? They won’t be able to message or call you.`, { ok: 'Block', danger: true }))) return; await api('POST', `/api/blocks/${other}`); S.blocked.add(other); }
          renderHeader(); refreshChat(chat.id); draw();
        } }) : null,
        cell({ icon: 'trash', color: '#ff9500', label: 'Clear chat history', onClick: async () => {
          if (!(await confirmDialog('Clear all messages in this conversation on your devices?', { ok: 'Clear', danger: true }))) return;
          await api('POST', `/api/chats/${chat.id}/clear`); S.msgs.delete(chat.id); s.close(); openChat(chat.id);
        } }),
        group ? cell({ icon: 'logout', color: '#ff3b30', label: 'Leave this conversation', danger: true, onClick: async () => {
          if (!(await confirmDialog('Leave this group? You won’t get new messages.', { ok: 'Leave', danger: true }))) return;
          await api('DELETE', `/api/chats/${chat.id}/members/${S.me.id}`).catch(err); s.close(); S.chats.delete(chat.id); closeChat();
        } }) : cell({ icon: 'trash', color: '#ff3b30', label: 'Delete conversation', danger: true, onClick: async () => { s.close(); await deleteConversation(chat); } })));
  };

  function mediaSection() {
    if (!media) return h('div', { class: 'loader' }, h('div', { class: 'spinner' }));
    const items = media[tab] || [];
    if (!items.length) return h('div', { class: 'empty-list', style: { padding: '24px' } }, 'Nothing here yet');
    if (tab === 'media') return h('div', { class: 'grid-media' }, items.slice(0, 120).map((m) => h('div', { onclick: () => openViewer(m, items) },
      m.kind === 'image' ? h('img', { src: fileUrl(m.att), loading: 'lazy', alt: '' }) : h('video', { src: fileUrl(m.att) + '#t=0.1', preload: 'metadata', muted: true, playsinline: true }),
      m.kind === 'video' ? h('span', { class: 'vbadge' }, '▶ ' + fmtDur(m.att?.dur || 0)) : null)));
    if (tab === 'links') return h('div', { class: 'group' }, items.slice(0, 100).map((l) => h('a', { class: 'cell', href: l.url, target: '_blank', rel: 'noopener noreferrer' }, h('span', { class: 'lb' }, l.url.replace(/^https?:\/\//, '').slice(0, 60), h('small', null, `${user(l.senderId).name} · ${new Date(l.createdAt).toLocaleDateString()}`)))));
    return h('div', { class: 'group' }, items.slice(0, 100).map((m) => cell({
      icon: tab === 'voice' ? 'mic' : 'file', color: tab === 'voice' ? '#ff9500' : '#8e8e93',
      label: tab === 'voice' ? `Voice message · ${fmtDur(m.att?.dur || 0)}` : m.att?.name || 'File',
      sub: `${user(m.senderId).name} · ${new Date(m.createdAt).toLocaleDateString()}${m.att?.size ? ' · ' + fmtSize(m.att.size) : ''}`,
      onClick: () => { s.close(); openChat(chatId, { around: m.id }); },
    })));
  }

  api('GET', `/api/chats/${chatId}/media`).then((r) => { media = r; draw(); }).catch(() => { media = {}; draw(); });
  draw();
}

async function changeGroupPhoto(chat) {
  const f = await pickFile('image/*');
  if (!f) return;
  try { await api('PATCH', `/api/chats/${chat.id}`, { avatar: await avatarDataUrl(f) }); await refreshChat(chat.id); } catch (e) { err(e); }
}

async function memberMenu(chat, m, meRole) {
  if (m.id === S.me.id) return;
  const u = user(m.id);
  const isAdmin = meRole === 'admin';
  const r = await actionSheet({
    title: u.name, align: 'left',
    actions: [
      { label: 'View profile', icon: 'user', value: 'profile' },
      { label: 'Message', icon: 'msg', value: 'msg' },
      isAdmin ? { label: m.role === 'admin' ? 'Remove as admin' : 'Make admin', icon: 'shield', value: 'admin' } : null,
      isAdmin ? { label: 'Remove from group', icon: 'trash', value: 'remove', danger: true } : null,
    ],
  });
  try {
    if (r === 'profile') openUserProfile(m.id);
    if (r === 'msg') { closeAllAnd(() => startDirect(u)); }
    if (r === 'admin') { await api('POST', `/api/chats/${chat.id}/admins/${m.id}`, { admin: m.role !== 'admin' }); await refreshChat(chat.id); }
    if (r === 'remove' && (await confirmDialog(`Remove ${u.name} from the group?`, { ok: 'Remove', danger: true }))) { await api('DELETE', `/api/chats/${chat.id}/members/${m.id}`); await refreshChat(chat.id); }
  } catch (e) { err(e); }
}

function closeAllAnd(fn) {
  document.querySelectorAll('#layer > *').forEach((n) => n.remove());
  fn();
}

async function addMembers(chat) {
  const v = await promptDialog({ title: 'Add by username', placeholder: 'username', ok: 'Add' });
  if (!v) return;
  try {
    const u = await lookup(v);
    await api('POST', `/api/chats/${chat.id}/members`, { userIds: [u.id] });
    await refreshChat(chat.id);
    toast(`${u.name} added`);
  } catch (e) { err(e); }
}

async function searchInChat(chat, infoSheet) {
  const q = await promptDialog({ title: 'Search in conversation', placeholder: 'Search messages', ok: 'Search' });
  if (!q || q.trim().length < 2) return;
  const { results } = await api('GET', `/api/search?chatId=${chat.id}&q=${encodeURIComponent(q.trim())}`).catch((e) => { err(e); return { results: [] }; });
  const s = openSheet({ title: `${results.length} result${results.length === 1 ? '' : 's'}`, left: { label: 'Back' }, full: true });
  s.body.append(results.length ? h('div', { class: 'group' }, results.map((r) => cell({
    label: r.preview, sub: `${r.senderId === S.me.id ? 'You' : user(r.senderId).name} · ${new Date(r.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`,
    onClick: () => { s.close(); infoSheet.close(); jumpTo(r.id); },
  }))) : h('div', { class: 'empty-list' }, 'No messages found'));
}

async function openPinned(chat) {
  const s = openSheet({ title: 'Pinned', left: { label: 'Back' }, full: true });
  const { messages } = await api('GET', `/api/chats/${chat.id}/pinned`).catch(() => ({ messages: [] }));
  s.body.append(messages.length ? h('div', { class: 'group' }, messages.map((m) => cell({
    icon: 'pin', color: '#ff9500', label: m.preview, sub: `${m.senderId === S.me.id ? 'You' : user(m.senderId).name} · ${new Date(m.createdAt).toLocaleDateString()}`,
    onClick: () => { closeAllAnd(() => openChat(chat.id, { around: m.id })); },
  }))) : h('div', { class: 'empty-list' }, 'No pinned messages. Long-press a message and tap Pin.'));
}

export function openUserProfile(userId) {
  const u = user(userId);
  const s = openSheet({ title: '', left: { label: 'Close' } });
  s.body.append(
    h('div', { class: 'profile-top' }, avatar({ id: u.id, name: u.name, src: userAvatar(u.id), size: 96, online: u.online }),
      h('h3', null, u.name), h('div', { class: 'u' }, u.username ? '@' + u.username : ''), u.bio ? h('div', { class: 'bio' }, u.bio) : null,
      h('div', { class: 'muted small' }, lastSeenText(u))),
    h('div', { class: 'quick', style: { gridTemplateColumns: 'repeat(3, 1fr)' } },
      h('button', { onclick: () => closeAllAnd(() => startDirect(u)) }, icon('msg'), 'Message'),
      h('button', { onclick: () => closeAllAnd(async () => { await startDirect(u); S.calls.start(S.current, false); }) }, icon('phone'), 'Audio'),
      h('button', { onclick: () => closeAllAnd(async () => { await startDirect(u); S.calls.start(S.current, true); }) }, icon('video'), 'Video')));
}

// ═══════════════════════════ media viewer ═══════════════════════════

export function openViewer(m, list = null) {
  const items = list || (S.msgs.get(m.chatId)?.list || []).filter((x) => (x.kind === 'image' || x.kind === 'video') && !x.deleted && !x.pending);
  let idx = Math.max(0, items.findIndex((x) => x.id === m.id));
  const body = h('div', { class: 'vb' });
  const title = h('div', { class: 't' });
  const cap = h('div', { class: 'cap', hidden: true });
  let scale = 1, tx = 0, ty = 0;
  const root = h('div', { class: 'viewer', role: 'dialog' },
    h('div', { class: 'vh' },
      h('button', { 'aria-label': 'Close', onclick: () => close() }, icon('x')),
      title,
      h('button', { 'aria-label': 'Share', onclick: () => share() }, icon('share')),
      h('button', { 'aria-label': 'Forward', onclick: () => { close(); openForward(items[idx]); } }, icon('fwd')),
      h('a', { 'aria-label': 'Download', style: { color: '#fff', width: '40px', height: '40px', display: 'grid', placeItems: 'center' }, class: 'dl' }, icon('download'))),
    body, cap);
  const show = () => {
    const it = items[idx] || m;
    scale = 1; tx = 0; ty = 0;
    const src = fileUrl(it.att);
    const el = it.kind === 'video' ? h('video', { src, controls: true, autoplay: true, playsinline: true }) : h('img', { src, alt: it.att?.name || '' });
    body.replaceChildren(el);
    title.replaceChildren(it.senderId === S.me.id ? 'You' : user(it.senderId).name, h('small', null, new Date(it.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })));
    cap.hidden = !it.text; cap.textContent = it.text || '';
    const a = root.querySelector('.dl');
    a.href = `/api/files/${it.att.id}?dl=1`; a.setAttribute('download', it.att.name || 'file');
  };
  const apply = () => { const el = body.firstChild; if (el) el.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`; };
  const close = () => { root.remove(); document.removeEventListener('keydown', onKey); };
  const go = (d) => { if (items[idx + d]) { idx += d; show(); } };
  const onKey = (e) => { if (e.key === 'Escape') close(); if (e.key === 'ArrowRight') go(1); if (e.key === 'ArrowLeft') go(-1); };
  async function share() {
    const it = items[idx];
    try {
      const blob = await fetch(`/api/files/${it.att.id}`).then((r) => r.blob());
      const file = new File([blob], it.att.name || 'media', { type: blob.type });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file] });
      else toast('Sharing is not supported here — use download');
    } catch (e) { if (e.name !== 'AbortError') toast('Could not share', { error: true }); }
  }
  // gestures: double-tap zoom, drag to pan / swipe to navigate / swipe down to close, pinch zoom
  let pts = new Map(), start = null, lastTap = 0, pinch0 = null;
  body.addEventListener('pointerdown', (e) => {
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y), s: scale }; }
    start = { x: e.clientX, y: e.clientY, tx, ty, t: Date.now() };
    const now = Date.now();
    if (now - lastTap < 280 && items[idx]?.kind === 'image') { scale = scale > 1 ? 1 : 2.5; tx = ty = 0; apply(); lastTap = 0; } else lastTap = now;
  });
  body.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2 && pinch0) { const [a, b] = [...pts.values()]; scale = Math.min(5, Math.max(1, pinch0.s * Math.hypot(a.x - b.x, a.y - b.y) / pinch0.d)); apply(); return; }
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (scale > 1) { tx = start.tx + dx; ty = start.ty + dy; apply(); }
    else if (items[idx]?.kind === 'image') { body.firstChild.style.transform = `translate(${dx}px, ${Math.max(0, dy)}px)`; root.style.background = `rgba(0,0,0,${1 - Math.min(0.6, Math.max(0, dy) / 400)})`; }
  });
  const up = (e) => {
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch0 = null;
    if (!start || pts.size) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    start = null;
    if (scale > 1) return;
    root.style.background = '';
    if (items[idx]?.kind !== 'image') return;
    if (dy > 120 && Math.abs(dy) > Math.abs(dx)) return close();
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy)) return go(dx < 0 ? 1 : -1);
    if (body.firstChild) body.firstChild.style.transform = '';
  };
  body.addEventListener('pointerup', up);
  body.addEventListener('pointercancel', up);
  document.addEventListener('keydown', onKey);
  document.body.append(root);
  show();
}

// ═══════════════════════════ forward ═══════════════════════════

export function openForward(m) {
  const picked = new Set();
  const s = openSheet({
    title: 'Forward', left: { label: 'Cancel' }, full: true,
    right: { label: 'Send', onClick: async (close) => {
      if (!picked.size) return;
      close();
      const payload = { kind: m.kind, text: m.text || '', forwarded: true };
      if (m.att) { payload.attachmentId = m.att.id; payload.media = { w: m.att.w, h: m.att.h, dur: m.att.dur, wave: m.att.wave }; }
      if (m.loc) payload.loc = m.loc;
      for (const id of picked) await sendPayload(id, payload);
      toast(picked.size === 1 ? `Forwarded to ${chatTitle(S.chats.get([...picked][0]))}` : `Forwarded to ${picked.size} conversations`);
    } },
  });
  const draw = () => {
    s.rightBtn.style.opacity = picked.size ? '1' : '0.4';
    s.body.replaceChildren(h('div', { class: 'group' }, [...S.chats.values()].sort((a, b) => b.lastMsgAt - a.lastMsgAt).map((c) => h('div', { class: 'user-row', style: { cursor: 'pointer' }, onclick: () => { if (picked.has(c.id)) picked.delete(c.id); else picked.add(c.id); draw(); } },
      avatar({ id: c.type === 'group' ? c.id : otherMember(c), name: chatTitle(c), src: chatAvatar(c), size: 40, group: c.type === 'group' }),
      h('div', { class: 't' }, h('b', null, chatTitle(c))),
      picked.has(c.id) ? h('span', { style: { color: 'var(--accent)' } }, icon('check')) : null))));
  };
  draw();
}

// ═══════════════════════════ polls / schedule / effects ═══════════════════════════

export function openPoll(chatId) {
  const q = h('input', { class: 'inl', placeholder: 'Ask a question', maxlength: 300 });
  const opts = [];
  const optsWrap = h('div', { class: 'group' });
  let multi = false;
  const addOpt = (focus) => {
    if (opts.length >= 12) return;
    const i = h('input', { class: 'inl', placeholder: `Option ${opts.length + 1}`, maxlength: 100 });
    i.addEventListener('input', () => { if (i === opts[opts.length - 1] && i.value) addOpt(false); });
    opts.push(i);
    optsWrap.append(h('div', { class: 'cell' }, i));
    if (focus) i.focus();
  };
  addOpt(false); addOpt(false);
  openSheet({
    title: 'New Poll', left: { label: 'Cancel' },
    right: { label: 'Send', onClick: (close) => {
      const options = opts.map((o) => o.value.trim()).filter(Boolean);
      if (!q.value.trim() || options.length < 2) return toast('Add a question and at least 2 options');
      close();
      sendPayload(chatId, { kind: 'poll', poll: { q: q.value.trim(), opts: options, multi } });
    } },
    body: h('div', null,
      h('div', { class: 'group' }, h('div', { class: 'cell' }, q)),
      h('div', { class: 'group-label' }, 'Options'), optsWrap,
      h('div', { class: 'group' }, cell({ label: 'Allow multiple answers', right: toggle(false, (v) => (multi = v)) }))),
  });
  setTimeout(() => q.focus(), 350);
}

export function openSchedule() {
  const now = new Date();
  const at = (d, hh, mm = 0) => { const x = new Date(now); x.setDate(x.getDate() + d); x.setHours(hh, mm, 0, 0); return x.getTime(); };
  const presets = [
    ['In 1 hour', Date.now() + 3600e3],
    now.getHours() < 20 ? ['Tonight at 9:00 PM', at(0, 21)] : null,
    ['Tomorrow at 9:00 AM', at(1, 9)],
    ['Monday at 9:00 AM', at(((8 - now.getDay()) % 7) || 7, 9)],
  ].filter(Boolean);
  const local = new Date(Date.now() + 3600e3 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const input = h('input', { class: 'field', type: 'datetime-local', value: local, min: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) });
  openSheet({
    title: 'Send Later', left: { label: 'Cancel' },
    right: { label: 'Set', onClick: (close) => {
      const ts = new Date(input.value).getTime();
      if (!(ts > Date.now() + 10000)) return toast('Pick a time in the future');
      close(); setSendAt(ts);
    } },
    body: (close) => h('div', null,
      h('div', { class: 'group' }, presets.map(([l, ts]) => cell({ icon: 'clock', color: '#ff9500', label: l, onClick: () => { close(); setSendAt(ts); } }))),
      h('div', { class: 'group-label' }, 'Custom'), input,
      h('p', { class: 'muted small' }, 'Type your message, then tap send. It will be delivered automatically at this time — even if you’re offline.')),
  });
}

export async function openScheduledList(chatId, onChange) {
  const s = openSheet({ title: 'Scheduled', left: { label: 'Done' } });
  const draw = async () => {
    const { scheduled } = await api('GET', `/api/chats/${chatId}/scheduled`);
    s.body.replaceChildren(scheduled.length ? h('div', { class: 'group' }, scheduled.map((x) => h('div', { class: 'cell', style: { cursor: 'default' } },
      h('span', { class: 'lb' }, x.preview || x.text, h('small', null, new Date(x.sendAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }))),
      h('button', { class: 'link', style: { color: 'var(--red)' }, onclick: async () => { await api('DELETE', `/api/scheduled/${x.id}`); onChange?.(); draw(); } }, 'Cancel')))) : h('div', { class: 'empty-list' }, 'No scheduled messages'));
  };
  draw().catch(err);
}

export function openSendOptions(fromPlus = false) {
  const s = openSheet({ title: 'Send with effect', left: { label: 'Cancel' } });
  const pick = (opts) => { s.close(); send(opts); };
  s.body.append(
    h('div', { class: 'group-label' }, 'Bubble'),
    h('div', { class: 'group' }, Object.entries(BUBBLE_EFFECTS).map(([k, l]) => cell({ icon: 'sparkle', color: '#af52de', label: l, onClick: () => pick({ effect: k }) }))),
    h('div', { class: 'group-label' }, 'Screen'),
    h('div', { class: 'group' }, Object.entries(SCREEN_EFFECTS).map(([k, l]) => cell({ icon: 'star', color: '#ff9500', label: l, value: h('button', { class: 'link small', onclick: (e) => { e.stopPropagation(); playScreenEffect(k); } }, 'Preview'), onClick: () => pick({ effect: k }) }))),
    h('div', { class: 'group' },
      cell({ icon: 'belloff', color: '#8e8e93', label: 'Send silently', sub: 'No notification sound for the recipient', onClick: () => pick({ silent: true }) }),
      cell({ icon: 'clock', color: '#ff9500', label: 'Send later…', onClick: () => { s.close(); openSchedule(); } })),
    fromPlus ? h('p', { class: 'muted small' }, 'Tip: type your message first, or long-press the send button to open this menu.') : null);
}

const EMOJIS = '😀 😂 🥹 😍 🥰 😘 😎 🤩 🥳 😇 🙂 😉 😜 🤪 🤔 🫡 🤗 🤭 😴 😬 🙄 😮 😱 😭 😤 😡 🤯 🥺 😅 😏 🤝 👏 🙌 🙏 💪 👀 👍 👎 👌 ✌️ 🤞 🫶 ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 💯 🔥 ✨ ⭐️ 🎉 🎊 🎁 🎂 🍕 🍔 ☕️ 🍺 🍷 ⚽️ 🏆 🚀 ✈️ 🏖️ 🌈 ☀️ 🌙 ⚡️ 💡 📌 ✅ ❌ ‼️ ❓ 💤 🐶 🐱 🦄 🌹'.split(' ');
export function openEmojiPicker() {
  return new Promise((resolve) => {
    let chosen = null;
    const s = openSheet({ title: 'React', left: { label: 'Cancel' }, onClose: () => resolve(chosen) });
    s.body.append(h('div', { class: 'emoji-grid' }, EMOJIS.map((e) => h('button', { onclick: () => { chosen = e; s.close(); } }, e))));
  });
}

// ═══════════════════════════ message info ═══════════════════════════

export function openMessageInfo(m, focus) {
  const chat = S.chats.get(m.chatId);
  const s = openSheet({ title: focus === 'reactions' ? 'Reactions' : 'Message Info', left: { label: 'Done' } });
  const others = chat ? chat.members.filter((x) => x.id !== S.me.id) : [];
  const mine = m.senderId === S.me.id;
  s.body.append(
    h('div', { class: 'group' },
      cell({ label: 'Sent', value: new Date(m.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) }),
      m.editedAt ? cell({ label: 'Edited', value: new Date(m.editedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) }) : null,
      m.expiresAt ? cell({ label: 'Disappears', value: new Date(m.expiresAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) }) : null,
      m.att ? cell({ label: 'File', value: `${m.att.name || ''} ${m.att.size ? '· ' + fmtSize(m.att.size) : ''}` }) : null),
    m.reactions?.length ? h('div', { class: 'group-label' }, 'Reactions') : null,
    m.reactions?.length ? h('div', { class: 'group' }, m.reactions.map((r) => h('div', { class: 'user-row' },
      avatar({ id: r.userId, name: user(r.userId).name, src: userAvatar(r.userId), size: 36 }),
      h('div', { class: 't' }, h('b', null, r.userId === S.me.id ? 'You' : user(r.userId).name)),
      h('span', { style: { fontSize: '24px' } }, r.emoji)))) : null,
    mine && others.length && focus !== 'reactions' ? h('div', { class: 'group-label' }, 'Delivery') : null,
    mine && others.length && focus !== 'reactions' ? h('div', { class: 'group' }, others.map((o) => h('div', { class: 'user-row' },
      avatar({ id: o.id, name: user(o.id).name, src: userAvatar(o.id), size: 36 }),
      h('div', { class: 't' }, h('b', null, user(o.id).name)),
      h('span', { class: 'tag' }, o.lastRead >= m.id ? 'Read' : o.lastDelivered >= m.id ? 'Delivered' : 'Sent')))) : null,
    m.history?.length ? h('div', { class: 'group-label' }, 'Edit history') : null,
    m.history?.length ? h('div', { class: 'group' }, [...m.history].reverse().map((x) => cell({ label: x.text || '(empty)', sub: new Date(x.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) }))) : null);
}

// ═══════════════════════════ location ═══════════════════════════

export function sendLocation(chatId, replyTo) {
  if (!navigator.geolocation) return toast('Location is not available', { error: true });
  const close = toast('Getting your location…', { timeout: 15000 });
  navigator.geolocation.getCurrentPosition(async (pos) => {
    close();
    const { latitude: lat, longitude: lng, accuracy: acc } = pos.coords;
    const ok = await confirmDialog(`Share your current location (±${Math.round(acc)}m)?`, { ok: 'Send Location' });
    if (ok) sendPayload(chatId, { kind: 'location', loc: { lat, lng, acc }, replyTo });
  }, (e) => { close(); toast(e.code === 1 ? 'Allow location access to share your location' : 'Could not get your location', { error: true }); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
}

// ═══════════════════════════ features ═══════════════════════════

export function openFeatures() {
  const s = openSheet({ title: 'Features', full: true, left: { label: 'Done' } });
  const features = { ...(S.config.features || {}), ...(S.me.settings.features || {}) };
  let saveTimer = null;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try { const { user: u } = await api('PATCH', '/api/me', { settings: { features } }); S.me = u; renderMessages(); } catch (e) { err(e); }
    }, 300);
  };
  const draw = () => s.body.replaceChildren(
    h('p', { class: 'muted small', style: { margin: '0 4px 12px' } }, 'Tap a circle to see what each feature does. Switch off anything you don’t need.'),
    storyStrip(FEATURE_GROUPS, features, (k, v) => { features[k] = v; save(); draw(); }),
    ...featureList(features, (k, v) => { features[k] = v; save(); draw(); }).flat());
  draw();
}

// ═══════════════════════════ trusted contacts ═══════════════════════════

export function openTrusted(after) {
  const picked = new Set(S.me.settings.trusted || []);
  const s = openSheet({
    title: 'Trusted contacts', left: { label: 'Cancel' }, full: true,
    right: { label: 'Save', onClick: async (close) => {
      try { const { user: u } = await api('PATCH', '/api/me', { settings: { trusted: [...picked] } }); S.me = u; close(); after?.(); toast('Trusted contacts saved'); } catch (e) { err(e); }
    } },
  });
  const draw = () => {
    const people = contacts();
    s.body.replaceChildren(
      h('p', { class: 'muted small', style: { margin: '0 4px 14px' } }, `Pick up to 5 people. They get your SOS alerts, and 3 of them can approve recovering your account. ${picked.size}/5 selected.`),
      people.length ? h('div', { class: 'group' }, people.map((u) => h('div', { class: 'user-row', style: { cursor: 'pointer' }, onclick: () => {
        if (picked.has(u.id)) picked.delete(u.id); else if (picked.size < 5) picked.add(u.id); else return toast('You can pick up to 5');
        draw();
      } },
        avatar({ id: u.id, name: u.name, src: userAvatar(u.id), size: 40 }),
        h('div', { class: 't' }, h('b', null, u.name), h('small', null, u.username ? '@' + u.username : '')),
        picked.has(u.id) ? h('span', { class: 'check-on' }, icon('check')) : h('span', { class: 'check-off' })))) : h('div', { class: 'empty-list' }, 'Chat with someone first, then add them here.'));
  };
  draw();
}

// ═══════════════════════════ app lock ═══════════════════════════

async function askPin(title, note) {
  const v = await promptDialog({ title, type: 'password', placeholder: '4–6 digits', maxlength: 6, note });
  if (v === null) return null;
  if (!/^\d{4,6}$/.test(v)) { toast('PIN must be 4–6 digits', { error: true }); return null; }
  return v;
}

export function openAppLock(after) {
  const s = openSheet({ title: 'App lock', left: { label: 'Done' }, onClose: () => after?.() });
  const draw = () => {
    if (!lockEnabled()) {
      s.body.replaceChildren(
        h('p', { class: 'muted small', style: { margin: '0 4px 14px' } }, 'Ask for a PIN when Ping Me opens or after a minute in the background. The PIN stays on this device.'),
        h('div', { class: 'group' }, cell({ icon: 'lock', color: '#5856d6', label: 'Turn on app lock', onClick: async () => {
          const a = await askPin('Choose a PIN'); if (!a) return;
          const b = await askPin('Enter it again'); if (!b) return;
          if (a !== b) return toast('PINs didn’t match', { error: true });
          await setPin(a); toast('App lock is on'); draw();
        } })));
      return;
    }
    const hidden = hiddenChats();
    s.body.replaceChildren(
      h('div', { class: 'group' },
        cell({ icon: 'key', color: '#5856d6', label: 'Change PIN', onClick: async () => {
          const cur = await askPin('Current PIN'); if (!cur) return;
          if (!(await checkPin(cur))) return toast('Wrong PIN', { error: true });
          const a = await askPin('New PIN'); if (!a) return;
          await setPin(a); toast('PIN changed — set your duress PIN again if you used one'); draw();
        } }),
        cell({ icon: 'shield', color: '#ff9500', label: 'Duress PIN', value: hasDuress() ? 'Set' : 'Off', chevron: true, onClick: async () => {
          const a = await askPin('Duress PIN', 'A second PIN that opens Ping Me with your hidden chats removed — for when someone forces you to unlock.'); if (!a) return;
          try { await setDuressPin(a); toast('Duress PIN set'); draw(); } catch (e) { err(e); }
        } }),
        cell({ icon: 'eye', color: '#8e8e93', label: 'Chats hidden by duress PIN', value: String(hidden.size), chevron: true, onClick: () => pickHidden(draw) }),
        cell({ icon: 'x', color: '#ff3b30', label: 'Turn off app lock', danger: true, onClick: async () => {
          const cur = await askPin('Enter your PIN'); if (!cur) return;
          if (!(await checkPin(cur))) return toast('Wrong PIN', { error: true });
          disableLock(); toast('App lock is off'); draw();
        } })),
      h('div', { class: 'group-foot' }, 'With the duress PIN, hidden chats disappear from the list, search, badges and notifications until you unlock with your real PIN.'));
  };
  draw();
}

function pickHidden(after) {
  const picked = hiddenChats();
  const s = openSheet({ title: 'Hidden chats', left: { label: 'Cancel' }, full: true, right: { label: 'Save', onClick: (close) => { setHiddenChats([...picked]); close(); after?.(); } } });
  const draw = () => s.body.replaceChildren(h('div', { class: 'group' }, [...S.chats.values()].map((c) => h('div', { class: 'user-row', style: { cursor: 'pointer' }, onclick: () => { if (picked.has(c.id)) picked.delete(c.id); else picked.add(c.id); draw(); } },
    avatar({ id: c.type === 'group' ? c.id : otherMember(c), name: chatTitle(c), src: chatAvatar(c), size: 40, group: c.type === 'group' }),
    h('div', { class: 't' }, h('b', null, chatTitle(c))),
    picked.has(c.id) ? h('span', { class: 'check-on' }, icon('check')) : h('span', { class: 'check-off' })))));
  draw();
}

// ═══════════════════════════ Golden Keys ═══════════════════════════

export async function openInvites() {
  const s = openSheet({ title: 'Golden Keys', left: { label: 'Done' } });
  try {
    const { invites } = await api('GET', '/api/invites');
    s.body.append(
      h('p', { class: 'muted small', style: { margin: '0 4px 14px' } }, 'Ping Me is invite-only. You have 3 Golden Keys — give them to people you trust.'),
      h('div', { class: 'group' }, invites.map((i) => h('div', { class: 'cell', style: { cursor: 'default' } },
        h('span', { class: 'lb' }, h('code', { class: 'gk' + (i.usedBy ? ' used' : '') }, i.code), h('small', null, i.usedBy ? `Used by ${i.usedBy}` : 'Available')),
        i.usedBy ? null : h('button', { class: 'link', onclick: () => shareLink(location.origin, { name: S.me.name }, `Here’s a Golden Key to join me on Ping Me: ${i.code}`) }, 'Share')))));
  } catch (e) { err(e); }
}

// ═══════════════════════════ friend recovery requests ═══════════════════════════

export async function openRecoveryRequests({ alert = false } = {}) {
  const s = openSheet({ title: alert ? 'Security alert' : 'Recovery requests', left: { label: 'Close' }, full: true });
  const draw = async () => {
    let requests = [];
    try { ({ requests } = await api('GET', '/api/recovery/pending')); } catch (e) { return err(e); }
    const mine = requests.filter((r) => r.mine);
    const friends = requests.filter((r) => !r.mine);
    s.body.replaceChildren(
      ...mine.map((r) => h('div', { class: 'alert-card' },
        h('b', { class: 'row' }, icon('alert'), 'Someone is recovering your account'),
        h('p', null, `${r.approvals} of ${r.needed} trusted contacts approved.${r.readyAt ? ` It completes at ${new Date(r.readyAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` : ''} If this isn’t you, cancel it now.`),
        h('button', { class: 'btn danger', onclick: async () => { await api('POST', `/api/recovery/${r.id}/cancel`); toast('Recovery cancelled'); draw(); } }, 'Cancel — this isn’t me'))),
      friends.length ? h('div', { class: 'group-label' }, 'Friends asking for help') : null,
      ...friends.map((r) => h('div', { class: 'alert-card' },
        h('div', { class: 'row' }, avatar({ id: r.user.id, name: r.user.name, src: userAvatar(r.user.id), size: 40 }), h('div', null, h('b', null, r.user.name), h('div', { class: 'muted small' }, '@' + r.user.username))),
        h('p', null, 'wants to recover their Ping Me account. Only approve if they asked you directly — call them first to be sure.'),
        r.responded ? h('div', { class: 'muted small' }, r.responded === 'approved' ? '✓ You approved' : 'You declined') : null,
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: async () => { await api('POST', `/api/recovery/${r.id}/respond`, { approve: true }); toast('Approved'); draw(); } }, 'Approve'),
          h('button', { class: 'btn secondary', onclick: async () => { await api('POST', `/api/recovery/${r.id}/respond`, { approve: false }); toast('Declined'); draw(); } }, 'Decline')))),
      !mine.length && !friends.length ? h('div', { class: 'empty-list' }, 'No recovery requests right now.') : null);
  };
  draw();
}

// ═══════════════════════════ message options ═══════════════════════════

export function openMessageOptions() {
  const s = openSheet({ title: 'Message options', left: { label: 'Done' } });
  const draw = () => {
    const o = messageOpts();
    s.body.replaceChildren(
      h('div', { class: 'group' },
        feature('secureMessages') ? cell({ icon: 'shieldcheck', label: 'Screenshot-proof', sub: 'Readable on screen, static in screenshots', right: toggle(o.secure, (v) => { setMessageOpts({ secure: v }); draw(); }) }) : null,
        feature('eyesOnly') ? cell({ icon: 'eye', label: 'Eyes-only', sub: 'Opens only while one face is looking', right: toggle(o.eyes, (v) => { setMessageOpts({ eyes: v }); draw(); }) }) : null,
        feature('vanishAfterRead') ? cell({ icon: 'hourglass', label: 'Vanish after read', sub: 'Disappears once read — longer messages stay longer', right: toggle(o.vanish, (v) => { setMessageOpts({ vanish: v }); draw(); }) }) : null),
      feature('intentTags') ? h('div', { class: 'group-label' }, 'Intent') : null,
      feature('intentTags') ? h('div', { class: 'chip-pick' }, Object.entries(INTENTS).map(([k, v]) => h('button', { class: o.intent === k ? 'on' : '', onclick: () => { setMessageOpts({ intent: o.intent === k ? null : k }); draw(); } }, icon(v.icon), v.label))) : null,
      h('div', { class: 'group' },
        cell({ icon: 'sparkle', color: '#af52de', label: 'Send with effect…', chevron: true, onClick: () => { s.close(); openSendOptions(); } }),
        cell({ icon: 'clock', color: '#ff9500', label: 'Send later…', chevron: true, onClick: () => { s.close(); openSchedule(); } })),
      h('p', { class: 'muted small' }, 'Options apply to your next message, then reset.'));
  };
  draw();
}

// ═══════════════════════════ Who's Right? ═══════════════════════════

export async function openWhosRight(chat) {
  const names = chat.members.map((m) => (m.id === S.me.id ? S.me.name : user(m.id).name)).slice(0, 8);
  const topic = await promptDialog({ title: 'Who’s right?', placeholder: 'What’s the argument? (optional)', ok: 'Start vote', maxlength: 120 });
  if (topic === null) return;
  sendPayload(chat.id, { kind: 'poll', poll: { q: `Who’s right?${topic.trim() ? ' ' + topic.trim() : ''}`, opts: names.length >= 2 ? names : [...names, 'Both', 'Neither'].slice(0, 3), whosRight: true } });
}

// ───── shareable cards (Who's Right result, Chat Wrapped) ─────

async function logoImage() {
  const img = new Image();
  img.src = '/icons/logo.svg';
  await img.decode().catch(() => {});
  return img;
}

async function shareCanvas(canvas, filename, text) {
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  const file = new File([blob], filename, { type: 'image/png' });
  try {
    if (navigator.canShare?.({ files: [file] })) return await navigator.share({ files: [file], text });
  } catch (e) { if (e.name === 'AbortError') return; }
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a); a.click(); a.remove();
  toast('Card saved — share it anywhere');
}

function card(w = 1080, hgt = 1350) {
  const c = document.createElement('canvas');
  c.width = w; c.height = hgt;
  const x = c.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, hgt);
  x.textBaseline = 'alphabetic';
  return { c, x };
}
const F = (wt, px) => `${wt} ${px}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;

export async function shareWhosRight(m, chat) {
  const { c, x } = card();
  const logo = await logoImage();
  x.drawImage(logo, 80, 80, 150, 150 * (logo.naturalHeight / logo.naturalWidth || 1.06));
  x.fillStyle = '#000'; x.font = F(800, 72);
  x.fillText('Who’s right?', 80, 400);
  x.font = F(500, 38); x.fillStyle = '#555';
  x.fillText((m.poll.q.replace(/^(⚖️ )?Who’s right\?\s*/, '') || chatTitle(chat)).slice(0, 44), 80, 460);
  const votes = m.poll.votes || {};
  const total = Object.values(votes).reduce((n, v) => n + v.length, 0) || 1;
  const counts = m.poll.opts.map((_, i) => (votes[i] || []).length);
  const best = Math.max(...counts);
  m.poll.opts.slice(0, 6).forEach((o, i) => {
    const y = 560 + i * 120, pct = counts[i] / total;
    x.fillStyle = '#f0f0f0'; x.beginPath(); x.roundRect(80, y, 920, 90, 45); x.fill();
    x.fillStyle = counts[i] === best && best > 0 ? '#000' : '#c8c8c8'; x.beginPath(); x.roundRect(80, y, Math.max(90, 920 * pct), 90, 45); x.fill();
    x.font = F(700, 40); x.fillStyle = counts[i] === best && best > 0 && pct > 0.35 ? '#fff' : '#000';
    x.fillText(String(o).slice(0, 30), 120, y + 60);
    x.fillStyle = '#000'; x.textAlign = 'right'; x.fillText(`${Math.round(pct * 100)}%`, 970, y + 60); x.textAlign = 'left';
  });
  x.font = F(500, 32); x.fillStyle = '#888'; x.fillText(`${Object.values(votes).flat().length} votes · settled on pingme`, 80, 1270);
  shareCanvas(c, 'whos-right.png', 'Settled it on Ping Me');
}

// ═══════════════════════════ Chat Wrapped ═══════════════════════════

export function openWrapped(chat) {
  let period = 'month';
  const s = openSheet({ title: 'Chat Wrapped', left: { label: 'Done' }, full: true });
  const draw = async () => {
    s.body.replaceChildren(h('div', { class: 'tabs' }, [['month', 'This month'], ['year', 'This year'], ['all', 'All time']].map(([k, l]) => h('button', { class: period === k ? 'on' : '', onclick: () => { period = k; draw(); } }, l))), h('div', { class: 'loader' }, h('div', { class: 'spinner' })));
    let st;
    try { st = await api('GET', `/api/chats/${chat.id}/stats?period=${period}`); } catch (e) { return err(e); }
    const lines = wrappedLines(st);
    s.body.lastChild.replaceWith(h('div', { class: 'wrapped' },
      st.total ? null : h('p', { class: 'muted' }, 'No messages in this period yet — chat a bit and come back!'),
      h('div', { class: 'wr-big' }, st.total.toLocaleString()), h('div', { class: 'wr-sub' }, `messages ${period === 'month' ? 'in the last 30 days' : period === 'year' ? 'in the last year' : 'so far'}`),
      ...lines.map(([e, t, v]) => h('div', { class: 'wr-row' }, h('span', { class: 'wr-e' }, icon(e)), h('span', { class: 'wr-t' }, t), h('b', null, v))),
      st.total ? h('button', { class: 'btn', style: { marginTop: '18px' }, onclick: () => shareWrapped(chat, st, lines) }, icon('share'), 'Share card') : null));
  };
  draw();
}

function wrappedLines(st) {
  const name = (id) => (Number(id) === S.me.id ? 'You' : st.users[id] || user(Number(id)).name);
  const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1])[0];
  const lines = [];
  const talker = top(st.perSender); if (talker) lines.push(['bubbles', 'Most messages', `${name(talker[0])} · ${talker[1]}`]);
  const vn = top(st.voice); if (vn) lines.push(['mic', 'Voice notes', `${Object.values(st.voice).reduce((a, b) => a + b, 0)} (most: ${name(vn[0])})`]);
  if (st.fastest) lines.push(['zap', 'Fastest replier', `${name(st.fastest.userId)} · ${st.fastest.medianMs < 60000 ? Math.round(st.fastest.medianMs / 1000) + 's' : Math.round(st.fastest.medianMs / 60000) + ' min'}`]);
  if (st.streak > 1) lines.push(['fire', 'Longest streak', `${st.streak} days`]);
  if (st.busiestDay) lines.push(['calendar', 'Busiest day', `${new Date(st.busiestDay.day + 'T12:00:00').toLocaleDateString([], { day: 'numeric', month: 'short' })} · ${st.busiestDay.count}`]);
  if (st.topEmoji) lines.push(['smile', 'Favourite emoji', `${st.topEmoji[0]}  ${st.topEmoji[1]}×`]);
  if (st.topWord) lines.push(['quote', 'Inside joke', `“${st.topWord[0]}”`]);
  if (st.lateNight) lines.push(['moon', 'Late-night messages', String(st.lateNight)]);
  const ph = Object.values(st.photos).reduce((a, b) => a + b, 0); if (ph) lines.push(['camera', 'Photos & videos', String(ph)]);
  if (st.calls) lines.push(['phone', 'Calls', String(st.calls)]);
  return lines.slice(0, 8);
}

async function shareWrapped(chat, st, lines) {
  const { c, x } = card();
  const logo = await logoImage();
  x.drawImage(logo, 80, 80, 130, 130 * (logo.naturalHeight / logo.naturalWidth || 1.06));
  x.fillStyle = '#000'; x.font = F(800, 64);
  x.fillText('Wrapped', 80, 330);
  x.font = F(500, 36); x.fillStyle = '#666';
  x.fillText(`${chatTitle(chat)} · ${st.period === 'month' ? new Date().toLocaleDateString([], { month: 'long', year: 'numeric' }) : st.period === 'year' ? new Date().getFullYear() : 'All time'}`.slice(0, 46), 80, 385);
  x.fillStyle = '#000'; x.font = F(800, 150); x.fillText(st.total.toLocaleString(), 80, 560);
  x.font = F(500, 36); x.fillStyle = '#666'; x.fillText('messages', 84, 610);
  lines.forEach(([, t, v], i) => {
    const y = 720 + i * 72;
    x.fillStyle = '#000'; x.beginPath(); x.arc(92, y - 11, 6, 0, Math.PI * 2); x.fill();
    x.font = F(500, 34); x.fillStyle = '#666'; x.fillText(t, 120, y);
    x.font = F(700, 34); x.fillStyle = '#000'; x.textAlign = 'right'; x.fillText(String(v).slice(0, 28), 1000, y); x.textAlign = 'left';
  });
  x.font = F(500, 30); x.fillStyle = '#999'; x.fillText('Get yours on pingme', 80, 1290);
  shareCanvas(c, 'pingme-wrapped.png', 'Our Ping Me Wrapped');
}

// ═══════════════════════════ Group Pet ═══════════════════════════

function petCard(chat) {
  const box = h('div', { class: 'pet' }, h('div', { class: 'spinner' }));
  api('GET', `/api/chats/${chat.id}/stats?period=all`).then((st) => {
    const p = st.pet;
    const pct = p.next ? Math.min(100, Math.round((p.xp / p.next) * 100)) : 100;
    box.replaceChildren(
      h('div', { class: 'pet-e' + (p.mood === 'Sleeping' ? ' sleep' : '') }, p.display),
      h('div', { class: 'pet-t' },
        h('b', null, `${p.name} the ${p.level === 0 ? 'Egg' : p.stage}`),
        h('span', { class: 'pet-r r-' + p.rarity.toLowerCase() }, p.rarity),
        h('div', { class: 'pet-bar' }, h('i', { style: { width: pct + '%' } })),
        h('small', null, `${p.mood} · ${p.next ? `${p.next - p.xp} messages to grow` : 'Fully grown legend'}${st.topWord ? ` · knows “${st.topWord[0]}”` : ''}`)));
  }).catch(() => box.remove());
  return box;
}

// ═══════════════════════════ Verified Real camera ═══════════════════════════

export async function openVerifiedCamera(chatId) {
  let stream = null, facing = 'environment', shot = null;
  const video = h('video', { autoplay: true, playsinline: true, muted: true });
  video.muted = true;
  const preview = h('img', { hidden: true, alt: '' });
  const status = h('div', { class: 'vc-status' }, 'Photos taken here are signed by this device — proof they’re real and unedited.');
  const shutter = h('button', { class: 'vc-shutter', 'aria-label': 'Take photo' });
  const flip = h('button', { class: 'vc-btn', 'aria-label': 'Flip camera' }, icon('flip'));
  const sendBtn = h('button', { class: 'btn', hidden: true }, icon('send'), 'Send Verified photo');
  const retake = h('button', { class: 'btn secondary', hidden: true }, 'Retake');
  const close = () => { stream?.getTracks().forEach((t) => t.stop()); root.remove(); };
  const root = h('div', { class: 'vcam' },
    h('div', { class: 'vc-top' }, h('button', { class: 'vc-btn', 'aria-label': 'Close', onclick: close }, icon('x')), h('b', null, '✓ Verified Real camera'), flip),
    h('div', { class: 'vc-stage' }, video, preview), status,
    h('div', { class: 'vc-bottom' }, shutter, retake, sendBtn));
  document.body.append(root);
  const start = async () => {
    stream?.getTracks().forEach((t) => t.stop());
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false });
      video.srcObject = stream; video.style.transform = facing === 'user' ? 'scaleX(-1)' : '';
    } catch { status.textContent = 'Allow camera access to take a Verified photo.'; }
  };
  flip.onclick = () => { facing = facing === 'user' ? 'environment' : 'user'; start(); };
  shutter.onclick = async () => {
    if (!video.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = video.videoWidth; c.height = video.videoHeight;
    const x = c.getContext('2d');
    if (facing === 'user') { x.translate(c.width, 0); x.scale(-1, 1); }
    x.drawImage(video, 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    shot = { blob, w: c.width, h: c.height };
    preview.src = URL.createObjectURL(blob);
    preview.hidden = false; video.hidden = true; shutter.hidden = true; flip.hidden = true; retake.hidden = false; sendBtn.hidden = false;
  };
  retake.onclick = () => { preview.hidden = true; video.hidden = false; shutter.hidden = false; flip.hidden = false; retake.hidden = true; sendBtn.hidden = true; shot = null; };
  sendBtn.onclick = async () => {
    if (!shot) return;
    sendBtn.disabled = true; status.textContent = 'Signing and sending…';
    try {
      const bytes = await shot.blob.arrayBuffer();
      const at = Date.now();
      const sig = await signPhoto(bytes, at);
      const up = await upload(chatId, shot.blob, `verified-${at}.jpg`);
      await sendPayload(chatId, { kind: 'image', attachmentId: up.id, media: { w: shot.w, h: shot.h }, vr: { keyId: sig.keyId, sig: sig.sig, at } });
      close();
    } catch (e) { sendBtn.disabled = false; status.textContent = e.message || 'Couldn’t send'; }
  };
  start();
}

// ═══════════════════════════ safety: check-in + SOS ═══════════════════════════

export function openSafety(chatId) {
  const s = openSheet({ title: 'Safety', left: { label: 'Done' } });
  const draw = () => {
    const parts = [];
    if (feature('checkIn')) {
      if (S.checkin) {
        parts.push(h('div', { class: 'alert-card' }, h('b', { class: 'row' }, icon('clock'), 'Check-in running'),
          h('p', null, `If you don’t tap “I’m safe” by ${new Date(S.checkin.dueAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}, ${chatTitle(S.chats.get(S.checkin.chatId)) || 'your chat'} will be alerted.`),
          h('button', { class: 'btn', onclick: async () => { await api('POST', `/api/checkins/${S.checkin.id}/safe`); setCheckin(null); toast('Glad you’re safe'); draw(); } }, 'I’m safe')));
      } else {
        const note = h('input', { class: 'field', placeholder: 'Note (e.g. “Cab KA01 AB1234 to home”)', maxlength: 300 });
        let share = true;
        const startCheckin = async (minutes) => {
          let loc = null;
          if (share && navigator.geolocation) loc = await new Promise((res) => navigator.geolocation.getCurrentPosition((p) => res({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }), () => res(null), { timeout: 6000, maximumAge: 60000 }));
          try { const { checkin } = await api('POST', '/api/checkins', { chatId, minutes, note: note.value, loc }); setCheckin(checkin); toast(`Check-in set — tap “I’m safe” before ${new Date(checkin.dueAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`); draw(); }
          catch (e) { err(e); }
        };
        parts.push(h('div', { class: 'group-label' }, 'Safety check-in'),
          h('p', { class: 'muted small', style: { margin: '0 4px 10px' } }, `Travelling alone or out late? If you don’t check in on time, ${chatTitle(S.chats.get(chatId))} gets an alert with your note${share ? ' and location' : ''}.`),
          note,
          h('div', { class: 'group', style: { marginTop: '10px' } }, cell({ label: 'Include my location', right: toggle(true, (v) => { share = v; }) })),
          h('div', { class: 'chip-pick' }, [[30, '30 min'], [60, '1 hour'], [120, '2 hours'], [240, '4 hours'], [480, '8 hours']].map(([m, l]) => h('button', { onclick: () => startCheckin(m) }, l))));
      }
    }
    if (feature('sos')) {
      const trusted = S.me.settings.trusted || [];
      parts.push(h('div', { class: 'group-label', style: { marginTop: '18px' } }, 'Silent SOS'));
      if (!trusted.length) {
        parts.push(h('div', { class: 'group' }, cell({ icon: 'users', color: '#34c759', label: 'Add trusted contacts first', chevron: true, onClick: () => openTrusted(draw) })));
      } else {
        const hold = h('button', { class: 'sos-hold' }, h('i'), h('span', null, 'Hold 2 seconds for SOS'));
        let t = null;
        const begin = (e) => { e.preventDefault(); hold.classList.add('holding'); t = setTimeout(() => { hold.classList.remove('holding'); s.close(); triggerSos(); }, 2000); };
        const cancel = () => { clearTimeout(t); hold.classList.remove('holding'); };
        hold.addEventListener('pointerdown', begin);
        ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => hold.addEventListener(ev, cancel));
        parts.push(hold, h('p', { class: 'muted small', style: { margin: '10px 4px' } }, `Sends your live location to ${trusted.length} trusted contact${trusted.length > 1 ? 's' : ''} and starts what looks like a normal call with ${user(trusted[0]).name}.`));
      }
    }
    s.body.replaceChildren(...parts);
  };
  draw();
}

export async function triggerSos() {
  navigator.vibrate?.([60, 40, 60]);
  const loc = await new Promise((res) => {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition((p) => res({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }), () => res(null), { enableHighAccuracy: true, timeout: 5000, maximumAge: 30000 });
  });
  try {
    const r = await api('POST', '/api/sos/start', loc || {});
    startSosTracking();
    S.calls.start(r.primaryChatId, false, { reason: 'SOS' });
  } catch (e) { err(e); }
}
