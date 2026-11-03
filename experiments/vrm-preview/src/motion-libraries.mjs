export const overteAssets = {
  balanced: '/animations/idle.vrma', 'rest-left': '/animations/idle-2.vrma', 'rest-right': '/animations/idle-3.vrma',
  talking: '/animations/idle-talking.vrma', thinking: '/animations/think.vrma',
  'walk-cycle': '/animations/world-walk-slow.vrma', 'walk-start': '/animations/world-walk-start.vrma', 'walk-stop': '/animations/world-walk-stop-small.vrma',
  'turn-left': '/animations/world-turn-left.vrma', 'turn-right': '/animations/world-turn-right.vrma',
};
const quaternius = name => `/animations/quaternius/${name}.vrma`;
export const libraryPreviews = [
  { id: 'preview-idle', name: '自然站立', note: '舒展的站姿', file: 'idle', loop: true, feet: false },
  { id: 'preview-talking', name: '交谈手势', note: '手臂与身体配合', file: 'talking', loop: true, feet: false },
  { id: 'preview-walk', name: '日常走路', note: '原地看完整步态', file: 'walk', loop: true, feet: true },
  { id: 'preview-formal', name: '端正走路', note: '较收敛的上身', file: 'walk-formal', loop: true, feet: true },
  { id: 'preview-jog', name: '慢跑', note: '原地预览', file: 'jog', loop: true, feet: true },
  { id: 'preview-sprint', name: '奔跑', note: '原地预览', file: 'sprint', loop: true, feet: true },
  { id: 'preview-dance', name: '轻松舞步', note: '原地预览', file: 'dance', loop: true, feet: true },
  { id: 'preview-interact', name: '伸手互动', note: '一次完整动作', file: 'interact', loop: false, feet: false },
  { id: 'preview-sit-enter', name: '坐下', note: '坐姿动作预览', file: 'sit-enter', loop: false, feet: true },
  { id: 'preview-sit-idle', name: '坐着休息', note: '坐姿循环，无座椅场景', file: 'sit-idle', loop: true, feet: true },
  { id: 'preview-sit-talking', name: '坐着交谈', note: '坐姿循环，无座椅场景', file: 'sit-talking', loop: true, feet: true },
  { id: 'preview-sit-exit', name: '起身', note: '从坐姿站起', file: 'sit-exit', loop: false, feet: true },
];
export const motionLibraries = [
  { id: 'quaternius', name: 'Quaternius · 通用', source: 'Quaternius Standard / CC0',
    note: '成品站姿、交谈与步态；起停和转身共用 Overte。',
    assets: { ...overteAssets, balanced: quaternius('idle'), 'rest-left': quaternius('idle'), 'rest-right': quaternius('idle'), talking: quaternius('talking'), 'walk-cycle': quaternius('walk'), ...Object.fromEntries(libraryPreviews.map(entry => [entry.id, quaternius(entry.file)])) } },
  { id: 'overte', name: 'Overte · 柔和', source: 'Overte / Hanami VRMA', note: '保留上一轮的慢走、重心变化和交谈。', assets: overteAssets },
];
export const animationRoutes = [...new Set(motionLibraries.flatMap(library => Object.values(library.assets)))];
export const overtePreviews = [
  { id: 'balanced', name: '自然站立', note: '基础待机', loop: true, feet: false },
  { id: 'rest-left', name: '松弛站立', note: '轻微重心变化', loop: true, feet: false },
  { id: 'rest-right', name: '轻移重心', note: '另一种站姿', loop: true, feet: false },
  { id: 'talking', name: '交谈手势', note: '成品身体动画', loop: true, feet: false },
  { id: 'thinking', name: '环顾思考', note: '一次完整动作', loop: false, feet: false },
  { id: 'walk-cycle', name: '慢走步态', note: '原地预览', loop: true, feet: true },
];
export const previewsFor = id => id === 'quaternius' ? libraryPreviews : overtePreviews;

export function rootTravelAt(curve, time) {
  const duration = curve.times.at(-1);
  if (!(duration > 0)) return 0;
  const cycles = Math.floor(Math.max(0, time) / duration), phase = Math.max(0, time) - cycles * duration;
  let i = 0; while (i + 1 < curve.times.length - 1 && curve.times[i + 1] < phase) i++;
  const span = curve.times[i + 1] - curve.times[i], t = span > 0 ? (phase - curve.times[i]) / span : 0;
  return cycles * curve.distance + curve.distances[i] * (1 - t) + curve.distances[i + 1] * t;
}
