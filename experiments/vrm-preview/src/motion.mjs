export const motions = [
  { id: 'idle', name: '自然待机', note: '呼吸与轻微重心变化', icon: '◌', duration: 6, bones: ['hips', 'spine'] },
  { id: 'wave', name: '招招手', note: '抬手、摆腕、回落', icon: '✋', duration: 3.8, bones: ['rightUpperArm', 'rightLowerArm', 'rightHand'] },
  { id: 'nod', name: '点点头', note: '连续两次轻点头', icon: '↕', duration: 2.8, bones: ['head'] },
  { id: 'shake', name: '摇摇头', note: '平缓左右摇头', icon: '↔', duration: 2.8, bones: ['head'] },
  { id: 'bow', name: '鞠个躬', note: '躯干前倾后归位', icon: '⌁', duration: 3.8, bones: ['spine', 'hips'] },
  { id: 'walk', name: '原地走走', note: '仅试步态，尚未锁脚', icon: '⇢', duration: 4.8, bones: ['leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg'] },
];
export function smoothstep(value) { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); }
export function envelope(time, duration, fade = 0.45) {
  return smoothstep(time / fade) * smoothstep((duration - time) / fade);
}
