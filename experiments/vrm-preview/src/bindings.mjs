/**
 * 动作绑定表：v1 只做 14 个语义词。
 *
 * 两条来源：
 *   - asset   ：VRMA 片段（来自 Quaternius / Overte 两套成品动作）
 *   - gesture ：本项目原创关键帧（clips.mjs），用于没有成品素材的短手势
 *
 * 绑定为空表示该词走通用兜底，不影响其他词。
 */

export const BINDING_WORDS = [
  { id: 'idle', zh: '待机', note: '站立循环', loop: true, required: true },
  { id: 'walk', zh: '走路', note: '移动循环', loop: true },
  { id: 'run', zh: '跑', note: '快速移动', loop: true },
  { id: 'turn', zh: '转身', note: '方向切换' },
  { id: 'sit', zh: '坐下', note: '坐姿循环', loop: true },
  { id: 'dance', zh: '跳舞', note: '表演动作' },
  { id: 'think', zh: '思考', note: '一次完整' },
  { id: 'talk', zh: '说话', note: '交谈循环', loop: true },
  { id: 'wave', zh: '挥手', note: '打招呼' },
  { id: 'nod', zh: '点头', note: '同意' },
  { id: 'shake', zh: '摇头', note: '否定' },
  { id: 'bow', zh: '鞠躬', note: '致意' },
  { id: 'clap', zh: '拍手', note: '暂无素材', empty: true },
  { id: 'cheer', zh: '欢呼', note: '暂无素材', empty: true },
];

/**
 * 可选片段。asset.key 对应 motion-libraries.mjs 里的资源键；
 * gesture.key 对应 performance.playGesture / clips.mjs 的动作名。
 */
export const BINDING_SOURCES = [
  { id: 'q/idle', kind: 'asset', key: 'preview-idle', label: 'Quaternius · 自然站立', loop: true },
  { id: 'q/talking', kind: 'asset', key: 'preview-talking', label: 'Quaternius · 交谈手势', loop: true },
  { id: 'q/walk', kind: 'asset', key: 'preview-walk', label: 'Quaternius · 日常走路', loop: true },
  { id: 'q/walk-formal', kind: 'asset', key: 'preview-formal', label: 'Quaternius · 端正走路', loop: true },
  { id: 'q/jog', kind: 'asset', key: 'preview-jog', label: 'Quaternius · 慢跑', loop: true },
  { id: 'q/sprint', kind: 'asset', key: 'preview-sprint', label: 'Quaternius · 奔跑', loop: true },
  { id: 'q/dance', kind: 'asset', key: 'preview-dance', label: 'Quaternius · 轻松舞步', loop: true },
  { id: 'q/interact', kind: 'asset', key: 'preview-interact', label: 'Quaternius · 伸手互动' },
  { id: 'q/sit-enter', kind: 'asset', key: 'preview-sit-enter', label: 'Quaternius · 坐下' },
  { id: 'q/sit-idle', kind: 'asset', key: 'preview-sit-idle', label: 'Quaternius · 坐着休息', loop: true },
  { id: 'q/sit-exit', kind: 'asset', key: 'preview-sit-exit', label: 'Quaternius · 起身' },
  { id: 'o/idle', kind: 'asset', key: 'balanced', label: 'Overte · 自然站立', loop: true },
  { id: 'o/rest-left', kind: 'asset', key: 'rest-left', label: 'Overte · 松弛站立', loop: true },
  { id: 'o/rest-right', kind: 'asset', key: 'rest-right', label: 'Overte · 轻移重心', loop: true },
  { id: 'o/thinking', kind: 'asset', key: 'thinking', label: 'Overte · 环顾思考' },
  { id: 'o/turn-left', kind: 'asset', key: 'turn-left', label: 'Overte · 左转' },
  { id: 'o/turn-right', kind: 'asset', key: 'turn-right', label: 'Overte · 右转' },
  { id: 'o/walk-cycle', kind: 'asset', key: 'walk-cycle', label: 'Overte · 慢走步态', loop: true },
  { id: 'm/wave', kind: 'asset', key: 'wave', label: 'Mixamo · 挥手（动捕）' },
  { id: 'm/nod', kind: 'asset', key: 'nod', label: 'Mixamo · 点头（动捕）' },
  { id: 'm/shake', kind: 'asset', key: 'shake', label: 'Mixamo · 摇头（动捕）' },
  { id: 'm/bow', kind: 'asset', key: 'bow', label: 'Mixamo · 鞠躬（动捕）' },
  { id: 'm/clap', kind: 'asset', key: 'clap', label: 'Mixamo · 拍手（动捕）' },
  { id: 'g/wave', kind: 'gesture', key: 'wave', label: '原创关键帧 · 招手' },
  { id: 'g/nod', kind: 'gesture', key: 'nod', label: '原创关键帧 · 点头' },
  { id: 'g/shake', kind: 'gesture', key: 'shake', label: '原创关键帧 · 摇头' },
  { id: 'g/bow', kind: 'gesture', key: 'bow', label: '原创关键帧 · 鞠躬' },
  { id: 'g/idle', kind: 'gesture', key: 'idle', label: '原创关键帧 · 自然待机', loop: true },
];

export const DEFAULT_BINDINGS = Object.freeze({
  idle: 'o/idle',
  walk: 'q/walk',
  run: 'q/jog',
  turn: 'o/turn-left',
  sit: 'q/sit-enter',
  dance: 'q/dance',
  think: 'o/thinking',
  talk: 'q/talking',
  wave: 'm/wave',
  nod: 'm/nod',
  shake: 'm/shake',
  bow: 'm/bow',
  clap: 'm/clap',
  cheer: '',
});

const STORAGE_KEY = 'vrm-preview-bindings-v1';
const KNOWN = new Set([...BINDING_WORDS.map((w) => w.id), '']);
const KNOWN_SOURCE = new Set(BINDING_SOURCES.map((s) => s.id).concat(''));

/** 只接受已知词与已知来源，避免旧存档把界面打坏。 */
export function sanitizeBindings(raw) {
  const out = { ...DEFAULT_BINDINGS };
  if (!raw || typeof raw !== 'object') return out;
  for (const word of BINDING_WORDS) {
    const value = raw[word.id];
    if (typeof value !== 'string' || !KNOWN_SOURCE.has(value)) continue;
    out[word.id] = value;
  }
  return out;
}

export function loadBindings() {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    if (!text) return { ...DEFAULT_BINDINGS };
    return sanitizeBindings(JSON.parse(text));
  } catch {
    return { ...DEFAULT_BINDINGS };
  }
}

export function saveBindings(bindings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeBindings(bindings)));
}

export function resetBindings() {
  localStorage.removeItem(STORAGE_KEY);
  return { ...DEFAULT_BINDINGS };
}

export function sourceById(id) {
  return BINDING_SOURCES.find((source) => source.id === id) || null;
}

/** 导出的形状就是打包器要吃的形状。 */
export function exportBindings(bindings, model) {
  const words = {};
  for (const word of BINDING_WORDS) {
    const source = sourceById(bindings[word.id]);
    if (!source) continue;
    words[word.id] = {
      kind: source.kind,
      key: source.key,
      label: source.label,
      loop: word.loop === true || source.loop === true,
    };
  }
  return {
    format: 'coo-vrm-bindings',
    version: 1,
    model: model ? String(model) : '',
    generatedAt: new Date().toISOString(),
    words,
  };
}

export function bindingStats(bindings) {
  let bound = 0;
  for (const word of BINDING_WORDS) if (sourceById(bindings[word.id])) bound += 1;
  return { bound, total: BINDING_WORDS.length };
}
