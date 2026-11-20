export const PLANNER_PROVIDERS = {
  openai: { name: 'OpenAI', endpoint: 'https://api.openai.com/v1', keyRequired: true },
  deepseek: { name: 'DeepSeek', endpoint: 'https://api.deepseek.com', keyRequired: true },
  dashscope: { name: '阿里云百炼', english: 'Alibaba Cloud Model Studio', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1', keyRequired: true },
  siliconflow: { name: '硅基流动', english: 'SiliconFlow', endpoint: 'https://api.siliconflow.cn/v1', keyRequired: true },
  gemini: { name: 'Google Gemini', endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai', keyRequired: true },
  openrouter: { name: 'OpenRouter', endpoint: 'https://openrouter.ai/api/v1', keyRequired: true },
  ollama: { name: 'Ollama（本机）', english: 'Ollama (local)', endpoint: 'http://127.0.0.1:11434/v1', keyRequired: false },
  custom: { name: '自定义兼容接口', english: 'Custom compatible API', endpoint: '', keyRequired: false },
};
