function mountWorkbenchLibrary({grid, search, sort, countLabel, clearAll, el, t, zh, readState, actions}) {
  const doc = grid.ownerDocument;
  function renderGrid() {
    const {state, initialized, startupFailed, editingId} = readState();
    grid.replaceChildren();
    countLabel.textContent = initialized ? String(state.builds.length) : '—';
    clearAll.disabled = state.busy || state.builds.length < 2;
    if (!initialized) {
      const empty = el('div', 'l2d-empty');
      empty.append(el('strong', null, startupFailed ? t('暂时无法读取模型包', 'Could not load packs') : t('正在读取模型包…', 'Loading packs…')));
      if (startupFailed) {
        const retry = el('button', 'l2d-btn', t('重新读取', 'Retry loading'));
        retry.type = 'button';
        retry.addEventListener('click', actions.retry);
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
    if (!builds.length) {
      const empty = el('div', 'l2d-empty');
      empty.append(el('strong', null, t('没有匹配的模型包', 'No matching packs')));
      const reset = el('button', 'l2d-btn sm', t('清除搜索', 'Clear search'));
      reset.type = 'button';
      reset.addEventListener('click', () => { search.value = ''; renderGrid(); search.focus(); });
      empty.append(reset); grid.append(empty);
    }
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
        preview.addEventListener('click', () => actions.cover(b, shown));
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
      titleEl.addEventListener('click', () => { if (!state.busy) actions.edit(b, 'button.title'); });
      titleEl.title = b.id;
      info.appendChild(titleEl);
      const metaRow = el('div', 'l2d-card-meta');
      const metadata = `${(b.bytes / 1048576).toFixed(1)} MB · ${clock(b.at)}`;
      const meta = el('span', 'meta', metadata);
      meta.title = metadata;
      metaRow.append(meta);
      const isInstalled = installedId === b.id;
      if (isInstalled) metaRow.append(el('span', 'tagline', t('已安装', 'Installed')));
      info.append(metaRow);
      card.appendChild(info);
      const adaptation = actions.adaptationDetails(b.adaptation);
      if (adaptation) {
        const details = el('button', 'l2d-adaptation-link', adaptation.title);
        details.type = 'button';
        details.setAttribute('aria-haspopup', 'dialog');
        details.title = adaptation.title;
        details.addEventListener('click', () => actions.showAdaptation(adaptation.detail));
        info.append(details);
      }

      const install = el('button', 'l2d-btn sm l2d-install', isInstalled ? t('重新安装', 'Reinstall') : t('安装', 'Install'));
      install.addEventListener('click', () => actions.install(b.id));
      const cardActions = el('div', 'l2d-card-actions');
      cardActions.appendChild(install);

      const row = el('div', 'row');
      const edit = el('button', 'l2d-btn sm l2d-card-edit', t('编辑', 'Edit'));
      edit.title = t('编辑名称、简介和取景', 'Edit name, description and framing');
      edit.setAttribute('aria-description', edit.title);
      edit.addEventListener('click', () => { if (!state.busy) actions.edit(b, '.l2d-card-edit'); });
      const del = el('button', 'l2d-btn sm danger', t('删除', 'Delete'));
      del.addEventListener('click', () => actions.remove(b.id));
      del.classList.add('quiet');
      if (b.manualAvailable) {
        const bind = el('button','l2d-btn sm l2d-card-binding');
        bind.type = 'button';
        bind.dataset.buildId = b.id;
        const spinner = el('span','l2d-spinner');
        spinner.setAttribute('aria-hidden','true');
        bind.append(el('span','l2d-card-binding-label'), spinner);
        actions.paintBinding(bind);
        bind.addEventListener('click', () => actions.bind(b.id));
        row.append(bind);
      }
      row.append(edit, del);
      cardActions.appendChild(row);
      card.appendChild(cardActions);
      for (const button of card.querySelectorAll('button')) button.disabled = state.busy;
      grid.appendChild(card);
    }
  }

  search.addEventListener('input', renderGrid);
  sort.addEventListener('change', renderGrid);
  return {
    render:renderGrid,
    dispose() {
      search.removeEventListener('input', renderGrid);
      sort.removeEventListener('change', renderGrid);
    },
  };
}
