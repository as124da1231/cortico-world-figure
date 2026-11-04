// Pure data playback. Native clips only own the channels present in their curves.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const mix=(a,b,t)=>a+(b-a)*t;
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
 let active=null,expression=null,fadingExpression=null,elapsed=0,lastFace=null,lastGesture=null,manual=null;
 const get=word=>{const b=bindings.get(word),r=b&&resources.get(b.resource);return r?{binding:b,resource:r}:null;};
 function trigger(word){const next=get(word);if(!next)return false;if(next.resource.kind==='expression'){expression={...next,age:0};}else{active={...next,age:0,release:false};}return true;}
 function applyTrack(out,track,value,weight){if(!Number.isFinite(value)||typeof track.id!=='string')return;out.push({id:track.id,target:track.target,value,weight,blend:track.blend||'Overwrite'});}
 function sample(resource,time,weight,out){for(const p of resource.tracks)applyTrack(out,p,p.sample?p.sample(time):p.value,weight);}
 return {
  trigger,
  failed:failures,
  resources:()=>[...resources.keys()],
  sample(id,time){const r=resources.get(id);if(!r)throw Error('Unknown native resource');manual={id,time:clamp(Number(time)||0,0,r.seconds)};},
  clearSample(){manual=null;},
  update(frame={},dt=.016){
   dt=clamp(Number(dt)||0,0,.1);elapsed+=dt;const out=[];
   if(manual){sample(resources.get(manual.id),manual.time,1,out);return out;}
   if(frame.face!==lastFace){lastFace=frame.face;const next=get(frame.face);if(expression)fadingExpression={...expression,age:0};expression=next?.resource.kind==='expression'?{...next,age:0}:null;if(next?.resource.kind==='motion'&&active?.binding.word!==frame.face)trigger(frame.face);}
   const gesture=frame.gesture?.kind||null;
   if(gesture!==lastGesture){lastGesture=gesture;if(gesture&&active?.binding.word!==gesture)trigger(gesture);}
   if(fadingExpression){fadingExpression.age+=dt;sample(fadingExpression.resource,0,Math.max(0,1-fadingExpression.age/.2),out);if(fadingExpression.age>=.2)fadingExpression=null;}
   if(expression){expression.age+=dt;sample(expression.resource,0,Math.min(1,expression.age/.2),out);}
   if(!active&&get('idle')&&(!frame.mode||frame.mode==='idle')&&!expression){const idle=get('idle');sample(idle.resource,elapsed%idle.resource.seconds,.55,out);}
   if(active){
    active.age+=dt;let r=active.resource,t=active.age;
    if(r.classification==='pose'&&!active.release&&t>r.seconds+1.5){const release=resources.get(active.binding.release);if(release){active={...active,resource:release,age:0,release:true};r=release;t=0;}}
    const hold=r.classification==='pose'&&!active.release?1.5:0;
    const end=r.seconds+hold,fade=.25,weight=Math.min(1,t/.15)*Math.min(1,Math.max(0,(end+fade-t)/fade));
    sample(r,Math.min(t,r.seconds),weight,out);
    if(t>=end+fade)active=null;
   }
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
  const base=model.getParameterValueByIndex(i),next=value.blend==='Add'?base+value.value:value.blend==='Multiply'?base*value.value:value.value;
  const number=clamp(mix(base,next,value.weight),model.getParameterMinimumValue(i),model.getParameterMaximumValue(i));
  if(Number.isFinite(number))model.setParameterValueByIndex(i,number);
 }
}
