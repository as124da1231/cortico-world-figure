// The approved ribbon-drift orb, composited on transparency in logo coordinates.
// Love uses lit heart grains, anger uses distributed fireworks, and sadness uses mist stamps.
const QUALITY = {
  restrained: {love:1000, fire:400, mist:110, shuttles:54},
  natural: {love:1650, fire:640, mist:156, shuttles:88},
  dramatic: {love:2420, fire:890, mist:218, shuttles:124},
};

export function createOrbPainter(doc, tier) {
  const quality = QUALITY[tier];
  const tau = Math.PI * 2;
  const clamp = value => Math.min(1, Math.max(0, value));
  const blend = (a,b,t) => a.map((value,i) => Math.round(value+(b[i]-value)*t));
  const rgb = (value, alpha=1) => `rgba(${value.join(',')},${clamp(alpha)})`;

  const emotions = {
    love:  {colors:[[183,71,123],[251,172,197],[229,112,163]], speed:1, force:.65},
    anger: {colors:[[125,6,26],[210,19,40],[255,58,66]], speed:1, force:1.63},
    sad:   {colors:[[87,125,174],[168,201,225],[114,152,194]], speed:.89, force:0},
  };
  function seeded(seed) {
    return () => {
      seed = (Math.imul(seed,1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
  }

  function cloud(count, exponent, seed) {
    const next=seeded(seed);
    return Array.from({length:count},(_,i)=>{
      const y=2*clamp((i+.35+next()*.3)/count)-1;
      const az=i*2.39996323+(next()-.5)*.28;
      const width=Math.sqrt(1-y*y);
      const r=.96*Math.pow(.036+.964*next(),exponent);
      return {x:Math.cos(az)*width,y,z:Math.sin(az)*width,r,phase:next(),size:next(),ink:i%3};
    });
  }

  let theme;
  const materialCache = new Map();
  function setTheme(scheme) {
    const light = scheme !== 'dark';
    if (theme?.light === light) return;
    theme = {light, white:[255,247,250], dark:[37,25,37]};
    materialCache.clear();
  }

  function stamp(color,kind) {
    const image=doc.createElement('canvas');
    image.width=image.height=48;
    const ctx=image.getContext('2d');
    const shade=ctx.createRadialGradient(24,24,0,24,24,24);
    if(kind==='soft'){
      shade.addColorStop(0,rgb(color,.64));
      shade.addColorStop(.40,rgb(color,.39));
      shade.addColorStop(1,rgb(color,0));
    }else{
      shade.addColorStop(0,rgb(blend(color,theme.white,theme.light?.30:.77)));
      shade.addColorStop(.19,rgb(color,.94));
      shade.addColorStop(.32,rgb(color,.35));
      shade.addColorStop(1,rgb(color,0));
    }
    ctx.fillStyle=shade;
    ctx.fillRect(0,0,48,48);
    return image;
  }

  function materials(emotion) {
    if(materialCache.has(emotion))return materialCache.get(emotion);
    const colors=emotion.colors.map(value=>theme.light?blend(value,theme.dark,.18):value);
    const value={colors,lines:colors.map(value=>rgb(value)),pins:colors.map(value=>stamp(value,'pin')),soft:colors.map(value=>stamp(value,'soft'))};
    materialCache.set(emotion,value);
    return value;
  }

  function camera(yaw,tilt=-.24) {
    const c=Math.cos(yaw), s=Math.sin(yaw), a=Math.cos(tilt), b=Math.sin(tilt);
    return (x,y,z,out={})=>{
      const depth=x*s+z*c;
      out.x=x*c-z*s;out.y=y*a-depth*b;out.z=y*b+depth*a;return out;
    };
  }

  function point(scene, p, ink, radius, alpha, soft=false) {
    if(alpha<.018)return;
    const perspective=1+p.z*.13;
    const x=scene.x+p.x*scene.r*perspective;
    const y=scene.y+p.y*scene.r*perspective;
    const r=Math.max(.65,scene.r*radius*perspective);
    const stamps=soft?scene.palette.soft:scene.palette.pins;
    scene.ctx.globalAlpha=clamp(alpha);
    scene.ctx.drawImage(stamps[ink],x-r,y-r,r*2,r*2);
  }

  function trail(scene,p,q,ink,width,alpha) {
    const ctx=scene.ctx;
    const x=scene.x+p.x*scene.r,y=scene.y+p.y*scene.r;
    ctx.beginPath();
    ctx.moveTo(scene.x+q.x*scene.r,scene.y+q.y*scene.r);
    ctx.lineTo(x,y);
    ctx.strokeStyle=scene.palette.lines[ink];
    ctx.globalAlpha=clamp(alpha);
    ctx.lineWidth=Math.max(.48,scene.r*width);
    ctx.lineCap='round';
    ctx.stroke();
  }

  const centerSeeds=cloud(7,.02,5543);
  function easeBetween(value,start,end) {
    const u=clamp((value-start)/(end-start));
    return u*u*(3-2*u);
  }

  function drawTail(scene,p,q,ink,power) {
    const a=1+p.z*.13,b=1+q.z*.13;
    const head={x:p.x*a,y:p.y*a};
    const dx=q.x*b-head.x,dy=q.y*b-head.y;
    const trim=Math.min(1,.133/Math.max(.0001,Math.hypot(dx,dy)));
    const tail={x:head.x+dx*trim,y:head.y+dy*trim};
    const mid={x:(head.x+tail.x)*.5,y:(head.y+tail.y)*.5};
    trail(scene,mid,tail,ink,.008,power*.37);
    trail(scene,head,mid,ink,.011,power*.92);
  }

  const motifCache=new WeakMap();

  function paintHeart(ctx) {
    ctx.moveTo(0,22);
    ctx.bezierCurveTo(-6,16,-24,4,-24,-8);
    ctx.bezierCurveTo(-24,-21,-9,-25,0,-13);
    ctx.bezierCurveTo(9,-25,24,-21,24,-8);
    ctx.bezierCurveTo(24,4,6,16,0,22);
  }

  function motifStamp(type,tint) {
    const image=doc.createElement('canvas');
    image.width=image.height=64;
    const ctx=image.getContext('2d');
    ctx.translate(32,32);
    const bright=blend(tint,theme.white,theme.light?.32:.61);
    const gradient=ctx.createLinearGradient(-12,-23,9,24);
    gradient.addColorStop(0,rgb(bright));
    gradient.addColorStop(.23,rgb(blend(tint,bright,.36),.96));
    gradient.addColorStop(.43,rgb(tint,.94));
    gradient.addColorStop(.69,rgb(blend(tint,theme.dark,.07),.93));
    gradient.addColorStop(1,rgb(blend(tint,theme.dark,.21),.95));
    ctx.beginPath();
    paintHeart(ctx);
    ctx.closePath();
    if(type==='heart-outline'){
      ctx.strokeStyle=gradient;ctx.lineWidth=3.3;ctx.lineJoin='round';ctx.stroke();
    }else{
      ctx.fillStyle=gradient;ctx.fill();
    }
    if(type==='heart'){
      ctx.beginPath();ctx.moveTo(-19,-8);ctx.quadraticCurveTo(-17,-17,-10,-17);
      ctx.lineWidth=2.25;ctx.lineCap='round';ctx.strokeStyle=rgb(bright,.91);ctx.stroke();
    }
    return image;
  }

  function motifs(scene) {
    const palette=scene.palette;
    if(!motifCache.has(palette)){
      const colors=palette.colors.slice(0,3);
      motifCache.set(palette,['heart','heart-outline'].map(type=>colors.map(tint=>motifStamp(type,tint))));
    }
    return motifCache.get(palette);
  }

  function makeLoveSeeds() {
    return cloud(quality.love,.36,4817).map((seed,index)=>{
      let group=0, nearest=-Infinity;
      for(const [i,center] of centerSeeds.entries()){
        const alignment=seed.x*center.x+seed.y*center.y+seed.z*center.z;
        if(alignment>nearest){group=i;nearest=alignment;}
      }
      const spark=(index*43+7)%109===0;
      const accent=(index*83+17)%109<2;
      const detail=spark||accent||(index*53+9)%103<12;
      const r=index%4===0?.92+seed.r*.074:seed.r;
      return {...seed,r,group,angle:Math.atan2(seed.z,seed.x),latitude:Math.hypot(seed.x,seed.z),
        spark,accent,detail,detailRank:index%11,halo:index%19===0,point:{x:0,y:0,z:0}};
    });
  }
  let loveSeeds;

  const firePeriod=3.24;
  const fireColors=[[73,8,25],[113,13,35],[158,19,42],[199,29,45],[232,43,50],
    [248,57,55],[255,78,66],[255,104,77],[255,133,97],[255,178,136]];

  function makeFireSources() {
    const random = seeded(5635927);
    const interior = Math.round(quality.fire * .71);
    return [...cloud(interior,.41,58531),...cloud(quality.fire-interior,.23,41819)].map((seed,index)=>{
      const radius=index<interior?.055+.88*seed.r:.82+.176*seed.r;
      const anchor={x:seed.x*radius,y:seed.y*radius,z:seed.z*radius};
      const hero=index%11===0;
      const size=(hero?1.10:.43)+random()*(hero?.53:.69);
      const front=clamp(.50+.58*anchor.x-.12*anchor.y);
      const burst=.87+.14*(1-front)+(index%4===0?.23:0)+.065*random();
      const heading=random()*tau;
      const rotateRay=camera(heading,(random()-.5)*Math.PI);
      const count=hero?7:3+index%3;
      const sparks=cloud(count,.31,8637+index*849).map((ray,i)=>{
        const speed=(hero?.96:.39)+random()*(hero?1.10:1.00);
        const direction=rotateRay(ray.x,ray.y,ray.z);
        return {
          vx:direction.x*speed*.85+.24+.39*front, vy:direction.y*speed*.72+anchor.y*.34-.06, vz:direction.z*speed*.76+anchor.z*.29,
          delay:random()*.039, life:.32+random()*.40,
          size:size*(.49+.49*random()), hot:random()*.29,
          wake:(hero?.16:.09)+random()*.095,
          streak:(hero&&i<4)||(index%5===0&&i===0), glint:hero&&i<3
        };
      });
      const branch=sparks[1];
      const fork=hero?{...branch,vx:branch.vz*.46,vy:-branch.vx*.42,vz:branch.vy*.41,
        life:.36,size:size*.52,wake:.13,streak:true,glint:false}:null;
      return {anchor,size,burst,heading,front,sparks,fork,birthMotion:angerGesture(burst),head:{},origin:{}};
    });
  }
  let fireSources;

  function fireSprite(color,glint) {
    const sprite=doc.createElement('canvas');
    sprite.width=sprite.height=48;
    const ctx=sprite.getContext('2d');
    const glow=ctx.createRadialGradient(24,24,0,24,24,24);
    const highlight=blend(color,theme.white,glint?.18:.055);
    glow.addColorStop(0,rgb(highlight,1));
    glow.addColorStop(.165,rgb(highlight,.99));
    glow.addColorStop(.258,rgb(color,.84));
    glow.addColorStop(.36,rgb(color,.21));
    glow.addColorStop(.57,rgb(color,.067));
    glow.addColorStop(1,rgb(color,0));
    ctx.fillStyle=glow;
    ctx.fillRect(0,0,48,48);
    return sprite;
  }

  let firePaint;
  function densePaint() {
    if(firePaint?.theme===theme)return firePaint;
    const colors=fireColors.map(color=>theme.light?blend(color,theme.dark,.20):color);
    firePaint={theme,
      heads:colors.map((color,index)=>fireSprite(color,index>=7)),
      haze:stamp(colors[2],'soft'), rim:stamp(colors[3],'soft'),
      tails:colors.map(color=>rgb(color))
    };
    return firePaint;
  }

  function firePhase(time) {
    return ((time%firePeriod)+firePeriod)%firePeriod;
  }

  function angerGesture(phase) {
    const brace=bump(phase,.16,.83,.89,1.26);
    const strike=bump(phase,.86,.983,.998,1.13);
    const aftershock=.47*bump(phase,1.12,1.187,1.208,1.37);
    const tremble=bump(phase,.54,.78,1.04,1.32);
    const shudder=.022*tremble*Math.sin(phase*87);
    const recoil=bump(phase,1.015,1.092,1.117,1.25);
    return {
      brace,strike,aftershock,shudder,
      xScale:1-.24*brace+.095*strike+.041*aftershock,
      yScale:1-.05*brace-.077*strike-.026*aftershock,
      shift:-.054*brace+.149*strike+.068*aftershock-.067*recoil+shudder
    };
  }

  function fireSourcePosition(source,time,phase,motion,out) {
    const {anchor,heading,front}=source;
    const {xScale,yScale,brace,strike,shift,shudder}=motion;
    const timing=phase-source.burst;
    const rock=Math.cos(timing*32)*(1-easeBetween(Math.abs(timing),.013,.10))*.025;
    const stagger=brace*.017*Math.sin(phase*81+heading*1.7);
    const rake=(.12*strike+.054*motion.aftershock)*(front-.32);
    out.x=anchor.x*xScale+shift+rake+rock*Math.cos(heading)+stagger;
    out.y=anchor.y*yScale-.20*shift-.58*rake+rock*Math.sin(heading)+.012*Math.sin(time*2.35+heading)+shudder*.30;
    out.z=anchor.z*(1-.12*brace)+stagger*.38;
    return out;
  }

  function flightDistance(age) {
    return -Math.expm1(-5.1*age)/5.1;
  }

  function fireProject(scene,view,x,y,z,out) {
    view(x,y,z,out);
    const size=scene.r*(1+out.z*.135);
    out.x=scene.x+out.x*size;
    out.y=scene.y+out.y*size;
  }

  function fireStamp(ctx,image,x,y,radius,opacity) {
    ctx.globalAlpha=clamp(opacity);
    ctx.drawImage(image,x-radius,y-radius,radius*2,radius*2);
  }

  const lightLayers=Array.from({length:7},()=>({
    heads:[], tails:Array.from({length:8},()=>[])
  }));
  const fireTip={},fireTail={};

  function collectFireSpark(scene,view,origin,spark,age,strength) {
    if(age<=0||age>=spark.life)return;
    const cool=age/spark.life;
    const alpha=easeBetween(age,0,.027)*(1-easeBetween(cool,.24,1))*strength;
    if(alpha<.032)return;
    const distance=flightDistance(age);
    const {vx,vy,vz}=spark;
    fireProject(scene,view,origin.x+vx*distance,origin.y+vy*distance,origin.z+vz*distance,fireTip);
    const depth=clamp(.52+fireTip.z*.48);
    const key=clamp(.61+depth*.25-(fireTip.x-scene.x)/scene.r*.12-(fireTip.y-scene.y)/scene.r*.13);
    const level=Math.round(1+8*clamp((1-cool)**1.55*(.49+.38*key)+spark.hot+(spark.glint?.16:0)));
    const radius=Math.max(1.1,scene.r*.033*spark.size*(.67+.48*depth)*(1-.25*cool));
    const layer=lightLayers[Math.min(6,Math.floor(depth*7))];
    const light=alpha*(.46+.49*depth);
    layer.heads.push(fireTip.x,fireTip.y,radius,level,light);

    if(!spark.streak||light<.16)return;
    const tailDistance=flightDistance(Math.max(0,age-spark.wake*(1-.31*cool)));
    fireProject(scene,view,origin.x+vx*tailDistance,origin.y+vy*tailDistance,origin.z+vz*tailDistance,fireTail);
    const dx=fireTip.x-fireTail.x,dy=fireTip.y-fireTail.y;
    const length=Math.hypot(dx,dy);
    if(length<1.02)return;
    const width=radius*(spark.glint?.28:.22);
    layer.tails[Math.max(0,level-2)].push(fireTail.x,fireTail.y,fireTip.x,fireTip.y,-dy/length*width,dx/length*width);
  }

  function drawRedFirework(scene,clustered) {
    const {ctx,r,t}=scene;
    const paint=densePaint();
    const phase=firePhase(t);
    const motion=angerGesture(phase);
    const view=camera(.18+.12*motion.strike-.08*motion.brace,-.19);
    const burstLight=motion.strike+.52*motion.aftershock;
    fireStamp(ctx,paint.haze,scene.x+r*motion.shift,scene.y,r*(1.13-.13*motion.brace),.24+.18*motion.brace+.11*burstLight);
    fireStamp(ctx,paint.rim,scene.x+r*(motion.shift+.19),scene.y-r*.12,r*.73,.075+.28*burstLight);

    for(const layer of lightLayers){
      layer.heads.length=0;
      for(const group of layer.tails)group.length=0;
    }

    for(const source of (fireSources ??= makeFireSources())){
      const p=fireSourcePosition(source,t,phase,motion,source.head);
      fireProject(scene,view,p.x,p.y,p.z,p);
      const depth=clamp(.50+.51*p.z);
      const age=phase-source.burst;
      const flash=age<0?easeBetween(age,-.070,0):Math.exp(-age*21);
      const tension=motion.brace*(.46+.54*source.front);
      const tone=clamp(.24+.35*depth+.30*flash+.21*tension+.16*burstLight*source.front);
      const radius=Math.max(1.2,r*.033*source.size*(.69+.40*depth+.20*flash));
      const layer=lightLayers[Math.min(6,Math.floor(depth*7))];
      layer.heads.push(p.x,p.y,radius,Math.round(tone*9),(.36+.43*depth+.17*flash)*(1+.15*tension));

      if(age<=0||age>=.81)continue;
      const origin=fireSourcePosition(source,t-age,source.burst,source.birthMotion,source.origin);
      for(const spark of source.sparks)collectFireSpark(scene,view,origin,spark,age-spark.delay,1);
      const branch=source.sparks[1];
      const forkAge=age-branch.delay-.21;
      if(source.fork&&clustered>.02&&forkAge>0&&forkAge<source.fork.life){
        const distance=flightDistance(.21);
        const split={x:origin.x+branch.vx*distance,y:origin.y+branch.vy*distance,z:origin.z+branch.vz*distance};
        collectFireSpark(scene,view,split,source.fork,forkAge,clustered);
      }
    }

    for(const {heads,tails} of lightLayers){
      for(const [tone,group] of tails.entries()){
        if(!group.length)continue;
        ctx.globalAlpha=.36+.05*tone;
        ctx.fillStyle=paint.tails[tone];
        ctx.beginPath();
        for(let i=0;i<group.length;i+=6){
          const x=group[i],y=group[i+1],hx=group[i+2],hy=group[i+3],ox=group[i+4],oy=group[i+5];
          ctx.moveTo(x,y);ctx.lineTo(hx-ox,hy-oy);ctx.lineTo(hx+ox,hy+oy);ctx.closePath();
        }
        ctx.fill();
      }
      for(let i=0;i<heads.length;i+=5)fireStamp(ctx,paint.heads[heads[i+3]],heads[i],heads[i+1],heads[i+2],heads[i+4]);
    }
  }

  const radiusByMood = {love:1, anger:.97, sad:.94};

  function bump(t, rise, peak, hold, end) {
    return easeBetween(t,rise,peak)*(1-easeBetween(t,hold,end));
  }

  function motionFor(id,t) {
    if(id==='love'){
      const phase=((t%3.84)+3.84)%3.84;
      const swell=bump(phase,.29,.60,.64,.89)+.69*bump(phase,.92,1.12,1.15,1.54);
      const approach=bump(phase,.03,.48,1.10,2.03);
      const drift=Math.sin(t*1.02);
      return {lift:.033*drift+.091*swell,side:.027*drift,stretch:1+swell*.056+approach*.038,widen:1+swell*.050+approach*.027,spin:t*.125,
        yaw:-.24+t*.132,tilt:-.31,noise:.048,accent:swell};
    }
    return {lift:id==='sad'?-.11:0,side:0,stretch:1,widen:1,spin:0,yaw:.13,tilt:-.17,noise:0,accent:0};
  }

  function makeScene(ctx,id,time,anchor) {
    const emotion = emotions[id];
    const t = time * emotion.speed;
    const motion = motionFor(id,t);
    const r = anchor.radius * radiusByMood[id];
    return {ctx,r,x:anchor.x+motion.side*r,y:anchor.y-motion.lift*r,t,
      force:emotion.force,palette:materials(emotion),id,motion};
  }

  function field(t,scene,clustered) {
    const {id,force}=scene;
    const motion=motionFor(id,t);
    const drift=.062+.027*force;
    const turn=motion.spin;
    const c=Math.cos(turn),s=Math.sin(turn);
    const nodes=clustered>.002?centerSeeds.map((node,i)=>{
      const phase=t*.84+i*1.94;
      const swell=Math.sin(phase)*.5+.5;
      const twist=t*.31+i*2.4;
      const span=.59+.19*swell;
      return {
        x:(node.x*c-node.z*s)*span+drift*Math.cos(twist),
        y:node.y*span+drift*Math.sin(twist*.83),
        z:(node.x*s+node.z*c)*span+drift*Math.cos(twist*.79),
        pull:clustered*(.19+.43*swell**1.25)
      };
    }):[];
    return {t,nodes,id,force,motion,view:camera(motion.yaw,motion.tilt)};
  }

  function position(p,f,out) {
    const {t,motion}=f;
    const wave=Math.sin(t*1.42+p.y*5.2+p.x*3.1);
    const drift=motion.noise*wave;
    const sparkTurn=p.spark?t*(.18+.26*f.force):t*.048*p.size;
    const angle=p.angle+motion.spin+sparkTurn+drift;
    const radius=p.r*.99*(1+drift*.66);
    let x=Math.cos(angle)*p.latitude*radius;
    let y=p.y*radius+motion.noise*.34*Math.sin(t*1.31+p.z*4.3);
    let z=Math.sin(angle)*p.latitude*radius;
    const node=f.nodes[p.group];
    if(node){
      const pull=node.pull*(p.detail?.60:.10);
      x+=(node.x-x)*pull;
      y+=(node.y-y)*pull;
      z+=(node.z-z)*pull;
    }
    return f.view(x*motion.widen,y*motion.stretch,z,out);
  }

  const mistSeeds=cloud(quality.mist,.31,74030);
  const mistCache=new WeakMap();

  function mistStamp(tint) {
    const image=doc.createElement('canvas');
    image.width=image.height=64;
    const ctx=image.getContext('2d');
    const pixels=ctx.createImageData(64,64);
    const bright=blend(tint,theme.white,.65);
    for(let y=0;y<64;y++)for(let x=0;x<64;x++){
      const u=x/31.5-1,v=y/31.5-1;
      const taper=(1-u*u)**2;
      const curl=.18*Math.sin(4.1*u+.4)+.08*Math.sin(8*u+1.1);
      const width=.095+.13*(1-u*u);
      const veil=Math.exp(-Math.pow((v-curl)/width,2));
      const edge=Math.exp(-Math.pow((v-curl+width*.55)/(width*.37),2));
      const haze=Math.exp(-Math.pow((v-curl-.13)/(.22+.12*taper),2));
      const noise=.82+.10*Math.sin(u*24+v*19)+.08*Math.cos(u*17-v*26);
      const offset=(y*64+x)*4;
      const silver=.38+.42*edge;
      for(let c=0;c<3;c++)pixels.data[offset+c]=tint[c]+(bright[c]-tint[c])*silver;
      pixels.data[offset+3]=255*taper*(veil*.39+edge*.20+haze*.18)*noise;
    }
    ctx.putImageData(pixels,0,0);
    return image;
  }

  function drawMist(scene,clustered) {
    const {ctx,t,r,x,y,palette}=scene;
    if(!mistCache.has(palette))mistCache.set(palette,palette.colors.slice(0,3).map(mistStamp));
    const images=mistCache.get(palette);
    const view=camera(t*.108-.35,-.16);
    const points=mistSeeds.map(seed=>{
      const stir=Math.sin(t*.61+seed.phase*tau);
      const spread=seed.r*(.97+.066*stir);
      const low=(.12+.05*clustered)*(1-seed.y*seed.y);
      const p=view(seed.x*spread+stir*.044,seed.y*spread+low+.065*Math.sin(t*.52+seed.z*6),seed.z*spread);
      return {seed,p};
    }).sort((a,b)=>a.p.z-b.p.z);
    for(const {seed,p} of points){
      const perspective=1+p.z*.13;
      const w=r*(.29+seed.size*.18)*perspective;
      const light=clamp(.56-.24*p.x+.16*p.y+.16*p.z);
      ctx.save();
      ctx.translate(x+p.x*r*perspective,y+p.y*r*perspective*.95);
      ctx.rotate(Math.sin(seed.phase*tau+t*.46)*.72-.17*p.x);
      ctx.globalAlpha=(.30+.48*light)*(.62+.31*seed.size);
      ctx.drawImage(images[seed.ink],-w,-w,w*2,w*2);
      ctx.restore();
    }
  }

  const layers=Array.from({length:7},()=>({fine:Array.from({length:9},()=>[]),detail:[]}));
  const previousPoint={x:0,y:0,z:0};
  const gradeCache=new WeakMap();

  const finishes={
    love:  {diffusion:1.18, size:1.04, trail:.19, highlight:1.13},
  };

  function gradedPigments(palette) {
    if(!gradeCache.has(palette)){
      const colors=palette.colors.slice(0,3);
      const dark=colors.map(c=>rgb(blend(c,theme.dark,.20)));
      const base=colors.map(c=>rgb(c));
      const bright=colors.map(c=>rgb(blend(c,theme.white,theme.light?.055:.25)));
      gradeCache.set(palette,[...dark,...base,...bright]);
    }
    return gradeCache.get(palette);
  }

  function drawOrbCore(scene,clustered) {
    if(scene.id==='anger'){
      drawRedFirework(scene,clustered);
      return;
    }
    if(scene.id==='sad'){
      drawMist(scene,clustered);
      return;
    }
    const {ctx,r,x,y,motion,palette}=scene;
    const finish=finishes.love;
    const current=field(scene.t,scene,clustered);
    const past=field(scene.t-.105,scene,clustered);
    const sprites=motifs(scene);
    const pigments=gradedPigments(palette);

    for(const layer of layers){
      for(const grains of layer.fine)grains.length=0;
      layer.detail.length=0;
    }
    for(const seed of (loveSeeds ??= makeLoveSeeds())){
      const p=position(seed,current,seed.point);
      const depth=Math.min(6,Math.floor(clamp((p.z+1)*.5)*7));
      const radius=Math.hypot(p.x,p.y);
      const key=clamp(.43-.48*p.x-.59*p.y+.35*p.z);
      const rim=clamp((radius-.59)*3.3)*clamp(.51+p.x*.50-p.y*.28)*clamp(.64-p.z);
      const light=clamp(key+rim*.35);
      const ink=seed.ink;
      const grade=light>.71?2:light>.36?1:0;
      const haze=(.021+.111*key+.061*rim)*finish.diffusion;
      seed.currentInk=ink;
      seed.light=light;
      if(seed.halo)point(scene,p,ink,.085+seed.size*.073,haze,true);

      const layer=layers[depth];
      const showMotif=seed.accent||seed.spark||(seed.detailRank<4&&light>.31);
      if(seed.detail&&showMotif)layer.detail.push(seed);
      else layer.fine[ink+grade*3].push(seed);
    }

    for(const [depth,layer] of layers.entries()){
      for(const [group,grains] of layer.fine.entries()){
        if(!grains.length)continue;
        const grade=Math.floor(group/3);
        ctx.fillStyle=pigments[group];
        ctx.globalAlpha=.077+depth*.032+grade*.074;
        ctx.beginPath();
        for(const seed of grains){
          const p=seed.point;
          const perspective=1+p.z*.13;
          const size=Math.max(.61,r*(.011+.012*seed.size)*perspective);
          const px=x+p.x*r*perspective,py=y+p.y*r*perspective;
          if(grade===2&&size>1.48){
            const dot=size*.54;
            ctx.moveTo(px+dot,py);
            ctx.arc(px,py,dot,0,tau);
          }else ctx.rect(px-size*.5,py-size*.5,size,size);
        }
        ctx.fill();
      }

      for(const seed of layer.detail){
        const p=seed.point;
        const perspective=1+p.z*.13;
        const near=clamp(.5+.5*p.z);
        const accent=seed.accent&&seed.phase>.64&&near>.56&&seed.light>.36;
        const glint=.54+.46*seed.light;
        const distance=accent?.102+seed.size*.032:.034+seed.size*.036;
        const size=Math.max(2.5,r*distance*perspective*finish.size*(.77+.23*near));
        const angle=Math.sin(scene.t*1.05+seed.phase*tau)*.33;
        if(seed.spark){
          const prior=position(seed,past,previousPoint);
          drawTail(scene,p,prior,seed.currentInk,(finish.trail+.13*motion.accent)*near*glint);
        }

        ctx.save();
        ctx.translate(x+p.x*r*perspective,y+p.y*r*perspective);
        ctx.rotate(angle);
        const highlights=accent?finish.highlight:1;
        ctx.globalAlpha=clamp((.28+.66*near)*glint*highlights);
        ctx.drawImage(sprites[Number(accent)][accent?1:seed.currentInk],-size,-size,size*2,size*2);
        ctx.restore();
      }
    }
  }

  const shuttleSeeds=cloud(quality.shuttles,.35,851662);
  const shuttlePreset={pace:.67,life:.78,opacity:.93,trail:.055};

  function shuttlePaint() {
    const ember=densePaint();
    return {heads:ember.heads.slice(3,9),lines:ember.tails.slice(2,8)};
  }

  function shuttleBasis(seed,cycle) {
    const azimuth=Math.atan2(seed.z,seed.x);
    const turn=seed.phase*tau+cycle*1.57;
    const c=Math.cos(turn),s=Math.sin(turn);
    const side=Math.sin(azimuth),forward=Math.cos(azimuth);
    const view=camera(seed.phase*tau+cycle*2.39996,seed.x*1.2+Math.sin(cycle*1.7+seed.phase*tau)*.56);
    return {normal:view(seed.x,seed.y,seed.z),
      tangent:view(-side*c+seed.y*forward*s,-Math.hypot(seed.x,seed.z)*s,forward*c+seed.y*side*s)};
  }

  function shuttlePosition(track,u) {
    const {basis,arc,bend,span,radius}=track;
    const {normal,tangent}=basis;
    const k=u*u*(3-2*u);
    const cross={x:normal.y*tangent.z-normal.z*tangent.y,y:normal.z*tangent.x-normal.x*tangent.z,z:normal.x*tangent.y-normal.y*tangent.x};
    const bow=Math.sin(Math.PI*k);
    const side=bend*bow*(.74+.26*Math.cos(k*tau));
    const theta=(k-.47)*span;
    const a=arc?(radius+.07*bow)*Math.cos(theta):radius-.20*bow;
    const b=arc?radius*Math.sin(theta):(k-.5)*span;
    return {x:a*normal.x+b*tangent.x+cross.x*side,y:a*normal.y+b*tangent.y+cross.y*side,z:a*normal.z+b*tangent.z+cross.z*side};
  }

  function shuttleProject(scene,point,shape) {
    const perspective=1+point.z*.125;
    return {
      x:scene.x+scene.r*(point.x*perspective*shape.xScale+shape.shift),
      y:scene.y+scene.r*(point.y*perspective*shape.yScale-.17*shape.shift),
      z:point.z
    };
  }

  function surfaceShuttles(scene) {
    const {t}=scene;
    const preset=shuttlePreset;
    const shape=angerGesture(firePhase(t));
    const active=[];
    for(let index=0;index<shuttleSeeds.length;index++){
      const seed=shuttleSeeds[index];
      const period=preset.pace*(.88+seed.r*.86);
      const offset=period*seed.phase;
      const cycle=Math.floor((t+offset)/period);
      const start=cycle*period-offset;
      const life=period*preset.life;
      const u=(t-start)/life;
      if(u>=1)continue;
      const opacity=easeBetween(u,0,.16)*(1-easeBetween(u,.70,1));
      const arc=index%5<2;
      const track={basis:shuttleBasis(seed,cycle),arc,bend:.07+.25*seed.size,
        span:arc?1.19+.64*seed.r:1.18+.63*seed.r,radius:1.02+.16*seed.size};
      const position=shuttleProject(scene,shuttlePosition(track,u),shape);
      const previous=shuttleProject(scene,shuttlePosition(track,Math.max(0,u-preset.trail/life)),shape);
      active.push({seed,position,previous,opacity:opacity*preset.opacity,u,shape});
    }
    return active;
  }

  function drawShuttles(scene,shuttles,foreground) {
    const {ctx,r,x,y}=scene;
    const paint=shuttlePaint();
    for(const shuttle of shuttles){
      const {seed,position,previous,opacity,u,shape}=shuttle;
      const front=easeBetween(position.z,-.15,.16);
      const distance=Math.hypot((position.x-x-r*shape.shift)/shape.xScale,(position.y-y+r*.17*shape.shift)/shape.yScale)/r;
      const rim=easeBetween(distance,.84,1.13);
      const depth=clamp(.51+.48*position.z);
      const strength=foreground?front:(1-front)*(.21+.67*rim);
      const alpha=opacity*strength*(.62+.38*depth);
      if(alpha<.018)continue;

      const vx=position.x-previous.x,vy=position.y-previous.y;
      const size=(.64+.58*seed.size)*(.79+.35*depth);
      const heat=Math.round(1+4*(1-u)**.74);
      const radius=Math.max(.9,r*.030*size);
      const length=Math.hypot(vx,vy);
      if(length>1.1){
        const trim=Math.min(1,r*.115/length);
        ctx.globalAlpha=alpha*.61;
        ctx.strokeStyle=paint.lines[Math.max(0,heat-1)];ctx.lineWidth=radius*.30;ctx.lineCap='round';
        ctx.beginPath();ctx.moveTo(position.x-vx*trim,position.y-vy*trim);ctx.lineTo(position.x,position.y);ctx.stroke();
      }
      fireStamp(ctx,paint.heads[heat],position.x,position.y,radius,alpha);
    }
    ctx.globalAlpha=1;
  }

  const ribbonTracks={
    love:[
      {curve:[[-1.40,.48,-.16],[-.49,1.02,.98],[.32,-.55,1.07],[1.38,-.62,-.24]],speed:.29,width:.103,count:184,alpha:.89},
      {curve:[[1.12,.64,-.17],[.67,.31,-.95],[-.28,-.88,-1.02],[-1.37,-.38,.09]],speed:.205,width:.075,count:124,alpha:.62}
    ],
    sad:[
      {curve:[[-1.11,-.93,.17],[-1.21,-.36,.49],[-.74,.59,.74],[.27,1.12,.14]],speed:.18,width:.093,count:143,alpha:.69},
      {curve:[[.86,-.85,-.43],[1.28,-.33,-.86],[1.09,.51,-.34],[.54,1.02,.32]],speed:.132,width:.069,count:108,alpha:.47}
    ]
  };
  const ribbonSeeds=cloud(184,.36,95163);
  const ribbonPaint=new WeakMap();

  function ribbonPoint(track,u,t,lane,across) {
    const v=1-u;
    const a=v*v*v,b=3*v*v*u,c=3*v*u*u,d=u*u*u;
    const [start,left,right,end]=track.curve;
    const x=start[0]*a+left[0]*b+right[0]*c+end[0]*d;
    const y=start[1]*a+left[1]*b+right[1]*c+end[1]*d;
    const z=start[2]*a+left[2]*b+right[2]*c+end[2]*d;
    const dx=(left[0]-start[0])*v*v+2*(right[0]-left[0])*v*u+(end[0]-right[0])*u*u;
    const dy=(left[1]-start[1])*v*v+2*(right[1]-left[1])*v*u+(end[1]-right[1])*u*u;
    const length=Math.max(.001,Math.hypot(dx,dy));
    const wave=Math.sin(7.9*u-t*1.58+lane*1.43);
    const curl=Math.cos(6.3*u-t*.78+lane*2.35);
    const envelope=.35+.65*Math.sin(u*Math.PI)**.62;
    const offset=across*track.width*envelope*(.60+.40*Math.abs(curl));
    return {x:x-dy/length*offset+.035*wave,y:y+dx/length*offset+.043*wave,
      z:z+across*track.width*curl*.58+.053*Math.sin(t*.89+u*4.8+lane),angle:Math.atan2(dy,dx)};
  }

  function ribbonParticles(scene) {
    const {id,t,r,x,y,motion}=scene;
    const particles=[];
    for(const [lane,track] of ribbonTracks[id].entries()){
      for(let i=0;i<track.count;i++){
        const seed=ribbonSeeds[i];
        const time=(i+seed.phase*.87)/track.count+t*track.speed+lane*.27;
        const u=time-Math.floor(time);
        const weight=easeBetween(u,.018,.19)*(1-easeBetween(u,.79,.98));
        if(weight<.026)continue;
        const point=ribbonPoint(track,u,t,lane,seed.x);
        const perspective=1+point.z*.127;
        particles.push({x:x+point.x*r*perspective*motion.widen,y:y+point.y*r*perspective*motion.stretch,
          z:point.z,angle:point.angle,seed,alpha:weight*track.alpha*(.76+.24*seed.r),u});
      }
    }
    return particles;
  }

  function drawRibbonParticles(scene,particles,foreground) {
    const {ctx,r,id,palette}=scene;
    if(!ribbonPaint.has(palette)){
      const heads=id==='love'?motifs(scene)[0]:palette.colors.slice(0,3).map(mistStamp);
      ribbonPaint.set(palette,heads);
    }
    const heads=ribbonPaint.get(palette);
    for(const particle of particles){
      const {seed,x,y,z,angle,u}=particle;
      const depth=clamp(.52+.49*z);
      const front=easeBetween(z,-.15,.14);
      const outside=easeBetween(Math.hypot((x-scene.x)/r,(y-scene.y)/r),.78,1.15);
      const amount=foreground?front:(1-front)*(.39+.53*outside);
      const alpha=particle.alpha*amount*(.57+.43*depth);
      if(alpha<.016)continue;
      if(id==='love'&&seed.phase>.52){
        const scale=r*(.014+.019*seed.size);
        const light=palette.pins[seed.ink];
        ctx.globalAlpha=alpha*.78;
        ctx.drawImage(light,x-scale,y-scale,scale*2,scale*2);
      }else{
        const scale=r*(id==='love'?(.029+.027*seed.size):(.081+.071*seed.size))*(.80+.28*depth);
        ctx.save();ctx.globalAlpha=id==='love'?alpha:alpha*.60;
        ctx.translate(x,y);ctx.rotate(id==='love'?Math.sin(seed.phase*tau+u*5)*.42:angle);
        ctx.drawImage(heads[seed.ink],-scale,-scale,scale*2,scale*2);
        ctx.restore();
      }
    }
    ctx.globalAlpha=1;
  }

  return function paint(ctx,id,time,anchor,scheme) {
    setTheme(scheme);
    const scene = makeScene(ctx,id,time,anchor);
    const restless = id === 'anger';
    const outer = restless ? surfaceShuttles(scene) : ribbonParticles(scene);
    const paintOuter = restless ? drawShuttles : drawRibbonParticles;
    paintOuter(scene,outer,false);
    drawOrbCore(scene,1);
    paintOuter(scene,outer,true);
  };
}
