const field = (key,label,value='',extra={}) => ({key,label,value,...extra});
const address = value => field('endpoint','服务地址',value,{url:true,required:true});
const model = value => field('model','模型',value,{required:true});
const voice = (value='',label='音色') => field('voice',label,value,{required:true});
const number = (key,label,value,min,max,step=.1) => field(key,label,value,{type:'number',min,max,step});

// Provider names and fields follow AstrBot's TTS catalog. The desktop owns
// playback and adapters here run independently of AstrBot.
export const VOICE_PROVIDERS = {
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
