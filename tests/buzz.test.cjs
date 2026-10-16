const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseFeed } = require('../server/buzz/collect');
const N = require('../server/buzz/normalize');

const src = { id: 't', url: 'https://example.com/feed', site: 'example.com' };

test('RSS: CDATA, entities, media:content, enclosure, relative links', () => {
  const xml = `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel>
    <item><title><![CDATA[Metro &amp; flyover open in Hyderabad]]></title><link>/news/metro?utm_source=rss&amp;id=7</link>
      <description><![CDATA[<p>The new line <b>opens</b> today. It connects two hubs. Officials expect huge crowds.</p>]]></description>
      <pubDate>Thu, 15 Oct 2026 10:00:00 +0530</pubDate><media:content url="https://example.com/a.jpg" medium="image"/></item>
    <item><title>Second</title><link>https://example.com/b</link><enclosure url="https://example.com/b.mp4" type="video/mp4"/></item>
  </channel></rss>`;
  const [a, b] = parseFeed(xml, src);
  assert.equal(a.title, 'Metro & flyover open in Hyderabad');
  assert.equal(a.url, 'https://example.com/news/metro?id=7'); // relative resolved, tracking stripped, id kept
  assert.equal(a.image, 'https://example.com/a.jpg');
  assert.match(a.description, /^The new line opens today\./);
  assert.equal(a.publishedAt, Date.parse('Thu, 15 Oct 2026 10:00:00 +0530'));
  assert.equal(b.video, 'https://example.com/b.mp4');
  assert.equal(b.publishedAt, null); // never invented
});

test('Atom: alternate link, summary, updated date, media:thumbnail', () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
    <entry><title type="html">Chip &lt;news&gt;</title><link rel="self" href="https://example.com/self"/><link rel="alternate" href="https://example.com/chip"/>
      <summary>New chips announced. They are fast and efficient for phones.</summary><updated>2026-10-15T08:00:00Z</updated>
      <media:thumbnail url="https://example.com/t.png"/></entry></feed>`;
  const [e] = parseFeed(xml, src);
  assert.equal(e.title, 'Chip'); // type="html": &lt;news&gt; is markup, so it is stripped (never rendered as HTML)
  assert.equal(e.url, 'https://example.com/chip');
  assert.equal(e.image, 'https://example.com/t.png');
  assert.equal(e.publishedAt, Date.parse('2026-10-15T08:00:00Z'));
});

test('rejects invalid feeds and ignores inline DTD entities', () => {
  assert.throws(() => parseFeed('<html><body>nope</body></html>', src), /RSS or Atom/);
  const bomb = `<?xml version="1.0"?><!DOCTYPE r [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;">]><rss><channel><item><title>&b;ok</title><link>https://example.com/x</link></item></channel></rss>`;
  const [x] = parseFeed(bomb, src);
  assert.ok(!x.title.includes('aaaaaaaaaa'));
});

test('text is plain: tags and scripts removed, entities decoded', () => {
  assert.equal(N.text('<script>alert(1)</script>Hello &amp; <b>world</b>'), 'Hello & world');
  assert.equal(N.text('&lt;img src=x onerror=1&gt;Hi'), 'Hi');
});

test('summaries: 2–3 real sentences, boilerplate removed, nothing invented', () => {
  const long = 'First sentence is here. ' + 'Middle sentence with details about the city. '.repeat(12) + 'The post Foo appeared first on Bar.';
  const s = N.summarize(long, 'Title');
  assert.ok(s.length <= 400 && s.startsWith('First sentence is here.'));
  assert.ok(!s.includes('appeared first'));
  assert.equal(N.summarize('', 'x'), null);
  assert.equal(N.summarize('Title', 'Title'), null);
});

test('canonical URLs: strip tracking, keep article ids, reject non-http', () => {
  assert.equal(N.canonical('https://Example.com/a?utm_medium=x&fbclid=1&page=2#top'), 'https://example.com/a?page=2');
  assert.equal(N.canonical('javascript:alert(1)'), null);
  assert.equal(N.idFor('https://example.com/a'), N.idFor('https://example.com/a'));
});
