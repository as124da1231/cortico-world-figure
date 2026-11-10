// Image-independent light fields. All coordinates are derived from visible
// bounds. Fixed seeds and analytic trajectories make every instant seekable.
export const FIELDS={
 joy:{flow:'rise',speed:.65,curl:.25,light:.75},
 bloom:{flow:'burst',speed:1.1,curl:.32,light:1},
 embrace:{flow:'orbit',speed:.38,curl:.5,light:.72},
 blush:{flow:'veil',speed:.24,curl:.22,light:.5},
 shock:{flow:'burst',speed:1.8,curl:.06,light:.85},
 heat:{flow:'heat',speed:1.45,curl:.8,light:1},
 sink:{flow:'fall',speed:.32,curl:.15,light:.5},
 sob:{flow:'fall',speed:.95,curl:.4,light:.75},
 crown:{flow:'orbit',speed:.28,curl:.15,light:.8},
 puff:{flow:'outward',speed:.45,curl:.3,light:.58},
 resolve:{flow:'focus',speed:.9,curl:.08,light:.95},
 tangle:{flow:'inward',speed:.42,curl:.85,light:.52},
 scatter:{flow:'scatter',speed:1.3,curl:.75,light:.72},
 pressure:{flow:'inward',speed:.85,curl:.12,light:.64},
 question:{flow:'orbit',speed:.3,curl:.7,light:.55},
 drowse:{flow:'fall',speed:.13,curl:.3,light:.38},
 breath:{flow:'breathe',speed:.16,curl:.15,light:.35},
 ack:{flow:'outward',speed:.3,curl:.12,light:.4},
 listen:{flow:'inward',speed:.24,curl:.07,light:.42},
 voice:{flow:'outward',speed:.7,curl:.15,light:.5},
 orbit:{flow:'orbit',speed:.25,curl:.2,light:.48},
 dizzy:{flow:'orbit',speed:1.2,curl:.65,light:.65},
 rhythm:{flow:'rise',speed:.8,curl:.65,light:.75},
 speed:{flow:'fall',speed:1.65,curl:.03,light:.58},
};

export function createEmotionField({path,ellipse,visible}) {
 const [L,T,R,B]=visible,W=R-L,H=B-T,C=(L+R)/2,Y=(T+B)/2,D=Math.min(W,H),TAU=Math.PI*2;
 const f=x=>Number(x.toFixed(3)),clamp=x=>Math.max(0,Math.min(1,x)),fract=x=>x-Math.floor(x);
 const smooth=x=>{x=clamp(x);return x*x*(3-2*x);};
 let seed=20261102;
 const rand=()=>{seed=(seed+0x6d2b79f5)|0;let n=Math.imul(seed^seed>>>15,1|seed);n^=n+Math.imul(n^n>>>7,61|n);return ((n^n>>>14)>>>0)/4294967296;};
 const particles=Array.from({length:32},(_,i)=>({i,phase:rand(),a:rand(),b:rand(),depth:rand(),speed:.72+rand()*.6}));
 function curve(pts){
  let d='M'+f(pts[0][0])+' '+f(pts[0][1]);
  for(let i=0;i<pts.length-1;i++){
   const a=pts[Math.max(0,i-1)],b=pts[i],c=pts[i+1],e=pts[Math.min(pts.length-1,i+2)];
   d+=`C${f(b[0]+(c[0]-a[0])/6)} ${f(b[1]+(c[1]-a[1])/6)} ${f(c[0]-(e[0]-b[0])/6)} ${f(c[1]-(e[1]-b[1])/6)} ${f(c[0])} ${f(c[1])}`;
  }return d;
 }
 function ribbon(b,pts,col,light,width,op){
  const d=curve(pts),sides=[[],[]];
  pts.forEach((p,i)=>{
   const a=pts[Math.max(0,i-1)],z=pts[Math.min(pts.length-1,i+1)],dx=z[0]-a[0],dy=z[1]-a[1],len=Math.hypot(dx,dy)||1;
   const w=width*(.04+.6*Math.sin(i/(pts.length-1)*Math.PI)**.7);
   for(let k=0;k<2;k++){const sign=k?1:-1;sides[k].push([p[0]-dy/len*w*sign,p[1]+dx/len*w*sign]);}
  });
  const outline=[...sides[0],...sides[1].reverse()].map(([x,y],i)=>(i?'L':'M')+f(x)+' '+f(y)).join(' ')+'Z';
  path(b,d,col,width*5,op*.09,'none');
  path(b,outline,'none',0,op*.65,col);
  path(b,d,light,width*.22,op*.9,'none');
 }
 function point(p,t,field,g){
  const {flow,speed,curl}=field,sign=p.i%2?1:-1;
  const u=fract(p.phase+t*speed*p.speed*.28),a=p.a*TAU;
  const margin=D*(.09+.15*g),span=H+margin*.7;
  let x,y,alpha=Math.sin(u*Math.PI)**.65;
  if(['rise','heat','fall','veil'].includes(flow)){
   const down=flow==='fall',q=down?u:1-u;
   x=C+sign*(W*.48+margin*(.25+p.b*.8))+Math.sin(u*TAU*(1+curl*2)+t*.6+p.a*6)*margin*curl*.5;
   y=T-margin*.3+q*span;
   if(flow==='veil')x=C+sign*(W*.5+margin*.25)+Math.sin(u*TAU+t*.2)*margin*.35;
  }else if(flow==='orbit'){
   const angle=a+t*speed*(p.i%3===0?-1:1),rx=W*.55+margin*(.2+p.b*.7),ry=H*(.34+p.b*.15);
   x=C+Math.cos(angle)*rx;y=Y+Math.sin(angle)*ry+Math.sin(angle*2)*margin*curl;
   alpha=.4+.6*(Math.cos(angle)*.5+.5);
  }else if(flow==='burst'){
   const impulse=fract(p.phase+t*speed*.22),k=.1+impulse*.9,dx=Math.cos(a),dy=Math.sin(a);
   x=C+dx*(W*.49+margin*k);y=Y+dy*(H*.49+margin*k);
   alpha=(1-impulse)*(.6+.4*Math.sin(impulse*Math.PI));
  }else if(flow==='inward'||flow==='focus'||flow==='outward'){
   const inward=flow!=='outward',q=inward?1-u:u,dx=Math.cos(a),dy=Math.sin(a);
   const edge=.97+q*.5;
   x=C+dx*(W*.5+margin*.6)*edge;y=Y+dy*(H*.48+margin*.25)*edge;
   x+=Math.sin(u*TAU*2+p.a*5)*margin*curl*.4;
   y+=Math.cos(u*TAU+p.b*5)*margin*curl*.4;
   alpha=Math.sin(u*Math.PI)*.9;
  }else if(flow==='scatter'){
   x=C+sign*(W*.5+margin*(.15+u*.8))+Math.sin(u*TAU*3+p.a*8)*margin*.16;
   y=T+H*p.b+Math.sin(u*TAU*2+p.a*7)*margin*.6;
  }else{
   const pulse=.5-.5*Math.cos(t*speed*TAU);
   x=C+Math.cos(a)*(W*.55+margin*(.3+pulse*.3));y=Y+Math.sin(a)*(H*.5+margin*.15);
   alpha=.3+pulse*.35;
  }
  return {x,y,alpha,u};
 }
 return function drawField(b,{p,lv,t,tier,reduced,frame}) {
  const field=FIELDS[p.motif];if(!field)return;
  const g=lv.gain,flow=field.flow,col=p.color,light=p.accent;
  const time=reduced?.85:t,rich=tier==='dramatic'&&!reduced,mid=tier!=='restrained'&&!reduced;
  const count=reduced?7:lv.count;
  const margin=D*(.09+.15*g),opening=reduced?0:Math.exp(-Math.max(0,t-.25)*2)*smooth(t/.25);
  const breath=reduced?.5:.5+.5*Math.sin(time*(p.quiet?1.1:1.7));
  const strength=field.light*(.65+g*.35)*(p.motif==='voice'&&!reduced?.35+.65*(frame.talk||0):1);
  // Broad, low-contrast colour has no hard edge or icon silhouette. Paint it
  // behind the image, so opaque subjects naturally occlude the light field.
  path(b,ellipse(C,Y,W*(.63+g*.08),H*.57),'none',0,strength*(.7+opening*.3),`url(#${b.paint.aura})`);
  const low=flow==='fall'?B-H*.12:flow==='heat'?B-H*.08:Y;
  for(const sign of [-1,1]){
   const x=C+sign*(W*.47+margin*.3),y=low+Math.sin(time*.6+sign)*D*.05;
   path(b,ellipse(x,y,D*(.25+g*.12),H*(flow==='heat'?.25:.2)),'none',0,strength*(.65+breath*.2),`url(#${b.paint.mist})`);
  }
  // Multi-scale depth: distant soft bokeh, mid-distance motes, fine bright
  // cores. Streaks are sampled from each mote's analytic past position.
  let frontUsed=0;
  for(let i=0;i<count;i++){
   const par=particles[i],v=point(par,time,field,g),far=i%6===0;
   const radius=D*(far?.072:.019+par.depth*.024)*(reduced?.75:1);
   const edge=Math.abs(v.x-C)>W*.5+radius*1.3||v.y<T-radius*1.3||v.y>B+radius*1.3;
   const plane=!far&&edge&&i%4===1&&frontUsed<7?1:0;if(plane)frontUsed++;
   const flicker=reduced?1:.76+.24*Math.sin(time*(1+par.a*2)+par.phase*TAU);
   const op=(.15+v.alpha*.85)*strength*flicker*(far?.32:1.25);
   path(b,ellipse(v.x,v.y,radius,radius),'none',0,op,`url(#${b.paint.mote})`,plane);
   if(!far&&i%3===1){
    const dt=(flow==='heat'||flow==='scatter')?.14:flow==='focus'?.24:.2;
    const prev=point(par,time-dt,field,g);
    // Do not draw a streak across a wrapped particle lifetime.
    if(Math.abs(prev.u-v.u)<.4){
     const sw=D*(flow==='heat'?.009:.0065);
     path(b,`M${f(prev.x)} ${f(prev.y)}Q${f((prev.x+v.x)*.5+Math.sin(par.a*8)*margin*.08)} ${f((prev.y+v.y)*.5)} ${f(v.x)} ${f(v.y)}`,col,sw,op*.65,'none',0);
    }
   }
  }
  const ribbons=reduced?0:lv.ribbons;
  for(let i=0;i<ribbons;i++){
   const sign=i%2?1:-1,pts=[];
   for(let k=0;k<=24;k++){
    const u=k/24,turn=time*field.speed*.65+i*1.8;
    let x,y;
    if(flow==='orbit'||flow==='veil'){
     const a=-Math.PI*.15+u*Math.PI*1.04+turn*.22;
     x=C+sign*Math.sin(a)*(W*.54+margin*(.4+Math.sin(u*Math.PI)*.24));
     y=Y+Math.cos(a)*(H*.49+margin*.1)+Math.sin(a*2+turn)*margin*.22;
    }else if(['inward','focus','outward','breathe'].includes(flow)){
     const a=(sign>0?.08:Math.PI*.9)+(u-.5)*.6+i*.15;
     const q=flow==='outward'?u:1-u;
     x=C+Math.cos(a)*(W*.48+margin*(.25+q*.95));
     y=Y+Math.sin(a)*H*.51+(u-.5)*H*.55;
    }else{
     x=C+sign*(W*.51+margin*(.45+Math.sin(u*TAU+turn)*(.15+field.curl*.65)));
     y=B+margin*.05-u*(H*.83+margin*.2);
     if(flow==='heat'){x+=Math.sin(u*TAU*2.4+turn)*margin*.48;y+=Math.cos(u*TAU*2.4+turn)*margin*.22;}
    }
    // A tapered stroke is built from a variable-length travelling segment.
    const center=.48+.12*Math.sin(turn),half=flow==='heat'?.3:.32;
    if(u>center-half&&u<center+half)pts.push([x,y]);
   }
   if(pts.length>1){
    const opacity=strength*(flow==='fall'?.55:.88+opening*.12);
    ribbon(b,pts,col,light,D*(flow==='heat'?.022:.018)*(mid?1:.7),opacity);
   }
  }
  // Burst families use brief tapered light filaments. The rest keep their own
  // laminar, turbulent, downward or converging flow; no shared impact ring.
  if(flow==='burst'&&!reduced){
   const n=rich?6:mid?4:2;
   for(let i=0;i<n;i++){
    const a=(i/n)*TAU+.25,dx=Math.cos(a),dy=Math.sin(a),grow=smooth((t-i*.025)/.3),length=margin*(.55+g*.6)*grow;
    const x=C+dx*W*.54,y=Y+dy*H*.54;
    const d=`M${f(x)} ${f(y)}q${f(dx*length*.45-dy*margin*.08)} ${f(dy*length*.45+dx*margin*.08)} ${f(dx*length)} ${f(dy*length)}`;
    path(b,d,col,D*.008,opening*.65,'none');
   }
  }
 };
}
