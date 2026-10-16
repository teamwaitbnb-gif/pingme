// Source registry for Buzz. Adding a publisher = one entry here (plus an adapter only for a new kind
// of API). Each source: id, name, url, adapter, enabled, poll interval, timeout, credentials,
// region (a city, 'india' or 'world') and topic. Runtime state (last success, next retry, status,
// ETag…) lives in the feed_sources table.
const GN = (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}+when:1d&hl=en-IN&gl=IN&ceid=IN:en`;
const min = (n) => n * 60000;

const CITIES = {
  hyderabad: { name: 'Hyderabad', lat: 17.385, lon: 78.4867 },
  bengaluru: { name: 'Bengaluru', lat: 12.9716, lon: 77.5946 },
  mumbai: { name: 'Mumbai', lat: 19.076, lon: 72.8777 },
  delhi: { name: 'Delhi', lat: 28.6139, lon: 77.209 },
  chennai: { name: 'Chennai', lat: 13.0827, lon: 80.2707 },
  kolkata: { name: 'Kolkata', lat: 22.5726, lon: 88.3639 },
  pune: { name: 'Pune', lat: 18.5204, lon: 73.8567 },
};

const SOURCES = [
  // ── Hyderabad ──
  { id: 'hindu-hyd', name: 'The Hindu · Hyderabad', site: 'thehindu.com', url: 'https://www.thehindu.com/news/cities/Hyderabad/feeder/default.rss', region: 'hyderabad', topic: 'local', poll: min(5) },
  { id: 'toi-hyd', name: 'Times of India · Hyderabad', site: 'indiatimes.com', url: 'https://timesofindia.indiatimes.com/rssfeeds/-2128816011.cms', region: 'hyderabad', topic: 'local', poll: min(5) },
  { id: 'telangana-today', name: 'Telangana Today', site: 'telanganatoday.com', url: 'https://telanganatoday.com/hyderabad/feed', region: 'hyderabad', topic: 'local', poll: min(5) },
  { id: 'siasat', name: 'The Siasat Daily', site: 'siasat.com', url: 'https://www.siasat.com/feed/', region: 'hyderabad', topic: 'local', poll: min(6) },
  { id: 'gn-hyd', name: 'Google News · Hyderabad', site: 'news.google.com', url: GN('Hyderabad'), region: 'hyderabad', topic: 'local', poll: min(8), aggregator: true },
  { id: 'gn-tollywood', name: 'Google News · Tollywood', site: 'news.google.com', url: GN('Tollywood'), region: 'hyderabad', topic: 'entertainment', poll: min(15), aggregator: true },
  // ── Other cities ──
  { id: 'hindu-blr', name: 'The Hindu · Bengaluru', site: 'thehindu.com', url: 'https://www.thehindu.com/news/cities/Bangalore/feeder/default.rss', region: 'bengaluru', topic: 'local', poll: min(6) },
  { id: 'toi-blr', name: 'Times of India · Bengaluru', site: 'indiatimes.com', url: 'https://timesofindia.indiatimes.com/rssfeeds/-2128833038.cms', region: 'bengaluru', topic: 'local', poll: min(6) },
  { id: 'hindu-mum', name: 'The Hindu · Mumbai', site: 'thehindu.com', url: 'https://www.thehindu.com/news/cities/Mumbai/feeder/default.rss', region: 'mumbai', topic: 'local', poll: min(6) },
  { id: 'toi-mum', name: 'Times of India · Mumbai', site: 'indiatimes.com', url: 'https://timesofindia.indiatimes.com/rssfeeds/-2128838597.cms', region: 'mumbai', topic: 'local', poll: min(6) },
  { id: 'hindu-del', name: 'The Hindu · Delhi', site: 'thehindu.com', url: 'https://www.thehindu.com/news/cities/Delhi/feeder/default.rss', region: 'delhi', topic: 'local', poll: min(6) },
  { id: 'toi-del', name: 'Times of India · Delhi', site: 'indiatimes.com', url: 'https://timesofindia.indiatimes.com/rssfeeds/-2128839596.cms', region: 'delhi', topic: 'local', poll: min(6) },
  { id: 'hindu-che', name: 'The Hindu · Chennai', site: 'thehindu.com', url: 'https://www.thehindu.com/news/cities/Chennai/feeder/default.rss', region: 'chennai', topic: 'local', poll: min(6) },
  { id: 'toi-che', name: 'Times of India · Chennai', site: 'indiatimes.com', url: 'https://timesofindia.indiatimes.com/rssfeeds/2950623.cms', region: 'chennai', topic: 'local', poll: min(6) },
  { id: 'hindu-kol', name: 'The Hindu · Kolkata', site: 'thehindu.com', url: 'https://www.thehindu.com/news/cities/Kolkata/feeder/default.rss', region: 'kolkata', topic: 'local', poll: min(6) },
  { id: 'toi-kol', name: 'Times of India · Kolkata', site: 'indiatimes.com', url: 'https://timesofindia.indiatimes.com/rssfeeds/-2128830821.cms', region: 'kolkata', topic: 'local', poll: min(6) },
  { id: 'toi-pune', name: 'Times of India · Pune', site: 'indiatimes.com', url: 'https://timesofindia.indiatimes.com/rssfeeds/-2128821991.cms', region: 'pune', topic: 'local', poll: min(6) },
  // ── India ──
  { id: 'hindu-national', name: 'The Hindu', site: 'thehindu.com', url: 'https://www.thehindu.com/news/national/feeder/default.rss', region: 'india', topic: 'india', poll: min(5) },
  { id: 'ndtv', name: 'NDTV', site: 'ndtv.com', url: 'https://feeds.feedburner.com/ndtvnews-top-stories', region: 'india', topic: 'india', poll: min(5) },
  { id: 'indian-express', name: 'The Indian Express', site: 'indianexpress.com', url: 'https://indianexpress.com/feed/', region: 'india', topic: 'india', poll: min(5) },
  { id: 'gn-india', name: 'Google News · India top stories', site: 'news.google.com', url: 'https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en', region: 'india', topic: 'india', poll: min(5), aggregator: true, topList: true },
  // ── Tech ──
  { id: 'hn', name: 'Hacker News', site: 'news.ycombinator.com', url: 'https://hacker-news.firebaseio.com/v0/topstories.json', adapter: 'hn', region: 'world', topic: 'tech', poll: min(4) },
  { id: 'verge', name: 'The Verge', site: 'theverge.com', url: 'https://www.theverge.com/rss/index.xml', region: 'world', topic: 'tech', poll: min(8) },
  { id: 'techcrunch', name: 'TechCrunch', site: 'techcrunch.com', url: 'https://techcrunch.com/feed/', region: 'world', topic: 'tech', poll: min(8) },
  { id: 'ars', name: 'Ars Technica', site: 'arstechnica.com', url: 'https://feeds.arstechnica.com/arstechnica/index', region: 'world', topic: 'tech', poll: min(10) },
  { id: 'gadgets360', name: 'Gadgets 360', site: 'gadgets360.com', url: 'https://feeds.feedburner.com/gadgets360-latest', region: 'india', topic: 'tech', poll: min(8) },
  // ── Business ──
  { id: 'et', name: 'The Economic Times', site: 'indiatimes.com', url: 'https://economictimes.indiatimes.com/rssfeedstopstories.cms', region: 'india', topic: 'business', poll: min(5) },
  { id: 'mint', name: 'Mint · Markets', site: 'livemint.com', url: 'https://www.livemint.com/rss/markets', region: 'india', topic: 'business', poll: min(6) },
  { id: 'moneycontrol', name: 'Moneycontrol', site: 'moneycontrol.com', url: 'https://www.moneycontrol.com/rss/latestnews.xml', region: 'india', topic: 'business', poll: min(6) },
  { id: 'cnbc', name: 'CNBC', site: 'cnbc.com', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', region: 'world', topic: 'business', poll: min(8) },
  // ── World ──
  { id: 'bbc-world', name: 'BBC News · World', site: 'bbc.co.uk', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', region: 'world', topic: 'world', poll: min(6) },
  { id: 'aljazeera', name: 'Al Jazeera', site: 'aljazeera.com', url: 'https://www.aljazeera.com/xml/rss/all.xml', region: 'world', topic: 'world', poll: min(8) },
  { id: 'guardian-world', name: 'The Guardian · World', site: 'theguardian.com', url: 'https://www.theguardian.com/world/rss', region: 'world', topic: 'world', poll: min(8) },
  { id: 'npr-world', name: 'NPR · World', site: 'npr.org', url: 'https://feeds.npr.org/1004/rss.xml', region: 'world', topic: 'world', poll: min(10) },
  // ── Sports & entertainment ──
  { id: 'cricinfo', name: 'ESPNcricinfo', site: 'espncricinfo.com', url: 'https://www.espncricinfo.com/rss/content/story/feeds/0.xml', region: 'india', topic: 'sports', poll: min(6) },
  { id: 'ht-entertainment', name: 'Hindustan Times · Entertainment', site: 'hindustantimes.com', url: 'https://www.hindustantimes.com/feeds/rss/entertainment/rssfeed.xml', region: 'india', topic: 'entertainment', poll: min(8) },
  // ── Google Trends: what people in each state are searching for right now (real search volume) ──
  ...[['india', 'IN', 'India'], ['hyderabad', 'IN-TG', 'Telangana'], ['bengaluru', 'IN-KA', 'Karnataka'], ['mumbai', 'IN-MH', 'Maharashtra'],
    ['delhi', 'IN-DL', 'Delhi'], ['chennai', 'IN-TN', 'Tamil Nadu'], ['kolkata', 'IN-WB', 'West Bengal']].map(([region, geo, area]) => ({
    id: 'trends-' + geo.toLowerCase(), name: `Google Trends · ${area}`, site: 'trends.google.com', url: `https://trends.google.com/trending/rss?geo=${geo}`,
    adapter: 'trends', region, topic: region === 'india' ? 'india' : 'local', area, poll: min(10), aggregator: true, trends: true,
  })),
  // ── Optional platforms: need documented API access, so off until credentials are configured ──
  { id: 'youtube-in', name: 'YouTube · Popular in India', site: 'youtube.com', url: 'https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&chart=mostPopular&regionCode=IN&maxResults=20', adapter: 'youtube', region: 'india', topic: 'video', poll: min(30), credentials: 'YOUTUBE_API_KEY' },
  { id: 'reddit-india', name: 'Reddit · r/india', site: 'reddit.com', url: 'https://oauth.reddit.com/r/india/hot?limit=25', adapter: 'reddit', region: 'india', topic: 'india', poll: min(15), credentials: 'REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET' },
].map((s) => ({ adapter: 'rss', timeout: 9000, ...s, enabled: s.credentials ? s.credentials.split(' + ').every((k) => !!process.env[k]) : true }));

module.exports = { SOURCES, CITIES, byId: (id) => SOURCES.find((s) => s.id === id) };
