import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSetupDiagnostics,diagnosticCall} from '../../native-extension/src/ai/setup-diagnostics.js';
const key='aiSetupDiagnosticsV1';
const tick=()=>new Promise(r=>setTimeout(r,0));
async function until(fn){for(let i=0;i<100&&!fn();i++)await tick();assert.ok(fn());}
function fixture(seed,clock=()=>Date.now()){
 const data={[key]:seed},writes=[];
 const storage={get:async()=>structuredClone(data),set:async v=>{writes.push(v);Object.assign(data,structuredClone(v));}};
 const logger=createSetupDiagnostics({storage,clock,workerId:'worker-test'});return {logger,storage,data,writes};
}
test('setup diagnostics survive a new logger, bound history, expire and never retain arbitrary text',async()=>{
 let now=100000000;const f=fixture(undefined,()=>now);await f.logger.load();
 const t=f.logger.trace('save','operation-one');
 for(let i=0;i<205;i++)t.event('model_probe','started');
 t.event('model_probe','failed',{errorCode:'KEY_SHOULD_NOT_LEAK',key:'SECRET'});
 await until(()=>f.data[key]?.events.length===200);
 assert.equal(f.logger.snapshot().events.length,200);assert.doesNotMatch(JSON.stringify(f.data),/SECRET|KEY_SHOULD_NOT_LEAK/);
 const restored=createSetupDiagnostics({storage:f.storage,clock:()=>now,workerId:'worker-next'});await restored.load();assert.equal(restored.snapshot().events.length,200);
 now+=86400001;assert.equal(restored.snapshot().events.length,0);
});
test('overlapping flows carry their own context and observe failures without changing the original Promise',async()=>{
 const f=fixture();await f.logger.load();let resolve;
 const a=f.logger.trace('permission_added','event-a'),b=f.logger.trace('save','operation-b');
 const p=new Promise(r=>resolve=r);assert.equal(diagnosticCall(a,'rule_read',()=>p),p);
 const rejected=Promise.reject(Object.assign(Error('SECRET'),{code:'CUSTOM_RULE_TIMEOUT'}));
 assert.equal(diagnosticCall(b,'rule_install',()=>rejected),rejected);await assert.rejects(rejected);
 resolve([]);await tick();const rows=f.logger.snapshot().events;
 assert.deepEqual(rows.filter(r=>r.operationId==='event-a').map(r=>r.status),['started','success']);
 assert.deepEqual(rows.filter(r=>r.operationId==='operation-b').map(r=>r.status),['started','failed']);
 assert.equal(rows.at(-2).errorCode,'CUSTOM_RULE_TIMEOUT');assert.doesNotMatch(JSON.stringify(rows),/SECRET/);
});
test('unavailable or pending diagnostic storage never blocks records or observed work',async()=>{
 const logger=createSetupDiagnostics({workerId:'worker-test',storage:{get:()=>new Promise(()=>{}),set:()=>new Promise(()=>{})}});
 void logger.load();const trace=logger.trace('save','operation-one');
 assert.equal(await diagnosticCall(trace,'model_probe',()=>Promise.resolve(true)),true);
 assert.equal(logger.snapshot().events.length,2);assert.equal(logger.snapshot().persistence,'loading');
 const f=fixture();f.storage.set=async()=>{throw Error('SECRET')};await f.logger.load();f.logger.trace('save','operation-two').event('commit','success');await until(()=>f.logger.snapshot().persistence==='unavailable');assert.doesNotMatch(JSON.stringify(f.logger.snapshot()),/SECRET/);
});
test('clear wins against an in-flight history read and removes persisted history',async()=>{
 const f=fixture();await f.logger.load();f.logger.trace('save','operation-one').event('commit','success');await until(()=>f.data[key]?.events.length===1);
 let resolve;const old=structuredClone(f.data);f.storage.get=()=>new Promise(r=>resolve=r);
 const restored=createSetupDiagnostics({storage:f.storage,workerId:'worker-new'});const loaded=restored.load();await tick();restored.clear();resolve(old);await loaded;await until(()=>f.data[key]?.events.length===0);assert.equal(restored.snapshot().events.length,0);
});
test('failed trusted-storage access never permits diagnostic persistence',async()=>{
 let reads=0,writes=0;const logger=createSetupDiagnostics({workerId:'worker-test',storageReady:Promise.reject(Error('denied')),storage:{get:async()=>{reads++;return {}},set:async()=>{writes++;}}});
 logger.trace('save','operation-one').event('save','started');await logger.load();await tick();assert.equal(reads,0);assert.equal(writes,0);assert.equal(logger.snapshot().events.length,1);
});
