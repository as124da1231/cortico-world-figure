const studioRoot = document.querySelector('.figure-studio');
const zhStudio = document.documentElement.lang.startsWith('zh');
const studioText = (zh, en) => zhStudio ? zh : en;

function studioElement(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
}

function createStudioPreview() {
  let gallery, status, pause, zoomControl, zoomValue, observer, onFailure;
  let frame, frameSize, boot, finishBoot, failBoot, bootTimer, animation;
  let initialized = false, rendered = false, paused = false, waiting = false;
  let previousTime = 0, revision = 0;
  let zoom = 1, panX = 0, panY = 0, drag = null;
  const side = 720;
  const bounds = { W: side, H: side, floorY: side * .89, S: side * .76 / 256 };
  const scene = new URL('scene/', location.href);
  const send = message => frame?.contentWindow?.postMessage(message, '*');
  const setStatus = (name, text) => {
    status.dataset.state = name;
    status.textContent = text;
  };
  const updatePause = () => {
    pause.textContent = paused ? studioText('继续', 'Resume') : studioText('暂停', 'Pause');
    pause.setAttribute('aria-pressed', String(paused));
  };
  function applyView() {
    const width = gallery.clientWidth, height = gallery.clientHeight;
    const fit = Math.min(width, height) / side;
    const limitX = width * .48 + height * .15 * zoom;
    const limitY = height * (.3 + .48 * zoom);
    panX = Math.max(-limitX, Math.min(limitX, panX));
    panY = Math.max(-limitY, Math.min(limitY, panY));
    if (frame) frame.style.transform = `translate(-50%, -50%) translate(${panX}px, ${panY}px) scale(${fit * zoom})`;
    zoomControl.value = String(Math.round(zoom * 100));
    zoomValue.value = Math.round(zoom * 100) + '%';
  }
  function zoomTo(value, anchorX = 0, anchorY = 0) {
    const next = Math.max(.5, Math.min(2.5, value));
    const ratio = next / zoom;
    panX = anchorX + (panX - anchorX) * ratio;
    panY = anchorY + (panY - anchorY) * ratio;
    zoom = next;
    applyView();
  }
  function resetView() {
    zoom = 1;
    panX = panY = 0;
    applyView();
  }
  function mountViewControls(toolbar) {
    gallery.tabIndex = 0;
    gallery.setAttribute('aria-label', studioText('实时预览。拖动平移，滚轮缩放', 'Live preview. Drag to pan or scroll to zoom'));
    gallery.addEventListener('wheel', event => {
      if (event.ctrlKey || event.metaKey || !event.deltaY) return;
      event.preventDefault();
      const rect = gallery.getBoundingClientRect();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1;
      const delta = Math.max(-120, Math.min(120, event.deltaY * unit));
      zoomTo(zoom * Math.exp(-delta / 620), event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height / 2);
    }, { passive: false });
    gallery.onpointerdown = event => {
      if (event.button !== 0 || drag) return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, panX, panY };
      gallery.setPointerCapture(event.pointerId);
      gallery.setAttribute('data-dragging', '');
    };
    gallery.onpointermove = event => {
      if (drag?.id !== event.pointerId) return;
      panX = drag.panX + event.clientX - drag.x;
      panY = drag.panY + event.clientY - drag.y;
      applyView();
    };
    const endDrag = event => {
      if (drag?.id !== event.pointerId) return;
      drag = null;
      gallery.removeAttribute('data-dragging');
    };
    gallery.onpointerup = gallery.onpointercancel = gallery.onlostpointercapture = endDrag;
    gallery.onkeydown = event => {
      if (event.key === '+' || event.key === '=') zoomTo(zoom + .1);
      else if (event.key === '-') zoomTo(zoom - .1);
      else if (event.key === '0') resetView();
      else {
        const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
        if (!direction) return;
        panX += direction[0] * 18;
        panY += direction[1] * 18;
        applyView();
      }
      event.preventDefault();
    };
    const zoomLabel = studioElement('label', 'figure-zoom', studioText('缩放', 'Zoom'));
    zoomControl = studioElement('input');
    Object.assign(zoomControl, { type: 'range', min: '50', max: '250', step: '5', value: '100' });
    zoomControl.oninput = () => zoomTo(Number(zoomControl.value) / 100);
    zoomValue = studioElement('output', 'figure-zoom-value', '100%');
    zoomLabel.append(zoomControl, zoomValue);
    const reset = studioElement('button', 'l2d-btn sm', studioText('重置视图', 'Reset view'));
    reset.type = 'button';
    reset.onclick = resetView;
    toolbar.append(zoomLabel, reset);
    observer = new ResizeObserver(applyView);
    observer.observe(gallery);
  }
  function tick(now) {
    animation = 0;
    if (!initialized || paused) return;
    if (!waiting) {
      const dt = previousTime ? Math.min(.05, (now - previousTime) / 1000) : 1 / 60;
      previousTime = now;
      waiting = true;
      send({ t: 'tick', dt });
    }
    animation = requestAnimationFrame(tick);
  }
  function resume() {
    paused = false;
    previousTime = 0;
    updatePause();
    if (!animation && initialized) animation = requestAnimationFrame(tick);
  }
  function disposeFrame() {
    cancelAnimationFrame(animation);
    clearTimeout(bootTimer);
    animation = 0;
    initialized = rendered = waiting = false;
    frame?.remove();
    frame = null;
    failBoot?.(Error(studioText('预览已关闭', 'Preview closed')));
    finishBoot = failBoot = null;
  }
  function failed(message) {
    setStatus('error', studioText('预览不可用', 'Preview unavailable'));
    failBoot?.(Error(message));
    disposeFrame();
    onFailure?.(message);
  }
  function receive(event) {
    if (!frame || event.source !== frame.contentWindow || event.origin !== 'null') return;
    const message = event.data;
    if (message?.t === 'loaded') {
      send({
        t: 'init', bounds, previewSize: frameSize, theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
        start: { x: bounds.W / 2, y: bounds.floorY, facing: 1 },
        language: document.documentElement.lang, scheme: '',
        entry: new URL('pack/figure.js', scene).href,
        export: 'createFigureBody', base: new URL('pack/', scene).href,
      });
    } else if (message?.t === 'ready') {
      initialized = true;
      send({ t: 'set', state: { roam: 'off' } });
      send({ t: 'preview-info' });
      resume();
    } else if (message?.t === 'frame') {
      waiting = false;
      if (!rendered) send({ t: 'preview-info' });
    } else if (message?.t === 'preview-info') {
      if (message.quality?.error) failed(String(message.quality.error));
      else if (message.ready && !rendered) {
        rendered = true;
        clearTimeout(bootTimer);
        setStatus('live', studioText('实时', 'Live'));
        finishBoot?.();
        finishBoot = failBoot = null;
      }
    } else if (message?.t === 'error') {
      failed(String(message.message || studioText('模型加载失败', 'Model loading failed')));
    }
  }
  function start(previewSize) {
    disposeFrame();
    frameSize = previewSize;
    setStatus('loading', studioText('载入模型', 'Loading'));
    boot = new Promise((resolve, reject) => { finishBoot = resolve; failBoot = reject; });
    bootTimer = setTimeout(() => failed(studioText('载入模型超时', 'Model loading timed out')), 25000);
    frame = studioElement('iframe', 'figure-preview-frame');
    frame.title = studioText('实时形象预览', 'Live figure preview');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.src = scene.href;
    frame.style.width = frame.style.height = side + 'px';
    gallery.replaceChildren(frame);
    applyView();
  }
  return {
    mount(elements) {
      gallery = elements.gallery;
      onFailure = elements.onFailure;
      const bar = studioElement('div', 'figure-preview-heading');
      status = studioElement('span', 'figure-live-status', studioText('准备预览', 'Preparing'));
      const guide = studioElement('span', 'figure-view-guide', studioText('拖动平移 · 滚轮缩放', 'Drag to pan · Scroll to zoom'));
      bar.append(studioElement('h2', '', studioText('形象预览', 'Figure preview')), guide, status, elements.resolutionLabel);
      elements.stage.prepend(bar);
      pause = studioElement('button', 'l2d-btn sm figure-pause', studioText('暂停', 'Pause'));
      pause.type = 'button';
      pause.onclick = () => {
        if (!rendered) return;
        if (paused) resume();
        else { paused = true; updatePause(); }
      };
      elements.playbackControls.prepend(pause);
      const viewControls=studioElement('div','figure-view-controls');
      elements.toolbar.append(viewControls);
      mountViewControls(viewControls);
      window.addEventListener('message', receive);
    },
    async play(request) {
      const current = ++revision;
      if (!frame || frameSize !== request.previewSize) start(request.previewSize);
      await boot;
      if (current !== revision || !frame) return;
      const wardrobe = request.page === 'wardrobe';
      send({ t: 'preview-wardrobe', groups: request.groups, picks: request.picks });
      const selected = request.bindings.find(item => item.word === request.word && item.resource === request.resource);
      const bindings = request.resource ? [{
        ...selected, word: request.word, resource: request.resource, overlays: request.overlays,
        nativeOnly: request.nativeOnly === true,
      }] : [];
      send({
        t: 'preview-play', resource: wardrobe ? null : request.resource, word: wardrobe ? 'neutral' : request.word,
        bindings: wardrobe ? [] : bindings, raw: wardrobe || request.raw,
      });
      resume();
    },
    dispose() {
      revision++;
      observer?.disconnect();
      window.removeEventListener('message', receive);
      disposeFrame();
    },
  };
}

async function studioRequest(path, value, owner, keepalive = false) {
  const headers = {};
  if (owner) headers.authorization = `Bearer ${owner}`;
  if (value !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(new URL(path, location.href), {
    method: value === undefined ? 'GET' : 'POST', headers,
    body: value === undefined ? undefined : JSON.stringify(value), keepalive,
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const message = result?.code === 'occupied'
      ? studioText('已有编辑页，请回到原标签页继续。', 'An editor is already open. Continue in the original tab.')
      : result?.error || studioText('编辑会话已结束，请从 Coo 重新打开。', 'Session ended. Reopen the editor from Coo.');
    throw Object.assign(Error(message), { code: result?.code, retry: result?.retry === true });
  }
  return result;
}

const toast = document.querySelector('.figure-studio-toast');
let toastTimer;
function showStudioToast(message, kind) {
  clearTimeout(toastTimer);
  (studioRoot.querySelector('.figure-studio-dialog[open]') ?? document.body).append(toast);
  toast.textContent = message;
  toast.dataset.kind = kind ?? '';
  toastTimer = setTimeout(() => { toast.textContent = ''; }, 4400);
}

function showStudioResult(title, message, note) {
  const panel = studioElement('section', 'figure-studio-result');
  panel.append(studioElement('h1', '', title), studioElement('p', '', message));
  if (note) panel.append(studioElement('p', 'figure-result-note', note));
  studioRoot.replaceChildren(panel);
}

async function startStudio() {
  const storageKey = `figure-editor:${location.pathname}`;
  let resume;
  try { resume = sessionStorage.getItem(storageKey) || undefined; } catch {}
  let active = true, suspended = false;
  let lease, connecting, lastOwner, staged, submission, bindingUI;
  let revision = 0, stagedRevision = 0;
  let saving = false;

  const expired = () => Error(studioText('编辑连接已中断，请从 Coo 重新打开。', 'The editing connection was lost. Reopen it from Coo.'));
  async function connect() {
    for (let attempt = 0; attempt < 8 && active && !suspended; attempt++) {
      let claim;
      try { claim = await studioRequest('claim', { resume }); }
      catch (error) {
        if (error instanceof TypeError) throw expired();
        if (!error.retry || attempt === 7) throw error;
        await new Promise(resolve => setTimeout(resolve, 250));
        continue;
      }
      lastOwner = claim.owner;
      resume = claim.resume;
      try { sessionStorage.setItem(storageKey, resume); } catch {}
      if (!active || suspended) {
        void studioRequest('detach', {}, claim.owner, true).catch(() => {});
        throw expired();
      }
      const controller = new AbortController();
      const response = await fetch(new URL('events', location.href), {
        headers: { authorization: `Bearer ${claim.owner}` }, signal: controller.signal,
      });
      if (!response.ok || !response.body) throw expired();
      if (!active || suspended) { controller.abort(); throw expired(); }
      const current = { ...claim, controller };
      lease = current;
      bindingUI?.setConnection(true);
      void observe(current, response.body.getReader());
      if (staged) void persistDraft(staged, current);
      return current;
    }
    throw expired();
  }

  function ensureLease() {
    if (!active || suspended) return Promise.reject(expired());
    return lease ? Promise.resolve(lease) : (connecting ??= connect().finally(() => { connecting = null; }));
  }

  function reconnect() {
    if (!active || suspended || lease) return;
    void ensureLease().catch(error => {
      if (!active || suspended) return;
      bindingUI?.setConnection(false, error.message);
      showStudioToast(error.message, 'bad');
    });
  }

  async function observe(current, reader) {
    try { while (!(await reader.read()).done) {} } catch {}
    finally {
      reader.releaseLock();
      if (active && lease === current) {
        lease = null;
        reconnect();
      }
    }
  }

  async function persistDraft(update, current) {
    try {
      await studioRequest('draft', update, current.owner);
      stagedRevision = Math.max(stagedRevision, update.revision);
    } catch {}
  }

  async function closeLease() {
    active = false;
    try {
      if (lastOwner) await studioRequest('close', {}, lastOwner, true);
      try { sessionStorage.removeItem(storageKey); } catch {}
    } finally { lease?.controller.abort(); }
  }

  window.addEventListener('pagehide', () => {
    if (!active) return;
    suspended = true;
    if (lastOwner) void studioRequest('detach', {}, lastOwner, true).catch(() => {});
    const current = lease;
    lease = null;
    current?.controller.abort();
  });
  window.addEventListener('pageshow', () => { suspended = false; reconnect(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) reconnect(); });
  const first = await ensureLease();
  const data = first.data;
  document.title = data.title + ' · Figure';
  const showSaved = result => showStudioResult(studioText('已保存', 'Saved'), studioText('回到 Coo，从原模型卡安装即可应用。', 'Return to Coo and install from the original figure card.'), result?.warn);
  if (first.saved) {
    showSaved(first.saved);
    void closeLease().catch(() => {});
    return;
  }
  const ctx = {
    root: studioRoot,
    language: document.documentElement.lang,
    studio: createStudioPreview(),
    ui: { toast: showStudioToast },
    stageDraft(value) {
      const update = staged = { revision: ++revision, draft: value };
      if (lease) void persistDraft(update, lease);
    },
    guardLeave(message) {
      const listener = event => {
        if (message() && (saving || stagedRevision < revision)) { event.preventDefault(); event.returnValue = ''; }
      };
      window.addEventListener('beforeunload', listener);
      return { dispose: () => window.removeEventListener('beforeunload', listener) };
    },
    async invoke(method, args) {
      if (method === 'manualOpenBuild') return data;
      if (method === 'manualClose') return closeLease();
      const current = await ensureLease();
      if (method === 'manualSkipImages') return studioRequest('skip-images', {}, current.owner);
      if (method === 'manualSaveProgress') return studioRequest('save-progress', undefined, current.owner);
      if (method === 'manualSave') {
        const value = { bindings: args[1], wardrobe: args[2] };
        const fingerprint = JSON.stringify(value);
        if (submission?.fingerprint !== fingerprint) submission = { id: crypto.randomUUID(), fingerprint };
        const body = { ...value, id: submission.id };
        saving = true;
        try { return await studioRequest('save', body, current.owner); }
        catch (error) {
          if (!active || (!(error instanceof TypeError) && error.code !== 'expired')) throw error;
          if (lease === current) { lease = null; current.controller.abort(); }
          const reconnected = await ensureLease();
          return await studioRequest('save', body, reconnected.owner);
        } finally { saving = false; }
      }
      throw Error('Unsupported editor action');
    },
  };
  bindingUI = await openBindingEditor(ctx, 'manualOpenBuild', [], showSaved, () => {
    showStudioResult(studioText('编辑已结束', 'Editor closed'), studioText('可以关闭此标签页并回到 Coo。', 'You can close this tab and return to Coo.'));
  });
  if (data.draft) showStudioToast(studioText('已恢复最近一次暂存的草稿。', 'Restored the latest staged draft.'), 'ok');
}

startStudio().catch(error => showStudioResult(studioText('编辑器打开失败', 'Editor unavailable'), error.message));
