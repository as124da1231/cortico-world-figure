import { ParameterPlanSequencer } from '../vendor/soullink/chunk-OPVA6SRP.js';
import { createNativeActions } from './native-actions.js';
import { PERFORMANCE_ASSET, PERFORMANCE_FACES, PERFORMANCE_MOVE, parsePerformanceCues } from './performance-plan.js';

const bounded = (value, min, max) => Math.max(min, Math.min(max, value));
class QuietSequencer extends ParameterPlanSequencer {
  logActiveBeatChange() {}
}

export function createPerformancePlayback({ asset, model, paramIndex, protectedIds, host, position }) {
  let active, waiting, disposed = false, request = false, nextPoll = 0, lastReply = 0;
  const used = new Map();
  const accepted = id => paramIndex.has(id) && !protectedIds.has(id);
  function report(owner, by) {
    if (!owner) return;
    const { x, y } = position();
    host.emit(by ? 'interrupted' : 'arrived', { walkId: owner, x, y, ...(by ? { by } : {}) });
  }
  function release(by) {
    const previous = active;
    active = undefined;
    if (previous) report(previous.owner, by ?? (previous.rendered ? undefined : 'figure-no-render'));
  }
  function collect(order, owner) {
    if (disposed || !order || used.has(order.ticket) || order.expiresAt <= Date.now()) return false;
    const speechMs = Number.isFinite(order.speechMs) && order.speechMs > 0 && order.speechMs <= 18000 ? order.speechMs : 0;
    let cues, beats, clips;
    if (!order.stop) {
      if (Array.isArray(order.beats)) {
        beats = order.beats.slice(0, 24).flatMap(beat => {
          if (!beat || !Number.isFinite(beat.time) || !Number.isFinite(beat.duration) || beat.time < 0 || beat.duration <= 0 || beat.time + beat.duration > 18) return [];
          const entries = Object.entries(beat.parameters ?? {}).slice(0, 96).filter(([id,value]) => accepted(id) && Number.isFinite(value) && value >= -1 && value <= 1);
          return entries.length ? [{ time: beat.time, duration: beat.duration, parameters: Object.fromEntries(entries) }] : [];
        });
        if (!beats.length) return false;
      } else if (Array.isArray(order.cues)) {
        cues = parsePerformanceCues(order.cues);
        if (cues.some(cue => cue.pose && Object.keys(cue.pose).some(id => !accepted(id)))) return false;
        if (cues.some(cue => cue.resource)) {
          clips = createNativeActions({ bindings: [], resources: Array.isArray(order.resources) ? order.resources : [] });
          const available = clips.resources();
          if (cues.some(cue => cue.resource && !available.includes(cue.resource))) return false;
        }
      } else if (!speechMs) return false;
    }
    used.set(order.ticket, order.expiresAt);
    if (order.startedAt) lastReply = order.ticket;
    if (order.stop) { release('figure-stop'); report(owner); return true; }
    release('figure-replaced');
    const activated = Date.now() / 1000;
    const start = order.startedAt ? order.startedAt / 1000 : activated;
    const duration = beats ? Math.max(...beats.map(beat => beat.time + beat.duration))
      : Math.max(speechMs / 1000, ...(cues ?? []).map(cue => cue.at + cue.duration));
    const marks = Array.isArray(order.marks) ? order.marks.slice(0, 24).filter(mark =>
      Number.isFinite(mark?.at) && mark.at >= 0 && PERFORMANCE_FACES.includes(mark.face)) : [];
    active = { owner, ticket:order.ticket, start, activated, duration, cues, beats, clips, face: order.face, marks, speechMs, rendered: false,
      until: owner ? Date.now() + (duration + .4) * 1000 : order.expiresAt };
    return true;
  }
  async function load() {
    const response = await fetch(asset(PERFORMANCE_ASSET), { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(2500) });
    if (!response.ok) return [];
    const json = await response.json();
    return json?.version === 1 && Array.isArray(json.orders) ? json.orders.slice(-12) : [];
  }
  function poll() {
    if (disposed || request || Date.now() < nextPoll) return;
    request = true;
    nextPoll = Date.now() + 220;
    for (const [ticket, deadline] of used) if (deadline < Date.now()) used.delete(ticket);
    void load().then(orders => {
      if (disposed || waiting) return;
      if (active?.owner) return;
      const now = Date.now();
      const reply = orders.filter(order => order?.startedAt && order.startedAt <= now && order.expiresAt > now)
        .reduce((latest, order) => !latest || latest.startedAt <= order.startedAt ? order : latest, null);
      if (reply && reply.ticket !== lastReply) collect(reply);
      else if (active && !orders.some(order => order.ticket === active.ticket)) release('figure-cancelled');
    }).catch(() => { nextPoll = Date.now() + 1500; }).finally(() => { request = false; });
  }
  function direct(move, owner) {
    if (move?.to !== PERFORMANCE_MOVE) return false;
    const ticket = move.params?.ticket;
    if (!Number.isSafeInteger(ticket) || ticket <= 0 || disposed) { report(owner, 'figure-invalid-ticket'); return true; }
    if (waiting) report(waiting, 'figure-replaced');
    waiting = owner;
    void load().then(orders => {
      if (disposed || waiting !== owner) return;
      waiting = undefined;
      if (!collect(orders.find(order => order?.ticket === ticket && !order.startedAt), owner)) report(owner, 'figure-unavailable');
    }).catch(() => {
      if (waiting !== owner) return;
      waiting = undefined;
      report(owner, 'figure-unavailable');
    });
    return true;
  }
  function cancel(owner) {
    if (waiting === owner && owner) { waiting = undefined; report(owner, 'figure-stop'); return true; }
    if (active?.owner === owner && owner) { release('figure-stop'); return true; }
    return false;
  }
  const normalized = id => {
    const index = paramIndex.get(id);
    const baseline = model.getParameterDefaultValue(index);
    const current = model.getParameterValueByIndex(index);
    const span = current >= baseline ? model.getParameterMaximumValue(index) - baseline : baseline - model.getParameterMinimumValue(index);
    return span > 0 ? bounded((current - baseline) / span, -1, 1) : 0;
  };
  const toTrack = ([id, value], weight) => {
    const index = paramIndex.get(id);
    const baseline = model.getParameterDefaultValue(index);
    const span = value >= 0 ? model.getParameterMaximumValue(index) - baseline : baseline - model.getParameterMinimumValue(index);
    return { id, target: 'Parameter', blend: 'Overwrite', value: baseline + value * span, weight };
  };
  function frame() {
    if (!active) return null;
    const now = Date.now() / 1000;
    const elapsed = now - active.start;
    if (elapsed > active.duration + .2 || Date.now() > active.until) { release(); return null; }
    if (elapsed < 0) return null;
    const weight = Math.min(bounded((now - active.activated) / .18, 0, 1), bounded((active.duration + .2 - elapsed) / .2, 0, 1));
    const speech = elapsed * 1000 < active.speechMs ? {
      id: active.start, elapsed, durationMs: active.speechMs,
      face: active.marks.findLast(mark => mark.at <= elapsed)?.face ??
        (PERFORMANCE_FACES.includes(active.face) ? active.face : undefined),
    } : undefined;
    if (active.beats) {
      if (!active.sequence) {
        const ids = new Set(active.beats.flatMap(beat => Object.keys(beat.parameters)));
        active.sequence = new QuietSequencer();
        active.sequence.start(active.beats, active.start, Object.fromEntries([...ids].map(id => [id, normalized(id)])));
      }
      const tracks = Object.entries(active.sequence.evaluate(now)).map(entry => toTrack(entry, weight));
      return { tracks, speech };
    }
    const cues = (active.cues ?? []).filter(cue => cue.at <= elapsed && cue.at + cue.duration + .2 >= elapsed);
    const emotion = cues.findLast(cue => cue.face || cue.vad || cue.facs || cue.actionUnits);
    const resource = cues.findLast(cue => cue.resource);
    const pose = cues.findLast(cue => cue.pose);
    const blend = cue => {
      const time = elapsed - cue.at;
      return Math.min(bounded(time / .15, 0, 1), bounded((cue.duration + .2 - time) / .2, 0, 1));
    };
    const tracks = new Map();
    if (pose) {
      if (!active.sequence) {
        const poses = active.cues.filter(item => item.pose);
        const ids = new Set(poses.flatMap(item => Object.keys(item.pose)));
        const initial = Object.fromEntries([...ids].map(id => [id, normalized(id)]));
        let current = initial;
        const segments = poses.map(item => ({
          time: item.at, duration: item.duration, parameters: current = { ...current, ...item.pose },
        }));
        active.sequence = new QuietSequencer();
        active.sequence.start(segments, active.start, initial);
      }
      for (const entry of Object.entries(active.sequence.evaluate(now))) tracks.set(entry[0], toTrack(entry, weight));
    }
    if (resource) {
      active.clips.sample(resource.resource, elapsed - resource.at);
      for (const track of active.clips.update()) {
        if (track.target === 'Parameter' && accepted(track.id)) tracks.set(track.id, { ...track, weight: blend(resource) });
      }
    }
    if (!cues.length && !speech) return null;
    return { face: emotion?.face, tracks: [...tracks.values()], emotion, strength: emotion ? blend(emotion) : 0, speech };
  }
  return {
    poll, frame, direct, cancel,
    rendered(layer) { if (active && (layer?.face || layer?.tracks.length || layer?.emotion?.facs || layer?.emotion?.actionUnits || layer?.emotion?.vad)) active.rendered = true; },
    dispose() { disposed = true; release('figure-closed'); if (waiting) report(waiting, 'figure-closed'); waiting = undefined; },
  };
}
