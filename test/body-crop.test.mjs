import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BODY_CROP_DEFAULT, cropEdgeAt, cropGeometry, normalizeBodyCrop } from '../workbench/pack/backends/crop-config.js';
import { cropPose, interpolateCrop } from '../workbench/pack/backends/body-crop.js';

const extent = [40, 20, 220, 246];
const upper = { ...BODY_CROP_DEFAULT, mode: 'upper', edge: 'round', feather: .12 };
const silhouette = {
  width: 106, footX: 135,
  rows: Array.from({ length: 226 }, (_, i) => [20 + i, i < 45 ? 90 : 42, i < 45 ? 175 : 212]),
};

test('upper-body masks raise a round edge at the sides and keep all hit circles above the floor', () => {
  const round = interpolateCrop(extent, BODY_CROP_DEFAULT, upper, 1);
  const flat = interpolateCrop(extent, BODY_CROP_DEFAULT, { ...upper, edge: 'flat' }, 1);
  assert.ok(cropEdgeAt(round, round.x0) < cropEdgeAt(round, round.center));
  assert.equal(cropEdgeAt(flat, flat.x0), cropEdgeAt(flat, flat.center));
  const pose = cropPose(round, silhouette);
  assert.ok(Math.abs(pose.extent[3] - 256) <= 1);
  assert.ok(pose.hits.length >= 2);
  assert.ok(pose.hits.every(([, y, radius]) => y + radius <= pose.extent[3]));
});

test('round crop curvature scales arc depth without moving the cut or floor', () => {
  const {curve:defaultCurve, ...legacy} = upper;
  assert.equal(normalizeBodyCrop(legacy).curve, defaultCurve);
  const normal = cropGeometry(extent, legacy);
  const half = cropGeometry(extent, normalizeBodyCrop({...legacy, curve:.5}));
  assert.equal(half.depth, normal.depth / 2);
  assert.equal(half.cut, normal.cut);
  assert.equal(half.shift, normal.shift);
  assert.equal(cropEdgeAt(half, half.center), normal.cut);
  assert.equal(cropGeometry(extent, {...upper, curve:0}).depth, 0);
  assert.equal(cropGeometry(extent, {...upper, curve:2, edge:'flat'}).depth, 0);
  const shallow = cropGeometry(extent, {...upper, curve:2, line:.2});
  assert.ok(shallow.depth <= (shallow.cut - shallow.y0) / 2);
});

test('reversing a crop transition starts at the displayed cut and restores the full silhouette', () => {
  const midway = interpolateCrop(extent, BODY_CROP_DEFAULT, upper, .4);
  const reversed = interpolateCrop(extent, upper, BODY_CROP_DEFAULT, 0, midway);
  assert.equal(reversed.cut, midway.cut);
  assert.equal(reversed.shift, midway.shift);
  assert.equal(reversed.upperAmount, midway.upperAmount);
  assert.equal(interpolateCrop(extent, upper, BODY_CROP_DEFAULT, 1, midway), null);
});

test('a sharp cut fades at the moving edge and remains sharp when settled', () => {
  const sharp = {...upper, feather:0};
  assert.ok(interpolateCrop(extent, BODY_CROP_DEFAULT, sharp, .5).featherPx > 0);
  assert.ok(interpolateCrop(extent, sharp, BODY_CROP_DEFAULT, .5).featherPx > 0);
  assert.equal(interpolateCrop(extent, BODY_CROP_DEFAULT, sharp, 1).featherPx, 0);
});
