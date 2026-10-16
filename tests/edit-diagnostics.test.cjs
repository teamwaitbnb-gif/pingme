const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function setup() {
  const reports = [], timers = [];
  const context = vm.createContext({ setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout() {} });
  vm.runInContext(fs.readFileSync('public/js/edit-diagnostics.js', 'utf8').replace(/^import .*;\n/m, '').replace('export ', ''), context);
  const diag = context.createEditDiagnostics(() => ({ n: [4, 4, 3] }), (e, where) => reports.push({ msg: e.message, stack: e.stack, where }));
  return { diag, reports, timers };
}
test('edit diagnostics correlate ack/render and exclude message content and identifiers', () => {
  const { diag, reports, timers } = setup();
  const message = { chatId: 879123, id: 93281, text: 'private message secret' };
  const done = diag.begin(message); done(true); diag.updated(message);
  timers.forEach(fn => fn());
  assert.equal(reports.length, 1);
  assert.match(reports[0].msg, /ack=ok update=true/);
  assert.equal(JSON.parse(reports[0].stack).rows.length, 6);
  assert.doesNotMatch(JSON.stringify(reports), /private message|879123|93281/);
});
test('pending updates, failures and page exit are captured once with bounded reports', () => {
  const { diag, reports, timers } = setup();
  for (let id = 0; id < 8; id++) diag.begin({ chatId: 1, id })?.(false);
  diag.flush(); timers.forEach(fn => fn()); diag.flush();
  assert.equal(reports.length, 5);
  assert.ok(reports.every(r => /ack=failed update=false/.test(r.msg)));
});
