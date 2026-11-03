import * as THREE from 'three';
import { createVRMAnimationClip } from '@pixiv/three-vrm-animation';
import { smoothstep } from './motion.mjs';
import { rootTravelAt } from './motion-libraries.mjs';

const up = new THREE.Vector3(0, 1, 0);
const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const ease = (a, b, dt, tau = .08) => THREE.MathUtils.lerp(a, b, 1 - Math.exp(-dt / tau));
const names = { start: 'walk-start', walk: 'walk-cycle', stop: 'walk-stop', left: 'turn-left', right: 'turn-right' };
const median = values => values.length ? values.sort((a, b) => a - b)[Math.floor(values.length / 2)] : 0;

// Sample the actual retargeted rig, so contact height and stride scale follow
// this avatar's proportions. The probe contains bones only, never mesh data.
export function measureGait(vrm, clip, height, forward) {
  vrm.scene.updateMatrixWorld(true);
  const hips = vrm.humanoid.getNormalizedBoneNode('hips');
  const probe = new THREE.Group(), original = hips.clone(true);
  hips.parent.matrixWorld.decompose(probe.position, probe.quaternion, probe.scale);
  probe.add(original);
  const mixer = new THREE.AnimationMixer(probe), action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play();
  const feet = Object.fromEntries(['left', 'right'].map(side => [side, probe.getObjectByName(vrm.humanoid.getNormalizedBoneNode(`${side}Foot`)?.name)]));
  const frames = [], count = Math.max(12, Math.ceil(clip.duration * 60));
  for (let i = 0; i <= count; i++) {
    mixer.setTime(i / count * clip.duration); probe.updateMatrixWorld(true);
    frames.push(Object.fromEntries(Object.entries(feet).map(([side, bone]) => [side, bone?.getWorldPosition(new THREE.Vector3()) || new THREE.Vector3()])));
  }
  const floors = Object.fromEntries(['left', 'right'].map(side => [side, Math.min(...frames.map(frame => frame[side].y))]));
  const velocities = [];
  const samples = frames.map((frame, i) => {
    const sample = {};
    for (const side of ['left', 'right']) {
      const before = frames[Math.max(0, i - 1)][side], after = frames[Math.min(count, i + 1)][side];
      const span = (i === 0 || i === count ? 1 : 2) * clip.duration / count;
      const speed = after.clone().sub(before).dot(forward) / span;
      const low = frame[side].y - floors[side] < height * .026;
      sample[side] = { low, speed, height: frame[side].y - floors[side] };
      if (low && speed < -height * .08) velocities.push(-speed);
    }
    return sample;
  });
  mixer.stopAllAction(); mixer.uncacheRoot(probe);
  const travel = samples.reduce((sum, sample) => sum + Math.max(0, ...Object.values(sample).filter(s => s.low).map(s => -s.speed)) * clip.duration / samples.length, 0);
  return { duration: clip.duration, samples, floors, travel, speed: THREE.MathUtils.clamp(median(velocities) || height * .42, height * .18, height * .85) };
}

export class Locomotion {
  constructor(vrm, height, mixer, animations, forward) {
    this.vrm = vrm; this.height = height; this.mixer = mixer;
    this.basePosition = vrm.scene.position.clone(); this.baseQuaternion = vrm.scene.quaternion.clone();
    this.baseForward = forward.clone(); this.forward = forward.clone();
    this.yaw = 0; this.weight = 0; this.phase = 'idle'; this.elapsed = 0;
    this.target = null; this.actions = new Map(); this.profiles = new Map(); this.rootMotions = new Map(); this.retiring = [];
    this.distance = 0; this.phaseChanges = 0; this.stopped = false;
    for (const [phase, id] of Object.entries(names)) {
      const animation = animations.get(id); if (!animation) continue;
      const clip = createVRMAnimationClip(animation, vrm);
      // Eyes and fingers keep their own ownership. World travel is controlled
      // once by this controller; the clip contributes local sway and bounce.
      const allowed = new Set(['hips', 'spine', 'chest', 'upperChest', 'neck', 'head', ...['left', 'right'].flatMap(s => ['Shoulder', 'UpperArm', 'LowerArm', 'Hand', 'UpperLeg', 'LowerLeg', 'Foot', 'Toes'].map(n => s + n))].map(n => vrm.humanoid.getNormalizedBoneNode(n)?.name).filter(Boolean));
      clip.tracks = clip.tracks.filter(track => allowed.has(track.name.slice(0, track.name.lastIndexOf('.'))));
      const hipTrack = clip.tracks.find(track => track.name.endsWith('.position'));
      if (hipTrack) {
        const x = hipTrack.values[0], z = hipTrack.values[2];
        for (let i = 0; i < hipTrack.values.length; i += 3) { hipTrack.values[i] -= x; hipTrack.values[i + 2] -= z; }
      }
      clip.name = `locomotion-${phase}`;
      this.profiles.set(phase, measureGait(vrm, clip, height, forward));
      if (animation.rootMotion) this.rootMotions.set(phase, animation.rootMotion);
      const action = mixer.clipAction(clip); action.enabled = true; action.weight = 0;
      this.actions.set(phase, action);
    }
    this.available = Object.values(names).every(id => animations.has(id));
    this.speed = this.profiles.get('walk')?.speed || height * .42;
    const authored = this.rootMotions.get('walk');
    if (authored) this.speed = authored.distance / authored.times.at(-1) * vrm.humanoid.normalizedRestPose.hips.position[1] / authored.restHipsHeight;
    this.rate = 1; this.stageAngle = 0; this.cycle = 0; this.returning = false;
  }
  get active() { return this.phase !== 'idle' || this.weight > .002; }
  get moving() { return this.phase !== 'idle'; }
  enter(phase) {
    if (this.action) this.retiring.push({ action: this.action, weight: this.action.weight });
    this.phase = phase; this.elapsed = 0; this.phaseChanges++;
    this.action = this.actions.get(phase); this.profile = this.profiles.get(phase);
    if (this.action) {
      this.retiring = this.retiring.filter(entry => entry.action !== this.action);
      this.action.stopFading().reset().setLoop(phase === 'walk' ? THREE.LoopRepeat : THREE.LoopOnce, phase === 'walk' ? Infinity : 1);
      this.action.clampWhenFinished = true; this.action.weight = 0; this.action.play();
    }
    this.stageYaw = this.yaw;
    if (phase === 'idle') { this.action = null; this.profile = null; this.target = null; }
  }
  walkTo(target, { pace = 1 } = {}) {
    if (!this.available || !Number.isFinite(target.x) || !Number.isFinite(target.z)) return false;
    const destination = target.clone(); destination.y = this.basePosition.y;
    // Keep the independent stage bounded, including repeated requests.
    const offset = destination.clone().sub(this.basePosition); offset.y = 0;
    if (offset.length() > this.height * .8) destination.copy(this.basePosition).add(offset.setLength(this.height * .8));
    const delta = destination.clone().sub(this.vrm.scene.position); delta.y = 0;
    if (delta.length() < this.height * .04) return false;
    this.target = destination;
    this.rate = THREE.MathUtils.clamp(pace, .65, 1.25); this.stopped = false; this.returning = false;
    this.desiredYaw = Math.atan2(this.baseForward.clone().cross(delta.clone().normalize()).y, this.baseForward.dot(delta.clone().normalize()));
    this.turnRemaining = wrap(this.desiredYaw - this.yaw);
    this.beginTurn(); return true;
  }
  beginTurn() {
    if (Math.abs(this.turnRemaining) > .13) {
      this.stageAngle = THREE.MathUtils.clamp(this.turnRemaining, -Math.PI / 2, Math.PI / 2);
      this.enter(this.stageAngle > 0 ? 'left' : 'right');
    } else { this.yaw = this.desiredYaw; this.enter(this.returning ? 'idle' : 'start'); }
  }
  stop() {
    if (!this.moving) return;
    this.stopped = true; this.target = null;
    if (this.phase !== 'stop') this.enter('stop');
  }
  update(dt) {
    if (dt <= 0) return;
    this.elapsed += dt;
    this.weight = ease(this.weight, this.moving ? 1 : 0, dt, .14);
    for (const entry of this.retiring) { entry.weight = Math.max(0, entry.weight - dt / .18); entry.action.weight = entry.weight * this.weight; if (entry.weight <= 0) entry.action.stop(); }
    this.retiring = this.retiring.filter(entry => entry.weight > 0);
    if (!this.moving) return;
    const duration = this.profile.duration, t = this.elapsed * this.rate, phase = this.phase;
    this.action.timeScale = this.rate;
    this.action.weight = this.weight * smoothstep(this.elapsed / .16);
    if (this.phase === 'left' || this.phase === 'right') {
      this.yaw = this.stageYaw + this.stageAngle * smoothstep(t / duration);
      if (t >= duration) {
        this.yaw = this.stageYaw + this.stageAngle; this.turnRemaining = wrap(this.desiredYaw - this.yaw); this.beginTurn();
      }
    } else {
      const index = Math.min(this.profile.samples.length - 1, Math.floor(t / duration % 1 * (this.profile.samples.length - 1)));
      const sample = this.profile.samples[index];
      const stanceSpeed = Math.max(0, ...Object.values(sample).filter(s => s.low).map(s => -s.speed));
      const authored = this.rootMotions.get(this.phase);
      const authoredDistance = authored ? (rootTravelAt(authored, t) - rootTravelAt(authored, Math.max(0, t - dt * this.rate))) * this.vrm.humanoid.normalizedRestPose.hips.position[1] / authored.restHipsHeight : null;
      const velocity = authoredDistance !== null ? authoredDistance / dt : Math.min(stanceSpeed, this.height * 1.1) * this.rate;
      if (this.target && velocity > 0) {
        const delta = this.target.clone().sub(this.vrm.scene.position); delta.y = 0;
        const travel = Math.min(delta.length(), velocity * dt);
        if (travel > 0) { this.vrm.scene.position.addScaledVector(delta.normalize(), travel); this.distance += travel; }
        // The stop clip begins at the same gait boundary as the cycle. Wait
        // for a phase boundary instead of splicing a raised foot into a plant.
        const stopDistance = (this.profiles.get('stop')?.travel || this.height * .08) + this.height * .025;
        const cycleRemaining = this.profile.duration - this.action.time;
        if (this.phase === 'walk' && this.vrm.scene.position.distanceTo(this.target) < stopDistance && cycleRemaining < dt * this.rate * 1.5) this.enter('stop');
        else if (this.phase === 'walk' && this.vrm.scene.position.distanceTo(this.target) < this.height * .015) this.enter('stop');
      }
      if (t >= duration && phase === 'start' && this.phase === phase) this.enter('walk');
      else if (t >= duration && phase === 'stop' && this.phase === phase) {
        this.target = null; this.returning = true; this.desiredYaw = 0;
        this.turnRemaining = wrap(-this.yaw); this.beginTurn();
      }
    }
    this.forward.copy(this.baseForward).applyAxisAngle(up, this.yaw);
    this.vrm.scene.quaternion.copy(new THREE.Quaternion().setFromAxisAngle(up, this.yaw).multiply(this.baseQuaternion));
  }
  contact(side) {
    if (!this.profile || !this.action) return null;
    const phase = this.action.time / this.profile.duration;
    const index = Math.min(this.profile.samples.length - 1, Math.floor(phase * (this.profile.samples.length - 1)));
    const sample = this.profile.samples[index][side];
    const planted = sample.low && (this.phase === 'walk' ? sample.speed < -this.height * .035 : sample.speed < this.height * .025);
    return { planted, phase: this.phase, cycle: Math.floor(this.elapsed * this.rate / this.profile.duration) };
  }
  reset() {
    for (const action of this.actions.values()) action.stop();
    this.retiring = []; this.action = null; this.profile = null; this.target = null; this.phase = 'idle'; this.weight = 0; this.yaw = 0; this.distance = 0;
    this.forward.copy(this.baseForward); this.vrm.scene.position.copy(this.basePosition); this.vrm.scene.quaternion.copy(this.baseQuaternion);
  }
  snapshot() { return { available: this.available, active: this.active, phase: this.phase, elapsed: this.elapsed, weight: this.weight, yaw: this.yaw, speed: this.speed * this.rate, distance: this.distance, displacementSource: this.rootMotions.has('walk') ? 'authored-root-motion' : 'stance-velocity', position: this.vrm.scene.position.toArray(), target: this.target?.toArray(), phases: this.phaseChanges }; }
}
