import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import panel from '../dist/webui.js';

const tick = () => new Promise((r) => setTimeout(r, 15));
async function mount(t, opts = {}) {
  const dom = new JSDOM('<main></main>', { url: 'http://localhost/' });
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  const calls = []; const toasts = [];
  let ack = opts.ack ?? false;
  const root = document.querySelector('main');
  const ctx = {
    root, language: opts.language ?? 'zh',
    ui: {
      sheet: ({ title, desc }) => {
        const el = document.createElement('section');
        const head = document.createElement('header'); head.className = 'sheet-head'; head.textContent = title;
        const body = document.createElement('div'); el.append(head, body); return { el, body };
      },
      log: () => ({ el: document.createElement('div'), append() {}, clear() {} }),
      toast: (...args) => toasts.push(args), confirm: async () => true, drawer() {},
    },
    async invoke(method, args) {
      calls.push({ method, args });
      if (opts.invoke) {
        const result = await opts.invoke(method, args);
        if (result !== undefined) return result;
      }
      const notice = { acknowledged: ack, revision: 1 };
      if (method === 'state') return { notice, version: opts.version ?? '1.4.2' };
      if (method === 'core') return { ok: opts.core ?? true, version: 'Cubism 5.3' };
      if (method === 'noticeAccept') { ack = true; return { acknowledged: true, revision: 1 }; }
      if (method === 'list') return { dir: '', figuresDir: 'E:/test/figures', builds: opts.builds ?? [], installed: null };
      if (method === 'detail') return { nameZh: '名字', aboutZh: '简介' };
      return { builds: opts.builds ?? [] };
    },
  };
  const handle = panel.panels.workbench.mount(ctx);
  t.after(() => { handle.dispose(); dom.window.close(); });
  await tick();
  const button = (label) => [...document.querySelectorAll('button')].find((b) => b.textContent === label);
  return { ctx, root, calls, toasts, button, handle, dom };
}

test('first visit expands notice; confirming restores version; version click reopens notice', async (t) => {
  const { root, button, calls } = await mount(t);
  assert.equal(root.querySelector('details').open, true);
  const badge = root.querySelector('.l2d-version-corner');
  assert.equal(badge.textContent, '!'); assert.equal(badge.tagName, 'BUTTON');
  button('我已知晓，不再分发').click(); await tick();
  assert.equal(badge.textContent, 'v1.4.2');
  assert.equal(root.querySelector('details').open, false);
  badge.click(); assert.equal(root.querySelector('details').open, true);
  assert.equal(calls.filter((c) => c.method === 'noticeAccept').length, 1);
});

test('acknowledged users see quiet version across upgrades; ready Core stays in owned details', async (t) => {
  const { root, calls } = await mount(t, { ack: true, version: '1.4.99', language: 'en' });
  assert.equal(root.querySelector('.l2d-version-corner').textContent, 'v1.4.99');
  assert.equal(root.querySelector('details').open, false);
  assert.ok(root.querySelector('details .l2d-license.ok'));
  assert.equal(calls.filter((c) => c.method === 'noticeAccept').length, 0);
  assert.equal(document.querySelectorAll('.l2d-license').length, 1);
});

test('failed consent save leaves warning visible and permits retry', async (t) => {
  let fail = true;
  const { root, button } = await mount(t, { invoke: (m) => { if (m === 'noticeAccept' && fail) throw new Error('disk full'); } });
  button('我已知晓，不再分发').click(); await tick();
  assert.equal(root.querySelector('.l2d-version-corner').textContent, '!');
  assert.equal(button('我已知晓，不再分发').disabled, false);
  fail = false; button('我已知晓，不再分发').click(); await tick();
  assert.equal(root.querySelector('.l2d-version-corner').textContent, 'v1.4.2');
});

test('pack and import require notice; installation of existing card does not require model path', async (t) => {
  const builds = [{ id: 'sample-1', packId: 'sample', nameZh: '名字', at: 1, bytes: 5 }];
  const { button, calls } = await mount(t, { builds });
  button('打包').click(); button('导入').click(); await tick();
  assert.equal(calls.some((c) => c.method === 'build'), false);
  assert.equal(document.querySelector('.l2d-modal'), null);
  button('我已知晓，不再分发').click(); await tick();
  button('安装').click(); await tick();
  assert.deepEqual(calls.find((c) => c.method === 'install').args, ['', 'sample-1']);
});

test('edit validates name, locks close while saving, clears about, and disposes overlays', async (t) => {
  let finish;
  const { button, handle, root, calls, dom } = await mount(t, {
    ack: true, builds: [{ id: 'a-1', at: 1, bytes: 5 }],
    invoke: (m) => m === 'edit' ? new Promise((r) => { finish = r; }) : undefined,
  });
  button('编辑').click(); await tick();
  const modal = document.querySelector('[role="dialog"]'); assert.ok(modal);
  const name = modal.querySelector('input'); name.value = '';
  button('保存').click(); await tick(); assert.equal(finish, undefined);
  name.value = '新名字'; modal.querySelector('textarea').value = '';
  button('保存').click(); await tick();
  button('取消').click(); assert.ok(document.querySelector('.l2d-modal'));
  assert.equal(root.querySelector('input.l2d-path').disabled, true);
  finish({}); await tick();
  assert.equal(document.querySelector('.l2d-modal'), null);
  assert.equal(calls.find((c) => c.method === 'edit').args[1].aboutZh, '');
  button('导入').click(); assert.ok(document.querySelector('[aria-modal="true"]'));
  document.querySelector('.l2d-modal').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(document.querySelector('.l2d-modal'), null);
  button('导入').click(); handle.dispose();
  assert.equal(document.querySelector('.l2d-modal'), null);
  assert.equal(root.hasAttribute('aria-busy'), false);
});
