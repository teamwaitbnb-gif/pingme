const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

// The "Edited" label once used class "ed" — the photo editor's full-screen black overlay class —
// so every edited message covered the whole app in black.
test('message labels never reuse full-screen overlay class names', () => {
  const app = fs.readFileSync('public/js/app.js', 'utf8');
  const css = fs.readFileSync('public/css/app.css', 'utf8');
  const fullScreen = [...css.matchAll(/^\.([a-z][\w-]*)\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0/gm)].map((m) => m[1]);
  assert.ok(fullScreen.includes('ed'), 'editor overlay class found');
  const infoBlock = app.slice(app.indexOf('const info = [];'), app.indexOf("if (info.length)"));
  for (const cls of fullScreen) assert.doesNotMatch(infoBlock, new RegExp(`class: '${cls}'`), `message info uses overlay class .${cls}`);
  assert.match(infoBlock, /class: 'edited-tag'/);
});
