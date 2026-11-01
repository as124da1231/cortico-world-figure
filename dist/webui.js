/**
 * Coo 魔术人偶工坊 面板（浏览器端，手写 ESM，不打 bundle）。
 *
 * 导入区：[拖入 / 点击后粘贴] [选择文件夹 / ZIP] [一键打包]
 * 卡片：[安装][编辑][删除]；编辑弹层直接改 figure.json / profile.js，不重新打包。
 * 原始模型打包、现成形象包入库，均保留卡片上的安装操作。
 */
const NOTICE_TEXT = {
  zh: '本功能生成的形象包包含 Live2D Cubism Core。请仅在本机使用，不要将这些形象包上传、分享或再次分发给他人。模型、贴图和第三方组件仍各自受原许可约束。',
  en: 'Generated figure packs contain Live2D Cubism Core. Use these packs locally; do not upload, share or redistribute them. Models, textures and third-party components remain subject to their respective licenses.',
};

export default {
  panels: {
    'config-notice': {
      mount(ctx) {
        const doc = ctx.root.ownerDocument;
        const zh = String(ctx.language || 'zh').toLowerCase().startsWith('zh');
        const details = doc.createElement('details');
        details.className = 'l2d-notice l2d-config-notice';
        details.hidden = true;
        const summary = doc.createElement('summary');
        summary.textContent = zh ? '须知' : 'Notice';
        const content = doc.createElement('p');
        content.textContent = zh ? NOTICE_TEXT.zh : NOTICE_TEXT.en;
        details.append(summary, content);
        ctx.root.appendChild(details);
        let disposed = false;
        ctx.invoke('state', []).then((state) => {
          if (!disposed) details.hidden = state.notice?.acknowledged !== true;
        }).catch((error) => {
          if (!disposed) ctx.ui.toast(error?.message || String(error), 'bad');
        });
        return { dispose() { disposed = true; details.remove(); } };
      },
    },
    workbench: {
      mount(ctx) {
        const ui = ctx.ui;
        const doc = ctx.root.ownerDocument;
        const win = doc.defaultView;
        const zh = String(ctx.language || 'zh').toLowerCase().startsWith('zh');
        const t = (a, b) => (zh ? a : b);
        const el = (tag, cls, text) => {
          const n = doc.createElement(tag);
          if (cls) n.className = cls;
          if (text != null) n.textContent = text;
          return n;
        };

        let disposed = false;
        let initialized = false;
        let notice = null;
        let version = '';
        let activeImportToken = null;
        let resumeHandle = null;
        let resuming = false;
        let resumePolling = false;
        let resumePhase;
        const state = { dir: '', busy: false, phase: '', builds: [], installed: null, figuresDir: '' };

        // ---- Live2D 核心组件：不随扩展分发，同意许可后从官方地址取 ----
        const coreCard = el('div', 'l2d-license');
        const coreText = el('span', 'l2d-license-text');
        const coreLicA = el('button', 'l2d-link', t('Core 许可', 'Core license'));
        const coreLicB = el('button', 'l2d-link', t('SDK 许可', 'SDK license'));
        const coreHome = el('button', 'l2d-link', t('打开官网', 'Download page'));
        const coreGet = el('button', 'l2d-btn sm primary', t('同意并获取', 'Agree & fetch'));
        coreCard.append(coreText, coreLicA, coreLicB, coreHome, coreGet);


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
          if (core.home) win.open(core.home, '_blank', 'noreferrer');
        });

        function paintCore() {
          if (disposed) return;
          coreCard.classList.toggle('ok', coreReady());
          if (coreReady()) noticeDetails.appendChild(coreCard);
          else noticeTop.appendChild(coreCard);
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

        const sheet = ui.sheet({
          title: t('Live2D 模型一键安装', 'Live2D One-Click Install'),
          en: t('Coo 魔术人偶工坊', 'Coo Marionette Atelier'),
          desc: t(
            '拖入或粘贴模型，一键打包后安装到 Coo。',
            'Drop or paste a model, pack it, then install it into Coo.',
          ),
        });
        ctx.root.appendChild(sheet.el);
        const noticeTop = el('div', 'l2d-notice-top');
        sheet.body.appendChild(noticeTop);
        let versionCorner = el('button', 'l2d-version-corner', '…');
        versionCorner.type = 'button';
        versionCorner.disabled = true;
        versionCorner.setAttribute('aria-controls', 'l2d-distribution-notice');
        sheet.el.classList.add('l2d-sheet');
        sheet.el.appendChild(versionCorner);
        const noticeDetails = el('details', 'l2d-notice');
        noticeDetails.id = 'l2d-distribution-notice';
        const noticeSummary = el('summary', null, t('须知', 'Notice'));
        noticeDetails.appendChild(noticeSummary);
        noticeDetails.appendChild(el('p', null, t(NOTICE_TEXT.zh, NOTICE_TEXT.en)));
        const acknowledge = el('button', 'l2d-btn sm primary', t('我已知晓，不再分发', 'I understand — no redistribution'));
        noticeDetails.appendChild(acknowledge);
        noticeTop.appendChild(noticeDetails);
        function paintNotice() {
          if (disposed) return;
          const ack = notice?.acknowledged === true;
          if (ack) {
            noticeDetails.open = false;
            noticeDetails.remove();
          }
          versionCorner.textContent = version ? `v${version}` : '…';
          versionCorner.classList.toggle('unack', !ack);
          versionCorner.classList.toggle('ack', ack);
          versionCorner.title = ack ? t('查看须知', 'Read notice') : t('请阅读并确认须知', 'Read and acknowledge the notice');
          versionCorner.disabled = !notice || state.busy;
          if (ack) { versionCorner.removeAttribute('aria-controls'); versionCorner.removeAttribute('aria-expanded'); }
          versionCorner.setAttribute('aria-label', `${versionCorner.textContent} · ${ack ? t('已确认', 'Acknowledged') : t('未确认', 'Not acknowledged')}`);
          acknowledge.hidden = ack;
          acknowledge.disabled = !notice || state.busy;
          if (!ack) {
            versionCorner.disabled = !notice;
            versionCorner.setAttribute('aria-expanded', String(noticeDetails.open));
          }
        }
        versionCorner.addEventListener('click', () => {
          if (notice?.acknowledged) { ui.drawer(t('须知', 'Notice'), t(NOTICE_TEXT.zh, NOTICE_TEXT.en)); return; }
          noticeDetails.open = !noticeDetails.open;
          noticeDetails.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
          paintNotice();
        });
        noticeDetails.addEventListener('toggle', paintNotice);
        acknowledge.addEventListener('click', async () => {
          if (!notice || state.busy) return;
          setBusy(true, t('保存须知…', 'Saving acknowledgement…'), undefined, 'notice');
          try {
            notice = await ctx.invoke('noticeAccept', [notice.revision]);
            noticeDetails.open = false;
            paintNotice();
          } catch (e) { ui.toast(text(e), 'bad'); }
          finally {
            setBusy(false);
            paintNotice();
            if (notice?.acknowledged) dropZone.focus({ preventScroll: true });
          }
        });
        function ensureNotice() {
          if (notice?.acknowledged) return true;
          noticeDetails.open = true;
          noticeDetails.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
          acknowledge.focus();
          ui.toast(t('请先确认形象包分发须知', 'Acknowledge the distribution notice first'), 'bad');
          return false;
        }


        // ---- 导入区与两个主操作 ----
        const bar = el('div', 'l2d-import-bar');
        const dropZone = el('div', 'l2d-drop-zone');
        dropZone.tabIndex = 0;
        dropZone.setAttribute('role', 'region');
        dropZone.setAttribute('aria-label', t('模型导入区域，点击后可粘贴', 'Model import area; click to paste'));
        const sourceTitle = el('div', 'l2d-source-title');
        const sourceHint = el('div', 'l2d-source-hint');
        dropZone.append(sourceTitle, sourceHint);
        const actions = el('div', 'l2d-import-controls');
        const chooseFolder = el('button', 'l2d-btn', t('选择文件夹', 'Choose folder'));
        const chooseZip = el('button', 'l2d-btn', t('选择 ZIP', 'Choose ZIP'));
        const pack = el('button', 'l2d-btn primary', t('一键打包', 'Pack models'));
        const folderInput = doc.createElement('input');
        folderInput.type = 'file';
        folderInput.webkitdirectory = true;
        folderInput.setAttribute('webkitdirectory', '');
        folderInput.hidden = true;
        const zipInput = doc.createElement('input');
        zipInput.type = 'file';
        zipInput.accept = '.zip,application/zip';
        zipInput.hidden = true;
        actions.append(chooseFolder, chooseZip, pack);
        bar.append(dropZone, actions, folderInput, zipInput);
        sheet.body.appendChild(bar);
        let staged = null;
        const completed = new Set();
        function paintSource() {
          const models = staged?.models ?? [];
          const packs = staged?.packs ?? [];
          const count = models.length + packs.length;
          const names = [...models.map(m => m.title), ...packs.map(p => (zh ? p.nameZh : p.nameEn) || p.id)];
          sourceTitle.textContent = count ? names.slice(0, 3).join('、') + (count > 3 ? t(` 等 ${count} 项`, ` and ${count - 3} more`) : '') : t('拖入模型或 ZIP', 'Drop a model folder or ZIP');
          sourceTitle.title = names.join('\n');
          sourceHint.textContent = count
            ? (completed.size === count ? t('已加入下方卡片，可编辑或安装；也可拖入其他模型', 'Added below; edit or install, or drop another model') : t(`已识别 ${count} 项，点击右侧一键打包`, `${count} recognized; pack using the button on the right`))
            : t('点击此区域后，按 Ctrl+V 粘贴文件或目录路径', 'Click here, then press Ctrl+V to paste files or a local path');
          dropZone.classList.toggle('ready', count > 0);
          dropZone.setAttribute('aria-disabled', String(state.busy));
          pack.disabled = state.busy || !count || completed.size === count;
        }
        paintSource();

        // ---- 状态 + 进度 ----
        const status = el('div', 'l2d-status');
        const spinner = el('span', 'l2d-spinner');
        const dot = el('span', 'dot');
        const statusText = el('span', null, t('就绪', 'Ready'));
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        status.append(dot, spinner, statusText);
        sheet.body.appendChild(status);
        const adaptationNote = el('div');
        sheet.body.appendChild(adaptationNote);

        function adaptationDetails(info) {
          if (!info) return null;
          const corrected = Array.isArray(info.corrected) ? info.corrected : [];
          const limited = Array.isArray(info.limited) ? info.limited : [];
          const warnings = Array.isArray(info.warnings) ? info.warnings : [];
          if (!corrected.length && !limited.length && !warnings.length) return null;
          const names = {
            eyeOpen: t('眨眼', 'Blink'), eyeSmile: t('笑眼', 'Eye smile'),
            browY: t('眉毛升降', 'Brow height'), browAngle: t('眉毛角度', 'Brow angle'),
            mouthOpen: t('张嘴', 'Mouth opening'), mouthForm: t('嘴形', 'Mouth shape'),
            cheek: t('脸红', 'Blush'), eyeBallX: t('横向视线', 'Horizontal gaze'), eyeBallY: t('纵向视线', 'Vertical gaze'),
            angleX: t('左右转头', 'Head turn'), angleY: t('抬头低头', 'Head pitch'), angleZ: t('歪头', 'Head tilt'),
            bodyX: t('身体跟随', 'Body follow'), breath: t('呼吸', 'Breathing'),
            step: t('腿部步态', 'Leg gait'), armA: t('手臂动作', 'Arm motion'), armB: t('手臂姿势', 'Arm pose'),
          };
          const show = roles => [...new Set(roles.map(r => names[r] || r))].join('、');
          const detail = el('details', 'l2d-adaptation');
          detail.appendChild(el('summary', null, limited.length || warnings.length
            ? t('已自动适配 · 部分效果简化', 'Adapted · some effects simplified')
            : t('已自动修正适配', 'Adaptation corrected automatically')));
          if (corrected.length) detail.appendChild(el('p', null, t('自动识别：', 'Detected: ') + show(corrected)));
          if (limited.length) detail.appendChild(el('p', null, t('沿用基础表现，独立控制受限：', 'Basic behavior retained; independent controls limited: ') + show(limited)));
          if (warnings.length) detail.appendChild(el('p', null, t('部分配置不可用，已自动使用基础识别。', 'Some configuration is unavailable; basic detection is used.')));
          detail.appendChild(el('p', null, t('继续使用已识别的通用动作和表情，无需手动配置参数。', 'Detected generic motions and expressions remain available; no manual parameter setup is needed.')));
          return detail;
        }

        function showAdaptation(info) {
          const detail = adaptationDetails(info);
          adaptationNote.replaceChildren(...(detail ? [detail] : []));
        }

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
          if (disposed) return;
          state.busy = on;
          folderInput.disabled = on;
          zipInput.disabled = on;
          coreGet.disabled = on;
          versionCorner.disabled = on || !notice;
          acknowledge.disabled = on || !notice;
          ctx.root.setAttribute('aria-busy', String(on));
          state.phase = on ? phase : '';
          for (const b of [pack, chooseFolder, chooseZip, clearAll]) b.disabled = on;
          dropZone.setAttribute('aria-disabled', String(on));
          const count = (staged?.models?.length || 0) + (staged?.packs?.length || 0);
          pack.disabled = on || !count || completed.size === count;
          for (const b of grid.querySelectorAll('button')) b.disabled = on;
          for (const input of modal?.querySelectorAll('button, input, textarea, select') ?? []) input.disabled = on;
          status.classList.toggle('busy', on);
          progress.classList.toggle('on', on);
          if (on) {
            startedAt = performance.now();
            if (base) busyLabel(base, hint);
            clearInterval(ticker);
            renderGrid();
            ticker = setInterval(() => { if (state.busy) busyLabel(base, hint); }, 120);
          } else {
            clearInterval(ticker);
            status.classList.remove('busy');
            progress.classList.remove('on');
            if (!status.classList.contains('bad')) paint();
            else renderGrid();
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
            grid.appendChild(el('div', 'l2d-empty', t('导入模型后，点击「一键打包」', 'Import a model, then pack it')));
            return;
          }
          const installedId = state.installed?.buildId;
          for (const b of state.builds) {
            const card = el('div', 'l2d-card' + (installedId === b.id ? ' installed' : ''));
            if (b.thumb) {
              const img = doc.createElement('img');
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
            const adaptation = adaptationDetails(b.adaptation);
            if (adaptation) card.appendChild(adaptation);

            const install = el('button', 'l2d-btn sm primary l2d-wide', t('安装', 'Install'));
            install.addEventListener('click', () => run('install', b.id));
            card.appendChild(install);

            const row = el('div', 'row');
            const edit = el('button', 'l2d-btn sm', t('编辑', 'Edit'));
            edit.addEventListener('click', () => { if (!state.busy) openEdit(b, card); });
            const del = el('button', 'l2d-btn sm danger', t('删除', 'Delete'));
            del.addEventListener('click', async () => {
              if (state.busy) return;
              const ok = await ui.confirm({
                title: t('删除这份打包产物？', 'Delete this pack?'),
                body: t('只删这一份打包，已安装的形象不受影响。', 'Only this pack folder is removed.'),
                danger: true,
              });
              if (!ok) return;
              setBusy(true, t('删除…', 'Deleting…'));
              try {
                const r = await ctx.invoke('remove', [b.id]);
                state.builds = r.builds ?? [];
                paint();
                log.append(t('已删除 ', 'Deleted ') + b.id, 'dim');
                ui.toast(t('已删除', 'Deleted'), 'ok');
              } catch (e) {
                ui.toast(text(e), 'bad');
              } finally { setBusy(false); }
            });
            row.append(edit, del);
            card.appendChild(row);
            for (const button of card.querySelectorAll('button')) button.disabled = state.busy;
            grid.appendChild(card);
          }
        }

        async function refresh() {
          const r = await ctx.invoke('list', []);
          if (disposed) return;
          state.builds = r.builds ?? [];
          state.installed = r.installed ?? null;
          state.figuresDir = r.figuresDir ?? '';
          const d = r.dir ?? '';
          if (!initialized && d) {
            state.dir = d;
          }
          initialized = true;
          paint();
        }

        async function run(kind, id) {
          if (state.busy) return;
          if (kind !== 'scan' && !ensureNotice()) return;
          if (kind !== 'install' && !state.dir) return;
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
            if (disposed) return;
            for (const line of r.log ?? []) log.append(line, 'dim');
            log.append(`✓ ${label} · ${((performance.now() - startedAt) / 1000).toFixed(1)}s`, 'plain');
            ui.toast(`${label} ✓`, 'ok');
            if (r.warn) log.append('! ' + r.warn, 'warn');
            await refresh().catch(e => log.append(t('操作已完成，列表刷新失败：', 'Completed, but the list could not refresh: ') + text(e), 'warn'));
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
        let editReturnFocus = null;

        function closeEdit() {
          if (state.busy) return;
          if (modal) { modal.remove(); modal = null; editReturnFocus?.focus(); }
        }

        async function openEdit(b, cardEl) {
          if (state.busy || modal) return;
          editReturnFocus = doc.activeElement;
          const d = await ctx.invoke('detail', [b.id]).catch(() => null);
          if (disposed || state.busy || modal) return;
          if (!d) { ui.toast(t('读不到这份打包的信息', 'Cannot read this pack'), 'bad'); return; }

          modal = el('div', 'l2d-modal');
          accessibleModal(modal, t('编辑形象信息', 'Edit figure'));
          const card = el('div', 'l2d-modal-card');
          const head2 = el('div', 'l2d-modal-head');
          head2.appendChild(el('div', 'l2d-modal-title', t('编辑形象信息', 'Edit figure')));
          head2.appendChild(el('div', 'l2d-modal-sub', b.id.replace(/(-\d{6,})+$/, '')));
          card.appendChild(head2);

          const fields = {};
          const addField = (key, label, multiline, value) => {
            const wrap = el('div', 'l2d-field');
            const labelEl = el('label', 'l2d-label', label);
            wrap.appendChild(labelEl);
            const input = multiline ? doc.createElement('textarea') : doc.createElement('input');
            input.id = `l2d-edit-${key}`;
            labelEl.htmlFor = input.id;
            input.maxLength = key === 'name' ? 120 : 1000;
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
          const gain = doc.createElement('input');
          gain.type = 'range';
          gain.setAttribute('aria-label', t('身体幅度', 'Body gain'));
          gain.min = '0.5';
          gain.max = '3';
          gain.step = '0.05';
          gain.value = String(d.bodyGain ?? 1.8);
          gain.className = 'l2d-range';
          gain.addEventListener('input', () => { gainOut.textContent = Number(gain.value).toFixed(2); });
          gainWrap.appendChild(gain);
          gainWrap.hidden = d.tunable === false;
          card.appendChild(gainWrap);

          const styleWrap = el('div', 'l2d-field');
          styleWrap.appendChild(el('div', 'l2d-label', t('动作风格', 'Motion style')));
          const style = doc.createElement('select');
          style.className = 'l2d-input';
          style.setAttribute('aria-label', t('动作风格', 'Motion style'));
          for (const [v, label] of [['natural', t('自然', 'Natural')], ['lively', t('活泼', 'Lively')], ['calm', t('安静', 'Calm')], ['shy', t('害羞', 'Shy')]]) {
            const o = doc.createElement('option');
            o.value = v;
            o.textContent = label;
            style.appendChild(o);
          }
          style.value = d.style ?? 'natural';
          styleWrap.appendChild(style);
          styleWrap.hidden = d.tunable === false;
          card.appendChild(styleWrap);

          card.appendChild(el('div', 'l2d-hint', t(
            '直接保存到该份打包产物。若这份已安装，需再点一次「安装」同步到 Coo。',
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
            if (state.busy) return;
            if (!fields.name.value.trim()) { ui.toast(t('名字不能为空', 'Name is required'), 'bad'); fields.name.focus(); return; }
            save.disabled = true;
            setBusy(true, t('保存…', 'Saving…'), undefined, 'edit');
            try {
              const name = fields.name.value.trim();
              const about = fields.about.value.trim();
              await ctx.invoke('edit', [b.id, {
                nameZh: name, nameEn: name,
                aboutZh: about, aboutEn: about,
                ...(d.tunable === false ? {} : {bodyGain:Number(gain.value),style:style.value}),
              }]);
              // 先就地更新卡片，再拉一次完整列表
              if (cardEl && name) {
                const titleEl = cardEl.querySelector('.title');
                if (titleEl) titleEl.textContent = name;
              }
              b.nameZh = name;
              b.nameEn = name;
              setBusy(false);
              closeEdit();
              ui.toast(t('已保存', 'Saved'), 'ok');
              log.append(t('编辑 · ', 'Edited · ') + b.id, 'dim');
              refresh().catch(() => {});
            } catch (e) {
              ui.toast(text(e), 'bad');
            } finally { save.disabled = false; setBusy(false); }
          });

          modal.appendChild(card);
          ctx.root.appendChild(modal);
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
          const inPack = depth === Infinity || list.some((e) => e.isFile && (e.name.toLowerCase() === 'figure.json' || e.name.toLowerCase().endsWith('.model3.json')));
          const out = [];
          for (const e of list) {
            if (e.isFile && inPack) out.push({ path: `${path}/${e.name}`, file: await new Promise((ok, bad) => e.file(ok, bad)) });
            else if (e.isDirectory && (inPack || depth > 0)) out.push(...await droppedFiles(e, `${path}/${e.name}`, inPack ? Infinity : depth - 1));
          }
          return out;
        }

        function cancelOwnedImport(token = activeImportToken) {
          if (!token) return;
          if (disposed && ctx.notifyOnUnmount) ctx.notifyOnUnmount('importCancel', [token]);
          else ctx.invoke('importCancel', [token]).catch(() => {});
        }

        const importView = {
          loading(label) { sourceTitle.textContent = label; sourceHint.textContent = ''; },
          note(title, detail, bad) {
            staged = null; completed.clear(); paintSource();
            sourceHint.textContent = [title, detail].filter(Boolean).join('：');
            dropZone.classList.toggle('bad', Boolean(bad));
          },
          result(result) {
            if (disposed) { cancelOwnedImport(result.token); return; }
            activeImportToken = result.token;
            staged = result; completed.clear(); dropZone.classList.remove('bad');
            showAdaptation(null); paintSource();
            if (!(result.models?.length || result.packs?.length)) {
              sourceHint.textContent = result.problems?.map(p => p.reason).join('；') || t('未找到 .model3.json 或 figure.json', 'No .model3.json or figure.json found');
            }
          },
        };

        function clearSource() {
          staged = null; completed.clear(); showAdaptation(null); paintSource();
          dropZone.classList.remove('bad');
        }

        async function stageZip(file) {
          if (state.busy || disposed) return;
          if (file.size > MAX_MB * 1048576) { importView.note(t('ZIP 太大', 'ZIP too large'), t('请解压后选择文件夹', 'Extract it and choose the folder'), true); return; }
          clearSource(); setBusy(true, t('读取 ZIP…', 'Reading ZIP…'), undefined, 'import');
          importView.loading(t('解包中…', 'Unpacking…'));
          try {
            const bytes = await file.arrayBuffer();
            if (disposed) return;
            if (bytes.byteLength > MAX_MB * 1048576) throw new Error(t('ZIP 超过 32 MB，请解压后导入文件夹', 'ZIP exceeds 32 MB; import the extracted folder'));
            importView.result(await ctx.invoke('importStage', [toBase64(bytes), 'zip']));
          } catch (error) { if (!disposed) importView.note(t('导入失败', 'Import failed'), text(error), true); }
          finally { setBusy(false); }
        }

        async function stageFolder(files, view) {
          if (state.busy || disposed) return;
          const picked = packFiles(files, 3);
          if (!picked.length) { view.note(t('这里没有模型包', 'No model pack here'), t('没有找到 .model3.json 或 figure.json', 'No .model3.json or figure.json found'), false); return; }
          if (picked.length > 20000 || picked.reduce((n, f) => n + (Number(f.file.size) || 0), 0) > 512 * 1048576) { view.note(t('目录过大', 'Folder too large'), t('请改用粘贴本机目录路径', 'Paste its local directory path instead'), true); return; }
          clearSource(); setBusy(true, t('读取文件夹…', 'Reading folder…'), undefined, 'import');
          view.loading(t('读取文件夹…', 'Reading folder…'));
          let token;
          try {
            token = (await ctx.invoke('importBegin', [])).token;
            activeImportToken = token;
            let batch = [], bytes = 0;
            const flush = async () => { if (batch.length) { await ctx.invoke('importAppend', [token, batch]); batch = []; bytes = 0; } };
            for (const item of picked) {
              if (disposed) return;
              if (item.file.size > 4 * 1048576 && typeof item.file.slice === 'function') {
                await flush();
                for (let offset = 0; offset < item.file.size; offset += 2 * 1048576) {
                  const data = await item.file.slice(offset, offset + 2 * 1048576).arrayBuffer();
                  if (disposed) return;
                  await ctx.invoke('importAppendChunk', [token, {path:item.path,offset,total:item.file.size,b64:toBase64(data)}]);
                }
              } else {
                const data = await item.file.arrayBuffer();
                if (disposed) return;
                const b64 = toBase64(data); batch.push({path:item.path,b64}); bytes += b64.length;
                if (bytes >= 4 * 1048576) await flush();
              }
            }
            await flush();
            if (!disposed) view.result(await ctx.invoke('importFinish', [token, true]));
          } catch (error) { if (!disposed) view.note(t('导入失败', 'Import failed'), text(error), true); if (token) cancelOwnedImport(token); }
          finally { if (disposed && token) cancelOwnedImport(token); setBusy(false); }
        }

        async function importPaths(paths) {
          if (state.busy || disposed || !paths.length) return;
          clearSource();
          setBusy(true, t('读取…', 'Reading…'), undefined, 'import');
          importView.loading(t('识别模型…', 'Recognizing model…'));
          try { const result = await ctx.invoke('importPaths', [paths]); if (!disposed) importView.result(result); }
          catch (e) { if (!disposed) importView.note(t('导入失败', 'Import failed'), text(e), true); }
          finally { setBusy(false); }
        }

        function textPaths(value) {
          const paths = [];
          for (let path of String(value || '').split(/\r?\n/)) {
            path = path.trim().replace(/^["']|["']$/g, '');
            if (/^file:/i.test(path)) {
              try {
                const url = new URL(path);
                if (url.hostname && url.hostname !== 'localhost') continue;
                path = decodeURIComponent(url.pathname);
                if (/^\/[a-z]:\//i.test(path)) path = path.slice(1);
              } catch { continue; }
            }
            if (!/[\x00-\x1f]/.test(path) && (/^[a-z]:[\\/]/i.test(path) || path.startsWith('/'))) paths.push(path);
          }
          return [...new Set(paths)].slice(0, 16);
        }

        async function importFiles(files) {
          if (state.busy || disposed || !files.length) return;
          const local = files.map(f => f.path || f.file.path).filter(p => /^[a-z]:[\\/]/i.test(p || '') || p?.startsWith('/'));
          if (local.length === files.length) return importPaths(local);
          if (files.length === 1 && /\.zip$/i.test(files[0].path)) return stageZip(files[0].file);
          if (files.length === 1 && /\.json$/i.test(files[0].path)) {
            importView.note(t('缺少同目录资源', 'Sibling files required'), t('请选择入口文件的完整路径，或拖入整个模型文件夹', 'Choose the entry file by its local path, or drop the whole model folder'), true); return;
          }
          return stageFolder(files, importView);
        }

        async function buildSources() {
          if (state.busy || !staged || !ensureNotice()) return;
          if (staged.models?.length && !coreReady()) { ui.toast(t('先获取 Live2D 核心组件', 'Fetch the Live2D core first'), 'bad'); return; }
          const pending = [
            ...(staged.models ?? []).map(item => ({ ...item, method: 'importBuild' })),
            ...(staged.packs ?? []).map(item => ({ ...item, method: 'importKeep' })),
          ];
          const token = staged.token;
          setBusy(true, t('打包…', 'Packing…'), undefined, 'build');
          let failed = 0;
          for (const item of pending) {
            if (disposed) break;
            const key = item.method + ':' + item.dir;
            if (completed.has(key)) continue;
            try {
              const result = await ctx.invoke(item.method, [token, item.dir, false]);
              completed.add(key);
              for (const line of result.log ?? []) log.append(line, 'dim');
              if (result.adaptation) showAdaptation(result.adaptation);
              if (result.warn) log.append('! ' + result.warn, 'warn');
            } catch (e) {
              failed++; log.append(`! ${item.title || item.id || item.dir} · ${text(e)}`, 'bad');
            }
          }
          try { await refresh(); }
          catch (e) { log.append('! ' + text(e), 'warn'); }
          finally { setBusy(false); }
          if (disposed) { ctx.invoke('importCancel', []).catch(() => {}); return; }
          sourceHint.textContent = failed
            ? t(`${failed} 项失败；再次点击只重试未完成项，详情见日志`, `${failed} failed; click again to retry unfinished items; see the log`)
            : t('已加入下方卡片，可编辑或安装', 'Added below; edit or install');
          dropZone.classList.toggle('bad', failed > 0);
          ui.toast(failed ? t('部分打包失败', 'Some items failed') : t('打包完成', 'Packing complete'), failed ? 'bad' : 'ok');
        }

        function accessibleModal(node, title) {
          node.setAttribute('role', 'dialog');
          node.setAttribute('aria-modal', 'true');
          node.setAttribute('aria-label', title);
          node.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !state.busy) { e.preventDefault(); closeEdit(); }
            if (e.key === 'Tab') {
              const items = [...node.querySelectorAll('button, input, textarea, select')].filter((n) => !n.disabled && !n.hidden);
              if (!items.length) return;
              const next = e.shiftKey ? items.at(-1) : items[0];
              if (doc.activeElement === (e.shiftKey ? items[0] : items.at(-1))) { e.preventDefault(); next.focus(); }
            }
          });
        }

        // ---------------- 绑定 ----------------
        // Browser inputs are owned by the Coo window and open its native system dialogs.
        chooseFolder.addEventListener('click', () => { if (!state.busy) folderInput.click(); });
        chooseZip.addEventListener('click', () => { if (!state.busy) zipInput.click(); });
        folderInput.addEventListener('change', async () => {
          if (disposed || state.busy) return;
          const files = [...(folderInput.files ?? [])].map(file => ({ path: file.webkitRelativePath || file.name, file }));
          if (!files.length) return;
          try { await stageFolder(files, importView); }
          catch (e) { importView.note(t('导入失败', 'Import failed'), text(e), true); }
          finally { folderInput.value = ''; }
        });
        zipInput.addEventListener('change', async () => {
          if (disposed || state.busy) return;
          try { await importFiles([...(zipInput.files ?? [])].map(file => ({ path: file.name, file }))); }
          catch (e) { importView.note(t('导入失败', 'Import failed'), text(e), true); }
          finally { zipInput.value = ''; }
        });
        pack.addEventListener('click', buildSources);
        dropZone.addEventListener('click', () => dropZone.focus({ preventScroll: true }));
        dropZone.addEventListener('paste', async (event) => {
          event.preventDefault();
          if (state.busy) return;
          const data = event.clipboardData;
          const clipboardFiles = [...(data?.files ?? [])];
          const clipboardText = data?.getData('text/plain') || data?.getData('text/uri-list');
          try {
            let paths = textPaths(clipboardText);
            if (!paths.length) {
              setBusy(true, t('读取剪贴板…', 'Reading clipboard…'), undefined, 'import');
              try { paths = (await ctx.invoke('clipboard', [])).paths ?? []; }
              catch (e) { if (!clipboardFiles.length) throw e; }
              finally { setBusy(false); }
            }
            if (disposed) return;
            if (paths.length) return await importPaths(paths);
            const files = clipboardFiles.map(file => ({ path: file.name, file }));
            if (files.length) return await importFiles(files);
            importView.note(t('未读到模型', 'No model found'), t('请复制文件、文件夹，或其完整路径后粘贴', 'Copy files, a folder, or their full local path, then paste'), false);
          } catch (e) { importView.note(t('粘贴失败', 'Paste failed'), text(e), true); }
        });
        dropZone.addEventListener('dragover', event => { event.preventDefault(); if (!state.busy) dropZone.classList.add('over'); });
        dropZone.addEventListener('dragleave', event => { if (!dropZone.contains(event.relatedTarget)) dropZone.classList.remove('over'); });
        dropZone.addEventListener('drop', async event => {
          event.preventDefault(); dropZone.classList.remove('over');
          if (state.busy || disposed) return;
          const data = event.dataTransfer;
          if (!data) return;
          // Capture all handles synchronously; the drag data store closes after this event.
          const paths = textPaths(data.getData('text/plain') || data.getData('text/uri-list'));
          const entries = [...(data.items ?? [])].filter(item => item.kind === 'file').map(item => item.webkitGetAsEntry?.()).filter(Boolean);
          const plain = [...(data.files ?? [])].map(file => ({path:file.name,file}));
          if (paths.length) return importPaths(paths);
          setBusy(true, t('读取拖入内容…', 'Reading dropped files…'), undefined, 'import');
          try {
            const files = [];
            for (const entry of entries) {
              if (disposed) return;
              if (entry.isDirectory) files.push(...await droppedFiles(entry, entry.name, 3));
              else files.push({path:entry.name,file:await new Promise((ok,bad)=>entry.file(ok,bad))});
            }
            setBusy(false);
            if (!disposed) {
              const captured = files.length ? files : plain;
              if (!captured.length) throw new Error(t('未读到文件，请拖入模型文件夹或 ZIP', 'No files found; drop a model folder or ZIP'));
              await importFiles(captured);
            }
          } catch (error) { if (!disposed) importView.note(t('导入失败', 'Import failed'), text(error), true); }
          finally { setBusy(false); }
        });
        clearAll.addEventListener('click', async () => {
          if (state.busy) return;
          const ok = await ui.confirm({
            title: t('清空旧打包？', 'Clear old packs?'),
            body: t('保留最新一份，其余打包目录直接删除。已安装的形象不受影响。', 'Keeps the newest pack; installed figures stay.'),
            danger: true,
          });
          if (!ok) return;
          setBusy(true, t('清理…', 'Clearing…'));
          try {
            const r = await ctx.invoke('clearAll', []);
            state.builds = r.builds ?? [];
            paint();
            log.append(t('清空旧打包 · 删除 ', 'Cleared ') + r.removed + t(' 份', ' packs'), 'dim');
            ui.toast(t('已清空', 'Cleared'), 'ok');
          } catch (e) {
            ui.toast(text(e), 'bad');
          } finally { setBusy(false); }
        });

        function stopResume() {
          if (resumeHandle?.dispose) resumeHandle.dispose();
          else if (resumeHandle) win.clearInterval(resumeHandle);
          resumeHandle = null;
        }
        async function pollResume() {
          if (disposed || !resuming || resumePolling) return;
          resumePolling = true;
          try {
            const remote = await ctx.invoke('state', []);
            if (disposed || remote.busy) return;
            resuming = false; stopResume(); setBusy(false);
            await refresh();
            const completed = resumePhase && remote.steps?.[resumePhase];
            if (completed?.phase === 'error') say(completed.hint, true);
          } catch (error) { if (!disposed) say(t('等待后台任务结果…', 'Waiting for the background task…')); }
          finally { resumePolling = false; }
        }

        // Host calls the returned disposer when switching panels.
        setBusy(true, t('读取…', 'Loading…'));
        Promise.all([loadCore(), ctx.invoke('state', [])]).then(async ([, initial]) => {
          if (disposed) return;
          notice = initial.notice;
          version = initial.version;

          noticeDetails.open = !notice?.acknowledged;
          paintNotice();
          for (const line of initial.log ?? []) log.append(line, 'dim');
          await refresh();
          if (initial.busy) {
            resuming = true;
            resumePhase = Object.keys(initial.steps ?? {}).find(key => initial.steps[key].phase === 'loading');
            setBusy(true, t('后台任务处理中…', 'Background task running…'), undefined, 'build');
            resumeHandle = ctx.interval ? ctx.interval(pollResume, 800) : win.setInterval(pollResume, 800);
          }
        }).catch((e) => { if (!disposed) say(text(e), true); }).finally(() => { if (!resuming) setBusy(false); paintNotice(); });
        return { dispose() {
          if (disposed) return;
          disposed = true;
          clearInterval(ticker);
          stopResume();
          modal?.remove();
          cancelOwnedImport();
          ctx.root.removeAttribute('aria-busy');
        } };
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
