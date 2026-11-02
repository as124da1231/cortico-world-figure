import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BehaviorDirector } from '../src/behavior.mjs';
import { idleClips, gestureClips, sampleKeys } from '../src/clips.mjs';

function random(seed = 12) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }
function advance(director, duration, options) { for (let t = 0; t < duration; t += .02) director.step(.02, options); }

test('quiet minute changes stance and glance without constant blinking cadence or unbounded focus', () => {
  const director = new BehaviorDirector(random());
  const idles = new Set(), blinks = [];
  let previous = 0;
  for (let t = 0; t < 60; t += .02) {
    const state = director.step(.02); idles.add(state.idle);
    assert.ok(state.blink >= 0 && state.blink <= 1);
    for (const focus of [state.eye, state.head, state.torso]) assert.ok(Number.isFinite(focus.x) && Math.abs(focus.x) < 1.1 && Math.abs(focus.y) < 1.1);
    if (director.blinkCount !== previous) { blinks.push(director.time); previous = director.blinkCount; }
  }
  assert.equal(idles.size, 3); assert.ok(blinks.length >= 8 && blinks.length < 35);
  const intervals = blinks.slice(1).map((t, i) => t - blinks[i]);
  assert.ok(Math.max(...intervals) - Math.min(...intervals) > 1);
  assert.ok(director.idleChanges >= 4);
});

test('eyes acquire a new target ahead of head and torso; attention eventually disengages and returns', () => {
  const director = new BehaviorDirector(random());
  director.setPointer(.8, .4, true); advance(director, .12);
  assert.ok(director.eye.x > .05); assert.equal(director.head.x, 0);
  advance(director, .65);
  assert.ok(director.eye.x > director.head.x && director.head.x > director.torso.x);
  const modes = new Set();
  for (let t = 0; t < 12; t += .02) modes.add(director.step(.02).mode);
  assert.ok(modes.has('attend') && modes.has('glance'));
  director.setPointer(.8, .4, false); director.step(.02); assert.equal(director.mode, 'linger');
  advance(director, 1.3); assert.equal(director.mode, 'rest');
});

test('reaction cooldown and paused simulation prevent repeated reactions and advancing clocks', () => {
  const director = new BehaviorDirector(random());
  assert.equal(director.react(), true); assert.equal(director.react(), false);
  advance(director, 2.6); assert.equal(director.react(), true);
  const before = director.snapshot();
  for (let i = 0; i < 100; i++) director.step(0);
  assert.deepEqual(director.snapshot(), before);
  advance(director, 20, { enabled: false }); assert.equal(director.idle, 'balanced');
});

test('original keyframes loop or return to rest, with finite interpolation across every curve', () => {
  for (const definition of Object.values(idleClips)) {
    for (const keys of Object.values(definition.channels)) assert.deepEqual(keys[0].slice(1), keys.at(-1).slice(1));
  }
  for (const definition of [...Object.values(idleClips), ...Object.values(gestureClips)]) {
    for (const keys of Object.values(definition.channels)) {
      assert.equal(keys[0][0], 0); assert.equal(keys.at(-1)[0], 1);
      for (let t = 0; t <= 1; t += .005) for (const value of sampleKeys(keys, t)) assert.ok(Number.isFinite(value) && Math.abs(value) < 120);
    }
  }
});
