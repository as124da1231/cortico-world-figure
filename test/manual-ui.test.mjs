import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const combination=(await readFile(new URL('../workbench/pack/backends/native-combination.js',import.meta.url),'utf8')).replace(/^export /gm,'');
const source=combination+'\n'+(await readFile(new URL('../workbench/pack/backends/wardrobe-slots.js',import.meta.url),'utf8')).replace(/^\uFEFF/,'').replace(/^export /gm,'')+'\n'+await readFile(new URL('../src/webui/manual.js',import.meta.url),'utf8');
async function editor(t,fail=false,opts={}){
 const dom=new JSDOM('<main></main>',{runScripts:'outside-only',url:'http://localhost/'}),w=dom.window,doc=w.document;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const schedule=w.setTimeout.bind(w);w.setTimeout=(fn,ms,...args)=>schedule(fn,ms===160?0:ms,...args);w.structuredClone=structuredClone;w.eval(source+';window.openEditor=openBindingEditor;');t.after(()=>dom.window.close());
 const ac=new w.AbortController(),calls=[],notifications=[],toasts=[];let hostConfirms=0;
 const data={token:'test',title:'Example',words:{expressions:['happy'],motions:[]},bindings:[],resources:[{id:'smile',kind:'expression',classification:'expression',title:'Smile'}]};
 if(opts.existing)data.buildId='pack';
 if(opts.upgrade)data.wardrobeNeedsSave=true;
 if(opts.previewSize)data.previewSize=opts.previewSize;
 if(opts.resources)data.resources=opts.resources;if(opts.wardrobe)data.wardrobe=opts.wardrobe;
 if(opts.nativeMotionMode)data.nativeMotionMode=true;
 const ctx={root:doc.querySelector('main'),language:'zh',signal:ac.signal,notifyOnUnmount:(...args)=>notifications.push(args),guardLeave:()=>({dispose(){}}),frame:()=>({dispose(){}}),ui:{toast:(...args)=>toasts.push(args),confirm:async()=>{hostConfirms++;throw Error('Host confirmation must not be used');}},invoke:async(method,args)=>{calls.push({method,args:structuredClone(args)});if(method==='manualPreview'){if(opts.preview)return opts.preview(args);return {frames:[{kind:'generic',png:'data:image/png;base64,aGVsbG8='}],quality:{textureLimit:256,canvas:[256,256],maskSize:256}};}if(method==='manualSave'&&opts.save)return opts.save(args);if(method==='manualOpenBuild'){if(fail)throw Error('编辑已过期，请重新打开');return data;}return {};}};
 if(opts.progress){const invoke=ctx.invoke;ctx.invoke=async(method,args)=>method==='manualSaveProgress'?opts.progress():invoke(method,args);}
 const handle=await w.openEditor(ctx,'manualOpenBuild',['pack'],opts.onSaved||(async()=>{}));t.after(()=>handle.dispose());
 const modal=doc.querySelector('.l2d-bind-modal'),gallery=doc.querySelector('.l2d-bind-gallery');const settle=()=>new Promise(r=>setTimeout(r,10));await settle();assert(!doc.querySelector('iframe'));
 const button=text=>[...doc.querySelectorAll('button')].find(b=>b.textContent===text);
 const dirty=async()=>{doc.querySelector('.l2d-bind-effect-check').click();await settle();};
 return {w,doc,modal,handle,button,dirty,calls,ac,notifications,toasts,gallery,settle,hostConfirms:()=>hostConfirms};
}
test('dirty close paths share one in-dialog confirmation; keeping edits and discarding both work',async t=>{
 for(const path of ['×','取消','Escape','backdrop'])await t.test(path,async t=>{
  const e=await editor(t);await e.dirty();const close=()=>path==='Escape'?e.modal.dispatchEvent(new e.w.Event('cancel',{cancelable:true})):path==='backdrop'?e.modal.click():e.button(path).click();
  close();close();close();assert.equal(e.doc.querySelectorAll('.l2d-bind-discard').length,1);assert(e.modal.contains(e.doc.querySelector('.l2d-bind-discard')));assert.equal(e.hostConfirms(),0);
  e.button('继续编辑').click();await Promise.resolve();assert(e.modal.open);assert.match(e.doc.querySelector('.l2d-bind-summary').textContent,/1 项绑定/);
  close();e.button('放弃修改').click();await Promise.resolve();assert.equal(e.doc.querySelector('.l2d-bind-modal'),null);assert(e.calls.some(c=>c.method==='manualClose'));assert(!e.calls.some(c=>c.method==='manualSave'));
 });
});

test('existing cards require a real change; reset all is confirmed, reversible and draft-only',async t=>{
 const e=await editor(t,false,{existing:true});assert(e.button('保存绑定').disabled);await e.dirty();assert(!e.button('保存绑定').disabled);
 e.button('全部恢复通用').click();e.button('保留绑定').click();await Promise.resolve();assert.match(e.doc.querySelector('.l2d-bind-summary').textContent,/1 项绑定/);
 e.button('全部恢复通用').click();e.button('全部恢复').click();await Promise.resolve();assert.match(e.doc.querySelector('.l2d-bind-summary').textContent,/0 项绑定/);assert(e.button('保存绑定').disabled);assert(!e.calls.some(c=>c.method==='manualSave'));assert.equal(e.doc.querySelectorAll('.l2d-bind-resource').length,1);
});
test('saving locks binding mutations and a committed save survives list refresh errors',async t=>{
 let finish;const e=await editor(t,false,{save:()=>new Promise(r=>finish=r),progress:()=>({stage:'images'}),onSaved:async()=>{throw Error('refresh failed');}});await e.dirty();e.button('保存绑定').click();assert(e.doc.querySelector('.l2d-bind-layout').inert);assert(e.button('恢复通用').disabled);e.button('恢复通用').onclick();assert.match(e.doc.querySelector('.l2d-bind-summary').textContent,/1 项绑定/);
 await e.settle();
 const progress=e.doc.querySelector('[role=progressbar]');
 assert(!progress.hidden);assert.equal(progress.getAttribute('aria-valuenow'),'2');
 assert.match(e.doc.querySelector('.l2d-bind-save-status').textContent,/处理预览图片.*3\/4/);
 assert(e.button('保存中…').disabled);
 finish({buildId:'pack'});await new Promise(r=>setTimeout(r,5));assert(!e.doc.querySelector('dialog'));assert.equal(e.calls.filter(c=>c.method==='manualSave').length,1);assert(e.toasts.some(([s])=>s.includes('绑定已保存，模型包列表刷新失败')));
});
test('save progress continues after a temporary status request failure', async t => {
 const stages = ['pack', Error('temporary disconnect'), 'images'];
 let finish;
 const e = await editor(t, false, {
   save: () => new Promise(resolve => { finish = resolve; }),
   progress: () => { const stage = stages.shift(); if (stage instanceof Error) throw stage; return { stage }; },
 });
 await e.dirty();
 e.button('保存绑定').click();
 const progress = e.doc.querySelector('[role=progressbar]');
 await e.settle();
 assert.equal(progress.getAttribute('aria-valuenow'), '1');
 for (let attempt = 0; attempt < 30 && progress.getAttribute('aria-valuenow') !== '2'; attempt++) {
   await new Promise(resolve => setTimeout(resolve, 50));
 }
 assert.equal(progress.getAttribute('aria-valuenow'), '2');
 finish({buildId:'pack'});
 await e.settle();
 assert(!e.doc.querySelector('dialog'));
});

test('new group is found beside the wardrobe list and the dialog creates a draft in that group',async t=>{
 const e=await editor(t,false,{existing:true});
 const entry=e.doc.querySelector('.l2d-bind-left .l2d-bind-newgroup');
 assert(entry.closest('.l2d-wardrobe-tools').hidden);
 e.doc.querySelector('[role=tab]:last-child').click();
 assert(!entry.closest('.l2d-wardrobe-tools').hidden);
 entry.focus();entry.click();
 const popup=e.modal.querySelector('.l2d-group-modal');
 const [name,english]=popup.querySelectorAll('input');
 const submit=popup.querySelector('[type=submit]');
 assert.equal(e.doc.activeElement,name);
 assert(submit.disabled);
 name.value='   ';name.dispatchEvent(new e.w.Event('input'));assert(submit.disabled);
 name.value=' 发型 ';name.dispatchEvent(new e.w.Event('input'));english.value='Hair';
 assert(!submit.disabled);submit.click();await e.settle();
 assert(!e.modal.querySelector('.l2d-group-modal'));
 assert.equal(e.doc.querySelector('.l2d-bind-group.selected .l2d-wardrobe-group-name').textContent,'发型');
 assert.equal(e.doc.querySelector('.l2d-wardrobe-destination').textContent,'发型 · 新选项');
 assert.equal(e.doc.activeElement,entry);
 assert(!e.calls.some(c=>c.method==='manualSave'));
});
test('animation-only playback is saved per motion and resolves an overlap without changing wardrobe',async t=>{
 const resources=[
  {id:'move',title:'原生动作',kind:'motion',classification:'gesture',seconds:2,channels:['Parameter:Hat']},
  {id:'hat',title:'帽子',kind:'expression',classification:'appearance',seconds:1,channels:['Parameter:Hat']},
 ];
 const wardrobe=[{id:'lookhat',name:'配饰',options:[{id:'hat',name:'戴帽子',resource:'hat'}]}];
 const e=await editor(t,false,{existing:true,resources,wardrobe,nativeMotionMode:true});
 e.doc.querySelector('[data-audition="move"]').click();
 assert(e.button('使用此动作').classList.contains('primary'));
 assert.equal(e.doc.querySelector('.l2d-motion-state').textContent,'待绑定');
 e.button('使用此动作').click();
 assert.match(e.doc.querySelector('.l2d-combination-warning').textContent,/完全使用动画/);
 const select=e.doc.querySelector('.l2d-motion-mode select');
 select.value='native';select.dispatchEvent(new e.w.Event('change'));
 await e.settle();
 assert(e.button('保存绑定').disabled);
 assert.equal(e.calls.findLast(c=>c.method==='manualPreview').args[1].nativeOnly,true);
 e.button('使用此动作').click();
 await e.settle();
 assert.equal(e.doc.querySelector('.l2d-motion-state.is-bound').textContent,'已绑定');
 assert.equal(e.doc.activeElement,e.doc.querySelector('.l2d-combination-title'));
 assert.equal(e.doc.querySelector('.l2d-motion-mode select').value,'native');
 e.button('保存绑定').click();
 await e.settle();
 const save=e.calls.find(c=>c.method==='manualSave');
 assert.equal(save.args[1][0].nativeOnly,true);
 assert.equal(save.args[2].find(g=>g.id==='lookhat').options[0].resource,'hat');
});
test('preview failures preserve drafts and retry without an iframe or host modification',async t=>{
 let fail=false;const e=await editor(t,false,{preview:()=>{if(fail)throw Error('renderer lost');return {frames:[{kind:'generic',png:'data:image/png;base64,aGVsbG8='}]};}});await e.dirty();fail=true;e.button('重新取样').click();await e.settle();assert(!e.button('保存绑定').disabled);assert.match(e.doc.querySelector('.l2d-bind-status').textContent,/renderer lost/);
 fail=false;e.button('重试预览').click();await e.settle();assert(!e.button('保存绑定').disabled);assert.match(e.doc.querySelector('.l2d-bind-summary').textContent,/1 项绑定/);
});
test('enlarging a comparison does not close or change the binding editor',async t=>{
 const e=await editor(t);const shot=e.gallery.querySelector('.l2d-bind-shot-button');
 shot.focus();shot.click();
 const viewer=e.modal.querySelector('dialog.l2d-image-popup');
 assert(viewer.open);assert.equal(viewer.querySelector('img').src,shot.querySelector('img').src);
 viewer.dispatchEvent(new e.w.Event('cancel',{bubbles:true,cancelable:true}));
 assert(e.modal.open);assert(!e.modal.querySelector('dialog'));assert.equal(e.doc.activeElement,shot);
});
test('unmount registers independent close notifications and does not invoke with an aborted signal',async t=>{
 const e=await editor(t);assert(e.notifications.some(([method,args])=>method==='manualClose'&&args[0]==='test'));e.ac.abort();await Promise.resolve();assert(!e.doc.querySelector('dialog'));assert(!e.calls.some(c=>c.method==='manualClose'));
});
test('actions and wardrobe share one preview and save together; group defaults keep option mappings',async t=>{
 const e=await editor(t,false,{existing:true,resources:[{id:'smile',kind:'expression',classification:'expression',title:'Smile',channels:['Parameter:Smile']},{id:'coat',kind:'expression',classification:'appearance',title:'冬装',channels:['Parameter:Coat']}]});await e.dirty();const gallery=e.gallery;
 e.doc.querySelector('[role=tab]:last-child').click();assert.deepEqual([...e.doc.querySelectorAll('.l2d-wardrobe-group-name')].map(b=>b.textContent),['装扮','部件','配饰']);assert(!e.button('添加分组'));assert(!e.doc.querySelector('[aria-label="装扮组名称"]'));
 [...e.doc.querySelectorAll('.l2d-bind-resource')].find(b=>b.textContent.includes('冬装')).click();await e.settle();e.button('添加选项').click();await e.settle();assert.equal(e.gallery,gallery);assert.match(e.doc.querySelector('.l2d-bind-summary').textContent,/外观 1\/3 栏/);
 e.button('恢复默认外观').click();assert.equal(e.doc.querySelectorAll('.l2d-bind-group').length,3);assert.equal(e.doc.querySelectorAll('[aria-label="装扮：冬装"]').length,1);
 e.doc.querySelector('[role=tab]').click();await e.settle();assert(e.button('开心待保存'));e.button('保存绑定').click();await new Promise(r=>setTimeout(r,5));const save=e.calls.find(c=>c.method==='manualSave');assert.equal(save.args[1][0].resource,'smile');assert.equal(save.args[2][0].options[0].resource,'coat');assert.equal(e.calls.filter(c=>c.method==='manualOpenBuild').length,1);
});
test('confirmation Escape preserves edits; panel disposal removes a pending confirmation',async t=>{
 const e=await editor(t);await e.dirty();e.button('取消').click();const event=new e.w.Event('cancel',{bubbles:true,cancelable:true});e.doc.querySelector('.l2d-bind-discard').dispatchEvent(event);await Promise.resolve();assert(e.modal.open);assert(!e.doc.querySelector('.l2d-bind-discard'));
 e.button('×').click();e.ac.abort();await Promise.resolve();assert(!e.doc.querySelector('dialog'));assert.equal(e.hostConfirms(),0);
});
test('wardrobe preview and save need no grounding switch',async t=>{
 const e=await editor(t,false,{resources:[{id:'egg',kind:'expression',classification:'appearance',title:'蛋',channels:['Parameter:Egg']}]});e.doc.querySelector('[role=tab]:last-child').click();e.doc.querySelector('.l2d-bind-resource').click();await e.settle();
 assert.equal(e.doc.querySelector('.l2d-bind-modal [role="switch"]'),null);
 assert.deepEqual(e.calls.findLast(c=>c.method==='manualPreview').args[1].groups[0].options[0],{id:'preview',name:'蛋',resource:'egg'});
 e.button('添加选项').click();await e.settle();e.button('保存绑定').click();await new Promise(r=>setTimeout(r,5));const option=e.calls.find(c=>c.method==='manualSave').args[2][0].options[0];
 assert.equal(option.resource,'egg');assert.equal(Object.hasOwn(option,'ground'),false);
});
test('previewing a candidate in a full wardrobe group stays within runtime limits and does not change its draft',async t=>{
 const e=await editor(t,false,{resources:[{id:'coat',kind:'expression',classification:'appearance',title:'冬装',channels:['Parameter:Coat']}],wardrobe:[{id:'lookcoat',name:'服装',options:Array.from({length:16},(_,i)=>({id:'v'+i,name:'衣服'+i,resource:'coat'}))}]});
 e.doc.querySelector('[role=tab]:last-child').click();e.doc.querySelector('.l2d-bind-resource').click();await e.settle();
 const preview=e.calls.findLast(c=>c.method==='manualPreview').args[1];assert.equal(preview.groups[0].options.length,16);assert.equal(preview.picks.lookcoat,'preview');assert.equal(e.doc.querySelectorAll('.l2d-wardrobe-option').length,17);
});
test('clean and expired editors can close without a discard prompt',async t=>{
 for(const fail of [false,true]){const e=await editor(t,fail);e.button('取消').click();await Promise.resolve();assert(!e.doc.querySelector('dialog'));assert.equal(e.hostConfirms(),0);}
});
test('legacy normalization can be saved without treating an untouched editor as an unsaved draft',async t=>{
 const e=await editor(t,false,{existing:true,upgrade:true,wardrobe:[{id:'looklegacy',name:'眼镜',options:[]}]});assert(!e.button('保存绑定').disabled);e.button('取消').click();await Promise.resolve();assert(!e.doc.querySelector('dialog'));assert(!e.calls.some(c=>c.method==='manualSave'));
});

test('late images cannot replace the current choice or recreate a closed editor',async t=>{
 let hold=false;const pending=[],image=kind=>({frames:[{kind,png:'data:image/png;base64,aGVsbG8='}]});
 const e=await editor(t,false,{preview:args=>hold?new Promise(resolve=>pending.push({args,resolve})):image('generic')});hold=true;
 e.doc.querySelector('.l2d-bind-resource').click();await e.settle();e.button('完整效果').click();await e.settle();assert.equal(pending.length,2);
 pending[1].resolve(image('native'));await e.settle();assert.equal(e.gallery.querySelector('figcaption').textContent,'原生效果');
 pending[0].resolve(image('combined'));await e.settle();assert.equal(e.gallery.querySelector('figcaption').textContent,'原生效果');
 e.button('重新取样').click();await e.settle();e.button('取消').click();await e.settle();pending[2].resolve(image('combined'));await e.settle();assert(!e.doc.querySelector('dialog,img'));
});

test('finishing a screenshot preserves an option name being typed',async t=>{
 let hold=false,finish;const image={frames:[{kind:'appearance',png:'data:image/png;base64,aGVsbG8='}]};
 const e=await editor(t,false,{resources:[{id:'coat',kind:'expression',classification:'appearance',title:'冬装',channels:['Parameter:Coat']}],preview:()=>hold?new Promise(resolve=>finish=resolve):image});
 e.doc.querySelector('[role=tab]:last-child').click();await e.settle();hold=true;e.doc.querySelector('.l2d-bind-resource').click();await e.settle();
 const name=e.doc.querySelector('[aria-label="装扮选项名称"]');name.value='我命名的装扮';name.dispatchEvent(new e.w.Event('input'));finish(image);await e.settle();assert.equal(e.doc.querySelector('[aria-label="装扮选项名称"]').value,'我命名的装扮');assert(!e.button('添加选项').disabled);
});

test('preview resolution can change without changing bindings or the saved pack',async t=>{
 const e=await editor(t,false,{existing:true,previewSize:512}),select=e.doc.querySelector('[aria-label="预览精度"]');
 assert.equal(select.value,'1024');
 assert.deepEqual([...select.options].map(o=>o.textContent),['1024 px','2048 px','无上限']);
 for(const size of [2048,'unlimited',1024]){
   select.value=String(size);select.dispatchEvent(new e.w.Event('change'));await e.settle();
   assert.equal(e.calls.findLast(c=>c.method==='manualPreview').args[1].previewSize,size);
   assert(e.gallery.querySelector('img'));assert(e.button('保存绑定').disabled);
 }
 assert(!e.calls.some(c=>c.method==='manualSave'));assert.equal(e.calls.filter(c=>c.method==='manualOpenBuild').length,1);
});

test('switching the wardrobe group keeps independent picks and shows one editor',async t=>{
 const resources=['A','B','C'].map(id=>({id,kind:'expression',classification:'appearance',title:id,channels:['Parameter:'+id]})),e=await editor(t,false,{resources});e.doc.querySelector('[role=tab]:last-child').click();await e.settle();
 for(let i=0;i<3;i++){e.doc.querySelectorAll('.l2d-bind-group')[i].click();await e.settle();[...e.doc.querySelectorAll('.l2d-bind-resource')].find(b=>b.querySelector('span').textContent===resources[i].id).click();await e.settle();e.button('添加选项').click();await e.settle();}
 const picks=()=>[...e.doc.querySelectorAll('.l2d-wardrobe-group-pick')].map(node=>node.textContent);
 assert.deepEqual(picks(),['A','B','C']);
 e.doc.querySelectorAll('.l2d-bind-group')[1].click();
 await e.settle();
 assert.equal(e.doc.querySelectorAll('.l2d-bind-group[aria-pressed=true]').length,1);
 assert.equal(e.doc.querySelector('.l2d-wardrobe-options').getAttribute('aria-label'),'部件选项');
 assert.equal(e.doc.querySelector('.l2d-wardrobe-option[aria-pressed=true]').getAttribute('aria-label'),'部件：B');
 assert.equal(e.doc.querySelector('.l2d-wardrobe-destination').textContent,'部件 · 编辑「B」');
 assert.deepEqual(picks(),['A','B','C']);
 e.doc.querySelector('.l2d-wardrobe-add').click();
 await e.settle();
 assert.equal(e.doc.querySelector('.l2d-wardrobe-destination').textContent,'部件 · 新选项');
 assert.deepEqual(picks(),['A','B','C']);
 e.button('恢复默认外观').click();
 assert.deepEqual(picks(),['默认','默认','默认']);
 assert.equal(e.doc.querySelectorAll('.l2d-wardrobe-option').length,2);
 assert(e.doc.querySelector('[aria-label="部件：B"]'));
});

test('multi-select is a draft, audition never mutates it, and removing one effect preserves the other',async t=>{
 const resources=[{id:'loading',kind:'expression',classification:'expression',title:'加载',channels:['Parameter:key8'],parameters:[{id:'key8',value:1,blend:'Add'}]},{id:'eyes',kind:'expression',classification:'expression',title:'圈圈眼',channels:['Parameter:key3'],parameters:[{id:'key3',value:1,blend:'Add'}]}];
 const e=await editor(t,false,{existing:true,resources});
 e.doc.querySelectorAll('.l2d-bind-resource')[0].click();await e.settle();assert(e.button('保存绑定').disabled);
 e.doc.querySelector('[data-resource="loading"]').click();e.doc.querySelector('[data-resource="eyes"]').click();await e.settle();
 const last=e.calls.filter(c=>c.method==='manualPreview').at(-1).args[1];assert.equal(last.resource,'loading');assert.deepEqual(last.overlays,['eyes']);
 assert.equal(e.doc.querySelectorAll('.l2d-combination-chips button').length,2);
 e.doc.querySelectorAll('.l2d-bind-resource')[1].click();await e.settle();assert.equal(e.doc.querySelectorAll('.l2d-bind-effect-check:checked').length,2);
 e.doc.querySelector('[aria-label="移除 加载"]').click();await e.settle();
 e.button('保存绑定').click();await e.settle();const saved=e.calls.find(c=>c.method==='manualSave').args[1];assert.equal(saved[0].resource,'eyes');assert.equal(saved[0].overlays,undefined);
});

test('conflicting selection preserves the draft until explicit replacement; wardrobe page retains it',async t=>{
 const resources=[['closed',0],['open',1],['alsoClosed',0]].map(([id,value])=>({id,title:id,kind:'expression',classification:'expression',channels:['Parameter:Eye'],parameters:[{id:'Eye',value,blend:'Overwrite'}]}));
 const e=await editor(t,false,{existing:true,resources});
 const row=id=>e.doc.querySelector(`[data-audition="${id}"]`);
 const marker=id=>row(id).querySelector('.l2d-bind-constraint')?.textContent;
 assert.equal(marker('open'),undefined);
 e.doc.querySelector('[data-resource="closed"]').click();
 assert.equal(marker('open'),'参数冲突');
 assert.equal(marker('alsoClosed'),undefined);
 assert.equal(row('alsoClosed').querySelector('.l2d-bind-overlap').textContent,'参数重叠');
 assert.equal(e.doc.querySelector('[data-resource="alsoClosed"]').disabled,false);
 assert.match(row('open').title,/closed.*Eye/);
 row('open').click();
 assert.equal(marker('open'),'参数冲突');
 assert.equal(e.doc.querySelector('[data-resource="open"]').checked,false);
 e.doc.querySelector('[data-resource="open"]').click();await e.settle();
 assert.match(e.doc.querySelector('.l2d-combination-warning').textContent,/冲突/);
 assert.deepEqual([...e.doc.querySelectorAll('.l2d-bind-effect-check:checked')].map(n=>n.dataset.resource),['closed']);
 e.button('替换冲突项').click();await e.settle();assert.deepEqual([...e.doc.querySelectorAll('.l2d-bind-effect-check:checked')].map(n=>n.dataset.resource),['open']);
 assert.equal(marker('open'),undefined);
 assert.equal(marker('closed'),'参数冲突');
 e.doc.querySelector('[role=tab]:last-child').click();e.doc.querySelector('[role=tab]').click();await e.settle();
 assert(e.doc.querySelector('[data-resource="open"]').checked);e.button('保存绑定').click();await e.settle();assert.equal(e.calls.find(c=>c.method==='manualSave').args[1][0].resource,'open');
});

test('an outfit conflict marks the expression row and blocks binding while keeping audition available',async t=>{
 const resources=[
  {id:'prop',kind:'expression',classification:'appearance',title:'配饰',channels:['Parameter:Prop']},
  {id:'effect',kind:'expression',classification:'expression',title:'表情',channels:['Parameter:Prop']},
 ];
 const wardrobe=[{id:'props',name:'配饰',options:[{id:'on',name:'戴上',resource:'prop'}]}];
 const e=await editor(t,false,{existing:true,resources,wardrobe});
 const row=e.doc.querySelector('[data-audition="effect"]');
 assert.equal(row.querySelector('.l2d-bind-constraint').textContent,'装扮冲突');
 assert(e.doc.querySelector('[data-resource="effect"]').disabled);
 row.click();await e.settle();
 assert.equal(e.calls.findLast(c=>c.method==='manualPreview').args[1].resource,'effect');
 assert(e.button('保存绑定').disabled);
});
