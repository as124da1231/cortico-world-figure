import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {lstat,readFile,readdir,realpath} from 'node:fs/promises';
import {basename,dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {compileCurve} from '../pack/backends/native-actions.js';

export const FACE_WORDS=['neutral','happy','wink','love','shy','surprised','angry','sad','sleepy','thinking','smug','pout','worried','determined','flustered','scared','excited','cry','confused'];
export const MOTION_WORDS=['idle','nod','shake','wave','bow','cheer','dance','jump','sit','stretch','shiver'];
const WORDS=new Set([...FACE_WORDS,...MOTION_WORDS]);
const reversePose=(a,b)=>b.id!==a.id&&b.kind==='motion'&&a.parameters.some(p=>Math.abs(p.start-p.end)>.001)&&b.parameters.length===a.parameters.length&&a.parameters.every(p=>{const q=b.parameters.find(q=>q.id===p.id&&q.target===p.target);return q&&Math.abs(p.start-q.end)<.01&&Math.abs(p.end-q.start)<.01;});
const digest=value=>createHash('sha256').update(value).digest('hex');

/** @param {any[]} vocab @param {any[]} bindings @param {any[]} resources */
export function appendNativeVocab(vocab, bindings, resources) {
 const labels = {nod:['点头','Nod'],shake:['摇头','Shake'],wave:['招手','Wave'],bow:['鞠躬','Bow'],cheer:['欢呼','Cheer'],dance:['跳舞','Dance'],jump:['跳跃','Jump'],sit:['坐下','Sit'],stretch:['伸展','Stretch'],shiver:['发抖','Shiver']};
 const used = new Set(vocab.flatMap(word => [word.id, ...Object.values(word.names || {}).flat()]));
 for (const {word,resource:id} of bindings) {
  if (word === 'idle' || used.has(word)) continue;
  const resource = resources.find(item => item.id === id);
  if (!resource) continue;
  const [zh,en] = labels[word] ?? [word,word];
  used.add(word);
  const names = {};
  for (const [locale,label] of [['zh',zh],['en',en]]) {
   if (!used.has(label)) { names[locale] = [label]; used.add(label); }
  }
  vocab.push({id:word,kind:resource.kind,names,about:{zh:`原生${zh}`,en:`Native ${en}`},seconds:Math.max(.1,resource.seconds || 1)});
 }
}
export const readJson=async file=>JSON.parse((await readFile(file,'utf8')).replace(/^\uFEFF/,''));
export async function localFile(root,name,max=4*1048576){
 if(typeof name!=='string'||isAbsolute(name)||name.includes('\0'))throw Error('资源路径无效');
 const file=resolve(root,name.replaceAll('\\','/')),rel=relative(root,file);
 if(!rel||rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))throw Error('资源不能越过模型目录');
 const info=await lstat(file);
 if(!info.isFile()||info.isSymbolicLink()||info.size>max)throw Error('资源不是受支持的普通文件，或文件过大');
 const actual=await realpath(file),base=await realpath(root),inside=relative(base,actual);
 if(inside==='..'||inside.startsWith('..'+sep)||isAbsolute(inside))throw Error('资源链接越过模型目录');
 return file;
}

/** Bounded discovery, without executing any model files. Never follows directory links.
 * @param {string | undefined} input
 * @param {{roots?:string[],query?:string,maxDepth?:number,maxEntries?:number,maxModels?:number,signal?:AbortSignal}} options
 */
export async function findModels(input,{roots=[],query='',maxDepth=4,maxEntries=10000,maxModels=40,signal}={}){
 const result=[],problems=[];let entries=0,truncated=false;
 const scan=async(dir,depth,entryFile)=>{
  signal?.throwIfAborted();if(result.length>=maxModels||entries>=maxEntries){truncated=true;return;}
  const info=await lstat(dir).catch(()=>null);if(!info||info.isSymbolicLink()||!info.isDirectory())return;
  const names=await readdir(dir,{withFileTypes:true});entries+=names.length;
  if(entries>maxEntries){truncated=true;return;}
  const manifests=names.filter(e=>e.isFile()&&(e.name.toLowerCase()==='figure.json'||e.name.toLowerCase().endsWith('.model3.json')));
  for(const entry of manifests){
   if(entryFile&&entry.name!==entryFile)continue;
   if(result.length>=maxModels){truncated=true;break;}
   const file=join(dir,entry.name),pack=entry.name.toLowerCase()==='figure.json';
   try{
    await localFile(dir,entry.name);
    const data=await readJson(file);
    if(pack&&(!data.id||!data.entry))continue;
    if(!pack&&!data.FileReferences)continue;
    if(query&&!`${basename(dir)} ${entry.name} ${data.name?.zh||''} ${data.name?.en||''} ${data.id||''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))continue;
    result.push({id:'model-'+digest(await realpath(file)).slice(0,16),kind:pack?'pack':'live2d',title:String(pack?(data.name?.zh||data.name?.en||data.id):basename(dir)).slice(0,120),dir:await realpath(dir),file:entry.name});
   }catch(e){problems.push({file,reason:e.message});}
  }
  if(manifests.length||depth>=maxDepth)return;
  for(const entry of names){if(entry.isDirectory()&&!entry.isSymbolicLink())await scan(join(dir,entry.name),depth+1);if(truncated)break;}
 };
 const paths=input?[input]:roots;
 for(let path of [...new Set(paths.filter(p=>typeof p==='string'&&isAbsolute(p)))].slice(0,8)){
  const info=await lstat(path).catch(()=>null);
  let entryFile;
  if(info?.isFile()){if(/\.model3\.json$|[\\/]figure\.json$/i.test(path)){entryFile=basename(path);path=dirname(path);}else{problems.push({file:path,reason:'请选择模型入口、模型文件夹或已解压的形象包'});continue;}}
  await scan(resolve(path),0,entryFile);
 }
 return {models:[...new Map(result.map(m=>[m.id,m])).values()],problems:problems.slice(0,20),truncated,entries};
}

/** @type {Array<[string, RegExp]>} */
const hints=[
 ['happy',/happy|smile|开心|高兴|微笑|笑脸/i],['shy',/shy|blush|害羞|脸红/i],['angry',/angry|anger|生气|愤怒/i],['sad',/sad|难过|悲伤/i],['cry',/cry|tear|哭|流泪/i],['surprised',/surpris|shock|惊讶|吃惊/i],['sleepy',/sleepy|tired|困倦|困了/i],['wink',/wink|眨眼/i],['love',/love|heart|喜欢|爱心/i],['thinking',/think|思考/i],['nod',/\bnod\b|点头/i],['shake',/\bshake\b|摇头/i],['wave',/\bwave\b|挥手|招手/i],['bow',/\bbow\b|鞠躬/i],['cheer',/cheer|欢呼/i],['dance',/dance|跳舞/i],['idle',/\bidle\b|待机|呼吸/i],['stretch',/stretch|伸懒腰/i],
];

const appearancePattern=/眼镜|眼鏡|单片|單片|脱鞋|脫鞋|鞋子|体型|體型|尾巴开关|尾巴開關|尾巴切换|尾巴切換|衣|裙|袜|帽|服装|换装|水印|标志|logo|shuiyin|glasses|monocle|shoe|body.?type|tail.?toggle|cloth|outfit|accessory|weapon|toggle/i;
const round=n=>Math.round(n*1e5)/1e5;
/** Exact value extrema for supported cubic segments; labels never establish semantics. */
export function curveSummary(curve){
 compileCurve(curve);
 const s=curve.Segments,points=[{time:s[0],value:s[1]}];let at=2,t=s[0],v=s[1];
 const bez=(a,b,c,d,u)=>(1-u)**3*a+3*(1-u)**2*u*b+3*(1-u)*u*u*c+u**3*d;
 while(at<s.length){
  const kind=s[at++],size=kind===1?6:2,p=s.slice(at,at+size);at+=size;
  const end=p.at(-2),value=p.at(-1);
  if(kind===1){
   const a=-v+3*p[1]-3*p[3]+value,b=2*(v-2*p[1]+p[3]),c=p[1]-v;
   const disc=b*b-4*a*c,roots=Math.abs(a)<1e-12?(Math.abs(b)<1e-12?[]:[-c/b]):disc<0?[]:[(-b+Math.sqrt(disc))/(2*a),(-b-Math.sqrt(disc))/(2*a)];
   for(const u of roots.filter(u=>u>0&&u<1))points.push({time:bez(t,p[0],p[2],end,u),value:bez(v,p[1],p[3],value,u)});
  }
  points.push({time:end,value});t=end;v=value;
 }
 points.sort((a,b)=>a.time-b.time);
 let min=Infinity,max=-Infinity,peak=points[0],direction=0,turns=0;
 for(let i=0;i<points.length;i++){
  const p=points[i];min=Math.min(min,p.value);max=Math.max(max,p.value);
  if(Math.abs(p.value-s[1])>Math.abs(peak.value-s[1]))peak=p;
  if(i){const next=Math.sign(p.value-points[i-1].value);if(next){if(direction&&next!==direction)turns++;direction=next;}}
 }
 return {start:s[1],end:v,min:round(min),max:round(max),peakTime:round(peak.time),turns,returnsToStart:max-min>.001&&Math.abs(v-s[1])<.01};
}

/** @param {{id:string,dir:string,file:string,kind:string,title:string}} model
 * @param {{signal?:AbortSignal}} options */
export async function inspectNative(model,{signal}={}){
 const root=model.dir,manifest=await readJson(await localFile(root,model.file));
 const refs=manifest.FileReferences?.FileReferences||manifest.FileReferences||{};
 const metadata=new Map(),hintsByFile=new Map(),resources=[],warnings=[],metadataHashes=[];let scanned=0;
 const names=await readdir(root,{withFileTypes:true});
 for(const entry of names.filter(e=>e.isFile()&&/\.cdi3\.json$/i.test(e.name))){
  const cdi=await readJson(await localFile(root,entry.name)).catch(()=>({}));
  metadataHashes.push([entry.name,digest(JSON.stringify(cdi))]);
  for(const p of cdi.Parameters||[])if(typeof p.Id==='string')metadata.set(p.Id,{name:String(p.Name||p.Id).slice(0,100),group:String(p.GroupId||'').slice(0,80)});
 }
 for(const entry of names.filter(e=>e.isFile()&&/\.vtube\.json$/i.test(e.name))){
  const data=await readJson(await localFile(root,entry.name,8*1048576)).catch(()=>({}));
  metadataHashes.push([entry.name,digest(JSON.stringify(data))]);
  for(const h of data.Hotkeys||[])if(typeof h.File==='string')hintsByFile.set(h.File.replaceAll('\\','/').toLowerCase(),String(h.Name||'').slice(0,120));
 }
 const candidates=new Map(),seenFiles=new Set(),discovered=new Set();
 const add=(file,group='')=>{if(typeof file==='string'){const key=file.replaceAll('\\','/');if(!candidates.has(key)||group)candidates.set(key,group);}};
 for(const [group,list]of Object.entries(refs.Motions||{}))if(Array.isArray(list))for(const m of list)add(m.File,group);
 for(const e of refs.Expressions||[])add(e.File,e.Name||'');
 for(const file of hintsByFile.keys())add(file);
 async function walk(dir,depth){
  signal?.throwIfAborted();if(scanned>3000||candidates.size>512)return;
  for(const e of await readdir(dir,{withFileTypes:true})){
   if(++scanned>3000)break;
   const file=join(dir,e.name);
   if(e.isFile()&&/\.(motion3|exp3)\.json$/i.test(e.name)){const rel=relative(root,file).replaceAll('\\','/');discovered.add(rel);add(rel);}
   else if(e.isDirectory()&&!e.isSymbolicLink()&&depth<3)await walk(file,depth+1);
  }
 }
 await walk(root,0);
 for(const [rel,group]of candidates){
  signal?.throwIfAborted();if(resources.length>=256)break;
  if(!/\.(motion3|exp3)\.json$/i.test(rel))continue;
  try{
   const matches=[...discovered].filter(p=>basename(p).toLowerCase()===basename(rel).toLowerCase());
   const located=!rel.includes('/')&&matches.length===1?matches[0]:rel;
   const file=await localFile(root,located),canonical=await realpath(file),key=process.platform==='win32'?canonical.toLowerCase():canonical;
   if(seenFiles.has(key))continue;seenFiles.add(key);
   const raw=await readFile(file),json=JSON.parse(raw.toString('utf8').replace(/^\uFEFF/,''));
   const kind=/\.exp3\.json$/i.test(rel)?'expression':'motion';
   if(kind==='motion')for(const c of json.Curves||[])if(['Parameter','PartOpacity'].includes(c.Target))compileCurve(c);
   const title=String(hintsByFile.get(rel.toLowerCase())||hintsByFile.get(basename(rel).toLowerCase())||group||basename(rel).replace(/\.(motion3|exp3)\.json$/i,'')).slice(0,120);
   const values=kind==='expression'?(json.Parameters||[]).map(p=>({id:p.Id,value:Number(p.Value),blend:p.Blend||'Add'})):(json.Curves||[]).filter(c=>c.Target==='Parameter'||c.Target==='PartOpacity').map(c=>({id:c.Id,target:c.Target,...curveSummary(c)}));
   if(values.length>2048||!values.length||values.some(v=>typeof v.id!=='string'||v.id.length>200||kind==='expression'&&(!Number.isFinite(v.value)||!['Add','Multiply','Overwrite'].includes(v.blend))))throw Error('无有效参数或曲线过多');
   const label=values.map(v=>`${v.id} ${metadata.get(v.id)?.name||''} ${metadata.get(v.id)?.group||''}`).join(' '),text=`${title} ${basename(rel)} ${label}`;
   const appearance=appearancePattern.test(text);
   const pose=kind==='motion'&&values.some(v=>Math.abs(v.end-v.start)>=.01)&&(/打开|关闭|开启|收起|放下|抬起|手|臂|pose|arm|hand/i.test(text));
   const classification=appearance?'appearance':pose?'pose':kind==='expression'?'expression':/idle|待机/i.test(text)?'idle':'gesture';
   const hit=hints.find(([,rx])=>rx.test(`${title} ${basename(rel)}`));
   const candidate=hit&&!appearance?{word:hit[0],confidence:.82,reason:'文件名或作者热键含明确动作／表情含义'}:null;
   const sourceRel=relative(root,canonical).replaceAll('\\','/');
   resources.push({id:(kind==='motion'?'motion-':'expr-')+digest(sourceRel).slice(0,16),kind,file:sourceRel,title,classification,seconds:kind==='motion'?Math.max(.05,Math.min(60,Number(json.Meta?.Duration)||1)):1.5,loop:json.Meta?.Loop===true,hash:digest(raw),parameters:values.map(v=>({...v,label:metadata.get(v.id)?.name||v.id})),suggestion:candidate,raw:json,release:undefined});
  }catch(e){warnings.push(`${rel}: ${e.message}`);}
 }
 // A friendly filename cannot hide channels already identified as appearance controls.
 const appearanceChannels=new Set(resources.filter(r=>r.classification==='appearance').flatMap(r=>r.parameters.map(p=>(p.target||'Parameter')+':'+p.id)));
 for(const r of resources)if(r.parameters.some(p=>appearanceChannels.has((p.target||'Parameter')+':'+p.id))){r.classification='appearance';r.suggestion=null;}
 // Pair transitions by their parameter channels and reversed endpoints, independent of model names.
 for(const a of resources.filter(r=>r.classification==='pose')){
  const opposite=resources.filter(b=>reversePose(a,b));
  if(opposite.length===1)a.release=opposite[0].id;
 }
 const assets=[];
 for(const name of [refs.Moc,refs.Physics,refs.Pose,refs.DisplayInfo,...(refs.Textures||[])].filter(v=>typeof v==='string')){
  signal?.throwIfAborted();
  try{
   const file=await localFile(root,name,512*1048576),hash=createHash('sha256');
   for await (const chunk of createReadStream(file,{signal})) hash.update(chunk);
   assets.push([name,hash.digest('hex')]);
  }catch(e){signal?.throwIfAborted();assets.push([name,'missing']);}
 }
 const fingerprint=digest(JSON.stringify({model:await readFile(await localFile(root,model.file),'utf8'),assets,metadataHashes,resources:resources.map(r=>[r.file,r.hash])}));
 return {model,fingerprint,resources,warnings,truncated:scanned>3000||resources.length>=256};
}

export function validateBindings(catalog,bindings){
 if(!Array.isArray(bindings)||bindings.length>40)throw Error('映射必须是最多 40 项的数组');
 const used=new Set();return bindings.map(b=>{
  if(!b||!WORDS.has(b.word)||used.has(b.word))throw Error('动作词无效或重复');
  used.add(b.word);const r=catalog.resources.find(r=>r.id===b.resource);if(!r)throw Error('映射引用了不存在的资源');
  if(r.classification==='appearance')throw Error('外观资源不能映射为情绪或动作，请保留通用表现');
  if(r.kind==='expression'&&!FACE_WORDS.includes(b.word))throw Error('表情资源须映射到表情词');
  const release=b.release?catalog.resources.find(r=>r.id===b.release):null;
  if(b.release&&(!release||release.kind!=='motion'||r.kind!=='motion'))throw Error('复位动作无效');
  if(release?.classification==='appearance')throw Error('外观资源不能作为复位动作');
  if(release&&!reversePose(r,release))throw Error('复位动作的参数与原姿态不匹配');
  if(r.classification==='pose'&&!release)throw Error('姿态切换必须包含复位动作，否则保留通用表现');
  return {word:b.word,resource:r.id,...(release?{release:release.id}:{}),reason:String(b.reason||r.suggestion?.reason||'按动作内容匹配').slice(0,200),confidence:Number.isFinite(b.confidence)?Math.max(0,Math.min(1,b.confidence)):.5};
 });
}

export function nativeConfig(catalog,bindings,{includeAll=false}={}){
 const selected=validateBindings(catalog,bindings),wanted=new Set(selected.flatMap(b=>[b.resource,b.release].filter(Boolean)));
 return {version:1,bindings:selected,resources:catalog.resources.filter(r=>includeAll||wanted.has(r.id)).map(r=>({id:r.id,kind:r.kind,title:r.title,seconds:r.seconds,classification:r.classification,data:r.raw}))};
}

export function publicCatalog(catalog){
 return {...catalog,resources:catalog.resources.map(({raw,...r})=>({...r,parameters:r.parameters.slice(0,40)}))};
}
