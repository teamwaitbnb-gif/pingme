// On-device helpers — nothing here leaves the phone.
//  • Scam radar: flags common Indian scam patterns in incoming messages.
//  • Promise tracker: notices "I'll send it tomorrow" and works out when to remind you.

const SCAMS = [
  {
    id: 'upi', title: 'Possible UPI collect scam',
    why: 'You never need to enter a PIN or scan a QR code to RECEIVE money. A “collect request” takes money from you.',
    test: (t) => /(collect request|request money|scan (the |this )?qr|enter (your )?(upi )?pin)/.test(t) && /(receive|refund|cashback|prize|reward|get (the )?money|credited)/.test(t),
  },
  {
    id: 'otp', title: 'Never share an OTP',
    why: 'Banks, UPI apps and delivery companies never ask for your OTP or PIN. Anyone asking for it is trying to take money from your account.',
    test: (t) => /\b(otp|one[\s-]?time[\s-]?password|verification code|upi pin|atm pin|cvv)\b/.test(t) && /\b(share|send|tell|forward|give|read out|provide|enter)\b/.test(t),
  },
  {
    id: 'kyc', title: 'Possible fake KYC message',
    why: 'Real banks don’t block accounts over chat or ask you to update KYC through a link. Visit the branch or the official app instead.',
    test: (t) => /\b(kyc|pan card|aadhaa?r)\b/.test(t) && /\b(update|expire|expired|block|blocked|suspend|deactivat|verify|link)\w*/.test(t),
  },
  {
    id: 'job', title: 'Possible job / task scam',
    why: 'Paid “like videos”, “rate hotels” or part-time task jobs that pay quickly and then ask for a deposit are a common fraud.',
    test: (t) => /(work from home|part[\s-]?time (job|work)|daily (income|earning)|earn (rs\.?|₹|inr)?\s?\d[\d,]* ?(per|\/|a) ?(day|hour)|like (youtube )?videos|rate (hotels|products)|telegram task|prepaid task)/.test(t),
  },
  {
    id: 'prize', title: 'Possible lottery / prize scam',
    why: 'You can’t win a lottery you never entered. Requests for a “processing fee” or “tax” to release a prize are always fake.',
    test: (t) => /(you (have )?won|winner|lottery|lucky draw|kbc|jackpot|claim (your )?(prize|reward))/.test(t) && /(fee|charge|tax|pay|deposit|claim|click|link)/.test(t),
  },
  {
    id: 'arrest', title: 'Possible “digital arrest” scam',
    why: 'Police, CBI, customs or courier companies never arrest people over video call or ask for money to “clear your name”.',
    test: (t) => /(digital arrest|cbi|narcotics|customs|fedex|courier|parcel|money laundering)/.test(t) && /(arrest|police|case|seized|drugs|illegal|warrant|video call)/.test(t),
  },
  {
    id: 'power', title: 'Possible electricity bill scam',
    why: 'Electricity boards don’t message you personally to say your power will be cut tonight. Check on the official website.',
    test: (t) => /(electricity|power|bijli)/.test(t) && /(disconnect|cut|tonight|today|unpaid|overdue)/.test(t) && /(call|contact|whatsapp|click|update)/.test(t),
  },
  {
    id: 'link', title: 'Suspicious link',
    why: 'Shortened links and app files (.apk) sent by people you don’t know are a common way to install apps that steal money.',
    test: (t) => /\.apk\b/.test(t) || (/\b(bit\.ly|tinyurl\.com|cutt\.ly|is\.gd|t\.ly|rb\.gy|shorturl\.at)\//.test(t) && /(urgent|immediately|verify|account|bank|kyc|reward|prize)/.test(t)),
  },
];

export function scanScam(text) {
  if (!text || text.length < 12) return null;
  const t = text.toLowerCase();
  return SCAMS.find((s) => s.test(t)) || null;
}

// ───── promise tracker ─────

const PROMISE = /\b(i'?ll|i will|i'm going to|im going to|i am going to|gonna|let me|will)\s+(definitely\s+|surely\s+|try to\s+)?(send|share|call|ring|text|message|mail|email|check|do|pay|transfer|get back|reply|finish|bring|fix|look|confirm|book|submit|update|ping|forward|return)\b/i;

function at(date, h, m = 0) { const d = new Date(date); d.setHours(h, m, 0, 0); return d; }
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// Returns { when: Date, label } or null.
export function detectPromise(text, now = new Date()) {
  if (!text || !PROMISE.test(text)) return null;
  const t = text.toLowerCase();
  let when = null;
  let m;
  if ((m = /\bin (\d{1,3}|an?|one|two|few) ?(min|minute|minutes|mins|hr|hrs|hour|hours)\b/.exec(t))) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : m[1] === 'few' ? 3 : m[1] === 'two' ? 2 : 1;
    when = new Date(now.getTime() + n * (m[2].startsWith('h') ? 3600000 : 60000));
  } else if ((m = /\b(?:at|by) (\d{1,2})(?::(\d{2}))? ?(am|pm)?\b/.exec(t))) {
    let h = Number(m[1]);
    const min = Number(m[2] || 0);
    if (m[3] === 'pm' && h < 12) h += 12;
    if (m[3] === 'am' && h === 12) h = 0;
    if (!m[3] && h < 8) h += 12; // "at 5" in conversation usually means 5 PM
    if (h > 23) return null;
    when = at(now, h, min);
    if (/\btomorrow\b/.test(t) || when <= now) when.setDate(when.getDate() + 1);
  } else if (/\btomorrow\b/.test(t)) {
    when = at(new Date(now.getTime() + 86400000), /\b(evening|night)\b/.test(t) ? 18 : /\bafternoon\b/.test(t) ? 14 : 10);
  } else if (/\b(tonight|this evening|by evening|in the evening)\b/.test(t)) {
    when = at(now, 19); if (when <= now) when = new Date(now.getTime() + 2 * 3600000);
  } else if (/\b(this afternoon|after lunch)\b/.test(t)) {
    when = at(now, 14); if (when <= now) when = new Date(now.getTime() + 2 * 3600000);
  } else if (/\b(next week)\b/.test(t)) {
    when = at(new Date(now.getTime() + 7 * 86400000), 10);
  } else if ((m = new RegExp(`\\b(on |by |this )?(${WEEKDAYS.join('|')})\\b`).exec(t))) {
    const target = WEEKDAYS.indexOf(m[2]);
    const d = new Date(now);
    d.setDate(d.getDate() + (((target - d.getDay() + 7) % 7) || 7));
    when = at(d, 10);
  } else if (/\b(later|in a bit|soon|shortly)\b/.test(t)) {
    when = new Date(now.getTime() + 3 * 3600000);
  } else {
    return null;
  }
  if (!(when > now)) return null;
  const sameDay = when.toDateString() === now.toDateString();
  const tomorrow = when.toDateString() === new Date(now.getTime() + 86400000).toDateString();
  const time = when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const label = sameDay ? `today at ${time}` : tomorrow ? `tomorrow at ${time}` : when.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  return { when, label };
}

export const INTENTS = {
  vent: { label: 'Just venting', icon: 'cloud', hint: 'No advice needed — just listen' },
  advice: { label: 'Need advice', icon: 'help', hint: 'Your opinion is welcome' },
  urgent: { label: 'Urgent', icon: 'alert', hint: 'Please reply soon' },
  fyi: { label: 'FYI', icon: 'info', hint: 'No reply needed' },
  news: { label: 'Good news', icon: 'star', hint: 'Celebrate with me' },
};
