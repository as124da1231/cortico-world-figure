import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import * as kit from '../workbench/vendor/coo-kit/kit/body.js';
import { createFigureBodyWithKit } from '../workbench/pack/backends/figure-body.js';

test('fixed art and hit geometry stay full width while the stock controller walks to the left', t => {
  const doc=new JSDOM('<main></main>').window.document;
  t.after(()=>doc.defaultView.close());
  let visibleFacing, disposed=0;
  const figure={
    directionalFrames:true,
    extent:[85,65,176,256],
    hits:[[129,154,40]],
    draw(_art,_face,frame) { visibleFacing=frame.facing; },
    dispose() { disposed++; },
  };
  const body=createFigureBodyWithKit(kit,{
    root:doc.querySelector('main'),bounds:()=>({W:500,H:420,floorY:360,S:.7}),
    start:{x:320,facing:-1},emit(){},sound(){},
  },{figure,words:{},css:''},{fixedFacing:true});
  assert.equal(disposed,0);
  body.set({roam:'off'});
  body.step(1/60);
  const initial=body.layout();
  assert.equal(initial.facing,-1);
  assert.equal(visibleFacing,1);
  assert(body.walk(170,false,1));
  for (let i=0;i<230;i++) {
    body.step(1/60,i%3===0);
    const layout=body.layout();
    assert(layout.box.w>initial.box.w*.8);
    assert.equal(visibleFacing,1);
  }
  assert(body.layout().x<initial.x-80);
  assert.match(doc.querySelector('svg.kit > g').getAttribute('transform'),/scale\([0-9.]+ /);
  body.dispose();
  assert.equal(disposed,1);
});

test('disabling idle breath removes the Kit scale cycle as well as keeping stable hit geometry', t => {
  function sample(breathingScale) {
    const doc = new JSDOM('<main></main>').window.document;
    t.after(() => doc.defaultView.close());
    const body = createFigureBodyWithKit(kit, {
      root:doc.querySelector('main'),bounds:()=>({W:500,H:420,floorY:360,S:.7}),
      start:{x:250,facing:1},emit(){},sound(){},
    }, {figure:{draw(){},hits:[[100,150,10],[160,150,10]]},words:{},css:''}, {breathingScale});
    body.set({roam:'off'});
    const scales = [], widths = [];
    for (let i=0;i<150;i++) {
      const draw = i%2===0;
      body.step(1/60,draw);
      if (draw) {
        const art = doc.querySelector('svg.kit > g');
        scales.push(Number(art.getAttribute('transform').match(/scale\([-\d.]+ ([-\d.]+)\)/)[1]));
      }
      const [left,right] = body.layout().hit;
      widths.push(Math.hypot(right.x-left.x,right.y-left.y));
    }
    body.dispose();
    return [scales,widths].map(values=>Math.max(...values)-Math.min(...values));
  }
  const [enabledHeight] = sample(true);
  const [disabledHeight, disabledWidth] = sample(false);
  assert(enabledHeight>.01);
  assert(disabledHeight<.0001);
  assert(disabledWidth<.0001);
});
