import {AIService,allowedSender} from './service.js';
import {AIError,fail,validateInput} from './protocol.js';
import {createDoubaoBridge,DOUBAO_BRIDGE_URL} from './doubao-bridge.js';
import {ProviderStore} from './provider-store.js';
import {createCustomTransport} from './custom-transport.js';
import {normalizeEndpoint} from './custom-provider.js';
import {descriptorPermissions,providerPermissions} from './transport-policy.js';
import {createNetworkRuleManager} from './network-rule-manager.js';
import {createBindingRuntime} from './binding-runtime.js';
let checkTask=null,setupOpening=null,connectionGeneration=0;
const stats={workerStartedAt:Date.now(),requests:0,stages:[],focusChecks:[],bindingStages:[]};
const BINDING_STAGES=new Set(['store_init','store_ready','prepare','probe','probe_ok','commit','binding_permission','rules_acquire','rules_reconcile','executor','rule_read','rule_install','rule_remove','transport_permission','request','response']);
const bindingStage=stage=>{if(BINDING_STAGES.has(stage)){stats.bindingStages.push({stage,at:Date.now()});stats.bindingStages=stats.bindingStages.slice(-40);}};
const hasPermission=request=>chrome.permissions.contains(request);
const customTransport=createCustomTransport({onStage:bindingStage,hasPermission:(permission,descriptor)=>hasPermission(descriptor?.policyId?descriptorPermissions(descriptor):{origins:[permission]})});
const networkRules=createNetworkRuleManager({onStage:bindingStage,extensionId:chrome.runtime.id,getDnr:()=>chrome.declarativeNetRequest,hasPermission});
const bindings=createBindingRuntime({onStage:bindingStage,transport:customTransport,rules:networkRules,hasPermission});
let bindingRevision=0;
let service,providerCheck=null;
const doubao=createDoubaoBridge({onLost:code=>{
 if(!service)return;const wasDoubao=!providers.active();
 service.bridgeLost(code).then(()=>{if(wasDoubao&&!providers.active())notifyState({connectionChanged:true});}).catch(()=>{});
}});
const providers=new ProviderStore({onStage:bindingStage,storage:chrome.storage,bindings,verifyPermission:config=>config?hasPermission(descriptorPermissions(config.binding)):Promise.resolve(doubao.available()),onChange:change=>{if(change.invalidate||change.bindingChanged){service.providerChanged();if(providerCheck)cancelConnectionWork();}notifyState({connectionChanged:change.invalidate||change.bindingChanged});}});
service=new AIService({storage:chrome.storage,doubao,providers,requestCustom:(provider,key,input,mode,signal,binding,onEvent)=>{if(!binding||binding!==bindings.current()||binding.descriptor.configVersion!==provider.version||binding.descriptor.keyRef!==provider.keyRef)fail('CONNECTION_CHANGED');return binding.executor.generate(key,input,mode,signal,onEvent);}});
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
const ready=(async()=>{await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});await chrome.storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});await service.init();await bindings.restore(providers.active(),providers.bindingState());})();
chrome.action.onClicked.addListener(()=>chrome.runtime.openOptionsPage());
function safeError(e){return {ok:false,error:e.name==='AbortError'?'CANCELLED':e instanceof AIError?e.code:'INTERNAL_ERROR'};}
async function status(){
 const connection=await service.status();
 const custom=providers.active();
 const permission=!custom||providers.bindingState(custom)!=='ready'?true:await hasPermission(custom.binding?descriptorPermissions(custom.binding):{origins:[normalizeEndpoint(custom.baseURL).permission]});
 const themeMemory=await chrome.storage.session.get('aiXTheme');
 const setupState=await chrome.storage.session.get(['aiDoubaoBridgeSetupV1','aiDoubaoBridgeSetupPendingV1']);
 const setup=setupState.aiDoubaoBridgeSetupV1;
 const tab=Number.isInteger(setup)?await chrome.tabs.get(setup).catch(()=>null):null;
 // Other-extension URLs may be redacted without tabs permission. The marker
 // is only UI guidance; a successful authenticated Port probe proves readiness.
 const setupOpen=!!tab&&(!custom||setupState.aiDoubaoBridgeSetupPendingV1===true);
 return {...connection,...(!permission?{state:'PERMISSION_REQUIRED'}:{}),setupOpen,xTheme:themeMemory.aiXTheme,checking:!!(checkTask||providerCheck),diagnostics:{...stats,generation:service.performanceSnapshot()}};
}
function cancelConnectionWork(){
 ++connectionGeneration;
 setupOpening?.abort.abort();checkTask?.abort.abort();
 // Keep tasks claimed until their asynchronous writes settle; no replacement
 // transaction may overtake a cancelled publication or page creation.
}
function openSetup(){
 if(setupOpening)return setupOpening.promise;
 if(checkTask)fail('CUSTOM_CHECK_IN_PROGRESS');
 const task={abort:new AbortController(),generation:connectionGeneration};setupOpening=task;
 const check=()=>{if(task.abort.signal.aborted||task.generation!==connectionGeneration)fail('CANCELLED');};
 task.promise=(async()=>{
  try{
   check();
   // Only an explicit settings gesture opens this visible page. Never create
   // a hidden tab or reopen it automatically after a worker/browser restart.
   const id=(await chrome.storage.session.get('aiDoubaoBridgeSetupV1')).aiDoubaoBridgeSetupV1;check();
   if(Number.isInteger(id)){
    const tab=await chrome.tabs.get(id).catch(()=>null);check();
    if(tab){await chrome.tabs.update(id,{active:true});check();await chrome.storage.session.set({aiDoubaoBridgeSetupPendingV1:true});check();return status();}
   }
   const tab=await chrome.tabs.create({url:DOUBAO_BRIDGE_URL,active:true});
   // Preserve the exact visible page marker even on cancellation so a later
   // user action can reuse it. No user page is navigated or auto-closed.
   await chrome.storage.session.set({aiDoubaoBridgeSetupV1:tab.id,aiDoubaoBridgeSetupPendingV1:true});check();
   return status();
  }finally{if(setupOpening===task)setupOpening=null;}
 })();return task.promise;
}
async function check(){
 if(checkTask)return checkTask.promise;
 if(setupOpening)fail('CUSTOM_CHECK_IN_PROGRESS');
 const task={abort:new AbortController(),generation:connectionGeneration};checkTask=task;
 const assert=()=>{if(task.abort.signal.aborted||task.generation!==connectionGeneration)fail('CANCELLED');};
 task.promise=(async()=>{
  try{
   if(!providers.active()){
    ++bindingRevision;service.providerChanged();
    // Native cancellation must settle before an explicit connection probe.
    await service.tail;assert();
   }
   assert();const params=await doubao.probe(task.abort.signal);assert();
   // Shared service publishes only a successful native probe. Old HTTP context
   // is not accepted and custom provider configuration is never rewritten.
   await service.connect(params,{signal:task.abort.signal});assert();
   if(!doubao.available())fail('BRIDGE_CHANGED');
   await providers.selectDoubao({signal:task.abort.signal});
   await chrome.storage.session.set({aiDoubaoBridgeSetupPendingV1:false}).catch(()=>{});
   notifyState({connectionChanged:true});return status();
  }finally{if(checkTask===task)checkTask=null;}
 })();return task.promise;
}
chrome.permissions.onRemoved.addListener(async()=>{
 await ready;
 const pending=providerCheck;if(pending?.permission&&!await hasPermission(pending.permission))pending.abort.abort();
 const custom=providers.active();
 if(custom){if(providers.bindingState(custom)!=='ready'||!await hasPermission(descriptorPermissions(custom.binding))){++bindingRevision;providerCheck?.abort.abort();service.providerChanged();await bindings.restore(custom,providers.bindingState());notifyState({connectionChanged:true});}}
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
  chrome.tabs.sendMessage(sender.tab.id,{ns:'peek-ai-v7',action:'generationProgress',instance:m.instance,requestId:m.requestId,mode:m.mode,connectionId:m.connectionId,sequence:++progressSequence,...event},{documentId:sender.documentId,frameId:0}).catch(()=>{});
 };
 const progress=event=>{
  if(progressClosed||!m.requestId||!Number.isInteger(sender.tab?.id))return;
  if(event.stage==='partial'&&typeof event.text==='string'&&event.text.length<=12000){
   latestProgress={stage:'partial',text:event.text};if(!progressTimer)progressTimer=setTimeout(deliverProgress,80);
  }else if(['request','uploadStart'].includes(event.stage)){
   latestProgress={stage:'request'};deliverProgress();
  }
 };
 const release=()=>{progressClosed=true;clearTimeout(progressTimer);latestProgress=null;if(!record)return;const pending=tabRequests.get(sender.tab.id);pending?.delete(record);if(!pending?.size)tabRequests.delete(sender.tab.id);};
 const admission=bindingRevision;
 const dispatch=async()=>{
  await ready;
  const fields={status:['xTheme'],preferences:[],savePreferences:['preferences'],providers:[],saveProvider:['config','key'],activateProvider:['id'],cancelProviderCheck:[],generate:['connectionId','input','mode','instance','requestId','contentMs'],cached:['connectionId','input','mode','instance','requestId','contentMs'],cancel:['instance'],displayed:['instance','requestId','displayMs','firstVisibleMs','firstReadableMs','visibilityInterrupted'],openSettings:[],openSetup:[],connect:[],capture:[],check:[],cancelCheck:[],disconnect:[]};
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
   case 'capture':return check();
   case 'check':return providers.active()?openSetup():check();
   case 'cancelCheck':cancelConnectionWork();return null;
   case 'disconnect':{providerCheck?.abort.abort();cancelConnectionWork();const disconnected=service.disconnect();doubao.close();const result=await disconnected;notifyState({connectionChanged:true});return result;}
   case 'cancel':service.cancel(owner);return null;
   case 'displayed':return service.recordDisplay(owner,m.requestId,{visibilityInterrupted:m.visibilityInterrupted,displayMs:m.displayMs,firstVisibleMs:m.firstVisibleMs,firstReadableMs:m.firstReadableMs});
   case 'cached':
   case 'generate':{
    if(checkTask&&!providers.active())fail('BRIDGE_BUSY');
    if(typeof m.instance!=='string'||!/^[\w-]{1,100}$/.test(m.instance))fail('INVALID_INSTANCE');
    const input=validateInput(m.input);await confirmFocus(sender,m,input);
    if(admission!==bindingRevision)fail('CONNECTION_CHANGED');
    if(typeof m.connectionId!=='string'||m.connectionId!==service.activeIdentity())fail('CONNECTION_CHANGED');
    if(m.requestId!==undefined&&(typeof m.requestId!=='string'||!/^[\w-]{1,100}$/.test(m.requestId)))fail('INVALID_MESSAGE');
    if(m.contentMs!==undefined&&(typeof m.contentMs!=='number'||!Number.isFinite(m.contentMs)||m.contentMs<0||m.contentMs>600000))fail('INVALID_MESSAGE');
    return m.action==='cached'?service.cachedMeasured(owner,input,m.mode,{requestId:m.requestId,contentMs:m.contentMs}):service.generate(owner,input,m.mode,{requestId:m.requestId,contentMs:m.contentMs,onProgress:progress});
   }
   default:fail('INVALID_MESSAGE');
  }
 };
 dispatch().then(value=>respond({ok:true,value})).catch(e=>respond(safeError(e))).finally(release);return true;
});
chrome.tabs.onRemoved.addListener(tabId=>cancelTabRequests(tabId));
chrome.tabs.onUpdated.addListener((tabId,change)=>{if(change.status==='loading')cancelTabRequests(tabId);else if(change.url)cancelTabRequests(tabId,change.url);});

// Forget only our setup marker when that exact tab closes/navigates. No tab is
// automatically removed. The Port owns readiness and cancels native work.
chrome.tabs.onRemoved.addListener(async tabId=>{
 const key='aiDoubaoBridgeSetupV1';
 if((await chrome.storage.session.get(key))[key]===tabId)await chrome.storage.session.remove(key);
});
chrome.tabs.onUpdated.addListener(async(tabId,change)=>{
 if(!change.url||change.url===DOUBAO_BRIDGE_URL)return;
 const key='aiDoubaoBridgeSetupV1';
 if((await chrome.storage.session.get(key))[key]===tabId)await chrome.storage.session.remove(key);
});

chrome.permissions.onAdded?.addListener(async()=>{await ready;if(providerCheck)return;await bindings.restore(providers.active(),providers.bindingState());notifyState({connectionChanged:true});});
