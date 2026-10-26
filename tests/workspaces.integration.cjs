// Run only against a disposable local Ping Me database (never production).
// PINGME_TEST_URL=http://127.0.0.1:3300 node tests/workspaces.integration.cjs
const assert = require('node:assert/strict');
const base = process.env.PINGME_TEST_URL;
if (!base || !['127.0.0.1','localhost'].includes(new URL(base).hostname)) throw new Error('Set PINGME_TEST_URL to an isolated localhost server');
const suffix = Date.now().toString(36);
function client() {
  let cookie = '';
  return { get cookie() { return cookie; }, async api(method, path, body, status = 200) {
    const r = await fetch(base + path, { method, headers: { cookie, 'x-pingme': '1', 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = r.headers.getSetCookie(); if (set.length) cookie = set.map((v) => v.split(';')[0]).join('; ');
    const data = await r.json(); assert.equal(r.status, status, `${method} ${path}: ${JSON.stringify(data)}`); return data;
  } };
}
async function socket(c) {
  let sid;
  const request = async (method, body) => { const r = await fetch(`${base}/socket.io/?EIO=4&transport=polling${sid ? '&sid=' + sid : ''}`, { method, headers: { cookie: c.cookie, 'content-type':'text/plain' }, body, signal: AbortSignal.timeout(10000) }); assert.ok(r.ok); return r.text(); };
  sid = JSON.parse((await request('GET')).slice(1)).sid;
  await request('POST','40'); await request('GET');
  return { async send(payload) {
    await request('POST', '421' + JSON.stringify(['msg:send',payload]));
    for (let i = 0; i < 8; i++) { const packets = (await request('GET')).split('\x1e'); for (const p of packets) { if (p === '2') await request('POST','3'); if (p.startsWith('431')) return JSON.parse(p.slice(3))[0]; } }
    throw new Error('No message acknowledgement');
  }, async close() { await request('POST','41').catch(() => {}); } };
}
(async () => {
  const owner = client(), member = client(), outsider = client(), newcomer = client();
  const people = [];
  for (const [i,c] of [owner,member,outsider,newcomer].entries()) people.push((await c.api('POST','/api/register',{ username:`wk${i}${suffix}`, name:['Owner','Member','Outsider','New teammate'][i], password:'Local-test-only-123!', birth:'1995-01-01' })).user);
  const w = await owner.api('POST','/api/workspaces',{ name:'Integration team' },201);
  await outsider.api('GET',`/api/workspaces/${w.id}`,undefined,403);
  const invitation = await owner.api('POST',`/api/workspaces/${w.id}/invites`,{role:'member'},201);
  await member.api('POST','/api/workspace-invites/accept',{token:invitation.token});
  await outsider.api('POST','/api/workspace-invites/accept',{token:invitation.token},410);
  const detail = await member.api('GET',`/api/workspaces/${w.id}`); assert.equal(detail.members.length,2); assert.equal(detail.channels[0].name,'General');
  const general = detail.channels[0].id;
  const chat = await member.api('GET',`/api/chats/${general}`); assert.equal(chat.chat.workspaceId,w.id);
  await member.api('POST',`/api/workspaces/${w.id}/channels`,{name:'Restricted'},403);
  await member.api('POST',`/api/chats/${general}/members`,{userIds:[people[2].id]},403);
  await owner.api('DELETE',`/api/workspaces/${w.id}/members/${people[0].id}`,undefined,409);
  await owner.api('PATCH',`/api/workspaces/${w.id}/members/${people[1].id}`,{role:'admin'});
  await member.api('POST',`/api/workspaces/${w.id}/invites`,{role:'admin'},403);
  const c = await member.api('POST',`/api/workspaces/${w.id}/channels`,{name:'Engineering'},201);
  await owner.api('POST',`/api/workspaces/${w.id}/channels`,{name:'engineering'},409);
  assert.equal((await owner.api('GET',`/api/chats/${c.chatId}`)).chat.members.length,2);
  const so = await socket(owner);
  const sent = await so.send({ chatId: c.chatId, kind:'text', text:'Workspace message integration test' });
  assert.ok(!sent.error, JSON.stringify(sent));
  const messages = await member.api('GET',`/api/chats/${c.chatId}/messages`); assert.ok(messages.messages.some((m) => m.text === 'Workspace message integration test'));
  await so.close();
  await outsider.api('GET',`/api/chats/${c.chatId}/messages`,undefined,403);
  await owner.api('DELETE',`/api/workspaces/${w.id}/members/${people[1].id}`);
  await member.api('GET',`/api/chats/${c.chatId}/messages`,undefined,403);
  await member.api('GET',`/api/workspaces/${w.id}`,undefined,403);
  const revoked = await owner.api('POST',`/api/workspaces/${w.id}/invites`,{},201);
  const pending = (await owner.api('GET',`/api/workspaces/${w.id}`)).invites.find((i) => !i.accepted_by && !i.revoked);
  await owner.api('DELETE',`/api/workspaces/${w.id}/invites/${pending.id}`);
  await outsider.api('POST','/api/workspace-invites/accept',{token:revoked.token},410);
  // Race the same invitation: the row lock permits only one winner.
  const racing = await owner.api('POST',`/api/workspaces/${w.id}/invites`,{},201);
  const accept = (c) => fetch(base + '/api/workspace-invites/accept', { method:'POST',headers:{cookie:c.cookie,'x-pingme':'1','content-type':'application/json'},body:JSON.stringify({token:racing.token}) });
  const results = await Promise.all([accept(outsider),accept(newcomer)]); assert.deepEqual(results.map((r) => r.status).sort(),[200,410]);
  const direct = await owner.api('POST','/api/chats',{userId:people[1].id}); assert.equal(direct.chat.type,'direct');
  await owner.api('GET','/api/feed',undefined,404); await owner.api('GET','/api/location',undefined,404);
  const admin = client(); await admin.api('POST','/api/admin/login',{key:'local-test-admin'});
  for (const path of ['overview','timeseries','retention','screens','users','notify','ads',`user/${people[0].id}`]) await admin.api('GET','/api/admin/'+path);
  console.log('PASS: organization lifecycle, roles, single-use/revoked/racing invites, channel messaging, isolation, removal, legacy chats and admin endpoints');
})().catch((e) => { console.error(e); process.exitCode=1; });
