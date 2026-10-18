import {readFocalContent,inspectFocal,focalArticle} from './content-source.js';
import {createCard} from './card.js';
import {send} from './client.js';
import {modesFor} from './preferences.js';
import {button} from './dom.js';
import {readTheme} from '../theme-adapter.js';
let current=null,scheduled=false,lastPrefs=null,syncRevision=0;
export function initAIReader(){
 if(!globalThis.chrome?.runtime?.id)return;
 chrome.runtime.onMessage.addListener((m,sender,respond)=>{
  if(sender.id!==chrome.runtime.id||sender.tab||m?.ns!=='peek-ai-v7'||m.action!=='confirmFocus')return false;
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
 window.addEventListener('focus',()=>sync(true));
 schedule();
}
function stop(){
 const s=current;current=null;if(!s)return;s.abort.abort();s.readAbort?.abort();clearTimeout(s.deadline);clearTimeout(s.debounce);s.observer?.disconnect();s.card?.destroy();send('cancel',{instance:s.instance}).catch(()=>{});
 document.querySelector('[data-peek-feishu]')?.remove();document.documentElement.removeAttribute('data-peek-ai-card');document.documentElement.style.removeProperty('--peek-ai-space');
}
async function sync(refresh=false){
 const root=document.documentElement,focusId=location.pathname.match(/^\/[^/]+\/status\/(\d+)/)?.[1];
 if(root.getAttribute('data-peek-lad')!=='on'||root.getAttribute('data-peek-lad-state')!=='active'||innerWidth<980||!focusId){++syncRevision;stop();return;}
 const bar=document.getElementById('peek-reader-topbar');
 if(bar&&!bar.querySelector('[data-peek-ai-settings]')){const b=button(document,'⚙',()=>send('openSettings').catch(()=>{}),'pk-tb-btn');b.setAttribute('aria-label','Peek 设置');b.setAttribute('data-peek-ai-settings','');bar.insertBefore(b,bar.querySelector('.pk-tb-native'));}
 if(current?.focusId===focusId&&!refresh){applyTheme(current.prefs);return;}
 const revision=++syncRevision;
 let prefs,connection;try{[prefs,connection]=await Promise.all([send('preferences'),send('status',{xTheme:readTheme()})]);}catch{return;}
 connection=connection||{};
 if(revision!==syncRevision||location.pathname.match(/\/status\/(\d+)/)?.[1]!==focusId||root.getAttribute('data-peek-lad')!=='on'||root.getAttribute('data-peek-lad-state')!=='active'||innerWidth<980)return;
 if(current?.focusId===focusId&&JSON.stringify(prefs)===JSON.stringify(lastPrefs)&&current.connectionId===connection.connectionId){
  // A tab focus is a state read, not consent to retry a failed model call.
  // A new connection partition below still automatically resumes generation.
  return;
 }
 stop();lastPrefs=prefs;applyTheme(prefs);ensureActions(focusId);if(!prefs.summary&&!prefs.mindmap)return;
 const s={focusId,prefs,connectionId:connection.connectionId,instance:crypto.randomUUID(),abort:new AbortController(),card:null,input:null,observer:null,extracting:false,hydrationEnded:false,sourceStamp:null};current=s;
 const stampOf=source=>!source?null:source.kind==='video'?JSON.stringify([source.kind,source.title,source.video.currentSrc]):source.text;
 const valid=()=>current===s&&!s.abort.signal.aborted&&location.pathname.match(/\/status\/(\d+)/)?.[1]===focusId&&root.getAttribute('data-peek-lad')==='on';s.valid=valid;
 async function attempt(){
  if(!valid()||s.extracting)return;
  const source=inspectFocal(document,focusId);if(!source)return;
  const stamp=stampOf(source);
  if(s.input&&s.sourceStamp===stamp)return;
  s.extracting=true;s.pendingStamp=stamp;s.readAbort=new AbortController();
  try{
   const input=await readFocalContent(focusId,{signal:s.readAbort.signal,isCurrent:()=>valid()&&stampOf(inspectFocal(document,focusId))===stamp});
   if(!valid()||!input)return;
   const modes=modesFor(input,prefs);if(!modes.length)return;
   if(s.card){s.card.destroy();send('cancel',{instance:s.instance}).catch(()=>{});}
   s.instance=crypto.randomUUID();
   s.input=input;s.sourceStamp=stamp;
   s.card=createCard({document,input,preferences:prefs,onRetry:mode=>generate(s,mode),onSettings:()=>send('openSettings').catch(()=>{})});
   s.card.root.dataset.kind=input.kind;s.card.root.dataset.focusId=focusId;
   if(input.cues){s.card.root.dataset.cueCount=input.cues.length;s.card.root.dataset.firstCue=input.cues[0].start;s.card.root.dataset.lastCue=input.cues.at(-1).end;s.card.root.dataset.completion=input.completion;}
   document.body.append(s.card.root);root.setAttribute('data-peek-ai-card','on');root.style.setProperty('--peek-ai-space','calc(min(44vh, 420px) + 12px)');applyTheme(prefs);
   const card=s.card,instance=s.instance;
   (async()=>{for(const mode of modes){if(!valid()||s.card!==card||s.instance!==instance)return;await generate(s,mode);}})();
  }catch{/* cancellation and unavailable input leave native reading intact */}
  finally{s.extracting=false;s.pendingStamp=null;if(s.rerun){s.rerun=false;attempt();}}
 }
 s.observer=new MutationObserver(()=>{
  if(!valid())return;ensureActions(focusId);
  const source=inspectFocal(document,focusId),stamp=stampOf(source);
  if(s.pendingStamp&&stamp!==s.pendingStamp){s.readAbort?.abort();s.rerun=true;}
  if(s.input&&(stamp!==s.sourceStamp||(source?.kind==='video'&&source.video!==s.input.video))){
   const old=s.instance;s.instance=crypto.randomUUID();s.card?.destroy();s.card=null;s.input=null;s.sourceStamp=null;send('cancel',{instance:old}).catch(()=>{});
   root.removeAttribute('data-peek-ai-card');root.style.removeProperty('--peek-ai-space');
  }
  if(s.debounce)return;s.debounce=setTimeout(()=>{s.debounce=null;attempt();},300);
 });
 s.observer.observe(document.querySelector('[data-testid="primaryColumn"]')||document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['src']});
 s.deadline=setTimeout(()=>{s.hydrationEnded=true;s.observer?.disconnect();if(s.input?.article?.isConnected){s.observer.observe(s.input.article,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['src']});}},10000);
 attempt();
}
function applyTheme(prefs){const theme=prefs.theme==='system'?readTheme():prefs.theme;if(document.documentElement.dataset.peekAiTheme!==theme)document.documentElement.dataset.peekAiTheme=theme;}
async function generate(s,mode){
 if(!s.valid()||!s.card||s.card.snapshot().states[mode]==='loading')return;
 const card=s.card;card.set(mode,'loading');
 const {kind,focusId,url,title,text,duration,cues}=s.input;
 try{const result=await send('generate',{instance:s.instance,connectionId:s.connectionId,input:{kind,focusId,url,title,text,...(kind==='video'?{duration,cues}:{})},mode});if(s.valid()&&s.card===card)card.set(mode,'success',result);}
 catch(e){if(s.valid()&&s.card===card)card.set(mode,'error',e.message);}
}

function ensureActions(focusId){
 const article=focalArticle(document,focusId);if(!article||article.querySelector('[data-peek-feishu]'))return;
 const reply=Array.from(article.querySelectorAll('[data-testid="reply"]')).find(n=>!n.closest('div[role="link"]'));
 const group=reply?.closest('[role="group"]');if(!group)return;
 const b=button(document,'',()=>{b.setAttribute('title','飞书收藏尚未开放');},'pk-feishu-placeholder');
 b.setAttribute('data-peek-feishu','');b.setAttribute('aria-label','飞书收藏，尚未开放');b.setAttribute('title','飞书收藏尚未开放');
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('width','20');svg.setAttribute('height','20');svg.setAttribute('aria-hidden','true');
 const bird=document.createElementNS(svg.namespaceURI,'path');bird.setAttribute('d','M5 11l5 4 5-8 6 1-5 11-6 2-7-5z');bird.setAttribute('fill','currentColor');
 const plus=document.createElementNS(svg.namespaceURI,'path');plus.setAttribute('d','M4 1v6M1 4h6');plus.setAttribute('stroke','currentColor');plus.setAttribute('stroke-width','1.5');svg.append(bird,plus);b.append(svg);group.append(b);
}
