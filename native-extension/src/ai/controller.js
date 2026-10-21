import {t,setUILanguage} from '../i18n.js';
import {attachCommentScrollbar} from './comment-scrollbar.js';
import {validPreview} from './preview.js';
import {readFocalContent,inspectFocal,focalArticle} from './content-source.js';
import {createCard} from './card.js';
import {send} from './client.js';
import {modesFor,normalizePreferences} from './preferences.js';
import {button} from './dom.js';
import {readTheme} from '../theme-adapter.js';
let current=null,scheduled=false,lastPrefs=null,syncRevision=0;
export function initAIReader(){
 if(!globalThis.chrome?.runtime?.id)return;
 attachCommentScrollbar(document);
 chrome.runtime.onMessage.addListener((m,sender,respond)=>{
  if(sender.id!==chrome.runtime.id||sender.tab||m?.ns!=='peek-ai-v7')return false;
  if(m.action==='generationProgress'){
   const s=current,job=s?.progress?.get(m.mode);
   if(!job||!s.valid()||s.stopped||(m.outputLanguage||'zh-CN')!==s.outputLanguage||m.instance!==s.instance||m.connectionId!==s.connectionId||m.requestId!==job.id||!Number.isSafeInteger(m.sequence)||m.sequence<=job.sequence||!modesFor(s.input,s.prefs).includes(m.mode))return false;
   if(m.preview&&!validPreview(m.preview,s.outputLanguage))return false;job.sequence=m.sequence;
   if(m.stage==='partial'&&typeof m.text==='string'&&m.text.length<=12000){job.previewReadable=!!(m.mode==='mindmap'?m.preview?.tree.length:m.preview?.highlights.length);job.text=m.mode==='mindmap'?(m.preview?.tree||[]).map(node=>node.text).join('\n'):m.text;s.card.progress(m.mode,m.text,m.preview);recordVisible(s,m.mode,job,false,job.text);}
   else if(m.stage==='request'&&s.card.snapshot().states[m.mode]==='queued')s.card.set(m.mode,'loading');
   return false;
  }
  if(m.action==='stateChanged'){
   if(m.connectionChanged){if(current)invalidateConnectionReads(current);++syncRevision;}
   if(m.preferences){++syncRevision;updateCurrentPreferences(normalizePreferences(m.preferences));}
   sync(true);return false;
  }
  if(m.action!=='confirmFocus')return false;
  const s=current;
  respond(document.documentElement.getAttribute('data-peek-lad-state')==='active'&&innerWidth>=980&&s?.valid?.()&&s.instance===m.instance&&s.card?.root.isConnected?{focusId:s.focusId,instance:s.instance,url:s.input.url}:null);
  return false;
 });
 const schedule=()=>{if(scheduled)return;scheduled=true;setTimeout(()=>{scheduled=false;sync();},0);};
 new MutationObserver(schedule).observe(document.documentElement,{attributes:true,attributeFilter:['data-peek-lad','data-peek-lad-state']});
 const themeObserver=new MutationObserver(()=>{if(lastPrefs&&document.documentElement.getAttribute('data-peek-lad')==='on')applyTheme(lastPrefs);});
 themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['class','style','data-theme']});
 if(document.body)themeObserver.observe(document.body,{attributes:true,attributeFilter:['class','style']});
 window.addEventListener('resize',schedule);
 document.addEventListener('visibilitychange',()=>{if(current)presentationChanged(current);});
 window.addEventListener('focus',()=>sync(true));
 schedule();
}
function stop(){
 const s=current;current=null;if(s){s.abort.abort();s.readAbort?.abort();clearTimeout(s.deadline);clearTimeout(s.debounce);s.observer?.disconnect();s.card?.destroy();send('cancel',{instance:s.instance}).catch(()=>{});}
 // Owned DOM can exist even when all modes were disabled before an instance.
 document.querySelectorAll('[data-peek-feishu]').forEach(n=>n.remove());document.getElementById('peek-ai-card')?.remove();document.documentElement.removeAttribute('data-peek-ai-card');document.documentElement.style.removeProperty('--peek-ai-space');
}
async function sync(refresh=false){
 const root=document.documentElement,focusId=location.pathname.match(/^\/[^/]+\/status\/(\d+)/)?.[1];
 if(root.getAttribute('data-peek-lad')!=='on'||root.getAttribute('data-peek-lad-state')!=='active'||innerWidth<980||!focusId){++syncRevision;stop();return;}
 const bar=document.getElementById('peek-reader-topbar');
 if(bar&&!bar.querySelector('[data-peek-ai-settings]')){const b=button(document,'⚙',()=>send('openSettings').catch(()=>{}),'pk-tb-btn');b.setAttribute('aria-label',t('设置'));b.setAttribute('data-peek-ai-settings','');bar.insertBefore(b,bar.querySelector('.pk-tb-native'));}
 if(current?.focusId===focusId&&!refresh){applyTheme(current.prefs);return;}
 const revision=++syncRevision;
 let prefs,connection;try{[prefs,connection]=await Promise.all([send('preferences'),send('status',{xTheme:readTheme()})]);}catch{return;}
 connection=connection||{};
 if(revision!==syncRevision||location.pathname.match(/\/status\/(\d+)/)?.[1]!==focusId||root.getAttribute('data-peek-lad')!=='on'||root.getAttribute('data-peek-lad-state')!=='active'||innerWidth<980)return;
 if(current?.focusId===focusId&&current.connectionId===connection.connectionId){
  // A tab focus is a state read, not consent to retry a failed model call.
  // A new connection partition below still automatically resumes generation.
  if(current.connectionState!==connection.state){invalidateConnectionReads(current);current.connectionState=connection.state;
   endConnectionWait(current);}
  updateCurrentPreferences(prefs);return;
 }
 const outputLanguage=current?.focusId===focusId?current.outputLanguage:(prefs.outputLanguage||'en');stop();lastPrefs=prefs;applyTheme(prefs);ensureActions(focusId);if(!prefs.summary&&!prefs.mindmap)return;
 const s={focusId,prefs,outputLanguage,runs:new Map(),cacheReads:new Map(),progress:new Map(),displayJobs:new Map(),stopped:false,connectionRevision:0,connectionState:connection.state,connectionId:connection.connectionId,instance:crypto.randomUUID(),abort:new AbortController(),card:null,input:null,observer:null,extracting:false,hydrationEnded:false,sourceStamp:null};current=s;
 const stampOf=source=>!source?null:source.kind==='video'?JSON.stringify([source.kind,source.title,source.video.currentSrc]):source.text;
 const valid=()=>current===s&&!s.abort.signal.aborted&&location.pathname.match(/\/status\/(\d+)/)?.[1]===focusId&&root.getAttribute('data-peek-lad')==='on'&&root.getAttribute('data-peek-lad-state')==='active'&&innerWidth>=980;s.valid=valid;
 async function attempt(){
  if(!valid()||s.extracting)return;
  const source=inspectFocal(document,focusId);s.observedArticle=source?.article||focalArticle(document,focusId);if(!source)return;
  const stamp=stampOf(source);
  if(s.input&&s.sourceStamp===stamp)return;
  s.extracting=true;s.pendingStamp=stamp;s.readAbort=new AbortController();const contentStarted=performance.now();
  try{
   const input=await readFocalContent(focusId,{signal:s.readAbort.signal,isCurrent:()=>valid()&&stampOf(inspectFocal(document,focusId))===stamp});
   if(!valid()||!input)return;
   const modes=modesFor(input,s.prefs);if(!modes.length)return;
   if(s.card){s.card.destroy();send('cancel',{instance:s.instance}).catch(()=>{});}
   s.instance=crypto.randomUUID();
   s.input=input;s.sourceStamp=stamp;s.cacheReads=new Map();s.progress.clear();s.displayJobs.clear();s.stopped=false;s.contentMs=performance.now()-contentStarted;
   s.card=createCard({document,input,preferences:s.prefs,onRetry:mode=>{s.stopped=false;generate(s,mode);},onSelect:mode=>generate(s,mode,true),onPresentationChange:()=>presentationChanged(s),onStop:()=>stopGeneration(s),onSettings:()=>send('openSettings').catch(()=>{}),onLanguage:value=>changeLanguage(s,value),onRender:(renderMs,mode)=>{const job=s.progress.get(mode);if(job)send('displayed',{instance:s.instance,requestId:job.id,renderMs}).catch(()=>{});}});
   s.card.resetLanguage(s.outputLanguage);s.card.root.dataset.kind=input.kind;s.card.root.dataset.focusId=focusId;
   if(input.cues){s.card.root.dataset.cueCount=input.cues.length;s.card.root.dataset.firstCue=input.cues[0].start;s.card.root.dataset.lastCue=input.cues.at(-1).end;s.card.root.dataset.completion=input.completion;}
   if(s.connectionRevision>0&&s.connectionState!=='ready')endConnectionWait(s);
   document.body.append(s.card.root);root.setAttribute('data-peek-ai-card','on');applyTheme(prefs);
   // Cache reads are independent of the serial model queue.
   for(const mode of modes)readCached(s,mode);
   generate(s,s.card.snapshot().view,true);
  }catch{/* cancellation and unavailable input leave native reading intact */}
  finally{s.extracting=false;s.pendingStamp=null;if(s.rerun){s.rerun=false;attempt();}}
 }
 s.observer=new MutationObserver(records=>{
  if(!valid()||!relevantMutation(records,s.observedArticle,focusId))return;ensureActions(focusId);
  const source=inspectFocal(document,focusId),stamp=stampOf(source);
  if(s.pendingStamp&&stamp!==s.pendingStamp){s.readAbort?.abort();s.rerun=true;}
  if(s.input&&(stamp!==s.sourceStamp||(source?.kind==='video'&&source.video!==s.input.video))){
   const old=s.instance;s.instance=crypto.randomUUID();s.card?.destroy();s.card=null;s.displayJobs.clear();s.input=null;s.sourceStamp=null;send('cancel',{instance:old}).catch(()=>{});
   root.removeAttribute('data-peek-ai-card');root.style.removeProperty('--peek-ai-space');
  }
  if(s.debounce)return;s.debounce=setTimeout(()=>{s.debounce=null;attempt();},300);
 });
 s.observer.observe(document.querySelector('[data-testid="primaryColumn"]')||document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['src']});
 s.deadline=setTimeout(()=>{s.hydrationEnded=true;s.observer?.disconnect();if(s.input?.article?.isConnected){s.observer.observe(s.input.article,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['src']});}},10000);
 attempt();
}
function applyTheme(prefs){setUILanguage(prefs.uiLanguage);document.documentElement.dataset.peekUiLanguage=prefs.uiLanguage||'en';window.dispatchEvent(new CustomEvent('peek-ui-language',{detail:{language:prefs.uiLanguage||'en'}}));const theme=prefs.theme==='system'?readTheme():prefs.theme;if(document.documentElement.dataset.peekAiTheme!==theme)document.documentElement.dataset.peekAiTheme=theme;}
function updateCurrentPreferences(prefs){
 lastPrefs=prefs;applyTheme(prefs);const s=current;if(!s)return;
 const outputChanged=s.prefs.outputLanguage!==prefs.outputLanguage;const before=s.input?modesFor(s.input,s.prefs):[];s.prefs=prefs;
 const after=s.input?modesFor(s.input,prefs):[];
 if((!prefs.summary&&!prefs.mindmap)||(s.input&&!after.length)){stop();return;}
 for(const mode of before)if(!after.includes(mode)){s.runs.set(mode,(s.runs.get(mode)||0)+1);s.cacheReads.delete(mode);s.progress.delete(mode);for(const [id,job] of s.displayJobs)if(job.mode===mode)s.displayJobs.delete(id);}
 s.card?.updatePreferences(prefs);
 if(outputChanged){if(s.card)changeLanguage(s,prefs.outputLanguage,false);else s.outputLanguage=prefs.outputLanguage;}
 for(const mode of after)if(!before.includes(mode))readCached(s,mode);
 if(s.card&&!before.includes(s.card.snapshot().view))generate(s,s.card.snapshot().view,true);
}
function endConnectionWait(s){
 if(!s.card||!s.input)return;
 const states=s.card.snapshot().states;
 for(const mode of modesFor(s.input,s.prefs))if(states[mode]!=='success')s.card.set(mode,'error',s.connectionState==='ready'?'CANCELLED':s.connectionState);
}
function invalidateConnectionReads(s){s.connectionRevision++;s.cacheReads.clear();s.progress.clear();s.displayJobs.clear();}
function relevantMutation(records,article,focusId){
 if(!article?.isConnected)return true;
 for(const record of records){
  if(record.target===article||article.contains(record.target))return true;
  for(const node of [...record.addedNodes,...record.removedNodes]){
   if(node===article||node.contains?.(article))return true;
   // A duplicate/new focal cell can invalidate ownership. Ordinary comment
   // text updates cannot; avoid a whole-document lookup for those callbacks.
   if(node.nodeType===1&&(node.matches?.(`a[href*="/status/${focusId}"]`)||node.querySelector?.(`a[href*="/status/${focusId}"]`)))return true;
  }
 }
 return false;
}
function stopGeneration(s){
 if(!s.valid()||s.stopped)return;
 s.stopped=true;const old=s.instance;s.instance=crypto.randomUUID();
 s.progress.clear();s.displayJobs.clear();s.cacheReads.clear();for(const mode of s.runs.keys())s.runs.set(mode,s.runs.get(mode)+1);
 send('cancel',{instance:old}).catch(()=>{});s.card.stop();
}
function changeLanguage(s,value,persist=true){
 if(!s.valid()||!['zh-CN','en'].includes(value)||value===s.outputLanguage)return;
 if(persist)send('setOutputLanguage',{outputLanguage:value}).catch(()=>{});
 const old=s.instance;s.instance=crypto.randomUUID();s.outputLanguage=value;s.stopped=false;
 s.card.resetLanguage(value);
 s.cacheReads.clear();s.progress.clear();s.displayJobs.clear();for(const mode of s.runs.keys())s.runs.set(mode,s.runs.get(mode)+1);
 send('cancel',{instance:old}).catch(()=>{});
 for(const mode of modesFor(s.input,s.prefs))readCached(s,mode);
 generate(s,s.card.snapshot().view,true);
}
function presentationVisible(s,mode){return !document.hidden&&s.card?.snapshot().view===mode&&!s.card.root.classList.contains('pk-ai-collapsed');}
function displayJob(s,mode){
 const job={id:crypto.randomUUID(),instance:s.instance,mode,sequence:0,started:performance.now(),visibilityInterrupted:!presentationVisible(s,mode)};
 s.displayJobs.set(job.id,job);return job;
}
function presentationChanged(s){
 if(!s.valid()||!s.card)return;
 // Keep pending cache reads and completed-but-unseen results in this set.
 // Retire a sample after its first complete display, so later user actions
 // cannot retroactively invalidate a measured foreground completion.
 for(const job of s.displayJobs.values()){
  if(!presentationVisible(s,job.mode)){
   if(!job.visibilityInterrupted){job.visibilityInterrupted=true;send('displayed',{instance:job.instance,requestId:job.id,visibilityInterrupted:true}).catch(()=>{});}
  }else if(job.complete||job.text||job.previewReadable)recordVisible(s,job.mode,job,job.complete===true,job.text);
 }
}
function recordVisible(s,mode,job,complete,text=''){
 if(!complete&&!text.trim()&&!job.previewReadable)return;
 const readable=complete||job.previewReadable||text.trim().length>=80||text.trim().length>=40&&/[。！？.!?]/.test(text);
 if(!complete&&job.firstVisibleMs!==undefined&&(!readable||job.firstReadableMs!==undefined))return;
 const frame=window.requestAnimationFrame||((fn)=>setTimeout(fn,16));
 frame(()=>{
  if(!s.valid()||!s.card||job.instance!==s.instance||s.displayJobs.get(job.id)!==job||!presentationVisible(s,mode))return;
  const ms=performance.now()-job.started;
  if(job.firstVisibleMs===undefined)job.firstVisibleMs=ms;
  if(readable&&job.firstReadableMs===undefined)job.firstReadableMs=ms;
  send('displayed',{instance:job.instance,requestId:job.id,visibilityInterrupted:job.visibilityInterrupted===true,firstVisibleMs:job.firstVisibleMs,...(job.firstReadableMs!==undefined?{firstReadableMs:job.firstReadableMs}:{}),...(complete?{displayMs:ms}:{})}).catch(()=>{});
  if(complete)s.displayJobs.delete(job.id);
 });
}
function requestInput(input){
 const {kind,focusId,url,title,text,duration,cues}=input;
 return {kind,focusId,url,title,text,...(kind==='video'?{duration,cues}:{})};
}
function readCached(s,mode){
 if(s.cacheReads.has(mode))return s.cacheReads.get(mode);
 const card=s.card,input=s.input,instance=s.instance,connectionId=s.connectionId,connectionRevision=s.connectionRevision,run=(s.runs.get(mode)||0)+1;s.runs.set(mode,run);
 const active=()=>s.valid()&&s.card===card&&s.input===input&&s.instance===instance&&s.connectionId===connectionId&&s.connectionRevision===connectionRevision&&s.runs.get(mode)===run&&modesFor(input,s.prefs).includes(mode);
 const pending=(async()=>{
  const job=displayJob(s,mode);
  try{const result=await send('cached',{instance,connectionId,input:requestInput(input),mode,requestId:job.id,contentMs:s.contentMs,outputLanguage:s.outputLanguage});if(result&&active()){job.complete=true;card.set(mode,'success',result);recordVisible(s,mode,job,true);}}
  catch{/* Cache lookup failure must not block the normal generation path. */}
  finally{if(!job.complete)s.displayJobs.delete(job.id);}
 })();s.cacheReads.set(mode,pending);return pending;
}
async function generate(s,mode,automatic=false){
 if(!s.valid()||!s.card||!modesFor(s.input,s.prefs).includes(mode)||automatic&&s.stopped)return;
 const cachedCard=s.card,cachedInput=s.input,instance=s.instance,connectionRevision=s.connectionRevision;await readCached(s,mode);
 if(!s.valid()||s.card!==cachedCard||s.input!==cachedInput||s.instance!==instance||s.connectionRevision!==connectionRevision||!modesFor(s.input,s.prefs).includes(mode))return;
 const state=s.card.snapshot().states[mode];if(['queued','loading','streaming'].includes(state)||automatic&&(['success','error'].includes(state)||s.stopped))return;
 const run=(s.runs.get(mode)||0)+1;s.runs.set(mode,run);
 const card=s.card;card.set(mode,'queued');const job=displayJob(s,mode);s.progress.set(mode,job);
 const active=()=>s.valid()&&s.instance===instance&&s.card===card&&s.connectionRevision===connectionRevision&&s.runs.get(mode)===run&&modesFor(s.input,s.prefs).includes(mode);
 try{const result=await send('generate',{instance,connectionId:s.connectionId,input:requestInput(s.input),mode,requestId:job.id,contentMs:s.contentMs,outputLanguage:s.outputLanguage});if(active()){job.complete=true;card.set(mode,'success',result);recordVisible(s,mode,job,true);}}
 catch(e){if(active())card.set(mode,'error',e.message);}
 finally{if(s.progress.get(mode)===job)s.progress.delete(mode);if(!job.complete)s.displayJobs.delete(job.id);}
}

function ensureActions(focusId){
 const article=focalArticle(document,focusId);if(!article||article.querySelector('[data-peek-feishu]'))return;
 const reply=Array.from(article.querySelectorAll('[data-testid="reply"]')).find(n=>!n.closest('div[role="link"]'));
 const group=reply?.closest('[role="group"]');if(!group)return;
 const b=button(document,'',()=>{b.setAttribute('title',t('飞书收藏尚未开放'));},'pk-feishu-placeholder');
 b.setAttribute('data-peek-feishu','');b.setAttribute('aria-label',t('飞书收藏，尚未开放'));b.setAttribute('title',t('飞书收藏尚未开放'));
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('width','20');svg.setAttribute('height','20');svg.setAttribute('aria-hidden','true');
 const bird=document.createElementNS(svg.namespaceURI,'path');bird.setAttribute('d','M5 11l5 4 5-8 6 1-5 11-6 2-7-5z');bird.setAttribute('fill','currentColor');
 const plus=document.createElementNS(svg.namespaceURI,'path');plus.setAttribute('d','M4 1v6M1 4h6');plus.setAttribute('stroke','currentColor');plus.setAttribute('stroke-width','1.5');svg.append(bird,plus);b.append(svg);group.append(b);
}
