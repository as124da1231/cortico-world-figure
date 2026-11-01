import {test} from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {patchPreviewHost} from '../scripts/local-preview-host.mjs';
const {allows,clean}=createRequire(import.meta.url)('../scripts/preview-host.cjs');
const token='12345678-1234-1234-1234-123456789abc',origin='http://127.0.0.1:17788',url=`http://127.0.0.1:48000/figure-preview/${token}/frame.html`;
test('local host forwarding accepts only scoped read-only previews and strips credentials',()=>{
 const request=new Request(url,{referrer:origin+'/',headers:{cookie:'example=test',authorization:'Bearer test'}});assert.equal(allows(request,origin),true);assert.equal(clean(request).headers.has('cookie'),false);assert.equal(clean(request).headers.has('authorization'),false);
 for(const request of [new Request(url,{method:'POST'}),new Request(url.replace('127.0.0.1','example.com')),new Request(url.replace('/figure-preview/','/private/')),new Request(url.replace(token,'wrong')),new Request(url,{referrer:'https://example.com/'})])assert.equal(allows(request,origin),false);
 assert.equal(allows(new Request(url.replace('48000','17788')),origin),false);
});
test('unknown host builds are refused and an existing adapter is left intact',()=>{
 assert.throws(()=>patchPreviewHost('unknown'),/Unknown/);assert.equal(patchPreviewHost('/* figure-local-preview-v1 */'),'/* figure-local-preview-v1 */');
});
