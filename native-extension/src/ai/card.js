import {el,button} from './dom.js';
import {clock,seekNative} from './content-source.js';
import {errorText} from './client.js';
let nodeSequence=0;
export function renderTree(document,tree){
 const ul=el(document,'ul',{class:'pk-ai-tree'});
 for(const node of tree){
  const li=el(document,'li');
  if(node.children.length){
   const children=renderTree(document,node.children);children.id='pk-ai-branch-'+(++nodeSequence);
   const toggle=button(document,node.text,()=>{children.hidden=!children.hidden;toggle.setAttribute('aria-expanded',String(!children.hidden));},'pk-ai-node');
   toggle.setAttribute('aria-expanded','true');toggle.setAttribute('aria-controls',children.id);li.append(toggle,children);
  }else li.append(el(document,'span',{class:'pk-ai-node',text:node.text}));ul.append(li);
 }return ul;
}
function renderSummary(document,text){
 const root=el(document,'div',{class:'pk-ai-summary'});
 for(const line of text.split('\n')){
  const row=el(document,/^#{1,4} /.test(line)?'h4':'p');
  const parts=line.replace(/^#{1,4} /,'').split(/(\*\*[^*]+\*\*)/g);
  for(const part of parts)row.append(part.startsWith('**')&&part.endsWith('**')?el(document,'strong',{text:part.slice(2,-2)}):document.createTextNode(part));root.append(row);
 }return root;
}
export function createCard({document,input,preferences,onRetry,onSettings,onClose}){
 let prefs=preferences,view=input.kind==='article'?'article':(prefs.summary&&prefs.mindmap?prefs.defaultView:prefs.summary?'summary':'mindmap'),collapsed=false;
 const results={},states={},errors={};
 const root=el(document,'section',{id:'peek-ai-card','aria-label':'AI 阅读辅助'}),bar=el(document,'div',{class:'pk-ai-tabs','role':'tablist','aria-label':'AI 视图'}),body=el(document,'div',{class:'pk-ai-body',tabindex:'0'}),footer=el(document,'footer',{class:'pk-ai-footer'}),status=el(document,'span',{'aria-live':'polite'});
 const fold=button(document,'收起摘要',()=>{collapsed=!collapsed;root.classList.toggle('pk-ai-collapsed',collapsed);fold.textContent=collapsed?'展开摘要':'收起摘要';root.style.height=collapsed?'48px':'';document.documentElement.style.setProperty('--peek-ai-space',collapsed?'60px':'calc(min(44vh, 420px) + 12px)');},'pk-ai-icon');
 const tabs=new Map();
 const modes=input.kind==='article'?['article']:[...(prefs.summary?['summary']:[]),...(prefs.mindmap?['mindmap']:[])];
 for(const mode of modes){const tab=button(document,mode==='mindmap'?'思维导图':'Summary',()=>select(mode),'pk-ai-tab');tab.setAttribute('role','tab');tab.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const next=modes[(modes.indexOf(view)+(e.key==='ArrowRight'?1:modes.length-1))%modes.length];select(next);tabs.get(next).focus();});tabs.set(mode,tab);bar.append(tab);}
 bar.append(el(document,'span',{class:'pk-ai-spacer'}),status,fold);
 const copy=button(document,'复制',async()=>{try{await navigator.clipboard.writeText(results[view]?.text||'');copy.textContent='已复制';setTimeout(()=>copy.textContent='复制',1500);}catch{copy.textContent='复制失败';}},'pk-ai-icon');
 footer.append(el(document,'span',{text:'AI 生成 · 请结合原文阅读'}),copy);root.append(bar,body,footer);
 function select(mode){view=mode;for(const [key,tab] of tabs){tab.setAttribute('aria-selected',String(key===view));tab.tabIndex=key===view?0:-1;}draw();}
 function draw(){
  body.replaceChildren();status.textContent=modes.some(m=>states[m]==='loading')?'正在生成…':'';
  const result=results[view];copy.disabled=!result;footer.firstElementChild.textContent=result?.cacheWarning?'已生成 · 本次结果未能缓存':'AI 生成 · 请结合原文阅读';
  if(result){
   if(view==='mindmap'){
    const expand=button(document,'展开 ↗',()=>openMap(result.tree),'pk-ai-link');body.append(expand,renderTree(document,result.tree));
   }else{
    body.append(renderSummary(document,result.text));
    if(view==='summary'&&prefs.timeline&&result.highlights.length){
     body.append(el(document,'h3',{text:'章节速览'}));
     for(const h of result.highlights){const details=el(document,'details',{class:'pk-ai-chapter'}),label=el(document,'summary');
      const seek=button(document,clock(h.timestamp/1000),()=>seekNative(input.video,h.timestamp),'pk-ai-time');label.append(seek,el(document,'span',{text:h.chapter||h.title||'章节'}));details.append(label);
      for(const point of h.bullet_points||[])details.append(button(document,`${clock(point.timestamp/1000)}  ${point.point||point.text||''}`,()=>seekNative(input.video,point.timestamp),'pk-ai-point'));
      body.append(details);
     }
    }
   }
  }else if(states[view]==='error'){
   body.append(el(document,'p',{text:errorText(errors[view])}),button(document,'重试'+(view==='mindmap'?'脑图':'摘要'),()=>onRetry(view)));
   if(['CONTEXT_CHANGED','DISCONNECTED','NEEDS_INITIALIZATION','PERMISSION_REQUIRED','LOGIN_REQUIRED','VERIFICATION_REQUIRED','EXTENSION_UNAVAILABLE'].includes(errors[view]))body.append(button(document,'前往设置',onSettings,'pk-ai-link'));
  }else{body.append(el(document,'p',{text:states[view]==='loading'?'正在整理内容…':'等待生成…'}),el(document,'p',{class:'pk-ai-muted',text:'可以继续播放视频或阅读评论'}));}
 }
 let modal=null;
 function openMap(tree){
  if(modal)return;const prior=document.activeElement;let scale=1;
  modal=el(document,'dialog',{class:'pk-ai-map-dialog','aria-label':'展开思维导图'});
  const canvas=el(document,'div',{class:'pk-ai-map-canvas'},renderTree(document,tree)),zoom=el(document,'span',{text:'100%'}),close=button(document,'返回阅读 ×',()=>modal.close());
  const tools=el(document,'div',{class:'pk-ai-map-tools'},button(document,'缩小',()=>apply(.1*-1)),zoom,button(document,'放大',()=>apply(.1)),button(document,'适应',()=>{const graph=canvas.firstElementChild;const width=graph.getBoundingClientRect().width/scale,height=graph.getBoundingClientRect().height/scale;scale=Math.min(1,(canvas.clientWidth-36)/width,(innerHeight*.58)/height);apply(0);}));
  const apply=delta=>{scale=Math.max(.15,Math.min(2,scale+delta));canvas.firstElementChild.style.zoom=String(scale);zoom.textContent=Math.round(scale*100)+'%';};
  modal.append(el(document,'header',{},el(document,'h2',{text:input.title}),close),canvas,tools);document.body.append(modal);
  const dialog=modal,view=document.defaultView;
  // X consumes Escape before the native dialog cancel default can run.
  // Own the key only while this dialog is open; the reader stays active.
  const escape=event=>{if(event.key!=='Escape'||!dialog.isConnected||!dialog.open)return;event.preventDefault();event.stopImmediatePropagation();dialog.close();};
  view.addEventListener('keydown',escape,true);
  dialog.addEventListener('close',()=>{view.removeEventListener('keydown',escape,true);dialog.remove();if(modal===dialog)modal=null;if(prior?.isConnected)prior.focus();},{once:true});dialog.showModal();close.focus();
 }
 select(view);
 return {root,set(mode,state,value){states[mode]=state;if(state==='success'){results[mode]=value;delete errors[mode];}if(state==='error')errors[mode]=value;draw();},updatePreferences(value){prefs=value;draw();},destroy(){modal?.close();root.remove();onClose?.();},snapshot:()=>({view,states:{...states},results:{...results}})};
}
