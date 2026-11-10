// DSH Live2D Body uses the same Web Audio output clock and 20 ms RMS sampling.
export function voiceLevel(buffer, position) {
  if (position < 0 || position >= buffer.duration) return 0;
  const first = Math.floor(position * buffer.sampleRate);
  const last = Math.min(buffer.length, first + Math.ceil(buffer.sampleRate * 0.02));
  let energy = 0, count = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel);
    for (let index = first; index < last; index += 4) {
      energy += samples[index] ** 2;
      count++;
    }
  }
  return count ? Math.min(1, Math.sqrt(energy / count) * 4.2) : 0;
}

const MOUTH_NOISE_FLOOR = 0.035;
const MOUTH_ATTACK = 0.045;
const MOUTH_RELEASE = 0.13;

/** Follow measured audio, then hand the mouth back to the model's current pose. */
export function createVoiceMouthEnvelope() {
  let open = 0, ownership = 0;
  return {
    update(level, gain, dt) {
      if (Number.isFinite(level)) {
        const target = Math.max(0, (Math.min(1, level) - MOUTH_NOISE_FLOOR) / (1 - MOUTH_NOISE_FLOOR));
        const time = target > open ? MOUTH_ATTACK : MOUTH_RELEASE;
        const blend = -Math.expm1(-dt / time);
        open += (target - open) * blend;
        ownership = Math.min(1, ownership + dt / MOUTH_ATTACK);
      } else {
        ownership = Math.max(0, ownership - dt / MOUTH_RELEASE);
        if (ownership === 0) {
          open = 0;
          return null;
        }
      }
      return {
        open: Math.max(0, Math.min(1, open * gain)),
        weight: ownership ** 2 * (3 - 2 * ownership),
      };
    },
  };
}

export function createFigureVoicePlayback(doc, asset) {
  const win = doc.defaultView;
  const location = win?.location;
  if (!location || win.parent === win || win.parent !== win.top
      || location.pathname !== '/figure-frame' || !win.navigator.userAgent.includes('Electron/')) return null;
  let referrer;
  try { referrer = new URL(doc.referrer); } catch { return null; }
  // Settings and browser-embedded dress previews never play the desktop's clip.
  if (referrer.origin !== location.origin || referrer.pathname !== '/pet'
      || !['127.0.0.1', 'localhost', '[::1]'].includes(referrer.hostname) || !win.AudioContext) return null;

  const abort = new AbortController();
  let timer, context, playing, prepared;
  let queue = [];
  const seen = new Set();
  let sampleQueue = [], sampleDecoder, lastSampleId;
  let lastSampleStartedAt = -Infinity;
  const samples = new Map();
  let gain = 1, sync = true, volume = 1;
  function stop() {
    if (!playing) return;
    const { source, output } = playing;
    playing = undefined;
    source.onended = null;
    try { source.stop(); } catch { /* already ended */ }
    source.disconnect();
    output.disconnect();
  }
  const fetchAsset = name => fetch(asset(name), {
    cache: 'no-store', credentials: 'omit',
    signal: AbortSignal.any([abort.signal, AbortSignal.timeout(3500)]),
  });
  function activeSample(now) {
    let active;
    for (const clip of sampleQueue) {
      if (!Number.isFinite(clip.startedAt) || clip.startedAt > now || now >= clip.expiresAt
          || clip.startedAt < lastSampleStartedAt
          || (clip.startedAt === lastSampleStartedAt && clip.id !== lastSampleId)) continue;
      if (!active || clip.startedAt > active.startedAt) active = clip;
    }
    if (active) {
      lastSampleStartedAt = active.startedAt;
      lastSampleId = active.id;
    }
    return active;
  }
  function preloadSamples(now) {
    const current = sync ? activeSample(now) : undefined;
    const next = sync ? sampleQueue.find(clip => now <= clip.playBy
      && (!Number.isFinite(clip.startedAt) || clip.startedAt > now)) : undefined;
    const wanted = [current, next].filter(Boolean);
    for (const id of samples.keys()) if (!wanted.some(clip => clip.id === id)) samples.delete(id);
    for (const clip of wanted) {
      if (samples.has(clip.id)) continue;
      const request = {};
      samples.set(clip.id, request);
      void loadSample(clip.id, request);
    }
  }
  async function loadSample(id, request) {
    const current = () => !abort.signal.aborted && samples.get(id) === request;
    try {
      const audio = await fetchAsset(`figure-voice-${id}.audio`);
      if (!audio.ok) return;
      const bytes = await audio.arrayBuffer();
      if (!current()) return;
      // The World player owns output for these clips. Decode without an audio
      // destination or an autoplay requirement in the figure frame.
      sampleDecoder ??= new win.OfflineAudioContext(1, 1, 48000);
      const buffer = await sampleDecoder.decodeAudioData(bytes);
      if (current()) request.buffer = buffer;
    } catch {
      // Missing or undecodable audio leaves the original text lip motion.
    }
  }
  function advance() {
    if (abort.signal.aborted) return;
    const now = Date.now();
    const next = queue.find(clip => !seen.has(clip.id) && now < clip.expiresAt && now <= clip.playBy);
    if (!next) { prepared = undefined; return; }
    if (prepared?.id !== next.id) {
      const request = prepared = { id: next.id };
      void load(next, request);
      return;
    }
    if (playing || !prepared.buffer) return;
    const { buffer } = prepared;
    prepared = undefined;
    seen.add(next.id);
    const source = context.createBufferSource();
    const output = context.createGain();
    output.gain.value = volume;
    source.buffer = buffer;
    source.connect(output);
    output.connect(context.destination);
    const start = context.currentTime;
    playing = { id: next.id, source, output, buffer, start, expiresAt: next.expiresAt };
    source.onended = () => { if (playing?.source === source) { stop(); advance(); } };
    source.start(start);
    advance(); // Preload the next published sentence during playback.
  }
  async function load(clip, request) {
    try {
      const audio = await fetchAsset(`figure-voice-${clip.id}.audio`);
      if (!audio.ok) throw Error('Missing voice clip');
      const bytes = await audio.arrayBuffer();
      if (prepared !== request || abort.signal.aborted) return;
      context ??= new win.AudioContext();
      // Do not queue a suspended source to play after an unrelated gesture.
      await Promise.race([context.resume(), new Promise(resolve => win.setTimeout(resolve, 500))]);
      if (context.state !== 'running') throw Error('Voice playback unavailable');
      const buffer = await context.decodeAudioData(bytes);
      if (prepared !== request || abort.signal.aborted) return;
      request.buffer = buffer;
      advance();
    } catch {
      if (prepared !== request) return;
      prepared = undefined;
      seen.add(clip.id);
      advance();
    }
  }
  async function poll() {
    try {
      const response = await fetchAsset('figure-voice.json');
      if (!response.ok) return;
      const state = await response.json();
      if (![1, 2, 3].includes(state?.version) || abort.signal.aborted) return;
      gain = Number.isFinite(state.gain) ? Math.min(3, Math.max(0.5, state.gain)) : 1;
      volume = Number.isFinite(state.volume) ? Math.min(1, Math.max(0, state.volume)) : 1;
      sync = state.sync !== false;
      const now = Date.now();
      const incoming = state.version === 1 ? [state.clip] : Array.isArray(state.clips) ? state.clips.slice(0, 24) : [];
      const clips = incoming.filter(clip => clip && typeof clip.id === 'string' && /^[0-9a-f-]{36}$/.test(clip.id)
        && Number.isFinite(clip.playBy) && Number.isFinite(clip.expiresAt) && now < clip.expiresAt);
      sampleQueue = state.version === 3 ? clips.filter(clip => clip.sampleOnly === true) : [];
      if (!sampleQueue.some(clip => clip.id === lastSampleId)) lastSampleId = undefined;
      queue = sampleQueue.length ? [] : clips.filter(clip => clip.sampleOnly !== true);
      const listed = new Set(queue.map(clip => clip.id));
      if (playing && !listed.has(playing.id)) stop();
      for (const id of seen) if (!listed.has(id)) seen.delete(id);
      if (playing) playing.output.gain.value = volume;
      preloadSamples(now);
      advance();
    } catch {
      // Missing or undecodable audio leaves the existing bubble and animation path available.
    } finally {
      if (!abort.signal.aborted) timer = win.setTimeout(poll, sampleQueue.length ? 70 : queue.length ? 180 : 350);
    }
  }
  function dispose() {
    if (abort.signal.aborted) return;
    abort.abort();
    prepared = undefined;
    sampleQueue = [];
    samples.clear();
    sampleDecoder = undefined;
    win.clearTimeout(timer);
    win.removeEventListener('pagehide', dispose);
    stop();
    void context?.close().catch(() => {});
  }
  win.addEventListener('pagehide', dispose, { once: true });
  void poll();
  return {
    get gain() { return gain; },
    level() {
      if (!sync) return null;
      const now = Date.now();
      const sample = activeSample(now);
      if (sample) {
        const buffer = samples.get(sample.id)?.buffer;
        const position = (now - sample.startedAt) / 1000;
        return buffer && position < buffer.duration ? voiceLevel(buffer, position) : null;
      }
      if (!playing || context.state !== 'running' || now >= playing.expiresAt) return null;
      const outputTime = context.getOutputTimestamp?.()?.contextTime;
      const time = outputTime > 0 ? outputTime : context.currentTime;
      return voiceLevel(playing.buffer, time - playing.start);
    },
    dispose,
  };
}
