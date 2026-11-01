import {createServer, type Server} from 'node:http';
import {readFile,lstat,realpath} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';

const MIME:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.moc3':'application/octet-stream'};
/** Read-only capability URLs; no model is registered in the wardrobe. */
export class PreviewServer {
  private server:Server|null=null;
  private opening:Promise<void>|null=null;
  private origin='';
  private find:(token:string)=>any;
  constructor(find:(token:string)=>any){this.find=find;}
  async start(){
    if(this.opening)await this.opening;
    if(this.server)return this.origin;
    const server=createServer(async(req,res)=>{
      try{
        if(req.headers.host!==new URL(this.origin).host){res.writeHead(421).end();return;}
        if(!['GET','HEAD'].includes(req.method||'')){res.writeHead(405).end();return;}
        const url=new URL(req.url||'/',this.origin),match=/^\/figure-preview\/([a-f0-9-]{36})\/(.+)$/.exec(url.pathname);
        if(!match){res.writeHead(404).end();return;}
        const session=this.find(match[1]);if(!session){res.writeHead(404).end();return;}
        const path=decodeURIComponent(match[2]);
        const origin=req.headers.origin;
        if(origin&&origin!=='null'&&!/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(origin)){res.writeHead(403).end();return;}
        const headers:Record<string,string>={'cache-control':'no-store','x-content-type-options':'nosniff','access-control-allow-origin':origin||'null','vary':'Origin','referrer-policy':'no-referrer'};
        let bytes:Buffer;
        if(path==='frame.html'){
          headers['content-security-policy']=`sandbox allow-scripts; default-src 'none'; script-src ${this.origin}; img-src ${this.origin} data:; style-src 'unsafe-inline'; connect-src ${this.origin}; frame-ancestors http://127.0.0.1:* http://localhost:*`;
          bytes=Buffer.from('<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;overflow:hidden;background:transparent}#root{position:absolute;inset:0}</style></head><body><div id="root"></div><script type="module" src="./web/figure-frame.js"></script></body></html>');
        }else{
          if(!session.files.some((f:any)=>f.path===path)||path.endsWith('native-library.json')||path.endsWith('build.json')){res.writeHead(404).end();return;}
          const file=resolve(session.dir,path),root=resolve(session.dir)+sep;
          if(!file.startsWith(root)||(await lstat(file)).isSymbolicLink()||!(await realpath(file)).startsWith(root)){res.writeHead(403).end();return;}
          bytes=await readFile(file);
        }
        headers['content-type']=MIME[extname(path)]||'application/octet-stream';
        res.writeHead(200,headers);res.end(req.method==='HEAD'?undefined:bytes);
      }catch{if(!res.headersSent)res.writeHead(404);res.end();}
    });
    this.opening=new Promise<void>((ok,bad)=>{server.once('error',bad);server.listen(0,'127.0.0.1',()=>{this.origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;this.server=server;ok();});});
    try{await this.opening;return this.origin;}finally{this.opening=null;}
  }
  async stop(){const server=this.server;this.server=null;if(server){server.closeAllConnections();await new Promise<void>(ok=>server.close(()=>ok()));}}
}
