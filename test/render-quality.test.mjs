import assert from 'node:assert/strict';
import {test} from 'node:test';
import {qualityPolicy,graphicsLimits,displayPixels,resolutionPlan,texturePlan} from '../workbench/pack/backends/render-quality.js';
import {createAdaptiveRenderer,resizeMaskBuffers} from '../workbench/pack/backends/render-config.js';

test('quality presets and Original preserve custom texture choices without a software canvas cap',()=>{
 assert.deepEqual(qualityPolicy({}),{mode:'balanced',textureLimit:2048,canvasLimit:2048,strict:false});
 for(const [mode,limit]of [['economy',1024],['balanced',2048],['high',4096]]){
  const p=qualityPolicy({quality:mode,texture:'original'});assert.equal(p.textureLimit,limit);assert.equal(p.canvasLimit,limit);
 }
 assert.deepEqual(qualityPolicy({quality:'original',texture:'original'}),{mode:'original',textureLimit:0,canvasLimit:0,strict:true});
 assert.equal(qualityPolicy({quality:'original',texture:'1024'}).textureLimit,1024);
});

test('render size follows transformed screen size and DPR, respecting only actual hardware in Original',()=>{
 const limits={texture:16384,canvas:16384},p=qualityPolicy({quality:'original'});
 assert.equal(displayPixels({a:0,b:2,c:-2,d:0}),512); // rotation does not inflate the size
 assert.equal(displayPixels({a:0,b:0,c:0,d:0},{width:400,height:500}),500);
 assert.equal(resolutionPlan(600,2,p,limits).size,1280);
 assert(resolutionPlan(6000,2,p,limits).size>4096);
 assert.equal(resolutionPlan(6000,2,qualityPolicy({quality:'balanced'}),limits).size,2048);
 const capped=resolutionPlan(10000,2,p,limits);assert.equal(capped.size,16384);assert.match(capped.warning,/设备上限/);
});

test('Original uploads full textures or explicitly rejects a device limit; manual limits remain effective',()=>{
 const p=qualityPolicy({quality:'original'});
 assert.deepEqual(texturePlan(8192,4096,p,{texture:16384}),{width:8192,height:4096,scaled:false});
 assert.throws(()=>texturePlan(8192,4096,p,{texture:4096}),/设备上限/);
 assert.deepEqual(texturePlan(8192,4096,qualityPolicy({quality:'original',texture:'1024'}),{texture:4096}),{width:1024,height:512,scaled:true});
 assert.equal(texturePlan(8192,4096,qualityPolicy({quality:'high'}),{texture:4096}).width,4096);
});

test('device limits combine texture, renderbuffer and viewport limits',()=>{
 const gl={MAX_TEXTURE_SIZE:1,MAX_RENDERBUFFER_SIZE:2,MAX_VIEWPORT_DIMS:3,getParameter:k=>({1:16384,2:8192,3:[6000,7000]})[k]};
 assert.deepEqual(graphicsLimits(gl),{texture:16384,canvas:6000});
 assert.throws(()=>graphicsLimits({...gl,getParameter:()=>0}),/无法读取/);
});

test('Original mask allocation never silently selects reduced precision',()=>{
 let attempts=0;
 const model={_model:{getDrawableMasks:()=>[[1]],isUsingMasking:()=>true},createRenderer(){attempts++;},deleteRenderer(){},getRenderer:()=>({_drawableMasks:[{isValid:()=>false}],setClippingMaskBufferSize(){},startUp(){},useHighPrecisionMask(){}})};
 assert.throws(()=>createAdaptiveRenderer(model,{},512,512,{strict:true}),/无法创建/);assert.equal(attempts,2);
});

test('dynamic masks validate allocation and expose preset fallback; Original fails instead',()=>{
 const sizes=[];let bound,context;
 const gl={FRAMEBUFFER_BINDING:1,FRAMEBUFFER:2,getParameter:()=>123,bindFramebuffer:(_k,v)=>{bound=v;}};
 const model={_model:{isUsingMasking:()=>true}};
 const renderer={setClippingMaskBufferSize:s=>sizes.push(s),_drawableClippingManager:{setGL:g=>{context=g;}},_drawableMasks:[{createRenderTarget:(_g,w)=>w<=512,isValid:()=>true}]};
 const config={renderer,maskSize:256};resizeMaskBuffers(config,model,gl,2048,false);
 assert.equal(config.maskSize,512);assert.match(config.warning,/实际使用 512/);assert.equal(bound,123);assert.equal(context,gl);
 assert.throws(()=>resizeMaskBuffers(config,model,gl,2048,true),/无法分配/);
 assert.deepEqual(sizes,[2048,512,2048]);
});
