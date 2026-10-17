// Feature "stories": status-style cards that show what each feature does with a small animated
// example. Tap right/left to move, hold to pause, swipe down to close. Each card has an on/off switch.
import { h, icon, toggle, registerLayer } from './ui.js';
import { secureText } from './secure.js';

const bubble = (text, me = false, extra = '') => h('div', { class: `sd-b ${me ? 'me' : ''} ${extra}` }, text);

// Each demo returns a small looping animation built from plain DOM + CSS keyframes.
const DEMOS = {
  ping: () => h('div', { class: 'sd sd-ping' },
    h('div', { class: 'sd-phone' }, h('img', { class: 'wave', src: '/icons/hand.svg', alt: '' })),
    h('b', null, 'Vijay pinged you'), h('small', null, 'Thinking of you')),
  usSpace: () => h('div', { class: 'sd sd-us' },
    h('div', { class: 'big' }, '128'), h('small', null, 'days together'),
    h('div', { class: 'row1' }, icon('fire'), '21-day streak'),
    h('div', { class: 'row2' }, icon('mail'), 'Open when you miss me')),
  secureMessages: () => {
    const live = secureText('Door code 4417', { maxWidth: 170, color: '#000', fontSize: 18 });
    return h('div', { class: 'sd sd-secure' },
      h('div', { class: 'sd-col' }, h('small', null, 'On your screen'), h('div', { class: 'sd-b' }, live)),
      h('div', { class: 'sd-col' }, h('small', null, 'In a screenshot'), h('div', { class: 'sd-b' }, staticNoise())));
  },
  eyesOnly: () => h('div', { class: 'sd sd-eyes' },
    h('div', { class: 'sd-faces' }, h('span', { class: 'f1' }, icon('user')), h('span', { class: 'f2' }, icon('user'))),
    bubble('The surprise party is on Friday!', false, 'blurs')),
  vanishAfterRead: () => h('div', { class: 'sd sd-vanish' },
    bubble('Here’s the Wi-Fi password: blue-sky-42', false, 'fades'),
    h('div', { class: 'sd-bar' }, h('i')),
    h('small', null, 'Read · vanishing in 8s')),
  intentTags: () => h('div', { class: 'sd sd-intent' },
    h('div', { class: 'sd-tag t1' }, icon('cloud'), 'Just venting'), bubble('Work was so exhausting today…', false, 'b1'),
    h('div', { class: 'sd-tag t2' }, icon('alert'), 'Urgent'), bubble('Can you pick me up at 6?', true, 'b2')),
  promiseTracker: () => h('div', { class: 'sd sd-promise' },
    bubble('I’ll send you the photos tomorrow', true),
    h('div', { class: 'sd-toast' }, icon('alarm'), 'I’ll remind you tomorrow at 10:00')),
  scamRadar: () => h('div', { class: 'sd sd-scam' },
    bubble('Dear customer, your KYC has expired. Update now or your account will be blocked.'),
    h('div', { class: 'sd-warn' }, icon('flag'), h('b', null, 'Possible fake KYC message'))),
  verifiedDevices: () => h('div', { class: 'sd sd-call' },
    h('div', { class: 'sd-av' }, 'PS'), h('b', null, 'Priya Sharma'), h('small', null, '0:42'),
    h('div', { class: 'sd-badge' }, icon('badgecheck'), 'Same device as before')),
  reasonToCall: () => h('div', { class: 'sd sd-call' },
    h('div', { class: 'sd-av' }, 'RK'), h('b', null, 'Rahul Kumar'), h('small', null, 'Incoming call'),
    h('div', { class: 'sd-reason' }, '“About tomorrow’s interview”')),
  whisperMode: () => h('div', { class: 'sd sd-wave' },
    h('div', { class: 'sd-lbl' }, h('small', null, 'You whisper'), h('small', null, 'They hear')),
    h('div', { class: 'sd-waves' }, h('div', { class: 'w soft' }, ...Array.from({ length: 9 }, () => h('i'))), h('div', { class: 'w loud' }, ...Array.from({ length: 9 }, () => h('i'))))),
  callRewind: () => h('div', { class: 'sd sd-rewind' },
    h('div', { class: 'sd-track' }, ...Array.from({ length: 22 }, (_, i) => h('i', { style: { height: 20 + ((i * 37) % 50) + '%' } })), h('span', { class: 'sd-head' })),
    h('div', { class: 'sd-rbtn' }, icon('rewind'), 'Replay last 30s')),
  spatialAudio: () => h('div', { class: 'sd sd-spatial' },
    h('div', { class: 'sd-me' }, icon('headphones')),
    h('span', { class: 'p p1' }, 'A'), h('span', { class: 'p p2' }, 'B'), h('span', { class: 'p p3' }, 'C')),
  sos: () => h('div', { class: 'sd sd-sos' },
    h('div', { class: 'sd-hold' }, h('i'), h('span', null, 'Hold for SOS')),
    h('div', { class: 'sd-pin' }, icon('map'), 'Live location sent to 3 trusted contacts')),
  checkIn: () => h('div', { class: 'sd sd-check' },
    h('div', { class: 'sd-ring' }, h('b', null, '1:00'), h('small', null, 'until check-in')),
    h('div', { class: 'sd-safe' }, 'I’m safe')),
  groupPets: () => h('div', { class: 'sd sd-pet' }, h('div', { class: 'egg' }, '🥚'), h('div', { class: 'baby' }, '🦊'), h('small', null, 'Grows as you chat & care')),
  wrapped: () => h('div', { class: 'sd sd-wrap' },
    h('div', { class: 'big' }, '4,218'), h('small', null, 'messages this month'),
    h('div', { class: 'row1' }, icon('zap'), 'Fastest replier · Priya'), h('div', { class: 'row2' }, icon('fire'), 'Longest streak · 12 days')),
  whosRight: () => h('div', { class: 'sd sd-poll' }, h('b', null, 'Who’s right?'),
    h('div', { class: 'o' }, h('i', { class: 'a' }), h('span', null, 'Vijay')), h('div', { class: 'o' }, h('i', { class: 'b' }), h('span', null, 'Rahul'))),
  verifiedCamera: () => h('div', { class: 'sd sd-cam' }, h('div', { class: 'shot' }, icon('image')), h('div', { class: 'flash' }),
    h('div', { class: 'sd-badge' }, icon('badgecheck'), 'Verified Real — unedited')),
};

const EXAMPLES = {
  ping: 'Busy day? Tap the hand — her phone gives a soft knock-knock buzz so she knows you’re thinking of her.',
  usSpace: 'See how many days you’ve been together, keep your daily streak alive, and leave “open when” letters for later.',
  secureMessages: 'Share a door code or OTP. If anyone screenshots it, they only get static.',
  eyesOnly: 'Send a surprise plan. It opens only while one face looks — if someone peeks over the shoulder, it hides.',
  vanishAfterRead: 'Send a Wi-Fi password. Once it’s read, a timer starts and the message disappears.',
  intentTags: 'Tag “Just venting” so friends listen instead of giving advice.',
  promiseTracker: 'Type “I’ll send the photos tomorrow” — Ping Me reminds you at 10 AM.',
  scamRadar: 'A message says your KYC expired? You see a warning before you tap anything.',
  verifiedDevices: 'Mom calls asking for money? Check the badge — it shows it’s her usual phone.',
  reasonToCall: 'Someone new calls — you see why before your phone even rings.',
  whisperMode: 'In a library or late at night, whisper — they hear you clearly.',
  callRewind: 'Missed the address they said? Tap rewind and hear the last 30 seconds again.',
  spatialAudio: 'In a group call each friend’s voice comes from a different side, like sitting at a table.',
  sos: 'Hold 2 seconds — trusted contacts get your live location and a normal-looking call starts.',
  checkIn: 'Taking a cab late? If you don’t tap “I’m safe” in time, your family is alerted.',
  groupPets: 'Every chat raises a pet — name it, feed it, play fetch and dress it up. Go quiet and it gets lonely.',
  wrapped: 'Every month: who replies fastest, your longest streak, favourite emoji — share the card.',
  whosRight: 'Settle a debate with a quick vote and share the result card.',
  verifiedCamera: 'Photos taken in Ping Me carry a signature proving they’re real and unedited.',
};

const DURATION = 6500;
const SHORT = {
  ping: 'Ping', usSpace: 'Us',
  secureMessages: 'Private', eyesOnly: 'Eyes-only', vanishAfterRead: 'Vanish', intentTags: 'Intent', promiseTracker: 'Promise',
  scamRadar: 'Scam radar', verifiedDevices: 'Verified', reasonToCall: 'Reason', whisperMode: 'Whisper', callRewind: 'Rewind',
  spatialAudio: 'Spatial', sos: 'SOS', checkIn: 'Check-in', groupPets: 'Pets', wrapped: 'Wrapped', whosRight: 'Who’s right', verifiedCamera: 'Real photo',
};

// A frozen frame of random noise — what a screenshot of a private message looks like.
function staticNoise(w = 170, hgt = 40) {
  const c = h('canvas', { width: w / 2, height: hgt / 2, class: 'secure-canvas' });
  c.style.width = w + 'px'; c.style.height = hgt + 'px';
  const x = c.getContext('2d');
  const img = x.createImageData(c.width, c.height);
  for (let i = 0; i < img.data.length; i += 4) { img.data[i + 3] = Math.random() < 0.5 ? 255 : 0; }
  x.putImageData(img, 0, 0);
  return c;
}

export function storyStrip(groups, features, onToggle) {
  const items = groups.flatMap((g) => g.items);
  const strip = h('div', { class: 'story-strip' });
  const draw = () => strip.replaceChildren(...items.map(([key, ic, title], i) =>
    h('button', { class: 'story-dot' + (features[key] === false ? ' off' : ''), onclick: () => openStories(items, i, features, (k, v) => { onToggle(k, v); draw(); }) },
      h('span', { class: 'ring' }, h('span', null, icon(ic))),
      h('small', null, SHORT[key] || title.split(' ')[0]))));
  draw();
  return strip;
}

export function openStories(items, start, features, onToggle) {
  let idx = start, timer = null, startedAt = 0, elapsed = 0, paused = false, closed = false;
  const bars = h('div', { class: 'st-bars' }, ...items.map(() => h('span', null, h('i'))));
  const head = h('div', { class: 'st-head' });
  const stage = h('div', { class: 'st-stage' });
  const text = h('div', { class: 'st-text' });
  const foot = h('div', { class: 'st-foot' });
  const root = h('div', { class: 'stories', role: 'dialog', 'aria-label': 'Feature stories' }, bars, head, stage, text, foot);
  const unregister = registerLayer(() => close());

  function close() {
    if (closed) return;
    closed = true; unregister(); cancelAnimationFrame(timer);
    root.classList.add('out');
    setTimeout(() => root.remove(), 200);
  }
  function show(i) {
    if (i < 0) i = 0;
    if (i >= items.length) return close();
    idx = i; elapsed = 0; startedAt = performance.now();
    const [key, ic, title, desc] = items[i];
    [...bars.children].forEach((b, j) => { b.firstChild.style.width = j < i ? '100%' : '0%'; });
    head.replaceChildren(h('span', { class: 'st-ic' }, icon(ic)), h('b', null, title), h('span', { class: 'spacer' }),
      h('button', { class: 'st-x', 'aria-label': 'Close', onclick: (e) => { e.stopPropagation(); close(); } }, icon('x')));
    stage.replaceChildren(DEMOS[key] ? DEMOS[key]() : h('div', { class: 'sd' }, icon(ic)));
    text.replaceChildren(h('h2', null, title), h('p', null, desc), EXAMPLES[key] ? h('div', { class: 'st-ex' }, h('b', null, 'Example'), EXAMPLES[key]) : null);
    foot.replaceChildren(h('span', null, features[key] === false ? 'Off' : 'On'),
      toggle(features[key] !== false, (v) => { onToggle(key, v); foot.firstChild.textContent = v ? 'On' : 'Off'; }));
  }
  function tick(now) {
    if (closed) return;
    if (!paused) elapsed = now - startedAt;
    else startedAt = now - elapsed;
    const bar = bars.children[idx]?.firstChild;
    if (bar) bar.style.width = Math.min(100, (elapsed / DURATION) * 100) + '%';
    if (elapsed >= DURATION) show(idx + 1);
    timer = requestAnimationFrame(tick);
  }

  // Tap left/right, hold to pause, swipe down to close.
  let downAt = 0, sy = 0;
  root.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.st-foot, .st-x')) return;
    downAt = performance.now(); sy = e.clientY; paused = true; root.classList.add('paused');
  });
  root.addEventListener('pointerup', (e) => {
    if (!downAt) return;
    const held = performance.now() - downAt;
    downAt = 0; paused = false; root.classList.remove('paused');
    if (e.clientY - sy > 90) return close();
    if (held < 250) show(e.clientX < innerWidth / 3 ? idx - 1 : idx + 1);
  });
  root.addEventListener('pointercancel', () => { downAt = 0; paused = false; root.classList.remove('paused'); });

  document.body.append(root);
  show(start);
  timer = requestAnimationFrame(tick);
}
