import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { createBody } from '../workbench/vendor/coo-kit/kit/body.js';
import { createGrabReaction, normalizeClickReaction, setClickReaction } from '../workbench/pack/backends/click-reaction.js';
import { createNativeActions } from '../workbench/pack/backends/native-actions.js';

function createPet(t, mode, options) {
  const dom = new JSDOM('<main></main>');
  t.after(() => dom.window.close());
  const events = [];
  let face;
  const body = createBody({
    root: dom.window.document.querySelector('main'),
    start: { x: 250 },
    bounds: () => ({ W: 500, H: 420, floorY: 360, S: .7 }),
    emit: (event, detail) => events.push({event, ...detail}),
    sound() {},
  }, { figure: { draw(_root, _face, frame) { face = frame.face; } } });
  t.after(() => body.dispose());
  body.set({roam:'off'});
  body.step(1/60);
  setClickReaction(body, normalizeClickReaction(mode), () => body.cue('cheer'), options?.(body));
  const hit = body.layout().hit[0];
  const down = () => body.pointer('down', {...hit,t:1000});
  const up = (ms=100) => body.pointer('up', {...hit,t:1000+ms});
  return {body,events,face:()=>face,down,up,hit};
}

test('a short click preserves the original reaction or gives the selected quieter response', t => {
  t.mock.method(Math, 'random', () => .01);
  for (const [mode,expectedMode,expectedFace] of [
    [undefined,'crouch','happy'],['expression','idle','happy'],['none','idle','neutral'],
  ]) {
    const pet = createPet(t,mode);
    pet.down();pet.up();pet.body.step(1/60);
    assert.equal(pet.body.layout().mode,expectedMode);
    assert.equal(pet.face(),expectedFace);
    assert.equal(pet.body.layout().pressing,false);
  }
});

test('cancel and long press stay quiet, while drag, wake and commanded jumps stay available', t => {
  for (const mode of ['expression','none']) {
    const pet=createPet(t,mode);
    pet.down();pet.up(500);pet.body.step(1/60);
    assert.equal(pet.face(),'neutral');
    pet.down();pet.body.pointer('cancel',{...pet.hit,t:1100});pet.body.step(1/60);
    assert.equal(pet.face(),'neutral');
    assert.equal(pet.body.layout().pressing,false);
    pet.down();pet.body.pointer('move',{x:pet.hit.x+30,y:pet.hit.y,t:1100});
    assert.equal(pet.body.layout().mode,'drag');
    pet.up();
    assert.equal(pet.body.layout().mode,'air');
    assert(pet.events.some(event=>event.event==='touch'&&event.kind==='grab'));
    assert(pet.events.some(event=>event.event==='touch'&&event.kind==='drop'));
    const asleep=createPet(t,mode);
    asleep.body.do('sleep');
    asleep.body.step(1/60);
    const hit=asleep.body.layout().hit[0];
    asleep.body.pointer('down',{...hit,t:1000});asleep.body.pointer('up',{...hit,t:1100});
    assert.equal(asleep.body.layout().mode,'wake');
    const standing=createPet(t,mode);
    assert(standing.body.do('jump'));
    assert.equal(standing.body.layout().mode,'crouch');
  }
});

test('expression feedback cannot start a native motion bound to the same face', () => {
  const config={
    resources:[{id:'hop',kind:'motion',seconds:1,data:{Curves:[{Id:'ParamBody',Target:'Parameter',Segments:[0,0,0,1,1]}]}}],
    bindings:[{word:'happy',resource:'hop'}],
  };
  const faceOnly=createNativeActions(config);
  faceOnly.update({face:'happy'},1/60,true);
  assert.equal(faceOnly.state().motion,null);
  faceOnly.update({face:'happy',gesture:{kind:'happy'}},1/60,true);
  assert.equal(faceOnly.state().motion,'hop');
});

test('click pools invoke one local word and ignore drag, long press and cancellation', t => {
  t.mock.method(Math, 'random', () => .51);
  const calls = [];
  const pet = createPet(t, 'none', body => {
    const local = body.do;
    body.do = word => word !== 'confused' && local(word);
    return {words:['wink','confused'],play(word) { calls.push(word); return local(word); }};
  });
  assert.equal(pet.body.do('confused'),false);
  pet.down();pet.up();pet.body.step(1/60);
  assert.deepEqual(calls,['confused']);
  assert.equal(pet.face(),'confused');
  pet.down();pet.up(500);
  pet.down();pet.body.pointer('cancel',{...pet.hit,t:1100});
  pet.down();pet.body.pointer('move',{x:pet.hit.x+30,y:pet.hit.y,t:1100});pet.up();
  assert.deepEqual(calls,['confused']);
});

test('grab reaction chooses once per hold and fades after drop or cancel', t => {
  const random = t.mock.method(Math, 'random', () => .6);
  const reaction = createGrabReaction({mode:'random',pool:['wink','confused','wave']}, word=>word!=='wave');
  reaction.event('mode',{mode:'drag'});
  reaction.event('touch',{kind:'grab'});
  reaction.event('touch',{kind:'grab'});
  assert.equal(random.mock.callCount(),1);
  assert.deepEqual(reaction.frame(.16),{word:'confused',held:true,weight:1,age:.16});
  reaction.event('touch',{kind:'throw'});
  assert.equal(reaction.frame(.11).weight,.5);
  assert.equal(reaction.frame(.11),null);
  reaction.event('touch',{kind:'grab'});
  assert.equal(random.mock.callCount(),2);
  reaction.release();
  assert.equal(reaction.frame(.22),null);
  assert.equal(createGrabReaction({mode:'fixed',word:'wave'},()=>false),null);
});

test('held native expression adds both layers without starting a motion and releases with a fade', () => {
  const native = createNativeActions({
    resources:[
      {id:'eyes',kind:'expression',data:{Parameters:[{Id:'ParamEyes',Value:1}]}},
      {id:'load',kind:'expression',data:{Parameters:[{Id:'ParamLoad',Value:1}]}},
    ],
    bindings:[{word:'confused',resource:'eyes',overlays:['load']}],
  });
  native.update({face:'surprised',mode:'drag'},.1,false,'confused');
  const held=native.update({face:'surprised',mode:'drag'},.1,false,'confused');
  assert.deepEqual(held.map(track=>track.id),['ParamEyes','ParamLoad']);
  assert.equal(native.state().motion,null);
  const fading=native.update({face:'neutral',mode:'air'},.05);
  assert(fading.every(track=>track.value>0&&track.value<1));
  native.update({face:'neutral',mode:'air'},.1);
  assert.deepEqual(native.update({face:'neutral',mode:'air'},.1),[]);
});
