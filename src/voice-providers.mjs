import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {VOICE_PROVIDERS} from './voice-catalog.mjs';

const AUDIO_LIMIT = 12 * 1024 * 1024;
const JSON_LIMIT = AUDIO_LIMIT * 2 + 65536;
const runner = fileURLToPath(new URL('./voice-local.py', import.meta.url));
class VoiceError extends Error {}

export function providerSpec(id) {
  if (typeof id!=='string'||!Object.hasOwn(VOICE_PROVIDERS,id)) throw new VoiceError('语音服务不存在');
  return VOICE_PROVIDERS[id];
}

/** @param {string} id @param {unknown} input */
export function normalizeVoiceProfile(id, input = {}) {
  const {fields} = providerSpec(id);
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key=>!fields.some(field=>field.key===key))) throw new VoiceError('语音配置无效');
  return Object.fromEntries(fields.map(field=>{
    const {key,label,type,pattern,min,max,url} = field;
    const value = Object.hasOwn(input,key) ? input[key] : field.value;
    if (type === 'number') {
      if (!Number.isFinite(value) || value < min || value > max || field.step===1&&!Number.isInteger(value)) throw new VoiceError(label+'超出范围');
      return [key,value];
    }
    if (typeof value !== 'string' || value.length > 2048 || (pattern && !new RegExp(pattern).test(value.trim()))) throw new VoiceError(label+'格式无效');
    const clean = value.trim();
    if (url) {
      let endpoint;
      try { endpoint = new URL(clean); } catch { throw new VoiceError(label+'必须是 HTTP 或 HTTPS 地址'); }
      if (!['http:','https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.hash || endpoint.search) throw new VoiceError(label+'必须是不含凭据或查询参数的 HTTP 或 HTTPS 地址');
    }
    return [key,clean];
  }));
}

export function voiceMissingFields(id, config) {
  return providerSpec(id).fields.filter(field=>field.required && !config[field.key]
    && !(id==='mimo' && field.key==='voice' && /voicedesign/i.test(config.model))).map(field=>field.label);
}

export function needsVoiceKey(id, config) {
  return providerSpec(id).auth === true || id === 'openai' && new URL(config.endpoint).hostname === 'api.openai.com';
}

function address(base, suffix) {
  const normalized = base.replace(/\/+$/, '');
  return new URL(normalized.endsWith(suffix)?normalized:normalized+suffix);
}
const bearer = key => key ? {Authorization:'Bearer '+key} : {};

async function readBody(response, limit) {
  if (!response.ok || Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel().catch(()=>{});
    if (!response.ok) throw new VoiceError('语音服务返回 HTTP '+response.status);
    throw new VoiceError('语音响应超过大小限制');
  }
  if (!response.body) throw new VoiceError('语音服务未返回内容');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const {done,value} = await reader.read();
      if (done) return Buffer.concat(chunks,size);
      size += value.length;
      if (size > limit) throw new VoiceError('语音响应超过大小限制');
      chunks.push(value);
    }
  } finally {await reader.cancel().catch(()=>{});}
}

export function audioMime(data) {
  const prefix = data.toString('ascii',0,4);
  if (prefix === 'RIFF' && data.toString('ascii',8,12) === 'WAVE') return 'audio/wav';
  if (prefix === 'OggS') return 'audio/ogg';
  if (prefix === 'fLaC') return 'audio/flac';
  if (data.toString('ascii',4,8) === 'ftyp') return 'audio/mp4';
  if (prefix.startsWith('ID3') || data[0] === 0xff && (data[1] & 0xe0) === 0xe0) return 'audio/mpeg';
  return null;
}

function decodeBase64(value) {
  if (typeof value !== 'string' || !value || value.length > AUDIO_LIMIT * 4 / 3 + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new VoiceError('语音服务未返回有效音频');
  return Buffer.from(value,'base64');
}

function pcmWav(pcm, rate = 24000) {
  if (!pcm.length || pcm.length % 2 || !Number.isInteger(rate) || rate < 8000 || rate > 48000) throw new VoiceError('语音服务返回的 PCM 格式无效');
  const header = Buffer.alloc(44);
  header.write('RIFF',0);header.writeUInt32LE(pcm.length+36,4);header.write('WAVEfmt ',8);
  header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);
  header.writeUInt32LE(rate,24);header.writeUInt32LE(rate*2,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);
  header.write('data',36);header.writeUInt32LE(pcm.length,40);
  return Buffer.concat([header,pcm]);
}

function fishPayload(text, voice) {
  // The endpoint takes a map containing UTF-8 strings only.
  const values = {text,reference_id:voice,format:'mp3'};
  const pack = value => {
    const data = Buffer.from(value);
    if (data.length < 32) return Buffer.concat([Buffer.from([0xa0+data.length]),data]);
    if (data.length < 256) return Buffer.concat([Buffer.from([0xd9,data.length]),data]);
    const size = Buffer.alloc(3);size[0]=0xda;size.writeUInt16BE(data.length,1);
    return Buffer.concat([size,data]);
  };
  return Buffer.concat([Buffer.from([0x80+Object.keys(values).length]),...Object.entries(values).flatMap(([k,v])=>[pack(k),pack(v)])]);
}

function runLocal(id, config, key, text, signal, python) {
  return new Promise((resolve,reject)=>{
    const executable = python || (process.platform==='win32'?'python':'python3');
    const runtime = /^(PATH|SYSTEMROOT|SYSTEMDRIVE|WINDIR|USERPROFILE|APPDATA|LOCALAPPDATA|HOME|TEMP|TMP|LANG|SSL_CERT_FILE|SSL_CERT_DIR|REQUESTS_CA_BUNDLE|CURL_CA_BUNDLE|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY)$/i;
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => runtime.test(name)));
    const child = spawn(executable,['-E','-P','-u',runner,id],{windowsHide:true,stdio:['pipe','pipe','ignore'],signal,env});
    const chunks = [];
    let size = 0;
    child.stdout.on('data',chunk=>{
      size += chunk.length;
      if (size > AUDIO_LIMIT) {reject(new VoiceError('语音响应超过大小限制'));child.kill();}
      else chunks.push(chunk);
    });
    child.stdin.on('error',()=>{});
    child.once('error',error=>reject(error.code==='ENOENT'?new VoiceError('找不到本机 Python'):error));
    child.once('close',code=>{
      if (code===0) resolve(Buffer.concat(chunks));
      else if (code===10) reject(new VoiceError('本机 Python 缺少 '+({edge:'edge-tts',genie:'genie-tts',dashscope:'dashscope'}[id])));
      else if (code===11) reject(new VoiceError('Edge 语音服务返回 403，请检查 edge-tts 版本和网络'));
      else reject(new VoiceError('本机语音合成失败，请检查服务配置和依赖'));
    });
    child.stdin.end(JSON.stringify({config,key,text}));
  });
}

const xml = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const openaiSpeech = (c,k,text,{post}) => post(address(c.endpoint,'/audio/speech'),{model:c.model,input:text,voice:c.voice,response_format:'wav',speed:c.speed,...(c.instructions?{instructions:c.instructions}:{})},bearer(k));
const adapters = {
  async minimax(c,k,text,{json}) {
    const url = new URL(c.endpoint);
    if (c.groupId) url.searchParams.set('GroupId',c.groupId);
    const v = await json(url,{model:c.model,text,stream:false,output_format:'hex',language_boost:'auto',
      voice_setting:{voice_id:c.voice,...(c.speed!==1?{speed:c.speed}:{}),...(c.pitch!==0?{pitch:c.pitch}:{}),...(c.volume!==1?{vol:c.volume}:{})},
      audio_setting:{format:'mp3',sample_rate:24000,bitrate:64000,channel:1}},bearer(k));
    const code = v?.base_resp?.status_code;
    if (code !== 0) throw new VoiceError('MiniMax 语音合成失败'+(Number.isInteger(code)?'（'+code+'）':''));
    const hex = v?.data?.audio;
    if (typeof hex !== 'string' || !hex || hex.length > AUDIO_LIMIT*2 || hex.length%2 || /[^0-9a-f]/i.test(hex)) throw new VoiceError('MiniMax 未返回有效语音');
    return Buffer.from(hex,'hex');
  },
  openai: openaiSpeech,
  sovitsLocal(c,k,text,{post}) {
    return openaiSpeech({...c,model:c.model||'gpt-sovits',voice:c.voice||''},k,text,{post});
  },
  async mimo(c,k,text,{json}) {
    const style = [c.style,c.dialect].filter(Boolean).join(' ');
    const content = style ? '<style>'+style+'</style>'+text : text;
    const messages = [...(c.seedText?[{role:'user',content:c.seedText}]:[]),{role:'assistant',content}];
    const audio = {format:'wav',...(!/voicedesign/i.test(c.model)?{voice:c.voice}:{})};
    const v = await json(address(c.endpoint,'/chat/completions'),{model:c.model,messages,audio},bearer(k));
    return decodeBase64(v?.choices?.[0]?.message?.audio?.data);
  },
  fish(c,k,text,{raw}) {
    return raw(address(c.endpoint,'/tts'),fishPayload(text,c.voice),{...bearer(k),model:c.model,'Content-Type':'application/msgpack'});
  },
  async dashscope(c,k,text,{json,download,local}) {
    if (!/^qwen.*tts/i.test(c.model)) return local('dashscope',c,k,text);
    const v = await json(address(c.endpoint,'/services/aigc/multimodal-generation/generation'),{model:c.model,input:{text,voice:c.voice,language_type:'Auto'}},bearer(k));
    const audio = v?.output?.audio;
    if (audio?.data) {
      const bytes = decodeBase64(audio.data);
      return audioMime(bytes)?bytes:pcmWav(bytes);
    }
    return download(audio?.url,c.endpoint,true);
  },
  azure(c,k,text,{raw}) {
    const locale = /^([a-z]{2,3}-[A-Z]{2})/.exec(c.voice)?.[1] || 'zh-CN';
    const prosody = '<prosody rate="'+c.speed+'" volume="'+c.volume+'">'+xml(text)+'</prosody>';
    const style = c.style ? '<mstts:express-as style="'+xml(c.style)+'"'+(c.role?' role="'+xml(c.role)+'"':'')+'>'+prosody+'</mstts:express-as>' : prosody;
    const ssml = '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="'+locale+'"><voice name="'+xml(c.voice)+'">'+style+'</voice></speak>';
    return raw('https://'+c.region+'.tts.speech.microsoft.com/cognitiveservices/v1',ssml,{'Ocp-Apim-Subscription-Key':k,'Content-Type':'application/ssml+xml','X-Microsoft-OutputFormat':'audio-24khz-48kbitrate-mono-mp3'});
  },
  async volcengine(c,k,text,{json}) {
    const v = await json(c.endpoint,{app:{appid:c.appId,token:k,cluster:c.cluster},user:{uid:'coo-figure'},audio:{voice_type:c.voice,encoding:'mp3',speed_ratio:c.speed},request:{reqid:randomUUID(),text,text_type:'plain',operation:'query'}},{Authorization:'Bearer; '+k});
    return decodeBase64(v?.data);
  },
  async gemini(c,k,text,{json}) {
    const prompt = c.style ? c.style+'\n'+text : text;
    const v = await json(address(c.endpoint,'/models/'+encodeURIComponent(c.model)+':generateContent'),{contents:[{parts:[{text:prompt}]}],generationConfig:{responseModalities:['AUDIO'],speechConfig:{voiceConfig:{prebuiltVoiceConfig:{voiceName:c.voice}}}}},{'x-goog-api-key':k});
    const audio = v?.candidates?.flatMap(x=>x.content?.parts||[]).find(part=>part.inlineData?.mimeType?.startsWith('audio/'))?.inlineData;
    const bytes = decodeBase64(audio?.data);
    return audioMime(bytes)?bytes:pcmWav(bytes,Number(/rate=(\d+)/i.exec(audio.mimeType)?.[1]||24000));
  },
  elevenlabs(c,k,text,{post}) {
    const url = address(c.endpoint,'/text-to-speech/'+encodeURIComponent(c.voice));
    url.searchParams.set('output_format','mp3_44100_128');
    return post(url,{text,model_id:c.model,voice_settings:{stability:c.stability,similarity_boost:c.similarity}},{'xi-api-key':k});
  },
  edge(c,k,text,{local}) {return local('edge',c,k,text);},
  gsv(c,_k,text,{post}) {
    return post(address(c.endpoint,'/tts'),{text,text_lang:c.language,ref_audio_path:c.reference,prompt_text:c.prompt,prompt_lang:c.promptLang,media_type:'wav',streaming_mode:false,speed_factor:c.speed});
  },
  async gsvi(c,k,text,{json,download}) {
    const v = await json(address(c.endpoint,'/infer_single'),{dl_url:c.endpoint,version:c.version,model_name:c.voice,prompt_text_lang:c.promptLang,emotion:c.emotion,text,text_lang:c.language},bearer(k));
    return download(v?.audio_url,c.endpoint);
  },
  genie(c,k,text,{local}) {return local('genie',c,k,text);},
};

/** @param {{signal?: AbortSignal, request?: typeof fetch, local?: typeof runLocal, python?: string}} options */
export async function synthesizeVoice(id, config, key, text, options = {}) {
  const {signal, request = fetch, local = runLocal, python = process.env.FIGURE_TTS_PYTHON} = options;
  const spec = providerSpec(id);
  const missing = voiceMissingFields(id,config);
  if (missing.length) throw new VoiceError('请填写'+missing.join('、'));
  if (needsVoiceKey(id,config) && !key) throw new VoiceError('请先保存 '+spec.name+' 的 API 密钥');
  const timeout = AbortSignal.timeout(['genie','gsv','gsvi'].includes(id)?55000:30000);
  const active = signal ? AbortSignal.any([signal,timeout]) : timeout;
  const send = (url,options,limit) => request(String(url),{...options,signal:active,redirect:'error'}).then(response=>readBody(response,limit));
  const raw = (url,body,headers,limit=AUDIO_LIMIT) => send(url,{method:'POST',body,headers},limit);
  const post = (url,body,headers,limit) => raw(url,JSON.stringify(body),{'Content-Type':'application/json',...headers},limit);
  try {
    const audio = await adapters[id](config,key,text,{
      raw,post,
      json:async(url,body,headers)=>JSON.parse(await post(url,body,headers,JSON_LIMIT)),
      download:(value,origin,allowAliyun=false)=>{
        if (typeof value !== 'string' || !value) throw new VoiceError('语音服务未提供音频');
        const url = new URL(value,origin);
        const oss = allowAliyun && /^dashscope-result[^.]*\.oss-[^.]+\.aliyuncs\.com$/.test(url.hostname);
        if (oss && url.protocol==='http:') url.protocol='https:';
        const trusted = url.origin===new URL(origin).origin || oss && url.protocol==='https:';
        if (!trusted || url.username || url.password) throw new VoiceError('语音下载地址与已配置的服务不匹配');
        return send(url,{},AUDIO_LIMIT);
      },
      local:(kind,c,k,body)=>local(kind,c,k,body,active,python),
    });
    active.throwIfAborted();
    if (audio.length > AUDIO_LIMIT || !audioMime(audio)) throw new VoiceError('语音服务返回了无法播放的音频格式');
    return audio;
  } catch (error) {
    if (signal?.aborted) throw new VoiceError('语音已停止');
    if (timeout.aborted) throw new VoiceError(spec.name+' 语音合成超时');
    if (error instanceof VoiceError) throw error;
    throw new VoiceError('无法完成 '+spec.name+' 语音合成');
  }
}
