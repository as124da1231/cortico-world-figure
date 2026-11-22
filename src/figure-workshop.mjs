import { createHash } from 'node:crypto';
import { FIGURE_IMPORT } from './import-limits.mjs';

const CONTENT = 'https://8.137.59.209/figure-workshop/v1/';
export async function figureHostAction(host, action) {
  const interactive = host?.hostServices?.get('ffa-hub.login')?.interactive;
  if (!interactive) throw Error('此部署由其他 World 管理 FFA 登录');
  if (action === 'complete') {
    const result = await interactive.complete();
    return { status: result.status };
  }
  if (action !== 'begin') throw Error('未知的 FFA 登录操作');
  const flow = await interactive.begin();
  const url = new URL(flow.authorizationUrl);
  if (url.protocol !== 'https:' || url.username || url.password ||
      !/^[A-Z0-9_-]{8}$/.test(flow.shortCode ?? '')) throw Error('宿主返回的登录申请无效');
  return { authorizationUrl: url.href, shortCode: flow.shortCode };
}

async function requestContext(host) {
  const capability = host?.hostServices?.get('ffa-hub.login');
  if (!capability) return {status:'host_unavailable'};
  const auth = await capability.signIn();
  if (auth.status !== 'ready') return {status:auth.status, interactive:!!capability.interactive};
  const session = auth.session;
  const issuer = new URL(session.issuer);
  if (issuer.protocol !== 'https:' || issuer.username || issuer.password || issuer.search || issuer.hash || session.audience !== 'cortico-world-figure' || typeof session.accessToken !== 'string') throw Error('无效的 FFA 授权');
  return { status: 'ready', issuer, accessToken: session.accessToken };
}

async function workshopRequest(context, operation, input, fetcher) {
  const { issuer, accessToken } = context;
  const response = await fetcher(`${issuer.href.replace(/\/$/,'')}/v1/figure/tickets`, {
    method:'POST', redirect:'error', signal:AbortSignal.timeout(15000),
    headers:{'Content-Type':'application/json',Authorization:`Bearer ${accessToken}`},
    body:JSON.stringify({...input,operation}),
  });
  if (!response.ok) throw Error(`工坊授权失败 (${response.status})`);
  const envelope = await response.json();
  const grant = envelope.result;
  if (!envelope.ok || typeof grant?.ticket !== 'string' || grant.url !== CONTENT + operation) throw Error('工坊授权响应无效');
  const content = await fetcher(grant.url,{
    redirect:'error',signal:AbortSignal.timeout(operation === 'download' ? 120000 : 15000),
    headers:{Authorization:`Bearer ${grant.ticket}`},
  });
  if (!content.ok) throw Error(`工坊读取失败 (${content.status})`);
  return content;
}

export async function figureCatalog(host, input = {}, fetcher = fetch) {
  const context = await requestContext(host);
  if (context.status !== 'ready') return context;
  const operation = input.operation === 'mine' ? 'mine' : 'list';
  const query = typeof input.query === 'string' ? input.query.slice(0,80) : '';
  const content = await workshopRequest(context, operation, { query, sort: 'new', page: 0 }, fetcher);
  const result = await content.json();
  if (!Array.isArray(result.items)) throw Error('工坊目录响应无效');
  return {status:'ready', items:result.items, more:!!result.more};
}

export async function downloadFigureSource(host, item, fetcher = fetch) {
  if (typeof item !== 'string' || !/^[a-f0-9]{32}$/.test(item)) throw Error('作品编号无效');
  const context = await requestContext(host);
  if (context.status !== 'ready') throw Error('请先登录 FFA Hub 并授权 Figure');
  const detail = await workshopRequest(context, 'item', { item, version: item }, fetcher);
  const metadata = await detail.json();
  const { sha256, size } = metadata;
  if (metadata.status !== 'published' || metadata.id !== item || !/^[a-f0-9]{64}$/.test(sha256 ?? '') ||
      !Number.isSafeInteger(size) || size < 1) throw Error('作品已撤回或校验信息缺失');
  if (size > FIGURE_IMPORT.zip) throw Error('请从网页工坊下载大包，解压后选择文件夹导入');
  const response = await workshopRequest(context, 'download', { item, version: item, sha256 }, fetcher);
  const reader = response.body?.getReader();
  if (!reader) throw Error('工坊没有返回素材包');
  const result = Buffer.alloc(size), hash = createHash('sha256');
  let position = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value.length > size - position) throw Error('素材超过预期体积');
      result.set(value, position);
      position += value.length;
      hash.update(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  if (position !== size || hash.digest('hex') !== sha256) throw Error('工坊素材摘要校验失败');
  return result;
}
