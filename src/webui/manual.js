// Included in the panel bundle. A preview owns its modules, images and animation loop.
async function mountBindingPreview(ctx,frame,data,alive,onStatus) {
  const urls=[],files=new Map(),base='https://figure-preview.invalid/';
  const object=(bytes,type)=>{const url=URL.createObjectURL(new Blob([bytes],{type}));urls.push(url);return url;};
  const dispose=()=>{frame.src='about:blank';for(const url of urls)URL.revokeObjectURL(url);urls.length=0;};
  try{
    let cursor=0;
    await Promise.all(Array.from({length:4},async()=>{while(cursor<data.files.length){
      const file=data.files[cursor++],parts=[];
      for(let at=0;at<file.size;at+=1048576){
        if(!alive())throw Error('Preview closed');
        const {b64}=await ctx.invoke('manualAsset',[data.token,file.path,at]);
        const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));parts.push(bytes);
      }
      const blob=new Blob(parts);files.set(file.path,blob);
    }}));
    if(!alive())throw Error('Preview closed');
    const assets={},imports={};
    for(const [path,blob]of files){
      if(path.endsWith('.js')&&!path.endsWith('live2dcubismcore.min.js')){
        let code=await blob.text();
        code=code.replace(/(\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(['"])(\.{1,2}\/[^'"]+)\2/g,(_,prefix,q,rel)=>prefix+q+new URL(rel,base+path).href+q);
        imports[new URL(path,base).href]=object(code,'text/javascript');
      } else assets[new URL(path,base).href]=object(blob,path.endsWith('.js')?'text/javascript':path.endsWith('.png')?'image/png':path.endsWith('.webp')?'image/webp':'application/octet-stream');
    }
    const escape=value=>JSON.stringify(value).replaceAll('<','\\u003c');
    const html=`<!doctype html><html><head><meta charset="utf-8"><style>html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}svg{width:100%;height:100%}</style>
      <script src="${assets[base+'pack/sdk/live2dcubismcore.min.js']}"></script>
      <script type="importmap">${escape({imports})}</script></head><body><div id="root"></div><script type="module">
      const assets=${escape(assets)},channel=${escape(data.token)};
      const report=(type,text)=>parent.postMessage({channel,type,text},'*');
      let body,raf,last=performance.now();
      try{
        const kit=await import('${base}kit/body.js'),mod=await import('${base}pack/figure.js');
        const host={root:document.querySelector('#root'),bounds:()=>({W:512,H:512,floorY:490,S:1.65}),emit(){},sound(){},start:{x:256,facing:1}};
        const asset=p=>assets[new URL(p,'${base}pack/').href] || new URL(p,'${base}pack/').href;
        const loadImage=u=>new Promise((ok,bad)=>{const img=new Image();img.onload=()=>ok(img);img.onerror=()=>bad(Error('Image failed'));img.src=assets[String(u)] || String(u);});
        body=await mod.createFigureBody(new URL('${base}pack/'),{kit,host,loadImage,asset,preview:true,scheme:''});
        host.root.querySelector('svg')?.setAttribute('viewBox','0 0 512 512');body.set?.({roam:'off'});body.do?.('neutral');
        function tick(now){body.step(Math.min(.05,(now-last)/1000));last=now;raf=requestAnimationFrame(tick);}raf=requestAnimationFrame(tick);
        addEventListener('message',e=>{if(e.source!==parent || e.data?.channel!==channel)return;const m=e.data;if(m.type==='play')globalThis.__l2dPreview?.play(m.resource,m.word,m.bindings,m.raw);if(m.type==='stop')globalThis.__l2dPreview?.stop();});
        addEventListener('pagehide',()=>{cancelAnimationFrame(raf);body?.dispose();},{once:true});
        report('ready','');
      }catch(error){report('error',String(error.message||error));}
      </script></body></html>`;
    const listener=event=>{if(event.source!==frame.contentWindow||event.data?.channel!==data.token)return;onStatus(event.data.type,event.data.text);};
    frame.ownerDocument.defaultView.addEventListener('message',listener);
    frame.src=object(html,'text/html');
    return ()=>{frame.ownerDocument.defaultView.removeEventListener('message',listener);dispose();};
  }catch(error){dispose();throw error;}
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
  const frame=el('iframe','l2d-bind-frame');frame.title=t('模型实时预览','Live model preview');frame.setAttribute('sandbox','allow-scripts allow-same-origin');
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
  const send=type=>{if(ready)frame.contentWindow.postMessage({channel:data.token,type,resource:resource?.id,word,bindings,raw:rawMode},'*');};
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
