import assert from 'node:assert/strict';
import {test} from 'node:test';
import {JSDOM} from 'jsdom';
import panel from '../dist/webui.js';

test('failed voice autosave keeps the newest volume, preserves other edits, and offers retry', async t => {
  const dom = new JSDOM('<main></main>', {url:'http://localhost/'});
  const {document, Event} = dom.window;
  const root = document.querySelector('main');
  const guard = [];
  const writes = [];
  const controls = {voiceVolume:1, voiceLipSync:true};
  const state = {selectedId:'voice',services:[{id:'voice',provider:'edge',profile:{},ready:true}],bodyReady:true,controls};
  const first = Promise.withResolvers();
  const handle = await panel.panels.voice.mount({
    root, language:'zh',
    guardLeave(fn) { guard.push(fn); return {dispose(){}}; },
    async invoke(method,args) {
      if (method === 'voiceState') return state;
      if (method === 'settings') return {};
      if (method === 'voiceControls') {
        writes.push(args[0]);
        if (writes.length === 1) return first.promise;
        return {...state, controls:{...controls, ...args[0]}};
      }
      throw Error('Unexpected method: '+method);
    },
  });
  t.after(() => { handle.dispose(); dom.window.close(); });
  const volume = root.querySelector('[aria-label="播放音量"]');
  const lipSync = root.querySelector('[aria-label="口型跟随音频"]');
  const retry = [...root.querySelectorAll('button')].find(button => button.textContent === '重试保存');
  const change = input => input.dispatchEvent(new Event('change',{bubbles:true}));
  const settle = () => new Promise(resolve => setImmediate(resolve));

  assert.equal(retry.parentElement.hidden, true);
  volume.value='0.4'; change(volume);
  volume.value='0.7'; change(volume);
  lipSync.checked=false; change(lipSync);
  assert.deepEqual(writes, [{voiceVolume:.4}]);
  first.reject(Error('QA write blocked'));
  await settle();
  assert.deepEqual(writes, [{voiceVolume:.4}]);
  assert.equal(volume.value,'0.7');
  assert.equal(volume.getAttribute('aria-valuetext'),'70%');
  assert.equal(lipSync.checked,false);
  assert.equal(retry.parentElement.hidden,false);
  assert.match(guard.at(-1)(), /尚未保存/);
  assert.match(root.textContent,/QA write blocked/);

  retry.click();
  await settle();
  assert.deepEqual(writes, [{voiceVolume:.4},{voiceVolume:.7,voiceLipSync:false}]);
  assert.equal(volume.value,'0.7');
  assert.equal(lipSync.checked,false);
  assert.equal(retry.parentElement.hidden,true);
  assert.equal(guard.at(-1)(),null);
});
