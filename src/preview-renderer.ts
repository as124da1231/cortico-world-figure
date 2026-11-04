import http from 'node:http';
import {spawn,type ChildProcess} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {extname,join,resolve,sep} from 'node:path';
import {findBrowser,pngOf} from './cover.ts';
import type {StaticPreviewPlan} from './manual-preview.ts';

export interface PreviewResult { frames:any[]; quality:any }
export interface PreviewWorker { readonly closed:boolean; render(plan:StaticPreviewPlan,signal:AbortSignal):Promise<PreviewResult>; close():Promise<void> }
const MIME:Record<string,string>={'.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'};

// One page and browser per editor. Jobs change parameters; only precision changes rebuild the body.
const PAGE=`<!doctype html><meta charset="utf-8"><style>html,body{margin:0}#root{position:relative;width:620px;height:620px}</style><div id="root"></div><script type="module">
const base=new URL('./',location.href),root=document.querySelector('#root'),bounds={W:620,H:620,floorY:512,S:2};
const post=(name,value)=>fetch(new URL(name,base),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});
const delay=ms=>new Promise(r=>setTimeout(r,ms));let body=null,size=0,loads=0;
try{
 const kit=await import(new URL('kit/body.js',base)),mod=await import(new URL('pack/figure.js',base));
 const loadImage=u=>new Promise((ok,bad)=>{const image=new Image();image.crossOrigin='anonymous';image.onload=()=>ok(image);image.onerror=()=>bad(Error('贴图加载失败'));image.src=String(u);});
 for(;;){
  const response=await fetch(new URL('job',base));if(!response.ok)break;const job=await response.json();if(!job.id)continue;
  try{
   if(!body||size!==job.plan.size){
    body?.dispose?.();body=null;root.replaceChildren();globalThis.__l2dPreviewReady=null;
    body=await mod.createFigureBody(new URL('pack/',base),{kit,preview:true,previewSize:job.plan.size,loadImage,asset:p=>new URL(p,new URL('pack/',base)),scheme:'',host:{root,bounds:()=>bounds,emit(){},sound(){},start:{x:310,facing:1}}});
    body.set?.({roam:'off'});body.do?.('neutral');const deadline=performance.now()+20000;
    while(!globalThis.__l2dPreviewReady?.()){
     const quality=globalThis.__l2dRenderQuality?.();if(quality?.error)throw Error(quality.error);
     if(performance.now()>deadline)throw Error('模型加载超时');body.step(1/60);await delay(8);
    }
    size=job.plan.size;loads++;
   }
   globalThis.__l2dPreview.wardrobe(job.plan.groups,{});
   const frames=job.plan.samples.map(sample=>({...sample,...globalThis.__l2dStaticSample(sample)}));
   await post('result',{id:job.id,frames,quality:globalThis.__l2dRenderQuality(),modelLoads:loads});
  }catch(error){body?.dispose?.();body=null;size=0;await post('result',{id:job.id,error:String(error.message||error)});}
 }
}catch(error){await post('fatal',{error:String(error.message||error)}).catch(()=>{});}
body?.dispose?.();
</script>`;

export function previewResult(plan:StaticPreviewPlan,body:any):PreviewResult {
  if(body.error)throw Error(String(body.error));
  if(!Array.isArray(body.frames)||body.frames.length!==plan.samples.length)throw Error('预览图片不完整');
  const frames=body.frames.map((frame:any,i:number)=>{
    const png=pngOf(frame.png);
    if(png.length<24||png.length>plan.size*plan.size*4+4096||png.readUInt32BE(16)!==plan.size||png.readUInt32BE(20)!==plan.size)throw Error('预览图片尺寸无效');
    return {...plan.samples[i],png:frame.png,fit:frame.fit,picks:frame.picks,values:frame.values};
  });
  const q=body.quality;
  if(q?.error)throw Error(q.error);
  if(q?.textureLimit!==plan.size||!Array.isArray(q.canvas)||q.canvas.length!==2||q.canvas.some((n:number)=>!Number.isFinite(n)||n<1||n>plan.size)||q.maskSize>plan.size)throw Error('预览画质上限无效');
  return {frames,quality:{...q,modelLoads:body.modelLoads}};
}

export class StaticPreviewRenderer implements PreviewWorker {
  closed=false;
  private server?:http.Server;
  private child?:ChildProcess;
  private profile='';
  private started?:Promise<void>;
  private closing?:Promise<void>;
  private prefix='/'+randomUUID()+'/';
  private origin='';
  private waiter?:http.ServerResponse;
  private queue?:{id:string;plan:StaticPreviewPlan};
  private pending=new Map<string,{plan:StaticPreviewPlan;resolve:(v:PreviewResult)=>void;reject:(e:Error)=>void;dispose:()=>void}>();
  constructor(privatePack:string,privateWorkbench:string){this.pack=resolve(privatePack);this.workbench=resolve(privateWorkbench);}
  private pack:string;
  private workbench:string;
  private start(){return this.started??=this.launch();}
  private async launch(){
    if(this.closed)throw Error('预览已关闭');
    const browser=findBrowser();if(!browser)throw Error('未找到 Chrome / Edge，无法生成预览');
    this.server=http.createServer((req,res)=>void this.handle(req,res).catch(()=>{if(!res.headersSent)res.writeHead(500);res.end();}));
    await new Promise<void>((ok,bad)=>{this.server!.once('error',bad);this.server!.listen(0,'127.0.0.1',ok);});
    if(this.closed){await this.close();throw Error('预览已关闭');}
    this.origin='http://127.0.0.1:'+(this.server.address() as {port:number}).port;
    this.profile=await mkdtemp(join(tmpdir(),'l2d-preview-'));
    if(this.closed)throw Error('预览已关闭');
    this.child=spawn(browser,['--headless=new','--disable-gpu','--enable-unsafe-swiftshader','--disable-background-timer-throttling','--hide-scrollbars','--mute-audio','--no-first-run','--window-size=640,640','--user-data-dir='+this.profile,this.origin+this.prefix],{windowsHide:true,stdio:'ignore'});
    this.child.once('error',e=>this.fail('启动预览失败：'+e.message));
    this.child.once('exit',()=>{if(!this.closed)this.fail('预览进程已退出，请重试');});
  }
  private fail(message:string){for(const job of this.pending.values()){job.dispose();job.reject(Error(message));}this.pending.clear();void this.close();}
  private deliver(){if(this.waiter&&this.queue){const res=this.waiter;this.waiter=undefined;const job=this.queue;this.queue=undefined;res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(job));}}
  private async handle(req:http.IncomingMessage,res:http.ServerResponse){
    const url=new URL(req.url||'/',this.origin||'http://127.0.0.1');
    if(this.closed){res.writeHead(410).end();return;}
    if(!url.pathname.startsWith(this.prefix)||req.headers.origin&&req.headers.origin!==this.origin){res.writeHead(403).end();return;}
    const path=url.pathname.slice(this.prefix.length);
    if(req.method==='GET'&&path==='job'){
      if(this.waiter){res.writeHead(409).end();return;}
      this.waiter=res;const timer=setTimeout(()=>{if(this.waiter===res){this.waiter=undefined;res.writeHead(200,{'content-type':'application/json'}).end('{}');}},20000);timer.unref();
      res.once('close',()=>{clearTimeout(timer);if(this.waiter===res)this.waiter=undefined;});this.deliver();return;
    }
    if(req.method==='POST'&&(path==='result'||path==='fatal')){
      let raw='';for await(const data of req){raw+=data;if(raw.length>18*1048576){res.writeHead(413).end();return;}}
      const body=JSON.parse(raw);res.writeHead(200).end('ok');
      if(path==='fatal'){this.fail(String(body.error||'预览初始化失败'));return;}
      const job=this.pending.get(body.id);if(!job)return;this.pending.delete(body.id);job.dispose();
      try{job.resolve(previewResult(job.plan,body));}catch(error){job.reject(error as Error);}return;
    }
    if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405).end();return;}
    if(!path){res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}).end(req.method==='HEAD'?'':PAGE);return;}
    const kit=path.startsWith('kit/');if(!kit&&!path.startsWith('pack/')){res.writeHead(404).end();return;}
    const root=kit?resolve(this.workbench,'vendor/coo-kit'):this.pack,file=resolve(root,decodeURIComponent(kit?path:path.slice(5)));
    if(!file.startsWith(root+sep)){res.writeHead(403).end();return;}
    try{const bytes=await readFile(file);res.writeHead(200,{'content-type':MIME[extname(file).toLowerCase()]||'application/octet-stream','cache-control':'no-store'}).end(req.method==='HEAD'?undefined:bytes);}catch{res.writeHead(404).end();}
  }
  async render(plan:StaticPreviewPlan,signal:AbortSignal):Promise<PreviewResult>{
    signal.throwIfAborted();try{await this.start();}catch(error){await this.close();throw error;}signal.throwIfAborted();if(this.closed)throw Error('预览已关闭');
    return new Promise((resolveJob,reject)=>{
      const id=randomUUID(),dispose=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);},abort=()=>{this.pending.delete(id);if(this.queue?.id===id)this.queue=undefined;dispose();reject(Error('预览已取消'));};
      const timer=setTimeout(()=>{this.pending.delete(id);if(this.queue?.id===id)this.queue=undefined;dispose();reject(Error('预览生成超时，请重试'));void this.close();},45000);timer.unref();
      this.pending.set(id,{plan,resolve:resolveJob,reject,dispose});signal.addEventListener('abort',abort,{once:true});this.queue={id,plan};this.deliver();
    });
  }
  close():Promise<void>{
    if(this.closing)return this.closing;this.closed=true;
    return this.closing=(async()=>{
      this.queue=undefined;for(const job of this.pending.values()){job.dispose();job.reject(Error('预览已关闭'));}this.pending.clear();this.waiter?.writeHead(410).end();this.waiter=undefined;
      const child=this.child;if(child&&child.exitCode===null){await new Promise<void>(ok=>{const timer=setTimeout(ok,2000);child.once('exit',()=>{clearTimeout(timer);ok();});try{child.kill();}catch{clearTimeout(timer);ok();}});}
      const server=this.server;if(server){server.closeAllConnections();await new Promise<void>(ok=>server.close(()=>ok()));}
      if(this.profile)await rm(this.profile,{recursive:true,force:true}).catch(()=>{});
    })();
  }
}
