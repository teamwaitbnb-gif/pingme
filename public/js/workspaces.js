import { h, icon, openSheet, confirmDialog, toast } from './ui.js';

export function captureWorkspaceInvite() {
  const match = /^#workspace-invite=([\w-]{43})$/.exec(location.hash);
  if (match) { sessionStorage.setItem('pm:workspace-invite', match[1]); history.replaceState(null, '', location.pathname + location.search); }
}

export function initWorkspaces({ api, me, openChannel }) {
  let pane, visible = false, selected = Number(sessionStorage.getItem('pm:workspace') || 0), generation = 0;
  const button = (label, run, cls = 'btn secondary') => h('button', { class: cls, onclick: async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try { await run(); } catch (err) { toast(err.message, { error: true }); } finally { b.disabled = false; }
  } }, label);
  const field = (label, input) => h('label', { class: 'wk-field' }, h('span', null, label), input);
  function form(title, inputs, submitText, submit) {
    const error = h('p', { class: 'wk-error', role: 'alert' });
    const submitButton = h('button', { class: 'btn', type: 'submit' }, submitText);
    const body = h('form', { class: 'wk-form', onsubmit: async (e) => {
      e.preventDefault(); submitButton.disabled = true; error.textContent = '';
      try { await submit(); sheet.close(); await refresh(); } catch (err) { error.textContent = err.message; } finally { submitButton.disabled = false; }
    } }, inputs, error, submitButton);
    const sheet = openSheet({ title, body });
  }
  function create() {
    const name = h('input', { class: 'input', required: true, maxlength: 80, placeholder: 'Organization name', autocomplete: 'organization' });
    form('Create an organization', [field('Name', name), h('p', { class: 'muted' }, 'You will be the owner. A General channel is created for everyone.')], 'Create organization', async () => {
      const w = await api('POST', '/api/workspaces', { name: name.value }); selected = w.id; sessionStorage.setItem('pm:workspace', selected);
    });
  }
  function join() {
    const token = h('input', { class: 'input', required: true, placeholder: 'Paste invitation link or code', value: sessionStorage.getItem('pm:workspace-invite') || '', autocomplete: 'off' });
    form('Join an organization', [field('Invitation', token), h('p', { class: 'muted' }, 'Joining gives you access to all organization channels and their history.')], 'Accept invitation', async () => {
      const raw = token.value.trim(), code = raw.includes('#workspace-invite=') ? raw.split('#workspace-invite=')[1] : raw;
      const out = await api('POST', '/api/workspace-invites/accept', { token: code }); selected = out.workspaceId;
      sessionStorage.setItem('pm:workspace', selected); sessionStorage.removeItem('pm:workspace-invite');
    });
  }
  function addChannel(w) {
    const name = h('input', { class: 'input', required: true, maxlength: 80, placeholder: 'e.g. Product or Operations' });
    form('New channel', [field('Channel name', name), h('p', { class: 'muted' }, 'Channels are visible to every member of this organization.')], 'Create channel', () => api('POST', `/api/workspaces/${w.id}/channels`, { name: name.value }));
  }
  async function invite(w) {
    const role = h('select', { class: 'input' }, h('option', { value: 'member' }, 'Member'), w.role === 'owner' ? h('option', { value: 'admin' }, 'Admin') : null);
    const result = h('div', { class: 'wk-invite-result', 'aria-live': 'polite' });
    openSheet({ title: 'Invite a teammate', body: h('div', { class: 'wk-form' }, field('Role', role),
      h('p', { class: 'muted' }, 'Anyone with this single-use link can join. It expires in 7 days. Share it only with the intended teammate.'),
      button('Create invitation link', async () => {
        const inv = await api('POST', `/api/workspaces/${w.id}/invites`, { role: role.value });
        const input = h('input', { class: 'input', readonly: true, value: inv.url, 'aria-label': 'Invitation link', onclick: (e) => e.target.select() });
        result.replaceChildren(input, button('Copy link', async () => { await navigator.clipboard.writeText(inv.url); toast('Invitation link copied'); }));
        await refresh();
      }, 'btn'), result) });
  }
  async function people(w) {
    const body = h('div', { class: 'wk-form' });
    const sheet = openSheet({ title: 'People & roles', body });
    const draw = (data) => body.replaceChildren(h('p', { class: 'muted' }, 'Owners manage roles. Admins create channels and invite or remove members. Members participate in channels.'), ...data.members.map((m) => {
      const controls = [];
      if (data.role === 'owner') {
        const roles = h('select', { class: 'input', 'aria-label': `Role for ${m.name}` }, ...['owner','admin','member'].map((r) => h('option', { value: r, selected: r === m.role }, r)));
        controls.push(roles, button('Save role', async () => {
          await api('PATCH', `/api/workspaces/${w.id}/members/${m.id}`, { role: roles.value });
          const fresh = await api('GET', `/api/workspaces/${w.id}`); draw(fresh); await refresh();
        }));
      }
      if (m.id === me().id || data.role === 'owner' || data.role === 'admin' && m.role === 'member') controls.push(button(m.id === me().id ? 'Leave' : 'Remove', async () => {
        if (!await confirmDialog(m.id === me().id ? 'Leave this organization and lose access to its channels?' : `Remove ${m.name} from this organization and all its channels?`, { ok: 'Confirm', danger: true })) return;
        await api('DELETE', `/api/workspaces/${w.id}/members/${m.id}`);
        if (m.id === me().id) { selected = 0; sheet.close(); } else draw(await api('GET', `/api/workspaces/${w.id}`));
        await refresh();
      }));
      return h('div', { class: 'wk-person' }, h('div', null, h('b', null, m.name), h('small', null, `@${m.username || 'user'} · ${m.role}`)), h('div', { class: 'wk-actions' }, controls));
    }));
    draw(w);
  }
  async function invitations(w) {
    const body = h('div', { class: 'wk-form' });
    openSheet({ title: 'Invitations', body });
    const draw = (list) => body.replaceChildren(...(list.length ? list.map((inv) => {
      const active = !inv.revoked && !inv.accepted_by && new Date(inv.expires_at).getTime() > Date.now();
      const state = inv.revoked ? 'Revoked' : inv.accepted_by ? 'Accepted' : active ? 'Pending' : 'Expired';
      return h('div', { class: 'wk-person' }, h('div', null, h('b', null, `${inv.role} invitation`), h('small', null, `${state} · expires ${new Date(inv.expires_at).toLocaleDateString()}`)), active ? button('Revoke', async () => { await api('DELETE', `/api/workspaces/${w.id}/invites/${inv.id}`); draw((await api('GET', `/api/workspaces/${w.id}`)).invites); }) : null);
    }) : [h('p', { class: 'muted' }, 'No invitations yet.')])); draw(w.invites);
  }
  async function refresh() {
    if (!visible || !pane) return;
    const version = ++generation;
    try {
      const { workspaces } = await api('GET', '/api/workspaces');
      if (!workspaces.some((w) => w.id === selected)) selected = workspaces[0]?.id || 0;
      const w = selected ? await api('GET', `/api/workspaces/${selected}`) : null;
      if (version !== generation || !visible) return;
      const select = h('select', { class: 'wk-select', 'aria-label': 'Organization', onchange: () => { selected = Number(select.value); sessionStorage.setItem('pm:workspace', selected); refresh(); } }, ...workspaces.map((x) => h('option', { value: x.id, selected: x.id === selected }, x.name)));
      pane.replaceChildren(h('div', { class: 'wk-header' }, h('div', null, h('h1', null, 'Workspace'), h('p', { class: 'muted' }, 'Your teams, conversations, and shared work.')), h('div', { class: 'wk-actions' }, button('Join organization', join), button('Create organization', create, 'btn'))),
        sessionStorage.getItem('pm:workspace-invite') ? h('div', { class: 'wk-notice' }, h('span', null, 'You have an organization invitation.'), button('Review invitation', join, 'btn')) : null,
        w ? h('div', { class: 'wk-content' }, h('div', { class: 'wk-toolbar' }, select, h('span', { class: 'wk-role' }, w.role), button('People & roles', () => people(w)), w.role !== 'member' ? button('Invite teammate', () => invite(w)) : null, w.role !== 'member' ? button('Invitations', () => invitations(w)) : null),
          h('div', { class: 'wk-section-heading' }, h('h2', null, 'Channels'), w.role !== 'member' ? button('New channel', () => addChannel(w)) : null),
          h('p', { class: 'muted' }, 'Every member can read and post in these channels. Open one to message, share files, or start a call.'),
          h('div', { class: 'wk-channels' }, ...w.channels.map((c) => button('# ' + c.name, () => openChannel(c.id), 'wk-channel'))))
          : h('div', { class: 'wk-empty' }, icon('users'), h('h2', null, 'Bring your team together'), h('p', null, 'Create an organization or accept an invitation to start collaborating in channels.')));
    } catch (e) { if (version === generation && visible) pane.replaceChildren(h('div', { class: 'wk-empty', role: 'alert' }, h('p', null, e.message), button('Retry', refresh))); }
  }
  return { show(el) { pane = el; visible = true; pane.replaceChildren(h('p', { class: 'wk-empty' }, 'Loading workspace…')); refresh(); }, hide() { visible = false; generation++; }, refresh };
}
