function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const parts = [];
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunk)));
  }
  return btoa(parts.join(''));
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

function mountWorkbenchImport({ ctx, t, chooseFolder, chooseZip, folderInput, zipInput, dropZone, importView, clearSource, setBusy, isBusy, isDisposed }) {
  const listeners = new dropZone.ownerDocument.defaultView.AbortController();
  const on = (node, event, handler) => node.addEventListener(event, handler, {signal:listeners.signal});
  let activeImportToken = null;

  function ownImport(token) {
    if (activeImportToken === token) return;
    activeImportToken = token;
    if (token) ctx.notifyOnUnmount?.('importCancel', [token]);
  }

  function cancelOwnedImport(token) {
    if (!token) return;
    if (activeImportToken === token) activeImportToken = null;
    void ctx.invoke('importCancel', [token]).catch(() => {});
  }

  async function stageZip(file) {
    if (isBusy() || isDisposed()) return;
    if (file.size > FIGURE_IMPORT.zip) { importView.note(t('ZIP 太大', 'ZIP too large'), t('请解压后选择文件夹', 'Extract it and choose the folder'), true); return; }
    clearSource(); setBusy(true, t('读取 ZIP…', 'Reading ZIP…'));
    importView.loading(t('解包中…', 'Unpacking…'));
    try {
      const bytes = await file.arrayBuffer();
      if (isDisposed()) return;
      if (bytes.byteLength > FIGURE_IMPORT.zip) throw new Error(t('ZIP 超过 32 MB，请解压后导入文件夹', 'ZIP exceeds 32 MB; import the extracted folder'));
      importView.result(await ctx.invoke('importStage', [toBase64(bytes), 'zip']));
    } catch (error) { if (!isDisposed()) importView.note(t('导入失败', 'Import failed'), text(error), true); }
    finally { setBusy(false); }
  }

  async function stageFolder(files, view) {
    if (isBusy() || isDisposed()) return;
    const picked = packFiles(files, 3);
    if (!picked.length) { view.note(t('这里没有模型包', 'No model pack here'), t('没有找到 Live2D 模型或现成形象包', 'No Live2D model or figure pack found'), false); return; }
    if (picked.length > FIGURE_IMPORT.files || picked.reduce((n, f) => n + (Number(f.file.size) || 0), 0) > FIGURE_IMPORT.folder) { view.note(t('目录过大', 'Folder too large'), t('请改用粘贴本机目录路径', 'Paste its local directory path instead'), true); return; }
    clearSource(); setBusy(true, t('读取文件夹…', 'Reading folder…'));
    view.loading(t('读取文件夹…', 'Reading folder…'));
    let token;
    try {
      token = (await ctx.invoke('importBegin', [])).token;
      if (isDisposed()) { cancelOwnedImport(token); return; }
      ownImport(token);
      let batch = [], bytes = 0;
      const flush = async () => { if (batch.length) { await ctx.invoke('importAppend', [token, batch]); batch = []; bytes = 0; } };
      for (const item of picked) {
        if (isDisposed()) return;
        if (item.file.size > FIGURE_IMPORT.file && typeof item.file.slice === 'function') {
          await flush();
          for (let offset = 0; offset < item.file.size; offset += FIGURE_IMPORT.chunk) {
            const data = await item.file.slice(offset, offset + FIGURE_IMPORT.chunk).arrayBuffer();
            if (isDisposed()) return;
            await ctx.invoke('importAppendChunk', [token, {path:item.path,offset,total:item.file.size,b64:toBase64(data)}]);
          }
        } else {
          const data = await item.file.arrayBuffer();
          if (isDisposed()) return;
          if (data.byteLength > FIGURE_IMPORT.file) throw Error(t('文件太大，无法分块读取', 'The file is too large to read without chunks'));
          if (bytes + data.byteLength > FIGURE_IMPORT.batch) await flush();
          batch.push({path:item.path,b64:toBase64(data)});
          bytes += data.byteLength;
        }
      }
      await flush();
      if (!isDisposed()) view.result(await ctx.invoke('importFinish', [token, true]));
    } catch (error) {
      if (!isDisposed()) {
        view.note(t('导入失败', 'Import failed'), text(error), true);
        cancelOwnedImport(token);
      }
    } finally { setBusy(false); }
  }

  async function importPaths(paths) {
    if (isBusy() || isDisposed() || !paths.length) return;
    clearSource();
    setBusy(true, t('读取…', 'Reading…'));
    importView.loading(t('识别模型…', 'Recognizing model…'));
    try { const result = await ctx.invoke('importPaths', [paths]); if (!isDisposed()) importView.result(result); }
    catch (e) { if (!isDisposed()) importView.note(t('导入失败', 'Import failed'), text(e), true); }
    finally { setBusy(false); }
  }

  async function importFiles(files) {
    if (isBusy() || isDisposed() || !files.length) return;
    const local = files.map(f => f.path || f.file.path).filter(p => /^[a-z]:[\\/]/i.test(p || '') || p?.startsWith('/'));
    if (local.length === files.length) return importPaths(local);
    if (files.length === 1 && /\.zip$/i.test(files[0].path)) return stageZip(files[0].file);
    if (files.length === 1 && /\.json$/i.test(files[0].path)) {
      importView.note(t('缺少同目录资源', 'Sibling files required'), t('请选择入口文件的完整路径，或拖入整个模型文件夹', 'Choose the entry file by its local path, or drop the whole model folder'), true); return;
    }
    return stageFolder(files, importView);
  }

  // Browser inputs are owned by the Coo window and open its native system dialogs.
  on(chooseFolder, 'click', () => { if (!isBusy()) folderInput.click(); });
  on(chooseZip, 'click', () => { if (!isBusy()) zipInput.click(); });
  on(folderInput, 'change', async () => {
    if (isDisposed() || isBusy()) return;
    const files = [...(folderInput.files ?? [])].map(file => ({ path: file.webkitRelativePath || file.name, file }));
    if (!files.length) return;
    try { await stageFolder(files, importView); }
    catch (e) { importView.note(t('导入失败', 'Import failed'), text(e), true); }
    finally { folderInput.value = ''; }
  });
  on(zipInput, 'change', async () => {
    if (isDisposed() || isBusy()) return;
    try { await importFiles([...(zipInput.files ?? [])].map(file => ({ path: file.name, file }))); }
    catch (e) { importView.note(t('导入失败', 'Import failed'), text(e), true); }
    finally { zipInput.value = ''; }
  });
  on(dropZone, 'click', event => {
    if (!event.target.closest('button')) dropZone.focus({preventScroll:true});
  });
  on(dropZone, 'paste', async (event) => {
    event.preventDefault();
    if (isBusy()) return;
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
      if (isDisposed()) return;
      if (paths.length) return await importPaths(paths);
      const files = clipboardFiles.map(file => ({ path: file.name, file }));
      if (files.length) return await importFiles(files);
      importView.note(t('未读到模型', 'No model found'), t('请复制文件、文件夹，或其完整路径后粘贴', 'Copy files, a folder, or their full local path, then paste'), false);
    } catch (e) { importView.note(t('粘贴失败', 'Paste failed'), text(e), true); }
  });
  on(dropZone, 'dragover', event => { event.preventDefault(); if (!isBusy()) dropZone.classList.add('over'); });
  on(dropZone, 'dragleave', event => { if (!dropZone.contains(event.relatedTarget)) dropZone.classList.remove('over'); });
  on(dropZone, 'drop', async event => {
    event.preventDefault(); dropZone.classList.remove('over');
    if (isBusy() || isDisposed()) return;
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
        if (isDisposed()) return;
        if (entry.isDirectory) files.push(...await droppedFiles(entry, entry.name, 3));
        else files.push({path:entry.name,file:await new Promise((ok,bad)=>entry.file(ok,bad))});
      }
      setBusy(false);
      if (!isDisposed()) {
        const captured = files.length ? files : plain;
        if (!captured.length) throw new Error(t('未读到文件，请拖入模型文件夹或 ZIP', 'No files found; drop a model folder or ZIP'));
        await importFiles(captured);
      }
    } catch (error) { if (!isDisposed()) importView.note(t('导入失败', 'Import failed'), text(error), true); }
    finally { setBusy(false); }
  });
  return {
    ownImport, cancelOwnedImport,
    dispose() {
      listeners.abort();
      if (!ctx.signal?.aborted) cancelOwnedImport(activeImportToken);
    },
  };
}
