import {el,button} from './dom.js';
import {clock,seekNative} from './content-source.js';
import {errorText} from './client.js';
import {attachCommentViewport} from './comment-viewport.js';
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
 let prefs=preferences,view=input.kind==='article'?'article':(prefs.summary&&prefs.mindmap?prefs.defaultView:prefs.summary?'summary':'mindmap'),collapsed=false,destroyed=false,copyTimer=null;
 const results={},states={},errors={},positions=new Map(),panels=new Map(),tabs=new Map();
 const allModes=input.kind==='article'?['article']:['summary','mindmap'];
 const modes=()=>allModes.filter(m=>m==='mindmap'?prefs.mindmap:prefs.summary);
 const root=el(document,'section',{id:'peek-ai-card','aria-label':'AI 阅读辅助'}),bar=el(document,'div',{class:'pk-ai-tabs','role':'tablist','aria-label':'AI 视图'}),body=el(document,'div',{class:'pk-ai-body',tabindex:'0'}),footer=el(document,'footer',{class:'pk-ai-footer'}),status=el(document,'span',{'aria-live':'polite'});
 const fold=button(document,'收起摘要',()=>{collapsed=!collapsed;root.classList.toggle('pk-ai-collapsed',collapsed);fold.textContent=collapsed?'展开摘要':'收起摘要';root.style.height=collapsed?'68px':'';document.documentElement.style.setProperty('--peek-ai-space',collapsed?'calc(68px + var(--peek-reader-gap, 8px))':'calc(min(44vh, 420px) + var(--peek-reader-gap, 8px))');},'pk-ai-icon');
 for(const mode of allModes){
  const panel=el(document,'div',{class:'pk-ai-view',role:'tabpanel',id:'pk-ai-view-'+mode});panel.hidden=true;panels.set(mode,panel);body.append(panel);
  const tab=button(document,mode==='mindmap'?'思维导图':'Summary',()=>select(mode),'pk-ai-tab');tab.id='pk-ai-tab-'+mode;tab.setAttribute('role','tab');tab.setAttribute('aria-controls',panel.id);panel.setAttribute('aria-labelledby',tab.id);
  tab.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const enabled=modes(),next=enabled[(enabled.indexOf(view)+(e.key==='ArrowRight'?1:enabled.length-1))%enabled.length];select(next);tabs.get(next)?.focus();});tabs.set(mode,tab);bar.append(tab);
 }
 bar.append(el(document,'span',{class:'pk-ai-spacer'}),status,fold);
 const copy=button(document,'复制',async()=>{try{await navigator.clipboard.writeText(results[view]?.text||'');if(destroyed)return;copy.textContent='已复制';clearTimeout(copyTimer);copyTimer=setTimeout(()=>{copy.textContent='复制';},1500);}catch{if(!destroyed)copy.textContent='复制失败';}},'pk-ai-icon');
 footer.append(el(document,'span',{text:'AI 生成 · 请结合原文阅读'}),copy);root.append(bar,body,footer);
 function chrome(){
  const enabled=modes();root.hidden=!enabled.length;
  for(const [key,tab] of tabs){tab.hidden=!enabled.includes(key);tab.setAttribute('aria-selected',String(key===view));tab.tabIndex=key===view?0:-1;}
  status.textContent=enabled.some(m=>states[m]==='loading')?'正在生成…':'';
  copy.disabled=!results[view];const result=results[view],source=result?(result.providerName||'豆包'):null;footer.firstElementChild.textContent=source?`AI · ${source} · ${result.cacheWarning?'本次结果未能缓存':'请结合原文阅读'}`:'AI 生成 · 请结合原文阅读';
 }
 function select(mode){
  if(destroyed||!modes().includes(mode))return;
  positions.set(view,{top:body.scrollTop,left:body.scrollLeft});view=mode;
  for(const [key,panel] of panels)panel.hidden=key!==view;
  const position=positions.get(view);body.scrollTop=position?.top||0;body.scrollLeft=position?.left||0;chrome();
 }
 function render(mode){
  const panel=panels.get(mode);panel.replaceChildren();const result=results[mode];
  if(result){
   if(mode==='mindmap')panel.append(button(document,'展开 ↗',()=>openMap(result.tree),'pk-ai-link'),renderTree(document,result.tree));
   else{
    panel.append(renderSummary(document,result.text));
    if(mode==='summary'&&result.highlights.length){
     const timeline=el(document,'div',{class:'pk-ai-timeline'});timeline.hidden=!prefs.timeline;timeline.append(el(document,'h3',{text:'章节速览'}));
     for(const h of result.highlights){const details=el(document,'details',{class:'pk-ai-chapter'}),label=el(document,'summary');
      const seek=button(document,clock(h.timestamp/1000),()=>seekNative(input.video,h.timestamp),'pk-ai-time');label.append(seek,el(document,'span',{text:h.chapter||h.title||'章节'}));details.append(label);
      for(const point of h.bullet_points||[])details.append(button(document,`${clock(point.timestamp/1000)}  ${point.point||point.text||''}`,()=>seekNative(input.video,point.timestamp),'pk-ai-point'));timeline.append(details);
     }panel.append(timeline);
    }
   }
  }else if(states[mode]==='error'){
   panel.append(el(document,'p',{text:errorText(errors[mode])}),button(document,'重试'+(mode==='mindmap'?'脑图':'摘要'),()=>onRetry(mode)));
   if(['CONTEXT_CHANGED','DISCONNECTED','NEEDS_INITIALIZATION','PERMISSION_REQUIRED','LOGIN_REQUIRED','VERIFICATION_REQUIRED','EXTENSION_UNAVAILABLE'].includes(errors[mode]))panel.append(button(document,'前往设置',onSettings,'pk-ai-link'));
  }else panel.append(el(document,'p',{text:states[mode]==='loading'?'正在整理内容…':'等待生成…'}),el(document,'p',{class:'pk-ai-muted',text:'可以继续播放视频或阅读评论'}));
  positions.set(mode,{top:0,left:0});if(mode===view){body.scrollTop=0;body.scrollLeft=0;}
 }
 let modal=null;
 function openMap(tree){
  if(modal||destroyed)return;const prior=document.activeElement;let scale=1;
  modal=el(document,'dialog',{class:'pk-ai-map-dialog','aria-label':'展开思维导图'});
  const canvas=el(document,'div',{class:'pk-ai-map-canvas'},renderTree(document,tree)),zoom=el(document,'span',{text:'100%'}),close=button(document,'返回阅读 ×',()=>modal.close());
  const tools=el(document,'div',{class:'pk-ai-map-tools'},button(document,'缩小',()=>apply(-.1)),zoom,button(document,'放大',()=>apply(.1)),button(document,'适应',()=>{const graph=canvas.firstElementChild;const width=graph.getBoundingClientRect().width/scale,height=graph.getBoundingClientRect().height/scale;scale=Math.min(1,(canvas.clientWidth-36)/width,(document.defaultView.innerHeight*.58)/height);apply(0);}));
  const apply=delta=>{scale=Math.max(.15,Math.min(2,scale+delta));canvas.firstElementChild.style.zoom=String(scale);zoom.textContent=Math.round(scale*100)+'%';};
  modal.append(el(document,'header',{},el(document,'h2',{text:input.title}),close),canvas,tools);document.body.append(modal);
  const dialog=modal,win=document.defaultView;
  const escape=event=>{if(event.key!=='Escape'||!dialog.isConnected||!dialog.open)return;event.preventDefault();event.stopImmediatePropagation();dialog.close();};
  win.addEventListener('keydown',escape,true);
  dialog.addEventListener('close',()=>{win.removeEventListener('keydown',escape,true);dialog.remove();if(modal===dialog)modal=null;if(!destroyed&&prior?.isConnected)prior.focus();},{once:true});dialog.showModal();close.focus();
 }
 for(const mode of allModes)render(mode);select(view);
 const releaseViewport=attachCommentViewport(document,root);
 return {
  root,
  set(mode,state,value){if(destroyed||!panels.has(mode))return;states[mode]=state;if(mode==='mindmap')modal?.close();if(state==='success'){results[mode]=value;delete errors[mode];}else{delete results[mode];if(state==='error')errors[mode]=value;}render(mode);chrome();},
  updatePreferences(value){if(destroyed)return;prefs=value;for(const mode of allModes)if(!modes().includes(mode)&&states[mode]==='loading'){states[mode]='waiting';render(mode);}const timeline=panels.get('summary')?.querySelector('.pk-ai-timeline');if(timeline)timeline.hidden=!prefs.timeline;if(!prefs.mindmap)modal?.close();if(!modes().includes(view)&&modes().length)select(modes()[0]);chrome();},
  destroy(){if(destroyed)return;destroyed=true;releaseViewport();clearTimeout(copyTimer);modal?.close();root.remove();positions.clear();panels.clear();tabs.clear();for(const value of [results,states,errors])for(const key of Object.keys(value))delete value[key];onClose?.();},
  snapshot:()=>({view,states:{...states},results:{...results}})
 };
}
