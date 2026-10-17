// Source registry for Buzz. Adding a publisher = one entry here (plus an adapter only for a new kind
// of API). Cities are generated from the table below: each gets its Times of India and The Hindu
// city feeds where they exist, a Google News local search, and Google Trends for its state.
// Runtime state (last success, next retry, status, ETag…) lives in the feed_sources table.
const GN = (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}+when:1d&hl=en-IN&gl=IN&ceid=IN:en`;
const TOI = (id) => `https://timesofindia.indiatimes.com/rssfeeds/${id}.cms`;
const HINDU = (slug) => `https://www.thehindu.com/news/cities/${slug}/feeder/default.rss`;
const min = (n) => n * 60000;

// key: [name, lat, lon, state Google Trends geo, state name, The Hindu slug, TOI feed id(s)]
const CITY_TABLE = {
  hyderabad: ['Hyderabad', 17.385, 78.4867, 'IN-TG', 'Telangana', 'Hyderabad', ['-2128816011']],
  bengaluru: ['Bengaluru', 12.9716, 77.5946, 'IN-KA', 'Karnataka', 'Bangalore', ['-2128833038']],
  mumbai: ['Mumbai', 19.076, 72.8777, 'IN-MH', 'Maharashtra', 'Mumbai', ['-2128838597', '3831863']],
  delhi: ['Delhi NCR', 28.6139, 77.209, 'IN-DL', 'Delhi', 'Delhi', ['-2128839596', '6547154', '8021716']],
  chennai: ['Chennai', 13.0827, 80.2707, 'IN-TN', 'Tamil Nadu', 'Chennai', ['2950623']],
  kolkata: ['Kolkata', 22.5726, 88.3639, 'IN-WB', 'West Bengal', 'Kolkata', ['-2128830821']],
  pune: ['Pune', 18.5204, 73.8567, 'IN-MH', 'Maharashtra', null, ['-2128821991']],
  ahmedabad: ['Ahmedabad', 23.0225, 72.5714, 'IN-GJ', 'Gujarat', null, ['-2128821153']],
  jaipur: ['Jaipur', 26.9124, 75.7873, 'IN-RJ', 'Rajasthan', null, ['3012544']],
  lucknow: ['Lucknow', 26.8467, 80.9462, 'IN-UP', 'Uttar Pradesh', null, ['-2128819658']],
  chandigarh: ['Chandigarh', 30.7333, 76.7794, 'IN-CH', 'Chandigarh', null, ['-2128816762']],
  kochi: ['Kochi', 9.9312, 76.2673, 'IN-KL', 'Kerala', 'Kochi', []],
  thiruvananthapuram: ['Thiruvananthapuram', 8.5241, 76.9366, 'IN-KL', 'Kerala', 'Thiruvananthapuram', ['878156304']],
  kozhikode: ['Kozhikode', 11.2588, 75.7804, 'IN-KL', 'Kerala', 'kozhikode', []],
  coimbatore: ['Coimbatore', 11.0168, 76.9558, 'IN-TN', 'Tamil Nadu', 'Coimbatore', ['7503091']],
  madurai: ['Madurai', 9.9252, 78.1198, 'IN-TN', 'Tamil Nadu', 'Madurai', []],
  tiruchirappalli: ['Tiruchirappalli', 10.7905, 78.7047, 'IN-TN', 'Tamil Nadu', 'Tiruchirapalli', []],
  visakhapatnam: ['Visakhapatnam', 17.6868, 83.2185, 'IN-AP', 'Andhra Pradesh', 'Visakhapatnam', []],
  vijayawada: ['Vijayawada', 16.5062, 80.648, 'IN-AP', 'Andhra Pradesh', 'Vijayawada', []],
  mangaluru: ['Mangaluru', 12.9141, 74.856, 'IN-KA', 'Karnataka', null, ['3942690']],
  mysuru: ['Mysuru', 12.2958, 76.6394, 'IN-KA', 'Karnataka', null, ['3942693']],
  hubballi: ['Hubballi', 15.3647, 75.124, 'IN-KA', 'Karnataka', null, ['3942695']],
  bhubaneswar: ['Bhubaneswar', 20.2961, 85.8245, 'IN-OR', 'Odisha', null, ['4118235']],
  guwahati: ['Guwahati', 26.1445, 91.7362, 'IN-AS', 'Assam', null, ['4118215']],
  patna: ['Patna', 25.5941, 85.1376, 'IN-BR', 'Bihar', null, ['-2128817995']],
  ranchi: ['Ranchi', 23.3441, 85.3096, 'IN-JH', 'Jharkhand', null, ['4118245']],
  nagpur: ['Nagpur', 21.1458, 79.0882, 'IN-MH', 'Maharashtra', null, ['442002']],
  surat: ['Surat', 21.1702, 72.8311, 'IN-GJ', 'Gujarat', null, ['3942660']],
  vadodara: ['Vadodara', 22.3072, 73.1812, 'IN-GJ', 'Gujarat', null, ['3942666']],
  rajkot: ['Rajkot', 22.3039, 70.8022, 'IN-GJ', 'Gujarat', null, ['3942663']],
  goa: ['Goa', 15.4909, 73.8278, 'IN-GA', 'Goa', null, ['3012535']],
  kanpur: ['Kanpur', 26.4499, 80.3319, 'IN-UP', 'Uttar Pradesh', null, ['3947067']],
  varanasi: ['Varanasi', 25.3176, 82.9739, 'IN-UP', 'Uttar Pradesh', null, ['3947071']],
  prayagraj: ['Prayagraj', 25.4358, 81.8463, 'IN-UP', 'Uttar Pradesh', null, ['3947060']],
  ludhiana: ['Ludhiana', 30.901, 75.8573, 'IN-PB', 'Punjab', null, ['3947051']],
};

const CITIES = Object.fromEntries(Object.entries(CITY_TABLE).map(([k, [name, lat, lon, geo, state]]) => [k, { name, lat, lon, geo, state }]));
const STATE_OF = Object.fromEntries(Object.entries(CITY_TABLE).map(([k, c]) => [k, c[4]]));

const citySources = Object.entries(CITY_TABLE).flatMap(([key, [name, , , , , hindu, toi]]) => [
  ...(hindu ? [{ id: `hindu-${key}`, name: `The Hindu · ${name}`, site: 'thehindu.com', url: HINDU(hindu), region: key, topic: 'local', poll: min(6) }] : []),
  ...toi.map((id, i) => ({ id: `toi-${key}${i ? '-' + i : ''}`, name: `Times of India · ${name}`, site: 'indiatimes.com', url: TOI(id), region: key, topic: 'local', poll: min(6) })),
  { id: `gn-${key}`, name: `Google News · ${name}`, site: 'news.google.com', url: GN(name.replace(' NCR', '')), region: key, topic: 'local', poll: min(10), aggregator: true },
]);

// Google Trends for every state that has a city above (plus all of India).
const STATES = [...new Map(Object.entries(CITY_TABLE).map(([key, c]) => [c[3], { geo: c[3], area: c[4], region: key }])).values()];
const trendSources = [{ geo: 'IN', area: 'India', region: 'india' }, ...STATES].map(({ geo, area, region }) => ({
  id: 'trends-' + geo.toLowerCase(), name: `Google Trends · ${area}`, site: 'trends.google.com', url: `https://trends.google.com/trending/rss?geo=${geo}`,
  adapter: 'trends', region, topic: region === 'india' ? 'india' : 'local', area, poll: min(10), aggregator: true, trends: true,
}));

const SOURCES = [
  // ── Hyderabad extras ──
  { id: 'telangana-today', name: 'Telangana Today', site: 'telanganatoday.com', url: 'https://telanganatoday.com/hyderabad/feed', region: 'hyderabad', topic: 'local', poll: min(5) },
  { id: 'siasat', name: 'The Siasat Daily', site: 'siasat.com', url: 'https://www.siasat.com/feed/', region: 'hyderabad', topic: 'local', poll: min(6) },
  { id: 'gn-tollywood', name: 'Google News · Tollywood', site: 'news.google.com', url: GN('Tollywood'), region: 'hyderabad', topic: 'entertainment', poll: min(15), aggregator: true },
  { id: '123telugu', name: '123telugu', site: '123telugu.com', url: 'https://www.123telugu.com/feed', region: 'hyderabad', topic: 'entertainment', poll: min(15) },
  ...citySources,
  // ── India ──
  { id: 'hindu-national', name: 'The Hindu', site: 'thehindu.com', url: 'https://www.thehindu.com/news/national/feeder/default.rss', region: 'india', topic: 'india', poll: min(5) },
  { id: 'ndtv', name: 'NDTV', site: 'ndtv.com', url: 'https://feeds.feedburner.com/ndtvnews-top-stories', region: 'india', topic: 'india', poll: min(5) },
  { id: 'indian-express', name: 'The Indian Express', site: 'indianexpress.com', url: 'https://indianexpress.com/feed/', region: 'india', topic: 'india', poll: min(5) },
  { id: 'india-today', name: 'India Today', site: 'indiatoday.in', url: 'https://www.indiatoday.in/rss/home', region: 'india', topic: 'india', poll: min(5) },
  { id: 'ht-india', name: 'Hindustan Times', site: 'hindustantimes.com', url: 'https://www.hindustantimes.com/feeds/rss/india-news/rssfeed.xml', region: 'india', topic: 'india', poll: min(6) },
  { id: 'ht-cities', name: 'Hindustan Times · Cities', site: 'hindustantimes.com', url: 'https://www.hindustantimes.com/feeds/rss/cities/rssfeed.xml', region: 'india', topic: 'india', poll: min(8) },
  { id: 'toi-india', name: 'Times of India', site: 'indiatimes.com', url: TOI('-2128936835'), region: 'india', topic: 'india', poll: min(5) },
  { id: 'scroll', name: 'Scroll', site: 'scroll.in', url: 'https://feeds.feedburner.com/ScrollinArticles.rss', region: 'india', topic: 'india', poll: min(10) },
  { id: 'nie', name: 'The New Indian Express', site: 'newindianexpress.com', url: 'https://www.newindianexpress.com/feed', region: 'india', topic: 'india', poll: min(8) },
  { id: 'gn-india', name: 'Google News · India top stories', site: 'news.google.com', url: 'https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en', region: 'india', topic: 'india', poll: min(5), aggregator: true, topList: true },
  // ── Tech & startups ──
  { id: 'hn', name: 'Hacker News', site: 'news.ycombinator.com', url: 'https://hacker-news.firebaseio.com/v0/topstories.json', adapter: 'hn', region: 'world', topic: 'tech', poll: min(4) },
  { id: 'verge', name: 'The Verge', site: 'theverge.com', url: 'https://www.theverge.com/rss/index.xml', region: 'world', topic: 'tech', poll: min(8) },
  { id: 'techcrunch', name: 'TechCrunch', site: 'techcrunch.com', url: 'https://techcrunch.com/feed/', region: 'world', topic: 'tech', poll: min(8) },
  { id: 'ars', name: 'Ars Technica', site: 'arstechnica.com', url: 'https://feeds.arstechnica.com/arstechnica/index', region: 'world', topic: 'tech', poll: min(10) },
  { id: 'wired', name: 'Wired', site: 'wired.com', url: 'https://www.wired.com/feed/rss', region: 'world', topic: 'tech', poll: min(12) },
  { id: 'engadget', name: 'Engadget', site: 'engadget.com', url: 'https://www.engadget.com/rss.xml', region: 'world', topic: 'tech', poll: min(10) },
  { id: 'androidauthority', name: 'Android Authority', site: 'androidauthority.com', url: 'https://www.androidauthority.com/feed/', region: 'world', topic: 'tech', poll: min(15) },
  { id: '9to5mac', name: '9to5Mac', site: '9to5mac.com', url: 'https://9to5mac.com/feed/', region: 'world', topic: 'tech', poll: min(15) },
  { id: 'gadgets360', name: 'Gadgets 360', site: 'gadgets360.com', url: 'https://feeds.feedburner.com/gadgets360-latest', region: 'india', topic: 'tech', poll: min(8) },
  { id: 'et-tech', name: 'ET Tech', site: 'indiatimes.com', url: 'https://economictimes.indiatimes.com/tech/rssfeeds/13357270.cms', region: 'india', topic: 'tech', poll: min(8) },
  { id: 'toi-tech', name: 'Times of India · Tech', site: 'indiatimes.com', url: TOI('66949542'), region: 'india', topic: 'tech', poll: min(10) },
  { id: 'hindu-scitech', name: 'The Hindu · Technology', site: 'thehindu.com', url: 'https://www.thehindu.com/sci-tech/technology/feeder/default.rss', region: 'india', topic: 'tech', poll: min(12) },
  { id: 'yourstory', name: 'YourStory', site: 'yourstory.com', url: 'https://yourstory.com/feed', region: 'india', topic: 'business', poll: min(12) },
  { id: 'inc42', name: 'Inc42', site: 'inc42.com', url: 'https://inc42.com/feed/', region: 'india', topic: 'business', poll: min(12) },
  // ── Business ──
  { id: 'et', name: 'The Economic Times', site: 'indiatimes.com', url: 'https://economictimes.indiatimes.com/rssfeedstopstories.cms', region: 'india', topic: 'business', poll: min(5) },
  { id: 'mint', name: 'Mint · Markets', site: 'livemint.com', url: 'https://www.livemint.com/rss/markets', region: 'india', topic: 'business', poll: min(6) },
  { id: 'mint-news', name: 'Mint', site: 'livemint.com', url: 'https://www.livemint.com/rss/news', region: 'india', topic: 'business', poll: min(8) },
  { id: 'hindu-business', name: 'The Hindu · Business', site: 'thehindu.com', url: 'https://www.thehindu.com/business/feeder/default.rss', region: 'india', topic: 'business', poll: min(8) },
  { id: 'toi-business', name: 'Times of India · Business', site: 'indiatimes.com', url: TOI('1898055'), region: 'india', topic: 'business', poll: min(8) },
  { id: 'moneycontrol', name: 'Moneycontrol', site: 'moneycontrol.com', url: 'https://www.moneycontrol.com/rss/latestnews.xml', region: 'india', topic: 'business', poll: min(6) },
  { id: 'cnbc', name: 'CNBC', site: 'cnbc.com', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', region: 'world', topic: 'business', poll: min(8) },
  // ── World ──
  { id: 'bbc-world', name: 'BBC News · World', site: 'bbc.co.uk', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', region: 'world', topic: 'world', poll: min(6) },
  { id: 'nyt-world', name: 'The New York Times · World', site: 'nytimes.com', url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', region: 'world', topic: 'world', poll: min(8) },
  { id: 'cnn-world', name: 'CNN · World', site: 'cnn.com', url: 'http://rss.cnn.com/rss/edition_world.rss', region: 'world', topic: 'world', poll: min(8) },
  { id: 'aljazeera', name: 'Al Jazeera', site: 'aljazeera.com', url: 'https://www.aljazeera.com/xml/rss/all.xml', region: 'world', topic: 'world', poll: min(8) },
  { id: 'guardian-world', name: 'The Guardian · World', site: 'theguardian.com', url: 'https://www.theguardian.com/world/rss', region: 'world', topic: 'world', poll: min(8) },
  { id: 'france24', name: 'France 24', site: 'france24.com', url: 'https://www.france24.com/en/rss', region: 'world', topic: 'world', poll: min(10) },
  { id: 'dw', name: 'DW', site: 'dw.com', url: 'https://rss.dw.com/rdf/rss-en-world', region: 'world', topic: 'world', poll: min(12) },
  { id: 'npr-world', name: 'NPR · World', site: 'npr.org', url: 'https://feeds.npr.org/1004/rss.xml', region: 'world', topic: 'world', poll: min(10) },
  { id: 'hindu-intl', name: 'The Hindu · World', site: 'thehindu.com', url: 'https://www.thehindu.com/news/international/feeder/default.rss', region: 'world', topic: 'world', poll: min(10) },
  { id: 'toi-world', name: 'Times of India · World', site: 'indiatimes.com', url: TOI('296589292'), region: 'world', topic: 'world', poll: min(10) },
  // ── Sports ──
  { id: 'cricinfo', name: 'ESPNcricinfo', site: 'espncricinfo.com', url: 'https://www.espncricinfo.com/rss/content/story/feeds/0.xml', region: 'india', topic: 'sports', poll: min(6) },
  { id: 'toi-cricket', name: 'Times of India · Cricket', site: 'indiatimes.com', url: TOI('54829575'), region: 'india', topic: 'sports', poll: min(8) },
  { id: 'sportstar', name: 'Sportstar', site: 'thehindu.com', url: 'https://sportstar.thehindu.com/feeder/default.rss', region: 'india', topic: 'sports', poll: min(8) },
  { id: 'ndtv-sports', name: 'NDTV Sports', site: 'ndtv.com', url: 'https://feeds.feedburner.com/ndtvsports-latest', region: 'india', topic: 'sports', poll: min(8) },
  { id: 'hindu-sport', name: 'The Hindu · Sport', site: 'thehindu.com', url: 'https://www.thehindu.com/sport/feeder/default.rss', region: 'india', topic: 'sports', poll: min(10) },
  { id: 'espn', name: 'ESPN', site: 'espn.com', url: 'https://www.espn.com/espn/rss/news', region: 'world', topic: 'sports', poll: min(12) },
  // ── Entertainment ──
  { id: 'ht-entertainment', name: 'Hindustan Times · Entertainment', site: 'hindustantimes.com', url: 'https://www.hindustantimes.com/feeds/rss/entertainment/rssfeed.xml', region: 'india', topic: 'entertainment', poll: min(8) },
  { id: 'toi-entertainment', name: 'Times of India · Entertainment', site: 'indiatimes.com', url: TOI('1081479906'), region: 'india', topic: 'entertainment', poll: min(10) },
  { id: 'hindu-entertainment', name: 'The Hindu · Entertainment', site: 'thehindu.com', url: 'https://www.thehindu.com/entertainment/feeder/default.rss', region: 'india', topic: 'entertainment', poll: min(12) },
  { id: 'pinkvilla', name: 'Pinkvilla', site: 'pinkvilla.com', url: 'https://www.pinkvilla.com/rss.xml', region: 'india', topic: 'entertainment', poll: min(12) },
  { id: 'bollywoodhungama', name: 'Bollywood Hungama', site: 'bollywoodhungama.com', url: 'https://www.bollywoodhungama.com/feed/', region: 'india', topic: 'entertainment', poll: min(15) },
  ...trendSources,
  // ── Video: news channels' own YouTube feeds (no key needed) — they play right inside Buzz ──
  ...[
    ['ndtv', 'NDTV', 'UCZFMm1mMw0F81Z37aaEzTUA', 'india', 'india'],
    ['indiatoday', 'India Today', 'UCYPvAwZP8pZhSMW8qs7cVCw', 'india', 'india'],
    ['timesnow', 'Times Now', 'UC6RJ7-PaXg6TIH2BzZfTV7w', 'india', 'india'],
    ['news18', 'CNN-News18', 'UCef1-8eOpJgud7szVPlZQAQ', 'india', 'india'],
    ['republic', 'Republic World', 'UCwqusr8YDwM-3mEYTDeJHzw', 'india', 'india'],
    ['tv9telugu', 'TV9 Telugu', 'UCPXTXMecYqnRKNdqdVOGSFg', 'hyderabad', 'local'],
    ['ntvtelugu', 'NTV Telugu', 'UCumtYpCY26F6Jr3satUgMvA', 'hyderabad', 'local'],
    ['cnbctv18', 'CNBC-TV18', 'UCmRbHAgG2k2vDUvb3xsEunQ', 'india', 'business'],
    ['icc', 'ICC', 'UCt2JXOLNxqry7B_4rRZME3Q', 'world', 'sports'],
    ['mkbhd', 'Marques Brownlee', 'UCBJycsmduvYEL83R_U4JriQ', 'world', 'tech'],
    ['wion', 'WION', 'UC_gUM8rL-Lrg6O3adPW9K1g', 'world', 'world'],
    ['firstpost', 'Firstpost', 'UCz8QaiQxApLq8sLNcszYyJw', 'world', 'world'],
    ['bbc', 'BBC News', 'UC16niRr50-MSBwiO3YDb3RA', 'world', 'world'],
    ['aljazeera', 'Al Jazeera English', 'UCNye-wNBqNL5ZzHSJj3l8Bg', 'world', 'world'],
    ['reuters', 'Reuters', 'UChqUTb7kYRX8-EiaN3XFrSQ', 'world', 'world'],
    ['dw', 'DW News', 'UCknLrEdhRCp1aegoMqRaCZg', 'world', 'world'],
  ].map(([id, name, ch, region, topic]) => ({ id: 'yt-' + id, name: `${name} · YouTube`, site: 'youtube.com', url: `https://www.youtube.com/feeds/videos.xml?channel_id=${ch}`, region, topic, poll: min(15), social: true, video: true })),
  // ── Entertainment, movies, music, cricket and viral video: official YouTube channel feeds (free,
  // no key). Every channel was checked to be live and posting. They play right inside Buzz.
  ...[
    // movies, trailers, songs, shows (all of India)
    ['tseries', 'T-Series', 'UCq-Fj5jknLsUf-MWSy4_brA', 'india'], ['sonymusic', 'Sony Music India', 'UC56gTxNs4f9xZ7Pa2i5xNzg', 'india'],
    ['zeemusic', 'Zee Music Company', 'UCFFbwnve3yF62-tVXkTyHqg', 'india'], ['saregama', 'Saregama Music', 'UC_A7K2dXFsTMAciGmnNxy-Q', 'india'],
    ['yrf', 'YRF', 'UCbTLwN10NoCU4WDzLf1JMOA', 'india'], ['netflixindia', 'Netflix India', 'UCZSNzBgFub_WWil6TOTYwAg', 'india'],
    ['primevideoin', 'Prime Video India', 'UC4zWG9LccdWGUlF77LZ8toA', 'india'], ['jiohotstar', 'JioHotstar', 'UC0PTktRYpZXb6On0_zFKWIg', 'india'],
    ['sonyliv', 'Sony LIV', 'UCOQNJjhXwvAScuELTT_i7cQ', 'india'], ['zee5', 'ZEE5', 'UCXOgAl4w-FQero1ERbGHpXQ', 'india'],
    ['colorstv', 'Colors TV', 'UC55IWqFLDH1Xp7iu1_xknRA', 'india'], ['starplus', 'StarPlus', 'UC-LPIU24bQXVljUXivKEeRQ', 'india'],
    ['zoom', 'Zoom', 'UCotI-SqRXnkAZX4bMqlRNjw', 'india'], ['pinkvilla', 'Pinkvilla', 'UCkJZQddO3XTCdcLjN019FjA', 'india'],
    // viral creators
    ['bbkivines', 'BB Ki Vines', 'UCqwUrj10mAEsqezcItqvwEw', 'india'], ['carryminati', 'CarryMinati', 'UCj22tfcQrWG7EMEKS0qLeEg', 'india'],
    ['ashishchanchlani', 'Ashish Chanchlani Vines', 'UC7eHZXheF8nVOfwB2PEslMw', 'india'], ['mrbeast', 'MrBeast', 'UCX6OQ3DkcsbYNE6H8uQQuVA', 'world'],
    ['dudeperfect', 'Dude Perfect', 'UCRijo3ddMTht_IHyNSNXpNQ', 'world'], ['ladbible', 'LADbible', 'UCYRE3PMYatMVXmqmulF0sgA', 'world'],
    ['netflix', 'Netflix', 'UCWOA1ZGywLbqmigxE4Qlvuw', 'world'],
    // regional cinema (shown in those cities, and to people who like it)
    ['adityamusic', 'Aditya Music', 'UCNApqoVYJbYSrni4YsbXzyQ', 'hyderabad'], ['tseriestelugu', 'T-Series Telugu', 'UCnJjcn5FrgrOEp5_N45ZLEQ', 'hyderabad'],
    ['mythri', 'Mythri Movie Makers', 'UCKZSn5C-RzrLjuWJF8wWiDw', 'hyderabad'], ['telugufilmnagar', 'Telugu Filmnagar', 'UCintIUOJEktQBfhEI9XXpuw', 'hyderabad'],
    ['suntv', 'Sun TV', 'UCBnxEdpoZwstJqC1yZpOjRA', 'chennai'], ['thinkmusic', 'Think Music India', 'UCLbdVvreihwZRL6kwuEUYsA', 'chennai'],
    ['sonymusicsouth', 'Sony Music South', 'UCTNtRdBAiZtHP9w7JinzfUg', 'chennai'], ['hombale', 'Hombale Films', 'UCarJoVXH0T2pdtcHBu9J8Bw', 'bengaluru'],
  ].map(([id, name, ch, region]) => ({ id: 'yt-' + id, name: `${name} · YouTube`, site: 'youtube.com', url: `https://www.youtube.com/feeds/videos.xml?channel_id=${ch}`, region, topic: 'entertainment', poll: min(20), social: true, video: true })),
  ...[
    ['starsports', 'Star Sports', 'UCmqfX0S3x0I3uwLkPdpX03w'], ['sonysports', 'Sony Sports Network', 'UC_WKb6N9iTGc77hxwXLDrbA'],
    ['cricbuzz', 'Cricbuzz', 'UCSRQXk5yErn4e14vN76upOw'], ['cricinfo', 'ESPNcricinfo', 'UCujuVKmt_utAQZJghxlRMIQ'],
  ].map(([id, name, ch]) => ({ id: 'yt-' + id, name: `${name} · YouTube`, site: 'youtube.com', url: `https://www.youtube.com/feeds/videos.xml?channel_id=${ch}`, region: 'india', topic: 'sports', poll: min(20), social: true, video: true })),
  ...[['dhruvrathee', 'Dhruv Rathee', 'UC-CSyyi47VX1lD9zyeABW3w', 'india'], ['technicalguruji', 'Technical Guruji', 'UCOhHO2ICt0ti9KAh-QHvttQ', 'tech']]
    .map(([id, name, ch, topic]) => ({ id: 'yt-' + id, name: `${name} · YouTube`, site: 'youtube.com', url: `https://www.youtube.com/feeds/videos.xml?channel_id=${ch}`, region: 'india', topic, poll: min(20), social: true, video: true })),
  // ── What celebrities posted and what's going viral: news coverage of Instagram/X posts, trailers,
  // OTT releases and box office (Instagram and Threads have no public API for other people's posts).
  ...[
    ['celeb-posts', 'Celebrity posts', '(Instagram OR "X post" OR tweet) (actor OR actress OR cricketer OR celebrity)', 'entertainment'],
    ['viral', 'Viral', '"viral video" OR "goes viral"', 'entertainment'],
    ['trailers', 'Trailers', 'trailer released OR teaser out', 'entertainment'],
    ['ott', 'OTT this week', 'OTT release this week', 'entertainment'],
    ['boxoffice', 'Box office', '"box office collection"', 'entertainment'],
    ['cricket', 'Cricket', 'cricket match OR IPL OR "Team India"', 'sports'],
  ].map(([id, name, q, topic]) => ({ id: 'gn-' + id, name: `Google News · ${name}`, site: 'news.google.com', url: GN(q), region: 'india', topic, poll: min(15), aggregator: true })),
  // ── Instagram: posts from celebrities, cricketers and creators (official API; on once IG_USER_ID and
  // IG_ACCESS_TOKEN are set — see README). Grouped so each source makes a few calls per poll.
  ...[
    ['bollywood', 'Bollywood', 'entertainment', 'india', ['aliaabhatt', 'deepikapadukone', 'iamsrk', 'ranveersingh', 'katrinakaif', 'priyankachopra', 'kritisanon', 'kartikaaryan']],
    ['tollywood', 'Tollywood', 'entertainment', 'hyderabad', ['alluarjunonline', 'actorprabhas', 'jrntr', 'samantharuthprabhuoffl', 'urstrulymahesh', 'ramcharan', 'rashmika_mandanna', 'vijaydeverakonda']],
    ['kollywood', 'Kollywood', 'entertainment', 'chennai', ['actorvijay', 'dhanushkraja', 'trishakrishnan', 'nayanthara']],
    ['cricket', 'Cricket', 'sports', 'india', ['virat.kohli', 'rohitsharma45', 'hardikpandya93', 'jaspritb1', 'mahi7781', 'indiancricketteam', 'iplt20']],
    ['viral', 'Viral India', 'entertainment', 'india', ['bhuvan.bam22', 'carryminati', 'ashishchanchlani', 'beerbiceps', 'mostlysane', 'thebeerbiceps']],
    ['world', 'Worldwide', 'entertainment', 'world', ['cristiano', 'leomessi', 'taylorswift', 'mrbeast', 'kimkardashian', 'therock']],
  ].map(([id, name, topic, region, accounts]) => ({ id: 'ig-' + id, name: `Instagram · ${name}`, site: 'instagram.com', url: 'https://graph.facebook.com/', adapter: 'instagram', accounts, max: 3, region, topic, poll: min(Number(process.env.IG_POLL_MINUTES) || 60), social: true, credentials: 'IG_USER_ID + IG_ACCESS_TOKEN' })),
  // Viral posts covered by the news (works without any keys).
  ...[
    ['insta-viral', 'Viral on Instagram', '"Instagram" (viral OR reel OR post) (actor OR actress OR cricketer OR star)', 'entertainment'],
    ['insta-celeb', 'Celebrity Instagram', '"shares" "Instagram" (Kohli OR Alia OR Deepika OR Shah Rukh OR Allu Arjun OR Prabhas OR Samantha OR Rashmika)', 'entertainment'],
    ['viral-reels', 'Viral reels', '"viral reel" OR "reel goes viral" OR "internet reacts"', 'entertainment'],
  ].map(([id, name, q, topic]) => ({ id: 'gn-' + id, name: `Google News · ${name}`, site: 'news.google.com', url: GN(q), region: 'india', topic, poll: min(15), aggregator: true })),
  // ── X (Twitter): the most engaging recent posts near the reader and worldwide. Official API only —
  // off until X_BEARER_TOKEN is set (X has no free read access). Polled gently to stay inside the plan.
  ...[
    ['india', 'India', 'india', 'india', '(India OR #India) lang:en'],
    ['world', 'World', 'world', 'world', '(breaking OR viral OR world) lang:en is:verified'],
    ['hyderabad', 'Hyderabad', 'hyderabad', 'local', '(Hyderabad OR #Hyderabad OR Telangana)'],
    ['bengaluru', 'Bengaluru', 'bengaluru', 'local', '(Bengaluru OR Bangalore OR #Bengaluru)'],
    ['mumbai', 'Mumbai', 'mumbai', 'local', '(Mumbai OR #Mumbai)'],
    ['delhi', 'Delhi', 'delhi', 'local', '(Delhi OR #Delhi OR NCR)'],
    ['chennai', 'Chennai', 'chennai', 'local', '(Chennai OR #Chennai)'],
  ].map(([id, name, region, topic, q]) => ({ id: 'x-' + id, name: `X · Popular in ${name}`, site: 'x.com', url: 'https://api.x.com/2/tweets/search/recent', adapter: 'x',
    query: `${q} -is:retweet -is:reply has:media`, max: 10, region, topic, poll: min(Number(process.env.X_POLL_MINUTES) || 120), social: true, credentials: 'X_BEARER_TOKEN' })),
  // ── Optional platforms: need documented API access, so off until credentials are configured ──
  { id: 'youtube-in', name: 'YouTube · Popular in India', site: 'youtube.com', url: 'https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&chart=mostPopular&regionCode=IN&maxResults=20', adapter: 'youtube', region: 'india', topic: 'video', poll: min(30), social: true, video: true, credentials: 'YOUTUBE_API_KEY' },
  { id: 'reddit-india', name: 'Reddit · r/india', site: 'reddit.com', url: 'https://oauth.reddit.com/r/india/hot?limit=25', adapter: 'reddit', region: 'india', topic: 'india', poll: min(15), credentials: 'REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET' },
].map((s) => ({ adapter: 'rss', timeout: 9000, ...s, enabled: s.credentials ? s.credentials.split(' + ').every((k) => !!process.env[k]) : true }));

module.exports = { SOURCES, CITIES, STATE_OF, byId: (id) => SOURCES.find((s) => s.id === id) };
