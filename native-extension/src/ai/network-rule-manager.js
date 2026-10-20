// Trusted worker only. A short queue serializes rules, never model/storage work.
import {AIError,fail} from './protocol.js';
import {ORIGIN_ENDPOINT,DNR_PERMISSION,descriptorPermissions} from './transport-policy.js';
export const RULE_ID=891020;
export function makeOriginRule(extensionId){return {id:RULE_ID,priority:1,action:{type:'modifyHeaders',requestHeaders:[{header:'Origin',operation:'remove'}]},condition:{regexFilter:'^'+ORIGIN_ENDPOINT.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$',isUrlFilterCaseSensitive:true,initiatorDomains:[extensionId],tabIds:[-1],requestMethods:['post'],resourceTypes:['xmlhttprequest']}};}
const equal=(a,b)=>{
 if(a===b)return true;if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;
 const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(k=>Object.hasOwn(b,k)&&equal(a[k],b[k]));
};
export function createNetworkRuleManager({extensionId,dnr,getDnr=()=>dnr,hasPermission,onStage=()=>{},operationTimeoutMs=15000}){
 const owners=new Set(),rule=makeOriginRule(extensionId);let tail=Promise.resolve(),stalled=false;
 // Chrome mutations cannot be aborted. Bound the caller's wait, but keep the
 // real queue intact. An uncertain queue admits cleanup only until restart.
 const enqueue=(operation,cleanup=false)=>{
  if(stalled&&!cleanup)return Promise.reject(new AIError('CUSTOM_RULE_TIMEOUT'));
  const p=tail.catch(()=>{}).then(operation);tail=p;
  if(stalled){p.catch(()=>{});return Promise.reject(new AIError('CUSTOM_RULE_TIMEOUT'));}
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{stalled=true;reject(new AIError('CUSTOM_RULE_TIMEOUT'));},operationTimeoutMs);
   p.then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});
  });
 };
 async function synchronize(wanted,cleanup=false){
  if(!await hasPermission({permissions:[DNR_PERMISSION]})){if(wanted)fail('PERMISSION_REQUIRED');return;}
  if(stalled&&!cleanup)fail('CUSTOM_RULE_TIMEOUT');
  // An optional API may be absent when the Worker starts without permission.
  // Resolve it after the grant check, never cache that initial absence.
  const api=getDnr();if(!api){if(wanted)fail('PERMISSION_REQUIRED');return;}
  onStage('rule_read');const existing=(await api.getSessionRules()).find(r=>r.id===RULE_ID);
  if(existing&&!equal(existing,rule))fail('CUSTOM_RULE_CONFLICT');
  // A read may finish after its caller timed out. Never start a late install.
  if(stalled&&(!cleanup||wanted))fail('CUSTOM_RULE_TIMEOUT');
  if(wanted&&!existing){onStage('rule_install');await api.updateSessionRules({addRules:[rule]});}
  if(!wanted&&existing){onStage('rule_remove');await api.updateSessionRules({removeRuleIds:[RULE_ID]});}
 }
 async function acquire(d,{signal}={}){
  if(signal?.aborted)fail('CANCELLED');
  if(d.policyId!=='yuanjing-origin')return {release:async()=>{}};
  if(d.endpoint!==ORIGIN_ENDPOINT||d.policyVersion!==1)fail('CUSTOM_BINDING_INVALID');
  const token={};owners.add(token);let released=false,releasing;
  const release=()=>{if(released)return releasing;released=true;owners.delete(token);signal?.removeEventListener('abort',cancel);return releasing=enqueue(()=>synchronize(owners.size>0,true),true);};
  const cancel=()=>{release().catch(()=>{});};signal?.addEventListener('abort',cancel,{once:true});
  try{
   await enqueue(async()=>{if(signal?.aborted)fail('CANCELLED');if(stalled)fail('CUSTOM_RULE_TIMEOUT');if(!await hasPermission(descriptorPermissions(d)))fail('PERMISSION_REQUIRED');await synchronize(owners.size>0);});
   if(signal?.aborted)fail('CANCELLED');signal?.removeEventListener('abort',cancel);return {release};
  }catch(e){await release().catch(()=>{});throw e;}
 }
 return {acquire,reconcile:d=>enqueue(()=>synchronize(!!d&&d.policyId==='yuanjing-origin'||owners.size>0))};
}
