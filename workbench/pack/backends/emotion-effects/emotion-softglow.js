import {TIERS,PLANS} from './emotion-softglow-plan.js';
import {createEmotionField,FIELDS} from './emotion-softglow-field.js';
let instanceId=0;

// Second-edition soft glow, carried over from the locally approved preview. Two fixed SVG banks allow a short outgoing
// tail without growing a particle tree. Native effects stay entirely with kit.
export function createSoftGlowEmotionEffects({make,parent,art,model,media}) {
 const [L,T,R,B]=model.visible,C=(L+R)/2,motionScale=Math.min(R-L,B-T)/160,PI=Math.PI;
 const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
 const ease=x=>1-(1-clamp(x))**3;
 const smooth=x=>{x=clamp(x);return x*x*(3-2*x);};
 const f=x=>Number(x.toFixed(3));
 const attr=(n,a)=>{for(const[k,v]of Object.entries(a)){const s=String(v);if(n.getAttribute(k)!==s)n.setAttribute(k,s);}};
 const tier=TIERS[model.emotionIntensity]?model.emotionIntensity:'natural',enabled=model.effectsEnabled!==false;
 let reduced=!!media?.matches,dead=false,pending=null,event=null;
 let current=null,outgoing=null,nextBank=0,lastRepeat=-100;
 const prefix='ifg-field-'+(++instanceId)+'-';
 const root=make('g',{'class':'ifg-performance','data-style':'softglow','pointer-events':'none'},parent);
 const back=make('g',{'class':'ifg-performance-back'},parent);parent.insertBefore(back,art);
 const front=make('g',{'class':'ifg-performance-front'},root),defs=make('defs',{},root);
 const banks=[0,1].map(index=>{
  const grad=make('radialGradient',{id:prefix+'aura-'+index},defs);
  const stops=[make('stop',{offset:0,'stop-opacity':.3},grad),make('stop',{offset:.55,'stop-opacity':.12},grad),make('stop',{offset:1,'stop-opacity':0},grad)];
  const radial=(name,values)=>{const grad=make('radialGradient',{id:prefix+name+'-'+index},defs);return values.map(([offset,opacity])=>make('stop',{offset,'stop-opacity':opacity},grad));};
  const motes=radial('mote',[[0,1],[.18,1],[.42,.45],[1,0]]),mist=radial('mist',[[0,.5],[.4,.2],[.75,.05],[1,0]]);
  const bg=make('g',{'data-bank':index},back),fg=make('g',{'data-bank':index},front);
  const pool=(n,g)=>Array.from({length:n},()=>make('path',{display:'none','stroke-linecap':'round','stroke-linejoin':'round'},g));
  return {bg,fg,stops,motes,mist,paint:{aura:prefix+'aura-'+index,mote:prefix+'mote-'+index,mist:prefix+'mist-'+index},paths:[pool(64,bg),pool(16,fg)],used:[0,0],index};
 });
 function path(b,d,col,sw=1.6,op=1,fill='none',plane=0,transform='') {
  const n=b.paths[plane][b.used[plane]++];if(!n)throw Error('Soft glow effect pool exhausted');
  attr(n,{d,stroke:col,'stroke-width':sw,fill,opacity:f(clamp(op)),display:'inline',transform});
 }
 const ellipse=(x,y,rx,ry)=>`M${f(x-rx)} ${f(y)}a${f(rx)} ${f(ry)} 0 1 0 ${f(2*rx)} 0a${f(rx)} ${f(ry)} 0 1 0 ${f(-2*rx)} 0`;
 function end(b){for(let p=0;p<2;p++)for(let i=b.used[p];i<b.paths[p].length;i++)attr(b.paths[p][i],{display:'none'});}
 function hide(b){attr(b.bg,{display:'none'});attr(b.fg,{display:'none'});}
 const scene=createEmotionField({path,ellipse,visible:model.visible});
 function render(perf,frame,alpha){
  const b=banks[perf.bank],p=PLANS[perf.face]||PLANS.neutral;
  if(!enabled||p.motif==='none'||alpha<=0){hide(b);return [0,0,0,1,1];}
  const lv=TIERS[reduced?'restrained':tier],age=Math.max(0,frame.t-perf.at);
  const enter=smooth(age/(reduced?.12:lv.anticipation+.12));
  // A low-strength signature remains while the official expression is active.
  const tail=p.quiet||reduced?1:.32+.68*(1-smooth((age-lv.duration+.6)/.6)),op=alpha*enter*tail;
  if(op<.003){hide(b);return [0,0,0,1,1];}
  attr(b.bg,{display:'inline',opacity:f(op),'data-face':perf.face});attr(b.fg,{display:'inline',opacity:f(op),'data-face':perf.face});
  b.used=[0,0];for(const s of [...b.stops,...b.mist])attr(s,{'stop-color':p.color});
  b.motes.forEach((s,i)=>attr(s,{'stop-color':i===0?p.accent:p.color}));
  const g=lv.gain,t=reduced?.65:Math.max(0,age-lv.anticipation);
  const release=ease(t/(p.quiet?.9:lv.burst)),punch=reduced||p.quiet?0:Math.sin(clamp(t/(lv.burst+.2))*PI);
  scene(b,{p,lv,t,tier,reduced,frame});
  end(b);
  // Keep the foreground light placement stable during the official mirror.
  attr(b.fg,{transform:frame.facing<0?`translate(${2*C} 0) scale(-1 1)`:''});
  if(reduced||p.quiet)return [0,0,0,1,1];
  const amp=g*alpha*(1-smooth((age-lv.duration+.6)/.6));let dx=0,dy=0,rot=0,sx=1,sy=1;
  if(age<lv.anticipation){const a=Math.sin(age/Math.max(.01,lv.anticipation)*PI);sy=1-a*.015*amp;sx=1+a*.009*amp;}
  if(['joy','bloom','shock'].includes(p.motif))dy=-punch*(p.motif==='bloom'?6:4)*amp;
  if(p.motif==='embrace')rot=Math.sin(t*2.4)*1.1*amp;
  if(p.motif==='blush')rot=Math.sin(t*1.5)*1.5*amp;
  if(p.motif==='heat')dx=Math.sin(t*29)*1.5*amp*(1-clamp(t/1.6));
  if(['sink','sob'].includes(p.motif))dy=3*release*amp;
  if(p.motif==='puff')dy=Math.abs(Math.sin(t*5))*1.5*amp;
  if(p.motif==='pressure'){sy=1-.013*amp;dx=Math.sin(t*31)*.8*amp;}
  if(p.motif==='scatter')rot=Math.sin(t*15)*1.4*amp;
  if(p.motif==='question')rot=Math.sin(t*1.5)*1.7*amp;
  return [dx,dy,rot,sx,sy];
 }
 function effective(frame){
  if(event&&frame.t<event.until&&frame.face==='neutral')return event.face;
  if(frame.mode==='dance')return 'dance';
  if(frame.face==='neutral'&&(frame.talk||0)>.04)return 'speaking';
  return PLANS[frame.face]?frame.face:'neutral';
 }
 function switchTo(face,t){
  const bank=nextBank;nextBank=1-nextBank;
  outgoing=current&&current.face!=='neutral'&&!reduced?{...current,exit:t}:null;
  current={face,at:t,bank};lastRepeat=t;
  attr(root,{'data-face':face,'data-generation':Number(root.getAttribute('data-generation')||0)+1});
 }
 function draw(frame){
  if(dead)return;
  if(pending&&['heard','bounce'].includes(pending))event={face:pending,until:frame.t+1.4};
  const face=effective(frame),repeat=pending===face&&frame.t-lastRepeat>=TIERS[tier].cooldown;
  if(!current||face!==current.face||repeat)switchTo(face,frame.t);pending=null;
  if(!enabled){banks.forEach(hide);attr(art,{transform:''});attr(root,{'data-enabled':'false','data-phase':'关闭'});return;}
  attr(root,{'data-enabled':'true','data-tier':reduced?'restrained':tier,'data-reduced':reduced,'data-motif':(PLANS[face]||PLANS.neutral).motif,'data-field':FIELDS[(PLANS[face]||PLANS.neutral).motif]?.flow||'none','data-revision':'universal-light-field-20261102'});
  let old=[0,0,0,1,1],incoming=1;
  if(outgoing){const k=1-clamp((frame.t-outgoing.exit)/.22);if(k>0){old=render(outgoing,frame,k);incoming=smooth((frame.t-outgoing.exit)/.2);}else{hide(banks[outgoing.bank]);outgoing=null;}}
  const now=render(current,frame,incoming);if(!outgoing)hide(banks[1-current.bank]);
  const sum=i=>now[i]+old[i],scale=i=>now[i]+old[i]-1;
  attr(art,{transform:reduced?'':`translate(${f(sum(0)*motionScale)} ${f(sum(1)*motionScale)}) rotate(${f(sum(2))} ${f(C)} ${f(B)}) translate(${f(C)} ${f(B)}) scale(${f(scale(3))} ${f(scale(4))}) translate(${-f(C)} ${-f(B)})`});
  const age=frame.t-current.at,lv=TIERS[tier],quiet=PLANS[face]?.quiet;
  const phase=reduced?'静态提示':face==='neutral'?'留白':quiet?'安静持续':age<lv.anticipation?'蓄势':age<lv.anticipation+lv.burst?'展开':age<lv.duration-.6?'余韵':age<lv.duration?'收尾':'情绪余光';
  attr(root,{'data-phase':phase,'data-age':f(age),'data-active-banks':outgoing?2:1});
 }
 const preference=e=>{reduced=!!e.matches;outgoing=null;banks.forEach(hide);};
 media?.addEventListener?.('change',preference);
 return {draw,trigger(word){pending=word;},dispose(){dead=true;media?.removeEventListener?.('change',preference);root.remove();back.remove();}};
}
