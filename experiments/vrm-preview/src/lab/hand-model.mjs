/**
 * 单手最小驱动模型（纯逻辑，可 Node 测试）。
 *
 * 这一版把"内部状态"真正接进动力学：
 *
 *   每条肌腱 = 一个执行器，跨 3 个关节，力矩 = K · 力臂 · (a_flex·(1−x) − a_ext·x)
 *
 * 其中 x = q / L 是归一化关节角。这个"线性力-长度"形式带来两个正确性质：
 *   1. 平衡点 x* = a_flex / (a_flex + a_ext)，由激活差决定姿态；
 *   2. 共激活同时抬高两侧激活 → 平衡点不变、刚度线性上升。
 *
 * 也就是说：绷紧不会改变姿势，只会改变受扰后的轨迹。这正是要验证的东西。
 *
 * 另外：牵张反射带 30ms 传导延迟；腕部两个自由度；指尖接触产生反向力矩。
 */

export const FINGERS = ['thumb', 'index', 'middle', 'ring', 'little'];

/** VRM 归一化骨骼名 + 关节活动范围（度）+ 肌腱力臂（跨 3 关节）。 */
export const HAND_CHAINS = {
  thumb: { bones: ['thumbMetacarpal', 'thumbProximal', 'thumbDistal'], limits: [35, 65, 80], arms: [1, 0.85, 0.7] },
  index: { bones: ['indexProximal', 'indexIntermediate', 'indexDistal'], limits: [90, 100, 70], arms: [1, 0.9, 0.75] },
  middle: { bones: ['middleProximal', 'middleIntermediate', 'middleDistal'], limits: [90, 100, 70], arms: [1, 0.9, 0.75] },
  ring: { bones: ['ringProximal', 'ringIntermediate', 'ringDistal'], limits: [90, 100, 70], arms: [1, 0.9, 0.75] },
  little: { bones: ['littleProximal', 'littleIntermediate', 'littleDistal'], limits: [90, 100, 70], arms: [1, 0.9, 0.75] },
};

export const WRIST_JOINTS = { flex: 70, deviation: 35 };

export const PRESETS = {
  open: { curls: [0, 0, 0, 0, 0], opposition: 0, wrist: [0, 0] },
  fist: { curls: [0.55, 1, 1, 1, 1], opposition: 0.35, wrist: [0.25, 0] },
  point: { curls: [0.7, 0, 1, 1, 1], opposition: 0.15, wrist: [0.1, 0] },
  pinch: { curls: [0.75, 0.55, 0.1, 0.05, 0.05], opposition: 0.9, wrist: [0.15, 0] },
  thumbsUp: { curls: [0, 1, 1, 1, 1], opposition: 0.6, wrist: [0.35, -0.15] },
  relax: { curls: [0.12, 0.22, 0.25, 0.28, 0.32], opposition: 0.1, wrist: [0.05, 0] },
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const deg = (d) => (d * Math.PI) / 180;

export class HandModel {
  constructor(options = {}) {
    this.options = {
      stiffness: 55,          // 肌腱刚度系数
      damping: 0.55,          // 关节阻尼
      inertia: 0.02,          // 等效惯量
      activationTau: 0.035,   // 激活时间常数
      coactivationGain: 2.2,  // 共激活对肌腱力的放大
      reflexDelay: 0.03,      // 反射传导延迟（秒）
      reflexGain: 0,          // 反射增益，0 = 关
      reflexVelocity: 0.5,    // 触发反射的角速度阈值（rad/s）
      contactStiffness: 3.0,  // 指尖接触刚度
      ...options,
    };
    this.time = 0;
    this.joints = new Map();   // bone -> { q, qd, L, rest }
    this.actuators = [];       // { id, joints: [{ bone, arm }], thumb? }
    this.activations = new Map();
    this.delayBuffer = [];     // 反射延迟缓冲
    this.contact = new Map();  // bone -> 穿透深度（由外部写入）
    this.impulseTorque = new Map();

    this.input = {
      curls: [0, 0, 0, 0, 0],
      opposition: 0,
      wrist: [0, 0],
      coactivation: 0,
      reflex: this.options.reflexGain,
    };

    this.#build();
  }

  #build() {
    for (const finger of FINGERS) {
      const chain = HAND_CHAINS[finger];
      const flexJoints = [];
      const extJoints = [];
      chain.bones.forEach((bone, i) => {
        const L = deg(chain.limits[i]);
        this.joints.set(bone, { q: 0, qd: 0, L, rest: 0 });
        const arm = chain.arms[i] * L; // 力臂按关节量程缩放
        flexJoints.push({ bone, arm });
        extJoints.push({ bone, arm });
      });
      this.actuators.push({ id: `${finger}:flex`, finger, kind: 'flex', joints: flexJoints });
      this.actuators.push({ id: `${finger}:ext`, finger, kind: 'ext', joints: extJoints });
      this.activations.set(`${finger}:flex`, 0);
      this.activations.set(`${finger}:ext`, 1);
    }
    // 拇指对掌：作用在掌骨上，绕另一个轴（由渲染层处理）
    this.actuators.push({
      id: 'thumb:opposition', finger: 'thumb', kind: 'opposition',
      joints: [{ bone: 'thumbMetacarpal', arm: deg(28) }],
    });
    this.activations.set('thumb:opposition', 0);

    // 腕：两个自由度
    this.joints.set('hand:flex', { q: 0, qd: 0, L: deg(WRIST_JOINTS.flex), rest: 0 });
    this.joints.set('hand:deviation', { q: 0, qd: 0, L: deg(WRIST_JOINTS.deviation), rest: 0 });
    this.actuators.push({ id: 'wrist:flex', finger: null, kind: 'wrist', joint: 'hand:flex', arm: deg(WRIST_JOINTS.flex) });
    this.actuators.push({ id: 'wrist:ext', finger: null, kind: 'wrist', joint: 'hand:flex', arm: deg(WRIST_JOINTS.flex) });
    this.actuators.push({ id: 'wrist:radial', finger: null, kind: 'wrist', joint: 'hand:deviation', arm: deg(WRIST_JOINTS.deviation) });
    this.actuators.push({ id: 'wrist:ulnar', finger: null, kind: 'wrist', joint: 'hand:deviation', arm: deg(WRIST_JOINTS.deviation) });
    for (const id of ['wrist:flex', 'wrist:ext', 'wrist:radial', 'wrist:ulnar']) this.activations.set(id, 0);
  }

  setInput(patch) {
    if (patch.curls) this.input.curls = patch.curls.map((v) => clamp(v, 0, 1));
    if (typeof patch.opposition === 'number') this.input.opposition = clamp(patch.opposition, 0, 1);
    if (patch.wrist) this.input.wrist = patch.wrist.map((v) => clamp(v, -1, 1));
    if (typeof patch.coactivation === 'number') this.input.coactivation = clamp(patch.coactivation, 0, 1);
    if (typeof patch.reflex === 'number') this.input.reflex = clamp(patch.reflex, 0, 1);
    return this;
  }

  applyPreset(name) {
    const preset = PRESETS[name];
    if (!preset) return false;
    return this.setInput({ curls: preset.curls, opposition: preset.opposition, wrist: preset.wrist });
  }

  /** 外部冲量：给五根手指的掌指关节一个短脉冲力矩。 */
  impulse(strength = 1.2) {
    for (const finger of FINGERS) {
      const bone = HAND_CHAINS[finger].bones[0];
      this.impulseTorque.set(bone, (this.impulseTorque.get(bone) || 0) + strength);
    }
    this.impulseAge = 0;
    return this;
  }

  /** 指尖接触：depth 为穿透深度（米），由渲染层根据场景给出。 */
  setContact(bone, depth) {
    if (depth > 0) this.contact.set(bone, depth);
    else this.contact.delete(bone);
  }

  step(dt) {
    const total = clamp(dt, 0, 0.05);
    const steps = Math.max(1, Math.ceil(total / 0.0015));
    const h = total / steps;
    for (let s = 0; s < steps; s++) this.#substep(h);
    this.time += total;
    return this;
  }

  #activationTargets() {
    const co = 1 + this.input.coactivation * this.options.coactivationGain;
    const targets = new Map();
    for (let i = 0; i < FINGERS.length; i++) {
      const finger = FINGERS[i];
      const curl = this.input.curls[i];
      targets.set(`${finger}:flex`, curl * co);
      targets.set(`${finger}:ext`, (1 - curl) * co);
    }
    targets.set('thumb:opposition', this.input.opposition * co);
    const [flex, dev] = this.input.wrist;
    const f = clamp(flex, -1, 1);
    targets.set('wrist:flex', Math.max(0, f) * co);
    targets.set('wrist:ext', Math.max(0, -f) * co);
    targets.set('wrist:radial', Math.max(0, dev) * co);
    targets.set('wrist:ulnar', Math.max(0, -dev) * co);
    return targets;
  }

  #substep(h) {
    const o = this.options;
    const targets = this.#activationTargets();
    const tau = o.activationTau;

    // 反射：用 30ms 前的角速度，而不是当前值
    this.delayBuffer.push({ t: this.time, velocities: new Map([...this.joints].map(([k, j]) => [k, j.qd])) });
    while (this.delayBuffer.length && this.delayBuffer[0].t < this.time - o.reflexDelay) this.delayBuffer.shift();
    const delayed = this.delayBuffer[0]?.velocities;

    for (const [id, target] of targets) {
      const current = this.activations.get(id) ?? 0;
      this.activations.set(id, current + (target - current) * (h / tau));
    }

    const torque = new Map();
    for (const key of this.joints.keys()) torque.set(key, 0);

    for (const actuator of this.actuators) {
      let a = this.activations.get(actuator.id) ?? 0;
      if (actuator.joint) {
        const j = this.joints.get(actuator.joint);
        const x = clamp(j.q / j.L, 0, 1);
        const force = actuator.kind === 'wrist' && actuator.id.endsWith('ext')
          ? -a * x
          : a * (1 - x);
        torque.set(actuator.joint, torque.get(actuator.joint) + o.stiffness * actuator.arm * force);
        continue;
      }
      for (const { bone, arm } of actuator.joints) {
        const j = this.joints.get(bone);
        const x = clamp(j.q / j.L, 0, 1);
        const force = actuator.kind === 'ext' ? -a * x : a * (1 - x);
        torque.set(bone, torque.get(bone) + o.stiffness * arm * force);
      }
    }

    for (const [key, j] of this.joints) {
      let t = torque.get(key) || 0;
      t += this.impulseTorque.get(key) || 0;
      const depth = this.contact.get(key) || 0;
      if (depth > 0) t -= o.contactStiffness * depth; // 接触把关节往回推
      // 牵张反射：用 30ms 前的伸展速度，产生屈曲方向的力矩。
      // 放在力矩层而不是激活层，静态时速度为 0，不会改变平衡姿态。
      if (this.input.reflex > 0) {
        const rv = delayed?.get(key) ?? 0;
        if (rv < -o.reflexVelocity) t += Math.min(6, this.input.reflex * 2.5 * (-rv - o.reflexVelocity));
      }
      t -= o.damping * j.qd;
      j.qd += (t / o.inertia) * h;
      j.q += j.qd * h;
      if (j.q < -deg(4)) { j.q = -deg(4); j.qd = Math.min(0, j.qd); }
      if (j.q > j.L * 1.02) { j.q = j.L * 1.02; j.qd = Math.max(0, j.qd); }
    }

    if (this.impulseAge !== undefined && this.impulseAge > 0.04) {
      this.impulseTorque.clear();
      this.impulseAge = Infinity;
    } else if (this.impulseAge !== undefined) this.impulseAge += h;
  }

  /** 指尖位置（模型侧，供实验记录用；不是渲染坐标）。 */
  fingertip() {
    const out = {};
    for (const finger of FINGERS) {
      const bones = HAND_CHAINS[finger].bones;
      out[finger] = bones.reduce((sum, bone) => sum + (this.joints.get(bone)?.q || 0), 0);
    }
    return out;
  }

  snapshot() {
    const joints = {};
    for (const [key, j] of this.joints) {
      joints[key] = {
        angle: +j.q.toFixed(4), velocity: +j.qd.toFixed(4), limit: +j.L.toFixed(4),
      };
    }
    const activations = {};
    for (const [id, a] of this.activations) activations[id] = +a.toFixed(3);
    return {
      time: +this.time.toFixed(3),
      input: { ...this.input, curls: [...this.input.curls], wrist: [...this.input.wrist] },
      joints,
      activations,
      fingertip: this.fingertip(),
      contacts: Object.fromEntries(this.contact),
      stiffness: +(this.options.stiffness * (1 + this.input.coactivation * this.options.coactivationGain)).toFixed(1),
    };
  }
}
