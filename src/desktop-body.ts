import type { EventEnvelope, EventRangeQuery, EventStoreReader } from 'cortico/core/types.ts';

export type DesktopBodyId = 'desktop-pet' | 'desktop-live2d-pet';
export interface DesktopBody {
  id: DesktopBodyId;
  figure?: string;
  dir?: string;
  native?: boolean;
  modelFile?: string;
  failed?: boolean;
}
export type DesktopBodyLookup = (id?: DesktopBodyId) => DesktopBody | null;
export const FIGURE_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

export function isDesktopBody(id: unknown): id is DesktopBodyId {
  return id === 'desktop-pet' || id === 'desktop-live2d-pet';
}

/** Live playback files for the second desktop window live beside the stock ones. */
export function desktopControlFile(file: string, id?: DesktopBodyId): string {
  return id === 'desktop-live2d-pet' ? file.replace(/\.json$/, '.desktop-live2d-pet.json') : file;
}

export function desktopEvents(store: EventStoreReader, query: EventRangeQuery, both = true) {
  const stock = store.range({ ...query, source: 'desktop-pet' }).filter(event => event.source === 'desktop-pet');
  if (!both) return stock;
  return [...stock, ...store.range({ ...query, source: 'desktop-live2d-pet' }).filter(event => event.source === 'desktop-live2d-pet')]
    .sort((a, b) => a.cursor - b.cursor).slice(-(query.limit ?? Infinity));
}

export function desktopReply(event: EventEnvelope): event is EventEnvelope & { source: DesktopBodyId; text: string } {
  return isDesktopBody(event.source) && event.type === event.source + '.self'
    && event.meta?.kind === 'say' && typeof event.text === 'string' && Boolean(event.text.trim());
}

export function desktopQuestion(event: EventEnvelope): event is EventEnvelope & { source: DesktopBodyId; text: string } {
  return isDesktopBody(event.source) && event.type === event.source + '.self'
    && event.meta?.kind === 'ask' && typeof event.text === 'string' && Boolean(event.text.trim());
}

export function figureChange(event: EventEnvelope) {
  if (!isDesktopBody(event.source) || event.type !== event.source + '.figure') return;
  const change = event.meta?.figure as { kind?: unknown; name?: { id?: unknown } } | undefined;
  if (change?.kind !== 'figure' && change?.kind !== 'dress' && change?.kind !== 'failed') return;
  const figure = change.name?.id;
  if (typeof figure !== 'string' || !FIGURE_ID.test(figure)) return;
  return { body: event.source, figure, failed: change.kind === 'failed', cursor: event.cursor };
}

/** Stock Coo does not always archive its initial or bot-selected outfit. Keep the user's selection
 * when there is no newer receipt. A newer conflicting receipt prevents writing to the wrong rig. */
export class DesktopSelection {
  private cursor = -1;
  private changes = new Map<DesktopBodyId, NonNullable<ReturnType<typeof figureChange>>>();
  private recentBody?: DesktopBodyId;
  private readonly store: () => EventStoreReader | undefined;
  private readonly config: () => { desktopFigure?: string; desktopFigureCursor?: number };

  constructor(store: () => EventStoreReader | undefined,
              config: () => { desktopFigure?: string; desktopFigureCursor?: number }) {
    this.store = store;
    this.config = config;
  }

  reset() {
    this.cursor = -1;
    this.changes.clear();
    this.recentBody = undefined;
  }

  body(requested?: DesktopBodyId): DesktopBody {
    const store = this.store();
    const latest = store?.latestCursor() ?? 0;
    if (store && latest !== this.cursor) {
      const events = desktopEvents(store, { toCursor: latest,
        ...(this.cursor >= 0 ? { fromCursor: this.cursor + 1 } : {}), limit: 256 });
      for (const event of events) {
        const change = figureChange(event);
        if (change) this.changes.set(change.body, change);
        if (desktopReply(event) || change || isDesktopBody(event.source) &&
            [event.source + '.message', event.source + '.speech'].includes(event.type)) {
          this.recentBody = event.source as DesktopBodyId;
        }
      }
      this.cursor = latest;
    }
    const cfg = this.config();
    const id = requested ?? (cfg.desktopFigure ? 'desktop-pet' : this.recentBody) ?? 'desktop-pet';
    const observed = this.changes.get(id);
    const selected = id === 'desktop-pet' && cfg.desktopFigure;
    const figure = selected && (!observed || observed.cursor <= (cfg.desktopFigureCursor ?? 0))
      ? selected : observed?.figure;
    return { id, ...(figure ? { figure } : {}), ...(observed?.failed && observed.figure === figure ? {failed:true} : {}) };
  }
}
