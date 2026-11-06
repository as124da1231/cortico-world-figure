import test from 'node:test';
import assert from 'node:assert/strict';
import { HandModel, FINGERS, HAND_CHAINS } from '../src/lab/hand-model.mjs';

const settle = (model, seconds = 2, step = 1 / 120) => {
  for (let t = 0; t < seconds; t += step) model.step(step);
};

test('蜷曲到 1 时，每根手指收敛到接近关节上限', () => {
  const model = new HandModel({ reflex: 0 });
  model.setInput({ curls: [1, 1, 1, 1, 1], coactivation: 0 });
  settle(model);
  const snap = model.snapshot();
  for (const finger of FINGERS) {
    const bones = HAND_CHAINS[finger].bones;
    for (const bone of bones) {
      const j = snap.joints[bone];
      assert.ok(j.angle > j.limit * 0.9, `${bone} 只到 ${(j.angle / j.limit * 100).toFixed(0)}%`);
    }
  }
});

test('完全张开时回到接近零度', () => {
  const model = new HandModel();
  model.setInput({ curls: [0, 0, 0, 0, 0] });
  settle(model);
  const snap = model.snapshot();
  for (const finger of FINGERS) {
    for (const bone of HAND_CHAINS[finger].bones) {
      assert.ok(Math.abs(snap.joints[bone].angle) < jitterTolerance(), `${bone} 未回到零位`);
    }
  }
});

function jitterTolerance() { return 0.02; }

test('共激活不改变平衡姿态，只提高刚度', () => {
  const relaxed = new HandModel();
  relaxed.setInput({ curls: [0.5, 0.5, 0.5, 0.5, 0.5], coactivation: 0 });
  settle(relaxed);
  const braced = new HandModel();
  braced.setInput({ curls: [0.5, 0.5, 0.5, 0.5, 0.5], coactivation: 0.9 });
  settle(braced);

  const a = relaxed.snapshot().joints.indexProximal.angle;
  const b = braced.snapshot().joints.indexProximal.angle;
  assert.ok(Math.abs(a - b) < 0.06, `平衡点被共激活改变了：${a} vs ${b}`);

  // 同一冲量下，绷紧的峰值偏移应当更小
  const peak = (model) => {
    model.impulse(1.5);
    let max = 0;
    for (let i = 0; i < 120; i++) {
      model.step(1 / 120);
      max = Math.max(max, Math.abs(model.snapshot().joints.indexProximal.angle - model.snapshot().joints.indexProximal.limit * 0.5));
    }
    return max;
  };
  const peakRelaxed = peak(relaxed);
  const peakBraced = peak(braced);
  assert.ok(peakBraced < peakRelaxed, `绷紧没有更稳：${peakBraced} vs ${peakRelaxed}`);
});

test('牵张反射抑制快速伸展（带 30ms 延迟）', () => {
  const run = (reflex) => {
    const model = new HandModel({ reflex });
    model.setInput({ curls: [0.8, 0.8, 0.8, 0.8, 0.8], reflex });
    settle(model, 1.5);
    const before = model.snapshot().joints.indexProximal.angle;
    model.impulse(-8); // 负冲量 = 把手指掰开
    let min = before;
    for (let i = 0; i < 180; i++) {
      model.step(1 / 120);
      min = Math.min(min, model.snapshot().joints.indexProximal.angle);
    }
    return before - min;
  };
  const without = run(0);
  const withReflex = run(1);
  assert.ok(withReflex < without, `反射没有减少伸展幅度：${withReflex} vs ${without}`);
});

test('接触力把关节推回，且不改变无接触时的姿态', () => {
  const model = new HandModel();
  model.setInput({ curls: [0.5, 0.5, 0.5, 0.5, 0.5] });
  settle(model, 1.5);
  const free = model.snapshot().joints.indexProximal.angle;
  model.setContact('indexProximal', 0.004);
  settle(model, 1);
  const pressed = model.snapshot().joints.indexProximal.angle;
  assert.ok(pressed < free, '接触没有产生回推');
});

test('快照包含执行器激活与刚度，可直接喂给 UI', () => {
  const model = new HandModel();
  model.setInput({ curls: [0.4, 0.2, 0.1, 0.1, 0.1], coactivation: 0.5 });
  model.step(1 / 60);
  const snap = model.snapshot();
  assert.equal(Object.keys(snap.activations).length, 10 + 1 + 4);
  assert.ok(snap.stiffness > 0);
  assert.ok(Object.keys(snap.joints).length === 15 + 2);
});
