import { smoothstep } from './motion.mjs';

const clamp = (x, min, max) => Math.min(max, Math.max(min, x));

// Exact critically damped integration, with velocity retained between frames.
class Focus {
  constructor() { this.x = 0; this.y = 0; this.vx = 0; this.vy = 0; }
  step(target, seconds, dt) {
    const omega = 2 / seconds, decay = Math.exp(-omega * dt);
    for (const [axis, velocity] of [['x', 'vx'], ['y', 'vy']]) {
      const delta = this[axis] - target[axis];
      const temp = (this[velocity] + omega * delta) * dt;
      this[axis] = target[axis] + (delta + temp) * decay;
      this[velocity] = (this[velocity] - omega * temp) * decay;
    }
  }
  snapshot() { return [this.x, this.y]; }
}

export class BehaviorDirector {
  constructor(random = Math.random) {
    this.random = random; this.time = 0;
    this.pointer = { x: 0, y: 0, present: false, movedAt: -100, leftAt: -100 };
    this.eye = new Focus(); this.head = new Focus(); this.torso = new Focus();
    this.target = { x: 0, y: 0 }; this.idleTarget = { x: 0, y: 0 };
    this.mode = 'rest'; this.idle = 'balanced'; this.idleChanges = 0;
    this.nextIdle = this.between(8, 12); this.nextLook = this.between(3, 5);
    this.nextBlink = this.between(2, 4.5); this.blinkAt = -100; this.blinkCount = 0;
    this.focusUntil = 0; this.awayUntil = 0; this.eyeDelayUntil = 0; this.headDelayUntil = 0;
    this.micro = { x: 0, y: 0 }; this.nextMicro = this.between(1, 2);
    this.reaction = 0; this.reactionAt = -100; this.reactionKind = 'acknowledge';
  }
  between(a, b) { return a + (b - a) * this.random(); }
  setPointer(x, y, present) {
    x = clamp(x, -1, 1); y = clamp(y, -1, 1);
    const acquired = present && !this.pointer.present;
    const distance = Math.hypot(x - this.pointer.x, y - this.pointer.y);
    if (present && (acquired || distance > .012)) {
      this.pointer.movedAt = this.time;
      this.focusUntil = this.time + this.between(2.8, 4.8);
      this.awayUntil = 0;
      if (acquired || distance > .5) { this.eyeDelayUntil = this.time + .055; this.headDelayUntil = this.time + .19; }
    }
    if (!present && this.pointer.present) this.pointer.leftAt = this.time;
    Object.assign(this.pointer, { x, y, present });
  }
  react() {
    if (this.time - this.reactionAt < 2.5) return false;
    this.reactionAt = this.time; this.reaction++;
    this.reactionKind = this.reaction % 3 === 0 ? 'greeting' : 'acknowledge';
    this.focusUntil = this.time + 4; this.awayUntil = 0;
    return true;
  }
  step(dt, { enabled = true, gaze = true, attention = null, arousal = 0 } = {}) {
    dt = clamp(dt, 0, .05); this.time += dt;
    const t = this.time;
    if (enabled && t >= this.nextIdle) {
      const choices = ['balanced', 'rest-left', 'rest-right'].filter(id => id !== this.idle);
      this.idle = choices[Math.floor(this.random() * choices.length)]; this.idleChanges++;
      this.nextIdle = t + this.between(8, 13);
    } else if (!enabled) { this.idle = 'balanced'; this.nextIdle = t + 9; }
    if (t >= this.nextLook) {
      this.idleTarget = { x: this.between(-.38, .38), y: this.between(-.1, .17) };
      this.nextLook = t + this.between(4, 8);
    }
    let target = this.idleTarget;
    this.mode = 'rest';
    if (enabled && this.pointer.present) {
      if (t < this.focusUntil || t - this.pointer.movedAt < 1.4) {
        target = this.pointer; this.mode = 'attend';
      } else {
        if (!this.awayUntil) this.awayUntil = t + this.between(1.1, 2);
        if (t >= this.awayUntil) { this.focusUntil = t + this.between(2.2, 3.8); this.awayUntil = 0; target = this.pointer; this.mode = 'attend'; }
        else this.mode = 'glance';
      }
    } else if (enabled && t - this.pointer.leftAt < 1.2) { target = this.pointer; this.mode = 'linger'; }
    if (!enabled) target = this.pointer.present ? this.pointer : { x: 0, y: 0 };
    if (attention) { target = attention; this.mode = attention.mode; }
    if (t >= this.nextMicro) {
      this.micro = { x: this.between(-.018, .018), y: this.between(-.012, .012) };
      this.nextMicro = t + this.between(.8, 1.8);
    }
    this.target = gaze ? { x: target.x + (enabled ? this.micro.x : 0), y: target.y + (enabled ? this.micro.y : 0) } : { x: 0, y: 0 };
    if (t >= this.eyeDelayUntil) this.eye.step(this.target, .09, dt);
    if (t >= this.headDelayUntil) this.head.step(this.eye, .42 * (1 - clamp(arousal, -1, 1) * .25), dt);
    this.torso.step(this.head, 1.1 * (1 - clamp(arousal, -1, 1) * .2), dt);
    if (t >= this.nextBlink) {
      this.blinkAt = t; this.blinkCount++;
      this.nextBlink = t + (this.random() < .12 ? this.between(.32, .48) : this.between(2.7, 6.2));
    }
    const blinkPhase = t - this.blinkAt;
    const blink = blinkPhase < .07 ? smoothstep(blinkPhase / .07) : 1 - smoothstep((blinkPhase - .085) / .14);
    const reactionTime = t - this.reactionAt;
    const smile = enabled ? .52 * smoothstep(reactionTime / .25) * (1 - smoothstep((reactionTime - 1.3) / 2)) : 0;
    return { idle: this.idle, mode: this.mode, blink, smile, eye: this.eye, head: this.head, torso: this.torso };
  }
  snapshot() {
    return { time: this.time, mode: this.mode, idle: this.idle, idleChanges: this.idleChanges,
      target: [this.target.x, this.target.y], eye: this.eye.snapshot(), head: this.head.snapshot(), torso: this.torso.snapshot(),
      blinkCount: this.blinkCount, nextBlink: this.nextBlink, reactionCount: this.reaction };
  }
}
