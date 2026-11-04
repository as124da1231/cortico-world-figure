import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {wardrobeSamples,captureWardrobeThumbnails,findBrowser} from '../src/cover.ts';
test('wardrobe thumbnails follow host axis order, include defaults, and do not touch model choices',()=>{
 const m={axes:[{id:'model',options:[{id:'frog'}]},{id:'lookhat',options:[{id:'default'},{id:'on'}]},{id:'lookcoat',options:[{id:'default'},{id:'red'}]}]};
 assert.deepEqual(wardrobeSamples(m,[{id:'lookhat',options:[{}]},{id:'lookcoat',options:[{}]}]).map(s=>s.scheme),['frog-default-default','frog-on-default','frog-default-default','frog-default-red']);
});
test('real browser captures distinct option thumbnails and preserves the existing cover', {skip:!findBrowser()},async t=>{
 const root=await mkdtemp(join(tmpdir(),'figure-wardrobe-cover-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'thumb'));
 const manifest={axes:[{id:'model',options:[{id:'frog',thumb:'thumb/model.png'}]},{id:'lookhat',options:[{id:'default'},{id:'on'}]}],thumb:'thumb/cover.png'};
 await writeFile(join(root,'figure.json'),JSON.stringify(manifest));await writeFile(join(root,'native-library.json'),JSON.stringify({wardrobe:[{id:'lookhat',options:[{id:'on'}]}]}));await writeFile(join(root,'thumb/cover.png'),'keep cover');
 await writeFile(join(root,'figure.js'),`export async function createFigureBody(){let scheme='';globalThis.__l2dCover=()=>{const c=document.createElement('canvas');c.width=c.height=128;const x=c.getContext('2d');x.fillStyle=scheme.endsWith('-on')?'red':'blue';x.fillRect(0,0,128,128);return {png:c.toDataURL(),png128:c.toDataURL()};};return {do(){},set(){},setScheme(s){scheme=s;}};}`);
 const result=await captureWardrobeThumbnails(root,new URL('../workbench',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));assert.equal(result.ok,true,result.error);assert.equal(result.thumbnails,2);
 const updated=JSON.parse(await readFile(join(root,'figure.json')));const [a,b]=await Promise.all(updated.axes[1].options.map(o=>readFile(join(root,o.thumb))));assert.notDeepEqual(a,b);assert.equal(a.readUInt32BE(16),128);assert.equal(await readFile(join(root,'thumb/cover.png'),'utf8'),'keep cover');assert.deepEqual(updated.axes[0],manifest.axes[0]);
});
