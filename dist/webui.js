const FIGURE_UI_VERSION = "4.2.0";
const EMOTION_EFFECTS = Object.freeze(['native', 'kaomoji', 'orb', 'flow', 'bubbles', 'softglow']);
const EMOTION_EFFECT_SIZES = Object.freeze(['small', 'medium', 'large']);

function normalizeEmotionEffects(value) {
  const selected = new Set(Array.isArray(value) ? value : typeof value === 'string' ? value.split(',').map(style=>style.trim()) : []);
  return EMOTION_EFFECTS.filter(style => style === 'native' || selected.has(style));
}

function normalizeEmotionEffectSize(value) {
  return EMOTION_EFFECT_SIZES.includes(value) ? value : 'medium';
}

const EMOTION_EFFECT_AXIS = 'figureeffects';
const EMOTION_EFFECT_THUMBS = 'thumb/effects';
const emotionEffectNames = {
  native: ['Coo 原有特效', 'Coo original effects'],
  kaomoji: ['颜文字', 'Kaomoji'],
  orb: ['情绪球', 'Emotion orb'],
  flow: ['全身粒子流', 'Full-body particle flow'],
  bubbles: ['右上角气泡', 'Upper-right bubbles'],
  softglow: ['柔光流尘 · 第二版', 'Softglow dust · V2'],
};

function setEmotionEffectAxis(manifest, value) {
  const styles = normalizeEmotionEffects(value);
  const options = styles.map(style => {
    const [zh, en] = emotionEffectNames[style];
    return { id: 'figurefx' + style, name: { zh, en }, thumb: EMOTION_EFFECT_THUMBS + '/' + style + '.png' };
  });
  const axis = { id: EMOTION_EFFECT_AXIS, name: { zh: '情绪特效', en: 'Emotion effects' }, options };
  const axes = manifest.axes ??= [];
  const index = axes.findIndex(item => item.id === axis.id);
  const previous = axes[index]?.options;
  const ownAxis = previous?.length && previous.every(option => EMOTION_EFFECTS.some(style => option.id === 'figurefx' + style));
  if (styles.length === 1) {
    if (index !== -1 && !ownAxis) return;
    if (ownAxis) axes.splice(index,1);
    for (const preset of manifest.presets ?? []) if (preset.pick) delete preset.pick[axis.id];
    if (manifest.effects?.reach === EMOTION_EFFECT_REACH) {
      delete manifest.effects.reach;
      if (!Object.keys(manifest.effects).length) delete manifest.effects;
    }
    return;
  }
  if (index !== -1 && !ownAxis) throw Error('情绪特效栏位与已有装扮分组重复');
  if (index === -1) axes.push(axis);
  else axes[index] = axis;
  for (const preset of manifest.presets ?? []) {
    preset.pick = {...preset.pick,[axis.id]:'figurefxnative'};
  }
  manifest.effects = { ...manifest.effects, reach: Math.max(manifest.effects?.reach || 0, EMOTION_EFFECT_REACH) };
}

function emotionStyleModule(value, size, manifest) {
  const styleList = normalizeEmotionEffects(value);
  const picks = Object.fromEntries(styleList.map(key => ['figurefx' + key, key]));
  const presets = Object.fromEntries((manifest.presets ?? []).map(preset => [preset.id, preset.pick?.[EMOTION_EFFECT_AXIS]]));
  return `export default "native";\nexport const emotionEffectSize = ${JSON.stringify(normalizeEmotionEffectSize(size))};\n`
    + `export const hasNamedPresets = ${Boolean(manifest.presets?.length)};\n`
    + `export const emotionEffectPicks = ${JSON.stringify(picks)};\nexport const emotionEffectPresets = ${JSON.stringify(presets)};\n`;
}

// Keep the effect travel independent of the body bounds.
const EMOTION_EFFECT_REACH = 1.95;

// Colour values from Coopanion 0.2.23, desktop-pet/web/whale/figure.json.
const FIGURE_THEME_AXIS = 'figuretheme';
const FIGURE_THEME_NAME = {
  zh: '配色', 'zh-Hant': '配色', en: 'Colours', ja: 'カラー', ko: '색상',
  fr: 'Couleurs', de: 'Farben', 'es-419': 'Colores', 'pt-BR': 'Cores', it: 'Colori', ru: 'Цвета',
};

const FIGURE_THEME_PALETTES = Object.freeze([
  {
    id: 'deepseek', name: { zh: '蓝色', 'zh-Hant': '藍色', en: 'Blue' }, accent: '#4D6BFE',
    console: {
      light: { a: '#4562f5', a2: '#7b90fe', on: '#ffffff', t: '#3550d6', c3: '#8ea0c8', c4: '#8a8a90' },
      dark: { a: '#7b93ff', a2: '#a3b3ff', on: '#0d1640', t: '#9aabff', c3: '#8ea0c8', c4: '#9a9aa0' },
    },
  },
  {
    id: 'chatgpt', name: { zh: '黑色', en: 'Black' }, accent: '#303030',
    console: {
      light: { a: '#2f2f2f', a2: '#8e8ea0', on: '#ffffff', t: '#202123', c3: '#10a37f', c4: '#b4b4c0' },
      dark: { a: '#ececf1', a2: '#a9a9b8', on: '#202123', t: '#d9d9e3', c3: '#19c37d', c4: '#6e6e80' },
    },
  },
  {
    id: 'claude', name: { zh: '橙色', en: 'Orange' }, accent: '#D97757',
    console: {
      light: { a: '#d97757', a2: '#c2928a', on: '#1f0f08', t: '#a84e2f', c3: '#7b7974', c4: '#c6a58c' },
      dark: { a: '#e08a6c', a2: '#d9a497', on: '#1f0f08', t: '#eba287', c3: '#97958d', c4: '#c6a58c' },
    },
  },
  {
    id: 'qwen', name: { zh: '紫色', en: 'Purple' }, accent: '#7F69F0',
    console: {
      light: { a: '#7560ea', a2: '#a294f5', on: '#ffffff', t: '#5b45d0', c3: '#b8a9e8', c4: '#8a8a90' },
      dark: { a: '#a596ff', a2: '#c2b8ff', on: '#1a1240', t: '#b3a6ff', c3: '#8f82c9', c4: '#9a9aa0' },
    },
  },
  {
    id: 'minimax', name: { zh: '粉色', en: 'Pink' }, accent: '#D92D7A',
    console: {
      light: { a: '#d92d7a', a2: '#f2762e', on: '#ffffff', t: '#b51f62', c3: '#e8a0c0', c4: '#8a8a90' },
      dark: { a: '#f0619e', a2: '#ff9a5c', on: '#2a0617', t: '#f58ab6', c3: '#c97aa0', c4: '#9a9aa0' },
    },
  },
]);

const FIGURE_THEME_ALIASES = Object.freeze({ harness: 'chatgpt', gemini: 'deepseek', kimi: 'deepseek' });

function normalizeFigureThemes(value) {
  const ids = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',').map(id => id.trim()) : [];
  const requested = new Set(ids.map(id => typeof id === 'string' && Object.hasOwn(FIGURE_THEME_ALIASES, id) ? FIGURE_THEME_ALIASES[id] : id));
  return FIGURE_THEME_PALETTES.map(palette => palette.id).filter(id => requested.has(id));
}

const field = (key,label,value='',extra={}) => ({key,label,value,...extra});
const address = value => field('endpoint','服务地址',value,{url:true,required:true});
const model = value => field('model','模型',value,{required:true});
const voice = (value='',label='音色') => field('voice',label,value,{required:true});
const number = (key,label,value,min,max,step=.1) => field(key,label,value,{type:'number',min,max,step});

const VOICE_PROVIDERS = {
  minimax:{name:'MiniMax',auth:true,fields:[address('https://api.minimax.cn/v1/t2a_v2'),model('speech-2.8-turbo'),voice('female-shaonv','音色 ID'),field('groupId','Group ID（可选）'),number('speed','语速',1,.5,2),number('pitch','音调',0,-12,12,1),number('volume','音量',1,.1,10)]},
  openai:{name:'OpenAI 兼容',auth:'optional',fields:[address('https://api.openai.com/v1'),model('gpt-4o-mini-tts'),voice('alloy'),number('speed','语速',1,.25,4),field('instructions','朗读风格（可选）')]},
  mimo:{name:'小米 MiMo',auth:true,fields:[address('https://api.xiaomimimo.com/v1'),model('mimo-v2.5-tts'),voice('mimo_default'),field('style','风格提示（可选）'),field('dialect','方言（可选）'),field('seedText','参考文本（可选）')]},
  fish:{name:'Fish Audio',auth:true,fields:[address('https://api.fish-audio.cn/v1'),model('s2-pro'),voice('','参考音色 ID')]},
  dashscope:{name:'阿里云百炼',auth:true,help:'支持 CosyVoice 和 Qwen TTS。CosyVoice 需要本机 Python 的 dashscope。',fields:[address('https://dashscope.aliyuncs.com/api/v1'),model('cosyvoice-v3-flash'),voice('longanyang')]},
  azure:{name:'Azure TTS',auth:true,fields:[field('region','Azure 区域','eastus',{required:true,pattern:'^[a-z0-9]+$'}),voice('zh-CN-YunxiaNeural'),field('style','说话风格（可选）'),field('role','说话角色（可选）'),number('speed','语速',1,.5,2),number('volume','音量',100,0,100,1)]},
  volcengine:{name:'火山引擎 TTS',auth:true,fields:[address('https://openspeech.bytedance.com/api/v1/tts'),field('appId','应用 ID','',{required:true}),field('cluster','集群','volcano_tts',{required:true}),voice('','音色 ID'),number('speed','语速',1,.2,3)]},
  gemini:{name:'Gemini TTS',auth:true,fields:[address('https://generativelanguage.googleapis.com/v1beta'),model('gemini-3.1-flash-tts-preview'),voice('Leda'),field('style','风格提示（可选）')]},
  elevenlabs:{name:'ElevenLabs',auth:true,fields:[address('https://api.elevenlabs.io/v1'),model('eleven_multilingual_v2'),voice('','音色 ID'),number('stability','稳定性',.5,0,1,.01),number('similarity','相似度',.75,0,1,.01)]},
  edge:{name:'Edge TTS',help:'使用 Microsoft 在线语音服务，需要 Python 3.11+ 和 edge-tts 7.3.1 或更高版本。',fields:[voice('zh-CN-XiaoxiaoNeural'),number('rate','语速（%）',0,-50,100,1),number('volume','音量（%）',0,-100,100,1),number('pitch','音调（Hz）',0,-100,100,1)]},
  sovitsLocal: {
    name: '本机 GPT-SoVITS 插件',
    help: '请先在 GPT-SoVITS 插件中开启「开放本机语音接口」，接口令牌留空。音色留空时使用插件当前音色。',
    helpEn: 'Enable the local speech API in the GPT-SoVITS plugin and leave its API token empty. A blank voice uses the plugin’s current voice.',
    fields: [
      address('http://127.0.0.1:9880'),
      field('voice', '音色（可选）', '', { primary: true }),
      { ...number('speed', '语速', 1, .25, 4), primary: true },
    ],
  },
  gsv:{name:'GPT-SoVITS 自部署',help:'使用服务端已加载的模型。参考音频填写 GPT-SoVITS 服务端能访问的路径。',fields:[address('http://127.0.0.1:9880'),field('reference','参考音频路径','',{required:true}),field('prompt','参考文本'),field('promptLang','参考语言','zh',{required:true}),field('language','朗读语言','auto',{required:true}),number('speed','语速',1,.25,4)]},
  gsvi:{name:'GPT-SoVITS 兼容接口（GSVI）',auth:'optional',fields:[address('http://127.0.0.1:8000'),field('version','接口版本','v4',{required:true,pattern:'^v[0-9]+$'}),voice('','角色名'),field('promptLang','参考语言','中文',{required:true}),field('language','朗读语言','中文',{required:true}),field('emotion','情绪','默认',{required:true})]},
  genie:{name:'Genie TTS',help:'需要 Python 3.11+、genie-tts 和 Genie ONNX 模型。',fields:[voice('mika','角色名'),field('modelDir','ONNX 模型目录','',{required:true}),field('language','语言','Japanese',{required:true}),field('reference','参考音频路径（可选）'),field('prompt','参考文本（可选）')]},
};

const VOICE_CONTROLS = {
  voiceEnabled: false,
  voiceTiming: 'fast',
  voiceLipSync: true,
  voiceMouthGain: 1,
  voiceVolume: 1,
};

const MOUTH_GAIN = { min: 0.5, max: 3, step: 0.1 };

function normalizeVoiceControls(value) {
  const bounded = (number, min, max, fallback) =>
    Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  return {
    voiceEnabled: value?.voiceEnabled === true,
    voiceTiming: value?.voiceTiming === 'sync' ? 'sync' : 'fast',
    voiceLipSync: value?.voiceLipSync !== false,
    voiceMouthGain: bounded(value?.voiceMouthGain, MOUTH_GAIN.min, MOUTH_GAIN.max, 1),
    voiceVolume: bounded(value?.voiceVolume, 0, 1, 1),
  };
}

const PLANNER_PROVIDERS = {
  openai: { name: 'OpenAI', endpoint: 'https://api.openai.com/v1', keyRequired: true },
  deepseek: { name: 'DeepSeek', endpoint: 'https://api.deepseek.com', keyRequired: true },
  dashscope: { name: '阿里云百炼', english: 'Alibaba Cloud Model Studio', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1', keyRequired: true },
  siliconflow: { name: '硅基流动', english: 'SiliconFlow', endpoint: 'https://api.siliconflow.cn/v1', keyRequired: true },
  gemini: { name: 'Google Gemini', endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai', keyRequired: true },
  openrouter: { name: 'OpenRouter', endpoint: 'https://openrouter.ai/api/v1', keyRequired: true },
  ollama: { name: 'Ollama（本机）', english: 'Ollama (local)', endpoint: 'http://127.0.0.1:11434/v1', keyRequired: false },
  custom: { name: '自定义兼容接口', english: 'Custom compatible API', endpoint: '', keyRequired: false },
};

const MiB = 1024 * 1024;

// Shared by the panel's uploader and the receiving World.
const FIGURE_IMPORT = Object.freeze({
  zip: 32 * MiB,
  folder: 512 * MiB,
  files: 20000,
  file: 4 * MiB,
  chunk: 2 * MiB,
  batch: 8 * MiB,
  // The legacy single-request folder format also includes path and length records.
  bundle: 40 * MiB,
});

﻿export const WARDROBE_SLOTS = [
  {slot:'outfit',id:'lookoutfit',name:'装扮',en:'Outfit'},
  {slot:'parts',id:'lookparts',name:'部件',en:'Parts'},
  {slot:'accessories',id:'lookaccessories',name:'配饰',en:'Accessories'},
];

// Preserve legacy axis/option IDs so existing picks survive the next save.
// 内置三栏固定在最前；其余分组（自定义）按原顺序追加在后面。
function fixedWardrobeGroups(groups=[]) {
  if(!Array.isArray(groups))throw Error('装扮分组无效');
  const assigned=new Map(),waiting=[],custom=[];
  for(const group of groups){
    if(!group||typeof group!=='object'||!Array.isArray(group.options))throw Error('装扮分组无效');
    if(group.custom&&!group.slot){custom.push(group);continue;}
    const slot=group.slot?WARDROBE_SLOTS.find(s=>s.slot===group.slot):WARDROBE_SLOTS.find(s=>s.name===group.name||s.en===group.name);
    if(group.slot&&!slot)throw Error('装扮栏位无效');
    if(slot){if(assigned.has(slot.slot))throw Error('装扮栏位重复');assigned.set(slot.slot,group);}
    else waiting.push(group);
  }
  // 老包可能没有 slot 字段：按顺序补进空着的内置栏。
  for(const slot of WARDROBE_SLOTS)if(!assigned.has(slot.slot)&&waiting.length)assigned.set(slot.slot,waiting.shift());
  custom.push(...waiting);

  const used=new Set();
  const unique=base=>{let id=base,n=1;while(used.has(id))id=`${base}${n++}`;used.add(id);return id;};

  const out=[];
  for(const slot of WARDROBE_SLOTS){
    const group=assigned.get(slot.slot);
    const id=unique(group?.id||slot.id);
    out.push({id,slot:slot.slot,name:slot.name,options:(group?.options||[]).map(o=>({...o}))});
  }
  for(const group of custom){
    if(!group.options.length&&!String(group.name||'').trim())continue;
    const id=unique(String(group.id||'').trim()||`custom${out.length+1}`);
    out.push({
      id,
      custom: true,
      name:String(group.name||id),
      ...(group.en?{en:String(group.en)}:{}),
      options:group.options.map(o=>({...o})),
    });
  }
  return out;
}

const BODY_CROP_DEFAULT = Object.freeze({mode:'full', edge:'flat', line:.6, curve:1, feather:.05, transition:.24});
const BODY_CROP_AXIS = 'figureframing';
const BODY_CROP_OPTIONS = Object.freeze({full:'figurefullframe', upper:'figureupperframe'});

function normalizeBodyCrop(value) {
  const between = (input, fallback, min, max) => Number.isFinite(input) ? Math.max(min, Math.min(max, input)) : fallback;
  return {
    mode: value?.mode === 'upper' ? 'upper' : 'full',
    edge: value?.edge === 'round' ? 'round' : 'flat',
    line: between(value?.line, BODY_CROP_DEFAULT.line, .2, .95),
    curve: between(value?.curve, BODY_CROP_DEFAULT.curve, 0, 2),
    feather: between(value?.feather, BODY_CROP_DEFAULT.feather, 0, .25),
    transition: between(value?.transition, BODY_CROP_DEFAULT.transition, 0, 1.2),
  };
}

function bodyCropForScheme(value, scheme) {
  const crop = normalizeBodyCrop(value);
  if (!value) return crop;
  for (const option of String(scheme ?? '').split('-')) {
    if (option === BODY_CROP_OPTIONS.full) crop.mode = 'full';
    if (option === BODY_CROP_OPTIONS.upper) crop.mode = 'upper';
  }
  return crop;
}

function cropGeometry([x0,y0,x1,y1], config, floor = 256) {
  const height = y1 - y0, width = x1 - x0;
  const center = (x0 + x1) / 2, halfWidth = Math.max(.5, width / 2);
  const upper = config.mode === 'upper';
  const cut = upper ? y0 + height * config.line : y1;
  const roundDepth = Math.min(height * .12, width * .18, (cut - y0) * .3);
  const depth = upper && config.edge === 'round'
    ? Math.min(roundDepth * (config.curve ?? BODY_CROP_DEFAULT.curve), (cut - y0) * .5) : 0;
  const featherPx = upper ? Math.min(height * config.feather, cut - y0 - depth) : 0;
  return {x0,y0,x1,y1,cut,center,halfWidth,depth,featherPx,shift:upper ? floor - cut : 0};
}

function cropEdgeAt(geometry, x) {
  const distance = Math.min(1, Math.abs((x - geometry.center) / geometry.halfWidth));
  return geometry.cut - geometry.depth * distance ** 2;
}

function cropFeatherAlpha(fraction, width) {
  if (width <= 0) return 1;
  const contact = Math.min(1, fraction * width / Math.min(width, 4));
  const smooth = n => n * n * (3 - 2 * n);
  return .52 * smooth(contact) + .48 * smooth(fraction);
}

function blendCropGeometry(from, to, progress) {
  const amount = progress * progress * (3 - 2 * progress);
  const mix = key => from[key] + (to[key] - from[key]) * amount;
  const cut = mix('cut'), depth = mix('depth');
  // Fade the moving edge even when the saved final edge is sharp.
  const edgeFade = Math.min((to.y1 - to.y0) * .045, Math.abs(to.cut - from.cut) * .16)
    * 4 * progress * (1 - progress);
  const featherPx = Math.min(Math.max(0, cut - depth - to.y0), mix('featherPx') + edgeFade);
  return { ...to, cut, depth, featherPx, shift:mix('shift') };
}

const GAZE_SPEED_MIN = .25;
const GAZE_SPEED_MAX = 2.5;
const GAZE_SPEED_STEP = .05;

function normalizeGazeConfig(value) {
  const speed = Number.isFinite(value?.speed)
    ? Math.max(GAZE_SPEED_MIN, Math.min(GAZE_SPEED_MAX, value.speed)) : 1;
  return { enabled: value?.enabled !== false, speed };
}

// Shared by the editor, catalog validation and packaged player.
const MAX_EXPRESSIONS = 8;
const bindingResourceIds = b => [b.resource, ...(b.overlays || []), b.release].filter(Boolean);
function expressionTracks(resources) {
  const channels = new Map();
  for (const resource of resources) {
    const data = resource.raw || resource.data;
    const parameters = data?.Parameters || resource.parameters || [];
    for (const p of parameters) {
      const id = p.Id ?? p.id, value = Number(p.Value ?? p.value), blend = p.Blend ?? p.blend ?? 'Add';
      if (typeof id !== 'string' || !Number.isFinite(value) || !['Add','Multiply','Overwrite'].includes(blend)) throw Error('表情参数无效');
      const old = channels.get(id) || {id, target:'Parameter', blend:'Affine', scale:1, value:0, owner:resource.title || resource.id};
      if (blend === 'Overwrite') {
        if (old.operations && (old.overwrite === undefined || old.overwrite !== value)) throw Error(`「${resource.title || resource.id}」与「${old.owner}」冲突：${id}`);
        old.overwrite = value; old.scale = 0; old.value = value;
      } else {
        if (old.overwrite !== undefined) throw Error(`「${resource.title || resource.id}」与「${old.owner}」冲突：${id}`);
        if (blend === 'Multiply') old.scale *= value;
        else old.value += value;
      }
      old.operations = true;
      if (!Number.isFinite(old.scale) || !Number.isFinite(old.value)) throw Error('表情组合超出数值范围');
      channels.set(id, old);
    }
  }
  // Cubism expression semantics: (base + additive) * multiply.
  return [...channels.values()].map(t=>({...t,value:t.overwrite===undefined?t.value*t.scale:t.value}));
}
function validateExpressionOverlays(catalog, resource, overlays = []) {
  if (!Array.isArray(overlays) || overlays.length >= MAX_EXPRESSIONS || overlays.some(id => typeof id !== 'string') || new Set([resource,...overlays]).size !== overlays.length+1) throw Error('表情组合无效，最多选择 8 个不同效果');
  if (!overlays.length) return [];
  const selected = [resource,...overlays].map(id => catalog.resources.find(r => r.id === id));
  if (selected.some(r => !r || r.kind !== 'expression' || r.classification === 'appearance')) throw Error('组合只接受可绑定的原生表情');
  expressionTracks(selected);
  return [...overlays].sort();
}

const figurePreviewChoices = t => [['1024','1024 px'],['2048','2048 px'],['unlimited',t('无上限','Unlimited')]];

function openFigureDialog(parent, title, body, { closeLabel, variant = '', onClose, returnFocus, locked = () => false } = {}) {
  const doc = parent.ownerDocument;
  const previous = doc.activeElement;
  const dialog = doc.createElement('dialog');
  dialog.className = `l2d-modal l2d-popup ${variant}`.trim();
  dialog.setAttribute('aria-label', title);
  dialog.setAttribute('aria-modal', 'true');
  const card = doc.createElement('div'); card.className = 'l2d-popup-card';
  const head = doc.createElement('header'); head.className = 'l2d-popup-head';
  const heading = doc.createElement('h3'); heading.textContent = title;
  const close = doc.createElement('button'); close.type = 'button';
  close.className = 'l2d-btn quiet l2d-modal-close'; close.textContent = '×';
  close.setAttribute('aria-label', closeLabel || 'Close');
  const content = doc.createElement('div'); content.className = 'l2d-popup-body';
  let closed = false;
  function dispose() {
    if (closed) return;
    closed = true;
    dialog.close(); dialog.remove();
    onClose?.();
    const target = typeof returnFocus === 'function' ? returnFocus() : returnFocus ?? previous;
    if (target?.isConnected) target.focus?.({preventScroll:true});
  }
  const requestClose = () => { if (!locked()) dispose(); };
  close.addEventListener('click', requestClose);
  // Keep Escape inside this layer so a host drawer beneath it keeps its draft.
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    event.preventDefault(); event.stopPropagation(); requestClose();
  });
  dialog.addEventListener('cancel', event => {
    event.preventDefault(); event.stopPropagation(); requestClose();
  });
  dialog.addEventListener('click', event => { if (event.target === dialog) requestClose(); });
  content.append(body); head.append(heading, close); card.append(head, content); dialog.append(card);
  parent.append(dialog); dialog.showModal(); close.focus({preventScroll:true});
  return {el:dialog,dispose};
}

// A host overlay outside showModal() is inert. Keep discard confirmation in the same top layer.
function bindingDiscardPrompt(parent,zh=true,options={}) {
  const doc=parent.ownerDocument,previous=doc.activeElement,t=(a,b)=>zh?a:b;
  const prompt=doc.createElement('dialog');prompt.className='l2d-modal l2d-bind-discard';
  prompt.setAttribute('aria-label',options.title||t('放弃未保存的绑定？','Discard unsaved bindings?'));
  const card=doc.createElement('div');card.className='l2d-modal-card';
  const title=doc.createElement('div');title.className='l2d-modal-title';title.textContent=prompt.getAttribute('aria-label');
  const body=doc.createElement('p');body.className='l2d-bind-discard-text';body.textContent=options.body||t('本次未保存的修改会丢失，已保存的绑定不受影响。','Unsaved changes will be lost. Saved bindings are kept.');
  const actions=doc.createElement('div');actions.className='l2d-dialog-actions';
  const keep=doc.createElement('button'),discard=doc.createElement('button');keep.className='l2d-btn';discard.className='l2d-btn primary';
  keep.textContent=options.cancel||t('继续编辑','Keep editing');discard.textContent=options.accept||t('放弃修改','Discard changes');
  let done=false,resolve;const result=new Promise(r=>{resolve=r;});
  const settle=value=>{if(done)return;done=true;prompt.close();prompt.remove();if(parent.isConnected&&parent.open)previous?.focus?.();resolve(value);};
  keep.onclick=()=>settle(false);discard.onclick=()=>settle(true);
  prompt.addEventListener('cancel',e=>{e.preventDefault();e.stopPropagation();settle(false);});
  prompt.addEventListener('click',e=>{e.stopPropagation();if(e.target===prompt)settle(false);});
  prompt.addEventListener('close',()=>settle(false));
  actions.append(keep,discard);card.append(title,body,actions);prompt.append(card);parent.append(prompt);prompt.showModal();keep.focus();
  return {result,dispose:()=>settle(false)};
}

async function openBindingEditor(ctx,method,args,onSaved,onClosed) {
  const doc=ctx.root.ownerDocument,win=doc.defaultView,zh=String(ctx.language||'zh').startsWith('zh'),t=(a,b)=>zh?a:b;
  const studio=ctx.studio;
  const names={neutral:'中性',happy:'开心',wink:'眨眼',love:'喜欢',shy:'害羞',surprised:'惊讶',angry:'生气',sad:'难过',sleepy:'困倦',thinking:'思考',smug:'得意',pout:'嘟嘴',worried:'担心',determined:'坚定',flustered:'慌乱',scared:'害怕',excited:'兴奋',cry:'哭泣',confused:'疑惑',idle:'待机',nod:'点头',shake:'摇头',wave:'挥手',bow:'鞠躬',cheer:'欢呼',dance:'跳舞',jump:'跳跃',sit:'坐下',stretch:'伸展',shiver:'发抖'};
  const label=w=>zh?names[w]||w:w;
  const el=(tag,cls,text)=>{const n=doc.createElement(tag);n.className=cls||'';if(text!=null)n.textContent=text;return n;};
  const previous=doc.activeElement;
  const requestedToken=win.crypto?.randomUUID?.();
  if(requestedToken)ctx.notifyOnUnmount?.('manualClose',[requestedToken]);
  const modal=el('dialog','l2d-modal l2d-bind-modal'+(studio?' figure-studio-dialog':''));modal.setAttribute('aria-label',t('动作与装扮','Actions and wardrobe'));
  const card=el('div','l2d-bind-card'),head=el('div','l2d-modal-head'),heading=el('div','l2d-modal-heading');
  heading.append(el('div','l2d-modal-title',t('动作与装扮','Actions and wardrobe')),el('div','l2d-modal-sub',t('选择表情或动作，可预览效果','Choose a target and preview its effect')));
  const close=el('button','l2d-btn quiet l2d-modal-close','×');close.setAttribute('aria-label',t('关闭动作与装扮','Close editor'));head.append(heading,close);
  const layout=el('div','l2d-bind-layout'),left=el('nav','l2d-bind-targets'),stage=el('section','l2d-bind-stage'),right=el('section','l2d-bind-resources');
  left.setAttribute('aria-label',t('绑定目标','Binding targets'));right.setAttribute('aria-label',t('原生资源','Native resources'));
  const gallery=el('div','l2d-bind-gallery');gallery.setAttribute('aria-label',t('模型效果对照','Model comparison'));gallery.setAttribute('aria-live','polite');
  const hint=el('p','l2d-bind-status',t('准备预览…','Preparing preview…'));hint.setAttribute('role','status');
  const toolbar=el('div','l2d-bind-toolbar'),raw=el('button','l2d-btn sm',t('完整效果','Full effect')),replay=el('button','l2d-btn sm',studio?t('重播','Replay'):t('重新取样','Resample')),reset=el('button','l2d-btn sm',t('查看组合','View combination'));
  const previewModes=studio?el('div','figure-preview-modes'):raw;
  const playbackControls=studio?el('div','figure-playback-controls'):null;
  const returnPreview=studio?el('button','l2d-btn quiet sm figure-preview-return',t('结束试看','End preview')):null;
  const full=studio?el('button','l2d-btn sm',t('完整','Combined')):null;
  if(studio){
    previewModes.setAttribute('role','group');previewModes.setAttribute('aria-label',t('预览模式','Preview mode'));
    raw.textContent=t('原生','Native');raw.title=t('只看模型自带的效果','Model effects only');
    full.title=t('按安装后的播放设置预览','Preview the installed playback settings');
    const modeButtons=el('div','figure-preview-mode-buttons');
    modeButtons.append(raw,full);
    previewModes.append(el('span','figure-preview-mode-label',t('预览模式','Preview mode')),modeButtons);
    playbackControls.append(replay);
    returnPreview.hidden=true;
  }
  const retry=el('button','l2d-btn sm l2d-bind-retry',t('重试预览','Retry preview'));retry.hidden=true;
  const resolutionLabel=el('label','l2d-bind-quality',t('预览精度','Preview size')),resolution=el('select','l2d-input');resolution.setAttribute('aria-label',t('预览精度','Preview resolution'));
  for(const [value,label] of figurePreviewChoices(t)){const option=el('option',null,label);option.value=value;resolution.append(option);}
  resolutionLabel.append(resolution);
  const leftShell=el('div','l2d-bind-left'),pages=el('div','l2d-bind-pages');pages.setAttribute('role','tablist');pages.setAttribute('aria-label',t('编辑页面','Editor pages'));
  const groupTools=el('div','l2d-wardrobe-tools');
  const newGroup=el('button','l2d-btn sm l2d-bind-newgroup',t('＋ 新建分组','＋ New group'));
  newGroup.type='button';newGroup.setAttribute('aria-haspopup','dialog');
  groupTools.hidden=true;
  groupTools.append(el('h3',null,t('分组','Groups')),newGroup);
  leftShell.append(pages,groupTools,left);
  stage.append(gallery);
  if(studio){
    const caption=el('div','figure-preview-caption');
    caption.append(hint,returnPreview,retry);
    toolbar.append(playbackControls,previewModes);
    stage.append(caption,toolbar);
  }else{
    toolbar.append(previewModes,replay,reset,resolutionLabel,retry);
    stage.append(hint,toolbar);
  }
  let editorNavigation;
  function showEditorPane(next) {
    if (!editorNavigation) return;
    layout.dataset.editorPane = next;
    for (const control of editorNavigation.children) {
      control.setAttribute('aria-pressed', String(control.dataset.pane === next));
    }
  }
  if (studio) {
    editorNavigation = el('div','figure-editor-navigation');
    editorNavigation.setAttribute('role','group');
    editorNavigation.setAttribute('aria-label',t('编辑面板','Editor panes'));
    for (const [key, name, target] of [
      ['targets', t('绑定目标','Binding targets'), leftShell],
      ['resources', t('原生资源','Native resources'), right],
    ]) {
      target.id = `figure-studio-${key}`;
      const control = el('button','l2d-btn sm',name);
      control.type = 'button';
      control.dataset.pane = key;
      control.setAttribute('aria-controls', target.id);
      control.onclick = () => showEditorPane(key);
      editorNavigation.append(control);
    }
    layout.append(editorNavigation);
    showEditorPane('targets');
  }
  layout.append(leftShell,stage,right);
  studio?.mount({stage,gallery,toolbar,playbackControls,resolutionLabel,onFailure(message){
    if(closed)return;
    hint.textContent=t('预览失败。','Preview failed. ')+message;
    retry.hidden=false;
  }});
  const footer=el('div','l2d-bind-footer'),summary=el('span','l2d-bind-summary',t('未绑定的项目使用通用配方','Unbound targets use generic recipes'));
  const footInfo=el('div','l2d-bind-footinfo');
  const saveStatus=el('span','l2d-bind-save-status');
  saveStatus.setAttribute('role','status');
  saveStatus.hidden=true;
  footInfo.append(summary,saveStatus);
  const saveStages=[
    ['check',t('检查绑定','Checking bindings')],
    ['pack',t('打包形象','Building figure pack')],
    ['images',t('处理预览图片','Preparing preview images')],
    ['commit',t('保存到模型卡','Saving to the model card')],
  ];
  const saveProgress=el('div','l2d-bind-save-progress');
  saveProgress.setAttribute('role','progressbar');
  saveProgress.setAttribute('aria-label',t('保存进度','Save progress'));
  saveProgress.setAttribute('aria-valuemin','0');
  saveProgress.setAttribute('aria-valuemax',String(saveStages.length));
  saveProgress.hidden=true;
  for(const _ of saveStages)saveProgress.append(el('span'));
  const cancel=el('button','l2d-btn',t('取消','Cancel')),save=el('button','l2d-btn primary l2d-bind-save',t('保存绑定','Save bindings'));save.disabled=true;
  const restoreAll=el('button','l2d-btn quiet sm',t('全部恢复通用','Reset all to generic'));restoreAll.disabled=true;
  const skipImages=el('button','l2d-btn',t('跳过图片','Skip images'));skipImages.hidden=true;
  footer.append(saveProgress,footInfo,restoreAll,cancel,skipImages,save);card.append(head,layout,footer);modal.append(card);ctx.root.append(modal);modal.showModal();
  let closed=false,saving=false,saveSequence=0,skippingImages=false,dirty=false,data,bindings=[],word='happy',resource=null,rawMode=!!studio,serial=0,previewTimer,sampleSet=0,discardPrompt=null,leaseTimer,sessionValid=true,previewDialog=null;
  let saveStage=-1,saveProgressTimer;
  let connected=true;
  let combinationError='',pendingCombination=null,auditionNativeOnly=false;
  let page='actions',groups=[],picks={},groupId=null,optionId='default',optionNameDraft=null,closeGroupDialog;
  const pageState={actions:{resource:null,filter:'all',search:'',scroll:0},wardrobe:{resource:null,filter:'all',search:'',scroll:0}};
  const uid=prefix=>prefix+(win.crypto?.randomUUID?.().replaceAll('-','')||Math.random().toString(16).slice(2)).slice(0,12);
  const signature=items=>JSON.stringify(items.map(({word,resource,overlays=[],release,nativeOnly})=>({word,resource,overlays:[...overlays].sort(),...(release?{release}:{}),...(nativeOnly?{nativeOnly:true}:{})})).sort((a,b)=>a.word.localeCompare(b.word)));
  const canEdit=()=>!!data&&sessionValid&&connected&&!saving;
  const canSave=()=>canEdit()&&(!data.buildId||dirty||data.wardrobeNeedsSave);
  const syncPreviewMode=()=>{
    raw.setAttribute('aria-pressed',String(rawMode));
    if(full)full.setAttribute('aria-pressed',String(!rawMode));
    else raw.textContent=rawMode?t('原生效果','Native only'):t('完整效果','Full effect');
  };
  function syncPreviewControls(){
    if(!studio){previewModes.hidden=page==='wardrobe';return;}
    const current=bindings.find(item=>item.word===word);
    const preview=page==='actions'?(resource??data?.resources.find(item=>item.id===current?.resource)):null;
    previewModes.hidden=!preview;
    replay.hidden=preview?.kind!=='motion';
    returnPreview.hidden=page!=='actions'||!resource;
  }
  function paintSaveProgress(){
    saveProgress.hidden=saveStatus.hidden=!saving;
    summary.hidden=saving;
    if(!saving)return;
    if(saveStage<0){
      saveProgress.dataset.pending='';
      saveProgress.removeAttribute('aria-valuenow');
      saveStatus.textContent=t('正在保存绑定…','Saving bindings…');
    }else{
      delete saveProgress.dataset.pending;
      saveProgress.setAttribute('aria-valuenow',String(saveStage));
      saveStatus.textContent=t(
        `${saveStages[saveStage][1]} · 第 ${saveStage+1}/${saveStages.length} 步`,
        `${saveStages[saveStage][1]} · Step ${saveStage+1}/${saveStages.length}`,
      );
    }
    saveProgress.setAttribute('aria-valuetext',saveStatus.textContent);
    [...saveProgress.children].forEach((segment,index)=>{
      segment.dataset.state=index<saveStage?'done':index===saveStage?'active':'pending';
    });
  }
  async function pollSaveProgress(sequence){
    if(!alive()||!saving||sequence!==saveSequence)return;
    try{
      const progress=await ctx.invoke('manualSaveProgress',[data.token]);
      if(!alive()||!saving||sequence!==saveSequence)return;
      const index=saveStages.findIndex(([stage])=>stage===progress?.stage);
      if(index>saveStage){saveStage=index;paintSaveProgress();}
    }catch{}finally{
      if(alive()&&saving&&sequence===saveSequence)saveProgressTimer=win.setTimeout(()=>void pollSaveProgress(sequence),450);
    }
  }
  const syncControls=()=>{
    layout.inert=saving||!connected;pages.inert=saving||!connected;save.disabled=!canSave();close.disabled=cancel.disabled=saving;
    save.textContent=saving?t('保存中…','Saving…'):t('保存绑定','Save bindings');
    save.setAttribute('aria-busy',String(saving));
    paintSaveProgress();
    skipImages.hidden=!saving;skipImages.disabled=skippingImages;
    restoreAll.disabled=!canEdit()||(page==='actions'?!bindings.length:!groups.length);
    restoreAll.textContent=page==='actions'?t('全部恢复通用','Reset all to generic'):t('恢复默认外观','Default appearance');
    groupTools.hidden=page!=='wardrobe';syncPreviewControls();
    reset.textContent=page==='wardrobe'?t('复位预览','Reset preview'):t('查看组合','View combination');
    newGroup.disabled=resolution.disabled=raw.disabled=replay.disabled=reset.disabled=retry.disabled=!canEdit();
    if(full)full.disabled=!canEdit();
    syncPreviewMode();
  };
  const setPreviewBusy=busy=>{gallery.setAttribute('aria-busy',String(busy));gallery.classList.toggle('is-pending',busy);};
  const stopPreviewUpdates=()=>{serial++;win.clearTimeout(previewTimer);setPreviewBusy(false);};
  const sessionError=message=>/编辑已过期|编辑已取消|模型素材已变化|形象包已变化|原打包产物已移除|editor session ended/.test(message);
  const expireSession=message=>{
    sessionValid=false;stopPreviewUpdates();retry.hidden=true;hint.textContent=message;syncControls();paintSelection();
  };
  const changed=()=>{
    dirty=signature(bindings)!==signature(data.bindings||[])||JSON.stringify(groups)!==JSON.stringify(data.wardrobe||[]);
    ctx.stageDraft?.(dirty?structuredClone({bindings,wardrobe:groups}):null);
    syncControls();
  };
  const alive=()=>!closed&&!ctx.signal?.aborted;
  const release=()=>{if(closed)return;closed=true;win.clearInterval(leaseTimer);win.clearTimeout(saveProgressTimer);closeGroupDialog?.();discardPrompt?.dispose();previewDialog?.dispose();leave?.dispose?.();ctx.signal?.removeEventListener('abort',release);stopPreviewUpdates();listResize?.disconnect();studio?.dispose();gallery.replaceChildren();modal.close();modal.remove();onClosed?.();const token=data?.token||requestedToken;if(token&&!ctx.signal?.aborted)ctx.invoke('manualClose',[token]).catch(()=>{});previous?.focus?.({preventScroll:true});};
  const requestClose=async()=>{
    if(closed||saving||discardPrompt)return;
    if(dirty){discardPrompt=bindingDiscardPrompt(modal,zh);const accepted=await discardPrompt.result;discardPrompt=null;if(!accepted||!alive())return;}
    release();
  };
  close.onclick=cancel.onclick=requestClose;modal.addEventListener('cancel',e=>{e.preventDefault();void requestClose();});modal.addEventListener('click',e=>{if(e.target===modal)void requestClose();});
  const leave=ctx.guardLeave?.(()=>alive()&&(dirty||saving)?t('动作绑定尚未保存，确定离开？','Bindings are not saved. Leave?'):null);
  ctx.signal?.addEventListener('abort',release,{once:true});
  const loadPreview=(candidate=false)=>{
    if(!canEdit()||!alive())return;
    const preview=structuredClone(groups),selected={...picks},g=preview.find(g=>g.id===groupId);
    const wardrobeAudition=candidate&&page==='wardrobe'&&g&&resource&&
      resource.id!==g.options.find(o=>o.id===optionId)?.resource&&!resource.wardrobeError&&!wardrobeConflict(resource,g.id);
    if(wardrobeAudition){
      g.options=g.options.slice(0,15);g.options.push({id:'preview',name:resource.title,resource:resource.id});selected[g.id]='preview';
    }
    const current=bindings.find(b=>b.word===word);
    const previewBinding=resource?{resource:resource.id,nativeOnly:resource.kind==='motion'&&auditionNativeOnly}:current;
    const request={page,word,resource:page==='actions'?previewBinding?.resource:null,overlays:page==='actions'?(previewBinding?.overlays||[]):[],nativeOnly:page==='actions'&&previewBinding?.nativeOnly===true,raw:rawMode&&(!studio||!!previewBinding?.resource),bindings:structuredClone(bindings),groups:preview,picks:selected,sampleSet,previewSize:resolution.value==='unlimited'?'unlimited':Number(resolution.value)};
    const description=page==='actions'
      ? (resource?t('单项试看 · ','Single effect · ')+resource.title:current?label(word)+' · '+[current.resource,...(current.overlays||[])].map(id=>data.resources.find(r=>r.id===id)?.title).join(' ＋ '):t('通用表现','Generic behavior'))
      : g?wardrobeGroupName(g)+' · '+(wardrobeAudition?t('试看 ','Previewing ')+resource.title:t('预览 ','Preview ')+wardrobePickName(g)):t('当前装扮','Current appearance');
    const generation=++serial;win.clearTimeout(previewTimer);retry.hidden=true;setPreviewBusy(true);
    hint.textContent=studio?description:t('正在生成对照图，可以继续编辑。','Generating comparison. You can keep editing.');
    previewTimer=win.setTimeout(async()=>{
      try{
        if(studio){
          await studio.play(request);
          if(alive()&&generation===serial)hint.textContent=description;
          return;
        }
        const result=await ctx.invoke('manualPreview',[data.token,request]);if(!alive()||generation!==serial)return;
        if(!Array.isArray(result.frames)||!result.frames.length||result.frames.length>3)throw Error(t('预览图片不完整','Incomplete preview'));
        const labels={default:t('默认','Default'),generic:t('通用表现','Generic'),appearance:t('当前装扮','Current appearance'),native:t('原生效果','Native'),combined:t('完整效果','Full effect')};
        const figures = result.frames.map(item => {
          if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(item.png || '')) throw Error(t('预览图片无效','Invalid preview image'));
          const captionText = (labels[item.kind] || t('对照图','Comparison')) + (item.resource && item.time ? ' · ' + item.time.toFixed(2) + 's' : '');
          const figure = el('figure','l2d-bind-shot');
          const button = el('button','l2d-bind-shot-button'); button.type = 'button';
          button.setAttribute('aria-label', t('放大 ','Enlarge ') + captionText); button.setAttribute('aria-haspopup','dialog');
          const image = el('img'); image.src = item.png; image.alt = '';
          button.addEventListener('click', () => {
            if (closed || previewDialog) return;
            const large = el('img','l2d-large-cover'); large.src = item.png; large.alt = captionText;
            previewDialog = openFigureDialog(modal, captionText, large, {
              closeLabel:t('关闭','Close'), variant:'l2d-image-popup', onClose() { previewDialog = null; },
            });
          });
          button.append(image); figure.append(button, el('figcaption', null, captionText));
          return figure;
        });
        gallery.replaceChildren(...figures);gallery.dataset.count=String(figures.length);gallery.dataset.previewInfo=JSON.stringify({quality:result.quality,frames:result.frames.map(({png,...frame})=>frame)});
        hint.textContent=description;
      }catch(error){
        if(!alive()||generation!==serial)return;
        const message=String(error.message||error);
        if(sessionError(message)){expireSession(message);return;}
        const stale=!studio&&gallery.childElementCount?t('仍显示上次预览。','The previous preview is still shown. '):'';
        hint.textContent=t('预览失败，可继续编辑或降低精度重试。','Preview failed. You can keep editing or retry at a lower resolution. ')+stale+message;
        retry.hidden=false;
      }finally{if(alive()&&generation===serial)setPreviewBusy(false);}
    },studio?0:160);
  };
  const sendWardrobe=(candidate=false)=>loadPreview(candidate);
  const play=()=>loadPreview(true);
  raw.onclick=()=>{rawMode=!!studio||!rawMode;syncPreviewMode();play();};
  if(full)full.onclick=()=>{rawMode=false;syncPreviewMode();play();};
  replay.onclick=()=>{sampleSet=(sampleSet+1)%3;play();};
  resolution.onchange=play;
  reset.onclick=()=>{
    if(page==='wardrobe'){picks={};optionId='default';optionNameDraft=null;}
    resource=null;paintTargets();paintResources();loadPreview();
  };
  if(returnPreview)returnPreview.onclick=()=>{resource=null;paintResources();loadPreview();};
  let filter='all';const search=el('input','l2d-input');search.type='search';search.placeholder=t('搜索原生资源','Search native resources');search.setAttribute('aria-label',search.placeholder);
  const tabs=el('div','l2d-bind-tabs'),list=el('div','l2d-bind-list'),binding=el('div','l2d-bind-selection');
  const resourceCount=el('span','figure-resource-count');
  const resourceTitle=el('h2',null,t('原生资源','Native resources'));
  const previousPage=el('button','l2d-btn sm figure-page-arrow','↑'),nextPage=el('button','l2d-btn sm figure-page-arrow','↓');
  let listResize;
  function updatePaging(){
    previousPage.disabled=list.scrollTop<=1;
    nextPage.disabled=list.scrollTop+list.clientHeight>=list.scrollHeight-1;
  }
  if(studio){
    list.tabIndex=0;list.setAttribute('role','region');list.setAttribute('aria-label',t('原生资源列表','Native resource list'));
    previousPage.title=t('向上滚动一屏','Scroll up one screen');nextPage.title=t('向下滚动一屏','Scroll down one screen');
    previousPage.setAttribute('aria-label',previousPage.title);nextPage.setAttribute('aria-label',nextPage.title);
    const pageBy=direction=>{
      const row=list.firstElementChild?.offsetHeight||44;
      list.scrollTop+=direction*Math.max(row,list.clientHeight-row);
      updatePaging();
    };
    previousPage.onclick=()=>pageBy(-1);nextPage.onclick=()=>pageBy(1);
    list.addEventListener('keydown', event => {
      if (event.key !== 'PageUp' && event.key !== 'PageDown') return;
      event.preventDefault();
      pageBy(event.key === 'PageUp' ? -1 : 1);
    });
    list.addEventListener('scroll',updatePaging,{passive:true});
    if(win.ResizeObserver){listResize=new win.ResizeObserver(updatePaging);listResize.observe(list);}
    const library=el('div','figure-resource-head');
    library.append(resourceTitle,resourceCount,previousPage,nextPage);right.append(library);
  }
  right.append(search,tabs,list,binding);
  const paintTargets=()=>{
    const scroll=left.scrollTop;
    const focus=left.contains(doc.activeElement)?doc.activeElement.dataset.wardrobeFocus:null;
    left.classList.toggle('l2d-wardrobe-nav',page==='wardrobe');
    left.replaceChildren();
    if(page==='wardrobe'){
      paintWardrobeTargets();
      left.scrollTop=scroll;
      if(focus)[...left.querySelectorAll('[data-wardrobe-focus]')].find(node=>node.dataset.wardrobeFocus===focus)?.focus({preventScroll:true});
      return;
    }
    for(const [key,title]of [['expressions',t('表情','Expressions')],['motions',t('动作','Motions')]]){
    left.append(el('h3',null,title));for(const w of data.words[key]){
      const b=el('button','l2d-bind-target'+(w===word?' selected':''));b.type='button';b.setAttribute('aria-pressed',String(w===word));
      const current = bindings.filter(item => item.word === w);
      const saved = (data.bindings || []).filter(item => item.word === w);
      const edited = signature(current) !== signature(saved);
      const status = edited ? t('待保存','Unsaved')
        : current.length ? t(`已绑定 ${1+(current[0].overlays?.length||0)} 项`,'Bound') : t('通用','Generic');
      b.append(el('span',null,label(w)),el('small',edited?'figure-draft-state':null,status));
      b.onclick=()=>{word=w;resource=null;combinationError='';pendingCombination=null;paintTargets();paintResources();play();};left.append(b);
    }
  }};
  const currentIds=()=>{const b=bindings.find(b=>b.word===word);return b?[b.resource,...(b.overlays||[])]:[];};
  const outfitChannels=()=>new Set(groups.flatMap(g=>g.options.flatMap(o=>data.resources.find(r=>r.id===o.resource)?.channels||[])));
  function commitSelection(ids,release,nativeOnly=false){
    if(!canEdit()||discardPrompt)return;
    const primary=data.resources.find(r=>r.id===ids[0]);
    const overlays=primary?validateExpressionOverlays(data,primary.id,ids.slice(1)):[];
    const outfit=outfitChannels();
    if(!nativeOnly&&[...ids,release].some(id=>data.resources.find(r=>r.id===id)?.channels?.some(c=>outfit.has(c))))throw Error(primary?.kind==='motion'&&data.nativeMotionMode?t('与装扮共用参数。可选「完全使用动画」，或调整装扮绑定。','Shares controls with wardrobe. Choose Animation only or adjust the outfit.'):t('与已配置装扮共用参数，请先调整装扮绑定。','Shares controls with wardrobe. Adjust that binding first.'));
    bindings=bindings.filter(b=>b.word!==word);
    if(primary)bindings.push({word,resource:primary.id,...(overlays.length?{overlays}:{}),...(release?{release}:{}),...(nativeOnly?{nativeOnly:true}:{}),confidence:1,reason:'用户在动作编辑器中选择'});
    resource=null;combinationError='';pendingCombination=null;changed();paintTargets();paintResources();play();
  }
  function toggleEffect(item){
    if(!canEdit()||discardPrompt)return;
    const ids=currentIds(),current=data.resources.find(r=>r.id===ids[0]);
    try{if(current?.kind==='motion')throw Error(t('当前绑定为动作，请先恢复通用，再选择表情组合。','Clear the motion binding before selecting expressions.'));commitSelection(ids.includes(item.id)?ids.filter(id=>id!==item.id):[...ids,item.id]);}
    catch(error){combinationError=error.message;pendingCombination=item;paintSelection();}
  }
  const paintSelection=()=>{
    syncPreviewControls();
    binding.classList.toggle('l2d-bind-combination',page==='actions');
    binding.classList.toggle('figure-wardrobe-selection',page==='wardrobe'&&!!studio);
    binding.classList.remove('has-motion-mode');
    if(page==='wardrobe'){paintWardrobeSelection();return;}
    binding.replaceChildren();const current=bindings.find(b=>b.word===word),ids=currentIds();
    const selectedResource=resource??data.resources.find(r=>r.id===current?.resource);
    const motion=selectedResource?.kind==='motion'&&selectedResource.classification!=='appearance'?selectedResource:null;
    const boundMotion=motion&&current?.resource===motion.id;
    const canUseMotion=resource&&motion&&(!boundMotion||motion.classification==='pose');
    const caption=el('p','l2d-combination-title',label(word)+' · ');
    if(motion){
      const state=el('span','l2d-motion-state'+(boundMotion?' is-bound':''),boundMotion?t('已绑定','Bound'):t('待绑定','Unbound'));
      caption.append(state,' ',motion.title);
    }else caption.append(ids.length?t(`已选 ${ids.length} 个效果`,`${ids.length} effects`):t('通用表现','Generic behavior'));
    caption.title=caption.textContent;
    const chips=el('div','l2d-combination-chips');chips.setAttribute('aria-label',t('当前组合','Current combination'));
    const warning=el('div','l2d-combination-warning',combinationError);warning.setAttribute('role','status');
    if(motion&&data.nativeMotionMode){
      binding.classList.add('has-motion-mode');
      const label=el('label','l2d-motion-mode',t('安装后播放','Installed playback'));
      const mode=el('select','l2d-input');
      for(const [value,title] of [['mixed',t('叠加通用表现','Blend generic behavior')],['native',t('完全使用动画','Animation only')]]){
        const option=el('option',null,title);option.value=value;mode.append(option);
      }
      mode.value=(resource?auditionNativeOnly:current?.nativeOnly)?'native':'mixed';
      mode.disabled=!canEdit();
      mode.title=t('完全使用动画时，由原生动作接管模型参数，播完恢复其他表现。','Animation only gives the native motion control of model parameters during playback.');
      mode.onchange=()=>{
        if(!canEdit()||discardPrompt)return;
        const nativeOnly=mode.value==='native';
        rawMode=false;syncPreviewMode();
        if(resource&&!boundMotion){
          auditionNativeOnly=nativeOnly;
          combinationError=warning.textContent='';
          play();
        }else{
          try{commitSelection([motion.id],current.release,nativeOnly);}
          catch(error){combinationError=error.message;paintSelection();}
        }
      };
      label.append(mode);chips.append(label);
    }else{
      for(const id of ids){const item=data.resources.find(r=>r.id===id);const chip=el('button','l2d-btn quiet sm',`${item?.title||id} ×`);chip.type='button';chip.setAttribute('aria-label',t('移除 ','Remove ')+(item?.title||id));chip.disabled=!canEdit();chip.onclick=()=>{try{commitSelection(ids.filter(x=>x!==id),id===current.resource?undefined:current.release);}catch(e){combinationError=e.message;paintSelection();}};chips.append(chip);}
      if(!ids.length){
        const canCombine=data.words.expressions.includes(word)&&data.resources.some(r=>r.kind==='expression'&&r.classification!=='appearance');
        chips.append(el('span','l2d-bind-note',canCombine?t('点名称试看，勾选加入组合','Click a name to preview. Check it to combine.'):t('点动作名称试看，再选择「使用此动作」','Preview an animation, then choose Use this motion.')));
      }
    }
    const actions=el('div','l2d-combination-actions');
    if(pendingCombination&&combinationError.includes('冲突')){
      const replace=el('button','l2d-btn sm',t('替换冲突项','Replace conflicting effects'));
      replace.onclick=()=>{const item=pendingCombination;const keep=ids.filter(id=>{try{validateExpressionOverlays(data,id,[item.id]);return true;}catch{return false;}});try{commitSelection([...keep,item.id]);}catch(e){combinationError=e.message;paintSelection();}};actions.append(replace);
    }else if(canUseMotion){
      const use=el('button','l2d-btn primary l2d-use-motion',t('使用此动作','Use this motion'));use.type='button';let select;
      if(resource.classification==='pose'){
        select=el('select','l2d-input');select.setAttribute('aria-label',t('复位动作','Reset motion'));select.append(el('option',null,t('请选择复位动作','Choose reset motion')));select.firstChild.value='';
        for(const r of data.resources.filter(r=>r.kind==='motion'&&r.classification!=='appearance'&&r.id!==resource.id)){const o=el('option',null,r.title);o.value=r.id;select.append(o);}select.value=(current?.resource===resource.id&&current.release)||resource.release||'';actions.append(select);
      }
      use.disabled=!canEdit()||!!select&&!select.value;if(select)select.onchange=()=>use.disabled=!canEdit()||!select.value;
      use.onclick=()=>{
        if(!canEdit()||discardPrompt)return;
        try{
          commitSelection([resource.id],select?.value,auditionNativeOnly);
          const result=binding.querySelector('.l2d-combination-title');
          if(result){result.tabIndex=-1;result.focus({preventScroll:true});}
        }catch(e){combinationError=e.message;paintSelection();}
      };actions.append(use);
    }else if(resource&&!studio){
      const view=el('button','l2d-btn sm',t('结束单项试看','End audition'));view.disabled=!canEdit();view.onclick=()=>{resource=null;paintResources();play();};actions.append(view);
    }
    if(current||!canUseMotion){
      const restore=el('button','l2d-btn quiet sm',t('恢复通用','Use generic'));restore.disabled=!canEdit()||!current;restore.onclick=()=>{if(!discardPrompt)commitSelection([]);};actions.append(restore);
    }
    binding.append(caption,chips,warning,actions);paintSummary();
  };
  const paintResources=(scroll=list.scrollTop)=>{list.replaceChildren();const q=search.value.trim().toLocaleLowerCase(),ids=currentIds();
    const saved = (data.bindings || []).find(item => item.word === word);
    const savedIds = new Set(saved ? [saved.resource, ...(saved.overlays || [])] : []);
    const activeGroup=page==='wardrobe'?groups.find(g=>g.id===groupId):null;
    const assignedResource=activeGroup?.options.find(o=>o.id===optionId)?.resource;
    const canCombine=page==='actions'&&data.words.expressions.includes(word);
    const combiningExpressions=canCombine&&ids.length>0&&data.resources.find(r=>r.id===ids[0])?.kind==='expression';
    const outfit=canCombine?outfitChannels():null;
    const selectedChannels=new Set(combiningExpressions?ids.flatMap(id=>data.resources.find(r=>r.id===id)?.channels||[]):[]);
    resourceTitle.textContent=activeGroup?t(`为${wardrobeGroupName(activeGroup)}选资源`,`Resources for ${wardrobeGroupName(activeGroup)}`):t('原生资源','Native resources');
    resourceTitle.title=resourceTitle.textContent;
    const resources=data.resources.filter(r=>(page!=='wardrobe'||!r.wardrobeError)&&(filter==='all'||filter==='other'?filter!=='other'||r.classification==='appearance':r.kind===filter)&&(!q||r.title.toLocaleLowerCase().includes(q)));
    for(const r of resources){
      const assigned=assignedResource===r.id;
      const audition=r.id===resource?.id&&!assigned;
      const blocked=audition&&activeGroup&&wardrobeConflict(r,activeGroup.id);
      const selected=page==='actions'&&ids.includes(r.id);
      const combinable=canCombine&&r.kind==='expression'&&r.classification!=='appearance';
      let constraint='',detail='',canReplace=false;
      if(combinable&&!selected){
        if(r.channels?.some(channel=>outfit.has(channel))){
          constraint=t('装扮冲突','Outfit conflict');
          detail=t('这个表情与已配置的装扮共用参数。','This expression shares parameters with a configured outfit.');
        }else if(combiningExpressions){
          try{validateExpressionOverlays(data,ids[0],[...ids.slice(1),r.id]);}
          catch(error){
            canReplace=error.message.includes('冲突');
            constraint=ids.length>=MAX_EXPRESSIONS?t('组合已满','Combination full'):canReplace?t('参数冲突','Parameter conflict'):t('无法组合','Cannot combine');
            detail=zh?error.message:constraint;
            if(canReplace)detail+='\n'+t('勾选可查看替换选项。','Check to see replacement options.');
          }
        }
      }
      const overlap=combinable&&!selected&&!constraint&&r.channels?.some(channel=>selectedChannels.has(channel));
      if(overlap)detail=t('与已选表情共用参数，仍可加入组合。','Shares parameters with selected expressions and can still be combined.');
      const rowHint=constraint||(overlap?t('参数重叠','Shared parameters'):'');
      const row=el('div','l2d-bind-resource-row');
      if(studio){row.classList.toggle('is-selected',selected);row.classList.toggle('is-audition',audition);row.classList.toggle('is-assigned',assigned);}
      const b=el('button','l2d-bind-resource'+(!studio&&(page==='actions'?selected:audition)?' selected':'')+(!studio&&audition?' audition':''));b.type='button';
      const kind=page==='wardrobe'?(r.kind==='expression'?t('外观状态','Appearance'):t('动作末帧','Final frame')):r.classification==='appearance'?t('仅试看','Preview only'):r.kind==='expression'?t('表情','Expression'):t(`${r.seconds.toFixed(1)} 秒`,`${r.seconds.toFixed(1)} s`);
      b.title=detail?`${r.title}\n${detail}`:r.title;
      b.dataset.audition=r.id;
      if(audition)b.setAttribute('aria-current','true');
      const draft = selected && !savedIds.has(r.id);
      const boundLabel = draft ? t('待保存','Unsaved') : t('已绑定','Bound');
      const status = blocked ? t('参数冲突','Conflict')
        : [audition && t('试看中','Previewing'), (selected || assigned) && boundLabel].filter(Boolean).join(' · ');
      const statusClass = constraint ? 'l2d-bind-constraint' : draft ? 'figure-draft-state'
        : overlap ? 'l2d-bind-overlap' : studio && status ? 'figure-audition-label' : null;
      b.append(el('span',null,r.title),el('small',statusClass,rowHint||(studio&&status)||kind));
      b.onclick=()=>{
        const refocus=studio&&doc.activeElement===b;
        if(page==='actions'&&resource?.id!==r.id)auditionNativeOnly=bindings.some(item=>item.word===word&&item.resource===r.id&&item.nativeOnly);
        resource=r;combinationError='';pendingCombination=null;paintResources();play();
        if(refocus)[...list.querySelectorAll('[data-audition]')].find(node=>node.dataset.audition===r.id)?.focus({preventScroll:true});
      };
      row.append(b);
      if(combinable){
        const check=el('input','l2d-bind-effect-check');check.type='checkbox';check.checked=selected;check.disabled=!canEdit()||!!constraint&&!canReplace;check.dataset.resource=r.id;check.setAttribute('aria-label',t('组合：','Combine: ')+r.title);
        if(rowHint){check.setAttribute('aria-label',`${check.getAttribute('aria-label')} · ${rowHint}`);check.title=detail;}
        check.onchange=()=>{toggleEffect(r);const next=[...list.querySelectorAll('input')].find(n=>n.dataset.resource===r.id);if(next){next.checked=currentIds().includes(r.id);next.focus({preventScroll:true});}};
        if(studio){const hit=el('label','figure-check-hit');hit.append(check);row.append(hit);}
        else row.append(check);
      }list.append(row);
    }
    if(!resources.length)list.append(el('p','l2d-bind-empty',t('没有匹配的资源','No matching resources')));
    list.scrollTop=scroll;
    resourceCount.textContent=t(`${resources.length} 项`,`${resources.length} items`);
    paintSelection();
    updatePaging();
  };
  function paintSummary(){const used=groups.filter(g=>g.options.length).length;const total=groups.length||3;summary.textContent=t(`${bindings.length} 项绑定 · 外观 ${used}/${total} 栏 · 保存后从卡片安装`,`${bindings.length} bindings · ${used}/${total} appearance slots · save then install`);}
  function wardrobeConflict(r,id){
    const ids=[...bindings.filter(b=>!b.nativeOnly).flatMap(bindingResourceIds),...groups.filter(g=>g.id!==id).flatMap(g=>g.options.map(o=>o.resource))];
    const used=new Set(ids.flatMap(id=>data.resources.find(r=>r.id===id)?.channels||[]));return (r?.channels||[]).some(c=>used.has(c));
  }
  function wardrobeGroupName(group) {
    return zh ? group.name : group.en || WARDROBE_SLOTS.find(slot=>slot.slot===group.slot)?.en || group.name;
  }
  function wardrobePickName(group) {
    return group.options.find(option=>option.id===picks[group.id])?.name || t('默认','Default');
  }
  function selectWardrobeOption(group,id) {
    groupId=group.id;
    optionId=id;
    optionNameDraft=null;
    const resourceId=group.options.find(option=>option.id===id)?.resource;
    resource=data.resources.find(item=>item.id===resourceId)||null;
  }
  function refreshWardrobe() {
    paintTargets();
    paintResources();
    sendWardrobe();
  }
  function paintWardrobeTargets(){
    const navigation=el('div','l2d-wardrobe-groups');
    navigation.setAttribute('role','group');
    navigation.setAttribute('aria-label',t('装扮分组','Appearance groups'));
    left.append(navigation);
    for(const g of groups){
      const title=wardrobeGroupName(g),pick=wardrobePickName(g),active=g.id===groupId;
      const row=el('div','l2d-bind-grow'+(g.custom?' is-custom':''));
      const header=el('button','l2d-bind-group'+(active?' selected':''));
      header.type='button';
      header.dataset.wardrobeFocus='group-'+g.id;
      header.setAttribute('aria-pressed',String(active));
      header.setAttribute('aria-label',t(`${title}，预览 ${pick}`,`${title}, previewing ${pick}`));
      header.title=header.getAttribute('aria-label');
      header.disabled=!canEdit();
      header.append(el('span','l2d-wardrobe-group-name',title),el('small','l2d-wardrobe-group-pick',pick));
      header.onclick=()=>{
        if(active||!canEdit()||discardPrompt)return;
        selectWardrobeOption(g,picks[g.id]||'default');
        refreshWardrobe();
      };
      row.append(header);
      if(g.custom){
        const del=el('button','l2d-bind-groupdel','×');del.type='button';del.title=t('删除分组','Delete group');del.setAttribute('aria-label',t('删除分组 '+g.name,'Delete group '+g.name));
        del.onclick=async event=>{
          event.stopPropagation();
          if(!canEdit()||discardPrompt)return;
          discardPrompt=bindingDiscardPrompt(modal,zh,{
            title:t('删除分组？','Delete group?'),
            body:t(`「${g.name}」以及它的所有选项都会被移除。`,`“${g.name}” and all its options will be removed.`),
            cancel:t('保留','Keep'),accept:t('删除','Delete'),
          });
          const accepted=await discardPrompt.result;discardPrompt=null;
          if(!accepted||!alive()||!canEdit())return;
          groups=groups.filter(x=>x.id!==g.id);delete picks[g.id];
          if(groupId===g.id&&groups[0])selectWardrobeOption(groups[0],picks[groups[0].id]||'default');
          changed();refreshWardrobe();
        };
        row.append(del);
      }
      navigation.append(row);
    }
    const group=groups.find(g=>g.id===groupId);
    if(!group)return;
    const title=wardrobeGroupName(group);
    const options=el('section','l2d-wardrobe-options');
    const optionTitle=t(`${title}选项`,`${title} options`);
    options.setAttribute('aria-label',optionTitle);
    options.append(el('h3','l2d-wardrobe-heading',optionTitle));
    for(const option of [{id:'default',name:t('默认','Default')},...group.options]){
      const chosen=(picks[group.id]||'default')===option.id;
      const button=el('button','l2d-bind-target l2d-wardrobe-option');
      button.type='button';
      button.dataset.wardrobeFocus='option-'+group.id+'-'+option.id;
      button.setAttribute('aria-label',title+'：'+option.name);
      button.setAttribute('aria-pressed',String(chosen));
      button.disabled=!canEdit();
      const indicator=el('span','l2d-wardrobe-radio');
      indicator.setAttribute('aria-hidden','true');
      button.append(indicator,el('span','l2d-wardrobe-option-name',option.name));
      if(chosen)button.append(el('small','l2d-wardrobe-preview-label',t('预览中','Preview')));
      button.title=option.name;
      button.onclick=()=>{
        if(!canEdit()||discardPrompt)return;
        selectWardrobeOption(group,option.id);
        picks[group.id]=option.id;
        refreshWardrobe();
      };
      options.append(button);
    }
    const add=el('button','l2d-btn quiet sm l2d-wardrobe-add',t('＋ 新选项','＋ New option'));
    add.type='button';
    add.dataset.wardrobeFocus='add-'+group.id;
    add.setAttribute('aria-pressed',String(optionId===null));
    add.setAttribute('aria-label',t(`为${title}新建选项`,`Add an option to ${title}`));
    add.disabled=!canEdit()||group.options.length>=16;
    add.onclick=()=>{
      if(!canEdit()||discardPrompt)return;
      selectWardrobeOption(group,null);
      refreshWardrobe();
    };
    options.append(add);
    left.append(options);
  }
  function paintWardrobeSelection(){
    binding.replaceChildren();const g=groups.find(g=>g.id===groupId);paintSummary();
    if(!g){binding.append(el('p',null,t('在左侧选择装扮、部件或配饰','Choose Outfit, Parts or Accessories on the left')));return;}
    const current=g.options.find(o=>o.id===optionId);
    const caption=el('p','l2d-wardrobe-destination',wardrobeGroupName(g)+' · '+(current?t(`编辑「${current.name}」`,`Edit ${current.name}`):t('新选项','New option')));
    caption.title=caption.textContent;
    binding.append(caption);
    const name=el('input','l2d-input');
    name.value=optionNameDraft ?? current?.name ?? resource?.title ?? '';
    name.maxLength=60;
    name.placeholder=t('选项名称','Option name');
    name.setAttribute('aria-label',t('装扮选项名称','Wardrobe option name'));
    binding.append(name);
    const conflict=resource&&wardrobeConflict(resource,g.id);
    const actions=studio?el('div','figure-wardrobe-actions'):binding;
    if(!studio&&conflict)binding.append(el('p','l2d-bind-warning',t('与动作或其他装扮组共用参数，请调整绑定。','Shares controls with actions or another wardrobe group.')));
    const add=el('button','l2d-btn primary',current?t('保存选项','Update option'):t('添加选项','Add option'));
    const canAdd=()=>canEdit()&&resource&&!resource.wardrobeError&&!conflict&&!!name.value.trim()&&(!!current||g.options.length<16);
    add.disabled=!canAdd();
    name.oninput=()=>{optionNameDraft=name.value;add.disabled=!canAdd();};
    add.onclick=()=>{
      if(!canAdd()||discardPrompt)return;
      const option={id:current?.id||uid('v'),name:name.value.trim(),resource:resource.id};
      if(current)g.options=g.options.map(item=>item.id===option.id?option:item);
      else g.options.push(option);
      picks[g.id]=option.id;
      selectWardrobeOption(g,option.id);
      changed();
      refreshWardrobe();
    };
    actions.append(add);
    if(current){
      const remove=el('button','l2d-btn quiet',t('移除选项','Remove option'));
      remove.disabled=!canEdit();
      remove.onclick=()=>{
        if(!canEdit()||discardPrompt)return;
        g.options=g.options.filter(o=>o.id!==current.id);
        picks[g.id]='default';
        selectWardrobeOption(g,'default');
        changed();
        refreshWardrobe();
      };
      actions.append(remove);
    }
    if(studio)binding.append(actions,el('p','l2d-bind-warning',conflict?t('与动作或其他装扮共用参数。','Shares controls with another binding.'):''));
    else binding.append(el('p','l2d-bind-note',t('每组可选一个选项。保存并安装后可在 Coo 装扮页切换。','Pick one option per group. Save and install to switch them in Coo.')));
  }
  for(const [id,title]of [['actions',t('动作','Actions')],['wardrobe',t('装扮','Wardrobe')]]){
    const b=el('button','l2d-btn quiet sm',title);b.setAttribute('role','tab');b.setAttribute('aria-selected',String(page===id));b.onclick=()=>{
      if(!data||saving||discardPrompt||page===id)return;pageState[page]={resource,filter,search:search.value,scroll:list.scrollTop};page=id;combinationError='';pendingCombination=null;({resource,filter}=pageState[id]);search.value=pageState[id].search;for(const n of pages.children)n.setAttribute('aria-selected',String(n===b));
      if(page==='wardrobe'&&!groupId)groupId=groups[0]?.id||null;for(const n of tabs.children)n.classList.toggle('selected',n.dataset.filter===filter);syncControls();paintTargets();paintResources(pageState[id].scroll);play();
    };pages.append(b);
  }
  for(const [value,title]of [['all',t('全部','All')],['expression',t('表情','Faces')],['motion',t('动作','Motions')],['other',t('其他','Other')]]){
    const b=el('button','l2d-btn quiet sm',title);b.dataset.filter=value;b.onclick=()=>{if(!data)return;filter=value;for(const n of tabs.children)n.classList.toggle('selected',n===b);paintResources(0);};tabs.append(b);
  }tabs.firstChild.classList.add('selected');search.oninput=()=>{if(data)paintResources(0);};
  restoreAll.onclick=async()=>{
    if(!canEdit()||discardPrompt)return;
    if(page==='wardrobe'){picks={};resource=null;optionId='default';optionNameDraft=null;refreshWardrobe();return;}
    if(!bindings.length)return;
    discardPrompt=bindingDiscardPrompt(modal,zh,{title:t('全部恢复通用？','Reset all bindings?'),body:t('清空当前绑定，保留原生资源。点击保存后生效。','Clear all bindings and keep native resources. Save to apply.'),cancel:t('保留绑定','Keep bindings'),accept:t('全部恢复','Reset all')});
    const accepted=await discardPrompt.result;discardPrompt=null;if(!accepted||!alive()||!canEdit())return;
    bindings=[];resource=null;combinationError='';pendingCombination=null;rawMode=!!studio;changed();paintTargets();paintResources();play();
  };
  const askGroup=()=>new Promise(resolve=>{
    const form=el('form','l2d-group-form');
    const nameLabel=el('label','l2d-group-field');
    const name=el('input','l2d-input');
    name.placeholder=t('例如发型','e.g. Hair');name.maxLength=24;name.required=true;
    nameLabel.append(el('span','l2d-group-field-title',t('分组名称','Group name')),name);
    const englishLabel=el('label','l2d-group-field');
    const englishTitle=el('span','l2d-group-field-title',t('英文名称','English name'));
    englishTitle.append(el('span','l2d-group-optional',t('选填','Optional')));
    const english=el('input','l2d-input');
    english.placeholder='e.g. Hair';english.maxLength=24;english.lang='en';
    englishLabel.append(englishTitle,english);
    const actions=el('div','l2d-group-actions');
    const cancelBtn=el('button','l2d-btn',t('取消','Cancel')),okBtn=el('button','l2d-btn primary',t('创建分组','Create group'));
    cancelBtn.type='button';okBtn.type='submit';okBtn.disabled=true;
    actions.append(cancelBtn,okBtn);
    form.append(nameLabel,englishLabel,actions);
    let value=null;
    const popup=openFigureDialog(modal,t('新建分组','New group'),form,{
      closeLabel:t('关闭新建分组','Close new group'),
      variant:'l2d-group-modal',
      onClose(){closeGroupDialog=undefined;resolve(value);},
    });
    closeGroupDialog=popup.dispose;
    cancelBtn.onclick=popup.dispose;
    name.oninput=()=>{okBtn.disabled=!name.value.trim();};
    form.onsubmit=event=>{
      event.preventDefault();
      if(!name.value.trim())return;
      value={name:name.value.trim(),en:english.value.trim()};
      popup.dispose();
    };
    name.focus({preventScroll:true});
  });
  newGroup.onclick=async()=>{
    if(page!=='wardrobe'||!canEdit()||discardPrompt||closeGroupDialog)return;
    const value=await askGroup();
    if(!value||!alive()||!canEdit())return;
    const group={id:uid('g'),custom:true,name:value.name,...(value.en?{en:value.en}:{}),options:[]};
    groups.push(group);selectWardrobeOption(group,null);
    changed();refreshWardrobe();
    const entry=left.querySelector('.l2d-bind-group.selected');
    if(entry){
      const row=entry.getBoundingClientRect(),viewport=left.getBoundingClientRect();
      if(row.bottom>viewport.bottom)left.scrollTop+=row.bottom-viewport.bottom;
    }
  };
  skipImages.onclick=async()=>{
    if(!saving||skippingImages)return;
    const sequence=saveSequence;skippingImages=true;syncControls();
    try{
      await ctx.invoke('manualSkipImages',[data.token]);
      if(alive()&&saving&&sequence===saveSequence)hint.textContent=t('已跳过图片，继续保存绑定…','Skipping images and saving bindings…');
    }catch(error){
      if(alive()&&saving&&sequence===saveSequence){
        skippingImages=false;syncControls();
        hint.textContent=t('暂未跳过图片。','Could not skip images. ')+String(error.message||error);
      }
    }
  };
  save.onclick=async()=>{
    if(!canSave()||discardPrompt)return;
    if(gallery.getAttribute('aria-busy')==='true')retry.hidden=false;
    stopPreviewUpdates();saveSequence++;saving=true;saveStage=-1;syncControls();paintSelection();hint.textContent=t('保存并打包…','Saving & packing…');skipImages.focus();
    try{
      const request=ctx.invoke('manualSave',[data.token,structuredClone(bindings),structuredClone(groups)]);
      void pollSaveProgress(saveSequence);
      const result=await request;dirty=false;release();
      const saved=t('绑定已保存，可从卡片安装','Bindings saved. Install from the pack card.');
      if(result?.warn)ctx.ui.toast(saved+' · '+result.warn);
      else ctx.ui.toast(saved,'ok');
      try{await onSaved?.(result);}catch{ctx.ui.toast(t('绑定已保存，模型包列表刷新失败，请稍后重新打开页面','Bindings saved; the pack list could not refresh. Reopen the page later.'),'bad');}
    }
    catch(error){if(alive()){const message=String(error.message||error);if(sessionError(message))expireSession(message);else hint.textContent=message;ctx.ui.toast(message,'bad');}}
    finally{win.clearTimeout(saveProgressTimer);saving=false;skippingImages=false;if(alive()){syncControls();paintSelection();}}
  };
  retry.onclick=play;
  syncControls();
  try{
    data=await ctx.invoke(method,requestedToken?[...args,requestedToken]:args);
    resolution.value=String(data.previewSize);
    if(resolution.selectedIndex<0)resolution.selectedIndex=0;
    if(data.token!==requestedToken)ctx.notifyOnUnmount?.('manualClose',[data.token]);
    if(!alive()){if(!ctx.signal?.aborted)ctx.invoke('manualClose',[data.token]).catch(()=>{});return {get closed(){return closed;},dispose:release};}
    data.wardrobe=fixedWardrobeGroups(data.wardrobe||[]).map((g,i)=>({...g,...(i>=3?{custom:true}:{})}));
    bindings=structuredClone(data.draft?.bindings??data.bindings??[]);
    groups=structuredClone(data.draft?.wardrobe??data.wardrobe);
    changed();heading.querySelector('.l2d-modal-sub').textContent=data.title;paintTargets();paintResources();
    if(data.truncated||data.warnings?.length)right.prepend(el('p','l2d-bind-empty',t('部分资源未能读取，列表可能不完整','Some resources could not be read; the list may be incomplete')));
    if(data.truncated)hint.textContent=t('资源扫描不完整，请核对模型内容','Resource scan is incomplete; check the model');
    if(!studio)leaseTimer=win.setInterval(()=>{if(alive()&&sessionValid)ctx.invoke('manualKeepAlive',[data.token]).catch(error=>{const message=String(error.message||error);if(alive()&&sessionError(message))expireSession(message);});},60000);
    loadPreview();
  }catch(error){if(alive())hint.textContent=String(error.message||error);}
  return {
    get closed(){return closed;},
    dispose(){leave?.dispose?.();release();},
    setConnection(online,message){
      if(closed||online===connected)return;
      connected=online;
      if(!online){stopPreviewUpdates();hint.textContent=message;}
      syncControls();paintResources();
      if(online&&!saving)play();
    },
  };
}

function voiceView(ctx) {
  const doc = ctx.root.ownerDocument;
  const zh = String(ctx.language || 'zh').toLowerCase().startsWith('zh');
  const t = (a, b) => zh ? a : b;
  const el = (tag, cls, text) => {
    const node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };
  const button = (label, style = '') => {
    const tokens = style.split(' ');
    const node = figureControlButton(ctx, label, {
      size: tokens.includes('sm') ? 'sm' : 'md',
      variant: tokens.find(token => token === 'primary' || token === 'danger'),
    });
    node.classList.add(...tokens.filter(token => token && !['sm','primary','danger'].includes(token)));
    return node;
  };
  return { doc, t, el, button };
}

async function reloadFigurePrefix(ctx) {
  const doc = ctx.root.ownerDocument;
  const win = doc.defaultView;
  if (!win?.fetch) throw Error('Prefix refresh unavailable');
  // Cortico applies this at the next safe session boundary and keeps history.
  const response = await win.fetch(new URL('/api/session/reload-prefix', doc.baseURI), {
    method:'POST', credentials:'same-origin',
    headers:{'x-cortico-language':ctx.language || 'zh'},
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw Error('Prefix refresh unavailable');
}

async function refreshVoiceTool(ctx, before, after) {
  if (typeof before?.syncToolReady !== 'boolean' || before.syncToolReady === after?.syncToolReady) return;
  if (!ctx.root.ownerDocument.defaultView?.fetch) return;
  const {t} = voiceView(ctx);
  try {
    await reloadFigurePrefix(ctx);
  } catch {
    if (!ctx.signal?.aborted) ctx.ui.toast(t('设置已保存，可从 Coo 页头重载前缀以更新语音工具。', 'Saved. Reload the prefix from Coo’s page header to update the speech tool.'), 'bad');
  } finally {
    if (!ctx.signal?.aborted) await ctx.refresh?.().catch(() => {});
  }
}

const speechProviders = {
  async mount(ctx) {
    const state = await ctx.invoke('voiceState', []);
    if (ctx.signal?.aborted) return;
    const { doc, t, el, button } = voiceView(ctx);
    const page = el('section', 'l2d-config-page l2d-voice-page');
    holdFigurePanelPaint(page);
    const services = el('section', 'l2d-voice-services');
    const header = el('header', 'l2d-voice-services-head');
    const title = el('h2', null, t('语音服务', 'Speech services'));
    const count = el('span', 'l2d-voice-count');
    const add = button(t('添加语音服务', 'Add speech service'), 'sm');
    add.setAttribute('aria-haspopup', 'dialog');
    add.onclick = () => openService();
    title.append(count);
    header.append(title, add);
    const grid = el('div', 'l2d-voice-service-grid');
    grid.setAttribute('role', 'region');
    grid.setAttribute('aria-label', t('已保存的语音服务', 'Saved speech services'));
    const audition = el('div', 'l2d-voice-audition');
    audition.setAttribute('aria-label', t('播放控制', 'Playback controls'));
    const transport = el('div', 'l2d-voice-transport');
    const feedback = el('div', 'l2d-voice-feedback');
    audition.append(feedback, transport);
    services.append(header, audition, grid);
    const sound = el('section', 'l2d-voice-controls');
    page.append(services, sound);
    ctx.root.append(page);
    const soundControls = mountVoiceControls(ctx, sound, transport, feedback, state);
    let snapshot = state, modal, switching = false, disposed = false;

    function paint() {
      grid.replaceChildren();
      count.textContent = snapshot.services.length ? String(snapshot.services.length) : '';
      if (!snapshot.services.length) {
        grid.append(el('p', 'l2d-voice-empty', t('添加一个服务，即可试听并朗读桌宠回复。', 'Add a service to preview and read desktop pet replies.')));
      }
      for (const service of snapshot.services) {
        const provider = VOICE_PROVIDERS[service.provider].name;
        const name = service.name || provider;
        const active = snapshot.selectedId === service.id;
        const item = el('article', 'l2d-voice-service' + (active ? ' is-current' : ''));
        item.dataset.serviceId = service.id;
        const identity = el('div', 'l2d-voice-service-identity');
        const model = [service.name && provider, service.profile.model || service.profile.version].filter(Boolean).join(' · ');
        const voice = service.profile.voice || (service.provider === 'sovitsLocal'
          ? t('使用插件当前音色', 'Use the plugin’s current voice') : '');
        identity.append(el('h3', null, name));
        if (model || voice) {
          const details = el('p', null, [model, voice].filter(Boolean).join(' · '));
          details.title = details.textContent;
          item.setAttribute('aria-label', name + ' · ' + details.textContent);
          identity.append(details);
        }
        const actions = el('div', 'l2d-voice-service-actions');
        const edit = button(t('配置', 'Configure'), 'quiet sm');
        edit.setAttribute('aria-label', t('配置 ', 'Configure ') + name);
        edit.setAttribute('aria-haspopup', 'dialog');
        edit.addEventListener('click', () => openService(service.id));
        if (active || !service.ready) {
          actions.append(el('span', 'l2d-voice-service-state', !service.ready
            ? t('待配置', 'Incomplete') : t('当前使用', 'Selected')));
        } else {
          const use = button(t('使用', 'Use'), 'sm');
          use.setAttribute('aria-label', t('使用 ', 'Use ') + name);
          use.onclick = () => void activate(service, item);
          actions.append(use);
        }
        actions.append(edit);
        item.append(identity, actions);
        grid.append(item);
      }
    }

    function focusService(id) {
      const card = [...grid.children].find(item => item.dataset.serviceId === id);
      (card?.querySelector('.quiet') || add).focus({preventScroll:true});
    }

    async function activate(service, item) {
      if (switching || modal || disposed) return;
      switching = true;
      const buttons = [add, ...grid.querySelectorAll('button')];
      buttons.forEach(control => { control.disabled = true; });
      soundControls.message(t('正在切换服务…', 'Switching service…'));
      try {
        const next = await ctx.invoke('voiceSave', [service.id, service.provider, service.name || '', service.profile, '', true]);
        if (disposed) return;
        snapshot = next;
        paint();
        soundControls.update(snapshot);
        focusService(service.id);
      } catch (error) {
        if (disposed) return;
        soundControls.message(String(error?.message || error), true);
        const button = item.querySelector('button:not(.quiet)');
        if (button) { button.disabled = false; button.focus({preventScroll:true}); }
      } finally {
        switching = false;
        buttons.forEach(control => { control.disabled = false; });
      }
    }
    paint();

    function openService(id = null) {
      if (modal || switching) return;
      const details = snapshot.services.find(service => service.id === id);
      const form = el('form', 'l2d-dialog-body l2d-voice-edit');
      const content = el('div', 'l2d-voice-edit-content');
      const fields = el('div', 'l2d-voice-fields');
      const help = el('p', 'l2d-voice-hint');
      const extra = el('details', 'l2d-voice-advanced');
      const advanced = el('div', 'l2d-voice-fields');
      extra.append(el('summary', null, t('更多服务参数', 'More service parameters')), advanced);
      const inputs = new Map();
      const english = {
        endpoint: 'Endpoint', model: 'Model', voice: 'Voice / character ID', region: 'Region',
        groupId: 'Group ID', speed: 'Speed', rate: 'Rate (%)', pitch: 'Pitch', volume: 'Volume',
        instructions: 'Reading style', style: 'Style', dialect: 'Dialect', seedText: 'Reference text',
        role: 'Role', appId: 'Application ID', cluster: 'Cluster', stability: 'Stability',
        similarity: 'Similarity', reference: 'Reference audio path', prompt: 'Reference text',
        promptLang: 'Reference language', language: 'Language', version: 'API version',
        emotion: 'Emotion', modelDir: 'ONNX model folder',
      };
      function field(label, type) {
        const row = el('label', 'l2d-field');
        const input = el('input', 'l2d-input');
        input.type = type;
        row.append(el('span', 'l2d-label', label), input);
        return { row, input };
      }
      const providerRow = el('label', 'l2d-field');
      const provider = el('select', 'l2d-input');
      provider.name = 'provider';
      provider.required = true;
      const placeholder = el('option', null, t('选择提供商', 'Select a provider'));
      placeholder.value = '';
      placeholder.disabled = true;
      provider.append(placeholder);
      for (const [value, spec] of Object.entries(VOICE_PROVIDERS)) {
        const option = el('option', null, spec.name);
        option.value = value;
        provider.append(option);
      }
      provider.value = details?.provider || '';
      providerRow.append(el('span', 'l2d-label', t('提供商', 'Provider')), provider);
      const name = field(t('服务名称（选填）', 'Service name (optional)'), 'text');
      name.input.name = 'name';
      name.input.maxLength = 80;
      name.input.value = details?.name || '';
      name.input.placeholder = t('如日常朗读', 'For example, Daily narration');
      content.append(providerRow, name.row, fields, help, extra);
      let key;
      function renderProviderFields() {
        const spec = VOICE_PROVIDERS[provider.value];
        const profile = details?.profile || {};
        if (key) key.value = '';
        key = undefined;
        inputs.clear();
        fields.replaceChildren();
        advanced.replaceChildren();
        extra.open = false;
        for (const setting of spec?.fields || []) {
          const { row, input } = field(t(setting.label, english[setting.key] || setting.label), setting.type || (setting.url ? 'url' : 'text'));
          input.name = setting.key;
          if (setting.type === 'number') {
            input.min = String(setting.min);
            input.max = String(setting.max);
            input.step = 'any';
            input.required = true;
          } else {
            input.maxLength = 2048;
            input.spellcheck = false;
          }
          input.value = String(profile[setting.key] ?? setting.value);
          inputs.set(setting.key, input);
          (setting.primary || (setting.required && setting.type !== 'number') ? fields : advanced).append(row);
        }
        if (spec?.auth) {
          const fieldKey = field(t('API 密钥', 'API key'), 'password');
          key = fieldKey.input;
          key.autocomplete = 'new-password';
          key.maxLength = 4096;
          const keyNote = el('small', 'l2d-voice-hint');
          fieldKey.row.append(keyNote);
          fields.append(fieldKey.row);
          const address = inputs.get('endpoint') || inputs.get('region');
          const origin = value => {
            try { return new URL(value).origin; } catch { return ''; }
          };
          const describeKey = () => {
            const same = address?.name === 'endpoint' ? origin(address.value) === origin(profile.endpoint)
              : address?.name === 'region' ? address.value.trim() === profile.region : true;
            keyNote.textContent = same && details?.hasKey
              ? t('已保存此服务地址的密钥。留空继续使用。', 'A key is saved for this service address. Leave blank to keep it.')
              : t('密钥保存在 Coo 的凭据区。', 'Keys are stored in Coo’s credential store.');
          };
          describeKey();
          address?.addEventListener('input', describeKey);
        }
        fields.hidden = !fields.childElementCount;
        help.textContent = t(spec?.help || '', spec?.helpEn || '');
        help.hidden = !help.textContent;
        extra.hidden = !advanced.childElementCount;
      }
      const status = el('p', 'l2d-voice-message');
      status.setAttribute('role', 'status');
      const footer = el('div', 'l2d-voice-edit-footer');
      const actions = el('div', 'l2d-dialog-actions l2d-voice-actions');
      const confirmation = el('div', 'l2d-dialog-actions l2d-voice-actions');
      const returnToEdit = button(t('返回编辑', 'Back to editor'));
      const confirmRemove = button(t('确认删除', 'Delete service'), 'danger');
      confirmation.append(returnToEdit, confirmRemove);
      confirmation.hidden = true;
      const remove = button(t('删除服务', 'Remove service'), 'quiet danger');
      remove.hidden = !details;
      const sample = button(t('试听', 'Test voice'));
      const cancel = button(t('取消', 'Cancel'), 'quiet');
      const save = button(t('保存', 'Save'));
      const use = button(t('保存并使用', 'Save and select'), 'primary');
      save.hidden = snapshot.selectedId === id;
      actions.append(remove, sample, cancel, save, use);
      footer.append(status, actions, confirmation);
      form.append(content, footer);

      const win = doc.defaultView;
      const createId = id === null ? win.crypto?.randomUUID?.() : undefined;
      let closed = false, saving = false, testing = false, changed = false, removing = false, player;
      form.addEventListener('input', () => { changed = true; });
      const guard = ctx.guardLeave?.(() => !closed && (saving || changed)
        ? t('语音服务配置尚未保存，确定离开？', 'Speech settings are unsaved. Leave anyway?') : null);
      const draft = () => Object.fromEntries([...inputs].map(([field, input]) =>
        [field, input.type === 'number' ? input.valueAsNumber : input.value]));
      const lock = () => {
        sample.disabled = !provider.value || testing || saving || removing;
        save.disabled = use.disabled = !provider.value || saving || removing;
        cancel.disabled = saving;
        remove.disabled = testing || saving;
        returnToEdit.disabled = confirmRemove.disabled = saving;
        provider.disabled = Boolean(details) || saving || removing || testing;
        for (const input of form.querySelectorAll('input')) input.disabled = saving || removing;
        form.setAttribute('aria-busy', String(testing || saving));
      };
      const message = (value, error = false) => {
        status.textContent = value;
        status.classList.toggle('bad', error);
      };
      const closePlayer = () => {
        void player?.close().catch(() => {});
        player = undefined;
      };
      form.addEventListener('invalid', event => {
        if (advanced.contains(event.target)) extra.open = true;
      }, true);
      provider.addEventListener('change', () => {
        changed = true;
        renderProviderFields();
        message('');
        lock();
      });
      renderProviderFields();
      lock();
      sample.onclick = async () => {
        if (!provider.value || !form.reportValidity() || testing || saving || removing) return;
        testing = true;
        lock();
        message(t('正在合成试听语音…', 'Generating a voice sample…'));
        closePlayer();
        try {
          const playback = player = new win.AudioContext();
          const resumed = playback.resume();
          const bytes = ctx.invokeBinary('voiceTest', [id, provider.value, draft(), key?.value || '']).then(blob => blob.arrayBuffer());
          const [, audio] = await Promise.all([resumed, bytes]);
          if (closed || player !== playback) return;
          const clip = await playback.decodeAudioData(audio);
          if (closed || player !== playback) return;
          const source = playback.createBufferSource();
          source.buffer = clip;
          source.connect(playback.destination);
          source.onended = () => { if (player === playback) closePlayer(); };
          source.start();
          message(t('试听语音已播放', 'Voice sample started'));
        } catch (error) {
          closePlayer();
          if (!closed) message(String(error?.message || error), true);
        } finally {
          testing = false;
          if (!closed) lock();
        }
      };
      async function persist(select) {
        if (!provider.value || !form.reportValidity() || saving || removing) return;
        const values = [id, provider.value, name.input.value.trim(), draft(), key?.value || '', select];
        if (createId) values.push(createId);
        saving = true;
        lock();
        message(t('正在保存…', 'Saving…'));
        try {
          snapshot = await ctx.invoke('voiceSave', values);
          if (closed) return;
          changed = false;
          if (key) key.value = '';
          paint();
          soundControls.update(snapshot);
          modal.dispose();
          focusService(id);
        } catch (error) {
          if (!closed) message(String(error?.message || error), true);
        } finally {
          saving = false;
          if (!closed) lock();
        }
      }
      cancel.onclick = () => modal.dispose();
      save.onclick = () => void persist(false);
      use.onclick = () => void persist(true);
      form.onsubmit = event => { event.preventDefault(); void persist(true); };
      function confirmDeletion(on) {
        removing = on;
        actions.hidden = on;
        confirmation.hidden = !on;
        message(!on ? '' : snapshot.selectedId === id && soundControls.narrationEnabled()
          ? t('删除当前服务并关闭朗读？', 'Remove the active service and turn off narration?')
          : t('删除这项语音服务？', 'Remove this speech service?'));
        lock();
        (on ? returnToEdit : remove).focus();
      }
      remove.onclick = () => confirmDeletion(true);
      returnToEdit.onclick = () => confirmDeletion(false);
      confirmRemove.onclick = async () => {
        if (saving || !id) return;
        const position = snapshot.services.findIndex(service => service.id === id);
        saving = true;
        lock();
        message(t('正在删除…', 'Removing…'));
        try {
          snapshot = await ctx.invoke('voiceRemove', [id]);
          if (closed) return;
          changed = false;
          paint();
          soundControls.update(snapshot);
          modal.dispose();
          focusService((snapshot.services[position] ?? snapshot.services.at(-1))?.id);
        } catch (error) {
          if (!closed) message(String(error?.message || error), true);
        } finally {
          saving = false;
          if (!closed) lock();
        }
      };
      modal = openFigureDialog(page, details ? t('编辑语音服务', 'Edit speech service') : t('添加语音服务', 'Add speech service'), form, {
        closeLabel: t('关闭', 'Close'), variant: 'l2d-voice-popup', locked: () => saving,
        onClose() {
          closed = true;
          closePlayer();
          if (key) key.value = '';
          guard?.dispose();
          modal = undefined;
        },
      });
      (details ? name.input : provider).focus({preventScroll:true});
    }
    return { dispose() {
      if (disposed) return;
      disposed = true;
      modal?.dispose();
      soundControls.dispose();
      page.remove();
    } };
  },
};

function mountVoiceControls(ctx, section, transport, feedback, initial) {
  const { t, el, button } = voiceView(ctx);
  let snapshot = initial;
  let disposed = false, saving = false, testing = false, testSent = false, request = 0;
  let speaking = initial?.speaking === true, stopping = false, pollPending = false;
  let inFlight = {}, saveFailed = false;
  let serviceRevision = 0;
  let prefixRefresh = Promise.resolve();
  const updateTool = (before, after) => {
    if (before?.syncToolReady !== after?.syncToolReady) {
      prefixRefresh = prefixRefresh.then(() => refreshVoiceTool(ctx, before, after)).catch(() => {});
    }
  };
  const pending = {};
  const inputs = new Map();
  const narration = el('section', 'l2d-voice-control-group');
  const mouth = el('section', 'l2d-voice-control-group');
  narration.append(el('h3', null, t('朗读', 'Narration')));
  mouth.append(el('h3', null, t('口型', 'Lip sync')));
  const status = el('span', 'l2d-voice-message');
  status.setAttribute('role', 'status');
  const controls = [
    ['voiceEnabled', t('朗读桌宠回复', 'Read desktop pet replies'), ''],
    ['voiceTiming', t('朗读时机', 'Narration timing'), t('同步档等到首声再显示气泡。', 'Sync waits for audio to start before showing the bubble.')],
    ['voiceVolume', t('播放音量', 'Playback volume'), '', { min: 0, max: 1, step: .01 }],
    ['voiceLipSync', t('口型跟随音频', 'Audio-driven lip sync'), t('关闭时使用原有的气泡口型', 'Turn off to use the existing bubble timing')],
    ['voiceMouthGain', t('张嘴幅度', 'Mouth opening gain'), t('调高后，轻声时张嘴更明显。', 'Higher values make quiet speech more expressive.'), MOUTH_GAIN],
  ];
  for (const [key, label, hint, range] of controls) {
    const row = el('label', 'l2d-setting-row');
    const text = el('span', 'l2d-setting-label');
    const description = el('small', null, hint);
    description.hidden = !hint;
    text.append(el('span', null, label), description);
    const timing = key === 'voiceTiming';
    const input = timing ? el('select', 'l2d-input') : el('input', range ? 'l2d-range' : 'l2d-switch');
    if (!timing) input.type = range ? 'range' : 'checkbox';
    input.disabled = true;
    input.setAttribute('aria-label', label);
    let output;
    if (timing) {
      const fast = el('option', null, t('快速播报', 'Fast narration'));
      const sync = el('option', null, t('跟气泡一起开始', 'Start with the bubble'));
      fast.value = 'fast';
      sync.value = 'sync';
      input.append(fast, sync);
      row.append(text, input);
    } else if (range) {
      Object.assign(input, { min: range.min, max: range.max, step: range.step });
      const slider = el('span', 'l2d-voice-slider');
      output = el('output', 'l2d-out');
      output.setAttribute('aria-hidden', 'true');
      slider.append(input, output);
      row.append(text, slider);
    } else {
      input.setAttribute('role', 'switch');
      row.append(text, input);
    }
    inputs.set(key, { input, output, description, hint });
    input.addEventListener('input', () => paintSlider(key));
    input.addEventListener('change', () => {
      if (input.disabled || timing && input.value === 'sync' && snapshot?.timingReady !== true) return;
      pending[key] = timing ? input.value : range ? input.valueAsNumber : input.checked;
      void save();
    });
    (['voiceLipSync', 'voiceMouthGain'].includes(key) ? mouth : narration).append(row);
  }
  const sample = button(t('在桌宠试听', 'Test on desktop pet'), 'primary');
  const retry = button(t('重试保存', 'Retry saving'), 'quiet');
  const retryRegion = el('div');
  retryRegion.hidden = true;
  retryRegion.append(retry);
  retry.onclick = () => void save();
  sample.classList.add('l2d-voice-playback');
  transport.append(sample);
  feedback.append(status, retryRegion);
  section.append(narration, mouth);
  function paintSlider(key) {
    const { input, output } = inputs.get(key);
    if (!output) return;
    const label = key === 'voiceMouthGain' ? Number(input.value).toFixed(1) + '×'
      : Math.round(Number(input.value) * 100) + '%';
    output.value = label;
    input.setAttribute('aria-valuetext', label);
  }
  function paintTiming(value) {
    const { input, description, hint } = inputs.get('voiceTiming');
    const ready = snapshot?.timingReady === true;
    input.value = value;
    input.options[1].disabled = !ready;
    description.textContent = ready ? hint : value === 'sync'
      ? t('当前设备使用快速播报，同步设置会保留。', 'This device uses fast narration and keeps your sync preference.')
      : t('当前设备支持快速播报，暂无法对齐气泡起点。', 'Fast narration is available on this device. Bubble timing sync is unavailable.');
  }
  function controlValue(key) {
    return pending[key] ?? inFlight[key] ?? snapshot?.controls[key] ?? VOICE_CONTROLS[key];
  }
  function paint() {
    if (disposed) return;
    for (const [key, { input, output }] of inputs) {
      const value = controlValue(key);
      if (key === 'voiceTiming') paintTiming(value);
      else if (output) { input.value = String(value); paintSlider(key); }
      else input.checked = value;
      input.disabled = !snapshot || key === 'voiceEnabled' && !snapshot.selectedId && !value;
    }
    paintPlayback();
    retryRegion.hidden = !saveFailed;
    retry.disabled = saving;
  }
  function playbackMode() {
    return testing || testSent ? 'sample' : speaking ? 'narration' : 'idle';
  }
  function paintPlayback() {
    if (disposed) return;
    const mode = playbackMode();
    const selected = snapshot?.services.find(service => service.id === snapshot.selectedId);
    const label = mode === 'sample' ? t('停止试听', 'Stop sample')
      : mode === 'narration' ? t('停止朗读', 'Stop narration') : t('在桌宠试听', 'Test on desktop pet');
    if (sample.textContent !== label) sample.textContent = label;
    sample.disabled = stopping || mode === 'idle' && (!selected?.ready || !(snapshot?.playbackReady ?? snapshot?.bodyReady));
    sample.classList.toggle('primary', mode === 'idle' && !sample.disabled);
  }
  function message(value, bad = false) {
    if (disposed) return;
    status.textContent = value;
    status.classList.toggle('bad', bad);
  }
  function hint() {
    if (!snapshot?.selectedId) return snapshot?.services.length
      ? t('选择要用于朗读的服务。', 'Choose a service for narration.')
      : '';
    if (snapshot.services.find(service => service.id === snapshot.selectedId)?.ready === false) {
      return t('当前服务的配置还未完成。', 'Complete the current service settings.');
    }
    if (!(snapshot.playbackReady ?? snapshot.bodyReady)) return t('请切换到支持语音的 Figure 形象。已有打包卡片可以重新安装。',
      'Switch to a supported Figure. Reinstall from its pack card to refresh an older runtime.');
    return snapshot.message || (!snapshot.bodyReady
      ? t('当前可播放语音。流式口型需要已更新的 Figure 形象。', 'Voice playback is available. Streaming lip sync needs an updated Figure.')
      : '');
  }
  async function save() {
    if (disposed || saving || !Object.keys(pending).length) return;
    saving = true;
    const patch = inFlight = { ...pending };
    for (const key of Object.keys(patch)) delete pending[key];
    paint();
    message(t('正在保存…', 'Saving…'));
    try {
      let revision = serviceRevision;
      let result = await ctx.invoke('voiceControls', [patch]);
      if (!disposed && revision !== serviceRevision) {
        revision = serviceRevision;
        result = await ctx.invoke('voiceState', []).catch(() => undefined);
      }
      if (!disposed && result && revision === serviceRevision) {
        const previous = snapshot;
        snapshot = result;
        updateTool(previous, snapshot);
      }
      saveFailed = false;
      message(hint() || t('已保存', 'Saved'));
    } catch (error) {
      // Keep the failed edits unless a newer edit already superseded a value.
      for (const [key, value] of Object.entries(patch)) {
        if (!Object.hasOwn(pending, key)) pending[key] = value;
      }
      saveFailed = true;
      message(String(error?.message || error), true);
    } finally {
      saving = false;
      inFlight = {};
      paint();
      if (!saveFailed) void save();
    }
  }
  async function refreshPlayback() {
    if (disposed || pollPending || testing || stopping || !snapshot?.selectedId) return;
    pollPending = true;
    const id = request;
    const revision = serviceRevision;
    try {
      const current = await ctx.invoke('voiceState', []);
      if (disposed || id !== request || revision !== serviceRevision || current.selectedId !== snapshot.selectedId) return;
      const previous = snapshot;
      const previousHint = hint();
      const { bodyReady, playbackReady, timingReady, message: playbackMessage } = current;
      snapshot = { ...snapshot, bodyReady, playbackReady, timingReady, message: playbackMessage };
      if (previous.timingReady !== timingReady) paintTiming(controlValue('voiceTiming'));
      speaking = current.speaking === true;
      if (testSent && !speaking) {
        testSent = false;
        message(current.message || t('试听已结束', 'Sample finished'));
      } else if (playbackMode() === 'idle' && !saving && !status.classList.contains('bad') && previousHint !== hint()) {
        message(hint());
      }
      paintPlayback();
    } catch {
      // The next refresh can recover a temporary unavailable status.
    } finally {
      pollPending = false;
    }
  }
  sample.onclick = async () => {
    const mode = playbackMode();
    const id = ++request;
    if (mode !== 'idle') {
      stopping = true;
      paintPlayback();
      try {
        await ctx.invoke(mode === 'sample' ? 'voiceStop' : 'voiceHush', []);
        if (disposed || id !== request) return;
        testing = testSent = speaking = false;
        message(mode === 'sample' ? t('试听已停止', 'Sample stopped') : t('朗读已停止', 'Narration stopped'));
      } catch (error) {
        if (id === request) {
          testing = false;
          message(String(error?.message || error), true);
        }
      } finally {
        if (id === request) {
          stopping = false;
          paintPlayback();
          void refreshPlayback();
        }
      }
      return;
    }
    testing = true;
    paintPlayback();
    message(t('正在准备桌宠试听…', 'Preparing the desktop sample…'));
    try {
      const result = await ctx.invoke('voiceAudition', []);
      if (id !== request || disposed) return;
      if (result?.ok === false) {
        message(t('试听已取消', 'Sample cancelled'));
        return;
      }
      testSent = true;
      message(t('已将试听送到桌宠', 'Sample sent to the desktop pet'));
    } catch (error) {
      if (id === request) message(String(error?.message || error), true);
    } finally {
      if (id === request) {
        testing = false;
        paintPlayback();
        if (testSent) void refreshPlayback();
      }
    }
  };
  const playbackPoll = ctx.interval?.(() => void refreshPlayback(), 900);
  paint();
  message(hint());
  const guard = ctx.guardLeave?.(() => !disposed && (saving || Object.keys(pending).length)
    ? t('语音设置尚未保存，确定离开？', 'Voice settings are unsaved. Leave anyway?') : null);
  return {
    message,
    narrationEnabled: () => snapshot?.controls.voiceEnabled,
    update(result) {
      const previous = snapshot;
      serviceRevision++;
      snapshot = result;
      if (previous?.selectedId !== result.selectedId) {
        request++;
        testing = testSent = stopping = false;
        speaking = result.speaking === true;
      }
      paint();
      if (!saving && !saveFailed) message(hint());
      updateTool(previous, snapshot);
    },
    dispose() { disposed = true; playbackPoll?.dispose(); guard?.dispose(); },
  };
}

function wardrobeLink(el, label, style = 'l2d-btn sm') {
  const link = el('a', style, label);
  link.href = '#/dress';
  return link;
}

function mountPerformanceSettings(ctx, form, cfg, setMode) {
  const {doc, t, el, button} = voiceView(ctx);
  const section = el('section', 'l2d-planner-settings');
  const modes = el('fieldset', 'l2d-planner-modes');
  modes.setAttribute('aria-label', t('表演模式', 'Performance mode'));
  const descriptions = [
    ['vocab', t('默认', 'Default'), t('沿用 Coo 的情绪和动作词。', 'Use Coo’s existing expressions and actions.'), t('现有主模型用量', 'Existing main-model usage')],
    ['direct', t('主模型编排', 'Main model planning'), t('在对话里直接让 Coo 做动作或边说边演。', 'Ask Coo to perform an action or act while speaking.'), t('主模型用量增加', 'Additional main-model usage')],
    ['dual', t('独立编排', 'Dedicated planning'), t('由单独配置的模型为气泡台词编排动作。', 'Use a dedicated model to plan actions for bubble text.'), t('现有主模型用量＋编排模型用量', 'Existing main-model usage + planner usage')],
  ];
  const radios = descriptions.map(([value, title, detail, usage]) => {
    const label = el('label', 'l2d-planner-mode');
    const radio = el('input');
    radio.type = 'radio';
    radio.name = 'figure-performance-mode';
    radio.value = value;
    radio.checked = value === (cfg.performanceMode || 'vocab');
    radio.setAttribute('aria-label', title);
    const head = el('span', 'l2d-planner-mode-head');
    head.append(el('strong', null, title), radio);
    label.append(head, el('span', 'l2d-planner-detail', detail), el('small', 'l2d-planner-usage', usage));
    modes.append(label);
    radio.addEventListener('change', () => { if (radio.checked) { setMode(value); paint(); } });
    return radio;
  });
  const manage = button(t('管理编排服务', 'Manage planners'), 'l2d-planner-manage');
  manage.setAttribute('aria-haspopup', 'dialog');
  const readiness = el('div', 'l2d-planner-service-bar l2d-performance-readiness');
  const targetSummary = el('div', 'l2d-planner-service-summary');
  const targetName = el('strong');
  const nextStep = el('small');
  targetSummary.append(targetName, nextStep);
  const action = el('div', 'l2d-performance-action');
  const dress = wardrobeLink(el, t('打开装扮', 'Open Dress up'));
  const desktopTarget = el('select', 'l2d-input');
  desktopTarget.setAttribute('aria-label', t('已穿戴的形象', 'Worn figure'));
  desktopTarget.append(el('option', null, t('跟随装扮记录', 'Follow wardrobe activity')));
  desktopTarget.options[0].value = '';
  desktopTarget.disabled = true;
  const targetRow = el('label', 'l2d-setting-row l2d-desktop-target-row');
  const targetLabel = el('span', 'l2d-setting-label');
  targetLabel.append(el('span', null, t('已穿戴的形象', 'Worn figure')),
    el('small', null, t('先在 Coo 穿戴。没有装扮记录时，可在这里指定编排和口型使用的形象。', 'Wear the figure in Coo. Select it here for planning and lip sync if wardrobe activity is unavailable.')));
  targetRow.append(targetLabel, desktopTarget);
  const importSource = button(t('导入原始模型', 'Import source model'), 'sm');
  action.append(dress, importSource, manage);
  readiness.append(targetSummary, action);
  targetSummary.setAttribute('role', 'status');
  section.append(modes, targetRow, readiness);
  form.append(section);

  let snapshot = null, currentBody = null, disposed = false, reading = false, importing = false, choosing = false;
  let readingTargets = false, targetsLoaded = false;
  let targetRevision = 0;
  let syncState = '';
  let dialog;
  const providerName = id => {
    const provider = PLANNER_PROVIDERS[id];
    return t(provider.name, provider.english || provider.name);
  };
  function paint() {
    const service = snapshot?.services.find(item => item.id === snapshot.selectedId);
    const independent = radios[2].checked;
    manage.classList.toggle('quiet', !independent);
    const mode = radios.find(input => input.checked)?.value;
    const state = currentBody?.state;
    dress.hidden = !['choose-figure', 'check-pack', 'render-failed', 'reload'].includes(state);
    dress.textContent = currentBody?.body === 'desktop-live2d-pet' ? t('打开桌宠设置', 'Open pet settings') : t('打开装扮', 'Open Dress up');
    dress.href = currentBody?.body === 'desktop-live2d-pet' ? '#/pet' : '#/dress';
    importSource.hidden = mode === 'vocab' || state !== 'native-model';
    importSource.disabled = importing;
    manage.hidden = !independent && (!dress.hidden || !importSource.hidden);
    const bodyName = currentBody?.body === 'desktop-live2d-pet' ? t('Live2D 桌宠', 'Live2D desktop pet') : t('桌宠', 'Desktop pet');
    const worn = currentBody?.figure === 'coo' ? t('内置 Coo', 'Built-in Coo') : currentBody?.figure;
    const name = worn ? bodyName + ' · ' + worn : t('当前对话桌宠', 'Current conversation pet');
    const title = service?.ready ? name + ' · ' + service.model : name;
    const hint = !currentBody ? t('正在检查穿戴形象…', 'Checking the worn figure…')
        : mode === 'vocab' ? t('回到对话，直接说「眨一下眼」。', 'In chat, say “Wink once.”')
          : state === 'unavailable' ? t('暂时读不到桌宠状态，正在重试。', 'Pet status is unavailable. Retrying.')
          : state === 'native-model' ? t('当前是 Live2D 桌宠直导的模型。请用 Figure 导入原始素材，再穿戴到 Coo 桌宠。', 'Import the source model in Figure and wear the pack on the Coo desktop pet.')
          : state === 'choose-figure' ? currentBody.body === 'desktop-live2d-pet'
            ? t('先在这只桌宠的装扮里穿戴 Figure 形象。', 'Wear a Figure pack on this desktop pet.')
            : t('在 Coo 装扮穿戴 Live2D 形象，或在上方选择已穿戴的形象。', 'Wear a Live2D figure in Coo, or select the figure already worn above.')
          : state === 'check-pack' ? t('从 Figure 模型卡重装 Live2D 形象，或在装扮里换一个。', 'Reinstall the Live2D figure from its Figure card or choose another one in Dress up.')
          : state === 'render-failed' ? t('Coo 加载这个形象失败。可在装扮里重选，或从模型卡重装。', 'Coo could not load this figure. Select it again or reinstall it from its card.')
          : state === 'reload' ? t('形象已重装。在 Coo 装扮里切到另一只，再切回此形象。', 'Figure reinstalled. Switch to another figure in Coo, then switch back.')
          : mode === 'direct' && syncState ? syncState
          : independent && !snapshot ? t('正在读取编排服务…', 'Loading planner services…')
          : independent && !service?.ready ? t('形象已就绪，选择一个编排服务即可。', 'The figure is ready. Select a planner service.')
          : currentBody.limited ? t('可编排姿态和通用表情。导入原始素材可恢复原生动作。', 'Pose and generic expression planning are available. Import the source model to recover native actions.')
          : t('可以回到对话，试试「先点头，再往左歪头」。', 'In chat, try “Nod, then tilt your head left.”');
    if (targetName.textContent !== title) targetName.title = targetName.textContent = title;
    if (nextStep.textContent !== hint) nextStep.title = nextStep.textContent = hint;
  }
  paint();
  void ctx.invoke('plannerState', []).then(state => {
    if (!snapshot && state?.services && !ctx.signal?.aborted) { snapshot = state; paint(); }
  }, () => { if (!snapshot && !ctx.signal?.aborted) { snapshot = {services:[]}; paint(); } });
  async function checkBody() {
    if (reading || choosing || disposed || ctx.signal?.aborted) return;
    reading = true;
    const revision = targetRevision;
    try {
      const state = await ctx.invoke('performanceReadiness', []);
      if (!disposed && !ctx.signal?.aborted && revision === targetRevision) currentBody = state?.state ? state : {state:'unavailable'};
    } catch {
      if (!disposed && !ctx.signal?.aborted && revision === targetRevision) currentBody = {state:'unavailable'};
    } finally {
      reading = false;
      if (!disposed && !ctx.signal?.aborted) paint();
    }
  }
  void checkBody();
  let selectedTarget = cfg.desktopFigure || '';
  async function loadTargets() {
    if (readingTargets || targetsLoaded || disposed || ctx.signal?.aborted) return;
    readingTargets = true;
    try {
      const targets = await ctx.invoke('desktopTargets', []);
      if (disposed || ctx.signal?.aborted) return;
      if (!Array.isArray(targets)) throw new Error('Figure list unavailable');
      desktopTarget.options[0].textContent = t('跟随装扮记录', 'Follow wardrobe activity');
      for (const {id, name} of targets) {
        const option = el('option', null, name);
        option.value = id;
        desktopTarget.append(option);
      }
      desktopTarget.value = selectedTarget;
      if (desktopTarget.selectedIndex < 0) desktopTarget.selectedIndex = 0;
      desktopTarget.disabled = false;
      targetsLoaded = true;
    } catch {
      if (!disposed) desktopTarget.options[0].textContent = t('形象列表暂不可用', 'Figure list unavailable');
    } finally {
      readingTargets = false;
    }
  }
  void loadTargets();
  const statusPoll = ctx.interval?.(() => {
    if (!form.isConnected || doc.hidden) return;
    void checkBody();
    void loadTargets();
  }, 2000);
  desktopTarget.onchange = async () => {
    targetRevision++;
    choosing = desktopTarget.disabled = true;
    try {
      currentBody = await ctx.invoke('selectDesktopFigure', [desktopTarget.value]);
      selectedTarget = desktopTarget.value;
      paint();
    } catch (error) {
      desktopTarget.value = selectedTarget;
      if (!disposed) ctx.ui.toast(String(error?.message || error), 'bad');
    } finally { choosing = desktopTarget.disabled = false; }
  };
  importSource.onclick = async () => {
    if (importing || !currentBody?.figure) return;
    importing = true; paint();
    try {
      await ctx.invoke('importDesktopSource', [currentBody.figure]);
      if (!disposed) doc.defaultView.location.hash = '#/provider/world%3Afigure/workbench';
    } catch (error) {
      if (!disposed) ctx.ui.toast(String(error?.message || error), 'bad');
    } finally { importing = false; if (!disposed) paint(); }
  };
  manage.onclick = () => {
    if (dialog) return;
    const pane = el('section', 'l2d-dialog-body l2d-planner-manager');
    const content = el('div', 'l2d-planner-manager-content');
    const footer = el('div', 'l2d-planner-manager-footer');
    const status = el('p', 'l2d-voice-message');
    status.setAttribute('role', 'status');
    const actions = el('div', 'l2d-dialog-actions l2d-planner-actions');
    footer.append(status, actions);
    pane.append(content, footer);
    let closed = false, writing = false, releaseEditor = () => {};
    const message = (text, bad = false) => {
      status.textContent = text;
      status.classList.toggle('bad', bad);
    };
    const errorText = error => String(error?.message || error);
    const update = state => { snapshot = state; paint(); };

    function list(focusId) {
      releaseEditor();
      message('');
      content.replaceChildren();
      actions.replaceChildren();
      const add = button(t('添加服务', 'Add service'), 'primary');
      const heading = el('div', 'l2d-planner-list-heading');
      heading.append(el('strong', null, t('已保存的服务', 'Saved services')), add);
      content.append(heading);
      const grid = el('div', 'l2d-planner-service-grid');
      const cards = new Map();
      for (const service of snapshot.services) {
        const card = el('button', 'l2d-card l2d-voice-card');
        card.type = 'button';
        const active = snapshot.selectedId === service.id;
        card.classList.toggle('selected', active);
        const head = el('span', 'l2d-voice-card-head');
        const name = service.name || providerName(service.provider);
        const state = active && service.ready ? t('当前使用', 'Selected') : service.ready ? t('可用', 'Ready') : t('待补全', 'Incomplete');
        head.append(el('strong', null, name), el('span', 'l2d-voice-badge', state));
        card.append(head, el('span', 'l2d-voice-model', service.model || t('待选模型', 'Model pending')),
          el('span', 'l2d-voice-voice', providerName(service.provider)));
        card.setAttribute('aria-label', t('编辑 ', 'Edit ') + name + ' · ' + state);
        card.onclick = () => { if (!writing) edit(service); };
        cards.set(service.id, card);
        const tile = el('div', 'l2d-planner-service-tile');
        tile.append(card);
        if (service.ready && !active) {
          const use = button(t('使用', 'Use'), 'sm l2d-planner-select');
          use.setAttribute('aria-label', t('使用 ', 'Use ') + name);
          use.onclick = async () => {
            if (writing) return;
            writing = true;
            use.disabled = true;
            message(t('正在切换…', 'Switching…'));
            try {
              update(await ctx.invoke('plannerSelect', [service.id]));
              if (!closed) list(service.id);
            } catch (error) {
              if (!closed) message(errorText(error), true);
            } finally {
              writing = false;
              if (!closed) use.disabled = false;
            }
          };
          tile.append(use);
        }
        grid.append(tile);
      }
      if (!grid.childElementCount) grid.append(el('p', 'l2d-voice-empty', t('添加一个服务后即可为独立编排选择模型。', 'Add a service to choose a model for dedicated planning.')));
      content.append(grid);
      const close = button(t('完成', 'Done'));
      close.onclick = () => { if (!writing) dialog?.dispose(); };
      actions.append(close);
      add.onclick = () => { if (!writing) edit(); };
      (cards.get(focusId) || add).focus({preventScroll:true});
    }

    function edit(service) {
      content.replaceChildren();
      actions.replaceChildren();
      message('');
      const draft = el('form', 'l2d-planner-editor');
      const field = (title, input) => {
        const label = el('label', 'l2d-field');
        input.setAttribute('aria-label', title);
        label.append(el('span', 'l2d-label', title), input);
        return label;
      };
      const input = (type, value, length) => {
        const node = el('input', 'l2d-input');
        node.type = type;
        node.value = value || '';
        node.maxLength = length;
        node.spellcheck = false;
        return node;
      };
      const provider = el('select', 'l2d-input');
      for (const id of Object.keys(PLANNER_PROVIDERS)) {
        const option = el('option', null, providerName(id));
        option.value = id;
        provider.append(option);
      }
      provider.value = service?.provider || 'openai';
      const name = input('text', service?.name, 80);
      name.placeholder = t('例如 日常表演', 'For example, Everyday performance');
      const endpoint = input('url', service?.endpoint ?? PLANNER_PROVIDERS[provider.value].endpoint, 2048);
      endpoint.required = true;
      endpoint.placeholder = 'https://example.com/v1';
      const key = input('password', '', 4096);
      key.autocomplete = 'new-password';
      const keyNote = el('small', 'l2d-planner-key-note');
      const keyField = field(t('API 密钥', 'API key'), key);
      keyField.append(keyNote);
      const model = input('text', service?.model, 240);
      model.required = true;
      const modelList = el('datalist');
      modelList.id = 'figure-planner-models';
      model.setAttribute('list', modelList.id);
      model.placeholder = t('选择或输入模型 ID', 'Choose or enter a model ID');
      const loadModels = button(t('获取模型', 'Fetch models'));
      const modelRow = el('div', 'l2d-planner-model-row');
      modelRow.append(field(t('模型', 'Model'), model), loadModels, modelList);
      const top = el('div', 'l2d-planner-editor-top');
      top.append(field(t('提供商', 'Provider'), provider), field(t('服务名称（选填）', 'Service name (optional)'), name));
      draft.append(top, field(t('服务地址', 'Service address'), endpoint), keyField, modelRow);
      content.append(draft);

      const back = button(t('返回', 'Back'), 'quiet');
      const remove = button(t('删除服务', 'Remove service'), 'quiet danger');
      const test = button(t('测试连接', 'Test connection'));
      const save = button(t('保存', 'Save'));
      const use = button(t('保存并使用', 'Save and use'), 'primary');
      const active = snapshot.selectedId === service?.id;
      if (service) actions.append(remove);
      actions.append(back, test);
      if (!active) actions.append(save);
      actions.append(use);
      const nonce = doc.defaultView.crypto?.randomUUID?.();
      let reading = false, changed = false, retiring = false, editing = true;
      const guard = ctx.guardLeave?.(() => !closed && editing && (writing || changed)
        ? t('编排服务配置尚未保存，确定离开？', 'Planner settings are unsaved. Leave anyway?') : null);
      releaseEditor = () => { editing = false; key.value = ''; guard?.dispose?.(); };
      const data = select => ({id:service?.id, provider:provider.value, name:name.value, endpoint:endpoint.value,
        model:model.value, key:key.value, nonce, select});
      const origin = value => { try { return new URL(value).origin; } catch { return ''; } };
      function describeKey() {
        const saved = service?.hasKey && origin(endpoint.value) === origin(service.endpoint);
        key.required = PLANNER_PROVIDERS[provider.value].keyRequired && !saved;
        keyNote.textContent = saved ? t('此地址的密钥已保存，留空可继续使用。', 'Leave blank to keep the saved key for this address.')
          : key.required ? t('密钥保存在 Coo 凭据区。', 'The key is stored in Coo’s credential store.')
            : t('服务无需鉴权时可留空。', 'Leave blank for services that do not require authentication.');
      }
      function lock() {
        for (const control of [provider,name,endpoint,key,model,loadModels,remove,test,save,use]) control.disabled = writing || reading || retiring;
        back.disabled = writing;
        pane.setAttribute('aria-busy', String(writing || reading));
      }
      draft.oninput = () => { changed = true; message(''); };
      endpoint.addEventListener('input', () => { describeKey(); modelList.replaceChildren(); });
      key.addEventListener('input', () => modelList.replaceChildren());
      provider.onchange = () => {
        endpoint.value = PLANNER_PROVIDERS[provider.value].endpoint;
        key.value = '';
        model.value = '';
        modelList.replaceChildren();
        describeKey();
        changed = true;
        message('');
      };
      describeKey();
      lock();
      (service ? name : provider).focus({preventScroll:true});

      async function check(models) {
        if (reading || writing || !endpoint.reportValidity() || !key.reportValidity() || !models && !model.reportValidity()) return;
        reading = true;
        lock();
        message(models ? t('正在获取模型列表…', 'Fetching models…') : t('正在测试连接…', 'Testing connection…'));
        try {
          const result = await ctx.invoke(models ? 'plannerModels' : 'plannerTest', [data(false)]);
          if (closed || !editing) return;
          if (models) {
            modelList.replaceChildren(...result.map(value => {
              const option = el('option');
              option.value = value;
              return option;
            }));
            message(result.length ? t('已获取 ', 'Loaded ') + result.length + t(' 个模型，可在模型框搜索。', ' models. Type in the model field to search.')
              : t('服务未返回模型，可手动填写模型 ID。', 'No models returned. Enter a model ID manually.'));
          } else {
            message(t('连接和动作 JSON 验证通过 · ', 'Connection and action JSON verified · ') + result.elapsedMs + ' ms');
          }
        } catch (error) {
          if (!closed && editing) message(errorText(error), true);
        } finally {
          reading = false;
          if (!closed && editing) {
            lock();
            if (models && modelList.childElementCount) model.focus({preventScroll:true});
          }
        }
      }
      loadModels.onclick = () => void check(true);
      test.onclick = () => void check(false);
      async function persist(select) {
        if (writing || reading || !draft.reportValidity()) return;
        writing = true;
        lock();
        message(t('正在保存…', 'Saving…'));
        try {
          update(await ctx.invoke('plannerSave', [data(select)]));
          if (!closed) list(service?.id === 'legacy' ? nonce : service?.id || nonce);
        } catch (error) {
          if (!closed) message(errorText(error), true);
        } finally {
          writing = false;
          if (!closed && editing) lock();
        }
      }
      save.onclick = () => void persist(false);
      use.onclick = () => void persist(true);
      draft.onsubmit = event => { event.preventDefault(); void persist(true); };
      back.onclick = () => list(service?.id);
      remove.onclick = () => {
        if (!service || reading || writing) return;
        retiring = true;
        const cancel = button(t('返回编辑', 'Back to editor'));
        const confirm = button(t('确认删除', 'Remove service'), 'danger');
        actions.replaceChildren(cancel, confirm);
        lock();
        message(active ? t('删除当前服务后，独立编排会暂用本地表演。', 'Dedicated planning uses local performance after removing the selected service.')
          : t('删除这项编排服务？', 'Remove this planner service?'));
        cancel.onclick = () => {
          retiring = false;
          actions.replaceChildren(remove, back, test, ...(active ? [] : [save]), use);
          lock();
          message('');
        };
        confirm.onclick = async () => {
          if (writing) return;
          writing = true;
          confirm.disabled = cancel.disabled = true;
          try {
            update(await ctx.invoke('plannerRemove', [service.id]));
            if (!closed) list();
          } catch (error) {
            if (!closed) message(errorText(error), true);
          } finally {
            writing = false;
            if (!closed && editing) confirm.disabled = cancel.disabled = false;
          }
        };
        cancel.focus();
      };
    }

    const parent = form.closest('dialog') || ctx.root;
    dialog = openFigureDialog(parent, t('编排服务', 'Planner services'), pane, {
      closeLabel: t('关闭', 'Close'), variant: 'l2d-planner-popup', locked: () => writing,
      onClose() { closed = true; releaseEditor(); dialog = undefined; },
    });
    if (snapshot) list();
    else {
      message(t('正在读取服务…', 'Loading services…'));
      void ctx.invoke('plannerState', []).then(state => {
        if (!closed) { update(state); list(); }
      }, error => { if (!closed) message(errorText(error), true); });
    }
  };
  const dispose = () => { disposed = true; statusPoll?.dispose?.(); dialog?.dispose(); };
  ctx.signal?.addEventListener('abort', dispose, {once:true});
  return { controls: radios, dispose, showSync(message = '') { syncState = message; paint(); } };
}

const effectsGallery = {
  async mount(ctx) {
    const cfg = await ctx.invoke('settings', []);
    if (ctx.signal?.aborted) return;

    const doc = ctx.root.ownerDocument;
    const zh = String(ctx.language || 'zh').toLowerCase().startsWith('zh');
    const t = (a, b) => zh ? a : b;
    const el = (tag, className, text) => {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const copy = {
      native: ['♥', t('Coo 原生', 'Coo original'), t('爱心、眼泪、音符与睡眠符号。', 'Hearts, tears, notes and sleep symbols.')],
      kaomoji: ['^_^', t('颜文字', 'Kaomoji'), t('随情绪变化的颜文字。', 'A text face that changes with the mood.')],
      orb: ['◉', t('情绪球', 'Emotion orb'), t('喜欢、生气或哭泣时亮起。', 'Glows in response to affection, anger and tears.')],
      flow: ['≈', t('全身粒子流', 'Full-body particle flow'), t('粒子环绕形象的前后两侧。', 'Particles circle the front and back of the figure.')],
      bubbles: ['○', t('右上角气泡', 'Upper-right bubbles'), t('彩色气泡从右上方浮起。', 'Coloured bubbles rise near the upper-right corner.')],
      softglow: ['✦', t('柔光流尘 · 第二版', 'Softglow dust · V2'), t('柔光与光尘掠过形象。', 'Soft light and dust sweep past the figure.')],
    };
    const page = el('section', 'l2d-config-page l2d-effects-page');
    holdFigurePanelPaint(page);
    const themes = el('section', 'l2d-theme-section');
    const themeHeader = el('div', 'l2d-effects-header');
    const themeIntro = el('div', 'l2d-effects-intro');
    const themeHeading = el('h3', null, t('主题配色', 'Theme colours'));
    themeHeading.id = 'l2d-theme-heading';
    const themeHint = el('p', null, t(
      '可多选随形象包带入的主题，安装后在 Coo「装扮 → 配色」切换。',
      'Include multiple themes in the pack, then switch between them under Dress up → Colours.',
    ));
    themeHint.id = 'l2d-theme-hint';
    themeIntro.append(themeHeading, themeHint);
    const themeActions = el('div', 'l2d-theme-actions');
    const themeCount = el('span', 'l2d-theme-count');
    themeCount.setAttribute('aria-live', 'polite');
    const selectThemes = el('button', 'l2d-btn quiet', t('全选', 'Select all'));
    const clearThemes = el('button', 'l2d-btn quiet', t('清空', 'Clear'));
    selectThemes.type = clearThemes.type = 'button';
    themeActions.append(themeCount, selectThemes, clearThemes);
    themeHeader.append(themeIntro, themeActions);
    const themeChoices = el('div', 'l2d-theme-choices');
    themeChoices.setAttribute('role', 'group');
    themeChoices.setAttribute('aria-labelledby', themeHeading.id);
    themeChoices.setAttribute('aria-describedby', themeHint.id);
    themes.append(themeHeader, themeChoices);

    const header = el('div', 'l2d-effects-header');
    const intro = el('div', 'l2d-effects-intro');
    const heading = el('h3', null, t('随包特效', 'Included effects'));
    heading.id = 'l2d-effects-heading';
    intro.append(heading, el('p', null, t(
      '勾选随包安装的特效，在 Coo 装扮里切换。',
      'Choose which effects to include, then switch between them in Dress up.',
    )));
    const sizes = el('fieldset', 'l2d-effect-sizes');
    const sizeChoices = el('div', 'l2d-effect-size-choices');
    const sizeHint = el('small', 'l2d-effect-size-hint', t('勾选附加特效后可调整', 'Select an extra effect to adjust'));
    sizeHint.id = 'l2d-effect-size-hint';
    sizes.setAttribute('aria-describedby', sizeHint.id);
    sizes.append(el('legend', null, t('附加特效大小', 'Extra effect size')), sizeChoices, sizeHint);
    header.append(intro, sizes);
    const cards = el('div', 'l2d-effects-grid');
    cards.setAttribute('role', 'group');
    cards.setAttribute('aria-labelledby', heading.id);
    const status = el('p', 'l2d-effects-status');
    status.setAttribute('role', 'status');

    let saved = {
      styles: normalizeEmotionEffects(cfg.emotionEffects ?? cfg.emotionEffect),
      size: normalizeEmotionEffectSize(cfg.emotionEffectSize),
      themes: normalizeFigureThemes(cfg.themePalettes),
    };
    let selected = saved, saving = false, disposed = false;
    const options = new Map();
    const sizeOptions = new Map();
    const themeOptions = new Map();
    const inactive = () => disposed || ctx.signal?.aborted;
    const sameEffects = (a, b) => a.size === b.size && a.styles.join() === b.styles.join();
    const sameThemes = (a, b) => a.themes.join() === b.themes.join();
    const sameSelection = (a, b) => sameThemes(a, b) && sameEffects(a, b);
    function paintSelection() {
      for (const [theme, input] of themeOptions) input.checked = selected.themes.includes(theme);
      const count = selected.themes.length;
      themeCount.textContent = t(`已选 ${count}/${themeOptions.size}`, `${count}/${themeOptions.size} selected`);
      selectThemes.disabled = count === themeOptions.size;
      clearThemes.disabled = count === 0;
      for (const [style, {card, input, selectedLabel}] of options) {
        input.checked = selected.styles.includes(style);
        card.classList.toggle('selected', input.checked);
        selectedLabel.style.visibility = input.checked ? 'visible' : 'hidden';
      }
      for (const [size, input] of sizeOptions) input.checked = size === selected.size;
      sizes.disabled = selected.styles.length === 1;
      sizeHint.style.visibility = sizes.disabled ? 'visible' : 'hidden';
    }
    async function saveSelection() {
      if (inactive() || saving || sameSelection(saved, selected)) return;
      const choice = selected;
      saving = true;
      status.textContent = t('保存中…', 'Saving…');
      status.classList.remove('bad');
      try {
        const patch = {};
        if (!sameEffects(saved, choice)) {
          patch['worlds.figure.emotionEffects'] = choice.styles.slice(1).join(',') || 'native';
          patch['worlds.figure.emotionEffectSize'] = choice.size;
        }
        if (!sameThemes(saved, choice)) patch['worlds.figure.themePalettes'] = choice.themes.join(',');
        await ctx.setConfig('figure', patch);
        saved = choice;
      } catch (error) {
        if (inactive()) return;
        if (sameSelection(selected, choice)) {
          selected = saved;
          paintSelection();
          status.textContent = t('保存失败，请重新选择。', 'Save failed. Please try again.');
          status.classList.add('bad');
          ctx.ui.toast(String(error?.message || error), 'bad');
          return;
        }
      } finally {
        saving = false;
      }
      if (inactive()) return;
      if (!sameSelection(saved, selected)) void saveSelection();
      else status.textContent = t('已保存', 'Saved');
    }
    function updateThemes(values) {
      if (inactive()) return;
      selected = {...selected, themes:normalizeFigureThemes(values)};
      paintSelection();
      void saveSelection();
    }
    selectThemes.addEventListener('click', () => updateThemes([...themeOptions.keys()]));
    clearThemes.addEventListener('click', () => updateThemes([]));
    for (const {id, name, console:colors} of FIGURE_THEME_PALETTES) {
      const choice = el('label', 'l2d-theme-choice');
      const swatch = el('span', 'l2d-theme-swatch');
      swatch.setAttribute('aria-hidden', 'true');
      swatch.style.setProperty('--theme-ring', `light-dark(${colors.light.a}, ${colors.dark.a})`);
      swatch.style.setProperty('--theme-tint', `light-dark(${colors.light.a2}, ${colors.dark.a2})`);
      const input = el('input', 'l2d-effect-check');
      input.type = 'checkbox';
      input.name = 'l2d-theme-palette';
      input.value = id;
      themeOptions.set(id, input);
      choice.append(swatch, el('span', 'l2d-theme-name', name[ctx.language] ?? t(name.zh, name.en)), input);
      themeChoices.append(choice);
      input.addEventListener('change', () => {
        const themes = selected.themes.filter(theme => theme !== id);
        if (input.checked) themes.push(id);
        updateThemes(themes);
      });
    }
    for (const style of EMOTION_EFFECTS) {
      const [glyph, title, description] = copy[style];
      const card = el('label', 'l2d-card l2d-effect-card' + (style === 'native' ? ' is-default' : ''));
      const input = el('input', style === 'native' ? 'l2d-effect-radio' : 'l2d-effect-check');
      input.type = 'checkbox';
      input.name = 'l2d-pet-effect';
      input.value = style;
      input.disabled = style === 'native';
      input.setAttribute('aria-label', title);
      const symbol = el('span', 'l2d-effect-symbol', glyph);
      symbol.setAttribute('aria-hidden', 'true');
      const details = el('span', 'l2d-effect-details');
      const label = el('span', 'l2d-effect-label');
      const selectedLabel = el('span', 'l2d-effect-selected', style === 'native' ? t('默认启用', 'On by default') : t('随包', 'Included'));
      selectedLabel.setAttribute('aria-hidden','true');
      label.append(el('strong', null, title), selectedLabel);
      const descriptionText = el('small', null, description);
      descriptionText.id = 'l2d-effect-description-' + style;
      input.setAttribute('aria-describedby', descriptionText.id);
      details.append(label, descriptionText);
      card.append(symbol, details, input);
      cards.append(card);
      options.set(style, {card, input, selectedLabel});
      input.addEventListener('change', () => {
        if (inactive() || input.disabled) return;
        const styles = selected.styles.filter(choice=>choice !== style);
        if (input.checked) styles.push(style);
        selected = {...selected, styles:normalizeEmotionEffects(styles)};
        paintSelection();
        void saveSelection();
      });
    }
    const sizeLabels = { small: t('小', 'Small'), medium: t('中', 'Medium'), large: t('大', 'Large') };
    for (const size of EMOTION_EFFECT_SIZES) {
      const choice = el('label', 'l2d-effect-size-choice');
      const input = el('input', 'l2d-effect-radio');
      input.type = 'radio';
      input.name = 'l2d-pet-effect-size';
      input.value = size;
      choice.append(input, el('span', null, sizeLabels[size]));
      sizeChoices.append(choice);
      sizeOptions.set(size, input);
      input.addEventListener('change', () => {
        if (inactive() || !input.checked) return;
        selected = {...selected, size};
        paintSelection();
        void saveSelection();
      });
    }
    paintSelection();
    page.append(themes, header, cards, status);
    ctx.root.append(page);
    const guard = ctx.guardLeave?.(() => saving ? t('个性化设置正在保存，确定离开？', 'Personalization is saving. Leave anyway?') : null);
    return {dispose() {
      disposed = true;
      guard?.dispose();
      page.remove();
    }};
  },
};

// The editor applies the runtime crop geometry to a small, transparent still.
function createCropEditor({doc, t, initial, loadCover}) {
  const win = doc.defaultView;
  const defaults = BODY_CROP_DEFAULT;
  let current = normalizeBodyCrop(initial);
  const initialValue = JSON.stringify(current);
  const html = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const svg = (tag, attrs = {}) => {
    const node = doc.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  };
  const button = (className, text) => {
    const node = html('button', className, text);
    node.type = 'button';
    return node;
  };

  const el = html('div', 'l2d-crop-editor');
  const preview = html('div', 'l2d-crop-preview');
  const stage = svg('svg', {viewBox:'0 0 320 292', 'aria-hidden':'true'});
  const floor = 258;
  const mask = svg('mask', {id:'l2d-edit-crop-mask', x:0, y:0, width:320, height:292, maskUnits:'userSpaceOnUse', 'mask-type':'alpha'});
  const layers = Array.from({length:24}, () => svg('path', {fill:'white'}));
  mask.append(...layers);
  const defs = svg('defs');
  defs.append(mask);
  const floorLine = svg('path', {class:'l2d-crop-floor', d:`M18 ${floor}H302`});
  const shadow = svg('ellipse', {class:'l2d-crop-shadow', cy:floor, ry:4});
  const body = svg('g', {mask:'url(#l2d-edit-crop-mask)'});
  const art = svg('g');
  const placeholder = svg('path', {class:'l2d-crop-silhouette',
    d:'M160 38a28 28 0 1 1 0 56 28 28 0 0 1 0-56Zm-18 66h36c14 0 25 12 29 25l13 53a8 8 0 0 1-16 4l-15-46-4 56-6 53a10 10 0 0 1-20-1l1-45h-2l1 45a10 10 0 0 1-20 1l-6-53-4-56-15 46a8 8 0 0 1-16-4l13-53c4-13 15-25 29-25Z'});
  const image = svg('image', {width:320, height:292, preserveAspectRatio:'none'});
  image.style.display = 'none';
  art.append(placeholder, image);
  body.append(art);
  const bubble = svg('g', {class:'l2d-crop-bubble'});
  bubble.append(svg('path', {d:'M-15-20H15a5 5 0 0 1 5 5v6a5 5 0 0 1-5 5H4L0 0-4-4h-11a5 5 0 0 1-5-5v-6a5 5 0 0 1 5-5Z'}));
  for (const x of [-5,0,5]) bubble.append(svg('circle', {cx:x, cy:-12, r:1.15}));
  stage.append(defs, floorLine, shadow, body, bubble);
  const stageBox = html('div', 'l2d-crop-stage');
  stageBox.append(stage);
  const status = html('p', 'l2d-crop-status', t('正在读取模型预览…', 'Loading figure preview…'));
  status.setAttribute('role', 'status');
  const replay = button('l2d-btn sm', t('预览过渡', 'Preview transition'));
  const reset = button('l2d-btn quiet sm', t('恢复默认', 'Reset framing'));
  const previewActions = html('div', 'l2d-crop-preview-actions');
  previewActions.append(replay, reset);
  preview.append(stageBox, previewActions, status);
  el.append(preview);

  const controls = html('div', 'l2d-crop-controls');
  const selectors = new Map();
  const sliders = new Map();
  const cropOnly = [];
  function choices(key, label, items, onlyUpper = false) {
    const row = html('div', 'l2d-crop-setting');
    const labelEl = html('span', 'l2d-label', label);
    const group = html('div', 'l2d-crop-options');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', label);
    const buttons = new Map();
    for (const [value, text] of items) {
      const node = button('l2d-btn sm', text);
      node.addEventListener('click', () => {
        if (value === current[key]) return;
        current = normalizeBodyCrop({...current, [key]:value});
        updateControls();
        updatePreview(key === 'mode');
      });
      buttons.set(value, node);
      group.append(node);
    }
    selectors.set(key, buttons);
    if (onlyUpper) cropOnly.push(...buttons.values());
    row.append(labelEl, group);
    controls.append(row);
  }
  function slider(key, label, min, max, step, format, onlyUpper = false) {
    const row = html('div', 'l2d-crop-setting');
    const range = html('input', 'l2d-range');
    range.type = 'range';
    range.id = 'l2d-crop-' + key;
    range.min = String(min);
    range.max = String(max);
    range.step = String(step);
    const labelEl = html('label', 'l2d-label', label);
    labelEl.htmlFor = range.id;
    const out = html('output', 'l2d-out');
    out.setAttribute('for', range.id);
    row.append(labelEl, range, out);
    range.addEventListener('input', () => {
      current = normalizeBodyCrop({...current, [key]:Number(range.value)});
      updateControls();
      updatePreview();
    });
    sliders.set(key, {range, out, format});
    if (onlyUpper) cropOnly.push(range);
    controls.append(row);
  }
  const percent = value => Math.round(value * 100) + '%';
  choices('mode', t('显示范围', 'Body framing'), [['full', t('全身', 'Full body')], ['upper', t('上半身', 'Upper body')]]);
  choices('edge', t('裁切形状', 'Cut shape'), [['flat', t('平口', 'Flat')], ['round', t('圆口', 'Rounded')]], true);
  slider('curve', t('圆口弧度', 'Curve depth'), 0, 2, .05, percent);
  slider('line', t('裁切线', 'Cut height'), .2, .95, .01, percent, true);
  slider('feather', t('边缘羽化', 'Edge softness'), 0, .25, .01, percent, true);
  slider('transition', t('淡入淡出', 'Transition'), 0, 1.2, .02, value => value.toFixed(2) + ' s');
  controls.append(html('p', 'l2d-crop-note', t(
    '圆口弧度 50% 为半弧，100% 为原弧深。裁切线从头顶向下计算，气泡跟随头部。',
    'At 50%, the curve is half as deep as the original. Cut height is measured from the top, and the bubble follows the head.',
  )));
  el.append(controls);

  let extent = [98,38,222,floor], head = [160,38];
  let displayed, animation = 0, loading = false, disposed = false;
  function updateControls() {
    for (const [key, buttons] of selectors) {
      for (const [value, node] of buttons) node.setAttribute('aria-pressed', String(value === current[key]));
    }
    for (const [key, {range,out,format}] of sliders) {
      range.value = String(current[key]);
      out.value = format(current[key]);
      range.setAttribute('aria-valuetext', out.value);
    }
    for (const node of cropOnly) node.disabled = current.mode !== 'upper';
    sliders.get('curve').range.disabled = current.mode !== 'upper' || current.edge !== 'round';
    reset.disabled = JSON.stringify(current) === JSON.stringify(defaults);
    replay.disabled = current.transition === 0;
  }
  function maskPath(geometry, offset) {
    const {center, halfWidth, cut, depth} = geometry;
    const middle = cut - offset, side = middle - depth;
    return depth > 0
      ? `M0 -300H320V${side}H${center+halfWidth}Q${center} ${middle+depth} ${center-halfWidth} ${side}H0Z`
      : `M0 -300H320V${middle}H0Z`;
  }
  function draw(geometry) {
    displayed = geometry;
    let previous = 0;
    for (let i=0; i<layers.length; i++) {
      const layer = layers[i];
      const fraction = (i+1)/layers.length;
      if (!geometry.featherPx && i < layers.length - 1) layer.removeAttribute('d');
      else {
        const alpha = cropFeatherAlpha(fraction, geometry.featherPx);
        layer.setAttribute('d', maskPath(geometry, geometry.featherPx * fraction));
        layer.setAttribute('opacity', String((alpha-previous)/(1-previous)));
        previous = alpha;
      }
    }
    art.setAttribute('transform', `translate(0 ${geometry.shift})`);
    const maskTransform = `translate(0 ${geometry.shift})`;
    for (const layer of layers) layer.setAttribute('transform', maskTransform);
    shadow.setAttribute('cx', geometry.center);
    shadow.setAttribute('rx', Math.max(10, geometry.halfWidth*(geometry.shift > 1 ? .66 : .42)));
    bubble.setAttribute('transform', `translate(${head[0]} ${head[1] + geometry.shift - 6})`);
  }
  function cancelAnimation() {
    if (animation) win.cancelAnimationFrame(animation);
    animation = 0;
  }
  function updatePreview(animate = false, from = displayed) {
    cancelAnimation();
    const target = cropGeometry(extent, current, floor);
    const reduceMotion = win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!animate || !from || !current.transition || reduceMotion || !win.requestAnimationFrame) {
      draw(target);
      return;
    }
    let start;
    const step = time => {
      if (disposed) return;
      start ??= time;
      const progress = Math.min(1, (time-start)/(1000*current.transition));
      draw(blendCropGeometry(from, target, progress));
      animation = progress < 1 ? win.requestAnimationFrame(step) : 0;
    };
    draw(from);
    animation = win.requestAnimationFrame(step);
  }
  replay.addEventListener('click', () => {
    const opposite = {...current,mode:current.mode === 'upper' ? 'full' : 'upper'};
    updatePreview(true, cropGeometry(extent, opposite, floor));
  });
  reset.addEventListener('click', () => {
    const switchMode = current.mode !== defaults.mode;
    current = normalizeBodyCrop(defaults);
    updateControls();
    updatePreview(switchMode);
  });
  function showImage(data) {
    if (typeof data !== 'string' || !/^data:image\/(?:png|webp);base64,/i.test(data)) return Promise.resolve(false);
    return new Promise(resolve => {
      const bitmap = new win.Image();
      bitmap.onload = () => {
        if (disposed) return resolve(false);
        try {
          const down = Math.min(1, 128/Math.max(bitmap.naturalWidth, bitmap.naturalHeight));
          const canvas = html('canvas');
          canvas.width = Math.max(1, Math.round(bitmap.naturalWidth*down));
          canvas.height = Math.max(1, Math.round(bitmap.naturalHeight*down));
          const ctx = canvas.getContext('2d', {willReadFrequently:true});
          const {width,height} = canvas;
          ctx.drawImage(bitmap, 0, 0, width, height);
          const pixels = ctx.getImageData(0,0,width,height).data;
          const measured = cropPreviewAlphaBounds(pixels, width, height);
          if (!measured) return resolve(false);
          const [x0,y0,x1,y1,headX] = measured;
          const scale = Math.min(220/(x1-x0), 220/(y1-y0));
          const px = 160-(x0+x1)*scale/2, py = floor-y1*scale;
          extent = [px+x0*scale, py+y0*scale, px+x1*scale, floor];
          head = [px+headX*scale, extent[1]];
          for (const [key,value] of Object.entries({x:px,y:py,width:width*scale,height:height*scale,href:data})) {
            image.setAttribute(key, value);
          }
          placeholder.style.display = 'none';
          image.style.display = '';
          updatePreview();
          resolve(true);
        } catch { resolve(false); }
      };
      bitmap.onerror = () => resolve(false);
      bitmap.src = data;
    });
  }
  async function activate() {
    if (loading || disposed) return;
    loading = true;
    const result = await Promise.resolve().then(loadCover).catch(() => null);
    if (disposed) return;
    const available = await showImage(result?.image);
    if (!disposed) status.textContent = available
      ? t('使用模型静态预览', 'Static model preview')
      : t('暂无模型预览，当前使用示意轮廓。', 'Figure preview unavailable. Showing a sample outline.');
  }
  updateControls();
  updatePreview();
  return {
    el, activate,
    value: () => current,
    changed: () => JSON.stringify(current) !== initialValue,
    deactivate() { updatePreview(); },
    dispose() { disposed = true; cancelAnimation(); },
  };
}

// Use only the visible body so margins in a cover never shift the cut line.
function cropPreviewAlphaBounds(data, width, height) {
  let x0=width, y0=height, x1=0, y1=0;
  for (let y=0; y<height; y++) {
    for (let x=0; x<width; x++) {
      if (data[(y*width+x)*4+3] < 32) continue;
      x0=Math.min(x0,x); x1=Math.max(x1,x+1);
      y0=Math.min(y0,y); y1=Math.max(y1,y+1);
    }
  }
  if (x1 <= x0 || y1 <= y0) return null;
  const y = Math.min(y1-1, Math.floor(y0+(y1-y0)*.14));
  let bestStart=x0, bestLength=0, start=x0;
  for (let x=x0; x<=x1; x++) {
    if (x < x1 && data[(y*width+x)*4+3] >= 32) continue;
    if (x-start > bestLength) { bestStart=start; bestLength=x-start; }
    start=x+1;
  }
  return [x0,y0,x1,y1,bestLength ? bestStart+bestLength/2 : (x0+x1)/2];
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const parts = [];
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunk)));
  }
  return btoa(parts.join(''));
}

function modelEntryName(name) {
  const lower = name.toLowerCase();
  return lower === 'figure.json' || lower.endsWith('.model3.json');
}

/** Find model or pack roots before uploading a selected folder, up to three levels deep. */
function packFiles(files, depth = 3) {
  const dirs = [...new Set(files
    .map((f) => f.path.split('/'))
    .filter((p) => {
      return p.length - 2 <= depth && modelEntryName(p[p.length - 1] || '');
    })
    .map((p) => p.slice(0, -1).join('/')))]
    .sort((a, b) => a.length - b.length);
  const roots = dirs.filter((d, i) => !dirs.slice(0, i).some((r) => d.startsWith(r + '/')));
  if (!roots.length) return [];
  return files.filter((f) => roots.some((r) => (r ? f.path.startsWith(r + '/') : true)));
}

async function droppedFiles(entry, path, depth) {
  const list = [];
  const reader = entry.createReader();
  for (let batch; (batch = await new Promise((ok, bad) => reader.readEntries(ok, bad))).length;) list.push(...batch);
  const inPack = depth === Infinity || list.some((e) => e.isFile && modelEntryName(e.name));
  const out = [];
  for (const e of list) {
    if (e.isFile && inPack) out.push({ path: `${path}/${e.name}`, file: await new Promise((ok, bad) => e.file(ok, bad)) });
    else if (e.isDirectory && (inPack || depth > 0)) out.push(...await droppedFiles(e, `${path}/${e.name}`, inPack ? Infinity : depth - 1));
  }
  return out;
}

function textPaths(value) {
  const paths = [];
  for (let path of String(value || '').split(/\r?\n/)) {
    path = path.trim().replace(/^["']|["']$/g, '');
    if (/^file:/i.test(path)) {
      try {
        const url = new URL(path);
        if (url.hostname && url.hostname !== 'localhost') continue;
        path = decodeURIComponent(url.pathname);
        if (/^\/[a-z]:\//i.test(path)) path = path.slice(1);
      } catch { continue; }
    }
    if (!/[\x00-\x1f]/.test(path) && (/^[a-z]:[\\/]/i.test(path) || path.startsWith('/'))) paths.push(path);
  }
  return [...new Set(paths)].slice(0, 16);
}

function mountWorkbenchImport({ ctx, t, chooseFolder, chooseZip, folderInput, zipInput, dropZone, importView, clearSource, setBusy, isBusy, isDisposed }) {
  const listeners = new dropZone.ownerDocument.defaultView.AbortController();
  const on = (node, event, handler) => node.addEventListener(event, handler, {signal:listeners.signal});
  let activeImportToken = null;

  function ownImport(token) {
    if (activeImportToken === token) return;
    activeImportToken = token;
    if (token) ctx.notifyOnUnmount?.('importCancel', [token]);
  }

  function cancelOwnedImport(token) {
    if (!token) return;
    if (activeImportToken === token) activeImportToken = null;
    void ctx.invoke('importCancel', [token]).catch(() => {});
  }

  async function stageZip(file) {
    if (isBusy() || isDisposed()) return;
    if (file.size > FIGURE_IMPORT.zip) { importView.note(t('ZIP 太大', 'ZIP too large'), t('请解压后选择文件夹', 'Extract it and choose the folder'), true); return; }
    clearSource(); setBusy(true, t('读取 ZIP…', 'Reading ZIP…'));
    importView.loading(t('解包中…', 'Unpacking…'));
    try {
      const bytes = await file.arrayBuffer();
      if (isDisposed()) return;
      if (bytes.byteLength > FIGURE_IMPORT.zip) throw new Error(t('ZIP 超过 32 MB，请解压后导入文件夹', 'ZIP exceeds 32 MB; import the extracted folder'));
      importView.result(await ctx.invoke('importStage', [toBase64(bytes), 'zip']));
    } catch (error) { if (!isDisposed()) importView.note(t('导入失败', 'Import failed'), text(error), true); }
    finally { setBusy(false); }
  }

  async function stageFolder(files, view) {
    if (isBusy() || isDisposed()) return;
    const picked = packFiles(files, 3);
    if (!picked.length) { view.note(t('这里没有模型包', 'No model pack here'), t('没有找到 Live2D 模型或现成形象包', 'No Live2D model or figure pack found'), false); return; }
    if (picked.length > FIGURE_IMPORT.files || picked.reduce((n, f) => n + (Number(f.file.size) || 0), 0) > FIGURE_IMPORT.folder) { view.note(t('目录过大', 'Folder too large'), t('请改用粘贴本机目录路径', 'Paste its local directory path instead'), true); return; }
    clearSource(); setBusy(true, t('读取文件夹…', 'Reading folder…'));
    view.loading(t('读取文件夹…', 'Reading folder…'));
    let token;
    try {
      token = (await ctx.invoke('importBegin', [])).token;
      if (isDisposed()) { cancelOwnedImport(token); return; }
      ownImport(token);
      let batch = [], bytes = 0;
      const flush = async () => { if (batch.length) { await ctx.invoke('importAppend', [token, batch]); batch = []; bytes = 0; } };
      for (const item of picked) {
        if (isDisposed()) return;
        if (item.file.size > FIGURE_IMPORT.file && typeof item.file.slice === 'function') {
          await flush();
          for (let offset = 0; offset < item.file.size; offset += FIGURE_IMPORT.chunk) {
            const data = await item.file.slice(offset, offset + FIGURE_IMPORT.chunk).arrayBuffer();
            if (isDisposed()) return;
            await ctx.invoke('importAppendChunk', [token, {path:item.path,offset,total:item.file.size,b64:toBase64(data)}]);
          }
        } else {
          const data = await item.file.arrayBuffer();
          if (isDisposed()) return;
          if (data.byteLength > FIGURE_IMPORT.file) throw Error(t('文件太大，无法分块读取', 'The file is too large to read without chunks'));
          if (bytes + data.byteLength > FIGURE_IMPORT.batch) await flush();
          batch.push({path:item.path,b64:toBase64(data)});
          bytes += data.byteLength;
        }
      }
      await flush();
      if (!isDisposed()) view.result(await ctx.invoke('importFinish', [token, true]));
    } catch (error) {
      if (!isDisposed()) {
        view.note(t('导入失败', 'Import failed'), text(error), true);
        cancelOwnedImport(token);
      }
    } finally { setBusy(false); }
  }

  async function importPaths(paths) {
    if (isBusy() || isDisposed() || !paths.length) return;
    clearSource();
    setBusy(true, t('读取…', 'Reading…'));
    importView.loading(t('识别模型…', 'Recognizing model…'));
    try { const result = await ctx.invoke('importPaths', [paths]); if (!isDisposed()) importView.result(result); }
    catch (e) { if (!isDisposed()) importView.note(t('导入失败', 'Import failed'), text(e), true); }
    finally { setBusy(false); }
  }

  async function importFiles(files) {
    if (isBusy() || isDisposed() || !files.length) return;
    const local = files.map(f => f.path || f.file.path).filter(p => /^[a-z]:[\\/]/i.test(p || '') || p?.startsWith('/'));
    if (local.length === files.length) return importPaths(local);
    if (files.length === 1 && /\.zip$/i.test(files[0].path)) return stageZip(files[0].file);
    if (files.length === 1 && /\.json$/i.test(files[0].path)) {
      importView.note(t('缺少同目录资源', 'Sibling files required'), t('请选择入口文件的完整路径，或拖入整个模型文件夹', 'Choose the entry file by its local path, or drop the whole model folder'), true); return;
    }
    return stageFolder(files, importView);
  }

  // Browser inputs are owned by the Coo window and open its native system dialogs.
  on(chooseFolder, 'click', () => { if (!isBusy()) folderInput.click(); });
  on(chooseZip, 'click', () => { if (!isBusy()) zipInput.click(); });
  on(folderInput, 'change', async () => {
    if (isDisposed() || isBusy()) return;
    const files = [...(folderInput.files ?? [])].map(file => ({ path: file.webkitRelativePath || file.name, file }));
    if (!files.length) return;
    try { await stageFolder(files, importView); }
    catch (e) { importView.note(t('导入失败', 'Import failed'), text(e), true); }
    finally { folderInput.value = ''; }
  });
  on(zipInput, 'change', async () => {
    if (isDisposed() || isBusy()) return;
    try { await importFiles([...(zipInput.files ?? [])].map(file => ({ path: file.name, file }))); }
    catch (e) { importView.note(t('导入失败', 'Import failed'), text(e), true); }
    finally { zipInput.value = ''; }
  });
  on(dropZone, 'click', event => {
    if (!event.target.closest('button')) dropZone.focus({preventScroll:true});
  });
  on(dropZone, 'paste', async (event) => {
    event.preventDefault();
    if (isBusy()) return;
    const data = event.clipboardData;
    const clipboardFiles = [...(data?.files ?? [])];
    const clipboardText = data?.getData('text/plain') || data?.getData('text/uri-list');
    try {
      let paths = textPaths(clipboardText);
      if (!paths.length) {
        setBusy(true, t('读取剪贴板…', 'Reading clipboard…'));
        try { paths = (await ctx.invoke('clipboard', [])).paths ?? []; }
        catch (e) { if (!clipboardFiles.length) throw e; }
        finally { setBusy(false); }
      }
      if (isDisposed()) return;
      if (paths.length) return await importPaths(paths);
      const files = clipboardFiles.map(file => ({ path: file.name, file }));
      if (files.length) return await importFiles(files);
      importView.note(t('未读到模型', 'No model found'), t('请复制文件、文件夹，或其完整路径后粘贴', 'Copy files, a folder, or their full local path, then paste'), false);
    } catch (e) { importView.note(t('粘贴失败', 'Paste failed'), text(e), true); }
  });
  on(dropZone, 'dragover', event => { event.preventDefault(); if (!isBusy()) dropZone.classList.add('over'); });
  on(dropZone, 'dragleave', event => { if (!dropZone.contains(event.relatedTarget)) dropZone.classList.remove('over'); });
  on(dropZone, 'drop', async event => {
    event.preventDefault(); dropZone.classList.remove('over');
    if (isBusy() || isDisposed()) return;
    const data = event.dataTransfer;
    if (!data) return;
    // Capture all handles synchronously; the drag data store closes after this event.
    const paths = textPaths(data.getData('text/plain') || data.getData('text/uri-list'));
    const entries = [...(data.items ?? [])].filter(item => item.kind === 'file').map(item => item.webkitGetAsEntry?.()).filter(Boolean);
    const plain = [...(data.files ?? [])].map(file => ({path:file.name,file}));
    if (paths.length) return importPaths(paths);
    setBusy(true, t('读取拖入内容…', 'Reading dropped files…'));
    try {
      const files = [];
      for (const entry of entries) {
        if (isDisposed()) return;
        if (entry.isDirectory) files.push(...await droppedFiles(entry, entry.name, 3));
        else files.push({path:entry.name,file:await new Promise((ok,bad)=>entry.file(ok,bad))});
      }
      setBusy(false);
      if (!isDisposed()) {
        const captured = files.length ? files : plain;
        if (!captured.length) throw new Error(t('未读到文件，请拖入模型文件夹或 ZIP', 'No files found; drop a model folder or ZIP'));
        await importFiles(captured);
      }
    } catch (error) { if (!isDisposed()) importView.note(t('导入失败', 'Import failed'), text(error), true); }
    finally { setBusy(false); }
  });
  return {
    ownImport, cancelOwnedImport,
    dispose() {
      listeners.abort();
      if (!ctx.signal?.aborted) cancelOwnedImport(activeImportToken);
    },
  };
}

function mountWorkbenchLibrary({grid, search, sort, countLabel, clearAll, el, t, zh, readState, actions}) {
  const doc = grid.ownerDocument;
  function renderGrid() {
    const {state, initialized, startupFailed, editingId} = readState();
    grid.replaceChildren();
    countLabel.textContent = initialized ? String(state.builds.length) : '—';
    clearAll.disabled = state.busy || state.builds.length < 2;
    if (!initialized) {
      const empty = el('div', 'l2d-empty');
      empty.append(el('strong', null, startupFailed ? t('暂时无法读取模型包', 'Could not load packs') : t('正在读取模型包…', 'Loading packs…')));
      if (startupFailed) {
        const retry = el('button', 'l2d-btn', t('重新读取', 'Retry loading'));
        retry.type = 'button';
        retry.addEventListener('click', actions.retry);
        empty.append(retry);
      }
      grid.append(empty);
      return;
    }
    if (!state.builds.length) {
      const empty = el('div', 'l2d-empty');
      empty.append(el('span', 'l2d-empty-mark', '◇'), el('strong', null, t('让一个新形象来到这里', 'Make room for a new figure')),
        el('p', null, t('从上方导入模型，打包后即可安装。', 'Import a model above, then pack and install it.')));
      grid.append(empty);
      return;
    }
    const installedId = state.installed?.buildId;
    const query = search.value.trim().toLocaleLowerCase();
    const builds = state.builds.filter(b => [b.id, b.nameZh, b.nameEn].some(value => String(value || '').toLocaleLowerCase().includes(query)));
    builds.sort((a, b) => sort.value === 'name' ? String(a.nameZh || a.nameEn || a.id).localeCompare(String(b.nameZh || b.nameEn || b.id), zh ? 'zh' : 'en') : b.at - a.at);
    if (!builds.length) {
      const empty = el('div', 'l2d-empty');
      empty.append(el('strong', null, t('没有匹配的模型包', 'No matching packs')));
      const reset = el('button', 'l2d-btn sm', t('清除搜索', 'Clear search'));
      reset.type = 'button';
      reset.addEventListener('click', () => { search.value = ''; renderGrid(); search.focus(); });
      empty.append(reset); grid.append(empty);
    }
    const kindLabels = new Map([['live2d', 'Live2D'], ['bongocat', 'BongoCat']]);
    for (const b of builds) {
      const card = el('article', 'l2d-card l2d-model-card' + (installedId === b.id ? ' installed' : '') + (editingId === b.id ? ' selected' : ''));
      card.dataset.id = b.id;
      const shown = (zh ? b.nameZh : b.nameEn) || b.nameZh || b.nameEn || b.id.replace(/(-\d{6,})+$/, '');
      if (b.thumb) {
        const preview = el('button','l2d-card-cover');
        preview.type = 'button';
        preview.setAttribute('aria-label', t(`查看 ${shown} 的封面`, `View cover for ${shown}`));
        preview.setAttribute('aria-haspopup','dialog');
        preview.addEventListener('click', () => actions.cover(b, shown));
        const img = doc.createElement('img');
        img.src = b.thumb;
        img.alt = ''; img.loading = 'lazy'; img.width = 160; img.height = 88;
        preview.append(img); card.append(preview);
      } else {
        card.appendChild(el('div', 'empty', t('无封面', 'no cover')));
      }
      const kindLabel = kindLabels.get(b.kind);
      if (kindLabel) card.append(el('span', 'l2d-card-kind', kindLabel));
      const info = el('div', 'l2d-card-info');
      const titleEl = el('button', 'title', shown);
      titleEl.addEventListener('click', () => { if (!state.busy) actions.edit(b, 'button.title'); });
      titleEl.title = b.id;
      info.appendChild(titleEl);
      const metaRow = el('div', 'l2d-card-meta');
      const metadata = `${(b.bytes / 1048576).toFixed(1)} MB · ${clock(b.at)}`;
      const meta = el('span', 'meta', metadata);
      meta.title = metadata;
      metaRow.append(meta);
      const isInstalled = installedId === b.id;
      if (isInstalled) metaRow.append(el('span', 'tagline', t('已安装', 'Installed')));
      info.append(metaRow);
      card.appendChild(info);
      const adaptation = actions.adaptationDetails(b.adaptation);
      if (adaptation) {
        const details = el('button', 'l2d-adaptation-link', adaptation.title);
        details.type = 'button';
        details.setAttribute('aria-haspopup', 'dialog');
        details.title = adaptation.title;
        details.addEventListener('click', () => actions.showAdaptation(adaptation.detail));
        info.append(details);
      }

      const install = el('button', 'l2d-btn sm l2d-install', isInstalled ? t('重新安装', 'Reinstall') : t('安装', 'Install'));
      install.addEventListener('click', () => actions.install(b.id));
      const cardActions = el('div', 'l2d-card-actions');
      cardActions.appendChild(install);

      const row = el('div', 'row');
      const edit = el('button', 'l2d-btn sm l2d-card-edit', t('编辑', 'Edit'));
      edit.title = t('编辑名称、简介和取景', 'Edit name, description and framing');
      edit.setAttribute('aria-description', edit.title);
      edit.addEventListener('click', () => { if (!state.busy) actions.edit(b, '.l2d-card-edit'); });
      const del = el('button', 'l2d-btn sm danger', t('删除', 'Delete'));
      del.addEventListener('click', () => actions.remove(b.id));
      del.classList.add('quiet');
      if (b.manualAvailable) {
        const bind = el('button','l2d-btn sm l2d-card-binding');
        bind.type = 'button';
        bind.dataset.buildId = b.id;
        const spinner = el('span','l2d-spinner');
        spinner.setAttribute('aria-hidden','true');
        bind.append(el('span','l2d-card-binding-label'), spinner);
        actions.paintBinding(bind);
        bind.addEventListener('click', () => actions.bind(b.id));
        row.append(bind);
      }
      row.append(edit, del);
      cardActions.appendChild(row);
      card.appendChild(cardActions);
      for (const button of card.querySelectorAll('button')) button.disabled = state.busy;
      grid.appendChild(card);
    }
  }

  search.addEventListener('input', renderGrid);
  sort.addEventListener('change', renderGrid);
  return {
    render:renderGrid,
    dispose() {
      search.removeEventListener('input', renderGrid);
      sort.removeEventListener('change', renderGrid);
    },
  };
}

function createWorkbenchPopups({ctx, shell, el, t, resultButton, resultBody, resultFeedback}) {
  let current = null;
  function showPopup(title, body, options = {}) {
    current?.dispose();
    const handle = openFigureDialog(shell, title, body, {
      closeLabel:t('关闭','Close'), ...options,
      onClose() { if (current === handle) current = null; options.onClose?.(); },
    });
    current = handle;
    return handle;
  }
  function reportResult(heading, lines = [], bad = false, figureId) {
    resultFeedback.replaceChildren();
    if (heading) resultFeedback.append(el('strong', null, heading));
    for (const line of lines) if (line) resultFeedback.append(el('p', null, line));
    if (figureId) {
      const row = el('div', 'l2d-install-next');
      const dress = wardrobeLink(el, t('前往装扮穿戴', 'Wear in Dress up'), 'l2d-btn sm primary');
      const configure = el('a', 'l2d-btn sm', t('打开模型设置', 'Open Model settings'));
      configure.href = '#/provider/world%3Afigure/settings';
      const feedback = el('p', 'l2d-install-feedback');
      feedback.setAttribute('role', 'status');
      feedback.textContent = t('穿戴后可在模型设置选择该形象，启用编排或语音口型。', 'Once worn, select the figure in Model settings to enable planning or audio lip sync.');
      row.append(dress, configure);
      resultFeedback.append(row, feedback);
    }
    resultFeedback.classList.toggle('has-error', bad);
    resultButton.classList.toggle('has-error', bad);
  }

  function openCover(build, title) {
    const body = el('div', 'l2d-cover-preview');
    const image = el('img', 'l2d-large-cover'); image.src = build.thumb; image.alt = title;
    const hint = el('p', 'l2d-hint', t('正在读取封面…', 'Loading the cover…'));
    hint.setAttribute('role','status');
    body.append(image, hint);
    const handle = showPopup(title, body, {variant:'l2d-image-popup'});
    ctx.invoke('coverPreview', [build.id]).then(result => {
      if (!handle.el.open) return;
      if (result?.image) { image.src = result.image; hint.textContent = ''; }
      else hint.textContent = t('当前显示这份模型包的缩略图。', 'Showing this pack’s thumbnail.');
    }).catch(error => {
      if (handle.el.open) hint.textContent = t('大图读取失败，仍可查看缩略图。', 'Could not load the cover. The thumbnail is still shown. ') + text(error);
    });
  }

  const openResults = (returnFocus = resultButton) =>
    showPopup(t('进展与结果', 'Progress & results'), resultBody, {variant:'l2d-result-popup', returnFocus});
  return {show:showPopup, openCover, openResults, reportResult, isOpen:() => current !== null, dispose:() => current?.dispose()};
}

/**
 * Coo 魔术人偶工坊 面板（浏览器端，手写 ESM，不打 bundle）。
 *
 * 导入区：[拖入 / 点击后粘贴] [选择文件夹 / ZIP] [一键打包]
 * 卡片：[安装][编辑][删除]；编辑弹层直接改 figure.json / profile.js，不重新打包。
 * 原始模型打包、现成形象包入库，均保留卡片上的安装操作。
 */
const NOTICE_TEXT = {
  zh: 'Live2D 运行组件从官方来源获取并保存在本机。生成的 Live2D 形象包包含 Cubism Core、Framework 和着色器，仅供本机使用。请保留模型、贴图和第三方组件各自的许可。',
  en: 'Live2D runtime components are obtained from official sources and stored locally. Generated Live2D figure packs include Cubism Core, Framework and shaders for local use only. Keep the licenses for models, textures and third-party components.',
};
function paintVersionBadge(button, version, acknowledged, t) {
  button.textContent = version ? `v${version}` : '…';
  const needsAcknowledgement = acknowledged === false;
  button.classList.toggle('unack', needsAcknowledgement);
  button.classList.toggle('ack', acknowledged === true);
  button.title = needsAcknowledgement ? t('请阅读并确认须知', 'Read and acknowledge the notice') : t('查看须知', 'Read notice');
  const status = needsAcknowledgement ? t('未确认须知', 'Notice not acknowledged')
    : acknowledged === true ? t('已确认', 'Acknowledged') : t('查看须知', 'Read notice');
  button.setAttribute('aria-label', `${button.textContent} · ${status}`);
}

function figureControlButton(ctx, label, opts = {}) {
  if (ctx.ui?.button) return ctx.ui.button(label, opts);
  const button = ctx.root.ownerDocument.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.className = ['btn', opts.size === 'sm' ? 'sm' : '', opts.variant || ''].filter(Boolean).join(' ');
  return button;
}

function holdFigurePanelPaint(node) {
  // Cortico can mount the panel before its stylesheet has finished loading.
  node.style.setProperty('display', 'var(--l2d-panel-display, none)');
}

function watchFigurePanelStyles(ctx, node, t) {
  let status;
  const timer = ctx.timeout?.(() => {
    if (!node.isConnected || ctx.signal?.aborted || node.ownerDocument.defaultView.getComputedStyle(node).display !== 'none') return;
    status = node.ownerDocument.createElement('p');
    status.className = 'l2d-panel-style-failure';
    status.setAttribute('role', 'status');
    status.textContent = t('界面样式暂未加载。若持续出现，请重新打开 Coo。', 'Panel styles are taking longer to load. If this persists, reopen Coo.');
    node.after(status);
  }, 6000);
  return () => { timer?.dispose(); status?.remove(); };
}

function readStudioTheme(root) {
  const style = root.ownerDocument.defaultView.getComputedStyle(root);
  const keys = ['paper', 'paper-2', 'sheet', 'sheet-2', 'ink', 'ink-soft', 'ink-dim',
    'line', 'line-2', 'accent', 'on-accent', 'ok', 'warn', 'danger'];
  const colors = {};
  for (const key of keys) {
    const color = style.getPropertyValue('--' + key).trim();
    if (/^#[0-9a-f]{6}$/i.test(color)) colors[key] = color;
  }
  return {mode: style.colorScheme, colors};
}

function createVersionButton(doc, t) {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'l2d-version-corner';
  button.setAttribute('aria-haspopup', 'dialog');
  paintVersionBadge(button, FIGURE_UI_VERSION, undefined, t);
  return button;
}

function mountPanelVersion(ctx) {
  const { root } = ctx;
  const doc = root.ownerDocument;
  const t = (zh, en) => String(ctx.language || 'zh').toLowerCase().startsWith('zh') ? zh : en;
  const header = doc.createElement('header');
  header.className = 'l2d-panel-version';
  holdFigurePanelPaint(header);
  const button = createVersionButton(doc, t);
  header.append(button);
  root.append(header);
  const stopWatchingStyles = watchFigurePanelStyles(ctx, header, t);
  let core, dialog, paintRuntime, coreFailed = false, disposed = false;
  void ctx.invoke('core', []).then(status => {
    if (disposed || ctx.signal?.aborted) return;
    core = status;
    paintVersionBadge(button, FIGURE_UI_VERSION, core?.notice?.acknowledged, t);
    paintRuntime?.();
  }, () => {
    if (disposed || ctx.signal?.aborted) return;
    coreFailed = true;
    paintRuntime?.();
  });
  button.addEventListener('click', () => {
    if (disposed || dialog) return;
    const body = doc.createElement('div');
    body.className = 'l2d-dialog-body';
    const summary = doc.createElement('p');
    summary.textContent = t(NOTICE_TEXT.zh, NOTICE_TEXT.en);
    body.append(summary);
    const card = doc.createElement('div');
    card.className = 'l2d-license l2d-license-core';
    const status = doc.createElement('div');
    status.className = 'l2d-license-core-status';
    const title = doc.createElement('strong');
    title.className = 'l2d-license-title';
    title.textContent = 'Live2D';
    status.append(title);
    const runtime = doc.createElement('span');
    runtime.setAttribute('role', 'status');
    status.append(runtime);
    const actions = doc.createElement('div');
    actions.className = 'l2d-dialog-actions';
    const confirmLink = doc.createElement('a');
    confirmLink.className = 'l2d-btn sm';
    confirmLink.href = '#/provider/world%3Afigure/workbench';
    confirmLink.textContent = t('前往工作台确认须知', 'Acknowledge in Workbench');
    actions.append(confirmLink);
    paintRuntime = () => {
      actions.hidden = core?.notice?.acknowledged !== false;
      card.classList.toggle('ok', core?.ok === true);
      runtime.textContent = core?.ok ? runtimeReadyText(core, t)
        : coreFailed ? t('暂时无法读取运行组件状态', 'Could not read runtime status')
        : core ? t('运行组件未就绪', 'Runtime not ready')
        : t('正在读取运行组件状态…', 'Reading runtime status…');
    };
    paintRuntime();
    const links = doc.createElement('span');
    links.className = 'l2d-license-docs';
    for (const [label, href] of [
      [t('Core 许可', 'Core license'), 'https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html'],
      [t('SDK 许可', 'SDK license'), 'https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html'],
      [t('打开官网', 'Download page'), core?.home || 'https://www.live2d.com/en/sdk/download/web/'],
    ]) {
      const link = doc.createElement('a');
      link.className = 'l2d-link';
      link.textContent = label;
      link.href = href;
      link.target = '_blank';
      link.rel = 'noreferrer';
      links.append(link);
    }
    card.append(status, links);
    body.append(card, actions);
    dialog = openFigureDialog(root, t('须知', 'Notice'), body, {
      closeLabel: t('关闭', 'Close'), variant: 'l2d-notice-popup',
      onClose() { dialog = null; paintRuntime = undefined; },
    });
  });
  return {dispose() {
    disposed = true;
    stopWatchingStyles();
    dialog?.dispose();
    header.remove();
  }};
}

function runtimeReadyText(core, t) {
  const kb = Math.round((core.bytes || 0) / 1024);
  return t(`运行组件已就绪 · ${core.version || ''} · ${kb} KB · 已校验`,
    `Runtime ready · ${core.version || ''} · ${kb} KB · verified`);
}

function withFigureHeader(panel) {
  return {
    async mount(ctx) {
      const version = mountPanelVersion(ctx);
      try {
        const mounted = await panel.mount(ctx);
        if (ctx.signal?.aborted) {
          mounted?.dispose();
          version.dispose();
          return;
        }
        return {dispose() {
          mounted?.dispose();
          version.dispose();
        }};
      } catch (error) {
        version.dispose();
        throw error;
      }
    },
  };
}

// Primary configuration and the quick popup share saving and dependency handling.
function settingsForm(ctx, cfg, { autosave = false, onNotice, onSaved, isDisposed = () => ctx.signal?.aborted } = {}) {
  const doc = ctx.root.ownerDocument;
  const zh = String(ctx.language || 'zh').toLowerCase().startsWith('zh');
  const t = (a, b) => zh ? a : b;
  const el = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const body = el('form', 'l2d-settings l2d-dialog-body');
  cfg={...cfg,assistAuto:cfg.assistAuto !== false,adaptationMode:cfg.adaptationMode || (cfg.assistMotions ? 'ai' : 'none')};
  const dirty = {};
  let changeVersion = 0;
  function changeSetting(key, value) {
    dirty[key] = value;
    changeVersion++;
  }
  const performanceKey = 'worlds.figure.performanceMode';
  let savedMode = cfg.performanceMode || 'vocab';
  let toolSyncPending = false;
  const controls = [];
  const fields = new Map();
  const section = title => {
    const group = el('section', 'l2d-settings-section');
    group.append(el('h3', null, title));
    body.append(group);
    return group;
  };
  let group = section(t('画质与预览', 'Quality and preview'));
  function field(key, title, hint, type, choices) {
    const row = el('label', 'l2d-setting-row');
    const label = el('span', 'l2d-setting-label');
    label.append(el('span', null, title));
    if (hint) label.append(el('small', null, hint));
    let input, control, readValue, paint = () => {};
    if (type === 'gear') {
      row.classList.add('l2d-gear-row');
      control = el('span', 'l2d-gear');
      const value = el('output', 'l2d-gear-value'); value.setAttribute('aria-hidden', 'true');
      const track = el('span', 'l2d-gear-track');
      const fill = el('span', 'l2d-gear-fill');
      const stops = el('span', 'l2d-gear-stops'); stops.setAttribute('aria-hidden', 'true');
      choices.forEach(() => stops.append(el('i')));
      input = el('input', 'l2d-gear-input');
      input.type = 'range'; input.min = '0'; input.max = String(choices.length - 1); input.step = '1';
      const initial = choices.findIndex(([v]) => v === cfg[key]);
      input.value = String(initial < 0 ? choices.findIndex(([v]) => v === (key === 'texture' ? 'original' : key === 'previewSize' ? '1024' : key === 'assistDepth' ? 'standard' : key === 'quality' ? 'balanced' : key === 'adaptationMode' ? 'none' : 'auto')) : initial);
      readValue = () => choices[Number(input.value)][0];
      paint = () => {
        const index = Number(input.value), title = choices[index][1];
        value.value = title; input.setAttribute('aria-valuetext', title);
        control.style.setProperty('--gear-ratio', String(index / (choices.length - 1)));
        control.classList.toggle('is-max', index === choices.length - 1);
      };
      input.addEventListener('input', paint); paint();
      track.append(fill, stops, input); control.append(value, track);
    } else {
      input = el(type === 'textarea' ? 'textarea' : 'input', type === 'checkbox' ? 'l2d-switch' : 'l2d-input');
      if (type !== 'textarea') input.type = type;
      else input.rows = 2;
      if (type === 'checkbox') { input.checked = cfg[key] === true; input.setAttribute('role', 'switch'); }
      else { input.value = cfg[key] || ''; input.placeholder = t('留空使用 Coo 默认目录', 'Leave empty for the Coo default'); }
    }
    input.setAttribute('aria-label', title);
    if (hint) {
      const description = label.querySelector('small');
      description.id = `figure-setting-${key}`;
      input.setAttribute('aria-describedby', description.id);
    }
    input.addEventListener('change', () => {
      if (input.disabled) return;
      paint();
      changeSetting('worlds.figure.' + key, type === 'checkbox' ? input.checked : readValue ? readValue() : input.value.trim());
    });
    fields.set(key,{input,paint,readValue,choices});
    controls.push(input); row.append(label, control || input); group.append(row); return input;
  }
  let depend=()=>{};
  let performanceSettings;
  field('cover', t('生成封面', 'Generate cover'), t('同时自动调整模型取景', 'Also fits the model framing'), 'checkbox');
  const quality = field('quality',t('画质','Quality'),t('画布随显示大小调整；原图不设软件精度上限。已有形象需重新打包安装。','Canvas follows display size; Original has no software cap. Repack existing figures to apply.'),'gear',[['economy',t('流畅','Smooth')],['balanced',t('标准','Standard')],['high',t('高清','HD')],['original',t('原图','Original')]]);
  const texture = field('texture', t('贴图精度', 'Texture resolution'), t('原图档可调整；较小的贴图占用更少显存', 'Adjustable in Original mode; smaller textures use less VRAM'), 'gear', ['512','1024','2048','4096','original'].map(value=>[value,value==='original'?t('原精度','Original'):value+' px']));
  let customTexture = cfg.texture || 'original';
  const syncQuality = () => {
    const editable = quality.value === '3';
    const selected = editable ? customTexture : ['1024','2048','4096'][Number(quality.value)];
    texture.value = String(fields.get('texture').choices.findIndex(([value])=>value===selected));
    fields.get('texture').paint(); fields.get('quality').paint();
    texture.disabled = !editable; texture.closest('.l2d-setting-row').classList.toggle('inactive',!editable);
    if (editable && customTexture !== 'original') {
      quality.setAttribute('aria-valuetext',t('自定义','Custom'));
      quality.closest('.l2d-gear').querySelector('output').value=t('自定义','Custom');
      quality.closest('.l2d-gear').classList.remove('is-max');
    }
  };
  for (const event of ['input','change']) {
    quality.addEventListener(event,syncQuality);
    texture.addEventListener(event,()=>{if(quality.value==='3'){customTexture=fields.get('texture').readValue();syncQuality();}});
  }
  syncQuality();
  field('previewSize',t('预览精度','Preview resolution'),t('动作与装扮预览默认 1024；无上限时按设备能力渲染','Action and wardrobe previews default to 1024. Unlimited uses device limits.'),'gear',figurePreviewChoices(t));
  group = section(t('打包与安装', 'Packing and installation'));
  field('clean', t('清理', 'Clean'), '', 'checkbox');
  field('autoDelete', t('安装后删除打包产物', 'Delete pack after installation'), t('仅在安装成功后执行，保留原始素材', 'Only after a successful install; source files are kept'), 'checkbox');
  const folder = field('figuresDir', t('安装目录', 'Install folder'), t('通常无需修改', 'Usually no change needed'), 'text');
  if (ctx.pickPath) {
    const picker = el('span', 'l2d-folder-control');
    const browse = figureControlButton(ctx, t('选择', 'Browse'), {size:'sm'});
    folder.replaceWith(picker); picker.append(folder, browse);
    browse.addEventListener('click', async () => {
      try {
        const path = await ctx.pickPath({kind:'directory'});
        if (path !== null && !isDisposed()) {
          folder.value = path;
          folder.dispatchEvent(new doc.defaultView.Event('change', {bubbles:true}));
        }
      } catch (error) { if (!isDisposed()) ctx.ui.toast(String(error?.message || error), 'bad'); }
    });
    controls.push(browse);
  }
  group = section(t('动作适配', 'Action mapping'));
  const mode = field('adaptationMode',t('适配方式','Adaptation mode'),t('无：仅通用配方；人工：预览并绑定；AI：交给 Coo 分析','None: generic recipes; Manual: preview and bind; AI: let Coo analyze'),'gear',[['none',t('无','None')],['manual',t('人工','Manual')],['ai','AI']]);
  const gear = field('assistGear',t('分析方式','Analysis mode'),t('图片不受支持时自动使用文本','Falls back to text when the current model cannot use images'),'gear', [['text',t('文本','Text')],['auto',t('自动','Auto')],['image',t('文本＋图片','Text + images')]]);
  const depth = field('assistDepth',t('适配深度','Adaptation depth'),t('仅文本＋图片时启用：基础取样、针对性补查、映射对照复核','Available with text + images: basic sampling, targeted inspection, mapping comparison'),'gear', [['quick',t('快速','Quick')],['standard',t('标准','Standard')],['deep',t('深入','Deep')]]);
  const automatic = field('assistAuto',t('自动安装','Automatic installation'),t('满足安装条件后自动执行；需要确认时暂停','Install when requirements are met; pause for confirmation when needed'),'checkbox');
  const confirmFallback = field('assistConfirmFallback',t('降级前确认','Confirm fallback'),t('需要沿用通用表现时先确认，默认直接继续','Ask before keeping generic behavior. Off by default.'),'checkbox');
  const roots = field('modelRoots',t('模型搜索目录','Model search folders'),t('每行一个目录；用于按名字找模型','One folder per line, used when finding models by name'),'textarea');
  roots.placeholder = t('留空时只搜索最近使用的模型目录','Leave empty to search recently used model folders');
  group = section(t('运行时表演', 'Runtime performance'));
  performanceSettings = mountPerformanceSettings(ctx, group, cfg, value => changeSetting(performanceKey, value));
  controls.push(...performanceSettings.controls);
  body.disposePlanner = performanceSettings.dispose;
  depend = () => {
    syncQuality();
    for (const input of [gear,automatic,roots,depth]) {
      input.disabled = mode.value !== '2' || input === depth && gear.value !== '2';
      input.closest('.l2d-setting-row').classList.toggle('inactive', input.disabled);
    }
    confirmFallback.disabled = automatic.disabled || !automatic.checked;
    confirmFallback.closest('.l2d-setting-row').classList.toggle('inactive', confirmFallback.disabled);
  };
  mode.addEventListener('change',depend); mode.addEventListener('input',depend); gear.addEventListener('change',depend); gear.addEventListener('input',depend); automatic.addEventListener('change',depend); depend();
  const actions = el('div', 'l2d-dialog-actions');
  if (onNotice) {
    const note = el('button', 'l2d-notice-entry', t('须知', 'Notice')); note.type = 'button';
    note.addEventListener('click', () => { if (!isDisposed()) onNotice(); });
    actions.append(note);
  }
  const status = el('span', 'l2d-settings-status', autosave ? t('修改后自动保存。', 'Changes save automatically.') : '');
  status.setAttribute('role', 'status');
  const save = figureControlButton(ctx, t('保存设置', 'Save settings'), {variant:'primary'}); save.type = 'submit'; save.hidden = autosave;
  actions.append(status, save); body.append(actions);
  let saving = false;
  const leave = ctx.guardLeave?.(() => body.isConnected && (saving || Object.keys(dirty).length) ? t('设置尚未保存，确定离开？', 'Settings are not saved. Leave anyway?') : null);
  async function syncPerformanceTools() {
    if (!toolSyncPending) return true;
    status.textContent = t('正在同步会话工具…', 'Updating conversation tools…');
    performanceSettings?.showSync(status.textContent);
    try {
      await ctx.invoke('performanceSync', []);
      await reloadFigurePrefix(ctx);
      toolSyncPending = false;
      performanceSettings?.showSync();
      return true;
    } catch {
      if (!isDisposed()) {
        status.textContent = t('档位已保存，会话工具待同步。', 'Mode saved. Conversation tools are pending.');
        performanceSettings?.showSync(t('档位已保存，点下方「重试同步」后再开始对话。', 'Mode saved. Retry tool sync below before chatting.'));
        save.textContent = t('重试同步', 'Retry sync');
        save.hidden = false;
      }
      return false;
    }
  }
  async function persist() {
    if (saving || isDisposed()) return;
    const patch = {...dirty};
    const keys = Object.keys(patch);
    const version = changeVersion;
    if (!keys.length && !toolSyncPending) { if (!autosave) await onSaved?.(); return; }
    saving = true; body.setAttribute('aria-busy','true'); save.disabled = true;
    if (!autosave) controls.forEach(input => { input.disabled = true; });
    let succeeded = false;
    try {
      if (keys.length) {
        status.textContent = t('保存中…', 'Saving…');
        if (patch[performanceKey] === 'direct') performanceSettings?.showSync(status.textContent);
        await ctx.setConfig('figure', patch);
        for (const key of keys) if (dirty[key] === patch[key]) delete dirty[key];
        const mode = patch[performanceKey];
        if (mode !== undefined) {
          toolSyncPending ||= (savedMode === 'direct') !== (mode === 'direct');
          savedMode = mode;
        }
      }
      succeeded = true;
      if (isDisposed()) return;
      const synced = await syncPerformanceTools();
      if (!isDisposed() && synced) {
        status.textContent = t('已保存', 'Saved');
        save.textContent = t('保存设置', 'Save settings');
        save.hidden = autosave;
        await onSaved?.();
      }
    } catch (error) {
      if (!isDisposed() && (!autosave || changeVersion === version)) {
        if (patch[performanceKey] === 'direct') performanceSettings?.showSync(t('档位保存失败，点下方重试。', 'Mode could not be saved. Retry below.'));
        status.textContent = t('保存失败，请重试。', 'Save failed. Please retry.');
        save.hidden = false; if (autosave) save.textContent = t('重试保存', 'Retry save');
        ctx.ui.toast(String(error?.message || error), 'bad');
      }
    } finally {
      saving = false; body.removeAttribute('aria-busy'); save.disabled = false;
      if (!autosave) { controls.forEach(input => { input.disabled = false; }); depend(); }
    }
    if (autosave && (succeeded || changeVersion !== version) && Object.keys(dirty).length && !isDisposed()) await persist();
  }
  body.addEventListener('submit', event => { event.preventDefault(); void persist(); });
  if (autosave) body.addEventListener('change', () => { void persist(); });
  body.dispose = () => { leave?.dispose(); body.disposePlanner?.(); };
  return body;
}

const configuration = {
  async mount(ctx) {
    const cfg = await ctx.invoke('settings', []);
    if (ctx.signal?.aborted) return;
    const doc = ctx.root.ownerDocument;
    const zh = String(ctx.language || 'zh').toLowerCase().startsWith('zh');
    const shell = doc.createElement('section'); shell.className = 'l2d-config-page';
    holdFigurePanelPaint(shell);
    shell.setAttribute('aria-label', zh ? '模型设置' : 'Model settings');
    let disposed = false;
    const form = settingsForm(ctx, cfg, {autosave:true, isDisposed:() => disposed || ctx.signal?.aborted});
    shell.append(form); ctx.root.append(shell);
    return {dispose() { disposed = true; form.dispose(); shell.remove(); }};
  },
};

const workshop = {
  mount(ctx) {
    const doc = ctx.root.ownerDocument;
    const zh = String(ctx.language || 'zh').toLowerCase().startsWith('zh');
    const t = (a, b) => zh ? a : b;
    const page = doc.createElement('section');
    page.className = 'l2d-config-page l2d-workshop-page';
    page.setAttribute('aria-label', t('素材工坊', 'Workshop'));
    holdFigurePanelPaint(page);

    const card = ctx.ui.sheet({
      title: t('FFA Hub 素材工坊', 'FFA Hub Workshop'),
      desc: t('浏览、下载或投稿 Live2D 和 BongoCat 原始模型素材。', 'Browse, download or submit source models for Live2D and BongoCat.'),
    });
    const actions = doc.createElement('div');
    actions.className = 'l2d-workshop-actions';
    const launch = doc.createElement('a');
    launch.className = 'btn primary l2d-workshop-link';
    launch.textContent = t('在浏览器打开工坊', 'Open workshop in browser');
    launch.href = 'https://8.148.13.225:8443/?page=figure';
    launch.target = '_blank';
    launch.rel = 'noopener noreferrer';
    const note = doc.createElement('p');
    note.className = 'sh-desc';
    note.textContent = t('使用 FFA Hub 账号登录。下载后可回到工作台导入。', 'Sign in with FFA Hub. Import downloaded models from the Workbench.');
    actions.append(launch, note);
    const submissionRule = doc.createElement('p');
    submissionRule.className = 'sh-desc';
    submissionRule.textContent = t('投稿包不得包含 Cubism Core、Cubism Framework、着色器及其打包副本。', 'Submissions must exclude Cubism Core, Cubism Framework, shaders, and bundled copies of these components.');
    card.body.append(actions, submissionRule);
    page.append(card.el);
    ctx.root.append(page);
    return {dispose() { page.remove(); }};
  },
};

export default {
  panels: {
    workshop: withFigureHeader(workshop),
    settings: withFigureHeader(configuration),
    effects: withFigureHeader(effectsGallery),
    voice: withFigureHeader(speechProviders),
    workbench: {
      mount(ctx) {
        const ui = ctx.ui;
        const doc = ctx.root.ownerDocument;
        const win = doc.defaultView;
        const zh = String(ctx.language || 'zh').toLowerCase().startsWith('zh');
        const t = (a, b) => (zh ? a : b);
        const el = (tag, cls, text) => {
          const n = doc.createElement(tag);
          if (cls) n.className = cls;
          if (text != null) n.textContent = text;
          return n;
        };

        let disposed = false;
        let initialized = false;
        let startupTimer = null;
        let startupFailed = false;
        let notice = null;
        let version = '';
        let resumeHandle = null;
        let resuming = false;
        let resumePolling = false;
        let resumePhase;
        let editingId = null;
        let noticeDialog = null;
        let settingsLoading = false;
        let settingsDialog = null;
        let assistTimer = null;
        let assistPolling = false;
        let assistState = {enabled:false,plans:[]};
        const state = { dir: '', busy: false, builds: [], installed: null, figuresDir: '' };

        // ---- Live2D 运行组件：Core 和 Framework 共用已有许可流程 ----
        const coreCard = el('div', 'l2d-license l2d-license-core');
        const coreTitle = el('strong', 'l2d-license-title', 'Live2D');
        const coreText = el('span');
        const coreLicA = el('button', 'l2d-link', t('Core 许可', 'Core license'));
        const coreLicB = el('button', 'l2d-link', t('SDK 许可', 'SDK license'));
        const coreHome = el('button', 'l2d-link', t('打开官网', 'Download page'));
        const coreGet = el('button', 'l2d-btn sm primary', t('同意并获取', 'Agree & fetch'));
        const coreStatus = el('div', 'l2d-license-core-status');
        coreStatus.append(coreTitle, coreText);
        const coreLinks = el('span', 'l2d-license-docs');
        coreLinks.append(coreLicA, coreLicB, coreHome);
        coreCard.append(coreStatus, coreLinks, coreGet);


        let core = { ok: false };
        const coreReady = () => core.ok === true;

        const openLicense = async (which) => {
          const parent = noticeDialog?.handle.el;
          try {
            const r = await ctx.invoke('license', [which]);
            if (parent?.open) openFigureDialog(parent, r.file, el('pre', 'l2d-license-document', r.text || t('读不到许可文本', 'License text missing')), {closeLabel:t('关闭','Close')});
          } catch (e) {
            if (parent?.open && noticeDialog) noticeDialog.error.textContent = text(e);
          }
        };
        coreLicA.addEventListener('click', () => openLicense('core'));
        coreLicB.addEventListener('click', () => openLicense('sdk'));
        coreHome.addEventListener('click', () => {
          if (core.home) win.open(core.home, '_blank', 'noreferrer');
        });

        function paintCore() {
          if (disposed) return;
          coreCard.classList.toggle('ok', coreReady());
          if (coreReady()) {
            coreText.textContent = runtimeReadyText(core, t);
            coreGet.hidden = true;
          } else {
            coreText.textContent = core.consentAt
              ? t('已同意许可。首次使用时会自动补齐运行组件，也可在这里重试。', 'License accepted. Missing runtime components are restored on use, or you can retry here.')
              : t('阅读 Core 和 SDK 许可后，点击「同意并获取」。扩展从 Live2D 官方来源获取组件并校验 SHA-256。', 'Read both licenses, then choose “Agree & fetch” to verify and prepare the runtime from official Live2D sources.');
            coreGet.textContent = core.consentAt ? t('获取运行组件', 'Get runtime') : t('同意并获取', 'Agree & fetch');
            coreGet.hidden = false;
          }
        }

        coreGet.addEventListener('click', async () => {
          const flow = noticeDialog;
          if (state.busy || !flow) return;
          flow.saving = true;
          flow.error.textContent = '';
          setBusy(true, t('准备 Live2D 运行组件…', 'Preparing Live2D runtime…'));
          try {
            core = await (core.consentAt ? ctx.invoke('coreRestore', []) : ctx.invoke('coreAccept', [true]));
            paintCore();
            log.append(t('Live2D 运行组件已校验', 'Live2D runtime verified'), 'dim');
          } catch (e) {
            const status = await ctx.invoke('core', []).catch(() => null);
            if (status) { core = status; paintCore(); }
            flow.error.textContent = t('获取失败，可以重试或打开官网。', 'Could not prepare the runtime. Retry or open the download page. ') + text(e);
            log.append('! ' + text(e), 'warn');
          } finally {
            setBusy(false);
            flow.saving = false;
          }
          if (coreReady()) finishNotice(flow);
        });

        const shell = el('section', 'l2d-sheet');
        holdFigurePanelPaint(shell);
        const header = el('header', 'l2d-header l2d-panel-version');
        header.setAttribute('aria-label',t('模型工坊操作','Figure workshop actions'));
        const settingsButton = figureControlButton(ctx, t('设置', 'Settings'), {size:'sm'});
        settingsButton.classList.add('l2d-settings-button');
        settingsButton.type = 'button';
        settingsButton.addEventListener('click', openSettings);
        const sheet = { el: shell, body: el('div', 'l2d-body') };
        shell.append(header, sheet.body);
        ctx.root.appendChild(shell);
        const stopWatchingStyles = watchFigurePanelStyles(ctx, shell, t);
        const operation = el('section','l2d-operation');
        operation.setAttribute('aria-label',t('导入与处理','Import and processing'));
        const operationBottom = el('div','l2d-operation-bottom');
        const versionCorner = createVersionButton(doc, t);
        versionCorner.disabled = true;
        versionCorner.addEventListener('click', () => openNotice());
        header.append(versionCorner);
        function paintNotice() {
          if (disposed) return;
          const ack = notice?.acknowledged;
          paintVersionBadge(versionCorner, version || FIGURE_UI_VERSION, ack, t);
          versionCorner.disabled = !notice || state.busy;
          noticeEntry.hidden = !ack;
          if (noticeDialog) {
            noticeDialog.accept.hidden = ack;
            noticeDialog.accept.disabled = state.busy;
          }
        }
        function ensureNotice(resume, needsCore = false) {
          if (notice?.acknowledged && (!needsCore || coreReady())) return true;
          if (notice?.acknowledged && needsCore && core.consentAt && !state.busy) {
            setBusy(true, t('准备 Live2D 运行组件…', 'Preparing Live2D runtime…'));
            void ctx.invoke('coreRestore', []).then(result => {
              if (disposed) return;
              if (result?.ok !== true) throw new Error(t('Live2D 运行组件未就绪', 'Live2D runtime is unavailable'));
              core = result;
              setBusy(false);
              paintCore();
              resume();
            }).catch(error => {
              if (disposed) return;
              setBusy(false);
              openNotice(resume, needsCore);
              if (noticeDialog) noticeDialog.error.textContent = text(error);
            });
            return false;
          }
          openNotice(resume, needsCore);
          return false;
        }


        // ---- 导入区与两个主操作 ----
        const dropZone = el('div', 'l2d-drop-zone');
        dropZone.tabIndex = 0;
        dropZone.setAttribute('role', 'region');
        dropZone.setAttribute('aria-label', t('模型导入区域，点击后可粘贴', 'Model import area; click to paste'));
        const sourceTitle = el('div', 'l2d-source-title');
        const sourceHint = el('div', 'l2d-source-hint');
        const source = el('div', 'l2d-source-copy');
        source.append(sourceTitle, sourceHint);
        const actions = el('div', 'l2d-import-controls');
        const chooseFolder = figureControlButton(ctx, t('导入文件夹', 'Import folder'), {size:'sm', variant:'primary'});
        const chooseZip = figureControlButton(ctx, t('导入 ZIP', 'Import ZIP'), {size:'sm'});
        const pack = figureControlButton(ctx, t('一键打包', 'Pack'), {size:'sm'});
        const installNow = figureControlButton(ctx, t('一键安装', 'Install'), {size:'sm', variant:'primary'});
        const skipCover = figureControlButton(ctx, t('跳过封面', 'Skip cover'), {size:'sm'});
        skipCover.type = 'button';
        skipCover.hidden = true;
        const folderInput = doc.createElement('input');
        folderInput.type = 'file';
        folderInput.webkitdirectory = true;
        folderInput.setAttribute('webkitdirectory', '');
        folderInput.hidden = true;
        const zipInput = doc.createElement('input');
        zipInput.type = 'file';
        zipInput.accept = '.zip,application/zip';
        zipInput.hidden = true;
        const pickers = el('div', 'l2d-source-pickers');
        pickers.append(chooseFolder, chooseZip);
        const installPane = el('section', 'l2d-install-pane');
        installPane.setAttribute('aria-labelledby', 'figure-install-title');
        const installCopy = el('div', 'l2d-source-copy');
        const installTitle = el('div', 'l2d-source-title', t('安装形象', 'Install figure'));
        installTitle.id = 'figure-install-title';
        const guidance = el('div', 'l2d-workflow-next l2d-source-hint');
        guidance.setAttribute('role', 'status');
        const guidanceText = el('span', 'l2d-workflow-next-copy');
        const dressLink = wardrobeLink(el, t('前往装扮穿戴', 'Wear in Dress up'), 'l2d-btn sm l2d-workflow-dress');
        dressLink.hidden = true;
        guidance.append(guidanceText);
        installCopy.append(installTitle, guidance);
        actions.append(pack, installNow, dressLink);
        installPane.append(installCopy, actions);
        dropZone.append(source, pickers);
        const lanes = el('div', 'l2d-import-lanes');
        lanes.append(dropZone, installPane);
        operation.append(lanes, folderInput, zipInput, operationBottom);
        let staged = null;
        let hasChosenImport = false;
        let sourceFeedback = '';
        let currentCover = null;
        const completed = new Map();
        const installedSources = new Set();
        function stagedWorkflow(source) {
          const models = source?.models ?? [];
          const packs = source?.packs ?? [];
          const onlyPacks = packs.length > 0 && models.length === 0;
          const mode = onlyPacks ? 'direct' : assistState.enabled ? 'ai' : assistState.adaptationMode === 'manual' ? 'manual' : 'direct';
          return {mode, models, packs};
        }
        function currentSubmission() {
          return (assistState.submissions || []).find(r => r.token === staged?.token) ?? staged?.submission;
        }
        function paintGuidance() {
          const {mode, models, packs} = stagedWorkflow(staged);
          const count = models.length + packs.length;
          const request = mode === 'ai' && currentSubmission();
          const isInstalled = count > 0 && installedSources.size === count;
          dressLink.hidden = !isInstalled;
          pack.hidden = !count || isInstalled;
          installNow.hidden = isInstalled || Boolean(count && mode !== 'direct');
          installTitle.textContent = isInstalled ? t('形象已安装', 'Figure installed') : t('安装形象', 'Install figure');
          installPane.classList.toggle('is-ready', Boolean(count && !isInstalled));
          chooseFolder.classList.toggle('primary', !count && !state.busy);
          const next = isInstalled ? t('在装扮页选中形象即可穿戴。', 'Select the figure in Dress up to wear it.')
            : !count ? t('导入后可打包或安装。', 'Import a model to pack or install it.')
            : request?.error || request?.canRetry ? t('分析尚未完成。查看进展，或重新提交。', 'Analysis did not finish. Check progress or retry.')
            : request ? t('在「进展与结果」查看分析；如果需要确认，也在那边处理。', 'Check Progress & results for analysis and any decisions.')
            : completed.size === count ? t('已加入模型包。可以从下方编辑，或直接安装。', 'Added to the library. Edit below or install directly.')
            : mode === 'manual' ? t('先预览动作和表情，确认绑定后保存模型包。', 'Preview motions and expressions, then save your bindings to a pack.')
            : mode === 'ai' ? t('提交给 Coo 分析动作和表情，再到「进展与结果」查看方案。', 'Ask Coo to map motions and expressions, then review its proposal in Progress & results.')
            : !models.length ? t('加入模型包只保存到工作台；一键安装会同时安装到 Coo。', 'Add to library saves the pack here. Install now also installs it in Coo.')
            : t('可直接安装，也可先打包编辑。', 'Install now, or pack it to edit later.');
          if (guidanceText.textContent !== next) {
            guidanceText.textContent = next;
            guidance.title = next;
          }
        }
        function paintImportButtons(count) {
          const {mode} = stagedWorkflow(staged);
          const direct = mode === 'direct';
          const request = mode === 'ai' && currentSubmission();
          pack.disabled = state.busy || !count || completed.size === count;
          pack.textContent = request?.canRetry ? t('重新提交分析','Retry analysis')
            : request ? (request.waiting?.length ? t('等待 Coo 分析','Awaiting Coo') : t('已生成方案','Proposal ready'))
              : mode === 'ai' ? t('提交 AI 适配','Submit to Coo')
                : mode === 'manual' ? t('预览并绑定','Preview & bind') : packsOnlyLabel(staged);
          installNow.disabled = state.busy || !count || installedSources.size === count;
          if (request && !request.error && !request.canRetry) pack.disabled = true;
          pack.classList.toggle('primary', !direct && !pack.disabled);
          installNow.classList.toggle('primary', direct && !installNow.disabled);
          paintGuidance();
        }
        function packsOnlyLabel(source) {
          return source?.packs?.length && !source?.models?.length ? t('加入模型包','Add to library') : t('一键打包','Pack models');
        }
        function paintSource() {
          const models = staged?.models ?? [];
          const packs = staged?.packs ?? [];
          const count = models.length + packs.length;
          const names = [...models.map(m => m.title), ...packs.map(p => (zh ? p.nameZh : p.nameEn) || p.id)];
          sourceTitle.textContent = count ? names.slice(0, 3).join('、') + (count > 3 ? t(` 等 ${count} 项`, ` and ${count - 3} more`) : '') : t('拖入模型文件夹或 ZIP', 'Drop a model folder or ZIP');
          sourceTitle.title = names.join('\n');
          const submission = currentSubmission();
          const aiHint = submission?.error ? t('提交失败 · 可重新提交分析', 'Submission failed · Retry analysis')
            : !submission ? t('准备好后提交 AI 适配', 'Submit for AI mapping when ready')
              : submission.waiting?.length ? t('已交给 Coo · 在「进展与结果」查看', 'Sent to Coo · See Progress & results')
                : t('方案已生成 · 在「进展与结果」查看', 'Proposal ready · See Progress & results');
          sourceHint.textContent = sourceFeedback || (!count
            ? t('支持 Live2D、BongoCat 和 Coo 形象包 · 可粘贴', 'Live2D, BongoCat and Coo figure packs. Paste is supported.')
            : stagedWorkflow(staged).mode === 'ai' ? aiHint
                : installedSources.size === count ? t('已安装 · 在「进展与结果」继续', 'Installed · Continue in Progress & results')
                : completed.size === count ? t('已加入模型包列表，可编辑或安装', 'Added to packs; edit or install')
                  : t(`已识别 ${count} 项`, `${count} recognized`));
          sourceHint.title = sourceHint.textContent;
          dropZone.classList.toggle('ready', count > 0);
          dropZone.setAttribute('aria-disabled', String(state.busy));
          paintImportButtons(count);
        }
        paintSource();

        // ---- 状态 + 进度 ----
        const status = el('div', 'l2d-status');
        const spinner = el('span', 'l2d-spinner');
        const dot = el('span', 'dot');
        const statusText = el('span', null, t('就绪', 'Ready'));
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        status.append(dot, spinner, statusText);
        const resultButton = figureControlButton(ctx, t('进展与结果', 'Progress & results'), {size:'sm'});
        resultButton.classList.add('l2d-result-entry');
        resultButton.setAttribute('aria-haspopup', 'dialog');
        const statusGroup = el('div', 'l2d-status-group');
        const coverSlot = el('span', 'l2d-cover-slot'); coverSlot.append(skipCover);
        statusGroup.append(status, coverSlot);
        operationBottom.append(statusGroup, resultButton);
        const resultBody = el('div', 'l2d-dialog-body l2d-results');
        const resultFeedback = el('div', 'l2d-result-feedback');
        const adaptationNote = el('div', 'l2d-adaptation-note');
        resultBody.append(resultFeedback, adaptationNote);

        function adaptationDetails(info) {
          if (!info) return null;
          const corrected = Array.isArray(info.corrected) ? info.corrected : [];
          const limited = Array.isArray(info.limited) ? info.limited : [];
          const warnings = Array.isArray(info.warnings) ? info.warnings : [];
          if (!corrected.length && !limited.length && !warnings.length) return null;
          const names = {
            eyeOpen: t('眨眼', 'Blink'), eyeSmile: t('笑眼', 'Eye smile'),
            browY: t('眉毛升降', 'Brow height'), browAngle: t('眉毛角度', 'Brow angle'),
            mouthOpen: t('张嘴', 'Mouth opening'), mouthForm: t('嘴形', 'Mouth shape'),
            cheek: t('脸红', 'Blush'), eyeBallX: t('横向视线', 'Horizontal gaze'), eyeBallY: t('纵向视线', 'Vertical gaze'),
            angleX: t('左右转头', 'Head turn'), angleY: t('抬头低头', 'Head pitch'), angleZ: t('歪头', 'Head tilt'),
            bodyX: t('身体跟随', 'Body follow'), breath: t('呼吸', 'Breathing'),
            step: t('腿部步态', 'Leg gait'), armA: t('手臂动作', 'Arm motion'), armB: t('手臂姿势', 'Arm pose'),
          };
          const show = roles => [...new Set(roles.map(r => names[r] || r))].join('、');
          const detail = el('div', 'l2d-adaptation');
          const title = limited.length || warnings.length
            ? t('已自动适配 · 部分效果简化', 'Adapted · some effects simplified')
            : t('已自动修正适配', 'Adaptation corrected automatically');
          if (corrected.length) detail.appendChild(el('p', null, t('自动识别：', 'Detected: ') + show(corrected)));
          if (limited.length) detail.appendChild(el('p', null, t('沿用基础表现，独立控制受限：', 'Basic behavior retained; independent controls limited: ') + show(limited)));
          if (warnings.length) detail.appendChild(el('p', null, t('部分配置不可用，已自动使用基础识别。', 'Some configuration is unavailable; basic detection is used.')));
          detail.appendChild(el('p', null, t('继续使用已识别的通用动作和表情，无需手动配置参数。', 'Detected generic motions and expressions remain available; no manual parameter setup is needed.')));
          return {title, detail};
        }

        function showAdaptation(info) {
          const report = adaptationDetails(info);
          adaptationNote.replaceChildren(...(report ? [el('strong', null, report.title), report.detail] : []));
        }

        const progress = el('div', 'l2d-progress');
        const progressBar = el('span');
        progress.appendChild(progressBar);
        operation.appendChild(progress);

        // Cards keep their page layout while editing in a modal dialog.
        const head = el('div', 'l2d-head');
        const libraryTitle = el('div', 'l2d-library-title');
        const countLabel = el('span', 'l2d-count', '—');
        libraryTitle.append(el('h3', null, t('模型包', 'Packs')), countLabel);
        const search = ctx.ui.input?.({type:'search', placeholder:t('搜索模型包', 'Search packs')}) ?? el('input', 'l2d-input');
        search.classList.add('l2d-search');
        search.type = 'search'; search.placeholder = t('搜索模型包', 'Search packs');
        search.setAttribute('aria-label', search.placeholder);
        const sort = el('select', 'l2d-input l2d-sort');
        sort.setAttribute('aria-label', t('排序', 'Sort'));
        for (const [value, label] of [['new', t('最近添加', 'Newest')], ['name', t('按名称', 'Name')]]) {
          const option = el('option', null, label); option.value = value; sort.append(option);
        }
        const clearAll = el('button', 'l2d-btn sm quiet', t('清空旧打包', 'Clear old packs'));
        const libraryTools = el('div', 'l2d-library-tools');
        libraryTools.append(search, sort, clearAll, settingsButton);
        head.append(libraryTitle, libraryTools);
        const dashboard = el('div', 'l2d-workbench-tools');
        dashboard.append(operation, head);
        sheet.body.append(dashboard);
        const workspace = el('div', 'l2d-workspace');
        const assistDock = el('div', 'l2d-assist-dock');
        resultBody.append(assistDock);
        const grid = el('div', 'l2d-grid');
        grid.setAttribute('aria-label', t('模型包卡片', 'Pack cards'));
        workspace.append(grid); sheet.body.append(workspace);

        const foot = el('footer', 'l2d-foot');
        const noticeEntry = el('button', 'l2d-notice-entry', t('须知', 'Notice'));
        noticeEntry.type = 'button'; noticeEntry.hidden = true;
        noticeEntry.setAttribute('aria-haspopup', 'dialog');
        noticeEntry.addEventListener('click', () => openNotice());
        const target = el('span', 'l2d-target', '');
        foot.append(noticeEntry, target); shell.append(foot);

        const logBody = el('div', 'l2d-dialog-body');
        const logHead = el('div', 'l2d-head');
        logHead.appendChild(el('span', 'l2d-head-title', t('任务记录', 'Activity')));
        const logClear = el('button', 'l2d-btn sm quiet', t('清空', 'Clear'));
        logHead.appendChild(logClear);
        const rawLog = ui.log({ maxHeight: '320px', empty: t('还没有任务记录', 'No activity yet') });
        const log = { el: rawLog.el, clear() { rawLog.clear(); resultButton.classList.remove('has-error'); },
          append(line, tone) { rawLog.append(line, tone); if (tone === 'bad' || tone === 'warn') resultButton.classList.add('has-error'); } };
        logBody.append(logHead, log.el);
        resultBody.append(logBody);
        const popups = createWorkbenchPopups({ctx, shell, el, t, resultButton, resultBody, resultFeedback});
        resultButton.addEventListener('click', () => popups.openResults());
        logClear.addEventListener('click', () => log.clear());

        function finishNotice(flow) {
          if (disposed || noticeDialog !== flow || !notice?.acknowledged || flow.needsCore && !coreReady()) return;
          flow.handle.dispose();
          void flow.resume?.();
        }

        function openNotice(resume, needsCore = false) {
          if (disposed || state.busy || !notice) return;
          const body = el('div', 'l2d-dialog-body');
          body.append(el('p', null, t(NOTICE_TEXT.zh, NOTICE_TEXT.en)));
          const error = el('p', 'has-error l2d-result-feedback');
          error.setAttribute('role', 'status');
          const accept = el('button', 'l2d-btn primary', t('我已知晓，不再分发', 'I understand — no redistribution'));
          accept.type = 'button';
          const buttons = el('div', 'l2d-dialog-actions'); buttons.append(accept);
          const flow = {resume, needsCore, accept, error, saving:false, handle:null};
          body.append(coreCard);
          body.append(error, buttons);
          flow.handle = popups.show(t('须知', 'Notice'), body, {
            variant:'l2d-notice-popup',
            locked:() => flow.saving,
            onClose() { if (noticeDialog === flow) noticeDialog = null; },
          });
          noticeDialog = flow;
          paintNotice(); paintCore();
          accept.addEventListener('click', async () => {
            if (state.busy || notice?.acknowledged) return;
            flow.saving = true;
            error.textContent = '';
            setBusy(true, t('保存须知…', 'Saving acknowledgement…'));
            try { notice = await ctx.invoke('noticeAccept', [notice.revision]); }
            catch (failure) { error.textContent = t('保存失败，可以重试。', 'Could not save. Try again. ') + text(failure); }
            finally { setBusy(false); flow.saving = false; }
            finishNotice(flow);
          });
        }

        async function openSettings() {
          if (disposed || state.busy || settingsLoading) return;
          settingsLoading = true; settingsButton.disabled = true;
          try {
            const cfg = await ctx.invoke('settings', []);
            if (disposed || state.busy) return;
            let dialog;
            const body = settingsForm(ctx, cfg, {
              isDisposed: () => disposed || ctx.signal?.aborted || !dialog?.el.open,
              onNotice: openNotice,
              onSaved: async () => {
                if (disposed) return;
                dialog?.dispose?.(); ui.toast(t('设置已保存', 'Settings saved'), 'ok');
                await refresh().catch(error => { if (!disposed) log.append(text(error), 'warn'); });
              },
            });
            dialog = openFigureDialog(shell, t('设置', 'Settings'), body, {
              closeLabel:t('关闭','Close'), variant:'l2d-settings-popup', returnFocus:settingsButton,
              onClose() { body.dispose(); settingsDialog = null; },
              locked: () => body.hasAttribute('aria-busy'),
            });
            settingsDialog = dialog;
          } catch (error) { if (!disposed) ui.toast(text(error), 'bad'); }
          finally { settingsLoading = false; if (!disposed) settingsButton.disabled = state.busy; }
        }

        function resize() {
          if (disposed) return;
          const content = shell.getBoundingClientRect();
          shell.dataset.compact = String(content.width < 760);
        }
        const observer = win.ResizeObserver ? new win.ResizeObserver(resize) : null;
        observer?.observe(ctx.root); win.addEventListener('resize', resize); resize();

        function paintAutomation(value) {
          assistState = value || {enabled:false,plans:[]};
          if (assistState.enabled && !assistTimer && ctx.interval) assistTimer = ctx.interval(async () => {
            if (disposed || state.busy || assistPolling) return;
            assistPolling = true;
            try { const value = await ctx.invoke('assistState', []); if (!disposed && !state.busy) {
              const completed = (value.plans || []).some(p=>p.status==='done' && !(assistState.plans || []).some(old=>old.id===p.id && old.status==='done'));
              if (completed) await refresh(); else paintAutomation(value);
            } }
            catch { /* The normal status and task log still report operation failures. */ }
            finally { assistPolling = false; }
          },1500);
          if (!assistState.enabled && assistTimer) { assistTimer.dispose?.(); assistTimer = null; }
          const plans = assistState.plans || [];
          const submissions = assistState.submissions || [];
          const attention = assistState.enabled && (plans.some(p => p.error || p.status === 'approved' || p.status === 'pending' && !p.automatic) || submissions.some(r => r.error || r.canRetry));
          resultButton.classList.toggle('needs-attention', Boolean(attention));
          const signature = JSON.stringify([assistState.enabled,plans,submissions]);
          if (assistDock.dataset.plans === signature) { paintSource(); return; }
          const expanded = new Set([...assistDock.querySelectorAll('details[open]')].map(d=>d.dataset.id));
          assistDock.dataset.plans = signature; assistDock.replaceChildren();
          if (!assistState.enabled) { paintSource(); return; }
          for (const request of submissions) {
            if (!request.error && !request.waiting?.length) continue;
            const message = request.error ? t('提交失败：','Submission failed: ') + request.error : t('已提交 Coo，等待方案或聊天中的模型选择：','Sent to Coo; awaiting a proposal or model choice in chat: ') + request.waiting.join('、');
            const waiting=el('div','l2d-assist-submission');waiting.append(el('p','l2d-assist-wait'+(request.error?' has-error':''),message));
            if(request.canRetry&&request.token===staged?.token && stagedWorkflow(staged).mode === 'ai'){
              const retry=el('button','l2d-btn sm',t('重新提交','Retry'));retry.disabled=state.busy;
              retry.addEventListener('click',()=>{if(!pack.disabled) void buildSources();});waiting.append(retry);
            }
            assistDock.append(waiting);
          }
          const wordNames = {neutral:'平静',happy:'开心',wink:'眨眼',love:'喜欢',shy:'害羞',surprised:'惊讶',angry:'生气',sad:'难过',sleepy:'困倦',thinking:'思考',smug:'得意',pout:'嘟嘴',worried:'担心',determined:'坚定',flustered:'慌张',scared:'害怕',excited:'兴奋',cry:'哭泣',confused:'疑惑',idle:'待机',nod:'点头',shake:'摇头',wave:'挥手',bow:'鞠躬',cheer:'欢呼',dance:'跳舞',jump:'跳跃',sit:'坐下',stretch:'伸展',shiver:'发抖'};
          const history = el('details','l2d-assist-history'); history.dataset.id='history'; history.open=expanded.has('history');
          const finished = plans.filter(p=>p.status==='done');
          history.append(el('summary',null,t(`已完成 ${finished.length} 项 · 查看记录`,`${finished.length} completed · View history`)));
          for (const plan of plans) {
            const row = el('section','l2d-assist-plan');
            const info = el('div','l2d-assist-info');
            const labels = {pending:t('待确认','Awaiting approval'),approved:t('待重试','Ready to retry'),validating:t('检查素材中','Validating'),executing:t('安装中','Installing'),done:t('已安装','Installed'),interrupted:t('任务已中断，请重新导入','Interrupted; import again')};
            info.append(el('strong',null,`${plan.model} · ${labels[plan.status] || plan.status}`));
            if (plan.status === 'pending') info.append(el('p',null,plan.automatic && !plan.error ? t('等待自动安装','Waiting for automatic installation') : plan.question));
            if (plan.error && plan.status !== 'done') info.append(el('p','has-error',plan.error));
            for (const warning of plan.reviewWarnings || []) info.append(el('p',null,t('需要确认：','Confirmation required: ') + warning));
            if (plan.summary?.length) {
              const detail = el('details','l2d-adaptation');detail.append(el('summary',null,t('适配详情','Mapping details')));
              detail.dataset.id=plan.id;detail.open=expanded.has(plan.id);
              for(const item of plan.summary)detail.append(el('p',null,t(`表现“${wordNames[item.word] || item.word}”时使用「${item.source}」：${item.reason}`,`For ${item.word}, use ${item.source}: ${item.reason}`)));
              detail.append(el('p',null,t('未映射的动作保留通用表现。','Unmapped actions retain generic behavior.')));
              for(const skipped of plan.skipped || [])detail.append(el('p',null,typeof skipped==='string'?skipped:skipped.reason || skipped.word || ''));
              info.append(detail);
            }
            const actions = el('div','l2d-dialog-actions');
            const review = plan.status === 'approved' || plan.status === 'pending' && (!plan.automatic || plan.error);
            for (const [method,label] of review ? [['assistReject',t('暂不安装','Not now')],['assistApprove',plan.status==='approved'?t('重试安装','Retry installation'):t('同意安装','Approve & install')]] : []) {
              const button = el('button','l2d-btn sm'+(method==='assistApprove'?' primary':''),label);
              button.addEventListener('click',async()=>{
                if(state.busy || method === 'assistApprove' && !ensureNotice(() => button.click(), plan.needsRuntime === true))return;
                setBusy(true,t('处理方案…','Processing proposal…'));
                try {
                  const result = await ctx.invoke(method,[plan.id]);
                  if (method === 'assistApprove' && result.figureId) popups.reportResult(t('安装完成','Installation complete'), [result.warning], false, result.figureId);
                  await refresh();
                }
                catch(error){popups.reportResult(t('处理方案失败，可以重试。','Could not process the proposal. Try again.'),[text(error)],true);log.append(text(error),'bad');await refresh().catch(()=>{});}
                finally {setBusy(false);}
              }); actions.append(button);
            }
            row.append(info,actions); (plan.status==='done'?history:assistDock).append(row);
          }
          if (finished.length) assistDock.append(history);
          assistDock.classList.toggle('history-only',assistDock.children.length===1 && assistDock.firstElementChild===history);
          paintSource();
        }

        // ---------------- 行为 ----------------
        function say(text, bad = false) {
          statusText.textContent = text;
          statusText.title = text;
          status.classList.toggle('bad', Boolean(bad));
          status.setAttribute('aria-atomic','true');
        }

        /** 忙碌时：转圈 + 一条来回走的进度线 + 秒数。 */
        let ticker = null;
        function stopTicker() {
          if (ticker?.dispose) ticker.dispose();
          else if (ticker) win.clearInterval(ticker);
          ticker = null;
        }
        let startedAt = 0;
        function busyLabel(base) {
          const ms = performance.now() - startedAt;
          say(`${base} ${(ms / 1000).toFixed(1)}s`);
        }
        function setBusy(on, base) {
          if (disposed) return;
          const locked = on || !initialized;
          state.busy = locked;
          folderInput.disabled = locked;
          zipInput.disabled = locked;
          coreGet.disabled = locked;
          paintNotice();
          ctx.root.setAttribute('aria-busy', String(on));
          for (const b of [chooseFolder, chooseZip, settingsButton]) b.disabled = locked;
          clearAll.disabled = locked || state.builds.length < 2;
          dropZone.setAttribute('aria-disabled', String(locked));
          const count = (staged?.models?.length || 0) + (staged?.packs?.length || 0);
          paintImportButtons(count);
          for (const b of grid.querySelectorAll('button')) b.disabled = on;
          for (const b of assistDock.querySelectorAll('button')) b.disabled = on;
          status.classList.toggle('busy', on);
          progress.classList.toggle('on', on);
          if (on) {
            startedAt = performance.now();
            if (base) busyLabel(base);
            stopTicker();
            ticker = ctx.interval ? ctx.interval(() => { if (state.busy) busyLabel(base); }, 250)
              : win.setInterval(() => { if (state.busy) busyLabel(base); }, 250);
          } else {
            stopTicker();
            status.classList.remove('busy');
            progress.classList.remove('on');
            if (!status.classList.contains('bad')) paintStatus();
          }
        }

        function paintStatus() {
          const bits = [];
          if (state.installed?.target) {
            const card = state.builds.find(build => build.id === state.installed.buildId);
            const name = (zh ? card?.nameZh : card?.nameEn) || card?.nameZh || card?.nameEn
              || state.installed.target.split(/[\\/]/).pop();
            bits.push(t('最近安装 · ', 'Last installed · ') + name);
          }
          else if (notice && !notice.acknowledged) bits.push(t('首次使用需确认须知','Read the notice before first use'));
          else if (notice && !coreReady()) bits.push(t('Live2D 运行组件待获取','Live2D runtime is missing'));
          if (!bits.length) bits.push(t('就绪', 'Ready'));
          say(bits.join('　'));
          target.textContent = state.figuresDir ? t('安装到 ', 'Installs to ') + state.figuresDir : '';
          target.title = state.figuresDir;
        }

        function paint() {
          if (!state.busy && modal && !state.builds.some(b => b.id === editingId)) closeEdit();
          if (!state.busy) paintStatus();
          renderGrid();
        }

        async function deletePack(id) {
          if (state.busy) return;
          const ok = await ui.confirm({
            title: t('删除这份打包产物？', 'Delete this pack?'),
            body: t('只删这一份打包，已安装的形象不受影响。', 'Only this pack folder is removed.'),
            danger: true,
          });
          if (!ok || disposed || state.busy) return;
          setBusy(true, t('删除…', 'Deleting…'));
          try {
            const r = await ctx.invoke('remove', [id]);
            if (disposed) return;
            state.builds = r.builds ?? [];
            forgetRemovedPacks();
            paint();
            log.append(t('已删除 ', 'Deleted ') + id, 'dim');
            if (r.warn) popups.reportResult(t('已删除', 'Deleted'), [r.warn]);
            ui.toast(r.warn || t('已删除', 'Deleted'), r.warn ? undefined : 'ok');
          } catch (e) {
            if (!disposed) ui.toast(text(e), 'bad');
          } finally { setBusy(false); }
        }

        const library = mountWorkbenchLibrary({
          grid, search, sort, countLabel, clearAll, el, t, zh,
          readState: () => ({state, initialized, startupFailed, editingId}),
          actions: {
            retry:startWorkbench, cover:popups.openCover, edit:openEdit, remove:deletePack,
            adaptationDetails, showAdaptation:detail => popups.show(t('适配详情','Adaptation details'), detail),
            install:id => run('install', id), bind:id => openBindings('manualOpenBuild', [id]), paintBinding:paintBindingButton,
          },
        });
        const renderGrid = library.render;

        async function refresh() {
          const r = await ctx.invoke('list', []);
          if (disposed) return;
          state.builds = r.builds ?? [];
          state.browserBuildId = r.browserBuildId;
          state.installed = r.installed ?? null;
          state.figuresDir = r.figuresDir ?? '';
          paintAutomation(r.automation);
          const d = r.dir ?? '';
          if (!initialized && d) {
            state.dir = d;
          }
          initialized = true;
          paint();
        }

        function forgetRemovedPacks() {
          const buildIds = new Set(state.builds.map(build => build.id));
          for (const [key, buildId] of completed) {
            if (!installedSources.has(key) && !buildIds.has(buildId)) completed.delete(key);
          }
        }

        async function installBuild(id) {
          const args = [state.dir, id ?? null];
          const result = await ctx.invoke('install', args);
          if (!result.replacementRequired || disposed) return result;
          const confirmed = await ui.confirm({
            title: t('替换同 ID 的形象？', 'Replace the figure with the same ID?'),
            body: t('目标目录已有另一份形象包。确认后将先备份原包，再安装这份。', 'A different pack has the same ID. The current pack will be backed up before replacement.'),
          });
          return confirmed && !disposed ? ctx.invoke('install', [...args, true]) : null;
        }

        async function run(kind, id) {
          if (state.busy) return;
          if (kind !== 'scan' && !ensureNotice(() => run(kind, id), kind === 'build')) return;
          if (kind !== 'install' && !state.dir) return;
          const label = kind === 'scan' ? t('扫描', 'Scan') : kind === 'build' ? t('打包', 'Pack') : t('安装', 'Install');
          setBusy(true, label + '…');
          log.append(`→ ${label}`, 'dim');
          try {
            const r = kind === 'install' ? await installBuild(id) : await ctx.invoke(kind, [state.dir]);
            if (disposed || !r) return;
            if (kind === 'install') {
              for (const [key, buildId] of completed) {
                if (buildId === id) installedSources.add(key);
              }
              const {models, packs} = stagedWorkflow(staged);
              if (installedSources.size && installedSources.size === models.length + packs.length) {
                sourceFeedback = '';
                dropZone.classList.remove('bad');
              }
              paintSource();
            }
            popups.reportResult(kind === 'install' ? t('安装完成','Installation complete') : `${label} ✓`, r.warn ? [r.warn] : [], false, r.figureId);
            for (const line of r.log ?? []) log.append(line, 'dim');
            log.append(`✓ ${label} · ${((performance.now() - startedAt) / 1000).toFixed(1)}s`, 'plain');
            ui.toast(`${label} ✓`, 'ok');
            if (r.warn) log.append('! ' + r.warn, 'warn');
            await refresh().catch(e => log.append(t('操作已完成，列表刷新失败：', 'Completed, but the list could not refresh: ') + text(e), 'warn'));
            if (kind === 'install' && r.figureId && !disposed && !popups.isOpen()) {
              popups.openResults(() => {
                const card = [...grid.children].find(item => item.dataset.id === id);
                return card?.querySelector('.l2d-install:not(:disabled)') ?? resultButton;
              });
            }
          } catch (e) {
            const s = text(e);
            say(t(`${label}失败 · 查看结果`, `${label} failed · See results`), true);
            popups.reportResult(t(`${label}失败，可以重试。`, `${label} failed. Try again.`),[s],true);
            log.append(`✗ ${s}`, 'bad');
            ui.toast(`${label} ✗`, 'bad');
          } finally {
            setBusy(false);
          }
        }

        let bindingEditor = null;
        let bindingOpening = null;
        let browserSessionDialog = null;
        function paintBindingButton(button) {
          const opening = button.dataset.buildId === bindingOpening?.buildId;
          const editing = button.dataset.buildId === state.browserBuildId;
          button.querySelector('.l2d-card-binding-label').textContent = opening ? t('稍候','Wait') : editing ? t('编辑中','Editing') : t('动作','Actions');
          button.title = opening ? t('正在打开动作编辑器','Opening the action editor') : t('在浏览器中编辑动作与装扮','Edit actions and wardrobe in the browser');
          if (opening) {
            button.setAttribute('aria-busy','true');
            button.setAttribute('aria-label',button.title);
          } else {
            button.removeAttribute('aria-busy');
            button.removeAttribute('aria-label');
          }
          button.setAttribute('aria-description', button.title);
          if (bindingOpening) button.setAttribute('aria-disabled','true');
          else button.removeAttribute('aria-disabled');
        }
        function paintBindingButtons() {
          for (const button of grid.querySelectorAll('.l2d-card-binding')) paintBindingButton(button);
        }
        function stopBindingFeedback(opening) {
          if (!opening) return;
          opening.timer?.dispose();
          opening.notice?.dispose?.();
          opening.timer = opening.notice = undefined;
        }
        function markBrowserEditor(buildId) {
          state.browserBuildId = buildId;
          paintBindingButtons();
        }
        function showBrowserSession(current) {
          if (browserSessionDialog) return;
          const body = el('div', 'l2d-browser-session');
          const title = current.title || t('当前模型','Current model');
          body.append(el('p', 'l2d-bind-discard-text', t(`「${title}」正在浏览器中编辑。回到原标签页可继续。`, `“${title}” is being edited in the browser. Continue in the original tab.`)));
          const actions = el('div', 'l2d-dialog-actions');
          const end = el('button', 'l2d-btn', current.saving?t('正在保存…','Saving…'):t('结束会话','End session'));
          const back = el('button', 'l2d-btn primary', t('知道了','Done'));
          let ending = false;
          end.disabled = current.saving;
          end.title = t('保留最近一次暂存的草稿','Keep the latest staged draft');
          actions.append(end, back); body.append(actions);
          const handle = browserSessionDialog = openFigureDialog(shell, t('已有浏览器编辑页','Browser editor is open'), body, {
            closeLabel: t('关闭','Close'), locked: () => ending, onClose: () => { browserSessionDialog = null; },
          });
          back.onclick = () => handle.dispose();
          end.onclick = async () => {
            ending = true; end.disabled = back.disabled = true;
            try {
              await ctx.invoke('manualBrowserEnd', [current.token]);
              if (disposed) return;
              markBrowserEditor(); handle.dispose();
              ui.toast(t('编辑会话已结束，可重新打开。','The editing session ended. You can reopen it.'));
            } catch (error) { if (!disposed) ui.toast(text(error),'bad'); }
            finally { ending = false; end.disabled = back.disabled = false; }
          };
        }
        async function openBindings(method,args,onSaved) {
          if (disposed || ctx.signal?.aborted || state.busy || bindingOpening || !ensureNotice(() => openBindings(method,args,onSaved), method === 'manualOpen')) return;
          if (bindingEditor && !bindingEditor.browser) return;
          const opening = bindingOpening = {buildId:method === 'manualOpenBuild' ? args[0] : undefined};
          try {
            paintBindingButtons();
            if (opening.buildId) opening.timer = ctx.timeout?.(() => {
              if (!disposed && !ctx.signal?.aborted && bindingOpening === opening) {
                opening.notice = ui.toast(t('正在准备模型并打开浏览器…','Preparing the model and opening the browser…'));
              }
            }, 3000);
            const current = await ctx.invoke('manualBrowserStatus', []);
            if (disposed) return;
            if (current.status === 'open') { markBrowserEditor(current.buildId); showBrowserSession(current); return; }
            const opened = await ctx.invoke('manualBrowserOpen', [method, args, zh ? 'zh' : 'en', readStudioTheme(ctx.root)]);
            if (disposed) return;
            if (opened.fallback) {
              ui.toast(t('未能打开浏览器，已切换到 Coo 内编辑。', 'Browser unavailable. Editing in Coo.'));
              bindingEditor = await openBindingEditor(ctx, method, args, async result => { onSaved?.(result); await refresh(); }, () => { bindingEditor = null; });
              return;
            }
            markBrowserEditor(opened.buildId);
            ui.toast(t('已打开浏览器编辑器', 'Opened the browser editor'), 'ok');
            let timer, stopped = false;
            const watcher = {
              browser: true,
              dispose() { stopped = true; win.clearTimeout(timer); },
            };
            bindingEditor = watcher;
            const poll = async () => {
              if (stopped || disposed) return;
              try {
                const result = await ctx.invoke('manualBrowserStatus', [opened.token]);
                if (stopped || disposed) return;
                if (result.status === 'open') {
                  timer = win.setTimeout(poll, 1400);
                  return;
                }
                if (result.status === 'saved') {
                  onSaved?.(result);
                  await refresh();
                }
              } catch (error) {
                if (!disposed && !stopped) ui.toast(text(error), 'bad');
              }
              if (bindingEditor === watcher) { bindingEditor = null; markBrowserEditor(); }
            };
            timer = win.setTimeout(poll, 1400);
          }
          catch (error) { if (!disposed && !ctx.signal?.aborted) ui.toast(text(error),'bad'); }
          finally {
            stopBindingFeedback(opening);
            bindingOpening = null;
            if (!disposed) paintBindingButtons();
            if (bindingEditor?.closed) bindingEditor = null;
          }
        }
        // ---------------- 编辑弹层 ----------------
        let modal = null;
        let editReturnFocus = null;
        let editLoading = false;
        let editDirty = () => false;
        let cropEditor = null;

        function closeEdit() {
          if (disposed || state.busy) return;
          if (modal) {
            const previousId = editingId;
            cropEditor?.dispose(); cropEditor = null;
            modal.close(); modal.remove(); modal = null; editingId = null;
            const previous = [...grid.querySelectorAll('.l2d-card')].find(card => card.dataset.id === previousId);
            previous?.classList.remove('selected');
            (previous?.querySelector(editReturnFocus) ?? search).focus({preventScroll:true});
          }
        }

        async function openEdit(b, focusSelector) {
          if (state.busy || editLoading) return;
          if (modal && editingId === b.id) { modal.querySelector('[role="tab"][aria-selected="true"], input')?.focus(); return; }
          editLoading = true;
          if (modal && editDirty()) {
            const discard = await ui.confirm({ title: t('放弃未保存的修改？', 'Discard unsaved edits?'), body: t('切换到另一份模型包。', 'Open the other pack.') });
            if (!discard || disposed || state.busy) { editLoading = false; return; }
          }
          const d = await ctx.invoke('detail', [b.id]).catch(() => null);
          editLoading = false;
          if (disposed || state.busy) return;
          if (!d) { ui.toast(t('读不到这份打包的信息', 'Cannot read this pack'), 'bad'); return; }
          editReturnFocus = focusSelector;
          cropEditor?.dispose();
          const framing = cropEditor = d.crop ? createCropEditor({
            doc, t, initial:d.crop,
            loadCover:() => ctx.invoke('cropPreview', [b.id]),
          }) : null;
          const gaze = d.gaze && d.tunable !== false ? normalizeGazeConfig(d.gaze) : null;
          modal?.close(); modal?.remove();

          editingId = b.id;
          modal = el('dialog', 'l2d-modal' + (framing || gaze ? ' l2d-crop-modal' : ''));
          for (const card of grid.querySelectorAll('.l2d-card')) card.classList.toggle('selected', card.dataset.id === editingId);
          accessibleModal(modal, t('编辑形象信息', 'Edit figure'));
          const card = el('div', 'l2d-modal-card');
          const head2 = el('div', 'l2d-modal-head');
          const heading = el('div', 'l2d-modal-heading');
          heading.appendChild(el('div', 'l2d-modal-title', t('编辑形象信息', 'Edit figure')));
          heading.appendChild(el('div', 'l2d-modal-sub', b.id.replace(/(-\d{6,})+$/, '')));
          const close = el('button', 'l2d-btn quiet l2d-modal-close', '×');
          close.setAttribute('aria-label', t('关闭编辑', 'Close editor'));
          close.addEventListener('click', closeEdit);
          head2.append(heading, close);
          card.appendChild(head2);

          const info = el('div', 'l2d-edit-info');
          const fields = {};
          const addField = (key, label, multiline, value) => {
            const wrap = el('div', 'l2d-field');
            const labelEl = el('label', 'l2d-label', label);
            wrap.appendChild(labelEl);
            const input = multiline ? doc.createElement('textarea') : doc.createElement('input');
            input.id = `l2d-edit-${key}`;
            labelEl.htmlFor = input.id;
            input.maxLength = key === 'name' ? 120 : 1000;
            input.className = 'l2d-input';
            if (multiline) input.rows = 2;
            input.value = value ?? '';
            fields[key] = input;
            wrap.appendChild(input);
            info.appendChild(wrap);
          };
          addField('name', t('名字', 'Name'), false, (zh ? d.nameZh || d.nameEn : d.nameEn || d.nameZh) || '');
          addField('about', t('一句话', 'About'), true, (zh ? d.aboutZh ?? d.aboutEn : d.aboutEn ?? d.aboutZh) || '');

          const gainWrap = el('div', 'l2d-field');
          const gainTop = el('div', 'l2d-label-row');
          gainTop.appendChild(el('span', 'l2d-label', t('身体幅度', 'Body gain')));
          const gainOut = el('output', 'l2d-out', Number(d.bodyGain ?? 1.8).toFixed(2));
          gainTop.appendChild(gainOut);
          gainWrap.appendChild(gainTop);
          const gain = doc.createElement('input');
          gain.type = 'range';
          gain.setAttribute('aria-label', t('身体幅度', 'Body gain'));
          gain.min = '0.5';
          gain.max = '3';
          gain.step = '0.05';
          gain.value = String(d.bodyGain ?? 1.8);
          gain.className = 'l2d-range';
          gain.addEventListener('input', () => { gainOut.textContent = Number(gain.value).toFixed(2); });
          gainWrap.appendChild(gain);
          gainWrap.hidden = d.tunable === false;
          info.appendChild(gainWrap);

          const styleWrap = el('div', 'l2d-field');
          styleWrap.appendChild(el('div', 'l2d-label', t('动作风格', 'Motion style')));
          const style = doc.createElement('select');
          style.className = 'l2d-input';
          style.setAttribute('aria-label', t('动作风格', 'Motion style'));
          for (const [v, label] of [['natural', t('自然', 'Natural')], ['lively', t('活泼', 'Lively')], ['calm', t('安静', 'Calm')], ['shy', t('害羞', 'Shy')]]) {
            const o = doc.createElement('option');
            o.value = v;
            o.textContent = label;
            style.appendChild(o);
          }
          style.value = d.style ?? 'natural';
          styleWrap.appendChild(style);
          styleWrap.hidden = d.tunable === false;
          info.appendChild(styleWrap);

          const gazePane = gaze ? el('div', 'l2d-edit-info') : null;
          let gazeValue;
          if (gazePane) {
            const followLabel = el('label', 'l2d-label-row');
            const follow = el('input', 'l2d-switch');
            follow.type = 'checkbox';
            follow.setAttribute('role', 'switch');
            follow.checked = gaze.enabled;
            followLabel.append(el('span', 'l2d-label', t('视线跟随鼠标', 'Follow cursor with eyes')), follow);

            const speedField = el('div', 'l2d-field l2d-gaze-speed');
            const speedLabel = el('label', 'l2d-label', t('跟随速度', 'Follow speed'));
            const speedOut = el('output', 'l2d-out');
            const speed = el('input', 'l2d-range');
            speed.type = 'range';
            speed.id = 'l2d-edit-gaze-speed';
            speedLabel.htmlFor = speed.id;
            speedOut.setAttribute('for', speed.id);
            speed.min = String(GAZE_SPEED_MIN);
            speed.max = String(GAZE_SPEED_MAX);
            speed.step = String(GAZE_SPEED_STEP);
            speed.value = String(gaze.speed);
            const updateSpeed = () => {
              speed.disabled = !follow.checked;
              speedOut.value = Number(speed.value).toFixed(2) + '×';
              speed.setAttribute('aria-valuetext', speedOut.value);
            };
            follow.addEventListener('change', updateSpeed);
            speed.addEventListener('input', updateSpeed);
            updateSpeed();
            const speedTop = el('div', 'l2d-label-row');
            speedTop.append(speedLabel, speedOut);
            speedField.append(speedTop, speed);
            gazePane.append(followLabel, speedField, el('p', 'l2d-hint l2d-gaze-note', t(
              '只调整眼球追上鼠标的快慢。需要模型有可转动的眼球参数。',
              'Changes how quickly the eyes follow the cursor. Requires movable eye parameters.',
            )));
            gazeValue = () => normalizeGazeConfig({ enabled: follow.checked, speed: Number(speed.value) });
          }

          const initialEdit = () => JSON.stringify([fields.name.value, fields.about.value, gain.value, style.value, framing?.value(), gazeValue?.()]);
          const initialValues = initialEdit();
          const initialGaze = gazeValue?.();
          const initialName = fields.name.value;
          const initialAbout = fields.about.value;
          const initialGain = gain.value, initialStyle = style.value;
          editDirty = () => initialEdit() !== initialValues;

          const hint = el('div', 'l2d-hint', t(
            '直接保存到该份打包产物。若这份已安装，需再点一次「安装」同步到 Coo。',
            'Saves without repacking. Re-install to sync if already installed.',
          ));
          let editScroll, editTabs;
          let showEditInfo = () => {};
          if (framing || gazePane) {
            editTabs = el('div', 'l2d-edit-tabs');
            editTabs.setAttribute('role', 'tablist');
            editTabs.setAttribute('aria-label', t('编辑选项', 'Editor sections'));
            editScroll = el('div', 'l2d-edit-scroll');
            const sections = [[t('信息', 'Details'), info]];
            if (framing) sections.push([t('取景', 'Framing'), framing.el]);
            if (gazePane) sections.push([t('视线', 'Gaze'), gazePane]);
            const panes = sections.map(([, pane]) => pane);
            const tabs = sections.map(([label, pane], index) => {
              const button = el('button', 'l2d-btn quiet sm', label);
              button.type = 'button';
              button.id = 'l2d-edit-tab-' + index;
              button.setAttribute('role', 'tab');
              pane.id = 'l2d-edit-pane-' + index;
              button.setAttribute('aria-controls', pane.id);
              pane.setAttribute('role', 'tabpanel');
              pane.setAttribute('aria-labelledby', button.id);
              button.addEventListener('click', () => selectTab(index));
              return button;
            });
            let selected = -1;
            function selectTab(index) {
              if (index === selected || state.busy) return;
              if (framing && panes[selected] === framing.el) framing.deactivate();
              selected = index;
              tabs.forEach((button, position) => {
                const active = position === selected;
                button.tabIndex = active ? 0 : -1;
                button.setAttribute('aria-selected', String(active));
                panes[position].hidden = !active;
              });
              editScroll.scrollTop = 0;
              if (framing && panes[selected] === framing.el) void framing.activate();
            }
            editTabs.addEventListener('keydown', event => {
              const last = tabs.length - 1;
              const move = {ArrowLeft:(selected+last)%tabs.length,ArrowRight:(selected+1)%tabs.length,Home:0,End:last}[event.key];
              if (move === undefined) return;
              event.preventDefault();
              selectTab(move);
              tabs[move].focus();
            });
            editTabs.append(...tabs);
            editScroll.append(...panes);
            card.append(editTabs, editScroll);
            showEditInfo = () => selectTab(0);
            selectTab(0);
          } else card.append(info);
          card.append(hint);

          const actions = el('div', 'l2d-modal-actions');
          const cancel = el('button', 'l2d-btn', t('取消', 'Cancel'));
          const save = el('button', 'l2d-btn primary', t('保存', 'Save'));
          const error = el('p', 'l2d-edit-feedback has-error');
          error.setAttribute('role','status');
          actions.append(error, cancel, save);
          card.appendChild(actions);

          cancel.addEventListener('click', closeEdit);
          modal.addEventListener('click', (e) => {
            if (e.target !== modal) return;
            const bounds = modal.getBoundingClientRect();
            if (e.clientX < bounds.left || e.clientX > bounds.right || e.clientY < bounds.top || e.clientY > bounds.bottom) closeEdit();
          });

          save.addEventListener('click', async () => {
            if (state.busy) return;
            if (!fields.name.value.trim()) { error.textContent = t('请输入名字后保存。', 'Enter a name and try again.'); showEditInfo(); fields.name.focus({preventScroll:true}); return; }
            error.textContent = '';
            close.disabled = cancel.disabled = save.disabled = true;
            setBusy(true, t('保存…', 'Saving…'));
            info.inert = true;
            if (editScroll) editScroll.inert = true;
            if (editTabs) editTabs.inert = true;
            try {
              const name = fields.name.value.trim();
              const about = fields.about.value.trim();
              const updatedGaze = gazeValue?.();
              const patch = {
                ...(fields.name.value !== initialName ? { [zh ? 'nameZh' : 'nameEn']: name } : {}),
                ...(fields.about.value !== initialAbout ? { [zh ? 'aboutZh' : 'aboutEn']: about } : {}),
                ...(d.tunable !== false && gain.value !== initialGain ? {bodyGain:Number(gain.value)} : {}),
                ...(d.tunable !== false && style.value !== initialStyle ? {style:style.value} : {}),
                ...(framing?.changed() ? {crop:framing.value()} : {}),
                ...(updatedGaze && (updatedGaze.enabled !== initialGaze.enabled || updatedGaze.speed !== initialGaze.speed)
                  ? {gaze:updatedGaze} : {}),
              };
              if (Object.keys(patch).length) await ctx.invoke('edit', [b.id, patch]);
              if (disposed) return;
              const currentCard = [...grid.children].find(item => item.dataset.id === b.id);
              const title = currentCard?.querySelector('button.title');
              if (title) title.textContent = name;
              if (patch.nameZh !== undefined) b.nameZh = name;
              if (patch.nameEn !== undefined) b.nameEn = name;
              await refresh().catch(() => {});
              if (disposed) return;
              setBusy(false);
              closeEdit();
              ui.toast(t('已保存', 'Saved'), 'ok');
              log.append(t('编辑 · ', 'Edited · ') + b.id, 'dim');
            } catch (e) {
              if (!disposed) error.textContent = t('保存失败，可以重试。', 'Could not save. Try again. ') + text(e);
            } finally {
              close.disabled = cancel.disabled = save.disabled = false;
              info.inert = false;
              if (editScroll) editScroll.inert = false;
              if (editTabs) editTabs.inert = false;
              setBusy(false);
              if (!disposed && modal?.open && error.textContent) save.focus({preventScroll:true});
            }
          });

          modal.appendChild(card);
          shell.appendChild(modal);
          modal.showModal();
          fields.name.focus({preventScroll:true});
        }

        const importView = {
          loading(label) { sourceTitle.textContent = label; sourceHint.textContent = ''; },
          note(title, detail, bad) {
            clearSource();
            sourceFeedback = [detail || title, t('可重新选择文件夹或 ZIP','Choose a folder or ZIP again')].join(' · ');
            paintSource();
            popups.reportResult(title,[detail,t('可重新选择文件夹、ZIP，或粘贴模型路径。','Choose a folder or ZIP again, or paste the model path.')],Boolean(bad));
            dropZone.classList.toggle('bad', Boolean(bad));
          },
          result(result) {
            if (disposed) { importTransfer.cancelOwnedImport(result.token); return; }
            importTransfer.ownImport(result.token);
            staged = result; completed.clear(); installedSources.clear(); dropZone.classList.remove('bad');
            sourceFeedback = '';
            if (result.submission) {
              assistState = { ...assistState, submissions: [...(assistState.submissions || []).filter(r => r.token !== result.token), result.submission] };
            }
            showAdaptation(null);
            const count = (result.models?.length || 0) + (result.packs?.length || 0);
            const problems = (result.problems || []).map(p => p.reason).filter(Boolean);
            if (!count) {
              const reason = problems.join('；') || t('未找到 Live2D 模型或现成形象包', 'No Live2D model or figure pack found');
              sourceFeedback = reason;
              popups.reportResult(t('未找到可导入的模型，可重新选择。','No model could be imported. Choose again.'),[reason],true);
            } else {
              popups.reportResult(t(`已识别 ${count} 项`, `${count} recognized`),problems);
              if (assistState.enabled) {
                void ctx.invoke('assistState', []).then(value => {
                  if (!disposed && staged === result && typeof value?.enabled === 'boolean') paintAutomation(value);
                }).catch(() => {});
              }
            }
            paintSource();
          },
        };

        function clearSource() {
          hasChosenImport = true;
          sourceFeedback = '';
          staged = null; completed.clear(); installedSources.clear(); showAdaptation(null); paintSource();
          popups.reportResult('');
          dropZone.classList.remove('bad');
        }

        const importTransfer = mountWorkbenchImport({
          ctx, t, chooseFolder, chooseZip, folderInput, zipInput, dropZone, importView, clearSource, setBusy,
          isBusy: () => state.busy, isDisposed: () => disposed,
        });

        skipCover.addEventListener('click', async () => {
          const cover = currentCover;
          if (!cover || disposed || skipCover.disabled) return;
          skipCover.disabled = true;
          try {
            await ctx.invoke('skipImportCover', [cover.token, cover.dir]);
            if (!disposed && currentCover === cover) skipCover.textContent = t('已跳过封面', 'Cover skipped');
          } catch (error) {
            if (disposed || currentCover !== cover) return;
            skipCover.disabled = false;
            ui.toast(t('暂时无法跳过封面。', 'Could not skip the cover. ') + text(error), 'bad');
          }
        });

        async function buildSources(installAfterBuild = false) {
          if (state.busy || !staged) return;
          const source = staged;
          const {mode, models, packs} = stagedWorkflow(source);
          const newModels = models.filter(model => !completed.has('importBuild:' + model.dir));
          const needsCore = mode === 'direct' && newModels.length > 0;
          if (!ensureNotice(() => { if (staged === source) return buildSources(installAfterBuild); }, needsCore)) return;
          if (mode === 'ai') {
            setBusy(true,t('交给 Coo 分析…','Asking Coo to analyze…'));
            try {
              const result = await ctx.invoke('assistAnalyze',[source.token,models.map(m=>m.dir),packs.map(p=>p.dir)]);
              popups.reportResult(result.queued===false?t('已提交，请等待 Coo 的方案','Already submitted; wait for Coo'):t('已交给 Coo 分析','Sent to Coo for analysis'));
              await refresh().catch(error=>log.append(text(error),'warn'));
            } catch (error) {
              popups.reportResult(t('提交失败，可以重新提交。','Submission failed. Try again.'),[text(error)],true);
              log.append(text(error),'bad'); await refresh().catch(()=>{});
            }
            finally{setBusy(false);}return;
          }
          if (mode === 'manual' && models.length) {
            const next = newModels[0];
            if (next) {
              await openBindings('manualOpen', [source.token, next.dir], result => {
                if (staged === source) completed.set('importBuild:' + next.dir, result.buildId);
              });
              return;
            }
          }
          const pending = [
            ...models.map(item => ({ ...item, method: 'importBuild' })),
            ...packs.map(item => ({ ...item, method: 'importKeep' })),
          ];
          const token = source.token;
          setBusy(true, installAfterBuild ? t('打包并安装…', 'Packing and installing…') : t('打包…', 'Packing…'));
          const failures = [];
          const warnings = [];
          const newInstalls = [];
          let deferred = 0;
          for (const item of pending) {
            if (disposed) break;
            const key = item.method + ':' + item.dir;
            if (installAfterBuild ? installedSources.has(key) : completed.has(key)) continue;
            try {
              if (!completed.has(key)) {
                if (item.method === 'importBuild') {
                  currentCover = { token, dir: item.dir };
                  skipCover.textContent = t('跳过封面', 'Skip cover');
                  skipCover.disabled = false;
                  skipCover.hidden = false;
                }
                let result;
                try { result = await ctx.invoke(item.method, [token, item.dir, false]); }
                finally { currentCover = null; skipCover.hidden = true; }
                completed.set(key, result.buildId);
                for (const line of result.log ?? []) log.append(line, 'dim');
                if (result.adaptation) showAdaptation(result.adaptation);
                if (result.warn) { warnings.push(result.warn); log.append('! ' + result.warn, 'warn'); }
              }
              if (installAfterBuild && !disposed) {
                const buildId = completed.get(key);
                if (!buildId) throw Error(t('找不到这份打包记录', 'Pack record not found'));
                const result = await installBuild(buildId);
                if (!result) { deferred++; continue; }
                installedSources.add(key);
                if (result.figureId) newInstalls.push(result.figureId);
                for (const line of result.log ?? []) log.append(line, 'dim');
                if (result.warn) { warnings.push(result.warn); log.append('! ' + result.warn, 'warn'); }
              }
            } catch (e) {
              const failure = `${item.title || item.id || item.dir} · ${text(e)}`;
              failures.push(failure); log.append(failure, 'bad');
            }
          }
          try { await refresh(); }
          catch (e) { log.append('! ' + text(e), 'warn'); }
          finally { setBusy(false); }
          if (disposed) return;
          sourceFeedback = failures.length
            ? t(`${failures.length} 项失败；再次点击只重试未完成项，原因见结果`, `${failures.length} failed; click again to retry unfinished items; see results`)
            : deferred ? t(`${deferred} 项已打包；再次点击可确认替换`, `${deferred} packed; click again to confirm replacement`)
            : '';
          paintSource();
          dropZone.classList.toggle('bad', failures.length > 0);
          const done = installAfterBuild ? t('安装完成', 'Installation complete') : t('打包完成', 'Packing complete');
          popups.reportResult(sourceFeedback || done, [...failures,...warnings], failures.length > 0, newInstalls.length === 1 ? newInstalls[0] : undefined);
          if (newInstalls.length > 1) resultFeedback.append(wardrobeLink(el, t('打开装扮', 'Open Dress up')));
          if (newInstalls.length && !popups.isOpen()) {
            popups.openResults(() => {
              if (!dressLink.hidden) return dressLink;
              if (!installNow.hidden && !installNow.disabled) return installNow;
              return resultButton;
            });
          }
        }

        function accessibleModal(node, title) {
          node.setAttribute('role', 'dialog');
          node.setAttribute('aria-modal', 'true');
          node.setAttribute('aria-label', title);
          node.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeEdit(); }
          });
          node.addEventListener('cancel', (e) => { e.preventDefault(); closeEdit(); });
        }

        // ---------------- 绑定 ----------------
        pack.addEventListener('click', () => buildSources());
        installNow.addEventListener('click', () => buildSources(true));
        clearAll.addEventListener('click', async () => {
          if (state.busy) return;
          const ok = await ui.confirm({
            title: t('清空旧打包？', 'Clear old packs?'),
            body: t('保留最新一份，其余打包目录直接删除。已安装的形象不受影响。', 'Keeps the newest pack; installed figures stay.'),
            danger: true,
          });
          if (!ok || disposed || state.busy) return;
          setBusy(true, t('清理…', 'Clearing…'));
          try {
            const r = await ctx.invoke('clearAll', []);
            if (disposed) return;
            state.builds = r.builds ?? [];
            forgetRemovedPacks();
            paint();
            log.append(t('清空旧打包 · 删除 ', 'Cleared ') + r.removed + t(' 份', ' packs'), 'dim');
            const failures = r.failures ?? [];
            const warnings = [...failures, r.warn].filter(Boolean);
            const heading = failures.length ? t('有打包目录未删除', 'Some pack folders could not be deleted') : t('已清空', 'Cleared');
            if (warnings.length) popups.reportResult(heading, warnings, failures.length > 0);
            ui.toast(failures.length ? heading : r.warn || heading, failures.length ? 'bad' : r.warn ? undefined : 'ok');
          } catch (e) {
            if (!disposed) ui.toast(text(e), 'bad');
          } finally { setBusy(false); }
        });

        function stopResume() {
          if (resumeHandle?.dispose) resumeHandle.dispose();
          else if (resumeHandle) win.clearInterval(resumeHandle);
          resumeHandle = null;
        }
        async function pollResume() {
          if (disposed || !resuming || resumePolling) return;
          resumePolling = true;
          try {
            const remote = await ctx.invoke('state', []);
            if (disposed || remote.busy) return;
            await refresh();
            if (disposed) return;
            resuming = false; stopResume(); setBusy(false);
            const completed = resumePhase && remote.steps?.[resumePhase];
            if (completed?.phase === 'error') say(completed.hint, true);
          } catch (error) { if (!disposed) say(t('等待后台任务结果…', 'Waiting for the background task…')); }
          finally { resumePolling = false; }
        }

        async function initialize(attempt, recovering) {
          startupTimer = null;
          if (disposed || ctx.signal?.aborted) return;
          try {
            const [coreState, initial] = await Promise.all([
              ctx.invoke('core', []), ctx.invoke('state', []),
            ]);
            if (disposed) return;
            await refresh();
            if (disposed) return;
            core = coreState;
            notice = initial.notice;
            version = initial.version;
            paintCore();
            for (const line of initial.log ?? []) log.append(line, 'dim');
            if (initial.busy) {
              resuming = true;
              resumePhase = Object.keys(initial.steps ?? {}).find(key => initial.steps[key].phase === 'loading');
              setBusy(true, t('后台任务处理中…', 'Background task running…'));
              resumeHandle = ctx.interval ? ctx.interval(pollResume, 800) : win.setInterval(pollResume, 800);
            } else {
              setBusy(false);
              const imported = await ctx.invoke('takeDesktopImport', []).catch(() => null);
              if (typeof imported?.token === 'string' && Array.isArray(imported.models)) {
                if (!disposed && !hasChosenImport && !state.busy) importView.result(imported);
                else importTransfer.cancelOwnedImport(imported.token);
              }
            }
            if (recovering || attempt) ctx.refresh?.().catch(() => {});
          } catch (error) {
            if (disposed || ctx.signal?.aborted) return;
            const transient = [0, 502, 503, 504].includes(error?.status) || /扩展正在停止|extension is stopping/i.test(text(error));
            if (transient && attempt < 20) {
              if (!attempt) setBusy(true, t('正在等待扩展恢复…', 'Waiting for the extension…'));
              const retry = () => void initialize(attempt + 1, true);
              startupTimer = ctx.timeout ? ctx.timeout(retry, 1000) : win.setTimeout(retry, 1000);
              return;
            }
            startupFailed = true;
            say(transient ? t('扩展尚未就绪，可以重新读取。', 'The extension is still starting. Try loading again.') : text(error), true);
            setBusy(false);
            renderGrid();
          }
        }
        function startWorkbench() {
          const recovering = startupFailed;
          startupFailed = false;
          renderGrid();
          setBusy(true, t('读取…', 'Loading…'));
          void initialize(0, recovering);
        }

        // Host calls the returned disposer when switching panels.
        startWorkbench();
        return { dispose() {
          if (disposed) return;
          disposed = true;
          stopWatchingStyles();
          if (startupTimer?.dispose) startupTimer.dispose();
          else if (startupTimer != null) win.clearTimeout(startupTimer);
          stopTicker();
          stopResume();
          assistTimer?.dispose?.();
          stopBindingFeedback(bindingOpening);
          bindingEditor?.dispose?.();
          browserSessionDialog?.dispose();
          cropEditor?.dispose(); cropEditor = null;
          modal?.close(); modal?.remove();
          popups.dispose(); settingsDialog?.dispose();
          observer?.disconnect(); win.removeEventListener('resize', resize);
          shell.remove();
          importTransfer.dispose();
          library.dispose();
          ctx.root.removeAttribute('aria-busy');
        } };
      },
    },
  },
};

function text(e) {
  return String((e && e.message) || e);
}

function clock(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
