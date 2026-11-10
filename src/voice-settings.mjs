export const VOICE_CONTROLS = {
  voiceEnabled: false,
  voiceTiming: 'fast',
  voiceLipSync: true,
  voiceMouthGain: 1,
  voiceVolume: 1,
};

export const MOUTH_GAIN = { min: 0.5, max: 3, step: 0.1 };

export function normalizeVoiceControls(value) {
  const bounded = (number, min, max, fallback) =>
    Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  return {
    voiceEnabled: value?.voiceEnabled === true,
    voiceTiming: value?.voiceTiming === 'sync' ? 'sync' : 'fast',
    voiceLipSync: value?.voiceLipSync !== false,
    voiceMouthGain: bounded(value?.voiceMouthGain, MOUTH_GAIN.min, MOUTH_GAIN.max, 1),
    voiceVolume: bounded(value?.voiceVolume, 0, 1, 1),
  };
}
