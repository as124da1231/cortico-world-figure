import {expressionTracks} from './native-combination.js';
// Pure data playback. Native clips only own the channels present in their curves.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const mix=(a,b,t)=>a+(b-a)*t;
const MOTION_IN = .15;
const MOTION_OUT = .25;
const EXPRESSION_FADE = .2;
const POSE_HOLD = 1.5;
const IDLE_WEIGHT = .55;
const PRIORITY = { face: 1, gesture: 2, command: 3 };

// Merge motion layers before writing parameters. Two successive partial writes
// would fade a shared channel toward its base pose instead of between the clips.
function crossfadeValues(previous, current, ratio) {
  const values = new Map();
  const trackKey = track => track.target + ':' + track.id;
  for (const track of previous) values.set(trackKey(track), { ...track, weight: track.weight * (1 - ratio) });
  for (const track of current) {
    const key = trackKey(track);
    const old = values.get(key);
    const weight = (old?.weight ?? 0) + track.weight;
    values.set(key, old
      ? { ...track, value: mix(old.value, track.value, track.weight / weight), weight,
          ...(old.nativeOnly || track.nativeOnly ? {nativeOnly:true} : {}) }
      : track);
  }
  return [...values.values()];
}
export function compileCurve(curve){
 const s=curve.Segments;if(!Array.isArray(s)||s.length<2||!s.every(Number.isFinite))throw Error('Invalid native curve');
 let at=2,t=s[0],v=s[1];const segments=[];
 while(at<s.length){
  const kind=s[at++],size=kind===1?6:2;if(![0,1,2,3].includes(kind)||at+size>s.length)throw Error('Unsupported curve segment');
  const points=s.slice(at,at+size);at+=size;const end=points.at(-2),value=points.at(-1);
  if(end<t)throw Error('Native curve times must increase');segments.push({kind,t,v,end,value,points});t=end;v=value;
 }
 if(segments.length>10000)throw Error('Native curve is too complex');
 return time=>{
  const p=segments.find(p=>time<=p.end);if(!p)return v;if(time<=p.t)return p.v;
  const k=clamp((time-p.t)/(p.end-p.t||1),0,1);
  if(p.kind===0)return mix(p.v,p.value,k);if(p.kind===2)return p.v;if(p.kind===3)return p.value;
  const bez=(a,b,c,d,u)=>(1-u)**3*a+3*(1-u)**2*u*b+3*(1-u)*u*u*c+u**3*d;
  let lo=0,hi=1;for(let i=0;i<18;i++){const u=(lo+hi)/2;if(bez(p.t,p.points[0],p.points[2],p.end,u)<time)lo=u;else hi=u;}
  return bez(p.v,p.points[1],p.points[3],p.value,(lo+hi)/2);
 };
}

export function createNativeActions(config,{warn=console.warn}={}){
 const resources=new Map(),bindings=new Map((config?.bindings||[]).map(b=>[b.word,b]));const failures=[];
 for(const resource of config?.resources||[]){
  try{
   const data=resource.data,tracks=[];
   if(resource.kind==='expression'){
    for(const p of data.Parameters||[]){if(typeof p.Id!=='string'||!Number.isFinite(Number(p.Value))||!['Add','Multiply','Overwrite'].includes(p.Blend||'Add'))throw Error('Invalid expression parameter');tracks.push({id:p.Id,target:'Parameter',blend:p.Blend||'Add',value:Number(p.Value)});}
   }else for(const c of data.Curves||[]){if(!['Parameter','PartOpacity'].includes(c.Target))continue;tracks.push({id:c.Id,target:c.Target,sample:compileCurve(c)});}
   if(!tracks.length)throw Error('No supported channels');
   resources.set(resource.id,{...resource,tracks,seconds:clamp(Number(resource.seconds)||1,.05,60)});
  }catch(error){failures.push(resource.id);warn('[l2d] Native resource skipped; generic behavior retained',resource.id,error.message);}
 }
 let active=null,expression=null,visibleExpression=[],expressionFrom=[],expressionAge=0,elapsed=0,lastFace=null,lastGesture=null,manual=null;
 let visibleMotion=[], outgoing=null, transitionAge=0, idleWeight=0;
 const expressionResource=(id,overlays=[])=>{
  const list=[id,...overlays].map(id=>resources.get(id)).filter(Boolean);
  if(!list.length)return null;
  const primary=list[0];
  if(primary.kind!=='expression')return primary;
  return {...primary,tracks:expressionTracks(list)};
 };
 const get=word=>{const b=bindings.get(word);if(!b)return null;try{const r=expressionResource(b.resource,b.overlays);return r?{binding:b,resource:r}:null;}catch(error){if(!failures.includes(b.resource)){failures.push(b.resource);warn('[l2d] Invalid expression combination',error.message);}return null;}};
 function setExpression(next) {
  if (expression?.binding.word === next?.binding.word) return;
  expressionFrom=visibleExpression.map(v=>({...v}));expressionAge=0;
  expression = next ? { ...next, age: 0 } : null;
 }
 function rememberMotion() {
  // A third command can arrive mid-fade. Capture what was actually displayed
  // rather than bringing a previously interrupted pose back into the mix.
  outgoing = visibleMotion.length ? visibleMotion : null;
  transitionAge = 0;
 }
 function startMotion(next, priority) {
  if (active && priority < active.priority) return false;
  rememberMotion();
  idleWeight = 0;
  active = { ...next, age: 0, release: false, priority };
  return true;
 }
 function trigger(word, priority = PRIORITY.command) {
  const next = get(word);
  if (!next) return false;
  if (next.resource.kind === 'motion') return startMotion(next, priority);
  setExpression(next);
  return true;
 }
 function sample(resource,time,weight,out,nativeOnly=false){
  if(weight<=0)return;
  for(const track of resource.tracks){
   const value=track.sample?track.sample(time):track.value;
   if(!Number.isFinite(value)||typeof track.id!=='string')continue;
   out.push({id:track.id,target:track.target,value,weight,blend:track.blend||'Overwrite',
     ...(track.scale!==undefined?{scale:track.scale}:{}),...(nativeOnly?{nativeOnly:true}:{})});
  }
 }
 function stepMotion(frame, dt) {
  const values = [];
  if (active) {
   active.age += dt;
   const hold = active.resource.classification === 'pose' && !active.release ? POSE_HOLD : 0;
   const release = hold > 0 && active.age >= active.resource.seconds + hold
     ? resources.get(active.binding.release) : null;
   if (release?.kind === 'motion') {
    rememberMotion();
    active = { ...active, resource: release, age: dt, release: true };
   }
   const { resource, age } = active;
   const end = resource.seconds + (active.release ? 0 : hold);
   const weight = Math.min(1, age / MOTION_IN) * clamp((end + MOTION_OUT - age) / MOTION_OUT, 0, 1);
   sample(resource, Math.min(age, resource.seconds), weight, values, active.binding.nativeOnly===true);
   if (age >= end + MOTION_OUT) active = null;
  } else {
   const idle = get('idle');
   if (idle?.resource.kind === 'motion') {
    const nativeOnly = idle.binding.nativeOnly===true;
    const maxWeight = nativeOnly ? 1 : IDLE_WEIGHT;
    const target = (!frame.mode || frame.mode === 'idle') ? maxWeight : 0;
    const step = dt * maxWeight / MOTION_IN;
    idleWeight += clamp(target - idleWeight, -step, step);
    sample(idle.resource, elapsed % idle.resource.seconds, idleWeight, values, nativeOnly);
   }
  }
  if (!outgoing) return values;
  transitionAge += dt;
  if (transitionAge < MOTION_IN) return crossfadeValues(outgoing, values, transitionAge / MOTION_IN);
  outgoing = null;
  return values;
 }
 return {
  trigger,
  hasExpression:word=>get(word)?.resource.kind==='expression',
  failed:failures,
  resources:()=>[...resources.keys()],
  sample(id,time,overlays=[]){const r=expressionResource(id,overlays);if(!r)throw Error('Unknown native resource');manual={resource:r,time:clamp(Number(time)||0,0,r.seconds)};},
  clearSample(){manual=null;},
  update(frame={},dt=.016){
   dt=clamp(Number(dt)||0,0,.1);elapsed+=dt;const out=[];
   if(manual){sample(manual.resource,manual.time,1,out);return out;}
   if (frame.face !== lastFace) {
    lastFace = frame.face;
    const next = get(frame.face);
    setExpression(next?.resource.kind === 'expression' ? next : null);
    if (next?.resource.kind === 'motion' && active?.binding.word !== frame.face) trigger(frame.face, PRIORITY.face);
   }
   const gesture=frame.gesture?.kind||null;
   if (gesture !== lastGesture) {
    lastGesture = gesture;
    if (gesture && active?.binding.word !== gesture) trigger(gesture, PRIORITY.gesture);
   }
   visibleMotion = stepMotion(frame, dt);
   out.push(...visibleMotion);
   expressionAge+=dt;if(expression)expression.age+=dt;
   const ratio=Math.min(1,expressionAge/EXPRESSION_FADE);
   const target=expression?.resource.tracks||[];
   const prior=new Map(expressionFrom.map(v=>[v.id,v])),next=new Map(target.map(v=>[v.id,v]));
   visibleExpression=[...new Set([...prior.keys(),...next.keys()])].map(id=>{
    const a=prior.get(id),b=next.get(id);
    return {id,target:'Parameter',blend:'Affine',scale:mix(a?.scale??1,b?.scale??1,ratio),value:mix(a?.value??0,b?.value??0,ratio),weight:1};
   });
   if(ratio===1){visibleExpression=visibleExpression.filter(v=>next.has(v.id));expressionFrom=[];}
   if(!visibleMotion.some(value=>value.nativeOnly))out.push(...visibleExpression);
   return out;
  },
  state:()=>({motion:active?.resource.id||null,expression:expression?.resource.id||null,failed:[...failures]}),
 };
}

export function applyNativeValues(values,model,paramIndex,partIndex){
 for(const value of values){
  if(value.target==='PartOpacity'){
   const i=partIndex.get(value.id);if(i===undefined)continue;
   model.setPartOpacityByIndex(i,clamp(mix(model.getPartOpacityByIndex(i),value.value,value.weight),0,1));continue;
  }
  const i=paramIndex.get(value.id);if(i===undefined)continue;
  const base=model.getParameterValueByIndex(i),next=value.blend==='Affine'?base*value.scale+value.value:value.blend==='Add'?base+value.value:value.blend==='Multiply'?base*value.value:value.value;
  const number=clamp(mix(base,next,value.weight),model.getParameterMinimumValue(i),model.getParameterMaximumValue(i));
  if(Number.isFinite(number))model.setParameterValueByIndex(i,number);
 }
}

// Blend once against the current pose, then keep the result through the later
// physics, wardrobe and lip-sync writes. Applying the fade twice changes it.
export function captureMotionLocks(values,model,paramIndex,partIndex){
 applyNativeValues(values,model,paramIndex,partIndex);
 return values.flatMap(track=>{
  const part=track.target==='PartOpacity';
  const index=(part?partIndex:paramIndex).get(track.id);
  if(index===undefined)return [];
  const value=part?model.getPartOpacityByIndex(index):model.getParameterValueByIndex(index);
  return [{id:track.id,target:track.target,blend:'Overwrite',value,weight:1}];
 });
}
