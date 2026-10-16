// AI descriptions for Buzz (Groq). After the server reads the full story, a strong model writes the
// short description shown under the headline: what happened, who, why it matters — plain and
// factual. Used only for stories people are about to see, paced to Groq's free-tier limits; if the
// API is unavailable the publisher's own opening paragraphs are used instead.
const KEY = () => process.env.GROQ_API_KEY || '';
const MODELS = (process.env.GROQ_MODELS || 'openai/gpt-oss-120b,qwen/qwen3.8-27b,openai/gpt-oss-20b').split(',').map((s) => s.trim()).filter(Boolean);
const MIN_GAP = Number(process.env.GROQ_MIN_GAP_MS || 9000);      // ≈6 calls/min keeps under the token-per-minute cap
const DAILY = Number(process.env.GROQ_DAILY_LIMIT || 900);        // free tier ≈1000 requests/day

const state = { pausedUntil: 0, last: 0, day: '', count: 0, model: 0, ok: 0, failed: 0, lastError: null };

const SYSTEM = 'You write the description shown under a news headline in a mobile news feed. Read the article and explain the story so a reader understands it in one pass: what happened, who is involved, and why it matters. Write 2-3 short, plain sentences (45-75 words) in simple English. Use only facts stated in the article — never add facts, numbers or names that are not in it. No opinions, no hype, no questions, no emojis, no hashtags, no preamble like "This article", and do not repeat the headline word for word. If the article text is not about the headline (for example a list of unrelated links), reply with exactly: SKIP';

function clean(t) {
  let s = String(t || '').replace(/^\s*(summary|description)\s*:\s*/i, '').replace(/^["“]|["”]$/g, '').replace(/\s+/g, ' ').trim();
  if (/^(here is|here's|this article|the article)/i.test(s)) s = s.replace(/^[^:]*:\s*/, '');
  if (/^skip\b/i.test(s) || s.length < 80 || s.length > 700) return null;
  if (/(as an ai|i cannot|i can't|not provided|does not (contain|provide|include|mention)|doesn't (contain|provide|mention)|no (specific|further) (details|information|events)|unrelated (topics|links|items)|the (piece|page|text|article) (lists|contains)|insufficient information)/i.test(s)) return null;
  return s;
}

// The text must actually be the story: most of the headline's key words should appear in it.
function onTopic(title, text) {
  const words = [...new Set(String(title).toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || [])];
  if (words.length < 2) return true;
  const body = String(text).toLowerCase();
  return words.filter((w) => body.includes(w)).length / words.length >= 0.45;
}

async function summarize({ title, source, text }) {
  if (!KEY() || !text || text.length < 200) return null;
  if (!onTopic(title, text)) return null;
  const now = Date.now();
  const day = new Date(now + 5.5 * 3600e3).toISOString().slice(0, 10);
  if (state.day !== day) { state.day = day; state.count = 0; }
  if (now < state.pausedUntil || state.count >= DAILY || now - state.last < MIN_GAP) return { throttled: true };
  state.last = now;
  for (let i = state.model; i < MODELS.length; i++) {
    const model = MODELS[i];
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST', signal: AbortSignal.timeout(20000),
        headers: { authorization: `Bearer ${KEY()}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model, temperature: 0.2, max_completion_tokens: 500,
          ...(model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {}),
          messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: `Headline: ${title}\nSource: ${source}\n\nArticle:\n${text.slice(0, 3500)}` }],
        }),
      });
      state.count++;
      if (r.status === 429) { const ra = Number(r.headers.get('retry-after')) || 60; state.pausedUntil = Date.now() + ra * 1000; state.lastError = 'rate limited'; return { throttled: true }; }
      if (r.status === 404 || r.status === 400) { const body = await r.text(); if (/model/i.test(body)) { state.model = i + 1; continue; } state.lastError = body.slice(0, 120); state.failed++; return null; }
      if (r.status === 401) { state.pausedUntil = Date.now() + 3600e3; state.lastError = 'invalid API key'; return null; }
      if (!r.ok) { state.failed++; state.lastError = 'HTTP ' + r.status; state.pausedUntil = Date.now() + 30000; return null; }
      const remaining = Number(r.headers.get('x-ratelimit-remaining-requests'));
      if (Number.isFinite(remaining) && remaining < 15) state.pausedUntil = Date.now() + 30 * 60000;
      const d = await r.json();
      const out = clean(d.choices?.[0]?.message?.content);
      if (out) { state.ok++; return { text: out, model }; }
      state.failed++;
      return null;
    } catch (e) { state.failed++; state.lastError = e.message; state.pausedUntil = Date.now() + 20000; return null; }
  }
  return null;
}

module.exports = { summarize, enabled: () => !!KEY(), status: () => ({ enabled: !!KEY(), model: MODELS[state.model] || null, today: state.count, ok: state.ok, failed: state.failed, pausedUntil: state.pausedUntil || null, lastError: state.lastError }) };
