import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { inferRoles, ROLE_RULES } from '../workbench/tools/parameter-mapping.mjs';
import { roleValue, maskBufferCount } from '../workbench/pack/backends/role-values.js';
import { createAdaptiveRenderer } from '../workbench/pack/backends/render-config.js';

const display = (...ids) => ({ Parameters: ids.map(Id => ({ Id })) });
const link = (input, output, weight = 100) => ({
  Input: [{ Source: { Target: 'Parameter', Id: input }, Weight: 100, Reflect: false }],
  Output: [{ Destination: { Target: 'Parameter', Id: output }, Weight: weight, Scale: 30, Reflect: false }],
});
const vts = (target, low = -20, high = 20) => ({ ParameterSettings: [
  { Input: 'FaceAngleX', OutputLive2D: target, OutputRangeLower: low, OutputRangeUpper: high },
] });

test('standard model keeps all previous semantic targets and ranges', () => {
  const d = display(...ROLE_RULES.flatMap(([, ids]) => ids));
  const result = inferRoles(d);
  assert.equal(Object.keys(result.roles).length, 17);
  for (const [name, targets, space, def] of ROLE_RULES) assert.deepEqual(result.roles[name], { targets, space, default: def });
});

test('reroutes a verified physics input and preserves authored input range', () => {
  const d = display('ParamAngleX', 'AngleX', 'smoothing');
  const physics = { PhysicsSettings: [link('AngleX', 'smoothing'), link('smoothing', 'ParamAngleX')] };
  const r = inferRoles(d, physics, vts('AngleX'));
  assert.deepEqual(r.roles.angleX.targets, ['AngleX']);
  assert.deepEqual(r.roles.angleX.ranges.AngleX, [-20, 20]);
  assert.equal(r.diagnostics[0].kind, 'physics-input');
  assert.deepEqual(inferRoles(d, physics).roles.angleX.targets, ['AngleX']);
});

test('ambiguous, reflected, partial and cyclic physics never invent an input', () => {
  const d = display('ParamAngleX', 'AngleX', 'another');
  const mixed = link('AngleX', 'ParamAngleX');
  mixed.Input.push({ Source: { Target: 'Parameter', Id: 'another' }, Weight: 50 });
  const reflected = link('AngleX', 'ParamAngleX'); reflected.Output[0].Reflect = true;
  for (const settings of [[mixed], [reflected], [link('AngleX', 'ParamAngleX', 50)],
    [link('AngleX', 'ParamAngleX'), link('another', 'ParamAngleX')],
    [link('AngleX', 'ParamAngleX'), link('ParamAngleX', 'AngleX')]]) {
    const r = inferRoles(d, { PhysicsSettings: settings }, vts('AngleX'));
    assert.deepEqual(r.roles.angleX.targets, ['ParamAngleX']);
    assert.ok(r.diagnostics.some(d => d.kind === 'physics-output'));
  }
});

test('body physics following the head does not steal the head input', () => {
  const r = inferRoles(display('ParamAngleX', 'ParamBodyAngleX'),
    { PhysicsSettings: [link('ParamAngleX', 'ParamBodyAngleX')] }, vts('ParamAngleX'));
  assert.deepEqual(r.roles.bodyX.targets, ['ParamBodyAngleX']);
  assert.deepEqual(r.roles.angleX.targets, ['ParamAngleX']);
  const shared = inferRoles(display('ParamAngleX', 'ParamBodyAngleX', 'AngleX'),
    { PhysicsSettings: [link('AngleX', 'ParamAngleX'), link('AngleX', 'ParamBodyAngleX')] }, vts('AngleX'));
  assert.deepEqual(shared.roles.angleX.targets, ['AngleX']);
  assert.deepEqual(shared.roles.bodyX.targets, ['ParamBodyAngleX']);
});

test('smile and blush aliases are narrow, not squint, puff, clothing or arbitrary tracker outputs', () => {
  const d = display('EyeSmile', 'LEyeSquint', 'REyeSquint', 'CheekPuff', 'key7', 'Clothes1');
  d.Parameters.find(p => p.Id === 'key7').Name = '7. 脸红';
  const r = inferRoles(d, {}, { ParameterSettings: [{ Input: 'MouthSmile', OutputLive2D: 'Clothes1', OutputRangeLower: 0, OutputRangeUpper: 1 }] });
  assert.deepEqual(r.roles.eyeSmile.targets, ['EyeSmile']);
  assert.equal(r.roles.cheek, undefined);
  assert.ok(r.diagnostics.some(d => d.kind === 'unverified-control' && d.targets.includes('key7')));
  assert.equal(inferRoles(display('LEyeSquint', 'CheekPuff')).roles.eyeSmile, undefined);
  d.Parameters.push({ Id: 'other', Name: '脸红' });
  assert.equal(inferRoles(d).roles.cheek, undefined);
});

test('normalization handles case/underscores but refuses ambiguous aliases', () => {
  assert.deepEqual(inferRoles(display('PARAM_ANGLE_X')).roles.angleX.targets, ['PARAM_ANGLE_X']);
  assert.equal(inferRoles(display('PARAM_ANGLE_X', 'param_angle_x')).roles.angleX, undefined);
});

test('range calibration preserves neutral, supports inversion and clamps bad ranges', () => {
  const m = { min: -30, max: 30, def: 0 };
  assert.equal(roleValue(.5, [-1, 1], 0, m), 15);
  assert.equal(roleValue(.5, [-1, 1], 0, m, [-20, 20]), 10);
  assert.equal(roleValue(.5, [-1, 1], 0, m, [20, -20]), -10);
  assert.equal(roleValue(0, [-1, 1], 0, m, [20, -20]), 0);
  assert.equal(roleValue(2, [-1, 1], 0, m, [-100, 100]), 30);
  assert.equal(roleValue(.5, [-1, 1], 0, m, [10, 20]), 15);
  assert.equal(roleValue(.5, [-1, 1], 0, m, [NaN, 20]), 15);
  assert.equal(roleValue(0, [0, 1], 1, { min: 0, max: 1.5, def: 1 }), 0);
});

test('clipping buffers count unique masks and cover the 36/32 texture limits', () => {
  const masks = n => Array.from({ length: n }, (_, i) => new Int32Array([i]));
  assert.equal(maskBufferCount([]), 1);
  assert.equal(maskBufferCount(masks(36)), 1);
  assert.equal(maskBufferCount(masks(37)), 2);
  assert.equal(maskBufferCount(masks(49)), 2);
  assert.equal(maskBufferCount(masks(64)), 2);
  assert.equal(maskBufferCount(masks(65)), 3);
  assert.equal(maskBufferCount([...masks(36), ...masks(36)]), 1);
  assert.equal(maskBufferCount([[1, 2], [2, 1], []]), 1);
});

test('mask allocation failure automatically falls back and refuses incomplete rendering', () => {
  for (const failures of [0, 1, 2, 3]) {
    let renderer; let attempt = 0; let cleanups = 0;
    const model = {
      _model: { getDrawableMasks: () => Array.from({ length: 49 }, (_, i) => [i]), isUsingMasking: () => true },
      createRenderer(w, h, count) {
        const valid = attempt++ >= failures;
        renderer = { _drawableMasks: Array.from({ length: count }, () => ({ isValid: () => valid })),
          setClippingMaskBufferSize(size) { this.size = size; }, useHighPrecisionMask(value) { this.precise = value; },
          startUp() {}, setIsPremultipliedAlpha() {} };
      },
      getRenderer: () => renderer, deleteRenderer: () => { cleanups++; },
    };
    if (failures === 3) assert.throws(() => createAdaptiveRenderer(model, {}, 512, 512), /兼容渲染也未成功/);
    else {
      const r = createAdaptiveRenderer(model, {}, 512, 512);
      assert.equal(r.mode, ['packed', 'compatible', 'reduced'][failures]);
      assert.equal(r.maskBuffers, failures ? 1 : 2);
      assert.equal(r.maskSize, failures === 2 ? 256 : 512);
      assert.equal(Boolean(r.warning), failures > 0);
      if (failures) assert.equal(renderer.precise, true);
    }
    assert.equal(cleanups, failures);
  }
});

test('real DeepSeek physics and reference packs retain working semantic behavior', {
  skip: !(process.env.L2D_MAPPING_MODEL && process.env.L2D_CORE),
}, async () => {
  globalThis.__dirname = process.cwd(); globalThis.require = createRequire(import.meta.url);
  vm.runInThisContext(await readFile(process.env.L2D_CORE, 'utf8'));
  const { CubismFramework, CubismUserModel } = await import('../workbench/pack/sdk/framework.js');
  CubismFramework.startUp(); CubismFramework.initialize();
  const dir = process.env.L2D_MAPPING_MODEL;
  const json = async name => JSON.parse(await readFile(join(dir, name), 'utf8'));
  const d = await json('大肥鱼.cdi3.json'); const physics = await json('大肥鱼.physics3.json');
  const { roles } = inferRoles(d, physics, await json('大肥鱼.vtube.json'));
  const moc = await readFile(join(dir, '大肥鱼.moc3'));
  const ids = CubismFramework.getIdManager();
  const ab = b => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  const make = () => {
    const u = new CubismUserModel(); u.loadModel(ab(moc), true);
    const p = Buffer.from(JSON.stringify(physics)); u.loadPhysics(ab(p), p.length); return u;
  };
  const evidence = [];
  for (const [role, output] of [['angleX','ParamAngleX'],['angleY','ParamAngleY'],['angleZ','ParamAngleZ'],['bodyX','ParamBodyAngleX']]) {
    assert.notEqual(roles[role].targets[0], output);
    for (const amount of [-.5, .5]) {
      const u = make(); const m = u._model; m.saveParameters();
      const input = roles[role].targets[0]; const ix = m.getParameterIndex(ids.getId(input));
      const target = roleValue(amount, roles[role].space, roles[role].default, {
        min: m.getParameterMinimumValue(ix), max: m.getParameterMaximumValue(ix), def: m.getParameterDefaultValue(ix),
      }, roles[role].ranges?.[input]);
      for (let i = 0; i < 180; i++) { m.loadParameters(); m.setParameterValueById(ids.getId(input), target); m.saveParameters(); u._physics.evaluate(m, 1 / 60); }
      m.update(); const value = m.getParameterValueById(ids.getId(output));
      assert.ok(value * Math.sign(amount) > 5, `${role}: ${value}`);
      evidence.push({ role, amount, value }); u.release();
    }
  }
  const u = make();
  assert.equal(maskBufferCount(u._model.getDrawableMasks()), 2); u.release();
  for (const root of (process.env.L2D_REFERENCE_PACKS ?? '').split(';').filter(Boolean)) {
    const registry = (await import(pathToFileURL(join(root, 'models/index.js')))).models;
    const entry = Object.values(registry)[0]; const folder = join(root, 'models', entry.id);
    const old = (await import(pathToFileURL(join(folder, 'profile.js')))).default;
    const display = (await import(pathToFileURL(join(folder, 'cdi3.js')))).default;
    const physics = (await import(pathToFileURL(join(folder, 'physics.js')))).default;
    const updated = inferRoles(display, physics).roles;
    assert.deepEqual(updated, old.roles, `reference mapping changed: ${entry.id}`);
  }
  console.log('Real mapping evidence:', JSON.stringify(evidence));
});
