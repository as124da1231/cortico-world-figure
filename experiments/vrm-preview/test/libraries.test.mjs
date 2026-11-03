import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMAnimationLoaderPlugin } from '@pixiv/three-vrm-animation';
import { motionLibraries, animationRoutes, rootTravelAt } from '../src/motion-libraries.mjs';
import { AvatarPerformance } from '../src/performance.js';
import { syntheticVrm } from './rig-helper.mjs';

const loader = new GLTFLoader(); loader.register(parser => new VRMAnimationLoaderPlugin(parser));
const manifest = JSON.parse(await readFile(new URL('../assets/animations/quaternius/sources.json', import.meta.url)));
const animations = new Map();
for (const clip of manifest.clips) {
  const bytes = await readFile(new URL(`../assets/animations/quaternius/${clip.file}`, import.meta.url));
  const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  animations.set(clip.id, { bytes, json: gltf.parser.json, animation: gltf.userData.vrmAnimations[0] });
}

test('converted author clips match pinned hashes and contain only embedded animation data', () => {
  assert.equal(manifest.sourceClipCount, 43); assert.equal(manifest.clips.length, 12);
  for (const clip of manifest.clips) {
    const { bytes, json, animation } = animations.get(clip.id);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), clip.sha256);
    assert.equal(json.meshes?.length || 0, 0); assert.equal(json.images?.length || 0, 0);
    assert.equal(json.skins?.length || 0, 0); assert.ok(json.buffers.every(buffer => !buffer.uri));
    assert.ok(animation.duration > 0);
  }
  assert.equal(new Set(animationRoutes).size, animationRoutes.length);
  for (const library of motionLibraries) assert.ok(Object.values(library.assets).every(url => animationRoutes.includes(url)));
});

test('authored root distance interpolates and remains continuous across repeated cycles', () => {
  const curve = animations.get('walk').json.asset.extras.rootMotion;
  assert.ok(curve.distance > 1.2 && curve.distance < 1.4);
  const duration = curve.times.at(-1);
  assert.equal(rootTravelAt(curve, -1), 0);
  assert.ok(Math.abs(rootTravelAt(curve, duration * 3) - curve.distance * 3) < 1e-6);
  assert.ok(rootTravelAt(curve, duration + 0.001) >= rootTravelAt(curve, duration - 0.001));
  assert.ok(rootTravelAt(curve, duration + 0.001) - rootTravelAt(curve, duration - 0.001) < 0.01);
});

test('a looping full-body preview pauses, cancels and resets without stale queued playback', () => {
  const values = new Map(); values.library = motionLibraries[0];
  for (const id of ['balanced', 'rest-left', 'rest-right']) values.set(id, animations.get('idle').animation);
  values.set('preview-dance', animations.get('dance').animation);
  const actor = new AvatarPerformance(syntheticVrm('1'), 1.7, { animations: values });
  const options = { life: false, gaze: false, blink: false, talk: false, amplitude: 0.8, loop: false };
  const camera = new THREE.PerspectiveCamera(), target = new THREE.Object3D();
  assert.equal(actor.playPreview('preview-dance', { loop: true }), true);
  for (let i = 0; i < 120; i++) actor.update(0.02, options, camera, target);
  const before = actor.snapshot().preview;
  actor.update(0, { ...options, paused: true }, camera, target);
  assert.deepEqual(actor.snapshot().preview, before);
  actor.stopPreview(); assert.equal(actor.snapshot().preview, null);
  for (let i = 0; i < 80; i++) actor.update(0.02, options, camera, target);
  assert.ok([...actor.bones.values()].every(bone => bone.quaternion.toArray().every(Number.isFinite)));
  actor.reset(); assert.equal(actor.snapshot().preview, null); assert.equal(actor.pendingPreview, null);
  actor.dispose();
});
