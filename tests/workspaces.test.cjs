const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const register = require('../server/workspaces');

function harness(steps = []) {
  const routes = new Map(), effects = [], queries = [];
  const q = async (sql, args) => {
    queries.push([sql, args]);
    const step = steps.shift(); assert.ok(step, `Unexpected query: ${sql}`);
    assert.match(sql, step[0]); if (step[2]) step[2](args);
    if (step[1] instanceof Error) throw step[1];
    return step[1];
  };
  const app = Object.fromEntries(['get','post','patch','delete','use'].map((method) => [method, (path, ...fns) => routes.set(method + ' ' + path, fns.at(-1))]));
  const db = { q, one: async (sql, args) => (await q(sql, args))[0] || null, pool: { getConnection: async () => ({
    query: async (sql, args) => [await q(sql, args)], beginTransaction: async () => effects.push('begin'), commit: async () => effects.push('commit'), rollback: async () => effects.push('rollback'), release: () => effects.push('release'),
  }) } };
  register({ app, db, C: { enc: (s) => 'enc:' + s, dec: (s) => s.slice(4), sha256: (s) => crypto.createHash('sha256').update(s).digest('hex') },
    auth() {}, wrap: (fn) => fn, rateLimit() {}, publicUser: async (id) => ({ id, name: 'Person ' + id }), getUser: async () => ({ settings: {} }),
    emitToUser: (...args) => effects.push(['emit', ...args]), joinUserToChat: (...args) => effects.push(['join', ...args]), disconnectUser: (id) => effects.push(['disconnect', id]), publicOrigin: () => 'https://example.test' });
  return { steps, queries, effects, async run(method, path, props = {}) {
    const res = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(v) { this.body = v; return this; } };
    await routes.get(method + ' ' + path)({ uid: 1, params: { wid: '5', uid: '2' }, body: {}, ...props }, res, () => effects.push('next'));
    return res;
  } };
}
const lock = [/SELECT id FROM workspaces.*FOR UPDATE/, [{ id: 5 }]];
const actor = (role) => [/SELECT role FROM workspace_members/, role ? [{ role }] : []];

test('nonmembers cannot inspect an organization, its members, or channels', async () => {
  const h = harness([actor(null)]);
  await assert.rejects(h.run('get', '/api/workspaces/:wid'), { status: 403 }); assert.equal(h.queries.length, 1);
});
test('members cannot create channels and the transaction is rolled back', async () => {
  const h = harness([lock, actor('member')]);
  await assert.rejects(h.run('post', '/api/workspaces/:wid/channels', { body: { name: 'Engineering' } }), { status: 403 });
  assert.deepEqual(h.effects, ['begin','rollback','release']);
});
test('organization creation atomically creates the owner and General channel', async () => {
  const h = harness([
    [/INSERT INTO workspaces/, { insertId: 5 }, (a) => assert.equal(a[0], 'enc:Acme')],
    [/INSERT INTO workspace_members/, {}], [/SELECT chat_id FROM workspace_channels/, []],
    [/INSERT INTO chats/, { insertId: 9 }, (a) => assert.equal(a[0], 'enc:General')],
    [/INSERT INTO workspace_channels/, {}], [/INSERT INTO chat_members.*SELECT/, {}],
    [/SELECT user_id FROM workspace_members/, [{ user_id: 1 }]],
  ]);
  const r = await h.run('post', '/api/workspaces', { body: { name: 'Acme' } });
  assert.equal(r.statusCode, 201); assert.deepEqual(r.body, { id: 5, chatId: 9 });
  assert.ok(h.effects.indexOf('commit') < h.effects.findIndex((e) => e[0] === 'join')); assert.equal(h.steps.length, 0);
});
test('failed channel creation never commits a partial organization', async () => {
  const h = harness([[/INSERT INTO workspaces/, { insertId: 5 }], [/INSERT INTO workspace_members/, {}], [/SELECT chat_id/, []], [/INSERT INTO chats/, new Error('disk full')]]);
  await assert.rejects(h.run('post', '/api/workspaces', { body: { name: 'Acme' } }), /disk full/);
  assert.deepEqual(h.effects, ['begin','rollback','release']);
});
test('admins cannot grant admin invitations or change roles', async () => {
  const h = harness([lock, actor('admin')]);
  await assert.rejects(h.run('post', '/api/workspaces/:wid/invites', { body: { role: 'admin' } }), { status: 403 });
  const r = harness([lock, actor('admin')]);
  await assert.rejects(r.run('patch', '/api/workspaces/:wid/members/:uid', { body: { role: 'owner' } }), { status: 403 });
});
test('the last owner cannot be demoted or removed', async () => {
  for (const method of ['patch','delete']) {
    const h = harness([lock, actor('owner'), actor('owner'), [/COUNT\(\*\)/, [{ n: 1 }]]]);
    await assert.rejects(h.run(method, '/api/workspaces/:wid/members/:uid', { body: { role: 'member' } }), { status: 409 });
    assert.ok(h.effects.includes('rollback'));
  }
});
test('admins cannot remove another admin', async () => {
  const h = harness([lock, actor('admin'), actor('admin')]);
  await assert.rejects(h.run('delete', '/api/workspaces/:wid/members/:uid'), { status: 403 });
});
test('removal revokes channel access, invitations, scheduled messages, and connected sockets', async () => {
  const h = harness([lock, actor('admin'), actor('member'), [/DELETE FROM workspace_members/, {}], [/UPDATE chat_members.*active=0/, {}], [/UPDATE workspace_invites SET revoked=1/, {}], [/DELETE sm FROM scheduled_messages/, {}], [/SELECT user_id FROM workspace_members/, [{ user_id: 1 }]]]);
  await h.run('delete', '/api/workspaces/:wid/members/:uid');
  assert.ok(h.effects.find((e) => e[0] === 'disconnect' && e[1] === 2));
  assert.ok(h.effects.indexOf('commit') < h.effects.findIndex((e) => e[0] === 'disconnect'));
});
test('invitation token is high entropy, hashed at rest and expires in seven days', async () => {
  let stored;
  const h = harness([lock, actor('owner'), [/INSERT INTO workspace_invites/, {}, (a) => { stored = a; }]]);
  const now = Date.now(); const r = await h.run('post', '/api/workspaces/:wid/invites', { body: { role: 'member' } });
  assert.match(r.body.token, /^[\w-]{43}$/); assert.notEqual(stored[1], r.body.token); assert.equal(stored[1].length, 64);
  assert.ok(new Date(r.body.expiresAt).getTime() >= now + 7 * 86400e3); assert.ok(r.body.url.endsWith('#workspace-invite=' + r.body.token));
});
test('expired, revoked and consumed invitations cannot grant membership', async () => {
  for (const change of [{ expires_at: new Date(0) }, { revoked: 1 }, { accepted_by: 7 }]) {
    const h = harness([[/SELECT workspace_id FROM workspace_invites/, [{ workspace_id: 5 }]], lock, [/SELECT \* FROM workspace_invites.*FOR UPDATE/, [{ id: 3, expires_at: new Date(Date.now() + 60000), ...change }]]]);
    await assert.rejects(h.run('post', '/api/workspace-invites/accept', { body: { token: 'x'.repeat(43) } }), { status: 410 });
    assert.ok(h.effects.includes('rollback'));
  }
});
test('acceptance locks invitation, rechecks issuer, adds channels, and consumes it atomically', async () => {
  const h = harness([[/SELECT workspace_id FROM workspace_invites/, [{ workspace_id: 5 }]], lock,
    [/SELECT \* FROM workspace_invites.*FOR UPDATE/, [{ id: 3, role: 'member', created_by: 8, expires_at: new Date(Date.now() + 60000) }]], actor('admin'), actor(null),
    [/INSERT INTO workspace_members/, {}], [/INSERT INTO chat_members.*ON DUPLICATE KEY UPDATE/, {}], [/UPDATE workspace_invites SET accepted_by/, {}],
    [/SELECT chat_id FROM workspace_channels/, [{ chat_id: 9 }]], [/SELECT user_id FROM workspace_members/, [{ user_id: 1 }]],
  ]);
  const r = await h.run('post', '/api/workspace-invites/accept', { body: { token: 'x'.repeat(43) } });
  assert.equal(r.body.workspaceId, 5); assert.ok(h.effects.includes('commit')); assert.equal(h.steps.length, 0);
});
test('an invitation from a removed or demoted inviter cannot be accepted', async () => {
  const h = harness([[/SELECT workspace_id FROM workspace_invites/, [{ workspace_id: 5 }]], lock,
    [/SELECT \* FROM workspace_invites.*FOR UPDATE/, [{ role: 'admin', created_by: 8, expires_at: new Date(Date.now() + 60000) }]], actor('admin')]);
  await assert.rejects(h.run('post', '/api/workspace-invites/accept', { body: { token: 'x'.repeat(43) } }), { status: 410 });
});
test('legacy group membership and deletion controls cannot bypass organization roles', async () => {
  for (const [method, path, body] of [['POST','/members',{}],['POST','/Members',{}],['POST','/ADMINS/2',{}],['POST','/admins/2',{}],['DELETE','/members/2',{}],['DELETE','/',{}],['PATCH','/',{ title: 'Renamed' }],['POST','/incognito',{}]]) {
    const h = harness([[/SELECT workspace_id FROM workspace_channels/, [{ workspace_id: 5 }]], actor('owner')]);
    await assert.rejects(h.run('use', '/api/chats/:id', { method, path, params: { id: '9' }, body }), { status: 403 });
  }
});
test('normal group controls and channel message operations continue to the existing handlers', async () => {
  const group = harness([[/SELECT workspace_id/, []]]); await group.run('use', '/api/chats/:id', { method: 'POST', path: '/members', params: { id: '9' } }); assert.ok(group.effects.includes('next'));
  const channel = harness([[/SELECT workspace_id/, [{ workspace_id: 5 }]], actor('member')]); await channel.run('use', '/api/chats/:id', { method: 'POST', path: '/messages', params: { id: '9' } }); assert.ok(channel.effects.includes('next'));
});
