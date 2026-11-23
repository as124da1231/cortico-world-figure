/**
 * Coo 魔术人偶工坊 面板（浏览器端，手写 ESM，不打 bundle）。
 *
 * 导入区：[拖入 / 点击后粘贴] [选择文件夹 / ZIP] [一键打包]
 * 卡片：[安装][编辑][删除]；编辑弹层直接改 figure.json / profile.js，不重新打包。
 * 原始模型打包、现成形象包入库，均保留卡片上的安装操作。
 */
const NOTICE_TEXT = {
  zh: 'Live2D 运行组件从官方来源获取并保存在本机。生成的 Live2D 形象包包含 Cubism Core、Framework 和着色器，仅供本机使用。请保留模型、贴图和第三方组件各自的许可。',
  en: 'Live2D runtime components are obtained from official sources and stored locally. Generated Live2D figure packs include Cubism Core, Framework and shaders for local use only. Keep the licenses for models, textures and third-party components.',
};
function paintVersionBadge(button, version, acknowledged, t) {
  button.textContent = version ? `v${version}` : '…';
  const needsAcknowledgement = acknowledged === false;
  button.classList.toggle('unack', needsAcknowledgement);
  button.classList.toggle('ack', acknowledged === true);
  button.title = needsAcknowledgement ? t('请阅读并确认须知', 'Read and acknowledge the notice') : t('查看须知', 'Read notice');
  const status = needsAcknowledgement ? t('未确认须知', 'Notice not acknowledged')
    : acknowledged === true ? t('已确认', 'Acknowledged') : t('查看须知', 'Read notice');
  button.setAttribute('aria-label', `${button.textContent} · ${status}`);
}

function figureControlButton(ctx, label, opts = {}) {
  if (ctx.ui?.button) return ctx.ui.button(label, opts);
  const button = ctx.root.ownerDocument.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.className = ['btn', opts.size === 'sm' ? 'sm' : '', opts.variant || ''].filter(Boolean).join(' ');
  return button;
}

function holdFigurePanelPaint(node) {
  // Cortico can mount the panel before its stylesheet has finished loading.
  node.style.setProperty('display', 'var(--l2d-panel-display, none)');
}

function watchFigurePanelStyles(ctx, node, t) {
  let status;
  const timer = ctx.timeout?.(() => {
    if (!node.isConnected || ctx.signal?.aborted || node.ownerDocument.defaultView.getComputedStyle(node).display !== 'none') return;
    status = node.ownerDocument.createElement('p');
    status.className = 'l2d-panel-style-failure';
    status.setAttribute('role', 'status');
    status.textContent = t('界面样式暂未加载。若持续出现，请重新打开 Coo。', 'Panel styles are taking longer to load. If this persists, reopen Coo.');
    node.after(status);
  }, 6000);
  return () => { timer?.dispose(); status?.remove(); };
}

function readStudioTheme(root) {
  const style = root.ownerDocument.defaultView.getComputedStyle(root);
  const keys = ['paper', 'paper-2', 'sheet', 'sheet-2', 'ink', 'ink-soft', 'ink-dim',
    'line', 'line-2', 'accent', 'on-accent', 'ok', 'warn', 'danger'];
  const colors = {};
  for (const key of keys) {
    const color = style.getPropertyValue('--' + key).trim();
    if (/^#[0-9a-f]{6}$/i.test(color)) colors[key] = color;
  }
  return {mode: style.colorScheme, colors};
}

function createVersionButton(doc, t) {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'l2d-version-corner';
  button.setAttribute('aria-haspopup', 'dialog');
  paintVersionBadge(button, FIGURE_UI_VERSION, undefined, t);
  return button;
}

function mountPanelVersion(ctx) {
  const { root } = ctx;
  const doc = root.ownerDocument;
  const t = (zh, en) => String(ctx.language || 'zh').toLowerCase().startsWith('zh') ? zh : en;
  const header = doc.createElement('header');
  header.className = 'l2d-panel-version';
  holdFigurePanelPaint(header);
  const button = createVersionButton(doc, t);
  header.append(button);
  root.append(header);
  const stopWatchingStyles = watchFigurePanelStyles(ctx, header, t);
  let core, dialog, paintRuntime, coreFailed = false, disposed = false;
  void ctx.invoke('core', []).then(status => {
    if (disposed || ctx.signal?.aborted) return;
    core = status;
    paintVersionBadge(button, FIGURE_UI_VERSION, core?.notice?.acknowledged, t);
    paintRuntime?.();
  }, () => {
    if (disposed || ctx.signal?.aborted) return;
    coreFailed = true;
    paintRuntime?.();
  });
  button.addEventListener('click', () => {
    if (disposed || dialog) return;
    const body = doc.createElement('div');
    body.className = 'l2d-dialog-body';
    const summary = doc.createElement('p');
    summary.textContent = t(NOTICE_TEXT.zh, NOTICE_TEXT.en);
    body.append(summary);
    const card = doc.createElement('div');
    card.className = 'l2d-license l2d-license-core';
    const status = doc.createElement('div');
    status.className = 'l2d-license-core-status';
    const title = doc.createElement('strong');
    title.className = 'l2d-license-title';
    title.textContent = 'Live2D';
    status.append(title);
    const runtime = doc.createElement('span');
    runtime.setAttribute('role', 'status');
    status.append(runtime);
    const actions = doc.createElement('div');
    actions.className = 'l2d-dialog-actions';
    const confirmLink = doc.createElement('a');
    confirmLink.className = 'l2d-btn sm';
    confirmLink.href = '#/provider/world%3Afigure/workbench';
    confirmLink.textContent = t('前往工作台确认须知', 'Acknowledge in Workbench');
    actions.append(confirmLink);
    paintRuntime = () => {
      actions.hidden = core?.notice?.acknowledged !== false;
      card.classList.toggle('ok', core?.ok === true);
      runtime.textContent = core?.ok ? runtimeReadyText(core, t)
        : coreFailed ? t('暂时无法读取运行组件状态', 'Could not read runtime status')
        : core ? t('运行组件未就绪', 'Runtime not ready')
        : t('正在读取运行组件状态…', 'Reading runtime status…');
    };
    paintRuntime();
    const links = doc.createElement('span');
    links.className = 'l2d-license-docs';
    for (const [label, href] of [
      [t('Core 许可', 'Core license'), 'https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html'],
      [t('SDK 许可', 'SDK license'), 'https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html'],
      [t('打开官网', 'Download page'), core?.home || 'https://www.live2d.com/en/sdk/download/web/'],
    ]) {
      const link = doc.createElement('a');
      link.className = 'l2d-link';
      link.textContent = label;
      link.href = href;
      link.target = '_blank';
      link.rel = 'noreferrer';
      links.append(link);
    }
    card.append(status, links);
    body.append(card, actions);
    dialog = openFigureDialog(root, t('须知', 'Notice'), body, {
      closeLabel: t('关闭', 'Close'), variant: 'l2d-notice-popup',
      onClose() { dialog = null; paintRuntime = undefined; },
    });
  });
  return {dispose() {
    disposed = true;
    stopWatchingStyles();
    dialog?.dispose();
    header.remove();
  }};
}

function runtimeReadyText(core, t) {
  const kb = Math.round((core.bytes || 0) / 1024);
  return t(`运行组件已就绪 · ${core.version || ''} · ${kb} KB · 已校验`,
    `Runtime ready · ${core.version || ''} · ${kb} KB · verified`);
}

function withFigureHeader(panel) {
  return {
    async mount(ctx) {
      const version = mountPanelVersion(ctx);
      try {
        const mounted = await panel.mount(ctx);
        if (ctx.signal?.aborted) {
          mounted?.dispose();
          version.dispose();
          return;
        }
        return {dispose() {
          mounted?.dispose();
          version.dispose();
        }};
      } catch (error) {
        version.dispose();
        throw error;
      }
    },
  };
}

// Primary configuration and the quick popup share saving and dependency handling.
function settingsForm(ctx, cfg, { autosave = false, onNotice, onSaved, isDisposed = () => ctx.signal?.aborted } = {}) {
  const doc = ctx.root.ownerDocument;
  const zh = String(ctx.language || 'zh').toLowerCase().startsWith('zh');
  const t = (a, b) => zh ? a : b;
  const el = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const body = el('form', 'l2d-settings l2d-dialog-body');
  cfg={...cfg,assistAuto:cfg.assistAuto !== false,adaptationMode:cfg.adaptationMode || (cfg.assistMotions ? 'ai' : 'none')};
  const dirty = {};
  let changeVersion = 0;
  function changeSetting(key, value) {
    dirty[key] = value;
    changeVersion++;
  }
  const performanceKey = 'worlds.figure.performanceMode';
  let savedMode = cfg.performanceMode || 'vocab';
  let toolSyncPending = false;
  const controls = [];
  const fields = new Map();
  const section = title => {
    const group = el('section', 'l2d-settings-section');
    group.append(el('h3', null, title));
    body.append(group);
    return group;
  };
  let group = section(t('画质与预览', 'Quality and preview'));
  function field(key, title, hint, type, choices) {
    const row = el('label', 'l2d-setting-row');
    const label = el('span', 'l2d-setting-label');
    label.append(el('span', null, title));
    if (hint) label.append(el('small', null, hint));
    let input, control, readValue, paint = () => {};
    if (type === 'gear') {
      row.classList.add('l2d-gear-row');
      control = el('span', 'l2d-gear');
      const value = el('output', 'l2d-gear-value'); value.setAttribute('aria-hidden', 'true');
      const track = el('span', 'l2d-gear-track');
      const fill = el('span', 'l2d-gear-fill');
      const stops = el('span', 'l2d-gear-stops'); stops.setAttribute('aria-hidden', 'true');
      choices.forEach(() => stops.append(el('i')));
      input = el('input', 'l2d-gear-input');
      input.type = 'range'; input.min = '0'; input.max = String(choices.length - 1); input.step = '1';
      const initial = choices.findIndex(([v]) => v === cfg[key]);
      input.value = String(initial < 0 ? choices.findIndex(([v]) => v === (key === 'texture' ? 'original' : key === 'previewSize' ? '1024' : key === 'assistDepth' ? 'standard' : key === 'quality' ? 'balanced' : key === 'adaptationMode' ? 'none' : 'auto')) : initial);
      readValue = () => choices[Number(input.value)][0];
      paint = () => {
        const index = Number(input.value), title = choices[index][1];
        value.value = title; input.setAttribute('aria-valuetext', title);
        control.style.setProperty('--gear-ratio', String(index / (choices.length - 1)));
        control.classList.toggle('is-max', index === choices.length - 1);
      };
      input.addEventListener('input', paint); paint();
      track.append(fill, stops, input); control.append(value, track);
    } else {
      input = el(type === 'textarea' ? 'textarea' : 'input', type === 'checkbox' ? 'l2d-switch' : 'l2d-input');
      if (type !== 'textarea') input.type = type;
      else input.rows = 2;
      if (type === 'checkbox') { input.checked = cfg[key] === true; input.setAttribute('role', 'switch'); }
      else { input.value = cfg[key] || ''; input.placeholder = t('留空使用 Coo 默认目录', 'Leave empty for the Coo default'); }
    }
    input.setAttribute('aria-label', title);
    if (hint) {
      const description = label.querySelector('small');
      description.id = `figure-setting-${key}`;
      input.setAttribute('aria-describedby', description.id);
    }
    input.addEventListener('change', () => {
      if (input.disabled) return;
      paint();
      changeSetting('worlds.figure.' + key, type === 'checkbox' ? input.checked : readValue ? readValue() : input.value.trim());
    });
    fields.set(key,{input,paint,readValue,choices});
    controls.push(input); row.append(label, control || input); group.append(row); return input;
  }
  let depend=()=>{};
  let performanceSettings;
  field('cover', t('生成封面', 'Generate cover'), t('同时自动调整模型取景', 'Also fits the model framing'), 'checkbox');
  const quality = field('quality',t('画质','Quality'),t('画布随显示大小调整；原图不设软件精度上限。已有形象需重新打包安装。','Canvas follows display size; Original has no software cap. Repack existing figures to apply.'),'gear',[['economy',t('流畅','Smooth')],['balanced',t('标准','Standard')],['high',t('高清','HD')],['original',t('原图','Original')]]);
  const texture = field('texture', t('贴图精度', 'Texture resolution'), t('原图档可调整；较小的贴图占用更少显存', 'Adjustable in Original mode; smaller textures use less VRAM'), 'gear', ['512','1024','2048','4096','original'].map(value=>[value,value==='original'?t('原精度','Original'):value+' px']));
  let customTexture = cfg.texture || 'original';
  const syncQuality = () => {
    const editable = quality.value === '3';
    const selected = editable ? customTexture : ['1024','2048','4096'][Number(quality.value)];
    texture.value = String(fields.get('texture').choices.findIndex(([value])=>value===selected));
    fields.get('texture').paint(); fields.get('quality').paint();
    texture.disabled = !editable; texture.closest('.l2d-setting-row').classList.toggle('inactive',!editable);
    if (editable && customTexture !== 'original') {
      quality.setAttribute('aria-valuetext',t('自定义','Custom'));
      quality.closest('.l2d-gear').querySelector('output').value=t('自定义','Custom');
      quality.closest('.l2d-gear').classList.remove('is-max');
    }
  };
  for (const event of ['input','change']) {
    quality.addEventListener(event,syncQuality);
    texture.addEventListener(event,()=>{if(quality.value==='3'){customTexture=fields.get('texture').readValue();syncQuality();}});
  }
  syncQuality();
  field('previewSize',t('预览精度','Preview resolution'),t('动作与装扮预览默认 1024；无上限时按设备能力渲染','Action and wardrobe previews default to 1024. Unlimited uses device limits.'),'gear',figurePreviewChoices(t));
  group = section(t('打包与安装', 'Packing and installation'));
  field('clean', t('清理', 'Clean'), '', 'checkbox');
  field('autoDelete', t('安装后删除打包产物', 'Delete pack after installation'), t('仅在安装成功后执行，保留原始素材', 'Only after a successful install; source files are kept'), 'checkbox');
  const folder = field('figuresDir', t('安装目录', 'Install folder'), t('通常无需修改', 'Usually no change needed'), 'text');
  if (ctx.pickPath) {
    const picker = el('span', 'l2d-folder-control');
    const browse = figureControlButton(ctx, t('选择', 'Browse'), {size:'sm'});
    folder.replaceWith(picker); picker.append(folder, browse);
    browse.addEventListener('click', async () => {
      try {
        const path = await ctx.pickPath({kind:'directory'});
        if (path !== null && !isDisposed()) {
          folder.value = path;
          folder.dispatchEvent(new doc.defaultView.Event('change', {bubbles:true}));
        }
      } catch (error) { if (!isDisposed()) ctx.ui.toast(String(error?.message || error), 'bad'); }
    });
    controls.push(browse);
  }
  group = section(t('动作适配', 'Action mapping'));
  const mode = field('adaptationMode',t('适配方式','Adaptation mode'),t('无：仅通用配方；人工：预览并绑定；AI：交给 Coo 分析','None: generic recipes; Manual: preview and bind; AI: let Coo analyze'),'gear',[['none',t('无','None')],['manual',t('人工','Manual')],['ai','AI']]);
  const gear = field('assistGear',t('分析方式','Analysis mode'),t('图片不受支持时自动使用文本','Falls back to text when the current model cannot use images'),'gear', [['text',t('文本','Text')],['auto',t('自动','Auto')],['image',t('文本＋图片','Text + images')]]);
  const depth = field('assistDepth',t('适配深度','Adaptation depth'),t('仅文本＋图片时启用：基础取样、针对性补查、映射对照复核','Available with text + images: basic sampling, targeted inspection, mapping comparison'),'gear', [['quick',t('快速','Quick')],['standard',t('标准','Standard')],['deep',t('深入','Deep')]]);
  const automatic = field('assistAuto',t('自动安装','Automatic installation'),t('满足安装条件后自动执行；需要确认时暂停','Install when requirements are met; pause for confirmation when needed'),'checkbox');
  const confirmFallback = field('assistConfirmFallback',t('降级前确认','Confirm fallback'),t('需要沿用通用表现时先确认，默认直接继续','Ask before keeping generic behavior. Off by default.'),'checkbox');
  const roots = field('modelRoots',t('模型搜索目录','Model search folders'),t('每行一个目录；用于按名字找模型','One folder per line, used when finding models by name'),'textarea');
  roots.placeholder = t('留空时只搜索最近使用的模型目录','Leave empty to search recently used model folders');
  group = section(t('运行时表演', 'Runtime performance'));
  performanceSettings = mountPerformanceSettings(ctx, group, cfg, value => changeSetting(performanceKey, value));
  controls.push(...performanceSettings.controls);
  body.disposePlanner = performanceSettings.dispose;
  depend = () => {
    syncQuality();
    for (const input of [gear,automatic,roots,depth]) {
      input.disabled = mode.value !== '2' || input === depth && gear.value !== '2';
      input.closest('.l2d-setting-row').classList.toggle('inactive', input.disabled);
    }
    confirmFallback.disabled = automatic.disabled || !automatic.checked;
    confirmFallback.closest('.l2d-setting-row').classList.toggle('inactive', confirmFallback.disabled);
  };
  mode.addEventListener('change',depend); mode.addEventListener('input',depend); gear.addEventListener('change',depend); gear.addEventListener('input',depend); automatic.addEventListener('change',depend); depend();
  const actions = el('div', 'l2d-dialog-actions');
  if (onNotice) {
    const note = el('button', 'l2d-notice-entry', t('须知', 'Notice')); note.type = 'button';
    note.addEventListener('click', () => { if (!isDisposed()) onNotice(); });
    actions.append(note);
  }
  const status = el('span', 'l2d-settings-status', autosave ? t('修改后自动保存。', 'Changes save automatically.') : '');
  status.setAttribute('role', 'status');
  const save = figureControlButton(ctx, t('保存设置', 'Save settings'), {variant:'primary'}); save.type = 'submit'; save.hidden = autosave;
  actions.append(status, save); body.append(actions);
  let saving = false;
  const leave = ctx.guardLeave?.(() => body.isConnected && (saving || Object.keys(dirty).length) ? t('设置尚未保存，确定离开？', 'Settings are not saved. Leave anyway?') : null);
  async function syncPerformanceTools() {
    if (!toolSyncPending) return true;
    status.textContent = t('正在同步会话工具…', 'Updating conversation tools…');
    performanceSettings?.showSync(status.textContent);
    try {
      await ctx.invoke('performanceSync', []);
      await reloadFigurePrefix(ctx);
      toolSyncPending = false;
      performanceSettings?.showSync();
      return true;
    } catch {
      if (!isDisposed()) {
        status.textContent = t('档位已保存，会话工具待同步。', 'Mode saved. Conversation tools are pending.');
        performanceSettings?.showSync(t('档位已保存，点下方「重试同步」后再开始对话。', 'Mode saved. Retry tool sync below before chatting.'));
        save.textContent = t('重试同步', 'Retry sync');
        save.hidden = false;
      }
      return false;
    }
  }
  async function persist() {
    if (saving || isDisposed()) return;
    const patch = {...dirty};
    const keys = Object.keys(patch);
    const version = changeVersion;
    if (!keys.length && !toolSyncPending) { if (!autosave) await onSaved?.(); return; }
    saving = true; body.setAttribute('aria-busy','true'); save.disabled = true;
    if (!autosave) controls.forEach(input => { input.disabled = true; });
    let succeeded = false;
    try {
      if (keys.length) {
        status.textContent = t('保存中…', 'Saving…');
        if (patch[performanceKey] === 'direct') performanceSettings?.showSync(status.textContent);
        await ctx.setConfig('figure', patch);
        for (const key of keys) if (dirty[key] === patch[key]) delete dirty[key];
        const mode = patch[performanceKey];
        if (mode !== undefined) {
          toolSyncPending ||= (savedMode === 'direct') !== (mode === 'direct');
          savedMode = mode;
        }
      }
      succeeded = true;
      if (isDisposed()) return;
      const synced = await syncPerformanceTools();
      if (!isDisposed() && synced) {
        status.textContent = t('已保存', 'Saved');
        save.textContent = t('保存设置', 'Save settings');
        save.hidden = autosave;
        await onSaved?.();
      }
    } catch (error) {
      if (!isDisposed() && (!autosave || changeVersion === version)) {
        if (patch[performanceKey] === 'direct') performanceSettings?.showSync(t('档位保存失败，点下方重试。', 'Mode could not be saved. Retry below.'));
        status.textContent = t('保存失败，请重试。', 'Save failed. Please retry.');
        save.hidden = false; if (autosave) save.textContent = t('重试保存', 'Retry save');
        ctx.ui.toast(String(error?.message || error), 'bad');
      }
    } finally {
      saving = false; body.removeAttribute('aria-busy'); save.disabled = false;
      if (!autosave) { controls.forEach(input => { input.disabled = false; }); depend(); }
    }
    if (autosave && (succeeded || changeVersion !== version) && Object.keys(dirty).length && !isDisposed()) await persist();
  }
  body.addEventListener('submit', event => { event.preventDefault(); void persist(); });
  if (autosave) body.addEventListener('change', () => { void persist(); });
  body.dispose = () => { leave?.dispose(); body.disposePlanner?.(); };
  return body;
}

const configuration = {
  async mount(ctx) {
    const cfg = await ctx.invoke('settings', []);
    if (ctx.signal?.aborted) return;
    const doc = ctx.root.ownerDocument;
    const zh = String(ctx.language || 'zh').toLowerCase().startsWith('zh');
    const shell = doc.createElement('section'); shell.className = 'l2d-config-page';
    holdFigurePanelPaint(shell);
    shell.setAttribute('aria-label', zh ? '模型设置' : 'Model settings');
    let disposed = false;
    const form = settingsForm(ctx, cfg, {autosave:true, isDisposed:() => disposed || ctx.signal?.aborted});
    shell.append(form); ctx.root.append(shell);
    return {dispose() { disposed = true; form.dispose(); shell.remove(); }};
  },
};

const workshop = {
  mount(ctx) {
    const doc = ctx.root.ownerDocument;
    const zh = String(ctx.language || 'zh').toLowerCase().startsWith('zh');
    const t = (a, b) => zh ? a : b;
    const page = doc.createElement('section');
    page.className = 'l2d-config-page l2d-workshop-page';
    page.setAttribute('aria-label', t('素材工坊', 'Workshop'));
    holdFigurePanelPaint(page);

    const card = ctx.ui.sheet({
      title: t('FFA Hub 素材工坊', 'FFA Hub Workshop'),
      desc: t('浏览、下载或投稿 Live2D 和 BongoCat 原始模型素材。', 'Browse, download or submit source models for Live2D and BongoCat.'),
    });
    const actions = doc.createElement('div');
    actions.className = 'l2d-workshop-actions';
    const launch = doc.createElement('a');
    launch.className = 'btn primary l2d-workshop-link';
    launch.textContent = t('在浏览器打开工坊', 'Open workshop in browser');
    launch.href = 'https://8.148.13.225:8443/?page=figure';
    launch.target = '_blank';
    launch.rel = 'noopener noreferrer';
    const note = doc.createElement('p');
    note.className = 'sh-desc';
    note.textContent = t('使用 FFA Hub 账号登录。下载后可回到工作台导入。', 'Sign in with FFA Hub. Import downloaded models from the Workbench.');
    actions.append(launch, note);
    const submissionRule = doc.createElement('p');
    submissionRule.className = 'sh-desc';
    submissionRule.textContent = t('投稿包不得包含 Cubism Core、Cubism Framework、着色器及其打包副本。', 'Submissions must exclude Cubism Core, Cubism Framework, shaders, and bundled copies of these components.');
    card.body.append(actions, submissionRule);
    page.append(card.el);
    ctx.root.append(page);
    return {dispose() { page.remove(); }};
  },
};

export default {
  panels: {
    workshop: withFigureHeader(workshop),
    settings: withFigureHeader(configuration),
    effects: withFigureHeader(effectsGallery),
    voice: withFigureHeader(speechProviders),
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
        let startupTimer = null;
        let startupFailed = false;
        let notice = null;
        let version = '';
        let resumeHandle = null;
        let resuming = false;
        let resumePolling = false;
        let resumePhase;
        let editingId = null;
        let noticeDialog = null;
        let settingsLoading = false;
        let settingsDialog = null;
        let assistTimer = null;
        let assistPolling = false;
        let assistState = {enabled:false,plans:[]};
        const state = { dir: '', busy: false, builds: [], installed: null, figuresDir: '' };

        // ---- Live2D 运行组件：Core 和 Framework 共用已有许可流程 ----
        const coreCard = el('div', 'l2d-license l2d-license-core');
        const coreTitle = el('strong', 'l2d-license-title', 'Live2D');
        const coreText = el('span');
        const coreLicA = el('button', 'l2d-link', t('Core 许可', 'Core license'));
        const coreLicB = el('button', 'l2d-link', t('SDK 许可', 'SDK license'));
        const coreHome = el('button', 'l2d-link', t('打开官网', 'Download page'));
        const coreGet = el('button', 'l2d-btn sm primary', t('同意并获取', 'Agree & fetch'));
        const coreStatus = el('div', 'l2d-license-core-status');
        coreStatus.append(coreTitle, coreText);
        const coreLinks = el('span', 'l2d-license-docs');
        coreLinks.append(coreLicA, coreLicB, coreHome);
        coreCard.append(coreStatus, coreLinks, coreGet);


        let core = { ok: false };
        const coreReady = () => core.ok === true;

        const openLicense = async (which) => {
          const parent = noticeDialog?.handle.el;
          try {
            const r = await ctx.invoke('license', [which]);
            if (parent?.open) openFigureDialog(parent, r.file, el('pre', 'l2d-license-document', r.text || t('读不到许可文本', 'License text missing')), {closeLabel:t('关闭','Close')});
          } catch (e) {
            if (parent?.open && noticeDialog) noticeDialog.error.textContent = text(e);
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
          if (coreReady()) {
            coreText.textContent = runtimeReadyText(core, t);
            coreGet.hidden = true;
          } else {
            coreText.textContent = core.consentAt
              ? t('已同意许可。首次使用时会自动补齐运行组件，也可在这里重试。', 'License accepted. Missing runtime components are restored on use, or you can retry here.')
              : t('阅读 Core 和 SDK 许可后，点击「同意并获取」。扩展从 Live2D 官方来源获取组件并校验 SHA-256。', 'Read both licenses, then choose “Agree & fetch” to verify and prepare the runtime from official Live2D sources.');
            coreGet.textContent = core.consentAt ? t('获取运行组件', 'Get runtime') : t('同意并获取', 'Agree & fetch');
            coreGet.hidden = false;
          }
        }

        coreGet.addEventListener('click', async () => {
          const flow = noticeDialog;
          if (state.busy || !flow) return;
          flow.saving = true;
          flow.error.textContent = '';
          setBusy(true, t('准备 Live2D 运行组件…', 'Preparing Live2D runtime…'));
          try {
            core = await (core.consentAt ? ctx.invoke('coreRestore', []) : ctx.invoke('coreAccept', [true]));
            paintCore();
            log.append(t('Live2D 运行组件已校验', 'Live2D runtime verified'), 'dim');
          } catch (e) {
            const status = await ctx.invoke('core', []).catch(() => null);
            if (status) { core = status; paintCore(); }
            flow.error.textContent = t('获取失败，可以重试或打开官网。', 'Could not prepare the runtime. Retry or open the download page. ') + text(e);
            log.append('! ' + text(e), 'warn');
          } finally {
            setBusy(false);
            flow.saving = false;
          }
          if (coreReady()) finishNotice(flow);
        });

        const shell = el('section', 'l2d-sheet');
        holdFigurePanelPaint(shell);
        const header = el('header', 'l2d-header l2d-panel-version');
        header.setAttribute('aria-label',t('模型工坊操作','Figure workshop actions'));
        const settingsButton = figureControlButton(ctx, t('设置', 'Settings'), {size:'sm'});
        settingsButton.classList.add('l2d-settings-button');
        settingsButton.type = 'button';
        settingsButton.addEventListener('click', openSettings);
        const sheet = { el: shell, body: el('div', 'l2d-body') };
        shell.append(header, sheet.body);
        ctx.root.appendChild(shell);
        const stopWatchingStyles = watchFigurePanelStyles(ctx, shell, t);
        const operation = el('section','l2d-operation');
        operation.setAttribute('aria-label',t('导入与处理','Import and processing'));
        const operationBottom = el('div','l2d-operation-bottom');
        const versionCorner = createVersionButton(doc, t);
        versionCorner.disabled = true;
        versionCorner.addEventListener('click', () => openNotice());
        header.append(versionCorner);
        function paintNotice() {
          if (disposed) return;
          const ack = notice?.acknowledged;
          paintVersionBadge(versionCorner, version || FIGURE_UI_VERSION, ack, t);
          versionCorner.disabled = !notice || state.busy;
          noticeEntry.hidden = !ack;
          if (noticeDialog) {
            noticeDialog.accept.hidden = ack;
            noticeDialog.accept.disabled = state.busy;
          }
        }
        function ensureNotice(resume, needsCore = false) {
          if (notice?.acknowledged && (!needsCore || coreReady())) return true;
          if (notice?.acknowledged && needsCore && core.consentAt && !state.busy) {
            setBusy(true, t('准备 Live2D 运行组件…', 'Preparing Live2D runtime…'));
            void ctx.invoke('coreRestore', []).then(result => {
              if (disposed) return;
              if (result?.ok !== true) throw new Error(t('Live2D 运行组件未就绪', 'Live2D runtime is unavailable'));
              core = result;
              setBusy(false);
              paintCore();
              resume();
            }).catch(error => {
              if (disposed) return;
              setBusy(false);
              openNotice(resume, needsCore);
              if (noticeDialog) noticeDialog.error.textContent = text(error);
            });
            return false;
          }
          openNotice(resume, needsCore);
          return false;
        }


        // ---- 导入区与两个主操作 ----
        const dropZone = el('div', 'l2d-drop-zone');
        dropZone.tabIndex = 0;
        dropZone.setAttribute('role', 'region');
        dropZone.setAttribute('aria-label', t('模型导入区域，点击后可粘贴', 'Model import area; click to paste'));
        const sourceTitle = el('div', 'l2d-source-title');
        const sourceHint = el('div', 'l2d-source-hint');
        const source = el('div', 'l2d-source-copy');
        source.append(sourceTitle, sourceHint);
        const actions = el('div', 'l2d-import-controls');
        const chooseFolder = figureControlButton(ctx, t('导入文件夹', 'Import folder'), {size:'sm', variant:'primary'});
        const chooseZip = figureControlButton(ctx, t('导入 ZIP', 'Import ZIP'), {size:'sm'});
        const pack = figureControlButton(ctx, t('一键打包', 'Pack'), {size:'sm'});
        const installNow = figureControlButton(ctx, t('一键安装', 'Install'), {size:'sm', variant:'primary'});
        const skipCover = figureControlButton(ctx, t('跳过封面', 'Skip cover'), {size:'sm'});
        skipCover.type = 'button';
        skipCover.hidden = true;
        const folderInput = doc.createElement('input');
        folderInput.type = 'file';
        folderInput.webkitdirectory = true;
        folderInput.setAttribute('webkitdirectory', '');
        folderInput.hidden = true;
        const zipInput = doc.createElement('input');
        zipInput.type = 'file';
        zipInput.accept = '.zip,application/zip';
        zipInput.hidden = true;
        const pickers = el('div', 'l2d-source-pickers');
        pickers.append(chooseFolder, chooseZip);
        const installPane = el('section', 'l2d-install-pane');
        installPane.setAttribute('aria-labelledby', 'figure-install-title');
        const installCopy = el('div', 'l2d-source-copy');
        const installTitle = el('div', 'l2d-source-title', t('安装形象', 'Install figure'));
        installTitle.id = 'figure-install-title';
        const guidance = el('div', 'l2d-workflow-next l2d-source-hint');
        guidance.setAttribute('role', 'status');
        const guidanceText = el('span', 'l2d-workflow-next-copy');
        const dressLink = wardrobeLink(el, t('前往装扮穿戴', 'Wear in Dress up'), 'l2d-btn sm l2d-workflow-dress');
        dressLink.hidden = true;
        guidance.append(guidanceText);
        installCopy.append(installTitle, guidance);
        actions.append(pack, installNow, dressLink);
        installPane.append(installCopy, actions);
        dropZone.append(source, pickers);
        const lanes = el('div', 'l2d-import-lanes');
        lanes.append(dropZone, installPane);
        operation.append(lanes, folderInput, zipInput, operationBottom);
        let staged = null;
        let hasChosenImport = false;
        let sourceFeedback = '';
        let currentCover = null;
        const completed = new Map();
        const installedSources = new Set();
        function stagedWorkflow(source) {
          const models = source?.models ?? [];
          const packs = source?.packs ?? [];
          const onlyPacks = packs.length > 0 && models.length === 0;
          const mode = onlyPacks ? 'direct' : assistState.enabled ? 'ai' : assistState.adaptationMode === 'manual' ? 'manual' : 'direct';
          return {mode, models, packs};
        }
        function currentSubmission() {
          return (assistState.submissions || []).find(r => r.token === staged?.token) ?? staged?.submission;
        }
        function paintGuidance() {
          const {mode, models, packs} = stagedWorkflow(staged);
          const count = models.length + packs.length;
          const request = mode === 'ai' && currentSubmission();
          const isInstalled = count > 0 && installedSources.size === count;
          dressLink.hidden = !isInstalled;
          pack.hidden = !count || isInstalled;
          installNow.hidden = isInstalled || Boolean(count && mode !== 'direct');
          installTitle.textContent = isInstalled ? t('形象已安装', 'Figure installed') : t('安装形象', 'Install figure');
          installPane.classList.toggle('is-ready', Boolean(count && !isInstalled));
          chooseFolder.classList.toggle('primary', !count && !state.busy);
          const next = isInstalled ? t('在装扮页选中形象即可穿戴。', 'Select the figure in Dress up to wear it.')
            : !count ? t('导入后可打包或安装。', 'Import a model to pack or install it.')
            : request?.error || request?.canRetry ? t('分析尚未完成。查看进展，或重新提交。', 'Analysis did not finish. Check progress or retry.')
            : request ? t('在「进展与结果」查看分析；如果需要确认，也在那边处理。', 'Check Progress & results for analysis and any decisions.')
            : completed.size === count ? t('已加入模型包。可以从下方编辑，或直接安装。', 'Added to the library. Edit below or install directly.')
            : mode === 'manual' ? t('先预览动作和表情，确认绑定后保存模型包。', 'Preview motions and expressions, then save your bindings to a pack.')
            : mode === 'ai' ? t('提交给 Coo 分析动作和表情，再到「进展与结果」查看方案。', 'Ask Coo to map motions and expressions, then review its proposal in Progress & results.')
            : !models.length ? t('加入模型包只保存到工作台；一键安装会同时安装到 Coo。', 'Add to library saves the pack here. Install now also installs it in Coo.')
            : t('可直接安装，也可先打包编辑。', 'Install now, or pack it to edit later.');
          if (guidanceText.textContent !== next) {
            guidanceText.textContent = next;
            guidance.title = next;
          }
        }
        function paintImportButtons(count) {
          const {mode} = stagedWorkflow(staged);
          const direct = mode === 'direct';
          const request = mode === 'ai' && currentSubmission();
          pack.disabled = state.busy || !count || completed.size === count;
          pack.textContent = request?.canRetry ? t('重新提交分析','Retry analysis')
            : request ? (request.waiting?.length ? t('等待 Coo 分析','Awaiting Coo') : t('已生成方案','Proposal ready'))
              : mode === 'ai' ? t('提交 AI 适配','Submit to Coo')
                : mode === 'manual' ? t('预览并绑定','Preview & bind') : packsOnlyLabel(staged);
          installNow.disabled = state.busy || !count || installedSources.size === count;
          if (request && !request.error && !request.canRetry) pack.disabled = true;
          pack.classList.toggle('primary', !direct && !pack.disabled);
          installNow.classList.toggle('primary', direct && !installNow.disabled);
          paintGuidance();
        }
        function packsOnlyLabel(source) {
          return source?.packs?.length && !source?.models?.length ? t('加入模型包','Add to library') : t('一键打包','Pack models');
        }
        function paintSource() {
          const models = staged?.models ?? [];
          const packs = staged?.packs ?? [];
          const count = models.length + packs.length;
          const names = [...models.map(m => m.title), ...packs.map(p => (zh ? p.nameZh : p.nameEn) || p.id)];
          sourceTitle.textContent = count ? names.slice(0, 3).join('、') + (count > 3 ? t(` 等 ${count} 项`, ` and ${count - 3} more`) : '') : t('拖入模型文件夹或 ZIP', 'Drop a model folder or ZIP');
          sourceTitle.title = names.join('\n');
          const submission = currentSubmission();
          const aiHint = submission?.error ? t('提交失败 · 可重新提交分析', 'Submission failed · Retry analysis')
            : !submission ? t('准备好后提交 AI 适配', 'Submit for AI mapping when ready')
              : submission.waiting?.length ? t('已交给 Coo · 在「进展与结果」查看', 'Sent to Coo · See Progress & results')
                : t('方案已生成 · 在「进展与结果」查看', 'Proposal ready · See Progress & results');
          sourceHint.textContent = sourceFeedback || (!count
            ? t('支持 Live2D、BongoCat 和 Coo 形象包 · 可粘贴', 'Live2D, BongoCat and Coo figure packs. Paste is supported.')
            : stagedWorkflow(staged).mode === 'ai' ? aiHint
                : installedSources.size === count ? t('已安装 · 在「进展与结果」继续', 'Installed · Continue in Progress & results')
                : completed.size === count ? t('已加入模型包列表，可编辑或安装', 'Added to packs; edit or install')
                  : t(`已识别 ${count} 项`, `${count} recognized`));
          sourceHint.title = sourceHint.textContent;
          dropZone.classList.toggle('ready', count > 0);
          dropZone.setAttribute('aria-disabled', String(state.busy));
          paintImportButtons(count);
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
        const resultButton = figureControlButton(ctx, t('进展与结果', 'Progress & results'), {size:'sm'});
        resultButton.classList.add('l2d-result-entry');
        resultButton.setAttribute('aria-haspopup', 'dialog');
        const statusGroup = el('div', 'l2d-status-group');
        const coverSlot = el('span', 'l2d-cover-slot'); coverSlot.append(skipCover);
        statusGroup.append(status, coverSlot);
        operationBottom.append(statusGroup, resultButton);
        const resultBody = el('div', 'l2d-dialog-body l2d-results');
        const resultFeedback = el('div', 'l2d-result-feedback');
        const adaptationNote = el('div', 'l2d-adaptation-note');
        resultBody.append(resultFeedback, adaptationNote);

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
          const detail = el('div', 'l2d-adaptation');
          const title = limited.length || warnings.length
            ? t('已自动适配 · 部分效果简化', 'Adapted · some effects simplified')
            : t('已自动修正适配', 'Adaptation corrected automatically');
          if (corrected.length) detail.appendChild(el('p', null, t('自动识别：', 'Detected: ') + show(corrected)));
          if (limited.length) detail.appendChild(el('p', null, t('沿用基础表现，独立控制受限：', 'Basic behavior retained; independent controls limited: ') + show(limited)));
          if (warnings.length) detail.appendChild(el('p', null, t('部分配置不可用，已自动使用基础识别。', 'Some configuration is unavailable; basic detection is used.')));
          detail.appendChild(el('p', null, t('继续使用已识别的通用动作和表情，无需手动配置参数。', 'Detected generic motions and expressions remain available; no manual parameter setup is needed.')));
          return {title, detail};
        }

        function showAdaptation(info) {
          const report = adaptationDetails(info);
          adaptationNote.replaceChildren(...(report ? [el('strong', null, report.title), report.detail] : []));
        }

        const progress = el('div', 'l2d-progress');
        const progressBar = el('span');
        progress.appendChild(progressBar);
        operation.appendChild(progress);

        // Cards keep their page layout while editing in a modal dialog.
        const head = el('div', 'l2d-head');
        const libraryTitle = el('div', 'l2d-library-title');
        const countLabel = el('span', 'l2d-count', '—');
        libraryTitle.append(el('h3', null, t('模型包', 'Packs')), countLabel);
        const search = ctx.ui.input?.({type:'search', placeholder:t('搜索模型包', 'Search packs')}) ?? el('input', 'l2d-input');
        search.classList.add('l2d-search');
        search.type = 'search'; search.placeholder = t('搜索模型包', 'Search packs');
        search.setAttribute('aria-label', search.placeholder);
        const sort = el('select', 'l2d-input l2d-sort');
        sort.setAttribute('aria-label', t('排序', 'Sort'));
        for (const [value, label] of [['new', t('最近添加', 'Newest')], ['name', t('按名称', 'Name')]]) {
          const option = el('option', null, label); option.value = value; sort.append(option);
        }
        const clearAll = el('button', 'l2d-btn sm quiet', t('清空旧打包', 'Clear old packs'));
        const libraryTools = el('div', 'l2d-library-tools');
        libraryTools.append(search, sort, clearAll, settingsButton);
        head.append(libraryTitle, libraryTools);
        const dashboard = el('div', 'l2d-workbench-tools');
        dashboard.append(operation, head);
        sheet.body.append(dashboard);
        const workspace = el('div', 'l2d-workspace');
        const assistDock = el('div', 'l2d-assist-dock');
        resultBody.append(assistDock);
        const grid = el('div', 'l2d-grid');
        grid.setAttribute('aria-label', t('模型包卡片', 'Pack cards'));
        workspace.append(grid); sheet.body.append(workspace);

        const foot = el('footer', 'l2d-foot');
        const noticeEntry = el('button', 'l2d-notice-entry', t('须知', 'Notice'));
        noticeEntry.type = 'button'; noticeEntry.hidden = true;
        noticeEntry.setAttribute('aria-haspopup', 'dialog');
        noticeEntry.addEventListener('click', () => openNotice());
        const target = el('span', 'l2d-target', '');
        foot.append(noticeEntry, target); shell.append(foot);

        const logBody = el('div', 'l2d-dialog-body');
        const logHead = el('div', 'l2d-head');
        logHead.appendChild(el('span', 'l2d-head-title', t('任务记录', 'Activity')));
        const logClear = el('button', 'l2d-btn sm quiet', t('清空', 'Clear'));
        logHead.appendChild(logClear);
        const rawLog = ui.log({ maxHeight: '320px', empty: t('还没有任务记录', 'No activity yet') });
        const log = { el: rawLog.el, clear() { rawLog.clear(); resultButton.classList.remove('has-error'); },
          append(line, tone) { rawLog.append(line, tone); if (tone === 'bad' || tone === 'warn') resultButton.classList.add('has-error'); } };
        logBody.append(logHead, log.el);
        resultBody.append(logBody);
        const popups = createWorkbenchPopups({ctx, shell, el, t, resultButton, resultBody, resultFeedback});
        resultButton.addEventListener('click', () => popups.openResults());
        logClear.addEventListener('click', () => log.clear());

        function finishNotice(flow) {
          if (disposed || noticeDialog !== flow || !notice?.acknowledged || flow.needsCore && !coreReady()) return;
          flow.handle.dispose();
          void flow.resume?.();
        }

        function openNotice(resume, needsCore = false) {
          if (disposed || state.busy || !notice) return;
          const body = el('div', 'l2d-dialog-body');
          body.append(el('p', null, t(NOTICE_TEXT.zh, NOTICE_TEXT.en)));
          const error = el('p', 'has-error l2d-result-feedback');
          error.setAttribute('role', 'status');
          const accept = el('button', 'l2d-btn primary', t('我已知晓，不再分发', 'I understand — no redistribution'));
          accept.type = 'button';
          const buttons = el('div', 'l2d-dialog-actions'); buttons.append(accept);
          const flow = {resume, needsCore, accept, error, saving:false, handle:null};
          body.append(coreCard);
          body.append(error, buttons);
          flow.handle = popups.show(t('须知', 'Notice'), body, {
            variant:'l2d-notice-popup',
            locked:() => flow.saving,
            onClose() { if (noticeDialog === flow) noticeDialog = null; },
          });
          noticeDialog = flow;
          paintNotice(); paintCore();
          accept.addEventListener('click', async () => {
            if (state.busy || notice?.acknowledged) return;
            flow.saving = true;
            error.textContent = '';
            setBusy(true, t('保存须知…', 'Saving acknowledgement…'));
            try { notice = await ctx.invoke('noticeAccept', [notice.revision]); }
            catch (failure) { error.textContent = t('保存失败，可以重试。', 'Could not save. Try again. ') + text(failure); }
            finally { setBusy(false); flow.saving = false; }
            finishNotice(flow);
          });
        }

        async function openSettings() {
          if (disposed || state.busy || settingsLoading) return;
          settingsLoading = true; settingsButton.disabled = true;
          try {
            const cfg = await ctx.invoke('settings', []);
            if (disposed || state.busy) return;
            let dialog;
            const body = settingsForm(ctx, cfg, {
              isDisposed: () => disposed || ctx.signal?.aborted || !dialog?.el.open,
              onNotice: openNotice,
              onSaved: async () => {
                if (disposed) return;
                dialog?.dispose?.(); ui.toast(t('设置已保存', 'Settings saved'), 'ok');
                await refresh().catch(error => { if (!disposed) log.append(text(error), 'warn'); });
              },
            });
            dialog = openFigureDialog(shell, t('设置', 'Settings'), body, {
              closeLabel:t('关闭','Close'), variant:'l2d-settings-popup', returnFocus:settingsButton,
              onClose() { body.dispose(); settingsDialog = null; },
              locked: () => body.hasAttribute('aria-busy'),
            });
            settingsDialog = dialog;
          } catch (error) { if (!disposed) ui.toast(text(error), 'bad'); }
          finally { settingsLoading = false; if (!disposed) settingsButton.disabled = state.busy; }
        }

        function resize() {
          if (disposed) return;
          const content = shell.getBoundingClientRect();
          shell.dataset.compact = String(content.width < 760);
        }
        const observer = win.ResizeObserver ? new win.ResizeObserver(resize) : null;
        observer?.observe(ctx.root); win.addEventListener('resize', resize); resize();

        function paintAutomation(value) {
          assistState = value || {enabled:false,plans:[]};
          if (assistState.enabled && !assistTimer && ctx.interval) assistTimer = ctx.interval(async () => {
            if (disposed || state.busy || assistPolling) return;
            assistPolling = true;
            try { const value = await ctx.invoke('assistState', []); if (!disposed && !state.busy) {
              const completed = (value.plans || []).some(p=>p.status==='done' && !(assistState.plans || []).some(old=>old.id===p.id && old.status==='done'));
              if (completed) await refresh(); else paintAutomation(value);
            } }
            catch { /* The normal status and task log still report operation failures. */ }
            finally { assistPolling = false; }
          },1500);
          if (!assistState.enabled && assistTimer) { assistTimer.dispose?.(); assistTimer = null; }
          const plans = assistState.plans || [];
          const submissions = assistState.submissions || [];
          const attention = assistState.enabled && (plans.some(p => p.error || p.status === 'approved' || p.status === 'pending' && !p.automatic) || submissions.some(r => r.error || r.canRetry));
          resultButton.classList.toggle('needs-attention', Boolean(attention));
          const signature = JSON.stringify([assistState.enabled,plans,submissions]);
          if (assistDock.dataset.plans === signature) { paintSource(); return; }
          const expanded = new Set([...assistDock.querySelectorAll('details[open]')].map(d=>d.dataset.id));
          assistDock.dataset.plans = signature; assistDock.replaceChildren();
          if (!assistState.enabled) { paintSource(); return; }
          for (const request of submissions) {
            if (!request.error && !request.waiting?.length) continue;
            const message = request.error ? t('提交失败：','Submission failed: ') + request.error : t('已提交 Coo，等待方案或聊天中的模型选择：','Sent to Coo; awaiting a proposal or model choice in chat: ') + request.waiting.join('、');
            const waiting=el('div','l2d-assist-submission');waiting.append(el('p','l2d-assist-wait'+(request.error?' has-error':''),message));
            if(request.canRetry&&request.token===staged?.token && stagedWorkflow(staged).mode === 'ai'){
              const retry=el('button','l2d-btn sm',t('重新提交','Retry'));retry.disabled=state.busy;
              retry.addEventListener('click',()=>{if(!pack.disabled) void buildSources();});waiting.append(retry);
            }
            assistDock.append(waiting);
          }
          const wordNames = {neutral:'平静',happy:'开心',wink:'眨眼',love:'喜欢',shy:'害羞',surprised:'惊讶',angry:'生气',sad:'难过',sleepy:'困倦',thinking:'思考',smug:'得意',pout:'嘟嘴',worried:'担心',determined:'坚定',flustered:'慌张',scared:'害怕',excited:'兴奋',cry:'哭泣',confused:'疑惑',idle:'待机',nod:'点头',shake:'摇头',wave:'挥手',bow:'鞠躬',cheer:'欢呼',dance:'跳舞',jump:'跳跃',sit:'坐下',stretch:'伸展',shiver:'发抖'};
          const history = el('details','l2d-assist-history'); history.dataset.id='history'; history.open=expanded.has('history');
          const finished = plans.filter(p=>p.status==='done');
          history.append(el('summary',null,t(`已完成 ${finished.length} 项 · 查看记录`,`${finished.length} completed · View history`)));
          for (const plan of plans) {
            const row = el('section','l2d-assist-plan');
            const info = el('div','l2d-assist-info');
            const labels = {pending:t('待确认','Awaiting approval'),approved:t('待重试','Ready to retry'),validating:t('检查素材中','Validating'),executing:t('安装中','Installing'),done:t('已安装','Installed'),interrupted:t('任务已中断，请重新导入','Interrupted; import again')};
            info.append(el('strong',null,`${plan.model} · ${labels[plan.status] || plan.status}`));
            if (plan.status === 'pending') info.append(el('p',null,plan.automatic && !plan.error ? t('等待自动安装','Waiting for automatic installation') : plan.question));
            if (plan.error && plan.status !== 'done') info.append(el('p','has-error',plan.error));
            for (const warning of plan.reviewWarnings || []) info.append(el('p',null,t('需要确认：','Confirmation required: ') + warning));
            if (plan.summary?.length) {
              const detail = el('details','l2d-adaptation');detail.append(el('summary',null,t('适配详情','Mapping details')));
              detail.dataset.id=plan.id;detail.open=expanded.has(plan.id);
              for(const item of plan.summary)detail.append(el('p',null,t(`表现“${wordNames[item.word] || item.word}”时使用「${item.source}」：${item.reason}`,`For ${item.word}, use ${item.source}: ${item.reason}`)));
              detail.append(el('p',null,t('未映射的动作保留通用表现。','Unmapped actions retain generic behavior.')));
              for(const skipped of plan.skipped || [])detail.append(el('p',null,typeof skipped==='string'?skipped:skipped.reason || skipped.word || ''));
              info.append(detail);
            }
            const actions = el('div','l2d-dialog-actions');
            const review = plan.status === 'approved' || plan.status === 'pending' && (!plan.automatic || plan.error);
            for (const [method,label] of review ? [['assistReject',t('暂不安装','Not now')],['assistApprove',plan.status==='approved'?t('重试安装','Retry installation'):t('同意安装','Approve & install')]] : []) {
              const button = el('button','l2d-btn sm'+(method==='assistApprove'?' primary':''),label);
              button.addEventListener('click',async()=>{
                if(state.busy || method === 'assistApprove' && !ensureNotice(() => button.click(), plan.needsRuntime === true))return;
                setBusy(true,t('处理方案…','Processing proposal…'));
                try {
                  const result = await ctx.invoke(method,[plan.id]);
                  if (method === 'assistApprove' && result.figureId) popups.reportResult(t('安装完成','Installation complete'), [result.warning], false, result.figureId);
                  await refresh();
                }
                catch(error){popups.reportResult(t('处理方案失败，可以重试。','Could not process the proposal. Try again.'),[text(error)],true);log.append(text(error),'bad');await refresh().catch(()=>{});}
                finally {setBusy(false);}
              }); actions.append(button);
            }
            row.append(info,actions); (plan.status==='done'?history:assistDock).append(row);
          }
          if (finished.length) assistDock.append(history);
          assistDock.classList.toggle('history-only',assistDock.children.length===1 && assistDock.firstElementChild===history);
          paintSource();
        }

        // ---------------- 行为 ----------------
        function say(text, bad = false) {
          statusText.textContent = text;
          statusText.title = text;
          status.classList.toggle('bad', Boolean(bad));
          status.setAttribute('aria-atomic','true');
        }

        /** 忙碌时：转圈 + 一条来回走的进度线 + 秒数。 */
        let ticker = null;
        function stopTicker() {
          if (ticker?.dispose) ticker.dispose();
          else if (ticker) win.clearInterval(ticker);
          ticker = null;
        }
        let startedAt = 0;
        function busyLabel(base) {
          const ms = performance.now() - startedAt;
          say(`${base} ${(ms / 1000).toFixed(1)}s`);
        }
        function setBusy(on, base) {
          if (disposed) return;
          const locked = on || !initialized;
          state.busy = locked;
          folderInput.disabled = locked;
          zipInput.disabled = locked;
          coreGet.disabled = locked;
          paintNotice();
          ctx.root.setAttribute('aria-busy', String(on));
          for (const b of [chooseFolder, chooseZip, settingsButton]) b.disabled = locked;
          clearAll.disabled = locked || state.builds.length < 2;
          dropZone.setAttribute('aria-disabled', String(locked));
          const count = (staged?.models?.length || 0) + (staged?.packs?.length || 0);
          paintImportButtons(count);
          for (const b of grid.querySelectorAll('button')) b.disabled = on;
          for (const b of assistDock.querySelectorAll('button')) b.disabled = on;
          status.classList.toggle('busy', on);
          progress.classList.toggle('on', on);
          if (on) {
            startedAt = performance.now();
            if (base) busyLabel(base);
            stopTicker();
            ticker = ctx.interval ? ctx.interval(() => { if (state.busy) busyLabel(base); }, 250)
              : win.setInterval(() => { if (state.busy) busyLabel(base); }, 250);
          } else {
            stopTicker();
            status.classList.remove('busy');
            progress.classList.remove('on');
            if (!status.classList.contains('bad')) paintStatus();
          }
        }

        function paintStatus() {
          const bits = [];
          if (state.installed?.target) {
            const card = state.builds.find(build => build.id === state.installed.buildId);
            const name = (zh ? card?.nameZh : card?.nameEn) || card?.nameZh || card?.nameEn
              || state.installed.target.split(/[\\/]/).pop();
            bits.push(t('最近安装 · ', 'Last installed · ') + name);
          }
          else if (notice && !notice.acknowledged) bits.push(t('首次使用需确认须知','Read the notice before first use'));
          else if (notice && !coreReady()) bits.push(t('Live2D 运行组件待获取','Live2D runtime is missing'));
          if (!bits.length) bits.push(t('就绪', 'Ready'));
          say(bits.join('　'));
          target.textContent = state.figuresDir ? t('安装到 ', 'Installs to ') + state.figuresDir : '';
          target.title = state.figuresDir;
        }

        function paint() {
          if (!state.busy && modal && !state.builds.some(b => b.id === editingId)) closeEdit();
          if (!state.busy) paintStatus();
          renderGrid();
        }

        async function deletePack(id) {
          if (state.busy) return;
          const ok = await ui.confirm({
            title: t('删除这份打包产物？', 'Delete this pack?'),
            body: t('只删这一份打包，已安装的形象不受影响。', 'Only this pack folder is removed.'),
            danger: true,
          });
          if (!ok || disposed || state.busy) return;
          setBusy(true, t('删除…', 'Deleting…'));
          try {
            const r = await ctx.invoke('remove', [id]);
            if (disposed) return;
            state.builds = r.builds ?? [];
            forgetRemovedPacks();
            paint();
            log.append(t('已删除 ', 'Deleted ') + id, 'dim');
            if (r.warn) popups.reportResult(t('已删除', 'Deleted'), [r.warn]);
            ui.toast(r.warn || t('已删除', 'Deleted'), r.warn ? undefined : 'ok');
          } catch (e) {
            if (!disposed) ui.toast(text(e), 'bad');
          } finally { setBusy(false); }
        }

        const library = mountWorkbenchLibrary({
          grid, search, sort, countLabel, clearAll, el, t, zh,
          readState: () => ({state, initialized, startupFailed, editingId}),
          actions: {
            retry:startWorkbench, cover:popups.openCover, edit:openEdit, remove:deletePack,
            adaptationDetails, showAdaptation:detail => popups.show(t('适配详情','Adaptation details'), detail),
            install:id => run('install', id), bind:id => openBindings('manualOpenBuild', [id]), paintBinding:paintBindingButton,
          },
        });
        const renderGrid = library.render;

        async function refresh() {
          const r = await ctx.invoke('list', []);
          if (disposed) return;
          state.builds = r.builds ?? [];
          state.browserBuildId = r.browserBuildId;
          state.installed = r.installed ?? null;
          state.figuresDir = r.figuresDir ?? '';
          paintAutomation(r.automation);
          const d = r.dir ?? '';
          if (!initialized && d) {
            state.dir = d;
          }
          initialized = true;
          paint();
        }

        function forgetRemovedPacks() {
          const buildIds = new Set(state.builds.map(build => build.id));
          for (const [key, buildId] of completed) {
            if (!installedSources.has(key) && !buildIds.has(buildId)) completed.delete(key);
          }
        }

        async function installBuild(id) {
          const args = [state.dir, id ?? null];
          const result = await ctx.invoke('install', args);
          if (!result.replacementRequired || disposed) return result;
          const confirmed = await ui.confirm({
            title: t('替换同 ID 的形象？', 'Replace the figure with the same ID?'),
            body: t('目标目录已有另一份形象包。确认后将先备份原包，再安装这份。', 'A different pack has the same ID. The current pack will be backed up before replacement.'),
          });
          return confirmed && !disposed ? ctx.invoke('install', [...args, true]) : null;
        }

        async function run(kind, id) {
          if (state.busy) return;
          if (kind !== 'scan' && !ensureNotice(() => run(kind, id), kind === 'build')) return;
          if (kind !== 'install' && !state.dir) return;
          const label = kind === 'scan' ? t('扫描', 'Scan') : kind === 'build' ? t('打包', 'Pack') : t('安装', 'Install');
          setBusy(true, label + '…');
          log.append(`→ ${label}`, 'dim');
          try {
            const r = kind === 'install' ? await installBuild(id) : await ctx.invoke(kind, [state.dir]);
            if (disposed || !r) return;
            if (kind === 'install') {
              for (const [key, buildId] of completed) {
                if (buildId === id) installedSources.add(key);
              }
              const {models, packs} = stagedWorkflow(staged);
              if (installedSources.size && installedSources.size === models.length + packs.length) {
                sourceFeedback = '';
                dropZone.classList.remove('bad');
              }
              paintSource();
            }
            popups.reportResult(kind === 'install' ? t('安装完成','Installation complete') : `${label} ✓`, r.warn ? [r.warn] : [], false, r.figureId);
            for (const line of r.log ?? []) log.append(line, 'dim');
            log.append(`✓ ${label} · ${((performance.now() - startedAt) / 1000).toFixed(1)}s`, 'plain');
            ui.toast(`${label} ✓`, 'ok');
            if (r.warn) log.append('! ' + r.warn, 'warn');
            await refresh().catch(e => log.append(t('操作已完成，列表刷新失败：', 'Completed, but the list could not refresh: ') + text(e), 'warn'));
            if (kind === 'install' && r.figureId && !disposed && !popups.isOpen()) {
              popups.openResults(() => {
                const card = [...grid.children].find(item => item.dataset.id === id);
                return card?.querySelector('.l2d-install:not(:disabled)') ?? resultButton;
              });
            }
          } catch (e) {
            const s = text(e);
            say(t(`${label}失败 · 查看结果`, `${label} failed · See results`), true);
            popups.reportResult(t(`${label}失败，可以重试。`, `${label} failed. Try again.`),[s],true);
            log.append(`✗ ${s}`, 'bad');
            ui.toast(`${label} ✗`, 'bad');
          } finally {
            setBusy(false);
          }
        }

        let bindingEditor = null;
        let bindingOpening = null;
        let browserSessionDialog = null;
        function paintBindingButton(button) {
          const opening = button.dataset.buildId === bindingOpening?.buildId;
          const editing = button.dataset.buildId === state.browserBuildId;
          button.querySelector('.l2d-card-binding-label').textContent = opening ? t('稍候','Wait') : editing ? t('编辑中','Editing') : t('动作','Actions');
          button.title = opening ? t('正在打开动作编辑器','Opening the action editor') : t('在浏览器中编辑动作与装扮','Edit actions and wardrobe in the browser');
          if (opening) {
            button.setAttribute('aria-busy','true');
            button.setAttribute('aria-label',button.title);
          } else {
            button.removeAttribute('aria-busy');
            button.removeAttribute('aria-label');
          }
          button.setAttribute('aria-description', button.title);
          if (bindingOpening) button.setAttribute('aria-disabled','true');
          else button.removeAttribute('aria-disabled');
        }
        function paintBindingButtons() {
          for (const button of grid.querySelectorAll('.l2d-card-binding')) paintBindingButton(button);
        }
        function stopBindingFeedback(opening) {
          if (!opening) return;
          opening.timer?.dispose();
          opening.notice?.dispose?.();
          opening.timer = opening.notice = undefined;
        }
        function markBrowserEditor(buildId) {
          state.browserBuildId = buildId;
          paintBindingButtons();
        }
        function showBrowserSession(current) {
          if (browserSessionDialog) return;
          const body = el('div', 'l2d-browser-session');
          const title = current.title || t('当前模型','Current model');
          body.append(el('p', 'l2d-bind-discard-text', t(`「${title}」正在浏览器中编辑。回到原标签页可继续。`, `“${title}” is being edited in the browser. Continue in the original tab.`)));
          const actions = el('div', 'l2d-dialog-actions');
          const end = el('button', 'l2d-btn', current.saving?t('正在保存…','Saving…'):t('结束会话','End session'));
          const back = el('button', 'l2d-btn primary', t('知道了','Done'));
          let ending = false;
          end.disabled = current.saving;
          end.title = t('保留最近一次暂存的草稿','Keep the latest staged draft');
          actions.append(end, back); body.append(actions);
          const handle = browserSessionDialog = openFigureDialog(shell, t('已有浏览器编辑页','Browser editor is open'), body, {
            closeLabel: t('关闭','Close'), locked: () => ending, onClose: () => { browserSessionDialog = null; },
          });
          back.onclick = () => handle.dispose();
          end.onclick = async () => {
            ending = true; end.disabled = back.disabled = true;
            try {
              await ctx.invoke('manualBrowserEnd', [current.token]);
              if (disposed) return;
              markBrowserEditor(); handle.dispose();
              ui.toast(t('编辑会话已结束，可重新打开。','The editing session ended. You can reopen it.'));
            } catch (error) { if (!disposed) ui.toast(text(error),'bad'); }
            finally { ending = false; end.disabled = back.disabled = false; }
          };
        }
        async function openBindings(method,args,onSaved) {
          if (disposed || ctx.signal?.aborted || state.busy || bindingOpening || !ensureNotice(() => openBindings(method,args,onSaved), method === 'manualOpen')) return;
          if (bindingEditor && !bindingEditor.browser) return;
          const opening = bindingOpening = {buildId:method === 'manualOpenBuild' ? args[0] : undefined};
          try {
            paintBindingButtons();
            if (opening.buildId) opening.timer = ctx.timeout?.(() => {
              if (!disposed && !ctx.signal?.aborted && bindingOpening === opening) {
                opening.notice = ui.toast(t('正在准备模型并打开浏览器…','Preparing the model and opening the browser…'));
              }
            }, 3000);
            const current = await ctx.invoke('manualBrowserStatus', []);
            if (disposed) return;
            if (current.status === 'open') { markBrowserEditor(current.buildId); showBrowserSession(current); return; }
            const opened = await ctx.invoke('manualBrowserOpen', [method, args, zh ? 'zh' : 'en', readStudioTheme(ctx.root)]);
            if (disposed) return;
            if (opened.fallback) {
              ui.toast(t('未能打开浏览器，已切换到 Coo 内编辑。', 'Browser unavailable. Editing in Coo.'));
              bindingEditor = await openBindingEditor(ctx, method, args, async result => { onSaved?.(result); await refresh(); }, () => { bindingEditor = null; });
              return;
            }
            markBrowserEditor(opened.buildId);
            ui.toast(t('已打开浏览器编辑器', 'Opened the browser editor'), 'ok');
            let timer, stopped = false;
            const watcher = {
              browser: true,
              dispose() { stopped = true; win.clearTimeout(timer); },
            };
            bindingEditor = watcher;
            const poll = async () => {
              if (stopped || disposed) return;
              try {
                const result = await ctx.invoke('manualBrowserStatus', [opened.token]);
                if (stopped || disposed) return;
                if (result.status === 'open') {
                  timer = win.setTimeout(poll, 1400);
                  return;
                }
                if (result.status === 'saved') {
                  onSaved?.(result);
                  await refresh();
                }
              } catch (error) {
                if (!disposed && !stopped) ui.toast(text(error), 'bad');
              }
              if (bindingEditor === watcher) { bindingEditor = null; markBrowserEditor(); }
            };
            timer = win.setTimeout(poll, 1400);
          }
          catch (error) { if (!disposed && !ctx.signal?.aborted) ui.toast(text(error),'bad'); }
          finally {
            stopBindingFeedback(opening);
            bindingOpening = null;
            if (!disposed) paintBindingButtons();
            if (bindingEditor?.closed) bindingEditor = null;
          }
        }
        // ---------------- 编辑弹层 ----------------
        let modal = null;
        let editReturnFocus = null;
        let editLoading = false;
        let editDirty = () => false;
        let cropEditor = null;

        function closeEdit() {
          if (disposed || state.busy) return;
          if (modal) {
            const previousId = editingId;
            cropEditor?.dispose(); cropEditor = null;
            modal.close(); modal.remove(); modal = null; editingId = null;
            const previous = [...grid.querySelectorAll('.l2d-card')].find(card => card.dataset.id === previousId);
            previous?.classList.remove('selected');
            (previous?.querySelector(editReturnFocus) ?? search).focus({preventScroll:true});
          }
        }

        async function openEdit(b, focusSelector) {
          if (state.busy || editLoading) return;
          if (modal && editingId === b.id) { modal.querySelector('[role="tab"][aria-selected="true"], input')?.focus(); return; }
          editLoading = true;
          if (modal && editDirty()) {
            const discard = await ui.confirm({ title: t('放弃未保存的修改？', 'Discard unsaved edits?'), body: t('切换到另一份模型包。', 'Open the other pack.') });
            if (!discard || disposed || state.busy) { editLoading = false; return; }
          }
          const d = await ctx.invoke('detail', [b.id]).catch(() => null);
          editLoading = false;
          if (disposed || state.busy) return;
          if (!d) { ui.toast(t('读不到这份打包的信息', 'Cannot read this pack'), 'bad'); return; }
          editReturnFocus = focusSelector;
          cropEditor?.dispose();
          const framing = cropEditor = d.crop ? createCropEditor({
            doc, t, initial:d.crop,
            loadCover:() => ctx.invoke('cropPreview', [b.id]),
          }) : null;
          const gaze = d.gaze && d.tunable !== false ? normalizeGazeConfig(d.gaze) : null;
          modal?.close(); modal?.remove();

          editingId = b.id;
          modal = el('dialog', 'l2d-modal' + (framing || gaze ? ' l2d-crop-modal' : ''));
          for (const card of grid.querySelectorAll('.l2d-card')) card.classList.toggle('selected', card.dataset.id === editingId);
          accessibleModal(modal, t('编辑形象信息', 'Edit figure'));
          const card = el('div', 'l2d-modal-card');
          const head2 = el('div', 'l2d-modal-head');
          const heading = el('div', 'l2d-modal-heading');
          heading.appendChild(el('div', 'l2d-modal-title', t('编辑形象信息', 'Edit figure')));
          heading.appendChild(el('div', 'l2d-modal-sub', b.id.replace(/(-\d{6,})+$/, '')));
          const close = el('button', 'l2d-btn quiet l2d-modal-close', '×');
          close.setAttribute('aria-label', t('关闭编辑', 'Close editor'));
          close.addEventListener('click', closeEdit);
          head2.append(heading, close);
          card.appendChild(head2);

          const info = el('div', 'l2d-edit-info');
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
            info.appendChild(wrap);
          };
          addField('name', t('名字', 'Name'), false, (zh ? d.nameZh || d.nameEn : d.nameEn || d.nameZh) || '');
          addField('about', t('一句话', 'About'), true, (zh ? d.aboutZh ?? d.aboutEn : d.aboutEn ?? d.aboutZh) || '');

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
          info.appendChild(gainWrap);

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
          info.appendChild(styleWrap);

          const gazePane = gaze ? el('div', 'l2d-edit-info') : null;
          let gazeValue;
          if (gazePane) {
            const followLabel = el('label', 'l2d-label-row');
            const follow = el('input', 'l2d-switch');
            follow.type = 'checkbox';
            follow.setAttribute('role', 'switch');
            follow.checked = gaze.enabled;
            followLabel.append(el('span', 'l2d-label', t('视线跟随鼠标', 'Follow cursor with eyes')), follow);

            const speedField = el('div', 'l2d-field l2d-gaze-speed');
            const speedLabel = el('label', 'l2d-label', t('跟随速度', 'Follow speed'));
            const speedOut = el('output', 'l2d-out');
            const speed = el('input', 'l2d-range');
            speed.type = 'range';
            speed.id = 'l2d-edit-gaze-speed';
            speedLabel.htmlFor = speed.id;
            speedOut.setAttribute('for', speed.id);
            speed.min = String(GAZE_SPEED_MIN);
            speed.max = String(GAZE_SPEED_MAX);
            speed.step = String(GAZE_SPEED_STEP);
            speed.value = String(gaze.speed);
            const updateSpeed = () => {
              speed.disabled = !follow.checked;
              speedOut.value = Number(speed.value).toFixed(2) + '×';
              speed.setAttribute('aria-valuetext', speedOut.value);
            };
            follow.addEventListener('change', updateSpeed);
            speed.addEventListener('input', updateSpeed);
            updateSpeed();
            const speedTop = el('div', 'l2d-label-row');
            speedTop.append(speedLabel, speedOut);
            speedField.append(speedTop, speed);
            gazePane.append(followLabel, speedField, el('p', 'l2d-hint l2d-gaze-note', t(
              '只调整眼球追上鼠标的快慢。需要模型有可转动的眼球参数。',
              'Changes how quickly the eyes follow the cursor. Requires movable eye parameters.',
            )));
            gazeValue = () => normalizeGazeConfig({ enabled: follow.checked, speed: Number(speed.value) });
          }

          const initialEdit = () => JSON.stringify([fields.name.value, fields.about.value, gain.value, style.value, framing?.value(), gazeValue?.()]);
          const initialValues = initialEdit();
          const initialGaze = gazeValue?.();
          const initialName = fields.name.value;
          const initialAbout = fields.about.value;
          const initialGain = gain.value, initialStyle = style.value;
          editDirty = () => initialEdit() !== initialValues;

          const hint = el('div', 'l2d-hint', t(
            '直接保存到该份打包产物。若这份已安装，需再点一次「安装」同步到 Coo。',
            'Saves without repacking. Re-install to sync if already installed.',
          ));
          let editScroll, editTabs;
          let showEditInfo = () => {};
          if (framing || gazePane) {
            editTabs = el('div', 'l2d-edit-tabs');
            editTabs.setAttribute('role', 'tablist');
            editTabs.setAttribute('aria-label', t('编辑选项', 'Editor sections'));
            editScroll = el('div', 'l2d-edit-scroll');
            const sections = [[t('信息', 'Details'), info]];
            if (framing) sections.push([t('取景', 'Framing'), framing.el]);
            if (gazePane) sections.push([t('视线', 'Gaze'), gazePane]);
            const panes = sections.map(([, pane]) => pane);
            const tabs = sections.map(([label, pane], index) => {
              const button = el('button', 'l2d-btn quiet sm', label);
              button.type = 'button';
              button.id = 'l2d-edit-tab-' + index;
              button.setAttribute('role', 'tab');
              pane.id = 'l2d-edit-pane-' + index;
              button.setAttribute('aria-controls', pane.id);
              pane.setAttribute('role', 'tabpanel');
              pane.setAttribute('aria-labelledby', button.id);
              button.addEventListener('click', () => selectTab(index));
              return button;
            });
            let selected = -1;
            function selectTab(index) {
              if (index === selected || state.busy) return;
              if (framing && panes[selected] === framing.el) framing.deactivate();
              selected = index;
              tabs.forEach((button, position) => {
                const active = position === selected;
                button.tabIndex = active ? 0 : -1;
                button.setAttribute('aria-selected', String(active));
                panes[position].hidden = !active;
              });
              editScroll.scrollTop = 0;
              if (framing && panes[selected] === framing.el) void framing.activate();
            }
            editTabs.addEventListener('keydown', event => {
              const last = tabs.length - 1;
              const move = {ArrowLeft:(selected+last)%tabs.length,ArrowRight:(selected+1)%tabs.length,Home:0,End:last}[event.key];
              if (move === undefined) return;
              event.preventDefault();
              selectTab(move);
              tabs[move].focus();
            });
            editTabs.append(...tabs);
            editScroll.append(...panes);
            card.append(editTabs, editScroll);
            showEditInfo = () => selectTab(0);
            selectTab(0);
          } else card.append(info);
          card.append(hint);

          const actions = el('div', 'l2d-modal-actions');
          const cancel = el('button', 'l2d-btn', t('取消', 'Cancel'));
          const save = el('button', 'l2d-btn primary', t('保存', 'Save'));
          const error = el('p', 'l2d-edit-feedback has-error');
          error.setAttribute('role','status');
          actions.append(error, cancel, save);
          card.appendChild(actions);

          cancel.addEventListener('click', closeEdit);
          modal.addEventListener('click', (e) => {
            if (e.target !== modal) return;
            const bounds = modal.getBoundingClientRect();
            if (e.clientX < bounds.left || e.clientX > bounds.right || e.clientY < bounds.top || e.clientY > bounds.bottom) closeEdit();
          });

          save.addEventListener('click', async () => {
            if (state.busy) return;
            if (!fields.name.value.trim()) { error.textContent = t('请输入名字后保存。', 'Enter a name and try again.'); showEditInfo(); fields.name.focus({preventScroll:true}); return; }
            error.textContent = '';
            close.disabled = cancel.disabled = save.disabled = true;
            setBusy(true, t('保存…', 'Saving…'));
            info.inert = true;
            if (editScroll) editScroll.inert = true;
            if (editTabs) editTabs.inert = true;
            try {
              const name = fields.name.value.trim();
              const about = fields.about.value.trim();
              const updatedGaze = gazeValue?.();
              const patch = {
                ...(fields.name.value !== initialName ? { [zh ? 'nameZh' : 'nameEn']: name } : {}),
                ...(fields.about.value !== initialAbout ? { [zh ? 'aboutZh' : 'aboutEn']: about } : {}),
                ...(d.tunable !== false && gain.value !== initialGain ? {bodyGain:Number(gain.value)} : {}),
                ...(d.tunable !== false && style.value !== initialStyle ? {style:style.value} : {}),
                ...(framing?.changed() ? {crop:framing.value()} : {}),
                ...(updatedGaze && (updatedGaze.enabled !== initialGaze.enabled || updatedGaze.speed !== initialGaze.speed)
                  ? {gaze:updatedGaze} : {}),
              };
              if (Object.keys(patch).length) await ctx.invoke('edit', [b.id, patch]);
              if (disposed) return;
              const currentCard = [...grid.children].find(item => item.dataset.id === b.id);
              const title = currentCard?.querySelector('button.title');
              if (title) title.textContent = name;
              if (patch.nameZh !== undefined) b.nameZh = name;
              if (patch.nameEn !== undefined) b.nameEn = name;
              await refresh().catch(() => {});
              if (disposed) return;
              setBusy(false);
              closeEdit();
              ui.toast(t('已保存', 'Saved'), 'ok');
              log.append(t('编辑 · ', 'Edited · ') + b.id, 'dim');
            } catch (e) {
              if (!disposed) error.textContent = t('保存失败，可以重试。', 'Could not save. Try again. ') + text(e);
            } finally {
              close.disabled = cancel.disabled = save.disabled = false;
              info.inert = false;
              if (editScroll) editScroll.inert = false;
              if (editTabs) editTabs.inert = false;
              setBusy(false);
              if (!disposed && modal?.open && error.textContent) save.focus({preventScroll:true});
            }
          });

          modal.appendChild(card);
          shell.appendChild(modal);
          modal.showModal();
          fields.name.focus({preventScroll:true});
        }

        const importView = {
          loading(label) { sourceTitle.textContent = label; sourceHint.textContent = ''; },
          note(title, detail, bad) {
            clearSource();
            sourceFeedback = [detail || title, t('可重新选择文件夹或 ZIP','Choose a folder or ZIP again')].join(' · ');
            paintSource();
            popups.reportResult(title,[detail,t('可重新选择文件夹、ZIP，或粘贴模型路径。','Choose a folder or ZIP again, or paste the model path.')],Boolean(bad));
            dropZone.classList.toggle('bad', Boolean(bad));
          },
          result(result) {
            if (disposed) { importTransfer.cancelOwnedImport(result.token); return; }
            importTransfer.ownImport(result.token);
            staged = result; completed.clear(); installedSources.clear(); dropZone.classList.remove('bad');
            sourceFeedback = '';
            if (result.submission) {
              assistState = { ...assistState, submissions: [...(assistState.submissions || []).filter(r => r.token !== result.token), result.submission] };
            }
            showAdaptation(null);
            const count = (result.models?.length || 0) + (result.packs?.length || 0);
            const problems = (result.problems || []).map(p => p.reason).filter(Boolean);
            if (!count) {
              const reason = problems.join('；') || t('未找到 Live2D 模型或现成形象包', 'No Live2D model or figure pack found');
              sourceFeedback = reason;
              popups.reportResult(t('未找到可导入的模型，可重新选择。','No model could be imported. Choose again.'),[reason],true);
            } else {
              popups.reportResult(t(`已识别 ${count} 项`, `${count} recognized`),problems);
              if (assistState.enabled) {
                void ctx.invoke('assistState', []).then(value => {
                  if (!disposed && staged === result && typeof value?.enabled === 'boolean') paintAutomation(value);
                }).catch(() => {});
              }
            }
            paintSource();
          },
        };

        function clearSource() {
          hasChosenImport = true;
          sourceFeedback = '';
          staged = null; completed.clear(); installedSources.clear(); showAdaptation(null); paintSource();
          popups.reportResult('');
          dropZone.classList.remove('bad');
        }

        const importTransfer = mountWorkbenchImport({
          ctx, t, chooseFolder, chooseZip, folderInput, zipInput, dropZone, importView, clearSource, setBusy,
          isBusy: () => state.busy, isDisposed: () => disposed,
        });

        skipCover.addEventListener('click', async () => {
          const cover = currentCover;
          if (!cover || disposed || skipCover.disabled) return;
          skipCover.disabled = true;
          try {
            await ctx.invoke('skipImportCover', [cover.token, cover.dir]);
            if (!disposed && currentCover === cover) skipCover.textContent = t('已跳过封面', 'Cover skipped');
          } catch (error) {
            if (disposed || currentCover !== cover) return;
            skipCover.disabled = false;
            ui.toast(t('暂时无法跳过封面。', 'Could not skip the cover. ') + text(error), 'bad');
          }
        });

        async function buildSources(installAfterBuild = false) {
          if (state.busy || !staged) return;
          const source = staged;
          const {mode, models, packs} = stagedWorkflow(source);
          const newModels = models.filter(model => !completed.has('importBuild:' + model.dir));
          const needsCore = mode === 'direct' && newModels.length > 0;
          if (!ensureNotice(() => { if (staged === source) return buildSources(installAfterBuild); }, needsCore)) return;
          if (mode === 'ai') {
            setBusy(true,t('交给 Coo 分析…','Asking Coo to analyze…'));
            try {
              const result = await ctx.invoke('assistAnalyze',[source.token,models.map(m=>m.dir),packs.map(p=>p.dir)]);
              popups.reportResult(result.queued===false?t('已提交，请等待 Coo 的方案','Already submitted; wait for Coo'):t('已交给 Coo 分析','Sent to Coo for analysis'));
              await refresh().catch(error=>log.append(text(error),'warn'));
            } catch (error) {
              popups.reportResult(t('提交失败，可以重新提交。','Submission failed. Try again.'),[text(error)],true);
              log.append(text(error),'bad'); await refresh().catch(()=>{});
            }
            finally{setBusy(false);}return;
          }
          if (mode === 'manual' && models.length) {
            const next = newModels[0];
            if (next) {
              await openBindings('manualOpen', [source.token, next.dir], result => {
                if (staged === source) completed.set('importBuild:' + next.dir, result.buildId);
              });
              return;
            }
          }
          const pending = [
            ...models.map(item => ({ ...item, method: 'importBuild' })),
            ...packs.map(item => ({ ...item, method: 'importKeep' })),
          ];
          const token = source.token;
          setBusy(true, installAfterBuild ? t('打包并安装…', 'Packing and installing…') : t('打包…', 'Packing…'));
          const failures = [];
          const warnings = [];
          const newInstalls = [];
          let deferred = 0;
          for (const item of pending) {
            if (disposed) break;
            const key = item.method + ':' + item.dir;
            if (installAfterBuild ? installedSources.has(key) : completed.has(key)) continue;
            try {
              if (!completed.has(key)) {
                if (item.method === 'importBuild') {
                  currentCover = { token, dir: item.dir };
                  skipCover.textContent = t('跳过封面', 'Skip cover');
                  skipCover.disabled = false;
                  skipCover.hidden = false;
                }
                let result;
                try { result = await ctx.invoke(item.method, [token, item.dir, false]); }
                finally { currentCover = null; skipCover.hidden = true; }
                completed.set(key, result.buildId);
                for (const line of result.log ?? []) log.append(line, 'dim');
                if (result.adaptation) showAdaptation(result.adaptation);
                if (result.warn) { warnings.push(result.warn); log.append('! ' + result.warn, 'warn'); }
              }
              if (installAfterBuild && !disposed) {
                const buildId = completed.get(key);
                if (!buildId) throw Error(t('找不到这份打包记录', 'Pack record not found'));
                const result = await installBuild(buildId);
                if (!result) { deferred++; continue; }
                installedSources.add(key);
                if (result.figureId) newInstalls.push(result.figureId);
                for (const line of result.log ?? []) log.append(line, 'dim');
                if (result.warn) { warnings.push(result.warn); log.append('! ' + result.warn, 'warn'); }
              }
            } catch (e) {
              const failure = `${item.title || item.id || item.dir} · ${text(e)}`;
              failures.push(failure); log.append(failure, 'bad');
            }
          }
          try { await refresh(); }
          catch (e) { log.append('! ' + text(e), 'warn'); }
          finally { setBusy(false); }
          if (disposed) return;
          sourceFeedback = failures.length
            ? t(`${failures.length} 项失败；再次点击只重试未完成项，原因见结果`, `${failures.length} failed; click again to retry unfinished items; see results`)
            : deferred ? t(`${deferred} 项已打包；再次点击可确认替换`, `${deferred} packed; click again to confirm replacement`)
            : '';
          paintSource();
          dropZone.classList.toggle('bad', failures.length > 0);
          const done = installAfterBuild ? t('安装完成', 'Installation complete') : t('打包完成', 'Packing complete');
          popups.reportResult(sourceFeedback || done, [...failures,...warnings], failures.length > 0, newInstalls.length === 1 ? newInstalls[0] : undefined);
          if (newInstalls.length > 1) resultFeedback.append(wardrobeLink(el, t('打开装扮', 'Open Dress up')));
          if (newInstalls.length && !popups.isOpen()) {
            popups.openResults(() => {
              if (!dressLink.hidden) return dressLink;
              if (!installNow.hidden && !installNow.disabled) return installNow;
              return resultButton;
            });
          }
        }

        function accessibleModal(node, title) {
          node.setAttribute('role', 'dialog');
          node.setAttribute('aria-modal', 'true');
          node.setAttribute('aria-label', title);
          node.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeEdit(); }
          });
          node.addEventListener('cancel', (e) => { e.preventDefault(); closeEdit(); });
        }

        // ---------------- 绑定 ----------------
        pack.addEventListener('click', () => buildSources());
        installNow.addEventListener('click', () => buildSources(true));
        clearAll.addEventListener('click', async () => {
          if (state.busy) return;
          const ok = await ui.confirm({
            title: t('清空旧打包？', 'Clear old packs?'),
            body: t('保留最新一份，其余打包目录直接删除。已安装的形象不受影响。', 'Keeps the newest pack; installed figures stay.'),
            danger: true,
          });
          if (!ok || disposed || state.busy) return;
          setBusy(true, t('清理…', 'Clearing…'));
          try {
            const r = await ctx.invoke('clearAll', []);
            if (disposed) return;
            state.builds = r.builds ?? [];
            forgetRemovedPacks();
            paint();
            log.append(t('清空旧打包 · 删除 ', 'Cleared ') + r.removed + t(' 份', ' packs'), 'dim');
            const failures = r.failures ?? [];
            const warnings = [...failures, r.warn].filter(Boolean);
            const heading = failures.length ? t('有打包目录未删除', 'Some pack folders could not be deleted') : t('已清空', 'Cleared');
            if (warnings.length) popups.reportResult(heading, warnings, failures.length > 0);
            ui.toast(failures.length ? heading : r.warn || heading, failures.length ? 'bad' : r.warn ? undefined : 'ok');
          } catch (e) {
            if (!disposed) ui.toast(text(e), 'bad');
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
            await refresh();
            if (disposed) return;
            resuming = false; stopResume(); setBusy(false);
            const completed = resumePhase && remote.steps?.[resumePhase];
            if (completed?.phase === 'error') say(completed.hint, true);
          } catch (error) { if (!disposed) say(t('等待后台任务结果…', 'Waiting for the background task…')); }
          finally { resumePolling = false; }
        }

        async function initialize(attempt, recovering) {
          startupTimer = null;
          if (disposed || ctx.signal?.aborted) return;
          try {
            const [coreState, initial] = await Promise.all([
              ctx.invoke('core', []), ctx.invoke('state', []),
            ]);
            if (disposed) return;
            await refresh();
            if (disposed) return;
            core = coreState;
            notice = initial.notice;
            version = initial.version;
            paintCore();
            for (const line of initial.log ?? []) log.append(line, 'dim');
            if (initial.busy) {
              resuming = true;
              resumePhase = Object.keys(initial.steps ?? {}).find(key => initial.steps[key].phase === 'loading');
              setBusy(true, t('后台任务处理中…', 'Background task running…'));
              resumeHandle = ctx.interval ? ctx.interval(pollResume, 800) : win.setInterval(pollResume, 800);
            } else {
              setBusy(false);
              const imported = await ctx.invoke('takeDesktopImport', []).catch(() => null);
              if (typeof imported?.token === 'string' && Array.isArray(imported.models)) {
                if (!disposed && !hasChosenImport && !state.busy) importView.result(imported);
                else importTransfer.cancelOwnedImport(imported.token);
              }
            }
            if (recovering || attempt) ctx.refresh?.().catch(() => {});
          } catch (error) {
            if (disposed || ctx.signal?.aborted) return;
            const transient = [0, 502, 503, 504].includes(error?.status) || /扩展正在停止|extension is stopping/i.test(text(error));
            if (transient && attempt < 20) {
              if (!attempt) setBusy(true, t('正在等待扩展恢复…', 'Waiting for the extension…'));
              const retry = () => void initialize(attempt + 1, true);
              startupTimer = ctx.timeout ? ctx.timeout(retry, 1000) : win.setTimeout(retry, 1000);
              return;
            }
            startupFailed = true;
            say(transient ? t('扩展尚未就绪，可以重新读取。', 'The extension is still starting. Try loading again.') : text(error), true);
            setBusy(false);
            renderGrid();
          }
        }
        function startWorkbench() {
          const recovering = startupFailed;
          startupFailed = false;
          renderGrid();
          setBusy(true, t('读取…', 'Loading…'));
          void initialize(0, recovering);
        }

        // Host calls the returned disposer when switching panels.
        startWorkbench();
        return { dispose() {
          if (disposed) return;
          disposed = true;
          stopWatchingStyles();
          if (startupTimer?.dispose) startupTimer.dispose();
          else if (startupTimer != null) win.clearTimeout(startupTimer);
          stopTicker();
          stopResume();
          assistTimer?.dispose?.();
          stopBindingFeedback(bindingOpening);
          bindingEditor?.dispose?.();
          browserSessionDialog?.dispose();
          cropEditor?.dispose(); cropEditor = null;
          modal?.close(); modal?.remove();
          popups.dispose(); settingsDialog?.dispose();
          observer?.disconnect(); win.removeEventListener('resize', resize);
          shell.remove();
          importTransfer.dispose();
          library.dispose();
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
