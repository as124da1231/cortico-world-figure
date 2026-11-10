export const EMOTION_EFFECTS = Object.freeze(['native', 'kaomoji', 'orb', 'flow', 'bubbles', 'softglow']);
export const EMOTION_EFFECT_SIZES = Object.freeze(['small', 'medium', 'large']);

export function normalizeEmotionEffect(value) {
  return EMOTION_EFFECTS.includes(value) ? value : 'native';
}

export function normalizeEmotionEffectSize(value) {
  return EMOTION_EFFECT_SIZES.includes(value) ? value : 'medium';
}

export function emotionStyleModule(style, size) {
  return `export default ${JSON.stringify(style)};\nexport const emotionEffectSize = ${JSON.stringify(normalizeEmotionEffectSize(size))};\n`;
}

// Same reach budget as the image figure's natural mode, independent of the body bounds.
export const EMOTION_EFFECT_REACH = 1.95;
