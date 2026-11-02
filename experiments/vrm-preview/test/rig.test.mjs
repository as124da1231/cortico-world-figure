import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { AvatarPerformance } from '../src/performance.js';

function syntheticVrm(version) {
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

test('official animation adapter makes bow lean forward in both VRM coordinate conventions', () => {
  for (const version of ['0', '1']) {
    const vrm = syntheticVrm(version), performance = new AvatarPerformance(vrm, 1.7, { random: () => .5 });
    const head = vrm.humanoid.getNormalizedBoneNode('head'); vrm.scene.updateMatrixWorld(true);
    const initial = head.getWorldPosition(new THREE.Vector3());
    performance.playGesture('bow');
    const options = { life: false, gaze: false, expression: '', weight: 1, blink: false, talk: false, amplitude: 1, loop: false };
    for (let i = 0; i < 80; i++) performance.update(.02, options, new THREE.PerspectiveCamera(), new THREE.Object3D());
    const bowed = head.getWorldPosition(new THREE.Vector3());
    assert.ok(bowed.z > initial.z + .08, `VRM ${version} bends backwards`);
    assert.ok(bowed.y < initial.y, `VRM ${version} raises head instead of bowing`);
    assert.ok(performance.snapshot().grounding.maxError < .003);
    performance.dispose();
  }
});

test('vendored idle assets match the pinned source and contain only embedded animation data', async () => {
  const root = new URL('../assets/animations/overte/', import.meta.url);
  const record = JSON.parse(await readFile(new URL('sources.json', root), 'utf8'));
  for (const source of record.sources) {
    const bytes = await readFile(new URL(source.file, root));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), source.sha256);
    const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    assert.equal(json.extensions.VRMC_vrm_animation.specVersion, '1.0');
    assert.ok(json.animations.length > 0);
    assert.ok(!(json.images?.length));
    assert.ok(!(json.meshes?.length));
    assert.ok(json.buffers.every(buffer => buffer.uri == null));
  }
});
