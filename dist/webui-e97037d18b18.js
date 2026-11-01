const WARDROBE_SLOTS = [
  {slot:'outfit',id:'lookoutfit',name:'装扮',en:'Outfit'},
  {slot:'parts',id:'lookparts',name:'部件',en:'Parts'},
  {slot:'accessories',id:'lookaccessories',name:'配饰',en:'Accessories'},
];

// Preserve legacy axis/option IDs so existing picks survive the next save.
function fixedWardrobeGroups(groups=[]) {
  if(!Array.isArray(groups)||groups.length>3)throw Error('最多支持装扮、部件、配饰三个栏位；旧分组超出上限时保留原包');
  const assigned=new Map(),pending=[];
  for(const group of groups){
    if(!group||typeof group!=='object'||!Array.isArray(group.options))throw Error('装扮分组无效');
    const slot=group.slot?WARDROBE_SLOTS.find(s=>s.slot===group.slot):WARDROBE_SLOTS.find(s=>s.name===group.name||s.en===group.name);
    if(group.slot&&!slot||slot&&assigned.has(slot.slot))throw Error('装扮栏位重复或无效');
    if(slot)assigned.set(slot.slot,group);else pending.push(group);
  }
  for(const slot of WARDROBE_SLOTS)if(!assigned.has(slot.slot)&&pending.length)assigned.set(slot.slot,pending.shift());
  const used=new Set(groups.map(g=>g.id));
  return WARDROBE_SLOTS.map(slot=>{
    const group=assigned.get(slot.slot);let id=group?.id||slot.id;
    if(!group&&used.has(id)){let n=1;while(used.has(id=slot.id+n))n++;}used.add(id);
    return {id,slot:slot.slot,name:slot.name,options:(group?.options||[]).map(o=>({...o}))};
  });
}

// The official figure-frame protocol, with a scoped temporary resource URL.
async function mountBindingPreview(ctx,frame,data,alive,onStatus) {
  const win=frame.ownerDocument.defaultView;
  let ready=false,closed=false,clock,previousSize='';
  const send=message=>{if(!closed)frame.contentWindow?.postMessage(message,'*');};
  const bounds=()=>{const W=Math.max(100,frame.clientWidth),H=Math.max(100,frame.clientHeight);return {W,H,floorY:H-12,S:Math.min(W/300,(H-32)/256)};};
  const tick=dtMs=>{
    if(closed||!alive()||!ready)return;
    const size=bounds(),key=JSON.stringify(size);if(key!==previousSize){previousSize=key;send({t:'set',state:{bounds:size}});}
    send({t:'tick',dt:Math.min(.05,Math.max(0,dtMs)/1000)||.016});
  };
  const dispose=()=>{if(closed)return;closed=true;clock?.dispose?.();clearTimeout(timer);win.removeEventListener('message',listener);frame.src='about:blank';};
  const fail=message=>{dispose();if(alive())onStatus('error',message);};
  const timer=setTimeout(()=>fail('模型预览加载超时，请重试'),20000);
  const listener=event=>{
    if(event.source!==frame.contentWindow||closed)return;
    const m=event.data||{};
    if(m.t==='loaded')send({t:'init',entry:data.preview.entry,base:data.preview.base,export:'createFigureBody',scheme:'',start:{x:bounds().W/2,facing:1},bounds:bounds(),language:ctx.language||'zh',theme:'light'});
    else if(m.t==='ready'&&!ready){ready=true;clearTimeout(timer);send({t:'set',state:{roam:'off'}});clock=ctx.frame(tick);onStatus('ready','');}
    else if(m.t==='error')fail(m.message||'模型预览失败');
    else if(m.t==='preview-info')frame.dataset.previewInfo=JSON.stringify(m);
  };
  win.addEventListener('message',listener);
  frame.setAttribute('sandbox','allow-scripts');frame.src=data.preview.url;
  return dispose;
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
  const names={neutral:'中性',happy:'开心',wink:'眨眼',love:'喜欢',shy:'害羞',surprised:'惊讶',angry:'生气',sad:'难过',sleepy:'困倦',thinking:'思考',smug:'得意',pout:'嘟嘴',worried:'担心',determined:'坚定',flustered:'慌乱',scared:'害怕',excited:'兴奋',cry:'哭泣',confused:'疑惑',idle:'待机',nod:'点头',shake:'摇头',wave:'挥手',bow:'鞠躬',cheer:'欢呼',dance:'跳舞',jump:'跳跃',sit:'坐下',stretch:'伸展',shiver:'发抖'};
  const label=w=>zh?names[w]||w:w;
  const el=(tag,cls,text)=>{const n=doc.createElement(tag);n.className=cls||'';if(text!=null)n.textContent=text;return n;};
  const previous=doc.activeElement;
  const requestedToken=win.crypto?.randomUUID?.();
  if(requestedToken)ctx.notifyOnUnmount?.('manualClose',[requestedToken]);
  const modal=el('dialog','l2d-modal l2d-bind-modal');modal.setAttribute('aria-label',t('动作与装扮','Actions and wardrobe'));
  const card=el('div','l2d-bind-card'),head=el('div','l2d-modal-head'),heading=el('div','l2d-modal-heading');
  heading.append(el('div','l2d-modal-title',t('动作与装扮','Actions and wardrobe')),el('div','l2d-modal-sub',t('选择表情或动作，预览后绑定','Choose a target, preview a resource, then bind')));
  const close=el('button','l2d-btn quiet l2d-modal-close','×');close.setAttribute('aria-label',t('关闭动作与装扮','Close editor'));head.append(heading,close);
  const layout=el('div','l2d-bind-layout'),left=el('nav','l2d-bind-targets'),stage=el('section','l2d-bind-stage'),right=el('section','l2d-bind-resources');
  left.setAttribute('aria-label',t('绑定目标','Binding targets'));right.setAttribute('aria-label',t('原生资源','Native resources'));
  const frame=el('iframe','l2d-bind-frame');frame.title=t('模型实时预览','Live model preview');frame.setAttribute('sandbox','allow-scripts');
  const hint=el('p','l2d-bind-status',t('准备模型…','Preparing model…'));hint.setAttribute('role','status');
  const toolbar=el('div','l2d-bind-toolbar'),raw=el('button','l2d-btn sm',t('组合效果','Combined')),replay=el('button','l2d-btn sm',t('重播','Replay')),reset=el('button','l2d-btn sm',t('复位','Reset'));
  const retry=el('button','l2d-btn sm',t('重试预览','Retry preview'));retry.hidden=true;
  const leftShell=el('div','l2d-bind-left'),pages=el('div','l2d-bind-pages');pages.setAttribute('role','tablist');pages.setAttribute('aria-label',t('编辑页面','Editor pages'));
  leftShell.append(pages,left);
  toolbar.append(raw,replay,reset,retry);stage.append(frame,hint,toolbar);layout.append(leftShell,stage,right);
  const footer=el('div','l2d-bind-footer'),summary=el('span','l2d-bind-summary',t('未绑定的项目使用通用配方','Unbound targets use generic recipes'));
  const cancel=el('button','l2d-btn',t('取消','Cancel')),save=el('button','l2d-btn primary',t('保存绑定','Save bindings'));save.disabled=true;
  const restoreAll=el('button','l2d-btn quiet sm',t('全部恢复通用','Reset all to generic'));restoreAll.disabled=true;
  footer.append(summary,restoreAll,cancel,save);card.append(head,layout,footer);modal.append(card);ctx.root.append(modal);modal.showModal();
  let closed=false,saving=false,dirty=false,data,bindings=[],word='happy',resource=null,rawMode=false,ready=false,cleanup=()=>{},serial=0,discardPrompt=null,leaseTimer,sessionValid=true,previewError='';
  let page='actions',groups=[],picks={},groupId=null,optionId='default';const pageState={actions:{resource:null,filter:'all',search:''},wardrobe:{resource:null,filter:'all',search:''}};
  const uid=prefix=>prefix+(win.crypto?.randomUUID?.().replaceAll('-','')||Math.random().toString(16).slice(2)).slice(0,12);
  const signature=items=>JSON.stringify(items.map(({word,resource,release})=>({word,resource,...(release?{release}:{})})).sort((a,b)=>a.word.localeCompare(b.word)));
  const syncControls=()=>{layout.inert=saving;pages.inert=saving;save.disabled=saving||!ready||!sessionValid||!!data?.buildId&&!dirty&&!data.wardrobeNeedsSave;close.disabled=cancel.disabled=saving;restoreAll.disabled=saving||!ready||(page==='actions'?!bindings.length:!groups.length);restoreAll.textContent=page==='actions'?t('全部恢复通用','Reset all to generic'):t('恢复默认外观','Default appearance');raw.hidden=page==='wardrobe';raw.disabled=replay.disabled=reset.disabled=!ready||saving;retry.disabled=saving||!sessionValid;};
  const changed=()=>{dirty=signature(bindings)!==signature(data.bindings||[])||JSON.stringify(groups)!==JSON.stringify(data.wardrobe||[]);syncControls();};
  const alive=()=>!closed&&!ctx.signal?.aborted;
  const release=()=>{if(closed)return;closed=true;win.clearInterval(leaseTimer);discardPrompt?.dispose();leave?.dispose?.();ctx.signal?.removeEventListener('abort',release);cleanup();modal.close();modal.remove();onClosed?.();const token=data?.token||requestedToken;if(token&&!ctx.signal?.aborted)ctx.invoke('manualClose',[token]).catch(()=>{});previous?.focus?.();};
  const requestClose=async()=>{
    if(closed||saving||discardPrompt)return;
    if(dirty){discardPrompt=bindingDiscardPrompt(modal,zh);const accepted=await discardPrompt.result;discardPrompt=null;if(!accepted||!alive())return;}
    release();
  };
  close.onclick=cancel.onclick=requestClose;modal.addEventListener('cancel',e=>{e.preventDefault();void requestClose();});modal.addEventListener('click',e=>{if(e.target===modal)void requestClose();});
  const leave=ctx.guardLeave?.(()=>alive()&&(dirty||saving)?t('动作绑定尚未保存，确定离开？','Bindings are not saved. Leave?'):null);
  ctx.signal?.addEventListener('abort',release,{once:true});
  const send=type=>{if(ready)frame.contentWindow.postMessage({t:type==='play'?'preview-play':'preview-stop',resource:resource?.id,word,bindings,raw:rawMode},'*');};
  const sendWardrobe=(candidate=false)=>{
    if(!ready)return;const preview=structuredClone(groups),selected={...picks},g=preview.find(g=>g.id===groupId);
    if(candidate&&page==='wardrobe'&&resource&&!resource.wardrobeError&&g&&!wardrobeConflict(resource,g.id)){g.options=g.options.slice(0,15);g.options.push({id:'preview',name:resource.title,resource:resource.id});selected[g.id]='preview';}
    frame.contentWindow.postMessage({t:'preview-wardrobe',groups:preview,picks:selected},'*');
  };
  const play=()=>{if(!ready||saving)return;sendWardrobe(true);if(page==='actions')send('play');else frame.contentWindow.postMessage({t:'preview-play',word:'neutral',bindings:[],raw:false},'*');if(!previewError)hint.textContent=page==='actions'?(resource?`${label(word)} · ${resource.title}`:t('通用表现','Generic behavior')):(resource?`${resource.title}${resource.kind==='motion'?t(' · 动作末帧',' · final frame'):''}`:t('当前装扮','Current appearance'));};
  raw.onclick=()=>{rawMode=!rawMode;raw.textContent=rawMode?t('原生效果','Native only'):t('组合效果','Combined');raw.setAttribute('aria-pressed',String(rawMode));play();};replay.onclick=play;reset.onclick=()=>{if(page==='wardrobe'){picks={};resource=null;optionId='default';paintTargets();paintResources();sendWardrobe();}send('stop');hint.textContent=t('已复位','Reset');};
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
    bind.disabled=saving||!ready||!resource||resource.classification==='appearance'||resource.kind==='expression'&&!data.words.expressions.includes(word);
    const restore=el('button','l2d-btn quiet',t('恢复通用','Use generic'));restore.disabled=saving||!ready||!current;
    let releaseSelect;
    if(resource?.classification==='pose'){
      binding.append(el('label',null,t('复位动作','Reset motion')));releaseSelect=el('select','l2d-input');releaseSelect.setAttribute('aria-label',t('复位动作','Reset motion'));
      releaseSelect.append(el('option',null,t('请选择','Choose')));releaseSelect.firstChild.value='';
      for(const r of data.resources.filter(r=>r.kind==='motion'&&r.classification!=='appearance'&&r.id!==resource.id)){const o=el('option',null,r.title);o.value=r.id;releaseSelect.append(o);}
      releaseSelect.value=current?.resource===resource.id?current.release||resource.release||'':resource.release||'';
      binding.append(releaseSelect);bind.disabled=bind.disabled||!releaseSelect.value;releaseSelect.onchange=()=>{bind.disabled=saving||!ready||!releaseSelect.value;};
    }
    bind.onclick=()=>{if(saving||!ready||discardPrompt)return;const channels=new Set(groups.flatMap(g=>g.options.flatMap(o=>data.resources.find(r=>r.id===o.resource)?.channels||[])));const used=[resource,...data.resources.filter(r=>r.id===releaseSelect?.value)].flatMap(r=>r.channels||[]);if(used.some(c=>channels.has(c))){ctx.ui.toast(t('该资源与装扮共用参数，请调整绑定','This resource overlaps wardrobe controls'),'bad');return;}bindings=bindings.filter(b=>b.word!==word);bindings.push({word,resource:resource.id,...(releaseSelect?.value?{release:releaseSelect.value}:{}),confidence:1,reason:'用户在动作编辑器中选择'});changed();paintTargets();paintSelection();play();};
    restore.onclick=()=>{if(saving||!ready||discardPrompt)return;bindings=bindings.filter(b=>b.word!==word);resource=null;changed();paintTargets();paintResources();play();};binding.append(bind,restore);
    paintSummary();
  };
  const paintResources=()=>{list.replaceChildren();const q=search.value.trim().toLocaleLowerCase();
    const resources=data.resources.filter(r=>(page!=='wardrobe'||!r.wardrobeError)&&(filter==='all'||filter==='other'?filter!=='other'||r.classification==='appearance':r.kind===filter)&&(!q||r.title.toLocaleLowerCase().includes(q)));
    for(const r of resources){const b=el('button','l2d-bind-resource'+(r.id===resource?.id?' selected':''));b.append(el('span',null,r.title),el('small',null,page==='wardrobe'?(r.kind==='expression'?t('外观状态','Appearance state'):t('动作末帧 · 持久','Final frame · held')):r.classification==='appearance'?t('其他 · 仅预览','Other · preview only'):r.kind==='expression'?t('表情','Expression'):t(`动作 · ${r.seconds.toFixed(1)} 秒`,`Motion · ${r.seconds.toFixed(1)} s`)));b.onclick=()=>{resource=r;paintResources();play();};list.append(b);}
    if(!resources.length)list.append(el('p','l2d-bind-empty',t('没有匹配的资源','No matching resources')));paintSelection();
  };
  function paintSummary(){const used=groups.filter(g=>g.options.length).length;summary.textContent=t(`${bindings.length} 项绑定 · 外观 ${used}/3 栏 · 保存后从卡片安装`,`${bindings.length} bindings · ${used}/3 appearance slots · save then install`);}
  function wardrobeConflict(r,id){
    const ids=[...bindings.flatMap(b=>[b.resource,b.release].filter(Boolean)),...groups.filter(g=>g.id!==id).flatMap(g=>g.options.map(o=>o.resource))];
    const used=new Set(ids.flatMap(id=>data.resources.find(r=>r.id===id)?.channels||[]));return (r?.channels||[]).some(c=>used.has(c));
  }
  function paintWardrobeTargets(){
    for(const g of groups){
      const title=zh?g.name:WARDROBE_SLOTS.find(s=>s.slot===g.slot).en;
      const header=el('button','l2d-bind-group'+(g.id===groupId?' selected':''),title);header.onclick=()=>{groupId=g.id;optionId=picks[g.id]||'default';resource=data.resources.find(r=>r.id===g.options.find(o=>o.id===optionId)?.resource)||null;paintTargets();paintResources();sendWardrobe();};left.append(header);
      for(const o of [{id:'default',name:t('默认','Default')},...g.options]){
        const chosen=(picks[g.id]||'default')===o.id;
        const b=el('button','l2d-bind-target'+(chosen?' selected':''),o.name);b.setAttribute('aria-label',title+'：'+o.name);b.setAttribute('aria-pressed',String(chosen));
        b.onclick=()=>{groupId=g.id;optionId=o.id;picks[g.id]=o.id;resource=data.resources.find(r=>r.id===o.resource)||null;paintTargets();paintResources();sendWardrobe();if(!previewError)hint.textContent=g.name+' · '+o.name;};left.append(b);
      }
      const add=el('button','l2d-btn quiet sm',t('＋ 新选项','＋ New option'));add.onclick=()=>{groupId=g.id;optionId=null;resource=null;paintTargets();paintResources();};left.append(add);
    }
  }
  function paintWardrobeSelection(){
    binding.replaceChildren();const g=groups.find(g=>g.id===groupId);paintSummary();
    if(!g){binding.append(el('p',null,t('在左侧选择装扮、部件或配饰','Choose Outfit, Parts or Accessories on the left')));return;}
    binding.append(el('p',null,t(g.name+' · 每次选一个原生按钮',(WARDROBE_SLOTS.find(s=>s.slot===g.slot)?.en||'')+' · one native resource at a time')));
    const current=g.options.find(o=>o.id===optionId),name=el('input','l2d-input');name.value=current?.name||resource?.title||'';name.maxLength=60;name.placeholder=t('选项名称，例如戴上','Option name, e.g. wear');name.setAttribute('aria-label',t('装扮选项名称','Wardrobe option name'));binding.append(name);
    const conflict=resource&&wardrobeConflict(resource,g.id);if(conflict)binding.append(el('p','l2d-bind-warning',t('与动作或其他装扮组共用参数，请调整绑定。','Shares controls with actions or another wardrobe group.')));
    const add=el('button','l2d-btn primary',current?t('保存选项','Update option'):t('添加选项','Add option'));
    const canAdd=()=>!saving&&ready&&resource&&!resource.wardrobeError&&!conflict&&!!name.value.trim()&&(!!current||g.options.length<16);add.disabled=!canAdd();name.oninput=()=>{add.disabled=!canAdd();};
    add.onclick=()=>{if(!canAdd()||discardPrompt)return;const o={id:current?.id||uid('v'),name:name.value.trim(),resource:resource.id};if(current)g.options=g.options.map(p=>p.id===o.id?o:p);else g.options.push(o);optionId=o.id;picks[g.id]=o.id;changed();paintTargets();paintResources();sendWardrobe();};binding.append(add);
    if(current){const remove=el('button','l2d-btn quiet',t('移除选项','Remove option'));remove.disabled=saving||!ready;remove.onclick=()=>{if(saving||!ready)return;g.options=g.options.filter(o=>o.id!==current.id);picks[g.id]='default';optionId='default';resource=null;changed();paintTargets();paintResources();sendWardrobe();};binding.append(remove);}
    binding.append(el('p','l2d-bind-note',t('三栏各选一个，最多同时生效三个按钮。保存并安装后可在 Coo 装扮页切换。','Pick one per slot, up to three together. Save and install to switch them in Coo.')));
  }
  for(const [id,title]of [['actions',t('动作','Actions')],['wardrobe',t('装扮','Wardrobe')]]){
    const b=el('button','l2d-btn quiet sm',title);b.setAttribute('role','tab');b.setAttribute('aria-selected',String(page===id));b.onclick=()=>{
      if(!data||saving||discardPrompt||page===id)return;pageState[page]={resource,filter,search:search.value};page=id;({resource,filter}=pageState[id]);search.value=pageState[id].search;for(const n of pages.children)n.setAttribute('aria-selected',String(n===b));
      if(page==='wardrobe'&&!groupId)groupId=groups[0]?.id||null;for(const n of tabs.children)n.classList.toggle('selected',n.dataset.filter===filter);syncControls();paintTargets();paintResources();play();
    };pages.append(b);
  }
  for(const [value,title]of [['all',t('全部','All')],['expression',t('表情','Faces')],['motion',t('动作','Motions')],['other',t('其他','Other')]]){
    const b=el('button','l2d-btn quiet sm',title);b.dataset.filter=value;b.onclick=()=>{filter=value;for(const n of tabs.children)n.classList.toggle('selected',n===b);paintResources();};tabs.append(b);
  }tabs.firstChild.classList.add('selected');search.oninput=()=>{if(data)paintResources();};
  restoreAll.onclick=async()=>{
    if(page==='wardrobe'){if(!ready||saving)return;picks={};resource=null;optionId='default';paintTargets();paintResources();sendWardrobe();if(!previewError)hint.textContent=t('已恢复默认外观，装扮选项保留','Default appearance restored; options kept');return;}
    if(saving||!ready||discardPrompt||!bindings.length)return;
    discardPrompt=bindingDiscardPrompt(modal,zh,{title:t('全部恢复通用？','Reset all bindings?'),body:t('清空当前绑定，保留原生资源。点击保存后生效。','Clear all bindings and keep native resources. Save to apply.'),cancel:t('保留绑定','Keep bindings'),accept:t('全部恢复','Reset all')});
    const accepted=await discardPrompt.result;discardPrompt=null;if(!accepted||!alive())return;
    bindings=[];resource=null;rawMode=false;raw.textContent=t('组合效果','Combined');raw.setAttribute('aria-pressed','false');send('stop');changed();paintTargets();paintResources();play();
  };
  save.onclick=async()=>{if(saving||!ready||!sessionValid||discardPrompt||data.buildId&&!dirty&&!data.wardrobeNeedsSave)return;saving=true;syncControls();paintSelection();hint.textContent=t('保存并打包…','Saving & packing…');
    try{
      const result=await ctx.invoke('manualSave',[data.token,structuredClone(bindings),structuredClone(groups)]);dirty=false;release();ctx.ui.toast(t('绑定已保存，可从卡片安装','Bindings saved; install from the pack card'),'ok');
      try{await onSaved?.(result);}catch{ctx.ui.toast(t('绑定已保存，模型包列表刷新失败，请稍后重新打开页面','Bindings saved; the pack list could not refresh. Reopen the page later.'),'bad');}
    }
    catch(error){hint.textContent=String(error.message||error);if(/编辑已过期|形象包已变化|原打包产物已移除/.test(hint.textContent)){sessionValid=false;previewError=hint.textContent;}ctx.ui.toast(hint.textContent,'bad');}
    finally{saving=false;if(alive()){syncControls();paintSelection();}}
  };
  const mountPreview=async()=>{
    cleanup();ready=false;previewError='';retry.hidden=true;hint.textContent=t('准备模型…','Preparing model…');syncControls();paintSelection();const generation=++serial;
    cleanup=await mountBindingPreview(ctx,frame,data,alive,(type,message)=>{if(!alive()||generation!==serial)return;if(type==='ready'){ready=true;syncControls();paintTargets();paintSelection();play();}else if(type==='error'){ready=false;previewError=t('预览失败：','Preview failed: ')+message;hint.textContent=previewError;retry.hidden=false;syncControls();paintSelection();}});
    if(!alive())cleanup();
  };
  retry.onclick=()=>{if(!saving&&sessionValid)void mountPreview();};
  syncControls();
  try{
    data=await ctx.invoke(method,requestedToken?[...args,requestedToken]:args);
    if(data.token!==requestedToken)ctx.notifyOnUnmount?.('manualClose',[data.token]);
    if(!alive()){if(!ctx.signal?.aborted)ctx.invoke('manualClose',[data.token]).catch(()=>{});return {get closed(){return closed;},dispose:release};}
    bindings=structuredClone(data.bindings||[]);groups=fixedWardrobeGroups(data.wardrobe||[]);data.wardrobe=structuredClone(groups);changed();heading.querySelector('.l2d-modal-sub').textContent=data.title;paintTargets();paintResources();
    if(data.truncated||data.warnings?.length)right.prepend(el('p','l2d-bind-empty',t('部分资源未能读取，列表可能不完整','Some resources could not be read; the list may be incomplete')));
    if(data.truncated)hint.textContent=t('资源扫描不完整，请核对模型内容','Resource scan is incomplete; check the model');
    leaseTimer=win.setInterval(()=>{if(alive())ctx.invoke('manualKeepAlive',[data.token]).catch(error=>{if(alive()&&/编辑已过期|编辑已取消/.test(String(error.message||error))){sessionValid=false;previewError=String(error.message||error);hint.textContent=previewError;syncControls();}});},60000);
    await mountPreview();
  }catch(error){if(alive())hint.textContent=String(error.message||error);}
  return {get closed(){return closed;},dispose(){leave?.dispose?.();release();}};
}

/**
 * Coo 魔术人偶工坊 面板（浏览器端，手写 ESM，不打 bundle）。
 *
 * 导入区：[拖入 / 点击后粘贴] [选择文件夹 / ZIP] [一键打包]
 * 卡片：[安装][编辑][删除]；编辑弹层直接改 figure.json / profile.js，不重新打包。
 * 原始模型打包、现成形象包入库，均保留卡片上的安装操作。
 */
const NOTICE_TEXT = {
  zh: '本功能生成的形象包包含 Live2D Cubism Core。请仅在本机使用，不要将这些形象包上传、分享或再次分发给他人。模型、贴图和第三方组件仍各自受原许可约束。',
  en: 'Generated figure packs contain Live2D Cubism Core. Use these packs locally; do not upload, share or redistribute them. Models, textures and third-party components remain subject to their respective licenses.',
};

// Both the primary configuration page and its quick popup use this form.
function settingsForm(ctx, cfg, { autosave = false, onNotice, onSaved, isDisposed = () => ctx.signal?.aborted } = {}) {
  const doc = ctx.root.ownerDocument;
  const zh = String(ctx.language || 'zh').toLowerCase().startsWith('zh');
  const t = (a, b) => zh ? a : b;
  const el = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const body = el('form', 'l2d-settings l2d-dialog-body');
  cfg={...cfg,adaptationMode:cfg.adaptationMode || (cfg.assistMotions ? 'ai' : 'none')};
  const dirty = {};
  const controls = [];
  const fields = new Map();
  function field(key, title, hint, type, choices) {
    const row = el('label', 'l2d-setting-row');
    const label = el('span', 'l2d-setting-label');
    label.append(el('span', null, title));
    if (hint) label.append(el('small', null, hint));
    let input, control, readValue, paint = () => {};
    if (type === 'gear') {
      row.classList.add('l2d-gear-row');
      control = el('span', 'l2d-gear');
      const value = el('output', 'l2d-gear-value'); value.setAttribute('aria-hidden', 'true');
      const track = el('span', 'l2d-gear-track');
      const fill = el('span', 'l2d-gear-fill');
      const sparks = el('span', 'l2d-gear-sparks'); sparks.setAttribute('aria-hidden', 'true');
      for (let i = 0; i < 10; i++) {
        const spark = el('i');
        spark.style.cssText = `--spark-x:${8 + i * 8.4}%;--spark-y:${6 + (i * 7 % 18)}px;--spark-delay:${-i * .37}s;--spark-duration:${1.8 + i % 3 * .4}s`;
        sparks.append(spark);
      }
      fill.append(sparks);
      const stops = el('span', 'l2d-gear-stops'); stops.setAttribute('aria-hidden', 'true');
      choices.forEach(() => stops.append(el('i')));
      input = el('input', 'l2d-gear-input');
      input.type = 'range'; input.min = '0'; input.max = String(choices.length - 1); input.step = '1';
      const initial = choices.findIndex(([v]) => v === cfg[key]);
      input.value = String(initial < 0 ? choices.findIndex(([v]) => v === (key === 'texture' ? 'original' : key === 'assistDepth' ? 'standard' : key === 'quality' ? 'balanced' : key === 'adaptationMode' ? 'none' : 'auto')) : initial);
      readValue = () => choices[Number(input.value)][0];
      paint = () => {
        const index = Number(input.value), title = choices[index][1];
        value.value = title; input.setAttribute('aria-valuetext', title);
        control.style.setProperty('--gear-ratio', String(index / (choices.length - 1)));
        control.classList.toggle('is-max', index === choices.length - 1);
      };
      input.addEventListener('input', paint); paint();
      track.append(fill, stops, input); control.append(value, track);
    } else {
      input = el(type === 'textarea' ? 'textarea' : 'input', type === 'checkbox' ? 'l2d-switch' : 'l2d-input');
      if (type !== 'textarea') input.type = type;
      else input.rows = 2;
      if (type === 'checkbox') { input.checked = cfg[key] === true; input.setAttribute('role', 'switch'); }
      else { input.value = cfg[key] || ''; input.placeholder = t('留空使用 Coo 默认目录', 'Leave empty for the Coo default'); }
    }
    input.setAttribute('aria-label', title);
    input.addEventListener('change', () => { if (input.disabled) return; paint(); dirty['worlds.figure.' + key] = type === 'checkbox' ? input.checked : readValue ? readValue() : input.value.trim(); });
    fields.set(key,{input,paint,readValue,choices});
    controls.push(input); row.append(label, control || input); body.append(row); return input;
  }
  field('cover', t('生成封面', 'Generate cover'), t('同时自动调整模型取景', 'Also fits the model framing'), 'checkbox');
  const quality = field('quality',t('画质','Quality'),t('画布随显示大小调整；原图不设软件精度上限。已有形象需重新打包安装。','Canvas follows display size; Original has no software cap. Repack existing figures to apply.'),'gear',[['economy',t('流畅','Smooth')],['balanced',t('标准','Standard')],['high',t('高清','HD')],['original',t('原图','Original')]]);
  const texture = field('texture', t('贴图精度', 'Texture resolution'), t('原图档可调整；较小的贴图占用更少显存', 'Adjustable in Original mode; smaller textures use less VRAM'), 'gear', ['512','1024','2048','4096','original'].map(value=>[value,value==='original'?t('原精度','Original'):value+' px']));
  let customTexture = cfg.texture || 'original';
  const syncQuality = () => {
    const editable = quality.value === '3';
    const selected = editable ? customTexture : ['1024','2048','4096'][Number(quality.value)];
    texture.value = String(fields.get('texture').choices.findIndex(([value])=>value===selected));
    fields.get('texture').paint(); fields.get('quality').paint();
    texture.disabled = !editable; texture.closest('.l2d-setting-row').classList.toggle('inactive',!editable);
    if (editable && customTexture !== 'original') {
      quality.setAttribute('aria-valuetext',t('自定义','Custom'));
      quality.closest('.l2d-gear').querySelector('output').value=t('自定义','Custom');
      quality.closest('.l2d-gear').classList.remove('is-max');
    }
  };
  for (const event of ['input','change']) {
    quality.addEventListener(event,syncQuality);
    texture.addEventListener(event,()=>{if(quality.value==='3'){customTexture=fields.get('texture').readValue();syncQuality();}});
  }
  syncQuality();
  field('clean', t('清理', 'Clean'), '', 'checkbox');
  field('autoDelete', t('安装后删除打包产物', 'Delete pack after installation'), t('仅在安装成功后执行，保留原始素材', 'Only after a successful install; source files are kept'), 'checkbox');
  const folder = field('figuresDir', t('安装目录', 'Install folder'), t('通常无需修改', 'Usually no change needed'), 'text');
  if (ctx.pickPath) {
    const picker = el('span', 'l2d-folder-control');
    const browse = el('button', 'l2d-btn sm', t('选择', 'Browse')); browse.type = 'button';
    folder.replaceWith(picker); picker.append(folder, browse);
    browse.addEventListener('click', async () => {
      try {
        const path = await ctx.pickPath({kind:'directory'});
        if (path !== null && !isDisposed()) {
          folder.value = path;
          folder.dispatchEvent(new doc.defaultView.Event('change', {bubbles:true}));
        }
      } catch (error) { if (!isDisposed()) ctx.ui.toast(String(error?.message || error), 'bad'); }
    });
    controls.push(browse);
  }
  body.append(el('h3','l2d-settings-heading',t('动作适配','Action mapping')));
  const mode = field('adaptationMode',t('适配方式','Adaptation mode'),t('无：仅通用配方；人工：预览并绑定；AI：交给 Coo 分析','None: generic recipes; Manual: preview and bind; AI: let Coo analyze'),'gear',[['none',t('无','None')],['manual',t('人工','Manual')],['ai','AI']]);
  const gear = field('assistGear',t('分析方式','Analysis mode'),t('图片不受支持时自动使用文本','Falls back to text when the current model cannot use images'),'gear', [['text',t('文本','Text')],['auto',t('自动','Auto')],['image',t('文本＋图片','Text + images')]]);
  const depth = field('assistDepth',t('适配深度','Adaptation depth'),t('仅文本＋图片时启用：基础取样、针对性补查、映射对照复核','Available with text + images: basic sampling, targeted inspection, mapping comparison'),'gear', [['quick',t('快速','Quick')],['standard',t('标准','Standard')],['deep',t('深入','Deep')]]);
  const automatic = field('assistAuto',t('自动安装','Automatic installation'),t('满足安装条件后自动执行；需要确认时暂停','Install when requirements are met; pause for confirmation when needed'),'checkbox');
  const roots = field('modelRoots',t('模型搜索目录','Model search folders'),t('每行一个目录；用于按名字找模型','One folder per line, used when finding models by name'),'textarea');
  roots.placeholder = t('留空时只搜索最近使用的模型目录','Leave empty to search recently used model folders');
  const depend = () => {
    syncQuality();
    for (const input of [gear,automatic,roots,depth]) {
      input.disabled = mode.value !== '2' || input === depth && gear.value !== '2';
      input.closest('.l2d-setting-row').classList.toggle('inactive', input.disabled);
    }
  };
  mode.addEventListener('change',depend); mode.addEventListener('input',depend); gear.addEventListener('change',depend); gear.addEventListener('input',depend); depend();
  const actions = el('div', 'l2d-dialog-actions');
  if (onNotice) {
    const note = el('button', 'l2d-notice-entry', t('须知', 'Notice')); note.type = 'button';
    note.addEventListener('click', async () => {
      if (Object.keys(dirty).length && !autosave && !await ctx.ui.confirm({title:t('放弃未保存的设置？','Discard unsaved settings?'),body:t('打开须知将关闭当前设置。','Opening the notice closes settings.')})) return;
      if (!isDisposed()) onNotice();
    });
    actions.append(note);
  }
  const status = el('span', 'l2d-settings-status', autosave ? t('修改后自动保存。', 'Changes save automatically.') : '');
  status.setAttribute('role', 'status');
  const save = el('button', 'l2d-btn primary', t('保存设置', 'Save settings')); save.type = 'submit'; save.hidden = autosave;
  actions.append(status, save); body.append(actions);
  let saving = false;
  ctx.guardLeave?.(() => body.isConnected && (saving || Object.keys(dirty).length) ? t('设置尚未保存，确定离开？', 'Settings are not saved. Leave anyway?') : null);
  async function persist() {
    if (saving || isDisposed()) return;
    if (!Object.keys(dirty).length) { if (!autosave) await onSaved?.(); return; }
    saving = true; save.disabled = true;
    if (!autosave) controls.forEach(input => { input.disabled = true; });
    status.textContent = t('保存中…', 'Saving…');
    const patch = {...dirty};
    let succeeded = false;
    try {
      await ctx.setConfig('figure', patch);
      for (const key of Object.keys(patch)) if (dirty[key] === patch[key]) delete dirty[key];
      succeeded = true;
      if (isDisposed()) return;
      status.textContent = t('已保存', 'Saved'); save.hidden = autosave;
      await onSaved?.();
    } catch (error) {
      if (!isDisposed()) {
        status.textContent = t('保存失败，请重试。', 'Save failed. Please retry.');
        save.hidden = false; if (autosave) save.textContent = t('重试保存', 'Retry save');
        ctx.ui.toast(String(error?.message || error), 'bad');
      }
    } finally {
      saving = false; save.disabled = false;
      if (!autosave) { controls.forEach(input => { input.disabled = false; }); depend(); }
    }
    if (autosave && succeeded && Object.keys(dirty).length && !isDisposed()) await persist();
  }
  body.addEventListener('submit', event => { event.preventDefault(); void persist(); });
  if (autosave) body.addEventListener('change', () => { void persist(); });
  return body;
}

const configuration = {
  // Local Coo configuration renderer hook; ordinary hosts retain the schema view.
  panelId: 'workbench',
  async mount(ctx) {
    const [cfg, state] = await Promise.all([ctx.invoke('settings', []), ctx.invoke('state', [])]);
    if (ctx.signal?.aborted) return;
    const doc = ctx.root.ownerDocument;
    const zh = String(ctx.language || 'zh').toLowerCase().startsWith('zh');
    const shell = doc.createElement('section'); shell.className = 'l2d-config-page';
    const header = doc.createElement('header'); header.className = 'l2d-config-header';
    const title = doc.createElement('h2'); title.textContent = zh ? '配置' : 'Configuration';
    const version = doc.createElement('span'); version.className = 'l2d-version-corner'; version.textContent = 'v' + state.version;
    header.append(title, version);
    const form = settingsForm(ctx, cfg, {autosave:true});
    shell.append(header, form); ctx.root.append(shell);
    return {dispose() { shell.remove(); }};
  },
};

export default {
  configuration,
  panels: {
    workbench: {
      mount(ctx) {
        const ui = ctx.ui;
        const doc = ctx.root.ownerDocument;
        const win = doc.defaultView;
        const zh = String(ctx.language || 'zh').toLowerCase().startsWith('zh');
        const t = (a, b) => (zh ? a : b);
        const el = (tag, cls, text) => {
          const n = doc.createElement(tag);
          if (cls) n.className = cls;
          if (text != null) n.textContent = text;
          return n;
        };

        let disposed = false;
        let initialized = false;
        let notice = null;
        let version = '';
        let activeImportToken = null;
        let resumeHandle = null;
        let resuming = false;
        let resumePolling = false;
        let resumePhase;
        let editingId = null;
        let overlay = null;
        let settingsLoading = false;
        let assistTimer = null;
        let assistPolling = false;
        let assistState = {enabled:false,plans:[]};
        const ownedOverlays = new Set();
        function showDialog(title, body) {
          overlay?.dispose?.();
          ownedOverlays.delete(overlay);
          overlay = ui.drawer(title, body);
          if (overlay) ownedOverlays.add(overlay);
          return overlay;
        }
        const state = { dir: '', busy: false, phase: '', builds: [], installed: null, figuresDir: '' };

        // ---- Live2D 核心组件：不随扩展分发，同意许可后从官方地址取 ----
        const coreCard = el('div', 'l2d-license');
        const coreText = el('span', 'l2d-license-text');
        const coreLicA = el('button', 'l2d-link', t('Core 许可', 'Core license'));
        const coreLicB = el('button', 'l2d-link', t('SDK 许可', 'SDK license'));
        const coreHome = el('button', 'l2d-link', t('打开官网', 'Download page'));
        const coreGet = el('button', 'l2d-btn sm primary', t('同意并获取', 'Agree & fetch'));
        coreCard.append(coreText, coreLicA, coreLicB, coreHome, coreGet);


        let core = { ok: false };
        const coreReady = () => core.ok === true;

        const openLicense = async (which) => {
          try {
            const r = await ctx.invoke('license', [which]);
            showDialog(r.file, r.text || t('（读不到许可文本）', '(license text missing)'));
          } catch (e) {
            ui.toast(text(e), 'bad');
          }
        };
        coreLicA.addEventListener('click', () => openLicense('core'));
        coreLicB.addEventListener('click', () => openLicense('sdk'));
        coreHome.addEventListener('click', () => {
          if (core.home) win.open(core.home, '_blank', 'noreferrer');
        });

        function paintCore() {
          if (disposed) return;
          coreCard.classList.toggle('ok', coreReady());
          if (coreReady()) noticeDetails.appendChild(coreCard);
          else noticeTop.appendChild(coreCard);
          if (coreReady()) {
            const kb = Math.round((core.bytes || 0) / 1024);
            coreText.textContent = t(
              `Live2D 核心已就绪 · ${core.version || ''} · ${kb} KB · 已校验`,
              `Live2D core ready · ${core.version || ''} · ${kb} KB · verified`,
            );
            coreGet.hidden = true;
          } else {
            coreText.textContent = t(
              '本扩展不附带 Live2D 核心组件。点「同意并获取」后，从 Live2D Inc. 官方服务器取同一份文件并校验 SHA-256；核心不随扩展分发。',
              'This extension does not ship the Live2D core. "Agree & fetch" downloads the same file from Live2D Inc. and verifies its SHA-256.',
            );
            coreGet.hidden = false;
          }
        }

        async function loadCore() {
          try {
            core = await ctx.invoke('core', []);
            paintCore();
          } catch (e) {
            ui.toast(text(e), 'bad');
          }
        }

        coreGet.addEventListener('click', async () => {
          if (state.busy) return;
          setBusy(true, t('获取核心…', 'Fetching core…'), undefined, 'core');
          try {
            core = await ctx.invoke('coreAccept', [true]);
            paintCore();
            log.append(t('已获取 Live2D 核心并校验', 'Live2D core fetched and verified'), 'dim');
            ui.toast(t('核心已就绪', 'Core ready'), 'ok');
          } catch (e) {
            ui.toast(text(e), 'bad');
            log.append('! ' + text(e), 'warn');
          } finally {
            setBusy(false);
          }
        });

        const shell = el('section', 'l2d-sheet');
        const header = el('header', 'l2d-header');
        header.setAttribute('aria-label',t('模型工坊操作','Figure workshop actions'));
        const toolbar = el('div','l2d-toolbar');
        const settingsButton = el('button', 'l2d-btn l2d-settings-button', t('设置', 'Settings'));
        settingsButton.type = 'button';
        settingsButton.addEventListener('click', openSettings);
        toolbar.append(settingsButton);header.append(toolbar);
        const sheet = { el: shell, body: el('div', 'l2d-body') };
        shell.append(header, sheet.body);
        ctx.root.appendChild(shell);
        const noticeTop = el('div', 'l2d-notice-top');
        sheet.body.appendChild(noticeTop);
        const operation = el('section','l2d-operation');
        operation.setAttribute('aria-label',t('导入与处理','Import and processing'));
        const operationBottom = el('div','l2d-operation-bottom');
        sheet.body.append(operation);
        let versionCorner = el('button', 'l2d-version-corner', '…');
        versionCorner.type = 'button';
        versionCorner.disabled = true;
        versionCorner.setAttribute('aria-controls', 'l2d-distribution-notice');
        sheet.el.classList.add('l2d-sheet');
        header.appendChild(versionCorner);
        const noticeDetails = el('details', 'l2d-notice');
        noticeDetails.id = 'l2d-distribution-notice';
        const noticeSummary = el('summary', null, t('须知', 'Notice'));
        noticeDetails.appendChild(noticeSummary);
        noticeDetails.appendChild(el('p', null, t(NOTICE_TEXT.zh, NOTICE_TEXT.en)));
        const acknowledge = el('button', 'l2d-btn sm primary', t('我已知晓，不再分发', 'I understand — no redistribution'));
        noticeDetails.appendChild(acknowledge);
        noticeTop.appendChild(noticeDetails);
        function paintNotice() {
          if (disposed) return;
          const ack = notice?.acknowledged === true;
          if (ack) {
            noticeDetails.open = false;
            noticeDetails.remove();
          }
          versionCorner.textContent = version ? `v${version}` : '…';
          versionCorner.classList.toggle('unack', !ack);
          versionCorner.classList.toggle('ack', ack);
          versionCorner.title = ack ? t('查看须知', 'Read notice') : t('请阅读并确认须知', 'Read and acknowledge the notice');
          versionCorner.disabled = !notice || state.busy;
          noticeEntry.hidden = !ack;
          if (ack) { versionCorner.removeAttribute('aria-controls'); versionCorner.removeAttribute('aria-expanded'); }
          versionCorner.setAttribute('aria-label', `${versionCorner.textContent} · ${ack ? t('已确认', 'Acknowledged') : t('未确认', 'Not acknowledged')}`);
          acknowledge.hidden = ack;
          acknowledge.disabled = !notice || state.busy;
          if (!ack) {
            versionCorner.disabled = !notice;
            versionCorner.setAttribute('aria-expanded', String(noticeDetails.open));
          }
        }
        versionCorner.addEventListener('click', () => {
          if (notice?.acknowledged) { openNotice(); return; }
          noticeDetails.open = !noticeDetails.open;
          noticeDetails.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
          paintNotice();
        });
        noticeDetails.addEventListener('toggle', paintNotice);
        acknowledge.addEventListener('click', async () => {
          if (!notice || state.busy) return;
          setBusy(true, t('保存须知…', 'Saving acknowledgement…'), undefined, 'notice');
          try {
            notice = await ctx.invoke('noticeAccept', [notice.revision]);
            noticeDetails.open = false;
            paintNotice();
          } catch (e) { ui.toast(text(e), 'bad'); }
          finally {
            setBusy(false);
            paintNotice();
            if (notice?.acknowledged) dropZone.focus({ preventScroll: true });
          }
        });
        function ensureNotice() {
          if (notice?.acknowledged) return true;
          noticeDetails.open = true;
          noticeDetails.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
          acknowledge.focus();
          ui.toast(t('请先确认形象包分发须知', 'Acknowledge the distribution notice first'), 'bad');
          return false;
        }


        // ---- 导入区与两个主操作 ----
        const bar = el('div', 'l2d-import-bar');
        const dropZone = el('div', 'l2d-drop-zone');
        dropZone.tabIndex = 0;
        dropZone.setAttribute('role', 'region');
        dropZone.setAttribute('aria-label', t('模型导入区域，点击后可粘贴', 'Model import area; click to paste'));
        const sourceTitle = el('div', 'l2d-source-title');
        const sourceHint = el('div', 'l2d-source-hint');
        dropZone.append(sourceTitle, sourceHint);
        const actions = el('div', 'l2d-import-controls');
        const chooseFolder = el('button', 'l2d-btn', t('选择文件夹', 'Choose folder'));
        const chooseZip = el('button', 'l2d-btn', t('选择 ZIP', 'Choose ZIP'));
        const pack = el('button', 'l2d-btn primary', t('一键打包', 'Pack models'));
        const folderInput = doc.createElement('input');
        folderInput.type = 'file';
        folderInput.webkitdirectory = true;
        folderInput.setAttribute('webkitdirectory', '');
        folderInput.hidden = true;
        const zipInput = doc.createElement('input');
        zipInput.type = 'file';
        zipInput.accept = '.zip,application/zip';
        zipInput.hidden = true;
        toolbar.prepend(chooseFolder, chooseZip);
        actions.append(pack);
        bar.append(dropZone, folderInput, zipInput);
        operation.append(bar,operationBottom);
        let staged = null;
        const completed = new Set();
        function paintSource() {
          const models = staged?.models ?? [];
          const packs = staged?.packs ?? [];
          const count = models.length + packs.length;
          const names = [...models.map(m => m.title), ...packs.map(p => (zh ? p.nameZh : p.nameEn) || p.id)];
          sourceTitle.textContent = count ? names.slice(0, 3).join('、') + (count > 3 ? t(` 等 ${count} 项`, ` and ${count - 3} more`) : '') : t('拖入模型或 ZIP', 'Drop a model folder or ZIP');
          sourceTitle.title = names.join('\n');
          sourceHint.textContent = count
            ? (assistState.enabled ? t(`已识别 ${count} 项 · 导入后自动交给 Coo，进展见下方`, `${count} recognized · sent to Coo automatically; see progress below`) : completed.size === count ? t('已加入模型包列表，可编辑或安装', 'Added to packs; edit or install') : t(`已识别 ${count} 项，可以开始打包`, `${count} recognized; ready to pack`))
            : t('点击此区域后，按 Ctrl+V 粘贴文件或目录路径', 'Click here, then press Ctrl+V to paste files or a local path');
          dropZone.classList.toggle('ready', count > 0);
          dropZone.setAttribute('aria-disabled', String(state.busy));
          pack.disabled = state.busy || !count || completed.size === count;
          if (assistState.enabled && (assistState.submissions || []).some(r => r.token === staged?.token && !r.error && !r.canRetry)) pack.disabled = true;
          if (assistState.enabled && (assistState.submissions || []).some(r => r.token === staged?.token && r.canRetry)) pack.textContent = t('重新提交分析','Retry analysis');
        }
        paintSource();

        // ---- 状态 + 进度 ----
        const status = el('div', 'l2d-status');
        const spinner = el('span', 'l2d-spinner');
        const dot = el('span', 'dot');
        const statusText = el('span', null, t('就绪', 'Ready'));
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        status.append(dot, spinner, statusText);
        const actionRow=el('div','l2d-action-row');actionRow.append(status,actions);operationBottom.append(actionRow);
        const adaptationNote = el('div', 'l2d-adaptation-note');
        operationBottom.appendChild(adaptationNote);

        function adaptationDetails(info) {
          if (!info) return null;
          const corrected = Array.isArray(info.corrected) ? info.corrected : [];
          const limited = Array.isArray(info.limited) ? info.limited : [];
          const warnings = Array.isArray(info.warnings) ? info.warnings : [];
          if (!corrected.length && !limited.length && !warnings.length) return null;
          const names = {
            eyeOpen: t('眨眼', 'Blink'), eyeSmile: t('笑眼', 'Eye smile'),
            browY: t('眉毛升降', 'Brow height'), browAngle: t('眉毛角度', 'Brow angle'),
            mouthOpen: t('张嘴', 'Mouth opening'), mouthForm: t('嘴形', 'Mouth shape'),
            cheek: t('脸红', 'Blush'), eyeBallX: t('横向视线', 'Horizontal gaze'), eyeBallY: t('纵向视线', 'Vertical gaze'),
            angleX: t('左右转头', 'Head turn'), angleY: t('抬头低头', 'Head pitch'), angleZ: t('歪头', 'Head tilt'),
            bodyX: t('身体跟随', 'Body follow'), breath: t('呼吸', 'Breathing'),
            step: t('腿部步态', 'Leg gait'), armA: t('手臂动作', 'Arm motion'), armB: t('手臂姿势', 'Arm pose'),
          };
          const show = roles => [...new Set(roles.map(r => names[r] || r))].join('、');
          const detail = el('details', 'l2d-adaptation');
          detail.appendChild(el('summary', null, limited.length || warnings.length
            ? t('已自动适配 · 部分效果简化', 'Adapted · some effects simplified')
            : t('已自动修正适配', 'Adaptation corrected automatically')));
          if (corrected.length) detail.appendChild(el('p', null, t('自动识别：', 'Detected: ') + show(corrected)));
          if (limited.length) detail.appendChild(el('p', null, t('沿用基础表现，独立控制受限：', 'Basic behavior retained; independent controls limited: ') + show(limited)));
          if (warnings.length) detail.appendChild(el('p', null, t('部分配置不可用，已自动使用基础识别。', 'Some configuration is unavailable; basic detection is used.')));
          detail.appendChild(el('p', null, t('继续使用已识别的通用动作和表情，无需手动配置参数。', 'Detected generic motions and expressions remain available; no manual parameter setup is needed.')));
          return detail;
        }

        function showAdaptation(info) {
          const detail = adaptationDetails(info);
          adaptationNote.replaceChildren(...(detail ? [detail] : []));
        }

        const progress = el('div', 'l2d-progress');
        const progressBar = el('span');
        progress.appendChild(progressBar);
        operationBottom.appendChild(progress);

        // Cards keep their page layout while editing in a modal dialog.
        const head = el('div', 'l2d-head');
        const libraryTitle = el('div', 'l2d-library-title');
        const countLabel = el('span', 'l2d-count', '0');
        libraryTitle.append(el('h3', null, t('模型包', 'Packs')), countLabel);
        const search = el('input', 'l2d-input l2d-search');
        search.type = 'search'; search.placeholder = t('搜索模型包', 'Search packs');
        search.setAttribute('aria-label', search.placeholder);
        const sort = el('select', 'l2d-input l2d-sort');
        sort.setAttribute('aria-label', t('排序', 'Sort'));
        for (const [value, label] of [['new', t('最近添加', 'Newest')], ['name', t('按名称', 'Name')]]) {
          const option = el('option', null, label); option.value = value; sort.append(option);
        }
        const clearAll = el('button', 'l2d-btn sm quiet', t('清空旧打包', 'Clear old packs'));
        head.append(libraryTitle, search, sort, clearAll);
        sheet.body.appendChild(head);
        const workspace = el('div', 'l2d-workspace');
        const assistDock = el('div', 'l2d-assist-dock');
        operationBottom.append(assistDock);
        const grid = el('div', 'l2d-grid');
        grid.setAttribute('aria-label', t('模型包卡片', 'Pack cards'));
        workspace.append(grid); sheet.body.append(workspace);
        search.addEventListener('input', renderGrid);
        sort.addEventListener('change', renderGrid);

        const foot = el('footer', 'l2d-foot');
        const noticeEntry = el('button', 'l2d-notice-entry', t('须知', 'Notice'));
        noticeEntry.type = 'button'; noticeEntry.hidden = true;
        noticeEntry.addEventListener('click', openNotice);
        const target = el('span', 'l2d-target', '');
        const logButton = el('button', 'l2d-btn quiet sm', t('任务记录', 'Activity'));
        foot.append(noticeEntry, target, logButton); shell.append(foot);

        const logBody = el('div', 'l2d-dialog-body');
        const logHead = el('div', 'l2d-head');
        logHead.appendChild(el('span', 'l2d-head-title', t('任务记录', 'Activity')));
        const logClear = el('button', 'l2d-btn sm quiet', t('清空', 'Clear'));
        logHead.appendChild(logClear);
        const rawLog = ui.log({ maxHeight: '320px', empty: t('还没有任务记录', 'No activity yet') });
        const log = { el: rawLog.el, clear() { rawLog.clear(); logButton.classList.remove('has-error'); },
          append(line, tone) { rawLog.append(line, tone); if (tone === 'bad' || tone === 'warn') logButton.classList.add('has-error'); } };
        logBody.append(logHead, log.el);
        logButton.addEventListener('click', () => showDialog(t('任务记录', 'Activity'), logBody));
        logClear.addEventListener('click', () => log.clear());

        function openNotice() {
          const body = el('div', 'l2d-dialog-body');
          body.append(el('p', null, t(NOTICE_TEXT.zh, NOTICE_TEXT.en)));
          const links = el('div', 'l2d-dialog-actions');
          for (const [key, label] of [['core', t('Core 许可', 'Core license')], ['sdk', t('SDK 许可', 'SDK license')]]) {
            const button = el('button', 'l2d-btn quiet sm', label);
            button.addEventListener('click', () => openLicense(key)); links.append(button);
          }
          body.append(links); showDialog(t('须知', 'Notice'), body);
        }

        async function openSettings() {
          if (disposed || state.busy || settingsLoading) return;
          settingsLoading = true; settingsButton.disabled = true;
          try {
            const cfg = await ctx.invoke('settings', []);
            if (disposed || state.busy) return;
            let dialog;
            const body = settingsForm(ctx, cfg, {
              isDisposed: () => disposed,
              onNotice: openNotice,
              onSaved: async () => {
                if (disposed) return;
                dialog?.dispose?.(); ui.toast(t('设置已保存', 'Settings saved'), 'ok');
                await refresh();
              },
            });
            dialog = showDialog(t('设置', 'Settings'), body);
          } catch (error) { if (!disposed) ui.toast(text(error), 'bad'); }
          finally { settingsLoading = false; if (!disposed) settingsButton.disabled = state.busy; }
        }

        function resize() {
          if (disposed) return;
          const content = shell.getBoundingClientRect();
          shell.dataset.compact = String(content.width < 760);
        }
        const observer = win.ResizeObserver ? new win.ResizeObserver(resize) : null;
        observer?.observe(ctx.root); win.addEventListener('resize', resize); resize();

        function paintAutomation(value) {
          assistState = value || {enabled:false,plans:[]};
          pack.textContent = assistState.enabled ? t('提交 AI 适配','Submit to Coo') : assistState.adaptationMode === 'manual' ? t('预览并绑定','Preview & bind') : t('一键打包','Pack models');
          if (assistState.enabled && !assistTimer && ctx.interval) assistTimer = ctx.interval(async () => {
            if (disposed || state.busy || assistPolling) return;
            assistPolling = true;
            try { const value = await ctx.invoke('assistState', []); if (!disposed) {
              const completed = (value.plans || []).some(p=>p.status==='done' && !(assistState.plans || []).some(old=>old.id===p.id && old.status==='done'));
              if (completed) await refresh(); else paintAutomation(value);
            } }
            catch { /* The normal status and task log still report operation failures. */ }
            finally { assistPolling = false; }
          },1500);
          if (!assistState.enabled && assistTimer) { assistTimer.dispose?.(); assistTimer = null; }
          const plans = assistState.plans || [];
          const submissions = assistState.submissions || [];
          const signature = JSON.stringify([assistState.enabled,plans,submissions]);
          if (assistDock.dataset.plans === signature) { paintSource(); return; }
          const expanded = new Set([...assistDock.querySelectorAll('details[open]')].map(d=>d.dataset.id));
          assistDock.dataset.plans = signature; assistDock.replaceChildren();
          if (!assistState.enabled) { paintSource(); return; }
          for (const request of submissions) {
            if (!request.error && !request.waiting?.length) continue;
            const message = request.error ? t('提交失败：','Submission failed: ') + request.error : t('已提交 Coo，等待方案或聊天中的模型选择：','Sent to Coo; awaiting a proposal or model choice in chat: ') + request.waiting.join('、');
            const waiting=el('div','l2d-assist-submission');waiting.append(el('p','l2d-assist-wait'+(request.error?' has-error':''),message));
            if(request.canRetry&&request.token===staged?.token){
              const retry=el('button','l2d-btn sm',t('重新提交','Retry'));retry.disabled=state.busy;
              retry.addEventListener('click',()=>pack.click());waiting.append(retry);
            }
            assistDock.append(waiting);
          }
          const wordNames = {neutral:'平静',happy:'开心',wink:'眨眼',love:'喜欢',shy:'害羞',surprised:'惊讶',angry:'生气',sad:'难过',sleepy:'困倦',thinking:'思考',smug:'得意',pout:'嘟嘴',worried:'担心',determined:'坚定',flustered:'慌张',scared:'害怕',excited:'兴奋',cry:'哭泣',confused:'疑惑',idle:'待机',nod:'点头',shake:'摇头',wave:'挥手',bow:'鞠躬',cheer:'欢呼',dance:'跳舞',jump:'跳跃',sit:'坐下',stretch:'伸展',shiver:'发抖'};
          const history = el('details','l2d-assist-history'); history.dataset.id='history'; history.open=expanded.has('history');
          const finished = plans.filter(p=>p.status==='done');
          history.append(el('summary',null,t(`已完成 ${finished.length} 项 · 查看记录`,`${finished.length} completed · View history`)));
          for (const plan of plans) {
            const row = el('section','l2d-assist-plan');
            const info = el('div','l2d-assist-info');
            const labels = {pending:t('待确认','Awaiting approval'),approved:t('待重试','Ready to retry'),validating:t('检查素材中','Validating'),executing:t('安装中','Installing'),done:t('已安装','Installed'),interrupted:t('任务已中断，请重新导入','Interrupted; import again')};
            info.append(el('strong',null,`${plan.model} · ${labels[plan.status] || plan.status}`));
            if (plan.status === 'pending') info.append(el('p',null,plan.question));
            if (plan.error && plan.status !== 'done') info.append(el('p','has-error',plan.error));
            for (const warning of plan.reviewWarnings || []) info.append(el('p',null,t('需要确认：','Confirmation required: ') + warning));
            if (plan.summary?.length) {
              const detail = el('details','l2d-adaptation');detail.append(el('summary',null,t('适配详情','Mapping details')));
              detail.dataset.id=plan.id;detail.open=expanded.has(plan.id);
              for(const item of plan.summary)detail.append(el('p',null,t(`表现“${wordNames[item.word] || item.word}”时使用「${item.source}」：${item.reason}`,`For ${item.word}, use ${item.source}: ${item.reason}`)));
              detail.append(el('p',null,t('未映射的动作保留通用表现。','Unmapped actions retain generic behavior.')));
              for(const skipped of plan.skipped || [])detail.append(el('p',null,typeof skipped==='string'?skipped:skipped.reason || skipped.word || ''));
              info.append(detail);
            }
            const actions = el('div','l2d-dialog-actions');
            for (const [method,label] of ['pending','approved'].includes(plan.status) ? [['assistReject',t('暂不安装','Not now')],['assistApprove',plan.status==='approved'?t('重试安装','Retry installation'):t('同意安装','Approve & install')]] : []) {
              const button = el('button','l2d-btn sm'+(method==='assistApprove'?' primary':''),label);
              button.addEventListener('click',async()=>{
                if(state.busy)return;
                setBusy(true,t('处理方案…','Processing proposal…'),undefined,'build');
                try { await ctx.invoke(method,[plan.id]); await refresh(); }
                catch(error){ui.toast(text(error),'bad');log.append(text(error),'bad');await refresh().catch(()=>{});}
                finally {setBusy(false);}
              }); actions.append(button);
            }
            row.append(info,actions); (plan.status==='done'?history:assistDock).append(row);
          }
          if (finished.length) assistDock.append(history);
          assistDock.classList.toggle('history-only',assistDock.children.length===1 && assistDock.firstElementChild===history);
          paintSource();
        }

        // ---------------- 行为 ----------------
        function say(text, bad = false) {
          statusText.textContent = text;
          status.classList.toggle('bad', Boolean(bad));
        }

        /** 忙碌时：转圈 + 一条来回走的进度线 + 秒数。 */
        let ticker = null;
        function stopTicker() {
          if (ticker?.dispose) ticker.dispose();
          else if (ticker) win.clearInterval(ticker);
          ticker = null;
        }
        let startedAt = 0;
        function busyLabel(base, hint) {
          const ms = performance.now() - startedAt;
          say(hint ? `${base} · ${hint}` : `${base} ${(ms / 1000).toFixed(1)}s`);
        }
        function setBusy(on, base, hint, phase = '') {
          if (disposed) return;
          state.busy = on;
          folderInput.disabled = on;
          zipInput.disabled = on;
          coreGet.disabled = on;
          versionCorner.disabled = on || !notice;
          acknowledge.disabled = on || !notice;
          ctx.root.setAttribute('aria-busy', String(on));
          state.phase = on ? phase : '';
          for (const b of [pack, chooseFolder, chooseZip, clearAll, settingsButton]) b.disabled = on;
          dropZone.setAttribute('aria-disabled', String(on));
          const count = (staged?.models?.length || 0) + (staged?.packs?.length || 0);
          pack.disabled = on || !count || completed.size === count;
          if (assistState.enabled && (assistState.submissions || []).some(r => r.token === staged?.token && !r.error && !r.canRetry)) pack.disabled = true;
          for (const b of grid.querySelectorAll('button')) b.disabled = on;
          for (const input of modal?.querySelectorAll('button, input, textarea, select') ?? []) input.disabled = on;
          status.classList.toggle('busy', on);
          progress.classList.toggle('on', on);
          if (on) {
            startedAt = performance.now();
            if (base) busyLabel(base, hint);
            stopTicker();
            renderGrid();
            ticker = ctx.interval ? ctx.interval(() => { if (state.busy) busyLabel(base, hint); }, 250)
              : win.setInterval(() => { if (state.busy) busyLabel(base, hint); }, 250);
          } else {
            stopTicker();
            status.classList.remove('busy');
            progress.classList.remove('on');
            if (!status.classList.contains('bad')) paint();
            else renderGrid();
          }
        }

        function paint() {
          if (!state.busy && modal && !state.builds.some(b => b.id === editingId)) closeEdit();
          const bits = [];
          if (state.installed?.target) bits.push(t('已安装 ', 'Installed ') + state.installed.target.split(/[\\/]/).pop());
          if (!bits.length) bits.push(t('就绪', 'Ready'));
          say(bits.join('　'));
          target.textContent = state.figuresDir ? t('安装到 ', 'Installs to ') + state.figuresDir : '';
          target.title = state.figuresDir;
          renderGrid();
        }

        function renderGrid() {
          grid.replaceChildren();
          countLabel.textContent = String(state.builds.length);
          clearAll.disabled = state.busy || state.builds.length < 2;
          if (!state.builds.length) {
            if (state.busy && state.phase === 'build') {
              const ghost = el('div', 'l2d-card ghost');
              ghost.appendChild(el('div', 'empty shimmer'));
              ghost.appendChild(el('div', 'title shimmer'));
              ghost.appendChild(el('div', 'meta shimmer'));
              grid.appendChild(ghost);
              return;
            }
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
          if (!builds.length) grid.append(el('div', 'l2d-empty', t('没有匹配的模型包', 'No matching packs')));
          for (const b of builds) {
            const card = el('article', 'l2d-card' + (installedId === b.id ? ' installed' : '') + (editingId === b.id ? ' selected' : ''));
            card.dataset.id = b.id;
            if (b.thumb) {
              const img = doc.createElement('img');
              img.src = b.thumb;
              img.alt = ''; img.loading = 'lazy'; img.width = 160; img.height = 88;
              card.appendChild(img);
            } else {
              card.appendChild(el('div', 'empty', t('无封面', 'no cover')));
            }
            const shown = (zh ? b.nameZh : b.nameEn) || b.nameZh || b.nameEn || b.id.replace(/(-\d{6,})+$/, '');
            const info = el('div', 'l2d-card-info');
            const titleEl = el('button', 'title', shown);
            titleEl.addEventListener('click', () => { if (!state.busy) openEdit(b, card); });
            titleEl.title = b.id;
            info.appendChild(titleEl);
            info.appendChild(el('div', 'meta',
              `${(b.bytes / 1048576).toFixed(1)} MB · ${clock(b.at)}`));
            if (installedId === b.id) info.appendChild(el('span', 'tagline', t('已安装', 'Installed')));
            card.appendChild(info);
            const adaptation = adaptationDetails(b.adaptation);
            if (adaptation) info.appendChild(adaptation);

            const install = el('button', 'l2d-btn sm l2d-install', t('安装', 'Install'));
            install.addEventListener('click', () => run('install', b.id));
            const cardActions = el('div', 'l2d-card-actions');
            cardActions.appendChild(install);

            const row = el('div', 'row');
            const edit = el('button', 'l2d-btn sm', t('编辑', 'Edit'));
            edit.addEventListener('click', () => { if (!state.busy) openEdit(b, card); });
            const del = el('button', 'l2d-btn sm danger', t('删除', 'Delete'));
            del.addEventListener('click', async () => {
              if (state.busy) return;
              const ok = await ui.confirm({
                title: t('删除这份打包产物？', 'Delete this pack?'),
                body: t('只删这一份打包，已安装的形象不受影响。', 'Only this pack folder is removed.'),
                danger: true,
              });
              if (!ok) return;
              setBusy(true, t('删除…', 'Deleting…'));
              try {
                const r = await ctx.invoke('remove', [b.id]);
                state.builds = r.builds ?? [];
                paint();
                log.append(t('已删除 ', 'Deleted ') + b.id, 'dim');
                ui.toast(t('已删除', 'Deleted'), 'ok');
              } catch (e) {
                ui.toast(text(e), 'bad');
              } finally { setBusy(false); }
            });
            del.classList.add('quiet');
            if(b.manualAvailable){const bind=el('button','l2d-btn sm l2d-card-binding',t('动作','Actions'));bind.addEventListener('click',()=>openBindings('manualOpenBuild',[b.id]));card.appendChild(bind);}
            row.append(edit, del);
            cardActions.appendChild(row);
            card.appendChild(cardActions);
            for (const button of card.querySelectorAll('button')) button.disabled = state.busy;
            grid.appendChild(card);
          }
        }

        async function refresh() {
          const r = await ctx.invoke('list', []);
          if (disposed) return;
          state.builds = r.builds ?? [];
          state.installed = r.installed ?? null;
          state.figuresDir = r.figuresDir ?? '';
          paintAutomation(r.automation);
          const d = r.dir ?? '';
          if (!initialized && d) {
            state.dir = d;
          }
          initialized = true;
          paint();
        }

        async function run(kind, id) {
          if (state.busy) return;
          if (kind !== 'scan' && !ensureNotice()) return;
          if (kind !== 'install' && !state.dir) return;
          if (kind === 'build' && !coreReady()) {
            ui.toast(t('先获取 Live2D 核心组件', 'Fetch the Live2D core first'), 'bad');
            coreCard.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            return;
          }
          const label = kind === 'scan' ? t('扫描', 'Scan') : kind === 'build' ? t('打包', 'Pack') : t('安装', 'Install');
          setBusy(true, label + '…', undefined, kind);
          log.append(`→ ${label}`, 'dim');
          try {
            const args = kind === 'install' && id ? [state.dir, id] : [state.dir];
            const r = await ctx.invoke(kind, args);
            if (disposed) return;
            for (const line of r.log ?? []) log.append(line, 'dim');
            log.append(`✓ ${label} · ${((performance.now() - startedAt) / 1000).toFixed(1)}s`, 'plain');
            ui.toast(`${label} ✓`, 'ok');
            if (r.warn) log.append('! ' + r.warn, 'warn');
            await refresh().catch(e => log.append(t('操作已完成，列表刷新失败：', 'Completed, but the list could not refresh: ') + text(e), 'warn'));
          } catch (e) {
            const s = text(e);
            say(`${label} ✗ ${s}`, true);
            log.append(`✗ ${s}`, 'bad');
            ui.toast(`${label} ✗`, 'bad');
          } finally {
            setBusy(false);
          }
        }

        let bindingEditor = null;
        let bindingOpening = false;
        async function openBindings(method,args,onSaved) {
          if(state.busy || bindingOpening || bindingEditor || !ensureNotice())return;
          bindingOpening=true;
          try{bindingEditor=await openBindingEditor(ctx,method,args,async()=>{onSaved?.();await refresh();},()=>{bindingEditor=null;});}
          catch(error){ui.toast(text(error),'bad');}
          finally{bindingOpening=false;if(bindingEditor?.closed)bindingEditor=null;}
        }
        // ---------------- 编辑弹层 ----------------
        let modal = null;
        let editReturnFocus = null;
        let editLoading = false;
        let editDirty = () => false;

        function closeEdit() {
          if (state.busy) return;
          if (modal) {
            const previousId = editingId;
            modal.close(); modal.remove(); modal = null; editingId = null; renderGrid();
            const previous = [...grid.querySelectorAll('.l2d-card')].find(card => card.dataset.id === previousId);
            (previous?.querySelector('button.title') || editReturnFocus)?.focus({ preventScroll: true });
          }
        }

        async function openEdit(b, cardEl) {
          if (state.busy || editLoading) return;
          if (modal && editingId === b.id) { modal.querySelector('input')?.focus(); return; }
          editLoading = true;
          if (modal && editDirty()) {
            const discard = await ui.confirm({ title: t('放弃未保存的修改？', 'Discard unsaved edits?'), body: t('切换到另一份模型包。', 'Open the other pack.') });
            if (!discard || disposed || state.busy) { editLoading = false; return; }
          }
          editReturnFocus = doc.activeElement;
          const d = await ctx.invoke('detail', [b.id]).catch(() => null);
          editLoading = false;
          if (disposed || state.busy) return;
          if (!d) { ui.toast(t('读不到这份打包的信息', 'Cannot read this pack'), 'bad'); return; }
          modal?.close(); modal?.remove();

          editingId = b.id;
          modal = el('dialog', 'l2d-modal');
          for (const card of grid.querySelectorAll('.l2d-card')) card.classList.toggle('selected', card.dataset.id === editingId);
          accessibleModal(modal, t('编辑形象信息', 'Edit figure'));
          const card = el('div', 'l2d-modal-card');
          const head2 = el('div', 'l2d-modal-head');
          const heading = el('div', 'l2d-modal-heading');
          heading.appendChild(el('div', 'l2d-modal-title', t('编辑形象信息', 'Edit figure')));
          heading.appendChild(el('div', 'l2d-modal-sub', b.id.replace(/(-\d{6,})+$/, '')));
          const close = el('button', 'l2d-btn quiet l2d-modal-close', '×');
          close.setAttribute('aria-label', t('关闭编辑', 'Close editor'));
          close.addEventListener('click', closeEdit);
          head2.append(heading, close);
          card.appendChild(head2);

          const fields = {};
          const addField = (key, label, multiline, value) => {
            const wrap = el('div', 'l2d-field');
            const labelEl = el('label', 'l2d-label', label);
            wrap.appendChild(labelEl);
            const input = multiline ? doc.createElement('textarea') : doc.createElement('input');
            input.id = `l2d-edit-${key}`;
            labelEl.htmlFor = input.id;
            input.maxLength = key === 'name' ? 120 : 1000;
            input.className = 'l2d-input';
            if (multiline) input.rows = 2;
            input.value = value ?? '';
            fields[key] = input;
            wrap.appendChild(input);
            card.appendChild(wrap);
          };
          addField('name', t('名字', 'Name'), false, d.nameZh || d.nameEn || '');
          addField('about', t('一句话', 'About'), true, d.aboutZh || d.aboutEn || '');

          const gainWrap = el('div', 'l2d-field');
          const gainTop = el('div', 'l2d-label-row');
          gainTop.appendChild(el('span', 'l2d-label', t('身体幅度', 'Body gain')));
          const gainOut = el('output', 'l2d-out', Number(d.bodyGain ?? 1.8).toFixed(2));
          gainTop.appendChild(gainOut);
          gainWrap.appendChild(gainTop);
          const gain = doc.createElement('input');
          gain.type = 'range';
          gain.setAttribute('aria-label', t('身体幅度', 'Body gain'));
          gain.min = '0.5';
          gain.max = '3';
          gain.step = '0.05';
          gain.value = String(d.bodyGain ?? 1.8);
          gain.className = 'l2d-range';
          gain.addEventListener('input', () => { gainOut.textContent = Number(gain.value).toFixed(2); });
          gainWrap.appendChild(gain);
          gainWrap.hidden = d.tunable === false;
          card.appendChild(gainWrap);

          const styleWrap = el('div', 'l2d-field');
          styleWrap.appendChild(el('div', 'l2d-label', t('动作风格', 'Motion style')));
          const style = doc.createElement('select');
          style.className = 'l2d-input';
          style.setAttribute('aria-label', t('动作风格', 'Motion style'));
          for (const [v, label] of [['natural', t('自然', 'Natural')], ['lively', t('活泼', 'Lively')], ['calm', t('安静', 'Calm')], ['shy', t('害羞', 'Shy')]]) {
            const o = doc.createElement('option');
            o.value = v;
            o.textContent = label;
            style.appendChild(o);
          }
          style.value = d.style ?? 'natural';
          styleWrap.appendChild(style);
          styleWrap.hidden = d.tunable === false;
          card.appendChild(styleWrap);
          const initialEdit = () => JSON.stringify([fields.name.value, fields.about.value, gain.value, style.value]);
          const initialValues = initialEdit();
          editDirty = () => initialEdit() !== initialValues;

          card.appendChild(el('div', 'l2d-hint', t(
            '直接保存到该份打包产物。若这份已安装，需再点一次「安装」同步到 Coo。',
            'Saves without repacking. Re-install to sync if already installed.',
          )));

          const actions = el('div', 'l2d-modal-actions');
          const cancel = el('button', 'l2d-btn', t('取消', 'Cancel'));
          const save = el('button', 'l2d-btn primary', t('保存', 'Save'));
          actions.append(cancel, save);
          card.appendChild(actions);

          cancel.addEventListener('click', closeEdit);
          modal.addEventListener('click', (e) => {
            if (e.target !== modal) return;
            const bounds = modal.getBoundingClientRect();
            if (e.clientX < bounds.left || e.clientX > bounds.right || e.clientY < bounds.top || e.clientY > bounds.bottom) closeEdit();
          });

          save.addEventListener('click', async () => {
            if (state.busy) return;
            if (!fields.name.value.trim()) { ui.toast(t('名字不能为空', 'Name is required'), 'bad'); fields.name.focus(); return; }
            save.disabled = true;
            setBusy(true, t('保存…', 'Saving…'), undefined, 'edit');
            try {
              const name = fields.name.value.trim();
              const about = fields.about.value.trim();
              await ctx.invoke('edit', [b.id, {
                nameZh: name, nameEn: name,
                aboutZh: about, aboutEn: about,
                ...(d.tunable === false ? {} : {bodyGain:Number(gain.value),style:style.value}),
              }]);
              // 先就地更新卡片，再拉一次完整列表
              if (cardEl && name) {
                const titleEl = cardEl.querySelector('.title');
                if (titleEl) titleEl.textContent = name;
              }
              b.nameZh = name;
              b.nameEn = name;
              setBusy(false);
              closeEdit();
              ui.toast(t('已保存', 'Saved'), 'ok');
              log.append(t('编辑 · ', 'Edited · ') + b.id, 'dim');
              refresh().catch(() => {});
            } catch (e) {
              ui.toast(text(e), 'bad');
            } finally { save.disabled = false; setBusy(false); }
          });

          modal.appendChild(card);
          shell.appendChild(modal);
          modal.showModal();
          fields.name.focus();
        }

        // ---------------- 导入 ----------------
        const MAX_MB = 32;

        function toBase64(buffer) {
          const bytes = new Uint8Array(buffer);
          const parts = [];
          const chunk = 0x8000;
          for (let i = 0; i < bytes.length; i += chunk) {
            parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunk)));
          }
          return btoa(parts.join(''));
        }

        /** 面板拼的文件夹包：与桌宠同一套格式（路径长度 + 路径 + 内容长度 + 内容）。 */
        function bundle(files) {
          const enc = new TextEncoder();
          const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
          return new Blob(files.flatMap(({ path, file }) => {
            const name = enc.encode(path);
            return [u32(name.length), name, u32(file.size), file];
          }));
        }

        /** 选中/拖进来的文件里，可能是包的目录：含 figure.json（打好的包）或 .model3.json（原始模型），最多 3 层。 */
        function packFiles(files, depth = 3) {
          const dirs = [...new Set(files
            .map((f) => f.path.split('/'))
            .filter((p) => {
              const name = (p[p.length - 1] || '').toLowerCase();
              return p.length - 2 <= depth && (name === 'figure.json' || name.endsWith('.model3.json'));
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
          const inPack = depth === Infinity || list.some((e) => e.isFile && (e.name.toLowerCase() === 'figure.json' || e.name.toLowerCase().endsWith('.model3.json')));
          const out = [];
          for (const e of list) {
            if (e.isFile && inPack) out.push({ path: `${path}/${e.name}`, file: await new Promise((ok, bad) => e.file(ok, bad)) });
            else if (e.isDirectory && (inPack || depth > 0)) out.push(...await droppedFiles(e, `${path}/${e.name}`, inPack ? Infinity : depth - 1));
          }
          return out;
        }

        function cancelOwnedImport(token = activeImportToken) {
          if (!token) return;
          if (disposed && ctx.notifyOnUnmount) ctx.notifyOnUnmount('importCancel', [token]);
          else ctx.invoke('importCancel', [token]).catch(() => {});
        }

        const importView = {
          loading(label) { sourceTitle.textContent = label; sourceHint.textContent = ''; },
          note(title, detail, bad) {
            staged = null; completed.clear(); paintSource();
            sourceHint.textContent = [title, detail].filter(Boolean).join('：');
            dropZone.classList.toggle('bad', Boolean(bad));
          },
          result(result) {
            if (disposed) { cancelOwnedImport(result.token); return; }
            activeImportToken = result.token;
            staged = result; completed.clear(); dropZone.classList.remove('bad');
            showAdaptation(null); paintSource();
            if (!(result.models?.length || result.packs?.length)) {
              sourceHint.textContent = result.problems?.map(p => p.reason).join('；') || t('未找到 .model3.json 或 figure.json', 'No .model3.json or figure.json found');
            }
          },
        };

        function clearSource() {
          staged = null; completed.clear(); showAdaptation(null); paintSource();
          dropZone.classList.remove('bad');
        }

        async function stageZip(file) {
          if (state.busy || disposed) return;
          if (file.size > MAX_MB * 1048576) { importView.note(t('ZIP 太大', 'ZIP too large'), t('请解压后选择文件夹', 'Extract it and choose the folder'), true); return; }
          clearSource(); setBusy(true, t('读取 ZIP…', 'Reading ZIP…'), undefined, 'import');
          importView.loading(t('解包中…', 'Unpacking…'));
          try {
            const bytes = await file.arrayBuffer();
            if (disposed) return;
            if (bytes.byteLength > MAX_MB * 1048576) throw new Error(t('ZIP 超过 32 MB，请解压后导入文件夹', 'ZIP exceeds 32 MB; import the extracted folder'));
            importView.result(await ctx.invoke('importStage', [toBase64(bytes), 'zip']));
          } catch (error) { if (!disposed) importView.note(t('导入失败', 'Import failed'), text(error), true); }
          finally { setBusy(false); }
        }

        async function stageFolder(files, view) {
          if (state.busy || disposed) return;
          const picked = packFiles(files, 3);
          if (!picked.length) { view.note(t('这里没有模型包', 'No model pack here'), t('没有找到 .model3.json 或 figure.json', 'No .model3.json or figure.json found'), false); return; }
          if (picked.length > 20000 || picked.reduce((n, f) => n + (Number(f.file.size) || 0), 0) > 512 * 1048576) { view.note(t('目录过大', 'Folder too large'), t('请改用粘贴本机目录路径', 'Paste its local directory path instead'), true); return; }
          clearSource(); setBusy(true, t('读取文件夹…', 'Reading folder…'), undefined, 'import');
          view.loading(t('读取文件夹…', 'Reading folder…'));
          let token;
          try {
            token = (await ctx.invoke('importBegin', [])).token;
            activeImportToken = token;
            let batch = [], bytes = 0;
            const flush = async () => { if (batch.length) { await ctx.invoke('importAppend', [token, batch]); batch = []; bytes = 0; } };
            for (const item of picked) {
              if (disposed) return;
              if (item.file.size > 4 * 1048576 && typeof item.file.slice === 'function') {
                await flush();
                for (let offset = 0; offset < item.file.size; offset += 2 * 1048576) {
                  const data = await item.file.slice(offset, offset + 2 * 1048576).arrayBuffer();
                  if (disposed) return;
                  await ctx.invoke('importAppendChunk', [token, {path:item.path,offset,total:item.file.size,b64:toBase64(data)}]);
                }
              } else {
                const data = await item.file.arrayBuffer();
                if (disposed) return;
                const b64 = toBase64(data); batch.push({path:item.path,b64}); bytes += b64.length;
                if (bytes >= 4 * 1048576) await flush();
              }
            }
            await flush();
            if (!disposed) view.result(await ctx.invoke('importFinish', [token, true]));
          } catch (error) { if (!disposed) view.note(t('导入失败', 'Import failed'), text(error), true); if (token) cancelOwnedImport(token); }
          finally { if (disposed && token) cancelOwnedImport(token); setBusy(false); }
        }

        async function importPaths(paths) {
          if (state.busy || disposed || !paths.length) return;
          clearSource();
          setBusy(true, t('读取…', 'Reading…'), undefined, 'import');
          importView.loading(t('识别模型…', 'Recognizing model…'));
          try { const result = await ctx.invoke('importPaths', [paths]); if (!disposed) importView.result(result); }
          catch (e) { if (!disposed) importView.note(t('导入失败', 'Import failed'), text(e), true); }
          finally { setBusy(false); }
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

        async function importFiles(files) {
          if (state.busy || disposed || !files.length) return;
          const local = files.map(f => f.path || f.file.path).filter(p => /^[a-z]:[\\/]/i.test(p || '') || p?.startsWith('/'));
          if (local.length === files.length) return importPaths(local);
          if (files.length === 1 && /\.zip$/i.test(files[0].path)) return stageZip(files[0].file);
          if (files.length === 1 && /\.json$/i.test(files[0].path)) {
            importView.note(t('缺少同目录资源', 'Sibling files required'), t('请选择入口文件的完整路径，或拖入整个模型文件夹', 'Choose the entry file by its local path, or drop the whole model folder'), true); return;
          }
          return stageFolder(files, importView);
        }

        async function buildSources() {
          if (state.busy || !staged || !ensureNotice()) return;
          if (assistState.enabled) {
            setBusy(true,t('交给 Coo 分析…','Asking Coo to analyze…'),undefined,'import');
            try { const result = await ctx.invoke('assistAnalyze',[staged.token,(staged.models||[]).map(m=>m.dir),(staged.packs||[]).map(p=>p.dir)]); await refresh(); ui.toast(result.queued===false?t('已提交，请等待 Coo 的方案','Already submitted; wait for Coo'):t('已交给 Coo，稍后在气泡或适配方案中确认','Coo will explain the proposal for your approval'),'ok'); }
            catch(error){ui.toast(text(error),'bad');}
            finally{setBusy(false);}return;
          }
          if (assistState.adaptationMode === 'manual' && staged.models?.length) {
            const next=staged.models.find(item=>!completed.has('importBuild:'+item.dir));
            if(next) { await openBindings('manualOpen',[staged.token,next.dir],()=>{completed.add('importBuild:'+next.dir);}); return; }
          }
          if (staged.models?.length && !coreReady()) { ui.toast(t('先获取 Live2D 核心组件', 'Fetch the Live2D core first'), 'bad'); return; }
          const pending = [
            ...(staged.models ?? []).map(item => ({ ...item, method: 'importBuild' })),
            ...(staged.packs ?? []).map(item => ({ ...item, method: 'importKeep' })),
          ];
          const token = staged.token;
          setBusy(true, t('打包…', 'Packing…'), undefined, 'build');
          let failed = 0;
          for (const item of pending) {
            if (disposed) break;
            const key = item.method + ':' + item.dir;
            if (completed.has(key)) continue;
            try {
              const result = await ctx.invoke(item.method, [token, item.dir, false]);
              completed.add(key);
              for (const line of result.log ?? []) log.append(line, 'dim');
              if (result.adaptation) showAdaptation(result.adaptation);
              if (result.warn) log.append('! ' + result.warn, 'warn');
            } catch (e) {
              failed++; log.append(`! ${item.title || item.id || item.dir} · ${text(e)}`, 'bad');
            }
          }
          try { await refresh(); }
          catch (e) { log.append('! ' + text(e), 'warn'); }
          finally { setBusy(false); }
          if (disposed) { cancelOwnedImport(token); return; }
          sourceHint.textContent = failed
            ? t(`${failed} 项失败；再次点击只重试未完成项，详情见日志`, `${failed} failed; click again to retry unfinished items; see the log`)
            : t('已加入模型包列表，可编辑或安装', 'Added to packs; edit or install');
          dropZone.classList.toggle('bad', failed > 0);
          ui.toast(failed ? t('部分打包失败', 'Some items failed') : t('打包完成', 'Packing complete'), failed ? 'bad' : 'ok');
        }

        function accessibleModal(node, title) {
          node.setAttribute('role', 'dialog');
          node.setAttribute('aria-modal', 'true');
          node.setAttribute('aria-label', title);
          node.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { e.preventDefault(); closeEdit(); }
          });
          node.addEventListener('cancel', (e) => { e.preventDefault(); closeEdit(); });
        }

        // ---------------- 绑定 ----------------
        // Browser inputs are owned by the Coo window and open its native system dialogs.
        chooseFolder.addEventListener('click', () => { if (!state.busy) folderInput.click(); });
        chooseZip.addEventListener('click', () => { if (!state.busy) zipInput.click(); });
        folderInput.addEventListener('change', async () => {
          if (disposed || state.busy) return;
          const files = [...(folderInput.files ?? [])].map(file => ({ path: file.webkitRelativePath || file.name, file }));
          if (!files.length) return;
          try { await stageFolder(files, importView); }
          catch (e) { importView.note(t('导入失败', 'Import failed'), text(e), true); }
          finally { folderInput.value = ''; }
        });
        zipInput.addEventListener('change', async () => {
          if (disposed || state.busy) return;
          try { await importFiles([...(zipInput.files ?? [])].map(file => ({ path: file.name, file }))); }
          catch (e) { importView.note(t('导入失败', 'Import failed'), text(e), true); }
          finally { zipInput.value = ''; }
        });
        pack.addEventListener('click', buildSources);
        dropZone.addEventListener('click', () => dropZone.focus({ preventScroll: true }));
        dropZone.addEventListener('paste', async (event) => {
          event.preventDefault();
          if (state.busy) return;
          const data = event.clipboardData;
          const clipboardFiles = [...(data?.files ?? [])];
          const clipboardText = data?.getData('text/plain') || data?.getData('text/uri-list');
          try {
            let paths = textPaths(clipboardText);
            if (!paths.length) {
              setBusy(true, t('读取剪贴板…', 'Reading clipboard…'), undefined, 'import');
              try { paths = (await ctx.invoke('clipboard', [])).paths ?? []; }
              catch (e) { if (!clipboardFiles.length) throw e; }
              finally { setBusy(false); }
            }
            if (disposed) return;
            if (paths.length) return await importPaths(paths);
            const files = clipboardFiles.map(file => ({ path: file.name, file }));
            if (files.length) return await importFiles(files);
            importView.note(t('未读到模型', 'No model found'), t('请复制文件、文件夹，或其完整路径后粘贴', 'Copy files, a folder, or their full local path, then paste'), false);
          } catch (e) { importView.note(t('粘贴失败', 'Paste failed'), text(e), true); }
        });
        dropZone.addEventListener('dragover', event => { event.preventDefault(); if (!state.busy) dropZone.classList.add('over'); });
        dropZone.addEventListener('dragleave', event => { if (!dropZone.contains(event.relatedTarget)) dropZone.classList.remove('over'); });
        dropZone.addEventListener('drop', async event => {
          event.preventDefault(); dropZone.classList.remove('over');
          if (state.busy || disposed) return;
          const data = event.dataTransfer;
          if (!data) return;
          // Capture all handles synchronously; the drag data store closes after this event.
          const paths = textPaths(data.getData('text/plain') || data.getData('text/uri-list'));
          const entries = [...(data.items ?? [])].filter(item => item.kind === 'file').map(item => item.webkitGetAsEntry?.()).filter(Boolean);
          const plain = [...(data.files ?? [])].map(file => ({path:file.name,file}));
          if (paths.length) return importPaths(paths);
          setBusy(true, t('读取拖入内容…', 'Reading dropped files…'), undefined, 'import');
          try {
            const files = [];
            for (const entry of entries) {
              if (disposed) return;
              if (entry.isDirectory) files.push(...await droppedFiles(entry, entry.name, 3));
              else files.push({path:entry.name,file:await new Promise((ok,bad)=>entry.file(ok,bad))});
            }
            setBusy(false);
            if (!disposed) {
              const captured = files.length ? files : plain;
              if (!captured.length) throw new Error(t('未读到文件，请拖入模型文件夹或 ZIP', 'No files found; drop a model folder or ZIP'));
              await importFiles(captured);
            }
          } catch (error) { if (!disposed) importView.note(t('导入失败', 'Import failed'), text(error), true); }
          finally { setBusy(false); }
        });
        clearAll.addEventListener('click', async () => {
          if (state.busy) return;
          const ok = await ui.confirm({
            title: t('清空旧打包？', 'Clear old packs?'),
            body: t('保留最新一份，其余打包目录直接删除。已安装的形象不受影响。', 'Keeps the newest pack; installed figures stay.'),
            danger: true,
          });
          if (!ok) return;
          setBusy(true, t('清理…', 'Clearing…'));
          try {
            const r = await ctx.invoke('clearAll', []);
            state.builds = r.builds ?? [];
            paint();
            log.append(t('清空旧打包 · 删除 ', 'Cleared ') + r.removed + t(' 份', ' packs'), 'dim');
            ui.toast(t('已清空', 'Cleared'), 'ok');
          } catch (e) {
            ui.toast(text(e), 'bad');
          } finally { setBusy(false); }
        });

        function stopResume() {
          if (resumeHandle?.dispose) resumeHandle.dispose();
          else if (resumeHandle) win.clearInterval(resumeHandle);
          resumeHandle = null;
        }
        async function pollResume() {
          if (disposed || !resuming || resumePolling) return;
          resumePolling = true;
          try {
            const remote = await ctx.invoke('state', []);
            if (disposed || remote.busy) return;
            resuming = false; stopResume(); setBusy(false);
            await refresh();
            const completed = resumePhase && remote.steps?.[resumePhase];
            if (completed?.phase === 'error') say(completed.hint, true);
          } catch (error) { if (!disposed) say(t('等待后台任务结果…', 'Waiting for the background task…')); }
          finally { resumePolling = false; }
        }

        // Host calls the returned disposer when switching panels.
        setBusy(true, t('读取…', 'Loading…'));
        Promise.all([loadCore(), ctx.invoke('state', [])]).then(async ([, initial]) => {
          if (disposed) return;
          notice = initial.notice;
          version = initial.version;

          noticeDetails.open = !notice?.acknowledged;
          paintNotice();
          for (const line of initial.log ?? []) log.append(line, 'dim');
          await refresh();
          if (initial.busy) {
            resuming = true;
            resumePhase = Object.keys(initial.steps ?? {}).find(key => initial.steps[key].phase === 'loading');
            setBusy(true, t('后台任务处理中…', 'Background task running…'), undefined, 'build');
            resumeHandle = ctx.interval ? ctx.interval(pollResume, 800) : win.setInterval(pollResume, 800);
          }
        }).catch((e) => { if (!disposed) say(text(e), true); }).finally(() => { if (!resuming) setBusy(false); paintNotice(); });
        return { dispose() {
          if (disposed) return;
          disposed = true;
          stopTicker();
          stopResume();
          assistTimer?.dispose?.();
          bindingEditor?.dispose?.();
          modal?.close(); modal?.remove();
          observer?.disconnect(); win.removeEventListener('resize', resize);
          for (const handle of ownedOverlays) handle.dispose?.();
          shell.remove();
          cancelOwnedImport();
          ctx.root.removeAttribute('aria-busy');
        } };
      },
    },
  },
};

function text(e) {
  return String((e && e.message) || e);
}

function clock(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
