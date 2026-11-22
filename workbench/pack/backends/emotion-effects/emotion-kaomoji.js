import {FIGURE_WOLF_KAOMOJI} from './wolf-kaomoji.js';

// Body poses from the approved kaomoji preview. Offsets are in em, then degrees and scale.
const MOODS = {
  joy: {face:'≧▽≦', light:'#9a4c15', dark:'#ffe6bf', duration:.74,
    poses:[[.21,0,-.27,-3,.96,1.09],[.46,0,.06,1,1.10,.91],[.67,0,-.13,2,.99,1.04],[.85,0,.016,0,1.02,.98]]},
  love: {face:'ᵔᵕᵔ', blush:'˶', light:'#a02f53', dark:'#ffe2eb', duration:1.08,
    poses:[[.25,-.02,.018,-4,1.01,1.01],[.47,.035,-.049,-2,1.055,1.065],[.72,.02,-.018,-1,1.023,1.025]]},
  anger: {face:'｀へ´', light:'#a52a38', dark:'#ffc5c8', duration:.68,
    poses:[[.19,-.07,.035,-3,.88,.91],[.32,.16,-.05,4,1.10,1.045],[.44,-.086,.01,-3,.97,1.02],[.56,.064,0,2,1.01,.98],[.70,-.026,0,-1,.99,1]]},
  sad: {face:'╥﹏╥', light:'#2e658d', dark:'#d4ebff', duration:1.21,
    poses:[[.20,-.03,.075,-3,.95,1.02],[.36,.022,.125,2,.95,1.04],[.51,-.015,.080,-2,.96,.98],[.77,0,.12,0,.98,1.03]]},
  fear: {face:'°△°;', light:'#6746a6', dark:'#e6dbff', duration:.96,
    poses:[[.15,-.22,.071,-8,.84,.85],[.34,-.15,.067,-5,.91,.91],[.58,-.138,.074,-4,.91,.92],[.80,-.046,.021,-1,.97,.97]]},
  calm: {face:'−‿−', light:'#287465', dark:'#d4f5e7', duration:1.45,
    poses:[[.34,0,-.043,0,1.035,1.07],[.61,0,-.018,0,1.02,1.037],[.84,0,.021,0,.99,.98]]},
};
const rest = [0,0,0,1,1];
const start = [0,...rest], end = [1,...rest];

function poseAt(mood, age) {
  const time = age / mood.duration;
  if (time >= 1) return rest;
  let before = start;
  for (const after of [...mood.poses,end]) {
    if (time <= after[0]) {
      const k = (time - before[0]) / (after[0] - before[0]);
      const ease = k * k * (3 - 2 * k);
      return before.slice(1).map((value,i) => value + (after[i+1] - value) * ease);
    }
    before = after;
  }
}

function fitAnchor(root, left, right, y, radii, side) {
  const matrix = root.getScreenCTM?.();
  const stage = root.ownerSVGElement?.getBoundingClientRect();
  const doc = root.ownerDocument.documentElement;
  const x = side === 'left' ? left : right;
  if (!matrix || !stage || !stage.width || !stage.height) return {x,y,zoom:1,side};
  const {a,b,c,d,e,f} = matrix;
  const det = a*d-b*c;
  if (Math.abs(det) < 1e-5) return {x,y,zoom:1,side};
  const minX = Math.max(0, stage.left) + 5;
  const minY = Math.max(0, stage.top) + 5;
  const maxX = Math.min(doc.clientWidth || stage.right, stage.right) - 5;
  const maxY = Math.min(doc.clientHeight || stage.bottom, stage.bottom) - 5;
  if (maxX <= minX || maxY <= minY) return {x,y,zoom:1,side};
  const radiusX = Math.abs(a)*radii.x + Math.abs(c)*radii.y;
  const radiusY = Math.abs(b)*radii.x + Math.abs(d)*radii.y;
  const zoom = Math.min(1,(maxX-minX)/(radiusX*2),(maxY-minY)/(radiusY*2));
  const padX = radiusX*zoom, padY = radiusY*zoom;
  const project = x => ({x:a*x+c*y+e,y:b*x+d*y+f});
  const fits = point => point.x >= minX+padX && point.x <= maxX-padX;
  let point = project(x), spot = x;
  const other = side === 'left' ? right : left;
  const alternate = project(other);
  if (!fits(point) && fits(alternate)) {
    side = side === 'left' ? 'right' : 'left';
    point = alternate;
    spot = other;
  }
  const dx = Math.max(minX+padX,Math.min(maxX-padX,point.x))-point.x;
  const dy = Math.max(minY+padY,Math.min(maxY-padY,point.y))-point.y;
  return {x:spot+(d*dx-c*dy)/det,y:y+(a*dy-b*dx)/det,zoom,side};
}

export function createKaomojiPainter(make, root, placement, scale = 1) {
  const anchor = make('g', {}, root);
  const text = make('text', {'font-weight':'500', 'text-anchor':'middle', 'dominant-baseline':'central',
    'font-family':'"Segoe UI", "Yu Gothic UI", "Microsoft YaHei UI", "Segoe UI Symbol", sans-serif',
    'style':'white-space:pre', 'paint-order':'stroke', 'stroke-linejoin':'round'}, anchor);
  const open = make('tspan',{},text);
  const cheekL = make('tspan',{},text), face = make('tspan',{},text), cheekR = make('tspan',{},text);
  const close = make('tspan',{},text);
  open.textContent = '(';
  close.textContent = ')';
  let lastMood, lastTheme, lastWord, lastSize, glyph, side = 'left';
  return (id, age, theme, reduced, word, facing) => {
    const mood = MOODS[id];
    let {left,right,top,height} = placement();
    if (facing < 0) [left,right] = [256-right,256-left];
    const size = Math.round(.55 * Math.max(30, Math.min(56, height*.26)) * scale * 4) / 4;
    const exact = Object.hasOwn(FIGURE_WOLF_KAOMOJI, word) ? FIGURE_WOLF_KAOMOJI[word] : '';
    const textChanged = id !== lastMood || word !== lastWord;
    if (id !== lastMood || theme !== lastTheme || word !== lastWord) {
      const dark = theme === 'dark';
      const quiet = dark ? '#d1c5d6' : '#6b6471';
      const blush = dark ? '#ff9ba9' : '#bd4567';
      const pink = exact ? '' : mood.blush ?? '';
      open.setAttribute('fill', quiet);
      close.setAttribute('fill', quiet);
      cheekL.setAttribute('fill', blush);
      cheekR.setAttribute('fill', blush);
      cheekL.textContent = cheekR.textContent = pink;
      open.textContent = exact ? '' : '(';
      close.textContent = exact ? '' : ')';
      face.textContent = exact || mood.face;
      face.setAttribute('fill', dark ? mood.dark : mood.light);
      text.setAttribute('stroke', dark ? '#251f30' : '#fff9fc');
      lastMood = id;
      lastTheme = theme;
      lastWord = word;
    }
    if (lastSize !== size) {
      text.setAttribute('font-size',String(size));
      text.setAttribute('stroke-width',String(size*.052));
    }
    if (textChanged || lastSize !== size) {
      lastSize = size;
      const box = text.getBBox?.();
      const x = box?.width ? Math.max(-box.x,box.x+box.width) : size*text.textContent.length*.32;
      const y = box?.height ? Math.max(-box.y,box.y+box.height) : size*.62;
      // Include the stroke and the largest offset, rotation and stretch of the poses.
      glyph = {x:(x+y*.14)*1.12+size*.24,y:(y+x*.14)*1.12+size*.29};
    }
    const gap = Math.max(6,height*.04) + glyph.x;
    const point = fitAnchor(root,left-gap,right+gap,top+Math.max(size*.48,height*.10),glyph,side);
    side = point.side;
    const translate = `translate(${point.x.toFixed(2)} ${point.y.toFixed(2)}) scale(${point.zoom.toFixed(4)})`;
    if (anchor.getAttribute('transform') !== translate) anchor.setAttribute('transform',translate);
    const [dx,dy,rotate,sx,sy] = reduced ? rest : poseAt(mood,age);
    const wordScale = word === 'wink' ? .8 : 1;
    const transform = `translate(${size*dx} ${size*dy}) rotate(${rotate}) scale(${sx*wordScale} ${sy*wordScale})`;
    if (text.getAttribute('transform') !== transform) text.setAttribute('transform',transform);
  };
}
