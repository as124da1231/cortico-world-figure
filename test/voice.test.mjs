import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { FigureVoice } from '../src/voice.ts';
import { LIVE2D } from '../src/index.ts';
import { makeCtx } from './_ctx.mjs';
import { normalizeVoiceProfile, synthesizeVoice } from '../src/voice-providers.mjs';
import { createVoiceMouthEnvelope, voiceLevel } from '../workbench/pack/backends/voice-playback.js';

test('stopping an audition before the playback job exists prevents it from starting', async t => {
  for (const stage of ['availability', 'previous playback cleanup']) await t.test(stage, async () => {
    const voice = new FigureVoice({ figures: '', systemPlayer: null, config: () => ({}), persist() {} });
    voice.current = () => ({id:'sovitsLocal', profile:{}, key:''});
    const deferred = Promise.withResolvers();
    const entered = Promise.withResolvers();
    const ready = {system:true, issue:''};
    voice.availability = async () => {
      if (stage === 'availability') { entered.resolve(); await deferred.promise; }
      return ready;
    };
    voice.hush = async () => {
      if (stage === 'previous playback cleanup') { entered.resolve(); await deferred.promise; }
    };
    let starts = 0;
    voice.play = async () => { starts++; };

    const audition = voice.audition();
    await entered.promise;
    assert.deepEqual(await voice.stopAudition(), {ok:true});
    deferred.resolve();
    assert.deepEqual(await audition, {ok:false});
    assert.equal(starts, 0);
    assert.deepEqual(await voice.audition(), {ok:true});
    assert.equal(starts, 1);
  });
});

test('mouth sampling follows audio position and closes for silence', () => {
  const samples = new Float32Array(1000);
  samples.fill(0.04, 250, 500);
  const buffer = { duration: 1, length: 1000, sampleRate: 1000, numberOfChannels: 1, getChannelData: () => samples };
  assert.equal(voiceLevel(buffer, 0), 0);
  assert.ok(Math.abs(voiceLevel(buffer, 0.3) - 0.168) < 0.001);
  assert.equal(voiceLevel(buffer, 0.6), 0);
  assert.equal(voiceLevel(buffer, 1), 0);
});

test('audio mouth smooths sudden peaks, closes through silence and keeps full-scale gain', () => {
  const mouth = createVoiceMouthEnvelope();
  const dt = 1 / 60;
  assert.equal(mouth.update(null, 1, dt), null);
  assert.equal(mouth.update(.02, 1, dt).open, 0);
  const peak = mouth.update(1, 1, dt);
  assert.ok(peak.open > .2 && peak.open < .4);
  const silence = mouth.update(0, 1, dt);
  assert.ok(silence.open > .8 * peak.open && silence.open < peak.open);
  for (let frame = 0; frame < 60; frame++) mouth.update(0, 1, dt);
  const quiet = mouth.update(0, 1, dt);
  assert.equal(quiet.weight, 1);
  assert.ok(quiet.open < .001);

  for (let frame = 0; frame < 60; frame++) mouth.update(.5, 1, dt);
  const normal = mouth.update(.5, 1, dt);
  const raised = mouth.update(.5, 2, dt);
  assert.ok(normal.open > .47 && normal.open < .5);
  assert.ok(Math.abs(raised.open - 2 * normal.open) < .001);
  assert.equal(mouth.update(.5, 3, dt).open, 1);
});

test('audio mouth blends back to the underlying pose and resumes without snapping ownership', () => {
  const mouth = createVoiceMouthEnvelope();
  for (let frame = 0; frame < 15; frame++) mouth.update(.6, 1, 1 / 60);
  const tail = mouth.update(null, 1, .065);
  assert.ok(tail.open > .5);
  assert.equal(tail.weight, .5);
  const next = mouth.update(0, 1, 1 / 60);
  assert.ok(next.weight > tail.weight && next.weight < 1);
  assert.ok(next.open < tail.open);
  assert.equal(mouth.update(null, 1, .13), null);
  assert.equal(mouth.update(0, 1, 1 / 60).open, 0);
});

test('the local GPT-SoVITS preset uses the plugin speech API and its current voice by default', async t => {
  const requests = [];
  const audio = Buffer.from('RIFF0000WAVE');
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push({
      path: req.url,
      method: req.method,
      authorization: req.headers.authorization,
      body: JSON.parse(Buffer.concat(chunks)),
    });
    res.writeHead(200, { 'Content-Type': 'audio/wav' }).end(audio);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  assert.deepEqual(normalizeVoiceProfile('sovitsLocal'), { endpoint: 'http://127.0.0.1:9880', voice: '', speed: 1 });

  const endpoint = 'http://127.0.0.1:' + server.address().port;
  for (const [path, voice, speed] of [['', '', 1], ['/audio/speech', 'xll', 1.2]]) {
    const profile = normalizeVoiceProfile('sovitsLocal', { endpoint: endpoint + path, voice, speed });
    assert.deepEqual(await synthesizeVoice('sovitsLocal', profile, '', '本地语音测试'), audio);
    assert.deepEqual(requests.at(-1), {
      path: '/audio/speech', method: 'POST', authorization: undefined,
      body: { model: 'gpt-sovits', input: '本地语音测试', voice, response_format: 'wav', speed },
    });
  }
  assert.equal(requests.length, 2);
});

test('existing provider profiles become saved service cards without rewriting settings or keys', async () => {
  const endpoint = 'https://api.openai.com/v1';
  const cfg = {
    voiceProvider:'openai',
    voiceProfiles:{openai:{endpoint,model:'existing-model',voice:'alloy'},edge:{voice:'zh-CN-XiaoxiaoNeural'}},
  };
  const slot = 'FIGURE_TTS_OPENAI_' + createHash('sha256').update(new URL(endpoint).origin).digest('hex').slice(0,20).toUpperCase();
  let writes = 0;
  const voice = new FigureVoice({
    config:()=>cfg, persist:()=>{writes++;}, figures:'',
    secret:name=>name === slot ? 'existing-local-test-key' : '',
  });
  const state = await voice.state();
  assert.equal(state.selectedId,'openai');
  assert.equal(state.services.length,2);
  assert.ok(state.services.find(service=>service.id==='openai').hasKey);
  assert.equal(writes,0);
  assert.ok(!JSON.stringify(state).includes('existing-local-test-key'));
});

test('malformed saved services do not hide usable services or draft repair', async () => {
  const voice = new FigureVoice({ figures: '', systemPlayer: null, persist() {},
    config: () => ({voiceService:'good', voiceServices:[
      null,
      {id:'unsupported', provider:'removed-provider', name:'Old', profile:{}},
      {id:'broken', provider:'edge', name:'To repair', profile:null},
      {id:'good', provider:'sovitsLocal', name:'Usable', profile:{}},
    ]}),
  });
  const state = await voice.state();
  assert.equal(state.selectedId, 'good');
  assert.deepEqual(state.services.map(({id, ready}) => [id, ready]), [['broken', false], ['good', true]]);
});

test('stopping narration blocks synchronized calls from the previous model response', async t => {
  const spoken = [];
  const events = [];
  const voice = new FigureVoice({ figures:'', config:()=>({voiceEnabled:true,voiceTiming:'sync',voiceProvider:'sovitsLocal'}),
    persist() {}, systemPlayer:{
      canReportStart:true, warm(){}, interrupt(){}, async stop(){},
      async play(audio, _volume, _signal, started) { spoken.push(audio.toString()); started(Date.now()); },
    },
  });
  voice.synthesize = async (_voice, text) => Buffer.from(text);
  await voice.start({store:{latestCursor:()=>events.length,range:({source,fromCursor=1,toCursor=Infinity})=>
    events.filter(event=>(!source || source===event.source) && event.cursor>=fromCursor && event.cursor<=toCursor)}});
  t.after(() => voice.stop());
  const tap = voice.outputTap();
  const emit = (name, call_id, args, output_index) => tap.onEvent({
    type:'response.output_item.done',output_index,item:{
      type:'function_call',name,call_id,status:'completed',arguments:JSON.stringify(args),
    },
  });
  const pair = (id, text) => {
    emit('figure_speak',id,{text},0);
    emit('pet_say',id+'-bubble',{script:text},1);
    tap.onRoundEnd();
  };
  const reply = (callId, text) => voice.syncTool().handler({text},{callId});
  pair('queued','等待朗读的旧回复。');
  await voice.stopNarration();
  assert.match(await reply('queued','等待朗读的旧回复。'),/语音未开始/);
  pair('late','停止之后才完成的旧回复。');
  assert.match(await reply('late','停止之后才完成的旧回复。'),/语音未开始/);
  for (const text of ['等待朗读的旧回复。','停止之后才完成的旧回复。']) {
    events.push({source:'desktop-pet',type:'desktop-pet.self',cursor:events.length+1,text,meta:{kind:'say'}});
  }
  await voice.poll();
  await voice.stream?.play;
  assert.deepEqual(spoken, []);

  tap.onEvent({type:'response.created'});
  pair('new','新回复仍正常朗读。');
  assert.match(await reply('new','新回复仍正常朗读。'),/语音已开始/);
  assert.deepEqual(spoken, ['新回复仍正常朗读。']);
});

test('speech uses the selected service for fresh pet replies, with origin-bound keys and cleanup', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'figure-voice-'));
  const botFile = join(dir, 'config.json');
  const figures = join(dir, 'figures');
  const pack = join(figures, 'sample');
  const asset = join(pack, 'figure-voice.json');
  const json = (path, value) => writeFile(path, JSON.stringify(value));
  await mkdir(join(pack, 'backends'), { recursive: true });
  await Promise.all([
    json(join(pack, 'build.json'), { tool: 'cortico-live2d-pack' }),
    json(join(pack, 'figure.json'), { id: 'sample', entry: 'figure.js' }),
    json(asset, { version: 1 }),
    writeFile(join(pack, 'backends/voice-playback.js'), 'export {};'),
  ]);
  const setPet = readSay => json(botFile, { worlds: {
    'desktop-pet': { skin: { figure: 'sample' } },
    streamvoice: { enabled: true, readSay },
  } });
  await setPet(false);
  const cfg = {};
  const keys = new Map();
  const requests = [];
  const failedSpeech = new Set();
  const wav = Buffer.from('RIFF0000WAVE');
  const service = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const text = JSON.parse(Buffer.concat(chunks)).input;
    requests.push({ path: req.url, key: req.headers.authorization, text });
    if (failedSpeech.has(text)) {
      res.writeHead(503).end();
      return;
    }
    res.setHeader('content-type', 'audio/wav');
    res.end(wav);
  });
  await new Promise(resolve => service.listen(0, '127.0.0.1', resolve));
  const endpoint = 'http://127.0.0.1:' + service.address().port + '/v1';
  const voice = new FigureVoice({
    config: () => cfg, persist: patch => Object.assign(cfg, patch), figures, systemPlayer: null,
    desktopBody: () => ({id:'desktop-pet',figure:'sample'}),
    secret: name => keys.get(name) || '', storeSecret: (name, key) => keys.set(name, key),
  });
  t.after(async () => {
    await voice.stop();
    await new Promise(resolve => service.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
  const event = (cursor, text, type = 'desktop-pet.self') =>
    ({ cursor, type, source: 'desktop-pet', text, meta: { kind: 'say' } });
  const events = [event(1, 'old reply')];
  await voice.start({ store: {
    latestCursor: () => events.at(-1).cursor,
    range: ({ fromCursor, toCursor }) => events.filter(e => e.cursor >= fromCursor && e.cursor <= toCursor),
  } });
  const profile = { endpoint, model: 'sample', voice: 'test' };
  assert.deepEqual((await voice.state()).services,[]);
  const state = await voice.save([null, 'openai', '日常', profile, 'local-test-key', true]);
  const primary = state.selectedId;
  assert.ok(primary);
  assert.equal(state.services[0].id, primary);
  assert.equal(state.services[0].hasKey, true);
  assert.equal(state.controls.voiceEnabled, false);
  assert.ok(!JSON.stringify(state).includes('local-test-key'));
  assert.ok(!JSON.stringify(cfg).includes('local-test-key'));
  const nonce = randomUUID();
  await voice.save([null, 'openai', '备用', profile, 'secondary-local-key', false, nonce]);
  const created = await voice.save([null, 'openai', '备用', profile, '', false, nonce]);
  const secondary = created.services.find(service=>service.id!==primary).id;
  assert.equal(secondary,nonce);
  assert.equal(created.selectedId, primary);
  await voice.save([secondary, 'openai', '另一个服务', {...profile,model:'secondary'}, '', false]);
  await voice.test([secondary, 'openai', {...profile,model:'secondary'}, '']);
  assert.equal(requests.pop().key,'Bearer secondary-local-key');
  assert.equal((await voice.state()).services.length,2);
  await assert.rejects(voice.test([primary, 'openai', { ...profile, endpoint: 'https://api.openai.com/v1' }, '']), /密钥/);
  await voice.controls({ voiceEnabled: true, voiceMouthGain: 2.4 });
  events.push(event(2, 'other event', 'desktop-pet.message'), event(3, 'fresh reply'));
  voice.onRunPhase({state:'delivering'});
  async function waitFor(check) {
    for (let attempt = 0; attempt < 35; attempt++) {
      const value = await check();
      if (value) return value;
      await delay(100);
    }
    const { message, issue, reader } = await voice.state();
    assert.fail(`Voice state did not update (${message || issue || reader || 'no active clip'}, ${requests.length} requests)`);
  }
  const read = async () => JSON.parse(await readFile(asset, 'utf8'));
  const published = await waitFor(async () => {
    const state = await read();
    return state.clip && state;
  });
  assert.equal(published.gain, 2.4);
  assert.deepEqual(requests, [{ path: '/v1/audio/speech', key: 'Bearer local-test-key', text: 'fresh reply' }]);
  assert.deepEqual(await readFile(join(pack, `figure-voice-${published.clip.id}.audio`)), wav);
  await setPet(true);
  await voice.controls({ voiceEnabled: false });
  events.push(event(4, 'narration is disabled'));
  await waitFor(async () => !(await read()).clip && !(await readdir(pack)).some(name => name.endsWith('.audio')));
  assert.equal(requests.length, 1);
  assert.ok(!(await readdir(pack)).some(name => name.endsWith('.audio')));
  await voice.controls({ voiceEnabled: true });
  await setPet(false);
  const resume = await voice.suspend();
  await json(asset, {version:2});
  resume();
  const tap = voice.outputTap();
  const first = '这是等到气泡入库再播的一句。';
  const second = '这是后来跟上的第二句话。';
  tap.onEvent({type:'response.output_item.added',output_index:0,item:{type:'function_call',id:'tool-1',name:'pet_say'}});
  tap.onEvent({type:'response.function_call_arguments.delta',output_index:0,item_id:'tool-1',delta:'{"script":"'+first});
  await delay(750);
  assert.equal((await read()).clips?.length ?? 0,0);
  assert.equal(requests.length,1);
  tap.onEvent({type:'response.function_call_arguments.delta',output_index:0,item_id:'tool-1',delta:second+'"}'});
  tap.onEvent({type:'response.function_call_arguments.done',output_index:0,item_id:'tool-1',arguments:JSON.stringify({script:first+second})});
  tap.onRoundEnd?.();
  events.push(event(5, first+second));
  await waitFor(async () => (await read()).clips?.length===2);
  await delay(800);
  assert.deepEqual(requests.slice(1).map(request=>request.text),[first,second]);
  tap.onAbort('test cut');
  await waitFor(async () => !(await read()).clips?.length && !(await readdir(pack)).some(name=>name.endsWith('.audio')));

  function acceptedSay(text) {
    const streamTap = voice.outputTap();
    streamTap.onEvent({type:'response.output_item.done',output_index:0,item:{
      type:'function_call',id:'tool-recovery',name:'pet_say',arguments:JSON.stringify({script:text}),
    }});
    streamTap.onRoundEnd?.();
    events.push(event(events.at(-1).cursor + 1, text));
    return streamTap;
  }
  await t.test('a fully failed synthesis leaves the bubble and does not repeat it', async () => {
    const first = '这是流式合成失败的第一句话。';
    const second = '这是流式合成失败的第二句话。';
    failedSpeech.add(first);
    failedSpeech.add(second);
    const before = requests.length;
    const recovery = acceptedSay(first + second);
    await waitFor(() => requests.length >= before+2);
    assert.deepEqual(requests.slice(before).map(request => request.text), [first, second]);
    assert.equal((await read()).clips?.length ?? 0,0);
    recovery.onAbort('test cut');
    await waitFor(async () => !(await read()).clips?.length && !(await readdir(pack)).some(name => name.endsWith('.audio')));
  });
  await t.test('accepted bubble narration does not repeat a partially successful stream', async () => {
    const first = '这是成功播放的一句话。';
    const second = '这是本次合成失败的一句话。';
    failedSpeech.add(second);
    const before = requests.length;
    const partial = acceptedSay(first + second);
    await waitFor(async () => requests.length >= before + 2 && (await read()).clips?.length === 1);
    await delay(800);
    assert.deepEqual(requests.slice(before).map(request => request.text), [first, second]);
    partial.onAbort('test cut');
    await waitFor(async () => !(await read()).clips?.length && !(await readdir(pack)).some(name => name.endsWith('.audio')));
  });
  const beforeQuestion = requests.length;
  events.push({...event(events.at(-1).cursor + 1, '选一个颜色。'), meta:{kind:'ask',options:['红色','蓝色']}});
  await waitFor(() => requests.length >= beforeQuestion + 2);
  assert.deepEqual(requests.slice(beforeQuestion).map(request => request.text), ['选一个颜色。','可选，红色、蓝色。']);
  await voice.stopNarration();
  const removed=await voice.remove(primary);
  assert.equal(removed.controls.voiceEnabled, false);
  assert.equal(removed.selectedId,'');
  assert.deepEqual(removed.services.map(service=>service.id),[secondary]);
});

test('system voice audition survives polling when the Live2D body has no lip-sync pack', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'figure-voice-body-'));
  await writeFile(join(dir, 'config.json'), JSON.stringify({ worlds: {
    'desktop-live2d-pet': { skin: { figure: 'coo' } },
  } }));
  const wav = Buffer.from('RIFF0000WAVE');
  const service = createServer((_req, res) => res.writeHead(200, { 'content-type': 'audio/wav' }).end(wav));
  await new Promise(resolve => service.listen(0, '127.0.0.1', resolve));
  const cfg = { voiceEnabled: false };
  const keys = new Map();
  let played = false;
  const voice = new FigureVoice({
    config: () => cfg, persist: patch => Object.assign(cfg, patch), figures: dir, botDir: dir,
    desktopBody: () => ({ id: 'desktop-live2d-pet', figure: 'coo' }),
    secret: name => keys.get(name) || '', storeSecret: (name, key) => keys.set(name, key),
    systemPlayer: {
      canReportStart: true, warm() {}, interrupt() {}, async stop() {},
      async play(bytes, _volume, signal) {
        assert.deepEqual(bytes, wav);
        await delay(900, undefined, { signal });
        played = true;
      },
    },
  });
  t.after(async () => {
    await voice.stop();
    await new Promise(resolve => service.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
  await voice.start({ store: { latestCursor: () => 0, range: () => [] } });
  const endpoint = `http://127.0.0.1:${service.address().port}/v1`;
  await voice.save([null, 'openai', 'test', { endpoint, model: 'test', voice: 'test' }, 'test-key', true]);
  assert.deepEqual(await voice.audition(), { ok: true });
  assert.equal(played, true);
  assert.equal((await voice.state()).controls.voiceEnabled, false);
});

test('the stock desktop pet can play a voice sample while wearing either built-in figure', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'figure-voice-stock-'));
  const wav = Buffer.from('RIFF0000WAVE');
  const server = createServer((_req, res) => res.writeHead(200, {'Content-Type':'audio/wav'}).end(wav));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = 'http://127.0.0.1:' + server.address().port;
  const world = LIVE2D.create(makeCtx(dir, { voiceProvider:'sovitsLocal', voiceProfiles:{sovitsLocal:{endpoint}} }));
  const events = [];
  let played = 0;
  world.voice.systemPlayer = {
    canReportStart: true, warm() {}, interrupt() {}, async stop() {},
    async play(bytes) { assert.deepEqual(bytes, wav); played++; },
  };
  t.after(async () => {
    await world.stop();
    await new Promise(resolve => server.close(resolve));
    await rm(dir, {recursive:true,force:true});
  });
  await world.start({store:{latestCursor:()=>events.length, range:({source})=>events.filter(event=>source===event.source)}});
  const ui = world.webUi('zh');
  for (const id of ['coo', 'whale']) {
    events.push({ cursor:events.length+1, source:'desktop-pet', type:'desktop-pet.figure',
      meta:{figure:{kind:'figure',name:{id}}} });
    const state = await ui.invoke('voice', 'voiceState', []);
    assert.equal(state.playbackReady, true);
    assert.equal(state.bodyReady, false);
    assert.deepEqual(await ui.invoke('voice', 'voiceAudition', []), {ok:true});
  }
  assert.equal(played, 2);
});

test('bubble timing waits for the player, cancels timeouts and never re-reads the bubble', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'figure-voice-sync-'));
  const figures = join(dir, 'figures');
  const pack = join(figures, 'sample');
  const stateFile = join(pack, 'figure-voice.json');
  const read = async () => JSON.parse(await readFile(stateFile, 'utf8'));
  await mkdir(join(pack, 'backends'), { recursive: true });
  await Promise.all([
    writeFile(join(dir, 'config.json'), JSON.stringify({worlds:{'desktop-pet':{skin:{figure:'sample'}}}})),
    writeFile(join(pack, 'build.json'), '{"tool":"cortico-live2d-pack"}'),
    writeFile(join(pack, 'figure.json'), '{"id":"sample","entry":"figure.js"}'),
    writeFile(stateFile, '{"version":3}'),
    writeFile(join(pack, 'backends', 'voice-playback.js'), 'export {};'),
  ]);
  const requests = [], plays = [], events = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const text = JSON.parse(Buffer.concat(chunks)).input;
    requests.push(text);
    if (text === '合成服务不可用。') res.writeHead(503).end();
    else res.setHeader('content-type', 'audio/wav').end(Buffer.from('RIFF0000WAVE'));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const player = {
    canReportStart: true,
    warm() {}, interrupt() {}, async stop() {},
    play(_audio, _volume, signal, onStarted) {
      signal.throwIfAborted();
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), {once:true});
        plays.push({signal, start:onStarted, end:resolve});
      });
    },
  };
  const cfg = {voiceEnabled:true, voiceTiming:'sync'};
  let key = '';
  const voice = new FigureVoice({ config:()=>cfg, persist: patch=>Object.assign(cfg,patch), figures,
    desktopBody: () => ({id:'desktop-pet',figure:'sample'}),
    secret:()=>key, storeSecret:(_name,value)=>{key=value;}, systemPlayer:player });
  t.after(async () => {
    await voice.stop();
    await new Promise(resolve => server.close(resolve));
    await rm(dir, {recursive:true,force:true});
  });
  await voice.start({store:{latestCursor:()=>events.length, range:({source,fromCursor=1,toCursor=Infinity})=>
    events.filter(event => (!source || event.source === source) && event.cursor >= fromCursor && event.cursor <= toCursor)}});
  const bubble = text => events.push({cursor:events.length+1,source:'desktop-pet',type:'desktop-pet.self',text,meta:{kind:'say'}});
  const wait = async check => {
    for (let i = 0; i < 50; i++) { if (await check()) return; await delay(25); }
    assert.fail('Voice playback did not reach the expected state');
  };
  assert.equal(voice.syncTool(), undefined);
  assert.equal(voice.outputTap(), undefined);
  bubble('没有配置时照常显示文字。');
  await voice.save([null,'openai','测试服务',
    {endpoint:'http://127.0.0.1:'+server.address().port+'/v1',model:'test',voice:'test'},'local-test-key',true]);
  assert.deepEqual(requests, []);

  const closeTool = (tap, name, callId, args, index) => tap.onEvent({
    type:'response.output_item.done',output_index:index,item:{
      type:'function_call',id:callId,call_id:callId,name,status:'completed',arguments:JSON.stringify(args),
    },
  });
  const pair = (text, id) => {
    const tap = voice.outputTap();
    closeTool(tap,'figure_speak',id,{text},0);
    closeTool(tap,'pet_say',id+'-bubble',{script:text},1);
    tap.onRoundEnd();
  };
  const text = '这句等到确认播放后再显示气泡。';
  const tap = voice.outputTap();
  closeTool(tap,'figure_speak','call-1',{text},0);
  await wait(() => requests.length === 1);
  assert.equal(plays.length, 0);
  let returned = false;
  const result = voice.syncTool().handler({text},{callId:'call-1',round:1}).then(value => {returned = true; return value;});
  await delay(75);
  assert.equal(plays.length, 0);
  closeTool(tap,'pet_say','call-1-bubble',{script:'<开心>'+text},1);
  await wait(() => plays.length === 1);
  assert.equal(returned, false);
  const staged = (await read()).clips[0];
  assert.equal(staged.sampleOnly, true);
  assert.equal(staged.startedAt, undefined);
  const at = Date.now();
  plays[0].start(at);
  assert.match(await result, /语音已开始/);
  await wait(async () => (await read()).clips?.[0]?.startedAt === at);
  bubble(text);
  await delay(800);
  assert.deepEqual(requests, [text]);
  assert.equal(plays.length, 1);
  plays[0].end();
  await wait(async () => !(await read()).clips?.length);

  pair('合成服务不可用。','call-2');
  const failed = await voice.syncTool().handler({text:'合成服务不可用。'},{callId:'call-2',round:2});
  assert.match(failed, /语音未开始/);
  assert.equal(plays.length, 1);
  bubble('合成服务不可用。');
  pair('播放器一直没有确认首声。','call-3');
  const timeout = voice.syncTool().handler({text:'播放器一直没有确认首声。'},{callId:'call-3',round:3});
  await wait(() => plays.length === 2);
  assert.match(await timeout, /语音未开始/);
  assert.equal(plays[1].signal.aborted, true);
  plays[1].start(Date.now());
  await wait(async () => !(await read()).clips?.length && !(await readdir(pack)).some(name => name.endsWith('.audio')));
  const before = requests.length;
  bubble('播放器一直没有确认首声。');
  await delay(800);
  assert.equal(requests.length, before);
  assert.equal(plays.length, 2);

  const resume = await voice.suspend();
  await writeFile(stateFile, '{"version":2}');
  resume();
  assert.equal((await voice.state()).bodyReady, false);
  const control = new AbortController();
  pair('旧形象也可以播放语音。','call-4');
  const oldPack = voice.syncTool().handler({text:'旧形象也可以播放语音。'},{callId:'call-4',round:4,signal:control.signal});
  await wait(() => plays.length === 3);
  assert.equal((await read()).clips, undefined);
  plays[2].start(Date.now());
  assert.match(await oldPack,/语音已开始/);
  control.abort();
  assert.equal(plays[2].signal.aborted, true);
  await wait(async () => !(await voice.state()).speaking);

  const unpaired = voice.outputTap();
  closeTool(unpaired,'figure_speak','call-5',{text},0);
  const missingBubble = voice.syncTool().handler({text},{callId:'call-5',round:5});
  unpaired.onRoundEnd();
  assert.match(await missingBubble,/语音未开始/);
  assert.equal(plays.length,3);

  const skipped = '已经开始出声，但气泡没有执行。';
  pair(skipped, 'call-6');
  const skippedSpeech = voice.syncTool().handler({text:skipped},{callId:'call-6',round:6});
  await wait(() => plays.length === 4);
  plays[3].start(Date.now());
  assert.match(await skippedSpeech,/语音已开始/);
  const deadline = Date.now() + 4500;
  while (!plays[3].signal.aborted && Date.now() < deadline) await delay(50);
  assert.equal(plays[3].signal.aborted,true);
  await wait(async () => !(await voice.state()).speaking);

  const restore = await voice.suspend();
  await writeFile(stateFile, '{"version":1}');
  restore();
  const bubbleOnly = '本轮只有气泡也要播报。';
  bubble(bubbleOnly);
  voice.onRunPhase({state:'delivering'});
  await wait(() => plays.length === 5);
  const fallbackStart = Date.now();
  plays[4].start(fallbackStart);
  assert.equal((await voice.state()).systemVoiceStartedAt, fallbackStart);
  voice.onRunPhase({state:'delivering'});
  assert.equal(plays[4].signal.aborted, false);
  plays[4].end();
  await wait(async () => !(await voice.state()).speaking);
  assert.equal(requests.filter(value => value === bubbleOnly).length, 1);
});
