import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createVoiceStream } from '../src/voice-stream.ts';

function fixture() {
  const chunks = [];
  const finished = [];
  let interrupted = 0;
  const tap = createVoiceStream({
    chunk: (text, kind, id) => chunks.push({ text, kind, id }),
    finish: (kind, id) => finished.push({ kind, id }),
    interrupt: () => { interrupted++; },
  });
  let sequence = 0;
  const event = (type, value = {}) => tap.onEvent({ type, sequence_number: sequence++, ...value });
  const item = (type, name, args = '', index = 0) => event('response.output_item.' + type, {
    output_index: index,
    item: { type: 'function_call', id: 'item-' + index, call_id: 'call-' + index, name, arguments: args },
  });
  const delta = (value, index = 0) => event('response.function_call_arguments.delta', {
    output_index: index, item_id: 'item-' + index, delta: value,
  });
  const done = (value, index = 0) => event('response.function_call_arguments.done', {
    output_index: index, item_id: 'item-' + index, arguments: value,
  });
  return { tap, chunks, finished, event, item, delta, done, interrupted: () => interrupted };
}

test('first complete sentence is emitted before tool completion across split escapes and markers', () => {
  const f = fixture();
  f.item('added', 'pet_say');
  f.delta('{"images":["never read this"],"meta":{"script":"nested"},"script":"【开');
  f.delta('心】＜挥');
  f.delta('手＞这\\u662');
  assert.deepEqual(f.chunks, []);
  f.delta('f第一句完整台词。');
  assert.deepEqual(f.chunks, [{ text: '这是第一句完整台词。', kind: 'say', id: 'call-0' }]);
  assert.deepEqual(f.finished, []);
  const completed = JSON.stringify({ script: '【开心】＜挥手＞这是第一句完整台词。还有一句。' });
  f.done(completed);
  f.item('done', 'pet_say', completed);
  f.tap.onRoundEnd();
  assert.deepEqual(f.chunks.map(chunk => chunk.text), ['这是第一句完整台词。', '还有一句。']);
  assert.deepEqual(f.finished, [{ kind: 'say', id: 'call-0' }]);
});

test('full tool events read a question and at most the stock three options, once', () => {
  const f = fixture();
  const payload = JSON.stringify({ question: '选一个颜色。', options: ['红色', '蓝色', '绿色', '忽略'] });
  f.item('done', 'pet_ask', payload);
  f.item('done', 'pet_ask', payload);
  f.tap.onRoundEnd();
  assert.deepEqual(f.chunks.map(chunk => chunk.text), ['选一个颜色。', '可选，红色、蓝色、绿色。']);
  assert.deepEqual(f.finished, [{ kind: 'ask', id: 'call-0' }]);
});

test('quiet, failure and abort stop stale speech but allow a fresh round', () => {
  const f = fixture();
  f.item('added', 'pet_say');
  f.delta('{"script":"这是一段已经开始的台词。');
  f.item('added', 'pet_quiet', '', 1);
  f.delta('后续内容。"}');
  f.item('done', 'pet_say', '{"script":"已经打断的内容"}');
  assert.equal(f.interrupted(), 1);
  f.event('response.failed');
  f.tap.onAbort('preempted');
  f.item('done', 'pet_say', '{"script":"失败轮次的内容"}', 2);
  assert.equal(f.interrupted(), 2);
  assert.deepEqual(f.finished, []);
  f.event('response.created'); // A failed attempt may be retried without a round-end callback.
  f.item('done', 'pet_say', '{"script":"新一轮恢复。"}');
  assert.deepEqual(f.chunks.map(chunk => chunk.text), ['这是一段已经开始的台词。', '新一轮恢复。']);
});

test('long lines have bounded chunks and only targeted Coo fields are narrated', () => {
  const f = fixture();
  f.item('done', 'unrelated', '{"script":"不读。"}');
  f.item('done', 'pet_say', JSON.stringify({ script: '长'.repeat(1700) }));
  assert.equal(f.chunks.reduce((total, chunk) => total + chunk.text.length, 0), 800);
  assert.ok(f.chunks.every(chunk => chunk.text.length <= 96));
  assert.deepEqual(f.finished, [{ kind: 'say', id: 'call-0' }]);
});
