import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectVrm } from '../src/model-file.mjs';
import { envelope } from '../src/motion.mjs';

function glb(extra = {}) {
  const json = JSON.stringify({ extensions: { VRMC_vrm: {} }, ...extra });
  const bytes = new TextEncoder().encode(json.padEnd(Math.ceil(json.length / 4) * 4, ' '));
  const buffer = new ArrayBuffer(20 + bytes.length); const view = new DataView(buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, buffer.byteLength, true);
  view.setUint32(12, bytes.length, true); view.setUint32(16, 0x4e4f534a, true); new Uint8Array(buffer, 20).set(bytes); return buffer;
}
test('accept embedded VRM, reject missing VRM, corrupt containers and remote/local external resources', () => {
  assert.ok(inspectVrm(glb()).extensions.VRMC_vrm);
  assert.ok(inspectVrm(glb({ extensions: { VRM: {} }, images: [{ uri: 'data:image/png;base64,YQ==' }] })).extensions.VRM);
  assert.throws(() => inspectVrm(glb({ extensions: {} })), /VRM 人形/);
  for (const uri of ['https://example.com/x.png', 'file:///C:/x.png', '../x.bin', '/sample.vrm', 'blob:whatever']) {
    assert.throws(() => inspectVrm(glb({ images: [{ uri }] })), /外部素材/);
    assert.throws(() => inspectVrm(glb({ buffers: [{ uri }] })), /外部素材/);
  }
  const broken = glb(); new DataView(broken).setUint32(8, 1, true);
  assert.throws(() => inspectVrm(broken), /容器损坏/);
  assert.throws(() => inspectVrm(new ArrayBuffer(2)), /有效/);
  assert.throws(() => inspectVrm(glb({ extensionsRequired: ['KHR_draco_mesh_compression'] })), /解码器/);
});
test('motion envelopes start and finish at rest and remain bounded', () => {
  for (const duration of [2.8, 3.8, 4.8]) {
    assert.equal(envelope(0, duration), 0); assert.equal(envelope(duration, duration), 0);
    assert.equal(envelope(duration / 2, duration), 1);
    for (let t = -.3; t < duration + .3; t += .01) assert.ok(envelope(t, duration) >= 0 && envelope(t, duration) <= 1);
    assert.ok(envelope(.001, duration) < .0001);
    assert.ok(envelope(duration - .001, duration) < .0001);
  }
});
