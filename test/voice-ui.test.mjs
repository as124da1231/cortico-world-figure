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

test('one playback control shows the matching stop action only while audio is active', async t => {
  const dom = new JSDOM('<main></main>', {url:'http://localhost/'});
  const root = dom.window.document.querySelector('main');
  const service = {id:'voice',provider:'edge',profile:{},ready:true};
  const state = {selectedId:service.id,services:[service],bodyReady:true,controls:{voiceEnabled:true},speaking:false};
  const calls = [];
  let refresh, stopped = false;
  const handle = await panel.panels.voice.mount({
    root, language:'zh',
    interval(fn) { refresh = fn; return {dispose(){ stopped = true; }}; },
    async invoke(method) {
      if (method === 'voiceState') return {...state};
      if (method === 'voiceAudition' || method === 'voiceStop' || method === 'voiceHush') {
        calls.push(method);
        state.speaking = method === 'voiceAudition';
        return {ok:true};
      }
    },
  });
  t.after(() => { handle.dispose(); dom.window.close(); });
  const control = root.querySelector('.l2d-voice-playback');
  const settle = () => new Promise(resolve => setImmediate(resolve));
  assert.equal(control.textContent,'在桌宠试听');
  assert.equal(root.querySelector('.l2d-voice-transport').childElementCount,1);
  control.click();
  await settle();
  assert.equal(control.textContent,'停止试听');
  control.click();
  await settle();
  assert.equal(control.textContent,'在桌宠试听');
  state.speaking = true;
  refresh();
  await settle();
  assert.equal(control.textContent,'停止朗读');
  control.click();
  await settle();
  assert.equal(control.textContent,'在桌宠试听');
  assert.deepEqual(calls,['voiceAudition','voiceStop','voiceHush']);
  handle.dispose();
  assert.equal(stopped,true);
});

test('late control save responses do not undo the selected service in the voice panel', async t => {
  const dom = new JSDOM('<main></main>', {url:'http://localhost/'});
  const root = dom.window.document.querySelector('main');
  const primary = {id:'initial',name:'Initial',provider:'edge',profile:{},ready:true};
  const backup = {id:'backup',name:'Backup',provider:'edge',profile:{},ready:true};
  const services = [primary, backup];
  const first = {selectedId:primary.id,services,playbackReady:false,controls:{voiceVolume:1}};
  const switched = {selectedId:backup.id,services,playbackReady:true,controls:{voiceVolume:.4}};
  const save = Promise.withResolvers();
  let state = first;
  const handle = await panel.panels.voice.mount({
    root, language:'zh',
    async invoke(method) {
      if (method === 'voiceState') return state;
      if (method === 'voiceControls') return save.promise;
      if (method === 'voiceSave') return state = switched;
      throw Error('Unexpected method: '+method);
    },
  });
  t.after(() => { handle.dispose(); dom.window.close(); });
  const volume = root.querySelector('[aria-label="播放音量"]');
  volume.value = '0.4';
  volume.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  root.querySelector('[aria-label="使用 Backup"]').click();
  await new Promise(resolve => setImmediate(resolve));
  save.resolve({...first, controls:{voiceVolume:.4}});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(root.querySelector('.l2d-voice-service.is-current').dataset.serviceId, backup.id);
  assert.equal(volume.value, '0.4');
  assert.equal(root.querySelector('.l2d-voice-playback').disabled, false);
});

test('desktop voice readiness updates in place without interrupting a volume adjustment', async t => {
  const dom = new JSDOM('<main></main>', {url:'http://localhost/'});
  const root = dom.window.document.querySelector('main');
  const service = {id:'voice',provider:'edge',profile:{},ready:true};
  const state = {selectedId:service.id,services:[service],bodyReady:false,playbackReady:false,timingReady:false,controls:{voiceVolume:1}};
  let poll;
  const handle = await panel.panels.voice.mount({
    root, language:'zh',
    interval(fn) { poll = fn; return {dispose(){}}; },
    async invoke(method) {
      assert.equal(method, 'voiceState');
      return {...state};
    },
  });
  t.after(() => { handle.dispose(); dom.window.close(); });
  const button = root.querySelector('.l2d-voice-playback');
  const timing = root.querySelector('[aria-label="朗读时机"]');
  const volume = root.querySelector('[aria-label="播放音量"]');
  const refresh = async () => {
    poll();
    await new Promise(resolve => setImmediate(resolve));
  };
  assert.equal(button.disabled, true);
  assert.match(root.querySelector('.l2d-voice-message').textContent, /切换到支持语音/);
  volume.value = '0.6';
  volume.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  Object.assign(state,{playbackReady:true,timingReady:true});
  await refresh();
  assert.equal(button.disabled, false);
  assert.equal(timing.options[1].disabled, false);
  assert.match(root.querySelector('.l2d-voice-message').textContent, /当前可播放语音/);
  assert.equal(volume.value, '0.6');
  Object.assign(state,{playbackReady:false,timingReady:false});
  await refresh();
  assert.equal(button.disabled, true);
  assert.equal(timing.options[1].disabled, true);
});
