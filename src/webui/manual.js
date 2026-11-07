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
  const names={neutral:'中性',happy:'开心',wink:'眨眼',love:'喜欢',shy:'害羞',surprised:'惊讶',angry:'生气',sad:'难过',sleepy:'困倦',thinking:'思考',smug:'得意',pout:'嘟嘴',worried:'担心',determined:'坚定',flustered:'慌乱',scared:'害怕',excited:'兴奋',cry:'哭泣',confused:'疑惑',idle:'待机',nod:'点头',shake:'摇头',wave:'挥手',bow:'鞠躬',cheer:'欢呼',dance:'跳舞',jump:'跳跃',sit:'坐下',stretch:'伸展',shiver:'发抖'};
  const label=w=>zh?names[w]||w:w;
  const el=(tag,cls,text)=>{const n=doc.createElement(tag);n.className=cls||'';if(text!=null)n.textContent=text;return n;};
  const previous=doc.activeElement;
  const requestedToken=win.crypto?.randomUUID?.();
  if(requestedToken)ctx.notifyOnUnmount?.('manualClose',[requestedToken]);
  const modal=el('dialog','l2d-modal l2d-bind-modal');modal.setAttribute('aria-label',t('动作与装扮','Actions and wardrobe'));
  const card=el('div','l2d-bind-card'),head=el('div','l2d-modal-head'),heading=el('div','l2d-modal-heading');
  heading.append(el('div','l2d-modal-title',t('动作与装扮','Actions and wardrobe')),el('div','l2d-modal-sub',t('选择表情或动作，可预览效果','Choose a target and preview its effect')));
  const close=el('button','l2d-btn quiet l2d-modal-close','×');close.setAttribute('aria-label',t('关闭动作与装扮','Close editor'));head.append(heading,close);
  const layout=el('div','l2d-bind-layout'),left=el('nav','l2d-bind-targets'),stage=el('section','l2d-bind-stage'),right=el('section','l2d-bind-resources');
  left.setAttribute('aria-label',t('绑定目标','Binding targets'));right.setAttribute('aria-label',t('原生资源','Native resources'));
  const gallery=el('div','l2d-bind-gallery');gallery.setAttribute('aria-label',t('模型效果对照','Model comparison'));gallery.setAttribute('aria-live','polite');
  const hint=el('p','l2d-bind-status',t('准备预览…','Preparing preview…'));hint.setAttribute('role','status');
  const toolbar=el('div','l2d-bind-toolbar'),raw=el('button','l2d-btn sm',t('组合效果','Combined')),replay=el('button','l2d-btn sm',t('重新取样','Resample')),reset=el('button','l2d-btn sm',t('复位','Reset'));
  const retry=el('button','l2d-btn sm',t('重试预览','Retry preview'));retry.hidden=true;
  const resolutionLabel=el('label','l2d-bind-quality',t('预览精度','Preview size')),resolution=el('select','l2d-input');resolution.setAttribute('aria-label',t('预览精度','Preview resolution'));
  for(const size of [256,512,1024]){const option=el('option',null,size+' px');option.value=String(size);resolution.append(option);}resolution.value='512';resolutionLabel.append(resolution);
  const leftShell=el('div','l2d-bind-left'),pages=el('div','l2d-bind-pages');pages.setAttribute('role','tablist');pages.setAttribute('aria-label',t('编辑页面','Editor pages'));
  leftShell.append(pages,left);
  toolbar.append(raw,replay,reset,resolutionLabel,retry);stage.append(gallery,hint,toolbar);layout.append(leftShell,stage,right);
  const footer=el('div','l2d-bind-footer'),summary=el('span','l2d-bind-summary',t('未绑定的项目使用通用配方','Unbound targets use generic recipes'));
  const footInfo=el('div','l2d-bind-footinfo');
  const newGroup=el('button','l2d-bind-newgroup',t('＋ 新建分组','＋ New group'));newGroup.type='button';
  footInfo.append(summary,newGroup);
  const cancel=el('button','l2d-btn',t('取消','Cancel')),save=el('button','l2d-btn primary',t('保存绑定','Save bindings'));save.disabled=true;
  const restoreAll=el('button','l2d-btn quiet sm',t('全部恢复通用','Reset all to generic'));restoreAll.disabled=true;
  const skipImages=el('button','l2d-btn',t('跳过图片','Skip images'));skipImages.hidden=true;
  footer.append(footInfo,restoreAll,cancel,skipImages,save);card.append(head,layout,footer);modal.append(card);ctx.root.append(modal);modal.showModal();
  let closed=false,saving=false,saveSequence=0,skippingImages=false,dirty=false,data,bindings=[],word='happy',resource=null,rawMode=false,serial=0,previewTimer,sampleSet=0,discardPrompt=null,leaseTimer,sessionValid=true;
  let page='actions',groups=[],picks={},groupId=null,optionId='default',closeGroupDialog;const pageState={actions:{resource:null,filter:'all',search:''},wardrobe:{resource:null,filter:'all',search:''}};
  const uid=prefix=>prefix+(win.crypto?.randomUUID?.().replaceAll('-','')||Math.random().toString(16).slice(2)).slice(0,12);
  const signature=items=>JSON.stringify(items.map(({word,resource,release})=>({word,resource,...(release?{release}:{})})).sort((a,b)=>a.word.localeCompare(b.word)));
  const canEdit=()=>!!data&&sessionValid&&!saving;
  const canSave=()=>canEdit()&&(!data.buildId||dirty||data.wardrobeNeedsSave);
  const syncControls=()=>{
    layout.inert=saving;pages.inert=saving;save.disabled=!canSave();close.disabled=cancel.disabled=saving;
    skipImages.hidden=!saving;skipImages.disabled=skippingImages;
    restoreAll.disabled=!canEdit()||(page==='actions'?!bindings.length:!groups.length);
    restoreAll.textContent=page==='actions'?t('全部恢复通用','Reset all to generic'):t('恢复默认外观','Default appearance');
    newGroup.hidden=page!=='wardrobe';raw.hidden=page==='wardrobe';
    newGroup.disabled=resolution.disabled=raw.disabled=replay.disabled=reset.disabled=retry.disabled=!canEdit();
  };
  const setPreviewBusy=busy=>{gallery.setAttribute('aria-busy',String(busy));gallery.classList.toggle('is-pending',busy);};
  const stopPreviewUpdates=()=>{serial++;win.clearTimeout(previewTimer);setPreviewBusy(false);};
  const sessionError=message=>/编辑已过期|编辑已取消|模型素材已变化|形象包已变化|原打包产物已移除/.test(message);
  const expireSession=message=>{
    sessionValid=false;stopPreviewUpdates();retry.hidden=true;hint.textContent=message;syncControls();paintSelection();
  };
  const changed=()=>{dirty=signature(bindings)!==signature(data.bindings||[])||JSON.stringify(groups)!==JSON.stringify(data.wardrobe||[]);syncControls();};
  const alive=()=>!closed&&!ctx.signal?.aborted;
  const release=()=>{if(closed)return;closed=true;win.clearInterval(leaseTimer);closeGroupDialog?.();discardPrompt?.dispose();leave?.dispose?.();ctx.signal?.removeEventListener('abort',release);stopPreviewUpdates();gallery.replaceChildren();modal.close();modal.remove();onClosed?.();const token=data?.token||requestedToken;if(token&&!ctx.signal?.aborted)ctx.invoke('manualClose',[token]).catch(()=>{});previous?.focus?.();};
  const requestClose=async()=>{
    if(closed||saving||discardPrompt)return;
    if(dirty){discardPrompt=bindingDiscardPrompt(modal,zh);const accepted=await discardPrompt.result;discardPrompt=null;if(!accepted||!alive())return;}
    release();
  };
  close.onclick=cancel.onclick=requestClose;modal.addEventListener('cancel',e=>{e.preventDefault();void requestClose();});modal.addEventListener('click',e=>{if(e.target===modal)void requestClose();});
  const leave=ctx.guardLeave?.(()=>alive()&&(dirty||saving)?t('动作绑定尚未保存，确定离开？','Bindings are not saved. Leave?'):null);
  ctx.signal?.addEventListener('abort',release,{once:true});
  const loadPreview=(candidate=false,groundOverride)=>{
    if(!canEdit()||!alive())return;
    const preview=structuredClone(groups),selected={...picks},g=preview.find(g=>g.id===groupId);
    if(candidate&&page==='wardrobe'&&resource&&!resource.wardrobeError&&g&&!wardrobeConflict(resource,g.id)){
      const ground=groundOverride??g.options.find(o=>o.id===optionId)?.ground;
      g.options=g.options.slice(0,15);g.options.push({id:'preview',name:resource.title,resource:resource.id,...(ground?{ground:true}:{})});selected[g.id]='preview';
    }
    const request={page,word,resource:page==='actions'?resource?.id:null,raw:rawMode,bindings:structuredClone(bindings),groups:preview,picks:selected,sampleSet,previewSize:Number(resolution.value)};
    const generation=++serial;win.clearTimeout(previewTimer);retry.hidden=true;setPreviewBusy(true);
    hint.textContent=t('正在生成对照图，可以继续编辑。','Generating comparison. You can keep editing.');
    previewTimer=win.setTimeout(async()=>{
      try{
        const result=await ctx.invoke('manualPreview',[data.token,request]);if(!alive()||generation!==serial)return;
        if(!Array.isArray(result.frames)||!result.frames.length||result.frames.length>3)throw Error(t('预览图片不完整','Incomplete preview'));
        const labels={default:t('默认','Default'),generic:t('通用表现','Generic'),appearance:t('当前装扮','Current appearance'),native:t('原生效果','Native'),combined:t('组合效果','Combined')};
        const figures=result.frames.map(item=>{if(!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(item.png||''))throw Error(t('预览图片无效','Invalid preview image'));const figure=el('figure','l2d-bind-shot'),image=el('img'),caption=el('figcaption',null,(labels[item.kind]||'')+(item.resource&&item.time?' · '+item.time.toFixed(2)+'s':''));image.src=item.png;image.alt=caption.textContent;image.width=image.height=request.previewSize;figure.append(image,caption);return figure;});
        gallery.replaceChildren(...figures);gallery.dataset.count=String(figures.length);gallery.dataset.previewInfo=JSON.stringify({quality:result.quality,frames:result.frames.map(({png,...frame})=>frame)});
        hint.textContent=page==='actions'?(resource?label(word)+' · '+resource.title:t('通用表现','Generic behavior')):t('静态外观对照','Appearance comparison');
      }catch(error){
        if(!alive()||generation!==serial)return;
        const message=String(error.message||error);
        if(sessionError(message)){expireSession(message);return;}
        const stale=gallery.childElementCount?t('仍显示上次预览。','The previous preview is still shown. '):'';
        hint.textContent=t('预览失败，可继续编辑或降低精度重试。','Preview failed. You can keep editing or retry at a lower resolution. ')+stale+message;
        retry.hidden=false;
      }finally{if(alive()&&generation===serial)setPreviewBusy(false);}
    },160);
  };
  const sendWardrobe=(candidate=false)=>loadPreview(candidate);
  const play=()=>loadPreview(true);
  raw.onclick=()=>{rawMode=!rawMode;raw.textContent=rawMode?t('原生效果','Native only'):t('组合效果','Combined');raw.setAttribute('aria-pressed',String(rawMode));play();};
  replay.onclick=()=>{sampleSet=(sampleSet+1)%3;play();};
  resolution.onchange=play;
  reset.onclick=()=>{picks={};resource=null;optionId='default';paintTargets();paintResources();loadPreview();};
  let filter='all';const search=el('input','l2d-input');search.placeholder=t('搜索原生资源','Search native resources');search.setAttribute('aria-label',search.placeholder);
  const tabs=el('div','l2d-bind-tabs'),list=el('div','l2d-bind-list'),binding=el('div','l2d-bind-selection');
  right.append(search,tabs,list,binding);
  const paintTargets=()=>{left.replaceChildren();if(page==='wardrobe'){paintWardrobeTargets();return;}for(const [key,title]of [['expressions',t('表情','Expressions')],['motions',t('动作','Motions')]]){
    left.append(el('h3',null,title));for(const w of data.words[key]){
      const b=el('button','l2d-bind-target'+(w===word?' selected':''));b.type='button';b.setAttribute('aria-pressed',String(w===word));
      b.append(el('span',null,label(w)),el('small',null,bindings.some(b=>b.word===w)?t('已绑定','Bound'):t('通用','Generic')));
      b.onclick=()=>{word=w;const match=bindings.find(b=>b.word===w);resource=data.resources.find(r=>r.id===match?.resource)||null;paintTargets();paintResources();play();};left.append(b);
    }
  }};
  const paintSelection=()=>{
    if(page==='wardrobe'){paintWardrobeSelection();return;}
    binding.replaceChildren();const current=bindings.find(b=>b.word===word);
    const caption=el('p',null,`${label(word)} ← ${current?data.resources.find(r=>r.id===current.resource)?.title:t('通用配方','Generic recipe')}`);binding.append(caption);
    const bind=el('button','l2d-btn primary',t(`绑定到「${label(word)}」`,`Bind to ${label(word)}`));
    const restore=el('button','l2d-btn quiet',t('恢复通用','Use generic'));restore.disabled=!canEdit()||!current;
    let releaseSelect;
    if(resource?.classification==='pose'){
      binding.append(el('label',null,t('复位动作','Reset motion')));releaseSelect=el('select','l2d-input');releaseSelect.setAttribute('aria-label',t('复位动作','Reset motion'));
      releaseSelect.append(el('option',null,t('请选择','Choose')));releaseSelect.firstChild.value='';
      for(const r of data.resources.filter(r=>r.kind==='motion'&&r.classification!=='appearance'&&r.id!==resource.id)){const o=el('option',null,r.title);o.value=r.id;releaseSelect.append(o);}
      releaseSelect.value=current?.resource===resource.id?current.release||resource.release||'':resource.release||'';
      binding.append(releaseSelect);releaseSelect.disabled=!canEdit();
    }
    const canBind=()=>canEdit()&&resource&&resource.classification!=='appearance'
      &&(resource.kind!=='expression'||data.words.expressions.includes(word))&&(!releaseSelect||releaseSelect.value);
    bind.disabled=!canBind();if(releaseSelect)releaseSelect.onchange=()=>{bind.disabled=!canBind();};
    bind.onclick=()=>{if(!canBind()||discardPrompt)return;const channels=new Set(groups.flatMap(g=>g.options.flatMap(o=>data.resources.find(r=>r.id===o.resource)?.channels||[])));const used=[resource,...data.resources.filter(r=>r.id===releaseSelect?.value)].flatMap(r=>r.channels||[]);if(used.some(c=>channels.has(c))){ctx.ui.toast(t('该资源与装扮共用参数，请调整绑定','This resource overlaps wardrobe controls'),'bad');return;}bindings=bindings.filter(b=>b.word!==word);bindings.push({word,resource:resource.id,...(releaseSelect?.value?{release:releaseSelect.value}:{}),confidence:1,reason:'用户在动作编辑器中选择'});changed();paintTargets();paintSelection();play();};
    restore.onclick=()=>{if(!canEdit()||discardPrompt)return;bindings=bindings.filter(b=>b.word!==word);resource=null;changed();paintTargets();paintResources();play();};binding.append(bind,restore);
    paintSummary();
  };
  const paintResources=()=>{list.replaceChildren();const q=search.value.trim().toLocaleLowerCase();
    const resources=data.resources.filter(r=>(page!=='wardrobe'||!r.wardrobeError)&&(filter==='all'||filter==='other'?filter!=='other'||r.classification==='appearance':r.kind===filter)&&(!q||r.title.toLocaleLowerCase().includes(q)));
    for(const r of resources){const b=el('button','l2d-bind-resource'+(r.id===resource?.id?' selected':''));b.append(el('span',null,r.title),el('small',null,page==='wardrobe'?(r.kind==='expression'?t('外观状态','Appearance state'):t('动作末帧 · 持久','Final frame · held')):r.classification==='appearance'?t('其他 · 仅预览','Other · preview only'):r.kind==='expression'?t('表情','Expression'):t(`动作 · ${r.seconds.toFixed(1)} 秒`,`Motion · ${r.seconds.toFixed(1)} s`)));b.onclick=()=>{resource=r;paintResources();play();};list.append(b);}
    if(!resources.length)list.append(el('p','l2d-bind-empty',t('没有匹配的资源','No matching resources')));paintSelection();
  };
  function paintSummary(){const used=groups.filter(g=>g.options.length).length;const total=groups.length||3;summary.textContent=t(`${bindings.length} 项绑定 · 外观 ${used}/${total} 栏 · 保存后从卡片安装`,`${bindings.length} bindings · ${used}/${total} appearance slots · save then install`);}
  function wardrobeConflict(r,id){
    const ids=[...bindings.flatMap(b=>[b.resource,b.release].filter(Boolean)),...groups.filter(g=>g.id!==id).flatMap(g=>g.options.map(o=>o.resource))];
    const used=new Set(ids.flatMap(id=>data.resources.find(r=>r.id===id)?.channels||[]));return (r?.channels||[]).some(c=>used.has(c));
  }
  function paintWardrobeTargets(){
    for(const g of groups){
      const title=zh?(g.name||''):(g.en||g.name||WARDROBE_SLOTS.find(s=>s.slot===g.slot)?.en||'');
      const row=el('div','l2d-bind-grow');
      const header=el('button','l2d-bind-group'+(g.id===groupId?' selected':''),title);header.onclick=()=>{groupId=g.id;optionId=picks[g.id]||'default';resource=data.resources.find(r=>r.id===g.options.find(o=>o.id===optionId)?.resource)||null;paintTargets();paintResources();sendWardrobe();};
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
          if(groupId===g.id){groupId=groups[0]?.id||null;optionId='default';resource=null;}
          changed();paintTargets();paintResources();sendWardrobe();
        };
        row.append(del);
      }
      left.append(row);
      for(const o of [{id:'default',name:t('默认','Default')},...g.options]){
        const chosen=(picks[g.id]||'default')===o.id;
        const b=el('button','l2d-bind-target'+(chosen?' selected':''),o.name);b.setAttribute('aria-label',title+'：'+o.name);b.setAttribute('aria-pressed',String(chosen));
        b.onclick=()=>{groupId=g.id;optionId=o.id;picks[g.id]=o.id;resource=data.resources.find(r=>r.id===o.resource)||null;paintTargets();paintResources();sendWardrobe();if(canEdit())hint.textContent=g.name+' · '+o.name;};left.append(b);
      }
      const add=el('button','l2d-btn quiet sm',t('＋ 新选项','＋ New option'));add.onclick=()=>{groupId=g.id;optionId=null;resource=null;paintTargets();paintResources();};left.append(add);
    }
  }
  function paintWardrobeSelection(){
    binding.replaceChildren();const g=groups.find(g=>g.id===groupId);paintSummary();
    if(!g){binding.append(el('p',null,t('在左侧选择装扮、部件或配饰','Choose Outfit, Parts or Accessories on the left')));return;}
    binding.append(el('p',null,t(g.name+' · 每次选一个原生按钮',(g.en||g.name||WARDROBE_SLOTS.find(s=>s.slot===g.slot)?.en||'')+' · one native resource at a time')));
    const current=g.options.find(o=>o.id===optionId),name=el('input','l2d-input');name.value=current?.name||resource?.title||'';name.maxLength=60;name.placeholder=t('选项名称，例如戴上','Option name, e.g. wear');name.setAttribute('aria-label',t('装扮选项名称','Wardrobe option name'));binding.append(name);
    const conflict=resource&&wardrobeConflict(resource,g.id);if(conflict)binding.append(el('p','l2d-bind-warning',t('与动作或其他装扮组共用参数，请调整绑定。','Shares controls with actions or another wardrobe group.')));
    const add=el('button','l2d-btn primary',current?t('保存选项','Update option'):t('添加选项','Add option'));
    const groundLabel=el('label','l2d-bind-ground'),ground=el('input','l2d-switch');ground.type='checkbox';ground.setAttribute('role','switch');ground.setAttribute('aria-label',t('切换后贴地','Ground after switching'));ground.checked=current?.ground===true;ground.disabled=!canEdit()||!resource||!!conflict;
    groundLabel.title=t('改变体型时启用；保持大小，仅在切换后测量并贴地。','For shape changes: keep scale, measure and ground on switching.');groundLabel.append(ground,el('span',null,t('切换后贴地','Ground on switch')));
    const canAdd=()=>canEdit()&&resource&&!resource.wardrobeError&&!conflict&&!!name.value.trim()&&(!!current||g.options.length<16);add.disabled=!canAdd();name.oninput=()=>{add.disabled=!canAdd();};
    ground.onchange=()=>{if(ground.disabled)return;if(current){if(ground.checked)current.ground=true;else delete current.ground;changed();sendWardrobe();}else if(resource){const preview=structuredClone(groups),group=preview.find(p=>p.id===g.id);group.options=group.options.slice(0,15);group.options.push({id:'preview',name:resource.title,resource:resource.id,...(ground.checked?{ground:true}:{})});loadPreview(true,ground.checked);}};
    add.onclick=()=>{if(!canAdd()||discardPrompt)return;const o={id:current?.id||uid('v'),name:name.value.trim(),resource:resource.id,...(ground.checked?{ground:true}:{})};if(current)g.options=g.options.map(p=>p.id===o.id?o:p);else g.options.push(o);optionId=o.id;picks[g.id]=o.id;changed();paintTargets();paintResources();sendWardrobe();};const actions=el('div','l2d-bind-option-actions');actions.append(add,groundLabel);binding.append(actions);
    if(current){const remove=el('button','l2d-btn quiet',t('移除选项','Remove option'));remove.disabled=!canEdit();remove.onclick=()=>{if(!canEdit())return;g.options=g.options.filter(o=>o.id!==current.id);picks[g.id]='default';optionId='default';resource=null;changed();paintTargets();paintResources();sendWardrobe();};binding.append(remove);}
    binding.append(el('p','l2d-bind-note',t('每组可选一个选项。保存并安装后可在 Coo 装扮页切换。','Pick one option per group. Save and install to switch them in Coo.')));
  }
  for(const [id,title]of [['actions',t('动作','Actions')],['wardrobe',t('装扮','Wardrobe')]]){
    const b=el('button','l2d-btn quiet sm',title);b.setAttribute('role','tab');b.setAttribute('aria-selected',String(page===id));b.onclick=()=>{
      if(!data||saving||discardPrompt||page===id)return;pageState[page]={resource,filter,search:search.value};page=id;({resource,filter}=pageState[id]);search.value=pageState[id].search;for(const n of pages.children)n.setAttribute('aria-selected',String(n===b));
      if(page==='wardrobe'&&!groupId)groupId=groups[0]?.id||null;for(const n of tabs.children)n.classList.toggle('selected',n.dataset.filter===filter);syncControls();paintTargets();paintResources();play();
    };pages.append(b);
  }
  for(const [value,title]of [['all',t('全部','All')],['expression',t('表情','Faces')],['motion',t('动作','Motions')],['other',t('其他','Other')]]){
    const b=el('button','l2d-btn quiet sm',title);b.dataset.filter=value;b.onclick=()=>{if(!data)return;filter=value;for(const n of tabs.children)n.classList.toggle('selected',n===b);paintResources();};tabs.append(b);
  }tabs.firstChild.classList.add('selected');search.oninput=()=>{if(data)paintResources();};
  restoreAll.onclick=async()=>{
    if(!canEdit()||discardPrompt)return;
    if(page==='wardrobe'){picks={};resource=null;optionId='default';paintTargets();paintResources();sendWardrobe();hint.textContent=t('已恢复默认外观，装扮选项保留','Default appearance restored. Wardrobe options kept.');return;}
    if(!bindings.length)return;
    discardPrompt=bindingDiscardPrompt(modal,zh,{title:t('全部恢复通用？','Reset all bindings?'),body:t('清空当前绑定，保留原生资源。点击保存后生效。','Clear all bindings and keep native resources. Save to apply.'),cancel:t('保留绑定','Keep bindings'),accept:t('全部恢复','Reset all')});
    const accepted=await discardPrompt.result;discardPrompt=null;if(!accepted||!alive()||!canEdit())return;
    bindings=[];resource=null;rawMode=false;raw.textContent=t('组合效果','Combined');raw.setAttribute('aria-pressed','false');changed();paintTargets();paintResources();play();
  };
  const askGroup=()=>new Promise(resolve=>{
    const dlg=el('dialog','l2d-modal l2d-group-modal');
    const box=el('div','l2d-group-box');
    box.append(el('div','l2d-modal-title',t('新建分组','New group')));
    const zhName=el('input','l2d-input');zhName.placeholder=t('中文名，例如 发型','Chinese name, e.g. Hair');zhName.maxLength=24;
    const enName=el('input','l2d-input');enName.placeholder=t('英文名（可选）','English name (optional)');enName.maxLength=24;
    zhName.setAttribute('aria-label',t('分组中文名','Group name'));enName.setAttribute('aria-label',t('分组英文名','Group English name'));
    const actions=el('div','l2d-group-actions');
    const cancelBtn=el('button','l2d-btn',t('取消','Cancel')),okBtn=el('button','l2d-btn primary',t('创建','Create'));
    actions.append(cancelBtn,okBtn);
    box.append(zhName,enName,actions);dlg.append(box);ctx.root.append(dlg);
    const done=value=>{closeGroupDialog=undefined;dlg.close();dlg.remove();resolve(value);};
    closeGroupDialog=()=>done(null);
    cancelBtn.onclick=()=>done(null);
    dlg.addEventListener('cancel',e=>{e.preventDefault();done(null);});
    okBtn.onclick=()=>{const name=zhName.value.trim();if(!name){zhName.focus();return;}done({name,en:enName.value.trim()});};
    zhName.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();okBtn.click();}});
    enName.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();okBtn.click();}});
    dlg.showModal();zhName.focus();
  });
  newGroup.onclick=async()=>{
    if(page!=='wardrobe'||!canEdit()||discardPrompt)return;
    const value=await askGroup();
    if(!value||!alive()||!canEdit())return;
    const group={id:uid('g'),custom:true,name:value.name,...(value.en?{en:value.en}:{}),options:[]};
    groups.push(group);groupId=group.id;optionId=null;resource=null;
    changed();paintTargets();paintResources();sendWardrobe();
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
    stopPreviewUpdates();saveSequence++;saving=true;syncControls();paintSelection();hint.textContent=t('保存并打包…','Saving & packing…');skipImages.focus();
    try{
      const result=await ctx.invoke('manualSave',[data.token,structuredClone(bindings),structuredClone(groups)]);dirty=false;release();
      const saved=t('绑定已保存，可从卡片安装','Bindings saved. Install from the pack card.');
      if(result?.warn)ctx.ui.toast(saved+' · '+result.warn);
      else ctx.ui.toast(saved,'ok');
      try{await onSaved?.(result);}catch{ctx.ui.toast(t('绑定已保存，模型包列表刷新失败，请稍后重新打开页面','Bindings saved; the pack list could not refresh. Reopen the page later.'),'bad');}
    }
    catch(error){if(alive()){const message=String(error.message||error);if(sessionError(message))expireSession(message);else hint.textContent=message;ctx.ui.toast(message,'bad');}}
    finally{saving=false;skippingImages=false;if(alive()){syncControls();paintSelection();}}
  };
  retry.onclick=play;
  syncControls();
  try{
    data=await ctx.invoke(method,requestedToken?[...args,requestedToken]:args);
    resolution.value=String([256,512,1024].includes(data.previewSize)?data.previewSize:512);
    if(data.token!==requestedToken)ctx.notifyOnUnmount?.('manualClose',[data.token]);
    if(!alive()){if(!ctx.signal?.aborted)ctx.invoke('manualClose',[data.token]).catch(()=>{});return {get closed(){return closed;},dispose:release};}
    bindings=structuredClone(data.bindings||[]);groups=fixedWardrobeGroups(data.wardrobe||[]).map((g,i)=>({...g,...(i>=3?{custom:true}:{})}));data.wardrobe=structuredClone(groups);changed();heading.querySelector('.l2d-modal-sub').textContent=data.title;paintTargets();paintResources();
    if(data.truncated||data.warnings?.length)right.prepend(el('p','l2d-bind-empty',t('部分资源未能读取，列表可能不完整','Some resources could not be read; the list may be incomplete')));
    if(data.truncated)hint.textContent=t('资源扫描不完整，请核对模型内容','Resource scan is incomplete; check the model');
    leaseTimer=win.setInterval(()=>{if(alive()&&sessionValid)ctx.invoke('manualKeepAlive',[data.token]).catch(error=>{const message=String(error.message||error);if(alive()&&sessionError(message))expireSession(message);});},60000);
    loadPreview();
  }catch(error){if(alive())hint.textContent=String(error.message||error);}
  return {get closed(){return closed;},dispose(){leave?.dispose?.();release();}};
}
