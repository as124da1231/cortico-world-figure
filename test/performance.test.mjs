import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { PlannerServices } from '../src/planner-services.ts';
import { FigurePerformance } from '../src/performance.ts';
import { DesktopSelection } from '../src/desktop-body.ts';
import { PERFORMANCE_ASSET, PERFORMANCE_MOVE, PERFORMANCE_TARGET, parsePerformanceCues } from '../workbench/pack/backends/performance-plan.js';
import { createPerformancePlayback } from '../workbench/pack/backends/performance-playback.js';
import { ParameterPlanSequencer } from '../workbench/pack/vendor/soullink/chunk-OPVA6SRP.js';

async function fixture(t, mode, activeBody) {
  const root = await mkdtemp(join(tmpdir(), 'figure-performance-'));
  const figures = join(root, 'figures');
  const dir = join(figures, 'demo');
  await mkdir(dir, { recursive: true });
  const json = (name, value) => writeFile(join(dir, name), JSON.stringify(value));
  await writeFile(join(root, 'config.json'), JSON.stringify({ worlds: { 'desktop-pet': { skin: { figure: 'demo' } } } }));
  await json('figure.json', { id: 'demo', moves: mode === 'direct' ? [PERFORMANCE_TARGET] : [],
    vocab:[{id:'happy',names:{zh:['开心']}},{id:'sad',names:{zh:['难过']}}] });
  await json('build.json', { tool: 'cortico-live2d-pack', model: { id: 'demo' } });
  await mkdir(join(dir, 'models', 'demo'), {recursive:true});
  await writeFile(join(dir, 'models', 'demo', 'cdi3.js'), 'export default '+JSON.stringify({Parameters:[{Id:'ParamAngleY',Name:'点头'},{Id:'Toggle01',Name:'衣服'}]})+';\n');
  await json(PERFORMANCE_ASSET, { version: 1, orders: [] });
  await json('native-library.json', { catalog: { fingerprint: 'demo-1', resources: [
    { id: 'nod', title: '点头', kind: 'motion', classification: 'gesture', seconds: 1,
      parameters: [{ id: 'ParamAngleX', label: '头部左右' }], raw: { Curves: [] } },
    { id: 'clothes', title: '服装', kind: 'expression', classification: 'appearance', seconds: 1,
      parameters: [{ id: 'Toggle01' }], raw: { Parameters: [] } },
  ] } });
  const cfg = { performanceMode: mode, performanceEndpoint: 'https://planner.invalid/v1', performanceModel: 'test-planner' };
  const service = new FigurePerformance({ config: () => cfg, persist:patch=>Object.assign(cfg,patch), figures, secret: () => 'fixture-key',
    desktopBody: (id = activeBody ?? 'desktop-pet') => ({ id, figure: 'demo', dir }) });
  const events = [], usage = [];
  const host = { store: { latestCursor: () => events.length,
    range: ({fromCursor, toCursor, source}) => events.slice(fromCursor - 1, toCursor).filter(event => !source || event.source === source) },
    reportUsage(value) { usage.push(value); } };
  service.host = host;
  service.lastMode = mode;
  t.after(async () => {
    await service.stop();
    await rm(root, { recursive: true, force: true });
  });
  const orders = async (name = PERFORMANCE_ASSET) => JSON.parse(await readFile(join(dir, name), 'utf8')).orders;
  const source = activeBody ?? 'desktop-pet';
  const say = (text, at = Date.now(), body = source) => events.push({cursor:events.length+1, ts:new Date(at).toISOString(), source:body, type:body+'.self', text, meta:{kind:'say',beats:[{text,mood:{id:'happy'}}]} });
  const sayUser = text => events.push({cursor:events.length+1, ts:new Date().toISOString(),source,type:source+'.message',meta:{text}});
  return { service, root, cfg, usage, orders, say, sayUser, manifest: async () => JSON.parse(await readFile(join(dir, 'figure.json'), 'utf8')) };
}

test('readiness can follow a Live2D pet receipt without relying on the deployment configuration', async t => {
  const { service } = await fixture(t, 'direct');
  const record = {cursor: 1, source:'desktop-live2d-pet', type:'desktop-live2d-pet.figure',
    meta:{figure:{kind:'figure',name:{id:'coo'}}}};
  const selection = new DesktopSelection(() => ({latestCursor:()=>1,range:({source})=>source===record.source?[record]:[]}), () => ({}));
  service.opts.desktopBody = id => selection.body(id);
  assert.deepEqual(await service.readiness(),{state:'choose-figure',body:'desktop-live2d-pet',figure:'coo'});
  const result = await service.tools().find(tool=>tool.name==='figure_body').handler({},{});
  assert.equal(result.failed,true);
  assert.match(result.text,/当前接收对话/);
});

test('the Live2D body stages its own performance without updating the shared stock asset', async t => {
  const { service, orders, say } = await fixture(t, 'direct', 'desktop-live2d-pet');
  const call = (name, args) => service.tools().find(tool => tool.name === name).handler(args, {});
  const staged = JSON.parse(await call('figure_perform', { cues: [{ at: 0, duration: 1, resource: 'nod' }] }));
  assert.equal(staged.tool, 'live2d_pet_move_to');
  assert.deepEqual(await orders(), []);
  assert.equal((await orders('figure-performance.desktop-live2d-pet.json'))[0].ticket, staged.params[0]);
  say('这句话由副本播放。');
  await service.tick();
  assert((await orders('figure-performance.desktop-live2d-pet.json')).some(order => order.startedAt));
  assert.deepEqual(await orders(), []);
});

test('committed replies retain separate timelines and full-width inline expressions', async t => {
  const {service, say, orders} = await fixture(t, 'direct');
  const tap = service.outputTap();
  tap.onEvent({type:'response.output_item.done', item:{type:'function_call', name:'pet_say',
    status:'completed', arguments:JSON.stringify({script:'【开心】甲＜ 难过 ＞乙<unknown>'})}});
  say('甲乙');
  say('下一句。');
  await service.tick();
  const [first, second] = (await orders()).filter(order => order.startedAt);
  assert.equal(first.marks[0].face,'happy');
  assert.equal(first.marks[1].face,'sad');
  assert(first.marks[1].at > 0);
  assert(second.startedAt >= first.startedAt + first.speechMs);
});

test('direct tools stage a real host ticket and pair only with committed matching text', async t => {
  const { service, cfg, orders, say, manifest } = await fixture(t, 'direct');
  const call = (name, args) => service.tools().find(tool => tool.name === name).handler(args, {});
  assert.match(service.instructions(), /compose new live action sequences/);
  assert.match(service.instructions(), /call figure_body to check the available controls before answering/);
  assert.deepEqual(await service.readiness(),{state:'ready',body:'desktop-pet',figure:'demo'});
  const capabilities = JSON.parse(await call('figure_body', {}));
  assert.deepEqual(capabilities.resources.map(resource => resource.id), ['nod']);
  assert.deepEqual(capabilities.parameters.map(parameter => parameter.id), ['ParamAngleX','ParamAngleY']);
  const staged = JSON.parse(await call('figure_perform', { cues: [{ at: 0, duration: 1, resource: 'nod' }] }));
  assert.equal(staged.to, PERFORMANCE_MOVE);
  assert.equal((await orders())[0].ticket, staged.params[0]);
  await call('figure_reply_plan', { text:'这次说这句。', cues: [{ at: 0, duration: 1, face: 'happy' }] });
  say('说的是另一句。');
  await service.tick();
  assert.equal((await orders()).filter(order => order.startedAt && order.cues).length, 0);
  await call('figure_reply_plan', { text:'这次说这句。', cues: [{ at: 0, duration: 1, vad:{valence:.6}, facs:{headX:.4} }] });
  say('这次说这句。');
  await service.tick();
  assert.equal((await orders()).find(order => order.startedAt && order.cues).cues[0].vad.valence, .6);
  service.outputTap().onAbort('cancelled');
  await service.writes;
  assert.equal((await orders()).filter(order => order.startedAt).length, 0);
  cfg.performanceMode = 'vocab';
  await Promise.all([service.syncMode(), service.tick()]);
  assert.deepEqual(service.tools(), []);
  assert.deepEqual((await manifest()).moves, []);
  assert.throws(() => parsePerformanceCues([{ at: 0, duration: 1, pose: { ParamMouthOpenY: 1 } }]), /可控参数/);
});

test('dual mode keeps the primary tool list unchanged and uses the upstream two-stage planner', async t => {
  const { service, orders, say, usage } = await fixture(t, 'dual');
  assert.deepEqual(service.tools(), []);
  assert.equal(service.instructions(), '');
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (_url, request) => {
    const body = JSON.parse(request.body);
    assert.equal(body.model, 'test-planner');
    assert.equal(body.messages.some(message => message.content.includes('让我们再试一遍。')), true);
    requests++;
    const prompt = JSON.parse(body.messages.find(message => message.role === 'user').content);
    const frames = Array.from({length:prompt.frameCount}, (_, index) => index);
    const content = requests === 1 ? { motionPlan: frames.map(frameIndex => ({frameIndex, action: frameIndex ? 'relax' : 'nod'})) }
      : { parameterPlan: frames.map(time => ({time, duration:1, label:time ? 'relax' : 'nod', parameters:{ParamAngleX:time ? 0 : .6}})) };
    return Response.json({choices:[{message:{role:'assistant',content:JSON.stringify(content)}}],usage:{prompt_tokens:18,completion_tokens:10}});
  });
  say('让我们再试一遍。');
  await service.tick();
  let result;
  for(let i=0;i<80&&!result;i++){result=(await orders()).find(order=>order.beats?.length);if(!result)await delay(15);}
  assert(result);
  assert.equal(requests, 2);
  assert.equal(usage.length, 2);
  assert.deepEqual(result.marks, [{at:0,face:'happy'}]);
  assert.equal(result.beats.length, 3);
});

test('the original speech session plans alongside audio and uses the measured playback receipt once', async t => {
  const { service, orders, say, sayUser } = await fixture(t, 'dual');
  const prompts = [];
  t.mock.method(globalThis, 'fetch', async (_url, request) => {
    const prompt = JSON.parse(JSON.parse(request.body).messages.find(m => m.role === 'user').content);
    prompts.push(prompt);
    const indices = Array.from({length:prompt.frameCount}, (_, i) => i);
    const plan = prompt.motionPlan ? {parameterPlan:indices.map(i => ({time:i,duration:1,parameters:{ParamAngleX:.5}}))}
      : {motionPlan:indices.map(frameIndex => ({frameIndex, action:'nod'}))};
    return Response.json({choices:[{message:{content:JSON.stringify(plan)}}]});
  });
  const privateText = '仅保留在主会话的口令';
  sayUser(`${privateText}是 123456，请先眨眼，再向左歪头。`);
  let completeAudio, completePlayback, startPlayback;
  const audio = new Promise(resolve => { completeAudio = resolve; });
  const playback = new Promise(resolve => { completePlayback = resolve; });
  const controller = new AbortController();
  t.after(() => { controller.abort(); completeAudio(undefined); completePlayback(); });
  const coordinate = service.voiceCoordinator('好呀。','【难过】好呀。<开心>');
  const result = coordinate(audio, controller.signal, async (_first, onStarted) => {
    startPlayback = onStarted;
    await playback;
  });
  for (let i=0;i<60&&prompts.length<2;i++) await delay(10);
  assert.equal(prompts.length,2);
  assert.equal(prompts[1].userMessage,'先眨眼，再向左歪头');
  assert.equal(prompts[1].expression.emotion,'sad');
  assert(prompts.every(prompt => !JSON.stringify(prompt).includes(privateText) && !prompt.userMessage?.includes('123456')));
  assert.equal(startPlayback,undefined);
  completeAudio(Buffer.from([1]));
  for (let i=0;i<60&&!startPlayback;i++) await delay(10);
  assert(startPlayback);
  assert.equal((await orders()).length,0);
  const at=Date.now()-15;
  startPlayback(at,900);
  say('好呀。');
  await service.tick();
  let order;
  for (let i=0;i<60&&!order;i++){order=(await orders()).find(item=>item.beats);if(!order)await delay(10);}
  assert.equal(order.startedAt,at);
  assert.equal(order.speechMs,900);
  const last=order.beats.at(-1);
  assert(Math.abs(last.time+last.duration-.9)<.001);
  assert.equal(prompts.length,2);
  completePlayback();
  assert.equal(await result,true);
  await service.writes;
  assert.equal((await orders()).length,0);
});

test('a late plan uses the original reply time while that reply is still current', async t => {
  const { service, orders, say, sayUser } = await fixture(t, 'dual');
  t.mock.method(globalThis,'fetch',async (_url,request)=>{
    const prompt=JSON.parse(JSON.parse(request.body).messages.find(m=>m.role==='user').content);
    const indices=Array.from({length:prompt.frameCount},(_,i)=>i);
    const plan=prompt.motionPlan ? {parameterPlan:indices.map(time=>({time,duration:1,parameters:{ParamAngleX:.5}}))}
      : {motionPlan:indices.map(frameIndex=>({frameIndex,action:'nod'}))};
    return Response.json({choices:[{message:{content:JSON.stringify(plan)}}]});
  });
  const accepted=Date.now()-2200;
  say('好。',accepted);
  await service.tick();
  let order;
  for (let i=0;i<50&&!order;i++){order=(await orders()).find(item=>item.beats);if(!order)await delay(10);}
  assert(order);
  assert.equal(order.startedAt,accepted);
  sayUser('请先停一下。');
  await service.tick();
  await service.writes;
  assert.equal((await orders()).length,0);
});

test('a synchronized reply only consumes the matching desktop body receipt', async t => {
  const { service, orders, say } = await fixture(t, 'dual');
  t.mock.method(globalThis, 'fetch', async () => { throw Error('planner unavailable'); });
  const started = Promise.withResolvers();
  const ended = Promise.withResolvers();
  const signal = new AbortController();
  t.after(() => { signal.abort(); ended.resolve(); });
  const text = '同文气泡。';
  const speak = service.voiceCoordinator(text, text, 'desktop-pet');
  const result = speak(Promise.resolve(Buffer.from([1])), signal.signal, async (_audio, onStarted) => {
    const at = Date.now();
    onStarted(at, 900);
    started.resolve(at);
    await ended.promise;
  });
  const at = await started.promise;
  say(text, at + 10, 'desktop-live2d-pet');
  say(text, at + 20, 'desktop-pet');
  await service.tick();
  await service.writes;
  const stock = await orders();
  const live2d = await orders('figure-performance.desktop-live2d-pet.json');
  assert.equal(stock.length, 1);
  assert.equal(stock[0].speechMs, 900);
  assert.equal(live2d.length, 1);
  assert.equal(live2d[0].startedAt, at + 10);
  ended.resolve();
  assert.equal(await result, true);
});

test('removing the active planner cancels its request and ignores a late response', async t => {
  const { service, orders, say } = await fixture(t, 'dual');
  const requested = Promise.withResolvers();
  const response = Promise.withResolvers();
  const settled = Promise.withResolvers();
  const requestMotion = service.requestMotion.bind(service);
  service.requestMotion = (...args) => requestMotion(...args).finally(settled.resolve);
  const fetch = t.mock.method(globalThis, 'fetch', async (_url, init) => {
    requested.resolve(init.signal);
    return response.promise;
  });
  t.after(() => response.resolve(Response.json({})));
  say('编排服务切换前的台词。');
  await service.tick();
  const signal = await requested.promise;
  assert.equal(signal.aborted, false);
  service.planners.remove('legacy');
  assert.equal(signal.aborted, true);
  response.resolve(Response.json({choices:[{message:{content:'{"motionPlan":[{"frameIndex":0,"action":"nod"}]}'}}]}));
  await settled.promise;
  await service.writes;
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal((await orders()).length, 1);
  assert.equal((await orders())[0].beats, undefined);
});

test('dual mode keeps the local speech plan when configuration is absent or the provider fails', async t => {
  const { service, cfg, orders, say } = await fixture(t, 'dual');
  const endpoint = cfg.performanceEndpoint;
  const requests = t.mock.method(globalThis, 'fetch', async () => { throw Error('provider unavailable'); });
  cfg.performanceEndpoint = '';
  say('没有编排配置。');
  await service.tick();
  assert.equal(requests.mock.callCount(), 0);
  const first = (await orders())[0];
  assert(first.speechMs > 0 && !first.beats);
  cfg.performanceEndpoint = endpoint;
  say('编排服务暂时不可用。');
  await service.tick();
  const current = (await orders()).at(-1);
  assert(requests.mock.callCount() >= 1);
  assert.notEqual(current.ticket, first.ticket);
  assert(current.speechMs > 0 && !current.beats);
});

test('a drawn direct performance reports completion and dual keyframes match SoulLink interpolation', async t => {
  let now = 100000;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(console, 'info', () => {});
  const events = [];
  let orders = [{ticket:1,expiresAt:now+4000,cues:[{at:0,duration:1,pose:{ParamAngleX:1}},{at:0,duration:1,face:'happy'}]}];
  t.mock.method(globalThis,'fetch',async()=>Response.json({version:1,orders}));
  const model = {getParameterDefaultValue:()=>0,getParameterValueByIndex:()=>0,getParameterMinimumValue:()=>-30,getParameterMaximumValue:()=>30};
  const playback = createPerformancePlayback({asset:name=>name,model,paramIndex:new Map([['ParamAngleX',0]]),protectedIds:new Set(),host:{emit:(kind,detail)=>events.push({kind,...detail})},position:()=>({x:10,y:20})});
  assert(playback.direct({to:PERFORMANCE_MOVE,params:{ticket:1}},'move-1'));
  await delay(0);
  now += 500;
  const layer = playback.frame();
  assert.equal(layer.face, 'happy');
  assert(Math.abs(layer.tracks[0].value - 15) < .001);
  playback.rendered(layer);
  now += 850;
  playback.frame();
  assert.equal(events[0].kind, 'arrived');
  const beats=[{time:0,duration:1,parameters:{ParamAngleX:.8}},{time:1,duration:1,parameters:{ParamAngleX:-.6}}];
  orders=[{ticket:2,startedAt:now,expiresAt:now+2500,beats,face:'happy',speechMs:2000}];
  const original=new ParameterPlanSequencer();
  original.start(beats,now/1000,{ParamAngleX:0});
  playback.poll();
  await delay(0);
  for(const elapsed of [200,400,400,400]){
    now+=elapsed;
    const frame=playback.frame();
    assert.equal(frame.face, undefined);
    assert.equal(frame.speech.face, 'happy');
    const sampled=frame.tracks[0].value;
    assert(Math.abs(sampled-original.evaluate(now/1000).ParamAngleX*30)<.001);
  }
  playback.dispose();
});


test('planner services keep credentials scoped to their address and preserve the previous configured service', async t => {
  const cfg = { performanceEndpoint:'https://legacy.invalid/v1', performanceModel:'old-model' };
  const credentials = new Map([['FIGURE_PERFORMANCE_MODEL_KEY','legacy-key']]);
  const services = new PlannerServices({config:()=>cfg, persist:patch=>Object.assign(cfg,patch),
    secret:name=>credentials.get(name), storeSecret:(name,value)=>credentials.set(name,value)});
  assert.equal(services.connection().model, 'old-model');
  assert.equal(services.state().selectedId, 'legacy');
  const migrated = services.save({id:'legacy',provider:'custom',endpoint:'https://legacy.invalid/v1/',model:'old-model'});
  assert.equal(cfg.performanceEndpoint,'');
  assert.equal(services.connection().apiKey, 'legacy-key');
  assert(!JSON.stringify(migrated).includes('legacy-key'));
  const selected = services.save({provider:'deepseek',name:'DeepSeek',endpoint:'https://api.deepseek.com',model:'deepseek-flash',key:'test-key',select:true});
  assert.equal(selected.services.length,2);
  assert.equal(services.connection().apiKey,'test-key');
  const active = selected.services.find(service=>service.id===selected.selectedId);
  assert.throws(()=>services.save({...active,endpoint:'https://different.invalid/v1'}),/API 密钥/);
  assert.equal(services.connection().endpoint,'https://api.deepseek.com');
  const payloads = [];
  t.mock.method(globalThis,'fetch',async(url,init)=>{
    payloads.push({url,init});
    if (url.endsWith('/models')) return Response.json({data:[{id:'deepseek-flash'},{id:'deepseek-flash'}]});
    return Response.json({choices:[{message:{content:'{"action":"nod"}'}}]});
  });
  assert.deepEqual(await services.models(active),['deepseek-flash']);
  assert((await services.test(active)).elapsedMs >= 0);
  assert.equal(payloads[0].init.headers.get('Authorization'),'Bearer test-key');
  assert.equal(payloads[1].init.redirect,'error');
  assert.deepEqual(JSON.parse(payloads[1].init.body).thinking,{type:'disabled'});
  assert.equal(services.remove(active.id).selectedId,'');
  assert.equal(services.select(migrated.selectedId).selectedId,migrated.selectedId);
  const local = services.save({provider:'ollama',endpoint:'http://127.0.0.1:11434/v1',model:'local',select:true});
  assert.equal(services.connection().apiKey,'');
  await services.test(local.services.find(item=>item.id===local.selectedId));
  assert.equal(payloads.at(-1).init.headers.has('Authorization'),false);
});
