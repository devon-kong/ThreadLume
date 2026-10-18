import {test} from 'node:test';import assert from 'node:assert/strict';
import {AIService,allowedSender,validateParams} from '../../native-extension/src/ai/service.js';
const input={kind:'article',focusId:'123',url:'https://x.com/a/status/123',title:'Title',text:'Body'};
const area=()=>{const d={};return {get:async key=>typeof key==='string'?{[key]:d[key]}:{...d},set:async x=>Object.assign(d,structuredClone(x)),remove:async key=>{delete d[key];}};};
const stream='data: {"event_type":2001,"event_data":{"message":{"content":"{\\"text\\":\\"done\\"}"}}}\n\ndata: {"event_type":2003,"event_data":{}}\n\n';
function setup(){const storage={local:area(),session:area()};let calls=[];const request=async(path,body,signal)=>{calls.push(path);if(signal?.aborted)throw new DOMException('Cancelled','AbortError');return path.endsWith('/create')?JSON.stringify({code:0,data:{id:'resource'}}):stream;};return {storage,calls,request,service:new AIService({storage,request})};}
test('来源与参数白名单，拒绝任意外部消息/URL/签名字段',()=>{
 assert.equal(allowedSender({id:'ours',tab:{id:1},frameId:0,url:input.url},'ours','generate'),true);
 assert.equal(allowedSender({id:'evil',tab:{id:1},frameId:0,url:input.url},'ours','generate'),false);
 assert.equal(allowedSender({id:'ours',tab:{id:1},frameId:2,url:input.url},'ours','generate'),false);
 assert.equal(allowedSender({id:'ours',tab:{id:1},frameId:0,url:input.url},'ours','connect'),false);
 assert.throws(()=>validateParams({aid:'586864'}),/APPLICATION_CHANGED/);assert.throws(()=>validateParams({aid:'497858',msToken:'bad'}),/INVALID_PARAMETERS/);
});
test('去重/缓存/输入变化、Worker 重建内存恢复、断开保留结果、新分区隔离',async()=>{
 const s=setup();await s.service.init();await s.service.connect({aid:'497858'});
 const [a,b]=await Promise.all([s.service.generate('owner-a',input,'article'),s.service.generate('owner-b',input,'article')]);
 assert.equal(a.text,'done');assert.equal(b.text,'done');assert.equal(s.calls.length,2);
 await s.service.generate('owner-c',input,'article');assert.equal(s.calls.length,2);
 await s.service.generate('owner-c',{...input,text:'Changed'},'article');assert.equal(s.calls.length,4);
 const restored=new AIService({storage:s.storage,request:s.request});await restored.init();assert.equal((await restored.status()).state,'ready');
 await restored.disconnect();assert.equal((await restored.cached(input,'article')).text,'done');
 await assert.rejects(restored.generate('owner',{...input,text:'Uncached'},'article'),/DISCONNECTED/);
 await restored.connect({aid:'497858'});await restored.generate('owner',input,'article');assert.equal(s.calls.length,6);
 assert.equal(JSON.stringify(await s.storage.local.get()).includes('497858'),false);
});
test('全局串行/取消清理、迟到结果不能进入新连接',async()=>{
 const storage={local:area(),session:area()};let release;let active=0,max=0;
 const service=new AIService({storage,request:async(path,body,signal)=>{
 active++;max=Math.max(max,active);try{if(path.endsWith('/create'))return JSON.stringify({code:0,data:{id:'r'}});await new Promise(r=>{release=r;});return stream;}finally{active--;}
 }});await service.init();await service.connect({aid:'497858'});
 const task=service.generate('one',input,'article');await new Promise(r=>setTimeout(r,10));
 service.cancel('one');release();await assert.rejects(task,{name:'AbortError'});assert.equal(await service.cached(input,'article'),null);assert.equal(max,1);
});
test('旧连接迟到拒绝不能污染新连接状态',async()=>{
 const storage={local:area(),session:area()};let rejectOld;
 const service=new AIService({storage,request:async path=>path.endsWith('/create')?JSON.stringify({code:0,data:{id:'r'}}):new Promise((_,reject)=>{rejectOld=reject;})});
 await service.init();await service.connect({aid:'497858'});const old=service.generate('old',input,'article');old.catch(()=>{});await new Promise(r=>setTimeout(r,5));
 await service.connect({aid:'497858'});const error=Error('LOGIN_REQUIRED');error.code='LOGIN_REQUIRED';rejectOld(error);await old.catch(()=>{});await new Promise(r=>setTimeout(r,5));assert.equal((await service.status()).state,'ready');
});
test('立即关闭：generate 初始化 await 期间 cancel 不得丢失，不上传',async()=>{
 const s=setup();await s.service.init();await s.service.connect({aid:'497858'});const p=s.service.generate('closed',input,'article');s.service.cancel('closed');await assert.rejects(p,{name:'AbortError'});assert.equal(s.calls.length,0);
});
test('初始化窗口中的请求不能跨连接代际上传',async()=>{
 const s=setup();await s.service.init();await s.service.connect({aid:'497858'});const p=s.service.generate('old-owner',input,'article');p.catch(()=>{});await s.service.connect({aid:'497858'});await assert.rejects(p,{name:'AbortError'});assert.equal(s.calls.length,0);
});
test('账号边界无法证明时 fail closed：作废上下文并轮换缓存分区',async()=>{
 const s=setup();await s.service.init();await s.service.connect({aid:'497858'});await s.service.generate('one',input,'article');const before=(await s.service.status()).connectionId;
 await s.service.invalidateContext();assert.equal(await s.service.cached(input,'article'),null);assert.notEqual((await s.service.status()).connectionId,before);assert.equal((await s.service.status()).state,'CONTEXT_CHANGED');assert.equal(s.service.context,null);
});
test('结果缓存写入失败不丢成功内容、不伪造已缓存',async()=>{
 const s=setup();await s.service.init();await s.service.connect({aid:'497858'});const old=s.storage.local.set;s.storage.local.set=async value=>{if(value.aiCache)throw Error('quota');return old(value);};
 const r=await s.service.generate('owner',input,'article');assert.equal(r.text,'done');assert.equal(r.cacheWarning,true);assert.equal(await s.service.cached(input,'article'),null);
});

test('验证/登录阻断跨Worker重建保留且不落盘，新连接清理旧阻断',async()=>{
 for(const code of [710022004,401]){
  const storage={local:area(),session:area()};let calls=0;
  const request=async path=>{calls++;return path.endsWith('/create')?JSON.stringify({code:0,data:{id:'r'}}):'data: '+JSON.stringify({event_type:2005,event_data:{code}})+'\n\n';};
  const first=new AIService({storage,request});await first.connect({aid:'497858'});
  const expected=code===401?'LOGIN_REQUIRED':'VERIFICATION_REQUIRED';
  await assert.rejects(first.generate('first',input,'article'),e=>e.code===expected);assert.equal(calls,2);
  const restored=new AIService({storage,request});assert.equal((await restored.status()).state,expected);
  await assert.rejects(restored.generate('new',{...input,text:'Uncached after restart'},'article'),e=>e.code===expected);assert.equal(calls,2);
  assert.equal(JSON.stringify(await storage.local.get()).includes(expected),false);
  await restored.connect({aid:'497858'});assert.equal((await restored.status()).state,'ready');
  const clean=new AIService({storage,request});assert.equal((await clean.status()).state,'ready');
 }
});

test('登录阻断仅属于当前分区；断开和上下文作废清理session阻断',async()=>{
 const s=setup();await s.service.connect({aid:'497858'});
 await s.storage.session.set({aiBlock:{partition:'other',code:'VERIFICATION_REQUIRED'}});
 const unrelated=new AIService({storage:s.storage,request:s.request});assert.equal((await unrelated.status()).state,'ready');
 await unrelated.setError('LOGIN_REQUIRED');await unrelated.disconnect();
 assert.equal((await s.storage.session.get('aiBlock')).aiBlock,undefined);
 await unrelated.connect({aid:'497858'});await unrelated.setError('VERIFICATION_REQUIRED');await unrelated.invalidateContext();
 assert.equal((await s.storage.session.get('aiBlock')).aiBlock,undefined);assert.equal((await unrelated.status()).state,'CONTEXT_CHANGED');
});

test('旧登录阻断存储写入完成后不能覆盖重连状态',async()=>{
 const s=setup();await s.service.connect({aid:'497858'});let release,started;
 const waiting=new Promise(r=>started=r),gate=new Promise(r=>release=r),set=s.storage.session.set;
 s.storage.session.set=async value=>{if(value.aiBlock){started();await gate;}return set(value);};
 const blocked=s.service.setError('VERIFICATION_REQUIRED');await waiting;
 const connecting=s.service.connect({aid:'497858'});release();await Promise.all([blocked,connecting]);
 const restored=new AIService({storage:s.storage,request:s.request});assert.equal((await restored.status()).state,'ready');assert.equal((await s.storage.session.get('aiBlock')).aiBlock,undefined);
});
