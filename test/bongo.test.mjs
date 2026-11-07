import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { createBody } from '../workbench/vendor/coo-kit/kit/body.js';
import { bongoBreathContribution, connectBongoBody, createBongoInput, keyArtwork } from '../workbench/pack/backends/bongo.js';

test('BongoCat binds the most recent held key to the authored side and restores the previous held key', () => {
  const images = { keya: { file: 'A.png' }, return: { file: 'Enter.png' } };
  assert.equal(keyArtwork(images, ['KeyA', 'Enter']).file, 'Enter.png');
  assert.equal(keyArtwork(images, ['KeyA']).file, 'A.png');
  assert.equal(keyArtwork(images, ['KeyB']), null);
});

test('BongoCat drives actual model indices from pointer and held state without latching the released paw', () => {
  const index = new Map([['ParamMouseX', 0], ['CatParamLeftHandDown', 1], ['ParamMouseLeftDown', 2]]);
  const values = new Map();
  const model = {
    getParameterMinimumValue: i => i === 0 ? -30 : 0,
    getParameterMaximumValue: i => i === 0 ? 20 : 1,
    getParameterDefaultValue: () => 0,
    setParameterValueByIndex: (i, value) => values.set(i, value),
  };
  const input = createBongoInput({ keys: [{ keya: { file: 'A.png' } }, {}] }, model, index, { bounds: () => ({ W: 100, H: 100 }) });
  input.pointer('move', { x: 0, y: 50 });
  input.input({ keys: ['KeyA'], primary: true });
  assert.equal(input.apply(1)[0].file, 'A.png');
  assert.ok(values.get(0) > 19);
  assert.equal(values.get(1), 1);
  assert.equal(values.get(2), 1);
  values.clear(); // Cubism loads its saved pose before the next input layer.
  input.input(null);
  assert.deepEqual(input.apply(1), [null, null]);
  assert.equal(values.has(1), false);
  assert.equal(values.has(2), false);
});


test('BongoCat keeps its authored facing while hovering on the left and rejects kit turns', () => {
  const { window } = new JSDOM('<div id="root"></div>');
  const host = {
    root: window.document.getElementById('root'),
    bounds: () => ({ W: 1000, H: 600, floorY: 540, S: 1 }),
    emit() {}, sound() {}, start: { x: 500, facing: 1 },
  };
  const body = createBody(host, { figure: { draw() {} } });
  body.set({ roam: 'off' });
  let pointerMoves = 0;
  connectBongoBody(body, { pointer(type) { if (type === 'move') pointerMoves++; }, input() {} }, {}, () => false);
  assert.equal(body.inputActivity, undefined);
  body.pointer('move', { x: 150, y: 400, t: 1 });
  for (let i = 0; i < 90; i++) body.step(1 / 60);
  assert.equal(pointerMoves, 1);
  assert.equal(body.layout().facing, 1);
  assert.equal(body.do('turn'), false);
  assert.equal(body.do('spin'), false);
  assert.equal(body.walk(100, false, 1), false);
  assert.equal(body.layout().facing, 1);
  body.dispose();
  window.close();
});

test('BongoCat uses the upstream half-weight additive breath over a full cycle', () => {
  const period = 3.2345;
  assert.equal(bongoBreathContribution(0), 0.25);
  assert.equal(bongoBreathContribution(period / 4), 0.5);
  assert.equal(bongoBreathContribution(period * 3 / 4), 0);
  for (let i = 0; i <= 240; i++) {
    const value = bongoBreathContribution(period * i / 240);
    assert.ok(value >= 0 && value <= 0.5);
  }
});
