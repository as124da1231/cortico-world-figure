import {createSoftGlowEmotionEffects} from './emotion-softglow.js';
import {createFinalEmotionEffects} from './emotion-finals.js';
import {createKaomojiPainter} from './emotion-kaomoji.js';
import {FIGURE_WOLF_KAOMOJI} from './wolf-kaomoji.js';
import {createOrbPainter} from './emotion-orb.js';
import {createParticlePainter} from './emotion-particles.js';

const painters = {kaomoji:createKaomojiPainter,orb:createOrbPainter,flow:createParticlePainter,bubbles:createParticlePainter};

export function createEmotionEffects(options) {
  const style = options.model.effectStyle;
  if (style === 'softglow') return createSoftGlowEmotionEffects(options);
  if (!Object.hasOwn(painters,style)) return {draw(){},trigger(){},dispose(){}};
  return createFinalEmotionEffects(options,style,painters[style],style === 'kaomoji' ? FIGURE_WOLF_KAOMOJI : undefined);
}
