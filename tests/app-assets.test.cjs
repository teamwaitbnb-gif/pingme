const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
function files(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? files(path.join(dir,e.name)) : [path.join(dir,e.name)]); }
test('all browser imports and service worker assets resolve after feature removal', () => {
  for (const file of files('public').filter((p) => p.endsWith('.js'))) {
    const source = fs.readFileSync(file,'utf8');
    for (const m of source.matchAll(/(?:from\s*|import\s*)['"](\.\.?\/[^'"]+)['"]/g)) assert.ok(fs.existsSync(path.resolve(path.dirname(file),m[1])), `${file} imports missing ${m[1]}`);
  }
  const sw = fs.readFileSync('public/sw.js','utf8'); const shell = sw.slice(sw.indexOf('const SHELL'),sw.indexOf('];'));
  for (const m of shell.matchAll(/'([^']+)'/g)) assert.ok(m[1] === '/' || fs.existsSync('public'+m[1]), `Missing cached asset ${m[1]}`);
  assert.doesNotMatch(shell, /\/js\/(buzz|map)\.js/);
});
test('server has no dependencies on removed modules or feed/location tables', () => {
  for (const file of files('server').filter((p) => p.endsWith('.js'))) {
    const source = fs.readFileSync(file,'utf8');
    assert.doesNotMatch(source, /require\(['"]\.\/buzz|\bfeed_(items|sources|seen|likes|comments|reposts)\b|\buser_locations\b/, file);
    for (const m of source.matchAll(/require\(['"](\.\.?\/[^'"]+)['"]\)/g)) assert.doesNotThrow(() => require.resolve(path.resolve(path.dirname(file),m[1])), `${file}: ${m[1]}`);
  }
});
