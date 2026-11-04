import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,cp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';

test('the optional local workbench rejects foreign website writes and import-directory traversal',async t=>{
  const root=await mkdtemp(join(tmpdir(),'figure-workbench-'));
  const directory=join(root,'tools','workbench');await mkdir(directory,{recursive:true});
  const serverFile=join(directory,'server.mjs');await cp(new URL('../workbench/tools/workbench/server.mjs',import.meta.url),serverFile);
  await cp(new URL('../workbench/vendor/coo-kit/',import.meta.url),join(root,'vendor','coo-kit'),{recursive:true});
  const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
  const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,[serverFile,'--no-coo','--port',String(port)],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  t.after(async()=>{if(child.exitCode===null){const closed=new Promise(resolve=>child.once('close',resolve));child.kill();await closed;}await rm(root,{recursive:true,force:true});});
  const origin=await new Promise((resolve,reject)=>{
    let output='',error='';const timer=setTimeout(()=>reject(Error('workbench startup timed out')),5000);
    child.stderr.on('data',data=>{error+=data;});
    child.once('error',reject);child.stdout.on('data',data=>{output+=data;const match=/workbench\(simple\) (http:\/\/127\.0\.0\.1:\d+)/.exec(output);if(match){clearTimeout(timer);resolve(match[1]);}});
    child.once('exit',code=>{if(code){clearTimeout(timer);reject(Error('workbench startup failed: '+error.slice(0,1500)));}});
  });
  const blocked=await fetch(origin+'/api/import/begin',{method:'POST',headers:{origin:'https://unrelated.invalid','content-type':'application/json'},body:'{"name":"test"}'});
  assert.equal(blocked.status,403);
  const escape=await fetch(origin+'/api/import/file?id=../../outside&rel=keep.txt',{method:'POST',body:'unsafe'});
  assert.equal(escape.status,400);
  const valid=await fetch(origin+'/api/import/begin',{method:'POST',headers:{origin,'content-type':'application/json'},body:'{"name":"test"}'});
  assert.equal(valid.status,200);assert((await valid.json()).id);
});
