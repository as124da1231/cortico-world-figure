import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import panel from '../dist/webui.js';

const tick = () => new Promise((r) => setTimeout(r, 15));
async function mount(t, opts = {}) {
  const dom = new JSDOM('<main></main>', { url: 'http://localhost/' });
  globalThis.window = dom.window; globalThis.document = dom.window.document;
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
      if (method === 'core') return { ok: opts.core ?? true, version: 'Cubism 5.3' };
      if (method === 'noticeAccept') { ack = true; return { acknowledged: true, revision: 1 }; }
      if (method === 'list') return { dir: '', figuresDir: 'E:/test/figures', builds: opts.builds ?? [], installed: null, automation: opts.automation ?? {enabled:false,plans:[]} };
      if (method === 'detail') return { nameZh: '名字', aboutZh: '简介' };
      if (method === 'settings') return { cover: true, clean: true, texture: 'original', autoDelete: false, figuresDir: '' };
      return { builds: opts.builds ?? [] };
    },
  };
  const handle = await (opts.configuration ? panel.configuration : panel.panels.workbench).mount(ctx);
  t.after(() => { handle.dispose(); dom.window.close(); });
  await tick();
  const button = (label) => [...document.querySelectorAll('button')].find((b) => b.textContent === label);
  return { ctx, root, calls, configCalls, toasts, drawers, button, handle, dom, guards };
}

test('primary configuration uses the shared gear form and auto-saves only changed fields', async t => {
  const {root,dom,configCalls,guards} = await mount(t,{configuration:true});
  assert.equal(root.querySelectorAll('.l2d-gear-input').length,2);
  assert.equal(root.querySelector('.l2d-config-notice').open,false);
  assert.equal(root.querySelector('.l2d-version-corner').textContent,'v1.4.2');
  const texture=root.querySelector('[aria-label="贴图精度"]');
  texture.value='2';texture.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await tick();
  assert.deepEqual(configCalls,[{group:'figure',values:{'worlds.figure.texture':'2048'}}]);
  assert.equal(guards[0](),null);
  assert.equal(root.querySelector('.l2d-settings-status').textContent,'已保存');
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

test('consent persists while the version offers a quiet manual notice fallback on standard hosts', async (t) => {
  const { root, button, calls, drawers } = await mount(t);
  assert.equal(root.querySelector('details').open, true);
  let badge = root.querySelector('.l2d-version-corner');
  assert.equal(badge.textContent, 'v1.4.2'); assert.equal(badge.tagName, 'BUTTON');
  assert.ok(badge.classList.contains('unack'));
  badge.click(); assert.equal(root.querySelector('details').open, false);
  badge.click(); assert.equal(root.querySelector('details').open, true);
  assert.equal(badge.closest('.l2d-notice-dock'), null);
  button('我已知晓，不再分发').click(); await tick();
  badge = root.querySelector('.l2d-version-corner');
  assert.equal(badge.textContent, 'v1.4.2');
  assert.ok(badge.classList.contains('ack'));
  assert.equal(badge.classList.contains('unack'), false);
  assert.equal(badge.parentElement, root.querySelector('.l2d-header'));
  assert.equal(root.querySelector('.l2d-notice-dock'), null);
  assert.equal(badge.tagName, 'BUTTON');
  assert.equal(badge.title, '查看须知');
  assert.equal(document.activeElement, root.querySelector('.l2d-drop-zone'));
  assert.equal(root.querySelector('.l2d-notice'), null);
  badge.click(); assert.equal(root.querySelector('.l2d-notice'), null);
  assert.equal(drawers.length, 1);
  assert.match(drawers[0][1].textContent, /Live2D Cubism Core/);
  assert.equal(calls.filter((c) => c.method === 'noticeAccept').length, 1);
});

test('acknowledged users see only the version across upgrades, without the notice or ready-Core banner', async (t) => {
  const { root, calls, drawers } = await mount(t, { ack: true, version: '1.4.99', language: 'en' });
  assert.equal(drawers.length, 0);
  assert.equal(root.querySelector('.l2d-version-corner').textContent, 'v1.4.99');
  assert.equal(root.querySelector('.l2d-version-corner').parentElement, root.querySelector('.l2d-header'));
  assert.equal(root.querySelector('.l2d-notice'), null);
  root.querySelector('.l2d-version-corner').click();
  assert.equal(root.querySelector('.l2d-notice'), null);
  assert.equal(calls.filter((c) => c.method === 'noticeAccept').length, 0);
  assert.equal(document.querySelectorAll('.l2d-license').length, 0);
});

test('acknowledged users can still fetch a missing Core without redisplaying the distribution notice', async (t) => {
  const { root, button } = await mount(t, { ack: true, core: false });
  assert.equal(root.querySelector('.l2d-notice'), null);
  assert.ok(root.querySelector('.l2d-notice-top > .l2d-license'));
  assert.equal(button('同意并获取').hidden, false);
});

test('notice lives in the workbench footer and opens only on demand after agreement', async t => {
  const {root, drawers, handle} = await mount(t, {ack:true});
  assert.equal(panel.panels['config-notice'], undefined);
  const entry=root.querySelector('.l2d-foot .l2d-notice-entry');
  assert.equal(entry.textContent,'须知'); assert.equal(entry.hidden,false);
  assert.equal(drawers.length,0); entry.click();
  assert.equal(drawers.length,1); assert.match(drawers[0][1].textContent,/Live2D Cubism Core/);
  handle.dispose(); assert.equal(root.childElementCount,0);
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
  root.querySelector('input[aria-label="交给 Coo 适配"]').click();
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
  assert.deepEqual(configCalls,[{group:'figure',values:{'worlds.figure.assistMotions':true,'worlds.figure.texture':'4096','worlds.figure.assistGear':'image'}}]);
});

test('AI-enabled imports are submitted for analysis rather than silently dropping native actions',async t=>{
  const {root,dom,button,calls}=await mount(t,{ack:true,automation:{enabled:true,plans:[]},invoke:method=>method==='importPaths'?{token:'ai-source',models:[{dir:'role',title:'角色'}],packs:[]}:undefined});
  paste(dom,root.querySelector('.l2d-drop-zone'),'G:/models/role');await tick();
  button('提交 AI 适配').click();await tick();
  assert.deepEqual(calls.find(c=>c.method==='assistAnalyze').args,['ai-source',['role'],[]]);
  assert(!calls.some(c=>c.method==='importBuild'));
});

test('a pending AI proposal shows its mapping and approval acts only on that proposal',async t=>{
  const {root,button,calls}=await mount(t,{ack:true,automation:{enabled:true,plans:[{id:'pending',status:'pending',question:'方案确认',summary:[{source:'脸红',word:'shy',reason:'表情对应'}]}]}});
  assert.match(root.querySelector('.l2d-assist-dock').textContent,/表现“害羞”时使用「脸红」/);
  button('同意安装').click();await tick();
  assert.deepEqual(calls.find(c=>c.method==='assistApprove').args,['pending']);
});

test('AI controls follow the master switch and opening notice protects unsaved settings',async t=>{
 const {root,button,drawers}=await mount(t,{ack:true,confirm:async()=>false});button('设置').click();await tick();
 const gear=root.querySelector('[aria-label="分析方式"]');assert.equal(gear.disabled,true);
 root.querySelector('[aria-label="交给 Coo 适配"]').click();assert.equal(gear.disabled,false);
 // Refusing the discard must keep the form and its selected value.
 const note=root.querySelector('.l2d-settings .l2d-notice-entry');note.click();await tick();
 assert.equal(drawers.length,1);assert(root.querySelector('.l2d-settings'));
 assert.equal(root.querySelector('[aria-label="交给 Coo 适配"]').checked,true);
 assert.match(root.querySelector('[aria-label="模型搜索目录"]').placeholder,/最近使用/);
});

test('multiple proposals, active tasks, and approved retry states remain visible together',async t=>{
 const {root,button,calls}=await mount(t,{ack:true,automation:{enabled:true,plans:[
  {id:'one',model:'一',status:'pending',question:'确认一'},
  {id:'two',model:'二',status:'approved',error:'磁盘暂不可用'},
  {id:'three',model:'三',status:'executing'},
 ]}});
 assert.equal(root.querySelectorAll('.l2d-assist-plan').length,3);
 assert.match(root.querySelector('.l2d-assist-dock').textContent,/安装中/);
 assert.match(root.querySelector('.l2d-assist-dock').textContent,/磁盘暂不可用/);
 button('重试安装').click();await tick();
 assert.deepEqual(calls.find(c=>c.method==='assistApprove').args,['two']);
});

test('queued imports show the wait state and disable duplicate submission',async t=>{
 const {root,dom,button,calls}=await mount(t,{ack:true,automation:{enabled:true,plans:[],submissions:[{token:'queued',waiting:['角色']}]},invoke:method=>method==='importPaths'?{token:'queued',models:[{dir:'role',title:'角色'}],packs:[]}:undefined});
 paste(dom,root.querySelector('.l2d-drop-zone'),'G:/models/role');await tick();
 assert.match(root.querySelector('.l2d-assist-dock').textContent,/等待方案/);
 assert.equal(button('提交 AI 适配').disabled,true);
 button('提交 AI 适配').click();assert(!calls.some(c=>c.method==='assistAnalyze'));
});

test('completed proposals use collapsed history while pending proposals stay directly accessible',async t=>{
 const {root}=await mount(t,{ack:true,automation:{enabled:true,plans:[{id:'done',model:'完成',status:'done'},{id:'todo',model:'等待',status:'pending',question:'确认安装'}]}});
 const history=root.querySelector('.l2d-assist-history');assert(history);assert.equal(history.open,false);
 assert.match(history.textContent,/完成 · 已安装/);
 assert.equal(root.querySelectorAll('.l2d-assist-dock > .l2d-assist-plan').length,1);
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
  const details = root.querySelectorAll('.l2d-adaptation');
  assert.equal(details.length, 1);
  assert.equal(details[0].open, false);
  assert.match(details[0].textContent, /左右转头/);
  assert.match(details[0].textContent, /独立控制受限.*脸红/);
  assert.match(details[0].textContent, /无需手动配置参数/);
  assert.equal(toasts.length, 0);
  assert.equal(root.querySelector('.l2d-path'), null);
});

test('failed consent save leaves warning visible and permits retry', async (t) => {
  let fail = true;
  const { root, button } = await mount(t, { invoke: (m) => { if (m === 'noticeAccept' && fail) throw new Error('disk full'); } });
  button('我已知晓，不再分发').click(); await tick();
  assert.equal(root.querySelector('.l2d-version-corner').textContent, 'v1.4.2');
  assert.ok(root.querySelector('.l2d-version-corner').classList.contains('unack'));
  assert.equal(root.querySelector('.l2d-version-corner').closest('.l2d-notice-dock'), null);
  assert.equal(button('我已知晓，不再分发').disabled, false);
  fail = false; button('我已知晓，不再分发').click(); await tick();
  assert.equal(root.querySelector('.l2d-version-corner').textContent, 'v1.4.2');
});

test('packing requires a source; installation of an existing card does not require a model path', async (t) => {
  const builds = [{ id: 'sample-1', packId: 'sample', nameZh: '名字', at: 1, bytes: 5 }];
  const { button, calls } = await mount(t, { builds });
  button('一键打包').click(); button('选择文件夹').click(); await tick();
  assert.equal(calls.some((c) => c.method === 'build'), false);
  assert.equal(document.querySelector('.l2d-modal'), null);
  button('我已知晓，不再分发').click(); await tick();
  button('安装').click(); await tick();
  assert.deepEqual(calls.find((c) => c.method === 'install').args, ['', 'sample-1']);
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
    assert.equal(dom.window.document.activeElement,root.querySelector('.l2d-card .title'));
  }
  assert.equal(calls.some(c=>c.method==='edit'),false);
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
