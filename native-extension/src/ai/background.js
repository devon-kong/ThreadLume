import {AIService,allowedSender,validateParams,PARAM_KEYS} from './service.js';
import {AIError,fail,parseSSE,completionOptions,validateInput,businessDiagnostics} from './protocol.js';
const BASE='https://www.doubao.com';
const PATHS=new Set(['/samantha/aireader/resource_content/create','/samantha/chat/completion']);
let checkTask=null,autoRestoring=null,autoStarting=null,setupOpening=null;
const stats={workerStartedAt:Date.now(),requests:0,stages:[],focusChecks:[]};
async function transport(path,body,signal,params){
 if(!PATHS.has(path))fail('UNSUPPORTED_OPERATION');
 if(!await chrome.permissions.contains({origins:[BASE+'/*']}))fail('PERMISSION_REQUIRED');
 const keys=validateParams(params),requestId=crypto.randomUUID(),started=Date.now();stats.requests++;
 const record={requestId,operation:path.endsWith('/create')?'upload':body.messages?.[0]?.content_type,started};
 stats.stages.push(record);stats.stages=stats.stages.slice(-40);
 try{
  const response=await fetch(BASE+path+'?'+new URLSearchParams(keys),{method:'POST',credentials:'include',redirect:'error',headers:{'Content-Type':'application/json','Agw-Js-Conv':'str'},body:JSON.stringify(body),signal:AbortSignal.any([signal,AbortSignal.timeout(120000)])});
  record.httpStatus=response.status;
  if(!response.ok)fail(response.status===401?'LOGIN_REQUIRED':response.status===429?'RATE_LIMITED':response.status===403?'ACCESS_REJECTED':'SERVER_ERROR');
  const text=await response.text();if(text.length>2000000)fail('RESPONSE_LIMIT');record.elapsedMs=Date.now()-started;
  if(path.endsWith('/completion')){record.fin=/"event_type"\s*:\s*2003/.test(text);record.err=/"event_type"\s*:\s*2005/.test(text);Object.assign(record,businessDiagnostics(text));}
  return text;
 }catch(e){const code=e instanceof AIError?e.code:e.name==='TimeoutError'?'TIMEOUT':signal.aborted?'CANCELLED':'NETWORK_ERROR';record.error=code;throw new AIError(code);}
}
const service=new AIService({storage:chrome.storage,request:transport});
// Register ownership before any await, including requests not yet in jobs.
// Full document navigation does not reliably run content-script cleanup.
const tabRequests=new Map();
function sameFocus(source,target){
 try{const a=new URL(source),b=new URL(target),id=a.pathname.match(/^\/[^/]+\/status\/(\d+)/)?.[1];return !!id&&a.origin===b.origin&&id===b.pathname.match(/^\/[^/]+\/status\/(\d+)/)?.[1];}catch{return false;}
}
function cancelTabRequests(tabId,nextUrl){
 for(const record of tabRequests.get(tabId)||[])if(!nextUrl||!sameFocus(record.url,nextUrl))service.cancel(record.owner);
}
const ready=(async()=>{await chrome.storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});await service.init();})();
chrome.action.onClicked.addListener(()=>chrome.runtime.openOptionsPage());
function safeError(e){return {ok:false,error:e.name==='AbortError'?'CANCELLED':e instanceof AIError?e.code:'INTERNAL_ERROR'};}
async function status(){
 const connection=await service.status();
 const permission=await chrome.permissions.contains({origins:[BASE+'/*']});
 const themeMemory=await chrome.storage.session.get('aiXTheme');
 const setup=(await chrome.storage.session.get('aiSetup')).aiSetup;
 const tab=Number.isInteger(setup)?await chrome.tabs.get(setup).catch(()=>null):null;
 const setupOpen=!!(tab?.pendingUrl||tab?.url)?.startsWith(BASE+'/');
 if(Number.isInteger(setup)&&!setupOpen)await chrome.storage.session.remove('aiSetup');
 return {...connection,...(!permission?{state:'PERMISSION_REQUIRED'}:{}),setupOpen,xTheme:themeMemory.aiXTheme,checking:!!checkTask,diagnostics:stats};
}
async function auditVisibleBoundary(){
 if(!service.context)return;
 const owned=(await chrome.storage.session.get('aiSetup')).aiSetup;
 const pages=await chrome.tabs.query({url:BASE+'/*'});
 if(pages.some(t=>!t.discarded&&t.id!==owned))await service.invalidateContext();
}
async function observeVisibleBoundary(tab){
 if(!service.context||!tab?.url?.startsWith(BASE+'/')||tab.discarded)return;
 const epoch=service.epoch,context=service.context;
 const owned=(await chrome.storage.session.get('aiSetup')).aiSetup;
 // The event already established this page existed. A later query may miss a
 // page that immediately navigated away or closed; keep the observed boundary.
 if(tab.id!==owned&&epoch===service.epoch&&context===service.context)await service.invalidateContext();
}
function openSetup(){
 return setupOpening??=(async()=>{
 if(!await chrome.permissions.contains({origins:[BASE+'/*']}))fail('PERMISSION_REQUIRED');
 const old=(await chrome.storage.session.get('aiSetup')).aiSetup;
 if(Number.isInteger(old)){
  try{const t=await chrome.tabs.get(old);if((t.pendingUrl||t.url)?.startsWith(BASE+'/')){await chrome.tabs.update(old,{active:true});return status();}}catch{/* closed */}
 }
 const tab=await chrome.tabs.create({url:BASE+'/chat/',active:true});await chrome.storage.session.set({aiSetup:tab.id});return status();
 })().finally(()=>{setupOpening=null;});
}
function maybeAutoRestore(){
 return autoStarting??=(async()=>{
 await ready;
 const preferences=await service.preferences();
 if(['LOGIN_REQUIRED','VERIFICATION_REQUIRED'].includes(service.error))return;
 if((!preferences.summary&&!preferences.mindmap)||service.context||!service.connection.enabled||!await chrome.permissions.contains({origins:[BASE+'/*']}))return;
 const memory=await chrome.storage.session.get(['aiAutoAttempted','aiAutoRestore']);
 if(memory.aiAutoAttempted)return;
 await chrome.storage.session.set({aiAutoAttempted:true,aiAutoRestore:true});
 await openSetup();
 const id=(await chrome.storage.session.get('aiSetup')).aiSetup;
 const tab=Number.isInteger(id)?await chrome.tabs.get(id).catch(()=>null):null;
 if(tab?.status==='complete')await finishAutoRestore();
 })().finally(()=>{autoStarting=null;});
}
async function finishAutoRestore(){
 if(autoRestoring)return autoRestoring;
 if(!(await chrome.storage.session.get('aiAutoRestore')).aiAutoRestore)return;
 autoRestoring=check({capture:true}).catch(()=>{}).finally(async()=>{await chrome.storage.session.remove('aiAutoRestore');autoRestoring=null;});return autoRestoring;
}
function waitForSetupPage(id,signal){
 return new Promise((resolve,reject)=>{
  let done=false;
  const finish=(tab,error)=>{if(done)return;done=true;clearTimeout(timer);chrome.tabs.onUpdated.removeListener(updated);chrome.tabs.onRemoved.removeListener(removed);signal?.removeEventListener('abort',cancel);error?reject(new AIError(error)):resolve(tab);};
  const examine=tab=>{
   if(!(tab?.pendingUrl||tab?.url)?.startsWith(BASE+'/'))return finish(null,'SETUP_PAGE_CHANGED');
   if(tab.status==='complete'&&tab.url?.startsWith(BASE+'/'))finish(tab);
  };
  const updated=(tabId,change,tab)=>{if(tabId===id)examine(tab);};
  const removed=tabId=>{if(tabId===id)finish(null,'SETUP_PAGE_CHANGED');};
  const cancel=()=>finish(null,'CANCELLED');
  const timer=setTimeout(()=>finish(null,'TIMEOUT'),20000);
  chrome.tabs.onUpdated.addListener(updated);chrome.tabs.onRemoved.addListener(removed);signal?.addEventListener('abort',cancel,{once:true});
  if(signal?.aborted)return cancel();
  // Install lifecycle listeners before reading the current state, so a
  // completion between the first status check and capture cannot be missed.
  chrome.tabs.get(id).then(examine,()=>finish(null,'SETUP_PAGE_CHANGED'));
 });
}
async function captureParams(signal){
 const id=(await chrome.storage.session.get('aiSetup')).aiSetup;if(!Number.isInteger(id))fail('NEEDS_INITIALIZATION');
 await waitForSetupPage(id,signal);
 const results=await chrome.scripting.executeScript({target:{tabId:id},world:'MAIN',func:async(keys)=>{
  if(location.origin!=='https://www.doubao.com')return {error:'WRONG_ORIGIN'};
  const latest=()=>performance.getEntriesByType('resource').filter(e=>{try{const u=new URL(e.name);return u.origin===location.origin&&u.pathname==='/samantha/notice/info';}catch{return false;}}).at(-1);
  let entry=latest();
  if(!entry)entry=await new Promise(resolve=>{
   const observer=new PerformanceObserver(()=>{const value=latest();if(value){clearTimeout(timer);observer.disconnect();resolve(value);}});
   const timer=setTimeout(()=>{observer.disconnect();resolve(null);},15000);observer.observe({type:'resource',buffered:true});
  });
  if(!entry)return {error:'NORMAL_CLIENT_REQUEST_NOT_OBSERVED'};
  const source=new URL(entry.name),params={};for(const key of keys){const value=source.searchParams.get(key);if(value!==null)params[key]=value;}
  return {params};
 },args:[PARAM_KEYS]});
 const result=results[0]?.result;if(!result?.params)fail(result?.error||'PARAMETERS_UNAVAILABLE');
 return {params:validateParams(result.params),tabId:id};
}
async function probe(params,signal){
 const body={messages:[{content_type:2001,content:JSON.stringify({text:'请只回复 OK'}),attachments:[],references:[]}],completion_option:completionOptions(),reply_id:'0',conversation_id:'0',section_id:'0',local_message_id:crypto.randomUUID(),local_conversation_id:'0'};
 const text=await transport('/samantha/chat/completion',body,signal,params),parsed=parseSSE(text);
 if(parsed.text.trim()!=='OK')fail('PROBE_OUTPUT_UNEXPECTED');
 return parsed;
}
async function check({capture=false}={}){
 if(checkTask)return checkTask.promise;
 const abort=new AbortController();
 checkTask={abort,promise:null};const current=checkTask,epoch=service.epoch,context=service.context;
 current.promise=(async()=>{
  try{
   let params,tabId;
   if(capture){({params,tabId}=await captureParams(abort.signal));}
   else {if(!service.context)fail('NEEDS_INITIALIZATION');params=service.context.params;}
   if(abort.signal.aborted||epoch!==service.epoch||context!==service.context)fail('CANCELLED');
   await probe(params,abort.signal);if(abort.signal.aborted||epoch!==service.epoch||context!==service.context)fail('CANCELLED');
   await service.connect(params); // A successful explicit check establishes a new connection partition.
   // Close only the exact, still-Doubao tab created by this connection.
   if(Number.isInteger(tabId)){
    const tab=await chrome.tabs.get(tabId).catch(()=>null);
    if(tab?.url?.startsWith(BASE+'/'))await chrome.tabs.remove(tabId);
    await chrome.storage.session.remove('aiSetup');
   }
   return status();
  }catch(e){if(!abort.signal.aborted&&e.code!=='CANCELLED')await service.setError(e.code||'NETWORK_ERROR',epoch,context);throw e;}
  finally{if(checkTask===current)checkTask=null;}
 })();return current.promise;
}
chrome.permissions.onRemoved.addListener(()=>{checkTask?.abort.abort();service.disconnect().catch(()=>{});});
async function confirmFocus(sender,m,input){
 const record={inputFocusId:input.focusId,documentFocusId:new URL(sender.url).pathname.match(/^\/[^/]+\/status\/(\d+)/)?.[1]||null,accepted:false};
 stats.focusChecks.push(record);stats.focusChecks=stats.focusChecks.slice(-20);
 if(typeof sender.documentId!=='string'||!sender.documentId||sender.documentLifecycle&&sender.documentLifecycle!=='active')fail('FOCUS_MISMATCH');
 let timer,confirmed;
 try{confirmed=await Promise.race([chrome.tabs.sendMessage(sender.tab.id,{ns:'peek-ai-v7',action:'confirmFocus',instance:m.instance},{documentId:sender.documentId,frameId:0}),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),2000);})]);}
 catch{/* Original document closed or cannot confirm ownership. */}
 finally{clearTimeout(timer);}
 record.confirmedFocusId=typeof confirmed?.focusId==='string'&&/^\d{1,25}$/.test(confirmed.focusId)?confirmed.focusId:null;
 if(confirmed?.instance!==m.instance||confirmed?.focusId!==input.focusId||confirmed?.url!==input.url)fail('FOCUS_MISMATCH');
 record.accepted=true;
}
chrome.runtime.onMessage.addListener((m,sender,respond)=>{
 if(!m||m.ns!=='peek-ai-v7'||typeof m.action!=='string'||!allowedSender(sender,chrome.runtime.id,m.action))return false;
 const owner=`${sender.tab?.id??'settings'}:${sender.documentId??sender.frameId}:${String(m.instance||'').slice(0,100)}`;
 const record=m.action==='generate'&&Number.isInteger(sender.tab?.id)?{owner,url:typeof m.input?.url==='string'?m.input.url:sender.url}:null;
 if(record){const pending=tabRequests.get(sender.tab.id)||new Set();pending.add(record);tabRequests.set(sender.tab.id,pending);}
 const release=()=>{if(!record)return;const pending=tabRequests.get(sender.tab.id);pending?.delete(record);if(!pending?.size)tabRequests.delete(sender.tab.id);};
 const dispatch=async()=>{
  await ready;
  switch(m.action){
   case 'status':if(sender.tab&&['light','dark'].includes(m.xTheme))await chrome.storage.session.set({aiXTheme:m.xTheme});return status();
   case 'preferences':return service.preferences();
   case 'savePreferences':return service.savePreferences(m.preferences);
   case 'openSettings':await chrome.runtime.openOptionsPage();return null;
   case 'openSetup':return openSetup();
   case 'connect':return service.context?check():openSetup();
   case 'capture':return check({capture:true});
   case 'check':return check();
   case 'cancelCheck':checkTask?.abort.abort();return null;
   case 'disconnect':checkTask?.abort.abort();return service.disconnect();
   case 'cancel':service.cancel(owner);return null;
   case 'cached':
   case 'generate':{
    await auditVisibleBoundary();
    if(typeof m.instance!=='string'||!/^[\w-]{1,100}$/.test(m.instance))fail('INVALID_INSTANCE');
    const input=validateInput(m.input);await confirmFocus(sender,m,input);
    if(typeof m.connectionId!=='string'||m.connectionId!==service.connection.partition)fail('CONNECTION_CHANGED');
    return m.action==='cached'?service.cached(input,m.mode):service.generate(owner,input,m.mode);
   }
   default:fail('INVALID_MESSAGE');
  }
 };
 dispatch().then(value=>respond({ok:true,value})).catch(e=>respond(safeError(e))).finally(release);return true;
});
chrome.tabs.onRemoved.addListener(tabId=>cancelTabRequests(tabId));
chrome.tabs.onUpdated.addListener((tabId,change)=>{if(change.status==='loading')cancelTabRequests(tabId);else if(change.url)cancelTabRequests(tabId,change.url);});

// Merely observe public tab lifecycle; never wake or inject a user-owned tab.
chrome.tabs.onActivated.addListener(async({tabId})=>{await ready;const t=await chrome.tabs.get(tabId).catch(()=>null);await observeVisibleBoundary(t);});
chrome.tabs.onUpdated.addListener(async(tabId,change,tab)=>{if((change.url||change.status==='complete')&&tab.url?.startsWith(BASE+'/')){await ready;await observeVisibleBoundary(tab);if(change.status==='complete')await finishAutoRestore();}});

// A single visible initialization attempt per browser memory cycle; no retry
// timer, alarms, panel polling or hidden documents keep the worker alive.
chrome.runtime.onStartup.addListener(()=>maybeAutoRestore().catch(()=>{}));
ready.then(()=>maybeAutoRestore()).catch(()=>{});
