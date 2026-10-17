// HD audio/video calls over WebRTC (peer-to-peer mesh, up to 8 people).
// Auto uses 1080p/30fps and the browser's codec order to avoid expensive software encoding.
// Explicit 4K and codec choices remain available. Congestion control adapts each sender.
import { h, icon, avatar, toast, actionSheet, promptDialog, fmtDur, isIOS, isMobile, store } from './ui.js';
import { sounds } from './media.js';
import { feature, api } from './core.js';
import { sign, verify, rememberKey } from './keys.js';
import { ensurePermission, permissionState } from './perm.js';

const fingerprint = (sdp) => (/a=fingerprint:\S+ ([0-9A-F:]+)/i.exec(sdp || '') || [])[1] || '';

const isApple = () => isIOS() || /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(navigator.userAgent);

const PROFILES = {
  uhd: { w: 3840, h: 2160, fps: 30, label: '4K Ultra HD' },
  fhd: { w: 1920, h: 1080, fps: 30, label: 'Full HD 1080p' },
  hd: { w: 1280, h: 720, fps: 30, label: 'HD 720p' },
  saver: { w: 640, h: 360, fps: 24, label: 'Data saver' },
};
const SCREEN_BPS = 8_000_000;

// Bitrate ceiling for the height the camera really delivers (WebRTC adapts below this on weak networks).
function bpsForHeight(h) {
  if (h >= 2000) return 16_000_000;
  if (h >= 1400) return 10_000_000;
  if (h >= 1000) return 6_000_000;
  if (h >= 700) return 3_000_000;
  if (h >= 480) return 1_500_000;
  return 700_000;
}

function profile() {
  const q = store.get('callQuality', 'auto');
  // Auto = the best the device can do (phones are capped at 1080p by captureSize). Older low settings → Auto.
  if (q === 'fhd') return PROFILES.fhd;
  return PROFILES.uhd;
}

function codecOrder() {
  const c = store.get('callCodec', 'auto');
  if (c === 'av1') return ['AV1', 'VP9', 'H264', 'VP8'];
  if (c === 'vp9') return ['VP9', 'AV1', 'H264', 'VP8'];
  if (c === 'h264') return ['H264', 'VP9', 'AV1', 'VP8'];
  return isApple() ? ['H264', 'VP9', 'AV1', 'VP8'] : ['VP9', 'AV1', 'H264', 'VP8'];
}

function sortedVideoCodecs() {
  if (store.get('callCodec', 'auto') === 'auto') return null; // Keep the browser's device-specific order.
  const caps = window.RTCRtpReceiver?.getCapabilities?.('video');
  if (!caps) return null;
  const order = codecOrder();
  const rank = (c) => {
    const name = c.mimeType.split('/')[1].toUpperCase();
    const i = order.indexOf(name);
    if (i < 0) return 100; // rtx / red / ulpfec / flexfec keep their relative order at the end
    let r = i;
    if (name === 'H264') {
      const f = c.sdpFmtpLine || '';
      if (!/packetization-mode=1/.test(f)) r += 0.4;
      if (!/profile-level-id=64/.test(f)) r += 0.2; // prefer High profile (better compression)
    }
    if (name === 'VP9' && /profile-id=[123]/.test(c.sdpFmtpLine || '')) r += 0.3; // profile 0 = widest support
    return r;
  };
  return caps.codecs.map((c, idx) => ({ c, idx })).sort((a, b) => rank(a.c) - rank(b.c) || a.idx - b.idx).map((x) => x.c);
}

function applyCodecPrefs(pc) {
  const codecs = sortedVideoCodecs();
  if (!codecs) return;
  for (const t of pc.getTransceivers()) {
    const kind = t.receiver?.track?.kind;
    if (kind === 'video' && t.setCodecPreferences) { try { t.setCodecPreferences(codecs); } catch {} }
  }
}

function tuneOpus(sdp) {
  const m = sdp.match(/a=rtpmap:(\d+) opus\/48000\/2/i);
  if (!m) return sdp;
  const pt = m[1];
  const want = { minptime: '10', useinbandfec: '1', stereo: '0', 'sprop-stereo': '0', maxaveragebitrate: '128000', usedtx: '0', cbr: '0' };
  const re = new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`);
  if (re.test(sdp)) {
    return sdp.replace(re, (_, p) => {
      const map = new Map(p.split(';').filter(Boolean).map((kv) => kv.trim().split('=')));
      for (const [k, v] of Object.entries(want)) map.set(k, v);
      return `a=fmtp:${pt} ` + [...map].map(([k, v]) => `${k}=${v}`).join(';');
    });
  }
  return sdp.replace(m[0], `${m[0]}\r\na=fmtp:${pt} ${Object.entries(want).map(([k, v]) => `${k}=${v}`).join(';')}`);
}

async function setLocal(pc, desc) {
  try { await pc.setLocalDescription({ type: desc.type, sdp: tuneOpus(desc.sdp) }); }
  catch { await pc.setLocalDescription(desc); }
}

export function initCalls(ctx) {
  const { socket } = ctx;
  let call = null;
  let incoming = null;
  let opening = false;
  let wakeLock = null;

  // ───────── local media ─────────

  // Never let the browser crop the camera to hit a size — that's what made calls look zoomed in.
  // resizeMode 'none' = use a real camera mode (full field of view); phones rotate it to portrait themselves.
  // Phones top out at 1080p: front cameras reach "4K" only via a cropped, zoomed sensor mode.
  function captureSize(p) {
    const q = isMobile() && p.h > 1080 ? PROFILES.fhd : p;
    return { width: { ideal: q.w }, height: { ideal: q.h }, resizeMode: { ideal: 'none' } };
  }

  async function getMedia({ audio = true, video = false, facing = 'user' }) {
    const p = profile();
    const ns = store.get('noiseSuppression', true);
    const constraints = {
      audio: audio ? { echoCancellation: true, noiseSuppression: ns, autoGainControl: true, channelCount: { ideal: 1 }, sampleRate: { ideal: 48000 } } : false,
      video: video ? { ...captureSize(p), frameRate: { ideal: p.fps, max: p.fps }, facingMode: { ideal: facing } } : false,
    };
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      stream.getVideoTracks().forEach((t) => { t.contentHint = 'motion'; });
      return stream;
    } catch (e) {
      if (video && audio && (e.name === 'NotFoundError' || e.name === 'NotReadableError' || e.name === 'OverconstrainedError')) {
        toast('Camera unavailable — joining with audio only');
        return navigator.mediaDevices.getUserMedia({ audio: constraints.audio });
      }
      throw e;
    }
  }

  function mediaError(e) {
    if (e?.name === 'NotAllowedError') { store.del('perm:camera'); store.del('perm:microphone'); return 'Allow camera and microphone access in your browser settings to make calls.'; }
    if (e?.name === 'NotFoundError') return 'No microphone or camera found.';
    if (!window.isSecureContext) return 'Calls need HTTPS. Open Ping Me over a secure (https://) link.';
    return 'Could not access camera/microphone.';
  }

  // ───────── session lifecycle ─────────

  // A call object without a live screen is a leftover (e.g. the connection dropped mid-call). Clear it.
  function dropStaleCall() {
    if (call?.ui && !call.ui.root.isConnected) cleanup();
  }

  // Relay (TURN) servers come with short-lived credentials — fetch them before every call.
  // Without a relay, phones on mobile data usually can't reach each other: ringing works, but no
  // video or voice arrives.
  let ice = null, iceAt = 0;
  async function freshIce() {
    if (ice && Date.now() - iceAt < 3600e3) return;
    try {
      const r = await Promise.race([api('GET', '/api/ice'), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))]);
      if (r?.iceServers?.length) { ice = r.iceServers; iceAt = Date.now(); }
    } catch {}
  }
  setTimeout(freshIce, 3000);

  async function start(...args) {
    if (opening) return;
    opening = true;
    try { return await startCall(...args); } finally { opening = false; }
  }

  async function startCall(chatId, video, { reason = '' } = {}) {
    dropStaleCall();
    if (call) { toast('You are already in a call'); restore(); return; }
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) return toast('Calls are not supported in this browser', { error: true });
    if (!(await ensurePermission(video ? ['camera', 'microphone'] : ['microphone'], video ? 'So the person you call can see and hear you.' : 'So the person you call can hear you.'))) return;
    const iceReady = freshIce();
    let stream;
    try { stream = await getMedia({ video }); } catch (e) { return toast(mediaError(e), { error: true, timeout: 6000 }); }
    await iceReady;
    call = newSession({ chatId, video, stream, outgoing: true });
    buildUI();
    const mine = call;
    // If the server never answers (connection dropped), don't leave a half-started call around.
    const startTimeout = setTimeout(() => { if (call === mine && !call.id) { toast('Couldn’t start the call — check your connection', { error: true }); cleanup(); } }, 15000);
    socket.emit('call:start', { chatId, video, reason }, async (res) => {
      clearTimeout(startTimeout);
      if (!call || call !== mine) return;
      if (!res?.ok) { toast(res?.error || 'Call failed', { error: true }); return cleanup(); }
      if (res.needReason) {
        // "Reason to call": they haven't chatted with you yet, so they'll see why you're calling first.
        cleanup();
        const why = await promptDialog({ title: 'Why are you calling?', placeholder: 'e.g. About tomorrow’s meeting', ok: 'Call', maxlength: 140, note: 'They haven’t chatted with you yet, so they’ll see this before picking up.' });
        if (why && why.trim()) start(chatId, video, { reason: why.trim() });
        return;
      }
      if (res.existing) {
        call.id = res.existing;
        return join();
      }
      call.id = res.callId;
      sounds.ringback();
      render();
    });
  }

  function newSession({ chatId, video, stream, outgoing }) {
    return {
      id: null, chatId, video, outgoing, stream,
      audioOn: stream.getAudioTracks().length > 0,
      videoOn: stream.getVideoTracks().length > 0,
      screen: null, facing: 'user',
      peers: new Map(), pendingIce: new Map(),
      state: outgoing ? 'ringing' : 'connecting',
      answeredAt: null, ui: null, timer: null, statsTimer: null, hideTimer: null,
      mini: false, showStats: false, status: '',
    };
  }

  function join() {
    const session = call;
    socket.emit('call:join', { callId: call.id, video: call.videoOn }, async (res) => {
      if (call !== session) return;
      if (!res?.ok) { toast(res?.error || 'Could not join the call', { error: true }); return cleanup(); }
      call.chatId = res.chatId;
      call.video = res.video || call.videoOn;
      if (res.answeredAt) markAnswered();
      sendMedia();
      for (const p of res.peers) {
        if (call !== session) return;
        const peer = createPeer(p.socketId, p.userId, true);
        peer.media = p.media || peer.media;
        await makeOffer(peer);
      }
      render();
    });
  }

  async function accept(video) {
    if (opening || call) return;
    opening = true;
    try { return await acceptCall(video); } finally { opening = false; }
  }

  async function acceptCall(video) {
    const inv = incoming?.invite;
    closeIncoming();
    if (!inv) return;
    const iceReady = freshIce();
    if (video && (await permissionState('camera')) === 'denied') { video = false; toast('Camera is blocked — answering with audio'); }
    if (!(await ensurePermission(video ? ['camera', 'microphone'] : ['microphone'], video ? 'So they can see and hear you.' : 'So they can hear you.'))) {
      socket.emit('call:decline', { callId: inv.callId });
      return;
    }
    let stream, mediaErr = null;
    try { stream = await getMedia({ video }); } catch (e) {
      mediaErr = e;
      // Camera refused? Still answer — with audio only.
      if (video && e?.name === 'NotAllowedError') {
        try { stream = await getMedia({ video: false }); toast('Answering with audio — camera access is off'); } catch (e2) { mediaErr = e2; }
      }
    }
    if (!stream) {
      socket.emit('call:decline', { callId: inv.callId });
      return toast(mediaError(mediaErr), { error: true, timeout: 6000 });
    }
    call = newSession({ chatId: inv.chatId, video: inv.video, stream, outgoing: false });
    call.id = inv.callId;
    const session = call;
    await iceReady;
    if (call !== session) return;
    buildUI();
    join();
  }

  // Join a group call that's already going on (missed it, declined, or left and came back).
  async function joinOngoing({ callId, chatId, video }) {
    dropStaleCall();
    if (call) { if (call.id === callId) return restore(); return toast('You are already in a call'); }
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) return toast('Calls are not supported in this browser', { error: true });
    const iceReady = freshIce();
    if (!(await ensurePermission(video ? ['camera', 'microphone'] : ['microphone'], video ? 'So everyone can see and hear you.' : 'So everyone can hear you.'))) return;
    let stream = null, err = null;
    try { stream = await getMedia({ video }); } catch (e) {
      err = e;
      if (video) { try { stream = await getMedia({ video: false }); toast('Joining with audio — camera unavailable'); } catch (e2) { err = e2; } }
    }
    if (!stream) return toast(mediaError(err), { error: true, timeout: 6000 });
    call = newSession({ chatId, video, stream, outgoing: false });
    call.id = callId;
    const session = call;
    await iceReady;
    if (call !== session) return;
    buildUI();
    join();
  }

  function hangup() {
    if (!call) return;
    if (call.id) socket.emit('call:leave', { callId: call.id });
    sounds.hangup();
    cleanup();
  }

  function cleanup(delay = 0) {
    const c = call;
    if (!c) return;
    call = null;
    sounds.stopLoop();
    clearInterval(c.timer); clearInterval(c.statsTimer); clearTimeout(c.hideTimer);
    for (const p of c.peers.values()) { clearTimeout(p.failTimer); try { p.pc.close(); } catch {} }
    c.stream?.getTracks().forEach((t) => t.stop());
    sounds.afterCall();
    c.whisper?.track?.stop();
    try { c.rewind?.stop(); } catch {}
    c.actx?.close().catch(() => {});
    c.screen?.getTracks().forEach((t) => t.stop());
    wakeLock?.release?.().catch(() => {}); wakeLock = null;
    if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
    const remove = () => { c.ui?.root.remove(); document.querySelector('.call-return')?.remove(); };
    if (delay) setTimeout(remove, delay); else remove();
    ctx.onCallChange?.(null);
  }

  function markAnswered() {
    if (!call || call.answeredAt) return;
    call.answeredAt = Date.now();
    call.state = 'active';
    sounds.stopLoop();
    clearInterval(call.timer);
    call.timer = setInterval(updateStatus, 1000);
    navigator.wakeLock?.request?.('screen').then((w) => { wakeLock = w; }).catch(() => {});
    startStats();
    if (feature('callRewind')) startRewindBuffer();
    render();
    scheduleHide();
  }

  // ───────── call audio extras: rewind · spatial · whisper ─────────

  function audioCtx() {
    if (!call.actx) { const AC = window.AudioContext || window.webkitAudioContext; call.actx = new AC(); }
    if (call.actx.state === 'suspended') call.actx.resume().catch(() => {});
    return call.actx;
  }

  // Rewind: keep the last 30 seconds of what the others said (on this device only, never stored).
  const REWIND_SECS = 30;
  function startRewindBuffer() {
    if (call.rewind) return;
    const a = audioCtx();
    const size = a.sampleRate * REWIND_SECS;
    const ring = new Float32Array(size);
    let pos = 0, filled = 0;
    const mix = a.createGain();
    const proc = a.createScriptProcessor(4096, 1, 1);
    proc.onaudioprocess = (e) => {
      const d = e.inputBuffer.getChannelData(0);
      for (let i = 0; i < d.length; i++) { ring[pos] = d[i]; pos = (pos + 1) % size; }
      filled = Math.min(size, filled + d.length);
    };
    const sink = a.createGain(); sink.gain.value = 0;
    mix.connect(proc); proc.connect(sink); sink.connect(a.destination);
    const sources = new Map();
    call.rewind = {
      add(peer) {
        const t = peer.stream.getAudioTracks()[0];
        if (!t || sources.has(peer.socketId)) return;
        const src = a.createMediaStreamSource(new MediaStream([t]));
        src.connect(mix); sources.set(peer.socketId, src);
      },
      snapshot() {
        const n = filled, out = a.createBuffer(1, Math.max(1, n), a.sampleRate), ch = out.getChannelData(0);
        for (let i = 0; i < n; i++) ch[i] = ring[(pos - n + i + size) % size];
        return out;
      },
      stop() { proc.disconnect(); mix.disconnect(); for (const s of sources.values()) s.disconnect(); },
      playing: null,
    };
    for (const p of call.peers.values()) call.rewind.add(p);
  }

  function toggleRewind() {
    const rw = call.rewind;
    if (!rw) return toast('Rewind starts once the call connects');
    if (rw.playing) { rw.playing.stop(); return; }
    const buf = rw.snapshot();
    if (buf.duration < 1) return toast('Nothing to rewind yet');
    const a = audioCtx();
    const src = a.createBufferSource();
    src.buffer = buf; src.connect(a.destination);
    for (const p of call.peers.values()) if (p.videoEl) p.videoEl.volume = 0.15; // duck the live call
    src.onended = () => { rw.playing = null; for (const p of call?.peers.values() || []) if (p.videoEl) p.videoEl.volume = 1; call && render(); };
    src.start();
    rw.playing = src;
    toast(`Replaying the last ${Math.round(buf.duration)}s — tap rewind again to stop`);
    render();
  }

  // Spatial group calls: each voice from its own direction (needs earphones to really shine).
  function updateSpatial() {
    if (!call) return;
    const peers = [...call.peers.values()];
    const on = feature('spatialAudio') && peers.length >= 2;
    peers.forEach((p, i) => {
      const t = p.stream.getAudioTracks()[0];
      if (!on || !t) {
        if (p.spatial) { p.spatial.src.disconnect(); p.spatial = null; }
        if (p.videoEl) p.videoEl.muted = false;
        return;
      }
      const a = audioCtx();
      if (!p.spatial) {
        const src = a.createMediaStreamSource(new MediaStream([t]));
        const pan = a.createPanner();
        pan.panningModel = 'HRTF'; pan.distanceModel = 'inverse'; pan.refDistance = 1;
        src.connect(pan).connect(a.destination);
        p.spatial = { src, pan };
        if (p.videoEl) p.videoEl.muted = true; // element keeps the stream flowing (Chrome), audio goes via Web Audio
      }
      const angle = peers.length === 1 ? 0 : (-70 + (140 * i) / (peers.length - 1)) * Math.PI / 180;
      p.spatial.pan.positionX.value = Math.sin(angle) * 2;
      p.spatial.pan.positionZ.value = -Math.cos(angle) * 2;
    });
  }

  // Whisper mode: compress + boost the mic so a soft voice arrives at normal loudness.
  async function toggleWhisper() {
    const raw = call.stream.getAudioTracks()[0];
    if (!raw) return;
    if (call.whisper) {
      call.whisper.track.stop();
      call.whisper = null;
      await replaceTrack('audio', raw);
      toast('Whisper mode off');
    } else {
      const a = audioCtx();
      const src = a.createMediaStreamSource(new MediaStream([raw]));
      const hp = a.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 110;
      const comp = a.createDynamicsCompressor();
      comp.threshold.value = -50; comp.knee.value = 12; comp.ratio.value = 10; comp.attack.value = 0.003; comp.release.value = 0.25;
      const gain = a.createGain(); gain.gain.value = 3.2;
      const dest = a.createMediaStreamDestination();
      src.connect(hp).connect(comp).connect(gain).connect(dest);
      const track = dest.stream.getAudioTracks()[0];
      track.enabled = call.audioOn;
      call.whisper = { track };
      await replaceTrack('audio', track);
      toast('Whisper mode on — speak softly');
    }
    render();
  }

  // ───────── verified call (device keys) ─────────

  async function sendVerification(peer) {
    if (!feature('verifiedDevices') || peer.verifySent) return;
    peer.verifySent = true;
    try {
      const mine = fingerprint(peer.pc.localDescription?.sdp), theirs = fingerprint(peer.pc.remoteDescription?.sdp);
      if (!mine || !theirs) return;
      const s = await sign(`pingme-call|${call.id}|${mine}|${theirs}`);
      signal(peer.socketId, { type: 'verify', keyId: s.keyId, jwk: s.jwk, sig: s.sig });
    } catch {}
  }

  async function checkVerification(peer, data) {
    let state = 'unverified';
    try {
      const theirs = fingerprint(peer.pc.remoteDescription?.sdp), mine = fingerprint(peer.pc.localDescription?.sdp);
      const ok = await verify(data.jwk, data.sig, `pingme-call|${call.id}|${theirs}|${mine}`);
      // The key must also be registered to that account on the server.
      const dev = ok ? await api('GET', `/api/devices/${data.keyId}`) : null;
      if (ok && dev?.userId === peer.userId) {
        const { isNew, firstEver } = rememberKey(peer.userId, data.keyId);
        state = firstEver ? 'first' : isNew ? 'new' : 'known';
      }
    } catch {}
    peer.verified = state;
    const name = ctx.user(peer.userId)?.name || 'They';
    if (state === 'new') toast(`${name} is calling from a new device. If this is unexpected, verify it’s really them.`, { error: true, timeout: 7000 });
    render();
  }

  // ───────── peers ─────────

  function createPeer(socketId, userId, initiator) {
    if (call.peers.has(socketId)) return call.peers.get(socketId);
    // 'relay-only' (diagnostics): route media through TURN only, like the strictest mobile networks.
    const session = call;
    const pc = new RTCPeerConnection({ iceServers: ice || ctx.config().iceServers, iceTransportPolicy: store.get('relay-only', false) ? 'relay' : 'all', bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require', iceCandidatePoolSize: 2 });
    const peer = {
      socketId, userId, pc, initiator,
      stream: new MediaStream(),
      media: { audio: true, video: call.video, screen: false },
      tile: null, videoEl: null, prev: null, quality: '', level: 0, failTimer: null,
    };
    call.peers.set(socketId, peer);

    if (initiator) {
      const a = call.stream.getAudioTracks()[0], v = call.screen?.getVideoTracks()[0] || call.stream.getVideoTracks()[0];
      pc.addTransceiver(a || 'audio', { direction: 'sendrecv', streams: [call.stream] });
      pc.addTransceiver(v || 'video', { direction: 'sendrecv', streams: [call.stream] });
      applyCodecPrefs(pc);
    }

    pc.onsignalingstatechange = () => {
      if (call === session && pc.signalingState === 'stable' && peer.restartPending) {
        peer.restartPending = false;
        restartIce(peer);
      }
    };
    // peer.socketId (not the original id): the other phone may rejoin on a new connection mid-call.
    pc.onicecandidate = (e) => { if (call === session && e.candidate) signal(peer.socketId, { type: 'ice', candidate: e.candidate.toJSON() }); };
    pc.ontrack = (e) => {
      if (call !== session) return;
      if (!peer.stream.getTracks().includes(e.track)) peer.stream.addTrack(e.track);
      e.track.onunmute = () => renderTile(peer);
      e.track.onmute = () => renderTile(peer);
      attachRemote(peer);
      if (e.track.kind === 'audio') { call.rewind?.add(peer); updateSpatial(); }
    };
    pc.onconnectionstatechange = () => {
      if (call !== session) return;
      const s = pc.connectionState;
      if (s === 'connected') {
        clearTimeout(peer.failTimer);
        markAnswered();
        tuneSenders();
        sendVerification(peer);
        call.rewind?.add(peer);
        updateSpatial();
        if (call.peers.size > 1) sounds.join();
      } else if (s === 'failed' || s === 'disconnected') {
        clearTimeout(peer.failTimer);
        peer.failTimer = setTimeout(() => {
          if (pc.connectionState === 'connected' || call !== session || call.peers.get(peer.socketId) !== peer) return;
          if (peer.initiator) restartIce(peer); else signal(peer.socketId, { type: 'restart' });
        }, s === 'failed' ? 0 : 3000);
      }
      renderTile(peer);
      updateStatus();
    };
    // Never fail silently: if no media path appears, say so.
    setTimeout(() => {
      if (call !== session || call.peers.get(peer.socketId) !== peer || ['connected', 'closed'].includes(pc.connectionState)) return;
      toast((ice || ctx.config().iceServers || []).some((s) => [].concat(s.urls).some((u) => /^turns?:/.test(u)))
        ? 'Still connecting — the network is slow. Try Wi-Fi or move to better signal.'
        : 'Can’t connect the call on this network — the server’s call relay (TURN) isn’t set up yet.', { error: true, timeout: 8000 });
    }, 20000);
    // Flush any ICE that arrived before we knew this peer.
    const q = call.pendingIce.get(socketId);
    if (q) { peer.queued = q; call.pendingIce.delete(socketId); }
    buildTile(peer);
    render();
    return peer;
  }

  async function makeOffer(peer, iceRestart = false) {
    if (peer.makingOffer || peer.pc.signalingState !== 'stable') {
      if (iceRestart) peer.restartPending = true;
      return;
    }
    const session = call;
    peer.makingOffer = true;
    try {
      const offer = await peer.pc.createOffer({ iceRestart });
      if (call !== session || peer.pc.signalingState === 'closed') return;
      await setLocal(peer.pc, offer);
      if (call === session) signal(peer.socketId, { type: 'offer', sdp: peer.pc.localDescription.sdp });
    } finally { peer.makingOffer = false; }
  }

  async function restartIce(peer) {
    if (peer.restarting) return;
    const session = call;
    peer.restarting = true;
    try {
      await freshIce();
      if (!session || call !== session || !session.peers.has(peer.socketId)) return;
      if (ice) peer.pc.setConfiguration({ ...peer.pc.getConfiguration(), iceServers: ice });
      // Only the designated offerer restarts; avoid colliding offers on both phones.
      await makeOffer(peer, true);
    } catch (e) { console.warn('ICE restart failed', e); }
    finally { peer.restarting = false; }
  }

  function recoverNetwork() {
    if (!call) return;
    for (const peer of call.peers.values()) {
      if (peer.initiator) restartIce(peer);
      else signal(peer.socketId, { type: 'restart' });
    }
  }
  window.addEventListener('online', recoverNetwork);
  navigator.connection?.addEventListener('change', recoverNetwork);

  async function handleOffer(peer, sdp) {
    const session = call;
    const pc = peer.pc;
    await pc.setRemoteDescription({ type: 'offer', sdp });
    if (call !== session) return;
    const a = call.stream.getAudioTracks()[0];
    const v = call.screen?.getVideoTracks()[0] || call.stream.getVideoTracks()[0];
    for (const t of pc.getTransceivers()) {
      const kind = t.receiver.track.kind;
      if (t.currentDirection === null || t.direction !== 'sendrecv' || !t.sender.track) {
        t.direction = 'sendrecv';
        await t.sender.replaceTrack(kind === 'audio' ? a || null : v || null);
        try { t.sender.setStreams?.(call.stream); } catch {}
      }
    }
    applyCodecPrefs(pc);
    const answer = await pc.createAnswer();
    await setLocal(pc, answer);
    if (call !== session) return;
    signal(peer.socketId, { type: 'answer', sdp: pc.localDescription.sdp });
    await flushIce(peer);
  }

  async function flushIce(peer) {
    const queued = peer.queued || [];
    peer.queued = [];
    for (const c of queued) { try { await peer.pc.addIceCandidate(c); } catch {} }
  }

  function signal(to, data) { socket.emit('call:signal', { callId: call?.id, to, data }); }

  function removePeer(socketId) {
    const p = call?.peers.get(socketId);
    if (!p) return;
    clearTimeout(p.failTimer);
    try { p.pc.close(); } catch {}
    p.tile?.remove();
    if (p.spatial) p.spatial.src.disconnect();
    call.peers.delete(socketId);
    updateSpatial();
    render();
    tuneSenders();
  }

  async function replaceTrack(kind, track) {
    for (const p of call.peers.values()) {
      for (const t of p.pc.getTransceivers()) {
        if (t.receiver.track.kind === kind && t.sender) { try { await t.sender.replaceTrack(track); } catch {} }
      }
    }
    tuneSenders();
  }

  // Bitrate ceilings per sender; congestion control adapts underneath.
  async function tuneSenders() {
    if (!call) return;
    const session = call;
    const p = profile();
    for (const peer of call.peers.values()) {
      for (const s of peer.pc.getSenders()) {
        if (!s.track) continue;
        const params = s.getParameters();
        if (!params.encodings || !params.encodings.length) params.encodings = [{}];
        const enc = params.encodings[0];
        if (s.track.kind === 'video') {
          if (call !== session) return;
          const screen = !!session.screen;
          const settings = s.track.getSettings?.() || {};
          const height = Math.min(settings.width || p.w, settings.height || p.h);
          // Full resolution and full bitrate to every person, also in group calls (no compromise).
          enc.maxBitrate = screen ? SCREEN_BPS : bpsForHeight(Math.min(height, p.h));
          enc.maxFramerate = screen ? 30 : p.fps;
          enc.scaleResolutionDownBy = 1;
          enc.networkPriority = 'high';
          params.degradationPreference = screen ? 'maintain-resolution' : 'maintain-framerate';
        } else {
          enc.maxBitrate = 128000; // HD voice
          enc.priority = 'high';
          enc.networkPriority = 'high';
        }
        try { await s.setParameters(params); }
        catch { delete params.degradationPreference; try { await s.setParameters(params); } catch {} }
      }
    }
  }

  function sendMedia() {
    if (!call?.id) return;
    socket.emit('call:media', { callId: call.id, audio: call.audioOn, video: call.videoOn || !!call.screen, screen: !!call.screen });
  }

  // ───────── controls ─────────

  function toggleMic() {
    call.audioOn = !call.audioOn;
    call.stream.getAudioTracks().forEach((t) => (t.enabled = call.audioOn));
    if (call.whisper) call.whisper.track.enabled = call.audioOn;
    sendMedia(); render();
  }

  async function toggleCamera() {
    const session = call;
    if (!session || session.cameraBusy) return;
    session.cameraBusy = true;
    try {
      if (session.videoOn) {
        session.stream.getVideoTracks().forEach((t) => { t.stop(); session.stream.removeTrack(t); });
        session.videoOn = false;
        if (!session.screen) await replaceTrack('video', null);
      } else {
        if (!(await ensurePermission(['camera'], 'So the people on this call can see you.')) || call !== session) return;
        const stream = await getMedia({ audio: false, video: true, facing: session.facing });
        if (call !== session) { stream.getTracks().forEach((t) => t.stop()); return; }
        const track = stream.getVideoTracks()[0];
        session.stream.addTrack(track);
        session.videoOn = session.video = true;
        if (!session.screen) await replaceTrack('video', track);
      }
    } catch (e) { toast(mediaError(e), { error: true }); }
    finally { session.cameraBusy = false; }
    if (call === session) { sendMedia(); render(); }
  }

  async function flipCamera() {
    const session = call;
    if (!session?.videoOn || session.cameraBusy) return;
    session.cameraBusy = true;
    const previous = session.facing;
    const facing = previous === 'user' ? 'environment' : 'user';
    // Mobile cameras often require releasing the current camera before opening the other.
    session.stream.getVideoTracks().forEach((t) => { t.stop(); session.stream.removeTrack(t); });
    try {
      let stream;
      try {
        stream = await getMedia({ audio: false, video: true, facing });
        session.facing = facing;
      } catch {
        stream = await getMedia({ audio: false, video: true, facing: previous });
        toast('Could not switch cameras — restored the previous camera');
      }
      if (call !== session) { stream.getTracks().forEach((t) => t.stop()); return; }
      const track = stream.getVideoTracks()[0];
      session.stream.addTrack(track);
      if (!session.screen) await replaceTrack('video', track);
    } catch (e) {
      session.videoOn = false;
      if (call === session && !session.screen) await replaceTrack('video', null);
      toast(mediaError(e), { error: true });
    } finally { session.cameraBusy = false; }
    if (call === session) { sendMedia(); render(); }
  }

  async function toggleScreen() {
    const session = call;
    if (!session) return;
    if (call.screen) return stopScreen();
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 30 }, width: { max: 3840 }, height: { max: 2160 } }, audio: false });
      if (call !== session) { s.getTracks().forEach((t) => t.stop()); return; }
      const t = s.getVideoTracks()[0];
      t.contentHint = 'detail';
      t.onended = () => stopScreen();
      call.screen = s;
      await replaceTrack('video', t);
      sendMedia(); render();
    } catch (e) { if (e?.name !== 'NotAllowedError') toast('Screen sharing failed', { error: true }); }
  }

  async function stopScreen() {
    if (!call?.screen) return;
    call.screen.getTracks().forEach((t) => t.stop());
    call.screen = null;
    await replaceTrack('video', call.stream.getVideoTracks()[0] || null);
    sendMedia(); render();
  }

  async function moreMenu() {
    const session = call;
    const chat = ctx.chat(call.chatId);
    const inCall = new Set([...call.peers.values()].map((p) => p.userId).concat(ctx.me().id));
    const missing = chat ? chat.members.filter((m) => !inCall.has(m.id)).map((m) => m.id) : [];
    const pipOk = document.pictureInPictureEnabled && [...call.peers.values()].some((p) => p.videoEl);
    const r = await actionSheet({
      align: 'left',
      actions: [
        missing.length ? { label: `Ring ${missing.length === 1 ? ctx.user(missing[0])?.name : missing.length + ' others'}`, icon: 'useradd', value: 'ring' } : null,
        pipOk ? { label: 'Picture in Picture', icon: 'pip', value: 'pip' } : null,
        feature('whisperMode') ? { label: call.whisper ? 'Turn off whisper mode' : 'Whisper mode (boost a soft voice)', icon: 'mic', value: 'whisper' } : null,
        { label: call.showStats ? 'Hide call statistics' : 'Show call statistics', icon: 'chart', value: 'stats' },
        { label: `Quality: ${profile().label}`, icon: 'settings', value: 'quality' },
      ],
    });
    if (call !== session) return;
    if (r === 'ring') socket.emit('call:ring-more', { callId: call.id, userIds: missing });
    if (r === 'pip') { const v = [...call.peers.values()].find((p) => p.videoEl)?.videoEl; v?.requestPictureInPicture?.().catch(() => toast('Picture in Picture not available')); }
    if (r === 'stats') { call.showStats = !call.showStats; render(); }
    if (r === 'whisper') toggleWhisper();
    if (r === 'quality') {
      const q = await actionSheet({ title: 'Video quality', actions: [
        { label: 'Auto (highest your device supports)', value: 'auto' }, { label: PROFILES.uhd.label, value: 'uhd' }, { label: PROFILES.fhd.label, value: 'fhd' },
      ] });
      if (q && call === session) {
        store.set('callQuality', q);
        const p = profile();
        const t = call.stream.getVideoTracks()[0];
        if (t) { try { await t.applyConstraints({ ...captureSize(p), frameRate: { ideal: p.fps, max: p.fps } }); } catch {} }
        tuneSenders();
        toast(`Quality set to ${q === 'auto' ? 'Auto' : p.label}`);
      }
    }
  }

  function minimize() { call.mini = true; render(); ctx.onCallChange?.(call); }
  function restore() { if (!call) return; call.mini = false; render(); document.querySelector('.call-return')?.remove(); }

  // ───────── UI ─────────

  function buildUI() {
    ctx.onCallStart?.();
    const root = h('div', { class: 'call' });
    const bg = h('div', { class: 'bgblur grad' });
    const stage = h('div', { class: 'stage n1' });
    const ring = h('div', { class: 'ring-center' });
    const selfVideo = h('video', { autoplay: true, playsinline: true, muted: true });
    selfVideo.muted = true;
    const self = h('div', { class: 'self' }, selfVideo, h('div', { class: 'off', hidden: true }, icon('videooff')));
    const status = h('div', { class: 'st' });
    const nameEl = h('div', { class: 'nm' });
    const qEl = h('span', { class: 'q', hidden: true }, h('i'), h('i'), h('i'));
    const top = h('div', { class: 'top' },
      h('button', { class: 'tb', title: 'Minimize', onclick: (e) => { e.stopPropagation(); minimize(); } }, icon('min')),
      h('div', { class: 'mid' }, nameEl, h('div', { class: 'st-wrap' }, status, qEl)),
      h('button', { class: 'tb', title: 'More', onclick: (e) => { e.stopPropagation(); moreMenu(); } }, icon('dots')));
    const controls = h('div', { class: 'controls' });
    const bottom = h('div', { class: 'bottom', onclick: (e) => e.stopPropagation() }, controls);
    const stats = h('div', { class: 'stats', hidden: true });
    const miniLabel = h('div', { class: 'mini-label' });
    root.append(bg, stage, ring, self, top, bottom, stats, miniLabel);
    document.body.append(root);
    call.ui = { root, bg, stage, ring, self, selfVideo, status, nameEl, qEl, controls, stats, miniLabel };

    root.addEventListener('click', () => {
      if (call?.mini) return restore();
      if (call?.state !== 'active') return;
      root.classList.toggle('hide-ui');
      scheduleHide();
    });
    makeDraggable(self);
    render();
  }

  function scheduleHide() {
    if (!call) return;
    clearTimeout(call.hideTimer);
    const anyVideo = [...call.peers.values()].some((p) => hasVideo(p));
    if (anyVideo && !call.showStats) call.hideTimer = setTimeout(() => call?.ui?.root.classList.add('hide-ui'), 5000);
  }

  function makeDraggable(el) {
    let sx, sy, ox, oy, dragging = false, moved = false;
    el.addEventListener('pointerdown', (e) => {
      if (el.classList.contains('full')) return;
      e.stopPropagation();
      dragging = true; moved = false; el.setPointerCapture(e.pointerId);
      const r = el.getBoundingClientRect(); sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
      el.classList.add('dragging');
    });
    el.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
      el.style.left = ox + dx + 'px'; el.style.top = oy + dy + 'px'; el.style.right = 'auto'; el.style.bottom = 'auto';
    });
    const end = () => {
      if (!dragging) return;
      dragging = false; el.classList.remove('dragging');
      const r = el.getBoundingClientRect();
      const m = 14, W = innerWidth, H = innerHeight;
      const left = r.left + r.width / 2 < W / 2 ? m : W - r.width - m;
      const top = r.top + r.height / 2 < H / 2 ? m + 70 : H - r.height - 150;
      el.style.left = left + 'px'; el.style.top = top + 'px';
      store.set('selfPos', { right: left > W / 2 - r.width, bottom: top > H / 2 - r.height });
    };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    el.addEventListener('click', (e) => { e.stopPropagation(); if (!moved && call?.peers.size) { /* swap could go here */ } });
  }

  function placeSelf(force = false) {
    const el = call.ui.self;
    if (el.classList.contains('full') || (el.style.left && !force)) return;
    const pos = store.get('selfPos', { right: true, bottom: false });
    // Measure the final PiP size with transitions off (it may be shrinking from full screen).
    el.classList.add('dragging');
    const w = el.offsetWidth, hgt = el.offsetHeight, m = 14;
    el.style.left = (pos.right ? innerWidth - w - m : m) + 'px';
    el.style.top = (pos.bottom ? innerHeight - hgt - 150 : m + 70) + 'px';
    requestAnimationFrame(() => el.classList.remove('dragging'));
  }

  function hasVideo(p) {
    const t = p.stream.getVideoTracks()[0];
    return !!t && t.readyState === 'live' && !t.muted && (p.media.video || p.media.screen);
  }

  function buildTile(peer) {
    const u = ctx.user(peer.userId);
    const v = h('video', { class: 'fg', autoplay: true, playsinline: true });
    v.setAttribute('autopictureinpicture', ''); // Safari/Chrome: float the call when leaving the app
    // Blurred copy behind the video: fills the screen when the picture's shape differs from it.
    const bgv = h('video', { class: 'bgv', autoplay: true, playsinline: true, muted: true, 'aria-hidden': 'true' });
    bgv.muted = true;
    const ph = h('div', { class: 'ph' }, avatar({ id: peer.userId, name: u?.name, src: ctx.userAvatar(peer.userId), size: 110 }), h('div', { class: 'phs' }, 'Connecting…'));
    const nm = h('div', { class: 'nm' });
    peer.tile = h('div', { class: 'tile' }, bgv, v, ph, nm);
    peer.videoEl = v;
    peer.bgEl = bgv;
    peer.tile.addEventListener('dblclick', () => peer.tile.classList.toggle('contain'));
  }

  // Fill the tile when the video's shape matches it; otherwise show the whole picture (no heavy crop).
  function fitVideo(peer) {
    const v = peer.videoEl, t = peer.tile;
    if (!v?.videoWidth || !t) return;
    // Fill only when the shapes almost match (crop ≤ ~8%); otherwise show the whole picture over its
    // blurred copy — nobody's face gets cut off or zoomed.
    const va = v.videoWidth / v.videoHeight, ta = t.clientWidth / Math.max(1, t.clientHeight);
    const mismatch = Math.max(va, ta) / Math.min(va, ta);
    t.classList.toggle('contain', !!peer.media.screen || mismatch > 1.08);
  }

  function attachRemote(peer) {
    if (!peer.fitBound) {
      peer.fitBound = true;
      peer.videoEl.addEventListener('loadedmetadata', () => fitVideo(peer));
      peer.videoEl.addEventListener('resize', () => fitVideo(peer));
      addEventListener('resize', () => fitVideo(peer));
    }
    if (peer.videoEl.srcObject !== peer.stream) peer.videoEl.srcObject = peer.stream;
    const vt = peer.stream.getVideoTracks()[0];
    if (vt && peer.bgEl && peer.bgEl.srcObject?.getVideoTracks()[0] !== vt) { peer.bgEl.srcObject = new MediaStream([vt]); peer.bgEl.play().catch(() => {}); }
    peer.videoEl.play().catch((e) => {
      // Phone blocked sound until a tap — offer one, so the other person is never silent.
      if (e?.name === 'NotAllowedError') toast('Tap here to hear the call', { timeout: 15000, onClick: () => { for (const p of call?.peers.values() || []) p.videoEl?.play().catch(() => {}); } });
    });
    renderTile(peer);
    render();
  }

  function renderTile(peer) {
    if (!peer.tile) return;
    const vid = hasVideo(peer);
    const u = ctx.user(peer.userId);
    peer.videoEl.style.visibility = vid ? 'visible' : 'hidden';
    peer.tile.querySelector('.ph').hidden = vid;
    peer.tile.classList.toggle('screen', !!peer.media.screen);
    const st = peer.pc.connectionState;
    peer.tile.querySelector('.phs').textContent = st === 'connected' ? (peer.media.audio ? '' : 'Muted') : st === 'failed' || st === 'disconnected' ? 'Reconnecting…' : 'Connecting…';
    const nm = peer.tile.querySelector('.nm');
    nm.replaceChildren(peer.media.audio ? '' : icon('micoff'), u?.name || '');
    peer.tile.classList.toggle('speaking', peer.level > 0.04 && call.peers.size > 1);
  }

  function updateStatus() {
    if (!call?.ui) return;
    const n = call.peers.size;
    let s;
    if (call.status) s = call.status;
    else if (call.state === 'ringing') s = call.peers.size ? 'Connecting…' : 'Calling…';
    else if (call.state === 'connecting' || !call.answeredAt) s = 'Connecting…';
    else {
      const recon = [...call.peers.values()].some((p) => ['disconnected', 'failed'].includes(p.pc.connectionState));
      s = recon ? 'Reconnecting…' : fmtDur((Date.now() - call.answeredAt) / 1000);
    }
    const peers = [...call.peers.values()];
    const v = peers.length === 1 ? peers[0].verified : null;
    const badge = v === 'known' ? ' · ✓ Same device as before' : v === 'first' ? ' · ✓ Verified device' : v === 'new' ? ' · New device' : '';
    call.ui.status.textContent = s + (call.answeredAt && !call.status ? badge : '') + (call.whisper ? ' · Whisper' : '');
    call.ui.miniLabel.textContent = (n ? '' : '') + s;
    const back = document.querySelector('.call-return');
    if (back) back.textContent = `Return to call · ${s}`;
  }

  function title() {
    const chat = ctx.chat(call.chatId);
    return chat ? ctx.chatTitle(chat) : 'Call';
  }

  function render() {
    if (!call?.ui) return;
    const ui = call.ui;
    const chat = ctx.chat(call.chatId);
    const peers = [...call.peers.values()];
    ui.root.classList.toggle('mini', call.mini);
    if (call.mini && !document.querySelector('.call-return')) {
      document.body.append(h('div', { class: 'call-return', onclick: restore }, 'Return to call'));
    }
    ui.nameEl.textContent = title();
    // While it's still ringing, keep the screen simple: no minimise / ⋯ until the call connects.
    ui.root.querySelectorAll('.top .tb').forEach((b) => { b.style.visibility = call.state === 'active' ? 'visible' : 'hidden'; });

    // background avatar while ringing
    const otherId = chat?.type === 'direct' ? chat.members.find((m) => m.id !== ctx.me().id)?.id : null;
    const bgSrc = chat?.type === 'group' ? ctx.chatAvatar(chat) : otherId ? ctx.userAvatar(otherId) : null;
    if (bgSrc) { ui.bg.classList.remove('grad'); ui.bg.style.backgroundImage = `url("${bgSrc}")`; }

    // stage
    const connectedPeers = peers;
    ui.stage.className = 'stage n' + Math.max(1, connectedPeers.length);
    const want = connectedPeers.map((p) => p.tile);
    if ([...ui.stage.children].some((c, i) => c !== want[i]) || ui.stage.children.length !== want.length) ui.stage.replaceChildren(...want);
    peers.forEach(renderTile);

    // ringing card
    const showRing = !connectedPeers.length;
    ui.ring.hidden = !showRing;
    if (showRing) {
      ui.ring.replaceChildren(
        chat?.type === 'group' ? avatar({ id: chat.id, name: chat.title, src: ctx.chatAvatar(chat), size: 130, group: true }) : avatar({ id: otherId, name: title(), src: otherId ? ctx.userAvatar(otherId) : null, size: 130 }),
        h('h2', null, title()),
        h('p', null, call.status || (call.outgoing ? (call.video ? 'Video calling…' : 'Calling…') : 'Connecting…')));
    }

    // self view
    const selfTrack = call.screen?.getVideoTracks()[0] || call.stream.getVideoTracks()[0];
    const selfStream = selfTrack ? new MediaStream([selfTrack]) : null;
    if (selfTrack && ui.selfVideo.srcObject?.getVideoTracks()[0] !== selfTrack) { ui.selfVideo.srcObject = selfStream; ui.selfVideo.play().catch(() => {}); }
    // Your preview box takes your camera's real shape (portrait on phones, landscape on laptops).
    const st = selfTrack?.getSettings?.() || {};
    const setShape = (w, hh) => { ui.self.style.setProperty('--ar', `${w} / ${hh}`); ui.self.classList.toggle('land', w > hh); };
    if (st.width && st.height) setShape(st.width, st.height);
    ui.selfVideo.onloadedmetadata = () => { const v = ui.selfVideo; if (v.videoWidth) { setShape(v.videoWidth, v.videoHeight); placeSelf(true); } };
    if (!selfTrack) ui.selfVideo.srcObject = null;
    ui.selfVideo.classList.toggle('mirror', !call.screen && call.facing === 'user');
    ui.self.hidden = !selfTrack && !connectedPeers.length;
    ui.self.querySelector('.off').hidden = !!selfTrack;
    const full = !!selfTrack && !connectedPeers.length;
    ui.self.classList.toggle('full', full);
    if (full) { ui.self.style.left = ''; ui.self.style.top = ''; ui.ring.style.background = 'rgba(0,0,0,0.25)'; }
    else { ui.ring.style.background = ''; placeSelf(); }
    if (!selfTrack && !connectedPeers.length) ui.self.hidden = true;

    // controls
    const canFlip = isMobile() && call.videoOn && !call.screen;
    const canScreen = !!navigator.mediaDevices?.getDisplayMedia && !isMobile();
    const btn = (ic, on, fn, label, cls = '') => h('button', { class: `cb ${on ? '' : 'off'} ${cls}`, title: label, 'aria-label': label, onclick: (e) => { e.stopPropagation(); fn(); scheduleHide(); } }, icon(ic));
    ui.controls.replaceChildren(
      btn(call.audioOn ? 'mic' : 'micoff', call.audioOn, toggleMic, call.audioOn ? 'Mute' : 'Unmute'),
      btn(call.videoOn ? 'video' : 'videooff', call.videoOn, toggleCamera, call.videoOn ? 'Turn camera off' : 'Turn camera on'),
      canFlip ? btn('flip', true, flipCamera, 'Flip camera') : null,
      canScreen ? btn('screen', !call.screen, toggleScreen, call.screen ? 'Stop sharing' : 'Share screen', call.screen ? 'off' : '') : null,
      feature('callRewind') && call.answeredAt ? btn('undo', !call.rewind?.playing, toggleRewind, call.rewind?.playing ? 'Stop rewind' : 'Rewind 30 seconds') : null,
      h('button', { class: 'cb end', title: 'End call', 'aria-label': 'End call', onclick: (e) => { e.stopPropagation(); hangup(); } }, icon('phoneoff')));
    // screen button: "off" style means active sharing (white)
    ui.stats.hidden = !call.showStats;
    if (call.state !== 'active') ui.root.classList.remove('hide-ui');
    updateStatus();
  }

  // ───────── stats / quality ─────────

  function startStats() {
    clearInterval(call.statsTimer);
    call.statsTimer = setInterval(collectStats, 2000);
  }

  async function collectStats() {
    if (!call) return;
    const lines = [];
    let worst = 'good';
    const rank = { good: 0, ok: 1, poor: 2 };
    for (const p of call.peers.values()) {
      let r;
      try { r = await p.pc.getStats(); } catch { continue; }
      const cur = { t: performance.now() };
      let inV, outV, inA, pair, codecs = {};
      r.forEach((s) => {
        if (s.type === 'inbound-rtp' && s.kind === 'video') inV = s;
        if (s.type === 'inbound-rtp' && s.kind === 'audio') inA = s;
        if (s.type === 'outbound-rtp' && s.kind === 'video' && !s.rid) outV = s;
        if (s.type === 'candidate-pair' && (s.nominated || s.selected) && s.state === 'succeeded') pair = s;
        if (s.type === 'codec') codecs[s.id] = s;
      });
      const prev = p.prev || {};
      const dt = (cur.t - (prev.t || cur.t - 2000)) / 1000;
      const kbps = (bytes, pb) => (bytes && pb !== undefined ? Math.round(((bytes - pb) * 8) / dt / 1000) : 0);
      cur.inBytes = (inV?.bytesReceived || 0) + (inA?.bytesReceived || 0);
      cur.outBytes = outV?.bytesSent || 0;
      cur.lost = (inV?.packetsLost || 0) + (inA?.packetsLost || 0);
      cur.recv = (inV?.packetsReceived || 0) + (inA?.packetsReceived || 0);
      const dLost = cur.lost - (prev.lost || 0), dRecv = cur.recv - (prev.recv || 0);
      const loss = dRecv + dLost > 0 ? (dLost / (dRecv + dLost)) * 100 : 0;
      const rtt = pair?.currentRoundTripTime ? Math.round(pair.currentRoundTripTime * 1000) : null;
      const q = loss < 2 && (rtt ?? 0) < 250 ? 'good' : loss < 7 && (rtt ?? 0) < 500 ? 'ok' : 'poor';
      if (rank[q] > rank[worst]) worst = q;
      p.level = inA?.audioLevel || 0;
      const u = ctx.user(p.userId);
      const codec = inV?.codecId && codecs[inV.codecId] ? codecs[inV.codecId].mimeType.split('/')[1] : '–';
      const ocodec = outV?.codecId && codecs[outV.codecId] ? codecs[outV.codecId].mimeType.split('/')[1] : '–';
      const acodec = inA?.codecId && codecs[inA.codecId] ? codecs[inA.codecId].mimeType.split('/')[1] : '–';
      lines.push(
        `${u?.name || 'Peer'}  ${q.toUpperCase()}`,
        `  ↓ ${inV?.frameWidth || 0}×${inV?.frameHeight || 0} @${Math.round(inV?.framesPerSecond || 0)}fps  ${codec}  ${kbps(cur.inBytes, prev.inBytes)} kbps`,
        `  ↑ ${outV?.frameWidth || 0}×${outV?.frameHeight || 0} @${Math.round(outV?.framesPerSecond || 0)}fps  ${ocodec}  ${kbps(cur.outBytes, prev.outBytes)} kbps${outV?.qualityLimitationReason && outV.qualityLimitationReason !== 'none' ? '  (limited: ' + outV.qualityLimitationReason + ')' : ''}`,
        `  audio ${acodec}  loss ${loss.toFixed(1)}%  rtt ${rtt ?? '–'}ms  jitter ${inV?.jitter ? Math.round(inV.jitter * 1000) : '–'}ms`,
        `  path ${pair ? (r.get(pair.localCandidateId)?.candidateType || '?') + '→' + (r.get(pair.remoteCandidateId)?.candidateType || '?') : '–'}`);
      p.prev = cur;
      renderTile(p);
    }
    if (!call) return;
    call.ui.qEl.hidden = !call.peers.size;
    call.ui.qEl.className = 'q ' + worst;
    call.ui.stats.textContent = lines.join('\n') || 'Waiting for media…';
  }

  // ───────── incoming ─────────

  function showIncoming(inv) {
    dropStaleCall();
    if (call) {
      if (call.id === inv.callId) return;
      socket.emit('call:decline', { callId: inv.callId, busy: true });
      const u = ctx.user(inv.from);
      return toast(`Missed call from ${u?.name || 'someone'} (you were on a call)`);
    }
    if (incoming?.invite.callId === inv.callId) return;
    closeIncoming();
    const chat = ctx.chat(inv.chatId);
    const from = ctx.user(inv.from);
    const name = inv.group && chat ? ctx.chatTitle(chat) : from?.name || 'Someone';
    const src = inv.group && chat ? ctx.chatAvatar(chat) : ctx.userAvatar(inv.from);
    const bg = h('div', { class: 'bgblur' + (src ? '' : ' grad'), style: src ? { backgroundImage: `url("${src}")` } : null });
    const root = h('div', { class: 'call' },
      bg,
      h('div', { class: 'ring-center' },
        avatar({ id: inv.group ? inv.chatId : inv.from, name, src, size: 130, group: inv.group }),
        h('h2', null, name),
        h('p', null, `Ping Me ${inv.video ? 'Video' : 'Audio'}${inv.group ? ' · ' + (from?.name || '') : ''}`),
        inv.reason ? h('div', { class: 'call-reason' + (inv.reason === 'SOS' ? ' sos' : '') }, inv.reason === 'SOS' ? 'SOS — they need help' : `“${inv.reason}”`) : null),
      h('div', { class: 'bottom', style: { position: 'relative' } },
        h('div', { class: 'incoming-actions' },
          h('div', { class: 'col' }, h('button', { class: 'cb big end', 'aria-label': 'Decline', onclick: decline }, icon('phoneoff')), 'Decline'),
          inv.video ? h('div', { class: 'col' }, h('button', { class: 'cb big', 'aria-label': 'Answer with audio only', onclick: () => accept(false) }, icon('phone')), 'Audio') : null,
          h('div', { class: 'col' }, h('button', { class: 'cb big accept', 'aria-label': 'Accept', onclick: () => accept(inv.video) }, icon(inv.video ? 'video' : 'phone')), 'Accept'))));
    document.body.append(root);
    incoming = { invite: inv, root };
    sounds.ringtone();
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      navigator.serviceWorker?.ready.then((reg) => {
        if (incoming?.invite.callId !== inv.callId) return;
        return reg.showNotification(`${inv.video ? '📹 Video call' : '☎ Incoming call'} · ${name}`, {
          body: 'Tap to answer in Ping Me', tag: 'call-' + inv.callId,
          icon: '/icons/icon-192.png', badge: '/icons/badge-96.png', requireInteraction: true,
          actions: [{ action: 'answer', title: 'Answer' }, { action: 'decline', title: 'Decline' }],
          data: { url: `/?call=${inv.callId}`, callId: inv.callId, type: 'call' },
        });
      }).catch(() => {});
    }
  }

  function decline() {
    if (!incoming) return;
    socket.emit('call:decline', { callId: incoming.invite.callId });
    closeIncoming();
  }

  function closeIncoming() {
    if (!incoming) return;
    sounds.stopLoop();
    incoming.root.remove();
    const callId = incoming?.invite.callId;
    navigator.serviceWorker?.ready.then((reg) => reg.getNotifications({ tag: 'call-' + callId })).then((ns) => ns?.forEach((n) => n.close())).catch(() => {});
    incoming = null;
  }

  // ───────── socket events ─────────

  socket.on('call:incoming', showIncoming);
  socket.on('call:stop-ring', ({ callId }) => { if (incoming?.invite.callId === callId) closeIncoming(); });
  socket.on('call:ended', ({ callId, reason }) => {
    if (incoming?.invite.callId === callId) closeIncoming();
    if (call?.id !== callId) return;
    const msg = { declined: 'Declined', busy: 'Busy', 'no-answer': 'No answer', cancelled: 'Call cancelled', ended: 'Call ended' }[reason] || 'Call ended';
    call.status = msg;
    render();
    sounds.stopLoop();
    sounds.hangup();
    cleanup(reason === 'ended' ? 600 : 1600);
  });
  socket.on('call:peer-joined', ({ callId, socketId, userId }) => {
    if (call?.id !== callId) return;
    createPeer(socketId, userId, false);
    markAnswered();
  });
  socket.on('call:peer-left', ({ callId, socketId }) => { if (call?.id === callId) removePeer(socketId); });
  socket.on('call:declined', ({ callId, userId, busy }) => {
    if (call?.id !== callId) return;
    const chat = ctx.chat(call.chatId);
    if (chat?.type === 'group') toast(`${ctx.user(userId)?.name || 'Someone'} ${busy ? 'is busy' : 'declined'}`);
  });
  socket.on('call:media', ({ callId, socketId, audio, video, screen }) => {
    const p = call?.id === callId && call.peers.get(socketId);
    if (!p) return;
    p.media = { audio, video, screen };
    renderTile(p);
    scheduleHide();
  });
  socket.on('call:signal', (message) => {
    const session = call;
    if (!session || session.id !== message.callId) return;
    session.signals = (session.signals || Promise.resolve()).then(() => {
      if (call === session) return handleSignal(message);
    }).catch((e) => console.warn('signal error', e));
  });
  async function handleSignal({ callId, from, userId, data }) {
    if (!call || call.id !== callId) return;
    let peer = call.peers.get(from);
    try {
      if (data.type === 'offer') {
        if (!peer) peer = createPeer(from, userId, false);
        await handleOffer(peer, data.sdp);
      } else if (data.type === 'answer' && peer) {
        await peer.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
        await flushIce(peer);
      } else if (data.type === 'ice') {
        if (peer?.pc.remoteDescription) await peer.pc.addIceCandidate(data.candidate).catch(() => {});
        else if (peer) (peer.queued ||= []).push(data.candidate);
        else { if (!call.pendingIce.has(from)) call.pendingIce.set(from, []); call.pendingIce.get(from).push(data.candidate); }
      } else if (data.type === 'verify' && peer) {
        checkVerification(peer, data);
      } else if (data.type === 'restart' && peer?.initiator) {
        restartIce(peer);
      }
    } catch (e) { console.warn('signal error', e); }
  }
  // Going to another app (or a network blip) drops the connection to the server, but a connected
  // call keeps going: the server holds our place for 2 minutes and we rejoin on the new connection.
  let mySid = socket.id || null;
  socket.on('disconnect', () => {
    if (!call) return;
    if (call.state !== 'active') { toast('Connection lost', { error: true }); cleanup(); return; }
    if (!call.lostAt) { call.lostAt = Date.now(); call.lostSid = mySid; }
  });
  socket.on('connect', () => {
    mySid = socket.id;
    if (call?.lostAt) rejoin();
  });
  function rejoin() {
    const session = call;
    socket.emit('call:rejoin', { callId: session.id, socketId: session.lostSid }, (r) => {
      if (call !== session) return;
      if (!r?.ok) { toast('Call ended — the connection dropped', { error: true }); cleanup(); return; }
      session.lostAt = null; session.lostSid = null;
      // Signals sent while we were away were lost: renegotiate any link that isn't up.
      for (const p of session.peers.values()) {
        if (p.pc.connectionState === 'connected') continue;
        if (p.initiator) restartIce(p); else signal(p.socketId, { type: 'restart' });
      }
      recoverMedia();
      render();
    });
  }
  socket.on('call:peer-moved', ({ callId, from, to }) => {
    const p = call?.id === callId && call.peers.get(from);
    if (!p) return;
    call.peers.delete(from); p.socketId = to; call.peers.set(to, p);
    if (call.pendingIce?.has(from)) { call.pendingIce.set(to, call.pendingIce.get(from)); call.pendingIce.delete(from); }
  });
  // Back in the app: phones stop the camera (and sometimes the mic) in the background — reopen them.
  async function recoverMedia() {
    const session = call;
    if (!session?.stream) return;
    const a = session.stream.getAudioTracks()[0];
    if (!a || a.readyState === 'ended') {
      try {
        const t = (await getMedia({ audio: true, video: false })).getAudioTracks()[0];
        if (call !== session) { t.stop(); return; }
        if (a) session.stream.removeTrack(a);
        t.enabled = session.audioOn !== false;
        session.stream.addTrack(t);
        if (session.whisper) { session.whisper.track.stop(); session.whisper = null; }
        await replaceTrack('audio', t);
      } catch {}
    }
    const v = session.stream.getVideoTracks()[0];
    if (session.videoOn && !session.cameraBusy && (!v || v.readyState === 'ended')) {
      session.cameraBusy = true;
      try {
        if (v) session.stream.removeTrack(v);
        const t = (await getMedia({ audio: false, video: true, facing: session.facing })).getVideoTracks()[0];
        if (call !== session) { t.stop(); return; }
        session.stream.addTrack(t);
        if (!session.screen) await replaceTrack('video', t);
      } catch {} finally { session.cameraBusy = false; }
    }
    if (call === session) render();
  }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => {
    if (!call) return;
    if (document.hidden) { autoPip(); return; }
    if (!socket.connected) socket.connect();
    recoverMedia();
  });
  // Leaving the app during a video call: float the other person's video (where the browser allows).
  function pipVideo() { return [...(call?.peers.values() || [])].find((p) => p.videoEl && p.media?.video)?.videoEl; }
  function autoPip() {
    const v = pipVideo();
    if (v && document.pictureInPictureEnabled && !document.pictureInPictureElement) v.requestPictureInPicture?.().catch(() => {});
  }
  try { navigator.mediaSession?.setActionHandler?.('enterpictureinpicture', () => pipVideo()?.requestPictureInPicture?.().catch(() => {})); } catch {}

  // Ask the server directly whether someone is calling me (app just opened / woke up).
  // autoAnswer: the person tapped "Answer" on the notification.
  let checking = null;
  function checkRinging({ autoAnswer = false } = {}) {
    if (checking) return checking;
    checking = api('GET', '/api/calls/ringing').then(({ calls }) => {
      const inv = calls?.[0];
      if (!inv) return;
      if (incoming?.invite.callId !== inv.callId) showIncoming(inv);
      if (autoAnswer && incoming?.invite.callId === inv.callId && !call) accept(inv.video);
    }).catch(() => {}).finally(() => { checking = null; });
    return checking;
  }

  return {
    start,
    active: () => call,
    checkRinging,
    joinOngoing,
    restore,
    hangup,
  };
}
