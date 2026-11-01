import {createHash} from 'node:crypto';

export const configuredDepth=cfg=>['quick','standard','deep'].includes(cfg.assistDepth)?cfg.assistDepth:'standard';
export function analysisPolicy(cfg) {
 const active=cfg.assistMotions===true&&cfg.assistGear==='image';
 const depth=active?configuredDepth(cfg):null;
 return {depth,configuredDepth:configuredDepth(cfg),active,
  pageSize:depth==='deep'?8:12,parameters:depth==='deep'?8:6,
  detailParameters:depth==='deep'?24:16,maxFrames:depth==='quick'?4:6,
  targeted:active&&depth!=='quick',reviewRequired:depth==='deep'};
}
export const bindingKey=b=>JSON.stringify([b.word,b.resource,b.release||'']);
export const fingerprintKey=(c,b)=>createHash('sha256').update(c.fingerprint+bindingKey(b)).digest('hex');

/** A bounded overview; a single-resource request pages through every channel. */
export function catalogPage(c,start,request,policy) {
 const ids=request.resources;
 if(ids!==undefined&&(!Array.isArray(ids)||!ids.length||ids.length>3||ids.some(id=>typeof id!=='string'||!c.resources.some(r=>r.id===id))))throw Error('请选择最多三个有效资源 ID');
 const offset=Number(request.parameter_offset??0);
 if(!Number.isInteger(offset)||offset<0||offset>2048||offset>0&&ids?.length!==1)throw Error('参数分页须指定一个资源和有效偏移');
 const source=ids?[...new Set(ids)].map(id=>c.resources.find(r=>r.id===id)):c.resources.slice(start);
 const rows=[];
 for(const r of source.slice(0,ids?3:policy.pageSize)) {
  const {raw,parameters,...meta}=r;
  const limit=ids?policy.detailParameters:policy.parameters;
  const row={...meta,parameterCount:parameters.length,parameterOffset:offset,parameters:parameters.slice(offset,offset+limit)};
  row.nextParameterOffset=offset+row.parameters.length<parameters.length?offset+row.parameters.length:null;
  // Leave room for policy, supported words, warnings and frame metadata.
  while(row.parameters.length>1&&JSON.stringify(row).length>4200){row.parameters.pop();row.nextParameterOffset=offset+row.parameters.length;}
  if(rows.length&&JSON.stringify([...rows,row]).length>5100)break;
  rows.push(row);
 }
 return {resources:rows,total:c.resources.length,next:ids?null:start+rows.length<c.resources.length?start+rows.length:null,
  nextResourceOffset:ids&&rows.length<source.length?rows.length:null,
  truncated:c.truncated===true,warnings:(c.warnings||[]).slice(0,3).map(w=>String(w).slice(0,180)),warningCount:(c.warnings||[]).length};
}

const peakTime=r=>r.parameters.filter(p=>Number.isFinite(p.peakTime)).sort((a,b)=>(b.max-b.min)-(a.max-a.min))[0]?.peakTime??r.seconds*.5;
export function resourceSamples(r) {
 return r.kind==='expression'?[{id:r.id,time:0}]:[...new Set([Math.max(0,Math.min(r.seconds,peakTime(r))),r.seconds])].map(time=>({id:r.id,time}));
}
export function inspectionSamples(resources,request,policy) {
 if(request.samples!==undefined) {
  if(!policy.targeted)throw Error('指定采样时刻需要文本＋图片的标准或深入档');
  if(!Array.isArray(request.samples)||!request.samples.length||request.samples.length>policy.maxFrames-1)throw Error('单次最多五个采样点');
  return request.samples.map(s=>{
   const r=resources.find(r=>r.id===s.resource);
   if(!r||!Number.isFinite(s.time)||s.time<0||s.time>r.seconds)throw Error('采样资源或时刻无效');
   if(r.classification==='appearance')throw Error('外观资源不参与情绪适配');
   return {id:r.id,time:s.time};
  });
 }
 const safe=resources.filter(r=>r.classification!=='appearance');
 // Balance expressions and motions; a name suggestion does not replace visual evidence.
 const expressions=safe.filter(r=>r.kind==='expression'),motions=safe.filter(r=>r.kind==='motion');
 const ordered=[];while(expressions.length||motions.length){if(expressions.length)ordered.push(expressions.shift());if(motions.length)ordered.push(motions.shift());}
 const samples=[];
 for(const r of ordered){const next=resourceSamples(r);if(samples.length+next.length>policy.maxFrames-1)continue;samples.push(...next);if(samples.length>=policy.maxFrames-1)break;}
 return samples;
}

/** Static generic/mapped comparisons, not proof of semantic correctness or user consent. */
export function reviewSamples(c,b) {
 const r=c.resources.find(r=>r.id===b.resource),release=c.resources.find(r=>r.id===b.release);
 return [{id:'__neutral__',time:0},
  {id:r.id,time:0,word:b.word,generic:true},
  ...resourceSamples(r).map(s=>({...s,word:b.word})),
  ...(release?[{id:release.id,time:release.seconds,word:b.word}]:[])];
}

export function confirmationReasons(c,bindings,cfg,proof={visual:[],review:[]}) {
 if(!bindings.length)return [];
 const policy=analysisPolicy(cfg),reasons=[];
 for(const b of bindings){
  const r=c.resources.find(r=>r.id===b.resource);
  if(b.confidence<.7||r.classification==='appearance')reasons.push('存在不确定或外观映射');
  if(r.suggestion?.word!==b.word)reasons.push('缺少明确的语义名称对应，需要人工确认');
  if(policy.active){
   if(![b.resource,b.release].filter(Boolean).every(id=>proof.visual.includes(id)))reasons.push('所选资源的图片证据不完整');
   if(policy.reviewRequired&&!proof.review.includes(bindingKey(b)))reasons.push('深入档尚未提供这项映射的对照复核');
  }
 }
 if(c.truncated)reasons.push('资源扫描已截断');
 return [...new Set(reasons)];
}
