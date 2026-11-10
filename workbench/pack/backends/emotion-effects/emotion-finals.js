import {createKaomojiPainter} from './emotion-kaomoji.js';
import {createOrbPainter} from './emotion-orb.js';
import {createParticlePainter} from './emotion-particles.js';

// The kit owns expression lifetimes and the original hearts, tears, notes and dust.
const MOODS = new Map(Object.entries({
  happy:'joy', excited:'joy',
  love:'love', shy:'love',
  angry:'anger',
  sad:'sad', cry:'sad',
  scared:'fear', surprised:'fear', worried:'fear', flustered:'fear',
  content:'calm', sleep:'calm', sleepy:'calm', listening:'calm', thinking:'calm',
}));
const ORB_MOODS = new Set(['love','anger','sad']);
const STILL = {joy:.68, love:1.05, anger:1.13, sad:2.27, fear:.81, calm:1.2};
const STRENGTH = {restrained:.64, natural:.9, dramatic:1};
const clamp = (n, low=0, high=1) => Math.max(low, Math.min(high, n));
const smooth = n => { const x=clamp(n); return x*x*(3-2*x); };

function canvasLayer(make, root, {left,top,width,height}) {
  const wrapper = make('foreignObject', {x:left,y:top,width,height}, root);
  const canvas = root.ownerDocument.createElement('canvas');
  canvas.width = Math.min(640, Math.ceil(width*1.6));
  canvas.height = Math.min(640, Math.ceil(height*1.6));
  canvas.style.cssText = 'display:block;width:100%;height:100%;pointer-events:none';
  wrapper.append(canvas);
  const ctx = canvas.getContext('2d');
  const sx = canvas.width / width, sy = canvas.height / height;
  return {
    clear() {
      ctx.setTransform(1,0,0,1,0,0);
      ctx.globalAlpha = 1;
      ctx.clearRect(0,0,canvas.width,canvas.height);
      ctx.setTransform(sx,0,0,sy,-left*sx,-top*sy);
      return ctx;
    },
    release() { canvas.width=canvas.height=1; },
  };
}

function makePainter(make, root, back, box, style, tier) {
  const {left,top,width,height} = box;
  const right = left + width;
  const doc = root.ownerDocument;
  if (style === 'kaomoji') {
    return {paint:createKaomojiPainter(make,root,box)};
  }
  if (style === 'orb') {
    const radius = clamp(height*.31,23,70);
    const anchor = {x:right+radius*1.18+8,y:top+height*.23,radius};
    const front = canvasLayer(make,root,{left:anchor.x-radius*1.8,top:anchor.y-radius*1.62,
      width:radius*3.6,height:radius*3.32});
    const draw = createOrbPainter(doc,tier);
    return {
      paint(mood,time,theme) { draw(front.clear(),mood,time,anchor,theme); },
      release:front.release,
    };
  }
  const particles = createParticlePainter(doc,tier);
  if (style === 'bubbles') {
    const front = canvasLayer(make,root,{left:right-14,top:top-height*.14-14,
      width:height*.28+42,height:height*.45+28});
    return {
      paint(mood,time,theme) { particles.setTheme(theme); particles.paintBubbles(front.clear(),box,mood,time); },
      release:front.release,
    };
  }
  const pad = Math.max(width*.44,height*.61)+16;
  const area = {left:left-pad,top:top-height*.12-8,width:width+pad*2,height:height*1.39+16};
  const front = canvasLayer(make,root,area), rear = canvasLayer(make,back,area);
  return {
    paint(mood,time,theme) { particles.setTheme(theme); particles.paintFlow(rear.clear(),front.clear(),box,mood,time); },
    release() { front.release(); rear.release(); },
  };
}

export function createFinalEmotionEffects({make,parent,art,model,media}, style) {
  if (model.effectsEnabled === false || model.emotionIntensity === 'off') {
    return {draw(){}, trigger(){}, dispose(){}};
  }
  const [left,top,right,bottom] = model.visible;
  const box = {left,top,width:right-left,height:bottom-top};
  const tier = Object.hasOwn(STRENGTH,model.emotionIntensity) ? model.emotionIntensity : 'natural';
  const root = make('g', {class:'ifg-final-effects','data-style':style,'data-tier':tier,
    'pointer-events':'none',display:'none'}, parent);
  const back = style === 'flow' ? make('g', {class:'ifg-final-back','pointer-events':'none',display:'none'}, parent) : null;
  if (back) parent.insertBefore(back,art);
  const painter = makePainter(make,root,back,box,style,tier);
  const layers = back ? [root,back] : [root];
  const set = (key,value) => {
    const text = String(value);
    for (const layer of layers) if (layer.getAttribute(key) !== text) layer.setAttribute(key,text);
  };
  const cooldown = model.effectProfiles?.[tier]?.cooldown ?? 1.2;
  let theme = parent.ownerDocument.documentElement.dataset.theme || 'light';
  let reduced = !!media?.matches;
  let pending, cueUntil = -Infinity, active, leaving;
  let opacity = 0, lastPaint = -Infinity, facing;

  function draw(frame) {
    const {face,t} = frame;
    if (pending === 'heard' || pending === 'bounce') cueUntil = t+1.15;
    if (pending === 'neutral') cueUntil = -Infinity;
    let mood = frame.mode === 'dance' ? 'joy' : MOODS.get(face);
    if (!mood && face === 'neutral' && t < cueUntil) mood = 'joy';
    if (style === 'orb' && !ORB_MOODS.has(mood)) mood = undefined;
    const repeat = active && pending === face && t-active.since >= cooldown;
    pending = undefined;

    // Counter the kit mirror so every corner effect keeps its screen side and orientation.
    const nextFacing = frame.facing < 0 ? -1 : 1;
    if (style !== 'flow' && nextFacing !== facing) {
      root.setAttribute('transform', nextFacing < 0 ? 'translate(256 0) scale(-1 1)' : '');
      facing = nextFacing;
    }

    if (!mood) {
      if (!active) return;
      leaving ??= {at:t,opacity};
      opacity = reduced ? 0 : leaving.opacity*(1-smooth((t-leaving.at)/.22));
      if (opacity < .003) {
        set('display','none');
        active = undefined;
        leaving = undefined;
      } else set('opacity',opacity);
      return;
    }

    if (!active || active.face !== face || active.mood !== mood || repeat || leaving) {
      active = {face,mood,since:t};
      leaving = undefined;
      lastPaint = -Infinity;
      root.setAttribute('data-mood',mood);
      root.setAttribute('data-face',face);
      set('display','inline');
    }
    const age = Math.max(0,t-active.since);
    opacity = STRENGTH[tier]*(reduced ? 1 : smooth(age/.14));
    set('opacity',opacity);
    // The figure clock drives all styles. Canvas draws at up to 30 Hz, without an extra loop.
    const interval = style === 'kaomoji' ? 0 : 1/30;
    if (lastPaint !== -Infinity && (reduced || t >= lastPaint && t-lastPaint+1e-6 < interval)) return;
    painter.paint(mood,reduced ? STILL[mood] : age,theme,reduced);
    root.setAttribute('data-reduced',String(reduced));
    lastPaint = t;
  }

  const preference = event => { reduced = !!event.matches; lastPaint = -Infinity; };
  media?.addEventListener?.('change',preference);
  return {
    draw,
    trigger(word) { pending = word; },
    setTheme(value) {
      if (value === theme || (value !== 'dark' && value !== 'light')) return;
      theme = value;
      lastPaint = -Infinity;
    },
    dispose() {
      media?.removeEventListener?.('change',preference);
      painter.release?.();
      root.remove();
      back?.remove();
    },
  };
}
