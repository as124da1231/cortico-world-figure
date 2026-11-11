import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { FigureVoice } from '../src/voice.ts';
import { synthesizeVoice } from '../src/voice-providers.mjs';
import { createVoiceMouthEnvelope, voiceLevel } from '../workbench/pack/backends/voice-playback.js';

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

test('local GPT-SoVITS preset posts to the OpenAI-compatible endpoint without auth', async () => {
  const requests = [];
  const wav = Buffer.alloc(44);
  wav.write('RIFF', 0, 'ascii');
  wav.write('WAVE', 8, 'ascii');
  const request = async (url, options) => {
    requests.push({ url: String(url), options });
    return new Response(wav, { status: 200, headers: { 'content-type': 'audio/wav', 'content-length': String(wav.length) } });
  };
  const audio = await synthesizeVoice('sovitsLocal', { endpoint: 'http://127.0.0.1:9880', voice: '', speed: 1.2 }, '', '本地音色测试', { request });
  assert.deepEqual(audio, wav);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'http://127.0.0.1:9880/audio/speech');
  assert.equal(requests[0].options.headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    model: 'gpt-sovits', input: '本地音色测试', voice: '', response_format: 'wav', speed: 1.2,
  });
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
    config: () => cfg, persist: patch => Object.assign(cfg, patch), figures, botDir: dir,
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
  events.push(event(4, 'another reader owns this reply'));
  await waitFor(async () => !(await read()).clip && !(await readdir(pack)).some(name => name.endsWith('.audio')));
  assert.equal(requests.length, 1);
  assert.ok(!(await readdir(pack)).some(name => name.endsWith('.audio')));
  await assert.rejects(voice.controls({ voiceEnabled: true }), /流式语音播报/);
  await setPet(false);
  const resume = await voice.suspend();
  await json(asset, {version:2});
  resume();
  const tap = voice.outputTap();
  const first = '这是模型还没写完时先播的一句。';
  const second = '这是后来跟上的第二句话。';
  tap.onEvent({type:'response.output_item.added',output_index:0,item:{type:'function_call',id:'tool-1',name:'pet_say'}});
  tap.onEvent({type:'response.function_call_arguments.delta',output_index:0,item_id:'tool-1',delta:'{"script":"'+first});
  await waitFor(async () => (await read()).clips?.length===1);
  assert.equal(requests.at(-1).text,first);
  tap.onEvent({type:'response.function_call_arguments.delta',output_index:0,item_id:'tool-1',delta:second+'"}'});
  tap.onEvent({type:'response.function_call_arguments.done',output_index:0,item_id:'tool-1',arguments:JSON.stringify({script:first+second})});
  tap.onRoundEnd();
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
    streamTap.onRoundEnd();
    events.push(event(events.at(-1).cursor + 1, text));
    return streamTap;
  }
  await t.test('accepted bubble narration recovers when every streamed sentence fails', async () => {
    const first = '这是流式合成失败的第一句话。';
    const second = '这是流式合成失败的第二句话。';
    failedSpeech.add(first);
    failedSpeech.add(second);
    const before = requests.length;
    const recovery = acceptedSay(first + second);
    await waitFor(async () => (await read()).clips?.length === 1);
    assert.deepEqual(requests.slice(before).map(request => request.text), [first, second, first + second]);
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
  const removed=await voice.remove(primary);
  assert.equal(removed.controls.voiceEnabled, false);
  assert.equal(removed.selectedId,'');
  assert.deepEqual(removed.services.map(service=>service.id),[secondary]);
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
    botDir:dir, secret:()=>key, storeSecret:(_name,value)=>{key=value;}, systemPlayer:player });
  t.after(async () => {
    await voice.stop();
    await new Promise(resolve => server.close(resolve));
    await rm(dir, {recursive:true,force:true});
  });
  await voice.start({store:{latestCursor:()=>events.length, range:()=>events}});
  const bubble = text => events.push({source:'desktop-pet',type:'desktop-pet.self',text,meta:{kind:'say'}});
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
      type:'function_call',id:callId,call_id:callId,name,arguments:JSON.stringify(args),
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
});
