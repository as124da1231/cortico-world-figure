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

export function createKaomojiPainter(make, root, {left, top, height}) {
  const size = .55 * Math.max(30, Math.min(56, height * .26));
  const x = left - Math.max(10, height * .06);
  const y = top + Math.max(size * .48, height * .10);
  const anchor = make('g', {transform:`translate(${x} ${y})`}, root);
  const text = make('text', {'font-size':size, 'font-weight':'500', 'text-anchor':'end', 'dominant-baseline':'central',
    'font-family':'"Segoe UI", "Yu Gothic UI", "Microsoft YaHei UI", "Segoe UI Symbol", sans-serif',
    'paint-order':'stroke', 'stroke-linejoin':'round', 'stroke-width':size * .052}, anchor);
  const open = make('tspan',{},text);
  const cheekL = make('tspan',{},text), face = make('tspan',{},text), cheekR = make('tspan',{},text);
  const close = make('tspan',{},text);
  open.textContent = '(';
  close.textContent = ')';
  let lastMood, lastTheme;
  return (id, age, theme, reduced) => {
    const mood = MOODS[id];
    if (id !== lastMood || theme !== lastTheme) {
      const dark = theme === 'dark';
      const quiet = dark ? '#d1c5d6' : '#6b6471';
      const blush = dark ? '#ff9ba9' : '#bd4567';
      const pink = mood.blush ?? '';
      open.setAttribute('fill', quiet);
      close.setAttribute('fill', quiet);
      cheekL.setAttribute('fill', blush);
      cheekR.setAttribute('fill', blush);
      cheekL.textContent = cheekR.textContent = pink;
      face.textContent = mood.face;
      face.setAttribute('fill', dark ? mood.dark : mood.light);
      text.setAttribute('stroke', dark ? '#251f30' : '#fff9fc');
      lastMood = id;
      lastTheme = theme;
    }
    const [dx,dy,rotate,sx,sy] = reduced ? rest : poseAt(mood,age);
    const transform = `translate(${size*dx} ${size*dy}) rotate(${rotate}) scale(${sx} ${sy})`;
    if (text.getAttribute('transform') !== transform) text.setAttribute('transform',transform);
  };
}
