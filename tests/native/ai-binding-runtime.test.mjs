import {test} from 'node:test';import assert from 'node:assert/strict';
import {createBindingRuntime} from '../../native-extension/src/ai/binding-runtime.js';
import {createCustomTransport} from '../../native-extension/src/ai/custom-transport.js';
import {ProviderStore} from '../../native-extension/src/ai/provider-store.js';
import {createNetworkRuleManager,RULE_ID} from '../../native-extension/src/ai/network-rule-manager.js';
import {ORIGIN_ENDPOINT} from '../../native-extension/src/ai/transport-policy.js';
const cfg={name:'Own name',protocol:'chat-completions',baseURL:ORIGIN_ENDPOINT,model:'user-model',rememberKey:false};
const area=()=>{const data={};return {data,get:async k=>typeof k==='string'?{[k]:structuredClone(data[k])}:structuredClone(data),set:async v=>Object.assign(data,structuredClone(v)),remove:async k=>{delete data[k];}};};
function fixture({operationTimeoutMs}={}){const rules=new Map(),updates=[],calls=[],storage={local:area(),session:area()};let allow=true,reply;
 const hasPermission=async()=>allow;
 const dnr={getSessionRules:async()=>[...rules.values()],updateSessionRules:async v=>{updates.push(v);for(const id of v.removeRuleIds||[])rules.delete(id);for(const r of v.addRules||[])rules.set(r.id,r);}};
 const transport=createCustomTransport({hasPermission,fetchImpl:async(url,o)=>{calls.push({url,o});if(reply)return reply(url,o);const probe=JSON.parse(o.body).messages[0].content==='Reply exactly OK.';return {ok:true,status:200,text:async()=>JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:probe?'OK':'{"text":"Summary"}'}}]})};}});
 const manager=createNetworkRuleManager({extensionId:'ours',dnr,hasPermission,operationTimeoutMs}),runtime=createBindingRuntime({transport,rules:manager,hasPermission});
 const store=new ProviderStore({storage,bindings:runtime,verifyPermission:c=>hasPermission(c)});
 return {store,runtime,rules,updates,calls,storage,manager,dnr,setAllow:v=>allow=v,setReply:v=>reply=v,transport,hasPermission};
}
test('formal binding publishes only after probe and pointer; repeated executor calls never update rules or parse URL',async()=>{
 const f=fixture();await f.store.save(cfg,'synthetic');const current=f.runtime.current();assert.ok(current);assert.equal(f.rules.has(RULE_ID),true);assert.equal(f.calls.length,1);const updates=f.updates.length;
 const input={kind:'article',focusId:'123',url:'https://x.com/a/status/123',title:'Title',text:'Body'};
 const Original=globalThis.URL;globalThis.URL=class extends Original {constructor(...a){super(...a);if(!String(a[0]).startsWith('https://x.com/'))throw Error('endpoint reparse on hot path');}};
 try{for(let i=0;i<3;i++)assert.equal((await current.executor.generate(f.store.keyFor(f.store.active()),input,'article')).text,'Summary');}finally{globalThis.URL=Original;}
 assert.equal(f.calls.length,4);assert.equal(f.updates.length,updates);
});
test('failed same-endpoint candidate retains current executor/Key/rule; released old candidate cannot delete retry',async()=>{
 const f=fixture();await f.store.save(cfg,'old-key');const before=f.runtime.current();f.setReply(async()=>({ok:false,status:401,text:async()=>'{}'}));await assert.rejects(f.store.save({...cfg,id:f.store.active().id,model:'other'},'new-key'),/CUSTOM_AUTH/);assert.equal(f.runtime.current(),before);assert.equal(f.store.keyFor(f.store.active()),'old-key');assert.equal(f.rules.has(RULE_ID),true);
});
test('restore validates Key/config/descriptor, reuses worker session rule and recreates missing rule without model probes',async()=>{
 const f=fixture();await f.store.save(cfg,'key');const count=f.calls.length,updates=f.updates.length;
 const runtime=createBindingRuntime({transport:f.transport,rules:createNetworkRuleManager({extensionId:'ours',dnr:{getSessionRules:async()=>[...f.rules.values()],updateSessionRules:async v=>{f.updates.push(v);for(const id of v.removeRuleIds||[])f.rules.delete(id);for(const r of v.addRules||[])f.rules.set(r.id,r);}},hasPermission:f.hasPermission}),hasPermission:f.hasPermission});
 await runtime.restore(f.store.active(),f.store.bindingState());assert.equal(runtime.state(),'ready');assert.equal(f.updates.length,updates);assert.equal(f.calls.length,count);
 f.setAllow(false);await runtime.restore(f.store.active(),f.store.bindingState());assert.equal(runtime.current(),null);assert.equal(runtime.state(),'PERMISSION_REQUIRED');assert.equal(f.calls.length,count);
});

test('standard rebind cannot clear cleanup error while an orphan Origin rule remains',async()=>{
 const f=fixture();await f.store.save(cfg,'old-key');const update=f.dnr.updateSessionRules;let failed=true;
 f.dnr.updateSessionRules=async change=>{if(failed&&change.removeRuleIds?.includes(RULE_ID))throw Error('storage unavailable');return update(change);};
 await f.store.save({...cfg,baseURL:'https://ordinary.example.test/v1'},'standard-key');assert.equal(f.runtime.state(),'CUSTOM_RULE_CLEANUP_REQUIRED');assert.equal(f.rules.has(RULE_ID),true);
 await assert.rejects(f.store.activate(f.store.active().id));assert.equal(f.runtime.state(),'CUSTOM_RULE_CLEANUP_REQUIRED');assert.equal(f.rules.has(RULE_ID),true);
 failed=false;await f.store.activate(f.store.active().id);assert.equal(f.rules.has(RULE_ID),false);assert.equal(f.runtime.state(),'ready');
});

test('cancel while adding a special rule after standard binding leaves no unowned rule',async()=>{
 const f=fixture();await f.store.save({...cfg,baseURL:'https://ordinary.example.test/v1'},'old-key');const current=f.runtime.current(),update=f.dnr.updateSessionRules;let resume;
 f.dnr.updateSessionRules=async change=>{if(change.addRules)await new Promise(r=>resume=r);return update(change);};
 const stop=new AbortController(),pending=f.store.save(cfg,'candidate-key',{signal:stop.signal});while(!resume)await new Promise(r=>setTimeout(r,0));stop.abort();resume();await assert.rejects(pending,/CANCELLED/);assert.equal(f.runtime.current(),current);assert.equal(f.rules.has(RULE_ID),false);assert.equal(f.runtime.state(),'ready');
});


test('stalled rule installation returns failure without probe, Key overwrite or replacing the active service',async()=>{
 const f=fixture({operationTimeoutMs:15});
 await f.store.save({...cfg,baseURL:'https://ordinary.example.test/v1'},'old-key');
 const current=f.runtime.current(),active=f.store.active(),calls=f.calls.length;
 f.dnr.updateSessionRules=()=>new Promise(()=>{});
 await assert.rejects(f.store.save(cfg,'candidate-key'),/CUSTOM_RULE_TIMEOUT/);
 assert.equal(f.runtime.current(),current);assert.equal(f.store.active(),active);
 assert.equal(f.store.keyFor(active),'old-key');assert.equal(f.calls.length,calls);
 assert.equal(f.store.list().services.length,1);
 await assert.rejects(f.store.save(cfg,'retry-key'),/CUSTOM_RULE_TIMEOUT/);
 assert.equal(f.calls.length,calls);
});
