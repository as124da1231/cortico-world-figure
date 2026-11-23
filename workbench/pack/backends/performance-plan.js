export const PERFORMANCE_ASSET = 'figure-performance.json';
export const SAVED_ACTION_PREFIX = 'figure-act-';
export const SAVED_ACTION_LIMIT = 24;
export const PERFORMANCE_MOVE = 'figure-performance';
export const PERFORMANCE_TARGET = {
  id: PERFORMANCE_MOVE,
  name: { zh: '执行 Figure 表演', en: 'Perform staged Figure action' },
  about: { zh: '执行 Figure 工具暂存的动作，返回实际播放结果。', en: 'Play a staged Figure action and return its result.' },
  params: [{ id: 'ticket', min: 1, max: 2147483647, about: { zh: 'Figure 返回的动作编号', en: 'The ticket returned by Figure' } }],
};

export const PERFORMANCE_MODES = ['vocab', 'direct', 'dual'];
export const PERFORMANCE_FACES = ['neutral','happy','wink','love','shy','surprised','angry','sad','sleepy','thinking','smug','pout','worried','determined','flustered','scared','excited','cry','confused'];
export const PROTECTED_PARAMETER = /mouthopen|lip.?sync|watermark|opacity|visibility|outfit|costume|cloth|dress|skirt|accessor|水印|换装|衣服|服装|透明|显隐|配饰/i;
export const performanceMode = value => PERFORMANCE_MODES.includes(value) ? value : 'vocab';
const valuesIn = (values, min, max, limit) => values && typeof values === 'object' && !Array.isArray(values)
  && Object.keys(values).length <= limit && Object.entries(values).every(([id,value]) => /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(id)
    && !['constructor','prototype'].includes(id) && Number.isFinite(value) && value >= min && value <= max);

export function parsePerformanceCues(input) {
  if (!Array.isArray(input) || !input.length || input.length > 8) throw Error('表演需要 1 至 8 个节拍');
  let previous = -1;
  return input.map(cue => {
    if (!cue || typeof cue !== 'object' || Array.isArray(cue)
      || Object.keys(cue).some(key => !['at','duration','face','resource','pose','intensity','facs','actionUnits','vad'].includes(key))) throw Error('表演节拍格式无效');
    const { at, duration, face, resource, pose, intensity, facs, actionUnits, vad } = cue;
    if (!Number.isFinite(at) || at < 0 || at < previous || !Number.isFinite(duration) || duration < .1 || at + duration > 18) {
      throw Error('表演节拍须按时间排序，单段至少 0.1 秒，总时长不超过 18 秒');
    }
    previous = at;
    if (face !== undefined && !PERFORMANCE_FACES.includes(face)) throw Error('情绪无效');
    if (resource !== undefined && (typeof resource !== 'string' || !/^[\w-]{1,120}$/.test(resource))) throw Error('原生资源编号无效');
    if (pose !== undefined && (!pose || typeof pose !== 'object' || Array.isArray(pose)
      || !Object.keys(pose).length || Object.keys(pose).length > 12
      || Object.entries(pose).some(([id, value]) => !id || id.length > 160 || ['__proto__','constructor','prototype'].includes(id)
        || PROTECTED_PARAMETER.test(id) || !Number.isFinite(value) || value < -1 || value > 1))) throw Error('每段姿态最多 12 个可控参数，值须在 -1 至 1');
    if (intensity !== undefined && (!Number.isFinite(intensity) || intensity < 0 || intensity > 1)) throw Error('表演强度须在 0 至 1');
    if ((facs !== undefined && !valuesIn(facs,-1,1,24)) || (actionUnits !== undefined && !valuesIn(actionUnits,0,1,24))
      || (vad !== undefined && (!valuesIn(vad,-1,1,3) || Object.keys(vad).some(key => !['valence','arousal','dominance'].includes(key))))) throw Error('SoulLink 表情参数无效');
    if (!face && !resource && !pose && !facs && !actionUnits && !vad) throw Error('表演节拍缺少内容');
    return { at, duration, face, resource, pose, intensity, facs, actionUnits, vad };
  });
}
