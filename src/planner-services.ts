import { createHash, randomUUID } from 'node:crypto';
import { PLANNER_PROVIDERS } from './planner-catalog.mjs';

const LEGACY_KEY = 'FIGURE_PERFORMANCE_MODEL_KEY';
const idPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
type PlannerProvider = keyof typeof PLANNER_PROVIDERS;
type PlannerService = { id: string; provider: PlannerProvider; name: string; endpoint: string; model: string };
type Connection = PlannerService & { apiKey: string };
type ActiveConnection = Connection & { signal: AbortSignal };
type PlannerDraft = Partial<PlannerService> & { key?: unknown; nonce?: unknown; select?: boolean };
export interface PlannerConfig {
  performanceServices?: PlannerService[];
  performanceService?: string;
  performanceEndpoint?: string;
  performanceModel?: string;
}
interface PlannerOptions {
  config(): PlannerConfig;
  persist?(patch: PlannerConfig): void;
  secret?(name: string): string | undefined;
  storeSecret?(name: string, value: string): void;
}

function plannerText(value: unknown, max: number, label: string) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) throw Error(label + '无效');
  return value.trim();
}

export function plannerEndpoint(value: unknown) {
  const input = plannerText(value, 2048, '服务地址');
  let url;
  try { url = new URL(input); } catch { throw Error('请输入有效的服务地址'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash) {
    throw Error('服务地址须使用 HTTPS，本机接口可使用 HTTP');
  }
  return url.href.replace(/\/+$/u, '').replace(/\/(?:chat\/completions|models)$/u, '');
}

const safeOrigin = (value: string) => {
  try { return new URL(plannerEndpoint(value)).origin; } catch { return ''; }
};
const scopeKey = (id: string, endpoint: string) =>
  'FIGURE_PLANNER_' + createHash('sha256').update(id + '|' + safeOrigin(endpoint)).digest('hex').slice(0, 32).toUpperCase();

function checkResponse(response: Response) {
  if (response.ok) return;
  if (response.status === 401 || response.status === 403) throw Error('服务拒绝鉴权，请检查密钥和访问权限');
  if (response.status === 404) throw Error('服务未找到接口或模型，请检查地址和模型 ID');
  if (response.status === 429) throw Error('服务请求受限，请检查配额或稍后重试');
  throw Error('服务返回 HTTP ' + response.status);
}

export async function plannerFetch(service: Connection, url: string, init: RequestInit = {}) {
  if (new URL(url).origin !== safeOrigin(service.endpoint)) throw Error('编排服务地址已变化');
  const headers = new Headers(init.headers);
  if (service.apiKey) headers.set('Authorization', 'Bearer ' + service.apiKey);
  else headers.delete('Authorization');
  let body = init.body;
  if (typeof body === 'string' && url.endsWith('/chat/completions')) {
    const payload = JSON.parse(body);
    const hostname = new URL(url).hostname;
    if (service.provider === 'deepseek' && hostname === 'api.deepseek.com') payload.thinking = { type: 'disabled' };
    if (service.provider === 'openai' && hostname === 'api.openai.com' && /^(?:gpt-5(?:[.-]|$)|o[134](?:-|$))/u.test(service.model)) {
      payload.max_completion_tokens = Math.max(512, payload.max_tokens);
      delete payload.max_tokens;
      delete payload.temperature;
    }
    body = JSON.stringify(payload);
  }
  try { return await fetch(url, { ...init, body, headers, redirect: 'error' }); }
  catch (error) {
    if (init.signal?.aborted || (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name))) throw Error('编排服务响应超时');
    throw Error('无法连接编排服务，请检查地址和网络');
  }
}

export class PlannerServices {
  private readonly options: PlannerOptions;
  private active?: { connection: ActiveConnection; controller: AbortController };

  constructor(options: PlannerOptions) { this.options = options; }

  private list(cfg = this.options.config()) {
    const stored = Array.isArray(cfg.performanceServices) ? cfg.performanceServices : [];
    const legacy = cfg.performanceEndpoint || cfg.performanceModel
      ? [{ id: 'legacy', provider: 'custom' as const, name: '', endpoint: cfg.performanceEndpoint || '', model: cfg.performanceModel || '' }]
      : [];
    return [...legacy, ...stored.filter(service => service && idPattern.test(service.id))].filter(service =>
      Object.hasOwn(PLANNER_PROVIDERS, service.provider) && typeof service.name === 'string'
      && typeof service.endpoint === 'string' && typeof service.model === 'string');
  }

  private selected(cfg: PlannerConfig, services: PlannerService[]) {
    return services.find(service => service.id === (cfg.performanceService || 'legacy'));
  }

  private key(service: PlannerService) {
    const origin = safeOrigin(service.endpoint);
    if (!origin) return '';
    return this.options.secret?.(service.id === 'legacy' ? LEGACY_KEY : scopeKey(service.id, service.endpoint)) || '';
  }

  private ready(service: PlannerService, key: string) {
    return Boolean(safeOrigin(service.endpoint) && service.model?.trim() && (key || service.id !== 'legacy' && !PLANNER_PROVIDERS[service.provider].keyRequired));
  }

  state() {
    const cfg = this.options.config();
    const services = this.list(cfg);
    return {
      selectedId: this.selected(cfg, services)?.id ?? '',
      services: services.map(service => {
        const apiKey = this.key(service);
        const { id, provider, name, endpoint, model } = service;
        return { id, provider, name, endpoint, model, hasKey: !!apiKey, ready: this.ready(service, apiKey) };
      }),
    };
  }

  connection(): ActiveConnection | undefined {
    const cfg = this.options.config();
    const service = this.selected(cfg, this.list(cfg));
    const apiKey = service ? this.key(service) : '';
    const next = service && this.ready(service, apiKey)
      ? { ...service, apiKey, endpoint: plannerEndpoint(service.endpoint), model: service.model.trim() } : undefined;
    const previous = this.active?.connection;
    if (next && previous && previous.id === next.id && previous.provider === next.provider
        && previous.endpoint === next.endpoint && previous.model === next.model && previous.apiKey === next.apiKey) {
      return { ...next, signal: previous.signal };
    }
    this.active?.controller.abort();
    this.active = undefined;
    if (!next) return undefined;
    const controller = new AbortController();
    const connection = { ...next, signal: controller.signal };
    this.active = { connection, controller };
    return connection;
  }

  private draft(input: unknown, needsModel: boolean) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('编排服务配置无效');
    const draft = input as PlannerDraft;
    const services = this.list();
    const existing = services.find(item => item.id === draft.id);
    if (draft.id && !existing) throw Error('编排服务已删除，请重新打开配置');
    if (typeof draft.provider !== 'string' || !Object.hasOwn(PLANNER_PROVIDERS, draft.provider)) throw Error('请选择提供商');
    const endpoint = plannerEndpoint(draft.endpoint);
    const model = plannerText(draft.model ?? '', 240, '模型 ID');
    if (needsModel && !model) throw Error('请选择或填写模型 ID');
    const provider = draft.provider;
    const name = plannerText(draft.name ?? '', 80, '服务名称');
    const fresh = plannerText(draft.key ?? '', 4096, 'API 密钥');
    if (/\s/u.test(fresh)) throw Error('API 密钥不能包含空格');
    const same = existing && safeOrigin(existing.endpoint) === safeOrigin(endpoint);
    const apiKey = fresh || (same ? this.key(existing) : '');
    if (!apiKey && PLANNER_PROVIDERS[provider].keyRequired) throw Error('请输入此服务地址的 API 密钥');
    return { existing, services, provider, endpoint, model, name, fresh, apiKey, draft };
  }

  save(input: unknown) {
    const {existing, services, provider, endpoint, model, name, apiKey, fresh, draft} = this.draft(input, true);
    if (!this.options.persist) throw Error('当前宿主无法保存编排服务');
    const nonce = typeof draft.nonce === 'string' && idPattern.test(draft.nonce) ? draft.nonce : '';
    const id = existing?.id && existing.id !== 'legacy' ? existing.id : nonce || randomUUID();
    const previous = services.find(service => service.id === id);
    if (previous && previous !== existing && (previous.provider !== provider || previous.endpoint !== endpoint || previous.model !== model || previous.name !== name)) {
      throw Error('这次保存已结束，请重新打开服务');
    }
    if (!previous && !existing && services.length >= 32) throw Error('编排服务已达 32 项');
    const cfg = this.options.config();
    const selected = this.selected(cfg, services)?.id;
    const updated = { id, provider, name, endpoint, model };
    if (fresh || existing?.id === 'legacy' && apiKey) {
      if (!this.options.storeSecret) throw Error('当前宿主无法保存 API 密钥');
      this.options.storeSecret(scopeKey(id, endpoint), apiKey);
    }
    this.options.persist({
      performanceServices: [...services.filter(service => service.id !== 'legacy' && service.id !== id), updated],
      performanceService: draft.select === true || (existing && selected === existing.id) ? id : selected ?? cfg.performanceService ?? '',
      ...(existing?.id === 'legacy' ? {performanceEndpoint: '', performanceModel: ''} : {}),
    });
    this.connection();
    return this.state();
  }

  select(id: unknown) {
    if (!this.options.persist) throw Error('当前宿主无法保存编排服务');
    const service = this.list().find(item => item.id === id);
    if (!service || !this.ready(service, this.key(service))) throw Error('请先补全该服务的地址、模型和鉴权');
    this.options.persist({ performanceService: service.id });
    this.connection();
    return this.state();
  }

  remove(id: unknown) {
    if (!this.options.persist) throw Error('当前宿主无法保存编排服务');
    const cfg = this.options.config();
    const services = this.list(cfg);
    if (!services.some(item => item.id === id)) return this.state();
    this.options.persist({
      performanceServices: services.filter(item => item.id !== id && item.id !== 'legacy'),
      performanceService: this.selected(cfg, services)?.id === id ? 'none' : cfg.performanceService ?? '',
      ...(id === 'legacy' ? {performanceEndpoint: '', performanceModel: ''} : {}),
    });
    this.connection();
    return this.state();
  }

  async models(input: unknown) {
    const { provider, endpoint, model, name, apiKey } = this.draft(input, false);
    const response = await plannerFetch({id:'probe', provider, endpoint, model, name, apiKey}, endpoint + '/models', {signal: AbortSignal.timeout(9000)});
    checkResponse(response);
    const payload = await response.json().catch(() => null);
    if (!Array.isArray(payload?.data)) throw Error('服务未提供兼容的模型列表，请手动填写模型 ID');
    return [...new Set<string>(payload.data.flatMap((item: {id?: unknown}) => typeof item?.id === 'string'
      && item.id.length <= 240 && !/[\u0000-\u001f\u007f]/u.test(item.id) ? [item.id] : []))].sort().slice(0, 500);
  }

  async test(input: unknown) {
    const { provider, endpoint, model, name, apiKey } = this.draft(input, true);
    const started = Date.now();
    const response = await plannerFetch({id:'probe', provider, endpoint, model, name, apiKey}, endpoint + '/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(9000),
      body: JSON.stringify({model, max_tokens: 96, stream: false, messages: [
        {role:'user', content:'Return only the JSON object {"action":"nod"}. Do not include commentary.'},
      ]}),
    });
    checkResponse(response);
    const payload = await response.json().catch(() => null);
    try {
      const content = payload?.choices?.[0]?.message?.content?.trim().replace(/^```(?:json)?\s*|\s*```$/gu, '');
      if (JSON.parse(content).action === 'nod') return { elapsedMs: Date.now() - started };
    } catch { /* A successful HTTP response is insufficient for a planner. */ }
    throw Error('服务已连通，但模型未返回可解析的动作 JSON，请换一个模型');
  }
}
