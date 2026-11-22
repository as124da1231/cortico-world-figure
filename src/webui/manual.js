const figurePreviewChoices = t => [['1024','1024 px'],['2048','2048 px'],['unlimited',t('无上限','Unlimited')]];

function openFigureDialog(parent, title, body, { closeLabel, variant = '', onClose, returnFocus, locked = () => false } = {}) {
  const doc = parent.ownerDocument;
  const previous = doc.activeElement;
  const dialog = doc.createElement('dialog');
  dialog.className = `l2d-modal l2d-popup ${variant}`.trim();
  dialog.setAttribute('aria-label', title);
  dialog.setAttribute('aria-modal', 'true');
  const card = doc.createElement('div'); card.className = 'l2d-popup-card';
  const head = doc.createElement('header'); head.className = 'l2d-popup-head';
  const heading = doc.createElement('h3'); heading.textContent = title;
  const close = doc.createElement('button'); close.type = 'button';
  close.className = 'l2d-btn quiet l2d-modal-close'; close.textContent = '×';
  close.setAttribute('aria-label', closeLabel || 'Close');
  const content = doc.createElement('div'); content.className = 'l2d-popup-body';
  let closed = false;
  function dispose() {
    if (closed) return;
    closed = true;
    dialog.close(); dialog.remove();
    onClose?.();
    const target = typeof returnFocus === 'function' ? returnFocus() : returnFocus ?? previous;
    if (target?.isConnected) target.focus?.({preventScroll:true});
  }
  const requestClose = () => { if (!locked()) dispose(); };
  close.addEventListener('click', requestClose);
  // Keep Escape inside this layer so a host drawer beneath it keeps its draft.
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    event.preventDefault(); event.stopPropagation(); requestClose();
  });
  dialog.addEventListener('cancel', event => {
    event.preventDefault(); event.stopPropagation(); requestClose();
  });
  dialog.addEventListener('click', event => { if (event.target === dialog) requestClose(); });
  content.append(body); head.append(heading, close); card.append(head, content); dialog.append(card);
  parent.append(dialog); dialog.showModal(); close.focus({preventScroll:true});
  return {el:dialog,dispose};
}

// A host overlay outside showModal() is inert. Keep discard confirmation in the same top layer.
function bindingDiscardPrompt(parent,zh=true,options={}) {
  const doc=parent.ownerDocument,previous=doc.activeElement,t=(a,b)=>zh?a:b;
  const prompt=doc.createElement('dialog');prompt.className='l2d-modal l2d-bind-discard';
  prompt.setAttribute('aria-label',options.title||t('放弃未保存的绑定？','Discard unsaved bindings?'));
  const card=doc.createElement('div');card.className='l2d-modal-card';
  const title=doc.createElement('div');title.className='l2d-modal-title';title.textContent=prompt.getAttribute('aria-label');
  const body=doc.createElement('p');body.className='l2d-bind-discard-text';body.textContent=options.body||t('本次未保存的修改会丢失，已保存的绑定不受影响。','Unsaved changes will be lost. Saved bindings are kept.');
  const actions=doc.createElement('div');actions.className='l2d-dialog-actions';
  const keep=doc.createElement('button'),discard=doc.createElement('button');keep.className='l2d-btn';discard.className='l2d-btn primary';
  keep.textContent=options.cancel||t('继续编辑','Keep editing');discard.textContent=options.accept||t('放弃修改','Discard changes');
  let done=false,resolve;const result=new Promise(r=>{resolve=r;});
  const settle=value=>{if(done)return;done=true;prompt.close();prompt.remove();if(parent.isConnected&&parent.open)previous?.focus?.();resolve(value);};
  keep.onclick=()=>settle(false);discard.onclick=()=>settle(true);
  prompt.addEventListener('cancel',e=>{e.preventDefault();e.stopPropagation();settle(false);});
  prompt.addEventListener('click',e=>{e.stopPropagation();if(e.target===prompt)settle(false);});
  prompt.addEventListener('close',()=>settle(false));
  actions.append(keep,discard);card.append(title,body,actions);prompt.append(card);parent.append(prompt);prompt.showModal();keep.focus();
  return {result,dispose:()=>settle(false)};
}

async function openBindingEditor(ctx,method,args,onSaved,onClosed) {
  const doc=ctx.root.ownerDocument,win=doc.defaultView,zh=String(ctx.language||'zh').startsWith('zh'),t=(a,b)=>zh?a:b;
  const studio=ctx.studio;
  const names={neutral:'中性',happy:'开心',wink:'眨眼',love:'喜欢',shy:'害羞',surprised:'惊讶',angry:'生气',sad:'难过',sleepy:'困倦',thinking:'思考',smug:'得意',pout:'嘟嘴',worried:'担心',determined:'坚定',flustered:'慌乱',scared:'害怕',excited:'兴奋',cry:'哭泣',confused:'疑惑',idle:'待机',nod:'点头',shake:'摇头',wave:'挥手',bow:'鞠躬',cheer:'欢呼',dance:'跳舞',jump:'跳跃',sit:'坐下',stretch:'伸展',shiver:'发抖'};
  const label=w=>zh?names[w]||w:w;
  const el=(tag,cls,text)=>{const n=doc.createElement(tag);n.className=cls||'';if(text!=null)n.textContent=text;return n;};
  const previous=doc.activeElement;
  const requestedToken=win.crypto?.randomUUID?.();
  if(requestedToken)ctx.notifyOnUnmount?.('manualClose',[requestedToken]);
  const modal=el('dialog','l2d-modal l2d-bind-modal'+(studio?' figure-studio-dialog':''));modal.setAttribute('aria-label',t('动作与装扮','Actions and wardrobe'));
  const card=el('div','l2d-bind-card'),head=el('div','l2d-modal-head'),heading=el('div','l2d-modal-heading');
  heading.append(el('div','l2d-modal-title',t('动作与装扮','Actions and wardrobe')),el('div','l2d-modal-sub',t('选择表情或动作，可预览效果','Choose a target and preview its effect')));
  const close=el('button','l2d-btn quiet l2d-modal-close','×');close.setAttribute('aria-label',t('关闭动作与装扮','Close editor'));head.append(heading,close);
  const layout=el('div','l2d-bind-layout'),left=el('nav','l2d-bind-targets'),stage=el('section','l2d-bind-stage'),right=el('section','l2d-bind-resources');
  left.setAttribute('aria-label',t('绑定目标','Binding targets'));right.setAttribute('aria-label',t('原生资源','Native resources'));
  const gallery=el('div','l2d-bind-gallery');gallery.setAttribute('aria-label',t('模型效果对照','Model comparison'));gallery.setAttribute('aria-live','polite');
  const hint=el('p','l2d-bind-status',t('准备预览…','Preparing preview…'));hint.setAttribute('role','status');
  const toolbar=el('div','l2d-bind-toolbar'),raw=el('button','l2d-btn sm',t('完整效果','Full effect')),replay=el('button','l2d-btn sm',studio?t('重播','Replay'):t('重新取样','Resample')),reset=el('button','l2d-btn sm',t('查看组合','View combination'));
  const previewModes=studio?el('div','figure-preview-modes'):raw;
  const playbackControls=studio?el('div','figure-playback-controls'):null;
  const returnPreview=studio?el('button','l2d-btn quiet sm figure-preview-return',t('结束试看','End preview')):null;
  const full=studio?el('button','l2d-btn sm',t('完整','Combined')):null;
  if(studio){
    previewModes.setAttribute('role','group');previewModes.setAttribute('aria-label',t('预览模式','Preview mode'));
    raw.textContent=t('原生','Native');raw.title=t('只看模型自带的效果','Model effects only');
    full.title=t('按安装后的播放设置预览','Preview the installed playback settings');
    const modeButtons=el('div','figure-preview-mode-buttons');
    modeButtons.append(raw,full);
    previewModes.append(el('span','figure-preview-mode-label',t('预览模式','Preview mode')),modeButtons);
    playbackControls.append(replay);
    returnPreview.hidden=true;
  }
  const retry=el('button','l2d-btn sm l2d-bind-retry',t('重试预览','Retry preview'));retry.hidden=true;
  const resolutionLabel=el('label','l2d-bind-quality',t('预览精度','Preview size')),resolution=el('select','l2d-input');resolution.setAttribute('aria-label',t('预览精度','Preview resolution'));
  for(const [value,label] of figurePreviewChoices(t)){const option=el('option',null,label);option.value=value;resolution.append(option);}
  resolutionLabel.append(resolution);
  const leftShell=el('div','l2d-bind-left'),pages=el('div','l2d-bind-pages');pages.setAttribute('role','tablist');pages.setAttribute('aria-label',t('编辑页面','Editor pages'));
  const groupTools=el('div','l2d-wardrobe-tools');
  const newGroup=el('button','l2d-btn sm l2d-bind-newgroup',t('＋ 新建分组','＋ New group'));
  newGroup.type='button';newGroup.setAttribute('aria-haspopup','dialog');
  groupTools.hidden=true;
  groupTools.append(el('h3',null,t('分组','Groups')),newGroup);
  leftShell.append(pages,groupTools,left);
  stage.append(gallery);
  if(studio){
    const caption=el('div','figure-preview-caption');
    caption.append(hint,returnPreview,retry);
    toolbar.append(playbackControls,previewModes);
    stage.append(caption,toolbar);
  }else{
    toolbar.append(previewModes,replay,reset,resolutionLabel,retry);
    stage.append(hint,toolbar);
  }
  let editorNavigation;
  function showEditorPane(next) {
    if (!editorNavigation) return;
    layout.dataset.editorPane = next;
    for (const control of editorNavigation.children) {
      control.setAttribute('aria-pressed', String(control.dataset.pane === next));
    }
  }
  if (studio) {
    editorNavigation = el('div','figure-editor-navigation');
    editorNavigation.setAttribute('role','group');
    editorNavigation.setAttribute('aria-label',t('编辑面板','Editor panes'));
    for (const [key, name, target] of [
      ['targets', t('绑定目标','Binding targets'), leftShell],
      ['resources', t('原生资源','Native resources'), right],
    ]) {
      target.id = `figure-studio-${key}`;
      const control = el('button','l2d-btn sm',name);
      control.type = 'button';
      control.dataset.pane = key;
      control.setAttribute('aria-controls', target.id);
      control.onclick = () => showEditorPane(key);
      editorNavigation.append(control);
    }
    layout.append(editorNavigation);
    showEditorPane('targets');
  }
  layout.append(leftShell,stage,right);
  studio?.mount({stage,gallery,toolbar,playbackControls,resolutionLabel,onFailure(message){
    if(closed)return;
    hint.textContent=t('预览失败。','Preview failed. ')+message;
    retry.hidden=false;
  }});
  const footer=el('div','l2d-bind-footer'),summary=el('span','l2d-bind-summary',t('未绑定的项目使用通用配方','Unbound targets use generic recipes'));
  const footInfo=el('div','l2d-bind-footinfo');
  const saveStatus=el('span','l2d-bind-save-status');
  saveStatus.setAttribute('role','status');
  saveStatus.hidden=true;
  footInfo.append(summary,saveStatus);
  const saveStages=[
    ['check',t('检查绑定','Checking bindings')],
    ['pack',t('打包形象','Building figure pack')],
    ['images',t('处理预览图片','Preparing preview images')],
    ['commit',t('保存到模型卡','Saving to the model card')],
  ];
  const saveProgress=el('div','l2d-bind-save-progress');
  saveProgress.setAttribute('role','progressbar');
  saveProgress.setAttribute('aria-label',t('保存进度','Save progress'));
  saveProgress.setAttribute('aria-valuemin','0');
  saveProgress.setAttribute('aria-valuemax',String(saveStages.length));
  saveProgress.hidden=true;
  for(const _ of saveStages)saveProgress.append(el('span'));
  const cancel=el('button','l2d-btn',t('取消','Cancel')),save=el('button','l2d-btn primary l2d-bind-save',t('保存绑定','Save bindings'));save.disabled=true;
  const restoreAll=el('button','l2d-btn quiet sm',t('全部恢复通用','Reset all to generic'));restoreAll.disabled=true;
  const skipImages=el('button','l2d-btn',t('跳过图片','Skip images'));skipImages.hidden=true;
  footer.append(saveProgress,footInfo,restoreAll,cancel,skipImages,save);card.append(head,layout,footer);modal.append(card);ctx.root.append(modal);modal.showModal();
  let closed=false,saving=false,saveSequence=0,skippingImages=false,dirty=false,data,bindings=[],word='happy',resource=null,rawMode=!!studio,serial=0,previewTimer,sampleSet=0,discardPrompt=null,leaseTimer,sessionValid=true,previewDialog=null;
  let saveStage=-1,saveProgressTimer;
  let connected=true;
  let combinationError='',pendingCombination=null,auditionNativeOnly=false;
  let page='actions',groups=[],picks={},groupId=null,optionId='default',optionNameDraft=null,closeGroupDialog;
  const pageState={actions:{resource:null,filter:'all',search:'',scroll:0},wardrobe:{resource:null,filter:'all',search:'',scroll:0}};
  const uid=prefix=>prefix+(win.crypto?.randomUUID?.().replaceAll('-','')||Math.random().toString(16).slice(2)).slice(0,12);
  const signature=items=>JSON.stringify(items.map(({word,resource,overlays=[],release,nativeOnly})=>({word,resource,overlays:[...overlays].sort(),...(release?{release}:{}),...(nativeOnly?{nativeOnly:true}:{})})).sort((a,b)=>a.word.localeCompare(b.word)));
  const canEdit=()=>!!data&&sessionValid&&connected&&!saving;
  const canSave=()=>canEdit()&&(!data.buildId||dirty||data.wardrobeNeedsSave);
  const syncPreviewMode=()=>{
    raw.setAttribute('aria-pressed',String(rawMode));
    if(full)full.setAttribute('aria-pressed',String(!rawMode));
    else raw.textContent=rawMode?t('原生效果','Native only'):t('完整效果','Full effect');
  };
  function syncPreviewControls(){
    if(!studio){previewModes.hidden=page==='wardrobe';return;}
    const current=bindings.find(item=>item.word===word);
    const preview=page==='actions'?(resource??data?.resources.find(item=>item.id===current?.resource)):null;
    previewModes.hidden=!preview;
    replay.hidden=preview?.kind!=='motion';
    returnPreview.hidden=page!=='actions'||!resource;
  }
  function paintSaveProgress(){
    saveProgress.hidden=saveStatus.hidden=!saving;
    summary.hidden=saving;
    if(!saving)return;
    if(saveStage<0){
      saveProgress.dataset.pending='';
      saveProgress.removeAttribute('aria-valuenow');
      saveStatus.textContent=t('正在保存绑定…','Saving bindings…');
    }else{
      delete saveProgress.dataset.pending;
      saveProgress.setAttribute('aria-valuenow',String(saveStage));
      saveStatus.textContent=t(
        `${saveStages[saveStage][1]} · 第 ${saveStage+1}/${saveStages.length} 步`,
        `${saveStages[saveStage][1]} · Step ${saveStage+1}/${saveStages.length}`,
      );
    }
    saveProgress.setAttribute('aria-valuetext',saveStatus.textContent);
    [...saveProgress.children].forEach((segment,index)=>{
      segment.dataset.state=index<saveStage?'done':index===saveStage?'active':'pending';
    });
  }
  async function pollSaveProgress(sequence){
    if(!alive()||!saving||sequence!==saveSequence)return;
    try{
      const progress=await ctx.invoke('manualSaveProgress',[data.token]);
      if(!alive()||!saving||sequence!==saveSequence)return;
      const index=saveStages.findIndex(([stage])=>stage===progress?.stage);
      if(index>saveStage){saveStage=index;paintSaveProgress();}
    }catch{}finally{
      if(alive()&&saving&&sequence===saveSequence)saveProgressTimer=win.setTimeout(()=>void pollSaveProgress(sequence),450);
    }
  }
  const syncControls=()=>{
    layout.inert=saving||!connected;pages.inert=saving||!connected;save.disabled=!canSave();close.disabled=cancel.disabled=saving;
    save.textContent=saving?t('保存中…','Saving…'):t('保存绑定','Save bindings');
    save.setAttribute('aria-busy',String(saving));
    paintSaveProgress();
    skipImages.hidden=!saving;skipImages.disabled=skippingImages;
    restoreAll.disabled=!canEdit()||(page==='actions'?!bindings.length:!groups.length);
    restoreAll.textContent=page==='actions'?t('全部恢复通用','Reset all to generic'):t('恢复默认外观','Default appearance');
    groupTools.hidden=page!=='wardrobe';syncPreviewControls();
    reset.textContent=page==='wardrobe'?t('复位预览','Reset preview'):t('查看组合','View combination');
    newGroup.disabled=resolution.disabled=raw.disabled=replay.disabled=reset.disabled=retry.disabled=!canEdit();
    if(full)full.disabled=!canEdit();
    syncPreviewMode();
  };
  const setPreviewBusy=busy=>{gallery.setAttribute('aria-busy',String(busy));gallery.classList.toggle('is-pending',busy);};
  const stopPreviewUpdates=()=>{serial++;win.clearTimeout(previewTimer);setPreviewBusy(false);};
  const sessionError=message=>/编辑已过期|编辑已取消|模型素材已变化|形象包已变化|原打包产物已移除|editor session ended/.test(message);
  const expireSession=message=>{
    sessionValid=false;stopPreviewUpdates();retry.hidden=true;hint.textContent=message;syncControls();paintSelection();
  };
  const changed=()=>{
    dirty=signature(bindings)!==signature(data.bindings||[])||JSON.stringify(groups)!==JSON.stringify(data.wardrobe||[]);
    ctx.stageDraft?.(dirty?structuredClone({bindings,wardrobe:groups}):null);
    syncControls();
  };
  const alive=()=>!closed&&!ctx.signal?.aborted;
  const release=()=>{if(closed)return;closed=true;win.clearInterval(leaseTimer);win.clearTimeout(saveProgressTimer);closeGroupDialog?.();discardPrompt?.dispose();previewDialog?.dispose();leave?.dispose?.();ctx.signal?.removeEventListener('abort',release);stopPreviewUpdates();listResize?.disconnect();studio?.dispose();gallery.replaceChildren();modal.close();modal.remove();onClosed?.();const token=data?.token||requestedToken;if(token&&!ctx.signal?.aborted)ctx.invoke('manualClose',[token]).catch(()=>{});previous?.focus?.({preventScroll:true});};
  const requestClose=async()=>{
    if(closed||saving||discardPrompt)return;
    if(dirty){discardPrompt=bindingDiscardPrompt(modal,zh);const accepted=await discardPrompt.result;discardPrompt=null;if(!accepted||!alive())return;}
    release();
  };
  close.onclick=cancel.onclick=requestClose;modal.addEventListener('cancel',e=>{e.preventDefault();void requestClose();});modal.addEventListener('click',e=>{if(e.target===modal)void requestClose();});
  const leave=ctx.guardLeave?.(()=>alive()&&(dirty||saving)?t('动作绑定尚未保存，确定离开？','Bindings are not saved. Leave?'):null);
  ctx.signal?.addEventListener('abort',release,{once:true});
  const loadPreview=(candidate=false)=>{
    if(!canEdit()||!alive())return;
    const preview=structuredClone(groups),selected={...picks},g=preview.find(g=>g.id===groupId);
    const wardrobeAudition=candidate&&page==='wardrobe'&&g&&resource&&
      resource.id!==g.options.find(o=>o.id===optionId)?.resource&&!resource.wardrobeError&&!wardrobeConflict(resource,g.id);
    if(wardrobeAudition){
      g.options=g.options.slice(0,15);g.options.push({id:'preview',name:resource.title,resource:resource.id});selected[g.id]='preview';
    }
    const current=bindings.find(b=>b.word===word);
    const previewBinding=resource?{resource:resource.id,nativeOnly:resource.kind==='motion'&&auditionNativeOnly}:current;
    const request={page,word,resource:page==='actions'?previewBinding?.resource:null,overlays:page==='actions'?(previewBinding?.overlays||[]):[],nativeOnly:page==='actions'&&previewBinding?.nativeOnly===true,raw:rawMode&&(!studio||!!previewBinding?.resource),bindings:structuredClone(bindings),groups:preview,picks:selected,sampleSet,previewSize:resolution.value==='unlimited'?'unlimited':Number(resolution.value)};
    const description=page==='actions'
      ? (resource?t('单项试看 · ','Single effect · ')+resource.title:current?label(word)+' · '+[current.resource,...(current.overlays||[])].map(id=>data.resources.find(r=>r.id===id)?.title).join(' ＋ '):t('通用表现','Generic behavior'))
      : g?wardrobeGroupName(g)+' · '+(wardrobeAudition?t('试看 ','Previewing ')+resource.title:t('预览 ','Preview ')+wardrobePickName(g)):t('当前装扮','Current appearance');
    const generation=++serial;win.clearTimeout(previewTimer);retry.hidden=true;setPreviewBusy(true);
    hint.textContent=studio?description:t('正在生成对照图，可以继续编辑。','Generating comparison. You can keep editing.');
    previewTimer=win.setTimeout(async()=>{
      try{
        if(studio){
          await studio.play(request);
          if(alive()&&generation===serial)hint.textContent=description;
          return;
        }
        const result=await ctx.invoke('manualPreview',[data.token,request]);if(!alive()||generation!==serial)return;
        if(!Array.isArray(result.frames)||!result.frames.length||result.frames.length>3)throw Error(t('预览图片不完整','Incomplete preview'));
        const labels={default:t('默认','Default'),generic:t('通用表现','Generic'),appearance:t('当前装扮','Current appearance'),native:t('原生效果','Native'),combined:t('完整效果','Full effect')};
        const figures = result.frames.map(item => {
          if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(item.png || '')) throw Error(t('预览图片无效','Invalid preview image'));
          const captionText = (labels[item.kind] || t('对照图','Comparison')) + (item.resource && item.time ? ' · ' + item.time.toFixed(2) + 's' : '');
          const figure = el('figure','l2d-bind-shot');
          const button = el('button','l2d-bind-shot-button'); button.type = 'button';
          button.setAttribute('aria-label', t('放大 ','Enlarge ') + captionText); button.setAttribute('aria-haspopup','dialog');
          const image = el('img'); image.src = item.png; image.alt = '';
          button.addEventListener('click', () => {
            if (closed || previewDialog) return;
            const large = el('img','l2d-large-cover'); large.src = item.png; large.alt = captionText;
            previewDialog = openFigureDialog(modal, captionText, large, {
              closeLabel:t('关闭','Close'), variant:'l2d-image-popup', onClose() { previewDialog = null; },
            });
          });
          button.append(image); figure.append(button, el('figcaption', null, captionText));
          return figure;
        });
        gallery.replaceChildren(...figures);gallery.dataset.count=String(figures.length);gallery.dataset.previewInfo=JSON.stringify({quality:result.quality,frames:result.frames.map(({png,...frame})=>frame)});
        hint.textContent=description;
      }catch(error){
        if(!alive()||generation!==serial)return;
        const message=String(error.message||error);
        if(sessionError(message)){expireSession(message);return;}
        const stale=!studio&&gallery.childElementCount?t('仍显示上次预览。','The previous preview is still shown. '):'';
        hint.textContent=t('预览失败，可继续编辑或降低精度重试。','Preview failed. You can keep editing or retry at a lower resolution. ')+stale+message;
        retry.hidden=false;
      }finally{if(alive()&&generation===serial)setPreviewBusy(false);}
    },studio?0:160);
  };
  const sendWardrobe=(candidate=false)=>loadPreview(candidate);
  const play=()=>loadPreview(true);
  raw.onclick=()=>{rawMode=!!studio||!rawMode;syncPreviewMode();play();};
  if(full)full.onclick=()=>{rawMode=false;syncPreviewMode();play();};
  replay.onclick=()=>{sampleSet=(sampleSet+1)%3;play();};
  resolution.onchange=play;
  reset.onclick=()=>{
    if(page==='wardrobe'){picks={};optionId='default';optionNameDraft=null;}
    resource=null;paintTargets();paintResources();loadPreview();
  };
  if(returnPreview)returnPreview.onclick=()=>{resource=null;paintResources();loadPreview();};
  let filter='all';const search=el('input','l2d-input');search.type='search';search.placeholder=t('搜索原生资源','Search native resources');search.setAttribute('aria-label',search.placeholder);
  const tabs=el('div','l2d-bind-tabs'),list=el('div','l2d-bind-list'),binding=el('div','l2d-bind-selection');
  const resourceCount=el('span','figure-resource-count');
  const resourceTitle=el('h2',null,t('原生资源','Native resources'));
  const previousPage=el('button','l2d-btn sm figure-page-arrow','↑'),nextPage=el('button','l2d-btn sm figure-page-arrow','↓');
  let listResize;
  function updatePaging(){
    previousPage.disabled=list.scrollTop<=1;
    nextPage.disabled=list.scrollTop+list.clientHeight>=list.scrollHeight-1;
  }
  if(studio){
    list.tabIndex=0;list.setAttribute('role','region');list.setAttribute('aria-label',t('原生资源列表','Native resource list'));
    previousPage.title=t('向上滚动一屏','Scroll up one screen');nextPage.title=t('向下滚动一屏','Scroll down one screen');
    previousPage.setAttribute('aria-label',previousPage.title);nextPage.setAttribute('aria-label',nextPage.title);
    const pageBy=direction=>{
      const row=list.firstElementChild?.offsetHeight||44;
      list.scrollTop+=direction*Math.max(row,list.clientHeight-row);
      updatePaging();
    };
    previousPage.onclick=()=>pageBy(-1);nextPage.onclick=()=>pageBy(1);
    list.addEventListener('keydown', event => {
      if (event.key !== 'PageUp' && event.key !== 'PageDown') return;
      event.preventDefault();
      pageBy(event.key === 'PageUp' ? -1 : 1);
    });
    list.addEventListener('scroll',updatePaging,{passive:true});
    if(win.ResizeObserver){listResize=new win.ResizeObserver(updatePaging);listResize.observe(list);}
    const library=el('div','figure-resource-head');
    library.append(resourceTitle,resourceCount,previousPage,nextPage);right.append(library);
  }
  right.append(search,tabs,list,binding);
  const paintTargets=()=>{
    const scroll=left.scrollTop;
    const focus=left.contains(doc.activeElement)?doc.activeElement.dataset.wardrobeFocus:null;
    left.classList.toggle('l2d-wardrobe-nav',page==='wardrobe');
    left.replaceChildren();
    if(page==='wardrobe'){
      paintWardrobeTargets();
      left.scrollTop=scroll;
      if(focus)[...left.querySelectorAll('[data-wardrobe-focus]')].find(node=>node.dataset.wardrobeFocus===focus)?.focus({preventScroll:true});
      return;
    }
    for(const [key,title]of [['expressions',t('表情','Expressions')],['motions',t('动作','Motions')]]){
    left.append(el('h3',null,title));for(const w of data.words[key]){
      const b=el('button','l2d-bind-target'+(w===word?' selected':''));b.type='button';b.setAttribute('aria-pressed',String(w===word));
      const current = bindings.filter(item => item.word === w);
      const saved = (data.bindings || []).filter(item => item.word === w);
      const edited = signature(current) !== signature(saved);
      const status = edited ? t('待保存','Unsaved')
        : current.length ? t(`已绑定 ${1+(current[0].overlays?.length||0)} 项`,'Bound') : t('通用','Generic');
      b.append(el('span',null,label(w)),el('small',edited?'figure-draft-state':null,status));
      b.onclick=()=>{word=w;resource=null;combinationError='';pendingCombination=null;paintTargets();paintResources();play();};left.append(b);
    }
  }};
  const currentIds=()=>{const b=bindings.find(b=>b.word===word);return b?[b.resource,...(b.overlays||[])]:[];};
  const outfitChannels=()=>new Set(groups.flatMap(g=>g.options.flatMap(o=>data.resources.find(r=>r.id===o.resource)?.channels||[])));
  function commitSelection(ids,release,nativeOnly=false){
    if(!canEdit()||discardPrompt)return;
    const primary=data.resources.find(r=>r.id===ids[0]);
    const overlays=primary?validateExpressionOverlays(data,primary.id,ids.slice(1)):[];
    const outfit=outfitChannels();
    if(!nativeOnly&&[...ids,release].some(id=>data.resources.find(r=>r.id===id)?.channels?.some(c=>outfit.has(c))))throw Error(primary?.kind==='motion'&&data.nativeMotionMode?t('与装扮共用参数。可选「完全使用动画」，或调整装扮绑定。','Shares controls with wardrobe. Choose Animation only or adjust the outfit.'):t('与已配置装扮共用参数，请先调整装扮绑定。','Shares controls with wardrobe. Adjust that binding first.'));
    bindings=bindings.filter(b=>b.word!==word);
    if(primary)bindings.push({word,resource:primary.id,...(overlays.length?{overlays}:{}),...(release?{release}:{}),...(nativeOnly?{nativeOnly:true}:{}),confidence:1,reason:'用户在动作编辑器中选择'});
    resource=null;combinationError='';pendingCombination=null;changed();paintTargets();paintResources();play();
  }
  function toggleEffect(item){
    if(!canEdit()||discardPrompt)return;
    const ids=currentIds(),current=data.resources.find(r=>r.id===ids[0]);
    try{if(current?.kind==='motion')throw Error(t('当前绑定为动作，请先恢复通用，再选择表情组合。','Clear the motion binding before selecting expressions.'));commitSelection(ids.includes(item.id)?ids.filter(id=>id!==item.id):[...ids,item.id]);}
    catch(error){combinationError=error.message;pendingCombination=item;paintSelection();}
  }
  const paintSelection=()=>{
    syncPreviewControls();
    binding.classList.toggle('l2d-bind-combination',page==='actions');
    binding.classList.toggle('figure-wardrobe-selection',page==='wardrobe'&&!!studio);
    binding.classList.remove('has-motion-mode');
    if(page==='wardrobe'){paintWardrobeSelection();return;}
    binding.replaceChildren();const current=bindings.find(b=>b.word===word),ids=currentIds();
    const selectedResource=resource??data.resources.find(r=>r.id===current?.resource);
    const motion=selectedResource?.kind==='motion'&&selectedResource.classification!=='appearance'?selectedResource:null;
    const boundMotion=motion&&current?.resource===motion.id;
    const canUseMotion=resource&&motion&&(!boundMotion||motion.classification==='pose');
    const caption=el('p','l2d-combination-title',label(word)+' · ');
    if(motion){
      const state=el('span','l2d-motion-state'+(boundMotion?' is-bound':''),boundMotion?t('已绑定','Bound'):t('待绑定','Unbound'));
      caption.append(state,' ',motion.title);
    }else caption.append(ids.length?t(`已选 ${ids.length} 个效果`,`${ids.length} effects`):t('通用表现','Generic behavior'));
    caption.title=caption.textContent;
    const chips=el('div','l2d-combination-chips');chips.setAttribute('aria-label',t('当前组合','Current combination'));
    const warning=el('div','l2d-combination-warning',combinationError);warning.setAttribute('role','status');
    if(motion&&data.nativeMotionMode){
      binding.classList.add('has-motion-mode');
      const label=el('label','l2d-motion-mode',t('安装后播放','Installed playback'));
      const mode=el('select','l2d-input');
      for(const [value,title] of [['mixed',t('叠加通用表现','Blend generic behavior')],['native',t('完全使用动画','Animation only')]]){
        const option=el('option',null,title);option.value=value;mode.append(option);
      }
      mode.value=(resource?auditionNativeOnly:current?.nativeOnly)?'native':'mixed';
      mode.disabled=!canEdit();
      mode.title=t('完全使用动画时，由原生动作接管模型参数，播完恢复其他表现。','Animation only gives the native motion control of model parameters during playback.');
      mode.onchange=()=>{
        if(!canEdit()||discardPrompt)return;
        const nativeOnly=mode.value==='native';
        rawMode=false;syncPreviewMode();
        if(resource&&!boundMotion){
          auditionNativeOnly=nativeOnly;
          combinationError=warning.textContent='';
          play();
        }else{
          try{commitSelection([motion.id],current.release,nativeOnly);}
          catch(error){combinationError=error.message;paintSelection();}
        }
      };
      label.append(mode);chips.append(label);
    }else{
      for(const id of ids){const item=data.resources.find(r=>r.id===id);const chip=el('button','l2d-btn quiet sm',`${item?.title||id} ×`);chip.type='button';chip.setAttribute('aria-label',t('移除 ','Remove ')+(item?.title||id));chip.disabled=!canEdit();chip.onclick=()=>{try{commitSelection(ids.filter(x=>x!==id),id===current.resource?undefined:current.release);}catch(e){combinationError=e.message;paintSelection();}};chips.append(chip);}
      if(!ids.length){
        const canCombine=data.words.expressions.includes(word)&&data.resources.some(r=>r.kind==='expression'&&r.classification!=='appearance');
        chips.append(el('span','l2d-bind-note',canCombine?t('点名称试看，勾选加入组合','Click a name to preview. Check it to combine.'):t('点动作名称试看，再选择「使用此动作」','Preview an animation, then choose Use this motion.')));
      }
    }
    const actions=el('div','l2d-combination-actions');
    if(pendingCombination&&combinationError.includes('冲突')){
      const replace=el('button','l2d-btn sm',t('替换冲突项','Replace conflicting effects'));
      replace.onclick=()=>{const item=pendingCombination;const keep=ids.filter(id=>{try{validateExpressionOverlays(data,id,[item.id]);return true;}catch{return false;}});try{commitSelection([...keep,item.id]);}catch(e){combinationError=e.message;paintSelection();}};actions.append(replace);
    }else if(canUseMotion){
      const use=el('button','l2d-btn primary l2d-use-motion',t('使用此动作','Use this motion'));use.type='button';let select;
      if(resource.classification==='pose'){
        select=el('select','l2d-input');select.setAttribute('aria-label',t('复位动作','Reset motion'));select.append(el('option',null,t('请选择复位动作','Choose reset motion')));select.firstChild.value='';
        for(const r of data.resources.filter(r=>r.kind==='motion'&&r.classification!=='appearance'&&r.id!==resource.id)){const o=el('option',null,r.title);o.value=r.id;select.append(o);}select.value=(current?.resource===resource.id&&current.release)||resource.release||'';actions.append(select);
      }
      use.disabled=!canEdit()||!!select&&!select.value;if(select)select.onchange=()=>use.disabled=!canEdit()||!select.value;
      use.onclick=()=>{
        if(!canEdit()||discardPrompt)return;
        try{
          commitSelection([resource.id],select?.value,auditionNativeOnly);
          const result=binding.querySelector('.l2d-combination-title');
          if(result){result.tabIndex=-1;result.focus({preventScroll:true});}
        }catch(e){combinationError=e.message;paintSelection();}
      };actions.append(use);
    }else if(resource&&!studio){
      const view=el('button','l2d-btn sm',t('结束单项试看','End audition'));view.disabled=!canEdit();view.onclick=()=>{resource=null;paintResources();play();};actions.append(view);
    }
    if(current||!canUseMotion){
      const restore=el('button','l2d-btn quiet sm',t('恢复通用','Use generic'));restore.disabled=!canEdit()||!current;restore.onclick=()=>{if(!discardPrompt)commitSelection([]);};actions.append(restore);
    }
    binding.append(caption,chips,warning,actions);paintSummary();
  };
  const paintResources=(scroll=list.scrollTop)=>{list.replaceChildren();const q=search.value.trim().toLocaleLowerCase(),ids=currentIds();
    const saved = (data.bindings || []).find(item => item.word === word);
    const savedIds = new Set(saved ? [saved.resource, ...(saved.overlays || [])] : []);
    const activeGroup=page==='wardrobe'?groups.find(g=>g.id===groupId):null;
    const assignedResource=activeGroup?.options.find(o=>o.id===optionId)?.resource;
    const canCombine=page==='actions'&&data.words.expressions.includes(word);
    const combiningExpressions=canCombine&&ids.length>0&&data.resources.find(r=>r.id===ids[0])?.kind==='expression';
    const outfit=canCombine?outfitChannels():null;
    const selectedChannels=new Set(combiningExpressions?ids.flatMap(id=>data.resources.find(r=>r.id===id)?.channels||[]):[]);
    resourceTitle.textContent=activeGroup?t(`为${wardrobeGroupName(activeGroup)}选资源`,`Resources for ${wardrobeGroupName(activeGroup)}`):t('原生资源','Native resources');
    resourceTitle.title=resourceTitle.textContent;
    const resources=data.resources.filter(r=>(page!=='wardrobe'||!r.wardrobeError)&&(filter==='all'||filter==='other'?filter!=='other'||r.classification==='appearance':r.kind===filter)&&(!q||r.title.toLocaleLowerCase().includes(q)));
    for(const r of resources){
      const assigned=assignedResource===r.id;
      const audition=r.id===resource?.id&&!assigned;
      const blocked=audition&&activeGroup&&wardrobeConflict(r,activeGroup.id);
      const selected=page==='actions'&&ids.includes(r.id);
      const combinable=canCombine&&r.kind==='expression'&&r.classification!=='appearance';
      let constraint='',detail='',canReplace=false;
      if(combinable&&!selected){
        if(r.channels?.some(channel=>outfit.has(channel))){
          constraint=t('装扮冲突','Outfit conflict');
          detail=t('这个表情与已配置的装扮共用参数。','This expression shares parameters with a configured outfit.');
        }else if(combiningExpressions){
          try{validateExpressionOverlays(data,ids[0],[...ids.slice(1),r.id]);}
          catch(error){
            canReplace=error.message.includes('冲突');
            constraint=ids.length>=MAX_EXPRESSIONS?t('组合已满','Combination full'):canReplace?t('参数冲突','Parameter conflict'):t('无法组合','Cannot combine');
            detail=zh?error.message:constraint;
            if(canReplace)detail+='\n'+t('勾选可查看替换选项。','Check to see replacement options.');
          }
        }
      }
      const overlap=combinable&&!selected&&!constraint&&r.channels?.some(channel=>selectedChannels.has(channel));
      if(overlap)detail=t('与已选表情共用参数，仍可加入组合。','Shares parameters with selected expressions and can still be combined.');
      const rowHint=constraint||(overlap?t('参数重叠','Shared parameters'):'');
      const row=el('div','l2d-bind-resource-row');
      if(studio){row.classList.toggle('is-selected',selected);row.classList.toggle('is-audition',audition);row.classList.toggle('is-assigned',assigned);}
      const b=el('button','l2d-bind-resource'+(!studio&&(page==='actions'?selected:audition)?' selected':'')+(!studio&&audition?' audition':''));b.type='button';
      const kind=page==='wardrobe'?(r.kind==='expression'?t('外观状态','Appearance'):t('动作末帧','Final frame')):r.classification==='appearance'?t('仅试看','Preview only'):r.kind==='expression'?t('表情','Expression'):t(`${r.seconds.toFixed(1)} 秒`,`${r.seconds.toFixed(1)} s`);
      b.title=detail?`${r.title}\n${detail}`:r.title;
      b.dataset.audition=r.id;
      if(audition)b.setAttribute('aria-current','true');
      const draft = selected && !savedIds.has(r.id);
      const boundLabel = draft ? t('待保存','Unsaved') : t('已绑定','Bound');
      const status = blocked ? t('参数冲突','Conflict')
        : [audition && t('试看中','Previewing'), (selected || assigned) && boundLabel].filter(Boolean).join(' · ');
      const statusClass = constraint ? 'l2d-bind-constraint' : draft ? 'figure-draft-state'
        : overlap ? 'l2d-bind-overlap' : studio && status ? 'figure-audition-label' : null;
      b.append(el('span',null,r.title),el('small',statusClass,rowHint||(studio&&status)||kind));
      b.onclick=()=>{
        const refocus=studio&&doc.activeElement===b;
        if(page==='actions'&&resource?.id!==r.id)auditionNativeOnly=bindings.some(item=>item.word===word&&item.resource===r.id&&item.nativeOnly);
        resource=r;combinationError='';pendingCombination=null;paintResources();play();
        if(refocus)[...list.querySelectorAll('[data-audition]')].find(node=>node.dataset.audition===r.id)?.focus({preventScroll:true});
      };
      row.append(b);
      if(combinable){
        const check=el('input','l2d-bind-effect-check');check.type='checkbox';check.checked=selected;check.disabled=!canEdit()||!!constraint&&!canReplace;check.dataset.resource=r.id;check.setAttribute('aria-label',t('组合：','Combine: ')+r.title);
        if(rowHint){check.setAttribute('aria-label',`${check.getAttribute('aria-label')} · ${rowHint}`);check.title=detail;}
        check.onchange=()=>{toggleEffect(r);const next=[...list.querySelectorAll('input')].find(n=>n.dataset.resource===r.id);if(next){next.checked=currentIds().includes(r.id);next.focus({preventScroll:true});}};
        if(studio){const hit=el('label','figure-check-hit');hit.append(check);row.append(hit);}
        else row.append(check);
      }list.append(row);
    }
    if(!resources.length)list.append(el('p','l2d-bind-empty',t('没有匹配的资源','No matching resources')));
    list.scrollTop=scroll;
    resourceCount.textContent=t(`${resources.length} 项`,`${resources.length} items`);
    paintSelection();
    updatePaging();
  };
  function paintSummary(){const used=groups.filter(g=>g.options.length).length;const total=groups.length||3;summary.textContent=t(`${bindings.length} 项绑定 · 外观 ${used}/${total} 栏 · 保存后从卡片安装`,`${bindings.length} bindings · ${used}/${total} appearance slots · save then install`);}
  function wardrobeConflict(r,id){
    const ids=[...bindings.filter(b=>!b.nativeOnly).flatMap(bindingResourceIds),...groups.filter(g=>g.id!==id).flatMap(g=>g.options.map(o=>o.resource))];
    const used=new Set(ids.flatMap(id=>data.resources.find(r=>r.id===id)?.channels||[]));return (r?.channels||[]).some(c=>used.has(c));
  }
  function wardrobeGroupName(group) {
    return zh ? group.name : group.en || WARDROBE_SLOTS.find(slot=>slot.slot===group.slot)?.en || group.name;
  }
  function wardrobePickName(group) {
    return group.options.find(option=>option.id===picks[group.id])?.name || t('默认','Default');
  }
  function selectWardrobeOption(group,id) {
    groupId=group.id;
    optionId=id;
    optionNameDraft=null;
    const resourceId=group.options.find(option=>option.id===id)?.resource;
    resource=data.resources.find(item=>item.id===resourceId)||null;
  }
  function refreshWardrobe() {
    paintTargets();
    paintResources();
    sendWardrobe();
  }
  function paintWardrobeTargets(){
    const navigation=el('div','l2d-wardrobe-groups');
    navigation.setAttribute('role','group');
    navigation.setAttribute('aria-label',t('装扮分组','Appearance groups'));
    left.append(navigation);
    for(const g of groups){
      const title=wardrobeGroupName(g),pick=wardrobePickName(g),active=g.id===groupId;
      const row=el('div','l2d-bind-grow'+(g.custom?' is-custom':''));
      const header=el('button','l2d-bind-group'+(active?' selected':''));
      header.type='button';
      header.dataset.wardrobeFocus='group-'+g.id;
      header.setAttribute('aria-pressed',String(active));
      header.setAttribute('aria-label',t(`${title}，预览 ${pick}`,`${title}, previewing ${pick}`));
      header.title=header.getAttribute('aria-label');
      header.disabled=!canEdit();
      header.append(el('span','l2d-wardrobe-group-name',title),el('small','l2d-wardrobe-group-pick',pick));
      header.onclick=()=>{
        if(active||!canEdit()||discardPrompt)return;
        selectWardrobeOption(g,picks[g.id]||'default');
        refreshWardrobe();
      };
      row.append(header);
      if(g.custom){
        const del=el('button','l2d-bind-groupdel','×');del.type='button';del.title=t('删除分组','Delete group');del.setAttribute('aria-label',t('删除分组 '+g.name,'Delete group '+g.name));
        del.onclick=async event=>{
          event.stopPropagation();
          if(!canEdit()||discardPrompt)return;
          discardPrompt=bindingDiscardPrompt(modal,zh,{
            title:t('删除分组？','Delete group?'),
            body:t(`「${g.name}」以及它的所有选项都会被移除。`,`“${g.name}” and all its options will be removed.`),
            cancel:t('保留','Keep'),accept:t('删除','Delete'),
          });
          const accepted=await discardPrompt.result;discardPrompt=null;
          if(!accepted||!alive()||!canEdit())return;
          groups=groups.filter(x=>x.id!==g.id);delete picks[g.id];
          if(groupId===g.id&&groups[0])selectWardrobeOption(groups[0],picks[groups[0].id]||'default');
          changed();refreshWardrobe();
        };
        row.append(del);
      }
      navigation.append(row);
    }
    const group=groups.find(g=>g.id===groupId);
    if(!group)return;
    const title=wardrobeGroupName(group);
    const options=el('section','l2d-wardrobe-options');
    const optionTitle=t(`${title}选项`,`${title} options`);
    options.setAttribute('aria-label',optionTitle);
    options.append(el('h3','l2d-wardrobe-heading',optionTitle));
    for(const option of [{id:'default',name:t('默认','Default')},...group.options]){
      const chosen=(picks[group.id]||'default')===option.id;
      const button=el('button','l2d-bind-target l2d-wardrobe-option');
      button.type='button';
      button.dataset.wardrobeFocus='option-'+group.id+'-'+option.id;
      button.setAttribute('aria-label',title+'：'+option.name);
      button.setAttribute('aria-pressed',String(chosen));
      button.disabled=!canEdit();
      const indicator=el('span','l2d-wardrobe-radio');
      indicator.setAttribute('aria-hidden','true');
      button.append(indicator,el('span','l2d-wardrobe-option-name',option.name));
      if(chosen)button.append(el('small','l2d-wardrobe-preview-label',t('预览中','Preview')));
      button.title=option.name;
      button.onclick=()=>{
        if(!canEdit()||discardPrompt)return;
        selectWardrobeOption(group,option.id);
        picks[group.id]=option.id;
        refreshWardrobe();
      };
      options.append(button);
    }
    const add=el('button','l2d-btn quiet sm l2d-wardrobe-add',t('＋ 新选项','＋ New option'));
    add.type='button';
    add.dataset.wardrobeFocus='add-'+group.id;
    add.setAttribute('aria-pressed',String(optionId===null));
    add.setAttribute('aria-label',t(`为${title}新建选项`,`Add an option to ${title}`));
    add.disabled=!canEdit()||group.options.length>=16;
    add.onclick=()=>{
      if(!canEdit()||discardPrompt)return;
      selectWardrobeOption(group,null);
      refreshWardrobe();
    };
    options.append(add);
    left.append(options);
  }
  function paintWardrobeSelection(){
    binding.replaceChildren();const g=groups.find(g=>g.id===groupId);paintSummary();
    if(!g){binding.append(el('p',null,t('在左侧选择装扮、部件或配饰','Choose Outfit, Parts or Accessories on the left')));return;}
    const current=g.options.find(o=>o.id===optionId);
    const caption=el('p','l2d-wardrobe-destination',wardrobeGroupName(g)+' · '+(current?t(`编辑「${current.name}」`,`Edit ${current.name}`):t('新选项','New option')));
    caption.title=caption.textContent;
    binding.append(caption);
    const name=el('input','l2d-input');
    name.value=optionNameDraft ?? current?.name ?? resource?.title ?? '';
    name.maxLength=60;
    name.placeholder=t('选项名称','Option name');
    name.setAttribute('aria-label',t('装扮选项名称','Wardrobe option name'));
    binding.append(name);
    const conflict=resource&&wardrobeConflict(resource,g.id);
    const actions=studio?el('div','figure-wardrobe-actions'):binding;
    if(!studio&&conflict)binding.append(el('p','l2d-bind-warning',t('与动作或其他装扮组共用参数，请调整绑定。','Shares controls with actions or another wardrobe group.')));
    const add=el('button','l2d-btn primary',current?t('保存选项','Update option'):t('添加选项','Add option'));
    const canAdd=()=>canEdit()&&resource&&!resource.wardrobeError&&!conflict&&!!name.value.trim()&&(!!current||g.options.length<16);
    add.disabled=!canAdd();
    name.oninput=()=>{optionNameDraft=name.value;add.disabled=!canAdd();};
    add.onclick=()=>{
      if(!canAdd()||discardPrompt)return;
      const option={id:current?.id||uid('v'),name:name.value.trim(),resource:resource.id};
      if(current)g.options=g.options.map(item=>item.id===option.id?option:item);
      else g.options.push(option);
      picks[g.id]=option.id;
      selectWardrobeOption(g,option.id);
      changed();
      refreshWardrobe();
    };
    actions.append(add);
    if(current){
      const remove=el('button','l2d-btn quiet',t('移除选项','Remove option'));
      remove.disabled=!canEdit();
      remove.onclick=()=>{
        if(!canEdit()||discardPrompt)return;
        g.options=g.options.filter(o=>o.id!==current.id);
        picks[g.id]='default';
        selectWardrobeOption(g,'default');
        changed();
        refreshWardrobe();
      };
      actions.append(remove);
    }
    if(studio)binding.append(actions,el('p','l2d-bind-warning',conflict?t('与动作或其他装扮共用参数。','Shares controls with another binding.'):''));
    else binding.append(el('p','l2d-bind-note',t('每组可选一个选项。保存并安装后可在 Coo 装扮页切换。','Pick one option per group. Save and install to switch them in Coo.')));
  }
  for(const [id,title]of [['actions',t('动作','Actions')],['wardrobe',t('装扮','Wardrobe')]]){
    const b=el('button','l2d-btn quiet sm',title);b.setAttribute('role','tab');b.setAttribute('aria-selected',String(page===id));b.onclick=()=>{
      if(!data||saving||discardPrompt||page===id)return;pageState[page]={resource,filter,search:search.value,scroll:list.scrollTop};page=id;combinationError='';pendingCombination=null;({resource,filter}=pageState[id]);search.value=pageState[id].search;for(const n of pages.children)n.setAttribute('aria-selected',String(n===b));
      if(page==='wardrobe'&&!groupId)groupId=groups[0]?.id||null;for(const n of tabs.children)n.classList.toggle('selected',n.dataset.filter===filter);syncControls();paintTargets();paintResources(pageState[id].scroll);play();
    };pages.append(b);
  }
  for(const [value,title]of [['all',t('全部','All')],['expression',t('表情','Faces')],['motion',t('动作','Motions')],['other',t('其他','Other')]]){
    const b=el('button','l2d-btn quiet sm',title);b.dataset.filter=value;b.onclick=()=>{if(!data)return;filter=value;for(const n of tabs.children)n.classList.toggle('selected',n===b);paintResources(0);};tabs.append(b);
  }tabs.firstChild.classList.add('selected');search.oninput=()=>{if(data)paintResources(0);};
  restoreAll.onclick=async()=>{
    if(!canEdit()||discardPrompt)return;
    if(page==='wardrobe'){picks={};resource=null;optionId='default';optionNameDraft=null;refreshWardrobe();return;}
    if(!bindings.length)return;
    discardPrompt=bindingDiscardPrompt(modal,zh,{title:t('全部恢复通用？','Reset all bindings?'),body:t('清空当前绑定，保留原生资源。点击保存后生效。','Clear all bindings and keep native resources. Save to apply.'),cancel:t('保留绑定','Keep bindings'),accept:t('全部恢复','Reset all')});
    const accepted=await discardPrompt.result;discardPrompt=null;if(!accepted||!alive()||!canEdit())return;
    bindings=[];resource=null;combinationError='';pendingCombination=null;rawMode=!!studio;changed();paintTargets();paintResources();play();
  };
  const askGroup=()=>new Promise(resolve=>{
    const form=el('form','l2d-group-form');
    const nameLabel=el('label','l2d-group-field');
    const name=el('input','l2d-input');
    name.placeholder=t('例如发型','e.g. Hair');name.maxLength=24;name.required=true;
    nameLabel.append(el('span','l2d-group-field-title',t('分组名称','Group name')),name);
    const englishLabel=el('label','l2d-group-field');
    const englishTitle=el('span','l2d-group-field-title',t('英文名称','English name'));
    englishTitle.append(el('span','l2d-group-optional',t('选填','Optional')));
    const english=el('input','l2d-input');
    english.placeholder='e.g. Hair';english.maxLength=24;english.lang='en';
    englishLabel.append(englishTitle,english);
    const actions=el('div','l2d-group-actions');
    const cancelBtn=el('button','l2d-btn',t('取消','Cancel')),okBtn=el('button','l2d-btn primary',t('创建分组','Create group'));
    cancelBtn.type='button';okBtn.type='submit';okBtn.disabled=true;
    actions.append(cancelBtn,okBtn);
    form.append(nameLabel,englishLabel,actions);
    let value=null;
    const popup=openFigureDialog(modal,t('新建分组','New group'),form,{
      closeLabel:t('关闭新建分组','Close new group'),
      variant:'l2d-group-modal',
      onClose(){closeGroupDialog=undefined;resolve(value);},
    });
    closeGroupDialog=popup.dispose;
    cancelBtn.onclick=popup.dispose;
    name.oninput=()=>{okBtn.disabled=!name.value.trim();};
    form.onsubmit=event=>{
      event.preventDefault();
      if(!name.value.trim())return;
      value={name:name.value.trim(),en:english.value.trim()};
      popup.dispose();
    };
    name.focus({preventScroll:true});
  });
  newGroup.onclick=async()=>{
    if(page!=='wardrobe'||!canEdit()||discardPrompt||closeGroupDialog)return;
    const value=await askGroup();
    if(!value||!alive()||!canEdit())return;
    const group={id:uid('g'),custom:true,name:value.name,...(value.en?{en:value.en}:{}),options:[]};
    groups.push(group);selectWardrobeOption(group,null);
    changed();refreshWardrobe();
    const entry=left.querySelector('.l2d-bind-group.selected');
    if(entry){
      const row=entry.getBoundingClientRect(),viewport=left.getBoundingClientRect();
      if(row.bottom>viewport.bottom)left.scrollTop+=row.bottom-viewport.bottom;
    }
  };
  skipImages.onclick=async()=>{
    if(!saving||skippingImages)return;
    const sequence=saveSequence;skippingImages=true;syncControls();
    try{
      await ctx.invoke('manualSkipImages',[data.token]);
      if(alive()&&saving&&sequence===saveSequence)hint.textContent=t('已跳过图片，继续保存绑定…','Skipping images and saving bindings…');
    }catch(error){
      if(alive()&&saving&&sequence===saveSequence){
        skippingImages=false;syncControls();
        hint.textContent=t('暂未跳过图片。','Could not skip images. ')+String(error.message||error);
      }
    }
  };
  save.onclick=async()=>{
    if(!canSave()||discardPrompt)return;
    if(gallery.getAttribute('aria-busy')==='true')retry.hidden=false;
    stopPreviewUpdates();saveSequence++;saving=true;saveStage=-1;syncControls();paintSelection();hint.textContent=t('保存并打包…','Saving & packing…');skipImages.focus();
    try{
      const request=ctx.invoke('manualSave',[data.token,structuredClone(bindings),structuredClone(groups)]);
      void pollSaveProgress(saveSequence);
      const result=await request;dirty=false;release();
      const saved=t('绑定已保存，可从卡片安装','Bindings saved. Install from the pack card.');
      if(result?.warn)ctx.ui.toast(saved+' · '+result.warn);
      else ctx.ui.toast(saved,'ok');
      try{await onSaved?.(result);}catch{ctx.ui.toast(t('绑定已保存，模型包列表刷新失败，请稍后重新打开页面','Bindings saved; the pack list could not refresh. Reopen the page later.'),'bad');}
    }
    catch(error){if(alive()){const message=String(error.message||error);if(sessionError(message))expireSession(message);else hint.textContent=message;ctx.ui.toast(message,'bad');}}
    finally{win.clearTimeout(saveProgressTimer);saving=false;skippingImages=false;if(alive()){syncControls();paintSelection();}}
  };
  retry.onclick=play;
  syncControls();
  try{
    data=await ctx.invoke(method,requestedToken?[...args,requestedToken]:args);
    resolution.value=String(data.previewSize);
    if(resolution.selectedIndex<0)resolution.selectedIndex=0;
    if(data.token!==requestedToken)ctx.notifyOnUnmount?.('manualClose',[data.token]);
    if(!alive()){if(!ctx.signal?.aborted)ctx.invoke('manualClose',[data.token]).catch(()=>{});return {get closed(){return closed;},dispose:release};}
    data.wardrobe=fixedWardrobeGroups(data.wardrobe||[]).map((g,i)=>({...g,...(i>=3?{custom:true}:{})}));
    bindings=structuredClone(data.draft?.bindings??data.bindings??[]);
    groups=structuredClone(data.draft?.wardrobe??data.wardrobe);
    changed();heading.querySelector('.l2d-modal-sub').textContent=data.title;paintTargets();paintResources();
    if(data.truncated||data.warnings?.length)right.prepend(el('p','l2d-bind-empty',t('部分资源未能读取，列表可能不完整','Some resources could not be read; the list may be incomplete')));
    if(data.truncated)hint.textContent=t('资源扫描不完整，请核对模型内容','Resource scan is incomplete; check the model');
    if(!studio)leaseTimer=win.setInterval(()=>{if(alive()&&sessionValid)ctx.invoke('manualKeepAlive',[data.token]).catch(error=>{const message=String(error.message||error);if(alive()&&sessionError(message))expireSession(message);});},60000);
    loadPreview();
  }catch(error){if(alive())hint.textContent=String(error.message||error);}
  return {
    get closed(){return closed;},
    dispose(){leave?.dispose?.();release();},
    setConnection(online,message){
      if(closed||online===connected)return;
      connected=online;
      if(!online){stopPreviewUpdates();hint.textContent=message;}
      syncControls();paintResources();
      if(online&&!saving)play();
    },
  };
}
