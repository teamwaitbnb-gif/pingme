import { reportError } from './analytics.js';

// Temporary, bounded diagnostics: one report per edit (up to five per page load).
// Only layout/state numbers are recorded; never message text, names, IDs or DOM HTML.
const VERSION = 'edit-v1';
export function createEditDiagnostics(snapshot, report = reportError) {
  const active = new Map();
  let count = 0;
  function sample(trace, stage) {
    if (trace.rows.length >= 8) return;
    try { trace.rows.push([stage, Date.now() - trace.at, snapshot(trace.chatId)]); }
    catch { trace.rows.push([stage, Date.now() - trace.at, { probeFailed: true }]); }
  }
  function finish(key, trace) {
    if (active.get(key) !== trace) return;
    active.delete(key);
    trace.timers.forEach(clearTimeout);
    const error = new Error(`${VERSION} ${trace.id} ack=${trace.ack} update=${trace.updated}`);
    const payload = { version: VERSION, rows: trace.rows };
    // Keep valid JSON within the existing crash-report storage limit.
    while (JSON.stringify(payload).length > 1450 && payload.rows.length > 1) payload.rows.splice(1, 1);
    error.stack = JSON.stringify(payload);
    report(error, 'diagnostic:message-edit');
  }
  return {
    begin(message) {
      if (count >= 5) return null;
      count++;
      const key = `${message.chatId}:${message.id}`;
      if (active.has(key)) finish(key, active.get(key));
      const trace = { chatId: message.chatId, at: Date.now(), id: Math.random().toString(36).slice(2, 10), rows: [], timers: [], ack: 'pending', updated: false };
      active.set(key, trace);
      sample(trace, 'submit');
      for (const ms of [800, 2500, 5000]) trace.timers.push(setTimeout(() => sample(trace, String(ms)), ms));
      trace.timers.push(setTimeout(() => finish(key, trace), 6000));
      return (ok) => { if (active.get(key) === trace) { trace.ack = ok ? 'ok' : 'failed'; sample(trace, 'ack'); } };
    },
    updated(message) {
      const trace = active.get(`${message.chatId}:${message.id}`);
      if (trace) { trace.updated = true; sample(trace, 'rendered'); }
    },
    flush() { for (const [key, trace] of active) finish(key, trace); },
  };
}
