// Trusted worker only. A short queue serializes rules, never model/storage work.
import {fail} from './protocol.js';
import {ORIGIN_ENDPOINT,DNR_PERMISSION,descriptorPermissions} from './transport-policy.js';
export const RULE_ID=891020;
export function makeOriginRule(extensionId){return {id:RULE_ID,priority:1,action:{type:'modifyHeaders',requestHeaders:[{header:'Origin',operation:'remove'}]},condition:{regexFilter:'^'+ORIGIN_ENDPOINT.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$',isUrlFilterCaseSensitive:true,initiatorDomains:[extensionId],tabIds:[-1],requestMethods:['post'],resourceTypes:['xmlhttprequest']}};}
const equal=(a,b)=>{
 if(a===b)return true;if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;
 const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(k=>Object.hasOwn(b,k)&&equal(a[k],b[k]));
};
export function createNetworkRuleManager({extensionId,dnr,getDnr=()=>dnr,hasPermission,onStage=()=>{}}){
 const owners=new Set(),rule=makeOriginRule(extensionId);let tail=Promise.resolve();
 const enqueue=operation=>{const p=tail.catch(()=>{}).then(operation);tail=p;return p;};
 async function synchronize(wanted){
  if(!await hasPermission({permissions:[DNR_PERMISSION]})){if(wanted)fail('PERMISSION_REQUIRED');return;}
  // An optional API may be absent when the Worker starts without permission.
  // Resolve it after the grant check, never cache that initial absence.
  const api=getDnr();if(!api){if(wanted)fail('PERMISSION_REQUIRED');return;}
  onStage('rule_read');const existing=(await api.getSessionRules()).find(r=>r.id===RULE_ID);
  if(existing&&!equal(existing,rule))fail('CUSTOM_RULE_CONFLICT');
  if(wanted&&!existing){onStage('rule_install');await api.updateSessionRules({addRules:[rule]});}
  if(!wanted&&existing){onStage('rule_remove');await api.updateSessionRules({removeRuleIds:[RULE_ID]});}
 }
 async function acquire(d,{signal}={}){
  if(signal?.aborted)fail('CANCELLED');
  if(d.policyId!=='yuanjing-origin')return {release:async()=>{}};
  if(d.endpoint!==ORIGIN_ENDPOINT||d.policyVersion!==1)fail('CUSTOM_BINDING_INVALID');
  const token={};owners.add(token);let released=false;
  const release=()=>{if(released)return tail;released=true;owners.delete(token);signal?.removeEventListener('abort',cancel);return enqueue(()=>synchronize(owners.size>0));};
  const cancel=()=>{release().catch(()=>{});};signal?.addEventListener('abort',cancel,{once:true});
  try{
   await enqueue(async()=>{if(signal?.aborted)fail('CANCELLED');if(!await hasPermission(descriptorPermissions(d)))fail('PERMISSION_REQUIRED');await synchronize(owners.size>0);});
   if(signal?.aborted)fail('CANCELLED');signal?.removeEventListener('abort',cancel);return {release};
  }catch(e){await release();throw e;}
 }
 return {acquire,reconcile:d=>enqueue(()=>synchronize(!!d&&d.policyId==='yuanjing-origin'||owners.size>0))};
}
