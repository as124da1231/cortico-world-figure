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
    const node = el('button', ('l2d-btn ' + style).trim(), label);
    node.type = 'button';
    return node;
  };
  return { doc, t, el, button };
}

async function refreshVoiceTool(ctx, before, after) {
  if (typeof before?.syncToolReady !== 'boolean' || before.syncToolReady === after?.syncToolReady) return;
  const doc = ctx.root.ownerDocument;
  const win = doc.defaultView;
  if (!win?.fetch) return;
  const {t} = voiceView(ctx);
  try {
    // Cortico applies this at the next safe session boundary and keeps history.
    const response = await win.fetch(new URL('/api/session/reload-prefix', doc.baseURI), {
      method:'POST', credentials:'same-origin',
      headers:{'x-cortico-language':ctx.language || 'zh'},
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw Error('Prefix refresh unavailable');
  } catch {
    if (!ctx.signal?.aborted) ctx.ui.toast(t('设置已保存，可从 Coo 页头重载前缀以更新语音工具。', 'Saved. Reload the prefix from Coo’s page header to update the speech tool.'), 'bad');
  } finally {
    if (!ctx.signal?.aborted) await ctx.refresh?.().catch(() => {});
  }
}

const speechProviders = {
  async mount(ctx) {
    const [state, cfg] = await Promise.all([
      ctx.invoke('voiceState', []), ctx.invoke('settings', []),
    ]);
    if (ctx.signal?.aborted) return;
    const { doc, t, el, button } = voiceView(ctx);
    const restore = ownAppearance(ctx.root);
    applyAppearance(ctx.root, cfg);
    const page = el('section', 'l2d-config-page l2d-voice-page');
    const intro = el('div', 'l2d-voice-intro');
    const heading = el('div');
    heading.append(el('h3', null, t('语音服务', 'Speech services')),
      el('p', null, t('点击服务卡片编辑模型、音色和连接设置。', 'Open a service card to edit its model, voice and connection settings.')));
    const add = button(t('添加语音服务', 'Add speech service'), 'primary l2d-voice-add');
    const plus = el('span', 'l2d-voice-add-icon');
    plus.setAttribute('aria-hidden', 'true');
    add.prepend(plus);
    add.setAttribute('aria-haspopup', 'dialog');
    add.addEventListener('click', () => openService());
    intro.append(heading, add);
    const grid = el('div', 'l2d-voice-grid');
    grid.setAttribute('role', 'region');
    grid.setAttribute('aria-label', t('已创建的语音服务', 'Saved speech services'));
    const empty = el('div', 'l2d-voice-empty', t('还没有语音服务。点击「添加语音服务」开始。', 'Add a speech service to get started.'));
    grid.append(empty);
    const sound = el('section', 'l2d-voice-controls');
    page.append(intro, grid, sound);
    ctx.root.append(page);
    const soundControls = mountVoiceControls(ctx, sound, state);
    let snapshot = state, modal, disposed = false;
    const cards = new Map();
    function paint() {
      const ids = new Set(snapshot.services.map(service => service.id));
      for (const [id, {card}] of cards) {
        if (ids.has(id)) continue;
        card.remove();
        cards.delete(id);
      }
      empty.hidden = snapshot.services.length > 0;
      for (const {id, provider, name: serviceName, profile, ready} of snapshot.services) {
        const providerName = VOICE_PROVIDERS[provider].name;
        if (!cards.has(id)) {
          const card = el('button', 'l2d-card l2d-voice-card');
          card.type = 'button';
          card.dataset.serviceId = id;
          card.dataset.provider = provider;
          card.setAttribute('aria-haspopup', 'dialog');
          const head = el('span', 'l2d-voice-card-head');
          const name = el('strong');
          const badge = el('span', 'l2d-voice-badge');
          const model = el('span', 'l2d-voice-model');
          const voice = el('span', 'l2d-voice-voice');
          head.append(name, badge);
          card.append(head, model, voice);
          card.addEventListener('click', () => openService(id));
          cards.set(id, {card, name, badge, model, voice});
          grid.append(card);
        }
        const {card, name, badge, model, voice} = cards.get(id);
        const selected = snapshot.selectedId === id;
        card.classList.toggle('selected', selected);
        name.textContent = serviceName || providerName;
        badge.textContent = selected ? t('当前使用', 'Selected') : ready ? t('可用', 'Ready') : t('待补全', 'Incomplete');
        model.textContent = [serviceName ? providerName : '', profile.model || profile.version].filter(Boolean).join(' · ')
          || t('服务预设', 'Service preset');
        voice.textContent = profile.voice || t('待选音色', 'Voice pending');
        card.setAttribute('aria-label', t('配置 ', 'Configure ') + name.textContent + ' · ' + badge.textContent);
      }
    }
    paint();

    function openService(id = null) {
      if (modal) return;
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
          (setting.type === 'number' || !setting.required ? advanced : fields).append(row);
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
        help.textContent = t(spec?.help || '', '');
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
          const created = id === null && snapshot.services.find(service => !cards.has(service.id));
          changed = false;
          if (key) key.value = '';
          paint();
          soundControls.update(snapshot);
          modal.dispose();
          if (created) {
            grid.scrollTop = grid.scrollHeight;
            cards.get(created.id)?.card.focus({preventScroll:true});
          }
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
        message(!on ? '' : snapshot.selectedId === id && snapshot.controls.voiceEnabled
          ? t('删除当前服务并关闭朗读？', 'Remove the active service and turn off narration?')
          : t('删除这项语音服务？', 'Remove this speech service?'));
        lock();
        (on ? returnToEdit : remove).focus();
      }
      remove.onclick = () => confirmDeletion(true);
      returnToEdit.onclick = () => confirmDeletion(false);
      confirmRemove.onclick = async () => {
        if (saving || !id) return;
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
          add.focus({preventScroll:true});
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
      restore();
    } };
  },
};

function mountVoiceControls(ctx, section, initial) {
  const { t, el, button } = voiceView(ctx);
  let snapshot = initial;
  let disposed = false, saving = false, testing = false, testSent = false, request = 0;
  let prefixRefresh = Promise.resolve();
  const updateTool = (before, after) => {
    if (before?.syncToolReady !== after?.syncToolReady) {
      prefixRefresh = prefixRefresh.then(() => refreshVoiceTool(ctx, before, after)).catch(() => {});
    }
  };
  const pending = {};
  const inputs = new Map();
  const rows = el('div', 'l2d-settings l2d-dialog-body');
  const status = el('span', 'l2d-voice-message');
  status.setAttribute('role', 'status');
  const heading = el('h3', 'l2d-settings-heading', t('语音与口型', 'Voice and lip sync'));
  const controls = [
    ['voiceEnabled', t('朗读桌宠回复', 'Read desktop pet replies'), t('开启后将回复交给选定的语音提供商合成', 'Sends replies to the selected provider for synthesis when enabled')],
    ['voiceTiming', t('朗读时机', 'Narration timing'), t('同步档让第一声和气泡接近同时出现。', 'Sync mode starts speech and the bubble at nearly the same time.')],
    ['voiceVolume', t('播放音量', 'Playback volume'), t('统一调节桌宠朗读的音量', 'Sets the playback volume for desktop narration'), { min: 0, max: 1, step: .01 }],
    ['voiceLipSync', t('口型跟随音频', 'Audio-driven lip sync'), t('关闭时使用原有的气泡口型', 'Turn off to use the existing bubble timing')],
    ['voiceMouthGain', t('张嘴幅度', 'Mouth opening gain'), t('调高后轻声时张嘴更明显，可在桌宠上试听', 'Increase it for clearer mouth movement on quiet sounds. Test it on the desktop pet.'), MOUTH_GAIN],
  ];
  for (const [key, label, hint, range] of controls) {
    const row = el('label', 'l2d-setting-row');
    const text = el('span', 'l2d-setting-label');
    const description = el('small', null, hint);
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
    rows.append(row);
  }
  const actions = el('div', 'l2d-dialog-actions l2d-voice-sound-actions');
  const sample = button(t('在桌宠试听', 'Test on desktop pet'));
  const stop = button(t('停止试听', 'Stop sample'), 'quiet');
  sample.disabled = stop.disabled = true;
  actions.append(status, sample, stop);
  section.append(heading, rows, actions);
  function paintSlider(key) {
    const { input, output } = inputs.get(key);
    if (!output) return;
    const label = key === 'voiceMouthGain' ? Number(input.value).toFixed(1) + '×'
      : Math.round(Number(input.value) * 100) + '%';
    output.value = label;
    input.setAttribute('aria-valuetext', label);
  }
  function paint() {
    if (disposed) return;
    for (const [key, { input, output, description, hint }] of inputs) {
      const value = pending[key] ?? snapshot?.controls[key] ?? VOICE_CONTROLS[key];
      if (key === 'voiceTiming') {
        const ready = snapshot?.timingReady === true;
        input.value = value;
        input.options[1].disabled = !ready;
        description.textContent = ready ? hint : value === 'sync'
          ? t('当前设备使用快速播报，同步设置会保留。', 'This device uses fast narration and keeps your sync preference.')
          : t('当前设备支持快速播报，暂无法对齐气泡起点。', 'Fast narration is available on this device. Bubble timing sync is unavailable.');
      } else if (output) { input.value = String(value); paintSlider(key); }
      else input.checked = value;
      input.disabled = !snapshot || key === 'voiceEnabled' && !snapshot.selectedId && !value;
    }
    sample.disabled = testing || !snapshot?.selectedId || !(snapshot?.playbackReady ?? snapshot?.bodyReady);
    stop.disabled = !testing && !testSent;
  }
  function message(value, bad = false) {
    if (disposed) return;
    status.textContent = value;
    status.classList.toggle('bad', bad);
  }
  function hint() {
    if (!snapshot?.selectedId) return snapshot?.services.length
      ? t('打开上方的服务卡片，选择「保存并使用」。', 'Open a service card above and choose “Save and select”.')
      : t('添加语音服务后即可启用朗读。', 'Add a speech service to enable narration.');
    if (!(snapshot.playbackReady ?? snapshot.bodyReady)) return t('请切换到支持语音的 Figure 形象。已有打包卡片可以重新安装。',
      'Switch to a supported Figure. Reinstall from its pack card to refresh an older runtime.');
    if (snapshot.reader) return t('启用朗读前，请关闭其他扩展的桌宠回复朗读。', 'Turn off other desktop reply readers before enabling narration.');
    return snapshot.message || (!snapshot.bodyReady
      ? t('当前可播放语音。流式口型需要已更新的 Figure 形象。', 'Voice playback is available. Streaming lip sync needs an updated Figure.')
      : '');
  }
  async function save() {
    if (disposed || saving || !Object.keys(pending).length) return;
    saving = true;
    const patch = { ...pending };
    for (const key of Object.keys(patch)) delete pending[key];
    message(t('正在保存…', 'Saving…'));
    try {
      const previous = snapshot;
      snapshot = await ctx.invoke('voiceControls', [patch]);
      message(hint() || t('已保存', 'Saved'));
      updateTool(previous, snapshot);
    } catch (error) {
      message(String(error?.message || error), true);
    } finally {
      saving = false;
      paint();
      void save();
    }
  }
  sample.onclick = async () => {
    const id = ++request;
    testing = true;
    testSent = false;
    paint();
    message(t('正在准备桌宠试听…', 'Preparing the desktop sample…'));
    try {
      await ctx.invoke('voiceAudition', []);
      if (id !== request || disposed) return;
      testSent = true;
      message(t('已将试听送到桌宠', 'Sample sent to the desktop pet'));
    } catch (error) {
      if (id === request) message(String(error?.message || error), true);
    } finally {
      if (id === request) { testing = false; paint(); }
    }
  };
  stop.onclick = async () => {
    request++;
    testing = testSent = false;
    paint();
    try {
      await ctx.invoke('voiceStop', []);
      if (!testing) message(t('试听已停止', 'Sample stopped'));
    } catch (error) { message(String(error?.message || error), true); }
  };
  paint();
  message(hint());
  const guard = ctx.guardLeave?.(() => !disposed && (saving || Object.keys(pending).length)
    ? t('语音设置正在保存，确定离开？', 'Voice settings are saving. Leave anyway?') : null);
  return {
    update(result) {
      const previous = snapshot;
      snapshot = result;
      paint();
      message(hint());
      updateTool(previous, snapshot);
    },
    dispose() { disposed = true; guard?.dispose(); },
  };
}
