// Trusted worker state only. Public snapshots never contain a secret.
import {fail} from './protocol.js';
import {validateProviderConfig} from './custom-provider.js';
const REGISTRY='aiProvidersV8',KEYS='aiProviderKeysV8',MAX_SERVICES=20;
const cancelled=()=>fail('CANCELLED');
export class ProviderStore {
 constructor({storage,probe,onChange=()=>{},verifyPermission=async()=>true}){this.storage=storage;this.probe=probe;this.verifyPermission=verifyPermission;this.onChange=onChange;this.registry={schema:1,activeId:'doubao',services:[]};this.localKeys={};this.sessionKeys={};this.tail=Promise.resolve();}
 init(){return this.initialized??=(async()=>{
  const [local,session]=await Promise.all([this.storage.local.get([REGISTRY,KEYS]),this.storage.session.get(KEYS)]);
  // Legacy Doubao keys are deliberately untouched. Absence means Doubao;
  // this is an idempotent, additive migration and can be rolled back.
  if(local[REGISTRY]){
   const raw=local[REGISTRY];if(raw.schema!==1||!Array.isArray(raw.services)||raw.services.length>MAX_SERVICES)fail('CUSTOM_INVALID_CONFIG');
   const ids=new Set();const services=raw.services.map(s=>{
    const config=validateProviderConfig({id:s.id,name:s.name,protocol:s.protocol,baseURL:s.baseURL,model:s.model,rememberKey:s.rememberKey});
    if(!config.id||ids.has(config.id)||typeof s.version!=='string'||!/^[\w-]{1,100}$/.test(s.version))fail('CUSTOM_INVALID_CONFIG');ids.add(config.id);
    return {...config,version:s.version,checkedAt:Number.isFinite(s.checkedAt)?s.checkedAt:null};
   });
   if(raw.activeId!=='doubao'&&!ids.has(raw.activeId))fail('CUSTOM_INVALID_CONFIG');
   this.registry={schema:1,activeId:raw.activeId,services};
  }
  for(const s of this.registry.services){const key=(s.rememberKey?local[KEYS]:session[KEYS])?.[s.id];if(this.validKey(key))(s.rememberKey?this.localKeys:this.sessionKeys)[s.id]=key;}
 })();}
 validKey(key){return typeof key==='string'&&key.trim()===key&&key.length>0&&key.length<=8192&&!/[\s\u0000-\u001f\u007f]/.test(key);}
 active(){return this.registry.services.find(s=>s.id===this.registry.activeId)||null;}
 keyFor(config){const current=config&&this.registry.services.find(s=>s.id===config.id&&s.version===config.version);return current?(current.rememberKey?this.localKeys:this.sessionKeys)[current.id]||null:null;}
 identity(){const s=this.active();return s?`${s.id}:${s.version}`:'doubao';}
 list(){return {activeId:this.registry.activeId,services:this.registry.services.map(s=>({...s,hasKey:!!this.keyFor(s)}))};}
 async save(raw,key,{signal}={}){
  await this.init();const check=()=>{if(signal?.aborted)cancelled();};check();
  const config=validateProviderConfig(raw),before=this.registry,old=config.id?before.services.find(s=>s.id===config.id):null;
  if(config.id&&!old)fail('CUSTOM_INVALID_CONFIG');
  if(!old&&before.services.length>=MAX_SERVICES)fail('CUSTOM_CONFIG_LIMIT');
  if(key!==undefined&&!this.validKey(key))fail('CUSTOM_KEY_REQUIRED');
  const secret=key===undefined?this.keyFor(old):key;if(!this.validKey(secret))fail('CUSTOM_KEY_REQUIRED');
  const changed=!old||['baseURL','model','protocol'].some(k=>config[k]!==old[k])||secret!==this.keyFor(old);
  const candidate={...config,id:old?.id||crypto.randomUUID(),version:changed?crypto.randomUUID():old.version,checkedAt:Date.now()};
  await this.probe(candidate,secret,signal);check();
  return this.commit(async()=>{
   check();if(this.registry!==before)cancelled();
   if(!await this.verifyPermission(candidate))fail('PERMISSION_REQUIRED');check();
   const services=before.services.filter(s=>s.id!==candidate.id);services.push(candidate);
   const localKeys={...this.localKeys},sessionKeys={...this.sessionKeys};delete localKeys[candidate.id];delete sessionKeys[candidate.id];
   (candidate.rememberKey?localKeys:sessionKeys)[candidate.id]=secret;
   await this.persist({schema:1,activeId:candidate.id,services},localKeys,sessionKeys,check,()=>this.verifyPermission(candidate));
   return this.list();
  });
 }
 async activate(id,options={}){
  await this.init();const config=this.registry.services.find(s=>s.id===id);if(!config)fail('CUSTOM_INVALID_CONFIG');
  return this.save({id:config.id,name:config.name,protocol:config.protocol,baseURL:config.baseURL,model:config.model,rememberKey:config.rememberKey},undefined,options);
 }
 // Called only after the existing Doubao probe has succeeded. It never deletes
 // custom configurations/keys or legacy bean connection/cache records.
 async selectDoubao({signal}={}){
  await this.init();return this.commit(async()=>{
   const check=()=>{if(signal?.aborted)cancelled();};check();
   if(this.registry.activeId==='doubao')return this.list();
   await this.persist({...this.registry,activeId:'doubao'},this.localKeys,this.sessionKeys,check,()=>this.verifyPermission(null));return this.list();
  });
 }
 commit(operation){const p=this.tail.catch(()=>{}).then(operation);this.tail=p;return p;}
 async persist(registry,localKeys,sessionKeys,check,verifyPermission=async()=>true){
  const oldRegistry=this.registry,oldLocal=this.localKeys,oldSession=this.sessionKeys,previousIdentity=this.identity();
  try{
   check();await this.storage.session.set({[KEYS]:sessionKeys});check();
   await this.storage.local.set({[REGISTRY]:registry,[KEYS]:localKeys});check();
   if(!await verifyPermission())fail('PERMISSION_REQUIRED');check();
  }catch(e){
   // Chrome writes are not cancellable. Restore the last accepted transaction
   // before releasing the serialized write tail; never publish a partial save.
   await this.storage.session.set({[KEYS]:oldSession});
   await this.storage.local.set({[REGISTRY]:oldRegistry,[KEYS]:oldLocal});throw e;
  }
  this.registry=registry;this.localKeys=localKeys;this.sessionKeys=sessionKeys;
  this.onChange({invalidate:previousIdentity!==this.identity()});
 }
}
