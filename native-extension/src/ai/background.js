import {AIService,allowedSender,validateParams,PARAM_KEYS} from './service.js';
import {AIError,fail,parseSSE,completionOptions,validateInput,businessDiagnostics} from './protocol.js';
import {ProviderStore} from './provider-store.js';
import {createCustomTransport} from './custom-transport.js';
import {normalizeEndpoint} from './custom-provider.js';
import {descriptorPermissions,providerPermissions} from './transport-policy.js';
import {createNetworkRuleManager} from './network-rule-manager.js';
import {createBindingRuntime} from './binding-runtime.js';
const BASE='https://www.doubao.com';
const PATHS=new Set(['/samantha/aireader/resource_content/create','/samantha/chat/completion']);
let checkTask=null,autoFlow=null,setupOpening=null,connectionGeneration=0,setupWrite=Promise.resolve();
// Exact pages created by this worker; tokens prevent stale cleanup after reuse.
const ownedPages=new Map();
const stats={workerStartedAt:Date.now(),requests:0,stages:[],focusChecks:[],bindingStages:[]};
const BINDING_STAGES=new Set(['store_init','store_ready','prepare','probe','probe_ok','commit','binding_permission','rules_acquire','rules_reconcile','executor','rule_read','rule_install','rule_remove','transport_permission','request','response']);
const bindingStage=stage=>{if(BINDING_STAGES.has(stage)){stats.bindingStages.push({stage,at:Date.now()});stats.bindingStages=stats.bindingStages.slice(-40);}};
async function transport(path,body,signal,params){
 if(!PATHS.has(path))fail('UNSUPPORTED_OPERATION');
 if(!await chrome.permissions.contains({origins:[BASE+'/*']}))fail('PERMISSION_REQUIRED');
 if(signal.aborted)fail('CANCELLED');
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
const hasPermission=request=>chrome.permissions.contains(request);
const customTransport=createCustomTransport({onStage:bindingStage,hasPermission:(permission,descriptor)=>hasPermission(descriptor?.policyId?descriptorPermissions(descriptor):{origins:[permission]})});
const networkRules=createNetworkRuleManager({onStage:bindingStage,extensionId:chrome.runtime.id,getDnr:()=>chrome.declarativeNetRequest,hasPermission});
const bindings=createBindingRuntime({onStage:bindingStage,transport:customTransport,rules:networkRules,hasPermission});
let bindingRevision=0;
let service,providerCheck=null;
const providers=new ProviderStore({onStage:bindingStage,storage:chrome.storage,bindings,verifyPermission:config=>hasPermission(config?descriptorPermissions(config.binding):{origins:[BASE+'/*']}),onChange:change=>{if(change.invalidate||change.bindingChanged){service.providerChanged();if(providerCheck)cancelConnectionWork();}notifyState({connectionChanged:change.invalidate||change.bindingChanged});}});
service=new AIService({storage:chrome.storage,request:transport,providers,requestCustom:(provider,key,input,mode,signal,binding)=>{if(!binding||binding!==bindings.current()||binding.descriptor.configVersion!==provider.version||binding.descriptor.keyRef!==provider.keyRef)fail('CONNECTION_CHANGED');return binding.executor.generate(key,input,mode,signal);}});
async function notifyState(extra={}){
 try{
  const preferences=await service.preferences();
  const message={ns:'peek-ai-v7',action:'stateChanged',preferences,...extra};
  // Static content-script matches do not grant privileged Tab.url access.
  // Enumerate IDs only; tabs.sendMessage addresses our already-injected scripts,
  // never another extension, a website handler, or a new injection.
  const tabs=await chrome.tabs.query({});
  await Promise.all(tabs.filter(t=>Number.isInteger(t.id)).map(t=>chrome.tabs.sendMessage(t.id,message,{frameId:0}).catch(()=>{})));
 }catch{/* Closed documents do not own state. No retry/poll. */}
}
async function checkProvider(operation,config){
 // A waking worker's read-only Doubao eligibility check is not a connection
 // transaction. Explicit custom binding preempts it before it can open a page.
 if(autoFlow?.phase==='preflight'){const previous=autoFlow;autoFlow=null;previous.abort.abort();}
 if(providerCheck||checkTask||autoFlow||setupOpening)fail('CUSTOM_CHECK_IN_PROGRESS');
 ++bindingRevision;const task={abort:new AbortController(),permission:config?providerPermissions(config.baseURL):null};providerCheck=task;
 try{return await operation(task.abort.signal);}finally{if(providerCheck===task)providerCheck=null;}
}
// Register ownership before any await, including requests not yet in jobs.
// Full document navigation does not reliably run content-script cleanup.
const tabRequests=new Map();
function sameFocus(source,target){
 try{const a=new URL(source),b=new URL(target),id=a.pathname.match(/^\/[^/]+\/status\/(\d+)/)?.[1];return !!id&&a.origin===b.origin&&id===b.pathname.match(/^\/[^/]+\/status\/(\d+)/)?.[1];}catch{return false;}
}
function cancelTabRequests(tabId,nextUrl){
 for(const record of tabRequests.get(tabId)||[])if(!nextUrl||!sameFocus(record.url,nextUrl))service.cancel(record.owner);
}
const ready=(async()=>{await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});await chrome.storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});await service.init();await bindings.restore(providers.active(),providers.bindingState());})();
chrome.action.onClicked.addListener(()=>chrome.runtime.openOptionsPage());
function safeError(e){return {ok:false,error:e.name==='AbortError'?'CANCELLED':e instanceof AIError?e.code:'INTERNAL_ERROR'};}
async function status(){
 const connection=await service.status();
 const custom=providers.active();
 const permission=custom&&providers.bindingState(custom)!=='ready'?true:await hasPermission(custom&&custom.binding?descriptorPermissions(custom.binding):{origins:[custom?normalizeEndpoint(custom.baseURL).permission:BASE+'/*']});
 const themeMemory=await chrome.storage.session.get('aiXTheme');
 const setup=(await chrome.storage.session.get('aiSetup')).aiSetup;
 const tab=Number.isInteger(setup)?await chrome.tabs.get(setup).catch(()=>null):null;
 const setupOpen=!!(tab?.pendingUrl||tab?.url)?.startsWith(BASE+'/');
 if(Number.isInteger(setup)&&!setupOpen)await clearSetup(setup);
 return {...connection,...(!permission?{state:'PERMISSION_REQUIRED'}:{}),setupOpen,xTheme:themeMemory.aiXTheme,checking:!!(checkTask||providerCheck),diagnostics:stats};
}
function currentSetupPage(){return [...ownedPages.values()].find(page=>page.generation===connectionGeneration&&!page.closing);}
function isCurrentSetup(id,marker){return id===marker||ownedPages.get(id)?.generation===connectionGeneration;}
async function auditVisibleBoundary(){
 if(providers.active()||!service.context)return;
 // A known cancelled page may still be awaiting Chrome's tab lookup/removal.
 // Finish that exact cleanup before auditing the remaining visible pages.
 await Promise.all([...ownedPages.values()].filter(page=>page.generation!==connectionGeneration&&page.closing).map(page=>page.closing.catch(()=>{})));
 if(providers.active()||!service.context)return;
 const owned=(await chrome.storage.session.get('aiSetup')).aiSetup;
 const pages=await chrome.tabs.query({url:BASE+'/*'});
 if(pages.some(t=>!t.discarded&&!isCurrentSetup(t.id,owned))){await service.invalidateContext();notifyState({connectionChanged:true});}
}
async function observeVisibleBoundary(tab){
 if(providers.active()||!service.context||!tab?.url?.startsWith(BASE+'/')||tab.discarded)return;
 const retiring=ownedPages.get(tab.id);
 if(retiring?.generation!==connectionGeneration&&retiring?.closing){await retiring.closing.catch(()=>{});if(retiring.closed)return;}
 const epoch=service.epoch,context=service.context;
 const owned=(await chrome.storage.session.get('aiSetup')).aiSetup;
 // The event already established this page existed. A later query may miss a
 // page that immediately navigated away or closed; keep the observed boundary.
 if(!isCurrentSetup(tab.id,owned)&&epoch===service.epoch&&context===service.context){await service.invalidateContext();notifyState({connectionChanged:true});}
}
// Cancellation starts before any asynchronous setup work, not at probe time.
function cancelConnectionWork(){
 ++connectionGeneration;
 autoFlow?.abort.abort();autoFlow=null;
 setupOpening?.abort.abort();setupOpening=null;
 checkTask?.abort.abort();checkTask=null;
 // Do not lose ownership when a capture/probe is still awaiting an API result.
 // Cleanup is independent of that un-cancellable result and may be adopted only
 // through the exact session marker while the old clear is still pending.
 return Promise.all([...ownedPages.values()].map(page=>closeOwnedPage(page).catch(()=>{})));
}
function assertWork(task){if(task.abort.signal.aborted||task.generation!==connectionGeneration)fail('CANCELLED');}
function writeSetup(operation){return setupWrite=setupWrite.catch(()=>{}).then(operation);}
function clearSetup(id){return writeSetup(async()=>{if((await chrome.storage.session.get('aiSetup')).aiSetup===id)await chrome.storage.session.remove('aiSetup');});}
function ownPage(id,task){const page={id,generation:task.generation};ownedPages.set(id,page);task.page=page;task.tabId=id;return page;}
function closeOwnedPage(page){
 if(!page||ownedPages.get(page.id)!==page)return Promise.resolve();
 if(page.closing)return page.closing;
 page.closing=(async()=>{
  await clearSetup(page.id);
  const tab=await chrome.tabs.get(page.id).catch(()=>null);
  // Clearing the marker can await Chrome storage. A newer explicit setup may
  // have reused this exact owned page in the meantime; its token wins.
  if(ownedPages.get(page.id)!==page)return;
  if((tab?.pendingUrl||tab?.url)?.startsWith(BASE+'/')){page.removing=true;await chrome.tabs.remove(page.id);page.closed=true;}
  if(ownedPages.get(page.id)===page)ownedPages.delete(page.id);
 })();return page.closing;
}
function openSetup(flow){
 if(setupOpening)return setupOpening.promise;
 const task=flow||{abort:new AbortController(),generation:connectionGeneration};
 setupOpening=task;
 task.openPromise=(async()=>{
 let createdPage;
 try{
  assertWork(task);
  const permission=await chrome.permissions.contains({origins:[BASE+'/*']});assertWork(task);if(!permission)fail('PERMISSION_REQUIRED');
  const old=(await chrome.storage.session.get('aiSetup')).aiSetup;assertWork(task);
  if(Number.isInteger(old)){
   const tab=await chrome.tabs.get(old).catch(()=>null);assertWork(task);
   const previous=ownedPages.get(old);
   const marked=previous||(await chrome.storage.session.get('aiSetup')).aiSetup===old;assertWork(task);
   if((tab?.pendingUrl||tab?.url)?.startsWith(BASE+'/')&&marked&&!previous?.removing){
    const page=ownPage(old,task);
    // If a cancelled clear is pending, publish the adopted marker after it.
    // Do not block opening on the old un-cancellable storage operation.
    if(previous?.closing)writeSetup(async()=>{if(ownedPages.get(old)===page){assertWork(task);await chrome.storage.session.set({aiSetup:old});}}).catch(()=>{});
    await chrome.tabs.update(old,{active:true});assertWork(task);return status();
   }
  }
  const tab=await chrome.tabs.create({url:BASE+'/chat/',active:true});createdPage=ownPage(tab.id,task);assertWork(task);
  await writeSetup(async()=>{assertWork(task);await chrome.storage.session.set({aiSetup:tab.id});});assertWork(task);
  return status();
 }catch(e){
  // tabs.create cannot be aborted. Reclaim only the exact page it created,
  // never a page looked up through a newer flow's session marker.
  if(task.abort.signal.aborted)await closeOwnedPage(createdPage||task.page).catch(()=>{});
  throw e;
 }finally{if(setupOpening===task)setupOpening=null;}
 })();
 // Keep auto flow's full lifetime distinct from the opening subtask promise.
 return task.promise=task.openPromise;
}
function maybeAutoRestore(){
 if(autoFlow)return autoFlow.restorePromise;
 const flow={abort:new AbortController(),generation:connectionGeneration,phase:'preflight'};autoFlow=flow;
 flow.restorePromise=(async()=>{
  await ready;assertWork(flow);if(providers.active())return;const epoch=service.epoch;
  const active=()=>{assertWork(flow);if(epoch!==service.epoch)fail('CANCELLED');};
  const preferences=await service.preferences();active();
  if(['LOGIN_REQUIRED','VERIFICATION_REQUIRED'].includes(service.error))return;
  const permission=await chrome.permissions.contains({origins:[BASE+'/*']});active();
  if((!preferences.summary&&!preferences.mindmap)||service.context||!service.connection.enabled||!permission)return;
  const memory=await chrome.storage.session.get('aiAutoAttempted');active();if(memory.aiAutoAttempted)return;
  // Chrome storage writes cannot be cancelled. Claim the transaction before
  // its first side effect so a custom check cannot strand the attempted flag.
  flow.phase='connecting';
  await chrome.storage.session.set({aiAutoAttempted:true});active();
  await openSetup(flow);active();
  await check({capture:true,flow});
 })().finally(()=>{if(autoFlow===flow)autoFlow=null;});return flow.restorePromise;
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
async function captureParams(signal,ownedId){
 const id=ownedId??(await chrome.storage.session.get('aiSetup')).aiSetup;if(signal.aborted)fail('CANCELLED');if(!Number.isInteger(id))fail('NEEDS_INITIALIZATION');
 await waitForSetupPage(id,signal);if(signal.aborted)fail('CANCELLED');
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
 if(signal.aborted)fail('CANCELLED');
 const result=results[0]?.result;if(!result?.params)fail(result?.error||'PARAMETERS_UNAVAILABLE');
 return {params:validateParams(result.params),tabId:id};
}
async function probe(params,signal){
 const body={messages:[{content_type:2001,content:JSON.stringify({text:'请只回复 OK'}),attachments:[],references:[]}],completion_option:completionOptions(),reply_id:'0',conversation_id:'0',section_id:'0',local_message_id:crypto.randomUUID(),local_conversation_id:'0'};
 const text=await transport('/samantha/chat/completion',body,signal,params),parsed=parseSSE(text);
 if(parsed.text.trim()!=='OK')fail('PROBE_OUTPUT_UNEXPECTED');
 return parsed;
}
async function check({capture=false,flow}={}){
 if(flow)assertWork(flow);
 if(checkTask)return checkTask.promise;
 const abort=flow?.abort||new AbortController();
 checkTask={abort,generation:flow?.generation??connectionGeneration,promise:null};const current=checkTask,epoch=service.epoch,context=service.context,errorRevision=service.errorRevision,switching=!!providers.active();
 current.promise=(async()=>{
  try{
   let params,tabId;
   assertWork(current);
   if(capture){
    const id=flow?.tabId??currentSetupPage()?.id??(await chrome.storage.session.get('aiSetup')).aiSetup;assertWork(current);
    if(Number.isInteger(id))current.page=ownedPages.get(id)||ownPage(id,current);
    ({params,tabId}=await captureParams(abort.signal,id));
   }
   else {if(!service.context)fail('NEEDS_INITIALIZATION');params=service.context.params;}
   assertWork(current);if(epoch!==service.epoch||context!==service.context)fail('CANCELLED');
   await probe(params,abort.signal);assertWork(current);if(epoch!==service.epoch||context!==service.context)fail('CANCELLED');
   // Cleanup is still cancellable preparation. Never select a provider before
   // an uncancellable tabs/storage cleanup that can later return CANCELLED.
   if(switching&&Number.isInteger(tabId))await closeOwnedPage(current.page);
   assertWork(current);if(epoch!==service.epoch||context!==service.context)fail('CANCELLED');
   if(capture)await service.connect(params,{signal:abort.signal});
   else await service.recheck(context,epoch,errorRevision);
   if(switching){assertWork(current);await providers.selectDoubao({signal:abort.signal});}
   // Current-Doubao rechecks have committed successfully. Late cancellation or
   // cleanup failure cannot relabel that committed outcome as a failed switch.
   if(!switching&&Number.isInteger(tabId))await closeOwnedPage(current.page).catch(()=>{});
   notifyState({connectionChanged:true});return status();
  }catch(e){if(!abort.signal.aborted&&e.name!=='AbortError'&&e.code!=='CANCELLED')await service.setError(e.code||'NETWORK_ERROR',epoch,context);throw e;}
  finally{if(checkTask===current)checkTask=null;}
 })();return current.promise;
}
chrome.permissions.onRemoved.addListener(async()=>{
 await ready;
 const pending=providerCheck;if(pending?.permission&&!await hasPermission(pending.permission))pending.abort.abort();
 const custom=providers.active();
 if(custom){if(providers.bindingState(custom)!=='ready'||!await hasPermission(descriptorPermissions(custom.binding))){++bindingRevision;providerCheck?.abort.abort();service.providerChanged();await bindings.restore(custom,providers.bindingState());notifyState({connectionChanged:true});}}
 else if(!await chrome.permissions.contains({origins:[BASE+'/*']})){const disconnected=service.disconnect();cancelConnectionWork();await disconnected;notifyState({connectionChanged:true});}
});
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
 const admission=bindingRevision;
 const dispatch=async()=>{
  await ready;
  const fields={status:['xTheme'],preferences:[],savePreferences:['preferences'],providers:[],saveProvider:['config','key'],activateProvider:['id'],cancelProviderCheck:[],generate:['connectionId','input','mode','instance'],cached:['connectionId','input','mode','instance'],cancel:['instance'],openSettings:[],openSetup:[],connect:[],capture:[],check:[],cancelCheck:[],disconnect:[]};
  if(!sender.url?.startsWith('chrome-extension://')&&Object.keys(m).some(key=>!['ns','action',...(fields[m.action]||[])].includes(key)))fail('INVALID_MESSAGE');
  if(providerCheck&&['connect','openSetup','capture','check'].includes(m.action))fail('CUSTOM_CHECK_IN_PROGRESS');
  switch(m.action){
   case 'status':if(sender.tab&&['light','dark'].includes(m.xTheme))await chrome.storage.session.set({aiXTheme:m.xTheme});return status();
   case 'preferences':return service.preferences();
   case 'savePreferences':{const value=await service.savePreferences(m.preferences);notifyState();return value;}
   case 'providers':return providers.list();
   case 'saveProvider':{if(Object.keys(m).some(k=>!['ns','action','config','key'].includes(k)))fail('INVALID_MESSAGE');return checkProvider(signal=>providers.save(m.config,m.key,{signal}),m.config);}
   case 'activateProvider':{if(Object.keys(m).some(k=>!['ns','action','id'].includes(k)))fail('INVALID_MESSAGE');return checkProvider(signal=>providers.activate(m.id,{signal}),providers.registry.services.find(s=>s.id===m.id));}
   case 'cancelProviderCheck':{
    // Aborted fetch/body reads need not settle immediately. Relinquish this
    // check now so retry works; its finally is identity-guarded, and the store
    // checks the aborted signal before any late result can commit.
    const cancelled=providerCheck;providerCheck=null;cancelled?.abort.abort();return null;
   }
   case 'openSettings':await chrome.runtime.openOptionsPage();return null;
   case 'openSetup':return openSetup();
   case 'connect':return !providers.active()&&service.context?check():openSetup();
   case 'capture':return check({capture:true});
   case 'check':return providers.active()?openSetup():check();
   case 'cancelCheck':cancelConnectionWork();return null;
   case 'disconnect':{providerCheck?.abort.abort();const disconnected=service.disconnect();await cancelConnectionWork();const result=await disconnected;notifyState({connectionChanged:true});return result;}
   case 'cancel':service.cancel(owner);return null;
   case 'cached':
   case 'generate':{
    await auditVisibleBoundary();
    if(typeof m.instance!=='string'||!/^[\w-]{1,100}$/.test(m.instance))fail('INVALID_INSTANCE');
    const input=validateInput(m.input);await confirmFocus(sender,m,input);
    if(admission!==bindingRevision)fail('CONNECTION_CHANGED');
    if(typeof m.connectionId!=='string'||m.connectionId!==service.activeIdentity())fail('CONNECTION_CHANGED');
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
chrome.tabs.onUpdated.addListener(async(tabId,change,tab)=>{if((change.url||change.status==='complete')&&tab.url?.startsWith(BASE+'/')){await ready;await observeVisibleBoundary(tab);}});

// A single visible initialization attempt per browser memory cycle; no retry
// timer, alarms, panel polling or hidden documents keep the worker alive.
chrome.runtime.onStartup.addListener(()=>maybeAutoRestore().catch(()=>{}));
ready.then(()=>maybeAutoRestore()).catch(()=>{});

chrome.permissions.onAdded?.addListener(async()=>{await ready;if(providerCheck)return;await bindings.restore(providers.active(),providers.bindingState());notifyState({connectionChanged:true});});
