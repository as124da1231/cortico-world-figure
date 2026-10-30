/**
 * Coo 魔术人偶工坊 面板（浏览器端，手写 ESM，不打 bundle）。
 *
 * 一行：[选择目录…][路径][扫描][打包][导入…]
 * 卡片：[安装][编辑][删除]；编辑弹层直接改 figure.json / profile.js，不重新打包。
 * 导入弹层：zip / 文件夹 / 直接拖入，照 Coopanion 桌宠的做法。
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

        const state = { dir: '', busy: false, phase: '', builds: [], installed: null, figuresDir: '' };

        // ---- Live2D 核心组件：不随扩展分发，同意许可后从官方地址取 ----
        const coreCard = el('div', 'l2d-license');
        const coreText = el('span', 'l2d-license-text');
        const coreLicA = el('button', 'l2d-link', t('Core 许可', 'Core license'));
        const coreLicB = el('button', 'l2d-link', t('SDK 许可', 'SDK license'));
        const coreHome = el('button', 'l2d-link', t('打开官网', 'Download page'));
        const coreGet = el('button', 'l2d-btn sm primary', t('同意并获取', 'Agree & fetch'));
        coreCard.append(coreText, coreLicA, coreLicB, coreHome, coreGet);
        ctx.root.appendChild(coreCard);

        let core = { ok: false };
        const coreReady = () => core.ok === true;

        const openLicense = async (which) => {
          try {
            const r = await ctx.invoke('license', [which]);
            ui.drawer(r.file, r.text || t('（读不到许可文本）', '(license text missing)'));
          } catch (e) {
            ui.toast(text(e), 'bad');
          }
        };
        coreLicA.addEventListener('click', () => openLicense('core'));
        coreLicB.addEventListener('click', () => openLicense('sdk'));
        coreHome.addEventListener('click', () => {
          if (core.home) window.open(core.home, '_blank', 'noreferrer');
        });

        function paintCore() {
          coreCard.classList.toggle('ok', coreReady());
          if (coreReady()) {
            const kb = Math.round((core.bytes || 0) / 1024);
            coreText.textContent = t(
              `Live2D 核心已就绪 · ${core.version || ''} · ${kb} KB · 已校验`,
              `Live2D core ready · ${core.version || ''} · ${kb} KB · verified`,
            );
            coreGet.hidden = true;
          } else {
            coreText.textContent = t(
              '本扩展不附带 Live2D 核心组件。点「同意并获取」后，从 Live2D Inc. 官方服务器取同一份文件并校验 SHA-256；核心不随扩展分发。',
              'This extension does not ship the Live2D core. "Agree & fetch" downloads the same file from Live2D Inc. and verifies its SHA-256.',
            );
            coreGet.hidden = false;
          }
        }

        async function loadCore() {
          try {
            core = await ctx.invoke('core', []);
            paintCore();
          } catch (e) {
            ui.toast(text(e), 'bad');
          }
        }

        coreGet.addEventListener('click', async () => {
          if (state.busy) return;
          setBusy(true, t('获取核心…', 'Fetching core…'), undefined, 'core');
          try {
            core = await ctx.invoke('coreAccept', [true]);
            paintCore();
            log.append(t('已获取 Live2D 核心并校验', 'Live2D core fetched and verified'), 'dim');
            ui.toast(t('核心已就绪', 'Core ready'), 'ok');
          } catch (e) {
            ui.toast(text(e), 'bad');
            log.append('! ' + text(e), 'warn');
          } finally {
            setBusy(false);
          }
        });

        loadCore();

        const sheet = ui.sheet({
          title: t('Live2D 模型一键安装', 'Live2D One-Click Install'),
          en: t('Coo 魔术人偶工坊', 'Coo Marionette Atelier'),
          desc: t(
            '把 Live2D 模型整理成 Coo 能用的形象：扫描、打包、安装。只做装配，不含编辑。',
            'Turn a Live2D model into a Coo figure: scan, pack, install.',
          ),
        });
        ctx.root.appendChild(sheet.el);

        // ---- 一行 ----
        const bar = el('div', 'l2d-bar');
        const path = el('input', 'l2d-path');
        path.placeholder = t('模型目录（含 .model3.json）', 'Model folder (.model3.json)');
        path.spellcheck = false;
        const scan = el('button', 'l2d-btn', t('扫描', 'Scan'));
        const pack = el('button', 'l2d-btn primary', t('打包', 'Pack'));
        const importBtn = el('button', 'l2d-btn', t('导入', 'Import'));
        bar.append(importBtn, path, scan, pack);
        sheet.body.appendChild(bar);

        // ---- 状态 + 进度 ----
        const status = el('div', 'l2d-status');
        const spinner = el('span', 'l2d-spinner');
        const dot = el('span', 'dot');
        const statusText = el('span', null, t('就绪', 'Ready'));
        status.append(dot, spinner, statusText);
        sheet.body.appendChild(status);

        const progress = el('div', 'l2d-progress');
        const progressBar = el('span');
        progress.appendChild(progressBar);
        sheet.body.appendChild(progress);

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
          status.classList.toggle('bad', Boolean(bad));
        }

        /** 忙碌时：转圈 + 一条来回走的进度线 + 秒数。 */
        let ticker = 0;
        let startedAt = 0;
        function busyLabel(base, hint) {
          const ms = performance.now() - startedAt;
          say(hint ? `${base} · ${hint}` : `${base} ${(ms / 1000).toFixed(1)}s`);
        }
        function setBusy(on, base, hint, phase = '') {
          state.busy = on;
          state.phase = on ? phase : '';
          for (const b of [scan, pack, importBtn, clearAll]) b.disabled = on;
          for (const b of grid.querySelectorAll('button')) b.disabled = on;
          status.classList.toggle('busy', on);
          progress.classList.toggle('on', on);
          if (on) {
            startedAt = performance.now();
            if (base) busyLabel(base, hint);
            clearInterval(ticker);
            ticker = setInterval(() => { if (state.busy) busyLabel(base, hint); }, 120);
          } else {
            clearInterval(ticker);
            status.classList.remove('busy');
            progress.classList.remove('on');
            renderGrid();
          }
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
            if (state.busy && state.phase === 'build') {
              const ghost = el('div', 'l2d-card ghost');
              ghost.appendChild(el('div', 'empty shimmer'));
              ghost.appendChild(el('div', 'title shimmer'));
              ghost.appendChild(el('div', 'meta shimmer'));
              grid.appendChild(ghost);
              return;
            }
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
            const shown = (zh ? b.nameZh : b.nameEn) || b.nameZh || b.nameEn || b.id.replace(/(-\d{6,})+$/, '');
            const titleEl = el('div', 'title', shown);
            titleEl.title = b.id;
            card.appendChild(titleEl);
            card.appendChild(el('div', 'meta',
              `${(b.bytes / 1048576).toFixed(1)} MB · ${clock(b.at)}`));
            if (b.fit) card.appendChild(el('div', 'tagline', t('已贴合', 'fit')));

            const install = el('button', 'l2d-btn sm primary l2d-wide', t('安装', 'Install'));
            install.addEventListener('click', () => run('install', b.id));
            card.appendChild(install);

            const row = el('div', 'row');
            const edit = el('button', 'l2d-btn sm', t('编辑', 'Edit'));
            edit.addEventListener('click', () => openEdit(b, card));
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
          if (kind === 'build' && !coreReady()) {
            ui.toast(t('先获取 Live2D 核心组件', 'Fetch the Live2D core first'), 'bad');
            coreCard.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            return;
          }
          const label = kind === 'scan' ? t('扫描', 'Scan') : kind === 'build' ? t('打包', 'Pack') : t('安装', 'Install');
          setBusy(true, label + '…', undefined, kind);
          log.append(`→ ${label}`, 'dim');
          try {
            const args = kind === 'install' && id ? [state.dir, id] : [state.dir];
            const r = await ctx.invoke(kind, args);
            for (const line of r.log ?? []) log.append(line, 'dim');
            log.append(`✓ ${label} · ${((performance.now() - startedAt) / 1000).toFixed(1)}s`, 'plain');
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

        async function openEdit(b, cardEl) {
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
          const addField = (key, label, multiline, value) => {
            const wrap = el('div', 'l2d-field');
            wrap.appendChild(el('div', 'l2d-label', label));
            const input = multiline ? document.createElement('textarea') : document.createElement('input');
            input.className = 'l2d-input';
            if (multiline) input.rows = 2;
            input.value = value ?? '';
            fields[key] = input;
            wrap.appendChild(input);
            card.appendChild(wrap);
          };
          addField('name', t('名字', 'Name'), false, d.nameZh || d.nameEn || '');
          addField('about', t('一句话', 'About'), true, d.aboutZh || d.aboutEn || '');

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
              const name = fields.name.value.trim();
              const about = fields.about.value.trim();
              await ctx.invoke('edit', [b.id, {
                nameZh: name, nameEn: name,
                aboutZh: about, aboutEn: about,
                bodyGain: Number(gain.value),
                style: style.value,
              }]);
              // 先就地更新卡片，再拉一次完整列表
              if (cardEl && name) {
                const titleEl = cardEl.querySelector('.title');
                if (titleEl) titleEl.textContent = name;
              }
              b.nameZh = name;
              b.nameEn = name;
              closeEdit();
              ui.toast(t('已保存', 'Saved'), 'ok');
              log.append(t('编辑 · ', 'Edited · ') + b.id, 'dim');
              refresh().catch(() => {});
            } catch (e) {
              ui.toast(text(e), 'bad');
              save.disabled = false;
            }
          });

          modal.appendChild(card);
          document.body.appendChild(modal);
          fields.name.focus();
        }

        // ---------------- 导入 ----------------
        const MAX_MB = 32;

        function toBase64(buffer) {
          const bytes = new Uint8Array(buffer);
          const parts = [];
          const chunk = 0x8000;
          for (let i = 0; i < bytes.length; i += chunk) {
            parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunk)));
          }
          return btoa(parts.join(''));
        }

        /** 面板拼的文件夹包：与桌宠同一套格式（路径长度 + 路径 + 内容长度 + 内容）。 */
        function bundle(files) {
          const enc = new TextEncoder();
          const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
          return new Blob(files.flatMap(({ path, file }) => {
            const name = enc.encode(path);
            return [u32(name.length), name, u32(file.size), file];
          }));
        }

        /** 选中/拖进来的文件里，可能是包的目录：含 figure.json（打好的包）或 .model3.json（原始模型），最多 3 层。 */
        function packFiles(files, depth = 3) {
          const dirs = [...new Set(files
            .map((f) => f.path.split('/'))
            .filter((p) => {
              const name = (p[p.length - 1] || '').toLowerCase();
              return p.length - 2 <= depth && (name === 'figure.json' || name.endsWith('.model3.json'));
            })
            .map((p) => p.slice(0, -1).join('/')))]
            .sort((a, b) => a.length - b.length);
          const roots = dirs.filter((d, i) => !dirs.slice(0, i).some((r) => d.startsWith(r + '/')));
          if (!roots.length) return [];
          return files.filter((f) => roots.some((r) => (r ? f.path.startsWith(r + '/') : true)));
        }

        async function droppedFiles(entry, path, depth) {
          const list = [];
          const reader = entry.createReader();
          for (let batch; (batch = await new Promise((ok, bad) => reader.readEntries(ok, bad))).length;) list.push(...batch);
          const inPack = depth === Infinity || list.some((e) => e.isFile && e.name === 'figure.json');
          const out = [];
          for (const e of list) {
            if (e.isFile && inPack) out.push({ path: `${path}/${e.name}`, file: await new Promise((ok, bad) => e.file(ok, bad)) });
            else if (e.isDirectory && (inPack || depth > 0)) out.push(...await droppedFiles(e, `${path}/${e.name}`, inPack ? Infinity : depth - 1));
          }
          return out;
        }

        let importModal = null;

        function closeImport() {
          if (!importModal) return;
          importModal.remove();
          importModal = null;
          ctx.invoke('importCancel', []).catch(() => {});
        }

        async function stageBytes(bytes, kind, view) {
          if (bytes.byteLength > MAX_MB * 1048576) {
            view.note(t('文件太大', 'Too big'), t(`超过 ${MAX_MB} MB，换个小一点的`, `Over ${MAX_MB} MB`), true);
            return;
          }
          view.loading(kind === 'zip' ? t('解包中…', 'Unpacking…') : t('读取文件夹…', 'Reading folder…'));
          try {
            const r = await ctx.invoke('importStage', [toBase64(bytes), kind]);
            view.result(r);
          } catch (e) {
            view.note(t('导入失败', 'Import failed'), text(e), true);
          }
        }

        async function stageFolder(files, view) {
          const picked = packFiles(files, 3);
          if (!picked.length) {
            view.note(t('这里没有模型包', 'No model pack here'), t('没有找到 .model3.json，也没有 figure.json。', 'No .model3.json and no figure.json.'), false);
            return;
          }
          view.loading(t('读取文件夹…', 'Reading folder…'));
          try {
            const { token } = await ctx.invoke('importBegin', []);
            let batch = [];
            let bytes = 0;
            for (const f of picked) {
              const b64 = toBase64(await f.file.arrayBuffer());
              batch.push({ path: f.path, b64 });
              bytes += b64.length;
              if (bytes > 6 * 1048576) {
                await ctx.invoke('importAppend', [token, batch]);
                batch = []; bytes = 0;
              }
            }
            if (batch.length) await ctx.invoke('importAppend', [token, batch]);
            const r = await ctx.invoke('importFinish', [token, true]);
            view.result(r);
          } catch (e) {
            view.note(t('导入失败', 'Import failed'), text(e), true);
          }
        }

        function openImport() {
          if (state.busy) return;
          if (importModal) { importModal.remove(); importModal = null; }

          importModal = el('div', 'l2d-modal');
          const card = el('div', 'l2d-modal-card l2d-import');
          const head2 = el('div', 'l2d-modal-head');
          head2.appendChild(el('div', 'l2d-modal-title', t('导入模型包', 'Import a model pack')));
          card.appendChild(head2);
          card.appendChild(el('div', 'l2d-import-lead', t(
            '选 zip 或文件夹。Live2D 模型会打包，打好的包会直接安装。',
            'Pick a zip or folder: models get packed, finished packs get installed.',
          )));

          const actions = el('div', 'l2d-import-actions');
          const zipBtn = el('button', 'l2d-btn primary', t('选择 zip 文件', 'Choose zip'));
          const dirBtn = el('button', 'l2d-btn', t('选择文件夹', 'Choose folder'));
          actions.append(zipBtn, dirBtn);
          card.appendChild(actions);
          card.appendChild(el('div', 'l2d-import-hint', t('也可以直接拖进来。', 'You can also drop it in.')));

          const body = el('div', 'l2d-import-body');
          card.appendChild(body);

          const foot2 = el('div', 'l2d-modal-actions');
          const cancel = el('button', 'l2d-btn', t('取消', 'Cancel'));
          foot2.appendChild(cancel);
          card.appendChild(foot2);

          const zipInput = document.createElement('input');
          zipInput.type = 'file';
          zipInput.accept = '.zip,application/zip';
          zipInput.hidden = true;
          const dirInput = document.createElement('input');
          dirInput.type = 'file';
          dirInput.webkitdirectory = true;
          dirInput.hidden = true;
          card.append(zipInput, dirInput);

          const view = {
            loading(label) {
              body.replaceChildren();
              const row = el('div', 'l2d-import-loading');
              row.append(el('span', 'l2d-spinner on'), el('span', null, label));
              body.appendChild(row);
            },
            note(title, detail, bad) {
              body.replaceChildren();
              body.appendChild(el('div', 'l2d-import-note' + (bad ? ' bad' : ''), title));
              if (detail) body.appendChild(el('div', 'l2d-hint', detail));
            },
            result(r) {
              body.replaceChildren();
              const packs = r.packs ?? [];
              const models = r.models ?? [];
              const problems = r.problems ?? [];
              if (!packs.length && !models.length) {
                body.appendChild(el('div', 'l2d-import-note', t('这里没有模型包', 'No model pack here')));
                for (const p of problems) body.appendChild(el('div', 'l2d-hint', `${p.dir || '.'} · ${p.reason}`));
                return;
              }

              if (models.length) {
                body.appendChild(el('div', 'l2d-import-note', t(`Live2D 模型 ${models.length} 个`, `${models.length} model(s)`)));
                for (const m of models) {
                  const row = el('div', 'l2d-packrow');
                  row.appendChild(el('div', 'l2d-packrow-empty', t('模型', 'model')));
                  const info = el('div', 'l2d-packrow-info');
                  info.appendChild(el('div', 'l2d-packrow-name', m.title));
                  info.appendChild(el('div', 'l2d-packrow-meta',
                    [m.dir || '.', t(`${m.files} 个文件`, `${m.files} files`), `${(m.bytes / 1048576).toFixed(1)} MB`].join(' · ')));
                  info.appendChild(el('div', 'l2d-packrow-tag', t('打包后可以改名字和参数，再安装', 'pack first, edit, then install')));
                  row.appendChild(info);
                  const go = el('button', 'l2d-btn sm primary', t('打包', 'Pack'));
                  go.addEventListener('click', async () => {
                    go.disabled = true;
                    go.textContent = t('打包中…', 'Packing…');
                    try {
                      const out = await ctx.invoke('importBuild', [r.token, m.dir, false]);
                      for (const line of out.log ?? []) log.append(line, 'dim');
                      log.append(t('导入模型 · ', 'Imported model · ') + m.title, 'dim');
                      log.append(t('已排到「已打包」，可以点编辑改名或调参数', 'Packed; edit it from the pack card'), 'dim');
                      ui.toast(t('已打包', 'Packed'), 'ok');
                      closeImport();
                      await refresh();
                    } catch (e) {
                      ui.toast(text(e), 'bad');
                      go.disabled = false;
                      go.textContent = t('打包', 'Pack');
                    }
                  });
                  row.appendChild(go);
                  body.appendChild(row);
                }
              }

              if (packs.length) {
                body.appendChild(el('div', 'l2d-import-note', t(`已打好的包 ${packs.length} 个`, `${packs.length} finished pack(s)`)));
                for (const p of packs) {
                  const row = el('div', 'l2d-packrow');
                  if (p.thumb) {
                    const img = document.createElement('img');
                    img.src = p.thumb;
                    img.alt = '';
                    row.appendChild(img);
                  } else {
                    row.appendChild(el('div', 'l2d-packrow-empty'));
                  }
                  const info = el('div', 'l2d-packrow-info');
                  info.appendChild(el('div', 'l2d-packrow-name', zh ? p.nameZh : p.nameEn));
                  const meta = [
                    p.id,
                    p.version ? `v${p.version}` : '',
                    `${(p.bytes / 1048576).toFixed(1)} MB`,
                    t(`${p.axes} 选项`, `${p.axes} axes`),
                    t(`${p.words} 词`, `${p.words} words`),
                  ].filter(Boolean).join(' · ');
                  info.appendChild(el('div', 'l2d-packrow-meta', meta));
                  if (p.installed) {
                    info.appendChild(el('div', 'l2d-packrow-tag', t(`已装 ${p.installed}，安装会替换`, `installed ${p.installed}, will replace`)));
                  }
                  row.appendChild(info);
                  const go = el('button', 'l2d-btn sm primary', t('安装', 'Install'));
                  go.addEventListener('click', async () => {
                    let replace = [];
                    if (p.installed) {
                      const ok = await ui.confirm({
                        title: t('替换已装的这份？', 'Replace the installed pack?'),
                        body: t(`「${zh ? p.nameZh : p.nameEn}」已经装过，安装会用新的覆盖它（旧的那份先备份）。`, 'A pack with this id is installed; the new one replaces it after a backup.'),
                        danger: true,
                      });
                      if (!ok) return;
                      replace = [p.id];
                    }
                    go.disabled = true;
                    go.textContent = t('安装中…', 'Installing…');
                    try {
                      const out = await ctx.invoke('importInstall', [r.token, [p.dir], replace]);
                      if (out && out.conflicts) {
                        ui.toast(t('同名已存在', 'Id already installed'), 'bad');
                        go.disabled = false;
                        go.textContent = t('安装', 'Install');
                        return;
                      }
                      ui.toast(t('已导入', 'Imported'), 'ok');
                      log.append(t('导入 · ', 'Imported · ') + p.id, 'dim');
                      closeImport();
                      await refresh();
                    } catch (e) {
                      ui.toast(text(e), 'bad');
                      go.disabled = false;
                      go.textContent = t('安装', 'Install');
                    }
                  });
                  row.appendChild(go);
                  body.appendChild(row);
                }
              }

              for (const p of problems) body.appendChild(el('div', 'l2d-hint', `${p.dir || '.'} · ${p.reason}`));
            },
          };

          zipBtn.addEventListener('click', () => zipInput.click());
          dirBtn.addEventListener('click', () => dirInput.click());
          dirInput.addEventListener('change', async () => {
            const files = [...(dirInput.files ?? [])].map((f) => ({ path: f.webkitRelativePath || f.name, file: f }));
            if (!files.length) return;
            await stageFolder(files, view);
          });
          zipInput.addEventListener('change', async () => {
            const f = zipInput.files?.[0];
            if (!f) return;
            await stageBytes(await f.arrayBuffer(), 'zip', view);
          });

          // 拖入
          const over = (on) => card.classList.toggle('drop', on);
          card.addEventListener('dragover', (e) => { e.preventDefault(); over(true); });
          card.addEventListener('dragleave', (e) => { if (!card.contains(e.relatedTarget)) over(false); });
          card.addEventListener('drop', async (e) => {
            e.preventDefault();
            over(false);
            const dt = e.dataTransfer;
            if (!dt) return;
            const entries = [...(dt.items ?? [])]
              .filter((i) => i.kind === 'file')
              .map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null))
              .filter(Boolean);
            if (entries.length === 1 && entries[0].isFile) {
              const f = await new Promise((ok, bad) => entries[0].file(ok, bad));
              if (f.name.toLowerCase().endsWith('.zip')) {
                await stageBytes(await f.arrayBuffer(), 'zip', view);
                return;
              }
            }
            const files = [];
            for (const entry of entries) {
              if (entry.isFile) files.push({ path: entry.name, file: await new Promise((ok, bad) => entry.file(ok, bad)) });
              else if (entry.isDirectory) files.push(...await droppedFiles(entry, entry.name, 1));
            }
            if (!files.length) {
              const plain = [...(dt.files ?? [])].map((f) => ({ path: f.name, file: f }));
              if (plain.length === 1 && plain[0].file.name.toLowerCase().endsWith('.zip')) {
                await stageBytes(await plain[0].file.arrayBuffer(), 'zip', view);
                return;
              }
              view.note(t('没读到内容', 'Nothing to read'), t('换一个文件夹试试。', 'Try another folder.'), true);
              return;
            }
            await stageFolder(files, view);
          });

          cancel.addEventListener('click', closeImport);
          importModal.addEventListener('click', (e) => { if (e.target === importModal) closeImport(); });
          importModal.appendChild(card);
          document.body.appendChild(importModal);
        }

        // ---------------- 绑定 ----------------
        path.addEventListener('input', () => { state.dir = path.value.trim(); });
        path.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && state.dir) {
            ctx.invoke('setDir', [state.dir]).catch((err) => ui.toast(text(err), 'bad'));
          }
        });
        scan.addEventListener('click', () => run('scan'));
        pack.addEventListener('click', () => run('build'));
        importBtn.addEventListener('click', openImport);
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
