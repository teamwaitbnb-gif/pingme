const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { File } = require('node:buffer');

function loadRecorder(getUserMedia, MediaRecorder) {
  const context = vm.createContext({ navigator: { mediaDevices: { getUserMedia } }, MediaRecorder, Blob, File });
  const source = fs.readFileSync('public/js/video-recorder.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/export /g, '');
  vm.runInContext(source + '\nglobalThis.exports = { VideoRecorder, recordingOptions };', context);
  return context.exports;
}
function stream() {
  const track = { stopped: false, stop() { this.stopped = true; }, getSettings: () => ({ width: 3840, height: 2160, frameRate: 30 }) };
  return { track, getTracks: () => [track], getVideoTracks: () => [track] };
}
class FakeRecorder {
  static isTypeSupported(type) { return type === 'video/webm;codecs=vp8,opus'; }
  constructor(stream, options) { this.options = options; this.mimeType = options.mimeType; this.state = 'inactive'; }
  start() { this.state = 'recording'; }
  chunk(bytes) { this.ondataavailable({ data: new Blob([new Uint8Array(bytes)]) }); }
  stop() { this.state = 'inactive'; queueMicrotask(() => this.onstop()); }
}
test('closing while permission is pending releases the late camera stream', async () => {
  let resolve;
  const { VideoRecorder } = loadRecorder(() => new Promise((r) => { resolve = r; }), FakeRecorder);
  const recorder = new VideoRecorder(), media = stream();
  const pending = recorder.open(); recorder.cancel(); resolve(media);
  assert.equal(await pending, null); assert.equal(media.track.stopped, true);
});
test('records at sensor resolution with high bitrate and preserves encoded bytes', async () => {
  const media = stream();
  const { VideoRecorder } = loadRecorder(async () => media, FakeRecorder);
  const recorder = new VideoRecorder(); await recorder.open();
  const result = recorder.start(1000); recorder.rec.chunk(100); recorder.rec.chunk(200); recorder.stop();
  const file = await result;
  assert.equal(file.size, 300); assert.match(file.name, /\.webm$/);
  assert.equal(recorder.rec.options.videoBitsPerSecond, 49766400);
  assert.equal(media.track.stopped, true);
});
test('auto-stops near upload limit and rejects oversize final data', async () => {
  const { VideoRecorder } = loadRecorder(async () => stream(), FakeRecorder);
  const recorder = new VideoRecorder(); await recorder.open(); let limited = false;
  const result = recorder.start(1000, () => { limited = true; });
  recorder.rec.chunk(950); recorder.rec.chunk(100);
  await assert.rejects(result, /too large/); assert.equal(limited, true);
});

function callHarness() {
  const handlers = {}, sent = [], context = vm.createContext({
    console, setTimeout: () => 1, clearTimeout() {}, clearInterval() {},
    window: { addEventListener() {} }, navigator: {},
    store: { get: (key, fallback) => fallback },
    sounds: { stopLoop() {} },
    ctx: { socket: { on: (name, fn) => { handlers[name] = fn; }, emit: (...args) => sent.push(args) } },
  });
  let source = fs.readFileSync('public/js/call.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/export /g, '');
  source = source.replace('    start,\n    active:', '    makeOffer, flushIce, closeIncoming, setCall: (value) => { call = value; }, setIncoming: (value) => { incoming = value; },\n    start,\n    active:');
  vm.runInContext(source + '\nglobalThis.calls = initCalls(ctx);', context);
  return { ...context, handlers, sent };
}
test('simultaneous offer requests produce one offer', async () => {
  const { calls, sent } = callHarness(); calls.setCall({ id: 'call-1' });
  let resolve; let offers = 0;
  const pc = { signalingState: 'stable', createOffer: () => { offers++; return new Promise((r) => { resolve = r; }); }, setLocalDescription: async (d) => { pc.localDescription = d; } };
  const peer = { pc, socketId: 'peer' };
  const first = calls.makeOffer(peer); await calls.makeOffer(peer); resolve({ type: 'offer', sdp: '' }); await first;
  assert.equal(offers, 1); assert.equal(sent.length, 1);
});
test('late offer completion cannot signal a different call', async () => {
  const { calls, sent } = callHarness(); calls.setCall({ id: 'old' });
  let resolve;
  const pc = { signalingState: 'stable', createOffer: () => new Promise((r) => { resolve = r; }) };
  const pending = calls.makeOffer({ pc }); calls.setCall({ id: 'new' }); resolve({ type: 'offer', sdp: '' }); await pending;
  assert.equal(sent.length, 0);
});
test('ICE received while an answer is pending waits for remote description', async () => {
  const { calls, handlers } = callHarness(); let resolve, added = false;
  const peer = { pc: { setRemoteDescription: () => new Promise((r) => { resolve = () => { peer.pc.remoteDescription = {}; r(); }; }), addIceCandidate: async () => { assert.ok(peer.pc.remoteDescription); added = true; } } };
  const session = { id: 'call-1', peers: new Map([['peer', peer]]) }; calls.setCall(session);
  handlers['call:signal']({ callId: session.id, from: 'peer', data: { type: 'answer', sdp: '' } });
  handlers['call:signal']({ callId: session.id, from: 'peer', data: { type: 'ice', candidate: {} } });
  await Promise.resolve(); assert.equal(added, false); resolve(); await session.signals; assert.equal(added, true);
});
test('dismissing incoming call closes its own notification after async worker lookup', async () => {
  const harness = callHarness(); let tag;
  harness.navigator.serviceWorker = { ready: Promise.resolve({ getNotifications: async (options) => { tag = options.tag; return []; } }) };
  harness.calls.setIncoming({ invite: { callId: 'ringing' }, root: { remove() {} } });
  harness.calls.closeIncoming(); await Promise.resolve(); await Promise.resolve();
  assert.equal(tag, 'call-ringing');
});

test('concurrent push messages keep both lines and the correct unread count', async () => {
  const notifications = new Map(), shown = [];
  const context = vm.createContext({
    URL, console, setTimeout, clearTimeout,
    location: { origin: 'https://ping.test' },
    self: { addEventListener() {}, registration: {
      getNotifications: async ({ tag }) => notifications.has(tag) ? [notifications.get(tag)] : [],
      showNotification: async (title, options) => {
        shown.push({ title, ...options });
        notifications.set(options.tag, { data: options.data, close: () => notifications.delete(options.tag) });
      },
    } },
  });
  vm.runInContext(fs.readFileSync('public/sw.js', 'utf8') + '\nglobalThis.show = showMessage;', context);
  await Promise.all([
    context.show({ tag: 'chat-1', title: 'Vijay', body: 'First' }),
    context.show({ tag: 'chat-1', title: 'Vijay', body: 'Second' }),
  ]);
  assert.equal(shown[1].data.count, 2); assert.equal(shown[1].body, 'First\nSecond');
  assert.match(shown[1].title, /2 new messages/);
});

test('an ICE restart requested during negotiation is retained for later', async () => {
  const { calls } = callHarness();
  const peer = { pc: { signalingState: 'have-local-offer' } };
  await calls.makeOffer(peer, true);
  assert.equal(peer.restartPending, true);
});
