export const GEAR_THEMES = [
  {id:'purple',name:'紫色',en:'Purple',color:'#9654ff',fill:'linear-gradient(105deg,#343bdc 0%,#7957f5 36%,#bd75ff 65%,#8c52ff 100%)',glow:'#ece0ff90'},
  {id:'red',name:'红色',en:'Red',color:'#d63c43',fill:'linear-gradient(105deg,#b91c3c 0%,#e83e50 36%,#ff7c66 65%,#e53e3e 100%)',glow:'#ffe3df90'},
  {id:'amber',name:'琥珀金',en:'Amber',color:'#a9660c',fill:'linear-gradient(105deg,#b96510 0%,#f59e0b 36%,#ffd76a 65%,#e98c18 100%)',glow:'#fff4c990'},
  {id:'blue',name:'蓝色',en:'Blue',color:'#2767d9',fill:'linear-gradient(105deg,#1645bc 0%,#397ff5 36%,#79bdff 65%,#2775e8 100%)',glow:'#dceeff90'},
  {id:'cyan',name:'青色',en:'Cyan',color:'#087f91',fill:'linear-gradient(105deg,#086b88 0%,#0da8b5 36%,#73e5dc 65%,#099caf 100%)',glow:'#d9fffa90'},
  {id:'green',name:'绿色',en:'Green',color:'#23834b',fill:'linear-gradient(105deg,#166941 0%,#2ba869 36%,#8cdb95 65%,#269851 100%)',glow:'#e1ffe590'},
];
export const GEAR_PARTICLES = [
  {id:'stars',name:'星点',en:'Stars',icon:'✦'},
  {id:'glow',name:'浮光',en:'Glow',icon:'●'},
  {id:'meteors',name:'流星',en:'Meteors',icon:'╱'},
  {id:'hearts',name:'爱心',en:'Hearts',icon:'♥'},
  {id:'bubbles',name:'气泡',en:'Bubbles',icon:'○'},
  {id:'ripples',name:'光波',en:'Ripples',icon:'◎'},
];
export const normalizeGearTheme = value => GEAR_THEMES.some(t=>t.id===value)?value:'red';
export const normalizeGearParticles = value => GEAR_PARTICLES.some(p=>p.id===value)?value:'stars';

export const UI_MATERIALS = [
  {id:'matte',name:'哑光',en:'Matte',icon:'◼'},
  {id:'glass',name:'磨砂玻璃',en:'Glass',icon:'◈'},
  {id:'silk',name:'柔光',en:'Silk',icon:'◒'},
  {id:'metal',name:'拉丝金属',en:'Metal',icon:'▤'},
];
export const UI_MODES = [{id:'auto',name:'跟随 Coo',en:'Follow Coo',icon:'◐'},{id:'light',name:'浅色',en:'Light',icon:'☼'},{id:'dark',name:'深色',en:'Dark',icon:'☾'}];
export const UI_CORNERS = [{id:'standard',name:'标准',en:'Standard',icon:'▢'},{id:'soft',name:'柔和',en:'Soft',icon:'●'},{id:'crisp',name:'利落',en:'Crisp',icon:'▪'}];
export const UI_GLOWS = [{id:'off',name:'关闭',en:'Off',icon:'○'},{id:'subtle',name:'轻柔',en:'Subtle',icon:'◉'},{id:'vivid',name:'鲜明',en:'Vivid',icon:'✺'}];
export const UI_STYLES = [{id:'classic',name:'默认',en:'Default',icon:'◻'},{id:'custom',name:'自定义',en:'Custom',icon:'✧'}];
export const UI_BUTTON_FILLS = [{id:'solid',name:'纯色',en:'Solid',icon:'■'},{id:'gradient',name:'渐变',en:'Gradient',icon:'◩'}];
export function normalizeAppearance(cfg = {}) {
  const choice=(list,value,fallback)=>list.some(item=>item.id===value)?value:fallback;
  return {gearTheme:normalizeGearTheme(cfg.gearTheme),particleEffect:normalizeGearParticles(cfg.particleEffect),
    uiMaterial:choice(UI_MATERIALS,cfg.uiMaterial,'matte'),uiMode:choice(UI_MODES,cfg.uiMode,'auto'),
    uiCorners:choice(UI_CORNERS,cfg.uiCorners,'standard'),uiGlow:choice(UI_GLOWS,cfg.uiGlow,'subtle'),uiStyle:choice(UI_STYLES,cfg.uiStyle,'custom'),uiButtonFill:choice(UI_BUTTON_FILLS,cfg.uiButtonFill,'gradient')};
}
