// Original keyframes for this experiment, authored in degrees and body-height units.
// These are reusable animation data, not copied model motions or third-party assets.
export const relaxedPose = {
  hips: [0, 0, 0], spine: [0, 0, 0], chest: [0, 0, 0], upperChest: [0, 0, 0], neck: [0, 0, 0], head: [0, 0, 0],
  leftShoulder: [0, 0, 1], rightShoulder: [0, 0, -1],
  leftUpperArm: [0, 0, 74], rightUpperArm: [0, 0, -74],
  leftLowerArm: [-9, 0, 3], rightLowerArm: [-9, 0, -3],
  leftHand: [0, -4, 0], rightHand: [0, 4, 0],
  leftUpperLeg: [0, 0, 0], rightUpperLeg: [0, 0, 0], leftLowerLeg: [0, 0, 0], rightLowerLeg: [0, 0, 0],
  leftFoot: [0, 0, 0], rightFoot: [0, 0, 0],
};

// Each key is [normalized time, x, y, z]. Endpoints agree for seamless loops.
export const idleClips = {
  balanced: { name: '自然待机', duration: 9.6, channels: {
    pelvis: [[0, 0, -.004, 0], [.24, -.002, -.0033, 0], [.53, .001, -.004, .001], [.78, .002, -.0034, 0], [1, 0, -.004, 0]],
    spine: [[0, 0, 0, 0], [.24, -.5, .3, -.3], [.53, .2, -.1, 0], [.78, -.4, -.4, .3], [1, 0, 0, 0]],
    chest: [[0, 0, 0, 0], [.26, -.65, 0, .1], [.54, .1, 0, 0], [.8, -.55, 0, -.1], [1, 0, 0, 0]],
    leftUpperArm: [[0, 0, 0, 0], [.28, -.6, .3, -.6], [.58, .3, -.2, .1], [.81, -.4, 0, -.4], [1, 0, 0, 0]],
    rightUpperArm: [[0, 0, 0, 0], [.29, -.5, -.3, .5], [.55, .1, 0, -.1], [.84, -.6, .2, .4], [1, 0, 0, 0]],
  } },
  'rest-left': { name: '松弛站立', duration: 11.2, channels: {
    pelvis: [[0, .009, -.005, 0], [.25, .012, -.0044, .001], [.57, .01, -.005, 0], [.8, .007, -.0044, 0], [1, .009, -.005, 0]],
    hips: [[0, 0, -1, -.8], [.3, 0, -1.6, -1.2], [.65, 0, -.8, -.9], [1, 0, -1, -.8]],
    spine: [[0, .3, .5, .8], [.25, -.3, .9, 1.1], [.6, .2, .2, .8], [.83, -.2, .5, .5], [1, .3, .5, .8]],
    chest: [[0, 0, .3, .3], [.26, -.65, .3, .3], [.59, .1, 0, .1], [.84, -.5, .3, .3], [1, 0, .3, .3]],
    leftLowerArm: [[0, -2, -1, 1], [.3, -3.5, -1, 1.5], [.68, -1.8, 0, .7], [1, -2, -1, 1]],
    rightUpperArm: [[0, -.4, 0, .7], [.3, -.9, 0, 1], [.7, -.2, .3, .4], [1, -.4, 0, .7]],
  } },
  'rest-right': { name: '轻移重心', duration: 10.4, channels: {
    pelvis: [[0, -.009, -.005, 0], [.25, -.007, -.0043, 0], [.55, -.012, -.005, .001], [.8, -.01, -.0045, 0], [1, -.009, -.005, 0]],
    hips: [[0, 0, 1, .8], [.35, 0, .8, .6], [.67, 0, 1.5, 1.1], [1, 0, 1, .8]],
    spine: [[0, .2, -.5, -.8], [.3, -.35, -.2, -.5], [.6, .2, -.8, -1.1], [.85, -.2, -.5, -.8], [1, .2, -.5, -.8]],
    chest: [[0, 0, -.3, -.2], [.29, -.6, -.1, -.1], [.6, .15, -.3, -.3], [.83, -.5, -.3, -.2], [1, 0, -.3, -.2]],
    rightLowerArm: [[0, -2, 1, -1], [.3, -1.5, 0, -.7], [.64, -3.5, 1, -1.5], [1, -2, 1, -1]],
    leftUpperArm: [[0, -.4, 0, -.7], [.3, -.2, -.2, -.5], [.7, -.9, 0, -1], [1, -.4, 0, -.7]],
  } },
};

const zero = [0, 0, 0, 0], end = [1, 0, 0, 0];
export const gestureClips = {
  acknowledge: { name: '轻轻回应', duration: 2.6, channels: {
    head: [zero, [.14, 3, 0, -2], [.36, -8, 0, -3], [.55, 2, 0, -2], [.72, -3, 0, -1], end],
    chest: [zero, [.2, 1, 0, 0], [.45, -1.5, 0, -.5], [.7, -.3, 0, 0], end],
    rightUpperArm: [zero, [.3, -2, 0, 2], [.6, -1, 0, 1], end],
  } },
  greeting: { name: '小小招呼', duration: 3.4, channels: {
    rightUpperArm: [zero, [.28, -8, 0, 47], [.5, -9, 0, 49], [.7, -7, 0, 45], end],
    rightLowerArm: [zero, [.3, 0, 0, 85], [.65, 0, 0, 88], end],
    rightHand: [zero, [.34, 0, -8, -5], [.43, 0, 12, 5], [.53, 0, -10, -5], [.63, 0, 10, 5], [.72, 0, 0, 0], end],
    head: [zero, [.3, 0, -3, -4], [.65, 0, -2, -3], end],
  } },
  wave: { name: '招招手', duration: 3.8, channels: {
    rightUpperArm: [zero, [.24, -8, 0, 80], [.65, -8, 0, 80], [.84, -5, 0, 36], end],
    rightLowerArm: [zero, [.25, 4, 0, 65], [.7, 4, 0, 65], [.85, 0, 0, 30], end],
    rightHand: [zero, [.28, 0, -11, -5], [.38, 0, 15, 7], [.48, 0, -13, -7], [.58, 0, 13, 7], [.68, 0, -10, -5], [.8, 0, 0, 0], end],
    head: [zero, [.25, 0, -3, -4], [.65, 0, -3, -3], end],
  } },
  nod: { name: '点点头', duration: 2.8, channels: {
    head: [zero, [.16, 3, 0, 0], [.34, -12, 0, 0], [.5, 3, 0, 0], [.7, -9, 0, 0], [.85, 0, 0, 0], end],
    neck: [zero, [.35, -2, 0, 0], [.52, 1, 0, 0], [.7, -2, 0, 0], end],
  } },
  shake: { name: '摇摇头', duration: 2.8, channels: {
    head: [zero, [.2, 0, -16, 0], [.43, 0, 17, 0], [.65, 0, -13, 0], [.82, 0, 7, 0], end],
    neck: [zero, [.22, 0, -2, 0], [.45, 0, 2, 0], [.68, 0, -2, 0], end],
  } },
  bow: { name: '鞠个躬', duration: 3.8, channels: {
    hips: [zero, [.35, -7, 0, 0], [.56, -7, 0, 0], [.85, -1, 0, 0], end],
    spine: [zero, [.38, -19, 0, 0], [.56, -19, 0, 0], [.85, -1, 0, 0], end],
    head: [zero, [.35, -7, 0, 0], [.56, -7, 0, 0], end],
    leftUpperArm: [zero, [.4, -4, 0, -2], [.6, -4, 0, -2], end],
    rightUpperArm: [zero, [.4, -4, 0, 2], [.6, -4, 0, 2], end],
  } },
  walk: { name: '原地走走', duration: 4.8, channels: {} },
};

export function sampleKeys(keys, time) {
  if (time <= keys[0][0]) return keys[0].slice(1);
  if (time >= keys.at(-1)[0]) return keys.at(-1).slice(1);
  let index = 0;
  while (keys[index + 1][0] < time) index++;
  const a = keys[index], b = keys[index + 1], before = keys[Math.max(0, index - 1)], after = keys[Math.min(keys.length - 1, index + 2)];
  const span = b[0] - a[0], t = (time - a[0]) / span;
  return [1, 2, 3].map(axis => {
    const m0 = index === 0 ? 0 : (b[axis] - before[axis]) / (b[0] - before[0]) * span;
    const m1 = index + 1 === keys.length - 1 ? 0 : (after[axis] - a[axis]) / (after[0] - a[0]) * span;
    return (2 * t ** 3 - 3 * t ** 2 + 1) * a[axis] + (t ** 3 - 2 * t ** 2 + t) * m0
      + (-2 * t ** 3 + 3 * t ** 2) * b[axis] + (t ** 3 - t ** 2) * m1;
  });
}
