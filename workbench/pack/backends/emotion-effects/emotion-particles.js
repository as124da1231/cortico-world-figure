// Independent painters for the approved particle ribbons and rising bubbles.
const DENSITY = {restrained:100, natural:162, dramatic:220};

export function createParticlePainter(doc, tier) {
  const grainCount = DENSITY[tier];
  const bubbleCount = tier === 'restrained' ? 3 : 4;
  const tau = Math.PI * 2;
  const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
  const fraction = value => value - Math.floor(value);
  const mix = (a,b,f) => a.map((v,i) => Math.round(v + (b[i] - v) * f));
  const color = (rgb,a = 1) => `rgba(${rgb.join(',')},${clamp(a)})`;

  const emotions = {
    joy:{main:'bubble', fine:'spark',
      palette:[[245,166,68],[255,211,122],[255,157,124]], speed:.23, turns:1.95, width:1.05, grain:1},
    love:{main:'petal', fine:'pearl',
      palette:[[228,86,149],[252,154,186],[190,126,241]], speed:.15, turns:1.53, width:1.27, grain:1.05},
    anger:{main:'ember', fine:'spark',
      palette:[[247,72,33],[255,128,37],[255,214,132]], speed:.43, turns:2.55, width:1.36, grain:1.24},
    sad:{main:'drop', fine:'mist',
      palette:[[82,151,214],[139,200,228],[121,140,196]], speed:-.17, turns:1.45, width:.97, grain:1.15},
    fear:{main:'shard', fine:'needle',
      palette:[[142,109,242],[178,172,255],[97,184,237]], speed:-.29, turns:2.3, width:.68, grain:.95},
    calm:{main:'pearl', fine:'mist',
      palette:[[87,182,169],[161,230,198],[89,169,205]], speed:.095, turns:1.42, width:1.22, grain:.85}
  };
  const stamps = new Map();
  let theme;
  function setTheme(scheme) {
    if (theme?.scheme === scheme) return;
    const light = scheme !== 'dark';
    theme = {scheme, glow:light ? [247,244,251] : [255,254,255]};
    stamps.clear();
  }

  function glow(ctx,x,y,r,rgb,alpha) {
    if (r < .1 || alpha <= 0) return;
    const shade = ctx.createRadialGradient(x,y,0,x,y,r);
    shade.addColorStop(0,color(rgb,alpha));
    shade.addColorStop(.38,color(rgb,alpha*.38));
    shade.addColorStop(1,color(rgb,0));
    ctx.fillStyle = shade;
    ctx.fillRect(x-r,y-r,r*2,r*2);
  }
  function ellipse(ctx,x,y,rx,ry,fill,stroke,width = 1) {
    ctx.beginPath();
    ctx.ellipse(x,y,rx,ry,0,0,tau);
    if (fill) {ctx.fillStyle = fill;ctx.fill();}
    if (stroke) {ctx.strokeStyle = stroke;ctx.lineWidth = width;ctx.stroke();}
  }
  function mark(type,rgb) {
    const key = type + rgb.join(',');
    if (stamps.has(key)) return stamps.get(key);
    const c = doc.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const bright = mix(rgb,theme.glow,.73);
    ctx.translate(32,32);
    glow(ctx,0,0,type==='mist'?28:23,rgb,type==='mist'?.43:.19);
    if (type==='bubble' || type==='pearl') {
      const radius = type==='bubble'?16:12;
      const gradient = ctx.createRadialGradient(-5,-6,0,0,0,radius);
      gradient.addColorStop(0,color(bright,type==='pearl'?.94:.22));
      gradient.addColorStop(.65,color(rgb,type==='pearl'?.8:.09));
      gradient.addColorStop(1,color(rgb,.55));
      ellipse(ctx,0,0,radius,radius,gradient,color(bright,.72),1.4);
      ctx.beginPath();ctx.arc(0,0,radius-2,3.62,4.89);ctx.strokeStyle=color(bright,.85);ctx.lineWidth=2.3;ctx.stroke();
    } else if (type==='petal') {
      const gradient=ctx.createLinearGradient(-18,-8,16,8);
      gradient.addColorStop(0,color(bright,.9));gradient.addColorStop(.6,color(rgb,.86));gradient.addColorStop(1,color(rgb,.26));
      ctx.beginPath();ctx.moveTo(-19,5);ctx.bezierCurveTo(-7,-19,13,-15,19,-6);ctx.bezierCurveTo(12,8,-1,12,-19,5);
      ctx.fillStyle=gradient;ctx.fill();
      ctx.beginPath();ctx.moveTo(-12,3);ctx.quadraticCurveTo(2,-3,13,-7);ctx.strokeStyle=color(bright,.54);ctx.lineWidth=1;ctx.stroke();
    } else if (type==='drop') {
      const gradient=ctx.createLinearGradient(-18,-8,14,7);
      gradient.addColorStop(0,color(rgb,.12));gradient.addColorStop(.77,color(rgb,.65));gradient.addColorStop(1,color(bright,.82));
      ctx.beginPath();ctx.moveTo(-19,0);ctx.bezierCurveTo(-3,-5,2,-10,12,-7);ctx.bezierCurveTo(26,-1,15,12,7,8);ctx.quadraticCurveTo(-4,6,-19,0);
      ctx.fillStyle=gradient;ctx.fill();ctx.strokeStyle=color(bright,.48);ctx.lineWidth=1.15;ctx.stroke();
      ellipse(ctx,11,-3,4,1.3,color(bright,.94));
    } else if (type==='ember' || type==='shard' || type==='needle') {
      const thick=type==='needle'?2.1:type==='shard'?5.6:4.4;
      const gradient=ctx.createLinearGradient(-22,0,17,0);
      gradient.addColorStop(0,color(rgb,0));gradient.addColorStop(.48,color(rgb,.74));gradient.addColorStop(1,color(bright,.96));
      ctx.beginPath();ctx.moveTo(-23,1);ctx.lineTo(6,-thick);ctx.lineTo(18,-.8);ctx.lineTo(9,thick*.54);ctx.closePath();
      ctx.fillStyle=gradient;ctx.fill();
      ctx.beginPath();ctx.moveTo(2,-thick*.27);ctx.lineTo(16,-.8);ctx.strokeStyle=color(bright,.88);ctx.lineWidth=1.6;ctx.stroke();
    } else if (type==='spark') {
      ellipse(ctx,0,0,5.8,5.8,color(bright,.96));
      ctx.beginPath();ctx.moveTo(-11,0);ctx.lineTo(11,0);ctx.moveTo(0,-8);ctx.lineTo(0,8);
      ctx.strokeStyle=color(rgb,.75);ctx.lineWidth=1.1;ctx.stroke();
    } else {
      glow(ctx,0,0,13,bright,.52);
    }
    stamps.set(key,c);
    return c;
  }
  function particle(ctx,type,rgb,x,y,r,angle,opacity) {
    if (opacity < .018) return;
    ctx.save();ctx.translate(x,y);ctx.rotate(angle);
    ctx.globalAlpha=clamp(opacity);
    ctx.drawImage(mark(type,rgb),-r*2,-r*2,r*4,r*4);
    ctx.restore();
  }
  function randomSource(seed) {
    return () => {
      seed = (Math.imul(seed,1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
  }
  const rand = randomSource(701123);
  const grains = Array.from({length:220},(_,i) => ({
    az:i*2.3999632297, phase:rand(), size:rand(), radius:.74+.27*rand(),
    color:i%3, main:i%5<2, lane:i%2
  }));

  function trace(ctx,points,stroke,width) {
    if (points.length<2) return;
    ctx.beginPath();ctx.moveTo(points[0].x,points[0].y);
    for (const point of points.slice(1)) ctx.lineTo(point.x,point.y);
    ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.lineJoin='round';ctx.lineCap='round';ctx.stroke();
  }
  function spans(points,front) {
    const parts=[];
    let part=[];
    for (const point of points) {
      if ((point.z>=0)===front&&point.visible!==false) part.push(point);
      else if (part.length) {parts.push(part);part=[];}
    }
    if (part.length) parts.push(part);
    return parts;
  }

  function cloth(ctx,points,palette,front,scale) {
    for (const part of spans(points,front)) {
      if (part.length<2) continue;
      const first=part[0],last=part.at(-1);
      const gradient=ctx.createLinearGradient(first.x,first.y,last.x,last.y);
      gradient.addColorStop(0,color(palette[0],front?.29:.12));
      gradient.addColorStop(.53,color(palette[1],front?.50:.25));
      gradient.addColorStop(1,color(palette[2],front?.32:.14));
      const edges=part.map((a,i)=>{
        const b=part[Math.max(0,i-1)],c=part[Math.min(part.length-1,i+1)];
        const dx=c.x-b.x,dy=c.y-b.y,mag=Math.hypot(dx,dy)||1;
        const span=Math.min(1,(i+.5)/6,(part.length-.5-i)/6);
        const width=a.width*Math.sqrt(span);
        return {a,nx:-dy/mag*width,ny:dx/mag*width};
      });
      ctx.beginPath();
      edges.forEach(({a,nx,ny},i)=>{if(i)ctx.lineTo(a.x+nx,a.y+ny);else ctx.moveTo(a.x+nx,a.y+ny);});
      for(let i=edges.length-1;i>=0;i--){const {a,nx,ny}=edges[i];ctx.lineTo(a.x-nx,a.y-ny);}
      ctx.closePath();ctx.fillStyle=gradient;ctx.fill();
      trace(ctx,edges.map(({a,nx,ny})=>({x:a.x-nx*.20,y:a.y-ny*.20})),color(palette[1],front?.15:.06),scale*.011);
      trace(ctx,edges.map(({a,nx,ny})=>({x:a.x-nx*.53,y:a.y-ny*.53})),color(palette[1],front?.37:.16),scale*.0027);
      trace(ctx,edges.map(({a,nx,ny})=>({x:a.x+nx*.89,y:a.y+ny*.89})),color(mix(palette[1],theme.glow,.35),front?.32:.12),scale*.0019);
    }
  }
  function paintFlow(back,front,box,id,t) {
    const {left,top,width,height} = box;
    const p = emotions[id];
    const cx = left + width / 2;
    const orbitWidth = Math.max(width * 1.68, height * 1.05);
    const base = Math.min(orbitWidth, height * 1.30);
    const orbit=(u,lane,spread=0)=>{
      const phase=u*tau*p.turns+lane*2.5+t*p.speed*3.9+.86;
      const rise=1-u;
      const beat=Math.sin(u*20+t*3.5);
      const squall=id==='anger'?.075*beat:id==='fear'?.049*Math.sin(u*39+t*6):0;
      const rx=orbitWidth*(.25+.13*Math.sin(u*Math.PI*.89)+.035*rise+squall+spread);
      const x=cx+Math.cos(phase)*rx;
      const heavy=id==='sad'?Math.pow(rise,.86):rise;
      const y=top+height*(.035+.915*heavy)+Math.sin(phase)*height*.039+(lane?-.027:.020)*height;
      const faceFade=y<top+height*.26&&Math.abs(x-cx)<Math.min(width*.43,height*.23);
      const depth=Math.sin(phase);
      const z=faceFade?-Math.abs(depth):depth;
      const taper=Math.pow(Math.sin(Math.PI*u),.58);
      const flick=id==='anger'?.85+.47*Math.sin(u*94+t*5):id==='fear'?.83+.27*Math.sin(u*37+t*4):.86+.14*Math.sin(u*21+t*1.4);
      return {x,y,z,width:base*.024*p.width*taper*(.72+z*.24)*flick*(lane?.47:1)*(faceFade?.42:1),
        visible:!(id==='fear'&&Math.sin(u*42+lane*1.4+t*1.8)<-.69), faceFade};
    };
    const ribbons=[0,1].map(lane=>Array.from({length:121},(_,i)=>orbit(i/120,lane)));
    const floating=[];
    for(let i=0;i<grainCount;i++){
      const seed=grains[i];
      const u=fraction(seed.phase+t*p.speed*(.5+seed.radius*.8));
      const off=(seed.radius-.86)*.31;
      const point=orbit(u,seed.lane,off);
      const jiggle=(seed.size-.5)*base*.044;
      const shed=(id==='anger'?.035:id==='fear'?-.019:.008)*base*Math.sin(seed.az);
      const next=orbit(Math.min(1,u+.003),seed.lane,off);
      const angle=id==='sad'?1.48+seed.size*.52:Math.atan2(next.y-point.y,next.x-point.x)+(p.speed<0?Math.PI:0);
      floating.push({...point,seed,u,angle,x:point.x+jiggle+shed,y:point.y+Math.sin(seed.az)*base*.027});
    }
    function pass(ctx,isFront) {
      for (const points of ribbons) cloth(ctx,points,p.palette,isFront,base);
      for (const point of floating) {
        if((point.z>=0)!==isFront||!point.visible)continue;
        const {seed}=point;
        const material=seed.main?p.main:p.fine;
        const fade=Math.pow(Math.sin(Math.PI*point.u),.6)*(point.faceFade?.24:1);
        const radius=base*(seed.main?.008+seed.size*.016:.004+seed.size*.008)*p.grain;
        particle(ctx,material,p.palette[seed.color],point.x,point.y,radius,point.angle,fade*(isFront?.71:.34));
      }
    }
    glow(back,cx,top+height*.89,base*.28,p.palette[0],.095);
    pass(back,false);
    pass(front,true);
  }

  function paintBubbles(ctx,box,id,time) {
    const {left,top,width,height} = box;
    const base = Math.min(270,height * 1.18);
    const anchorX = left + width + Math.max(6,height * .075);
    const anchorY = top + height * .23;
    const palette = emotions[id].palette;
    for (let i = 0; i < bubbleCount; i++) {
      const seed = grains[i * 53 + 7];
      const age = fraction(time * .39 + i / bubbleCount);
      const visibility = Math.min(1, age / .16, (1 - age) / .29);
      const fade = visibility * visibility * (3 - 2 * visibility);
      const drift = Math.sin(age * 5.1 + i * 2.4) * height * .019;
      const x = anchorX + height * .117 * age + drift;
      const y = anchorY - height * .277 * age;
      const radius = Math.max(2.2,base * (.016 + .016 * seed.size) * (.82 + .23 * age));
      particle(ctx,'bubble',palette[i % 3],x,y,radius,0,fade * .83);
    }
  }

  return {setTheme, paintFlow, paintBubbles};
}
