import {el,button} from './dom.js';
import {clock,seekNative} from './content-source.js';
import {errorText} from './client.js';
import {createSourceSearch} from './source-search.js';
import {createMindmap} from './mindmap.js';
import {validPreview} from './preview.js';
import {icon} from './icons.js';
import {attachCommentViewport} from './comment-viewport.js';
const BUSY=new Set(['queued','loading','streaming']);
const SETTINGS_ERRORS=new Set(['CONTEXT_CHANGED','DISCONNECTED','NEEDS_INITIALIZATION','PERMISSION_REQUIRED','LOGIN_REQUIRED','VERIFICATION_REQUIRED','EXTENSION_UNAVAILABLE','CUSTOM_KEY_REQUIRED','CUSTOM_AUTH','CUSTOM_PERMISSION_REQUIRED','CUSTOM_REBIND_REQUIRED','CUSTOM_BINDING_INVALID','CUSTOM_BINDING_UNAVAILABLE','CUSTOM_MODEL_UNAVAILABLE','CUSTOM_ENDPOINT_NOT_FOUND','CUSTOM_REQUEST_REJECTED','CUSTOM_STREAM_UNSUPPORTED','CUSTOM_RULE_TIMEOUT','CUSTOM_RULE_CONFLICT','CUSTOM_RULE_CLEANUP_REQUIRED','CUSTOM_KEY_CLEANUP_REQUIRED','CUSTOM_ORIGIN_REJECTED']);
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
export function createCard({document,input,preferences,onRetry=()=>{},onSettings=()=>{},onClose,onSelect=()=>{},onStop=()=>{},onLanguage=()=>{},onPresentationChange=()=>{},onRender=()=>{}}){
 const win=document.defaultView;
 let prefs=preferences,view=input.kind==='article'?(prefs.summary?'article':'mindmap'):(prefs.summary&&prefs.mindmap?prefs.defaultView:prefs.summary?'summary':'mindmap'),collapsed=false,expanded=false,destroyed=false,copyTimer=null,language='zh-CN',frame=0;
 const results={},states={},errors={},drafts={},positions=new Map(),panels=new Map(),tabs=new Map(),contents=new Map(),pending=new Map();
 const allModes=input.kind==='article'?['article','mindmap']:['summary','mindmap'],modes=()=>allModes.filter(m=>m==='mindmap'?prefs.mindmap:prefs.summary);
 const root=el(document,'section',{id:'peek-ai-card','aria-label':'AI 阅读辅助'}),bar=el(document,'div',{class:'pk-ai-toolbar'}),tablist=el(document,'div',{class:'pk-ai-tabs',role:'tablist','aria-label':'AI 视图'}),body=el(document,'div',{class:'pk-ai-body',id:'pk-ai-body',tabindex:'0'}),footer=el(document,'footer',{class:'pk-ai-footer'}),status=el(document,'span',{'aria-live':'polite',role:'status'});
 let modal=null,modalMap=null;
 const searchIndex=createSourceSearch(input,document),searchPanel=el(document,'div',{class:'pk-ai-search-panel',hidden:true}),searchResults=el(document,'div',{class:'pk-ai-search-results'}),query=el(document,'input',{id:'pk-ai-search-input',type:'search',placeholder:input.kind==='video'?'搜索已读取字幕':'搜索当前原文','aria-label':'搜索当前内容',maxlength:200}),matchStatus=el(document,'span',{role:'status'});let matches=[],matchIndex=-1;
 const chooseMatch=index=>{if(!matches.length)return;matchIndex=(index+matches.length)%matches.length;if(!searchIndex.activate(matchIndex)){matches=[];matchIndex=-1;searchResults.replaceChildren();matchStatus.textContent='原文已变化，请重新打开阅读器';return;}matchStatus.textContent=`${matchIndex+1} / ${matches.length}${matches.length===500?'（最多显示 500 项）':''}`;};
 const search=button(document,'',()=>{searchPanel.hidden=!searchPanel.hidden;search.setAttribute('aria-expanded',String(!searchPanel.hidden));if(!searchPanel.hidden){query.focus();}else search.focus();},'pk-ai-tool');search.id='pk-ai-search';search.title=input.kind==='video'?'搜索字幕':'搜索原文';search.setAttribute('aria-label',search.title);search.setAttribute('aria-expanded','false');search.append(icon(document,'search'));
 query.addEventListener('input',()=>{matches=searchIndex.find(query.value);matchIndex=-1;searchResults.replaceChildren();matchStatus.textContent=!query.value?'仅搜索当前已读取内容':!searchIndex.valid()?'原文已变化，请重新打开阅读器':matches.length?`${matches.length} 条匹配`:'没有匹配内容';for(const [i,m] of matches.slice(0,50).entries())searchResults.append(button(document,(m.time!==undefined?clock(m.time)+'  ':'')+m.context,()=>chooseMatch(i),'pk-ai-search-result'));});
 query.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();chooseMatch(matchIndex+(e.shiftKey?-1:1));}if(e.key==='Escape'){e.stopPropagation();searchPanel.hidden=true;search.setAttribute('aria-expanded','false');search.focus();}});
 searchPanel.append(el(document,'div',{class:'pk-ai-search-row'},query,button(document,'↑',()=>chooseMatch(matchIndex-1)),button(document,'↓',()=>chooseMatch(matchIndex+1))),matchStatus,searchResults);
 searchPanel.querySelectorAll('button')[0].setAttribute('aria-label','上一条匹配');searchPanel.querySelectorAll('button')[1].setAttribute('aria-label','下一条匹配');
 const languagePanel=el(document,'div',{class:'pk-ai-language-panel',hidden:true}),languageButton=button(document,'',()=>{languagePanel.hidden=!languagePanel.hidden;languageButton.setAttribute('aria-expanded',String(!languagePanel.hidden));if(!languagePanel.hidden)languagePanel.querySelector(`[data-language="${language}"]`).focus();},'pk-ai-tool');languageButton.id='pk-ai-language';languageButton.title='输出语言';languageButton.setAttribute('aria-label','输出语言：简体中文');languageButton.setAttribute('aria-expanded','false');languageButton.append(icon(document,'language'));
 for(const [value,label] of [['zh-CN','简体中文'],['en','English']]){const b=button(document,label,()=>{languagePanel.hidden=true;languageButton.setAttribute('aria-expanded','false');languageButton.focus();if(value!==language){resetLanguage(value);onLanguage(value);}});b.id='pk-ai-language-'+value;b.dataset.language=value;b.setAttribute('aria-pressed',String(value===language));languagePanel.append(b);}languagePanel.append(el(document,'small',{text:'切换后生成对应语言结果'}));
 languagePanel.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();languagePanel.hidden=true;languageButton.setAttribute('aria-expanded','false');languageButton.focus();}});
 const fold=button(document,'收起 AI 辅助',()=>{collapsed=!collapsed;geometry();onPresentationChange();},'pk-ai-icon');fold.id='pk-ai-fold';fold.setAttribute('aria-expanded','true');fold.setAttribute('aria-controls',body.id);
 const expand=button(document,'展开阅读',()=>{expanded=!expanded;collapsed=false;geometry();onPresentationChange();},'pk-ai-icon');expand.id='pk-ai-expand';
 const stop=button(document,'停止',onStop,'pk-ai-icon');stop.id='pk-ai-stop';stop.setAttribute('aria-label','停止本帖生成');
 for(const mode of allModes){
  const panel=el(document,'div',{class:'pk-ai-view',role:'tabpanel',id:'pk-ai-view-'+mode});panel.hidden=true;panels.set(mode,panel);body.append(panel);
  const label=mode==='mindmap'?'脑图':'摘要',tab=button(document,'',()=>select(mode),'pk-ai-tab');tab.append(icon(document,mode==='mindmap'?'mindmap':input.kind==='video'?'video':'article'),el(document,'span',{class:'pk-ai-tab-label',text:label}));tab.id='pk-ai-tab-'+mode;tab.title=label;tab.setAttribute('aria-label',label);tab.setAttribute('role','tab');tab.setAttribute('aria-controls',panel.id);panel.setAttribute('aria-labelledby',tab.id);
  tab.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const enabled=modes(),next=enabled[(enabled.indexOf(view)+(e.key==='ArrowRight'?1:enabled.length-1))%enabled.length];select(next);tabs.get(next)?.focus();});tabs.set(mode,tab);tablist.append(tab);
 }
 bar.append(el(document,'span',{class:'pk-ai-heading',text:input.kind==='video'?'视频解读':'长文解读'}),search,languageButton,tablist);
 const copyLabel=()=>view==='mindmap'?'复制大纲':'复制',copy=button(document,'复制',async()=>{try{const data=results[view]||drafts[view],text=view==='mindmap'?treeOutline(data?.tree||[]):data?.text||'';await (win.navigator.clipboard||globalThis.navigator?.clipboard).writeText((results[view]?'':'未完成\n')+text);if(destroyed)return;copy.textContent='已复制';clearTimeout(copyTimer);copyTimer=setTimeout(()=>copy.textContent=copyLabel(),1500);}catch{if(!destroyed)copy.textContent='复制失败';}},'pk-ai-icon');
 footer.append(el(document,'span',{text:'AI 生成 · 请结合原文阅读'}),copy,expand,fold);root.append(bar,languagePanel,searchPanel,el(document,'div',{class:'pk-ai-progress'},status,stop),body,footer);
 function geometry(){
  const available=win.innerHeight-68-8-160-16;if(available<180)collapsed=true;
  const height=collapsed?68:Math.max(68,Math.min(expanded?560:320,available));root.style.height=height+'px';root.classList.toggle('pk-ai-collapsed',collapsed);root.dataset.size=collapsed?'collapsed':expanded?'expanded':'overview';fold.textContent=collapsed?'展开 AI 辅助':'收起 AI 辅助';fold.setAttribute('aria-expanded',String(!collapsed));expand.textContent=expanded?'返回概览':'展开阅读';document.documentElement.style.setProperty('--peek-ai-space',`calc(${height}px + var(--peek-reader-gap, 8px))`);
 }
 function chrome(){
  const enabled=modes();root.hidden=!enabled.length;
  for(const [key,tab] of tabs){tab.hidden=!enabled.includes(key);tab.setAttribute('aria-selected',String(key===view));tab.tabIndex=key===view?0:-1;}
  const running=enabled.find(m=>BUSY.has(states[m])),name=running==='mindmap'?'脑图':'摘要';const label=running?(states[running]==='queued'?`${name}排队中…`:`正在生成${name} · 未完成`):states[view]==='success'?(view==='mindmap'?'脑图':'摘要')+'已完成':states[view]==='error'?(errors[view]==='CANCELLED'?'已停止，未完成内容不会保存':'生成失败，请查看恢复操作'):'选择此视图后生成';if(status.textContent!==label)status.textContent=label;
  stop.hidden=!running;copy.disabled=!results[view]&&!drafts[view];copy.textContent=copyLabel();const result=results[view],source=result?(result.providerName||'豆包'):null;
  footer.firstElementChild.textContent=(source?`AI · ${source} · ${result.cacheWarning?'本次结果未能缓存':'请结合原文阅读'}`:'AI 生成 · 请结合原文阅读')+(input.kind==='video'&&input.completion==='available-cues-snapshot'?' · 基于当前可用字幕':'');
 }
 function select(mode,notify=true){if(destroyed||!modes().includes(mode))return;positions.set(view,{top:body.scrollTop,left:body.scrollLeft});view=mode;for(const [key,panel] of panels)panel.hidden=key!==view;const position=positions.get(view);body.scrollTop=position?.top||0;body.scrollLeft=position?.left||0;chrome();const map=contents.get(mode)?.map;if(map)map.update((results[mode]||drafts[mode])?.tree||[]);if(notify){onPresentationChange();onSelect(mode);}}
 function contentFor(mode){
  let c=contents.get(mode);if(c)return c;const panel=panels.get(mode);panel.replaceChildren();const note=el(document,'p',{class:'pk-ai-muted'}),text=el(document,'div',{class:'pk-ai-draft'}),timeline=el(document,'div',{class:'pk-ai-timeline'}),error=el(document,'div',{class:'pk-ai-error'});c={note,text,timeline,error,chapters:new Map(),map:null};
  panel.append(note,text);if(mode==='mindmap'){c.map=createMindmap(document);const tools=el(document,'div',{class:'pk-ai-map-inline-tools'},button(document,'−',()=>c.map.zoom(-.1)),button(document,'＋',()=>c.map.zoom(.1)),button(document,'适应',()=>c.map.fit()),button(document,'展开 ↗',()=>openMap(),'pk-ai-link'));tools.children[0].setAttribute('aria-label','缩小脑图');tools.children[1].setAttribute('aria-label','放大脑图');panel.append(error,c.map.root,tools);}else panel.append(timeline,error);contents.set(mode,c);return c;
 }
 function render(mode){
  const panel=panels.get(mode),hadFocus=panel.contains(document.activeElement),data=results[mode]||drafts[mode],top=body.scrollTop,left=body.scrollLeft;
  panel.dataset.state=states[mode]||'waiting';
  if(data){const c=contentFor(mode);c.note.textContent=results[mode]?'':'未完成 · 请等待完整结果后核对';c.note.hidden=!!results[mode];if(c.text.textContent!==data.text)c.text.textContent=data.text||'';c.text.hidden=mode==='mindmap';
   if(c.map){c.map.update(data.tree||[]);modalMap?.update(data.tree||[]);}
   else{c.timeline.hidden=mode!=='summary'||!prefs.timeline;const seen=new Set();for(const [i,h] of (data.highlights||[]).entries()){
    const key=String(i);seen.add(key);let item=c.chapters.get(key);
    if(!item){const details=el(document,'details',{class:'pk-ai-chapter'}),label=el(document,'summary'),seek=button(document,'',e=>{e.preventDefault();e.stopPropagation();seekNative(input.video,item.data.timestamp);},'pk-ai-time'),title=el(document,'span'),points=el(document,'div');label.append(seek,title,el(document,'span',{class:'pk-ai-expand',text:'展开要点'}));details.append(label,points);c.timeline.append(details);item={details,seek,title,points,data:h};c.chapters.set(key,item);}
    item.data=h;item.details.hidden=false;item.seek.textContent=clock(h.timestamp/1000);item.title.textContent=h.chapter||h.title||'章节';item.details.dataset.timestamp=String(h.timestamp);
    const points=h.bullet_points||[];for(let j=0;j<points.length;j++){let b=item.points.children[j];if(!b){b=button(document,'',()=>seekNative(input.video,item.data.bullet_points[j].timestamp),'pk-ai-point');item.points.append(b);}b.textContent=`${clock(points[j].timestamp/1000)}  ${points[j].point||points[j].text||''}`;}while(item.points.children.length>points.length)item.points.lastChild.remove();
   }for(const [key,item] of c.chapters)item.details.hidden=!seen.has(key);}
   c.error.replaceChildren();if(states[mode]==='error')renderError(c.error,mode);
  }else{contents.get(mode)?.map?.destroy();contents.delete(mode);panel.replaceChildren();if(states[mode]==='error'){const error=el(document,'div',{class:'pk-ai-error'});panel.append(error);renderError(error,mode);}else panel.append(el(document,'p',{text:states[mode]==='queued'?'正在排队…':BUSY.has(states[mode])?'正在整理内容…':'选择此视图后生成'}),el(document,'p',{class:'pk-ai-muted',text:'可以继续播放视频或阅读评论'}));}
  body.scrollTop=top;body.scrollLeft=left;if(hadFocus&&document.activeElement===document.body)tabs.get(view)?.focus({preventScroll:true});
 }
 function renderError(parent,mode){parent.append(el(document,'p',{text:errorText(errors[mode])}));parent.append(SETTINGS_ERRORS.has(errors[mode])?button(document,errors[mode].startsWith('CUSTOM_')?'编辑服务':'前往设置',onSettings,'pk-ai-link'):button(document,'重试'+(mode==='mindmap'?'脑图':'摘要'),()=>onRetry(mode)));}
 function openMap(){if(modal||destroyed)return;const prior=document.activeElement;modal=el(document,'dialog',{class:'pk-ai-map-dialog','aria-label':'展开思维导图'});modalMap=createMindmap(document);const close=button(document,'返回阅读 ×',()=>modal.close()),tools=el(document,'div',{class:'pk-ai-map-tools'},button(document,'缩小',()=>modalMap.zoom(-.1)),button(document,'放大',()=>modalMap.zoom(.1)),button(document,'适应',()=>modalMap.fit()));modal.append(el(document,'header',{},el(document,'h2',{text:input.title}),close),modalMap.root,tools);document.body.append(modal);const dialog=modal,escape=e=>{if(e.key==='Escape'&&dialog.open){e.preventDefault();e.stopImmediatePropagation();dialog.close();}};win.addEventListener('keydown',escape,true);dialog.addEventListener('close',()=>{win.removeEventListener('keydown',escape,true);modalMap?.destroy();modalMap=null;dialog.remove();modal=null;if(!destroyed&&prior?.isConnected)prior.focus({preventScroll:true});},{once:true});dialog.showModal();modalMap.update((results.mindmap||drafts.mindmap)?.tree||[]);close.focus();}
 function resetLanguage(value){if(!['zh-CN','en'].includes(value))return;language=value;modal?.close();pending.clear();for(const object of [results,drafts,states,errors])for(const key of Object.keys(object))delete object[key];for(const c of contents.values())c.map?.destroy();contents.clear();positions.clear();for(const mode of allModes)render(mode);for(const b of languagePanel.querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.language===value));languageButton.setAttribute('aria-label','输出语言：'+(value==='en'?'English':'简体中文'));chrome();}
 function flushProgress(){if(frame){(win.cancelAnimationFrame||win.clearTimeout).call(win,frame);frame=0;}if(destroyed)return;for(const [mode,data] of pending){if(BUSY.has(states[mode])){const started=win.performance.now();drafts[mode]=data;states[mode]='streaming';render(mode);if(mode==='mindmap'?data.tree?.length:data.text||data.highlights?.length)onRender(win.performance.now()-started,mode);}}pending.clear();chrome();}
 const playback=()=>{const chapters=[...root.querySelectorAll('.pk-ai-chapter')],time=(input.video?.currentTime||0)*1000;let current=null;for(const c of chapters)if(Number(c.dataset.timestamp)<=time)current=c;for(const c of chapters){if(c===current)c.setAttribute('aria-current','true');else c.removeAttribute('aria-current');}};
 input.video?.addEventListener?.('timeupdate',playback);win.addEventListener('resize',geometry);for(const mode of allModes)render(mode);select(view,false);geometry();const releaseViewport=attachCommentViewport(document,root);
 return {root,flushProgress,resetLanguage,
  set(mode,state,value){if(destroyed||!panels.has(mode))return;flushProgress();states[mode]=state;if(state==='success'){results[mode]=value;delete errors[mode];delete drafts[mode];}else{delete results[mode];if(state==='error'){errors[mode]=value;}else{delete drafts[mode];}}const started=win.performance.now();render(mode);chrome();if(state==='success')onRender(win.performance.now()-started,mode);},
  progress(mode,text,preview){if(destroyed||!panels.has(mode)||!BUSY.has(states[mode])||typeof text!=='string'||text.length>12000)return;if(preview&&!validPreview(preview,language))return;pending.set(mode,preview||{text,tree:[],highlights:[]});if(!frame)frame=(win.requestAnimationFrame||((fn)=>win.setTimeout(fn,16))).call(win,flushProgress);},
  stop(){flushProgress();for(const mode of modes())if(states[mode]!=='success')this.set(mode,'error','CANCELLED');},
  updatePreferences(value){prefs=value;for(const mode of allModes)if(!modes().includes(mode)&&BUSY.has(states[mode])){states[mode]='waiting';pending.delete(mode);render(mode);}const timeline=contents.get('summary')?.timeline;if(timeline)timeline.hidden=!prefs.timeline;if(!prefs.mindmap)modal?.close();if(!modes().includes(view)&&modes().length)select(modes()[0]);chrome();},
  destroy(){if(destroyed)return;destroyed=true;releaseViewport();clearTimeout(copyTimer);if(frame)(win.cancelAnimationFrame||win.clearTimeout).call(win,frame);modal?.close();for(const c of contents.values())c.map?.destroy();searchIndex.destroy();input.video?.removeEventListener?.('timeupdate',playback);win.removeEventListener('resize',geometry);root.remove();pending.clear();onClose?.();},
  snapshot:()=>({view,outputLanguage:language,states:{...states},results:{...results}})
 };
}
