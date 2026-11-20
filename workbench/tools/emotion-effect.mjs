export const EMOTION_EFFECTS = Object.freeze(['native', 'kaomoji', 'orb', 'flow', 'bubbles', 'softglow']);
export const EMOTION_EFFECT_SIZES = Object.freeze(['small', 'medium', 'large']);

export function normalizeEmotionEffect(value) {
  return EMOTION_EFFECTS.includes(value) ? value : 'native';
}

export function normalizeEmotionEffectSize(value) {
  return EMOTION_EFFECT_SIZES.includes(value) ? value : 'medium';
}

export const EMOTION_EFFECT_AXIS = 'figureeffects';
export const EMOTION_EFFECT_THUMBS = 'thumb/effects';
const emotionEffectNames = {
  native: ['Coo 原有特效', 'Coo original effects'],
  kaomoji: ['颜文字', 'Kaomoji'],
  orb: ['情绪球', 'Emotion orb'],
  flow: ['全身粒子流', 'Full-body particle flow'],
  bubbles: ['右上角气泡', 'Upper-right bubbles'],
  softglow: ['柔光流尘 · 第二版', 'Softglow dust · V2'],
};

export function setEmotionEffectAxis(manifest, value) {
  const initial = normalizeEmotionEffect(value);
  const options = [initial, ...EMOTION_EFFECTS.filter(style => style !== initial)].map(style => {
    const [zh, en] = emotionEffectNames[style];
    return { id: 'figurefx' + style, name: { zh, en }, thumb: EMOTION_EFFECT_THUMBS + '/' + style + '.png' };
  });
  const axis = { id: EMOTION_EFFECT_AXIS, name: { zh: '情绪特效', en: 'Emotion effects' }, options };
  const axes = manifest.axes ??= [];
  const index = axes.findIndex(item => item.id === axis.id);
  if (index === -1) axes.push(axis);
  else {
    const previous = axes[index].options;
    if (previous.length !== options.length || !options.every(option => previous.some(old => old.id === option.id))) {
      throw Error('情绪特效栏位与已有装扮分组重复');
    }
    axes[index] = axis;
  }
  for (const preset of manifest.presets ?? []) {
    if (!options.some(option => option.id === preset.pick?.[axis.id])) {
      preset.pick = { ...preset.pick, [axis.id]: options[0].id };
    }
  }
  manifest.effects = { ...manifest.effects, reach: Math.max(manifest.effects?.reach || 0, EMOTION_EFFECT_REACH) };
}

export function emotionStyleModule(style, size, manifest) {
  const picks = Object.fromEntries(EMOTION_EFFECTS.map(key => ['figurefx' + key, key]));
  const presets = Object.fromEntries((manifest.presets ?? []).map(preset => [preset.id, preset.pick[EMOTION_EFFECT_AXIS]]));
  return `export default ${JSON.stringify(style)};\nexport const emotionEffectSize = ${JSON.stringify(normalizeEmotionEffectSize(size))};\n`
    + `export const emotionEffectPicks = ${JSON.stringify(picks)};\nexport const emotionEffectPresets = ${JSON.stringify(presets)};\n`;
}

// Keep the effect travel independent of the body bounds.
export const EMOTION_EFFECT_REACH = 1.95;
