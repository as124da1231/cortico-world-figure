function voiceView(ctx) {
  const doc = ctx.root.ownerDocument;
  const zh = String(ctx.language || 'zh').toLowerCase().startsWith('zh');
  const t = (a, b) => zh ? a : b;
  const el = (tag, cls, text) => {
    const node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };
  const button = (label, style = '') => {
    const tokens = style.split(' ');
    const node = figureControlButton(ctx, label, {
      size: tokens.includes('sm') ? 'sm' : 'md',
      variant: tokens.find(token => token === 'primary' || token === 'danger'),
    });
    node.classList.add(...tokens.filter(token => token && !['sm','primary','danger'].includes(token)));
    return node;
  };
  return { doc, t, el, button };
}

async function reloadFigurePrefix(ctx) {
  const doc = ctx.root.ownerDocument;
  const win = doc.defaultView;
  if (!win?.fetch) throw Error('Prefix refresh unavailable');
  // Cortico applies this at the next safe session boundary and keeps history.
  const response = await win.fetch(new URL('/api/session/reload-prefix', doc.baseURI), {
    method:'POST', credentials:'same-origin',
    headers:{'x-cortico-language':ctx.language || 'zh'},
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw Error('Prefix refresh unavailable');
}

async function refreshVoiceTool(ctx, before, after) {
  if (typeof before?.syncToolReady !== 'boolean' || before.syncToolReady === after?.syncToolReady) return;
  if (!ctx.root.ownerDocument.defaultView?.fetch) return;
  const {t} = voiceView(ctx);
  try {
    await reloadFigurePrefix(ctx);
  } catch {
    if (!ctx.signal?.aborted) ctx.ui.toast(t('设置已保存，可从 Coo 页头重载前缀以更新语音工具。', 'Saved. Reload the prefix from Coo’s page header to update the speech tool.'), 'bad');
  } finally {
    if (!ctx.signal?.aborted) await ctx.refresh?.().catch(() => {});
  }
}

const speechProviders = {
  async mount(ctx) {
    const state = await ctx.invoke('voiceState', []);
    if (ctx.signal?.aborted) return;
    const { doc, t, el, button } = voiceView(ctx);
    const page = el('section', 'l2d-config-page l2d-voice-page');
    holdFigurePanelPaint(page);
    const services = el('section', 'l2d-voice-services');
    const header = el('header', 'l2d-voice-services-head');
    const title = el('h2', null, t('语音服务', 'Speech services'));
    const count = el('span', 'l2d-voice-count');
    const add = button(t('添加语音服务', 'Add speech service'), 'sm');
    add.setAttribute('aria-haspopup', 'dialog');
    add.onclick = () => openService();
    title.append(count);
    header.append(title, add);
    const grid = el('div', 'l2d-voice-service-grid');
    grid.setAttribute('role', 'region');
    grid.setAttribute('aria-label', t('已保存的语音服务', 'Saved speech services'));
    const audition = el('div', 'l2d-voice-audition');
    audition.setAttribute('aria-label', t('播放控制', 'Playback controls'));
    const transport = el('div', 'l2d-voice-transport');
    const feedback = el('div', 'l2d-voice-feedback');
    audition.append(feedback, transport);
    services.append(header, audition, grid);
    const sound = el('section', 'l2d-voice-controls');
    page.append(services, sound);
    ctx.root.append(page);
    const soundControls = mountVoiceControls(ctx, sound, transport, feedback, state);
    let snapshot = state, modal, switching = false, disposed = false;

    function paint() {
      grid.replaceChildren();
      count.textContent = snapshot.services.length ? String(snapshot.services.length) : '';
      if (!snapshot.services.length) {
        grid.append(el('p', 'l2d-voice-empty', t('添加一个服务，即可试听并朗读桌宠回复。', 'Add a service to preview and read desktop pet replies.')));
      }
      for (const service of snapshot.services) {
        const provider = VOICE_PROVIDERS[service.provider].name;
        const name = service.name || provider;
        const active = snapshot.selectedId === service.id;
        const item = el('article', 'l2d-voice-service' + (active ? ' is-current' : ''));
        item.dataset.serviceId = service.id;
        const identity = el('div', 'l2d-voice-service-identity');
        const model = [service.name && provider, service.profile.model || service.profile.version].filter(Boolean).join(' · ');
        const voice = service.profile.voice || (service.provider === 'sovitsLocal'
          ? t('使用插件当前音色', 'Use the plugin’s current voice') : '');
        identity.append(el('h3', null, name));
        if (model || voice) {
          const details = el('p', null, [model, voice].filter(Boolean).join(' · '));
          details.title = details.textContent;
          item.setAttribute('aria-label', name + ' · ' + details.textContent);
          identity.append(details);
        }
        const actions = el('div', 'l2d-voice-service-actions');
        const edit = button(t('配置', 'Configure'), 'quiet sm');
        edit.setAttribute('aria-label', t('配置 ', 'Configure ') + name);
        edit.setAttribute('aria-haspopup', 'dialog');
        edit.addEventListener('click', () => openService(service.id));
        if (active || !service.ready) {
          actions.append(el('span', 'l2d-voice-service-state', !service.ready
            ? t('待配置', 'Incomplete') : t('当前使用', 'Selected')));
        } else {
          const use = button(t('使用', 'Use'), 'sm');
          use.setAttribute('aria-label', t('使用 ', 'Use ') + name);
          use.onclick = () => void activate(service, item);
          actions.append(use);
        }
        actions.append(edit);
        item.append(identity, actions);
        grid.append(item);
      }
    }

    function focusService(id) {
      const card = [...grid.children].find(item => item.dataset.serviceId === id);
      (card?.querySelector('.quiet') || add).focus({preventScroll:true});
    }

    async function activate(service, item) {
      if (switching || modal || disposed) return;
      switching = true;
      const buttons = [add, ...grid.querySelectorAll('button')];
      buttons.forEach(control => { control.disabled = true; });
      soundControls.message(t('正在切换服务…', 'Switching service…'));
      try {
        const next = await ctx.invoke('voiceSave', [service.id, service.provider, service.name || '', service.profile, '', true]);
        if (disposed) return;
        snapshot = next;
        paint();
        soundControls.update(snapshot);
        focusService(service.id);
      } catch (error) {
        if (disposed) return;
        soundControls.message(String(error?.message || error), true);
        const button = item.querySelector('button:not(.quiet)');
        if (button) { button.disabled = false; button.focus({preventScroll:true}); }
      } finally {
        switching = false;
        buttons.forEach(control => { control.disabled = false; });
      }
    }
    paint();

    function openService(id = null) {
      if (modal || switching) return;
      const details = snapshot.services.find(service => service.id === id);
      const form = el('form', 'l2d-dialog-body l2d-voice-edit');
      const content = el('div', 'l2d-voice-edit-content');
      const fields = el('div', 'l2d-voice-fields');
      const help = el('p', 'l2d-voice-hint');
      const extra = el('details', 'l2d-voice-advanced');
      const advanced = el('div', 'l2d-voice-fields');
      extra.append(el('summary', null, t('更多服务参数', 'More service parameters')), advanced);
      const inputs = new Map();
      const english = {
        endpoint: 'Endpoint', model: 'Model', voice: 'Voice / character ID', region: 'Region',
        groupId: 'Group ID', speed: 'Speed', rate: 'Rate (%)', pitch: 'Pitch', volume: 'Volume',
        instructions: 'Reading style', style: 'Style', dialect: 'Dialect', seedText: 'Reference text',
        role: 'Role', appId: 'Application ID', cluster: 'Cluster', stability: 'Stability',
        similarity: 'Similarity', reference: 'Reference audio path', prompt: 'Reference text',
        promptLang: 'Reference language', language: 'Language', version: 'API version',
        emotion: 'Emotion', modelDir: 'ONNX model folder',
      };
      function field(label, type) {
        const row = el('label', 'l2d-field');
        const input = el('input', 'l2d-input');
        input.type = type;
        row.append(el('span', 'l2d-label', label), input);
        return { row, input };
      }
      const providerRow = el('label', 'l2d-field');
      const provider = el('select', 'l2d-input');
      provider.name = 'provider';
      provider.required = true;
      const placeholder = el('option', null, t('选择提供商', 'Select a provider'));
      placeholder.value = '';
      placeholder.disabled = true;
      provider.append(placeholder);
      for (const [value, spec] of Object.entries(VOICE_PROVIDERS)) {
        const option = el('option', null, spec.name);
        option.value = value;
        provider.append(option);
      }
      provider.value = details?.provider || '';
      providerRow.append(el('span', 'l2d-label', t('提供商', 'Provider')), provider);
      const name = field(t('服务名称（选填）', 'Service name (optional)'), 'text');
      name.input.name = 'name';
      name.input.maxLength = 80;
      name.input.value = details?.name || '';
      name.input.placeholder = t('如日常朗读', 'For example, Daily narration');
      content.append(providerRow, name.row, fields, help, extra);
      let key;
      function renderProviderFields() {
        const spec = VOICE_PROVIDERS[provider.value];
        const profile = details?.profile || {};
        if (key) key.value = '';
        key = undefined;
        inputs.clear();
        fields.replaceChildren();
        advanced.replaceChildren();
        extra.open = false;
        for (const setting of spec?.fields || []) {
          const { row, input } = field(t(setting.label, english[setting.key] || setting.label), setting.type || (setting.url ? 'url' : 'text'));
          input.name = setting.key;
          if (setting.type === 'number') {
            input.min = String(setting.min);
            input.max = String(setting.max);
            input.step = 'any';
            input.required = true;
          } else {
            input.maxLength = 2048;
            input.spellcheck = false;
          }
          input.value = String(profile[setting.key] ?? setting.value);
          inputs.set(setting.key, input);
          (setting.primary || (setting.required && setting.type !== 'number') ? fields : advanced).append(row);
        }
        if (spec?.auth) {
          const fieldKey = field(t('API 密钥', 'API key'), 'password');
          key = fieldKey.input;
          key.autocomplete = 'new-password';
          key.maxLength = 4096;
          const keyNote = el('small', 'l2d-voice-hint');
          fieldKey.row.append(keyNote);
          fields.append(fieldKey.row);
          const address = inputs.get('endpoint') || inputs.get('region');
          const origin = value => {
            try { return new URL(value).origin; } catch { return ''; }
          };
          const describeKey = () => {
            const same = address?.name === 'endpoint' ? origin(address.value) === origin(profile.endpoint)
              : address?.name === 'region' ? address.value.trim() === profile.region : true;
            keyNote.textContent = same && details?.hasKey
              ? t('已保存此服务地址的密钥。留空继续使用。', 'A key is saved for this service address. Leave blank to keep it.')
              : t('密钥保存在 Coo 的凭据区。', 'Keys are stored in Coo’s credential store.');
          };
          describeKey();
          address?.addEventListener('input', describeKey);
        }
        fields.hidden = !fields.childElementCount;
        help.textContent = t(spec?.help || '', spec?.helpEn || '');
        help.hidden = !help.textContent;
        extra.hidden = !advanced.childElementCount;
      }
      const status = el('p', 'l2d-voice-message');
      status.setAttribute('role', 'status');
      const footer = el('div', 'l2d-voice-edit-footer');
      const actions = el('div', 'l2d-dialog-actions l2d-voice-actions');
      const confirmation = el('div', 'l2d-dialog-actions l2d-voice-actions');
      const returnToEdit = button(t('返回编辑', 'Back to editor'));
      const confirmRemove = button(t('确认删除', 'Delete service'), 'danger');
      confirmation.append(returnToEdit, confirmRemove);
      confirmation.hidden = true;
      const remove = button(t('删除服务', 'Remove service'), 'quiet danger');
      remove.hidden = !details;
      const sample = button(t('试听', 'Test voice'));
      const cancel = button(t('取消', 'Cancel'), 'quiet');
      const save = button(t('保存', 'Save'));
      const use = button(t('保存并使用', 'Save and select'), 'primary');
      save.hidden = snapshot.selectedId === id;
      actions.append(remove, sample, cancel, save, use);
      footer.append(status, actions, confirmation);
      form.append(content, footer);

      const win = doc.defaultView;
      const createId = id === null ? win.crypto?.randomUUID?.() : undefined;
      let closed = false, saving = false, testing = false, changed = false, removing = false, player;
      form.addEventListener('input', () => { changed = true; });
      const guard = ctx.guardLeave?.(() => !closed && (saving || changed)
        ? t('语音服务配置尚未保存，确定离开？', 'Speech settings are unsaved. Leave anyway?') : null);
      const draft = () => Object.fromEntries([...inputs].map(([field, input]) =>
        [field, input.type === 'number' ? input.valueAsNumber : input.value]));
      const lock = () => {
        sample.disabled = !provider.value || testing || saving || removing;
        save.disabled = use.disabled = !provider.value || saving || removing;
        cancel.disabled = saving;
        remove.disabled = testing || saving;
        returnToEdit.disabled = confirmRemove.disabled = saving;
        provider.disabled = Boolean(details) || saving || removing || testing;
        for (const input of form.querySelectorAll('input')) input.disabled = saving || removing;
        form.setAttribute('aria-busy', String(testing || saving));
      };
      const message = (value, error = false) => {
        status.textContent = value;
        status.classList.toggle('bad', error);
      };
      const closePlayer = () => {
        void player?.close().catch(() => {});
        player = undefined;
      };
      form.addEventListener('invalid', event => {
        if (advanced.contains(event.target)) extra.open = true;
      }, true);
      provider.addEventListener('change', () => {
        changed = true;
        renderProviderFields();
        message('');
        lock();
      });
      renderProviderFields();
      lock();
      sample.onclick = async () => {
        if (!provider.value || !form.reportValidity() || testing || saving || removing) return;
        testing = true;
        lock();
        message(t('正在合成试听语音…', 'Generating a voice sample…'));
        closePlayer();
        try {
          const playback = player = new win.AudioContext();
          const resumed = playback.resume();
          const bytes = ctx.invokeBinary('voiceTest', [id, provider.value, draft(), key?.value || '']).then(blob => blob.arrayBuffer());
          const [, audio] = await Promise.all([resumed, bytes]);
          if (closed || player !== playback) return;
          const clip = await playback.decodeAudioData(audio);
          if (closed || player !== playback) return;
          const source = playback.createBufferSource();
          source.buffer = clip;
          source.connect(playback.destination);
          source.onended = () => { if (player === playback) closePlayer(); };
          source.start();
          message(t('试听语音已播放', 'Voice sample started'));
        } catch (error) {
          closePlayer();
          if (!closed) message(String(error?.message || error), true);
        } finally {
          testing = false;
          if (!closed) lock();
        }
      };
      async function persist(select) {
        if (!provider.value || !form.reportValidity() || saving || removing) return;
        const values = [id, provider.value, name.input.value.trim(), draft(), key?.value || '', select];
        if (createId) values.push(createId);
        saving = true;
        lock();
        message(t('正在保存…', 'Saving…'));
        try {
          snapshot = await ctx.invoke('voiceSave', values);
          if (closed) return;
          changed = false;
          if (key) key.value = '';
          paint();
          soundControls.update(snapshot);
          modal.dispose();
          focusService(id);
        } catch (error) {
          if (!closed) message(String(error?.message || error), true);
        } finally {
          saving = false;
          if (!closed) lock();
        }
      }
      cancel.onclick = () => modal.dispose();
      save.onclick = () => void persist(false);
      use.onclick = () => void persist(true);
      form.onsubmit = event => { event.preventDefault(); void persist(true); };
      function confirmDeletion(on) {
        removing = on;
        actions.hidden = on;
        confirmation.hidden = !on;
        message(!on ? '' : snapshot.selectedId === id && soundControls.narrationEnabled()
          ? t('删除当前服务并关闭朗读？', 'Remove the active service and turn off narration?')
          : t('删除这项语音服务？', 'Remove this speech service?'));
        lock();
        (on ? returnToEdit : remove).focus();
      }
      remove.onclick = () => confirmDeletion(true);
      returnToEdit.onclick = () => confirmDeletion(false);
      confirmRemove.onclick = async () => {
        if (saving || !id) return;
        const position = snapshot.services.findIndex(service => service.id === id);
        saving = true;
        lock();
        message(t('正在删除…', 'Removing…'));
        try {
          snapshot = await ctx.invoke('voiceRemove', [id]);
          if (closed) return;
          changed = false;
          paint();
          soundControls.update(snapshot);
          modal.dispose();
          focusService((snapshot.services[position] ?? snapshot.services.at(-1))?.id);
        } catch (error) {
          if (!closed) message(String(error?.message || error), true);
        } finally {
          saving = false;
          if (!closed) lock();
        }
      };
      modal = openFigureDialog(page, details ? t('编辑语音服务', 'Edit speech service') : t('添加语音服务', 'Add speech service'), form, {
        closeLabel: t('关闭', 'Close'), variant: 'l2d-voice-popup', locked: () => saving,
        onClose() {
          closed = true;
          closePlayer();
          if (key) key.value = '';
          guard?.dispose();
          modal = undefined;
        },
      });
      (details ? name.input : provider).focus({preventScroll:true});
    }
    return { dispose() {
      if (disposed) return;
      disposed = true;
      modal?.dispose();
      soundControls.dispose();
      page.remove();
    } };
  },
};

function mountVoiceControls(ctx, section, transport, feedback, initial) {
  const { t, el, button } = voiceView(ctx);
  let snapshot = initial;
  let disposed = false, saving = false, testing = false, testSent = false, request = 0;
  let speaking = initial?.speaking === true, stopping = false, pollPending = false;
  let inFlight = {}, saveFailed = false;
  let serviceRevision = 0;
  let prefixRefresh = Promise.resolve();
  const updateTool = (before, after) => {
    if (before?.syncToolReady !== after?.syncToolReady) {
      prefixRefresh = prefixRefresh.then(() => refreshVoiceTool(ctx, before, after)).catch(() => {});
    }
  };
  const pending = {};
  const inputs = new Map();
  const narration = el('section', 'l2d-voice-control-group');
  const mouth = el('section', 'l2d-voice-control-group');
  narration.append(el('h3', null, t('朗读', 'Narration')));
  mouth.append(el('h3', null, t('口型', 'Lip sync')));
  const status = el('span', 'l2d-voice-message');
  status.setAttribute('role', 'status');
  const controls = [
    ['voiceEnabled', t('朗读桌宠回复', 'Read desktop pet replies'), ''],
    ['voiceTiming', t('朗读时机', 'Narration timing'), t('同步档等到首声再显示气泡。', 'Sync waits for audio to start before showing the bubble.')],
    ['voiceVolume', t('播放音量', 'Playback volume'), '', { min: 0, max: 1, step: .01 }],
    ['voiceLipSync', t('口型跟随音频', 'Audio-driven lip sync'), t('关闭时使用原有的气泡口型', 'Turn off to use the existing bubble timing')],
    ['voiceMouthGain', t('张嘴幅度', 'Mouth opening gain'), t('调高后，轻声时张嘴更明显。', 'Higher values make quiet speech more expressive.'), MOUTH_GAIN],
  ];
  for (const [key, label, hint, range] of controls) {
    const row = el('label', 'l2d-setting-row');
    const text = el('span', 'l2d-setting-label');
    const description = el('small', null, hint);
    description.hidden = !hint;
    text.append(el('span', null, label), description);
    const timing = key === 'voiceTiming';
    const input = timing ? el('select', 'l2d-input') : el('input', range ? 'l2d-range' : 'l2d-switch');
    if (!timing) input.type = range ? 'range' : 'checkbox';
    input.disabled = true;
    input.setAttribute('aria-label', label);
    let output;
    if (timing) {
      const fast = el('option', null, t('快速播报', 'Fast narration'));
      const sync = el('option', null, t('跟气泡一起开始', 'Start with the bubble'));
      fast.value = 'fast';
      sync.value = 'sync';
      input.append(fast, sync);
      row.append(text, input);
    } else if (range) {
      Object.assign(input, { min: range.min, max: range.max, step: range.step });
      const slider = el('span', 'l2d-voice-slider');
      output = el('output', 'l2d-out');
      output.setAttribute('aria-hidden', 'true');
      slider.append(input, output);
      row.append(text, slider);
    } else {
      input.setAttribute('role', 'switch');
      row.append(text, input);
    }
    inputs.set(key, { input, output, description, hint });
    input.addEventListener('input', () => paintSlider(key));
    input.addEventListener('change', () => {
      if (input.disabled || timing && input.value === 'sync' && snapshot?.timingReady !== true) return;
      pending[key] = timing ? input.value : range ? input.valueAsNumber : input.checked;
      void save();
    });
    (['voiceLipSync', 'voiceMouthGain'].includes(key) ? mouth : narration).append(row);
  }
  const sample = button(t('在桌宠试听', 'Test on desktop pet'), 'primary');
  const retry = button(t('重试保存', 'Retry saving'), 'quiet');
  const retryRegion = el('div');
  retryRegion.hidden = true;
  retryRegion.append(retry);
  retry.onclick = () => void save();
  sample.classList.add('l2d-voice-playback');
  transport.append(sample);
  feedback.append(status, retryRegion);
  section.append(narration, mouth);
  function paintSlider(key) {
    const { input, output } = inputs.get(key);
    if (!output) return;
    const label = key === 'voiceMouthGain' ? Number(input.value).toFixed(1) + '×'
      : Math.round(Number(input.value) * 100) + '%';
    output.value = label;
    input.setAttribute('aria-valuetext', label);
  }
  function paintTiming(value) {
    const { input, description, hint } = inputs.get('voiceTiming');
    const ready = snapshot?.timingReady === true;
    input.value = value;
    input.options[1].disabled = !ready;
    description.textContent = ready ? hint : value === 'sync'
      ? t('当前设备使用快速播报，同步设置会保留。', 'This device uses fast narration and keeps your sync preference.')
      : t('当前设备支持快速播报，暂无法对齐气泡起点。', 'Fast narration is available on this device. Bubble timing sync is unavailable.');
  }
  function controlValue(key) {
    return pending[key] ?? inFlight[key] ?? snapshot?.controls[key] ?? VOICE_CONTROLS[key];
  }
  function paint() {
    if (disposed) return;
    for (const [key, { input, output }] of inputs) {
      const value = controlValue(key);
      if (key === 'voiceTiming') paintTiming(value);
      else if (output) { input.value = String(value); paintSlider(key); }
      else input.checked = value;
      input.disabled = !snapshot || key === 'voiceEnabled' && !snapshot.selectedId && !value;
    }
    paintPlayback();
    retryRegion.hidden = !saveFailed;
    retry.disabled = saving;
  }
  function playbackMode() {
    return testing || testSent ? 'sample' : speaking ? 'narration' : 'idle';
  }
  function paintPlayback() {
    if (disposed) return;
    const mode = playbackMode();
    const selected = snapshot?.services.find(service => service.id === snapshot.selectedId);
    const label = mode === 'sample' ? t('停止试听', 'Stop sample')
      : mode === 'narration' ? t('停止朗读', 'Stop narration') : t('在桌宠试听', 'Test on desktop pet');
    if (sample.textContent !== label) sample.textContent = label;
    sample.disabled = stopping || mode === 'idle' && (!selected?.ready || !(snapshot?.playbackReady ?? snapshot?.bodyReady));
    sample.classList.toggle('primary', mode === 'idle' && !sample.disabled);
  }
  function message(value, bad = false) {
    if (disposed) return;
    status.textContent = value;
    status.classList.toggle('bad', bad);
  }
  function hint() {
    if (!snapshot?.selectedId) return snapshot?.services.length
      ? t('选择要用于朗读的服务。', 'Choose a service for narration.')
      : '';
    if (snapshot.services.find(service => service.id === snapshot.selectedId)?.ready === false) {
      return t('当前服务的配置还未完成。', 'Complete the current service settings.');
    }
    if (!(snapshot.playbackReady ?? snapshot.bodyReady)) return t('请切换到支持语音的 Figure 形象。已有打包卡片可以重新安装。',
      'Switch to a supported Figure. Reinstall from its pack card to refresh an older runtime.');
    return snapshot.message || (!snapshot.bodyReady
      ? t('当前可播放语音。流式口型需要已更新的 Figure 形象。', 'Voice playback is available. Streaming lip sync needs an updated Figure.')
      : '');
  }
  async function save() {
    if (disposed || saving || !Object.keys(pending).length) return;
    saving = true;
    const patch = inFlight = { ...pending };
    for (const key of Object.keys(patch)) delete pending[key];
    paint();
    message(t('正在保存…', 'Saving…'));
    try {
      let revision = serviceRevision;
      let result = await ctx.invoke('voiceControls', [patch]);
      if (!disposed && revision !== serviceRevision) {
        revision = serviceRevision;
        result = await ctx.invoke('voiceState', []).catch(() => undefined);
      }
      if (!disposed && result && revision === serviceRevision) {
        const previous = snapshot;
        snapshot = result;
        updateTool(previous, snapshot);
      }
      saveFailed = false;
      message(hint() || t('已保存', 'Saved'));
    } catch (error) {
      // Keep the failed edits unless a newer edit already superseded a value.
      for (const [key, value] of Object.entries(patch)) {
        if (!Object.hasOwn(pending, key)) pending[key] = value;
      }
      saveFailed = true;
      message(String(error?.message || error), true);
    } finally {
      saving = false;
      inFlight = {};
      paint();
      if (!saveFailed) void save();
    }
  }
  async function refreshPlayback() {
    if (disposed || pollPending || testing || stopping || !snapshot?.selectedId) return;
    pollPending = true;
    const id = request;
    const revision = serviceRevision;
    try {
      const current = await ctx.invoke('voiceState', []);
      if (disposed || id !== request || revision !== serviceRevision || current.selectedId !== snapshot.selectedId) return;
      const previous = snapshot;
      const previousHint = hint();
      const { bodyReady, playbackReady, timingReady, message: playbackMessage } = current;
      snapshot = { ...snapshot, bodyReady, playbackReady, timingReady, message: playbackMessage };
      if (previous.timingReady !== timingReady) paintTiming(controlValue('voiceTiming'));
      speaking = current.speaking === true;
      if (testSent && !speaking) {
        testSent = false;
        message(current.message || t('试听已结束', 'Sample finished'));
      } else if (playbackMode() === 'idle' && !saving && !status.classList.contains('bad') && previousHint !== hint()) {
        message(hint());
      }
      paintPlayback();
    } catch {
      // The next refresh can recover a temporary unavailable status.
    } finally {
      pollPending = false;
    }
  }
  sample.onclick = async () => {
    const mode = playbackMode();
    const id = ++request;
    if (mode !== 'idle') {
      stopping = true;
      paintPlayback();
      try {
        await ctx.invoke(mode === 'sample' ? 'voiceStop' : 'voiceHush', []);
        if (disposed || id !== request) return;
        testing = testSent = speaking = false;
        message(mode === 'sample' ? t('试听已停止', 'Sample stopped') : t('朗读已停止', 'Narration stopped'));
      } catch (error) {
        if (id === request) {
          testing = false;
          message(String(error?.message || error), true);
        }
      } finally {
        if (id === request) {
          stopping = false;
          paintPlayback();
          void refreshPlayback();
        }
      }
      return;
    }
    testing = true;
    paintPlayback();
    message(t('正在准备桌宠试听…', 'Preparing the desktop sample…'));
    try {
      const result = await ctx.invoke('voiceAudition', []);
      if (id !== request || disposed) return;
      if (result?.ok === false) {
        message(t('试听已取消', 'Sample cancelled'));
        return;
      }
      testSent = true;
      message(t('已将试听送到桌宠', 'Sample sent to the desktop pet'));
    } catch (error) {
      if (id === request) message(String(error?.message || error), true);
    } finally {
      if (id === request) {
        testing = false;
        paintPlayback();
        if (testSent) void refreshPlayback();
      }
    }
  };
  const playbackPoll = ctx.interval?.(() => void refreshPlayback(), 900);
  paint();
  message(hint());
  const guard = ctx.guardLeave?.(() => !disposed && (saving || Object.keys(pending).length)
    ? t('语音设置尚未保存，确定离开？', 'Voice settings are unsaved. Leave anyway?') : null);
  return {
    message,
    narrationEnabled: () => snapshot?.controls.voiceEnabled,
    update(result) {
      const previous = snapshot;
      serviceRevision++;
      snapshot = result;
      if (previous?.selectedId !== result.selectedId) {
        request++;
        testing = testSent = stopping = false;
        speaking = result.speaking === true;
      }
      paint();
      if (!saving && !saveFailed) message(hint());
      updateTool(previous, snapshot);
    },
    dispose() { disposed = true; playbackPoll?.dispose(); guard?.dispose(); },
  };
}
