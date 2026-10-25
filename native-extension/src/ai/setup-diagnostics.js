// Fixed, credential-free setup observations. Storage never owns business progress.
const KEY='aiSetupDiagnosticsV1',LIMIT=200,TTL=86400000;
const ORIGINS=new Set(['settings','startup','save','activate','permission_added','permission_removed']);
const STAGES=new Set(['permission_request','save_message','cancel','worker_access','worker_init','worker_ready','permission_event','restore','save','store_init','binding_permission','rules_acquire','rules_reconcile','rule_queue','rule_permission','rule_api','rule_read','rule_install','rule_remove','executor','model_probe','transport_permission','request','response_body','commit','key_write','registry_write','cleanup']);
const STATUSES=new Set(['started','success','failed','cancelled','queued','timeout','late_success','late_failed','observed','skipped']);
const ERRORS=new Set(['CANCELLED','PERMISSION_REQUIRED','CUSTOM_PERMISSION_REQUIRED','CUSTOM_RULE_TIMEOUT','CUSTOM_RULE_CONFLICT','CUSTOM_RULE_CLEANUP_REQUIRED','CUSTOM_BINDING_INVALID','CUSTOM_BINDING_UNAVAILABLE','CUSTOM_REBIND_REQUIRED','CUSTOM_AUTH','CUSTOM_FORBIDDEN','CUSTOM_ORIGIN_REJECTED','CUSTOM_ENDPOINT_NOT_FOUND','CUSTOM_MODEL_UNAVAILABLE','CUSTOM_TIMEOUT','CUSTOM_NETWORK','CUSTOM_SERVER','CUSTOM_INVALID_RESPONSE','CUSTOM_EMPTY_OUTPUT','CUSTOM_TRUNCATED','CUSTOM_STREAM_UNSUPPORTED','CUSTOM_REQUEST_REJECTED','CUSTOM_RATE_LIMITED','CUSTOM_QUOTA','CUSTOM_CHECK_IN_PROGRESS','CUSTOM_KEY_REQUIRED','CUSTOM_KEY_CLEANUP_REQUIRED','CONNECTION_CHANGED','EXTENSION_UNAVAILABLE','INTERNAL_ERROR']);
const id=v=>typeof v==='string'&&/^[-\w]{1,100}$/.test(v);
const number=v=>Number.isFinite(v)&&v>=0;
const OPTIONAL=['granted','dnrGranted','apiAvailable','checking','stalled','policy','errorCode'];
function details(value={}){
 const result={};
 for(const name of OPTIONAL.slice(0,5))if(typeof value[name]==='boolean')result[name]=value[name];
 if(['standard','yuanjing-origin'].includes(value.policy))result.policy=value.policy;
 if(value.errorCode!==undefined)result.errorCode=ERRORS.has(value.errorCode)?value.errorCode:'INTERNAL_ERROR';
 return result;
}
export function validSetupEvent(value){
 return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>['operationId','stage','status','elapsedMs','granted'].includes(k))&&id(value.operationId)&&['permission_request','save_message','cancel'].includes(value.stage)&&STATUSES.has(value.status)&&(value.elapsedMs===undefined||number(value.elapsedMs)&&value.elapsedMs<=TTL)&&(value.granted===undefined||typeof value.granted==='boolean');
}
function storedRow(value,now){
 if(!value||Object.keys(value).some(k=>!['at','elapsedMs','sequence','workerId','operationId','origin','stage','status',...OPTIONAL].includes(k))||!id(value.workerId)||!id(value.operationId)||!ORIGINS.has(value.origin)||!STAGES.has(value.stage)||!STATUSES.has(value.status)||!number(value.at)||value.at>now||now-value.at>TTL||!number(value.elapsedMs)||value.elapsedMs>TTL||!Number.isSafeInteger(value.sequence)||value.sequence<1)return null;
 return {at:value.at,elapsedMs:value.elapsedMs,sequence:value.sequence,workerId:value.workerId,operationId:value.operationId,origin:value.origin,stage:value.stage,status:value.status,...details(value)};
}
export function createSetupDiagnostics({storage,storageReady=Promise.resolve(),clock=()=>Date.now(),workerId=crypto.randomUUID()}={}){
 let rows=[],sequence=0,revision=0,loaded=false,storageAllowed=false,loading,writing=false,scheduled=false,cleared=false,persistence='loading';
 const prune=()=>{const now=clock();rows=rows.filter(r=>now-r.at<=TTL&&r.at<=now).slice(-LIMIT);};
 function schedule(){
  if(!loaded||writing||scheduled)return;scheduled=true;
  Promise.resolve().then(async()=>{
   scheduled=false;writing=true;prune();const at=revision;
   try{await storage.set({[KEY]:{schema:1,events:rows.map(r=>({...r}))}});persistence='ready';}
   catch{persistence='unavailable';}
   finally{writing=false;if(at!==revision)schedule();}
  });
 }
 const load=()=>loading??=(async()=>{
  try{await storageReady;storageAllowed=true;const data=await storage.get(KEY),now=clock();const history=!cleared&&data?.[KEY]?.schema===1&&Array.isArray(data[KEY].events)?data[KEY].events.slice(-LIMIT).map(r=>storedRow(r,now)).filter(Boolean):[];rows=[...history,...rows];persistence='ready';}
  catch{persistence='unavailable';}
  loaded=storageAllowed;prune();schedule();
 })();
 function append(origin,operationId,stage,status,elapsedMs,extra){
  if(!ORIGINS.has(origin)||!id(operationId)||!STAGES.has(stage)||!STATUSES.has(status))return;
  rows.push({at:clock(),elapsedMs:Math.min(TTL,Math.max(0,Math.round(elapsedMs))),sequence:++sequence,workerId,operationId,origin,stage,status,...details(extra)});prune();revision++;schedule();
 }
 return {load,
  trace(origin,operationId=crypto.randomUUID()){const start=clock();return {event:(stage,status,extra)=>append(origin,operationId,stage,status,clock()-start,extra)};},
  record(value){if(!validSetupEvent(value))return false;append('settings',value.operationId,value.stage,value.status,value.elapsedMs||0,value);return true;},
  snapshot(){const before=rows.length;prune();if(before!==rows.length){revision++;schedule();}return {schema:1,persistence,events:rows.map(r=>({...r}))};},
  clear(){rows=[];cleared=true;revision++;schedule();}
 };
}
export function diagnosticError(error){return error?.name==='AbortError'?'CANCELLED':ERRORS.has(error?.code)?error.code:'INTERNAL_ERROR';}
// Observe the original promise, without replacing it, delaying invocation or
// changing rejection/cancellation. Nothing from its value/body is serialized.
export function diagnosticCall(trace,stage,operation){
 if(!trace)return operation();trace.event(stage,'started');
 try{const value=operation();Promise.resolve(value).then(result=>trace.event(stage,'success',typeof result==='boolean'?{granted:result}:{}),error=>trace.event(stage,'failed',{errorCode:diagnosticError(error)}));return value;}
 catch(error){trace.event(stage,'failed',{errorCode:diagnosticError(error)});throw error;}
}
