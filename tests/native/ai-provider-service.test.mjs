import {test} from 'node:test';import assert from 'node:assert/strict';
import {AIService} from '../../native-extension/src/ai/service.js';
import {ProviderStore} from '../../native-extension/src/ai/provider-store.js';
const area=()=>{const data={};return {data,get:async k=>typeof k==='string'?{[k]:structuredClone(data[k])}:structuredClone(data),set:async v=>Object.assign(data,structuredClone(v)),remove:async k=>delete data[k]};};
const config={name:'服务一',protocol:'chat-completions',baseURL:'https://api.example.test/v1',model:'one',rememberKey:true};
const input={kind:'article',focusId:'123',url:'https://x.com/a/status/123',title:'Title',text:'Full body'};
const result={finished:true,text:'Summary',highlights:[],timestampUnit:'milliseconds'};
async function fixture(requestCustom){const storage={local:area(),session:area()};let calls=0,service;const providers=new ProviderStore({storage,probe:async()=>{},onChange:e=>{if(e.invalidate)service?.providerChanged();}});service=new AIService({storage,providers,request:async()=>{throw Error('NO_DOUBAO');},requestCustom:requestCustom||(async()=>{calls++;return result;})});await service.init();await providers.save(config,'test-key');return {storage,providers,service,calls:()=>calls};}
test('自定义服务复用队列与缓存，结果标注来源；重检不轮换缓存，模型编辑隔离',async()=>{
 const f=await fixture();const status=await f.service.status();assert.equal(status.state,'ready');assert.equal(status.providerName,'服务一');assert.match(status.connectionId,/custom/);
 const a=await f.service.generate('a',input,'article');assert.equal(a.providerName,'服务一');await f.service.generate('b',input,'article');assert.equal(f.calls(),1);
 const id=f.providers.active().id;await f.providers.activate(id);await f.service.generate('c',input,'article');assert.equal(f.calls(),1);
 await f.providers.save({...config,id,model:'two'});await f.service.generate('d',input,'article');assert.equal(f.calls(),2);
 const restoredProviders=new ProviderStore({storage:f.storage,probe:async()=>{}}),restored=new AIService({storage:f.storage,providers:restoredProviders,requestCustom:async()=>{throw Error('CACHE_EXPECTED');}});await restored.init();assert.equal((await restored.generate('restored',input,'article')).text,'Summary');
});
test('切换时取消旧请求，迟到响应不回填新配置缓存；总缓存有界',async()=>{
 let release;const f=await fixture(()=>new Promise(r=>release=r));const pending=f.service.generate('old',input,'article');pending.catch(()=>{});while(!release)await new Promise(r=>setTimeout(r,0));
 await f.providers.save({...config,name:'服务二',model:'two'},'second-key');release(result);await assert.rejects(pending,/Cancelled|CANCELLED/);assert.equal(await f.service.cached(input,'article'),null);assert.deepEqual(f.storage.local.data.aiCache||{},{});
});
test('session Key冷启动缺失保持当前服务并阻止生成，不fallback',async()=>{
 const f=await fixture();const id=f.providers.active().id;await f.providers.save({...config,id,rememberKey:false});const storage={local:f.storage.local,session:area()},providers=new ProviderStore({storage,probe:async()=>{}});let calls=0;const service=new AIService({storage,providers,request:async()=>{calls++;},requestCustom:async()=>{calls++;}});
 assert.equal((await service.status()).state,'CUSTOM_KEY_REQUIRED');await assert.rejects(service.generate('a',input,'article'),/CUSTOM_KEY_REQUIRED/);assert.equal(calls,0);
});
test('首次连接失败空partition阻断跨Worker恢复，只读状态不触发网络',async()=>{
 const storage={local:area(),session:area()};let calls=0;const first=new AIService({storage,request:async()=>{calls++;}});await first.init();await first.setError('VERIFICATION_REQUIRED');const second=new AIService({storage,request:async()=>{calls++;}});assert.equal((await second.status()).state,'VERIFICATION_REQUIRED');assert.equal(calls,0);await second.disconnect();assert.equal((await new AIService({storage}).status()).state,'DISCONNECTED');
});
test('所有自定义服务共享30项缓存总上限，全部关闭时不请求',async()=>{
 const f=await fixture();for(let i=0;i<20;i++)await f.service.generate('first-'+i,{...input,text:'Content '+i},'article');
 await f.providers.save({...config,name:'另一服务',model:'two'},'key-two');for(let i=0;i<20;i++)await f.service.generate('second-'+i,{...input,text:'Content '+i},'article');
 assert.equal(Object.keys(f.storage.local.data.aiCache).length,30);const before=f.calls();await f.service.savePreferences({summary:false,mindmap:false});await assert.rejects(f.service.generate('off',{...input,text:'Never sent'},'article'),/GENERATION_DISABLED/);assert.equal(f.calls(),before);
});
test('stream-mode edit is atomic and changes config/cache identity; failed capability probe preserves old binding',async()=>{
 const f=await fixture();const old=f.providers.active(),oldIdentity=f.providers.identity();
 f.providers.probe=async candidate=>{if(candidate.stream)throw Error('UNSUPPORTED');};
 await assert.rejects(f.providers.save({...config,id:old.id,stream:true}),/UNSUPPORTED/);
 assert.equal(f.providers.active(),old);assert.equal(f.providers.identity(),oldIdentity);assert.equal(f.providers.keyFor(old),'test-key');
 f.providers.probe=async()=>{};await f.providers.save({...config,id:old.id,stream:true});
 const streamed=f.providers.active();assert.equal(streamed.stream,true);assert.equal(streamed.binding.stream,true);assert.notEqual(streamed.version,old.version);
 const restarted=new ProviderStore({storage:f.storage,probe:()=>{throw Error('no automatic probe');}});await restarted.init();assert.equal(restarted.bindingState(),'ready');assert.equal(restarted.active().stream,true);assert.equal(restarted.keyFor(restarted.active()),'test-key');
});
test('language caches survive Worker reconstruction and article mindmap never changes the binding',async()=>{
 const calls=[];const f=await fixture(async(_p,_key,_input,mode,_signal,_binding,_event,language)=>{calls.push({mode,language});return mode==='mindmap'?{...result,tree:[{text:language,children:[]}]}:{...result,text:language};});const before=f.providers.active();
 await f.service.generate('zh',input,'article',{outputLanguage:'zh-CN'});await f.service.generate('en',input,'article',{outputLanguage:'en'});await f.service.generate('map',input,'mindmap',{outputLanguage:'en'});await f.service.generate('again',input,'article',{outputLanguage:'zh-CN'});assert.equal(calls.length,3);assert.equal(f.providers.active(),before);
 const restoredProviders=new ProviderStore({storage:f.storage,probe:async()=>{}}),restored=new AIService({storage:f.storage,providers:restoredProviders,requestCustom:()=>assert.fail('must use language cache')});await restored.init();assert.equal((await restored.generate('english',input,'article',{outputLanguage:'en'})).text,'en');assert.equal((await restored.generate('chinese',input,'article',{outputLanguage:'zh-CN'})).text,'zh-CN');await assert.rejects(restored.cached(input,'article','fr'),/INVALID_LANGUAGE/);
});
