const effectsGallery = {
  async mount(ctx) {
    const cfg = await ctx.invoke('settings', []);
    if (ctx.signal?.aborted) return;

    const doc = ctx.root.ownerDocument;
    const zh = String(ctx.language || 'zh').toLowerCase().startsWith('zh');
    const t = (a, b) => zh ? a : b;
    const el = (tag, className, text) => {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const copy = {
      native: [t('原有特效', 'Original effects'), t('Coo 的爱心、眼泪、音符与睡眠符号。', 'Coo’s hearts, tears, notes and sleep symbols.')],
      kaomoji: [t('颜文字', 'Kaomoji'), t('一个轻轻做动作的颜文字，随情绪变换。', 'A softly animated text face that changes with the mood.')],
      orb: [t('情绪球', 'Emotion orb'), t('喜欢、生气或哭泣时，亮起对应的情绪球。', 'A glowing orb responds to affection, anger and tears.')],
      flow: [t('全身粒子流', 'Full-body particle flow'), t('粒子沿着形象的前后两侧环绕。', 'Particles sweep around the front and back of the figure.')],
      bubbles: [t('右上角气泡', 'Upper-right bubbles'), t('彩色小气泡在形象右上方浮起。', 'Coloured bubbles rise near the upper-right corner.')],
      softglow: [t('柔光流尘 · 第二版', 'Softglow dust · V2'), t('淡淡的流光和光尘掠过形象。', 'Soft light and drifting dust sweep past the figure.')],
    };
    const restoreAppearance = ownAppearance(ctx.root);
    applyAppearance(ctx.root, cfg);
    const page = el('section', 'l2d-config-page l2d-effects-page');
    const header = el('div', 'l2d-effects-header');
    const intro = el('div', 'l2d-effects-intro');
    const heading = el('h3', null, t('桌宠特效', 'Pet effects'));
    heading.id = 'l2d-effects-heading';
    intro.append(heading, el('p', null, t(
      '选一张卡片作为特效风格。打包或从已有卡片重新安装时生效。',
      'Select an effect style. It applies when packing or reinstalling from an existing card.',
    )));
    const sizes = el('fieldset', 'l2d-effect-sizes');
    const sizeChoices = el('div', 'l2d-effect-size-choices');
    sizes.append(el('legend', null, t('特效大小', 'Effect size')), sizeChoices);
    header.append(intro, sizes);
    const gallery = el('div', 'l2d-effects-grid');
    gallery.setAttribute('role', 'radiogroup');
    gallery.setAttribute('aria-labelledby', heading.id);
    const status = el('p', 'l2d-effects-status', t('选择后自动保存。', 'Selection saves automatically.'));
    status.setAttribute('role', 'status');

    let saved = {
      style: normalizeEmotionEffect(cfg.emotionEffect),
      size: normalizeEmotionEffectSize(cfg.emotionEffectSize),
    };
    let selected = saved, saving = false, disposed = false;
    const options = new Map();
    const sizeOptions = new Map();
    const inactive = () => disposed || ctx.signal?.aborted;
    const sameSelection = (a, b) => a.style === b.style && a.size === b.size;
    function paintSelection() {
      for (const [style, {card, input}] of options) {
        input.checked = style === selected.style;
        card.classList.toggle('selected', input.checked);
      }
      for (const [size, input] of sizeOptions) input.checked = size === selected.size;
      sizes.disabled = selected.style === 'native';
      page.dataset.effectSize = selected.size;
    }
    async function saveSelection() {
      if (inactive() || saving || sameSelection(saved, selected)) return;
      const choice = selected;
      saving = true;
      status.textContent = t('保存中…', 'Saving…');
      status.classList.remove('bad');
      try {
        await ctx.setConfig('figure', {
          'worlds.figure.emotionEffect': choice.style,
          'worlds.figure.emotionEffectSize': choice.size,
        });
        saved = choice;
      } catch (error) {
        if (inactive()) return;
        if (sameSelection(selected, choice)) {
          selected = saved;
          paintSelection();
          status.textContent = t('保存失败，请重新选择。', 'Save failed. Please try again.');
          status.classList.add('bad');
          ctx.ui.toast(String(error?.message || error), 'bad');
          return;
        }
      } finally {
        saving = false;
      }
      if (inactive()) return;
      if (!sameSelection(saved, selected)) void saveSelection();
      else status.textContent = t('已保存', 'Saved');
    }
    for (const style of EMOTION_EFFECTS) {
      const [title, description] = copy[style];
      const card = el('label', 'l2d-card l2d-effect-card');
      const input = el('input', 'l2d-effect-radio');
      input.type = 'radio';
      input.name = 'l2d-pet-effect';
      input.value = style;
      input.setAttribute('aria-label', title);
      const details = el('span', 'l2d-effect-details');
      details.append(el('strong', null, title), el('small', null, description));
      const check = el('span', 'l2d-effect-check', '✓');
      check.setAttribute('aria-hidden', 'true');
      card.append(input, createEffectPreview(doc, style), details, check);
      gallery.append(card);
      options.set(style, {card, input});
      input.addEventListener('change', () => {
        if (inactive() || !input.checked) return;
        selected = {...selected, style};
        paintSelection();
        void saveSelection();
      });
    }
    const sizeLabels = { small: t('小', 'Small'), medium: t('中', 'Medium'), large: t('大', 'Large') };
    for (const size of EMOTION_EFFECT_SIZES) {
      const choice = el('label', 'l2d-effect-size-choice');
      const input = el('input', 'l2d-effect-radio');
      input.type = 'radio';
      input.name = 'l2d-pet-effect-size';
      input.value = size;
      choice.append(input, el('span', null, sizeLabels[size]));
      sizeChoices.append(choice);
      sizeOptions.set(size, input);
      input.addEventListener('change', () => {
        if (inactive() || sizes.disabled || !input.checked) return;
        selected = {...selected, size};
        paintSelection();
        void saveSelection();
      });
    }
    paintSelection();
    page.append(header, gallery, status);
    ctx.root.append(page);
    const guard = ctx.guardLeave?.(() => saving ? t('特效正在保存，确定离开？', 'Effect selection is saving. Leave anyway?') : null);
    return {dispose() {
      disposed = true;
      guard?.dispose();
      page.remove();
      restoreAppearance();
    }};
  },
};
