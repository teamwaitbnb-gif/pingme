const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

// iOS Safari doesn't paint fixed backgrounds inside scroll areas: sent bubbles disappeared while
// scrolling (only their tails and times were left).
test('no fixed background attachments in the app stylesheet', () => {
  const css = fs.readFileSync('public/css/app.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /background-attachment\s*:\s*fixed/);
  assert.doesNotMatch(css, /background\s*:[^;}]*\bfixed\b/);
});
