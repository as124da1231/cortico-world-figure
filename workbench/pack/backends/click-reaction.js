export const CLICK_REACTIONS = ['native', 'expression', 'none'];

export function normalizeClickReaction(value) {
  return CLICK_REACTIONS.includes(value) ? value : 'native';
}

function randomWord(words) {
  return words[Math.floor(Math.random() * words.length)];
}

export function createGrabReaction(config, allowed) {
  const candidates = config?.mode === 'fixed' ? [config.word]
    : config?.mode === 'random' && Array.isArray(config.pool) ? config.pool : [];
  const words = candidates.filter(allowed);
  if (!words.length) return null;
  let word, held = false, weight = 0, age = 0;
  return {
    event(kind, detail) {
      if (kind === 'touch' && detail?.kind === 'grab' && !held) {
        word = randomWord(words);
        held = true;
        age = 0;
      } else if (kind === 'mode' && detail?.mode !== 'drag'
          || kind === 'touch' && ['drop','throw'].includes(detail?.kind)) this.release();
    },
    release() { held = false; },
    frame(dt) {
      if (!word) return null;
      weight = held ? Math.min(1, weight + dt / .16) : Math.max(0, weight - dt / .22);
      if (!held && weight === 0) { word = undefined; return null; }
      age += dt;
      return {word, weight, age, held};
    },
  };
}

export function setClickReaction(body, mode, showExpression, { words = [], play } = {}) {
  if ((mode === 'native' && !words.length) || typeof body.drop !== 'function') return;
  const pointer = body.pointer.bind(body);
  const time = point => point?.t ?? performance.now();
  let pressedAt = null;

  body.pointer = (type, point) => {
    if (type === 'down') pressedAt = time(point);
    if (type !== 'up' && type !== 'cancel') return pointer(type, point);

    const short = pressedAt !== null && time(point) - pressedAt < 400;
    pressedAt = null;
    const state = body.layout();
    // Keep Kit's drag release and wake-up paths. Its drop method clears a press
    // without moving the body when no drag is in progress.
    if (!state.pressing || state.mode === 'drag'
        || (type === 'up' && (!short || state.mode === 'sleep' || state.mode === 'sit'))) {
      return pointer(type, point);
    }
    body.drop(point);
    const cleared = !body.layout().pressing;
    const result = pointer(type, point);
    if (cleared && type === 'up' && !state.busy && state.mode !== 'dizzy') {
      if (words.length) play(randomWord(words));
      else if (mode === 'expression') showExpression();
    }
    return result;
  };
}
