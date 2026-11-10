import {createSoftGlowEmotionEffects} from './emotion-softglow.js';
import {createFinalEmotionEffects} from './emotion-finals.js';

const FINAL_STYLES = new Set(['kaomoji','orb','flow','bubbles']);

export function createEmotionEffects(options) {
  const style = options.model.effectStyle;
  if (style === 'softglow') return createSoftGlowEmotionEffects(options);
  return createFinalEmotionEffects(options, FINAL_STYLES.has(style) ? style : 'kaomoji');
}
