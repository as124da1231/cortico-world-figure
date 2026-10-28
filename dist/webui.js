/**
 * Coo 魔术人偶工坊 面板（浏览器端，手写 ESM，不打 bundle）。
 */
export default {
  panels: {
    workbench: {
      mount(ctx) {
        const ui = ctx.ui;
        const zh = String(ctx.language || 'zh').toLowerCase().startsWith('zh');
        const t = (a, b) => (zh ? a : b);
        const el = (tag, cls, text) => {
          const n = document.createElement(tag);
          if (cls) n.className = cls;
          if (text != null) n.textContent = text;
          return n;
        };

        const state = { dir: '', busy: false, builds: [], installed: null, figuresDir: '' };

        // ---- 首次打开的许可条 ----
        if (!ctx.memo.get('licenseAck', false)) {
          const bar = el('div', 'l2d-license');
          bar.appendChild(el('span', 'l2d-license-text', t(
            '本扩展随包附带 Live2D Cubism 运行时，按 Live2D Inc. 的许可分发。',
            'This extension ships the Live2D Cubism runtime under the Live2D Inc. license.',
          )));
          const core = el('button', 'l2d-link', t('Core 许可', 'Core license'));
          const sdk = el('button', 'l2d-link', t('SDK 许可', 'SDK license'));
          const ack = el('button', 'l2d-btn sm', t('知道了', 'Got it'));
          const openLicense = async (which) => {
            try {
              const r = await ctx.invoke('license', [which]);
              ui.drawer(r.file, r.text || t('（读不到许可文本）', '(license text missing)'));
            } catch (e) {
              ui.toast(text(e), 'bad');
            }
          };
          core.addEventListener('click', () => openLicense('core'));
          sdk.addEventListener('click', () => openLicense('sdk'));
          ack.addEventListener('click', () => {
            ctx.memo.set('licenseAck', true);
            bar.remove();
          });
          bar.append(core, sdk, ack);
          ctx.root.appendChild(bar);
        }

        const sheet = ui.sheet({
          title: t('Coo 魔术人偶工坊', 'Coo Marionette Atelier'),
          en: 'Coo Marionette Atelier',
          desc: t(
            '把 Live2D 模型整理成 Coo 能用的形象：扫描、打包、安装。只做装配，不含编辑。',
            'Turn a Live2D model into a Coo figure: scan, pack, install.',
          ),
        });
        ctx.root.appendChild(sheet.el);

        // ---- 一行 ----
        const bar = el('div', 'l2d-bar');
        const pick = el('button', 'l2d-btn', t('选择目录…', 'Choose folder…'));
        const path = el('input', 'l2d-path');
        path.placeholder = t('模型目录（含 .model3.json）', 'Model folder (.model3.json)');
        path.spellcheck = false;
        const scan = el('button', 'l2d-btn', t('扫描', 'Scan'));
        const pack = el('button', 'l2d-btn primary', t('打包', 'Pack'));
        bar.append(pick, path, scan, pack);
        sheet.body.appendChild(bar);

        const status = el('div', 'l2d-status');
        const dot = el('span', 'dot');
        const statusText = el('span', null, t('就绪', 'Ready'));
        status.append(dot, statusText);
        sheet.body.appendChild(status);

        // ---- 已打包 ----
        const head = el('div', 'l2d-head');
        head.appendChild(el('span', 'l2d-head-title', t('已打包', 'Packs')));
        const clearAll = el('button', 'l2d-btn sm', t('清空旧打包', 'Clear old packs'));
        head.appendChild(clearAll);
        sheet.body.appendChild(head);

        const grid = el('div', 'l2d-grid');
        sheet.body.appendChild(grid);

        // ---- 脚：安装目标（开关与目录在设置页）----
        const foot = el('div', 'l2d-foot');
        const target = el('span', 'l2d-target', '');
        foot.appendChild(target);
        foot.appendChild(el('span', 'l2d-note', t('删除与目录在设置里', 'Options in settings')));
        sheet.body.appendChild(foot);

        // ---- 日志 ----
        const logHead = el('div', 'l2d-head');
        logHead.appendChild(el('span', 'l2d-head-title', t('日志', 'Log')));
        const logClear = el('button', 'l2d-btn sm', t('清空', 'Clear'));
        logHead.appendChild(logClear);
        sheet.body.appendChild(logHead);
        const log = ui.log({ maxHeight: '150px', empty: t('还没有动作', 'No actions yet') });
        sheet.body.appendChild(log.el);
        logClear.addEventListener('click', () => log.clear());

        // ---------------- 行为 ----------------
        function say(text, bad = false) {
          statusText.textContent = text;
          status.className = 'l2d-status' + (bad ? ' bad' : '');
        }

        function setBusy(on, hint) {
          state.busy = on;
          for (const b of [pick, scan, pack, clearAll]) b.disabled = on;
          for (const b of grid.querySelectorAll('button')) b.disabled = on;
          if (hint) say(hint);
        }

        function paint() {
          const bits = [];
          if (state.installed?.target) bits.push(t('已安装 ', 'Installed ') + state.installed.target.split(/[\\/]/).pop());
          bits.push(t('已打包 ', 'Packs ') + state.builds.length);
          say(bits.join('　'));
          target.textContent = state.figuresDir ? t('安装到 ', 'Installs to ') + state.figuresDir : '';
          target.title = state.figuresDir;
          renderGrid();
        }

        function renderGrid() {
          grid.replaceChildren();
          if (!state.builds.length) {
            grid.appendChild(el('div', 'l2d-empty', t('还没有打包产物，先点「打包」', 'No packs yet — hit Pack')));
            return;
          }
          const installedName = state.installed?.target ? state.installed.target.split(/[\\/]/).pop() : '';
          for (const b of state.builds) {
            const card = el('div', 'l2d-card' + (installedName && b.id.startsWith(installedName) ? ' installed' : ''));
            if (b.thumb) {
              const img = document.createElement('img');
              img.src = b.thumb;
              img.alt = '';
              card.appendChild(img);
            } else {
              card.appendChild(el('div', 'empty', t('无封面', 'no cover')));
            }
            card.appendChild(el('div', 'title', b.id.replace(/(-\d{6,})+$/, '')));
            card.appendChild(el('div', 'meta',
              `${(b.bytes / 1048576).toFixed(1)} MB · ${clock(b.at)}`));
            if (b.fit) card.appendChild(el('div', 'tagline', t('已贴合', 'fit')));

            const install = el('button', 'l2d-btn sm primary l2d-wide', t('安装', 'Install'));
            install.addEventListener('click', () => run('install', b.id));
            card.appendChild(install);

            const row = el('div', 'row');
            const edit = el('button', 'l2d-btn sm', t('编辑', 'Edit'));
            edit.addEventListener('click', () => openEdit(b));
            const del = el('button', 'l2d-btn sm danger', t('删除', 'Delete'));
            del.addEventListener('click', async () => {
              if (state.busy) return;
              const ok = await ui.confirm({
                title: t('删除这份打包产物？', 'Delete this pack?'),
                body: t('只删这一份打包，已安装的形象不受影响。', 'Only this pack folder is removed.'),
                danger: true,
              });
              if (!ok) return;
              try {
                const r = await ctx.invoke('remove', [b.id]);
                state.builds = r.builds ?? [];
                paint();
                log.append(t('已删除 ', 'Deleted ') + b.id, 'dim');
                ui.toast(t('已删除', 'Deleted'), 'ok');
              } catch (e) {
                ui.toast(text(e), 'bad');
              }
            });
            row.append(edit, del);
            card.appendChild(row);
            grid.appendChild(card);
          }
        }

        async function refresh() {
          const r = await ctx.invoke('list', []);
          state.builds = r.builds ?? [];
          state.installed = r.installed ?? null;
          state.figuresDir = r.figuresDir ?? '';
          const d = r.dir ?? '';
          if (d && d !== state.dir) {
            state.dir = d;
            path.value = d;
          }
          paint();
        }

        async function run(kind, id) {
          if (state.busy) return;
          if (!state.dir) { ui.toast(t('先选模型目录', 'Pick a folder first'), 'bad'); return; }
          const label = kind === 'scan' ? t('扫描', 'Scan') : kind === 'build' ? t('打包', 'Pack') : t('安装', 'Install');
          setBusy(true, `${label}…`);
          log.append(`→ ${label}`, 'dim');
          const t0 = performance.now();
          try {
            const args = kind === 'install' && id ? [state.dir, id] : [state.dir];
            const r = await ctx.invoke(kind, args);
            const ms = Math.round(performance.now() - t0);
            for (const line of r.log ?? []) log.append(line, 'dim');
            log.append(`✓ ${label} · ${ms} ms`, 'plain');
            ui.toast(`${label} ✓`, 'ok');
            if (r.warn) log.append('! ' + r.warn, 'warn');
            await refresh();
          } catch (e) {
            const s = text(e);
            say(`${label} ✗ ${s}`, true);
            log.append(`✗ ${s}`, 'bad');
            ui.toast(`${label} ✗`, 'bad');
          } finally {
            setBusy(false);
          }
        }

        // ---------------- 编辑弹层 ----------------
        let modal = null;

        function closeEdit() {
          if (modal) { modal.remove(); modal = null; }
        }

        async function openEdit(b) {
          closeEdit();
          const d = await ctx.invoke('detail', [b.id]).catch(() => null);
          if (!d) { ui.toast(t('读不到这份打包的信息', 'Cannot read this pack'), 'bad'); return; }

          modal = el('div', 'l2d-modal');
          const card = el('div', 'l2d-modal-card');
          const head2 = el('div', 'l2d-modal-head');
          head2.appendChild(el('div', 'l2d-modal-title', t('编辑形象信息', 'Edit figure')));
          head2.appendChild(el('div', 'l2d-modal-sub', b.id.replace(/(-\d{6,})+$/, '')));
          card.appendChild(head2);

          const fields = {};
          const addField = (key, label, multiline) => {
            const wrap = el('div', 'l2d-field');
            wrap.appendChild(el('div', 'l2d-label', label));
            const input = multiline ? document.createElement('textarea') : document.createElement('input');
            input.className = 'l2d-input';
            if (multiline) input.rows = 2;
            input.value = d[key] ?? '';
            fields[key] = input;
            wrap.appendChild(input);
            card.appendChild(wrap);
          };
          addField('nameZh', t('名字（中）', 'Name (zh)'));
          addField('nameEn', t('名字（英）', 'Name (en)'));
          addField('aboutZh', t('一句话（中）', 'About (zh)'), true);
          addField('aboutEn', t('一句话（英）', 'About (en)'), true);

          const gainWrap = el('div', 'l2d-field');
          const gainTop = el('div', 'l2d-label-row');
          gainTop.appendChild(el('span', 'l2d-label', t('身体幅度', 'Body gain')));
          const gainOut = el('output', 'l2d-out', Number(d.bodyGain ?? 1.8).toFixed(2));
          gainTop.appendChild(gainOut);
          gainWrap.appendChild(gainTop);
          const gain = document.createElement('input');
          gain.type = 'range';
          gain.min = '0.5';
          gain.max = '3';
          gain.step = '0.05';
          gain.value = String(d.bodyGain ?? 1.8);
          gain.className = 'l2d-range';
          gain.addEventListener('input', () => { gainOut.textContent = Number(gain.value).toFixed(2); });
          gainWrap.appendChild(gain);
          card.appendChild(gainWrap);

          const styleWrap = el('div', 'l2d-field');
          styleWrap.appendChild(el('div', 'l2d-label', t('动作风格', 'Motion style')));
          const style = document.createElement('select');
          style.className = 'l2d-input';
          for (const [v, label] of [['natural', t('自然', 'Natural')], ['lively', t('活泼', 'Lively')], ['calm', t('安静', 'Calm')], ['shy', t('害羞', 'Shy')]]) {
            const o = document.createElement('option');
            o.value = v;
            o.textContent = label;
            style.appendChild(o);
          }
          style.value = d.style ?? 'natural';
          styleWrap.appendChild(style);
          card.appendChild(styleWrap);

          card.appendChild(el('div', 'l2d-hint', t(
            '保存不重新打包，1 秒内生效。若这份已安装，需再点一次「安装」同步到 Coo。',
            'Saves without repacking. Re-install to sync if already installed.',
          )));

          const actions = el('div', 'l2d-modal-actions');
          const cancel = el('button', 'l2d-btn', t('取消', 'Cancel'));
          const save = el('button', 'l2d-btn primary', t('保存', 'Save'));
          actions.append(cancel, save);
          card.appendChild(actions);

          cancel.addEventListener('click', closeEdit);
          modal.addEventListener('click', (e) => { if (e.target === modal) closeEdit(); });

          save.addEventListener('click', async () => {
            save.disabled = true;
            try {
              await ctx.invoke('edit', [b.id, {
                nameZh: fields.nameZh.value.trim(),
                nameEn: fields.nameEn.value.trim(),
                aboutZh: fields.aboutZh.value.trim(),
                aboutEn: fields.aboutEn.value.trim(),
                bodyGain: Number(gain.value),
                style: style.value,
              }]);
              closeEdit();
              ui.toast(t('已保存', 'Saved'), 'ok');
              log.append(t('编辑 · ', 'Edited · ') + b.id, 'dim');
              await refresh();
            } catch (e) {
              ui.toast(text(e), 'bad');
              save.disabled = false;
            }
          });

          modal.appendChild(card);
          document.body.appendChild(modal);
          fields.nameZh.focus();
        }

        // ---------------- 绑定 ----------------
        pick.addEventListener('click', async () => {
          if (state.busy) return;
          const picked = await ctx.pickPath({ kind: 'directory', title: t('选择 Live2D 模型目录', 'Pick a Live2D model folder') });
          if (!picked) return;
          state.dir = picked;
          path.value = picked;
          try {
            await ctx.invoke('setDir', [picked]);
            ui.toast(t('已记下目录', 'Folder saved'), 'ok');
          } catch (e) {
            ui.toast(text(e), 'bad');
          }
        });
        path.addEventListener('input', () => { state.dir = path.value.trim(); });
        path.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && state.dir) {
            ctx.invoke('setDir', [state.dir]).catch((err) => ui.toast(text(err), 'bad'));
          }
        });
        scan.addEventListener('click', () => run('scan'));
        pack.addEventListener('click', () => run('build'));
        clearAll.addEventListener('click', async () => {
          if (state.busy) return;
          const ok = await ui.confirm({
            title: t('清空旧打包？', 'Clear old packs?'),
            body: t('保留最新一份，其余打包目录直接删除。已安装的形象不受影响。', 'Keeps the newest pack; installed figures stay.'),
            danger: true,
          });
          if (!ok) return;
          try {
            const r = await ctx.invoke('clearAll', []);
            state.builds = r.builds ?? [];
            paint();
            log.append(t('清空旧打包 · 删除 ', 'Cleared ') + r.removed + t(' 份', ' packs'), 'dim');
            ui.toast(t('已清空', 'Cleared'), 'ok');
          } catch (e) {
            ui.toast(text(e), 'bad');
          }
        });

        refresh().catch((e) => say(text(e), true));
      },
    },
  },
};

function text(e) {
  return String((e && e.message) || e);
}

function clock(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
