import {el,button} from './dom.js';
import {clock,seekNative} from './content-source.js';
import {errorText} from './client.js';
import {attachCommentViewport} from './comment-viewport.js';
const BUSY=new Set(['queued','loading','streaming']);
const SETTINGS_ERRORS=new Set(['CONTEXT_CHANGED','DISCONNECTED','NEEDS_INITIALIZATION','PERMISSION_REQUIRED','LOGIN_REQUIRED','VERIFICATION_REQUIRED','EXTENSION_UNAVAILABLE','CUSTOM_KEY_REQUIRED','CUSTOM_AUTH','CUSTOM_PERMISSION_REQUIRED','CUSTOM_REBIND_REQUIRED','CUSTOM_BINDING_INVALID','CUSTOM_BINDING_UNAVAILABLE','CUSTOM_MODEL_UNAVAILABLE','CUSTOM_ENDPOINT_NOT_FOUND','CUSTOM_REQUEST_REJECTED','CUSTOM_INVALID_RESPONSE','CUSTOM_STREAM_UNSUPPORTED','CUSTOM_RULE_TIMEOUT','CUSTOM_RULE_CONFLICT','CUSTOM_RULE_CLEANUP_REQUIRED','CUSTOM_KEY_CLEANUP_REQUIRED','CUSTOM_ORIGIN_REJECTED']);
export const treeOutline=(tree,depth=0)=>tree.map(n=>'  '.repeat(depth)+'- '+n.text+(n.children.length?'\n'+treeOutline(n.children,depth+1):'')).join('\n');
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
export function createCard({document,input,preferences,onRetry,onSettings,onClose,onSelect=()=>{},onStop=()=>{},onPresentationChange=()=>{}}){
 let prefs=preferences,view=input.kind==='article'?'article':(prefs.summary&&prefs.mindmap?prefs.defaultView:prefs.summary?'summary':'mindmap'),collapsed=false,destroyed=false,copyTimer=null;
 const results={},states={},errors={},drafts={},positions=new Map(),panels=new Map(),tabs=new Map();
 const allModes=input.kind==='article'?['article']:['summary','mindmap'];
 const modes=()=>allModes.filter(m=>m==='mindmap'?prefs.mindmap:prefs.summary);
 const root=el(document,'section',{id:'peek-ai-card','aria-label':'AI 阅读辅助'}),bar=el(document,'div',{class:'pk-ai-tabs','role':'tablist','aria-label':'AI 视图'}),body=el(document,'div',{class:'pk-ai-body',id:'pk-ai-body',tabindex:'0'}),footer=el(document,'footer',{class:'pk-ai-footer'}),status=el(document,'span',{'aria-live':'polite',role:'status'});
 let announcement='';
 const fold=button(document,'收起 AI 辅助',()=>{collapsed=!collapsed;root.classList.toggle('pk-ai-collapsed',collapsed);fold.textContent=collapsed?'展开 AI 辅助':'收起 AI 辅助';fold.setAttribute('aria-expanded',String(!collapsed));root.style.height=collapsed?'68px':'';document.documentElement.style.setProperty('--peek-ai-space',collapsed?'calc(68px + var(--peek-reader-gap, 8px))':'calc(min(44vh, 420px) + var(--peek-reader-gap, 8px))');onPresentationChange();},'pk-ai-icon');
 fold.id='pk-ai-fold';fold.setAttribute('aria-expanded','true');fold.setAttribute('aria-controls',body.id);
 const stop=button(document,'停止',onStop,'pk-ai-icon');stop.id='pk-ai-stop';stop.setAttribute('aria-label','停止本帖生成');
 for(const mode of allModes){
  const panel=el(document,'div',{class:'pk-ai-view',role:'tabpanel',id:'pk-ai-view-'+mode});panel.hidden=true;panels.set(mode,panel);body.append(panel);
  const tab=button(document,mode==='mindmap'?'思维导图':'摘要',()=>select(mode),'pk-ai-tab');tab.id='pk-ai-tab-'+mode;tab.setAttribute('role','tab');tab.setAttribute('aria-controls',panel.id);panel.setAttribute('aria-labelledby',tab.id);
  tab.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const enabled=modes(),next=enabled[(enabled.indexOf(view)+(e.key==='ArrowRight'?1:enabled.length-1))%enabled.length];select(next);tabs.get(next)?.focus();});tabs.set(mode,tab);bar.append(tab);
 }
 bar.append(el(document,'span',{class:'pk-ai-spacer'}),status,stop,fold);
 const copyLabel=()=>view==='mindmap'?'复制大纲':'复制';
 const copy=button(document,'复制',async()=>{try{await navigator.clipboard.writeText(view==='mindmap'?treeOutline(results[view]?.tree||[]):results[view]?.text||'');if(destroyed)return;copy.textContent='已复制';clearTimeout(copyTimer);copyTimer=setTimeout(()=>{copy.textContent=copyLabel();},1500);}catch{if(!destroyed)copy.textContent='复制失败';}},'pk-ai-icon');
 footer.append(el(document,'span',{text:'AI 生成 · 请结合原文阅读'}),copy);root.append(bar,body,footer);
 function chrome(){
  const enabled=modes();root.hidden=!enabled.length;
  for(const [key,tab] of tabs){tab.hidden=!enabled.includes(key);tab.setAttribute('aria-selected',String(key===view));tab.tabIndex=key===view?0:-1;}
  const running=enabled.find(m=>BUSY.has(states[m])),name=running==='mindmap'?'脑图':'摘要';
  const label=running?(states[running]==='queued'?`${name}排队中…`:`正在生成${name}…`):announcement;
  if(status.textContent!==label)status.textContent=label;
  stop.hidden=!running;copy.disabled=!results[view];copy.textContent=copyLabel();
  const result=results[view],source=result?(result.providerName||'豆包'):null;
  const scope=input.kind==='video'&&input.completion==='available-cues-snapshot'?' · 基于当前可用字幕':'';
  footer.firstElementChild.textContent=(source?`AI · ${source} · ${result.cacheWarning?'本次结果未能缓存':'请结合原文阅读'}`:'AI 生成 · 请结合原文阅读')+scope;
 }
 function select(mode,notify=true){
  if(destroyed||!modes().includes(mode))return;
  positions.set(view,{top:body.scrollTop,left:body.scrollLeft});view=mode;
  for(const [key,panel] of panels)panel.hidden=key!==view;
  const position=positions.get(view);body.scrollTop=position?.top||0;body.scrollLeft=position?.left||0;chrome();if(notify){onPresentationChange();onSelect(mode);}
 }
 function render(mode){
  const panel=panels.get(mode),hadFocus=panel.contains(document.activeElement);panel.replaceChildren();const result=results[mode];
  if(!result&&drafts[mode])panel.append(el(document,'p',{class:'pk-ai-muted',text:'未完成 · 请等待完整结果后核对'}),el(document,'div',{class:'pk-ai-draft',text:drafts[mode]}));
  if(result){
   if(mode==='mindmap')panel.append(button(document,'展开 ↗',()=>openMap(result.tree),'pk-ai-link'),renderTree(document,result.tree));
   else{
    panel.append(renderSummary(document,result.text));
    if(mode==='summary'&&result.highlights.length){
     const timeline=el(document,'div',{class:'pk-ai-timeline'});timeline.hidden=!prefs.timeline;timeline.append(el(document,'h3',{text:'章节速览'}));
     for(const h of result.highlights){const details=el(document,'details',{class:'pk-ai-chapter'}),label=el(document,'summary');
      const seek=button(document,clock(h.timestamp/1000),event=>{event.preventDefault();event.stopPropagation();seekNative(input.video,h.timestamp);},'pk-ai-time');label.append(seek,el(document,'span',{text:h.chapter||h.title||'章节'}),el(document,'span',{class:'pk-ai-expand',text:'展开要点'}));details.append(label);
      for(const point of h.bullet_points||[])details.append(button(document,`${clock(point.timestamp/1000)}  ${point.point||point.text||''}`,()=>seekNative(input.video,point.timestamp),'pk-ai-point'));timeline.append(details);
     }panel.append(timeline);
    }
   }
  }else if(states[mode]==='error'){
   panel.append(el(document,'p',{text:errorText(errors[mode])}));
   if(SETTINGS_ERRORS.has(errors[mode]))panel.append(button(document,errors[mode].startsWith('CUSTOM_')?'编辑服务':'前往设置',onSettings,'pk-ai-link'));
   else panel.append(button(document,'重试'+(mode==='mindmap'?'脑图':'摘要'),()=>onRetry(mode)));
  }else if(!drafts[mode])panel.append(el(document,'p',{text:states[mode]==='queued'?'正在排队…':BUSY.has(states[mode])?'正在整理内容…':'选择此视图后生成'}),el(document,'p',{class:'pk-ai-muted',text:'可以继续播放视频或阅读评论'}));
  if(hadFocus&&document.activeElement===document.body)tabs.get(view)?.focus({preventScroll:true});
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
 for(const mode of allModes)render(mode);select(view,false);
 const releaseViewport=attachCommentViewport(document,root);
 return {
  root,
  set(mode,state,value){if(destroyed||!panels.has(mode))return;const reading=drafts[mode]&&['success','error'].includes(state)?(mode===view?{top:body.scrollTop,left:body.scrollLeft}:positions.get(mode)):null;states[mode]=state;if(mode==='mindmap')modal?.close();if(state==='success'){results[mode]=value;delete errors[mode];delete drafts[mode];announcement=(mode==='mindmap'?'脑图':'摘要')+'已完成';}else{delete results[mode];if(state==='error'){errors[mode]=value;announcement=value==='CANCELLED'?'已停止，未完成内容不会保存':'生成失败，请查看恢复操作';}else{delete drafts[mode];announcement='';}}render(mode);if(reading){positions.set(mode,reading);if(mode===view){body.scrollTop=reading.top;body.scrollLeft=reading.left;}}chrome();},
  progress(mode,text){if(destroyed||!panels.has(mode)||!BUSY.has(states[mode])||typeof text!=='string'||text.length>12000)return;drafts[mode]=text;states[mode]='streaming';const panel=panels.get(mode);let node=panel.querySelector('.pk-ai-draft');if(!node){const top=body.scrollTop,left=body.scrollLeft;render(mode);body.scrollTop=top;body.scrollLeft=left;node=panel.querySelector('.pk-ai-draft');}if(node&&node.textContent!==text)node.textContent=text;chrome();},
  stop(){for(const mode of modes())if(states[mode]!=='success')this.set(mode,'error','CANCELLED');},
  updatePreferences(value){if(destroyed)return;prefs=value;for(const mode of allModes)if(!modes().includes(mode)&&BUSY.has(states[mode])){states[mode]='waiting';render(mode);}const timeline=panels.get('summary')?.querySelector('.pk-ai-timeline');if(timeline)timeline.hidden=!prefs.timeline;if(!prefs.mindmap)modal?.close();if(!modes().includes(view)&&modes().length)select(modes()[0]);chrome();},
  destroy(){if(destroyed)return;destroyed=true;releaseViewport();clearTimeout(copyTimer);modal?.close();root.remove();positions.clear();panels.clear();tabs.clear();for(const value of [results,states,errors,drafts])for(const key of Object.keys(value))delete value[key];onClose?.();},
  snapshot:()=>({view,states:{...states},results:{...results}})
 };
}
