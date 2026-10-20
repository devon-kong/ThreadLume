// Trusted worker state only. Immutable versioned Key records precede the single
// registry commit pointer. Recovery never depends on the dying worker's finally.
import {fail} from './protocol.js';
import {validateProviderConfig} from './custom-provider.js';
import {createBindingDescriptor,validateBindingDescriptor,protocolConfig} from './transport-policy.js';
const REGISTRY='aiProvidersV8',LEGACY_KEYS='aiProviderKeysV8',MAX_SERVICES=20;
export const KEY_PREFIX='aiProviderKeyV9:';
const cancelled=()=>fail('CANCELLED');
export class ProviderStore {
 constructor({storage,probe,onChange=()=>{},verifyPermission=async()=>true,bindings,onStage=()=>{}}){
  Object.assign(this,{storage,probe,onChange,verifyPermission,bindings,onStage});this.registry={schema:2,activeId:'doubao',services:[]};this.records={local:{},session:{}};this.tail=Promise.resolve();this.descriptorStates=new WeakMap();
 }
 init(){return this.initialized??=(async()=>{
  const [local,session]=await Promise.all([this.storage.local.get(null),this.storage.session.get(null)]);
  for(const [location,values] of [['local',local],['session',session]])for(const [key,value] of Object.entries(values))if(key.startsWith(KEY_PREFIX))this.records[location][key.slice(KEY_PREFIX.length)]=value;
  const raw=local[REGISTRY];if(!raw){await this.collectKeys();return;}
  if(![1,2].includes(raw.schema)||!Array.isArray(raw.services)||raw.services.length>MAX_SERVICES)fail('CUSTOM_INVALID_CONFIG');
  const ids=new Set();const services=raw.services.map(s=>{
   const config=validateProviderConfig(protocolConfig(s));
   if(!config.id||ids.has(config.id)||typeof s.version!=='string'||!/^[\w-]{1,100}$/.test(s.version))fail('CUSTOM_INVALID_CONFIG');ids.add(config.id);
   return {...config,version:s.version,checkedAt:Number.isFinite(s.checkedAt)?s.checkedAt:null,...(raw.schema===2?{keyRef:s.keyRef,binding:s.binding}: {})};
  });
  if(raw.activeId!=='doubao'&&!ids.has(raw.activeId))fail('CUSTOM_INVALID_CONFIG');
  if(raw.schema===1){
   for(const c of services){
    c.keyRef=crypto.randomUUID();c.binding=null;
    // Legacy ID-only records cannot prove which config version owns the Key:
    // a dead old worker may have staged a different Key before its registry.
    // Preserve it for an explicit rebind, never certify it during recovery.
    const secret=(c.rememberKey?local:session)[LEGACY_KEYS]?.[c.id];
    if(this.validKey(secret))await this.stageKey(c,secret);
   }
   // All referenced records exist before changing the pointer. A crash before
   // this write leaves schema=1 intact; a crash after it can restore schema=2.
   await this.storage.local.set({[REGISTRY]:{schema:2,activeId:raw.activeId,services}});
  }
  this.registry={schema:2,activeId:raw.activeId,services};
  for(const c of services)this.bindingState(c);
  await this.collectKeys();
 })();}
 validKey(key){return typeof key==='string'&&key.trim()===key&&key.length>0&&key.length<=8192&&!/[\s\u0000-\u001f\u007f]/.test(key);}
 active(){return this.registry.services.find(s=>s.id===this.registry.activeId)||null;}
 bindingState(c=this.active()){
  if(!c)return 'ready';if(c===this.active()&&this.cleanupError)return this.cleanupError;
  if(!this.descriptorStates.has(c)){let state='ready';try{if(!c.binding)state='CUSTOM_REBIND_REQUIRED';else validateBindingDescriptor(c.binding,c);}catch{state='CUSTOM_BINDING_INVALID';}this.descriptorStates.set(c,state);}
  if(this.descriptorStates.get(c)!=='ready')return this.descriptorStates.get(c);
  const record=this.records[c.rememberKey?'local':'session'][c.keyRef];
  if(!record)return 'CUSTOM_KEY_REQUIRED';
  if(record.providerId!==c.id||record.configVersion!==c.version||record.keyRef!==c.keyRef||record.keyLocation!==(c.rememberKey?'local':'session')||!this.validKey(record.secret))return 'CUSTOM_BINDING_INVALID';
  return 'ready';
 }
 ownedKey(c){const r=c&&this.records[c.rememberKey?'local':'session'][c.keyRef];return r&&r.providerId===c.id&&r.configVersion===c.version&&r.keyRef===c.keyRef&&r.keyLocation===(c.rememberKey?'local':'session')&&this.validKey(r.secret)?r.secret:null;}
 keyFor(c){return c&&this.bindingState(c)==='ready'?this.ownedKey(c):null;}
 identity(){const s=this.active();return s?`${s.id}:${s.version}`:'doubao';}
 list(){return {activeId:this.registry.activeId,services:this.registry.services.map(s=>({...protocolConfig(s),version:s.version,checkedAt:s.checkedAt,hasKey:!!this.ownedKey(s)}))};}
 async stageKey(c,secret){
  const location=c.rememberKey?'local':'session',record={providerId:c.id,configVersion:c.version,keyRef:c.keyRef,keyLocation:location,secret};
  await this.storage[location].set({[KEY_PREFIX+c.keyRef]:record});this.records[location][c.keyRef]=record;
 }
 async collectKeys(){
  try{
  // Only after a durable pointer, never during preparation. Current configs
  // (including invalid ones) retain their referenced records for recovery.
  for(const location of ['local','session']){
   const referenced=new Set(this.registry.services.filter(c=>(c.rememberKey?'local':'session')===location).map(c=>c.keyRef));
   for(const ref of Object.keys(this.records[location]))if(!referenced.has(ref)){await this.storage[location].remove(KEY_PREFIX+ref);delete this.records[location][ref];}
   // Legacy duplicates may be removed only after the versioned pointer exists.
   await this.storage[location].remove(LEGACY_KEYS);
  }
  this.cleanupError=null;
  }catch{this.cleanupError='CUSTOM_KEY_CLEANUP_REQUIRED';}
 }
 async save(raw,key,{signal}={}){
  this.onStage('store_init');await this.init();this.onStage('store_ready');const check=()=>{if(signal?.aborted)cancelled();};check();
  const config=validateProviderConfig(raw),before=this.registry,old=config.id?before.services.find(s=>s.id===config.id):null;
  if(config.id&&!old)fail('CUSTOM_INVALID_CONFIG');if(!old&&before.services.length>=MAX_SERVICES)fail('CUSTOM_CONFIG_LIMIT');
  if(key!==undefined&&!this.validKey(key))fail('CUSTOM_KEY_REQUIRED');
  // Editing an invalid descriptor can reuse only a record with exact config
  // ownership; it never borrows another config/version or a legacy ID-only Key.
  const oldRecord=old&&this.records[old.rememberKey?'local':'session'][old.keyRef];
  const owned=oldRecord&&oldRecord.providerId===old.id&&oldRecord.configVersion===old.version&&oldRecord.keyRef===old.keyRef&&oldRecord.keyLocation===(old.rememberKey?'local':'session')&&this.validKey(oldRecord.secret)?oldRecord.secret:null;
  const secret=key===undefined?owned:key;if(!this.validKey(secret))fail('CUSTOM_KEY_REQUIRED');
  const changed=!old||!old.binding||this.descriptorStates.get(old)!=='ready'||['baseURL','model','protocol'].some(k=>config[k]!==old[k])||secret!==owned;
  let candidate={...config,id:old?.id||crypto.randomUUID(),version:changed?crypto.randomUUID():old.version,checkedAt:Date.now(),keyRef:crypto.randomUUID()};
  candidate.binding=createBindingDescriptor(candidate,candidate.keyRef);
  if(old?.binding&&(old.binding.policyId!==candidate.binding.policyId||old.binding.policyVersion!==candidate.binding.policyVersion)){candidate={...candidate,version:crypto.randomUUID()};candidate.binding=createBindingDescriptor(candidate,candidate.keyRef);}
  this.descriptorStates.set(candidate,'ready');
  let prepared,published=false;
  try{
   this.onStage('prepare');prepared=await this.bindings?.prepare(candidate,{signal});check();
   this.onStage('probe');await (prepared?prepared.executor.probe(secret,signal):this.probe(candidate,secret,signal));check();this.onStage('probe_ok');
   this.onStage('commit');return await this.commit(async()=>{
    check();if(this.registry!==before)cancelled();if(!await this.verifyPermission(candidate))fail('PERMISSION_REQUIRED');check();
    const registry={schema:2,activeId:candidate.id,services:[...before.services.filter(s=>s.id!==candidate.id),candidate]};
    // Staged records have unique refs, so old bound requests cannot see them.
    await this.stageKey(candidate,secret);check();
    try{
     await this.storage.local.set({[REGISTRY]:registry});check();
     if(!await this.verifyPermission(candidate))fail('PERMISSION_REQUIRED');check();
    }catch(e){await this.storage.local.set({[REGISTRY]:before});throw e;}
    const previousIdentity=this.identity();this.registry=registry;
    const retired=prepared?.publish();published=true;
    this.onChange({invalidate:previousIdentity!==this.identity(),bindingChanged:true});
    // Publication is final. Cleanup failures cannot turn its ACK into a failed
    // save; unreferenced records are retried on the next worker initialization.
    try{await retired?.release();}catch{/* Runtime exposes a fixed cleanup state. */}await this.collectKeys();
    return this.list();
   });
  }finally{if(!published){try{await prepared?.release();}finally{const location=candidate.rememberKey?'local':'session';try{await this.storage[location].remove(KEY_PREFIX+candidate.keyRef);delete this.records[location][candidate.keyRef];}catch{this.cleanupError='CUSTOM_KEY_CLEANUP_REQUIRED';}}}}
 }
 async activate(id,options={}){await this.init();const c=this.registry.services.find(s=>s.id===id);if(!c)fail('CUSTOM_INVALID_CONFIG');return this.save(protocolConfig(c),undefined,options);}
 async selectDoubao({signal}={}){
  await this.init();return this.commit(async()=>{
   const check=()=>{if(signal?.aborted)cancelled();};check();if(this.registry.activeId==='doubao')return this.list();
   const before=this.registry,registry={...before,activeId:'doubao'};
   try{await this.storage.local.set({[REGISTRY]:registry});check();if(!await this.verifyPermission(null))fail('PERMISSION_REQUIRED');check();}
   catch(e){await this.storage.local.set({[REGISTRY]:before});throw e;}
   this.registry=registry;const retired=this.bindings?.clear();this.onChange({invalidate:true,bindingChanged:true});await retired?.release();return this.list();
  });
 }
 commit(operation){const p=this.tail.catch(()=>{}).then(operation);this.tail=p;return p;}
}
