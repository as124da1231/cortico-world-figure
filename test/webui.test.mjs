import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import panel from '../dist/webui.js';
import { VOICE_PROVIDERS } from '../src/voice-catalog.mjs';

const tick = () => new Promise((r) => setTimeout(r, 15));
async function mount(t, opts = {}) {
  const providerHeader = opts.providerHeader
    ? '<div class="providerchrome"><header class="providerintro"><div class="pagetitle-row"></div></header></div>'
    : '';
  const route = opts.providerHeader ? '#/provider/world%3Afigure/workbench' : '';
  const dom = new JSDOM(providerHeader + '<main class="panelslot"></main>', { url: 'http://localhost/' + route });
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  if (opts.fetch) dom.window.fetch = opts.fetch;
  // jsdom has no top-layer implementation; real modality is checked in the browser.
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  const calls = []; const toasts = []; const drawers = [];
  const configCalls = [];
  const guards = [];
  let ack = opts.ack ?? false;
  const root = document.querySelector('main');
  const ctx = {
    root, language: opts.language ?? 'zh',
    pickPath: opts.pickPath,
    interval: opts.interval,
    timeout: opts.timeout,
    refresh: opts.refresh,
    guardLeave(fn) { guards.push(fn); return {dispose(){}}; },
    async setConfig(group, values) { configCalls.push({group, values}); if (opts.setConfig) return opts.setConfig(group, values); return 'saved'; },
    ui: {
      sheet: ({ title, desc }) => {
        const el = document.createElement('section');
        const head = document.createElement('header'); head.className = 'sheet-head'; head.textContent = title;
        const body = document.createElement('div'); el.append(head, body); return { el, body };
      },
      log: () => ({ el: document.createElement('div'), append() {}, clear() {} }),
      toast: (...args) => toasts.push(args), confirm: opts.confirm || (async () => true),
      drawer: (...args) => { drawers.push(args); const body = args[1]; if (typeof body !== 'string') root.append(body); return {dispose(){body?.remove?.();}}; },
    },
    async invoke(method, args) {
      calls.push({ method, args });
      if (opts.invoke) {
        const result = await opts.invoke(method, args);
        if (result !== undefined) return result;
      }
      const notice = { acknowledged: ack, revision: 1 };
      if (method === 'state') return { notice, version: opts.version ?? '1.4.2' };
      if (method === 'core') return { ok: opts.core ?? true, version: 'Cubism 5.3', consentAt: opts.coreConsentAt };
      if (method === 'noticeAccept') { ack = true; return { acknowledged: true, revision: 1 }; }
      if (method === 'list') return { dir: '', figuresDir: 'E:/test/figures', builds: opts.builds ?? [], installed: null, automation: opts.automation ?? {enabled:false,plans:[]} };
      if (method === 'detail') return { nameZh: '名字', aboutZh: '简介' };
      if (method === 'settings') return { cover: true, clean: true, texture: 'original', quality: opts.quality ?? 'original', gearTheme:opts.gearTheme,particleEffect:opts.particleEffect,autoDelete: false, figuresDir: '',...opts.appearanceValues };
      return { builds: opts.builds ?? [] };
    },
  };
  const handle = await (opts.voice ? panel.panels.voice : opts.appearance ? panel.panels.appearance : opts.effects ? panel.panels.effects : opts.configuration ? panel.panels.settings : panel.panels.workbench).mount(ctx);
  t.after(() => { handle.dispose(); dom.window.close(); });
  await tick();
  const button = (label) => [...document.querySelectorAll('button')].find((b) => b.textContent === label);
  return { ctx, root, calls, configCalls, toasts, drawers, button, handle, dom, guards };
}

test('primary configuration uses the shared gear form and auto-saves only changed fields', async t => {
  const {root,dom,configCalls,guards} = await mount(t,{configuration:true});
  assert.equal(root.querySelector('.l2d-voice-controls'),null);
  assert.equal(root.querySelectorAll('.l2d-gear-input').length,6);
  assert.equal(root.querySelector('.l2d-config-notice'),null);
  assert.equal(root.querySelector('.l2d-config-page .l2d-notice-entry'),null);
  assert.equal(root.querySelector('.l2d-version-corner'),null);
  const texture=root.querySelector('[aria-label="贴图精度"]');
  texture.value='2';texture.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await tick();
  assert.deepEqual(configCalls,[{group:'figure',values:{'worlds.figure.texture':'2048'}}]);
  assert.equal(root.querySelector('[aria-label="桌宠特效"]'), null);
  assert.equal(guards[0](),null);
  assert.equal(root.querySelector('.l2d-settings-status').textContent,'已保存');
});

test('model cards display only the supported model types', async t => {
  const builds = [
    {id:'l',kind:'live2d',bytes:1,at:2},
    {id:'b',kind:'bongocat',bytes:1,at:3},
    {id:'u',kind:'custom',bytes:1,at:4},
    {id:'old',bytes:1,at:5},
  ];
  const {root} = await mount(t,{ack:true,builds});
  const labels = Object.fromEntries([...root.querySelectorAll('.l2d-model-card')].map(card =>
    [card.dataset.id, card.querySelector('.l2d-card-kind')?.textContent ?? null]));
  assert.deepEqual(labels, {old:null,u:null,b:'BongoCat',l:'Live2D'});
});

test('the effects tab has six preview cards and saves the chosen style with its size', async t => {
  const {root, configCalls, guards} = await mount(t, {effects:true, appearanceValues:{emotionEffect:'flow'}});
  const cards = [...root.querySelectorAll('.l2d-effect-card')];
  const radios = cards.map(card => card.querySelector('input[type="radio"]'));
  assert.deepEqual(radios.map(input => input.value), ['native','kaomoji','orb','flow','bubbles','softglow']);
  assert.ok(cards.every(card => card.querySelector('.l2d-effect-preview[aria-hidden="true"]')));
  assert.equal(radios.find(input => input.checked).value, 'flow');
  assert.equal(root.querySelector('.l2d-version-corner'), null);
  cards[4].click();
  await tick();
  assert.deepEqual(configCalls, [{group:'figure', values:{'worlds.figure.emotionEffect':'bubbles','worlds.figure.emotionEffectSize':'medium'}}]);
  assert.equal(root.querySelector('.l2d-effect-card.selected input').value, 'bubbles');
  assert.equal(root.querySelector('.l2d-effects-status').textContent, '已保存');
  assert.equal(guards[0](), null);
  assert.deepEqual([...root.querySelectorAll('.l2d-effect-card')], cards);
});

test('effect size stays selected when switching to native and back', async t => {
  const {root, configCalls} = await mount(t, {effects:true, appearanceValues:{emotionEffect:'flow',emotionEffectSize:'large'}});
  const sizes = root.querySelector('.l2d-effect-sizes');
  const page = root.querySelector('.l2d-effects-page');
  const checkedSize = () => sizes.querySelector('input:checked').value;
  assert.equal(checkedSize(), 'large');
  sizes.querySelector('[value="small"]').click();
  await tick();
  assert.equal(page.dataset.effectSize, 'small');
  root.querySelector('[name="l2d-pet-effect"][value="native"]').click();
  await tick();
  assert.equal(sizes.disabled, true);
  sizes.querySelector('[value="large"]').click();
  assert.equal(checkedSize(), 'small');
  root.querySelector('[name="l2d-pet-effect"][value="orb"]').click();
  await tick();
  assert.equal(sizes.disabled, false);
  assert.equal(checkedSize(), 'small');
  assert.deepEqual(configCalls.map(call => call.values['worlds.figure.emotionEffectSize']), ['small','small','small']);
});

test('effect card selection rolls back after a failed save and can be retried', async t => {
  let fail = true;
  const {root, configCalls} = await mount(t, {effects:true, setConfig() {
    if (fail) throw Error('save failed');
  }});
  const orb = root.querySelector('input[value="orb"]');
  orb.click();
  await tick();
  assert.equal(root.querySelector('[name="l2d-pet-effect"]:checked').value, 'native');
  assert.match(root.querySelector('.l2d-effects-status').textContent, /保存失败/);
  fail = false;
  orb.click();
  await tick();
  assert.equal(root.querySelector('[name="l2d-pet-effect"]:checked').value, 'orb');
  assert.equal(configCalls.length, 2);
});

test('quick effect changes leave the latest style and size saved', async t => {
  let finishFirst;
  const firstSave = new Promise(resolve => { finishFirst = resolve; });
  const {root, configCalls} = await mount(t, {effects:true, setConfig(_group, values) {
    if (values['worlds.figure.emotionEffect'] === 'orb') return firstSave;
  }});
  root.querySelector('input[value="orb"]').click();
  root.querySelector('input[value="large"]').click();
  root.querySelector('input[value="flow"]').click();
  assert.equal(configCalls.length, 1);
  finishFirst();
  await tick();
  assert.deepEqual(configCalls.map(call => call.values['worlds.figure.emotionEffect']), ['orb', 'flow']);
  assert.deepEqual(configCalls.map(call => call.values['worlds.figure.emotionEffectSize']), ['medium', 'large']);
  assert.equal(root.querySelector('[name="l2d-pet-effect"]:checked').value, 'flow');
});

test('speech provider choices stay in the creation dialog and only saved services become cards', async t => {
  const initial = {
    selectedId: '', services: [], bodyReady: true,
    controls: {voiceEnabled: false, voiceMouthGain: 1, voiceLipSync: true, voiceVolume: 1},
  };
  const createdId = 'f58d0d7d-b2a9-4939-84bc-52c1e02f146c';
  const {root, dom, calls, button} = await mount(t, {
    voice: true,
    invoke(method, args) {
      if (method === 'voiceState') return initial;
      if (method === 'voiceSave') {
        const [, provider, name, profile] = args;
        return {...initial, selectedId: createdId, services: [{id: createdId, provider, name, profile, hasKey: false, ready: true}]};
      }
      if (method === 'voiceRemove') return initial;
    },
  });
  const cards = () => root.querySelectorAll('[data-service-id]');
  assert.equal(root.querySelector('.l2d-version-corner'), null);
  const controls = root.querySelector('.l2d-voice-controls');
  const enabled = controls.querySelector('[aria-label="朗读桌宠回复"]');
  assert.equal(cards().length, 0);
  assert.equal(root.querySelector('select[name="provider"]'), null);
  assert.equal(enabled.disabled, true);
  assert.equal(controls.querySelector('[aria-label="张嘴幅度"]').getAttribute('aria-valuetext'), '1.0×');

  button('添加语音服务').click();
  const create = root.querySelector('dialog[open]');
  const provider = create.querySelector('select[name="provider"]');
  assert.deepEqual([...provider.options].map(option => option.value).filter(Boolean).sort(), Object.keys(VOICE_PROVIDERS).sort());
  assert.equal(cards().length, 0);
  assert.equal(root.querySelector('.l2d-voice-controls'), controls);
  assert.equal(calls.some(call => call.method === 'voiceSave'), false);
  provider.value = 'edge';
  provider.dispatchEvent(new dom.window.Event('change', {bubbles: true}));
  const name = create.querySelector('input[name="name"]');
  name.value = '日常朗读';
  name.dispatchEvent(new dom.window.Event('input', {bubbles: true}));
  button('保存并使用').click();
  await tick();

  assert.equal(root.querySelector('dialog[open]'), null);
  assert.equal(cards().length, 1);
  assert.match(cards()[0].textContent, /日常朗读/);
  const saves = calls.filter(call => call.method === 'voiceSave');
  assert.equal(saves.length, 1);
  const [id, providerId, serviceName, profile, key, select] = saves[0].args;
  assert.deepEqual([id, providerId, serviceName, profile.voice, key, select], [null, 'edge', '日常朗读', 'zh-CN-XiaoxiaoNeural', '', true]);
  assert.equal(enabled.disabled, false);
  assert.equal(button('在桌宠试听').disabled, false);

  cards()[0].click();
  const edit = root.querySelector('dialog[open]');
  const editName = edit.querySelector('input[name="name"]');
  assert.equal(editName.value, '日常朗读');
  editName.value = '取消的编辑';
  editName.dispatchEvent(new dom.window.Event('input', {bubbles: true}));
  button('取消').click();
  await tick();
  assert.equal(root.querySelector('dialog[open]'), null);
  assert.match(cards()[0].textContent, /日常朗读/);
  assert.equal(calls.filter(call => call.method === 'voiceSave').length, 1);

  cards()[0].click();
  button('删除服务').click();
  assert.equal(root.querySelectorAll('dialog[open]').length, 1);
  assert.equal(cards().length, 1);
  assert.equal(calls.some(call => call.method === 'voiceRemove'), false);
  button('确认删除').click();
  await tick();
  assert.deepEqual(calls.filter(call => call.method === 'voiceRemove').map(call => call.args), [[createdId]]);
  assert.equal(root.querySelector('dialog[open]'), null);
  assert.equal(cards().length, 0);
  assert.equal(enabled.disabled, true);
});

test('narration timing defaults to fast and saves only the selected mode', async t => {
  const state = { selectedId: '', services: [], bodyReady: false, timingReady: true, controls: {} };
  const {root, dom, calls} = await mount(t, {
    voice: true,
    invoke(method, args) {
      if (method === 'voiceState') return state;
      if (method === 'voiceControls') return { ...state, controls: args[0] };
    },
  });
  const timing = root.querySelector('select[aria-label="朗读时机"]');
  assert.equal(timing.value, 'fast');
  assert.equal(timing.options[1].disabled, false);
  timing.value = 'sync';
  timing.dispatchEvent(new dom.window.Event('change', {bubbles: true}));
  await tick();
  assert.deepEqual(calls.filter(call => call.method === 'voiceControls').map(call => call.args), [[{voiceTiming: 'sync'}]]);
  assert.equal(timing.value, 'sync');
});

test('changing the synchronized speech tool refreshes the current session prefix', async t => {
  const state = { selectedId: 'v', services: [], bodyReady: true, timingReady: true,
    syncToolReady: false, controls: {voiceEnabled:true} };
  const requests = [];
  let refreshed = 0;
  const {root,dom} = await mount(t,{
    voice:true,
    fetch:async (url, options) => { requests.push([url.pathname, options.method]); return {ok:true}; },
    refresh:async () => { refreshed++; },
    invoke(method, args) {
      if (method === 'voiceState') return state;
      if (method === 'voiceControls') return {...state,syncToolReady:true,controls:{...state.controls,...args[0]}};
    },
  });
  const timing = root.querySelector('select[aria-label="朗读时机"]');
  timing.value = 'sync';
  timing.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  await tick();
  assert.deepEqual(requests,[['/api/session/reload-prefix','POST']]);
  assert.equal(refreshed,1);
});

test('a device without timing support preserves a saved sync preference and allows switching back', async t => {
  const state = { selectedId: '', services: [], bodyReady: false, timingReady: false, controls: {voiceTiming: 'sync'} };
  const {root, dom, calls} = await mount(t, {
    voice: true,
    invoke(method, args) {
      if (method === 'voiceState') return state;
      if (method === 'voiceControls') return { ...state, controls: args[0] };
    },
  });
  const timing = root.querySelector('select[aria-label="朗读时机"]');
  assert.equal(timing.value, 'sync');
  assert.equal(timing.options[1].disabled, true);
  assert.match(timing.closest('label').textContent, /当前设备使用快速播报，同步设置会保留/);
  assert.equal(calls.some(call => call.method === 'voiceControls'), false);
  timing.value = 'fast';
  timing.dispatchEvent(new dom.window.Event('change', {bubbles: true}));
  await tick();
  assert.deepEqual(calls.filter(call => call.method === 'voiceControls').map(call => call.args), [[{voiceTiming: 'fast'}]]);
  assert.equal(timing.value, 'fast');
});

test('preview resolution is saved independently from formal pack quality',async t=>{
 const {root,dom,configCalls}=await mount(t,{configuration:true,quality:'balanced'}),preview=root.querySelector('[aria-label="预览精度"]');
 assert.equal(preview.value,'1');assert.equal(preview.getAttribute('aria-valuetext'),'512 px');
 preview.value='0';preview.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await tick();
 assert.deepEqual(configCalls,[{group:'figure',values:{'worlds.figure.previewSize':'256'}}]);assert.equal(root.querySelector('[aria-label="画质"]').value,'1');
});

test('auto-save serializes rapid edits and keeps the latest selection', async t => {
  let release;
  const {root,dom,configCalls,guards} = await mount(t,{configuration:true,setConfig:()=>new Promise(r=>{release=r;})});
  const texture=root.querySelector('[aria-label="贴图精度"]');
  texture.value='1';texture.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  texture.value='3';texture.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  assert.match(guards[0](),/尚未保存/);assert.equal(configCalls.length,1);
  release();await tick();assert.equal(configCalls.length,2);
  assert.equal(configCalls[1].values['worlds.figure.texture'],'4096');
  release();await tick();assert.equal(guards[0](),null);
});
test('six themes and six particles preview independently and auto-save only the chosen preference',async t=>{
 const {root,configCalls}=await mount(t,{appearance:true});const themes=root.querySelector('[role=radiogroup][aria-label="主题配色"]'),particles=root.querySelector('[role=radiogroup][aria-label="粒子效果"]');
 assert.equal(root.querySelector('.l2d-version-corner'),null);
 assert.equal(themes.querySelectorAll('input').length,6);assert.equal(particles.querySelectorAll('input').length,6);assert.equal(themes.querySelector(':checked').value,'red');assert.equal(particles.querySelector(':checked').value,'stars');assert.equal(configCalls.length,0);
 themes.querySelector('[value=cyan]').click();await tick();assert.equal(root.querySelector('form').dataset.gearTheme,'cyan');assert.equal(root.querySelector('form').dataset.particleEffect,'stars');
 particles.querySelector('[value=meteors]').click();await tick();assert.deepEqual(configCalls.map(c=>c.values),[{'worlds.figure.gearTheme':'cyan'},{'worlds.figure.particleEffect':'meteors'}]);
});
test('appearance preferences persist and reopen while configuration and its quick popup stay focused',async t=>{
 const cfg={cover:true,quality:'original',texture:'original'};const opts={appearance:true,invoke:method=>method==='settings'?{...cfg}:undefined,setConfig:async(_group,patch)=>{for(const[key,value]of Object.entries(patch))cfg[key.replace('worlds.figure.','')]=value;}};
 const e=await mount(t,opts);e.root.querySelector('[name=l2d-uiMaterial][value=glass]').click();await tick();e.root.querySelector('[name=l2d-gearTheme][value=green]').click();await tick();e.root.querySelector('[name=l2d-particleEffect][value=glow]').click();await tick();
 assert.deepEqual(e.configCalls.map(c=>c.values),[{'worlds.figure.uiMaterial':'glass'},{'worlds.figure.gearTheme':'green'},{'worlds.figure.particleEffect':'glow'}]);
 const reopened=await mount(t,opts);assert.equal(reopened.root.querySelector('[value=glass]').checked,true);assert.equal(reopened.root.querySelector('[value=green]').checked,true);assert.equal(reopened.root.querySelector('[value=glow]').checked,true);
 const quick=await mount(t,{...opts,appearance:false,ack:true});quick.button('设置').click();await tick();assert.equal(quick.root.querySelector('[role=radiogroup]'),null);assert.equal(quick.root.querySelector('form').dataset.gearTheme,'green');assert.equal(quick.root.dataset.uiMaterial,'glass');
});
test('unknown appearance values fall back visually without writing a replacement configuration',async t=>{
 const e=await mount(t,{appearance:true,gearTheme:'bad',particleEffect:'bad',appearanceValues:{uiMode:'bad',uiCorners:'bad',uiMaterial:'bad',uiGlow:'bad'}});assert.equal(e.root.querySelector('form').dataset.gearTheme,'red');assert.equal(e.root.querySelector('form').dataset.particleEffect,'stars');assert.equal(e.root.dataset.uiMaterial,'matte');assert.equal(e.root.dataset.uiMode,'auto');assert.equal(e.configCalls.length,0);
});

test('appearance preview stays at maximum and saves serialized changes with retry and leave protection',async t=>{
 let fail=true;const e=await mount(t,{appearance:true,setConfig:async()=>{if(fail)throw Error('offline');}});
 assert.ok(e.root.querySelector('.l2d-preview-bar.is-max .l2d-gear-sparks'));assert.equal(e.root.querySelector('.l2d-preview-bar input'),null);assert.equal(e.root.querySelectorAll('.l2d-gear-input').length,0);
 e.root.querySelector('[name=l2d-uiMode][value=dark]').click();await tick();assert.equal(e.root.dataset.uiMode,'dark');assert.match(e.guards[0](),/尚未保存/);fail=false;e.button('重试保存').click();await tick();assert.equal(e.guards[0](),null);
 assert.deepEqual(e.configCalls[1].values,{'worlds.figure.uiMode':'dark'});e.handle.dispose();assert.equal(e.root.classList.contains('l2d-themed'),false);assert.equal(e.root.dataset.uiMode,undefined);assert.equal(e.root.style.getPropertyValue('--gear-max-fill'),'');
});

test('default preset restores pre-red styling while retaining every custom preference',async t=>{
 const cfg={gearTheme:'cyan',particleEffect:'meteors',uiMaterial:'metal',uiMode:'dark',uiCorners:'crisp',uiGlow:'vivid',uiButtonFill:'gradient'};
 const e=await mount(t,{appearance:true,appearanceValues:cfg});e.root.querySelector('[name=l2d-uiStyle][value=classic]').click();await tick();
 assert.equal(e.root.dataset.gearTheme,'purple');assert.equal(e.root.dataset.particleEffect,'stars');assert.equal(e.root.dataset.uiMode,'auto');assert.equal(e.root.dataset.uiGlow,'off');assert.equal(e.root.querySelector('[value=metal]').disabled,true);
 assert.deepEqual(e.configCalls[0].values,{'worlds.figure.uiStyle':'classic'});assert.equal(e.root.querySelector('[name=l2d-gearTheme][value=cyan]').checked,true);
 e.root.querySelector('[name=l2d-uiStyle][value=custom]').click();await tick();for(const[key,value]of Object.entries(cfg))assert.equal(e.root.dataset[key],value);assert.equal(e.root.querySelector('[value=metal]').disabled,false);
 assert.deepEqual(e.configCalls[1].values,{'worlds.figure.uiStyle':'custom'});
});

test('button fill is an independent saved preference',async t=>{
 const e=await mount(t,{appearance:true});e.root.querySelector('[name=l2d-uiButtonFill][value=solid]').click();await tick();
 assert.equal(e.root.dataset.uiButtonFill,'solid');assert.equal(e.root.dataset.gearTheme,'red');assert.deepEqual(e.configCalls[0].values,{'worlds.figure.uiButtonFill':'solid'});
 const reopened=await mount(t,{appearance:true,appearanceValues:{uiButtonFill:'solid'}});assert.equal(reopened.root.querySelector('[name=l2d-uiButtonFill][value=solid]').checked,true);
});

test('failed primary auto-save retains dirty values and retries without reverting controls',async t=>{
  let fail=true;
  const {root,dom,button,configCalls,guards}=await mount(t,{configuration:true,setConfig:async()=>{if(fail)throw Error('failed');}});
  const texture=root.querySelector('[aria-label="贴图精度"]');
  texture.value='0';texture.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await tick();
  assert.equal(texture.value,'0');assert.equal(texture.disabled,false);assert.match(guards[0](),/尚未保存/);
  fail=false;button('重试保存').click();await tick();
  assert.deepEqual(configCalls[1].values,{'worlds.figure.texture':'512'});assert.equal(guards[0](),null);
});

test('configuration folder selection uses the host picker and persists the chosen directory',async t=>{
  const picks=[];
  const {root,button,configCalls}=await mount(t,{configuration:true,pickPath:async options=>{picks.push(options);return 'E:/figures';}});
  button('选择').click();await tick();
  assert.deepEqual(picks,[{kind:'directory'}]);assert.equal(root.querySelector('[aria-label="安装目录"]').value,'E:/figures');
  assert.deepEqual(configCalls,[{group:'figure',values:{'worlds.figure.figuresDir':'E:/figures'}}]);
});

test('the version opens a bounded notice and restores focus after consent', async t => {
  const {root,button,calls}=await mount(t);
  const version=root.querySelector('.l2d-version-corner');
  assert.equal(version.textContent,'v1.4.2');
  assert(version.classList.contains('unack'));
  assert.equal(root.querySelector('dialog'),null);
  version.focus();version.click();
  assert.equal(root.querySelector('dialog.l2d-notice-popup').open,true);
  assert.equal(root.querySelector('.l2d-body dialog'),null);
  button('×').click();assert.equal(root.querySelector('dialog'),null);
  version.click();button('我已知晓，不再分发').click();await tick();
  assert(version.classList.contains('ack'));assert.equal(version.title,'查看须知');
  assert.equal(document.activeElement,version);assert.equal(root.querySelector('dialog'),null);
  version.click();assert.match(root.querySelector('dialog').textContent,/Cubism Core、Framework 和着色器/);
  assert.equal(button('我已知晓，不再分发').hidden,true);
  assert.equal(calls.filter(c=>c.method==='noticeAccept').length,1);
});

test('the compact Figure header keeps the same notice button when the host redraws the header', async t => {
  const {root, handle} = await mount(t, {providerHeader:true, version:'4.0.0'});
  const chrome = root.previousElementSibling;
  const version = chrome.querySelector('.l2d-version-corner');
  assert.equal(version.textContent, 'v4.0.0');
  assert.equal(root.querySelector('.l2d-version-corner'), null);
  const next = chrome.firstElementChild.cloneNode(false);
  next.append(chrome.querySelector('.pagetitle-row').cloneNode());
  chrome.replaceChildren(next);
  await tick();
  assert.equal(next.querySelector('.l2d-version-corner'), version);
  version.click();
  assert.equal(root.querySelector('dialog.l2d-notice-popup').open, true);
  handle.dispose();
  assert.equal(chrome.querySelector('.l2d-version-corner'), null);
});

test('an acknowledged upgrade shows no inline notice or core banner',async t=>{
  const {root,calls,handle}=await mount(t,{ack:true,version:'1.4.99',language:'en'});
  const badge=root.querySelector('.l2d-version-corner');
  assert.equal(badge.textContent,'v1.4.99');assert.equal(badge.parentElement,root.querySelector('.l2d-header'));
  assert.equal(root.querySelector('dialog,.l2d-license'),null);
  const entry=root.querySelector('.l2d-foot .l2d-notice-entry');
  assert.equal(entry.textContent,'Notice');entry.click();
  assert.equal(root.querySelector('dialog.l2d-notice-popup').open,true);
  assert.equal(calls.filter(c=>c.method==='noticeAccept').length,0);
  handle.dispose();assert.equal(root.childElementCount,0);
});

test('acknowledged users can fetch a missing Core in the popup without repeating consent',async t=>{
  const {root,button}=await mount(t,{ack:true,core:false});
  assert.match(root.querySelector('.l2d-status').textContent,/运行组件待获取/);
  assert.equal(root.querySelector('.l2d-license'),null);
  root.querySelector('.l2d-version-corner').click();
  assert.equal(button('同意并获取').hidden,false);
  assert.equal(button('我已知晓，不再分发').hidden,true);
});

test('an existing SDK consent automatically restores missing runtime files before packing',async t=>{
  const {root,button,calls,dom}=await mount(t,{
    ack:true,core:false,coreConsentAt:1,
    invoke(method){
      if(method==='importPaths')return {token:'sdk-cache',models:[{dir:'role',title:'角色',kind:'live2d'}],packs:[]};
      if(method==='coreRestore')return {ok:true,consentAt:1};
      if(method==='importBuild')return {buildId:'role',log:[]};
    },
  });
  paste(dom, root.querySelector('.l2d-drop-zone'), 'G:/models/role');
  await tick();
  button('一键打包').click();
  await tick();
  assert.deepEqual(calls.filter(call=>['coreRestore','coreAccept','importBuild'].includes(call.method)).map(call=>call.method),
    ['coreRestore','importBuild']);
  assert.equal(root.querySelector('dialog.l2d-notice-popup'),null);
});

test('settings save only changed fields through the host configuration contract', async t => {
  const {root,button,configCalls} = await mount(t,{ack:true});
  button('设置').click(); await tick();
  const clean=root.querySelector('input[aria-label="清理"]');
  assert.equal(clean.closest('label').textContent,'清理');
  const auto=root.querySelector('input[aria-label="安装后删除打包产物"]');
  auto.click(); button('保存设置').click(); await tick();
  assert.deepEqual(configCalls,[{group:'figure',values:{'worlds.figure.autoDelete':true}}]);
  assert.equal(root.querySelector('.l2d-settings'),null);
});

test('failed settings writes keep the form editable for retry', async t => {
  const {root,button,toasts} = await mount(t,{ack:true,setConfig:async()=>{throw Error('write failed');}});
  button('设置').click(); await tick();
  root.querySelector('input[aria-label="安装后删除打包产物"]').click();
  button('保存设置').click(); await tick();
  assert.ok(root.querySelector('.l2d-settings'));
  assert.equal(button('保存设置').disabled,false);
  assert.ok(toasts.some(([s])=>s==='write failed'));
});

test('settings gear sliders preserve texture and analysis values and save only explicit choices', async t => {
  const {root,button,configCalls,dom}=await mount(t,{ack:true});
  button('设置').click();await tick();
  const mode=root.querySelector('[aria-label="适配方式"]');mode.value='2';mode.dispatchEvent(new dom.window.Event('change'));
  const gear=root.querySelector('input[type="range"][aria-label="分析方式"]');
  const texture=root.querySelector('input[type="range"][aria-label="贴图精度"]');
  assert.equal(texture.value,'4');assert.equal(texture.getAttribute('aria-valuetext'),'原精度');
  assert.equal(gear.value,'1');assert.equal(gear.getAttribute('aria-valuetext'),'自动');
  for(const [index,title]of ['512 px','1024 px','2048 px','4096 px','原精度'].entries()){
    texture.value=String(index);texture.dispatchEvent(new dom.window.Event('input'));
    assert.equal(texture.getAttribute('aria-valuetext'),title);
    assert.equal(texture.closest('.l2d-gear').classList.contains('is-max'),index===4);
  }
  texture.value='3';texture.dispatchEvent(new dom.window.Event('change'));
  gear.value='2';gear.dispatchEvent(new dom.window.Event('change'));
  assert.equal(gear.getAttribute('aria-valuetext'),'文本＋图片');
  assert.equal(gear.closest('.l2d-gear').classList.contains('is-max'),true);
  button('保存设置').click();await tick();
  assert.deepEqual(configCalls,[{group:'figure',values:{'worlds.figure.adaptationMode':'ai','worlds.figure.texture':'4096','worlds.figure.assistGear':'image'}}]);
});

test('AI-enabled imports are submitted for analysis rather than silently dropping native actions',async t=>{
  const {root,dom,button,calls}=await mount(t,{ack:true,automation:{enabled:true,plans:[]},invoke:method=>method==='importPaths'?{token:'ai-source',models:[{dir:'role',title:'角色'}],packs:[]}:undefined});
  paste(dom,root.querySelector('.l2d-drop-zone'),'G:/models/role');await tick();
  button('提交 AI 适配').click();await tick();
  assert.deepEqual(calls.find(c=>c.method==='assistAnalyze').args,['ai-source',['role'],[]]);
  assert(!calls.some(c=>c.method==='importBuild'));
});

test('quality presets show effective texture limits and Original restores the remembered custom value',async t=>{
 const {root,dom,button,configCalls}=await mount(t,{ack:true,quality:'balanced'});button('设置').click();await tick();
 const quality=root.querySelector('[aria-label="画质"]'),texture=root.querySelector('[aria-label="贴图精度"]');
 assert.equal(quality.getAttribute('aria-valuetext'),'标准');assert.equal(texture.value,'2');assert.equal(texture.disabled,true);
 quality.value='3';quality.dispatchEvent(new dom.window.Event('change',{bubbles:true}));assert.equal(texture.value,'4');assert.equal(texture.disabled,false);
 texture.value='0';texture.dispatchEvent(new dom.window.Event('change',{bubbles:true}));assert.equal(quality.getAttribute('aria-valuetext'),'自定义');
 quality.value='2';quality.dispatchEvent(new dom.window.Event('change',{bubbles:true}));assert.equal(texture.value,'3');assert.equal(texture.disabled,true);
 quality.value='3';quality.dispatchEvent(new dom.window.Event('change',{bubbles:true}));assert.equal(texture.value,'0');
 button('保存设置').click();await tick();assert.deepEqual(configCalls[0].values,{'worlds.figure.quality':'original','worlds.figure.texture':'512'});
});

test('adaptation depth is enabled only with AI and text plus images and retains its selected tier',async t=>{
 const {root,dom,button,configCalls}=await mount(t,{ack:true});button('设置').click();await tick();
 const depth=root.querySelector('[aria-label="适配深度"]'),gear=root.querySelector('[aria-label="分析方式"]');
 assert.equal(depth.value,'1');assert.equal(depth.disabled,true);
 const mode=root.querySelector('[aria-label="适配方式"]');mode.value='2';mode.dispatchEvent(new root.ownerDocument.defaultView.Event('change'));assert.equal(depth.disabled,true);
 gear.value='2';gear.dispatchEvent(new dom.window.Event('change',{bubbles:true}));assert.equal(depth.disabled,false);
 depth.value='2';depth.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
 gear.value='0';gear.dispatchEvent(new dom.window.Event('change',{bubbles:true}));assert.equal(depth.disabled,true);
 assert.equal(depth.closest('.l2d-setting-row').classList.contains('inactive'),true);assert.equal(depth.value,'2');
 gear.value='2';gear.dispatchEvent(new dom.window.Event('change',{bubbles:true}));assert.equal(depth.disabled,false);assert.equal(depth.value,'2');
 button('保存设置').click();await tick();assert.equal(configCalls[0].values['worlds.figure.assistDepth'],'deep');
});

test('a pending AI proposal shows its mapping and approval acts only on that proposal',async t=>{
  const {root,button,calls}=await mount(t,{ack:true,automation:{enabled:true,plans:[{id:'pending',status:'pending',question:'方案确认',summary:[{source:'脸红',word:'shy',reason:'表情对应'}]}]}});
  assert.equal(root.querySelector('.l2d-operation .l2d-assist-dock'),null);
  button('进展与结果').click();
  assert.match(root.querySelector('dialog .l2d-assist-dock').textContent,/表现“害羞”时使用「脸红」/);
  button('同意安装').click();await tick();
  assert.deepEqual(calls.find(c=>c.method==='assistApprove').args,['pending']);
});

test('reading the notice preserves settings without a discard confirmation',async t=>{
 let confirms=0;
 const {root,button,drawers}=await mount(t,{ack:true,confirm:async()=>{confirms++;return false;}});button('设置').click();await tick();
 const gear=root.querySelector('[aria-label="分析方式"]');assert.equal(gear.disabled,true);
 const mode=root.querySelector('[aria-label="适配方式"]');mode.value='2';mode.dispatchEvent(new root.ownerDocument.defaultView.Event('change'));assert.equal(gear.disabled,false);
 const note=root.querySelector('.l2d-settings .l2d-notice-entry');note.click();await tick();
 const notice=root.querySelector('dialog.l2d-notice-popup');
 assert(notice.open);
 let hostEscapes=0;root.ownerDocument.addEventListener('keydown',()=>hostEscapes++);
 notice.dispatchEvent(new root.ownerDocument.defaultView.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
 assert.equal(hostEscapes,0);assert.equal(root.querySelector('dialog.l2d-notice-popup'),null);assert.equal(confirms,0);
 assert.equal(drawers.length,1);assert(root.querySelector('.l2d-settings'));
 assert.equal(root.querySelector('[aria-label="适配方式"]').value,'2');
 assert.match(root.querySelector('[aria-label="模型搜索目录"]').placeholder,/最近使用/);
});

test('multiple proposals, active tasks, and approved retry states remain visible together',async t=>{
 const {root,button,calls}=await mount(t,{ack:true,automation:{enabled:true,plans:[
  {id:'one',model:'一',status:'pending',question:'确认一'},
  {id:'two',model:'二',status:'approved',error:'磁盘暂不可用'},
  {id:'three',model:'三',status:'executing'},
 ]}});
 button('进展与结果').click();
 assert.equal(root.querySelectorAll('.l2d-assist-plan').length,3);
 assert.match(root.querySelector('.l2d-assist-dock').textContent,/安装中/);
 assert.match(root.querySelector('.l2d-assist-dock').textContent,/磁盘暂不可用/);
 button('重试安装').click();await tick();
 assert.deepEqual(calls.find(c=>c.method==='assistApprove').args,['two']);
});

test('queued imports show the wait state and disable duplicate submission',async t=>{
 const {root,dom,button,calls}=await mount(t,{ack:true,automation:{enabled:true,plans:[],submissions:[{token:'queued',waiting:['角色']}]},invoke:method=>method==='importPaths'?{token:'queued',models:[{dir:'role',title:'角色'}],packs:[]}:undefined});
 paste(dom,root.querySelector('.l2d-drop-zone'),'G:/models/role');await tick();
 button('进展与结果').click();
 assert.match(root.querySelector('.l2d-assist-dock').textContent,/等待方案/);
 assert.equal(button('提交 AI 适配').disabled,true);
 button('提交 AI 适配').click();assert(!calls.some(c=>c.method==='assistAnalyze'));
});

test('completed proposals use collapsed history while pending proposals stay directly accessible',async t=>{
 const {root,button}=await mount(t,{ack:true,automation:{enabled:true,plans:[{id:'done',model:'完成',status:'done'},{id:'todo',model:'等待',status:'pending',question:'确认安装'},{id:'auto',model:'自动',status:'pending',automatic:true}]}});
 button('进展与结果').click();
 const history=root.querySelector('.l2d-assist-history');assert(history);assert.equal(history.open,false);
 assert.match(history.textContent,/完成 · 已安装/);
 assert.equal(root.querySelectorAll('.l2d-assist-dock > .l2d-assist-plan').length,2);
 assert.equal(root.querySelectorAll('.l2d-assist-dock > .l2d-assist-plan button.primary').length,1);
 assert.equal(root.querySelector('.l2d-assist-dock > .l2d-assist-plan button.primary').textContent,'同意安装');
});

test('an eligible stalled import can resubmit analysis from the current workbench',async t=>{
 const {root,dom,button,calls}=await mount(t,{ack:true,automation:{enabled:true,plans:[],submissions:[{token:'retry',models:[{id:'m',title:'角色'}],waiting:['角色'],canRetry:true}]},invoke:method=>method==='importPaths'?{token:'retry',models:[{dir:'role',title:'角色'}],packs:[]}:undefined});
 const paste=new dom.window.Event('paste',{bubbles:true,cancelable:true});
 Object.defineProperty(paste,'clipboardData',{value:{files:[],getData:()=> 'E:\\models\\role'}});
 root.querySelector('.l2d-drop-zone').dispatchEvent(paste);await tick();await tick();
 assert.equal(button('重新提交分析').disabled,false);button('重新提交分析').click();await tick();
 assert.equal(calls.filter(c=>c.method==='assistAnalyze').length,1);
 assert.deepEqual(calls.find(c=>c.method==='assistAnalyze').args,['retry',['role'],[]]);
});

test('search and sorting preserve the pack list while editing opens a modal outside the grid', async t => {
  const {root,dom,button,calls}=await mount(t,{ack:true,builds:[{id:'a',nameZh:'Alpha',at:1,bytes:1},{id:'b',nameZh:'Beta',at:2,bytes:1}]});
  assert.equal(root.querySelector('.l2d-card').dataset.id,'b');
  const search=root.querySelector('.l2d-search');search.value='Alpha'; search.dispatchEvent(new dom.window.Event('input'));
  assert.equal(root.querySelectorAll('.l2d-card').length,1);
  const card=root.querySelector('.l2d-card');
  button('编辑').click();await tick();
  assert.equal(calls.find(c=>c.method==='detail').args[0],'a');
  assert.ok(root.querySelector('dialog.l2d-modal[open][aria-modal="true"]'));
  assert.equal(root.querySelector('.l2d-workspace .l2d-modal'), null);
  assert.equal(root.querySelector('.l2d-workspace').classList.contains('editing'), false);
  assert.equal(root.querySelector('.l2d-card'),card);
  button('取消').click();search.value='';search.dispatchEvent(new dom.window.Event('input'));
  assert.equal(root.querySelectorAll('.l2d-card').length,2);
});

test('pack cards explain adaptation without reusing the previous source report', async (t) => {
  const adaptation = { corrected: ['angleX'], limited: ['cheek', 'browAngle'], warnings: [] };
  const { root, toasts, dom } = await mount(t, {
    ack: true, builds: [{ id: 'a', bytes: 1, at: 1, adaptation }],
    invoke: m => m === 'state' ? { notice: { acknowledged: true }, version: 'test', scan: { adaptation } } : undefined,
  });
  const card=root.querySelector('.l2d-card');
  assert.equal(card.querySelector('details'),null);
  card.querySelector('.l2d-adaptation-link').click();
  const details=root.querySelector('dialog[open] .l2d-adaptation');
  assert.match(details.textContent,/左右转头/);
  assert.match(details.textContent,/独立控制受限.*脸红/);
  assert.match(details.textContent,/无需手动配置参数/);
  root.querySelector('dialog .l2d-modal-close').click();assert.equal(root.querySelector('.l2d-card'),card);
  assert.equal(toasts.length, 0);
  assert.equal(root.querySelector('.l2d-path'), null);
});

test('failed consent save leaves warning visible and permits retry', async (t) => {
  let fail = true;
  const { root, button } = await mount(t, { invoke: (m) => { if (m === 'noticeAccept' && fail) throw new Error('disk full'); } });
  root.querySelector('.l2d-version-corner').click();
  button('我已知晓，不再分发').click(); await tick();
  assert.equal(root.querySelector('.l2d-version-corner').textContent, 'v1.4.2');
  assert.ok(root.querySelector('.l2d-version-corner').classList.contains('unack'));
  assert.equal(root.querySelector('.l2d-version-corner').closest('.l2d-notice-dock'), null);
  assert.equal(button('我已知晓，不再分发').disabled, false);
  assert.match(root.querySelector('dialog .l2d-result-feedback').textContent,/disk full/);
  fail = false; button('我已知晓，不再分发').click(); await tick();
  assert.equal(root.querySelector('.l2d-version-corner').textContent, 'v1.4.2');
});

test('packing requires a source; installation of an existing card does not require a model path', async (t) => {
  const builds = [{ id: 'sample-1', packId: 'sample', nameZh: '名字', at: 1, bytes: 5 }];
  const { button, calls } = await mount(t, { builds });
  button('一键打包').click(); button('选择文件夹').click(); await tick();
  assert.equal(calls.some((c) => c.method === 'build'), false);
  assert.equal(document.querySelector('.l2d-modal'), null);
  button('安装').click();await tick();
  assert(document.querySelector('dialog.l2d-notice-popup').open);
  assert(!calls.some(c=>c.method==='install'));
  button('我已知晓，不再分发').click();await tick();
  assert.deepEqual(calls.filter(c=>c.method==='install').map(c=>c.args),[['','sample-1']]);
});

test('edit validates name, locks close while saving, clears about, and disposes overlays', async (t) => {
  let finish;
  const { button, handle, root, calls, dom } = await mount(t, {
    ack: true, builds: [{ id: 'a-1', at: 1, bytes: 5 }],
    invoke: (m) => m === 'edit' ? new Promise((r) => { finish = r; }) : undefined,
  });
  button('编辑').click(); await tick();
  const modal = document.querySelector('[role="dialog"]'); assert.ok(modal);
  const name = modal.querySelector('input'); name.value = '';
  button('保存').click(); await tick(); assert.equal(finish, undefined);
  name.value = '新名字'; modal.querySelector('textarea').value = '';
  button('保存').click(); await tick();
  button('取消').click(); assert.ok(document.querySelector('.l2d-modal'));
  modal.dispatchEvent(new dom.window.Event('cancel', {cancelable:true})); assert.equal(modal.open, true);
  button('×').click(); assert.equal(modal.open, true);
  assert.equal(button('选择文件夹').disabled, true);
  finish({}); await tick();
  assert.equal(document.querySelector('.l2d-modal'), null);
  assert.equal(calls.find((c) => c.method === 'edit').args[1].aboutZh, '');
  button('编辑').click(); await tick(); assert.ok(document.querySelector('dialog[open][aria-modal="true"]'));
  document.querySelector('.l2d-modal').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(document.querySelector('.l2d-modal'), null);
  button('编辑').click(); await tick(); handle.dispose();
  assert.equal(document.querySelector('.l2d-modal'), null);
  assert.equal(root.hasAttribute('aria-busy'), false);
});

test('editor close buttons and native cancellation discard without writing and restore focus', async t => {
  const {root,button,calls,dom}=await mount(t,{ack:true,builds:[{id:'a',nameZh:'Alpha',at:1,bytes:1}]});
  for(const action of ['cancel','close','native']){
    button('编辑').click();await tick();
    const modal=root.querySelector('dialog');modal.querySelector('input').value='Unsaved';
    if(action==='native')modal.dispatchEvent(new dom.window.Event('cancel',{cancelable:true}));
    else button(action==='cancel'?'取消':'×').click();
    assert.equal(root.querySelector('dialog'),null);
    assert.equal(dom.window.document.activeElement,button('编辑'));
  }
  assert.equal(calls.some(c=>c.method==='edit'),false);
});

test('framing edits share the bounded model dialog and save with the existing card', async t => {
  const {root,button,calls,dom}=await mount(t,{
    ack:true, builds:[{id:'a',nameZh:'Alpha',at:1,bytes:1}],
    invoke:method=>method==='detail' ? {
      nameZh:'Alpha',tunable:true,crop:{mode:'full',edge:'flat',line:.6,feather:.05,transition:.24},
      gaze:{enabled:true,speed:1},
    } : method==='cropPreview' ? {image:null} : undefined,
  });
  const card=root.querySelector('.l2d-card');
  button('编辑').click();
  await tick();
  const dialog=root.querySelector('dialog.l2d-crop-modal[open]');
  assert(dialog);
  assert.equal(calls.some(c=>c.method==='cropPreview'),false);
  const name=dialog.querySelector('#l2d-edit-name');
  name.value='保留草稿';
  button('取景').click();
  await tick();
  assert.equal(root.querySelectorAll('dialog[open]').length,1);
  assert.equal(root.querySelector('.l2d-card'),card);
  assert.equal(button('圆口').disabled,true);
  const curve=dialog.querySelector('#l2d-crop-curve');
  assert.equal(curve.disabled,true);
  button('上半身').click();
  assert.equal(curve.disabled,true);
  button('圆口').click();
  assert.equal(curve.disabled,false);
  assert.equal(curve.getAttribute('aria-valuetext'),'100%');
  curve.value='.5';
  curve.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  assert.equal(curve.getAttribute('aria-valuetext'),'50%');
  const line=dialog.querySelector('#l2d-crop-line');
  line.value='.58';
  line.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  assert.equal(line.getAttribute('aria-valuetext'),'58%');
  const navigate = key => dialog.querySelector('[role="tab"][aria-selected="true"]')
    .dispatchEvent(new dom.window.KeyboardEvent('keydown', {key, bubbles:true}));
  navigate('ArrowRight');
  assert.equal(button('视线').getAttribute('aria-selected'),'true');
  navigate('ArrowRight');
  assert.equal(button('信息').getAttribute('aria-selected'),'true');
  assert.equal(name.value,'保留草稿');
  button('取景').click();
  await tick();
  assert.deepEqual(calls.filter(c=>c.method==='cropPreview').map(c=>c.args),[['a']]);
  assert.equal(calls.some(c=>c.method==='edit'),false);
  button('保存').click();
  await tick();
  assert.deepEqual(calls.find(c=>c.method==='edit').args,['a',{
    nameZh:'保留草稿',crop:{mode:'upper',edge:'round',line:.58,curve:.5,feather:.05,transition:.24},
  }]);
});

test('the model gaze tab saves only changed settings and remembers speed while disabled', async t => {
  let gaze = {enabled:true,speed:1};
  const {root,button,calls,dom}=await mount(t,{
    ack:true, builds:[{id:'a',nameZh:'Alpha',at:1,bytes:1}],
    invoke(method, args) {
      if (method==='detail') return {nameZh:'Alpha',tunable:true,gaze};
      if (method==='edit') gaze = args[1].gaze;
    },
  });
  const open = async () => {
    button('编辑').click();
    await tick();
    button('视线').click();
    const pane = root.querySelector('[role="tabpanel"]:not([hidden])');
    return [pane.querySelector('[role="switch"]'),pane.querySelector('input[type="range"]')];
  };
  let [follow,speed]=await open();
  assert.equal(follow.checked,true);
  assert.equal(speed.disabled,false);
  assert.equal(speed.value,'1');
  speed.value='1.35';
  speed.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  assert.equal(speed.getAttribute('aria-valuetext'),'1.35×');
  follow.click();
  assert.equal(speed.disabled,true);
  assert.equal(speed.value,'1.35');
  button('保存').click();
  await tick();
  assert.deepEqual(calls.filter(c=>c.method==='edit').map(c=>c.args),[['a',{gaze:{enabled:false,speed:1.35}}]]);
  [follow,speed]=await open();
  assert.equal(follow.checked,false);
  assert.equal(speed.disabled,true);
  assert.equal(speed.value,'1.35');
  follow.click();
  assert.equal(speed.disabled,false);
  assert.equal(speed.value,'1.35');
  button('取消').click();
  assert.equal(calls.filter(c=>c.method==='edit').length,1);
  assert.equal(root.querySelectorAll('.l2d-card').length,1);
});

test('folder and ZIP selection are owned by the Coo browser window without the backend path picker', async (t) => {
  const { root, button } = await mount(t, {
    ack: true,
    pickPath: async () => { throw new Error('must not use the backend picker'); },
  });
  assert.deepEqual([...root.querySelectorAll('.l2d-toolbar button')].map(b => b.textContent), ['选择文件夹', '选择 ZIP', '设置']);
  assert.equal(root.querySelector('.l2d-operation .l2d-import-controls button').textContent, '一键打包');
  assert.equal(root.querySelector('.l2d-path'), null);
  assert.equal(button('扫描'), undefined);
  assert.equal(button('一键打包').disabled, true);
  const folder = root.querySelector('input[webkitdirectory]');
  const zip = root.querySelector('input[accept=".zip,application/zip"]');
  assert.equal(folder.webkitdirectory, true);
  const opened = [];
  folder.addEventListener('click', event => { event.preventDefault(); opened.push('folder'); });
  zip.addEventListener('click', event => { event.preventDefault(); opened.push('zip'); });
  button('选择文件夹').click(); button('选择 ZIP').click();
  assert.deepEqual(opened, ['folder', 'zip']);
});

test('choosing a folder retains relative paths and imports the model with its sibling resources', async (t) => {
  const { root, calls, dom, button } = await mount(t, {
    ack: true,
    invoke: method => method === 'importBegin' ? { token: 'folder' } : method === 'importFinish' ? { token: 'folder', models: [{ dir: 'role', title: '角色' }], packs: [] } : undefined,
  });
  const input = root.querySelector('input[webkitdirectory]');
  const files = ['role/role.model3.json', 'role/role.moc3', 'role/textures/texture.png'].map(path => ({
    name: path.split('/').at(-1), webkitRelativePath: path, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  }));
  Object.defineProperty(input, 'files', { value: files });
  input.dispatchEvent(new dom.window.Event('change')); await tick();
  assert.deepEqual(calls.find(call => call.method === 'importAppend').args[1].map(file => file.path), files.map(file => file.webkitRelativePath));
  assert.deepEqual(calls.find(call => call.method === 'importFinish').args, ['folder', true]);
  assert.equal(button('一键打包').disabled, false);
  assert.equal(calls.some(call => call.method === 'importBuild'), false);
});

function paste(dom, zone, text = '', files = []) {
  const event = new dom.window.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { getData: type => type === 'text/plain' ? text : '', files } });
  zone.dispatchEvent(event);
}

test('pasting native copied folders is local and never starts packing or installation', async (t) => {
  const { root, calls, dom } = await mount(t, {
    ack: true,
    invoke: method => method === 'clipboard' ? { paths: ['G:/models/role'] } : method === 'importPaths' ? { token: 'paste', models: [{ dir: 'role', title: '角色' }], packs: [] } : undefined,
  });
  const zone = root.querySelector('.l2d-drop-zone'); zone.click();
  assert.equal(document.activeElement, zone);
  paste(dom, zone); await tick();
  assert.deepEqual(calls.find(c => c.method === 'importPaths').args, [['G:/models/role']]);
  assert.equal(calls.some(c => ['build', 'importBuild', 'install', 'importInstall'].includes(c.method)), false);
});

test('one-click packing retries only failed models and keeps completed packs', async (t) => {
  let attempts = 0;
  const { root, button, calls, dom } = await mount(t, {
    ack: true,
    invoke: (method, args) => {
      if (method === 'importPaths') return { token: 'batch', models: [{ dir: 'one', title: '一' }, { dir: 'two', title: '二' }], packs: [] };
      if (method === 'importBuild' && args[1] === 'two' && attempts++ === 0) throw new Error('try again');
      if (method === 'importBuild') return { buildId: args[1], log: [] };
    },
  });
  paste(dom, root.querySelector('.l2d-drop-zone'), '"G:/models"'); await tick();
  button('一键打包').click(); await tick();
  assert.match(root.querySelector('.l2d-source-hint').textContent, /1 项失败/);
  button('一键打包').click(); await tick();
  assert.deepEqual(calls.filter(c => c.method === 'importBuild').map(c => c.args[1]), ['one', 'two', 'two']);
  assert.equal(calls.some(c => c.method === 'install'), false);
  assert.equal(button('一键打包').disabled, true);
});

test('failed imports keep the error visible and cannot package a stale selection', async (t) => {
  const { root, button, dom } = await mount(t, { ack: true, invoke: method => { if (method === 'importPaths') throw new Error('目录不存在'); } });
  paste(dom, root.querySelector('.l2d-drop-zone'), 'G:/missing'); await tick();
  assert.match(root.querySelector('.l2d-source-hint').textContent, /目录不存在/);
  assert.equal(button('一键打包').disabled, true);
});

test('dropping a ZIP recognizes it without opening an import dialog', async (t) => {
  const { root, calls, dom, button } = await mount(t, {
    ack: true,
    invoke: method => method === 'importStage' ? { token: 'zip', models: [{ dir: 'role', title: '角色' }], packs: [] } : undefined,
  });
  const event = new dom.window.Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { getData: () => '', items: [], files: [{ name: 'role.zip', arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }] } });
  root.querySelector('.l2d-drop-zone').dispatchEvent(event); await tick();
  assert.deepEqual(calls.find(c => c.method === 'importStage').args, ['AQID', 'zip']);
  assert.equal(root.querySelector('[role="dialog"]'), null);
  assert.equal(button('一键打包').disabled, false);
});

test('non-Live2D pack metadata can be saved without sending unsupported performance settings', async t => {
  const {root,button,calls} = await mount(t,{ack:true,builds:[{id:'frames',at:1,bytes:5}],invoke:method=>method==='detail'?{nameZh:'图像形象',tunable:false}:undefined});
  button('编辑').click();await tick();
  const modal=root.querySelector('[role="dialog"]');assert(modal);
  assert.equal(modal.querySelector('input[type="range"]').closest('.l2d-field').hidden,true);
  modal.querySelector('input').value='新名字';
  button('保存').click();await tick();
  const patch=calls.find(call=>call.method==='edit').args[1];
  assert.equal('bodyGain' in patch,false);assert.equal('style' in patch,false);
});

test('a successful installation is not reported as failed when the result list cannot refresh',async t=>{
  let lists=0;
  const {button,toasts}=await mount(t,{ack:true,builds:[{id:'draft',at:1,bytes:5}],invoke:method=>{
    if(method==='install')return {log:[]};
    if(method==='list'&&lists++>0)throw Error('temporary read failure');
  }});
  button('安装').click();await tick();
  assert(toasts.some(([message,tone])=>message==='安装 ✓'&&tone==='ok'));
  assert(!toasts.some(([message])=>message==='安装 ✗'));
});

test('a reopened panel reflects a running backend action until it actually finishes',async t=>{
  let busy=true,poll,cleared=false;
  const {root,button}=await mount(t,{ack:true,interval:fn=>{poll=fn;return{dispose(){cleared=true;}};},invoke:method=>method==='state'?{notice:{acknowledged:true},version:'1.4.5',busy,steps:{build:{phase:busy?'loading':'done'}}}:undefined});
  assert.equal(button('选择文件夹').disabled,true);assert.equal(root.getAttribute('aria-busy'),'true');
  busy=false;await poll();
  assert.equal(button('选择文件夹').disabled,false);assert.equal(root.getAttribute('aria-busy'),'false');assert.equal(cleared,true);
});

test('workbench reloads its cards and host tabs after the extension restarts',async t=>{
  let listAttempts=0,retry,refreshed=0;
  const {root,button}=await mount(t,{
    ack:true,builds:[{id:'old',nameZh:'原来的卡片'}],
    timeout:fn=>{retry=fn;return{dispose(){}};},
    refresh:async()=>{refreshed++;},
    invoke:method=>{
      if(method==='list'&&listAttempts++===0)throw Error('Error: 扩展正在停止');
    },
  });
  assert.equal(root.querySelector('.l2d-count').textContent,'—');
  assert.match(root.querySelector('.l2d-status').textContent,/等待扩展恢复/);
  assert.equal(button('选择文件夹').disabled,true);
  retry();await tick();
  assert.equal(root.querySelector('.l2d-count').textContent,'1');
  assert.match(root.querySelector('.l2d-card').textContent,/原来的卡片/);
  assert.equal(button('选择文件夹').disabled,false);
  assert.equal(refreshed,1);
});

test('leaving the workbench cancels its pending startup retry',async t=>{
  let retry,cleared=false;
  const {calls,handle}=await mount(t,{
    timeout:fn=>{retry=fn;return{dispose(){cleared=true;}};},
    invoke:method=>{if(method==='state')throw Object.assign(Error('Service Unavailable'),{status:503});},
  });
  const before=calls.length;
  handle.dispose();
  assert.equal(cleared,true);
  retry();await tick();
  assert.equal(calls.length,before);
});

test('large individual textures are split into bounded requests while preserving relative paths',async t=>{
  const {root,calls,dom}=await mount(t,{ack:true,invoke:method=>method==='importBegin'?{token:'chunks'}:method==='importFinish'?{token:'chunks',models:[{dir:'role',title:'角色'}],packs:[]}:undefined});
  const length=5*1048576;
  const files=[{name:'role.model3.json',webkitRelativePath:'role/role.model3.json',size:2,arrayBuffer:async()=>new TextEncoder().encode('{}').buffer},{name:'texture.png',webkitRelativePath:'role/textures/texture.png',size:length,slice:(start,end)=>({arrayBuffer:async()=>new Uint8Array(Math.min(end,length)-start).buffer})}];
  const input=root.querySelector('input[webkitdirectory]');Object.defineProperty(input,'files',{value:files});
  input.dispatchEvent(new dom.window.Event('change'));
  for(let i=0;i<70&&!calls.some(call=>call.method==='importFinish');i++)await tick();
  const chunks=calls.filter(call=>call.method==='importAppendChunk').map(call=>call.args[1]);
  assert.deepEqual(chunks.map(chunk=>chunk.offset),[0,2*1048576,4*1048576]);
  assert(chunks.every(chunk=>chunk.path==='role/textures/texture.png'&&chunk.b64.length<=3*1048576));
  assert(calls.some(call=>call.method==='importFinish'));
});

test('leaving during folder reads stops subsequent transfer and cancels only that import token',async t=>{
  let finish;
  const {root,calls,dom,handle}=await mount(t,{ack:true,invoke:method=>method==='importBegin'?{token:'owned'}:undefined});
  const file={name:'role.model3.json',webkitRelativePath:'role/role.model3.json',arrayBuffer:()=>new Promise(resolve=>{finish=resolve;})};
  const input=root.querySelector('input[webkitdirectory]');Object.defineProperty(input,'files',{value:[file]});
  input.dispatchEvent(new dom.window.Event('change'));await tick();handle.dispose();finish(new Uint8Array([1]).buffer);await tick();
  assert(!calls.some(call=>call.method==='importAppend'||call.method==='importFinish'));
  assert(calls.some(call=>call.method==='importCancel'&&call.args[0]==='owned'));
});

test('manual mode disables AI options while retaining depth and analysis selections',async t=>{
 const {root,dom,button,configCalls}=await mount(t,{ack:true});button('设置').click();await tick();
 const mode=root.querySelector('[aria-label="适配方式"]'),gear=root.querySelector('[aria-label="分析方式"]'),depth=root.querySelector('[aria-label="适配深度"]'),automatic=root.querySelector('[aria-label="自动安装"]');
 const change=(input,value)=>{input.value=value;input.dispatchEvent(new dom.window.Event('change',{bubbles:true}));};
 change(mode,'2');change(gear,'2');change(depth,'2');assert.equal(depth.disabled,false);
 change(mode,'1');assert.equal(gear.disabled,true);assert.equal(depth.disabled,true);assert.equal(automatic.disabled,true);assert.equal(depth.value,'2');
 change(mode,'0');change(mode,'2');assert.equal(gear.value,'2');assert.equal(depth.value,'2');assert.equal(depth.disabled,false);
 change(mode,'1');button('保存设置').click();await tick();assert.equal(configCalls[0].values['worlds.figure.adaptationMode'],'manual');assert(!('worlds.figure.assistMotions' in configCalls[0].values));
});

test('manual actions sit above the unchanged install/edit/delete row',async t=>{
 const {root}=await mount(t,{ack:true,builds:[{id:'editable',at:1,bytes:1024,manualAvailable:true}]});
 const card=root.querySelector('.l2d-card');assert.equal(card.querySelector(':scope > .l2d-card-binding').textContent,'动作');
 assert.deepEqual([...card.querySelectorAll('.l2d-card-actions button')].map(b=>b.textContent),['安装','编辑','删除']);
 assert.equal(card.querySelector('.l2d-card-binding').nextElementSibling.className,'l2d-card-actions');
});
