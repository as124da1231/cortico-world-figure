export const EMOTION_EFFECTS = Object.freeze(['native', 'kaomoji', 'orb', 'flow', 'bubbles', 'softglow']);
export const EMOTION_EFFECT_SIZES = Object.freeze(['small', 'medium', 'large']);

export function normalizeEmotionEffects(value) {
  const selected = new Set(Array.isArray(value) ? value : typeof value === 'string' ? value.split(',').map(style=>style.trim()) : []);
  return EMOTION_EFFECTS.filter(style => style === 'native' || selected.has(style));
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
  const styles = normalizeEmotionEffects(value);
  const options = styles.map(style => {
    const [zh, en] = emotionEffectNames[style];
    return { id: 'figurefx' + style, name: { zh, en }, thumb: EMOTION_EFFECT_THUMBS + '/' + style + '.png' };
  });
  const axis = { id: EMOTION_EFFECT_AXIS, name: { zh: '情绪特效', en: 'Emotion effects' }, options };
  const axes = manifest.axes ??= [];
  const index = axes.findIndex(item => item.id === axis.id);
  const previous = axes[index]?.options;
  const ownAxis = previous?.length && previous.every(option => EMOTION_EFFECTS.some(style => option.id === 'figurefx' + style));
  if (styles.length === 1) {
    if (index !== -1 && !ownAxis) return;
    if (ownAxis) axes.splice(index,1);
    for (const preset of manifest.presets ?? []) if (preset.pick) delete preset.pick[axis.id];
    if (manifest.effects?.reach === EMOTION_EFFECT_REACH) {
      delete manifest.effects.reach;
      if (!Object.keys(manifest.effects).length) delete manifest.effects;
    }
    return;
  }
  if (index !== -1 && !ownAxis) throw Error('情绪特效栏位与已有装扮分组重复');
  if (index === -1) axes.push(axis);
  else axes[index] = axis;
  for (const preset of manifest.presets ?? []) {
    preset.pick = {...preset.pick,[axis.id]:'figurefxnative'};
  }
  manifest.effects = { ...manifest.effects, reach: Math.max(manifest.effects?.reach || 0, EMOTION_EFFECT_REACH) };
}

export function emotionStyleModule(value, size, manifest) {
  const styleList = normalizeEmotionEffects(value);
  const picks = Object.fromEntries(styleList.map(key => ['figurefx' + key, key]));
  const presets = Object.fromEntries((manifest.presets ?? []).map(preset => [preset.id, preset.pick?.[EMOTION_EFFECT_AXIS]]));
  return `export default "native";\nexport const emotionEffectSize = ${JSON.stringify(normalizeEmotionEffectSize(size))};\n`
    + `export const hasNamedPresets = ${Boolean(manifest.presets?.length)};\n`
    + `export const emotionEffectPicks = ${JSON.stringify(picks)};\nexport const emotionEffectPresets = ${JSON.stringify(presets)};\n`;
}

// Keep the effect travel independent of the body bounds.
export const EMOTION_EFFECT_REACH = 1.95;
