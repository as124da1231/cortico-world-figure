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
      native: ['♥', t('Coo 原生', 'Coo original'), t('爱心、眼泪、音符与睡眠符号。', 'Hearts, tears, notes and sleep symbols.')],
      kaomoji: ['^_^', t('颜文字', 'Kaomoji'), t('随情绪变化的颜文字。', 'A text face that changes with the mood.')],
      orb: ['◉', t('情绪球', 'Emotion orb'), t('喜欢、生气或哭泣时亮起。', 'Glows in response to affection, anger and tears.')],
      flow: ['≈', t('全身粒子流', 'Full-body particle flow'), t('粒子环绕形象的前后两侧。', 'Particles circle the front and back of the figure.')],
      bubbles: ['○', t('右上角气泡', 'Upper-right bubbles'), t('彩色气泡从右上方浮起。', 'Coloured bubbles rise near the upper-right corner.')],
      softglow: ['✦', t('柔光流尘 · 第二版', 'Softglow dust · V2'), t('柔光与光尘掠过形象。', 'Soft light and dust sweep past the figure.')],
    };
    const page = el('section', 'l2d-config-page l2d-effects-page');
    holdFigurePanelPaint(page);
    const themes = el('section', 'l2d-theme-section');
    const themeHeader = el('div', 'l2d-effects-header');
    const themeIntro = el('div', 'l2d-effects-intro');
    const themeHeading = el('h3', null, t('主题配色', 'Theme colours'));
    themeHeading.id = 'l2d-theme-heading';
    const themeHint = el('p', null, t(
      '可多选随形象包带入的主题，安装后在 Coo「装扮 → 配色」切换。',
      'Include multiple themes in the pack, then switch between them under Dress up → Colours.',
    ));
    themeHint.id = 'l2d-theme-hint';
    themeIntro.append(themeHeading, themeHint);
    const themeActions = el('div', 'l2d-theme-actions');
    const themeCount = el('span', 'l2d-theme-count');
    themeCount.setAttribute('aria-live', 'polite');
    const selectThemes = el('button', 'l2d-btn quiet', t('全选', 'Select all'));
    const clearThemes = el('button', 'l2d-btn quiet', t('清空', 'Clear'));
    selectThemes.type = clearThemes.type = 'button';
    themeActions.append(themeCount, selectThemes, clearThemes);
    themeHeader.append(themeIntro, themeActions);
    const themeChoices = el('div', 'l2d-theme-choices');
    themeChoices.setAttribute('role', 'group');
    themeChoices.setAttribute('aria-labelledby', themeHeading.id);
    themeChoices.setAttribute('aria-describedby', themeHint.id);
    themes.append(themeHeader, themeChoices);

    const header = el('div', 'l2d-effects-header');
    const intro = el('div', 'l2d-effects-intro');
    const heading = el('h3', null, t('随包特效', 'Included effects'));
    heading.id = 'l2d-effects-heading';
    intro.append(heading, el('p', null, t(
      '勾选随包安装的特效，在 Coo 装扮里切换。',
      'Choose which effects to include, then switch between them in Dress up.',
    )));
    const sizes = el('fieldset', 'l2d-effect-sizes');
    const sizeChoices = el('div', 'l2d-effect-size-choices');
    const sizeHint = el('small', 'l2d-effect-size-hint', t('勾选附加特效后可调整', 'Select an extra effect to adjust'));
    sizeHint.id = 'l2d-effect-size-hint';
    sizes.setAttribute('aria-describedby', sizeHint.id);
    sizes.append(el('legend', null, t('附加特效大小', 'Extra effect size')), sizeChoices, sizeHint);
    header.append(intro, sizes);
    const cards = el('div', 'l2d-effects-grid');
    cards.setAttribute('role', 'group');
    cards.setAttribute('aria-labelledby', heading.id);
    const status = el('p', 'l2d-effects-status');
    status.setAttribute('role', 'status');

    let saved = {
      styles: normalizeEmotionEffects(cfg.emotionEffects ?? cfg.emotionEffect),
      size: normalizeEmotionEffectSize(cfg.emotionEffectSize),
      themes: normalizeFigureThemes(cfg.themePalettes),
    };
    let selected = saved, saving = false, disposed = false;
    const options = new Map();
    const sizeOptions = new Map();
    const themeOptions = new Map();
    const inactive = () => disposed || ctx.signal?.aborted;
    const sameEffects = (a, b) => a.size === b.size && a.styles.join() === b.styles.join();
    const sameThemes = (a, b) => a.themes.join() === b.themes.join();
    const sameSelection = (a, b) => sameThemes(a, b) && sameEffects(a, b);
    function paintSelection() {
      for (const [theme, input] of themeOptions) input.checked = selected.themes.includes(theme);
      const count = selected.themes.length;
      themeCount.textContent = t(`已选 ${count}/${themeOptions.size}`, `${count}/${themeOptions.size} selected`);
      selectThemes.disabled = count === themeOptions.size;
      clearThemes.disabled = count === 0;
      for (const [style, {card, input, selectedLabel}] of options) {
        input.checked = selected.styles.includes(style);
        card.classList.toggle('selected', input.checked);
        selectedLabel.style.visibility = input.checked ? 'visible' : 'hidden';
      }
      for (const [size, input] of sizeOptions) input.checked = size === selected.size;
      sizes.disabled = selected.styles.length === 1;
      sizeHint.style.visibility = sizes.disabled ? 'visible' : 'hidden';
    }
    async function saveSelection() {
      if (inactive() || saving || sameSelection(saved, selected)) return;
      const choice = selected;
      saving = true;
      status.textContent = t('保存中…', 'Saving…');
      status.classList.remove('bad');
      try {
        const patch = {};
        if (!sameEffects(saved, choice)) {
          patch['worlds.figure.emotionEffects'] = choice.styles.slice(1).join(',') || 'native';
          patch['worlds.figure.emotionEffectSize'] = choice.size;
        }
        if (!sameThemes(saved, choice)) patch['worlds.figure.themePalettes'] = choice.themes.join(',');
        await ctx.setConfig('figure', patch);
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
    function updateThemes(values) {
      if (inactive()) return;
      selected = {...selected, themes:normalizeFigureThemes(values)};
      paintSelection();
      void saveSelection();
    }
    selectThemes.addEventListener('click', () => updateThemes([...themeOptions.keys()]));
    clearThemes.addEventListener('click', () => updateThemes([]));
    for (const {id, name, console:colors} of FIGURE_THEME_PALETTES) {
      const choice = el('label', 'l2d-theme-choice');
      const swatch = el('span', 'l2d-theme-swatch');
      swatch.setAttribute('aria-hidden', 'true');
      swatch.style.setProperty('--theme-ring', `light-dark(${colors.light.a}, ${colors.dark.a})`);
      swatch.style.setProperty('--theme-tint', `light-dark(${colors.light.a2}, ${colors.dark.a2})`);
      const input = el('input', 'l2d-effect-check');
      input.type = 'checkbox';
      input.name = 'l2d-theme-palette';
      input.value = id;
      themeOptions.set(id, input);
      choice.append(swatch, el('span', 'l2d-theme-name', name[ctx.language] ?? t(name.zh, name.en)), input);
      themeChoices.append(choice);
      input.addEventListener('change', () => {
        const themes = selected.themes.filter(theme => theme !== id);
        if (input.checked) themes.push(id);
        updateThemes(themes);
      });
    }
    for (const style of EMOTION_EFFECTS) {
      const [glyph, title, description] = copy[style];
      const card = el('label', 'l2d-card l2d-effect-card' + (style === 'native' ? ' is-default' : ''));
      const input = el('input', style === 'native' ? 'l2d-effect-radio' : 'l2d-effect-check');
      input.type = 'checkbox';
      input.name = 'l2d-pet-effect';
      input.value = style;
      input.disabled = style === 'native';
      input.setAttribute('aria-label', title);
      const symbol = el('span', 'l2d-effect-symbol', glyph);
      symbol.setAttribute('aria-hidden', 'true');
      const details = el('span', 'l2d-effect-details');
      const label = el('span', 'l2d-effect-label');
      const selectedLabel = el('span', 'l2d-effect-selected', style === 'native' ? t('默认启用', 'On by default') : t('随包', 'Included'));
      selectedLabel.setAttribute('aria-hidden','true');
      label.append(el('strong', null, title), selectedLabel);
      const descriptionText = el('small', null, description);
      descriptionText.id = 'l2d-effect-description-' + style;
      input.setAttribute('aria-describedby', descriptionText.id);
      details.append(label, descriptionText);
      card.append(symbol, details, input);
      cards.append(card);
      options.set(style, {card, input, selectedLabel});
      input.addEventListener('change', () => {
        if (inactive() || input.disabled) return;
        const styles = selected.styles.filter(choice=>choice !== style);
        if (input.checked) styles.push(style);
        selected = {...selected, styles:normalizeEmotionEffects(styles)};
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
        if (inactive() || !input.checked) return;
        selected = {...selected, size};
        paintSelection();
        void saveSelection();
      });
    }
    paintSelection();
    page.append(themes, header, cards, status);
    ctx.root.append(page);
    const guard = ctx.guardLeave?.(() => saving ? t('个性化设置正在保存，确定离开？', 'Personalization is saving. Leave anyway?') : null);
    return {dispose() {
      disposed = true;
      guard?.dispose();
      page.remove();
    }};
  },
};
