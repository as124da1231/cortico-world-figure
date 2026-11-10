import type { OutputTap } from 'cortico/core/types.ts';
import { randomUUID } from 'node:crypto';

// Incremental JSON field parser adapted from cortico-world-streamvoice v0.5.0
// by xww (AGPL-3.0-or-later): https://github.com/laojingwei/cortico-world-streamvoice

/**
 * 从流式的函数调用参数里，增量地抠出一个字符串字段。
 *
 * 模型吐出来的是 JSON 的碎片：`{"script":"我先","看一下。"}` 会分成好几次到，甚至
 * `\"` `\n` 这些转义也会被切在中间。这里只做一件事：盯着目标字段的字符串值，把已经
 * 解好转义的那部分交出去，剩下的等下一片。
 *
 * 别的字段（images 之类）整段跳过，不需要把 JSON 解析完。
 */

type State = 'obj' | 'key' | 'colon' | 'value' | 'text' | 'skip' | 'after' | 'done';

class JsonStringField {
  private buf = '';
  private pos = 0;
  private state: State = 'obj';
  private target = false;
  private value = '';
  /** 跳过别的值时的括号深度与字符串状态。 */
  private depth = 0;
  private inString = false;
  private escape = false;
  private readonly field: string;

  constructor(field: string) { this.field = field; }

  /** 到目前为止该字段的完整值。 */
  get text(): string {
    return this.value;
  }

  /** 该字段的字符串已经闭合。 */
  get complete(): boolean {
    return this.state === 'after' || this.state === 'done';
  }

  /** 喂一片参数，返回这一片里新解出来的文字。 */
  feed(delta: string): string {
    if (!delta) return '';
    this.buf += delta;
    const before = this.value.length;
    this.pump();
    return this.value.slice(before);
  }

  private pump(): void {
    const s = this.buf;
    while (this.pos < s.length) {
      const ch = s[this.pos];
      switch (this.state) {
        case 'obj':
          if (ch === '{') { this.state = 'key'; this.pos++; break; }
          if (/\s/.test(ch)) { this.pos++; break; }
          this.state = 'done';
          return;
        case 'key': {
          if (ch === '"') {
            const out = this.readKey();
            if (out === null) return;
            this.target = out === this.field;
            this.state = 'colon';
            break;
          }
          if (ch === '}') { this.state = 'done'; return; }
          this.pos++;
          break;
        }
        case 'colon':
          if (ch === ':') { this.state = 'value'; this.pos++; break; }
          if (/\s/.test(ch)) { this.pos++; break; }
          this.state = 'done';
          return;
        case 'value':
          if (/\s/.test(ch)) { this.pos++; break; }
          if (this.target && ch === '"') { this.state = 'text'; this.pos++; break; }
          this.state = 'skip';
          this.depth = 0;
          this.inString = false;
          this.escape = false;
          break;
        case 'text': {
          if (this.escape) {
            if (ch === 'u') {
              if (this.pos + 4 >= s.length) return; // 四个十六进制还没到齐
              const hex = s.slice(this.pos + 1, this.pos + 5);
              if (!/^[0-9a-fA-F]{4}$/.test(hex)) { this.escape = false; this.pos++; break; }
              this.value += String.fromCharCode(parseInt(hex, 16));
              this.escape = false;
              this.pos += 5;
              break;
            }
            this.value += unescapeChar(ch);
            this.escape = false;
            this.pos++;
            break;
          }
          if (ch === '\\') { this.escape = true; this.pos++; break; }
          if (ch === '"') { this.state = 'done'; this.pos++; break; }
          this.value += ch;
          this.pos++;
          break;
        }
        case 'skip':
          if (this.inString) {
            if (this.escape) { this.escape = false; this.pos++; break; }
            if (ch === '\\') { this.escape = true; this.pos++; break; }
            if (ch === '"') { this.inString = false; this.pos++; break; }
            this.pos++;
            break;
          }
          if (ch === '"') { this.inString = true; this.pos++; break; }
          if (ch === '{' || ch === '[') { this.depth++; this.pos++; break; }
          if (ch === '}' || ch === ']') {
            if (this.depth === 0) { this.state = 'after'; break; }
            this.depth--;
            this.pos++;
            break;
          }
          if (ch === ',' && this.depth === 0) { this.state = 'key'; this.pos++; break; }
          this.pos++;
          break;
        case 'after':
          if (ch === ',') { this.state = 'key'; this.pos++; break; }
          if (ch === '}') { this.state = 'done'; return; }
          this.pos++;
          break;
        case 'done':
          return;
      }
    }
  }

  /** 读一个键名；字符串还没闭合时返回 null，一个字节都不吃掉。 */
  private readKey(): string | null {
    let i = this.pos + 1;
    let out = '';
    let esc = false;
    while (i < this.buf.length) {
      const ch = this.buf[i];
      if (esc) { out += unescapeChar(ch); esc = false; i++; continue; }
      if (ch === '\\') { esc = true; i++; continue; }
      if (ch === '"') {
        this.pos = i + 1;
        return out;
      }
      out += ch;
      i++;
    }
    return null;
  }
}

function unescapeChar(ch: string): string {
  switch (ch) {
    case 'n': return '\n';
    case 'r': return '\r';
    case 't': return '\t';
    case 'b': return '\b';
    case 'f': return '\f';
    case '"': return '"';
    case '\\': return '\\';
    case '/': return '/';
    default: return ch;
  }
}

type Kind = 'say' | 'ask' | 'speak';
type Event = Parameters<OutputTap['onEvent']>[0];
type Item = Extract<Extract<Event, { type: 'response.output_item.added' }>['item'], { type: 'function_call' }>;
const MAX_ARGUMENTS = 64 * 1024;
const MAX_CALLS = 32;
const MAX_SPEECH = 800;
const MIN_CHUNK = 8;
const MAX_CHUNK = 96;

/** Hold only a possible action marker split across adjacent deltas. */
class ActionMarks {
  private tail = '';

  push(delta: string, final = false) {
    const text = this.tail + delta;
    let out = '', i = 0;
    while (i < text.length) {
      const ch = text[i];
      const closer = ch === '【' ? '】' : ch === '<' ? '>' : ch === '＜' ? '＞' : '';
      if (closer) {
        const end = text.indexOf(closer, i + 1);
        const inner = text.slice(i + 1, end < 0 ? undefined : end);
        const isMarker = ch === '【' || inner.length <= 32 && !inner.includes('\n');
        if (end >= 0 && isMarker) { i = end + 1; continue; }
        if (end < 0 && isMarker && !final && inner.length <= MAX_SPEECH) break;
      }
      out += ch;
      i++;
    }
    this.tail = text.slice(i);
    return out;
  }
}

/** A complete short sentence can start synthesis while the model keeps writing. */
class Sentences {
  private buffer = '';

  push(text: string, final = false): string[] {
    this.buffer += text;
    const chunks: string[] = [];
    for (;;) {
      const cut = this.nextCut() || (final ? this.buffer.length : 0);
      if (!cut) return chunks;
      chunks.push(this.buffer.slice(0, cut));
      this.buffer = this.buffer.slice(cut);
    }
  }

  private nextCut() {
    let i = 0, length = 0, soft = 0;
    for (const ch of this.buffer) {
      i += ch.length;
      if (!/\s/u.test(ch) && ++length > MAX_CHUNK) return soft || i - ch.length;
      if (/[，,、：:]/u.test(ch) && length >= MIN_CHUNK) soft = i;
      if (length >= MIN_CHUNK && (/[。！？!?；;…\n\r]/u.test(ch)
          || ch === '.' && /^\s/u.test(this.buffer[i] ?? '') && !/\d/u.test(this.buffer[i - 2] ?? ''))) return i;
    }
    return 0;
  }
}

function speakable(text: string) {
  const cleaned = text.replace(/https?:\/\/\S+/giu, ' ')
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, ' ')
    .replace(/[*_\x60~#>|]+/gu, ' ')
    .replace(/\s+/gu, ' ').trim();
  return /[\p{Letter}\p{Number}]/u.test(cleaned) ? cleaned : '';
}

export function speechSentences(text: string): string[] {
  const marks = new ActionMarks();
  const sentences = new Sentences();
  let remaining = MAX_SPEECH;
  return sentences.push(marks.push(text.slice(0, MAX_ARGUMENTS), true), true).flatMap(piece => {
    const chars = Array.from(speakable(piece)).slice(0, remaining);
    remaining -= chars.length;
    return chars.length ? [chars.join('')] : [];
  }).slice(0, MAX_CALLS);
}

function finalArguments(raw?: string): Record<string, unknown> {
  if (!raw || raw.length > MAX_ARGUMENTS) return {};
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch { return {}; }
}

type Call = {
  id: string;
  itemId: string;
  kind: Kind;
  field: JsonStringField;
  marks: ActionMarks;
  sentences: Sentences;
  received: number;
  spoken: number;
};

/** Convert the main session's Coo speech tool arguments into ordered speech segments. */
export function createVoiceStream(options: {
  synchronized?: boolean;
  chunk(text: string, kind: Kind, callId: string): void;
  finish(kind: Kind, callId: string): void;
  interrupt(): void;
}): OutputTap {
  const active = new Map<number, Call>();
  const done = new Set<number>();
  let aborted = false;

  function emit(call: Call, candidate: string) {
    const cleaned = speakable(candidate);
    if (!cleaned || call.spoken >= MAX_SPEECH) return;
    const chars = Array.from(cleaned).slice(0, MAX_SPEECH - call.spoken);
    call.spoken += chars.length;
    options.chunk(chars.join(''), call.kind, call.id);
  }

  function interrupt() {
    for (const index of active.keys()) done.add(index);
    active.clear();
    options.interrupt();
  }

  function abort() {
    if (aborted) return;
    aborted = true;
    interrupt();
  }

  function open(index: number, item: Item) {
    if (done.has(index) || active.has(index) || active.size + done.size >= MAX_CALLS) return;
    if (item.name === 'pet_quiet') {
      done.add(index);
      interrupt();
      return;
    }
    const kind = options.synchronized ? item.name === 'figure_speak' ? 'speak' : null
      : item.name === 'pet_say' ? 'say' : item.name === 'pet_ask' ? 'ask' : null;
    if (!kind) return;
    active.set(index, {
      id: item.call_id || item.id || randomUUID(), itemId: item.id ?? '', kind,
      field: new JsonStringField(kind === 'speak' ? 'text' : kind === 'say' ? 'script' : 'question'),
      marks: new ActionMarks(), sentences: new Sentences(), received: 0, spoken: 0,
    });
  }

  function feed(call: Call, text: string) {
    for (const piece of call.sentences.push(call.marks.push(text))) emit(call, piece);
  }

  function finish(index: number, raw?: string) {
    const call = active.get(index);
    if (!call) return;
    active.delete(index);
    done.add(index);
    const args = finalArguments(raw);
    const finalText = args[call.kind === 'speak' ? 'text' : call.kind === 'say' ? 'script' : 'question'];
    if (typeof finalText === 'string' && finalText.startsWith(call.field.text)) {
      feed(call, finalText.slice(call.field.text.length));
    }
    if (typeof finalText === 'string' || call.field.complete) {
      for (const tail of call.sentences.push(call.marks.push('', true), true)) emit(call, tail);
    }
    if (call.kind === 'ask' && call.spoken && Array.isArray(args.options)) {
      const choices = args.options.slice(0, 3)
        .filter((choice): choice is string => typeof choice === 'string')
        .map(choice => speakable(choice.slice(0, 128))).filter(Boolean);
      if (choices.length) {
        for (const piece of call.sentences.push('可选，' + choices.join('、') + '。', true)) emit(call, piece);
      }
    }
    if (call.spoken) options.finish(call.kind, call.id);
  }

  return {
    externalizes: () => false,
    onEvent(event) {
      if (event.type === 'response.created') {
        active.clear();
        done.clear();
        aborted = false;
        return;
      }
      if (aborted) return;
      switch (event.type) {
        case 'response.output_item.added':
          if (event.item?.type === 'function_call') open(event.output_index, event.item);
          return;
        case 'response.function_call_arguments.delta': {
          const call = active.get(event.output_index);
          if (call && (!call.itemId || call.itemId === event.item_id)
              && call.received + event.delta.length <= MAX_ARGUMENTS) {
            call.received += event.delta.length;
            feed(call, call.field.feed(event.delta));
          }
          return;
        }
        case 'response.function_call_arguments.done': {
          const call = active.get(event.output_index);
          if (call && (!call.itemId || call.itemId === event.item_id)) finish(event.output_index, event.arguments);
          return;
        }
        case 'response.output_item.done':
          if (event.item?.type === 'function_call') {
            open(event.output_index, event.item);
            const call = active.get(event.output_index);
            if (call && (!call.itemId || !event.item.id || call.itemId === event.item.id)) finish(event.output_index, event.item.arguments);
          }
          return;
        case 'response.failed':
        case 'response.incomplete':
        case 'error':
          abort();
      }
    },
    onRoundEnd() {
      for (const index of active.keys()) finish(index);
      done.clear();
      aborted = false;
    },
    onAbort: abort,
  };
}
