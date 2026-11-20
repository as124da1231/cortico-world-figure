import assert from 'node:assert/strict';
import {test} from 'node:test';
import {JSDOM} from 'jsdom';
import {createPetEmotionEffects} from '../workbench/pack/backends/emotion-effects/index.js';
import {FIGURE_WOLF_KAOMOJI} from '../workbench/pack/backends/emotion-effects/wolf-kaomoji.js';

function fixture() {
  const dom = new JSDOM('<svg><g id="art"/></svg>');
  const doc = dom.window.document, parent = doc.querySelector('svg');
  const effect = createPetEmotionEffects({doc,parent,art:doc.querySelector('#art'),bounds:[70,30,185,220],style:'kaomoji',size:'large'});
  const frame = (t, face='neutral', mode='stand') => effect.draw({t,face,mode,facing:1});
  return {dom,parent,effect,frame,read:() => parent.querySelector('text').textContent};
}

test('wolf glyphs match Figure faces and supported action cues through the real SVG painter', t => {
  const {effect,dom,frame,read,parent} = fixture();
  t.after(() => {effect.dispose();dom.window.close();});
  let i = 0;
  for (const word of ['pout','scared','worried','smug','thinking','sleepy','wink']) {
    frame(i++,word);
    assert.equal(read(),FIGURE_WOLF_KAOMOJI[word]);
  }
  frame(i++,'neutral','sleep');
  assert.equal(read(),FIGURE_WOLF_KAOMOJI.sleep);
  frame(i++);
  effect.trigger('wink');
  frame(i++);
  assert.equal(read(),FIGURE_WOLF_KAOMOJI.wink);
  frame(i+2);
  frame(i+3);
  assert.equal(parent.querySelector('.ifg-final-effects').getAttribute('display'),'none');
  frame(i+4,'happy');
  assert.equal(read(),'(≧▽≦)');
});
