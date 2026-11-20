function wardrobeLink(el, label, style = 'l2d-btn sm') {
  const link = el('a', style, label);
  link.href = '#/dress';
  return link;
}

function mountPerformanceSettings(ctx, form, cfg, setMode) {
  const {doc, t, el, button} = voiceView(ctx);
  const section = el('section', 'l2d-planner-settings');
  section.append(el('h3', 'l2d-settings-heading', t('运行时表演', 'Runtime performance')));
  const modes = el('fieldset', 'l2d-planner-modes');
  modes.setAttribute('aria-label', t('表演模式', 'Performance mode'));
  const descriptions = [
    ['vocab', t('默认', 'Default'), t('沿用 Coo 的情绪和动作词。', 'Use Coo’s existing expressions and actions.'), t('现有主模型用量', 'Existing main-model usage')],
    ['direct', t('主模型编排', 'Main model planning'), t('在对话里直接让 Coo 做动作或边说边演。', 'Ask Coo to perform an action or act while speaking.'), t('主模型用量增加', 'Additional main-model usage')],
    ['dual', t('独立编排', 'Dedicated planning'), t('由单独配置的模型为气泡台词编排动作。', 'Use a dedicated model to plan actions for bubble text.'), t('现有主模型用量＋编排模型用量', 'Existing main-model usage + planner usage')],
  ];
  const radios = descriptions.map(([value, title, detail, usage]) => {
    const label = el('label', 'l2d-planner-mode');
    const radio = el('input');
    radio.type = 'radio';
    radio.name = 'figure-performance-mode';
    radio.value = value;
    radio.checked = value === (cfg.performanceMode || 'vocab');
    radio.setAttribute('aria-label', title);
    const head = el('span', 'l2d-planner-mode-head');
    head.append(el('strong', null, title), radio);
    label.append(head, el('span', 'l2d-planner-detail', detail), el('small', 'l2d-planner-usage', usage));
    modes.append(label);
    radio.addEventListener('change', () => { if (radio.checked) { setMode(value); paint(); } });
    return radio;
  });
  const manage = button(t('管理编排服务', 'Manage planners'), 'l2d-planner-manage');
  manage.setAttribute('aria-haspopup', 'dialog');
  const readiness = el('div', 'l2d-planner-service-bar l2d-performance-readiness');
  const targetSummary = el('div', 'l2d-planner-service-summary');
  const targetName = el('strong');
  const nextStep = el('small');
  targetSummary.append(targetName, nextStep);
  const action = el('div', 'l2d-performance-action');
  const dress = wardrobeLink(el, t('打开装扮', 'Open Dress up'));
  const desktopTarget = el('select', 'l2d-input');
  desktopTarget.setAttribute('aria-label', t('已穿戴的形象', 'Worn figure'));
  desktopTarget.append(el('option', null, t('跟随装扮记录', 'Follow wardrobe activity')));
  desktopTarget.options[0].value = '';
  desktopTarget.disabled = true;
  const targetRow = el('label', 'l2d-setting-row l2d-desktop-target-row');
  const targetLabel = el('span', 'l2d-setting-label');
  targetLabel.append(el('span', null, t('已穿戴的形象', 'Worn figure')),
    el('small', null, t('先在 Coo 穿戴。没有装扮记录时，可在这里指定编排和口型使用的形象。', 'Wear the figure in Coo. Select it here for planning and lip sync if wardrobe activity is unavailable.')));
  targetRow.append(targetLabel, desktopTarget);
  const importSource = button(t('导入原始模型', 'Import source model'), 'sm');
  action.append(dress, importSource, manage);
  readiness.append(targetSummary, action);
  readiness.setAttribute('role', 'status');
  section.append(modes, targetRow, readiness);
  form.append(section);

  let snapshot = null, currentBody = null, disposed = false, reading = false, importing = false, choosing = false;
  let syncState = '';
  let dialog;
  const providerName = id => {
    const provider = PLANNER_PROVIDERS[id];
    return t(provider.name, provider.english || provider.name);
  };
  function paint() {
    const service = snapshot?.services.find(item => item.id === snapshot.selectedId);
    const independent = radios[2].checked;
    manage.classList.toggle('quiet', !independent);
    const mode = radios.find(input => input.checked)?.value;
    const state = currentBody?.state;
    dress.hidden = !['choose-figure', 'check-pack', 'render-failed', 'reload'].includes(state);
    dress.textContent = currentBody?.body === 'desktop-live2d-pet' ? t('打开桌宠设置', 'Open pet settings') : t('打开装扮', 'Open Dress up');
    dress.href = currentBody?.body === 'desktop-live2d-pet' ? '#/pet' : '#/dress';
    importSource.hidden = mode === 'vocab' || state !== 'native-model';
    importSource.disabled = importing;
    manage.hidden = !independent && (!dress.hidden || !importSource.hidden);
    const bodyName = currentBody?.body === 'desktop-live2d-pet' ? t('Live2D 桌宠', 'Live2D desktop pet') : t('桌宠', 'Desktop pet');
    const worn = currentBody?.figure === 'coo' ? t('内置 Coo', 'Built-in Coo') : currentBody?.figure;
    targetName.textContent = worn ? bodyName + ' · ' + worn : t('当前对话桌宠', 'Current conversation pet');
    if (service?.ready) targetName.textContent += ' · ' + service.model;
    nextStep.textContent = !currentBody ? t('正在检查穿戴形象…', 'Checking the worn figure…')
        : mode === 'vocab' ? t('回到对话，直接说「眨一下眼」。', 'In chat, say “Wink once.”')
          : state === 'unavailable' ? t('暂时读不到桌宠状态，正在重试。', 'Pet status is unavailable. Retrying.')
          : state === 'native-model' ? t('当前是 Live2D 桌宠直导的模型。请用 Figure 导入原始素材，再穿戴到 Coo 桌宠。', 'Import the source model in Figure and wear the pack on the Coo desktop pet.')
          : state === 'choose-figure' ? currentBody.body === 'desktop-live2d-pet'
            ? t('先在这只桌宠的装扮里穿戴 Figure 形象。', 'Wear a Figure pack on this desktop pet.')
            : t('在 Coo 装扮穿戴 Live2D 形象，或在上方选择已穿戴的形象。', 'Wear a Live2D figure in Coo, or select the figure already worn above.')
          : state === 'check-pack' ? t('从 Figure 模型卡重装 Live2D 形象，或在装扮里换一个。', 'Reinstall the Live2D figure from its Figure card or choose another one in Dress up.')
          : state === 'render-failed' ? t('Coo 加载这个形象失败。可在装扮里重选，或从模型卡重装。', 'Coo could not load this figure. Select it again or reinstall it from its card.')
          : state === 'reload' ? t('形象已重装。在 Coo 装扮里切到另一只，再切回此形象。', 'Figure reinstalled. Switch to another figure in Coo, then switch back.')
          : mode === 'direct' && syncState ? syncState
          : independent && !snapshot ? t('正在读取编排服务…', 'Loading planner services…')
          : independent && !service?.ready ? t('形象已就绪，选择一个编排服务即可。', 'The figure is ready. Select a planner service.')
          : currentBody.limited ? t('可编排姿态和通用表情。导入原始素材可恢复原生动作。', 'Pose and generic expression planning are available. Import the source model to recover native actions.')
          : t('可以回到对话，试试「先点头，再往左歪头」。', 'In chat, try “Nod, then tilt your head left.”');
    targetName.title = targetName.textContent;
    nextStep.title = nextStep.textContent;

  }
  paint();
  void ctx.invoke('plannerState', []).then(state => {
    if (!snapshot && state?.services && !ctx.signal?.aborted) { snapshot = state; paint(); }
  }, () => { if (!ctx.signal?.aborted) { snapshot = {services:[]}; paint(); } });
  async function checkBody() {
    if (reading || choosing || disposed || ctx.signal?.aborted) return;
    reading = true;
    try {
      const state = await ctx.invoke('performanceReadiness', []);
      if (!disposed && !ctx.signal?.aborted) currentBody = state?.state ? state : {state:'unavailable'};
    } catch {
      if (!disposed && !ctx.signal?.aborted) currentBody = {state:'unavailable'};
    } finally {
      reading = false;
      if (!disposed && !ctx.signal?.aborted) paint();
    }
  }
  void checkBody();
  const statusPoll = ctx.interval?.(() => { if (form.isConnected && !doc.hidden) void checkBody(); }, 2000);
  let selectedTarget = cfg.desktopFigure || '';
  async function loadTargets() {
    try {
      const targets = await ctx.invoke('desktopTargets', []);
      if (disposed || !Array.isArray(targets)) return;
      for (const {id, name} of targets) {
        const option = el('option', null, name);
        option.value = id;
        desktopTarget.append(option);
      }
      desktopTarget.value = selectedTarget;
      if (desktopTarget.selectedIndex < 0) desktopTarget.selectedIndex = 0;
      desktopTarget.disabled = false;
    } catch {
      if (!disposed) desktopTarget.options[0].textContent = t('形象列表暂不可用', 'Figure list unavailable');
    }
  }
  void loadTargets();
  desktopTarget.onchange = async () => {
    choosing = desktopTarget.disabled = true;
    try {
      currentBody = await ctx.invoke('selectDesktopFigure', [desktopTarget.value]);
      selectedTarget = desktopTarget.value;
      paint();
    } catch (error) {
      desktopTarget.value = selectedTarget;
      if (!disposed) ctx.ui.toast(String(error?.message || error), 'bad');
    } finally { choosing = desktopTarget.disabled = false; }
  };
  importSource.onclick = async () => {
    if (importing || !currentBody?.figure) return;
    importing = true; paint();
    try {
      await ctx.invoke('importDesktopSource', [currentBody.figure]);
      if (!disposed) doc.defaultView.location.hash = '#/provider/world%3Afigure/workbench';
    } catch (error) {
      if (!disposed) ctx.ui.toast(String(error?.message || error), 'bad');
    } finally { importing = false; if (!disposed) paint(); }
  };
  manage.onclick = () => {
    if (dialog) return;
    const pane = el('section', 'l2d-dialog-body l2d-planner-manager');
    const content = el('div', 'l2d-planner-manager-content');
    const footer = el('div', 'l2d-planner-manager-footer');
    const status = el('p', 'l2d-voice-message');
    status.setAttribute('role', 'status');
    const actions = el('div', 'l2d-dialog-actions l2d-planner-actions');
    footer.append(status, actions);
    pane.append(content, footer);
    let closed = false, writing = false, releaseEditor = () => {};
    const message = (text, bad = false) => {
      status.textContent = text;
      status.classList.toggle('bad', bad);
    };
    const errorText = error => String(error?.message || error);
    const update = state => { snapshot = state; paint(); };

    function list(focusId) {
      releaseEditor();
      message('');
      content.replaceChildren();
      actions.replaceChildren();
      const add = button(t('添加服务', 'Add service'), 'primary');
      const heading = el('div', 'l2d-planner-list-heading');
      heading.append(el('strong', null, t('已保存的服务', 'Saved services')), add);
      content.append(heading);
      const grid = el('div', 'l2d-planner-service-grid');
      const cards = new Map();
      for (const service of snapshot.services) {
        const card = el('button', 'l2d-card l2d-voice-card');
        card.type = 'button';
        const active = snapshot.selectedId === service.id;
        card.classList.toggle('selected', active);
        const head = el('span', 'l2d-voice-card-head');
        const name = service.name || providerName(service.provider);
        const state = active && service.ready ? t('当前使用', 'Selected') : service.ready ? t('可用', 'Ready') : t('待补全', 'Incomplete');
        head.append(el('strong', null, name), el('span', 'l2d-voice-badge', state));
        card.append(head, el('span', 'l2d-voice-model', service.model || t('待选模型', 'Model pending')),
          el('span', 'l2d-voice-voice', providerName(service.provider)));
        card.setAttribute('aria-label', t('编辑 ', 'Edit ') + name + ' · ' + state);
        card.onclick = () => { if (!writing) edit(service); };
        cards.set(service.id, card);
        const tile = el('div', 'l2d-planner-service-tile');
        tile.append(card);
        if (service.ready && !active) {
          const use = button(t('使用', 'Use'), 'sm l2d-planner-select');
          use.setAttribute('aria-label', t('使用 ', 'Use ') + name);
          use.onclick = async () => {
            if (writing) return;
            writing = true;
            use.disabled = true;
            message(t('正在切换…', 'Switching…'));
            try {
              update(await ctx.invoke('plannerSelect', [service.id]));
              if (!closed) list(service.id);
            } catch (error) {
              if (!closed) message(errorText(error), true);
            } finally {
              writing = false;
              if (!closed) use.disabled = false;
            }
          };
          tile.append(use);
        }
        grid.append(tile);
      }
      if (!grid.childElementCount) grid.append(el('p', 'l2d-voice-empty', t('添加一个服务后即可为独立编排选择模型。', 'Add a service to choose a model for dedicated planning.')));
      content.append(grid);
      const close = button(t('完成', 'Done'));
      close.onclick = () => { if (!writing) dialog?.dispose(); };
      actions.append(close);
      add.onclick = () => { if (!writing) edit(); };
      (cards.get(focusId) || add).focus({preventScroll:true});
    }

    function edit(service) {
      content.replaceChildren();
      actions.replaceChildren();
      message('');
      const draft = el('form', 'l2d-planner-editor');
      const field = (title, input) => {
        const label = el('label', 'l2d-field');
        label.append(el('span', 'l2d-label', title), input);
        return label;
      };
      const input = (type, value, length) => {
        const node = el('input', 'l2d-input');
        node.type = type;
        node.value = value || '';
        node.maxLength = length;
        node.spellcheck = false;
        return node;
      };
      const provider = el('select', 'l2d-input');
      for (const id of Object.keys(PLANNER_PROVIDERS)) {
        const option = el('option', null, providerName(id));
        option.value = id;
        provider.append(option);
      }
      provider.value = service?.provider || 'openai';
      const name = input('text', service?.name, 80);
      name.placeholder = t('例如 日常表演', 'For example, Everyday performance');
      const endpoint = input('url', service?.endpoint ?? PLANNER_PROVIDERS[provider.value].endpoint, 2048);
      endpoint.required = true;
      endpoint.placeholder = 'https://example.com/v1';
      const key = input('password', '', 4096);
      key.autocomplete = 'new-password';
      const keyNote = el('small', 'l2d-planner-key-note');
      const keyField = field(t('API 密钥', 'API key'), key);
      keyField.append(keyNote);
      const model = input('text', service?.model, 240);
      model.required = true;
      const modelList = el('datalist');
      modelList.id = 'figure-planner-models';
      model.setAttribute('list', modelList.id);
      model.placeholder = t('选择或输入模型 ID', 'Choose or enter a model ID');
      const loadModels = button(t('获取模型', 'Fetch models'));
      const modelRow = el('div', 'l2d-planner-model-row');
      modelRow.append(field(t('模型', 'Model'), model), loadModels, modelList);
      const top = el('div', 'l2d-planner-editor-top');
      top.append(field(t('提供商', 'Provider'), provider), field(t('服务名称（选填）', 'Service name (optional)'), name));
      draft.append(top, field(t('服务地址', 'Service address'), endpoint), keyField, modelRow);
      content.append(draft);

      const back = button(t('返回', 'Back'), 'quiet');
      const remove = button(t('删除服务', 'Remove service'), 'quiet danger');
      const test = button(t('测试连接', 'Test connection'));
      const save = button(t('保存', 'Save'));
      const use = button(t('保存并使用', 'Save and use'), 'primary');
      const active = snapshot.selectedId === service?.id;
      if (service) actions.append(remove);
      actions.append(back, test);
      if (!active) actions.append(save);
      actions.append(use);
      const nonce = doc.defaultView.crypto?.randomUUID?.();
      let reading = false, changed = false, retiring = false, editing = true;
      const guard = ctx.guardLeave?.(() => !closed && editing && (writing || changed)
        ? t('编排服务配置尚未保存，确定离开？', 'Planner settings are unsaved. Leave anyway?') : null);
      releaseEditor = () => { editing = false; key.value = ''; guard?.dispose?.(); };
      const data = select => ({id:service?.id, provider:provider.value, name:name.value, endpoint:endpoint.value,
        model:model.value, key:key.value, nonce, select});
      const origin = value => { try { return new URL(value).origin; } catch { return ''; } };
      function describeKey() {
        const saved = service?.hasKey && origin(endpoint.value) === origin(service.endpoint);
        key.required = PLANNER_PROVIDERS[provider.value].keyRequired && !saved;
        keyNote.textContent = saved ? t('此地址的密钥已保存，留空可继续使用。', 'Leave blank to keep the saved key for this address.')
          : key.required ? t('密钥保存在 Coo 凭据区。', 'The key is stored in Coo’s credential store.')
            : t('服务无需鉴权时可留空。', 'Leave blank for services that do not require authentication.');
      }
      function lock() {
        for (const control of [provider,name,endpoint,key,model,loadModels,remove,test,save,use]) control.disabled = writing || reading || retiring;
        back.disabled = writing;
        pane.setAttribute('aria-busy', String(writing || reading));
      }
      draft.oninput = () => { changed = true; message(''); };
      endpoint.addEventListener('input', () => { describeKey(); modelList.replaceChildren(); });
      key.addEventListener('input', () => modelList.replaceChildren());
      provider.onchange = () => {
        endpoint.value = PLANNER_PROVIDERS[provider.value].endpoint;
        key.value = '';
        model.value = '';
        modelList.replaceChildren();
        describeKey();
        changed = true;
        message('');
      };
      describeKey();
      lock();
      (service ? name : provider).focus({preventScroll:true});

      async function check(models) {
        if (reading || writing || !endpoint.reportValidity() || !key.reportValidity() || !models && !model.reportValidity()) return;
        reading = true;
        lock();
        message(models ? t('正在获取模型列表…', 'Fetching models…') : t('正在测试连接…', 'Testing connection…'));
        try {
          const result = await ctx.invoke(models ? 'plannerModels' : 'plannerTest', [data(false)]);
          if (closed || !editing) return;
          if (models) {
            modelList.replaceChildren(...result.map(value => {
              const option = el('option');
              option.value = value;
              return option;
            }));
            message(result.length ? t('已获取 ', 'Loaded ') + result.length + t(' 个模型，可在模型框搜索。', ' models. Type in the model field to search.')
              : t('服务未返回模型，可手动填写模型 ID。', 'No models returned. Enter a model ID manually.'));
          } else {
            message(t('连接和动作 JSON 验证通过 · ', 'Connection and action JSON verified · ') + result.elapsedMs + ' ms');
          }
        } catch (error) {
          if (!closed && editing) message(errorText(error), true);
        } finally {
          reading = false;
          if (!closed && editing) {
            lock();
            if (models && modelList.childElementCount) model.focus({preventScroll:true});
          }
        }
      }
      loadModels.onclick = () => void check(true);
      test.onclick = () => void check(false);
      async function persist(select) {
        if (writing || reading || !draft.reportValidity()) return;
        writing = true;
        lock();
        message(t('正在保存…', 'Saving…'));
        try {
          update(await ctx.invoke('plannerSave', [data(select)]));
          if (!closed) list(service?.id === 'legacy' ? nonce : service?.id || nonce);
        } catch (error) {
          if (!closed) message(errorText(error), true);
        } finally {
          writing = false;
          if (!closed && editing) lock();
        }
      }
      save.onclick = () => void persist(false);
      use.onclick = () => void persist(true);
      draft.onsubmit = event => { event.preventDefault(); void persist(true); };
      back.onclick = () => list(service?.id);
      remove.onclick = () => {
        if (!service || reading || writing) return;
        retiring = true;
        const cancel = button(t('返回编辑', 'Back to editor'));
        const confirm = button(t('确认删除', 'Remove service'), 'danger');
        actions.replaceChildren(cancel, confirm);
        lock();
        message(active ? t('删除当前服务后，独立编排会暂用本地表演。', 'Dedicated planning uses local performance after removing the selected service.')
          : t('删除这项编排服务？', 'Remove this planner service?'));
        cancel.onclick = () => {
          retiring = false;
          actions.replaceChildren(remove, back, test, ...(active ? [] : [save]), use);
          lock();
          message('');
        };
        confirm.onclick = async () => {
          if (writing) return;
          writing = true;
          confirm.disabled = cancel.disabled = true;
          try {
            update(await ctx.invoke('plannerRemove', [service.id]));
            if (!closed) list();
          } catch (error) {
            if (!closed) message(errorText(error), true);
          } finally {
            writing = false;
            if (!closed && editing) confirm.disabled = cancel.disabled = false;
          }
        };
        cancel.focus();
      };
    }

    const parent = form.closest('dialog') || ctx.root;
    dialog = openFigureDialog(parent, t('编排服务', 'Planner services'), pane, {
      closeLabel: t('关闭', 'Close'), variant: 'l2d-planner-popup', locked: () => writing,
      onClose() { closed = true; releaseEditor(); dialog = undefined; },
    });
    if (snapshot) list();
    else {
      message(t('正在读取服务…', 'Loading services…'));
      void ctx.invoke('plannerState', []).then(state => {
        if (!closed) { update(state); list(); }
      }, error => { if (!closed) message(errorText(error), true); });
    }
  };
  const dispose = () => { disposed = true; statusPoll?.dispose?.(); dialog?.dispose(); };
  ctx.signal?.addEventListener('abort', dispose, {once:true});
  return { controls: radios, dispose, showSync(message = '') { syncState = message; paint(); } };
}
