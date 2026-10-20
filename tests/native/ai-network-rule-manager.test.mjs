import {test} from 'node:test';import assert from 'node:assert/strict';
import {createNetworkRuleManager,RULE_ID,makeOriginRule} from '../../native-extension/src/ai/network-rule-manager.js';
import {createBindingDescriptor,ORIGIN_ENDPOINT} from '../../native-extension/src/ai/transport-policy.js';
const descriptor=createBindingDescriptor({id:'one',version:'v1',protocol:'chat-completions',baseURL:ORIGIN_ENDPOINT,model:'model',rememberKey:true},'ref');
function fixture(seed=[]){const rules=new Map(seed.map(r=>[r.id,r])),updates=[];const dnr={getSessionRules:async()=>[...rules.values()],updateSessionRules:async change=>{updates.push(change);for(const id of change.removeRuleIds||[])rules.delete(id);for(const rule of change.addRules||[])rules.set(rule.id,rule);}};return {rules,updates,dnr,manager:createNetworkRuleManager({extensionId:'ours',dnr,hasPermission:async()=>true})};}
test('rule is exact fixed worker POST, Origin only; sharing and late release preserve other owners',async()=>{
 const r=makeOriginRule('ours');assert.equal(r.id,RULE_ID);assert.deepEqual(r.action,{type:'modifyHeaders',requestHeaders:[{header:'Origin',operation:'remove'}]});assert.deepEqual(r.condition.initiatorDomains,['ours']);assert.deepEqual(r.condition.tabIds,[-1]);assert.deepEqual(r.condition.requestMethods,['post']);assert.deepEqual(r.condition.resourceTypes,['xmlhttprequest']);
 const re=new RegExp(r.condition.regexFilter);assert.ok(re.test(ORIGIN_ENDPOINT));for(const bad of [ORIGIN_ENDPOINT+'?q=x',ORIGIN_ENDPOINT+'/extra',ORIGIN_ENDPOINT.replace('.com/','.com:443/'),ORIGIN_ENDPOINT.replace('maas-api.','other.'),'https://x.com/chat/completions'])assert.equal(re.test(bad),false);
 const f=fixture([{id:99},{id:891019}]),a=await f.manager.acquire(descriptor),b=await f.manager.acquire(descriptor);assert.equal(f.updates.length,1);await a.release();assert.equal(f.rules.has(RULE_ID),true);await a.release();assert.equal(f.rules.has(RULE_ID),true);await b.release();assert.deepEqual([...f.rules.keys()],[99,891019]);
});
test('cancelled acquisition waiting for Chrome update cannot remove retry ownership',async()=>{
 const f=fixture();let release;const update=f.dnr.updateSessionRules;f.dnr.updateSessionRules=async v=>{if(!release)await new Promise(r=>release=r);return update(v);};const stop=new AbortController(),first=f.manager.acquire(descriptor,{signal:stop.signal});while(!release)await new Promise(r=>setTimeout(r,0));stop.abort();const second=f.manager.acquire(descriptor);release();await assert.rejects(first,/CANCELLED/);const lease=await second;assert.equal(f.rules.has(RULE_ID),true);await lease.release();assert.equal(f.rules.has(RULE_ID),false);
});
test('reconcile preserves matching session rules, restores missing, removes only exact owned orphan; conflict fails closed',async()=>{
 const f=fixture([makeOriginRule('ours'),{id:99}]);await f.manager.reconcile(descriptor);assert.equal(f.updates.length,0);const current=await f.manager.acquire(descriptor);assert.equal(f.updates.length,0);await current.release();assert.equal(f.rules.has(99),true);
 const fresh=fixture();await fresh.manager.reconcile(descriptor);assert.equal(fresh.rules.has(RULE_ID),true);
 const orphan=fixture([makeOriginRule('ours'),{id:99}]);await orphan.manager.reconcile(null);assert.deepEqual([...orphan.rules.keys()],[99]);
 const conflict=fixture([{id:RULE_ID}]);await assert.rejects(conflict.manager.reconcile(descriptor),/CUSTOM_RULE_CONFLICT/);assert.equal(conflict.updates.length,0);
});

// A never-settling Chrome mutation must fail visibly without advancing the
// underlying mutation queue. Otherwise a retry or late add can own stale rules.
test('hung Chrome update fails bounded, blocks retries, and cleans a late unowned add',async()=>{
 const rules=new Map();let finish,updates=0;
 const manager=createNetworkRuleManager({extensionId:'ours',hasPermission:async()=>true,operationTimeoutMs:15,dnr:{
  getSessionRules:async()=>[...rules.values()],
  updateSessionRules:change=>{updates++;if(change.addRules)return new Promise(resolve=>{finish=()=>{for(const r of change.addRules)rules.set(r.id,r);resolve();};});for(const id of change.removeRuleIds||[])rules.delete(id);return Promise.resolve();}
 }});
 const pending=manager.acquire(descriptor);
 const result=await Promise.race([pending.then(()=> 'resolved',e=>e.code),new Promise(r=>setTimeout(()=>r('still pending'),100))]);
 assert.equal(result,'CUSTOM_RULE_TIMEOUT');
 await assert.rejects(manager.acquire(descriptor),/CUSTOM_RULE_TIMEOUT/);
 assert.equal(updates,1);
 finish();
 for(let i=0;i<20&&rules.has(RULE_ID);i++)await new Promise(r=>setTimeout(r,0));
 assert.equal(rules.has(RULE_ID),false);
 assert.equal(updates,2);
 await assert.rejects(manager.acquire(descriptor),/CUSTOM_RULE_TIMEOUT/);
});

test('hung rule read cannot start a late mutation or block ordinary no-rule leases',async()=>{
 let finish,updates=0;
 const manager=createNetworkRuleManager({extensionId:'ours',hasPermission:async()=>true,operationTimeoutMs:15,dnr:{getSessionRules:()=>new Promise(r=>finish=r),updateSessionRules:async()=>{updates++;}}});
 const result=await Promise.race([manager.acquire(descriptor).then(()=> 'resolved',e=>e.code),new Promise(r=>setTimeout(()=>r('still pending'),100))]);
 assert.equal(result,'CUSTOM_RULE_TIMEOUT');finish([]);
 await new Promise(r=>setTimeout(r,0));assert.equal(updates,0);
 const ordinary=await manager.acquire({...descriptor,policyId:'standard'});await ordinary.release();
});
test('ordinary first binding without rule permission never reads or writes DNR',async()=>{
 let calls=0;const manager=createNetworkRuleManager({extensionId:'ours',hasPermission:async p=>!p.permissions?.length,dnr:{getSessionRules:()=>{calls++;throw Error('must not use rules');},updateSessionRules:()=>{calls++;throw Error('must not use rules');}}});await manager.reconcile(null);const lease=await manager.acquire({...descriptor,policyId:'standard'});await manager.reconcile(null);await lease.release();assert.equal(calls,0);
});
