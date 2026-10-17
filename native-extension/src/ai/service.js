import {AIError,fail,validateInput,md5,buildResource,buildRequest,parseSSE,classifyBusiness} from './protocol.js';
import {DEFAULTS,normalizePreferences} from './preferences.js';
export const PARAM_KEYS=['version_code','language','device_platform','doubao_device_platform','aid','real_aid','pkg_type','device_id','pc_version','doubao_pc_version','web_id','tea_uuid','region','sys_region','samantha_web','use-olympus-account'];
export function validateParams(params){
 if(!params||typeof params!=='object'||Array.isArray(params)||Object.keys(params).some(k=>!PARAM_KEYS.includes(k))||Object.values(params).some(v=>typeof v!=='string'||v.length>256||/[\r\n]/.test(v)))fail('INVALID_PARAMETERS');
 if(params.aid!=='497858')fail('APPLICATION_CHANGED');return {...params};
}
export function allowedSender(sender,id,action){
 if(sender?.id!==id)return false;
 const settings=sender.url===`chrome-extension://${id}/settings.html`;
 if(['status','preferences','savePreferences','connect','capture','disconnect','cancelCheck','check','openSetup'].includes(action)&&settings)return true;
 if(!['status','preferences','generate','cached','cancel','openSettings'].includes(action)||!Number.isInteger(sender.tab?.id)||sender.frameId!==0)return false;
 try{const u=new URL(sender.url);return u.protocol==='https:'&&['x.com','twitter.com'].includes(u.hostname);}catch{return false;}
}
const aborted=()=>new DOMException('Cancelled','AbortError');
const TTL=7*86400000;
export class AIService {
 constructor({storage,request}){this.storage=storage;this.request=request;this.jobs=new Map();this.cancelledOwners=new Map();this.resources=new Map();this.tail=Promise.resolve();this.epoch=0;this.context=null;this.connection={enabled:false,partition:''};this.cache={};this.error=null;}
 init(){return this.initialized??=(async()=>{
  const local=await this.storage.local.get(['aiConnection','aiCache']);this.connection=local.aiConnection||this.connection;this.cache=local.aiCache||{};
  const session=await this.storage.session.get('aiContext');
  if(session.aiContext?.partition===this.connection.partition&&session.aiContext?.params){try{this.context={...session.aiContext,params:validateParams(session.aiContext.params)};}catch{await this.storage.session.remove('aiContext');}}
 })();}
 async status(){await this.init();return {state:this.error||(this.context&&this.connection.enabled?'ready':this.connection.enabled?'NEEDS_INITIALIZATION':'DISCONNECTED'),checkedAt:this.context?.checkedAt||null,connectionId:this.connection.partition};}
 async preferences(){const d=await this.storage.local.get('aiPreferences');return normalizePreferences(d.aiPreferences);}
 async savePreferences(p){const value=normalizePreferences(p);await this.storage.local.set({aiPreferences:value});return value;}
 async connect(params){
  await this.init();this.clearJobs();this.epoch++;this.resources.clear();this.error=null;
  this.connection={enabled:true,partition:crypto.randomUUID()};this.context={params:validateParams(params),partition:this.connection.partition,checkedAt:Date.now()};
  await this.storage.session.set({aiContext:this.context});await this.storage.local.set({aiConnection:this.connection});return this.status();
 }
 async invalidateContext(){await this.init();this.clearJobs();this.epoch++;this.context=null;this.error='CONTEXT_CHANGED';this.resources.clear();this.connection={enabled:this.connection.enabled,partition:crypto.randomUUID()};await this.storage.session.remove('aiContext');await this.storage.local.set({aiConnection:this.connection});}
 async disconnect(){await this.init();this.clearJobs();this.epoch++;this.context=null;this.error=null;this.resources.clear();this.connection.enabled=false;await this.storage.session.remove('aiContext');await this.storage.local.set({aiConnection:this.connection});return this.status();}
 key(input,mode){return `${this.connection.partition}:${md5(JSON.stringify([input.kind,input.url,input.title,input.text,input.duration||0,input.cues||null]))}:${mode}`;}
 async cached(raw,mode){await this.init();const input=validateInput(raw),entry=this.cache[this.key(input,mode)];return entry&&Date.now()-entry.at<TTL?entry.result:null;}
 cancel(owner){this.cancelledOwners.set(owner,Date.now());for(const [id,at] of this.cancelledOwners)if(Date.now()-at>300000)this.cancelledOwners.delete(id);for(const job of this.jobs.values())if(job.owners.has(owner)){job.owners.delete(owner);for(const reject of job.rejects.get(owner)||[])reject(aborted());job.rejects.delete(owner);if(!job.owners.size)job.abort.abort();}}
 clearJobs(){for(const job of this.jobs.values()){job.abort.abort();for(const rejects of job.rejects.values())for(const reject of rejects)reject(aborted());}this.jobs.clear();}
 async generate(owner,raw,mode){
  const requestEpoch=this.epoch;const ownerCheck=()=>{if(this.cancelledOwners.has(owner)||requestEpoch!==this.epoch)throw aborted();};ownerCheck();
  await this.init();ownerCheck();const input=validateInput(raw);
  if((input.kind==='article'&&mode!=='article')||(input.kind==='video'&&!['summary','mindmap'].includes(mode)))fail('INVALID_MODE');
  const cached=await this.cached(input,mode);ownerCheck();if(cached)return {...cached,cached:true};
  const status=await this.status();ownerCheck();if(status.state!=='ready')fail(status.state);
  const key=this.key(input,mode);let job=this.jobs.get(key);
  if(job?.abort.signal.aborted){this.jobs.delete(key);job=null;}
  if(!job){
   job={abort:new AbortController(),owners:new Set(),rejects:new Map()};const epoch=this.epoch,context=this.context;
   const execute=async()=>{
    const signal=job.abort.signal,check=()=>{if(signal.aborted||epoch!==this.epoch||context!==this.context)throw aborted();};check();
    const resourceKey=this.key(input,'resource');let resource=this.resources.get(resourceKey);
    if(!resource){let response;try{response=JSON.parse(await this.request('/samantha/aireader/resource_content/create',buildResource(input),signal,context.params));}catch(e){if(e instanceof AIError||e.name==='AbortError')throw e;fail('INVALID_RESPONSE');}check();
     if(response.code!==0||!response.data?.id)fail(classifyBusiness(response.code));resource=response.data.id;this.resources.set(resourceKey,resource);
    }
    const text=await this.request('/samantha/chat/completion',buildRequest(resource,mode,input),signal,context.params);check();
    const result={...parseSSE(text,mode,input.duration),mode,createdAt:Date.now()};
    const entries=Object.entries({...this.cache,[key]:{at:Date.now(),result}}).filter(([,v])=>Date.now()-v.at<TTL).sort(([,a],[,b])=>b.at-a.at);
    const candidate={};let bytes=0;for(const [k,v] of entries){const size=new TextEncoder().encode(JSON.stringify([k,v])).length;if(Object.keys(candidate).length>=30||bytes+size>4*1024*1024)continue;candidate[k]=v;bytes+=size;}
    try{await this.storage.local.set({aiCache:candidate});check();this.cache=candidate;}
    catch(e){check();result.cacheWarning=true;}
    check();return result;
   };
   job.promise=this.tail.then(execute).catch(e=>{if(epoch===this.epoch&&context===this.context&&!job.abort.signal.aborted&&['LOGIN_REQUIRED','VERIFICATION_REQUIRED'].includes(e.code))this.error=e.code;throw e;}).finally(()=>{if(this.jobs.get(key)===job)this.jobs.delete(key);});
   this.tail=job.promise.catch(()=>{});this.jobs.set(key,job);
  }
  job.owners.add(owner);
  return new Promise((resolve,reject)=>{const list=job.rejects.get(owner)||[];list.push(reject);job.rejects.set(owner,list);job.promise.then(result=>{if(job.owners.has(owner))resolve(result);else reject(aborted());},reject);});
 }
}
