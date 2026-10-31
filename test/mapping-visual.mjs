// Optional local WebGL inspection. No model assets leave the loopback server.
// node --experimental-strip-types test/mapping-visual.mjs <pack> <output-dir> [plan.json]
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join, extname, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { findBrowser } from '../src/cover.ts';

const [packArg, outArg, planArg] = process.argv.slice(2);
if (!packArg || !outArg) throw new Error('Provide pack and output directory');
const pack = resolve(packArg); const out = resolve(outArg);
await mkdir(out, { recursive: true });
const plan = planArg ? JSON.parse(await readFile(planArg, 'utf8')) : null;
const runtime = process.env.L2D_VISUAL_RUNTIME === 'workspace' ? resolve('workbench/pack') : pack;
const performanceEnabled = process.env.L2D_VISUAL_PERFORMANCE === '1';
const failMasks = Number(process.env.L2D_VISUAL_FAIL_MASKS || 0);
const scratch = await mkdtemp(join(tmpdir(), 'figure-mapping-browser-'));
let finish; let fail;
const done = new Promise((ok, bad) => { finish = ok; fail = bad; });
const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#eee">
<svg width="768" height="768" viewBox="0 0 256 256"><g id="pet"></g></svg>
<script type="module">
try {
 const mod = await import('/pack/figure.js');
 const root = document.body; let figure;
 const kit = { createBody(host, opts) { figure = opts.figure; return {set(){},place(){},step(){}}; } };
 const loadImage = u => new Promise((ok,bad)=>{const img=new Image();img.onload=()=>ok(img);img.onerror=bad;img.src=String(u);});
 await mod.createFigureBody(new URL('/pack/',location.origin), { kit, host:{root}, loadImage });
 let ready=false;
 for(let wait=0;wait<150;wait++){
   await new Promise(r=>setTimeout(r,200));
   if(figure.__cover?.()){ready=true;break;}
 }
 if(!ready)throw new Error('Model textures did not become ready');
 const pet=document.getElementById('pet');
 const model=globalThis.__mappingTestModel;
 const captures=[]; const states=${performanceEnabled
   ? JSON.stringify([['neutral',{}],['happy',{}],['sad',{}],['angry',{}],['surprised',{}],['sleepy',{}]])
   : JSON.stringify(failMasks ? [['neutral',{}],['surprised',{}]] : [['neutral',{}],['blush25',{cheek:.25}],['blush100',{cheek:1}],['smile',{eyeSmile:1}],['left',{angleX:-.5}],['right',{angleX:.5}],['up',{angleY:.5}],['tilt',{angleZ:.5}],['body',{bodyX:.5}],['surprised',{}]])};
 let t=0;
 for(const [name,values] of states){
   figure.__roles.clear();figure.__roles.set(values);
   for(let f=0;f<180;f++)figure.draw(pet,{gap:[44]}, {dt:1/60,t:t+=1/60,face:${performanceEnabled ? 'name' : "name === 'surprised' ? name : 'neutral'"},look:[0,0]});
   const png=document.querySelector('canvas').toDataURL();
   const params={};for(let i=0;i<model.getParameterCount();i++){const id=model.getParameterId(i).getString();if(['key1','key7','ParamMouthOpenY','ParamAngleX','ParamAngleY','ParamAngleZ','ParamBodyAngleX','AngleX','AngleY','AngleZ','PositionX','EyeSmile'].includes(id))params[id]=model.getParameterValueByIndex(i);}
   captures.push({name,png,params});
 }
 await fetch('/result',{method:'POST',body:JSON.stringify({captures,info:globalThis.__l2dInfo})});
}catch(e){await fetch('/result',{method:'POST',body:JSON.stringify({error:String(e.stack||e)})});}
</script>`;
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/result' && req.method === 'POST') {
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 32e6) throw new Error('Result too large'); chunks.push(chunk); }
      const result = JSON.parse(Buffer.concat(chunks));
      if (result.error) { res.end('error'); fail(new Error(result.error)); return; }
      for (const shot of result.captures) {
        if (!/^[a-z0-9]+$/.test(shot.name)) throw new Error('Invalid capture name');
        await writeFile(join(out, shot.name + '.png'), Buffer.from(shot.png.split(',')[1], 'base64'));
        delete shot.png;
      }
      await writeFile(join(out, 'results.json'), JSON.stringify(result, null, 2));
      res.end('ok'); finish(result); return;
    }
    if (url.pathname === '/') { res.setHeader('content-type', 'text/html'); res.end(html); return; }
    if (!url.pathname.startsWith('/pack/')) { res.writeHead(404).end(); return; }
    const rel = decodeURIComponent(url.pathname.slice(6));
    const file = resolve(pack, rel); const diff = relative(pack, file);
    if (diff.startsWith('..') || isAbsolute(diff)) { res.writeHead(403).end(); return; }
    let data;
    if (rel.startsWith('backends/')) {
      data = await readFile(join(runtime, rel), 'utf8');
      if (rel === 'backends/live2d.js') data = data.replace('const driven = new Set();', 'globalThis.__mappingTestModel = model._model; const driven = new Set();');
      if (rel === 'backends/render-config.js' && failMasks) data = data.replace('const buffers = renderer._drawableMasks;', `if (attempt.mode === 'packed' ${failMasks > 1 ? "|| attempt.mode === 'compatible'" : ''}) throw new Error('simulated mask allocation failure'); const buffers = renderer._drawableMasks;`);
    } else if (rel.endsWith('/profile.js')) {
      const profile = structuredClone((await import(pathToFileURL(file))).default);
      if (plan) profile.roles = plan.roleTable;
      if (!performanceEnabled) { profile.performance = { enabled: false }; }
      data = 'export default ' + JSON.stringify(profile);
    } else data = await readFile(file);
    res.setHeader('content-type', ({ '.js':'text/javascript', '.png':'image/png', '.json':'application/json' })[extname(file)] ?? 'application/octet-stream');
    res.end(data);
  } catch (e) { res.writeHead(500).end(String(e.message)); }
});
await new Promise((ok, bad) => { server.once('error', bad); server.listen(0, '127.0.0.1', ok); });
const browser = findBrowser(); if (!browser) throw new Error('Chrome / Edge not found');
const child = spawn(browser, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--enable-unsafe-swiftshader', '--user-data-dir=' + scratch, 'http://127.0.0.1:' + server.address().port], { windowsHide: true, stdio: 'ignore' });
child.once('error', fail);
const timeout = setTimeout(() => fail(new Error('WebGL inspection timed out')), 60000);
try { const result = await done; console.log(JSON.stringify(result)); }
finally { clearTimeout(timeout); child.kill(); server.closeAllConnections(); server.close(); await new Promise(r => setTimeout(r, 500)); await rm(scratch, { recursive: true, force: true, maxRetries: 3 }).catch(() => {}); }
