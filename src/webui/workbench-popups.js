function createWorkbenchPopups({ctx, shell, el, t, resultButton, resultBody, resultFeedback}) {
  let current = null;
  function showPopup(title, body, options = {}) {
    current?.dispose();
    const handle = openFigureDialog(shell, title, body, {
      closeLabel:t('关闭','Close'), ...options,
      onClose() { if (current === handle) current = null; options.onClose?.(); },
    });
    current = handle;
    return handle;
  }
  function reportResult(heading, lines = [], bad = false, figureId) {
    resultFeedback.replaceChildren();
    if (heading) resultFeedback.append(el('strong', null, heading));
    for (const line of lines) if (line) resultFeedback.append(el('p', null, line));
    if (figureId) {
      const row = el('div', 'l2d-install-next');
      const dress = wardrobeLink(el, t('前往装扮穿戴', 'Wear in Dress up'), 'l2d-btn sm primary');
      const configure = el('a', 'l2d-btn sm', t('打开模型设置', 'Open Model settings'));
      configure.href = '#/provider/world%3Afigure/settings';
      const feedback = el('p', 'l2d-install-feedback');
      feedback.setAttribute('role', 'status');
      feedback.textContent = t('穿戴后可在模型设置选择该形象，启用编排或语音口型。', 'Once worn, select the figure in Model settings to enable planning or audio lip sync.');
      row.append(dress, configure);
      resultFeedback.append(row, feedback);
    }
    resultFeedback.classList.toggle('has-error', bad);
    resultButton.classList.toggle('has-error', bad);
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

  const openResults = (returnFocus = resultButton) =>
    showPopup(t('进展与结果', 'Progress & results'), resultBody, {variant:'l2d-result-popup', returnFocus});
  return {show:showPopup, openCover, openResults, reportResult, isOpen:() => current !== null, dispose:() => current?.dispose()};
}
