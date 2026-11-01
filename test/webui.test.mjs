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

test('unacknowledged version opens notice; consent removes the workbench notice and keeps a static version', async (t) => {
  const { root, button, calls } = await mount(t);
  assert.equal(root.querySelector('details').open, true);
  let badge = root.querySelector('.l2d-version-corner');
  assert.equal(badge.textContent, 'v1.4.2'); assert.equal(badge.tagName, 'BUTTON');
  assert.ok(badge.classList.contains('unack'));
  badge.click(); assert.equal(root.querySelector('details').open, false);
  badge.click(); assert.equal(root.querySelector('details').open, true);
  assert.equal(badge.closest('.l2d-notice-dock'), null);
  button('我已知晓，不再分发').click(); await tick();
  badge = root.querySelector('.l2d-version-corner');
  assert.equal(badge.textContent, 'v1.4.2');
  assert.ok(badge.classList.contains('ack'));
  assert.equal(badge.classList.contains('unack'), false);
  assert.equal(badge.parentElement, root.querySelector('.l2d-sheet'));
  assert.equal(root.querySelector('.l2d-notice-dock'), null);
  assert.equal(badge.tagName, 'SPAN');
  assert.equal(badge.title, '');
  assert.equal(document.activeElement, root.querySelector('.l2d-path'));
  assert.equal(root.querySelector('.l2d-notice'), null);
  badge.click(); assert.equal(root.querySelector('.l2d-notice'), null);
  assert.equal(calls.filter((c) => c.method === 'noticeAccept').length, 1);
});

test('acknowledged users see only the version across upgrades, without the notice or ready-Core banner', async (t) => {
  const { root, calls } = await mount(t, { ack: true, version: '1.4.99', language: 'en' });
  assert.equal(root.querySelector('.l2d-version-corner').textContent, 'v1.4.99');
  assert.equal(root.querySelector('.l2d-version-corner').parentElement, root.querySelector('.l2d-sheet'));
  assert.equal(root.querySelector('.l2d-notice'), null);
  root.querySelector('.l2d-version-corner').click();
  assert.equal(root.querySelector('.l2d-notice'), null);
  assert.equal(calls.filter((c) => c.method === 'noticeAccept').length, 0);
  assert.equal(document.querySelectorAll('.l2d-license').length, 0);
});

test('acknowledged users can still fetch a missing Core without redisplaying the distribution notice', async (t) => {
  const { root, button } = await mount(t, { ack: true, core: false });
  assert.equal(root.querySelector('.l2d-notice'), null);
  assert.ok(root.querySelector('.l2d-notice-top > .l2d-license'));
  assert.equal(button('同意并获取').hidden, false);
});

test('acknowledged notice is a collapsed two-character entry in the config footer, without a version', async (t) => {
  const dom = new JSDOM('<footer></footer>');
  const root = dom.window.document.querySelector('footer');
  const handle = panel.panels['config-notice'].mount({
    root, language: 'zh', ui: { toast() { throw new Error('unexpected toast'); } },
    invoke: async () => ({ notice: { acknowledged: true, revision: 1 } }),
  });
  t.after(() => { handle.dispose(); dom.window.close(); });
  await tick();
  const details = root.querySelector('details');
  assert.equal(details.hidden, false);
  assert.equal(details.open, false);
  assert.equal(details.querySelector('summary').textContent, '须知');
  assert.equal(root.querySelector('.l2d-version-corner'), null);
  details.open = true;
  assert.match(details.querySelector('p').textContent, /Live2D Cubism Core/);
  handle.dispose();
  assert.equal(root.childElementCount, 0);
});

test('unacknowledged config footer stays hidden and pending loads cannot restore disposed content', async () => {
  const dom = new JSDOM('<footer></footer>');
  const root = dom.window.document.querySelector('footer');
  const ctx = { root, language: 'zh', ui: { toast() {} }, invoke: async () => ({ notice: { acknowledged: false } }) };
  const first = panel.panels['config-notice'].mount(ctx);
  await tick();
  assert.equal(root.querySelector('details').hidden, true);
  first.dispose();
  let resolve;
  const second = panel.panels['config-notice'].mount({ ...ctx, invoke: () => new Promise((r) => { resolve = r; }) });
  second.dispose();
  resolve({ notice: { acknowledged: true } });
  await tick();
  assert.equal(root.childElementCount, 0);
  dom.window.close();
});

test('automatic adaptation is explained inline without popups or parameter setup', async (t) => {
  const adaptation = { corrected: ['angleX'], limited: ['cheek', 'browAngle'], warnings: [] };
  const { root, toasts, dom } = await mount(t, {
    ack: true, builds: [{ id: 'a', bytes: 1, at: 1, adaptation }],
    invoke: m => m === 'state' ? { notice: { acknowledged: true }, version: 'test', scan: { adaptation } } : undefined,
  });
  const details = root.querySelectorAll('.l2d-adaptation');
  assert.equal(details.length, 2);
  assert.equal(details[0].open, false);
  assert.match(details[0].textContent, /左右转头/);
  assert.match(details[0].textContent, /独立控制受限.*脸红/);
  assert.match(details[0].textContent, /无需手动配置参数/);
  assert.equal(toasts.length, 0);
  const path = root.querySelector('.l2d-path'); path.value = 'new model';
  path.dispatchEvent(new dom.window.Event('input'));
  assert.equal(root.querySelectorAll('.l2d-adaptation').length, 1);
});

test('failed consent save leaves warning visible and permits retry', async (t) => {
  let fail = true;
  const { root, button } = await mount(t, { invoke: (m) => { if (m === 'noticeAccept' && fail) throw new Error('disk full'); } });
  button('我已知晓，不再分发').click(); await tick();
  assert.equal(root.querySelector('.l2d-version-corner').textContent, 'v1.4.2');
  assert.ok(root.querySelector('.l2d-version-corner').classList.contains('unack'));
  assert.equal(root.querySelector('.l2d-version-corner').closest('.l2d-notice-dock'), null);
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
