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
  };
  win.addEventListener('message',listener);
  frame.setAttribute('sandbox','allow-scripts');frame.src=data.preview.url;
  return dispose;
}

async function openBindingEditor(ctx,method,args,onSaved,onClosed) {
  const doc=ctx.root.ownerDocument,win=doc.defaultView,zh=String(ctx.language||'zh').startsWith('zh'),t=(a,b)=>zh?a:b;
  const names={neutral:'中性',happy:'开心',wink:'眨眼',love:'喜欢',shy:'害羞',surprised:'惊讶',angry:'生气',sad:'难过',sleepy:'困倦',thinking:'思考',smug:'得意',pout:'嘟嘴',worried:'担心',determined:'坚定',flustered:'慌乱',scared:'害怕',excited:'兴奋',cry:'哭泣',confused:'疑惑',idle:'待机',nod:'点头',shake:'摇头',wave:'挥手',bow:'鞠躬',cheer:'欢呼',dance:'跳舞',jump:'跳跃',sit:'坐下',stretch:'伸展',shiver:'发抖'};
  const label=w=>zh?names[w]||w:w;
  const el=(tag,cls,text)=>{const n=doc.createElement(tag);n.className=cls||'';if(text!=null)n.textContent=text;return n;};
  const previous=doc.activeElement;
  const modal=el('dialog','l2d-modal l2d-bind-modal');modal.setAttribute('aria-label',t('动作绑定','Action bindings'));
  const card=el('div','l2d-bind-card'),head=el('div','l2d-modal-head'),heading=el('div','l2d-modal-heading');
  heading.append(el('div','l2d-modal-title',t('动作绑定','Action bindings')),el('div','l2d-modal-sub',t('选择表情或动作，预览后绑定','Choose a target, preview a resource, then bind')));
  const close=el('button','l2d-btn quiet l2d-modal-close','×');close.setAttribute('aria-label',t('关闭动作绑定','Close bindings'));head.append(heading,close);
  const layout=el('div','l2d-bind-layout'),left=el('nav','l2d-bind-targets'),stage=el('section','l2d-bind-stage'),right=el('section','l2d-bind-resources');
  left.setAttribute('aria-label',t('绑定目标','Binding targets'));right.setAttribute('aria-label',t('原生资源','Native resources'));
  const frame=el('iframe','l2d-bind-frame');frame.title=t('模型实时预览','Live model preview');frame.setAttribute('sandbox','allow-scripts');
  const hint=el('p','l2d-bind-status',t('准备模型…','Preparing model…'));hint.setAttribute('role','status');
  const toolbar=el('div','l2d-bind-toolbar'),raw=el('button','l2d-btn sm',t('组合效果','Combined')),replay=el('button','l2d-btn sm',t('重播','Replay')),reset=el('button','l2d-btn sm',t('复位','Reset'));
  toolbar.append(raw,replay,reset);stage.append(frame,hint,toolbar);layout.append(left,stage,right);
  const footer=el('div','l2d-bind-footer'),summary=el('span','l2d-bind-summary',t('未绑定的项目使用通用配方','Unbound targets use generic recipes'));
  const cancel=el('button','l2d-btn',t('取消','Cancel')),save=el('button','l2d-btn primary',t('保存绑定','Save bindings'));save.disabled=true;
  footer.append(summary,cancel,save);card.append(head,layout,footer);modal.append(card);ctx.root.append(modal);modal.showModal();
  let closed=false,saving=false,dirty=false,data,bindings=[],word='happy',resource=null,rawMode=false,ready=false,cleanup=()=>{},serial=0;
  const alive=()=>!closed&&!ctx.signal?.aborted;
  const release=()=>{if(closed)return;closed=true;leave?.dispose?.();ctx.signal?.removeEventListener('abort',release);cleanup();modal.close();modal.remove();onClosed?.();if(data)ctx.invoke('manualClose',[data.token]).catch(()=>{});previous?.focus?.();};
  const requestClose=async()=>{if(saving)return;if(dirty&&!await ctx.ui.confirm({title:t('放弃未保存的绑定？','Discard unsaved bindings?'),body:t('已保存的绑定会保留。','Saved bindings are kept.')}))return;release();};
  close.onclick=cancel.onclick=requestClose;modal.addEventListener('cancel',e=>{e.preventDefault();void requestClose();});modal.addEventListener('click',e=>{if(e.target===modal)void requestClose();});
  const leave=ctx.guardLeave?.(()=>alive()&&(dirty||saving)?t('动作绑定尚未保存，确定离开？','Bindings are not saved. Leave?'):null);
  ctx.signal?.addEventListener('abort',release,{once:true});
  const send=type=>{if(ready)frame.contentWindow.postMessage({t:type==='play'?'preview-play':'preview-stop',resource:resource?.id,word,bindings,raw:rawMode},'*');};
  const play=()=>{send('play');hint.textContent=resource?`${label(word)} · ${resource.title}`:t('通用表现','Generic behavior');};
  raw.onclick=()=>{rawMode=!rawMode;raw.textContent=rawMode?t('原生效果','Native only'):t('组合效果','Combined');raw.setAttribute('aria-pressed',String(rawMode));play();};replay.onclick=play;reset.onclick=()=>{send('stop');hint.textContent=t('已复位','Reset');};
  let filter='all';const search=el('input','l2d-input');search.placeholder=t('搜索原生资源','Search native resources');search.setAttribute('aria-label',search.placeholder);
  const tabs=el('div','l2d-bind-tabs'),list=el('div','l2d-bind-list'),binding=el('div','l2d-bind-selection');
  right.append(search,tabs,list,binding);
  const paintTargets=()=>{left.replaceChildren();for(const [key,title]of [['expressions',t('表情','Expressions')],['motions',t('动作','Motions')]]){
    left.append(el('h3',null,title));for(const w of data.words[key]){
      const b=el('button','l2d-bind-target'+(w===word?' selected':''));b.type='button';b.setAttribute('aria-pressed',String(w===word));
      b.append(el('span',null,label(w)),el('small',null,bindings.some(b=>b.word===w)?t('已绑定','Bound'):t('通用','Generic')));
      b.onclick=()=>{word=w;const match=bindings.find(b=>b.word===w);resource=data.resources.find(r=>r.id===match?.resource)||null;paintTargets();paintResources();play();};left.append(b);
    }
  }};
  const paintSelection=()=>{
    binding.replaceChildren();const current=bindings.find(b=>b.word===word);
    const caption=el('p',null,`${label(word)} ← ${current?data.resources.find(r=>r.id===current.resource)?.title:t('通用配方','Generic recipe')}`);binding.append(caption);
    const bind=el('button','l2d-btn primary',t(`绑定到「${label(word)}」`,`Bind to ${label(word)}`));
    bind.disabled=!ready||!resource||resource.classification==='appearance'||resource.kind==='expression'&&!data.words.expressions.includes(word);
    const restore=el('button','l2d-btn quiet',t('恢复通用','Use generic'));restore.disabled=!current;
    let releaseSelect;
    if(resource?.classification==='pose'){
      binding.append(el('label',null,t('复位动作','Reset motion')));releaseSelect=el('select','l2d-input');releaseSelect.setAttribute('aria-label',t('复位动作','Reset motion'));
      releaseSelect.append(el('option',null,t('请选择','Choose')));releaseSelect.firstChild.value='';
      for(const r of data.resources.filter(r=>r.kind==='motion'&&r.classification!=='appearance'&&r.id!==resource.id)){const o=el('option',null,r.title);o.value=r.id;releaseSelect.append(o);}
      releaseSelect.value=current?.resource===resource.id?current.release||resource.release||'':resource.release||'';
      binding.append(releaseSelect);bind.disabled=bind.disabled||!releaseSelect.value;releaseSelect.onchange=()=>{bind.disabled=!ready||!releaseSelect.value;};
    }
    bind.onclick=()=>{bindings=bindings.filter(b=>b.word!==word);bindings.push({word,resource:resource.id,...(releaseSelect?.value?{release:releaseSelect.value}:{}),confidence:1,reason:'用户在动作编辑器中选择'});dirty=true;paintTargets();paintSelection();play();};
    restore.onclick=()=>{bindings=bindings.filter(b=>b.word!==word);resource=null;dirty=true;paintTargets();paintResources();play();};binding.append(bind,restore);
    summary.textContent=t(`${bindings.length} 项绑定 · 保存后从卡片安装`,`${bindings.length} bindings · install from the pack card after saving`);
  };
  const paintResources=()=>{list.replaceChildren();const q=search.value.trim().toLocaleLowerCase();
    const resources=data.resources.filter(r=>(filter==='all'||filter==='other'?filter!=='other'||r.classification==='appearance':r.kind===filter)&&(!q||r.title.toLocaleLowerCase().includes(q)));
    for(const r of resources){const b=el('button','l2d-bind-resource'+(r.id===resource?.id?' selected':''));b.append(el('span',null,r.title),el('small',null,r.classification==='appearance'?t('其他 · 仅预览','Other · preview only'):r.kind==='expression'?t('表情','Expression'):t(`动作 · ${r.seconds.toFixed(1)} 秒`,`Motion · ${r.seconds.toFixed(1)} s`)));b.onclick=()=>{resource=r;paintResources();play();};list.append(b);}
    if(!resources.length)list.append(el('p','l2d-bind-empty',t('没有匹配的资源','No matching resources')));paintSelection();
  };
  for(const [value,title]of [['all',t('全部','All')],['expression',t('表情','Faces')],['motion',t('动作','Motions')],['other',t('其他','Other')]]){
    const b=el('button','l2d-btn quiet sm',title);b.onclick=()=>{filter=value;for(const n of tabs.children)n.classList.toggle('selected',n===b);paintResources();};tabs.append(b);
  }tabs.firstChild.classList.add('selected');search.oninput=()=>{if(data)paintResources();};
  save.onclick=async()=>{if(saving||!ready)return;saving=true;save.disabled=close.disabled=cancel.disabled=true;hint.textContent=t('保存并打包…','Saving & packing…');
    try{await ctx.invoke('manualSave',[data.token,bindings]);dirty=false;await onSaved?.();release();ctx.ui.toast(t('绑定已保存，可从卡片安装','Bindings saved; install from the pack card'),'ok');}
    catch(error){hint.textContent=String(error.message||error);ctx.ui.toast(hint.textContent,'bad');}
    finally{saving=false;if(alive())save.disabled=close.disabled=cancel.disabled=false;}
  };
  try{
    data=await ctx.invoke(method,args);if(!alive()){ctx.invoke('manualClose',[data.token]).catch(()=>{});return {get closed(){return closed;},dispose:release};}
    bindings=structuredClone(data.bindings||[]);heading.querySelector('.l2d-modal-sub').textContent=data.title;paintTargets();paintResources();
    if(data.truncated||data.warnings?.length)right.prepend(el('p','l2d-bind-empty',t('部分资源未能读取，列表可能不完整','Some resources could not be read; the list may be incomplete')));
    if(data.truncated)hint.textContent=t('资源扫描不完整，请核对模型内容','Resource scan is incomplete; check the model');
    const generation=++serial;
    cleanup=await mountBindingPreview(ctx,frame,data,alive,(type,message)=>{if(!alive()||generation!==serial)return;if(type==='ready'){ready=true;save.disabled=false;paintSelection();play();}else if(type==='error'){hint.textContent=t('预览失败：','Preview failed: ')+message;}});
    if(!alive())cleanup();
  }catch(error){if(alive())hint.textContent=String(error.message||error);}
  return {get closed(){return closed;},dispose(){leave?.dispose?.();release();}};
}
