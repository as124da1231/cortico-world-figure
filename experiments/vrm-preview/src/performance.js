import * as THREE from 'three';
import { VRMAnimation, createVRMAnimationClip, VRMLookAtQuaternionProxy } from '@pixiv/three-vrm-animation';
import { BehaviorDirector } from './behavior.mjs';
import { gestureClips, idleClips, relaxedPose, sampleKeys } from './clips.mjs';
import { envelope, smoothstep } from './motion.mjs';

const degrees = THREE.MathUtils.degToRad;
const clamp = THREE.MathUtils.clamp;
const up = new THREE.Vector3(0, 1, 0);
const ease = (current, target, seconds, dt) => current + (target - current) * (1 - Math.exp(-dt / seconds));

export class AvatarPerformance {
  constructor(vrm, height, { random = Math.random, animations = new Map() } = {}) {
    this.vrm = vrm; this.height = height; this.random = random;
    this.director = new BehaviorDirector(random); this.time = 0;
    this.bones = new Map(); this.rest = new Map(); this.neutral = new Map();
    this.faces = new Map(); this.retiring = []; this.gesture = null; this.bridge = null;
    this.lastReaction = 0; this.contact = 1; this.footError = 0;
    this.previousExpression = ''; this.previousWeight = 1;
    vrm.humanoid.resetNormalizedPose();
    for (const [name, humanBone] of Object.entries(vrm.humanoid.normalizedHumanBones)) {
      const bone = humanBone.node;
      this.bones.set(name, bone);
      this.rest.set(name, { position: bone.position.clone(), quaternion: bone.quaternion.clone() });
      const angles = relaxedPose[name] || [0, 0, 0];
      const q = bone.quaternion.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...angles.map(degrees))));
      if (vrm.meta?.metaVersion !== '0') { q.x = -q.x; q.z = -q.z; }
      this.neutral.set(name, q); bone.quaternion.copy(q);
    }
    vrm.scene.updateMatrixWorld(true);
    this.forward = new THREE.Vector3(0, 0, vrm.meta?.metaVersion === '0' ? -1 : 1).transformDirection(vrm.scene.matrixWorld);
    this.right = new THREE.Vector3().crossVectors(up, this.forward).normalize();
    this.legs = [];
    for (const side of ['left', 'right']) {
      const root = this.bones.get(`${side}UpperLeg`), mid = this.bones.get(`${side}LowerLeg`), tip = this.bones.get(`${side}Foot`);
      if (!root || !mid || !tip) continue;
      const a = root.getWorldPosition(new THREE.Vector3()), b = mid.getWorldPosition(new THREE.Vector3()), c = tip.getWorldPosition(new THREE.Vector3());
      const l1 = a.distanceTo(b), l2 = b.distanceTo(c);
      if (l1 < height * .02 || l2 < height * .02) continue;
      this.legs.push({ side, root, mid, tip, rawTip: vrm.humanoid.getRawBoneNode(`${side}Foot`), target: c.clone(), rotation: tip.getWorldQuaternion(new THREE.Quaternion()), l1, l2 });
    }
    this.mixer = new THREE.AnimationMixer(vrm.scene);
    if (vrm.lookAt && !vrm.scene.children.some(obj => obj instanceof VRMLookAtQuaternionProxy)) {
      const proxy = new VRMLookAtQuaternionProxy(vrm.lookAt); proxy.name = 'VRMLookAtQuaternionProxy'; vrm.scene.add(proxy);
    }
    this.idles = new Map(); this.gestures = new Map();
    this.idleSources = new Map();
    for (const [id, definition] of Object.entries(idleClips)) {
      const animation = animations.get(id);
      const clip = animation ? createVRMAnimationClip(animation, vrm) : this.buildClip(id, definition, false);
      clip.name = id; this.idles.set(id, this.mixer.clipAction(clip));
      this.idleSources.set(id, animation ? 'Overte / Hanami VRMA' : '原创关键帧');
    }
    for (const [id, definition] of Object.entries(gestureClips)) {
      const action = this.mixer.clipAction(this.buildClip(id, definition, true));
      action.blendMode = THREE.AdditiveAnimationBlendMode;
      this.gestures.set(id, action);
    }
    this.idleId = 'balanced'; this.idles.get(this.idleId).play();
    this.mixer.update(0);
    this.animationPose = new Map([...this.bones].map(([name, bone]) => [name, bone.quaternion.clone()]));
    this.animationHips = this.bones.get('hips')?.position.clone();
  }

  buildClip(id, definition, additive) {
    const animation = new VRMAnimation(), channels = { ...definition.channels }, q = new THREE.Quaternion(), euler = new THREE.Euler();
    animation.duration = definition.duration;
    animation.restHipsPosition.copy(this.rest.get('hips').position);
    if (this.vrm.meta.metaVersion === '0') { animation.restHipsPosition.x *= -1; animation.restHipsPosition.z *= -1; }
    if (id === 'walk') {
      for (const name of ['leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg', 'leftUpperArm', 'rightUpperArm']) channels[name] = [];
    }
    const names = additive ? Object.keys(channels) : Object.keys(relaxedPose);
    for (const name of names) {
      const bone = this.bones.get(name); if (!bone) continue;
      const times = [], values = [], steps = Math.ceil(definition.duration * 30);
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        let angles = channels[name]?.length ? sampleKeys(channels[name], t) : [0, 0, 0];
        if (id === 'walk') {
          const phase = t * definition.duration * 6.5, sign = name.startsWith('left') ? 1 : -1;
          const blend = envelope(t * definition.duration, definition.duration);
          const angle = name.includes('LowerLeg') ? -Math.max(0, -sign * Math.sin(phase)) * 31
            : name.includes('UpperArm') ? -sign * Math.sin(phase) * 13 : sign * Math.sin(phase) * 21;
          angles = [angle * blend, 0, 0];
        }
        q.setFromEuler(euler.set(...angles.map(degrees)));
        if (!additive) q.premultiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...(relaxedPose[name] || [0, 0, 0]).map(degrees))));
        // Original recipes use the historical VRM 0 frame. Convert to canonical
        // VRMA once; the official adapter performs the target-specific mapping.
        q.x = -q.x; q.z = -q.z;
        times.push(t * definition.duration); values.push(...q.toArray());
      }
      animation.humanoidTracks.rotation.set(name, new THREE.QuaternionKeyframeTrack('', times, values));
    }
    if (!additive && this.bones.has('hips')) {
      const times = [], values = [], rest = animation.restHipsPosition;
      const steps = Math.ceil(definition.duration * 30);
      for (let i = 0; i <= steps; i++) {
        const t = i / steps, offset = sampleKeys(channels.pelvis, t);
        times.push(t * definition.duration); values.push(rest.x - offset[0] * this.height, rest.y + offset[1] * this.height, rest.z - offset[2] * this.height);
      }
      animation.humanoidTracks.translation.set('hips', new THREE.VectorKeyframeTrack('', times, values));
    }
    const clip = createVRMAnimationClip(animation, this.vrm); clip.name = id;
    clip.blendMode = additive ? THREE.AdditiveAnimationBlendMode : THREE.NormalAnimationBlendMode;
    return clip;
  }

  setPointer(x, y, present) { this.director.setPointer(x, y, present); }
  react(enabled) {
    if (!enabled || (this.gesture?.source === 'manual')) return false;
    return this.director.react();
  }
  captureBridge() {
    this.bridge = { at: this.time, bones: new Map([...this.bones].map(([name, bone]) => [name, bone.quaternion.clone()])), hips: this.bones.get('hips')?.position.clone() };
  }
  playGesture(id, { loop = false, source = 'manual' } = {}) {
    this.captureBridge();
    if (this.gesture) {
      this.gesture.action.fadeOut(.32);
      this.retiring.push({ action: this.gesture.action, until: this.time + .32 });
      this.gesture = null;
    }
    if (id === 'idle') return;
    const action = this.gestures.get(id); if (!action) return;
    // Replaying the same clip must not leave a scheduled stop for the new action.
    this.retiring = this.retiring.filter(entry => entry.action !== action);
    action.reset().setEffectiveWeight(1).setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = true; action.fadeIn(.28).play();
    this.gesture = { id, action, source, loop };
  }
  switchIdle(id) {
    if (id === this.idleId) return;
    const previous = this.idles.get(this.idleId), next = this.idles.get(id);
    next.reset().setEffectiveWeight(1).play().crossFadeFrom(previous, 1.8, false);
    this.retiring.push({ action: previous, until: this.time + 1.8 }); this.idleId = id;
  }

  rotateWorld(bone, yaw, pitch) {
    if (!bone) return;
    const parent = bone.parent.getWorldQuaternion(new THREE.Quaternion());
    const delta = new THREE.Quaternion().setFromAxisAngle(up, yaw)
      .multiply(new THREE.Quaternion().setFromAxisAngle(this.right, pitch));
    const localDelta = parent.clone().invert().multiply(delta).multiply(parent);
    bone.quaternion.premultiply(localDelta);
    bone.updateWorldMatrix(false, true);
  }

  applyAttention(focus, camera, target, gazeEnabled) {
    const head = this.bones.get('head'); if (!head) return;
    const center = head.getWorldPosition(new THREE.Vector3());
    const toCamera = camera.position.clone().sub(center).normalize();
    const cameraRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const cameraUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const goal = xy => center.clone().addScaledVector(toCamera, this.height * 1.4)
      .addScaledVector(cameraRight, xy.x * this.height * .9).addScaledVector(cameraUp, xy.y * this.height * .65);
    const angles = xy => {
      const direction = goal(xy).sub(center).normalize();
      const yaw = Math.atan2(new THREE.Vector3().crossVectors(this.forward, direction).y, this.forward.dot(direction));
      return [clamp(yaw, -.55, .55), clamp(-Math.asin(direction.y), -.3, .3)];
    };
    const [headYaw, headPitch] = gazeEnabled ? angles(focus.head) : [0, 0];
    const [bodyYaw, bodyPitch] = gazeEnabled ? angles(focus.torso) : [0, 0];
    const headOwnership = ['nod', 'shake', 'bow', 'acknowledge'].includes(this.gesture?.id) ? .3 : 1;
    this.rotateWorld(this.bones.get('chest') || this.bones.get('spine'), bodyYaw * .12, bodyPitch * .08);
    this.rotateWorld(this.bones.get('neck'), headYaw * .18 * headOwnership, headPitch * .15 * headOwnership);
    this.rotateWorld(head, headYaw * .42 * headOwnership, headPitch * .42 * headOwnership);
    target.position.copy(goal(focus.eye));
  }

  // Analytic two-bone IK in world space, with a forward knee hint and fixed sole orientation.
  solveLeg(leg, weight) {
    if (weight < .001) return;
    const { root, mid, tip, target, l1, l2 } = leg;
    const a = root.getWorldPosition(new THREE.Vector3()), b = mid.getWorldPosition(new THREE.Vector3()), c = tip.getWorldPosition(new THREE.Vector3());
    const direction = target.clone().sub(a), distance = clamp(direction.length(), Math.abs(l1 - l2) + .00001, (l1 + l2) * .99999);
    direction.normalize();
    const pole = this.forward.clone().addScaledVector(direction, -this.forward.dot(direction)).normalize();
    if (pole.lengthSq() < .1) return;
    const along = (l1 * l1 + distance * distance - l2 * l2) / (2 * distance);
    const bend = Math.sqrt(Math.max(0, l1 * l1 - along * along));
    const knee = a.clone().addScaledVector(direction, along).addScaledVector(pole, bend);
    const rotateToward = (bone, from, to) => {
      if (from.lengthSq() < 1e-10 || to.lengthSq() < 1e-10) return;
      const delta = new THREE.Quaternion().setFromUnitVectors(from.normalize(), to.normalize());
      const desired = bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert()
        .multiply(delta.multiply(bone.getWorldQuaternion(new THREE.Quaternion())));
      bone.quaternion.slerp(desired, weight); bone.updateWorldMatrix(false, true);
    };
    rotateToward(root, b.sub(a), knee.clone().sub(a));
    const newMid = mid.getWorldPosition(new THREE.Vector3());
    rotateToward(mid, tip.getWorldPosition(new THREE.Vector3()).sub(newMid), target.clone().sub(newMid));
    const localFoot = tip.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(leg.rotation);
    tip.quaternion.slerp(localFoot, weight); tip.updateWorldMatrix(false, true);
  }

  applyFaces(dt, options, focus) {
    const manager = this.vrm.expressionManager; if (!manager) return;
    const { expression, weight, blink, talk, life } = options;
    const changedWhilePaused = dt === 0 && (expression !== this.previousExpression || weight !== this.previousWeight);
    const targets = new Map();
    if (expression) targets.set(expression, weight);
    else if (life) {
      if (manager.getExpression('happy')) targets.set('happy', focus.smile);
      if (manager.getExpression('relaxed')) targets.set('relaxed', focus.smile > .05 ? 0 : .035);
    }
    manager.resetValues();
    for (const name of Object.keys(manager.expressionMap)) {
      let value = this.faces.get(name) || 0;
      const target = targets.get(name) || 0;
      value = changedWhilePaused ? target : ease(value, target, target > value ? .11 : .25, dt);
      if (value < .0001) value = 0;
      this.faces.set(name, value); manager.setValue(name, value);
    }
    if (blink && !manager.blinkExpressionNames.includes(expression)) manager.setValue('blink', focus.blink);
    if (talk && !manager.mouthExpressionNames.includes(expression)) manager.setValue('aa', .18 + Math.pow(Math.sin(this.time * 9), 2) * .5);
    this.previousExpression = expression; this.previousWeight = weight;
  }

  update(dt, options, camera, gazeTarget) {
    if (dt === 0 && options.paused && this.focus) {
      this.applyFaces(0, options, this.focus);
      this.vrm.expressionManager?.update();
      return;
    }
    const { life, gaze, expression, amplitude, loop } = options;
    const focus = this.director.step(dt, { enabled: life, gaze });
    this.time = this.director.time;
    this.switchIdle(focus.idle);
    if (this.director.reaction !== this.lastReaction) {
      this.lastReaction = this.director.reaction;
      this.playGesture(this.director.reactionKind, { source: 'automatic' });
    }
    if (!life && this.gesture?.source === 'automatic') this.playGesture('idle');
    if (this.gesture?.source === 'manual' && this.gesture.loop !== loop) {
      this.gesture.loop = loop; this.gesture.action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    }
    // PropertyMixer may skip unchanged tracks. Restore the preceding animation-only
    // pose so additive attention and IK cannot accumulate on constant tracks.
    for (const [name, q] of this.animationPose) this.bones.get(name).quaternion.copy(q);
    if (this.animationHips) this.bones.get('hips').position.copy(this.animationHips);
    // Keep authored idle poses intact. The amplitude control weights hand gestures;
    // it must not scale a whole authored skeleton away from its reference pose.
    for (const action of this.gestures.values()) action.weight = clamp(amplitude, .3, 1);
    this.mixer.update(dt);
    for (const [name, q] of this.animationPose) q.copy(this.bones.get(name).quaternion);
    if (this.animationHips) this.animationHips.copy(this.bones.get('hips').position);
    for (const entry of this.retiring) if (this.time >= entry.until) entry.action.stop();
    this.retiring = this.retiring.filter(entry => this.time < entry.until);
    if (this.gesture && !this.gesture.loop && this.gesture.action.time >= this.gesture.action.getClip().duration - .001) {
      this.gesture.action.stop(); this.gesture = null;
    }
    const hips = this.bones.get('hips');
    this.vrm.scene.updateMatrixWorld(true);
    const manager = this.vrm.expressionManager;
    const gazeAllowed = gaze && !manager?.lookAtExpressionNames.includes(expression);
    this.applyAttention(focus, camera, gazeTarget, gazeAllowed);
    if (this.bridge) {
      const blend = smoothstep((this.time - this.bridge.at) / .38);
      for (const [name, q] of this.bridge.bones) this.bones.get(name).quaternion.slerpQuaternions(q, this.bones.get(name).quaternion.clone(), blend);
      if (hips && this.bridge.hips) hips.position.lerpVectors(this.bridge.hips, hips.position.clone(), blend);
      if (blend >= 1) this.bridge = null;
    }
    this.vrm.scene.updateMatrixWorld(true);
    this.contact = ease(this.contact, this.gesture?.id === 'walk' ? 0 : 1, .16, dt);
    for (const leg of this.legs) this.solveLeg(leg, this.contact);
    if (this.vrm.lookAt) {
      this.vrm.lookAt.autoUpdate = gazeAllowed;
      if (!gazeAllowed) { this.vrm.lookAt.reset(); this.vrm.lookAt.update(0); }
    }
    this.applyFaces(dt, options, focus);
    this.vrm.update(dt);
    this.vrm.scene.updateMatrixWorld(true);
    this.footError = this.legs.length ? Math.max(...this.legs.map(leg => leg.tip.getWorldPosition(new THREE.Vector3()).distanceTo(leg.target))) : 0;
    this.focus = focus;
  }

  reset() {
    this.mixer.stopAllAction(); this.retiring = []; this.gesture = null; this.bridge = null;
    this.director = new BehaviorDirector(this.random); this.time = 0; this.lastReaction = 0;
    this.faces.clear(); this.previousExpression = ''; this.previousWeight = 1; this.contact = 1;
    this.idleId = 'balanced'; this.idles.get('balanced').reset().setEffectiveWeight(1).play();
    this.vrm.expressionManager?.resetValues(); this.vrm.lookAt?.reset();
  }
  snapshot() {
    const gesture = this.gesture;
    return { behavior: this.director.snapshot(), idle: this.idleId, idleName: idleClips[this.idleId].name, idleSource: this.idleSources.get(this.idleId),
      gesture: gesture ? { id: gesture.id, name: gestureClips[gesture.id].name, source: gesture.source, time: gesture.action.time, duration: gesture.action.getClip().duration } : null,
      grounding: { legs: this.legs.length, blend: this.contact, maxError: this.footError,
        feet: this.legs.map(leg => ({ side: leg.side, target: leg.target.toArray(), actual: leg.tip.getWorldPosition(new THREE.Vector3()).toArray(), raw: leg.rawTip?.getWorldPosition(new THREE.Vector3()).toArray() })) },
      transitioning: !!this.bridge, actions: this.mixer.stats.actions.inUse };
  }
  dispose() { this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.vrm.scene); this.faces.clear(); this.retiring = []; }
}
