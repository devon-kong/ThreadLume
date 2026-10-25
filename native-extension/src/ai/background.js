import {createSetupDiagnostics,diagnosticCall,diagnosticError,validSetupEvent} from './setup-diagnostics.js';
import {validPreview} from './preview.js';
import {AIService,allowedSender} from './service.js';
import {AIError,fail,validateInput,validateLanguage} from './protocol.js';
import {ProviderStore} from './provider-store.js';
import {createCustomTransport} from './custom-transport.js';
import {normalizeEndpoint} from './custom-provider.js';
import {descriptorPermissions,providerPermissions} from './transport-policy.js';
import {createNetworkRuleManager} from './network-rule-manager.js';
import {createBindingRuntime} from './binding-runtime.js';
let checkTask=null,setupOpening=null,connectionGeneration=0;
let allowDiagnosticStorage;
const setupDiagnostics=createSetupDiagnostics({storage:chrome.storage.local,storageReady:new Promise(resolve=>{allowDiagnosticStorage=resolve;})});
void setupDiagnostics.load();
const startupTrace=setupDiagnostics.trace('startup');
const stats={workerStartedAt:Date.now(),requests:0,stages:[],focusChecks:[],bindingStages:[],configuration:[]};
const BINDING_STAGES=new Set(['store_init','store_ready','prepare','probe','probe_ok','commit','binding_permission','rules_acquire','rules_reconcile','executor','rule_read','rule_install','rule_remove','transport_permission','request','response']);
const bindingStage=stage=>{if(BINDING_STAGES.has(stage)){stats.bindingStages.push({stage,at:Date.now()});stats.bindingStages=stats.bindingStages.slice(-40);}};
const hasPermission=request=>chrome.permissions.contains(request);
const customTransport=createCustomTransport({onStage:bindingStage,hasPermission:(permission,descriptor)=>hasPermission(descriptor?.policyId?descriptorPermissions(descriptor):{origins:[permission]})});
const networkRules=createNetworkRuleManager({onStage:bindingStage,extensionId:chrome.runtime.id,getDnr:()=>chrome.declarativeNetRequest,hasPermission});
const bindings=createBindingRuntime({onStage:bindingStage,transport:customTransport,rules:networkRules,hasPermission});
let bindingRevision=0,providerAdmission=0;
let service,providerCheck=null;
const providers=new ProviderStore({onStage:bindingStage,storage:chrome.storage,bindings,verifyPermission:config=>config?hasPermission(descriptorPermissions(config.binding)):Promise.resolve(false),onChange:change=>{if(change.invalidate||change.bindingChanged){service.providerChanged();if(providerCheck)cancelConnectionWork();}notifyState({connectionChanged:change.invalidate||change.bindingChanged});}});
service=new AIService({storage:chrome.storage,providers,requestCustom:(provider,key,input,mode,signal,binding,onEvent,outputLanguage)=>{if(!binding||binding!==bindings.current()||binding.descriptor.configVersion!==provider.version||binding.descriptor.keyRef!==provider.keyRef)fail('CONNECTION_CHANGED');return binding.executor.generate(key,input,mode,signal,onEvent,outputLanguage);}});
async function notifyState(extra={}){
 try{
  const preferences=await service.preferences();
  const message={ns:'peek-ai-v7',action:'stateChanged',preferences,...extra};
  // Static content-script matches do not grant privileged Tab.url access.
  // Enumerate IDs only; tabs.sendMessage addresses our already-injected scripts,
  // never another extension, a website handler, or a new injection.
  const tabs=await chrome.tabs.query({});
  await Promise.all(tabs.filter(t=>Number.isInteger(t.id)).map(t=>chrome.tabs.sendMessage(t.id,message,{frameId:0}).catch(()=>{})));
  // tabs.sendMessage cannot reach extension settings documents. Broadcast the
  // same sanitized event there so an open settings page cannot retain stale ready.
  await chrome.runtime.sendMessage?.(message).catch(()=>{});
 }catch{/* Closed documents do not own state. No retry/poll. */}
}
async function checkProvider(operation,config){
 if(providerCheck||checkTask||setupOpening)fail('CUSTOM_CHECK_IN_PROGRESS');
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
const ready=diagnosticCall(startupTrace,'worker_ready',async()=>{await diagnosticCall(startupTrace,'worker_access',()=>chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}));await diagnosticCall(startupTrace,'worker_access',()=>chrome.storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}));allowDiagnosticStorage();await diagnosticCall(startupTrace,'worker_init',()=>service.init());await bindings.restore(providers.active(),providers.bindingState(),{trace:startupTrace});});
chrome.action.onClicked.addListener(()=>chrome.runtime.openOptionsPage());
function safeError(e){return {ok:false,error:e.name==='AbortError'?'CANCELLED':e instanceof AIError?e.code:'INTERNAL_ERROR'};}
async function status(){
 const connection=await service.status();
 const custom=providers.active();
 const permission=!custom||providers.bindingState(custom)!=='ready'?true:await hasPermission(custom.binding?descriptorPermissions(custom.binding):{origins:[normalizeEndpoint(custom.baseURL).permission]});
 const themeMemory=await chrome.storage.session.get('aiXTheme');
 return {...connection,...(!permission?{state:'PERMISSION_REQUIRED'}:{}),setupOpen:false,xTheme:themeMemory.aiXTheme,checking:!!providerCheck,diagnostics:{...stats,generation:service.performanceSnapshot()}};
}

function cancelConnectionWork(){
 ++connectionGeneration;
 setupOpening?.abort.abort();checkTask?.abort.abort();
 // Keep tasks claimed until their asynchronous writes settle; no replacement
 // transaction may overtake a cancelled publication or page creation.
}
chrome.permissions.onRemoved.addListener(async()=>{
 const trace=setupDiagnostics.trace('permission_removed');trace.event('permission_event','observed',{checking:!!providerCheck});
 await diagnosticCall(trace,'worker_ready',()=>ready);
 const pending=providerCheck;if(pending?.permission&&!await hasPermission(pending.permission))pending.abort.abort();
 const custom=providers.active();
 if(custom){if(providers.bindingState(custom)!=='ready'||!await hasPermission(descriptorPermissions(custom.binding))){++bindingRevision;providerCheck?.abort.abort();service.providerChanged();await bindings.restore(custom,providers.bindingState(),{trace});notifyState({connectionChanged:true});}}
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
 let progressTimer=null,latestProgress=null,progressClosed=false,progressSequence=0;
 const deliverProgress=()=>{progressTimer=null;if(progressClosed||!latestProgress)return;
  const event=latestProgress;latestProgress=null;
  chrome.tabs.sendMessage(sender.tab.id,{ns:'peek-ai-v7',action:'generationProgress',instance:m.instance,requestId:m.requestId,mode:m.mode,connectionId:m.connectionId,outputLanguage:m.outputLanguage||'zh-CN',sequence:++progressSequence,...event},{documentId:sender.documentId,frameId:0}).catch(()=>{});
 };
 const progress=event=>{
  if(progressClosed||!m.requestId||!Number.isInteger(sender.tab?.id))return;
  if(event.stage==='partial'&&typeof event.text==='string'&&event.text.length<=12000){
   latestProgress={stage:'partial',text:event.text,...(validPreview(event.preview,m.outputLanguage||'zh-CN')?{preview:event.preview}:{}),outputLanguage:m.outputLanguage||'zh-CN'};if(!progressTimer)progressTimer=setTimeout(deliverProgress,80);
  }else if(['request','uploadStart'].includes(event.stage)){
   latestProgress={stage:'request'};deliverProgress();
  }
 };
 const release=()=>{progressClosed=true;clearTimeout(progressTimer);latestProgress=null;if(!record)return;const pending=tabRequests.get(sender.tab.id);pending?.delete(record);if(!pending?.size)tabRequests.delete(sender.tab.id);};
 const admission=bindingRevision,checkAdmission=providerAdmission,operationStarted=performance.now();
 const operationId=typeof m.operationId==='string'&&/^[\w-]{1,100}$/.test(m.operationId)?m.operationId:crypto.randomUUID();
 const setupTrace=['saveProvider','activateProvider'].includes(m.action)?setupDiagnostics.trace(m.action==='saveProvider'?'save':'activate',operationId):null;
 const setupStage=stage=>{
  if(!['background','rules','model','commit'].includes(stage)||checkAdmission!==providerAdmission)return;
  const event={ns:'peek-ai-v7',action:'providerProgress',operationId,stage,elapsedMs:Math.round(performance.now()-operationStarted)};
  stats.configuration.push({operationId,stage,elapsedMs:event.elapsedMs});stats.configuration=stats.configuration.slice(-40);
  chrome.runtime.sendMessage?.(event)?.catch(()=>{});
 };
 const storeStage=stage=>{const phase={prepare:'rules',probe:'model',commit:'commit'}[stage];if(phase)setupStage(phase);};
 const dispatch=async()=>{
  if(['recordSetupDiagnostic','getSetupDiagnostics','clearSetupDiagnostics'].includes(m.action)){
   const allowed=m.action==='recordSetupDiagnostic'?['ns','action','event']:['ns','action'];
   if(Object.keys(m).some(k=>!allowed.includes(k)))fail('INVALID_MESSAGE');
   if(m.action==='recordSetupDiagnostic'){if(!validSetupEvent(m.event))fail('INVALID_MESSAGE');setupDiagnostics.record(m.event);return null;}
   if(m.action==='clearSetupDiagnostics'){setupDiagnostics.clear();return null;}
   return setupDiagnostics.snapshot();
  }
  // Cancellation is admitted before storage/rule restoration. A save already
  // waiting for initialization must never start after its UI was dismissed.
  if(m.action==='cancelProviderCheck'){
   ++providerAdmission;const cancelled=providerCheck;providerCheck=null;cancelled?.abort.abort();return null;
  }
  if(['saveProvider','activateProvider'].includes(m.action)){if(m.operationId!==undefined&&(typeof m.operationId!=='string'||!/^[-\w]{1,100}$/.test(m.operationId)))fail('INVALID_MESSAGE');setupStage('background');setupTrace.event('save','started');}
  await diagnosticCall(setupTrace,'worker_ready',()=>ready);
  if(['saveProvider','activateProvider'].includes(m.action)&&checkAdmission!==providerAdmission)fail('CANCELLED');
  const fields={status:['xTheme'],preferences:[],savePreferences:['preferences'],setOutputLanguage:['outputLanguage'],providers:[],saveProvider:['config','key','operationId'],activateProvider:['id','operationId'],cancelProviderCheck:[],generate:['connectionId','input','mode','instance','requestId','contentMs','outputLanguage'],cached:['connectionId','input','mode','instance','requestId','contentMs','outputLanguage'],cancel:['instance'],displayed:['instance','requestId','displayMs','firstVisibleMs','firstReadableMs','renderMs','visibilityInterrupted'],openSettings:[],openSetup:[],connect:[],capture:[],check:[],cancelCheck:[],disconnect:[]};
  if(!sender.url?.startsWith('chrome-extension://')&&Object.keys(m).some(key=>!['ns','action',...(fields[m.action]||[])].includes(key)))fail('INVALID_MESSAGE');

  switch(m.action){
   case 'status':if(sender.tab&&['light','dark'].includes(m.xTheme))await chrome.storage.session.set({aiXTheme:m.xTheme});return status();
   case 'preferences':return service.preferences();
   case 'savePreferences':{const value=await service.savePreferences(m.preferences);notifyState();return value;}
   case 'setOutputLanguage':{if(Object.keys(m).some(k=>!['ns','action','outputLanguage'].includes(k)))fail('INVALID_MESSAGE');const outputLanguage=validateLanguage(m.outputLanguage);const value=await service.saveOutputLanguage(outputLanguage);notifyState();return value;}
   case 'providers':return providers.list();
   case 'saveProvider':{if(Object.keys(m).some(k=>!['ns','action','config','key','operationId'].includes(k)))fail('INVALID_MESSAGE');return checkProvider(signal=>providers.save(m.config,m.key,{signal,onStage:storeStage,trace:setupTrace}),m.config);}
   case 'activateProvider':{if(Object.keys(m).some(k=>!['ns','action','id','operationId'].includes(k)))fail('INVALID_MESSAGE');return checkProvider(signal=>providers.activate(m.id,{signal,onStage:storeStage,trace:setupTrace}),providers.registry.services.find(s=>s.id===m.id));}
   case 'cancelProviderCheck':{
    // Aborted fetch/body reads need not settle immediately. Relinquish this
    // check now so retry works; its finally is identity-guarded, and the store
    // checks the aborted signal before any late result can commit.
    const cancelled=providerCheck;providerCheck=null;cancelled?.abort.abort();return null;
   }
   case 'openSettings':await chrome.runtime.openOptionsPage();return null;
   case 'openSetup':case 'connect':case 'capture':case 'check':case 'disconnect':fail('DOUBAO_UNAVAILABLE');
   case 'cancelCheck':return null;
   case 'cancel':service.cancel(owner);return null;
   case 'displayed':return service.recordDisplay(owner,m.requestId,{visibilityInterrupted:m.visibilityInterrupted,displayMs:m.displayMs,firstVisibleMs:m.firstVisibleMs,firstReadableMs:m.firstReadableMs,renderMs:m.renderMs});
   case 'cached':
   case 'generate':{
    if(checkTask&&!providers.active())fail('BRIDGE_BUSY');
    if(typeof m.instance!=='string'||!/^[\w-]{1,100}$/.test(m.instance))fail('INVALID_INSTANCE');
    const outputLanguage=validateLanguage(m.outputLanguage);const input=validateInput(m.input);await confirmFocus(sender,m,input);
    if(admission!==bindingRevision)fail('CONNECTION_CHANGED');
    if(typeof m.connectionId!=='string'||m.connectionId!==service.activeIdentity())fail('CONNECTION_CHANGED');
    if(m.requestId!==undefined&&(typeof m.requestId!=='string'||!/^[\w-]{1,100}$/.test(m.requestId)))fail('INVALID_MESSAGE');
    if(m.contentMs!==undefined&&(typeof m.contentMs!=='number'||!Number.isFinite(m.contentMs)||m.contentMs<0||m.contentMs>600000))fail('INVALID_MESSAGE');
    return m.action==='cached'?service.cachedMeasured(owner,input,m.mode,{requestId:m.requestId,contentMs:m.contentMs,outputLanguage}):service.generate(owner,input,m.mode,{requestId:m.requestId,contentMs:m.contentMs,outputLanguage,onProgress:progress});
   }
   default:fail('INVALID_MESSAGE');
  }
 };
 dispatch().then(value=>{setupTrace?.event('save','success');respond({ok:true,value});}).catch(e=>{setupTrace?.event('save','failed',{errorCode:diagnosticError(e)});respond(safeError(e));}).finally(release);return true;
});
chrome.tabs.onRemoved.addListener(tabId=>cancelTabRequests(tabId));
chrome.tabs.onUpdated.addListener((tabId,change)=>{if(change.status==='loading')cancelTabRequests(tabId);else if(change.url)cancelTabRequests(tabId,change.url);});

chrome.permissions.onAdded?.addListener(async()=>{const trace=setupDiagnostics.trace('permission_added');trace.event('permission_event','observed',{checking:!!providerCheck});await diagnosticCall(trace,'worker_ready',()=>ready);if(providerCheck){trace.event('restore','skipped',{checking:true});return;}await bindings.restore(providers.active(),providers.bindingState(),{trace});notifyState({connectionChanged:true});});
