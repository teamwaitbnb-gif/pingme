const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mentionsIn } = require('../server/usernames');
const { parseMeta, mapsInfo, titleFromPath } = require('../server/unfurl');

test('mentions: handles in text, not emails, trailing full stop dropped', () => {
  assert.deepEqual([...mentionsIn('hey @Swapna_r and @ravi.k. see mail me@site.com @ab')], ['swapna_r', 'ravi.k']);
  assert.deepEqual([...mentionsIn('@vijay')], ['vijay']);
  assert.equal(mentionsIn('no tags here').size, 0);
});

test('link previews: meta tags in any attribute order, entities decoded', () => {
  const m = parseMeta('<head><title>Fallback</title><meta content="Big &amp; Bold" property="og:title"><meta property=\'og:image\' content=\'https://x.com/a.jpg\'></head>');
  assert.equal(m['og:title'], 'Big & Bold');
  assert.equal(m['og:image'], 'https://x.com/a.jpg');
  assert.equal(m._title, 'Fallback');
});

test('link previews: Google Maps place name and coordinates', () => {
  const p = mapsInfo('https://www.google.com/maps/place/Charminar/@17.3615636,78.4746645,17z');
  assert.equal(p.name, 'Charminar');
  assert.deepEqual(p.ll, [17.3615636, 78.4746645]);
  assert.equal(mapsInfo('https://example.com/maps/place/x'), null);
});

test('link previews: readable title from a blocked site address', () => {
  assert.equal(titleFromPath('https://in.bookmyshow.com/hyderabad/movies/kalki-2898-ad/ET00352941'), 'Kalki 2898 Ad');
});
