import {taskProgressEvent} from './generation-progress.js';
import {t,setUILanguage,localizeUI,format} from '../i18n.js';
import {renderMarkdown} from './markdown.js';
import {el,button} from './dom.js';
import {clock,seekNative} from './content-source.js';
import {errorText} from './client.js';
import {createSourceSearch} from './source-search.js';
import {createMindmap,initialExpandedDepth} from './mindmap.js';
import {validPreview} from './preview.js';
import {icon} from './icons.js';
const BUSY=new Set(['queued','loading','streaming']);
const SETTINGS_ERRORS=new Set(['CUSTOM_INVALID_CONTEXT','CUSTOM_CONTEXT_BUDGET','CUSTOM_LONG_CONTENT_LIMIT','CUSTOM_INPUT_TOO_LONG','AI_NOT_CONFIGURED','DOUBAO_UNAVAILABLE','BRIDGE_UNAVAILABLE','BRIDGE_CLOSED','BRIDGE_CHANGED','BRIDGE_RELOAD_REQUIRED','BRIDGE_INCOMPATIBLE','BRIDGE_NATIVE_ERROR','CONTEXT_CHANGED','DISCONNECTED','NEEDS_INITIALIZATION','PERMISSION_REQUIRED','LOGIN_REQUIRED','VERIFICATION_REQUIRED','EXTENSION_UNAVAILABLE','CUSTOM_KEY_REQUIRED','CUSTOM_AUTH','CUSTOM_PERMISSION_REQUIRED','CUSTOM_REBIND_REQUIRED','CUSTOM_BINDING_INVALID','CUSTOM_BINDING_UNAVAILABLE','CUSTOM_MODEL_UNAVAILABLE','CUSTOM_ENDPOINT_NOT_FOUND','CUSTOM_REQUEST_REJECTED','CUSTOM_STREAM_UNSUPPORTED','CUSTOM_RULE_TIMEOUT','CUSTOM_RULE_CONFLICT','CUSTOM_RULE_CLEANUP_REQUIRED','CUSTOM_KEY_CLEANUP_REQUIRED','CUSTOM_ORIGIN_REJECTED']);
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
export function createCard({document,input,preferences,onRetry=()=>{},onSettings=()=>{},onClose,onSelect=()=>{},onStop=()=>{},onLanguage=()=>{},onPresentationChange=()=>{},onRender=()=>{}}){
 setUILanguage(preferences.uiLanguage);
 const win=document.defaultView;
 let prefs=preferences,view=input.kind==='article'?(prefs.summary?'article':'mindmap'):(prefs.summary&&prefs.mindmap?prefs.defaultView:prefs.summary?'summary':'mindmap'),collapsed=false,expanded=false,destroyed=false,copyTimer=null,language=preferences.outputLanguage||'en',frame=0;
 const results={},states={},errors={},drafts={},tasks={},positions=new Map(),panels=new Map(),tabs=new Map(),contents=new Map(),pending=new Map();
 const allModes=input.kind==='article'?['article','mindmap']:['summary','mindmap'],modes=()=>allModes.filter(m=>m==='mindmap'?prefs.mindmap:prefs.summary);
 const root=el(document,'section',{id:'peek-ai-card','aria-label':t("AI 阅读辅助")}),bar=el(document,'div',{class:'pk-ai-toolbar'}),tablist=el(document,'div',{class:'pk-ai-tabs',role:'tablist','aria-label':t("AI 视图")}),body=el(document,'div',{class:'pk-ai-body',id:'pk-ai-body',tabindex:'0'}),footer=el(document,'footer',{class:'pk-ai-footer'}),status=el(document,'span',{'aria-live':'polite',role:'status'});
 const taskInfo=el(document,'div',{id:'pk-ai-task-progress',class:'pk-ai-muted pk-ai-task-progress',hidden:true,'aria-live':'polite'});
 let modal=null,modalMap=null;
 const searchIndex=createSourceSearch(input,document),searchPanel=el(document,'div',{class:'pk-ai-search-panel',hidden:true}),searchResults=el(document,'div',{class:'pk-ai-search-results'}),query=el(document,'input',{id:'pk-ai-search-input',type:'search',placeholder:input.kind==='video'?t("搜索已读取字幕"):t("搜索当前原文"),'aria-label':t("搜索当前内容"),maxlength:200}),matchStatus=el(document,'span',{role:'status'});let matches=[],matchIndex=-1;
 const chooseMatch=index=>{if(!matches.length)return;matchIndex=(index+matches.length)%matches.length;if(!searchIndex.activate(matchIndex)){matches=[];matchIndex=-1;searchResults.replaceChildren();matchStatus.textContent=t("原文已变化，请重新打开阅读器");return;}matchStatus.textContent=`${matchIndex+1} / ${matches.length}${matches.length===500?t("（最多显示 500 项）"):''}`;};
 const search=button(document,'',()=>{searchPanel.hidden=!searchPanel.hidden;search.setAttribute('aria-expanded',String(!searchPanel.hidden));if(!searchPanel.hidden){query.focus();}else search.focus();},'pk-ai-tool');search.id='pk-ai-search';search.title=input.kind==='video'?t("搜索字幕"):t("搜索原文");search.setAttribute('aria-label',search.title);search.setAttribute('aria-expanded','false');search.append(icon(document,'search'));
 query.addEventListener('input',()=>{matches=searchIndex.find(query.value);matchIndex=-1;searchResults.replaceChildren();matchStatus.textContent=!query.value?t("仅搜索当前已读取内容"):!searchIndex.valid()?t("原文已变化，请重新打开阅读器"):matches.length?format('{count} 条匹配',{count:matches.length}):t("没有匹配内容");for(const [i,m] of matches.slice(0,50).entries())searchResults.append(button(document,(m.time!==undefined?clock(m.time)+'  ':'')+m.context,()=>chooseMatch(i),'pk-ai-search-result'));});
 query.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();chooseMatch(matchIndex+(e.shiftKey?-1:1));}if(e.key==='Escape'){e.stopPropagation();searchPanel.hidden=true;search.setAttribute('aria-expanded','false');search.focus();}});
 searchPanel.append(el(document,'div',{class:'pk-ai-search-row'},query,button(document,'↑',()=>chooseMatch(matchIndex-1)),button(document,'↓',()=>chooseMatch(matchIndex+1))),matchStatus,searchResults);
 searchPanel.querySelectorAll('button')[0].setAttribute('aria-label',t("上一条匹配"));searchPanel.querySelectorAll('button')[1].setAttribute('aria-label',t("下一条匹配"));
 const languagePanel=el(document,'div',{class:'pk-ai-language-panel',id:'pk-ai-language-menu',role:'menu','aria-label':t("回复语言"),hidden:true});
 const closeLanguage=(focus=false)=>{languagePanel.hidden=true;languageButton.setAttribute('aria-expanded','false');if(focus)languageButton.focus({preventScroll:true});};
 const languageButton=button(document,'',()=>{if(!languagePanel.hidden){closeLanguage();return;}languagePanel.hidden=false;languageButton.setAttribute('aria-expanded','true');languagePanel.querySelector(`[data-language="${language}"]`).focus({preventScroll:true});},'pk-ai-tool');
 languageButton.id='pk-ai-language';languageButton.title=t("回复语言");languageButton.setAttribute('aria-label',t('输出语言：')+(language==='en'?'English':t('简体中文')));languageButton.setAttribute('aria-expanded','false');languageButton.setAttribute('aria-haspopup','menu');languageButton.setAttribute('aria-controls',languagePanel.id);languageButton.append(icon(document,'language'));
 languagePanel.append(el(document,'div',{class:'pk-ai-language-title',text:t("回复语言")}));
 for(const [value,label,subtitle] of [['zh-CN',t("中文（简体）"),t("简体中文")],['en','English',t("英语")]]){const b=button(document,'',()=>{closeLanguage(true);if(value!==language){resetLanguage(value);onLanguage(value);}});b.id='pk-ai-language-'+value;b.dataset.language=value;b.setAttribute('role','menuitemradio');b.setAttribute('aria-checked',String(value===language));b.tabIndex=value===language?0:-1;b.append(el(document,'span',{},el(document,'span',{text:label}),el(document,'small',{text:subtitle})),el(document,'span',{class:'pk-ai-language-check','aria-hidden':'true',text:'✓'}));languagePanel.append(b);}
 languagePanel.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeLanguage(true);}else if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const items=[...languagePanel.querySelectorAll('button')],index=items.indexOf(document.activeElement),next=e.key==='Home'?0:e.key==='End'?items.length-1:(index+(e.key==='ArrowDown'?1:items.length-1))%items.length;items.forEach((item,i)=>item.tabIndex=i===next?0:-1);items[next].focus({preventScroll:true});}});
 const dismissLanguage=e=>{if(!languagePanel.hidden&&!languagePanel.contains(e.target)&&!languageButton.contains(e.target))closeLanguage();};
 document.addEventListener('pointerdown',dismissLanguage,true);document.addEventListener('focusin',dismissLanguage);
 const fold=button(document,t("收起 AI 辅助"),()=>{collapsed=!collapsed;geometry();onPresentationChange();},'pk-ai-icon');fold.id='pk-ai-fold';fold.setAttribute('aria-expanded','true');fold.setAttribute('aria-controls',body.id);
 const expand=button(document,t("展开阅读"),()=>{expanded=!expanded;collapsed=false;geometry();onPresentationChange();},'pk-ai-icon');expand.id='pk-ai-expand';
 const stop=button(document,t("停止"),onStop,'pk-ai-icon');stop.id='pk-ai-stop';stop.setAttribute('aria-label',t("停止本帖生成"));
 for(const mode of allModes){
  const panel=el(document,'div',{class:'pk-ai-view',role:'tabpanel',id:'pk-ai-view-'+mode});panel.hidden=true;panels.set(mode,panel);body.append(panel);
  const label=mode==='mindmap'?t("脑图"):t("摘要"),tab=button(document,'',()=>select(mode),'pk-ai-tab');tab.append(icon(document,mode==='mindmap'?'mindmap':input.kind==='video'?'video':'article'),el(document,'span',{class:'pk-ai-tab-label',text:label}));tab.id='pk-ai-tab-'+mode;tab.title=label;tab.setAttribute('aria-label',label);tab.setAttribute('role','tab');tab.setAttribute('aria-controls',panel.id);panel.setAttribute('aria-labelledby',tab.id);
  tab.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const enabled=modes(),next=enabled[(enabled.indexOf(view)+(e.key==='ArrowRight'?1:enabled.length-1))%enabled.length];select(next);tabs.get(next)?.focus();});tabs.set(mode,tab);tablist.append(tab);
 }
 bar.append(el(document,'span',{class:'pk-ai-heading'},el(document,'span',{text:input.kind==='video'?t("视频解读"):t("长文解读")}),status),search,el(document,'div',{class:'pk-ai-language-anchor'},languageButton,languagePanel),tablist);
 const copyLabel=()=>view==='mindmap'?t("复制大纲"):t("复制"),copy=button(document,t("复制"),async()=>{try{const data=results[view]||drafts[view],text=view==='mindmap'&&(!tasks[view]||results[view])?treeOutline(data?.tree||[]):data?.text||'';await (win.navigator.clipboard||globalThis.navigator?.clipboard).writeText((results[view]?'':t("未完成\n"))+text);if(destroyed)return;copy.textContent=t("已复制");clearTimeout(copyTimer);copyTimer=setTimeout(()=>copy.textContent=copyLabel(),1500);}catch{if(!destroyed)copy.textContent=t("复制失败");}},'pk-ai-icon');
 footer.append(el(document,'span',{text:t("AI 生成 · 请结合原文阅读")}),stop,copy,expand,fold);root.append(bar,taskInfo,searchPanel,body,footer);
 function geometry(){
  closeLanguage();
  const available=win.innerHeight-68-8-160-16;if(available<180)collapsed=true;
  const height=collapsed?68:Math.max(68,Math.min(expanded?560:320,available));root.style.height=height+'px';root.classList.toggle('pk-ai-collapsed',collapsed);root.dataset.size=collapsed?'collapsed':expanded?'expanded':'overview';fold.textContent=collapsed?t("展开 AI 辅助"):t("收起 AI 辅助");fold.setAttribute('aria-expanded',String(!collapsed));expand.textContent=expanded?t("返回概览"):t("展开阅读");document.documentElement.style.setProperty('--peek-ai-space',`calc(${height}px + var(--peek-reader-gap, 8px))`);
 }
 function chrome(){
  setUILanguage(prefs.uiLanguage);localizeUI(root,prefs.uiLanguage);localizeUI(modal,prefs.uiLanguage);
  languageButton.setAttribute('aria-label',t('输出语言：')+(language==='en'?'English':t('简体中文')));
  if(query.value&&matches.length&&matchIndex<0)matchStatus.textContent=format('{count} 条匹配',{count:matches.length});
  const enabled=modes();root.hidden=!enabled.length;
  for(const [key,tab] of tabs){tab.hidden=!enabled.includes(key);tab.setAttribute('aria-selected',String(key===view));tab.tabIndex=key===view?0:-1;}
  const task=tasks[view];taskInfo.hidden=!task||!!results[view];
  if(task&&!results[view])taskInfo.textContent=(!BUSY.has(states[view])?(errors[view]==='CANCELLED'?t("已停止"):t("未完成")):task.stage==='integrate'?t("正在整合"):format('处理第 {current}/{total} 段',{current:Math.min(task.total,(task.completed||0)+1),total:task.total}))+' · '+format('计划 {requests} 次请求 · 本地估算',{requests:task.requests})+(drafts[view]?t(" · 局部提要，未完成"):'');
  const running=enabled.find(m=>BUSY.has(states[m]));
  const partial=!!drafts[view]&&!results[view],state=states[view];
  const label=(state==='success'?t("已完成"):state==='error'?(errors[view]==='CANCELLED'?t("已停止"):t("生成失败")):state==='queued'?t("排队中"):BUSY.has(state)?t("生成中"):t("未生成"))+(partial?t(" · 未完成"):'');
  if(status.textContent!==label)status.textContent=label;status.dataset.state=state||'waiting';
  status.setAttribute('aria-label',(view==='mindmap'?t("脑图"):t("摘要"))+'：'+label);
  stop.hidden=!running;copy.disabled=!results[view]&&!drafts[view];copy.textContent=copyLabel();const result=results[view],source=result?(result.providerName||'AI'):null;
  footer.firstElementChild.textContent=(source?`AI · ${source} · ${result.cacheWarning?t("本次结果未能缓存"):t("请结合原文阅读")}`:t("AI 生成 · 请结合原文阅读"))+(input.kind==='video'&&input.completion==='available-cues-snapshot'?t(" · 基于当前可用字幕"):'');
 }
 function select(mode,notify=true){if(destroyed||!modes().includes(mode))return;positions.set(view,{top:body.scrollTop,left:body.scrollLeft});view=mode;for(const [key,panel] of panels)panel.hidden=key!==view;const position=positions.get(view);body.scrollTop=position?.top||0;body.scrollLeft=position?.left||0;chrome();const map=contents.get(mode)?.map;if(map)map.update((results[mode]||drafts[mode])?.tree||[]);if(notify){onPresentationChange();onSelect(mode);}}
 function contentFor(mode){
  let c=contents.get(mode);if(c)return c;const panel=panels.get(mode);panel.replaceChildren();const text=el(document,'div',{class:'pk-ai-draft pk-ai-summary',translate:'no'}),timeline=el(document,'div',{class:'pk-ai-timeline'}),error=el(document,'div',{class:'pk-ai-error'});c={text,timeline,error,chapters:new Map(),map:null};
  panel.append(text);if(mode==='mindmap'){c.map=createMindmap(document);const tools=el(document,'div',{class:'pk-ai-map-inline-tools'},button(document,'−',()=>c.map.zoom(-.1)),button(document,'＋',()=>c.map.zoom(.1)),button(document,t("适应"),()=>c.map.fit()),button(document,t("展开 ↗"),()=>openMap(),'pk-ai-link'));tools.children[0].setAttribute('aria-label',t("缩小脑图"));tools.children[1].setAttribute('aria-label',t("放大脑图"));panel.append(error,c.map.root,tools);}else panel.append(timeline,error);contents.set(mode,c);return c;
 }
 function render(mode){
  const panel=panels.get(mode),hadFocus=panel.contains(document.activeElement),data=results[mode]||drafts[mode],top=body.scrollTop,left=body.scrollLeft;
  panel.dataset.state=states[mode]||'waiting';
  if(data){const c=contentFor(mode);if((mode!=='mindmap'||tasks[mode]&&!results[mode])&&c.rawText!==data.text){renderMarkdown(document,c.text,data.text||'');c.rawText=data.text;}c.text.hidden=mode==='mindmap'&&(!tasks[mode]||!!results[mode]);
   if(c.map){c.map.update(data.tree||[]);modalMap?.update(data.tree||[]);}
   else{c.timeline.hidden=mode!=='summary'||!prefs.timeline;const seen=new Set();for(const [i,h] of (data.highlights||[]).entries()){
    const key=String(i);seen.add(key);let item=c.chapters.get(key);
    if(!item){const details=el(document,'details',{class:'pk-ai-chapter'}),label=el(document,'summary'),seek=button(document,'',e=>{e.preventDefault();e.stopPropagation();seekNative(input.video,item.data.timestamp);},'pk-ai-time'),title=el(document,'span',{translate:'no',class:'pk-ai-chapter-title'}),points=el(document,'div',{translate:'no',class:'pk-ai-chapter-points'});label.append(seek,title,el(document,'span',{class:'pk-ai-expand',text:t("展开要点")}));details.append(label,points);c.timeline.append(details);item={details,seek,title,points,data:h};c.chapters.set(key,item);}
    item.data=h;item.details.hidden=false;item.seek.textContent=clock(h.timestamp/1000);item.title.textContent=h.chapter||h.title||t("章节");item.details.dataset.timestamp=String(h.timestamp);
    const points=h.bullet_points||[];for(let j=0;j<points.length;j++){let b=item.points.children[j];if(!b){b=button(document,'',()=>seekNative(input.video,item.data.bullet_points[j].timestamp),'pk-ai-point');item.points.append(b);}b.textContent=`${clock(points[j].timestamp/1000)}  ${points[j].point||points[j].text||''}`;}while(item.points.children.length>points.length)item.points.lastChild.remove();
   }for(const [key,item] of c.chapters)item.details.hidden=!seen.has(key);}
   c.error.replaceChildren();if(states[mode]==='error')renderError(c.error,mode);
  }else{contents.get(mode)?.map?.destroy();contents.delete(mode);panel.replaceChildren();if(states[mode]==='error'){const error=el(document,'div',{class:'pk-ai-error'});panel.append(error);renderError(error,mode);}else panel.append(el(document,'p',{text:states[mode]==='queued'?t("正在排队…"):BUSY.has(states[mode])?t("正在整理内容…"):t("选择此视图后生成")}),el(document,'p',{class:'pk-ai-muted',text:t("可以继续播放视频或阅读评论")}));}
  body.scrollTop=top;body.scrollLeft=left;if(hadFocus&&document.activeElement===document.body)tabs.get(view)?.focus({preventScroll:true});
 }
 function renderError(parent,mode){parent.append(el(document,'p',{text:errorText(errors[mode])}));parent.append(SETTINGS_ERRORS.has(errors[mode])?button(document,['AI_NOT_CONFIGURED','DOUBAO_UNAVAILABLE'].includes(errors[mode])?t("添加 AI 服务"):errors[mode].startsWith('CUSTOM_')?t("编辑服务"):t("前往设置"),onSettings,'pk-ai-link'):button(document,t("重试")+(mode==='mindmap'?t("脑图"):t("摘要")),()=>onRetry(mode)));}
 function openMap(){if(modal||destroyed)return;const prior=document.activeElement;modal=el(document,'dialog',{class:'pk-ai-map-dialog','aria-label':t("展开思维导图")});const initialTree=(results.mindmap||drafts.mindmap)?.tree||[];modalMap=createMindmap(document,{expandedDepth:initialExpandedDepth(initialTree)});const close=button(document,t("返回阅读 ×"),()=>modal.close()),tools=el(document,'div',{class:'pk-ai-map-tools'},el(document,'span',{class:'pk-ai-map-hint',text:t("双指滑动 / 拖动平移 · 捏合缩放 · 点击分支展开 / 收起")}),button(document,t("缩小"),()=>modalMap.zoom(-.1)),button(document,t("放大"),()=>modalMap.zoom(.1)),button(document,t("适应"),()=>modalMap.fit()));modal.append(el(document,'header',{},el(document,'h2',{text:input.title,translate:'no'}),close),modalMap.root,tools);document.body.append(modal);const dialog=modal,escape=e=>{if(e.key==='Escape'&&dialog.open){e.preventDefault();e.stopImmediatePropagation();dialog.close();}};win.addEventListener('keydown',escape,true);dialog.addEventListener('close',()=>{win.removeEventListener('keydown',escape,true);modalMap?.destroy();modalMap=null;dialog.remove();modal=null;if(!destroyed&&prior?.isConnected)prior.focus({preventScroll:true});},{once:true});dialog.showModal();modalMap.update((results.mindmap||drafts.mindmap)?.tree||[]);modalMap.fit();close.focus();}
 function resetLanguage(value){if(!['zh-CN','en'].includes(value))return;language=value;modal?.close();pending.clear();for(const object of [results,drafts,states,errors,tasks])for(const key of Object.keys(object))delete object[key];for(const c of contents.values())c.map?.destroy();contents.clear();positions.clear();for(const mode of allModes)render(mode);for(const b of languagePanel.querySelectorAll('button')){b.setAttribute('aria-checked',String(b.dataset.language===value));b.tabIndex=b.dataset.language===value?0:-1;}languageButton.setAttribute('aria-label',t("输出语言：")+(value==='en'?'English':t("简体中文")));chrome();}
 function flushProgress(){if(frame){(win.cancelAnimationFrame||win.clearTimeout).call(win,frame);frame=0;}if(destroyed)return;for(const [mode,data] of pending){if(BUSY.has(states[mode])){const started=win.performance.now();drafts[mode]=data;states[mode]='streaming';render(mode);if(mode==='mindmap'?data.tree?.length:data.text||data.highlights?.length)onRender(win.performance.now()-started,mode);}}pending.clear();chrome();}
 const playback=()=>{const chapters=[...root.querySelectorAll('.pk-ai-chapter')],time=(input.video?.currentTime||0)*1000;let current=null;for(const c of chapters)if(Number(c.dataset.timestamp)<=time)current=c;for(const c of chapters){if(c===current)c.setAttribute('aria-current','true');else c.removeAttribute('aria-current');}};
 input.video?.addEventListener?.('timeupdate',playback);win.addEventListener('resize',geometry);for(const mode of allModes)render(mode);select(view,false);geometry();
 return {root,flushProgress,resetLanguage,
  set(mode,state,value){if(destroyed||!panels.has(mode))return;flushProgress();states[mode]=state;if(state==='queued'||state==='success')delete tasks[mode];if(state==='success'){results[mode]=value;delete errors[mode];delete drafts[mode];}else{delete results[mode];if(state==='error'){errors[mode]=value;}else{delete drafts[mode];}}const started=win.performance.now();render(mode);chrome();if(state==='success')onRender(win.performance.now()-started,mode);},
  progress(mode,text,preview){if(destroyed||!panels.has(mode)||!BUSY.has(states[mode])||typeof text!=='string'||text.length>12000)return;if(preview&&!validPreview(preview,language))return;pending.set(mode,preview||{text,tree:[],highlights:[]});if(!frame)frame=(win.requestAnimationFrame||((fn)=>win.setTimeout(fn,16))).call(win,flushProgress);},
  taskProgress(mode,event){
   const e=taskProgressEvent(event);if(destroyed||!e||!panels.has(mode)||!BUSY.has(states[mode]))return;
   tasks[mode]={...tasks[mode],...e};if(states[mode]==='queued')states[mode]='loading';
   if(e.text!==undefined)this.progress(mode,e.text);chrome();
  },
  stop(){flushProgress();for(const mode of modes())if(states[mode]!=='success')this.set(mode,'error','CANCELLED');},
  updatePreferences(value){prefs=value;setUILanguage(prefs.uiLanguage);localizeUI(root,prefs.uiLanguage);localizeUI(modal,prefs.uiLanguage);for(const mode of allModes)if(!modes().includes(mode)&&BUSY.has(states[mode])){states[mode]='waiting';pending.delete(mode);render(mode);}const timeline=contents.get('summary')?.timeline;if(timeline)timeline.hidden=!prefs.timeline;for(const mode of allModes)if(states[mode]==='error')render(mode);for(const c of contents.values())c.map?.localize();modalMap?.localize();if(!prefs.mindmap)modal?.close();if(!modes().includes(view)&&modes().length)select(modes()[0]);chrome();},
  destroy(){if(destroyed)return;destroyed=true;document.removeEventListener('pointerdown',dismissLanguage,true);document.removeEventListener('focusin',dismissLanguage);clearTimeout(copyTimer);if(frame)(win.cancelAnimationFrame||win.clearTimeout).call(win,frame);modal?.close();for(const c of contents.values())c.map?.destroy();searchIndex.destroy();input.video?.removeEventListener?.('timeupdate',playback);win.removeEventListener('resize',geometry);root.remove();pending.clear();onClose?.();},
  snapshot:()=>({view,outputLanguage:language,states:{...states},results:{...results}})
 };
}
