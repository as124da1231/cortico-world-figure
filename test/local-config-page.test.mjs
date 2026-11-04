import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mountConfigurationOverride,patchLocalHost,orderFigureTabs} from '../scripts/local-config-page.mjs';

test('appearance follows config only in figure navigation, without mutating the input',()=>{
 const tabs=['workbench','appearance','~config','~prompts'].map(value=>({value}));
 assert.deepEqual(orderFigureTabs({id:'world:figure'},tabs).map(t=>t.value),['workbench','~config','appearance','~prompts']);
 assert.equal(tabs[1].value,'appearance');assert.equal(orderFigureTabs({id:'world:other'},tabs),tabs);
 assert.equal(orderFigureTabs({id:'world:figure'},[tabs[0]]).length,1);
});

class Lifecycle {
  disposed=false; resources=[];
  own(item){this.resources.push(item);return item;}
  dispose(){if(this.disposed)return;this.disposed=true;for(const item of this.resources)item.dispose();}
}
function fixture(configuration) {
  const lifecycle=new Lifecycle(),errors=[],slot={replaceChildren(){this.cleared=true;}};
  const host={generation:1,find:()=>({client:{},panels:[{id:'workbench'}]}),
    deps:{onError:error=>errors.push(error),loader:{load:async()=>({configuration})}},
    panelContext:(_page,panel,root,life,_gen,scope)=>({panelId:panel,root,life,scope})};
  return {host,lifecycle,errors,slot,run:()=>mountConfigurationOverride(host,'world:figure',['figure'],1,slot,lifecycle)};
}
test('local config adapter leaves ordinary bundles on the generic schema renderer',async()=>{
  const f=fixture(undefined);assert.equal(await f.run(),false);assert.equal(f.errors.length,0);
  assert.throws(()=>patchLocalHost('unknown build'),/refusing/);
});
test('custom renderer receives an existing declared data panel and is disposed with the page',async()=>{
  let ctx,disposed=false;
  const f=fixture({panelId:'workbench',mount:value=>{ctx=value;return {dispose(){disposed=true;}};}});
  assert.equal(await f.run(),true);assert.equal(ctx.panelId,'workbench');assert.equal(ctx.scope.configGroups,'figure');
  f.lifecycle.dispose();assert.equal(disposed,true);
});
test('invalid or failed configuration renderers fall back and release their own resources',async()=>{
  assert.equal(await fixture({panelId:'undeclared',mount(){throw Error('never');}}).run(),false);
  let disposed=false;
  const f=fixture({panelId:'workbench',mount(ctx){ctx.life.own({dispose(){disposed=true;}});throw Error('failed');}});
  assert.equal(await f.run(),false);assert.equal(disposed,true);assert.equal(f.slot.cleared,true);assert.equal(f.errors.length,1);
});
test('navigation during loading or mounting does not mount into a newer page or leak late handles',async()=>{
  let mounted=false;
  const f=fixture({panelId:'workbench',mount(){mounted=true;}});
  f.host.deps.loader.load=async()=>{f.host.generation++;return {configuration:{mount(){mounted=true;}}};};
  assert.equal(await f.run(),true);assert.equal(mounted,false);
  let disposed=false;
  const g=fixture({panelId:'workbench',async mount(){g.host.generation++;g.lifecycle.dispose();return {dispose(){disposed=true;}};}});
  assert.equal(await g.run(),true);assert.equal(disposed,true);
});
