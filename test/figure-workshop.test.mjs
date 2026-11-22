import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {downloadFigureSource, figureCatalog, figureHostAction} from '../src/figure-workshop.mjs';
test('catalog keeps credentials on backend and pins content URL', async () => {
  const calls=[];
  const host={hostServices:{get:()=>({signIn:async()=>({status:'ready',session:{issuer:'https://hub.example',audience:'cortico-world-figure',accessToken:'secret'}})})}};
  const fetcher=async (url,opts)=>{calls.push([url,opts]);return {ok:true,json:async()=>calls.length===1?{ok:true,result:{ticket:'ticket',url:'https://8.137.59.209/figure-workshop/v1/list'}}:{items:[{title:'A'}]}}};
  assert.deepEqual(await figureCatalog(host,{query:'A'},fetcher),{status:'ready',items:[{title:'A'}],more:false});
  assert.equal(calls[0][1].headers.Authorization,'Bearer secret');
  assert.equal(calls[1][1].headers.Authorization,'Bearer ticket');
  assert.equal(calls[0][1].redirect,'error');
});
test('no host and mismatched ticket target are rejected',async()=>{
  assert.equal((await figureCatalog(null)).status,'host_unavailable');
  const host={hostServices:{get:()=>({signIn:async()=>({status:'ready',session:{issuer:'https://hub.example',audience:'cortico-world-figure',accessToken:'secret'}})})}};
  await assert.rejects(()=>figureCatalog(host,{},async()=>({ok:true,json:async()=>({ok:true,result:{ticket:'ticket',url:'https://evil.example'}})})));
});
test('direct import binds download to the approved revision and verifies every byte', async () => {
  const item = 'a'.repeat(32), data = Buffer.from('sample archive');
  const sha256 = createHash('sha256').update(data).digest('hex');
  const host = { hostServices:{ get:()=>({ signIn:async()=>({status:'ready',
    session:{issuer:'https://hub.example',audience:'cortico-world-figure',accessToken:'test-grant'}}) }) } };
  const fetcher = corrupt => async (url, options) => {
    if (url.startsWith('https://hub.example')) {
      const input = JSON.parse(options.body);
      if (input.operation === 'download') assert.equal(input.sha256, sha256);
      assert.equal(input.version, item);
      return Response.json({ok:true,result:{ticket:'test-ticket',url:'https://8.137.59.209/figure-workshop/v1/'+input.operation}});
    }
    if (url.endsWith('/item')) return Response.json({id:item,status:'published',sha256,size:data.length});
    return new Response(corrupt ? Buffer.alloc(data.length) : data);
  };
  assert.deepEqual(await downloadFigureSource(host,item,fetcher(false)),data);
  await assert.rejects(downloadFigureSource(host,item,fetcher(true)),/摘要/);
});
test('Figure can initiate authentication when it owns the host login', async () => {
  const host = { hostServices: { get: () => ({interactive: {
    begin: async () => ({authorizationUrl:'https://hub.example/?hostLogin=test',shortCode:'QWERTY-1'}),
    complete: async () => ({status:'ready',accessToken:'not for the browser'}),
  }}) } };
  assert.equal((await figureHostAction(host,'begin')).shortCode,'QWERTY-1');
  assert.deepEqual(await figureHostAction(host,'complete'),{status:'ready'});
  await assert.rejects(figureHostAction(null,'begin'),/其他 World/);
});
test('the normal Figure World uses the login service from its construction context', async () => {
  const {default: definition} = await import('../src/index.ts');
  const world = definition.create({
    cfg:definition.defaults(),dataDir:tmpdir(),persist(){},secret(){return '';},storeSecret(){},
    hostServices:{get: () => ({ signIn: async () => ({status:'login_required'}), interactive:{} })},
  });
  const result = await world.webUi().invoke('workbench','figureCatalog',[{}]);
  assert.deepEqual(result,{status:'login_required',interactive:true});
});
