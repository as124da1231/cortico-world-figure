import * as THREE from "three";
export function syntheticVrm(version) {
  const scene = new THREE.Group(), bones = new Map(), positions = new Map();
  const frame = version === '0' ? -1 : 1;
  if (version === '0') scene.rotation.y = Math.PI;
  const add = (name, parent, x, y, z = 0) => {
    const bone = new THREE.Bone(); bone.name = name; bone.position.set(x, y, z);
    (bones.get(parent) || scene).add(bone); bones.set(name, bone); positions.set(name, bone.position.clone());
  };
  add('hips', null, 0, 1); add('spine', 'hips', 0, .18); add('chest', 'spine', 0, .18);
  add('neck', 'chest', 0, .12); add('head', 'neck', 0, .12);
  for (const [side, sign] of [['left', frame], ['right', -frame]]) {
    add(`${side}Shoulder`, 'chest', sign * .12, .03); add(`${side}UpperArm`, `${side}Shoulder`, sign * .08, 0);
    add(`${side}LowerArm`, `${side}UpperArm`, sign * .25, 0); add(`${side}Hand`, `${side}LowerArm`, sign * .22, 0);
    add(`${side}UpperLeg`, 'hips', sign * .08, 0); add(`${side}LowerLeg`, `${side}UpperLeg`, 0, -.45);
    add(`${side}Foot`, `${side}LowerLeg`, 0, -.45, frame * .015);
  }
  const humanoid = {
    normalizedHumanBones: Object.fromEntries([...bones].map(([name, node]) => [name, { node }])),
    normalizedRestPose: { hips: { position: [0, 1, 0] } },
    getNormalizedBoneNode: name => bones.get(name) || null,
    getRawBoneNode: name => bones.get(name) || null,
    resetNormalizedPose: () => { for (const [name, bone] of bones) { bone.position.copy(positions.get(name)); bone.quaternion.identity(); } },
  };
  return { meta: { metaVersion: version }, scene, humanoid, update: () => scene.updateMatrixWorld(true) };
}

