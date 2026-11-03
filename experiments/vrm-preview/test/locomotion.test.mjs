import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMAnimationLoaderPlugin } from '@pixiv/three-vrm-animation';
import { AvatarPerformance } from '../src/performance.js';
import { Engagement } from '../src/engagement.mjs';
import { syntheticVrm } from './rig-helper.mjs';

const loader = new GLTFLoader(); loader.register(parser => new VRMAnimationLoaderPlugin(parser));
const animations = new Map();
for (const [id, file] of Object.entries({ balanced: 'idle', 'rest-left': 'idle-2', 'rest-right': 'idle-3', talking: 'idle-talking', thinking: 'think', 'walk-cycle': 'world-walk-slow', 'walk-start': 'world-walk-start', 'walk-stop': 'world-walk-stop-small', 'turn-left': 'world-turn-left', 'turn-right': 'world-turn-right' })) {
  const bytes = await readFile(new URL(`../assets/animations/overte/${file}.vrma`, import.meta.url));
  const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  animations.set(id, gltf.userData.vrmAnimations[0]);
}
const options = { life: false, gaze: false, expression: '', weight: 1, blink: false, talk: false, amplitude: .8, loop: false };
const camera = new THREE.PerspectiveCamera(), target = new THREE.Object3D();

test('authored locomotion turns, travels, settles and retains its landing in both VRM frames', () => {
  for (const version of ['0', '1']) {
    const actor = new AvatarPerformance(syntheticVrm(version), 1.7, { animations, random: () => .5 });
    const start = actor.vrm.scene.position.clone(), phases = new Set();
    assert.equal(actor.walk(), true);
    let maxError = 0;
    for (let i = 0; i < 650; i++) {
      actor.update(.02, options, camera, target);
      const state = actor.snapshot(); phases.add(state.locomotion.phase);
      for (const bone of actor.bones.values()) assert.ok(bone.quaternion.toArray().every(Number.isFinite));
      maxError = Math.max(maxError, state.grounding.maxError);
    }
    assert.ok(['left', 'start', 'walk', 'stop', 'idle'].every(phase => phases.has(phase)));
    assert.equal(actor.locomotion.active, false);
    assert.ok(actor.vrm.scene.position.distanceTo(start) > .6, 'actor still walks in place');
    assert.ok(Math.abs(actor.locomotion.yaw) < .01, 'actor should turn back to the viewer');
    assert.ok(actor.snapshot().grounding.maxError < .005, 'landing feet cannot reach the floor');
    assert.ok(maxError < .025, `support foot error ${maxError} (${version})`);
    const landing = actor.vrm.scene.position.clone();
    for (let i = 0; i < 100; i++) actor.update(.02, options, camera, target);
    assert.ok(actor.vrm.scene.position.distanceTo(landing) < 1e-9, 'returning idle resets root travel');
    actor.dispose();
  }
});

test('walking can be paused, retargeted and interrupted without reviving a stale destination', () => {
  const actor = new AvatarPerformance(syntheticVrm('1'), 1.7, { animations, random: () => .5 });
  actor.walk(); for (let i = 0; i < 100; i++) actor.update(.02, options, camera, target);
  const previousTarget = actor.locomotion.target.clone();
  assert.equal(actor.walk(actor.vrm.scene.position.clone()), false);
  assert.ok(actor.locomotion.target.distanceTo(previousTarget) < 1e-9);
  const before = actor.snapshot();
  for (let i = 0; i < 10; i++) actor.update(0, { ...options, paused: true }, camera, target);
  assert.deepEqual(actor.snapshot().locomotion, before.locomotion);
  actor.walk(new THREE.Vector3(-.8, 0, .1));
  actor.engage('interrupt');
  for (let i = 0; i < 350; i++) actor.update(.02, options, camera, target);
  assert.equal(actor.locomotion.active, false);
  assert.equal(actor.locomotion.target, null);
  assert.equal(actor.snapshot().engagement.interruptions, 1);
  actor.reset(); actor.update(.02, options, camera, target);
  assert.ok(actor.vrm.scene.position.length() < 1e-9);
  assert.equal(actor.locomotion.active, false);
  actor.walk(); for (let i = 0; i < 100; i++) actor.update(.02, options, camera, target);
  assert.equal(actor.locomotion.active, true);
  actor.reset(); assert.doesNotThrow(() => actor.update(.02, options, camera, target));
  assert.equal(actor.locomotion.contact('left'), null);
  actor.dispose();
});

test('emotional carryover decays, audio closes on interruption, and paused time stays frozen', () => {
  const state = new Engagement(); state.set('notice', { duration: 1 });
  for (let i = 0; i < 50; i++) state.step(.02);
  assert.ok(state.emotion.valence > .1);
  state.set('speak'); state.audio(.7, .4); assert.equal(state.energy, .7);
  state.interrupt(); assert.equal(state.mode, 'listen'); assert.equal(state.energy, 0);
  const frozen = state.snapshot(); state.step(0); assert.deepEqual(state.snapshot(), frozen);
  for (let i = 0; i < 4000; i++) state.step(.02);
  assert.equal(state.mode, 'idle'); assert.ok(Math.abs(state.emotion.valence - .08) < .002);
});

test('a full-body bow waits for walking to settle and an interruption cancels the waiting bow', () => {
  const actor = new AvatarPerformance(syntheticVrm('1'), 1.7, { animations, random: () => .5 });
  actor.walk(); for (let i = 0; i < 90; i++) actor.update(.02, options, camera, target);
  actor.playGesture('bow'); assert.equal(actor.gesture, null); assert.equal(actor.pendingGesture.id, 'bow');
  for (let i = 0; i < 160; i++) actor.update(.02, options, camera, target);
  assert.equal(actor.locomotion.active, false); assert.equal(actor.gesture?.id, 'bow');
  actor.reset(); actor.walk(); actor.playGesture('bow'); actor.engage('interrupt');
  for (let i = 0; i < 300; i++) actor.update(.02, options, camera, target);
  assert.equal(actor.pendingGesture, null); assert.equal(actor.gesture, null); actor.dispose();
});
