import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const source=await readFile(new URL('../src/webui/manual.js',import.meta.url),'utf8');
async function editor(t,fail=false,opts={}){
 const dom=new JSDOM('<main></main>',{runScripts:'outside-only',url:'http://localhost/'}),w=dom.window,doc=w.document;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.structuredClone=structuredClone;w.eval(source+';window.openEditor=openBindingEditor;');t.after(()=>dom.window.close());
 const ac=new w.AbortController(),calls=[],notifications=[],toasts=[];let hostConfirms=0;
 const data={token:'test',title:'Example',preview:{url:'about:blank',entry:'http://localhost/pack.js',base:'http://localhost/'},words:{expressions:['happy'],motions:[]},bindings:[],resources:[{id:'smile',kind:'expression',classification:'expression',title:'Smile'}]};
 if(opts.existing)data.buildId='pack';
 const ctx={root:doc.querySelector('main'),language:'zh',signal:ac.signal,notifyOnUnmount:(...args)=>notifications.push(args),guardLeave:()=>({dispose(){}}),frame:()=>({dispose(){}}),ui:{toast:(...args)=>toasts.push(args),confirm:async()=>{hostConfirms++;throw Error('Host confirmation must not be used');}},invoke:async(method,args)=>{calls.push({method,args:structuredClone(args)});if(method==='manualSave'&&opts.save)return opts.save(args);if(method==='manualOpenBuild'){if(fail)throw Error('编辑已过期，请重新打开');return data;}return {};}};
 const handle=await w.openEditor(ctx,'manualOpenBuild',['pack'],opts.onSaved||(async()=>{}));t.after(()=>handle.dispose());
 const modal=doc.querySelector('.l2d-bind-modal'),frame=doc.querySelector('iframe');
 if(!fail)w.dispatchEvent(new w.MessageEvent('message',{source:frame.contentWindow,data:{t:'ready'}}));
 const button=text=>[...doc.querySelectorAll('button')].find(b=>b.textContent===text);
 const dirty=()=>{doc.querySelector('.l2d-bind-resource').click();button('绑定到「开心」').click();};
 return {w,doc,modal,handle,button,dirty,calls,ac,notifications,toasts,frame,hostConfirms:()=>hostConfirms};
}
test('dirty close paths share one in-dialog confirmation; keeping edits and discarding both work',async t=>{
 for(const path of ['×','取消','Escape','backdrop'])await t.test(path,async t=>{
  const e=await editor(t);e.dirty();const close=()=>path==='Escape'?e.modal.dispatchEvent(new e.w.Event('cancel',{cancelable:true})):path==='backdrop'?e.modal.click():e.button(path).click();
  close();close();close();assert.equal(e.doc.querySelectorAll('.l2d-bind-discard').length,1);assert(e.modal.contains(e.doc.querySelector('.l2d-bind-discard')));assert.equal(e.hostConfirms(),0);
  e.button('继续编辑').click();await Promise.resolve();assert(e.modal.open);assert.match(e.doc.querySelector('.l2d-bind-summary').textContent,/1 项绑定/);
  close();e.button('放弃修改').click();await Promise.resolve();assert.equal(e.doc.querySelector('.l2d-bind-modal'),null);assert(e.calls.some(c=>c.method==='manualClose'));assert(!e.calls.some(c=>c.method==='manualSave'));
 });
});

test('existing cards require a real change; reset all is confirmed, reversible and draft-only',async t=>{
 const e=await editor(t,false,{existing:true});assert(e.button('保存绑定').disabled);e.dirty();assert(!e.button('保存绑定').disabled);
 e.button('全部恢复通用').click();e.button('保留绑定').click();await Promise.resolve();assert.match(e.doc.querySelector('.l2d-bind-summary').textContent,/1 项绑定/);
 e.button('全部恢复通用').click();e.button('全部恢复').click();await Promise.resolve();assert.match(e.doc.querySelector('.l2d-bind-summary').textContent,/0 项绑定/);assert(e.button('保存绑定').disabled);assert(!e.calls.some(c=>c.method==='manualSave'));assert.equal(e.doc.querySelectorAll('.l2d-bind-resource').length,1);
});
test('saving locks binding mutations and a committed save survives list refresh errors',async t=>{
 let finish;const e=await editor(t,false,{save:()=>new Promise(r=>finish=r),onSaved:async()=>{throw Error('refresh failed');}});e.dirty();e.button('保存绑定').click();assert(e.doc.querySelector('.l2d-bind-layout').inert);assert(e.button('恢复通用').disabled);e.button('恢复通用').onclick();assert.match(e.doc.querySelector('.l2d-bind-summary').textContent,/1 项绑定/);
 finish({buildId:'pack'});await new Promise(r=>setTimeout(r,5));assert(!e.doc.querySelector('dialog'));assert.equal(e.calls.filter(c=>c.method==='manualSave').length,1);assert(e.toasts.some(([s])=>s.includes('绑定已保存，模型包列表刷新失败')));
});
test('preview errors disable edits and save, preserve the error and can retry with the same draft',async t=>{
 const e=await editor(t);e.dirty();e.w.dispatchEvent(new e.w.MessageEvent('message',{source:e.frame.contentWindow,data:{t:'error',message:'renderer lost'}}));assert(e.button('保存绑定').disabled);assert(e.button('绑定到「开心」').disabled);e.doc.querySelector('.l2d-bind-resource').click();assert.match(e.doc.querySelector('.l2d-bind-status').textContent,/renderer lost/);
 e.button('重试预览').click();await Promise.resolve();e.w.dispatchEvent(new e.w.MessageEvent('message',{source:e.frame.contentWindow,data:{t:'ready'}}));assert(!e.button('保存绑定').disabled);assert.match(e.doc.querySelector('.l2d-bind-summary').textContent,/1 项绑定/);
});
test('unmount registers independent close notifications and does not invoke with an aborted signal',async t=>{
 const e=await editor(t);assert(e.notifications.some(([method,args])=>method==='manualClose'&&args[0]==='test'));e.ac.abort();await Promise.resolve();assert(!e.doc.querySelector('dialog'));assert(!e.calls.some(c=>c.method==='manualClose'));
});
test('confirmation Escape preserves edits; panel disposal removes a pending confirmation',async t=>{
 const e=await editor(t);e.dirty();e.button('取消').click();const event=new e.w.Event('cancel',{bubbles:true,cancelable:true});e.doc.querySelector('.l2d-bind-discard').dispatchEvent(event);await Promise.resolve();assert(e.modal.open);assert(!e.doc.querySelector('.l2d-bind-discard'));
 e.button('×').click();e.ac.abort();await Promise.resolve();assert(!e.doc.querySelector('dialog'));assert.equal(e.hostConfirms(),0);
});
test('clean and expired editors can close without a discard prompt',async t=>{
 for(const fail of [false,true]){const e=await editor(t,fail);e.button('取消').click();await Promise.resolve();assert(!e.doc.querySelector('dialog'));assert.equal(e.hostConfirms(),0);}
});
