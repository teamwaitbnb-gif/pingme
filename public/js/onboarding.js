// First-run setup: show every advanced feature with a one-line explanation and an on/off switch.
// The same list powers Settings → Features.
import { h, icon, toggle, toast } from './ui.js';
import { S, api } from './core.js';
import { storyStrip } from './stories.js';

export const FEATURE_GROUPS = [
  {
    title: 'Together', items: [
      ['ping', 'hand', 'The Ping', 'One tap sends a “thinking of you” buzz — a special sound and vibration, no words needed.'],
      ['usSpace', 'heart', 'Us space', 'Days together, your streak, anniversary countdown and open-when letters for two.'],
    ],
  },
  {
    title: 'Messaging', items: [
      ['secureMessages', 'shieldcheck', 'Screenshot-proof messages', 'Send text that reads fine on screen but shows only static in screenshots.'],
      ['eyesOnly', 'eye', 'Eyes-only messages', 'Opens only while one face is looking at the screen; hides if someone peeks.'],
      ['vanishAfterRead', 'hourglass', 'Vanish after read', 'Messages disappear after they’re read — longer messages stay a bit longer.'],
      ['intentTags', 'tag', 'Intent tags', 'Mark a message “Just venting”, “Need advice” or “Urgent”.'],
      ['promiseTracker', 'alarm', 'Promise tracker', 'Say “I’ll send it tomorrow” and get a reminder automatically.'],
      ['scamRadar', 'flag', 'Scam radar', 'Warns about fake KYC, OTP requests, UPI collect and job scams. Runs on your phone.'],
    ],
  },
  {
    title: 'Calls', items: [
      ['verifiedDevices', 'badgecheck', 'Verified calls', 'Shows when a caller is on the same device as before — or warns if it’s new.'],
      ['reasonToCall', 'note', 'Reason to call', 'People who’ve never chatted with you must say why before your phone rings.'],
      ['whisperMode', 'whisper', 'Whisper mode', 'Talk softly; your voice is boosted so they hear you clearly.'],
      ['callRewind', 'rewind', 'Call rewind', 'Missed something? Replay the last 30 seconds of what they said.'],
      ['spatialAudio', 'headphones', 'Spatial group calls', 'In group calls each voice comes from a different direction in your earphones.'],
    ],
  },
  {
    title: 'Safety', items: [
      ['sos', 'lifebuoy', 'Silent SOS', 'Looks like a normal call, but shares your live location with trusted contacts.'],
      ['checkIn', 'clock', 'Safety check-in', 'If you don’t tap “I’m safe” in time, a chat you choose is alerted.'],
    ],
  },
  {
    title: 'Fun', items: [
      ['groupPets', 'paw', 'Chat pets', 'Every chat raises a little pet: name it, feed it, play fetch, dress it up — it grows as you chat and care for it, and loves whoever looks after it most.'],
      ['wrapped', 'gift', 'Chat Wrapped', 'Monthly & yearly cards: who replies fastest, favourite emoji, longest streak.'],
      ['whosRight', 'scale', 'Who’s Right?', 'Settle arguments with a quick group vote.'],
      ['verifiedCamera', 'camcheck', 'Verified Real photos', 'Photos taken in Ping Me carry a signature proving they’re real and unedited.'],
    ],
  },
];

const PRIVACY = [
  ['readReceipts', 'check', 'Read receipts', 'Let people see when you’ve read their messages.'],
  ['typing', 'keyboard', 'Typing indicator', 'Show when you’re typing.'],
  ['lastSeen', 'presence', 'Online & last seen', 'Show when you’re online.'],
];

function row([key, ic, title, desc], checked, onChange) {
  return h('div', { class: 'feat' },
    h('span', { class: 'feat-ic' }, icon(ic)),
    h('div', { class: 'feat-t' }, h('b', null, title), h('span', null, desc)),
    toggle(checked, (v) => onChange(key, v)));
}

export function featureList(features, onChange) {
  return FEATURE_GROUPS.map((g) => [
    h('div', { class: 'group-label' }, g.title),
    h('div', { class: 'group feat-group' }, g.items.map((it) => row(it, features[it[0]] !== false, onChange))),
  ]);
}

export function showOnboarding(onDone) {
  const features = { ...(S.config.features || {}), ...(S.me.settings.features || {}) };
  const privacy = { readReceipts: S.me.settings.readReceipts, typing: S.me.settings.typing, lastSeen: S.me.settings.lastSeen };
  const list = h('div');
  const strip = h('div');
  const draw = () => {
    strip.replaceChildren(storyStrip(FEATURE_GROUPS, features, (k, v) => { features[k] = v; draw(); }));
    drawList();
  };
  const drawList = () => list.replaceChildren(
    ...featureList(features, (k, v) => { features[k] = v; }).flat(),
    h('div', { class: 'group-label' }, 'Privacy'),
    h('div', { class: 'group feat-group' }, PRIVACY.map((it) => row(it, privacy[it[0]] !== false, (k, v) => { privacy[k] = v; }))));
  const btn = h('button', { class: 'btn', onclick: async () => {
    btn.disabled = true;
    try {
      const { user } = await api('PATCH', '/api/me', { settings: { ...privacy, features, onboarded: true } });
      S.me = user;
      root.remove();
      onDone?.();
    } catch (e) { toast(e.message, { error: true }); btn.disabled = false; }
  } }, 'Start pinging');
  const root = h('div', { class: 'onboard' },
    h('div', { class: 'onboard-in' },
      h('img', { class: 'onboard-hand', src: '/icons/hand.svg', alt: '' }),
      h('h1', null, `Hi ${S.me.name.split(' ')[0]}`),
      h('p', { class: 'sub' }, 'Tap a circle to see each feature in action. Keep what you like — change anything later in Settings → Features.'),
      strip,
      h('div', { class: 'onboard-all' },
        h('button', { class: 'link', onclick: () => { for (const g of FEATURE_GROUPS) for (const [k] of g.items) features[k] = true; draw(); } }, 'Turn all on'),
        h('span', { class: 'muted' }, ' · '),
        h('button', { class: 'link', onclick: () => { for (const g of FEATURE_GROUPS) for (const [k] of g.items) features[k] = false; draw(); } }, 'Keep it simple (all off)')),
      list),
    h('div', { class: 'onboard-foot' }, btn));
  draw();
  document.body.append(root);
}
