import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ProviderStore} from '../../native-extension/src/ai/provider-store.js';
const area=()=>{const data={};return {data,get:async key=>typeof key==='string'?{[key]:structuredClone(data[key])}:structuredClone(data),set:async v=>Object.assign(data,structuredClone(v)),remove:async key=>{delete data[key];}};};
const config={name:'我的服务',protocol:'chat-completions',baseURL:'https://api.example.test/v1',model:'my-model',rememberKey:true};
const fixture=probe=>{const storage={local:area(),session:area()},changes=[];return {storage,changes,store:new ProviderStore({storage,probe:probe||(async()=>{}),onChange:e=>changes.push(e)})};};
test('首次迁移幂等并保留旧豆包数据，脱敏列表不泄露Key',async()=>{
 const f=fixture();f.storage.local.data.aiConnection={enabled:true,partition:'old'};f.storage.local.data.aiCache={old:{result:'old'}};
 await f.store.init();assert.equal(f.store.list().activeId,'doubao');await f.store.save(config,'secret-test');
 const list=f.store.list();assert.equal(list.services.length,1);assert.equal(list.services[0].hasKey,true);assert.equal(JSON.stringify(list).includes('secret-test'),false);
 assert.deepEqual(f.storage.local.data.aiConnection,{enabled:true,partition:'old'});assert.deepEqual(f.storage.local.data.aiCache,{old:{result:'old'}});
 const again=new ProviderStore({storage:f.storage,probe:async()=>{}});await again.init();assert.equal(again.list().activeId,list.activeId);assert.equal(again.list().services.length,1);
});
test('会话Key跨Worker恢复但不落盘，浏览器内存丢失不能使用旧localKey或自动fallback',async()=>{
 const f=fixture();await f.store.save(config,'persisted-secret');let active=f.store.active();
 await f.store.save({...config,id:active.id,rememberKey:false},'session-secret');
 assert.equal(JSON.stringify(f.storage.local.data).includes('session-secret'),false);assert.equal(JSON.stringify(f.storage.local.data).includes('persisted-secret'),false);
 const restored=new ProviderStore({storage:f.storage,probe:async()=>{}});await restored.init();assert.equal(restored.keyFor(restored.active()),'session-secret');
 const cold=new ProviderStore({storage:{local:f.storage.local,session:area()},probe:async()=>{}});await cold.init();assert.equal(cold.list().activeId,active.id);assert.equal(cold.keyFor(cold.active()),null);assert.equal(cold.list().services[0].hasKey,false);
});
test('失败/取消保留原配置与活动服务，普通重检/重命名保持版本，关键编辑轮换',async()=>{
 let fail=false;const f=fixture(async()=>{if(fail)throw Error('CUSTOM_AUTH');});await f.store.save(config,'test-secret');const old=f.store.active();
 fail=true;await assert.rejects(f.store.save({...config,id:old.id,model:'other'},'new-secret'),/CUSTOM_AUTH/);assert.equal(f.store.active().version,old.version);assert.equal(f.store.active().model,'my-model');
 fail=false;await f.store.activate(old.id);assert.equal(f.store.active().version,old.version);await f.store.save({...config,id:old.id,name:'重命名'});assert.equal(f.store.active().version,old.version);
 await f.store.save({...config,id:old.id,model:'other'});assert.notEqual(f.store.active().version,old.version);
 const abort=new AbortController();abort.abort();await assert.rejects(f.store.save(config,'new',{signal:abort.signal}),/CANCELLED|Cancelled/);assert.equal(f.store.list().services.length,1);
});
test('迟到探测和不可取消存储写入都不能发布已取消配置',async()=>{
 let release;const f=fixture(()=>new Promise(r=>release=r));const abort=new AbortController(),p=f.store.save(config,'secret',{signal:abort.signal});await new Promise(r=>setTimeout(r,0));abort.abort();release();await assert.rejects(p,/CANCELLED|Cancelled/);assert.equal(f.store.list().activeId,'doubao');assert.equal(f.store.list().services.length,0);
 const g=fixture();await g.store.init();const set=g.storage.local.set;let resume;g.storage.local.set=async v=>{await new Promise(r=>resume=r);return set(v);};const stop=new AbortController(),pending=g.store.save(config,'secret',{signal:stop.signal});await new Promise(r=>setTimeout(r,0));stop.abort();g.storage.local.set=set;resume();await assert.rejects(pending,/CANCELLED|Cancelled/);assert.equal(g.store.list().activeId,'doubao');assert.equal(g.storage.local.data.aiProvidersV8?.activeId||'doubao','doubao');assert.equal(JSON.stringify(g.storage.local.data).includes('secret'),false);
});
test('保存缺失Key/未知配置ID拒绝，设置重复检测不增加版本',async()=>{
 const f=fixture();await assert.rejects(f.store.save(config),/CUSTOM_KEY_REQUIRED/);await assert.rejects(f.store.save({...config,id:'unknown'},'key'),/CUSTOM_INVALID_CONFIG/);
 await f.store.save(config,'key');const id=f.store.active().id,version=f.store.active().version;await f.store.save({...config,id});assert.equal(f.store.active().version,version);
});
test('仅改变记住方式不轮换生成版本，旧Key引用失效而新绑定仅取其版本条目',async()=>{
 const f=fixture();await f.store.save(config,'same-key');const captured=f.store.active();await f.store.save({...config,id:captured.id,rememberKey:false});assert.equal(f.store.active().version,captured.version);assert.equal(f.store.keyFor(captured),null);assert.equal(f.store.keyFor(f.store.active()),'same-key');assert.equal(JSON.stringify(f.storage.local.data).includes('same-key'),false);
});
test('候选权限在探测后或存储等待中被撤销时不启用，恢复原服务及密钥',async()=>{
 for(const duringWrite of [false,true]){
  const f=fixture();await f.store.save(config,'original-key');const old=f.store.active();let allowed=true;
  f.store.verifyPermission=async()=>allowed;
  if(duringWrite){const set=f.storage.local.set;let once=true;f.storage.local.set=async v=>{await set(v);if(once){once=false;allowed=false;}};}else {f.store.probe=async()=>{allowed=false;};}
  await assert.rejects(f.store.save({...config,name:'candidate',model:'new'},'candidate-key'),/PERMISSION_REQUIRED/);
  assert.equal(f.store.active().id,old.id);assert.equal(f.store.keyFor(old),'original-key');assert.equal(JSON.stringify(f.storage.local.data).includes('candidate-key'),false);
 }
});
