import {AIError,fail,validateInput,md5,buildResource,buildRequest,parseSSE,classifyBusiness} from './protocol.js';
import {PROMPT_VERSION} from './custom-provider.js';
import {DEFAULTS,normalizePreferences} from './preferences.js';
import {createMetrics} from './metrics.js';
export const PARAM_KEYS=['version_code','language','device_platform','doubao_device_platform','aid','real_aid','pkg_type','device_id','pc_version','doubao_pc_version','web_id','tea_uuid','region','sys_region','samantha_web','use-olympus-account'];
export function validateParams(params){
 if(!params||typeof params!=='object'||Array.isArray(params)||Object.keys(params).some(k=>!PARAM_KEYS.includes(k))||Object.values(params).some(v=>typeof v!=='string'||v.length>256||/[\r\n]/.test(v)))fail('INVALID_PARAMETERS');
 if(params.aid!=='497858')fail('APPLICATION_CHANGED');return {...params};
}
export function allowedSender(sender,id,action){
 if(sender?.id!==id)return false;
 const settings=sender.url===`chrome-extension://${id}/settings.html`;
 if(['status','preferences','savePreferences','connect','capture','disconnect','cancelCheck','check','openSetup','providers','saveProvider','activateProvider','cancelProviderCheck'].includes(action)&&settings)return true;
 if(!['status','preferences','generate','cached','cancel','displayed','openSettings'].includes(action)||!Number.isInteger(sender.tab?.id)||sender.frameId!==0)return false;
 try{const u=new URL(sender.url);return u.protocol==='https:'&&['x.com','twitter.com'].includes(u.hostname);}catch{return false;}
}
const aborted=()=>new DOMException('Cancelled','AbortError');
const TTL=7*86400000;
const AUTH_BLOCKS=new Set(['LOGIN_REQUIRED','VERIFICATION_REQUIRED']);
const outputCharacters=result=>{
 let count=(result?.text||'').length;
 for(const h of result?.highlights||[]){count+=(h.chapter||h.title||'').length;for(const p of h.bullet_points||[])count+=(p.point||p.text||'').length;}
 const nodes=[...(result?.tree||[])];for(let i=0;i<nodes.length&&i<200;i++){count+=(nodes[i].text||'').length;nodes.push(...(nodes[i].children||[]));}
 return count;
};
export class AIService {
 constructor({storage,request,providers,requestCustom,doubao}){this.doubao=doubao;this.connectionKey=doubao?'aiDoubaoBridgeConnectionV1':'aiConnection';this.contextKey=doubao?'aiDoubaoBridgeContextV1':'aiContext';this.blockKey=doubao?'aiDoubaoBridgeBlockV1':'aiBlock';this.storage=storage;this.request=request;this.providers=providers;this.requestCustom=requestCustom;this.metrics=createMetrics({onChange:rows=>this.saveMetrics(rows)});this.jobs=new Map();this.cancelledOwners=new Map();this.resources=new Map();this.tail=Promise.resolve();this.epoch=0;this.context=null;this.connection={enabled:false,partition:''};this.cache={};this.error=null;this.errorRevision=0;this.preferenceRevision=0;this.preferencePending=0;this.modeRevision={summary:0,mindmap:0};}
 init(){return this.initialized??=(async()=>{
  await this.providers?.init();
  const local=await this.storage.local.get([this.connectionKey,'aiCache']);this.connection=local[this.connectionKey]||this.connection;this.cache=local.aiCache||{};
  const session=await this.storage.session.get([this.contextKey,this.blockKey,'aiPerformanceV12']);this.metrics.restore(session.aiPerformanceV12);
  // Restore only the same still-visible, previously probed host session.
  // A handshake is read-only: never open a page or send a model probe here.
  if(!this.doubao&&session[this.contextKey]?.partition===this.connection.partition&&session[this.contextKey]?.params){try{this.context={...session[this.contextKey],params:validateParams(session[this.contextKey].params)};}catch{await this.storage.session.remove(this.contextKey);}}
  if(session[this.blockKey]?.partition===this.connection.partition&&AUTH_BLOCKS.has(session[this.blockKey].code))this.error=session[this.blockKey].code;
  const saved=session[this.contextKey];
  if(this.doubao&&!this.providers?.active()&&this.connection.enabled&&!this.error&&saved?.partition===this.connection.partition&&saved.params){
   try{await this.doubao.restore(saved.params);this.context=saved;}catch{this.error='NEEDS_INITIALIZATION';}
  }
 })();}
 writeBlock(block,epoch=this.epoch){
  // Serialize writes and recheck ownership so old failures cannot overwrite a
  // reconnect's clear or a newer partition's block after an async storage wait.
  return this.blockWrite=(this.blockWrite||Promise.resolve()).catch(()=>{}).then(async()=>{if(epoch!==this.epoch)return;if(block)await this.storage.session.set({[this.blockKey]:block});else await this.storage.session.remove(this.blockKey);});
 }
 async setError(code,epoch=this.epoch,context=this.context){
  if(epoch!==this.epoch||context!==this.context)return;
  this.error=code;this.errorRevision++;
  if(AUTH_BLOCKS.has(code))await this.writeBlock({partition:this.connection.partition,code},epoch);
 }
 providerChanged(){this.pendingConnection?.abort.abort();this.clearJobs();this.epoch++;this.resources.clear();}
 activeIdentity(){const provider=this.providers?.active();return provider?`custom:${provider.id}:${provider.version}`:this.connection.partition;}
 async status(){await this.init();
  const provider=this.providers?.active();if(provider)return {state:this.providers.bindingState(provider)!=='ready'?this.providers.bindingState(provider):(this.providers.bindings?.state()||'ready'),checkedAt:provider.checkedAt,connectionId:this.activeIdentity(),providerId:provider.id,providerName:provider.name};
  // A storage change can be observed before connect's final publication.
  // Wait for that transaction (or cancellation), never start a probe/poll.
  for(let p=this.pendingConnection;p&&!p.signal.aborted&&p.epoch===this.epoch;p=this.pendingConnection){
   const pending=p;await new Promise(resolve=>{const done=()=>{pending.signal.removeEventListener('abort',done);resolve();};pending.signal.addEventListener('abort',done,{once:true});pending.promise.then(done,done);if(pending.signal.aborted)done();});
  }
  return {state:this.error||(this.context&&this.connection.enabled&&(!this.doubao||this.doubao.validContext(this.context.params))?'ready':this.connection.enabled?'NEEDS_INITIALIZATION':'DISCONNECTED'),checkedAt:this.context?.checkedAt||null,connectionId:this.connection.partition,providerId:'doubao',providerName:'豆包'};}
 async preferences(){
  const revision=this.preferenceRevision,d=await this.storage.local.get('aiPreferences');
  if(revision!==this.preferenceRevision||this.preferencePending)return {...this.preferenceValue};
  return this.preferenceValue=normalizePreferences(d.aiPreferences);
 }
 savePreferences(p){
  const value=normalizePreferences(p),revision=++this.preferenceRevision;
  this.preferenceValue=value;this.preferencePending++;
  for(const flag of ['summary','mindmap'])if(!value[flag])this.modeRevision[flag]++;
  for(const job of this.jobs.values())if(!this.modeEnabled(job.mode,value))this.abortJob(job);
  const save=async()=>{
   try{await this.storage.local.set({aiPreferences:value});this.confirmedPreferences=value;return value;}
   catch(e){if(revision===this.preferenceRevision){const stored=await this.storage.local.get('aiPreferences');if(revision===this.preferenceRevision)this.preferenceValue=this.confirmedPreferences||normalizePreferences(stored.aiPreferences);}throw e;}
   finally{this.preferencePending--;}
  };
  return this.preferenceWrite=(this.preferenceWrite||Promise.resolve()).catch(()=>{}).then(save);
 }
 modeEnabled(mode,p){return mode==='mindmap'?p.mindmap:p.summary;}
 abortJob(job){job.abort.abort();for(const rejects of job.rejects.values())for(const reject of rejects)reject(aborted());}
 writeContext(context,epoch=this.epoch){
  return this.contextWrite=(this.contextWrite||Promise.resolve()).catch(()=>{}).then(async()=>{if(epoch!==this.epoch||context!==this.context)return;context?await this.storage.session.set({[this.contextKey]:context}):await this.storage.session.remove(this.contextKey);});
 }
 async recheck(context,epoch,errorRevision){
  await this.init();if(!context||!this.connection.enabled||context!==this.context||epoch!==this.epoch||errorRevision!==this.errorRevision)throw aborted();
  // Keep the context object: in-flight jobs own this exact identity.
  context.checkedAt=Date.now();this.error=null;this.errorRevision++;
  await this.writeBlock(null,epoch);await this.writeContext(context,epoch);
  if(context!==this.context||epoch!==this.epoch)throw aborted();return this.status();
 }
 writeConnection(connection=this.connection,epoch=this.epoch,valid=()=>connection===this.connection){
  return this.connectionWrite=(this.connectionWrite||Promise.resolve()).catch(()=>{}).then(async()=>{if(epoch!==this.epoch||!valid())return;await this.storage.local.set({[this.connectionKey]:connection});});
 }
 async connect(params,{signal}={}){
  await this.init();if(signal?.aborted)throw aborted();this.pendingConnection?.abort.abort();
  const abort=new AbortController();signal=signal?AbortSignal.any([signal,abort.signal]):abort.signal;
  this.clearJobs();const epoch=++this.epoch;this.resources.clear();
  const connection={enabled:true,partition:crypto.randomUUID()},context={params:this.doubao?this.doubao.validateContext(params):validateParams(params),partition:connection.partition,checkedAt:Date.now()};
  const check=()=>{if(signal?.aborted||epoch!==this.epoch)throw aborted();};
  // Stage durable state under the same serialized context ownership, then
  // publish ready synchronously. An aborted Chrome storage write cannot be
  // stopped, so restore accepted state unless a newer epoch owns the cleanup.
  const commit=(this.contextWrite||Promise.resolve()).catch(()=>{}).then(async()=>{
   try{
    check();await this.storage.session.set({[this.contextKey]:context});check();
    await this.writeConnection(connection,epoch,()=>!signal?.aborted);check();
    await this.writeBlock(null,epoch);check();
    this.connection=connection;this.context=context;this.error=null;this.errorRevision++;
   }catch(e){
    if(epoch===this.epoch){
     if(this.context)await this.storage.session.set({[this.contextKey]:this.context});else await this.storage.session.remove(this.contextKey);
     await this.writeConnection(this.connection,epoch);
     await this.writeBlock(AUTH_BLOCKS.has(this.error)?{partition:this.connection.partition,code:this.error}:null,epoch);
    }
    throw e;
   }
  });this.contextWrite=commit;const pending={abort,signal,epoch,promise:commit};this.pendingConnection=pending;
  try{await commit;check();}finally{if(this.pendingConnection===pending)this.pendingConnection=null;}return this.status();
 }
 async bridgeLost(code){
  await this.init();
  if(!this.providers?.active())this.pendingConnection?.abort.abort();
  if(!this.context)return;
  // An inactive Doubao connection must not cancel the active custom provider.
  if(!this.providers?.active()){this.pendingConnection?.abort.abort();this.clearJobs();this.epoch++;}
  this.context=null;this.error=code;this.errorRevision++;this.resources.clear();
  if(!AUTH_BLOCKS.has(code))this.connection={enabled:this.connection.enabled,partition:crypto.randomUUID()};
  await this.writeBlock(AUTH_BLOCKS.has(code)?{partition:this.connection.partition,code}:null);
  await this.writeContext(null);await this.writeConnection();
 }
 async invalidateContext(){await this.init();this.pendingConnection?.abort.abort();this.clearJobs();this.epoch++;this.context=null;this.error='CONTEXT_CHANGED';this.errorRevision++;this.resources.clear();this.connection={enabled:this.connection.enabled,partition:crypto.randomUUID()};await this.writeBlock(null);await this.writeContext(null);await this.writeConnection();}
 async disconnect(){await this.init();this.pendingConnection?.abort.abort();this.clearJobs();this.epoch++;this.context=null;this.error=null;this.errorRevision++;this.resources.clear();this.connection.enabled=false;await this.writeBlock(null);await this.writeContext(null);await this.writeConnection();return this.status();}
 key(input,mode){const provider=this.providers?.active(),partition=provider?`${provider.id}:${provider.version}:${provider.model}:${PROMPT_VERSION}${provider.binding&&(provider.binding.policyId!=='standard'||provider.binding.policyVersion!==1)?':'+provider.binding.policyId+':'+provider.binding.policyVersion:''}`:this.connection.partition;return `${partition}:${md5(JSON.stringify([input.kind,input.url,input.title,input.text,input.duration||0,input.cues||null]))}:${mode}`;}
 async cached(raw,mode){const epoch=this.epoch;await this.init();if(epoch!==this.epoch)throw aborted();const input=validateInput(raw);if((input.kind==='article'&&mode!=='article')||(input.kind==='video'&&!['summary','mindmap'].includes(mode)))fail('INVALID_MODE');const provider=this.providers?.active();if(!provider&&this.doubao&&(!this.context||!this.doubao.validContext(this.context.params)))fail(this.error||'NEEDS_INITIALIZATION');if(provider){const state=this.providers.bindingState(provider)!=='ready'?this.providers.bindingState(provider):(this.providers.bindings?.state()||'ready');if(state!=='ready')fail(state);}const entry=this.cache[this.key(input,mode)];return entry&&Date.now()-entry.at<TTL?entry.result:null;}
 cancel(owner){this.cancelledOwners.set(owner,Date.now());for(const [id,at] of this.cancelledOwners)if(Date.now()-at>300000)this.cancelledOwners.delete(id);for(const job of this.jobs.values())if(job.owners.has(owner)){job.owners.delete(owner);for(const reject of job.rejects.get(owner)||[])reject(aborted());job.rejects.delete(owner);if(!job.owners.size)job.abort.abort();}}
 clearJobs(){for(const job of this.jobs.values())this.abortJob(job);this.jobs.clear();}
 performanceSnapshot(){return this.metrics.snapshot();}
 saveMetrics(rows){
  this.pendingMetrics=rows;if(this.metricsScheduled)return;this.metricsScheduled=true;
  Promise.resolve().then(()=>{this.metricsScheduled=false;const snapshot=this.pendingMetrics;
   this.metricsWrite=(this.metricsWrite||Promise.resolve()).catch(()=>{}).then(()=>this.storage.session.set({aiPerformanceV12:snapshot})).catch(()=>{});
  });
 }
 recordDisplay(owner,requestId,timing){return this.metrics.display(owner,requestId,timing);}
 async cachedMeasured(owner,raw,mode,{requestId=crypto.randomUUID(),contentMs}={}){
  const epoch=this.epoch;await this.init();if(epoch!==this.epoch)throw aborted();
  const trace=this.metrics.start(owner,requestId,{kind:raw?.kind==='video'?'video':'article',mode:['article','summary','mindmap'].includes(mode)?mode:'unknown',provider:this.providers?.active()?'custom':'doubao',providerId:this.providers?.active()?.id||'doubao',configVersion:this.providers?.active()?.version,contentMs,inputCharacters:typeof raw?.text==='string'?raw.text.length:undefined,operation:'cache'});trace.mark('admitted');
  try{const result=await this.cached(raw,mode);trace.cache(result?'hit':'miss');if(result)trace.output(outputCharacters(result));trace.finish('success');return result;}
  catch(e){trace.finish('error');throw e;}
 }
 async generate(owner,raw,mode,{requestId=crypto.randomUUID(),contentMs,onProgress=()=>{}}={}){
  const epoch=this.epoch,flag=mode==='mindmap'?'mindmap':'summary',modeRevision=this.modeRevision[flag];
  await this.init();if(epoch!==this.epoch||modeRevision!==this.modeRevision[flag]||this.cancelledOwners.has(owner))throw aborted();
  const trace=this.metrics.start(owner,requestId,{kind:raw?.kind==='video'?'video':'article',mode:['article','summary','mindmap'].includes(mode)?mode:'unknown',provider:this.providers?.active()?'custom':'doubao',providerId:this.providers?.active()?.id||'doubao',configVersion:this.providers?.active()?.version,contentMs,inputCharacters:typeof raw?.text==='string'?raw.text.length:undefined});
  trace.mark('admitted');
  try{const result=await this.generateMeasured(owner,raw,mode,trace,onProgress);trace.output(outputCharacters(result));trace.finish('success');return result;}
  catch(e){trace.finish(e.name==='AbortError'||e.code==='CANCELLED'?'cancelled':'error');throw e;}
 }
 async generateMeasured(owner,raw,mode,trace,onProgress){
  const requestEpoch=this.epoch,flag=mode==='mindmap'?'mindmap':'summary',modeRevision=this.modeRevision[flag];const ownerCheck=()=>{if(this.cancelledOwners.has(owner)||requestEpoch!==this.epoch||modeRevision!==this.modeRevision[flag])throw aborted();};ownerCheck();
  await this.init();ownerCheck();const input=validateInput(raw);
  if((input.kind==='article'&&mode!=='article')||(input.kind==='video'&&!['summary','mindmap'].includes(mode)))fail('INVALID_MODE');
  const prefs=await this.preferences();ownerCheck();if(!this.modeEnabled(mode,prefs))fail('GENERATION_DISABLED');
  const cached=await this.cached(input,mode);ownerCheck();if(cached){trace.cache('hit');return {...cached,cached:true};}
  const status=await this.status();ownerCheck();if(status.state!=='ready')fail(status.state);
  const key=this.key(input,mode);let job=this.jobs.get(key);
  if(job?.abort.signal.aborted){this.jobs.delete(key);job=null;}
  trace.mark('queued');
  if(job)trace.cache('shared');
  if(!job){
   job={id:crypto.randomUUID(),mode,abort:new AbortController(),owners:new Set(),rejects:new Map(),observers:new Set()};const epoch=this.epoch,context=this.context,provider=this.providers?.active(),binding=this.providers?.bindings?.current(),identity=this.activeIdentity();
   const emit=event=>{
    if(job.abort.signal.aborted||epoch!==this.epoch||identity!==this.activeIdentity())return;
    for(const o of job.observers)if(job.owners.has(o.owner)){
     o.trace.mark(event.stage);
     try{o.progress(event);}catch{/* A closed recipient cannot fail another owner's request. */}
    }
   };
   const execute=async()=>{
    const signal=job.abort.signal,isStale=()=>signal.aborted||epoch!==this.epoch||identity!==this.activeIdentity()||(!provider&&context!==this.context),check=()=>{if(isStale())throw aborted();};check();
    const permit=async()=>{const p=await this.preferences();check();if(!this.modeEnabled(mode,p))fail('GENERATION_DISABLED');if(!provider&&this.error)fail(this.error);};
    emit({stage:'executing'});await permit();check();
    if(!provider&&this.error)fail(this.error);
    let parsed;
    if(provider){const secret=this.providers.keyFor(provider);if(!secret)fail('CUSTOM_KEY_REQUIRED');parsed=await this.requestCustom(provider,secret,input,mode,signal,binding,emit);check();}
    else if(this.doubao){parsed=await this.doubao.generate(input,mode,signal,context.params,emit);check();}
    else {
    const resourceKey=this.key(input,'resource');let resource=this.resources.get(resourceKey);
    if(!resource){let response;emit({stage:'uploadStart'});try{response=JSON.parse(await this.request('/samantha/aireader/resource_content/create',buildResource(input),signal,context.params));}catch(e){if(e instanceof AIError||e.name==='AbortError')throw e;fail('INVALID_RESPONSE');}check();emit({stage:'uploadDone'});
     if(response.code!==0||!response.data?.id)fail(classifyBusiness(response.code));resource=response.data.id;this.resources.set(resourceKey,resource);
    }
    await permit();check();emit({stage:'request'});const text=await this.request('/samantha/chat/completion',buildRequest(resource,mode,input),signal,context.params,emit);check();
    parsed=parseSSE(text,mode,input.duration);
    }
    emit({stage:'parsed'});const result={...parsed,mode,createdAt:Date.now(),providerId:provider?.id||'doubao',providerName:provider?.name||'豆包'};
    const entries=Object.entries({...this.cache,[key]:{at:Date.now(),result}}).filter(([,v])=>Date.now()-v.at<TTL).sort(([,a],[,b])=>b.at-a.at);
    const candidate={};let bytes=0;for(const [k,v] of entries){const size=new TextEncoder().encode(JSON.stringify([k,v])).length;if(Object.keys(candidate).length>=30||bytes+size>4*1024*1024)continue;candidate[k]=v;bytes+=size;}
    emit({stage:'cacheStart'});try{await this.storage.local.set({aiCache:candidate});
     // storage.set itself cannot be cancelled. If ownership changed while it
     // was pending, restore the last accepted cache before releasing the tail.
     if(isStale()){await this.storage.local.set({aiCache:this.cache});check();}
     check();this.cache=candidate;emit({stage:'cacheSaved'});
    }catch(e){check();result.cacheWarning=true;}
    check();return result;
   };
   job.promise=this.tail.then(execute).catch(async e=>{if(!provider&&!job.abort.signal.aborted&&AUTH_BLOCKS.has(e.code))await this.setError(e.code,epoch,context);throw e;}).finally(()=>{if(this.jobs.get(key)===job)this.jobs.delete(key);});
   this.tail=job.promise.catch(()=>{});this.jobs.set(key,job);
  }
  job.owners.add(owner);trace.job(job.id);
  const observer={owner,trace,progress:onProgress};job.observers.add(observer);
  try{return await new Promise((resolve,reject)=>{const list=job.rejects.get(owner)||[];list.push(reject);job.rejects.set(owner,list);job.promise.then(result=>{if(job.owners.has(owner))resolve(result);else reject(aborted());},reject);});}
  finally{job.observers.delete(observer);}
 }
}
