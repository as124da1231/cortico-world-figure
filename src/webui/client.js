/**
 * Coo 魔术人偶工坊 面板（浏览器端，手写 ESM，不打 bundle）。
 *
 * 导入区：[拖入 / 点击后粘贴] [选择文件夹 / ZIP] [一键打包]
 * 卡片：[安装][编辑][删除]；编辑弹层直接改 figure.json / profile.js，不重新打包。
 * 原始模型打包、现成形象包入库，均保留卡片上的安装操作。
 */
const NOTICE_TEXT = {
  zh: '生成的形象包可能包含 Live2D Cubism Core，仅供本机使用。请保留模型、贴图和第三方组件各自的许可。',
  en: 'Generated figure packs may include Live2D Cubism Core for local use. Keep the separate licenses for models, textures and third-party components.',
};
// Theme only extension-owned roots. Restore inherited host values on unmount.
function applyAppearance(root, cfg) {
  const preferences=normalizeAppearance(cfg),classic=preferences.uiStyle==='classic';
  const appearance=classic?{...preferences,gearTheme:'purple',particleEffect:'stars',uiMaterial:'matte',uiMode:'auto',uiCorners:'standard',uiGlow:'off',uiButtonFill:'solid'}:preferences;
  const theme=GEAR_THEMES.find(t=>t.id===appearance.gearTheme);
  root.classList.add('l2d-themed');
  for(const [key,value] of Object.entries(appearance)) root.dataset[key]=value;
  root.style.setProperty('--appearance-accent',theme.color);
  root.style.setProperty('--gear-max-color',classic?theme.color:'var(--appearance-effective, '+theme.color+')');
  root.style.setProperty('--gear-max-fill',theme.fill);
  root.style.setProperty('--gear-spark-glow',theme.glow);
  const chrome = root.previousElementSibling;
  const route = root.ownerDocument.defaultView?.location.hash || '';
  if (root.classList.contains('panelslot') && chrome?.matches('.providerchrome')
      && /^#\/provider\/world(?:%3a|:)figure(?:\/|$)/i.test(route)) {
    // Coo reuses this header between tabs of the same provider and drops it on exit.
    chrome.classList.add('l2d-themed', 'l2d-provider-chrome');
    chrome.dataset.uiMode = appearance.uiMode;
    chrome.dataset.uiStyle = appearance.uiStyle;
    chrome.style.setProperty('--appearance-accent', theme.color);
  }
}
function ownAppearance(root) {
  const keys=Object.keys(normalizeAppearance()),props=['--appearance-accent','--gear-max-color','--gear-max-fill','--gear-spark-glow'];
  const data=keys.map(k=>root.dataset[k]),styles=props.map(k=>[root.style.getPropertyValue(k),root.style.getPropertyPriority(k)]),hadClass=root.classList.contains('l2d-themed');
  let restored=false;
  return ()=>{if(restored)return;restored=true;keys.forEach((k,i)=>{if(data[i]===undefined)delete root.dataset[k];else root.dataset[k]=data[i];});props.forEach((k,i)=>{if(styles[i][0])root.style.setProperty(k,...styles[i]);else root.style.removeProperty(k);});if(!hadClass)root.classList.remove('l2d-themed');};
}

// Primary configuration and the quick popup share saving and dependency handling.
function settingsForm(ctx, cfg, { autosave = false, appearanceOnly = false, onNotice, onSaved, onAppearance, isDisposed = () => ctx.signal?.aborted } = {}) {
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
  const controls = [];
  const fields = new Map();
  const appearance=normalizeAppearance(cfg);
  const paintAppearance=()=>{
    applyAppearance(body,appearance);onAppearance?.(appearance);
    if(appearanceOnly)for(const input of controls){if(input.type==='radio'&&input.name!=='l2d-uiStyle'){input.disabled=appearance.uiStyle==='classic';input.closest('.l2d-setting-row').classList.toggle('inactive',input.disabled);}}
  };
  paintAppearance();
  function appearanceField(section,key,title,hint,choices){
    const row=el('div','l2d-setting-row l2d-appearance-row'),label=el('span','l2d-setting-label');label.append(el('span',null,title),el('small',null,hint));
    const group=el('div',key==='gearTheme'?'l2d-theme-options':'l2d-particle-options');group.style.setProperty('--appearance-options',String(choices.length));group.setAttribute('role','radiogroup');group.setAttribute('aria-label',title);
    group.classList.toggle('l2d-appearance-six-options', choices.length === 6);
    for(const choice of choices){
      const option=el('label','l2d-appearance-option'),input=el('input','l2d-appearance-radio');input.type='radio';input.name='l2d-'+key;input.value=choice.id;input.checked=appearance[key]===choice.id;input.setAttribute('aria-label',zh?choice.name:choice.en);
      const icon=el('span',key==='gearTheme'?'l2d-theme-swatch':'l2d-particle-icon',key==='gearTheme'?null:choice.icon);icon.setAttribute('aria-hidden','true');if(choice.fill){icon.style.background=choice.fill;option.style.setProperty('--choice-color',choice.color);}
      option.append(input,icon,el('span',null,zh?choice.name:choice.en));group.append(option);controls.push(input);
      input.addEventListener('change',()=>{if(input.disabled||!input.checked)return;appearance[key]=choice.id;paintAppearance();dirty['worlds.figure.'+key]=choice.id;});
    }
    row.append(label,group);section.append(row);
  }
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
      const sparks = el('span', 'l2d-gear-sparks'); sparks.setAttribute('aria-hidden', 'true');
      for (let i = 0; i < 10; i++) {
        const spark = el('i');
        spark.style.cssText = `--spark-x:${8 + i * 8.4}%;--spark-y:${6 + (i * 7 % 18)}px;--spark-delay:${-i * .37}s;--spark-duration:${1.8 + i % 3 * .4}s`;
        sparks.append(spark);
      }
      fill.append(sparks);
      const stops = el('span', 'l2d-gear-stops'); stops.setAttribute('aria-hidden', 'true');
      choices.forEach(() => stops.append(el('i')));
      input = el('input', 'l2d-gear-input');
      input.type = 'range'; input.min = '0'; input.max = String(choices.length - 1); input.step = '1';
      const initial = choices.findIndex(([v]) => v === cfg[key]);
      input.value = String(initial < 0 ? choices.findIndex(([v]) => v === (key === 'texture' ? 'original' : key === 'previewSize' ? '512' : key === 'assistDepth' ? 'standard' : key === 'quality' ? 'balanced' : key === 'adaptationMode' ? 'none' : 'auto')) : initial);
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
    input.addEventListener('change', () => { if (input.disabled) return; paint(); dirty['worlds.figure.' + key] = type === 'checkbox' ? input.checked : readValue ? readValue() : input.value.trim(); });
    fields.set(key,{input,paint,readValue,choices});
    controls.push(input); row.append(label, control || input); body.append(row); return input;
  }
  let depend=()=>{};
  if(appearanceOnly){
    const appearanceGroup = title => {
      const section = el('section', 'l2d-appearance-group');
      section.append(el('h3', 'l2d-appearance-heading', title));
      body.append(section);
      return section;
    };
    const preview=el('section','l2d-appearance-preview');preview.setAttribute('aria-label',t('外观实时预览','Live appearance preview'));
    const intro=el('div','l2d-preview-intro');intro.append(el('strong',null,t('实时预览','Live preview')),el('small',null,t('修改即时显示并自动保存','Changes appear and save automatically')));
    const bar=el('div','l2d-gear is-max l2d-preview-bar');bar.setAttribute('role','img');bar.setAttribute('aria-label',t('满档光效预览','Maximum effect preview'));
    const track=el('span','l2d-gear-track'),fill=el('span','l2d-gear-fill'),sparks=el('span','l2d-gear-sparks');sparks.setAttribute('aria-hidden','true');
    for(let i=0;i<10;i++){const spark=el('i');spark.style.cssText=`--spark-x:${8+i*8.4}%;--spark-y:${6+i*7%18}px;--spark-delay:${-i*.37}s;--spark-duration:${1.8+i%3*.4}s`;sparks.append(spark);}fill.append(sparks);track.append(fill,el('span','l2d-preview-thumb'));bar.append(track);
    const samples=el('div','l2d-preview-samples'),sample=el('div','l2d-card l2d-preview-card');sample.append(el('strong',null,t('模型卡片','Model card')),el('small',null,t('材质与边角','Material and corners')));
    const button=el('button','l2d-btn primary',t('主要按钮','Primary button'));button.type='button';button.disabled=true;
    const input=el('input','l2d-input');input.value=t('输入框预览','Input preview');input.readOnly=true;input.setAttribute('aria-label',input.value);
    samples.append(sample,input,button);preview.append(intro,bar,samples);body.append(preview);
    const theme = appearanceGroup(t('主题','Theme'));
    appearanceField(theme,'uiStyle',t('外观方案','Appearance preset'),t('默认使用原版蓝紫风格，自定义选项会保留','Default uses the original blue and purple look. Custom choices are kept.'),UI_STYLES);
    appearanceField(theme,'gearTheme',t('主题配色','Theme colour'),t('统一标题区、页签、按钮和满档滑杆的配色','Colours the header, tabs, buttons and sliders at their highest setting'),GEAR_THEMES);
    appearanceField(theme,'uiMode',t('明暗模式','Light and dark mode'),t('设置 Figure 页面与标题区的明暗','Controls brightness across the Figure panel and its header'),UI_MODES);
    const controlsGroup = appearanceGroup(t('控件与材质','Controls and materials'));
    appearanceField(controlsGroup,'uiMaterial',t('表面材质','Surface material'),t('用于卡片、面板和弹窗','Applies to cards, panels and dialogs'),UI_MATERIALS);
    appearanceField(controlsGroup,'uiCorners',t('边角风格','Corners'),t('统一卡片、弹窗和控件的圆角','Sets corner shapes for cards, dialogs and controls'),UI_CORNERS);
    appearanceField(controlsGroup,'uiButtonFill',t('按钮填色','Button fill'),t('用于主要操作按钮','Applies to primary action buttons'),UI_BUTTON_FILLS);
    appearanceField(controlsGroup,'uiGlow',t('光晕强度','Glow intensity'),t('调整按钮和面板周围的光晕','Sets the glow around buttons and panels'),UI_GLOWS);
    const sliders = appearanceGroup(t('滑杆','Sliders'));
    appearanceField(sliders,'particleEffect',t('粒子效果','Particle effect'),t('用于满档滑杆。桌宠演出请到「特效」页选择。','Applies to sliders at their highest setting. Choose pet effects on the Effects tab.'),GEAR_PARTICLES);
    paintAppearance();
  } else {
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
  field('previewSize',t('预览精度','Preview resolution'),t('仅影响动作与装扮对照图；默认 512','Only affects action and wardrobe comparison images; default 512'),'gear',['256','512','1024'].map(v=>[v,v+' px']));
  field('clean', t('清理', 'Clean'), '', 'checkbox');
  field('autoDelete', t('安装后删除打包产物', 'Delete pack after installation'), t('仅在安装成功后执行，保留原始素材', 'Only after a successful install; source files are kept'), 'checkbox');
  const folder = field('figuresDir', t('安装目录', 'Install folder'), t('通常无需修改', 'Usually no change needed'), 'text');
  if (ctx.pickPath) {
    const picker = el('span', 'l2d-folder-control');
    const browse = el('button', 'l2d-btn sm', t('选择', 'Browse')); browse.type = 'button';
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
  body.append(el('h3','l2d-settings-heading',t('动作适配','Action mapping')));
  const mode = field('adaptationMode',t('适配方式','Adaptation mode'),t('无：仅通用配方；人工：预览并绑定；AI：交给 Coo 分析','None: generic recipes; Manual: preview and bind; AI: let Coo analyze'),'gear',[['none',t('无','None')],['manual',t('人工','Manual')],['ai','AI']]);
  const gear = field('assistGear',t('分析方式','Analysis mode'),t('图片不受支持时自动使用文本','Falls back to text when the current model cannot use images'),'gear', [['text',t('文本','Text')],['auto',t('自动','Auto')],['image',t('文本＋图片','Text + images')]]);
  const depth = field('assistDepth',t('适配深度','Adaptation depth'),t('仅文本＋图片时启用：基础取样、针对性补查、映射对照复核','Available with text + images: basic sampling, targeted inspection, mapping comparison'),'gear', [['quick',t('快速','Quick')],['standard',t('标准','Standard')],['deep',t('深入','Deep')]]);
  const automatic = field('assistAuto',t('自动安装','Automatic installation'),t('满足安装条件后自动执行；需要确认时暂停','Install when requirements are met; pause for confirmation when needed'),'checkbox');
  const confirmFallback = field('assistConfirmFallback',t('降级前确认','Confirm fallback'),t('需要沿用通用表现时先确认，默认直接继续','Ask before keeping generic behavior. Off by default.'),'checkbox');
  const roots = field('modelRoots',t('模型搜索目录','Model search folders'),t('每行一个目录；用于按名字找模型','One folder per line, used when finding models by name'),'textarea');
  roots.placeholder = t('留空时只搜索最近使用的模型目录','Leave empty to search recently used model folders');
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
  }
  const actions = el('div', 'l2d-dialog-actions');
  if (onNotice) {
    const note = el('button', 'l2d-notice-entry', t('须知', 'Notice')); note.type = 'button';
    note.addEventListener('click', () => { if (!isDisposed()) onNotice(); });
    actions.append(note);
  }
  const status = el('span', 'l2d-settings-status', autosave ? t('修改后自动保存。', 'Changes save automatically.') : '');
  status.setAttribute('role', 'status');
  const save = el('button', 'l2d-btn primary', t('保存设置', 'Save settings')); save.type = 'submit'; save.hidden = autosave;
  actions.append(status, save); body.append(actions);
  let saving = false;
  ctx.guardLeave?.(() => body.isConnected && (saving || Object.keys(dirty).length) ? t('设置尚未保存，确定离开？', 'Settings are not saved. Leave anyway?') : null);
  async function persist() {
    if (saving || isDisposed()) return;
    if (!Object.keys(dirty).length) { if (!autosave) await onSaved?.(); return; }
    saving = true; save.disabled = true;
    if (!autosave) controls.forEach(input => { input.disabled = true; });
    status.textContent = t('保存中…', 'Saving…');
    const patch = {...dirty};
    let succeeded = false;
    try {
      await ctx.setConfig('figure', patch);
      for (const key of Object.keys(patch)) if (dirty[key] === patch[key]) delete dirty[key];
      succeeded = true;
      if (isDisposed()) return;
      status.textContent = t('已保存', 'Saved'); save.hidden = autosave;
      await onSaved?.();
    } catch (error) {
      if (!isDisposed()) {
        status.textContent = t('保存失败，请重试。', 'Save failed. Please retry.');
        save.hidden = false; if (autosave) save.textContent = t('重试保存', 'Retry save');
        ctx.ui.toast(String(error?.message || error), 'bad');
      }
    } finally {
      saving = false; save.disabled = false;
      if (!autosave) { controls.forEach(input => { input.disabled = false; }); depend(); }
    }
    if (autosave && succeeded && Object.keys(dirty).length && !isDisposed()) await persist();
  }
  body.addEventListener('submit', event => { event.preventDefault(); void persist(); });
  if (autosave) body.addEventListener('change', () => { void persist(); });
  return body;
}

const configuration = {
  async mount(ctx) {
    const cfg = await ctx.invoke('settings', []);
    if (ctx.signal?.aborted) return;
    const restoreAppearance=ownAppearance(ctx.root);applyAppearance(ctx.root,cfg);
    const doc = ctx.root.ownerDocument;
    const zh = String(ctx.language || 'zh').toLowerCase().startsWith('zh');
    const shell = doc.createElement('section'); shell.className = 'l2d-config-page';
    shell.setAttribute('aria-label', zh ? '模型设置' : 'Model settings');
    const form = settingsForm(ctx, cfg, {autosave:true});
    shell.append(form); ctx.root.append(shell);
    return {dispose() { shell.remove();restoreAppearance(); }};
  },
};

export default {
  panels: {
    settings: configuration,
    effects: effectsGallery,
    voice: speechProviders,
    appearance: {
      async mount(ctx){
        const cfg=await ctx.invoke('settings',[]);
        if(ctx.signal?.aborted)return;
        const restoreAppearance=ownAppearance(ctx.root),doc=ctx.root.ownerDocument,zh=String(ctx.language||'zh').startsWith('zh');
        const shell=doc.createElement('section');shell.className='l2d-config-page l2d-appearance-page';
        shell.setAttribute('aria-label',zh?'外观':'Appearance');
        const form=settingsForm(ctx,cfg,{autosave:true,appearanceOnly:true,onAppearance:value=>applyAppearance(ctx.root,value)});
        shell.append(form);ctx.root.append(shell);
        return {dispose(){shell.remove();restoreAppearance();}};
      },
    },
    workbench: {
      mount(ctx) {
        const ui = ctx.ui;
        const doc = ctx.root.ownerDocument;
        const win = doc.defaultView;
        const restoreAppearance=ownAppearance(ctx.root);
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
        let activeImportToken = null;
        let resumeHandle = null;
        let resuming = false;
        let resumePolling = false;
        let resumePhase;
        let editingId = null;
        let overlay = null;
        let popup = null;
        let noticeDialog = null;
        let settingsLoading = false;
        let assistTimer = null;
        let assistPolling = false;
        let assistState = {enabled:false,plans:[]};
        let currentAppearance=normalizeAppearance();
        function showDialog(title, body) {
          overlay?.dispose?.();
          if(body?.nodeType===1)applyAppearance(body,currentAppearance);
          overlay = ui.drawer(title, body);
          return overlay;
        }
        function showPopup(title, body, options = {}) {
          popup?.dispose();
          const handle = openFigureDialog(shell, title, body, {
            closeLabel:t('关闭','Close'), ...options,
            onClose() { if (popup === handle) popup = null; options.onClose?.(); },
          });
          popup = handle;
          return handle;
        }
        const state = { dir: '', busy: false, builds: [], installed: null, figuresDir: '' };

        // ---- Live2D 核心组件：不随扩展分发，同意许可后从官方地址取 ----
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
            const kb = Math.round((core.bytes || 0) / 1024);
            coreText.textContent = t(
              `核心已就绪 · ${core.version || ''} · ${kb} KB · 已校验`,
              `Core ready · ${core.version || ''} · ${kb} KB · verified`,
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

        coreGet.addEventListener('click', async () => {
          const flow = noticeDialog;
          if (state.busy || !flow) return;
          flow.saving = true;
          flow.error.textContent = '';
          setBusy(true, t('获取核心…', 'Fetching core…'));
          try {
            core = await ctx.invoke('coreAccept', [true]);
            paintCore();
            log.append(t('已获取 Live2D 核心并校验', 'Live2D core fetched and verified'), 'dim');
          } catch (e) {
            flow.error.textContent = t('获取失败，可以重试或打开官网。', 'Could not fetch the core. Retry or open the download page. ') + text(e);
            log.append('! ' + text(e), 'warn');
          } finally {
            setBusy(false);
            flow.saving = false;
          }
          if (coreReady()) finishNotice(flow);
        });

        const shell = el('section', 'l2d-sheet');
        const header = el('header', 'l2d-header');
        header.setAttribute('aria-label',t('模型工坊操作','Figure workshop actions'));
        const toolbar = el('div','l2d-toolbar');
        const settingsButton = el('button', 'l2d-btn l2d-settings-button', t('设置', 'Settings'));
        settingsButton.type = 'button';
        settingsButton.addEventListener('click', openSettings);
        toolbar.append(settingsButton);header.append(toolbar);
        const sheet = { el: shell, body: el('div', 'l2d-body') };
        shell.append(header, sheet.body);
        ctx.root.appendChild(shell);
        const operation = el('section','l2d-operation');
        operation.setAttribute('aria-label',t('导入与处理','Import and processing'));
        const operationBottom = el('div','l2d-operation-bottom');
        sheet.body.append(operation);
        const versionCorner = el('button', 'l2d-version-corner', '…');
        versionCorner.type = 'button';
        versionCorner.disabled = true;
        versionCorner.setAttribute('aria-haspopup', 'dialog');
        header.appendChild(versionCorner);
        function paintNotice() {
          if (disposed) return;
          const ack = notice?.acknowledged === true;
          versionCorner.textContent = version ? `v${version}` : '…';
          versionCorner.classList.toggle('unack', !ack);
          versionCorner.classList.toggle('ack', ack);
          versionCorner.title = ack ? t('查看须知', 'Read notice') : t('请阅读并确认须知', 'Read and acknowledge the notice');
          versionCorner.disabled = !notice || state.busy;
          noticeEntry.hidden = !ack;
          versionCorner.setAttribute('aria-label', `${versionCorner.textContent} · ${ack ? t('已确认', 'Acknowledged') : t('未确认', 'Not acknowledged')}`);
          if (noticeDialog) {
            noticeDialog.accept.hidden = ack;
            noticeDialog.accept.disabled = state.busy;
          }
        }
        versionCorner.addEventListener('click', () => openNotice());
        function ensureNotice(resume, needsCore = false) {
          if (notice?.acknowledged && (!needsCore || coreReady())) return true;
          openNotice(resume, needsCore);
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
        const installNow = el('button', 'l2d-btn primary', t('一键安装', 'Install now'));
        const skipCover = el('button', 'l2d-btn sm', t('跳过封面', 'Skip cover'));
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
        toolbar.prepend(chooseFolder, chooseZip);
        actions.append(pack, installNow);
        bar.append(dropZone, folderInput, zipInput);
        operation.append(bar,operationBottom);
        let staged = null;
        let currentCover = null;
        const completed = new Map();
        const installedSources = new Set();
        function stagedWorkflow(source) {
          const models = source?.models ?? [];
          const packs = source?.packs ?? [];
          const mode = assistState.enabled ? 'ai' : assistState.adaptationMode === 'manual' ? 'manual' : 'direct';
          return {mode, models, packs};
        }
        function paintImportButtons(count) {
          const {mode} = stagedWorkflow(staged);
          const direct = mode === 'direct';
          const request = mode === 'ai' && (assistState.submissions || []).find(r => r.token === staged?.token);
          pack.classList.toggle('primary', !direct);
          pack.disabled = state.busy || !count || completed.size === count;
          pack.textContent = request?.canRetry ? t('重新提交分析','Retry analysis') : mode === 'ai' ? t('提交 AI 适配','Submit to Coo') : mode === 'manual' ? t('预览并绑定','Preview & bind') : t('一键打包','Pack models');
          installNow.hidden = !direct;
          installNow.disabled = state.busy || !count || installedSources.size === count;
          if (request && !request.error && !request.canRetry) pack.disabled = true;
        }
        function paintSource() {
          const models = staged?.models ?? [];
          const packs = staged?.packs ?? [];
          const count = models.length + packs.length;
          const names = [...models.map(m => m.title), ...packs.map(p => (zh ? p.nameZh : p.nameEn) || p.id)];
          sourceTitle.textContent = count ? names.slice(0, 3).join('、') + (count > 3 ? t(` 等 ${count} 项`, ` and ${count - 3} more`) : '') : t('拖入模型或 ZIP', 'Drop a model folder or ZIP');
          sourceTitle.title = names.join('\n');
          sourceHint.textContent = count
            ? (stagedWorkflow(staged).mode === 'ai' ? t(`已识别 ${count} 项 · 在「进展与结果」查看 AI 适配`, `${count} recognized · see AI adaptation in Progress & results`) : installedSources.size === count ? t('已安装，可在 Coo 装扮中选择', 'Installed; choose in Coo Dress up') : completed.size === count ? t('已加入模型包列表，可编辑或安装', 'Added to packs; edit or install') : t(`已识别 ${count} 项，可以开始打包`, `${count} recognized; ready to pack`))
            : t('点击此区域后，按 Ctrl+V 粘贴文件或目录路径', 'Click here, then press Ctrl+V to paste files or a local path');
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
        const resultButton = el('button', 'l2d-btn sm l2d-result-entry', t('进展与结果', 'Progress & results'));
        resultButton.type = 'button';
        resultButton.setAttribute('aria-haspopup', 'dialog');
        const statusGroup = el('div', 'l2d-status-group');
        const coverSlot = el('span', 'l2d-cover-slot'); coverSlot.append(skipCover);
        statusGroup.append(status, coverSlot, resultButton);
        const actionRow = el('div', 'l2d-action-row');
        actionRow.append(statusGroup, actions); operationBottom.append(actionRow);
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
        const search = el('input', 'l2d-input l2d-search');
        search.type = 'search'; search.placeholder = t('搜索模型包', 'Search packs');
        search.setAttribute('aria-label', search.placeholder);
        const sort = el('select', 'l2d-input l2d-sort');
        sort.setAttribute('aria-label', t('排序', 'Sort'));
        for (const [value, label] of [['new', t('最近添加', 'Newest')], ['name', t('按名称', 'Name')]]) {
          const option = el('option', null, label); option.value = value; sort.append(option);
        }
        const clearAll = el('button', 'l2d-btn sm quiet', t('清空旧打包', 'Clear old packs'));
        head.append(libraryTitle, search, sort, clearAll);
        sheet.body.appendChild(head);
        const workspace = el('div', 'l2d-workspace');
        const assistDock = el('div', 'l2d-assist-dock');
        resultBody.append(assistDock);
        const grid = el('div', 'l2d-grid');
        grid.setAttribute('aria-label', t('模型包卡片', 'Pack cards'));
        workspace.append(grid); sheet.body.append(workspace);
        search.addEventListener('input', renderGrid);
        sort.addEventListener('change', renderGrid);

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
        resultButton.addEventListener('click', () => showPopup(t('进展与结果', 'Progress & results'), resultBody, {variant:'l2d-result-popup'}));
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
          flow.handle = showPopup(t('须知', 'Notice'), body, {
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
              isDisposed: () => disposed,
              onNotice: openNotice,
              onSaved: async () => {
                if (disposed) return;
                dialog?.dispose?.(); ui.toast(t('设置已保存', 'Settings saved'), 'ok');
                await refresh();
              },
            });
            dialog = showDialog(t('设置', 'Settings'), body);
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
            try { const value = await ctx.invoke('assistState', []); if (!disposed) {
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
            if(request.canRetry&&request.token===staged?.token){
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
                if(state.busy || method === 'assistApprove' && !ensureNotice(() => button.click()))return;
                setBusy(true,t('处理方案…','Processing proposal…'));
                try { await ctx.invoke(method,[plan.id]); await refresh(); }
                catch(error){reportResult(t('处理方案失败，可以重试。','Could not process the proposal. Try again.'),[text(error)],true);log.append(text(error),'bad');await refresh().catch(()=>{});}
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
        }

        function reportResult(heading, lines = [], bad = false) {
          resultFeedback.replaceChildren();
          if (heading) resultFeedback.append(el('strong', null, heading));
          for (const line of lines) if (line) resultFeedback.append(el('p', null, line));
          resultFeedback.classList.toggle('has-error', bad);
          resultButton.classList.toggle('has-error', bad);
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
          for (const input of modal?.querySelectorAll('button, input, textarea, select') ?? []) input.disabled = on;
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
          if (state.installed?.target) bits.push(t('已安装 ', 'Installed ') + state.installed.target.split(/[\\/]/).pop());
          else if (notice && !notice.acknowledged) bits.push(t('首次使用需确认须知','Read the notice before first use'));
          else if (notice && !coreReady()) bits.push(t('Live2D 核心待获取','Live2D core is missing'));
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

        function openCover(build, title) {
          const body = el('div', 'l2d-cover-preview');
          const image = el('img', 'l2d-large-cover'); image.src = build.thumb; image.alt = title;
          const hint = el('p', 'l2d-hint', t('正在读取封面…', 'Loading the cover…'));
          hint.setAttribute('role','status');
          body.append(image, hint);
          const handle = showPopup(title, body, {variant:'l2d-image-popup'});
          ctx.invoke('coverPreview', [build.id]).then(result => {
            if (!handle.el.open) return;
            if (result?.image) { image.src = result.image; hint.textContent = ''; }
            else hint.textContent = t('当前显示这份模型包的缩略图。', 'Showing this pack’s thumbnail.');
          }).catch(error => {
            if (handle.el.open) hint.textContent = t('大图读取失败，仍可查看缩略图。', 'Could not load the cover. The thumbnail is still shown. ') + text(error);
          });
        }

        function renderGrid() {
          grid.replaceChildren();
          countLabel.textContent = initialized ? String(state.builds.length) : '—';
          clearAll.disabled = state.busy || state.builds.length < 2;
          if (!initialized) {
            const empty = el('div', 'l2d-empty');
            empty.append(el('strong', null, startupFailed ? t('暂时无法读取模型包', 'Could not load packs') : t('正在读取模型包…', 'Loading packs…')));
            if (startupFailed) {
              const retry = el('button', 'l2d-btn', t('重新读取', 'Retry loading'));
              retry.type = 'button';
              retry.addEventListener('click', startWorkbench);
              empty.append(retry);
            }
            grid.append(empty);
            return;
          }
          if (!state.builds.length) {
            const empty = el('div', 'l2d-empty');
            empty.append(el('span', 'l2d-empty-mark', '◇'), el('strong', null, t('让一个新形象来到这里', 'Make room for a new figure')),
              el('p', null, t('从上方导入模型，打包后即可安装。', 'Import a model above, then pack and install it.')));
            grid.append(empty);
            return;
          }
          const installedId = state.installed?.buildId;
          const query = search.value.trim().toLocaleLowerCase();
          const builds = state.builds.filter(b => [b.id, b.nameZh, b.nameEn].some(value => String(value || '').toLocaleLowerCase().includes(query)));
          builds.sort((a, b) => sort.value === 'name' ? String(a.nameZh || a.nameEn || a.id).localeCompare(String(b.nameZh || b.nameEn || b.id), zh ? 'zh' : 'en') : b.at - a.at);
          if (!builds.length) grid.append(el('div', 'l2d-empty', t('没有匹配的模型包', 'No matching packs')));
          const kindLabels = new Map([['live2d', 'Live2D'], ['bongocat', 'BongoCat']]);
          for (const b of builds) {
            const card = el('article', 'l2d-card l2d-model-card' + (installedId === b.id ? ' installed' : '') + (editingId === b.id ? ' selected' : ''));
            card.dataset.id = b.id;
            const shown = (zh ? b.nameZh : b.nameEn) || b.nameZh || b.nameEn || b.id.replace(/(-\d{6,})+$/, '');
            if (b.thumb) {
              const preview = el('button','l2d-card-cover');
              preview.type = 'button';
              preview.setAttribute('aria-label', t(`查看 ${shown} 的封面`, `View cover for ${shown}`));
              preview.setAttribute('aria-haspopup','dialog');
              preview.addEventListener('click', () => openCover(b, shown));
              const img = doc.createElement('img');
              img.src = b.thumb;
              img.alt = ''; img.loading = 'lazy'; img.width = 160; img.height = 88;
              preview.append(img); card.append(preview);
            } else {
              card.appendChild(el('div', 'empty', t('无封面', 'no cover')));
            }
            const kindLabel = kindLabels.get(b.kind);
            if (kindLabel) card.append(el('span', 'l2d-card-kind', kindLabel));
            const info = el('div', 'l2d-card-info');
            const titleEl = el('button', 'title', shown);
            titleEl.addEventListener('click', () => { if (!state.busy) openEdit(b, card, titleEl); });
            titleEl.title = b.id;
            info.appendChild(titleEl);
            info.appendChild(el('div', 'meta',
              `${(b.bytes / 1048576).toFixed(1)} MB · ${clock(b.at)}`));
            if (installedId === b.id) info.appendChild(el('span', 'tagline', t('已安装', 'Installed')));
            card.appendChild(info);
            const adaptation = adaptationDetails(b.adaptation);
            if (adaptation) {
              const details = el('button', 'l2d-adaptation-link', adaptation.title);
              details.type = 'button';
              details.setAttribute('aria-haspopup', 'dialog');
              details.title = adaptation.title;
              details.addEventListener('click', () => showPopup(t('适配详情','Adaptation details'), adaptation.detail));
              info.append(details);
            }

            const install = el('button', 'l2d-btn sm l2d-install', t('安装', 'Install'));
            install.addEventListener('click', () => run('install', b.id));
            const cardActions = el('div', 'l2d-card-actions');
            cardActions.appendChild(install);

            const row = el('div', 'row');
            const edit = el('button', 'l2d-btn sm', t('编辑', 'Edit'));
            edit.addEventListener('click', () => { if (!state.busy) openEdit(b, card, edit); });
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
                forgetRemovedPacks();
                paint();
                log.append(t('已删除 ', 'Deleted ') + b.id, 'dim');
                ui.toast(t('已删除', 'Deleted'), 'ok');
              } catch (e) {
                ui.toast(text(e), 'bad');
              } finally { setBusy(false); }
            });
            del.classList.add('quiet');
            if(b.manualAvailable){const bind=el('button','l2d-btn sm l2d-card-binding',t('动作','Actions'));bind.addEventListener('click',()=>openBindings('manualOpenBuild',[b.id]));card.appendChild(bind);}
            row.append(edit, del);
            cardActions.appendChild(row);
            card.appendChild(cardActions);
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
            reportResult(`${label} ✓`, r.warn ? [r.warn] : []);
            for (const line of r.log ?? []) log.append(line, 'dim');
            log.append(`✓ ${label} · ${((performance.now() - startedAt) / 1000).toFixed(1)}s`, 'plain');
            ui.toast(`${label} ✓`, 'ok');
            if (r.warn) log.append('! ' + r.warn, 'warn');
            await refresh().catch(e => log.append(t('操作已完成，列表刷新失败：', 'Completed, but the list could not refresh: ') + text(e), 'warn'));
          } catch (e) {
            const s = text(e);
            say(t(`${label}失败 · 查看结果`, `${label} failed · See results`), true);
            reportResult(t(`${label}失败，可以重试。`, `${label} failed. Try again.`),[s],true);
            log.append(`✗ ${s}`, 'bad');
            ui.toast(`${label} ✗`, 'bad');
          } finally {
            setBusy(false);
          }
        }

        let bindingEditor = null;
        let bindingOpening = false;
        async function openBindings(method,args,onSaved) {
          if(state.busy || bindingOpening || bindingEditor || !ensureNotice(() => openBindings(method,args,onSaved)))return;
          bindingOpening=true;
          try{bindingEditor=await openBindingEditor(ctx,method,args,async result=>{onSaved?.(result);await refresh();},()=>{bindingEditor=null;});}
          catch(error){ui.toast(text(error),'bad');}
          finally{bindingOpening=false;if(bindingEditor?.closed)bindingEditor=null;}
        }
        // ---------------- 编辑弹层 ----------------
        let modal = null;
        let editReturnFocus = null;
        let editLoading = false;
        let editDirty = () => false;
        let cropEditor = null;

        function closeEdit() {
          if (state.busy) return;
          if (modal) {
            const previousId = editingId;
            cropEditor?.dispose(); cropEditor = null;
            modal.close(); modal.remove(); modal = null; editingId = null;
            const previous = [...grid.querySelectorAll('.l2d-card')].find(card => card.dataset.id === previousId);
            previous?.classList.remove('selected');
            (editReturnFocus?.isConnected ? editReturnFocus : previous?.querySelector('button.title'))?.focus({ preventScroll: true });
          }
        }

        async function openEdit(b, cardEl, trigger) {
          if (state.busy || editLoading) return;
          if (modal && editingId === b.id) { modal.querySelector('[role="tab"][aria-selected="true"], input')?.focus(); return; }
          editLoading = true;
          if (modal && editDirty()) {
            const discard = await ui.confirm({ title: t('放弃未保存的修改？', 'Discard unsaved edits?'), body: t('切换到另一份模型包。', 'Open the other pack.') });
            if (!discard || disposed || state.busy) { editLoading = false; return; }
          }
          editReturnFocus = trigger;
          const d = await ctx.invoke('detail', [b.id]).catch(() => null);
          editLoading = false;
          if (disposed || state.busy) return;
          if (!d) { ui.toast(t('读不到这份打包的信息', 'Cannot read this pack'), 'bad'); return; }
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
            save.disabled = true;
            setBusy(true, t('保存…', 'Saving…'));
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
              // 先就地更新卡片，再拉一次完整列表
              if (cardEl && name) {
                const titleEl = cardEl.querySelector('.title');
                if (titleEl) titleEl.textContent = name;
              }
              if (patch.nameZh !== undefined) b.nameZh = name;
              if (patch.nameEn !== undefined) b.nameEn = name;
              setBusy(false);
              closeEdit();
              ui.toast(t('已保存', 'Saved'), 'ok');
              log.append(t('编辑 · ', 'Edited · ') + b.id, 'dim');
              refresh().catch(() => {});
            } catch (e) {
              error.textContent = t('保存失败，可以重试。', 'Could not save. Try again. ') + text(e);
            } finally {
              save.disabled = false;
              if (editScroll) editScroll.inert = false;
              if (editTabs) editTabs.inert = false;
              setBusy(false);
            }
          });

          modal.appendChild(card);
          shell.appendChild(modal);
          modal.showModal();
          fields.name.focus({preventScroll:true});
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

        function modelEntryName(name) {
          const lower = name.toLowerCase();
          return lower === 'figure.json' || lower.endsWith('.model3.json');
        }

        /** Find model or pack roots before uploading a selected folder, up to three levels deep. */
        function packFiles(files, depth = 3) {
          const dirs = [...new Set(files
            .map((f) => f.path.split('/'))
            .filter((p) => {
              return p.length - 2 <= depth && modelEntryName(p[p.length - 1] || '');
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
          const inPack = depth === Infinity || list.some((e) => e.isFile && modelEntryName(e.name));
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
            staged = null; completed.clear(); installedSources.clear(); paintSource();
            sourceHint.textContent = [detail || title, t('可重新选择文件夹或 ZIP','Choose a folder or ZIP again')].join(' · ');
            sourceHint.title = detail || title;
            reportResult(title,[detail,t('可重新选择文件夹、ZIP，或粘贴模型路径。','Choose a folder or ZIP again, or paste the model path.')],Boolean(bad));
            dropZone.classList.toggle('bad', Boolean(bad));
          },
          result(result) {
            if (disposed) { cancelOwnedImport(result.token); return; }
            activeImportToken = result.token;
            staged = result; completed.clear(); installedSources.clear(); dropZone.classList.remove('bad');
            showAdaptation(null); paintSource();
            const count = (result.models?.length || 0) + (result.packs?.length || 0);
            const problems = (result.problems || []).map(p => p.reason).filter(Boolean);
            if (!count) {
              const reason = problems.join('；') || t('未找到 Live2D 模型或现成形象包', 'No Live2D model or figure pack found');
              sourceHint.textContent = reason; sourceHint.title = reason;
              reportResult(t('未找到可导入的模型，可重新选择。','No model could be imported. Choose again.'),[reason],true);
            } else {
              reportResult(t(`已识别 ${count} 项`, `${count} recognized`),problems);
              if (assistState.enabled) {
                void ctx.invoke('assistState', []).then(value => {
                  if (!disposed && staged === result && typeof value?.enabled === 'boolean') paintAutomation(value);
                }).catch(() => {});
              }
            }
          },
        };

        function clearSource() {
          staged = null; completed.clear(); installedSources.clear(); showAdaptation(null); paintSource();
          reportResult('');
          dropZone.classList.remove('bad');
        }

        async function stageZip(file) {
          if (state.busy || disposed) return;
          if (file.size > MAX_MB * 1048576) { importView.note(t('ZIP 太大', 'ZIP too large'), t('请解压后选择文件夹', 'Extract it and choose the folder'), true); return; }
          clearSource(); setBusy(true, t('读取 ZIP…', 'Reading ZIP…'));
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
          if (!picked.length) { view.note(t('这里没有模型包', 'No model pack here'), t('没有找到 Live2D 模型或现成形象包', 'No Live2D model or figure pack found'), false); return; }
          if (picked.length > 20000 || picked.reduce((n, f) => n + (Number(f.file.size) || 0), 0) > 512 * 1048576) { view.note(t('目录过大', 'Folder too large'), t('请改用粘贴本机目录路径', 'Paste its local directory path instead'), true); return; }
          clearSource(); setBusy(true, t('读取文件夹…', 'Reading folder…'));
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
          setBusy(true, t('读取…', 'Reading…'));
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
              reportResult(result.queued===false?t('已提交，请等待 Coo 的方案','Already submitted; wait for Coo'):t('已交给 Coo 分析','Sent to Coo for analysis'));
              await refresh().catch(error=>log.append(text(error),'warn'));
            } catch (error) {
              reportResult(t('提交失败，可以重新提交。','Submission failed. Try again.'),[text(error)],true);
              log.append(text(error),'bad'); await refresh().catch(()=>{});
            }
            finally{setBusy(false);}return;
          }
          if (mode === 'manual' && models.length) {
            const next = newModels[0];
            if(next) { await openBindings('manualOpen',[staged.token,next.dir],result=>{completed.set('importBuild:'+next.dir,result.buildId);}); return; }
          }
          const pending = [
            ...models.map(item => ({ ...item, method: 'importBuild' })),
            ...packs.map(item => ({ ...item, method: 'importKeep' })),
          ];
          const token = source.token;
          setBusy(true, installAfterBuild ? t('打包并安装…', 'Packing and installing…') : t('打包…', 'Packing…'));
          const failures = [];
          const warnings = [];
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
          if (disposed) { cancelOwnedImport(token); return; }
          sourceHint.textContent = failures.length
            ? t(`${failures.length} 项失败；再次点击只重试未完成项，原因见结果`, `${failures.length} failed; click again to retry unfinished items; see results`)
            : deferred ? t(`${deferred} 项已打包，等待确认替换`, `${deferred} packed; awaiting replacement approval`)
            : installAfterBuild ? t('已安装，可在 Coo 装扮中选择', 'Installed; choose in Coo Dress up')
            : t('已加入模型包列表，可编辑或安装', 'Added to packs; edit or install');
          sourceHint.title = sourceHint.textContent;
          dropZone.classList.toggle('bad', failures.length > 0);
          const done = installAfterBuild ? t('安装完成', 'Installation complete') : t('打包完成', 'Packing complete');
          reportResult(failures.length || deferred ? sourceHint.textContent : done, [...failures,...warnings], failures.length > 0);
        }

        function accessibleModal(node, title) {
          node.setAttribute('role', 'dialog');
          node.setAttribute('aria-modal', 'true');
          node.setAttribute('aria-label', title);
          node.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { e.preventDefault(); closeEdit(); }
          });
          node.addEventListener('cancel', (e) => { e.preventDefault(); closeEdit(); });
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
        pack.addEventListener('click', () => buildSources());
        installNow.addEventListener('click', () => buildSources(true));
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
              setBusy(true, t('读取剪贴板…', 'Reading clipboard…'));
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
          setBusy(true, t('读取拖入内容…', 'Reading dropped files…'));
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
            forgetRemovedPacks();
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
            const [coreState, initial, cfg] = await Promise.all([
              ctx.invoke('core', []), ctx.invoke('state', []), ctx.invoke('settings', []),
            ]);
            if (disposed) return;
            await refresh();
            if (disposed) return;
            core = coreState;
            currentAppearance = normalizeAppearance(cfg);
            applyAppearance(ctx.root, cfg);
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
          if (startupTimer?.dispose) startupTimer.dispose();
          else if (startupTimer != null) win.clearTimeout(startupTimer);
          stopTicker();
          stopResume();
          assistTimer?.dispose?.();
          bindingEditor?.dispose?.();
          cropEditor?.dispose(); cropEditor = null;
          modal?.close(); modal?.remove();
          popup?.dispose(); overlay?.dispose?.();
          observer?.disconnect(); win.removeEventListener('resize', resize);
          shell.remove();
          cancelOwnedImport();
          ctx.root.removeAttribute('aria-busy');
          restoreAppearance();
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
