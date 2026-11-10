const GEAR_THEMES = [
  {id:'purple',name:'紫色',en:'Purple',color:'#9654ff',fill:'linear-gradient(105deg,#343bdc 0%,#7957f5 36%,#bd75ff 65%,#8c52ff 100%)',glow:'#ece0ff90'},
  {id:'red',name:'红色',en:'Red',color:'#d63c43',fill:'linear-gradient(105deg,#b91c3c 0%,#e83e50 36%,#ff7c66 65%,#e53e3e 100%)',glow:'#ffe3df90'},
  {id:'amber',name:'琥珀金',en:'Amber',color:'#a9660c',fill:'linear-gradient(105deg,#b96510 0%,#f59e0b 36%,#ffd76a 65%,#e98c18 100%)',glow:'#fff4c990'},
  {id:'blue',name:'蓝色',en:'Blue',color:'#2767d9',fill:'linear-gradient(105deg,#1645bc 0%,#397ff5 36%,#79bdff 65%,#2775e8 100%)',glow:'#dceeff90'},
  {id:'cyan',name:'青色',en:'Cyan',color:'#087f91',fill:'linear-gradient(105deg,#086b88 0%,#0da8b5 36%,#73e5dc 65%,#099caf 100%)',glow:'#d9fffa90'},
  {id:'green',name:'绿色',en:'Green',color:'#23834b',fill:'linear-gradient(105deg,#166941 0%,#2ba869 36%,#8cdb95 65%,#269851 100%)',glow:'#e1ffe590'},
];
const GEAR_PARTICLES = [
  {id:'stars',name:'星点',en:'Stars',icon:'✦'},
  {id:'glow',name:'浮光',en:'Glow',icon:'●'},
  {id:'meteors',name:'流星',en:'Meteors',icon:'╱'},
  {id:'hearts',name:'爱心',en:'Hearts',icon:'♥'},
  {id:'bubbles',name:'气泡',en:'Bubbles',icon:'○'},
  {id:'ripples',name:'光波',en:'Ripples',icon:'◎'},
];
const normalizeGearTheme = value => GEAR_THEMES.some(t=>t.id===value)?value:'red';
const normalizeGearParticles = value => GEAR_PARTICLES.some(p=>p.id===value)?value:'stars';

const UI_MATERIALS = [
  {id:'matte',name:'哑光',en:'Matte',icon:'◼'},
  {id:'glass',name:'磨砂玻璃',en:'Glass',icon:'◈'},
  {id:'silk',name:'柔光',en:'Silk',icon:'◒'},
  {id:'metal',name:'拉丝金属',en:'Metal',icon:'▤'},
];
const UI_MODES = [{id:'auto',name:'跟随 Coo',en:'Follow Coo',icon:'◐'},{id:'light',name:'浅色',en:'Light',icon:'☼'},{id:'dark',name:'深色',en:'Dark',icon:'☾'}];
const UI_CORNERS = [{id:'standard',name:'标准',en:'Standard',icon:'▢'},{id:'soft',name:'柔和',en:'Soft',icon:'●'},{id:'crisp',name:'利落',en:'Crisp',icon:'▪'}];
const UI_GLOWS = [{id:'off',name:'关闭',en:'Off',icon:'○'},{id:'subtle',name:'轻柔',en:'Subtle',icon:'◉'},{id:'vivid',name:'鲜明',en:'Vivid',icon:'✺'}];
const UI_STYLES = [{id:'classic',name:'默认',en:'Default',icon:'◻'},{id:'custom',name:'自定义',en:'Custom',icon:'✧'}];
const UI_BUTTON_FILLS = [{id:'solid',name:'纯色',en:'Solid',icon:'■'},{id:'gradient',name:'渐变',en:'Gradient',icon:'◩'}];
function normalizeAppearance(cfg = {}) {
  const choice=(list,value,fallback)=>list.some(item=>item.id===value)?value:fallback;
  return {gearTheme:normalizeGearTheme(cfg.gearTheme),particleEffect:normalizeGearParticles(cfg.particleEffect),
    uiMaterial:choice(UI_MATERIALS,cfg.uiMaterial,'matte'),uiMode:choice(UI_MODES,cfg.uiMode,'auto'),
    uiCorners:choice(UI_CORNERS,cfg.uiCorners,'standard'),uiGlow:choice(UI_GLOWS,cfg.uiGlow,'subtle'),uiStyle:choice(UI_STYLES,cfg.uiStyle,'custom'),uiButtonFill:choice(UI_BUTTON_FILLS,cfg.uiButtonFill,'gradient')};
}

const EMOTION_EFFECTS = Object.freeze(['native', 'kaomoji', 'orb', 'flow', 'bubbles', 'softglow']);
const EMOTION_EFFECT_SIZES = Object.freeze(['small', 'medium', 'large']);

function normalizeEmotionEffect(value) {
  return EMOTION_EFFECTS.includes(value) ? value : 'native';
}

function normalizeEmotionEffectSize(value) {
  return EMOTION_EFFECT_SIZES.includes(value) ? value : 'medium';
}

function emotionStyleModule(style, size) {
  return `export default ${JSON.stringify(style)};\nexport const emotionEffectSize = ${JSON.stringify(normalizeEmotionEffectSize(size))};\n`;
}

// Same reach budget as the image figure's natural mode, independent of the body bounds.
const EMOTION_EFFECT_REACH = 1.95;

const field = (key,label,value='',extra={}) => ({key,label,value,...extra});
const address = value => field('endpoint','服务地址',value,{url:true,required:true});
const model = value => field('model','模型',value,{required:true});
const voice = (value='',label='音色') => field('voice',label,value,{required:true});
const number = (key,label,value,min,max,step=.1) => field(key,label,value,{type:'number',min,max,step});

// Provider names and fields follow AstrBot's TTS catalog. The desktop owns
// playback and adapters here run independently of AstrBot.
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

function openFigureDialog(parent, title, body, { closeLabel, variant = '', onClose, locked = () => false } = {}) {
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
    previous?.focus?.({preventScroll:true});
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
  const names={neutral:'中性',happy:'开心',wink:'眨眼',love:'喜欢',shy:'害羞',surprised:'惊讶',angry:'生气',sad:'难过',sleepy:'困倦',thinking:'思考',smug:'得意',pout:'嘟嘴',worried:'担心',determined:'坚定',flustered:'慌乱',scared:'害怕',excited:'兴奋',cry:'哭泣',confused:'疑惑',idle:'待机',nod:'点头',shake:'摇头',wave:'挥手',bow:'鞠躬',cheer:'欢呼',dance:'跳舞',jump:'跳跃',sit:'坐下',stretch:'伸展',shiver:'发抖'};
  const label=w=>zh?names[w]||w:w;
  const el=(tag,cls,text)=>{const n=doc.createElement(tag);n.className=cls||'';if(text!=null)n.textContent=text;return n;};
  const previous=doc.activeElement;
  const requestedToken=win.crypto?.randomUUID?.();
  if(requestedToken)ctx.notifyOnUnmount?.('manualClose',[requestedToken]);
  const modal=el('dialog','l2d-modal l2d-bind-modal');modal.setAttribute('aria-label',t('动作与装扮','Actions and wardrobe'));
  const card=el('div','l2d-bind-card'),head=el('div','l2d-modal-head'),heading=el('div','l2d-modal-heading');
  heading.append(el('div','l2d-modal-title',t('动作与装扮','Actions and wardrobe')),el('div','l2d-modal-sub',t('选择表情或动作，可预览效果','Choose a target and preview its effect')));
  const close=el('button','l2d-btn quiet l2d-modal-close','×');close.setAttribute('aria-label',t('关闭动作与装扮','Close editor'));head.append(heading,close);
  const layout=el('div','l2d-bind-layout'),left=el('nav','l2d-bind-targets'),stage=el('section','l2d-bind-stage'),right=el('section','l2d-bind-resources');
  left.setAttribute('aria-label',t('绑定目标','Binding targets'));right.setAttribute('aria-label',t('原生资源','Native resources'));
  const gallery=el('div','l2d-bind-gallery');gallery.setAttribute('aria-label',t('模型效果对照','Model comparison'));gallery.setAttribute('aria-live','polite');
  const hint=el('p','l2d-bind-status',t('准备预览…','Preparing preview…'));hint.setAttribute('role','status');
  const toolbar=el('div','l2d-bind-toolbar'),raw=el('button','l2d-btn sm',t('组合效果','Combined')),replay=el('button','l2d-btn sm',t('重新取样','Resample')),reset=el('button','l2d-btn sm',t('复位','Reset'));
  const retry=el('button','l2d-btn sm',t('重试预览','Retry preview'));retry.hidden=true;
  const resolutionLabel=el('label','l2d-bind-quality',t('预览精度','Preview size')),resolution=el('select','l2d-input');resolution.setAttribute('aria-label',t('预览精度','Preview resolution'));
  for(const size of [256,512,1024]){const option=el('option',null,size+' px');option.value=String(size);resolution.append(option);}resolution.value='512';resolutionLabel.append(resolution);
  const leftShell=el('div','l2d-bind-left'),pages=el('div','l2d-bind-pages');pages.setAttribute('role','tablist');pages.setAttribute('aria-label',t('编辑页面','Editor pages'));
  leftShell.append(pages,left);
  toolbar.append(raw,replay,reset,resolutionLabel,retry);stage.append(gallery,hint,toolbar);layout.append(leftShell,stage,right);
  const footer=el('div','l2d-bind-footer'),summary=el('span','l2d-bind-summary',t('未绑定的项目使用通用配方','Unbound targets use generic recipes'));
  const footInfo=el('div','l2d-bind-footinfo');
  const newGroup=el('button','l2d-bind-newgroup',t('＋ 新建分组','＋ New group'));newGroup.type='button';
  footInfo.append(summary,newGroup);
  const cancel=el('button','l2d-btn',t('取消','Cancel')),save=el('button','l2d-btn primary',t('保存绑定','Save bindings'));save.disabled=true;
  const restoreAll=el('button','l2d-btn quiet sm',t('全部恢复通用','Reset all to generic'));restoreAll.disabled=true;
  const skipImages=el('button','l2d-btn',t('跳过图片','Skip images'));skipImages.hidden=true;
  footer.append(footInfo,restoreAll,cancel,skipImages,save);card.append(head,layout,footer);modal.append(card);ctx.root.append(modal);modal.showModal();
  let closed=false,saving=false,saveSequence=0,skippingImages=false,dirty=false,data,bindings=[],word='happy',resource=null,rawMode=false,serial=0,previewTimer,sampleSet=0,discardPrompt=null,leaseTimer,sessionValid=true,previewDialog=null;
  let page='actions',groups=[],picks={},groupId=null,optionId='default',closeGroupDialog;const pageState={actions:{resource:null,filter:'all',search:''},wardrobe:{resource:null,filter:'all',search:''}};
  const uid=prefix=>prefix+(win.crypto?.randomUUID?.().replaceAll('-','')||Math.random().toString(16).slice(2)).slice(0,12);
  const signature=items=>JSON.stringify(items.map(({word,resource,release})=>({word,resource,...(release?{release}:{})})).sort((a,b)=>a.word.localeCompare(b.word)));
  const canEdit=()=>!!data&&sessionValid&&!saving;
  const canSave=()=>canEdit()&&(!data.buildId||dirty||data.wardrobeNeedsSave);
  const syncControls=()=>{
    layout.inert=saving;pages.inert=saving;save.disabled=!canSave();close.disabled=cancel.disabled=saving;
    skipImages.hidden=!saving;skipImages.disabled=skippingImages;
    restoreAll.disabled=!canEdit()||(page==='actions'?!bindings.length:!groups.length);
    restoreAll.textContent=page==='actions'?t('全部恢复通用','Reset all to generic'):t('恢复默认外观','Default appearance');
    newGroup.hidden=page!=='wardrobe';raw.hidden=page==='wardrobe';
    newGroup.disabled=resolution.disabled=raw.disabled=replay.disabled=reset.disabled=retry.disabled=!canEdit();
  };
  const setPreviewBusy=busy=>{gallery.setAttribute('aria-busy',String(busy));gallery.classList.toggle('is-pending',busy);};
  const stopPreviewUpdates=()=>{serial++;win.clearTimeout(previewTimer);setPreviewBusy(false);};
  const sessionError=message=>/编辑已过期|编辑已取消|模型素材已变化|形象包已变化|原打包产物已移除/.test(message);
  const expireSession=message=>{
    sessionValid=false;stopPreviewUpdates();retry.hidden=true;hint.textContent=message;syncControls();paintSelection();
  };
  const changed=()=>{dirty=signature(bindings)!==signature(data.bindings||[])||JSON.stringify(groups)!==JSON.stringify(data.wardrobe||[]);syncControls();};
  const alive=()=>!closed&&!ctx.signal?.aborted;
  const release=()=>{if(closed)return;closed=true;win.clearInterval(leaseTimer);closeGroupDialog?.();discardPrompt?.dispose();previewDialog?.dispose();leave?.dispose?.();ctx.signal?.removeEventListener('abort',release);stopPreviewUpdates();gallery.replaceChildren();modal.close();modal.remove();onClosed?.();const token=data?.token||requestedToken;if(token&&!ctx.signal?.aborted)ctx.invoke('manualClose',[token]).catch(()=>{});previous?.focus?.({preventScroll:true});};
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
    if(candidate&&page==='wardrobe'&&resource&&!resource.wardrobeError&&g&&!wardrobeConflict(resource,g.id)){
      g.options=g.options.slice(0,15);g.options.push({id:'preview',name:resource.title,resource:resource.id});selected[g.id]='preview';
    }
    const request={page,word,resource:page==='actions'?resource?.id:null,raw:rawMode,bindings:structuredClone(bindings),groups:preview,picks:selected,sampleSet,previewSize:Number(resolution.value)};
    const generation=++serial;win.clearTimeout(previewTimer);retry.hidden=true;setPreviewBusy(true);
    hint.textContent=t('正在生成对照图，可以继续编辑。','Generating comparison. You can keep editing.');
    previewTimer=win.setTimeout(async()=>{
      try{
        const result=await ctx.invoke('manualPreview',[data.token,request]);if(!alive()||generation!==serial)return;
        if(!Array.isArray(result.frames)||!result.frames.length||result.frames.length>3)throw Error(t('预览图片不完整','Incomplete preview'));
        const labels={default:t('默认','Default'),generic:t('通用表现','Generic'),appearance:t('当前装扮','Current appearance'),native:t('原生效果','Native'),combined:t('组合效果','Combined')};
        const figures = result.frames.map(item => {
          if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(item.png || '')) throw Error(t('预览图片无效','Invalid preview image'));
          const captionText = (labels[item.kind] || t('对照图','Comparison')) + (item.resource && item.time ? ' · ' + item.time.toFixed(2) + 's' : '');
          const figure = el('figure','l2d-bind-shot');
          const button = el('button','l2d-bind-shot-button'); button.type = 'button';
          button.setAttribute('aria-label', t('放大 ','Enlarge ') + captionText); button.setAttribute('aria-haspopup','dialog');
          const image = el('img'); image.src = item.png; image.alt = ''; image.width = image.height = request.previewSize;
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
        hint.textContent=page==='actions'?(resource?label(word)+' · '+resource.title:t('通用表现','Generic behavior')):t('静态外观对照','Appearance comparison');
      }catch(error){
        if(!alive()||generation!==serial)return;
        const message=String(error.message||error);
        if(sessionError(message)){expireSession(message);return;}
        const stale=gallery.childElementCount?t('仍显示上次预览。','The previous preview is still shown. '):'';
        hint.textContent=t('预览失败，可继续编辑或降低精度重试。','Preview failed. You can keep editing or retry at a lower resolution. ')+stale+message;
        retry.hidden=false;
      }finally{if(alive()&&generation===serial)setPreviewBusy(false);}
    },160);
  };
  const sendWardrobe=(candidate=false)=>loadPreview(candidate);
  const play=()=>loadPreview(true);
  raw.onclick=()=>{rawMode=!rawMode;raw.textContent=rawMode?t('原生效果','Native only'):t('组合效果','Combined');raw.setAttribute('aria-pressed',String(rawMode));play();};
  replay.onclick=()=>{sampleSet=(sampleSet+1)%3;play();};
  resolution.onchange=play;
  reset.onclick=()=>{picks={};resource=null;optionId='default';paintTargets();paintResources();loadPreview();};
  let filter='all';const search=el('input','l2d-input');search.placeholder=t('搜索原生资源','Search native resources');search.setAttribute('aria-label',search.placeholder);
  const tabs=el('div','l2d-bind-tabs'),list=el('div','l2d-bind-list'),binding=el('div','l2d-bind-selection');
  right.append(search,tabs,list,binding);
  const paintTargets=()=>{left.replaceChildren();if(page==='wardrobe'){paintWardrobeTargets();return;}for(const [key,title]of [['expressions',t('表情','Expressions')],['motions',t('动作','Motions')]]){
    left.append(el('h3',null,title));for(const w of data.words[key]){
      const b=el('button','l2d-bind-target'+(w===word?' selected':''));b.type='button';b.setAttribute('aria-pressed',String(w===word));
      b.append(el('span',null,label(w)),el('small',null,bindings.some(b=>b.word===w)?t('已绑定','Bound'):t('通用','Generic')));
      b.onclick=()=>{word=w;const match=bindings.find(b=>b.word===w);resource=data.resources.find(r=>r.id===match?.resource)||null;paintTargets();paintResources();play();};left.append(b);
    }
  }};
  const paintSelection=()=>{
    if(page==='wardrobe'){paintWardrobeSelection();return;}
    binding.replaceChildren();const current=bindings.find(b=>b.word===word);
    const caption=el('p',null,`${label(word)} ← ${current?data.resources.find(r=>r.id===current.resource)?.title:t('通用配方','Generic recipe')}`);binding.append(caption);
    const bind=el('button','l2d-btn primary',t(`绑定到「${label(word)}」`,`Bind to ${label(word)}`));
    const restore=el('button','l2d-btn quiet',t('恢复通用','Use generic'));restore.disabled=!canEdit()||!current;
    let releaseSelect;
    if(resource?.classification==='pose'){
      binding.append(el('label',null,t('复位动作','Reset motion')));releaseSelect=el('select','l2d-input');releaseSelect.setAttribute('aria-label',t('复位动作','Reset motion'));
      releaseSelect.append(el('option',null,t('请选择','Choose')));releaseSelect.firstChild.value='';
      for(const r of data.resources.filter(r=>r.kind==='motion'&&r.classification!=='appearance'&&r.id!==resource.id)){const o=el('option',null,r.title);o.value=r.id;releaseSelect.append(o);}
      releaseSelect.value=current?.resource===resource.id?current.release||resource.release||'':resource.release||'';
      binding.append(releaseSelect);releaseSelect.disabled=!canEdit();
    }
    const canBind=()=>canEdit()&&resource&&resource.classification!=='appearance'
      &&(resource.kind!=='expression'||data.words.expressions.includes(word))&&(!releaseSelect||releaseSelect.value);
    bind.disabled=!canBind();if(releaseSelect)releaseSelect.onchange=()=>{bind.disabled=!canBind();};
    bind.onclick=()=>{if(!canBind()||discardPrompt)return;const channels=new Set(groups.flatMap(g=>g.options.flatMap(o=>data.resources.find(r=>r.id===o.resource)?.channels||[])));const used=[resource,...data.resources.filter(r=>r.id===releaseSelect?.value)].flatMap(r=>r.channels||[]);if(used.some(c=>channels.has(c))){ctx.ui.toast(t('该资源与装扮共用参数，请调整绑定','This resource overlaps wardrobe controls'),'bad');return;}bindings=bindings.filter(b=>b.word!==word);bindings.push({word,resource:resource.id,...(releaseSelect?.value?{release:releaseSelect.value}:{}),confidence:1,reason:'用户在动作编辑器中选择'});changed();paintTargets();paintSelection();play();};
    restore.onclick=()=>{if(!canEdit()||discardPrompt)return;bindings=bindings.filter(b=>b.word!==word);resource=null;changed();paintTargets();paintResources();play();};binding.append(bind,restore);
    paintSummary();
  };
  const paintResources=()=>{list.replaceChildren();const q=search.value.trim().toLocaleLowerCase();
    const resources=data.resources.filter(r=>(page!=='wardrobe'||!r.wardrobeError)&&(filter==='all'||filter==='other'?filter!=='other'||r.classification==='appearance':r.kind===filter)&&(!q||r.title.toLocaleLowerCase().includes(q)));
    for(const r of resources){const b=el('button','l2d-bind-resource'+(r.id===resource?.id?' selected':''));b.append(el('span',null,r.title),el('small',null,page==='wardrobe'?(r.kind==='expression'?t('外观状态','Appearance state'):t('动作末帧 · 持久','Final frame · held')):r.classification==='appearance'?t('其他 · 仅预览','Other · preview only'):r.kind==='expression'?t('表情','Expression'):t(`动作 · ${r.seconds.toFixed(1)} 秒`,`Motion · ${r.seconds.toFixed(1)} s`)));b.onclick=()=>{resource=r;paintResources();play();};list.append(b);}
    if(!resources.length)list.append(el('p','l2d-bind-empty',t('没有匹配的资源','No matching resources')));paintSelection();
  };
  function paintSummary(){const used=groups.filter(g=>g.options.length).length;const total=groups.length||3;summary.textContent=t(`${bindings.length} 项绑定 · 外观 ${used}/${total} 栏 · 保存后从卡片安装`,`${bindings.length} bindings · ${used}/${total} appearance slots · save then install`);}
  function wardrobeConflict(r,id){
    const ids=[...bindings.flatMap(b=>[b.resource,b.release].filter(Boolean)),...groups.filter(g=>g.id!==id).flatMap(g=>g.options.map(o=>o.resource))];
    const used=new Set(ids.flatMap(id=>data.resources.find(r=>r.id===id)?.channels||[]));return (r?.channels||[]).some(c=>used.has(c));
  }
  function paintWardrobeTargets(){
    for(const g of groups){
      const title=zh?(g.name||''):(g.en||g.name||WARDROBE_SLOTS.find(s=>s.slot===g.slot)?.en||'');
      const row=el('div','l2d-bind-grow');
      const header=el('button','l2d-bind-group'+(g.id===groupId?' selected':''),title);header.onclick=()=>{groupId=g.id;optionId=picks[g.id]||'default';resource=data.resources.find(r=>r.id===g.options.find(o=>o.id===optionId)?.resource)||null;paintTargets();paintResources();sendWardrobe();};
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
          if(groupId===g.id){groupId=groups[0]?.id||null;optionId='default';resource=null;}
          changed();paintTargets();paintResources();sendWardrobe();
        };
        row.append(del);
      }
      left.append(row);
      for(const o of [{id:'default',name:t('默认','Default')},...g.options]){
        const chosen=(picks[g.id]||'default')===o.id;
        const b=el('button','l2d-bind-target'+(chosen?' selected':''),o.name);b.setAttribute('aria-label',title+'：'+o.name);b.setAttribute('aria-pressed',String(chosen));
        b.onclick=()=>{groupId=g.id;optionId=o.id;picks[g.id]=o.id;resource=data.resources.find(r=>r.id===o.resource)||null;paintTargets();paintResources();sendWardrobe();if(canEdit())hint.textContent=g.name+' · '+o.name;};left.append(b);
      }
      const add=el('button','l2d-btn quiet sm',t('＋ 新选项','＋ New option'));add.onclick=()=>{groupId=g.id;optionId=null;resource=null;paintTargets();paintResources();};left.append(add);
    }
  }
  function paintWardrobeSelection(){
    binding.replaceChildren();const g=groups.find(g=>g.id===groupId);paintSummary();
    if(!g){binding.append(el('p',null,t('在左侧选择装扮、部件或配饰','Choose Outfit, Parts or Accessories on the left')));return;}
    binding.append(el('p',null,t(g.name+' · 每次选一个原生按钮',(g.en||g.name||WARDROBE_SLOTS.find(s=>s.slot===g.slot)?.en||'')+' · one native resource at a time')));
    const current=g.options.find(o=>o.id===optionId),name=el('input','l2d-input');name.value=current?.name||resource?.title||'';name.maxLength=60;name.placeholder=t('选项名称，例如戴上','Option name, e.g. wear');name.setAttribute('aria-label',t('装扮选项名称','Wardrobe option name'));binding.append(name);
    const conflict=resource&&wardrobeConflict(resource,g.id);if(conflict)binding.append(el('p','l2d-bind-warning',t('与动作或其他装扮组共用参数，请调整绑定。','Shares controls with actions or another wardrobe group.')));
    const add=el('button','l2d-btn primary',current?t('保存选项','Update option'):t('添加选项','Add option'));
    const canAdd=()=>canEdit()&&resource&&!resource.wardrobeError&&!conflict&&!!name.value.trim()&&(!!current||g.options.length<16);add.disabled=!canAdd();name.oninput=()=>{add.disabled=!canAdd();};
    add.onclick=()=>{if(!canAdd()||discardPrompt)return;const o={id:current?.id||uid('v'),name:name.value.trim(),resource:resource.id};if(current)g.options=g.options.map(p=>p.id===o.id?o:p);else g.options.push(o);optionId=o.id;picks[g.id]=o.id;changed();paintTargets();paintResources();sendWardrobe();};binding.append(add);
    if(current){const remove=el('button','l2d-btn quiet',t('移除选项','Remove option'));remove.disabled=!canEdit();remove.onclick=()=>{if(!canEdit())return;g.options=g.options.filter(o=>o.id!==current.id);picks[g.id]='default';optionId='default';resource=null;changed();paintTargets();paintResources();sendWardrobe();};binding.append(remove);}
    binding.append(el('p','l2d-bind-note',t('每组可选一个选项。保存并安装后可在 Coo 装扮页切换。','Pick one option per group. Save and install to switch them in Coo.')));
  }
  for(const [id,title]of [['actions',t('动作','Actions')],['wardrobe',t('装扮','Wardrobe')]]){
    const b=el('button','l2d-btn quiet sm',title);b.setAttribute('role','tab');b.setAttribute('aria-selected',String(page===id));b.onclick=()=>{
      if(!data||saving||discardPrompt||page===id)return;pageState[page]={resource,filter,search:search.value};page=id;({resource,filter}=pageState[id]);search.value=pageState[id].search;for(const n of pages.children)n.setAttribute('aria-selected',String(n===b));
      if(page==='wardrobe'&&!groupId)groupId=groups[0]?.id||null;for(const n of tabs.children)n.classList.toggle('selected',n.dataset.filter===filter);syncControls();paintTargets();paintResources();play();
    };pages.append(b);
  }
  for(const [value,title]of [['all',t('全部','All')],['expression',t('表情','Faces')],['motion',t('动作','Motions')],['other',t('其他','Other')]]){
    const b=el('button','l2d-btn quiet sm',title);b.dataset.filter=value;b.onclick=()=>{if(!data)return;filter=value;for(const n of tabs.children)n.classList.toggle('selected',n===b);paintResources();};tabs.append(b);
  }tabs.firstChild.classList.add('selected');search.oninput=()=>{if(data)paintResources();};
  restoreAll.onclick=async()=>{
    if(!canEdit()||discardPrompt)return;
    if(page==='wardrobe'){picks={};resource=null;optionId='default';paintTargets();paintResources();sendWardrobe();hint.textContent=t('已恢复默认外观，装扮选项保留','Default appearance restored. Wardrobe options kept.');return;}
    if(!bindings.length)return;
    discardPrompt=bindingDiscardPrompt(modal,zh,{title:t('全部恢复通用？','Reset all bindings?'),body:t('清空当前绑定，保留原生资源。点击保存后生效。','Clear all bindings and keep native resources. Save to apply.'),cancel:t('保留绑定','Keep bindings'),accept:t('全部恢复','Reset all')});
    const accepted=await discardPrompt.result;discardPrompt=null;if(!accepted||!alive()||!canEdit())return;
    bindings=[];resource=null;rawMode=false;raw.textContent=t('组合效果','Combined');raw.setAttribute('aria-pressed','false');changed();paintTargets();paintResources();play();
  };
  const askGroup=()=>new Promise(resolve=>{
    const dlg=el('dialog','l2d-modal l2d-group-modal');
    const box=el('div','l2d-group-box');
    box.append(el('div','l2d-modal-title',t('新建分组','New group')));
    const zhName=el('input','l2d-input');zhName.placeholder=t('中文名，例如 发型','Chinese name, e.g. Hair');zhName.maxLength=24;
    const enName=el('input','l2d-input');enName.placeholder=t('英文名（可选）','English name (optional)');enName.maxLength=24;
    zhName.setAttribute('aria-label',t('分组中文名','Group name'));enName.setAttribute('aria-label',t('分组英文名','Group English name'));
    const actions=el('div','l2d-group-actions');
    const cancelBtn=el('button','l2d-btn',t('取消','Cancel')),okBtn=el('button','l2d-btn primary',t('创建','Create'));
    actions.append(cancelBtn,okBtn);
    box.append(zhName,enName,actions);dlg.append(box);ctx.root.append(dlg);
    const done=value=>{closeGroupDialog=undefined;dlg.close();dlg.remove();resolve(value);};
    closeGroupDialog=()=>done(null);
    cancelBtn.onclick=()=>done(null);
    dlg.addEventListener('cancel',e=>{e.preventDefault();done(null);});
    okBtn.onclick=()=>{const name=zhName.value.trim();if(!name){zhName.focus();return;}done({name,en:enName.value.trim()});};
    zhName.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();okBtn.click();}});
    enName.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();okBtn.click();}});
    dlg.showModal();zhName.focus();
  });
  newGroup.onclick=async()=>{
    if(page!=='wardrobe'||!canEdit()||discardPrompt)return;
    const value=await askGroup();
    if(!value||!alive()||!canEdit())return;
    const group={id:uid('g'),custom:true,name:value.name,...(value.en?{en:value.en}:{}),options:[]};
    groups.push(group);groupId=group.id;optionId=null;resource=null;
    changed();paintTargets();paintResources();sendWardrobe();
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
    stopPreviewUpdates();saveSequence++;saving=true;syncControls();paintSelection();hint.textContent=t('保存并打包…','Saving & packing…');skipImages.focus();
    try{
      const result=await ctx.invoke('manualSave',[data.token,structuredClone(bindings),structuredClone(groups)]);dirty=false;release();
      const saved=t('绑定已保存，可从卡片安装','Bindings saved. Install from the pack card.');
      if(result?.warn)ctx.ui.toast(saved+' · '+result.warn);
      else ctx.ui.toast(saved,'ok');
      try{await onSaved?.(result);}catch{ctx.ui.toast(t('绑定已保存，模型包列表刷新失败，请稍后重新打开页面','Bindings saved; the pack list could not refresh. Reopen the page later.'),'bad');}
    }
    catch(error){if(alive()){const message=String(error.message||error);if(sessionError(message))expireSession(message);else hint.textContent=message;ctx.ui.toast(message,'bad');}}
    finally{saving=false;skippingImages=false;if(alive()){syncControls();paintSelection();}}
  };
  retry.onclick=play;
  syncControls();
  try{
    data=await ctx.invoke(method,requestedToken?[...args,requestedToken]:args);
    resolution.value=String([256,512,1024].includes(data.previewSize)?data.previewSize:512);
    if(data.token!==requestedToken)ctx.notifyOnUnmount?.('manualClose',[data.token]);
    if(!alive()){if(!ctx.signal?.aborted)ctx.invoke('manualClose',[data.token]).catch(()=>{});return {get closed(){return closed;},dispose:release};}
    bindings=structuredClone(data.bindings||[]);groups=fixedWardrobeGroups(data.wardrobe||[]).map((g,i)=>({...g,...(i>=3?{custom:true}:{})}));data.wardrobe=structuredClone(groups);changed();heading.querySelector('.l2d-modal-sub').textContent=data.title;paintTargets();paintResources();
    if(data.truncated||data.warnings?.length)right.prepend(el('p','l2d-bind-empty',t('部分资源未能读取，列表可能不完整','Some resources could not be read; the list may be incomplete')));
    if(data.truncated)hint.textContent=t('资源扫描不完整，请核对模型内容','Resource scan is incomplete; check the model');
    leaseTimer=win.setInterval(()=>{if(alive()&&sessionValid)ctx.invoke('manualKeepAlive',[data.token]).catch(error=>{const message=String(error.message||error);if(alive()&&sessionError(message))expireSession(message);});},60000);
    loadPreview();
  }catch(error){if(alive())hint.textContent=String(error.message||error);}
  return {get closed(){return closed;},dispose(){leave?.dispose?.();release();}};
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
    const node = el('button', ('l2d-btn ' + style).trim(), label);
    node.type = 'button';
    return node;
  };
  return { doc, t, el, button };
}

async function refreshVoiceTool(ctx, before, after) {
  if (typeof before?.syncToolReady !== 'boolean' || before.syncToolReady === after?.syncToolReady) return;
  const doc = ctx.root.ownerDocument;
  const win = doc.defaultView;
  if (!win?.fetch) return;
  const {t} = voiceView(ctx);
  try {
    // Cortico applies this at the next safe session boundary and keeps history.
    const response = await win.fetch(new URL('/api/session/reload-prefix', doc.baseURI), {
      method:'POST', credentials:'same-origin',
      headers:{'x-cortico-language':ctx.language || 'zh'},
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw Error('Prefix refresh unavailable');
  } catch {
    if (!ctx.signal?.aborted) ctx.ui.toast(t('设置已保存，可从 Coo 页头重载前缀以更新语音工具。', 'Saved. Reload the prefix from Coo’s page header to update the speech tool.'), 'bad');
  } finally {
    if (!ctx.signal?.aborted) await ctx.refresh?.().catch(() => {});
  }
}

const speechProviders = {
  async mount(ctx) {
    const [state, cfg] = await Promise.all([
      ctx.invoke('voiceState', []), ctx.invoke('settings', []),
    ]);
    if (ctx.signal?.aborted) return;
    const { doc, t, el, button } = voiceView(ctx);
    const restore = ownAppearance(ctx.root);
    applyAppearance(ctx.root, cfg);
    const page = el('section', 'l2d-config-page l2d-voice-page');
    const intro = el('div', 'l2d-voice-intro');
    const heading = el('div');
    heading.append(el('h3', null, t('语音服务', 'Speech services')),
      el('p', null, t('点击服务卡片编辑模型、音色和连接设置。', 'Open a service card to edit its model, voice and connection settings.')));
    const add = button(t('添加语音服务', 'Add speech service'), 'primary l2d-voice-add');
    const plus = el('span', 'l2d-voice-add-icon');
    plus.setAttribute('aria-hidden', 'true');
    add.prepend(plus);
    add.setAttribute('aria-haspopup', 'dialog');
    add.addEventListener('click', () => openService());
    intro.append(heading, add);
    const grid = el('div', 'l2d-voice-grid');
    grid.setAttribute('role', 'region');
    grid.setAttribute('aria-label', t('已创建的语音服务', 'Saved speech services'));
    const empty = el('div', 'l2d-voice-empty', t('还没有语音服务。点击「添加语音服务」开始。', 'Add a speech service to get started.'));
    grid.append(empty);
    const sound = el('section', 'l2d-voice-controls');
    page.append(intro, grid, sound);
    ctx.root.append(page);
    const soundControls = mountVoiceControls(ctx, sound, state);
    let snapshot = state, modal, disposed = false;
    const cards = new Map();
    function paint() {
      const ids = new Set(snapshot.services.map(service => service.id));
      for (const [id, {card}] of cards) {
        if (ids.has(id)) continue;
        card.remove();
        cards.delete(id);
      }
      empty.hidden = snapshot.services.length > 0;
      for (const {id, provider, name: serviceName, profile, ready} of snapshot.services) {
        const providerName = VOICE_PROVIDERS[provider].name;
        if (!cards.has(id)) {
          const card = el('button', 'l2d-card l2d-voice-card');
          card.type = 'button';
          card.dataset.serviceId = id;
          card.dataset.provider = provider;
          card.setAttribute('aria-haspopup', 'dialog');
          const head = el('span', 'l2d-voice-card-head');
          const name = el('strong');
          const badge = el('span', 'l2d-voice-badge');
          const model = el('span', 'l2d-voice-model');
          const voice = el('span', 'l2d-voice-voice');
          head.append(name, badge);
          card.append(head, model, voice);
          card.addEventListener('click', () => openService(id));
          cards.set(id, {card, name, badge, model, voice});
          grid.append(card);
        }
        const {card, name, badge, model, voice} = cards.get(id);
        const selected = snapshot.selectedId === id;
        card.classList.toggle('selected', selected);
        name.textContent = serviceName || providerName;
        badge.textContent = selected ? t('当前使用', 'Selected') : ready ? t('可用', 'Ready') : t('待补全', 'Incomplete');
        model.textContent = [serviceName ? providerName : '', profile.model || profile.version].filter(Boolean).join(' · ')
          || t('服务预设', 'Service preset');
        voice.textContent = profile.voice || t('待选音色', 'Voice pending');
        card.setAttribute('aria-label', t('配置 ', 'Configure ') + name.textContent + ' · ' + badge.textContent);
      }
    }
    paint();

    function openService(id = null) {
      if (modal) return;
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
          (setting.type === 'number' || !setting.required ? advanced : fields).append(row);
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
        help.textContent = t(spec?.help || '', '');
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
          const created = id === null && snapshot.services.find(service => !cards.has(service.id));
          changed = false;
          if (key) key.value = '';
          paint();
          soundControls.update(snapshot);
          modal.dispose();
          if (created) {
            grid.scrollTop = grid.scrollHeight;
            cards.get(created.id)?.card.focus({preventScroll:true});
          }
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
        message(!on ? '' : snapshot.selectedId === id && snapshot.controls.voiceEnabled
          ? t('删除当前服务并关闭朗读？', 'Remove the active service and turn off narration?')
          : t('删除这项语音服务？', 'Remove this speech service?'));
        lock();
        (on ? returnToEdit : remove).focus();
      }
      remove.onclick = () => confirmDeletion(true);
      returnToEdit.onclick = () => confirmDeletion(false);
      confirmRemove.onclick = async () => {
        if (saving || !id) return;
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
          add.focus({preventScroll:true});
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
      restore();
    } };
  },
};

function mountVoiceControls(ctx, section, initial) {
  const { t, el, button } = voiceView(ctx);
  let snapshot = initial;
  let disposed = false, saving = false, testing = false, testSent = false, request = 0;
  let prefixRefresh = Promise.resolve();
  const updateTool = (before, after) => {
    if (before?.syncToolReady !== after?.syncToolReady) {
      prefixRefresh = prefixRefresh.then(() => refreshVoiceTool(ctx, before, after)).catch(() => {});
    }
  };
  const pending = {};
  const inputs = new Map();
  const rows = el('div', 'l2d-settings l2d-dialog-body');
  const status = el('span', 'l2d-voice-message');
  status.setAttribute('role', 'status');
  const heading = el('h3', 'l2d-settings-heading', t('语音与口型', 'Voice and lip sync'));
  const controls = [
    ['voiceEnabled', t('朗读桌宠回复', 'Read desktop pet replies'), t('开启后将回复交给选定的语音提供商合成', 'Sends replies to the selected provider for synthesis when enabled')],
    ['voiceTiming', t('朗读时机', 'Narration timing'), t('同步档让第一声和气泡接近同时出现。', 'Sync mode starts speech and the bubble at nearly the same time.')],
    ['voiceVolume', t('播放音量', 'Playback volume'), t('统一调节桌宠朗读的音量', 'Sets the playback volume for desktop narration'), { min: 0, max: 1, step: .01 }],
    ['voiceLipSync', t('口型跟随音频', 'Audio-driven lip sync'), t('关闭时使用原有的气泡口型', 'Turn off to use the existing bubble timing')],
    ['voiceMouthGain', t('张嘴幅度', 'Mouth opening gain'), t('调高后轻声时张嘴更明显，可在桌宠上试听', 'Increase it for clearer mouth movement on quiet sounds. Test it on the desktop pet.'), MOUTH_GAIN],
  ];
  for (const [key, label, hint, range] of controls) {
    const row = el('label', 'l2d-setting-row');
    const text = el('span', 'l2d-setting-label');
    const description = el('small', null, hint);
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
    rows.append(row);
  }
  const actions = el('div', 'l2d-dialog-actions l2d-voice-sound-actions');
  const sample = button(t('在桌宠试听', 'Test on desktop pet'));
  const stop = button(t('停止试听', 'Stop sample'), 'quiet');
  sample.disabled = stop.disabled = true;
  actions.append(status, sample, stop);
  section.append(heading, rows, actions);
  function paintSlider(key) {
    const { input, output } = inputs.get(key);
    if (!output) return;
    const label = key === 'voiceMouthGain' ? Number(input.value).toFixed(1) + '×'
      : Math.round(Number(input.value) * 100) + '%';
    output.value = label;
    input.setAttribute('aria-valuetext', label);
  }
  function paint() {
    if (disposed) return;
    for (const [key, { input, output, description, hint }] of inputs) {
      const value = pending[key] ?? snapshot?.controls[key] ?? VOICE_CONTROLS[key];
      if (key === 'voiceTiming') {
        const ready = snapshot?.timingReady === true;
        input.value = value;
        input.options[1].disabled = !ready;
        description.textContent = ready ? hint : value === 'sync'
          ? t('当前设备使用快速播报，同步设置会保留。', 'This device uses fast narration and keeps your sync preference.')
          : t('当前设备支持快速播报，暂无法对齐气泡起点。', 'Fast narration is available on this device. Bubble timing sync is unavailable.');
      } else if (output) { input.value = String(value); paintSlider(key); }
      else input.checked = value;
      input.disabled = !snapshot || key === 'voiceEnabled' && !snapshot.selectedId && !value;
    }
    sample.disabled = testing || !snapshot?.selectedId || !(snapshot?.playbackReady ?? snapshot?.bodyReady);
    stop.disabled = !testing && !testSent;
  }
  function message(value, bad = false) {
    if (disposed) return;
    status.textContent = value;
    status.classList.toggle('bad', bad);
  }
  function hint() {
    if (!snapshot?.selectedId) return snapshot?.services.length
      ? t('打开上方的服务卡片，选择「保存并使用」。', 'Open a service card above and choose “Save and select”.')
      : t('添加语音服务后即可启用朗读。', 'Add a speech service to enable narration.');
    if (!(snapshot.playbackReady ?? snapshot.bodyReady)) return t('请切换到支持语音的 Figure 形象。已有打包卡片可以重新安装。',
      'Switch to a supported Figure. Reinstall from its pack card to refresh an older runtime.');
    if (snapshot.reader) return t('启用朗读前，请关闭其他扩展的桌宠回复朗读。', 'Turn off other desktop reply readers before enabling narration.');
    return snapshot.message || (!snapshot.bodyReady
      ? t('当前可播放语音。流式口型需要已更新的 Figure 形象。', 'Voice playback is available. Streaming lip sync needs an updated Figure.')
      : '');
  }
  async function save() {
    if (disposed || saving || !Object.keys(pending).length) return;
    saving = true;
    const patch = { ...pending };
    for (const key of Object.keys(patch)) delete pending[key];
    message(t('正在保存…', 'Saving…'));
    try {
      const previous = snapshot;
      snapshot = await ctx.invoke('voiceControls', [patch]);
      message(hint() || t('已保存', 'Saved'));
      updateTool(previous, snapshot);
    } catch (error) {
      message(String(error?.message || error), true);
    } finally {
      saving = false;
      paint();
      void save();
    }
  }
  sample.onclick = async () => {
    const id = ++request;
    testing = true;
    testSent = false;
    paint();
    message(t('正在准备桌宠试听…', 'Preparing the desktop sample…'));
    try {
      await ctx.invoke('voiceAudition', []);
      if (id !== request || disposed) return;
      testSent = true;
      message(t('已将试听送到桌宠', 'Sample sent to the desktop pet'));
    } catch (error) {
      if (id === request) message(String(error?.message || error), true);
    } finally {
      if (id === request) { testing = false; paint(); }
    }
  };
  stop.onclick = async () => {
    request++;
    testing = testSent = false;
    paint();
    try {
      await ctx.invoke('voiceStop', []);
      if (!testing) message(t('试听已停止', 'Sample stopped'));
    } catch (error) { message(String(error?.message || error), true); }
  };
  paint();
  message(hint());
  const guard = ctx.guardLeave?.(() => !disposed && (saving || Object.keys(pending).length)
    ? t('语音设置正在保存，确定离开？', 'Voice settings are saving. Leave anyway?') : null);
  return {
    update(result) {
      const previous = snapshot;
      snapshot = result;
      paint();
      message(hint());
      updateTool(previous, snapshot);
    },
    dispose() { disposed = true; guard?.dispose(); },
  };
}

const effectPreviewArt = {
  native: `<g class="l2d-effect-preview-motion">
    <path d="M147 79 122 56C110 44 129 33 142 46L147 51 152 46C165 33 184 44 172 56Z"
      fill="#fb72963b" stroke="#fb9ab4" stroke-width="2.5"/>
    <path d="M109 71c-8 9-8 16-1 17 8 1 8-7 1-17" fill="#88caff"/>
    <path d="M184 56V42l10-4v13m-10 5c0 5-10 7-10 2 0-4 10-7 10-2m10-5c0 5-9 7-9 2 0-4 9-6 9-2"
      fill="none" stroke="#f9dc9a" stroke-width="2.3" stroke-linecap="round"/>
    <path d="M109 37h12l-12 13h12" fill="none" stroke="#c5b5f4" stroke-width="2.3" stroke-linecap="round"/>
  </g>`,
  kaomoji: `<text class="l2d-effect-preview-motion" x="150" y="65" text-anchor="middle"
    dominant-baseline="middle" fill="#983854" font-size="33" font-family="Segoe UI, Yu Gothic UI, Microsoft YaHei UI, sans-serif">(˶ᵔᵕᵔ˶)</text>`,
  orb: `<g class="l2d-effect-preview-motion">
    <circle cx="150" cy="60" r="35" fill="#e87fb04d" style="filter:blur(9px)"/>
    <circle cx="150" cy="60" r="31" fill="#b65c914f" stroke="#e6a1c285"/>
    <g fill="#ffd4ec">${Array.from({length:81}, (_, i) => {
      const x = i % 9 - 4, y = Math.floor(i / 9) - 4;
      return x*x + y*y > 19 ? '' : `<circle cx="${150+x*7}" cy="${60+y*7}" r="${(x+y)%3===0 ? 1.6 : .9}" opacity="${.26 + (i%5)*.13}"/>`;
    }).join('')}</g>
    <path d="M154 64c-8-6-4-12 1-8 4-4 9 2-1 8m-17 14c-8-6-4-12 1-8 4-4 9 2-1 8m36 3c-8-6-4-12 1-8 4-4 9 2-1 8" fill="#ffc5df"/>
    <g fill="#ffd2e8"><circle cx="87" cy="40" r="2"/><circle cx="104" cy="85" r="1.5"/><circle cx="212" cy="65" r="2.5"/></g>
  </g>`,
  flow: `<ellipse cx="150" cy="65" rx="19" ry="36" fill="#c5c6eb22" stroke="#dcd7ff48"/>
    <g class="l2d-effect-preview-motion" transform="rotate(-15 150 60)">
      <ellipse cx="150" cy="60" rx="106" ry="14" fill="none" stroke="#e0a6f5" stroke-width="1.8" opacity=".85"/>
      <path d="M44 59q20 29 106 22 83-6 105-24-24 20-105 15Q80 75 44 59" fill="#ffd8f6" opacity=".46"/>
      <g fill="#fff0ff"><circle cx="80" cy="50" r="2.6"/><circle cx="190" cy="67" r="2.2"/><circle cx="231" cy="39" r="1.7"/></g>
    </g>`,
  bubbles: `<ellipse cx="124" cy="74" rx="19" ry="37" fill="#c8d5f227" stroke="#dfecff51"/>
    <g class="l2d-effect-preview-motion" fill="#cfe3ff24" stroke="#f3dbffae">
      <circle cx="155" cy="81" r="5"/><circle cx="166" cy="66" r="7"/>
      <circle cx="187" cy="51" r="9"/><circle cx="212" cy="34" r="12"/>
      <path d="M182 48q2-4 6-3m18-14q2-5 8-5" fill="none" stroke="#fff9" stroke-linecap="round"/>
    </g>`,
  softglow: `<ellipse cx="151" cy="63" rx="24" ry="40" fill="#9295b730" stroke="#b1bad624"/>
    <g class="l2d-effect-preview-motion">
      <ellipse cx="124" cy="67" rx="117" ry="8" transform="rotate(-15 124 67)" fill="#ffcf84"
        opacity=".5" style="filter:blur(13px)"/>
      <ellipse cx="196" cy="64" rx="87" ry="7" transform="rotate(8 196 64)" fill="#e4b7ee"
        opacity=".68" style="filter:blur(13px)"/>
      <g fill="#fff6e6"><circle cx="69" cy="50" r="1.9"/><circle cx="108" cy="85" r="1.2"/><circle cx="195" cy="43" r="2"/><circle cx="223" cy="74" r="2.4"/></g>
    </g>`,
};

function createEffectPreview(doc, style) {
  const preview = doc.createElement('span');
  preview.className = 'l2d-effect-preview';
  preview.dataset.style = style;
  preview.setAttribute('aria-hidden', 'true');
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 300 120');
  svg.innerHTML = effectPreviewArt[style];
  preview.append(svg);
  return preview;
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
      native: [t('原有特效', 'Original effects'), t('Coo 的爱心、眼泪、音符与睡眠符号。', 'Coo’s hearts, tears, notes and sleep symbols.')],
      kaomoji: [t('颜文字', 'Kaomoji'), t('一个轻轻做动作的颜文字，随情绪变换。', 'A softly animated text face that changes with the mood.')],
      orb: [t('情绪球', 'Emotion orb'), t('喜欢、生气或哭泣时，亮起对应的情绪球。', 'A glowing orb responds to affection, anger and tears.')],
      flow: [t('全身粒子流', 'Full-body particle flow'), t('粒子沿着形象的前后两侧环绕。', 'Particles sweep around the front and back of the figure.')],
      bubbles: [t('右上角气泡', 'Upper-right bubbles'), t('彩色小气泡在形象右上方浮起。', 'Coloured bubbles rise near the upper-right corner.')],
      softglow: [t('柔光流尘 · 第二版', 'Softglow dust · V2'), t('淡淡的流光和光尘掠过形象。', 'Soft light and drifting dust sweep past the figure.')],
    };
    const restoreAppearance = ownAppearance(ctx.root);
    applyAppearance(ctx.root, cfg);
    const page = el('section', 'l2d-config-page l2d-effects-page');
    const header = el('div', 'l2d-effects-header');
    const intro = el('div', 'l2d-effects-intro');
    const heading = el('h3', null, t('桌宠特效', 'Pet effects'));
    heading.id = 'l2d-effects-heading';
    intro.append(heading, el('p', null, t(
      '选一张卡片作为特效风格。打包或从已有卡片重新安装时生效。',
      'Select an effect style. It applies when packing or reinstalling from an existing card.',
    )));
    const sizes = el('fieldset', 'l2d-effect-sizes');
    const sizeChoices = el('div', 'l2d-effect-size-choices');
    sizes.append(el('legend', null, t('特效大小', 'Effect size')), sizeChoices);
    header.append(intro, sizes);
    const gallery = el('div', 'l2d-effects-grid');
    gallery.setAttribute('role', 'radiogroup');
    gallery.setAttribute('aria-labelledby', heading.id);
    const status = el('p', 'l2d-effects-status', t('选择后自动保存。', 'Selection saves automatically.'));
    status.setAttribute('role', 'status');

    let saved = {
      style: normalizeEmotionEffect(cfg.emotionEffect),
      size: normalizeEmotionEffectSize(cfg.emotionEffectSize),
    };
    let selected = saved, saving = false, disposed = false;
    const options = new Map();
    const sizeOptions = new Map();
    const inactive = () => disposed || ctx.signal?.aborted;
    const sameSelection = (a, b) => a.style === b.style && a.size === b.size;
    function paintSelection() {
      for (const [style, {card, input}] of options) {
        input.checked = style === selected.style;
        card.classList.toggle('selected', input.checked);
      }
      for (const [size, input] of sizeOptions) input.checked = size === selected.size;
      sizes.disabled = selected.style === 'native';
      page.dataset.effectSize = selected.size;
    }
    async function saveSelection() {
      if (inactive() || saving || sameSelection(saved, selected)) return;
      const choice = selected;
      saving = true;
      status.textContent = t('保存中…', 'Saving…');
      status.classList.remove('bad');
      try {
        await ctx.setConfig('figure', {
          'worlds.figure.emotionEffect': choice.style,
          'worlds.figure.emotionEffectSize': choice.size,
        });
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
    for (const style of EMOTION_EFFECTS) {
      const [title, description] = copy[style];
      const card = el('label', 'l2d-card l2d-effect-card');
      const input = el('input', 'l2d-effect-radio');
      input.type = 'radio';
      input.name = 'l2d-pet-effect';
      input.value = style;
      input.setAttribute('aria-label', title);
      const details = el('span', 'l2d-effect-details');
      details.append(el('strong', null, title), el('small', null, description));
      const check = el('span', 'l2d-effect-check', '✓');
      check.setAttribute('aria-hidden', 'true');
      card.append(input, createEffectPreview(doc, style), details, check);
      gallery.append(card);
      options.set(style, {card, input});
      input.addEventListener('change', () => {
        if (inactive() || !input.checked) return;
        selected = {...selected, style};
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
        if (inactive() || sizes.disabled || !input.checked) return;
        selected = {...selected, size};
        paintSelection();
        void saveSelection();
      });
    }
    paintSelection();
    page.append(header, gallery, status);
    ctx.root.append(page);
    const guard = ctx.guardLeave?.(() => saving ? t('特效正在保存，确定离开？', 'Effect selection is saving. Leave anyway?') : null);
    return {dispose() {
      disposed = true;
      guard?.dispose();
      page.remove();
      restoreAppearance();
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

/**
 * Coo 魔术人偶工坊 面板（浏览器端，手写 ESM，不打 bundle）。
 *
 * 导入区：[拖入 / 点击后粘贴] [选择文件夹 / ZIP] [一键打包]
 * 卡片：[安装][编辑][删除]；编辑弹层直接改 figure.json / profile.js，不重新打包。
 * 原始模型打包、现成形象包入库，均保留卡片上的安装操作。
 */
const NOTICE_TEXT = {
  zh: '生成的形象包可能包含 Live2D Cubism Core，仅供本机使用。请保留模型、贴图和第三方组件各自的许可。',
  en: 'Generated figure packs may include Live2D Cubism Core for local use. Keep the separate licenses for models, textures and third-party components.',
};
// Theme only extension-owned roots. Restore inherited host values on unmount.
function applyAppearance(root, cfg) {
  const preferences=normalizeAppearance(cfg),classic=preferences.uiStyle==='classic';
  const appearance=classic?{...preferences,gearTheme:'purple',particleEffect:'stars',uiMaterial:'matte',uiMode:'auto',uiCorners:'standard',uiGlow:'off',uiButtonFill:'solid'}:preferences;
  const theme=GEAR_THEMES.find(t=>t.id===appearance.gearTheme);
  root.classList.add('l2d-themed');
  for(const [key,value] of Object.entries(appearance)) root.dataset[key]=value;
  root.style.setProperty('--appearance-accent',theme.color);
  root.style.setProperty('--gear-max-color',classic?theme.color:'var(--appearance-effective, '+theme.color+')');
  root.style.setProperty('--gear-max-fill',theme.fill);
  root.style.setProperty('--gear-spark-glow',theme.glow);
  const chrome = root.previousElementSibling;
  const route = root.ownerDocument.defaultView?.location.hash || '';
  if (root.classList.contains('panelslot') && chrome?.matches('.providerchrome')
      && /^#\/provider\/world(?:%3a|:)figure(?:\/|$)/i.test(route)) {
    // Coo reuses this header between tabs of the same provider and drops it on exit.
    chrome.classList.add('l2d-themed', 'l2d-provider-chrome');
    chrome.dataset.uiMode = appearance.uiMode;
    chrome.dataset.uiStyle = appearance.uiStyle;
    chrome.style.setProperty('--appearance-accent', theme.color);
  }
}
function ownAppearance(root) {
  const keys=Object.keys(normalizeAppearance()),props=['--appearance-accent','--gear-max-color','--gear-max-fill','--gear-spark-glow'];
  const data=keys.map(k=>root.dataset[k]),styles=props.map(k=>[root.style.getPropertyValue(k),root.style.getPropertyPriority(k)]),hadClass=root.classList.contains('l2d-themed');
  let restored=false;
  return ()=>{if(restored)return;restored=true;keys.forEach((k,i)=>{if(data[i]===undefined)delete root.dataset[k];else root.dataset[k]=data[i];});props.forEach((k,i)=>{if(styles[i][0])root.style.setProperty(k,...styles[i]);else root.style.removeProperty(k);});if(!hadClass)root.classList.remove('l2d-themed');};
}

// Primary configuration and the quick popup share saving and dependency handling.
function settingsForm(ctx, cfg, { autosave = false, appearanceOnly = false, onNotice, onSaved, onAppearance, isDisposed = () => ctx.signal?.aborted } = {}) {
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
  const controls = [];
  const fields = new Map();
  const appearance=normalizeAppearance(cfg);
  const paintAppearance=()=>{
    applyAppearance(body,appearance);onAppearance?.(appearance);
    if(appearanceOnly)for(const input of controls){if(input.type==='radio'&&input.name!=='l2d-uiStyle'){input.disabled=appearance.uiStyle==='classic';input.closest('.l2d-setting-row').classList.toggle('inactive',input.disabled);}}
  };
  paintAppearance();
  function appearanceField(section,key,title,hint,choices){
    const row=el('div','l2d-setting-row l2d-appearance-row'),label=el('span','l2d-setting-label');label.append(el('span',null,title),el('small',null,hint));
    const group=el('div',key==='gearTheme'?'l2d-theme-options':'l2d-particle-options');group.style.setProperty('--appearance-options',String(choices.length));group.setAttribute('role','radiogroup');group.setAttribute('aria-label',title);
    group.classList.toggle('l2d-appearance-six-options', choices.length === 6);
    for(const choice of choices){
      const option=el('label','l2d-appearance-option'),input=el('input','l2d-appearance-radio');input.type='radio';input.name='l2d-'+key;input.value=choice.id;input.checked=appearance[key]===choice.id;input.setAttribute('aria-label',zh?choice.name:choice.en);
      const icon=el('span',key==='gearTheme'?'l2d-theme-swatch':'l2d-particle-icon',key==='gearTheme'?null:choice.icon);icon.setAttribute('aria-hidden','true');if(choice.fill){icon.style.background=choice.fill;option.style.setProperty('--choice-color',choice.color);}
      option.append(input,icon,el('span',null,zh?choice.name:choice.en));group.append(option);controls.push(input);
      input.addEventListener('change',()=>{if(input.disabled||!input.checked)return;appearance[key]=choice.id;paintAppearance();dirty['worlds.figure.'+key]=choice.id;});
    }
    row.append(label,group);section.append(row);
  }
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
      const sparks = el('span', 'l2d-gear-sparks'); sparks.setAttribute('aria-hidden', 'true');
      for (let i = 0; i < 10; i++) {
        const spark = el('i');
        spark.style.cssText = `--spark-x:${8 + i * 8.4}%;--spark-y:${6 + (i * 7 % 18)}px;--spark-delay:${-i * .37}s;--spark-duration:${1.8 + i % 3 * .4}s`;
        sparks.append(spark);
      }
      fill.append(sparks);
      const stops = el('span', 'l2d-gear-stops'); stops.setAttribute('aria-hidden', 'true');
      choices.forEach(() => stops.append(el('i')));
      input = el('input', 'l2d-gear-input');
      input.type = 'range'; input.min = '0'; input.max = String(choices.length - 1); input.step = '1';
      const initial = choices.findIndex(([v]) => v === cfg[key]);
      input.value = String(initial < 0 ? choices.findIndex(([v]) => v === (key === 'texture' ? 'original' : key === 'previewSize' ? '512' : key === 'assistDepth' ? 'standard' : key === 'quality' ? 'balanced' : key === 'adaptationMode' ? 'none' : 'auto')) : initial);
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
    input.addEventListener('change', () => { if (input.disabled) return; paint(); dirty['worlds.figure.' + key] = type === 'checkbox' ? input.checked : readValue ? readValue() : input.value.trim(); });
    fields.set(key,{input,paint,readValue,choices});
    controls.push(input); row.append(label, control || input); body.append(row); return input;
  }
  let depend=()=>{};
  if(appearanceOnly){
    const appearanceGroup = title => {
      const section = el('section', 'l2d-appearance-group');
      section.append(el('h3', 'l2d-appearance-heading', title));
      body.append(section);
      return section;
    };
    const preview=el('section','l2d-appearance-preview');preview.setAttribute('aria-label',t('外观实时预览','Live appearance preview'));
    const intro=el('div','l2d-preview-intro');intro.append(el('strong',null,t('实时预览','Live preview')),el('small',null,t('修改即时显示并自动保存','Changes appear and save automatically')));
    const bar=el('div','l2d-gear is-max l2d-preview-bar');bar.setAttribute('role','img');bar.setAttribute('aria-label',t('满档光效预览','Maximum effect preview'));
    const track=el('span','l2d-gear-track'),fill=el('span','l2d-gear-fill'),sparks=el('span','l2d-gear-sparks');sparks.setAttribute('aria-hidden','true');
    for(let i=0;i<10;i++){const spark=el('i');spark.style.cssText=`--spark-x:${8+i*8.4}%;--spark-y:${6+i*7%18}px;--spark-delay:${-i*.37}s;--spark-duration:${1.8+i%3*.4}s`;sparks.append(spark);}fill.append(sparks);track.append(fill,el('span','l2d-preview-thumb'));bar.append(track);
    const samples=el('div','l2d-preview-samples'),sample=el('div','l2d-card l2d-preview-card');sample.append(el('strong',null,t('模型卡片','Model card')),el('small',null,t('材质与边角','Material and corners')));
    const button=el('button','l2d-btn primary',t('主要按钮','Primary button'));button.type='button';button.disabled=true;
    const input=el('input','l2d-input');input.value=t('输入框预览','Input preview');input.readOnly=true;input.setAttribute('aria-label',input.value);
    samples.append(sample,input,button);preview.append(intro,bar,samples);body.append(preview);
    const theme = appearanceGroup(t('主题','Theme'));
    appearanceField(theme,'uiStyle',t('外观方案','Appearance preset'),t('默认使用原版蓝紫风格，自定义选项会保留','Default uses the original blue and purple look. Custom choices are kept.'),UI_STYLES);
    appearanceField(theme,'gearTheme',t('主题配色','Theme colour'),t('统一标题区、页签、按钮和满档滑杆的配色','Colours the header, tabs, buttons and sliders at their highest setting'),GEAR_THEMES);
    appearanceField(theme,'uiMode',t('明暗模式','Light and dark mode'),t('设置 Figure 页面与标题区的明暗','Controls brightness across the Figure panel and its header'),UI_MODES);
    const controlsGroup = appearanceGroup(t('控件与材质','Controls and materials'));
    appearanceField(controlsGroup,'uiMaterial',t('表面材质','Surface material'),t('用于卡片、面板和弹窗','Applies to cards, panels and dialogs'),UI_MATERIALS);
    appearanceField(controlsGroup,'uiCorners',t('边角风格','Corners'),t('统一卡片、弹窗和控件的圆角','Sets corner shapes for cards, dialogs and controls'),UI_CORNERS);
    appearanceField(controlsGroup,'uiButtonFill',t('按钮填色','Button fill'),t('用于主要操作按钮','Applies to primary action buttons'),UI_BUTTON_FILLS);
    appearanceField(controlsGroup,'uiGlow',t('光晕强度','Glow intensity'),t('调整按钮和面板周围的光晕','Sets the glow around buttons and panels'),UI_GLOWS);
    const sliders = appearanceGroup(t('滑杆','Sliders'));
    appearanceField(sliders,'particleEffect',t('粒子效果','Particle effect'),t('用于满档滑杆。桌宠演出请到「特效」页选择。','Applies to sliders at their highest setting. Choose pet effects on the Effects tab.'),GEAR_PARTICLES);
    paintAppearance();
  } else {
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
  field('previewSize',t('预览精度','Preview resolution'),t('仅影响动作与装扮对照图；默认 512','Only affects action and wardrobe comparison images; default 512'),'gear',['256','512','1024'].map(v=>[v,v+' px']));
  field('clean', t('清理', 'Clean'), '', 'checkbox');
  field('autoDelete', t('安装后删除打包产物', 'Delete pack after installation'), t('仅在安装成功后执行，保留原始素材', 'Only after a successful install; source files are kept'), 'checkbox');
  const folder = field('figuresDir', t('安装目录', 'Install folder'), t('通常无需修改', 'Usually no change needed'), 'text');
  if (ctx.pickPath) {
    const picker = el('span', 'l2d-folder-control');
    const browse = el('button', 'l2d-btn sm', t('选择', 'Browse')); browse.type = 'button';
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
  body.append(el('h3','l2d-settings-heading',t('动作适配','Action mapping')));
  const mode = field('adaptationMode',t('适配方式','Adaptation mode'),t('无：仅通用配方；人工：预览并绑定；AI：交给 Coo 分析','None: generic recipes; Manual: preview and bind; AI: let Coo analyze'),'gear',[['none',t('无','None')],['manual',t('人工','Manual')],['ai','AI']]);
  const gear = field('assistGear',t('分析方式','Analysis mode'),t('图片不受支持时自动使用文本','Falls back to text when the current model cannot use images'),'gear', [['text',t('文本','Text')],['auto',t('自动','Auto')],['image',t('文本＋图片','Text + images')]]);
  const depth = field('assistDepth',t('适配深度','Adaptation depth'),t('仅文本＋图片时启用：基础取样、针对性补查、映射对照复核','Available with text + images: basic sampling, targeted inspection, mapping comparison'),'gear', [['quick',t('快速','Quick')],['standard',t('标准','Standard')],['deep',t('深入','Deep')]]);
  const automatic = field('assistAuto',t('自动安装','Automatic installation'),t('满足安装条件后自动执行；需要确认时暂停','Install when requirements are met; pause for confirmation when needed'),'checkbox');
  const confirmFallback = field('assistConfirmFallback',t('降级前确认','Confirm fallback'),t('需要沿用通用表现时先确认，默认直接继续','Ask before keeping generic behavior. Off by default.'),'checkbox');
  const roots = field('modelRoots',t('模型搜索目录','Model search folders'),t('每行一个目录；用于按名字找模型','One folder per line, used when finding models by name'),'textarea');
  roots.placeholder = t('留空时只搜索最近使用的模型目录','Leave empty to search recently used model folders');
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
  }
  const actions = el('div', 'l2d-dialog-actions');
  if (onNotice) {
    const note = el('button', 'l2d-notice-entry', t('须知', 'Notice')); note.type = 'button';
    note.addEventListener('click', () => { if (!isDisposed()) onNotice(); });
    actions.append(note);
  }
  const status = el('span', 'l2d-settings-status', autosave ? t('修改后自动保存。', 'Changes save automatically.') : '');
  status.setAttribute('role', 'status');
  const save = el('button', 'l2d-btn primary', t('保存设置', 'Save settings')); save.type = 'submit'; save.hidden = autosave;
  actions.append(status, save); body.append(actions);
  let saving = false;
  ctx.guardLeave?.(() => body.isConnected && (saving || Object.keys(dirty).length) ? t('设置尚未保存，确定离开？', 'Settings are not saved. Leave anyway?') : null);
  async function persist() {
    if (saving || isDisposed()) return;
    if (!Object.keys(dirty).length) { if (!autosave) await onSaved?.(); return; }
    saving = true; save.disabled = true;
    if (!autosave) controls.forEach(input => { input.disabled = true; });
    status.textContent = t('保存中…', 'Saving…');
    const patch = {...dirty};
    let succeeded = false;
    try {
      await ctx.setConfig('figure', patch);
      for (const key of Object.keys(patch)) if (dirty[key] === patch[key]) delete dirty[key];
      succeeded = true;
      if (isDisposed()) return;
      status.textContent = t('已保存', 'Saved'); save.hidden = autosave;
      await onSaved?.();
    } catch (error) {
      if (!isDisposed()) {
        status.textContent = t('保存失败，请重试。', 'Save failed. Please retry.');
        save.hidden = false; if (autosave) save.textContent = t('重试保存', 'Retry save');
        ctx.ui.toast(String(error?.message || error), 'bad');
      }
    } finally {
      saving = false; save.disabled = false;
      if (!autosave) { controls.forEach(input => { input.disabled = false; }); depend(); }
    }
    if (autosave && succeeded && Object.keys(dirty).length && !isDisposed()) await persist();
  }
  body.addEventListener('submit', event => { event.preventDefault(); void persist(); });
  if (autosave) body.addEventListener('change', () => { void persist(); });
  return body;
}

const configuration = {
  async mount(ctx) {
    const cfg = await ctx.invoke('settings', []);
    if (ctx.signal?.aborted) return;
    const restoreAppearance=ownAppearance(ctx.root);applyAppearance(ctx.root,cfg);
    const doc = ctx.root.ownerDocument;
    const zh = String(ctx.language || 'zh').toLowerCase().startsWith('zh');
    const shell = doc.createElement('section'); shell.className = 'l2d-config-page';
    shell.setAttribute('aria-label', zh ? '模型设置' : 'Model settings');
    const form = settingsForm(ctx, cfg, {autosave:true});
    shell.append(form); ctx.root.append(shell);
    return {dispose() { shell.remove();restoreAppearance(); }};
  },
};

export default {
  panels: {
    settings: configuration,
    effects: effectsGallery,
    voice: speechProviders,
    appearance: {
      async mount(ctx){
        const cfg=await ctx.invoke('settings',[]);
        if(ctx.signal?.aborted)return;
        const restoreAppearance=ownAppearance(ctx.root),doc=ctx.root.ownerDocument,zh=String(ctx.language||'zh').startsWith('zh');
        const shell=doc.createElement('section');shell.className='l2d-config-page l2d-appearance-page';
        shell.setAttribute('aria-label',zh?'外观':'Appearance');
        const form=settingsForm(ctx,cfg,{autosave:true,appearanceOnly:true,onAppearance:value=>applyAppearance(ctx.root,value)});
        shell.append(form);ctx.root.append(shell);
        return {dispose(){shell.remove();restoreAppearance();}};
      },
    },
    workbench: {
      mount(ctx) {
        const ui = ctx.ui;
        const doc = ctx.root.ownerDocument;
        const win = doc.defaultView;
        const restoreAppearance=ownAppearance(ctx.root);
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
        let activeImportToken = null;
        let resumeHandle = null;
        let resuming = false;
        let resumePolling = false;
        let resumePhase;
        let editingId = null;
        let overlay = null;
        let popup = null;
        let noticeDialog = null;
        let settingsLoading = false;
        let assistTimer = null;
        let assistPolling = false;
        let assistState = {enabled:false,plans:[]};
        let currentAppearance=normalizeAppearance();
        function showDialog(title, body) {
          overlay?.dispose?.();
          if(body?.nodeType===1)applyAppearance(body,currentAppearance);
          overlay = ui.drawer(title, body);
          return overlay;
        }
        function showPopup(title, body, options = {}) {
          popup?.dispose();
          const handle = openFigureDialog(shell, title, body, {
            closeLabel:t('关闭','Close'), ...options,
            onClose() { if (popup === handle) popup = null; options.onClose?.(); },
          });
          popup = handle;
          return handle;
        }
        const state = { dir: '', busy: false, builds: [], installed: null, figuresDir: '' };

        // ---- Live2D 核心组件：不随扩展分发，同意许可后从官方地址取 ----
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
            const kb = Math.round((core.bytes || 0) / 1024);
            coreText.textContent = t(
              `核心已就绪 · ${core.version || ''} · ${kb} KB · 已校验`,
              `Core ready · ${core.version || ''} · ${kb} KB · verified`,
            );
            coreGet.hidden = true;
          } else {
            coreText.textContent = t(
              '本扩展不附带 Live2D 核心组件。点「同意并获取」后，从 Live2D Inc. 官方服务器取同一份文件并校验 SHA-256；核心不随扩展分发。',
              'This extension does not ship the Live2D core. "Agree & fetch" downloads the same file from Live2D Inc. and verifies its SHA-256.',
            );
            coreGet.hidden = false;
          }
        }

        coreGet.addEventListener('click', async () => {
          const flow = noticeDialog;
          if (state.busy || !flow) return;
          flow.saving = true;
          flow.error.textContent = '';
          setBusy(true, t('获取核心…', 'Fetching core…'));
          try {
            core = await ctx.invoke('coreAccept', [true]);
            paintCore();
            log.append(t('已获取 Live2D 核心并校验', 'Live2D core fetched and verified'), 'dim');
          } catch (e) {
            flow.error.textContent = t('获取失败，可以重试或打开官网。', 'Could not fetch the core. Retry or open the download page. ') + text(e);
            log.append('! ' + text(e), 'warn');
          } finally {
            setBusy(false);
            flow.saving = false;
          }
          if (coreReady()) finishNotice(flow);
        });

        const shell = el('section', 'l2d-sheet');
        const header = el('header', 'l2d-header');
        header.setAttribute('aria-label',t('模型工坊操作','Figure workshop actions'));
        const toolbar = el('div','l2d-toolbar');
        const settingsButton = el('button', 'l2d-btn l2d-settings-button', t('设置', 'Settings'));
        settingsButton.type = 'button';
        settingsButton.addEventListener('click', openSettings);
        toolbar.append(settingsButton);header.append(toolbar);
        const sheet = { el: shell, body: el('div', 'l2d-body') };
        shell.append(header, sheet.body);
        ctx.root.appendChild(shell);
        const operation = el('section','l2d-operation');
        operation.setAttribute('aria-label',t('导入与处理','Import and processing'));
        const operationBottom = el('div','l2d-operation-bottom');
        sheet.body.append(operation);
        const versionCorner = el('button', 'l2d-version-corner', '…');
        versionCorner.type = 'button';
        versionCorner.disabled = true;
        versionCorner.setAttribute('aria-haspopup', 'dialog');
        header.appendChild(versionCorner);
        function paintNotice() {
          if (disposed) return;
          const ack = notice?.acknowledged === true;
          versionCorner.textContent = version ? `v${version}` : '…';
          versionCorner.classList.toggle('unack', !ack);
          versionCorner.classList.toggle('ack', ack);
          versionCorner.title = ack ? t('查看须知', 'Read notice') : t('请阅读并确认须知', 'Read and acknowledge the notice');
          versionCorner.disabled = !notice || state.busy;
          noticeEntry.hidden = !ack;
          versionCorner.setAttribute('aria-label', `${versionCorner.textContent} · ${ack ? t('已确认', 'Acknowledged') : t('未确认', 'Not acknowledged')}`);
          if (noticeDialog) {
            noticeDialog.accept.hidden = ack;
            noticeDialog.accept.disabled = state.busy;
          }
        }
        versionCorner.addEventListener('click', () => openNotice());
        function ensureNotice(resume, needsCore = false) {
          if (notice?.acknowledged && (!needsCore || coreReady())) return true;
          openNotice(resume, needsCore);
          return false;
        }


        // ---- 导入区与两个主操作 ----
        const bar = el('div', 'l2d-import-bar');
        const dropZone = el('div', 'l2d-drop-zone');
        dropZone.tabIndex = 0;
        dropZone.setAttribute('role', 'region');
        dropZone.setAttribute('aria-label', t('模型导入区域，点击后可粘贴', 'Model import area; click to paste'));
        const sourceTitle = el('div', 'l2d-source-title');
        const sourceHint = el('div', 'l2d-source-hint');
        dropZone.append(sourceTitle, sourceHint);
        const actions = el('div', 'l2d-import-controls');
        const chooseFolder = el('button', 'l2d-btn', t('选择文件夹', 'Choose folder'));
        const chooseZip = el('button', 'l2d-btn', t('选择 ZIP', 'Choose ZIP'));
        const pack = el('button', 'l2d-btn primary', t('一键打包', 'Pack models'));
        const installNow = el('button', 'l2d-btn primary', t('一键安装', 'Install now'));
        const skipCover = el('button', 'l2d-btn sm', t('跳过封面', 'Skip cover'));
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
        toolbar.prepend(chooseFolder, chooseZip);
        actions.append(pack, installNow);
        bar.append(dropZone, folderInput, zipInput);
        operation.append(bar,operationBottom);
        let staged = null;
        let currentCover = null;
        const completed = new Map();
        const installedSources = new Set();
        function stagedWorkflow(source) {
          const models = source?.models ?? [];
          const packs = source?.packs ?? [];
          const mode = assistState.enabled ? 'ai' : assistState.adaptationMode === 'manual' ? 'manual' : 'direct';
          return {mode, models, packs};
        }
        function paintImportButtons(count) {
          const {mode} = stagedWorkflow(staged);
          const direct = mode === 'direct';
          const request = mode === 'ai' && (assistState.submissions || []).find(r => r.token === staged?.token);
          pack.classList.toggle('primary', !direct);
          pack.disabled = state.busy || !count || completed.size === count;
          pack.textContent = request?.canRetry ? t('重新提交分析','Retry analysis') : mode === 'ai' ? t('提交 AI 适配','Submit to Coo') : mode === 'manual' ? t('预览并绑定','Preview & bind') : t('一键打包','Pack models');
          installNow.hidden = !direct;
          installNow.disabled = state.busy || !count || installedSources.size === count;
          if (request && !request.error && !request.canRetry) pack.disabled = true;
        }
        function paintSource() {
          const models = staged?.models ?? [];
          const packs = staged?.packs ?? [];
          const count = models.length + packs.length;
          const names = [...models.map(m => m.title), ...packs.map(p => (zh ? p.nameZh : p.nameEn) || p.id)];
          sourceTitle.textContent = count ? names.slice(0, 3).join('、') + (count > 3 ? t(` 等 ${count} 项`, ` and ${count - 3} more`) : '') : t('拖入模型或 ZIP', 'Drop a model folder or ZIP');
          sourceTitle.title = names.join('\n');
          sourceHint.textContent = count
            ? (stagedWorkflow(staged).mode === 'ai' ? t(`已识别 ${count} 项 · 在「进展与结果」查看 AI 适配`, `${count} recognized · see AI adaptation in Progress & results`) : installedSources.size === count ? t('已安装，可在 Coo 装扮中选择', 'Installed; choose in Coo Dress up') : completed.size === count ? t('已加入模型包列表，可编辑或安装', 'Added to packs; edit or install') : t(`已识别 ${count} 项，可以开始打包`, `${count} recognized; ready to pack`))
            : t('点击此区域后，按 Ctrl+V 粘贴文件或目录路径', 'Click here, then press Ctrl+V to paste files or a local path');
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
        const resultButton = el('button', 'l2d-btn sm l2d-result-entry', t('进展与结果', 'Progress & results'));
        resultButton.type = 'button';
        resultButton.setAttribute('aria-haspopup', 'dialog');
        const statusGroup = el('div', 'l2d-status-group');
        const coverSlot = el('span', 'l2d-cover-slot'); coverSlot.append(skipCover);
        statusGroup.append(status, coverSlot, resultButton);
        const actionRow = el('div', 'l2d-action-row');
        actionRow.append(statusGroup, actions); operationBottom.append(actionRow);
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
        const search = el('input', 'l2d-input l2d-search');
        search.type = 'search'; search.placeholder = t('搜索模型包', 'Search packs');
        search.setAttribute('aria-label', search.placeholder);
        const sort = el('select', 'l2d-input l2d-sort');
        sort.setAttribute('aria-label', t('排序', 'Sort'));
        for (const [value, label] of [['new', t('最近添加', 'Newest')], ['name', t('按名称', 'Name')]]) {
          const option = el('option', null, label); option.value = value; sort.append(option);
        }
        const clearAll = el('button', 'l2d-btn sm quiet', t('清空旧打包', 'Clear old packs'));
        head.append(libraryTitle, search, sort, clearAll);
        sheet.body.appendChild(head);
        const workspace = el('div', 'l2d-workspace');
        const assistDock = el('div', 'l2d-assist-dock');
        resultBody.append(assistDock);
        const grid = el('div', 'l2d-grid');
        grid.setAttribute('aria-label', t('模型包卡片', 'Pack cards'));
        workspace.append(grid); sheet.body.append(workspace);
        search.addEventListener('input', renderGrid);
        sort.addEventListener('change', renderGrid);

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
        resultButton.addEventListener('click', () => showPopup(t('进展与结果', 'Progress & results'), resultBody, {variant:'l2d-result-popup'}));
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
          flow.handle = showPopup(t('须知', 'Notice'), body, {
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
              isDisposed: () => disposed,
              onNotice: openNotice,
              onSaved: async () => {
                if (disposed) return;
                dialog?.dispose?.(); ui.toast(t('设置已保存', 'Settings saved'), 'ok');
                await refresh();
              },
            });
            dialog = showDialog(t('设置', 'Settings'), body);
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
            try { const value = await ctx.invoke('assistState', []); if (!disposed) {
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
            if(request.canRetry&&request.token===staged?.token){
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
                if(state.busy || method === 'assistApprove' && !ensureNotice(() => button.click()))return;
                setBusy(true,t('处理方案…','Processing proposal…'));
                try { await ctx.invoke(method,[plan.id]); await refresh(); }
                catch(error){reportResult(t('处理方案失败，可以重试。','Could not process the proposal. Try again.'),[text(error)],true);log.append(text(error),'bad');await refresh().catch(()=>{});}
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
        }

        function reportResult(heading, lines = [], bad = false) {
          resultFeedback.replaceChildren();
          if (heading) resultFeedback.append(el('strong', null, heading));
          for (const line of lines) if (line) resultFeedback.append(el('p', null, line));
          resultFeedback.classList.toggle('has-error', bad);
          resultButton.classList.toggle('has-error', bad);
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
          for (const input of modal?.querySelectorAll('button, input, textarea, select') ?? []) input.disabled = on;
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
          if (state.installed?.target) bits.push(t('已安装 ', 'Installed ') + state.installed.target.split(/[\\/]/).pop());
          else if (notice && !notice.acknowledged) bits.push(t('首次使用需确认须知','Read the notice before first use'));
          else if (notice && !coreReady()) bits.push(t('Live2D 核心待获取','Live2D core is missing'));
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

        function renderGrid() {
          grid.replaceChildren();
          countLabel.textContent = initialized ? String(state.builds.length) : '—';
          clearAll.disabled = state.busy || state.builds.length < 2;
          if (!initialized) {
            const empty = el('div', 'l2d-empty');
            empty.append(el('strong', null, startupFailed ? t('暂时无法读取模型包', 'Could not load packs') : t('正在读取模型包…', 'Loading packs…')));
            if (startupFailed) {
              const retry = el('button', 'l2d-btn', t('重新读取', 'Retry loading'));
              retry.type = 'button';
              retry.addEventListener('click', startWorkbench);
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
          if (!builds.length) grid.append(el('div', 'l2d-empty', t('没有匹配的模型包', 'No matching packs')));
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
              preview.addEventListener('click', () => openCover(b, shown));
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
            titleEl.addEventListener('click', () => { if (!state.busy) openEdit(b, card, titleEl); });
            titleEl.title = b.id;
            info.appendChild(titleEl);
            info.appendChild(el('div', 'meta',
              `${(b.bytes / 1048576).toFixed(1)} MB · ${clock(b.at)}`));
            if (installedId === b.id) info.appendChild(el('span', 'tagline', t('已安装', 'Installed')));
            card.appendChild(info);
            const adaptation = adaptationDetails(b.adaptation);
            if (adaptation) {
              const details = el('button', 'l2d-adaptation-link', adaptation.title);
              details.type = 'button';
              details.setAttribute('aria-haspopup', 'dialog');
              details.title = adaptation.title;
              details.addEventListener('click', () => showPopup(t('适配详情','Adaptation details'), adaptation.detail));
              info.append(details);
            }

            const install = el('button', 'l2d-btn sm l2d-install', t('安装', 'Install'));
            install.addEventListener('click', () => run('install', b.id));
            const cardActions = el('div', 'l2d-card-actions');
            cardActions.appendChild(install);

            const row = el('div', 'row');
            const edit = el('button', 'l2d-btn sm', t('编辑', 'Edit'));
            edit.addEventListener('click', () => { if (!state.busy) openEdit(b, card, edit); });
            const del = el('button', 'l2d-btn sm danger', t('删除', 'Delete'));
            del.addEventListener('click', async () => {
              if (state.busy) return;
              const ok = await ui.confirm({
                title: t('删除这份打包产物？', 'Delete this pack?'),
                body: t('只删这一份打包，已安装的形象不受影响。', 'Only this pack folder is removed.'),
                danger: true,
              });
              if (!ok) return;
              setBusy(true, t('删除…', 'Deleting…'));
              try {
                const r = await ctx.invoke('remove', [b.id]);
                state.builds = r.builds ?? [];
                forgetRemovedPacks();
                paint();
                log.append(t('已删除 ', 'Deleted ') + b.id, 'dim');
                ui.toast(t('已删除', 'Deleted'), 'ok');
              } catch (e) {
                ui.toast(text(e), 'bad');
              } finally { setBusy(false); }
            });
            del.classList.add('quiet');
            if(b.manualAvailable){const bind=el('button','l2d-btn sm l2d-card-binding',t('动作','Actions'));bind.addEventListener('click',()=>openBindings('manualOpenBuild',[b.id]));card.appendChild(bind);}
            row.append(edit, del);
            cardActions.appendChild(row);
            card.appendChild(cardActions);
            for (const button of card.querySelectorAll('button')) button.disabled = state.busy;
            grid.appendChild(card);
          }
        }

        async function refresh() {
          const r = await ctx.invoke('list', []);
          if (disposed) return;
          state.builds = r.builds ?? [];
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
            reportResult(`${label} ✓`, r.warn ? [r.warn] : []);
            for (const line of r.log ?? []) log.append(line, 'dim');
            log.append(`✓ ${label} · ${((performance.now() - startedAt) / 1000).toFixed(1)}s`, 'plain');
            ui.toast(`${label} ✓`, 'ok');
            if (r.warn) log.append('! ' + r.warn, 'warn');
            await refresh().catch(e => log.append(t('操作已完成，列表刷新失败：', 'Completed, but the list could not refresh: ') + text(e), 'warn'));
          } catch (e) {
            const s = text(e);
            say(t(`${label}失败 · 查看结果`, `${label} failed · See results`), true);
            reportResult(t(`${label}失败，可以重试。`, `${label} failed. Try again.`),[s],true);
            log.append(`✗ ${s}`, 'bad');
            ui.toast(`${label} ✗`, 'bad');
          } finally {
            setBusy(false);
          }
        }

        let bindingEditor = null;
        let bindingOpening = false;
        async function openBindings(method,args,onSaved) {
          if(state.busy || bindingOpening || bindingEditor || !ensureNotice(() => openBindings(method,args,onSaved)))return;
          bindingOpening=true;
          try{bindingEditor=await openBindingEditor(ctx,method,args,async result=>{onSaved?.(result);await refresh();},()=>{bindingEditor=null;});}
          catch(error){ui.toast(text(error),'bad');}
          finally{bindingOpening=false;if(bindingEditor?.closed)bindingEditor=null;}
        }
        // ---------------- 编辑弹层 ----------------
        let modal = null;
        let editReturnFocus = null;
        let editLoading = false;
        let editDirty = () => false;
        let cropEditor = null;

        function closeEdit() {
          if (state.busy) return;
          if (modal) {
            const previousId = editingId;
            cropEditor?.dispose(); cropEditor = null;
            modal.close(); modal.remove(); modal = null; editingId = null;
            const previous = [...grid.querySelectorAll('.l2d-card')].find(card => card.dataset.id === previousId);
            previous?.classList.remove('selected');
            (editReturnFocus?.isConnected ? editReturnFocus : previous?.querySelector('button.title'))?.focus({ preventScroll: true });
          }
        }

        async function openEdit(b, cardEl, trigger) {
          if (state.busy || editLoading) return;
          if (modal && editingId === b.id) { modal.querySelector('[role="tab"][aria-selected="true"], input')?.focus(); return; }
          editLoading = true;
          if (modal && editDirty()) {
            const discard = await ui.confirm({ title: t('放弃未保存的修改？', 'Discard unsaved edits?'), body: t('切换到另一份模型包。', 'Open the other pack.') });
            if (!discard || disposed || state.busy) { editLoading = false; return; }
          }
          editReturnFocus = trigger;
          const d = await ctx.invoke('detail', [b.id]).catch(() => null);
          editLoading = false;
          if (disposed || state.busy) return;
          if (!d) { ui.toast(t('读不到这份打包的信息', 'Cannot read this pack'), 'bad'); return; }
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
            save.disabled = true;
            setBusy(true, t('保存…', 'Saving…'));
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
              // 先就地更新卡片，再拉一次完整列表
              if (cardEl && name) {
                const titleEl = cardEl.querySelector('.title');
                if (titleEl) titleEl.textContent = name;
              }
              if (patch.nameZh !== undefined) b.nameZh = name;
              if (patch.nameEn !== undefined) b.nameEn = name;
              setBusy(false);
              closeEdit();
              ui.toast(t('已保存', 'Saved'), 'ok');
              log.append(t('编辑 · ', 'Edited · ') + b.id, 'dim');
              refresh().catch(() => {});
            } catch (e) {
              error.textContent = t('保存失败，可以重试。', 'Could not save. Try again. ') + text(e);
            } finally {
              save.disabled = false;
              if (editScroll) editScroll.inert = false;
              if (editTabs) editTabs.inert = false;
              setBusy(false);
            }
          });

          modal.appendChild(card);
          shell.appendChild(modal);
          modal.showModal();
          fields.name.focus({preventScroll:true});
        }

        // ---------------- 导入 ----------------
        const MAX_MB = 32;

        function toBase64(buffer) {
          const bytes = new Uint8Array(buffer);
          const parts = [];
          const chunk = 0x8000;
          for (let i = 0; i < bytes.length; i += chunk) {
            parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunk)));
          }
          return btoa(parts.join(''));
        }

        /** 面板拼的文件夹包：与桌宠同一套格式（路径长度 + 路径 + 内容长度 + 内容）。 */
        function bundle(files) {
          const enc = new TextEncoder();
          const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
          return new Blob(files.flatMap(({ path, file }) => {
            const name = enc.encode(path);
            return [u32(name.length), name, u32(file.size), file];
          }));
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

        function cancelOwnedImport(token = activeImportToken) {
          if (!token) return;
          if (disposed && ctx.notifyOnUnmount) ctx.notifyOnUnmount('importCancel', [token]);
          else ctx.invoke('importCancel', [token]).catch(() => {});
        }

        const importView = {
          loading(label) { sourceTitle.textContent = label; sourceHint.textContent = ''; },
          note(title, detail, bad) {
            staged = null; completed.clear(); installedSources.clear(); paintSource();
            sourceHint.textContent = [detail || title, t('可重新选择文件夹或 ZIP','Choose a folder or ZIP again')].join(' · ');
            sourceHint.title = detail || title;
            reportResult(title,[detail,t('可重新选择文件夹、ZIP，或粘贴模型路径。','Choose a folder or ZIP again, or paste the model path.')],Boolean(bad));
            dropZone.classList.toggle('bad', Boolean(bad));
          },
          result(result) {
            if (disposed) { cancelOwnedImport(result.token); return; }
            activeImportToken = result.token;
            staged = result; completed.clear(); installedSources.clear(); dropZone.classList.remove('bad');
            showAdaptation(null); paintSource();
            const count = (result.models?.length || 0) + (result.packs?.length || 0);
            const problems = (result.problems || []).map(p => p.reason).filter(Boolean);
            if (!count) {
              const reason = problems.join('；') || t('未找到 Live2D 模型或现成形象包', 'No Live2D model or figure pack found');
              sourceHint.textContent = reason; sourceHint.title = reason;
              reportResult(t('未找到可导入的模型，可重新选择。','No model could be imported. Choose again.'),[reason],true);
            } else {
              reportResult(t(`已识别 ${count} 项`, `${count} recognized`),problems);
              if (assistState.enabled) {
                void ctx.invoke('assistState', []).then(value => {
                  if (!disposed && staged === result && typeof value?.enabled === 'boolean') paintAutomation(value);
                }).catch(() => {});
              }
            }
          },
        };

        function clearSource() {
          staged = null; completed.clear(); installedSources.clear(); showAdaptation(null); paintSource();
          reportResult('');
          dropZone.classList.remove('bad');
        }

        async function stageZip(file) {
          if (state.busy || disposed) return;
          if (file.size > MAX_MB * 1048576) { importView.note(t('ZIP 太大', 'ZIP too large'), t('请解压后选择文件夹', 'Extract it and choose the folder'), true); return; }
          clearSource(); setBusy(true, t('读取 ZIP…', 'Reading ZIP…'));
          importView.loading(t('解包中…', 'Unpacking…'));
          try {
            const bytes = await file.arrayBuffer();
            if (disposed) return;
            if (bytes.byteLength > MAX_MB * 1048576) throw new Error(t('ZIP 超过 32 MB，请解压后导入文件夹', 'ZIP exceeds 32 MB; import the extracted folder'));
            importView.result(await ctx.invoke('importStage', [toBase64(bytes), 'zip']));
          } catch (error) { if (!disposed) importView.note(t('导入失败', 'Import failed'), text(error), true); }
          finally { setBusy(false); }
        }

        async function stageFolder(files, view) {
          if (state.busy || disposed) return;
          const picked = packFiles(files, 3);
          if (!picked.length) { view.note(t('这里没有模型包', 'No model pack here'), t('没有找到 Live2D 模型或现成形象包', 'No Live2D model or figure pack found'), false); return; }
          if (picked.length > 20000 || picked.reduce((n, f) => n + (Number(f.file.size) || 0), 0) > 512 * 1048576) { view.note(t('目录过大', 'Folder too large'), t('请改用粘贴本机目录路径', 'Paste its local directory path instead'), true); return; }
          clearSource(); setBusy(true, t('读取文件夹…', 'Reading folder…'));
          view.loading(t('读取文件夹…', 'Reading folder…'));
          let token;
          try {
            token = (await ctx.invoke('importBegin', [])).token;
            activeImportToken = token;
            let batch = [], bytes = 0;
            const flush = async () => { if (batch.length) { await ctx.invoke('importAppend', [token, batch]); batch = []; bytes = 0; } };
            for (const item of picked) {
              if (disposed) return;
              if (item.file.size > 4 * 1048576 && typeof item.file.slice === 'function') {
                await flush();
                for (let offset = 0; offset < item.file.size; offset += 2 * 1048576) {
                  const data = await item.file.slice(offset, offset + 2 * 1048576).arrayBuffer();
                  if (disposed) return;
                  await ctx.invoke('importAppendChunk', [token, {path:item.path,offset,total:item.file.size,b64:toBase64(data)}]);
                }
              } else {
                const data = await item.file.arrayBuffer();
                if (disposed) return;
                const b64 = toBase64(data); batch.push({path:item.path,b64}); bytes += b64.length;
                if (bytes >= 4 * 1048576) await flush();
              }
            }
            await flush();
            if (!disposed) view.result(await ctx.invoke('importFinish', [token, true]));
          } catch (error) { if (!disposed) view.note(t('导入失败', 'Import failed'), text(error), true); if (token) cancelOwnedImport(token); }
          finally { if (disposed && token) cancelOwnedImport(token); setBusy(false); }
        }

        async function importPaths(paths) {
          if (state.busy || disposed || !paths.length) return;
          clearSource();
          setBusy(true, t('读取…', 'Reading…'));
          importView.loading(t('识别模型…', 'Recognizing model…'));
          try { const result = await ctx.invoke('importPaths', [paths]); if (!disposed) importView.result(result); }
          catch (e) { if (!disposed) importView.note(t('导入失败', 'Import failed'), text(e), true); }
          finally { setBusy(false); }
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

        async function importFiles(files) {
          if (state.busy || disposed || !files.length) return;
          const local = files.map(f => f.path || f.file.path).filter(p => /^[a-z]:[\\/]/i.test(p || '') || p?.startsWith('/'));
          if (local.length === files.length) return importPaths(local);
          if (files.length === 1 && /\.zip$/i.test(files[0].path)) return stageZip(files[0].file);
          if (files.length === 1 && /\.json$/i.test(files[0].path)) {
            importView.note(t('缺少同目录资源', 'Sibling files required'), t('请选择入口文件的完整路径，或拖入整个模型文件夹', 'Choose the entry file by its local path, or drop the whole model folder'), true); return;
          }
          return stageFolder(files, importView);
        }

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
              reportResult(result.queued===false?t('已提交，请等待 Coo 的方案','Already submitted; wait for Coo'):t('已交给 Coo 分析','Sent to Coo for analysis'));
              await refresh().catch(error=>log.append(text(error),'warn'));
            } catch (error) {
              reportResult(t('提交失败，可以重新提交。','Submission failed. Try again.'),[text(error)],true);
              log.append(text(error),'bad'); await refresh().catch(()=>{});
            }
            finally{setBusy(false);}return;
          }
          if (mode === 'manual' && models.length) {
            const next = newModels[0];
            if(next) { await openBindings('manualOpen',[staged.token,next.dir],result=>{completed.set('importBuild:'+next.dir,result.buildId);}); return; }
          }
          const pending = [
            ...models.map(item => ({ ...item, method: 'importBuild' })),
            ...packs.map(item => ({ ...item, method: 'importKeep' })),
          ];
          const token = source.token;
          setBusy(true, installAfterBuild ? t('打包并安装…', 'Packing and installing…') : t('打包…', 'Packing…'));
          const failures = [];
          const warnings = [];
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
          if (disposed) { cancelOwnedImport(token); return; }
          sourceHint.textContent = failures.length
            ? t(`${failures.length} 项失败；再次点击只重试未完成项，原因见结果`, `${failures.length} failed; click again to retry unfinished items; see results`)
            : deferred ? t(`${deferred} 项已打包，等待确认替换`, `${deferred} packed; awaiting replacement approval`)
            : installAfterBuild ? t('已安装，可在 Coo 装扮中选择', 'Installed; choose in Coo Dress up')
            : t('已加入模型包列表，可编辑或安装', 'Added to packs; edit or install');
          sourceHint.title = sourceHint.textContent;
          dropZone.classList.toggle('bad', failures.length > 0);
          const done = installAfterBuild ? t('安装完成', 'Installation complete') : t('打包完成', 'Packing complete');
          reportResult(failures.length || deferred ? sourceHint.textContent : done, [...failures,...warnings], failures.length > 0);
        }

        function accessibleModal(node, title) {
          node.setAttribute('role', 'dialog');
          node.setAttribute('aria-modal', 'true');
          node.setAttribute('aria-label', title);
          node.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { e.preventDefault(); closeEdit(); }
          });
          node.addEventListener('cancel', (e) => { e.preventDefault(); closeEdit(); });
        }

        // ---------------- 绑定 ----------------
        // Browser inputs are owned by the Coo window and open its native system dialogs.
        chooseFolder.addEventListener('click', () => { if (!state.busy) folderInput.click(); });
        chooseZip.addEventListener('click', () => { if (!state.busy) zipInput.click(); });
        folderInput.addEventListener('change', async () => {
          if (disposed || state.busy) return;
          const files = [...(folderInput.files ?? [])].map(file => ({ path: file.webkitRelativePath || file.name, file }));
          if (!files.length) return;
          try { await stageFolder(files, importView); }
          catch (e) { importView.note(t('导入失败', 'Import failed'), text(e), true); }
          finally { folderInput.value = ''; }
        });
        zipInput.addEventListener('change', async () => {
          if (disposed || state.busy) return;
          try { await importFiles([...(zipInput.files ?? [])].map(file => ({ path: file.name, file }))); }
          catch (e) { importView.note(t('导入失败', 'Import failed'), text(e), true); }
          finally { zipInput.value = ''; }
        });
        pack.addEventListener('click', () => buildSources());
        installNow.addEventListener('click', () => buildSources(true));
        dropZone.addEventListener('click', () => dropZone.focus({ preventScroll: true }));
        dropZone.addEventListener('paste', async (event) => {
          event.preventDefault();
          if (state.busy) return;
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
            if (disposed) return;
            if (paths.length) return await importPaths(paths);
            const files = clipboardFiles.map(file => ({ path: file.name, file }));
            if (files.length) return await importFiles(files);
            importView.note(t('未读到模型', 'No model found'), t('请复制文件、文件夹，或其完整路径后粘贴', 'Copy files, a folder, or their full local path, then paste'), false);
          } catch (e) { importView.note(t('粘贴失败', 'Paste failed'), text(e), true); }
        });
        dropZone.addEventListener('dragover', event => { event.preventDefault(); if (!state.busy) dropZone.classList.add('over'); });
        dropZone.addEventListener('dragleave', event => { if (!dropZone.contains(event.relatedTarget)) dropZone.classList.remove('over'); });
        dropZone.addEventListener('drop', async event => {
          event.preventDefault(); dropZone.classList.remove('over');
          if (state.busy || disposed) return;
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
              if (disposed) return;
              if (entry.isDirectory) files.push(...await droppedFiles(entry, entry.name, 3));
              else files.push({path:entry.name,file:await new Promise((ok,bad)=>entry.file(ok,bad))});
            }
            setBusy(false);
            if (!disposed) {
              const captured = files.length ? files : plain;
              if (!captured.length) throw new Error(t('未读到文件，请拖入模型文件夹或 ZIP', 'No files found; drop a model folder or ZIP'));
              await importFiles(captured);
            }
          } catch (error) { if (!disposed) importView.note(t('导入失败', 'Import failed'), text(error), true); }
          finally { setBusy(false); }
        });
        clearAll.addEventListener('click', async () => {
          if (state.busy) return;
          const ok = await ui.confirm({
            title: t('清空旧打包？', 'Clear old packs?'),
            body: t('保留最新一份，其余打包目录直接删除。已安装的形象不受影响。', 'Keeps the newest pack; installed figures stay.'),
            danger: true,
          });
          if (!ok) return;
          setBusy(true, t('清理…', 'Clearing…'));
          try {
            const r = await ctx.invoke('clearAll', []);
            state.builds = r.builds ?? [];
            forgetRemovedPacks();
            paint();
            log.append(t('清空旧打包 · 删除 ', 'Cleared ') + r.removed + t(' 份', ' packs'), 'dim');
            ui.toast(t('已清空', 'Cleared'), 'ok');
          } catch (e) {
            ui.toast(text(e), 'bad');
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
            const [coreState, initial, cfg] = await Promise.all([
              ctx.invoke('core', []), ctx.invoke('state', []), ctx.invoke('settings', []),
            ]);
            if (disposed) return;
            await refresh();
            if (disposed) return;
            core = coreState;
            currentAppearance = normalizeAppearance(cfg);
            applyAppearance(ctx.root, cfg);
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
          if (startupTimer?.dispose) startupTimer.dispose();
          else if (startupTimer != null) win.clearTimeout(startupTimer);
          stopTicker();
          stopResume();
          assistTimer?.dispose?.();
          bindingEditor?.dispose?.();
          cropEditor?.dispose(); cropEditor = null;
          modal?.close(); modal?.remove();
          popup?.dispose(); overlay?.dispose?.();
          observer?.disconnect(); win.removeEventListener('resize', resize);
          shell.remove();
          cancelOwnedImport();
          ctx.root.removeAttribute('aria-busy');
          restoreAppearance();
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
