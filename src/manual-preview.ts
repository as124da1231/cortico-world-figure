import {FACE_WORDS,MOTION_WORDS,validateBindings} from '../workbench/tools/native-catalog.mjs';
import {wardrobeConfig} from '../workbench/pack/backends/wardrobe.js';

export interface StaticSample { kind:string; resource?:string; word?:string; time:number; picks:Record<string,string> }
export type PreviewSize = 256|512|1024;
export const previewSize=(value:unknown):PreviewSize=>[256,512,1024].includes(Number(value))?Number(value) as PreviewSize:512;
export interface StaticPreviewPlan { size:PreviewSize; groups:any[]; samples:StaticSample[] }

/** Resolve UI choices against this session's catalog; never accept paths or executable content. */
export function manualPreviewPlan(catalog:any,input:any):StaticPreviewPlan {
  if(!input||!['actions','wardrobe'].includes(input.page)||typeof input.raw!=='boolean')throw Error('预览选项无效');
  if(input.previewSize!=null&&![256,512,1024].includes(Number(input.previewSize)))throw Error('预览精度无效');
  const size=previewSize(input.previewSize);
  const bindings=validateBindings(catalog,input.bindings||[]);
  const groups=wardrobeConfig(catalog,input.groups||[],bindings).groups;
  const picks:Record<string,string>={};
  if(!input.picks||typeof input.picks!=='object'||Array.isArray(input.picks))throw Error('装扮选择无效');
  for(const [id,pick]of Object.entries(input.picks)){
    const group=groups.find(g=>g.id===id);
    if(!group||typeof pick!=='string'||pick!=='default'&&!group.options.some((o:any)=>o.id===pick))throw Error('装扮选择无效');
    if(pick!=='default')picks[id]=pick;
  }
  const selected=input.resource==null?null:catalog.resources.find((r:any)=>r.id===input.resource);
  if(input.resource!=null&&!selected)throw Error('原生资源无效');
  const variant=input.sampleSet??0;
  if(!Number.isInteger(variant)||variant<0||variant>2)throw Error('取样档位无效');
  if(input.page==='wardrobe')return {size,groups,samples:[
    {kind:'default',time:0,picks:{}},{kind:'appearance',time:0,picks},
  ]};
  if(![...FACE_WORDS,...MOTION_WORDS].includes(input.word))throw Error('预览动作词无效');
  const word=input.raw?undefined:input.word;
  if(!selected)return {size,groups,samples:[{kind:word?'generic':'default',word,time:0,picks}]};
  if(selected.kind==='expression')return {size,groups,samples:[
    {kind:word?'generic':'default',word,time:0,picks},
    {kind:input.raw?'native':'combined',resource:selected.id,word,time:0,picks},
  ]};
  const duration=Number(selected.seconds);
  if(!Number.isFinite(duration)||duration<=0||duration>600)throw Error('动作时长无效');
  const fractions=[[.2,.5,.8],[.1,.4,.7],[.3,.6,.9]][variant];
  return {size,groups,samples:fractions.map(f=>({kind:input.raw?'native':'combined',resource:selected.id,word,time:Math.round(duration*f*1000)/1000,picks}))};
}
