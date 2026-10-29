import {diagnosticCall,diagnosticError} from './setup-diagnostics.js';
// Only the worker owns executable bindings and rule leases. No secret is captured.
import {AIError,fail} from './protocol.js';
import {prepareChatBuilder} from './custom-provider.js';
import {validateBindingDescriptor,protocolConfig,descriptorPermissions} from './transport-policy.js';
export function createBindingRuntime({transport,rules,hasPermission,onStage=()=>{}}){
 let active=null,error='CUSTOM_REBIND_REQUIRED',revision=0;
 async function prepare(config,{signal,trace}={}){
  if(signal?.aborted)fail('CANCELLED');
  const descriptor=validateBindingDescriptor(config.binding,config);
  onStage('binding_permission');if(!await diagnosticCall(trace,'binding_permission',()=>hasPermission(descriptorPermissions(descriptor))))fail('PERMISSION_REQUIRED');
  if(signal?.aborted)fail('CANCELLED');
  onStage('rules_acquire');const lease=await diagnosticCall(trace,'rules_acquire',()=>rules.acquire(descriptor,{signal,trace}));let released=false,published=false;
  const binding={descriptor,executor:null,publish(){
   if(released||signal?.aborted)fail('CANCELLED');const previous=active;active=binding;published=true;error=null;revision++;signal?.removeEventListener('abort',cancel);return previous;
  },release(){
   if(released)return Promise.resolve();released=true;binding.executor?.clear?.();signal?.removeEventListener('abort',cancel);
   return lease.release().catch(e=>{error='CUSTOM_RULE_CLEANUP_REQUIRED';throw e;});
  }};
  const cancel=()=>{if(!published)binding.release().catch(()=>{});};signal?.addEventListener('abort',cancel,{once:true});
  try{
   // Acquire registers ownership before any installation. Reconcile only
   // after the lease exists: retain live owners and clean unrelated orphans.
   onStage('rules_reconcile');await diagnosticCall(trace,'rules_reconcile',()=>rules.reconcile(null,{trace}));
   if(signal?.aborted)fail('CANCELLED');
   onStage('executor');trace?.event('executor','observed',{policy:descriptor.policyId});binding.executor=diagnosticCall(trace,'executor',()=>transport.bind(descriptor,prepareChatBuilder(protocolConfig(config)),mode=>{if(released||signal?.aborted&&!published||mode!=='probe'&&active!==binding)fail('CONNECTION_CHANGED');},trace));
   return binding;
  }catch(e){await binding.release();throw e;}
 }
 function clear(){revision++;const previous=active;active=null;error='CUSTOM_REBIND_REQUIRED';return previous;}
 async function restore(config,storeState='ready',{trace}={}){
  trace?.event('restore','started');
  const previous=clear(),at=revision;let candidate;
  try{
   if(!config){await diagnosticCall(trace,'rules_reconcile',()=>rules.reconcile(null,{trace}));error=null;trace?.event('restore','success');return;}
   if(storeState!=='ready')fail(storeState);
   validateBindingDescriptor(config.binding,config);
   if(!await hasPermission(descriptorPermissions(config.binding)))fail('PERMISSION_REQUIRED');
   candidate=await prepare(config,{trace});
   if(at!==revision)fail('CANCELLED');candidate.publish();trace?.event('restore','success');
  }catch(e){trace?.event('restore','failed',{errorCode:diagnosticError(e)});if(at===revision){error=e instanceof AIError?e.code:'CUSTOM_BINDING_UNAVAILABLE';await diagnosticCall(trace,'rules_reconcile',()=>rules.reconcile(null,{trace})).catch(()=>{});}await candidate?.release();}
  finally{await previous?.release();}
 }
 return {prepare,restore,clear,current:()=>active,state:()=>error||'ready'};
}
