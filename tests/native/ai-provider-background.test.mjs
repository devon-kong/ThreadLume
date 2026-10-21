// Executes the actual worker bundle with browser I/O doubles. No credentials/network.
import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {build} from 'esbuild';
import {createBindingDescriptor} from '../../native-extension/src/ai/transport-policy.js';
const source=(await build({entryPoints:['native-extension/src/ai/background.js'],bundle:true,write:false,format:'iife'})).outputFiles[0].text;
const evt=()=>{const handlers=[];return {handlers,addListener:f=>handlers.push(f),removeListener:f=>{const n=handlers.indexOf(f);if(n>=0)handlers.splice(n,1);},fire:async(...args)=>{for(const f of [...handlers])await f(...args);}};};
const area=seed=>{const data=structuredClone(seed||{}),access=[];return {data,access,get:async k=>typeof k==='string'?{[k]:data[k]}:structuredClone(data),set:async v=>Object.assign(data,structuredClone(v)),remove:async k=>delete data[k],setAccessLevel:async v=>access.push(v)};};
const cfg={name:'用户服务',protocol:'chat-completions',baseURL:'https://api.example.test/v1',model:'model-user',rememberKey:true};
const input={kind:'article',focusId:'123',url:'https://x.com/a/status/123',title:'Title',text:'Full body'};
const fixture=async({current=false,read,permission=true,seed,dnr,urlClass=URL,startupPreferencesGate,startupAttemptGate,startupCreateGate,storageGate,bridgeRead}={})=>{
 const saved={...cfg,id:'custom-one',version:'version-one',checkedAt:1,keyRef:'key-one'};saved.binding=createBindingDescriptor(saved,saved.keyRef);const storage={local:area({aiConnection:{enabled:true,partition:'bean'},...(current?{aiProvidersV8:{schema:2,activeId:saved.id,services:[saved]},['aiProviderKeyV9:'+saved.keyRef]:{providerId:saved.id,configVersion:saved.version,keyRef:saved.keyRef,keyLocation:'local',secret:'synthetic-key'}}:{})}),session:area()},calls=[],created=[],notified=[],progress=[];
 if(seed){storage.local=area(seed.local);storage.session=area(seed.session);}
 if(storageGate){const access=storage.local.setAccessLevel;storage.local.setAccessLevel=async v=>{await storageGate;return access(v);};}
 if(startupPreferencesGate){const get=storage.local.get;storage.local.get=async key=>{if(key==='aiPreferences')await startupPreferencesGate;return get(key);};}
 if(startupAttemptGate){const set=storage.session.set;storage.session.set=async value=>{if(value.aiAutoAttempted)await startupAttemptGate;return set(value);};}
 const chrome={...(dnr?{declarativeNetRequest:dnr}:{}),storage,runtime:{id:'ours',onMessage:evt(),sendMessage:async m=>progress.push({m}),onStartup:evt(),openOptionsPage:async()=>{}},action:{onClicked:evt()},permissions:{contains:async()=>permission,onRemoved:evt(),onAdded:evt()},tabs:{onUpdated:evt(),onRemoved:evt(),onActivated:evt(),query:async()=>[{id:1,url:input.url}],get:async()=>null,create:async options=>{created.push(options);return {id:9,url:options.url,status:'complete'};},remove:async()=>{},sendMessage:async(id,m,options)=>{if(m.action==='generationProgress'){progress.push({id,m,options});return null;}if(m.action==='stateChanged'){notified.push(m);return null;}return {focusId:'123',url:input.url,instance:m.instance};}},scripting:{executeScript:async()=>[]}};
 if(startupCreateGate){const create=chrome.tabs.create;chrome.tabs.create=async options=>{await startupCreateGate;return create(options);};}
 // Avoid unrelated Doubao startup when no custom has yet been saved.
 if(!current&&!seed)storage.local.data.aiConnection.enabled=false;
 const beanCalls=[];
 chrome.runtime.connect=()=>{
  const port={onMessage:evt(),onDisconnect:evt(),disconnect(){this.onDisconnect.fire();},postMessage(m){
   beanCalls.push(m);const reply=v=>port.onMessage.fire({...v,requestId:m.requestId,session:'host-session'});
   if(m.op==='cancel'){reply({type:'error',code:'CANCELLED'});return;}
   Promise.resolve().then(async()=>{const result=bridgeRead?await bridgeRead(m):{status:200,finished:true,text:'OK'};reply({type:'result',result});});
  }};queueMicrotask(()=>port.onMessage.fire({type:'hello',version:2,session:'host-session',verified:false}));return port;
 };
 const fetch=async(url,options)=>{calls.push({url,options});if(read)return read(url,options);const probe=JSON.parse(options.body).messages.at(-1).content==='Reply exactly OK.';return {ok:true,status:200,text:async()=>JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:probe?'OK':'{"text":"结果"}'}}]})};};
 const context=vm.createContext({chrome,fetch,crypto,URL:urlClass,URLSearchParams,AbortSignal,AbortController,DOMException,performance,structuredClone,TextDecoder,TextEncoder,btoa,setTimeout,clearTimeout});vm.runInContext(source,context);const wire=vm.runInContext('JSON.parse',context);await new Promise(r=>setTimeout(r,10));
 const settings={id:'ours',url:'chrome-extension://ours/settings.html'},x={id:'ours',url:input.url,tab:{id:1},documentId:'doc',frameId:0};
 const send=(m,sender=settings)=>new Promise(resolve=>{if(!chrome.runtime.onMessage.handlers[0](wire(JSON.stringify({ns:'peek-ai-v7',...m})),sender,resolve))resolve({rejected:true});});
 return {chrome,storage,calls,created,notified,progress,settings,x,send,beanCalls};
};
test('actual worker streams only to owning document, measures generic service, cancellation rejects late cache',async()=>{
 const frame=(content,finish_reason=null)=>'data: '+JSON.stringify({choices:[{index:0,delta:content===null?{}:{content},finish_reason}]})+'\n\n';
 let controller;
 const w=await fixture({read:async(_,options)=>{
  const body=JSON.parse(options.body);assert.equal(body.stream,true);
  const probe=body.messages.at(-1).content==='Reply exactly OK.';
  return new Response(new ReadableStream({start(c){if(probe){c.enqueue(new TextEncoder().encode(frame('OK')+frame(null,'stop')+'data: [DONE]\n\n'));c.close();}else{controller=c;c.enqueue(new TextEncoder().encode(frame('{"text":"readable draft')));}}}),{headers:{'content-type':'text/event-stream'}});
 }});
 const saved=await w.send({action:'saveProvider',config:{...cfg,stream:true},key:'synthetic-key'});assert.equal(saved.ok,true);
 const state=(await w.send({action:'status'})).value;
 const job=w.send({action:'generate',instance:'stream-owner',requestId:'stream-request',connectionId:state.connectionId,input,mode:'article',contentMs:502},w.x);
 for(let i=0;i<100&&!w.progress.some(p=>p.m.stage==='partial');i++)await new Promise(r=>setTimeout(r,5));
 const partial=w.progress.find(p=>p.m.stage==='partial');assert.ok(partial);assert.equal(partial.id,1);assert.equal(partial.options.documentId,'doc');assert.equal(partial.options.frameId,0);assert.equal(partial.m.text,'readable draft');
 assert.equal((await w.send({action:'displayed',instance:'stream-owner',requestId:'stream-request',firstReadableMs:150},w.x)).value,true);
 await w.send({action:'cancel',instance:'stream-owner'},w.x);assert.equal((await job).error,'CANCELLED');
 const before=w.progress.length;try{controller.enqueue(new TextEncoder().encode(frame('"}')+frame(null,'stop')+'data: [DONE]\n\n'));}catch{}
 await new Promise(r=>setTimeout(r,100));assert.equal(w.progress.length,before);
 assert.equal(Object.keys(w.storage.local.data.aiCache||{}).length,0);
 const diagnostic=(await w.send({action:'status'})).value.diagnostics.generation.find(r=>r.requestId==='stream-request');
 assert.equal(diagnostic.provider,'custom');assert.equal(diagnostic.outcome,'cancelled');assert.equal(diagnostic.firstReadableMs,150);assert.equal(diagnostic.contentMs,502);
 assert.equal(JSON.stringify(diagnostic).includes('readable draft'),false);
});
test('实际后台：自定义当前时豆包不初始化/探测，可信存储与来源限制及脱敏通知',async()=>{
 const w=await fixture({current:true});assert.equal(w.created.length,0);assert.equal(w.calls.length,0);await w.chrome.runtime.onStartup.fire();assert.equal(w.created.length,0);
 for(const area of [w.storage.local,w.storage.session])assert.equal(area.access[0].accessLevel,'TRUSTED_CONTEXTS');
 assert.equal((await w.send({action:'providers'},w.x)).rejected,true);assert.equal((await w.send({action:'saveProvider',config:cfg,key:'evil'},w.x)).rejected,true);
 const status=(await w.send({action:'status'})).value;assert.equal(status.providerName,'用户服务');assert.equal(status.state,'ready');
 const list=(await w.send({action:'providers'})).value;assert.equal(list.services[0].hasKey,true);assert.equal(JSON.stringify(list).includes('synthetic-key'),false);assert.equal(JSON.stringify(status).includes('synthetic-key'),false);
 const denied=await w.send({action:'generate',instance:'owned',connectionId:status.connectionId,input,mode:'article',url:'https://evil.test'},w.x);assert.equal(denied.error,'INVALID_MESSAGE');assert.equal(w.calls.length,0);
 const generated=await w.send({action:'generate',instance:'owned',connectionId:status.connectionId,input,mode:'article'},w.x);assert.equal(generated.value.text,'结果');assert.equal(generated.value.providerName,'用户服务');assert.equal(w.calls.length,1);
 assert.equal(w.calls[0].options.credentials,'omit');assert.equal(w.calls[0].options.redirect,'error');
 await w.send({action:'savePreferences',preferences:{summary:false,mindmap:false}});await new Promise(r=>setTimeout(r,5));assert.equal(w.notified.length>0,true);assert.equal(JSON.stringify(w.notified).includes('synthetic-key'),false);
});
test('实际后台：检测成功才启用；权限拒绝与取消/迟到响应保留原服务',async()=>{
 const w=await fixture();const save=await w.send({action:'saveProvider',config:cfg,key:'synthetic-key'});assert.equal(save.ok,true);assert.notEqual(save.value.activeId,'doubao');assert.equal(w.created.length,0);assert.equal(w.calls.length,1);assert.equal(w.calls[0].options.body.includes('Full body'),false);
 const no=await fixture({permission:false});const denied=await no.send({action:'saveProvider',config:cfg,key:'synthetic-key'});assert.equal(denied.error,'PERMISSION_REQUIRED');assert.equal((await no.send({action:'providers'})).value.activeId,'doubao');assert.equal(no.calls.length,0);
 let release;const cancelled=await fixture({current:true,read:()=>new Promise(r=>release=r)});const pending=cancelled.send({action:'saveProvider',config:{...cfg,name:'新配置'},key:'new-key'});while(!release)await new Promise(r=>setTimeout(r,0));const duplicate=await cancelled.send({action:'saveProvider',config:cfg,key:'other'});assert.equal(duplicate.error,'CUSTOM_CHECK_IN_PROGRESS');await cancelled.send({action:'cancelProviderCheck'});release({ok:true,status:200,text:async()=>JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:'OK'}}]})});assert.equal((await pending).error,'CANCELLED');assert.equal((await cancelled.send({action:'providers'})).value.activeId,'custom-one');assert.equal(JSON.stringify(cancelled.storage.local.data).includes('new-key'),false);
});
const beanOK={ok:true,status:200,text:async()=>'data: {"event_type":2001,"event_data":{"message":{"content":"{\\"text\\":\\"OK\\"}"}}}\n\ndata: {"event_type":2003,"event_data":{}}\n\n'};
test('实际后台：取消后立即重试不等待旧网络响应，迟到旧任务不能解除新任务所有权',async()=>{
 const releases=[];const w=await fixture({current:true,read:()=>new Promise(resolve=>releases.push(resolve))});
 const first=w.send({action:'activateProvider',id:'custom-one'});
 while(releases.length<1)await new Promise(r=>setTimeout(r,0));
 await w.send({action:'cancelProviderCheck'});
 const second=w.send({action:'activateProvider',id:'custom-one'});
 await new Promise(r=>setTimeout(r,10));
 const accepted=releases.length===2;
 const ok={ok:true,status:200,text:async()=>' {"choices":[{"finish_reason":"stop","message":{"role":"assistant","content":"OK"}}]}'};
 releases[0](ok);assert.equal((await first).error,'CANCELLED');
 if(accepted){
  assert.equal((await w.send({action:'status'})).value.checking,true,'old finally must not release the second check');
  releases[1](ok);assert.equal((await second).ok,true);
 }else await second;
 assert.equal(accepted,true,'new probe must start even if cancelled network ignores abort');
 assert.equal((await w.send({action:'providers'})).value.activeId,'custom-one');
});
test('实际后台：候选权限在不可取消提交中撤销，原服务不被替换',async()=>{
 const w=await fixture({current:true});let release,entered=false;const set=w.storage.local.set;w.storage.local.set=async v=>{if(v.aiProvidersV8?.activeId!=='custom-one'&&!entered){entered=true;await new Promise(r=>release=r);}return set(v);};
 const p=w.send({action:'saveProvider',config:{...cfg,baseURL:'https://candidate.example.test/v1'},key:'candidate-key'});while(!entered)await new Promise(r=>setTimeout(r,0));
 w.chrome.permissions.contains=async p=>!p.origins.includes('https://candidate.example.test/*');await w.chrome.permissions.onRemoved.fire({origins:['https://candidate.example.test/*']});release();assert.equal((await p).ok,false);assert.equal((await w.send({action:'providers'})).value.activeId,'custom-one');assert.equal(JSON.stringify(w.storage.local.data).includes('candidate-key'),false);
});
test('实际后台：豆包probe成功后提交等待中取消，不提前替换自定义服务',async()=>{
 const w=await fixture({current:true});const set=w.storage.session.set;let release,entered=false;
 w.storage.session.set=async v=>{if(v.aiDoubaoBridgeContextV1&&!entered){entered=true;await new Promise(r=>release=r);}return set(v);};
 const pending=w.send({action:'capture'});while(!entered)await new Promise(r=>setTimeout(r,0));
 assert.equal((await w.send({action:'providers'})).value.activeId,'custom-one');await w.send({action:'cancelCheck'});release();
 assert.equal((await pending).error,'CANCELLED');assert.equal((await w.send({action:'providers'})).value.activeId,'custom-one');assert.equal(w.calls.length,0);
});

test('实际后台：豆包/自定义检测互斥，旧检测不能覆盖较新的选择',async()=>{
 let release;const w=await fixture({current:true,read:()=>new Promise(r=>release=r)});const old=w.send({action:'saveProvider',config:cfg,key:'candidate-key'});while(!release)await new Promise(r=>setTimeout(r,0));assert.equal((await w.send({action:'check'})).error,'CUSTOM_CHECK_IN_PROGRESS');await w.send({action:'cancelProviderCheck'});release({ok:true,status:200,text:async()=>' {"choices":[{"finish_reason":"stop","message":{"role":"assistant","content":"OK"}}]}'});assert.equal((await old).error,'CANCELLED');
 let beanRelease;const bean=await fixture({current:true,bridgeRead:()=>new Promise(r=>beanRelease=r)});const capture=bean.send({action:'capture'});while(!beanRelease)await new Promise(r=>setTimeout(r,0));assert.equal((await bean.send({action:'saveProvider',config:cfg,key:'candidate-key'})).error,'CUSTOM_CHECK_IN_PROGRESS');beanRelease({status:200,finished:true,text:'OK'});assert.equal((await capture).ok,true);assert.equal((await bean.send({action:'providers'})).value.activeId,'doubao');assert.equal(bean.calls.length,0);
});

test('实际后台：无tabs权限及Tab.url字段仍通知自有内容脚本，不依赖URL筛选',async()=>{
 const w=await fixture({current:true});w.chrome.tabs.query=async options=>options.url?[]:[{id:1},{id:2}];const before=w.notified.length;await w.send({action:'savePreferences',preferences:{summary:false,mindmap:false}});await new Promise(r=>setTimeout(r,10));assert.equal(w.notified.length-before,2);for(const message of w.notified.slice(before)){assert.equal(message.action,'stateChanged');assert.equal(message.preferences.summary,false);assert.equal(JSON.stringify(message).includes('synthetic-key'),false);}
});

const originConfig={...cfg,baseURL:'https://maas-api.ai-yuanjing.com/openapi/compatible-mode/v1'};
const ruleFixture=()=>{const rules=new Map([[99,{id:99}]]),updates=[];return {rules,updates,dnr:{getSessionRules:async()=>[...rules.values()],updateSessionRules:async v=>{updates.push(v);for(const id of v.removeRuleIds||[])rules.delete(id);for(const r of v.addRules||[])rules.set(r.id,r);}}};};
test('实际worker绑定：等待focus的旧请求不能跨过绑定准备边界；原服务仍可用于新请求',async()=>{
 const f=await fixture({current:true});let releaseFocus,releaseProbe;
 const send=f.chrome.tabs.sendMessage;f.chrome.tabs.sendMessage=async(id,m,...rest)=>m.action==='confirmFocus'?new Promise(r=>releaseFocus=()=>r({focusId:input.focusId,url:input.url,instance:m.instance})):send(id,m,...rest);
 const status=(await f.send({action:'status'})).value;
 const pending=f.send({action:'generate',instance:'pending',connectionId:status.connectionId,input,mode:'article'},f.x);
 while(!releaseFocus)await new Promise(r=>setTimeout(r,0));
 const fetchCount=f.calls.length;
 // Recheck the same version: checking connectionId alone is insufficient.
 const set=f.storage.local.set;f.storage.local.set=async v=>{if(v.aiProvidersV8)await new Promise(r=>releaseProbe=r);return set(v);};
 const recheck=f.send({action:'activateProvider',id:'custom-one'});while(!releaseProbe)await new Promise(r=>setTimeout(r,0));
 releaseFocus();const old=await pending;assert.equal(old.error,'CONNECTION_CHANGED');assert.equal(f.calls.length,fetchCount+1,'only explicit probe');releaseProbe();assert.equal((await recheck).ok,true);
});
test('实际worker：元景正式绑定及恢复不重复probe；损坏版本Key/描述禁止网络，不能fallback',async()=>{
 const r=ruleFixture(),first=await fixture({dnr:r.dnr});const saved=await first.send({action:'saveProvider',config:originConfig,key:'synthetic-key'});assert.equal(saved.ok,true);assert.equal(r.rules.has(891020),true);assert.equal(first.calls.length,1);
 const seed={local:structuredClone(first.storage.local.data),session:structuredClone(first.storage.session.data)},updates=r.updates.length;
 const restored=await fixture({seed,dnr:r.dnr});assert.equal((await restored.send({action:'status'})).value.state,'ready');assert.equal(restored.calls.length,0);assert.equal(r.updates.length,updates);
 const c=seed.local.aiProvidersV8.services[0];c.binding.configVersion='wrong';const bad=await fixture({seed,dnr:r.dnr});const status=(await bad.send({action:'status'})).value;assert.equal(status.state,'CUSTOM_BINDING_INVALID');const got=await bad.send({action:'generate',instance:'one',connectionId:status.connectionId,input,mode:'article'},bad.x);assert.equal(got.error,'CUSTOM_BINDING_INVALID');assert.equal(bad.calls.length,0);assert.equal(r.rules.has(99),true);assert.equal(r.rules.has(891020),false);
});

test('实际worker热路径：连续生成/缓存没有端点解析、DNR更新或额外probe',async()=>{
 let parses=0;class CountURL extends URL{constructor(...args){super(...args);if(String(args[0]).startsWith('https://maas-api.ai-yuanjing.com'))parses++;}}
 const r=ruleFixture(),w=await fixture({dnr:r.dnr,urlClass:CountURL});assert.equal((await w.send({action:'saveProvider',config:originConfig,key:'synthetic-key'})).ok,true);
 const status=(await w.send({action:'status'})).value,afterBind=parses,updates=r.updates.length;
 for(let i=0;i<5;i++){const result=await w.send({action:'generate',instance:'owned',connectionId:status.connectionId,input:{...input,text:'Full body '+i},mode:'article'},w.x);assert.equal(result.ok,true);}
 assert.equal(parses,afterBind);assert.equal(r.updates.length,updates);assert.equal(w.calls.length,6);const hit=await w.send({action:'generate',instance:'owned',connectionId:status.connectionId,input:{...input,text:'Full body 0'},mode:'article'},w.x);assert.equal(hit.value.cached,true);assert.equal(w.calls.length,6);
});

test('实际worker逐持久化边界终止：不运行旧finally，四种Key记住切换恢复只用一致版本',async()=>{
 for(const from of [true,false])for(const to of [true,false]){
  const initialRules=ruleFixture(),initial=await fixture({dnr:initialRules.dnr});assert.equal((await initial.send({action:'saveProvider',config:{...originConfig,rememberKey:from},key:'old-key'})).ok,true);
  const seed={local:structuredClone(initial.storage.local.data),session:structuredClone(initial.storage.session.data)};let boundaries=0,finished=false;
  for(let n=1;n<20;n++){
   let done=false;
   for(const side of ['before','after']){
    const r=ruleFixture();for(const [id,value]of initialRules.rules)r.rules.set(id,structuredClone(value));const old=await fixture({seed,dnr:r.dnr});await old.send({action:'status'});
    let count=0,checkpoint;const reached=new Promise(resolve=>checkpoint=resolve),forever=new Promise(()=>{});
    for(const area of [old.storage.local,old.storage.session])for(const method of ['set','remove']){
     const original=area[method];area[method]=async(...args)=>{const stop=++count===n;if(stop&&side==='before'){checkpoint();await forever;}await original(...args);if(stop&&side==='after'){checkpoint();await forever;}};
    }
    const id=seed.local.aiProvidersV8.activeId;
    const pending=old.send({action:'saveProvider',config:{...originConfig,id,model:'new-model',rememberKey:to},key:'new-key'});
    const result=await Promise.race([reached.then(()=>false),pending.then(()=>true)]);if(result){done=true;break;}boundaries++;
    // The old message promise is deliberately abandoned, with its entire stack
    // suspended. New worker receives only storage/rules left at process death.
    const residual={local:structuredClone(old.storage.local.data),session:structuredClone(old.storage.session.data)};
    const restartedRules=ruleFixture();for(const [id,value]of r.rules)restartedRules.rules.set(id,structuredClone(value));
    const restarted=await fixture({seed:residual,dnr:restartedRules.dnr});const status=(await restarted.send({action:'status'})).value;assert.equal(status.state,'ready',`${from}->${to} ${n}/${side}`);assert.equal(restarted.calls.length,0,'restore never probes');
    const generated=await restarted.send({action:'generate',instance:'recovered',connectionId:status.connectionId,input,mode:'article'},restarted.x);assert.equal(generated.ok,true);
    const request=restarted.calls[0].options,model=JSON.parse(request.body).model;assert.ok(['model-user','new-model'].includes(model));assert.equal(request.headers.Authorization,model==='model-user'?'Bearer old-key':'Bearer new-key');assert.equal(restartedRules.rules.has(99),true);
   }
   if(done){finished=true;break;}
  }
  assert.ok(finished,'must exhaust bundled-worker persistence boundaries');
  assert.ok(boundaries>=4);
 }
});

test('实际worker旧schema崩溃残留：保留Key但须显式绑定，恢复和生成均不探测不fallback',async()=>{
 const saved={...cfg,id:'legacy',version:'old-version',rememberKey:false,checkedAt:1};
 const w=await fixture({seed:{local:{aiProvidersV8:{schema:1,activeId:'legacy',services:[saved]}},session:{aiProviderKeysV8:{legacy:'candidate-key-without-version'}}}});
 const status=(await w.send({action:'status'})).value;assert.equal(status.state,'CUSTOM_REBIND_REQUIRED');assert.equal((await w.send({action:'providers'})).value.services[0].hasKey,true);assert.equal(w.calls.length,0);
 const generated=await w.send({action:'generate',instance:'owned',connectionId:status.connectionId,input,mode:'article'},w.x);assert.equal(generated.error,'CUSTOM_REBIND_REQUIRED');assert.equal(w.calls.length,0);
 assert.equal((await w.send({action:'activateProvider',id:'legacy'})).ok,true);assert.equal(w.calls.length,1);assert.notEqual(w.storage.local.data.aiProvidersV8.services[0].version,'old-version');assert.equal((await w.send({action:'status'})).value.state,'ready');
});

test('实际worker冷会话：local Key恢复规则不probe，session Key丢失明确阻断且清自有孤儿',async()=>{
 for(const rememberKey of [true,false]){
  const r=ruleFixture(),initial=await fixture({dnr:r.dnr});assert.equal((await initial.send({action:'saveProvider',config:{...originConfig,rememberKey},key:'synthetic-key'})).ok,true);
  const coldRules=ruleFixture(),cold=await fixture({seed:{local:structuredClone(initial.storage.local.data),session:{}},dnr:coldRules.dnr});const status=(await cold.send({action:'status'})).value;assert.equal(status.state,rememberKey?'ready':'CUSTOM_KEY_REQUIRED');assert.equal(cold.calls.length,0);assert.equal(coldRules.rules.has(891020),rememberKey);
  if(!rememberKey){const got=await cold.send({action:'generate',instance:'cold',connectionId:status.connectionId,input,mode:'article'},cold.x);assert.equal(got.error,'CUSTOM_KEY_REQUIRED');assert.equal(cold.calls.length,0);}
 }
});

test('实际worker唤醒：旧豆包配置不触发自动开页，自定义绑定成功或失败均不fallback',async()=>{
 for(const accepted of [true,false]){
  const w=await fixture({seed:{local:{aiConnection:{enabled:true,partition:'bean'}},session:{}},...(!accepted?{read:async()=>({ok:false,status:401,text:async()=>'{}'})}:{})});
  const saved=await w.send({action:'saveProvider',config:cfg,key:'wake-test-key'});
  if(accepted)assert.equal(saved.ok,true);else assert.equal(saved.error,'CUSTOM_AUTH');
  await w.chrome.runtime.onStartup.fire();assert.equal(w.created.length,0);assert.equal(w.calls.length,1);assert.equal(w.beanCalls.length,0);assert.equal(w.storage.session.data.aiAutoAttempted,undefined);
 }
});

test('实际worker：显式豆包开页尚未完成时自定义检测不能抢占',async()=>{
 let resume,entered;const gate=new Promise(r=>resume=r),started=new Promise(r=>entered=r);const w=await fixture();
 const create=w.chrome.tabs.create;w.chrome.tabs.create=async args=>{entered();await gate;return create(args);};
 const opening=w.send({action:'openSetup'});await started;
 assert.equal((await w.send({action:'saveProvider',config:cfg,key:'must-not-probe'})).error,'CUSTOM_CHECK_IN_PROGRESS');assert.equal(w.calls.length,0);
 await w.send({action:'cancelCheck'});resume();assert.equal((await opening).error,'CANCELLED');assert.equal(w.created.length,1);
});

test('实际worker可选DNR动态授权：启动时API不可用，重授后无需重建即可恢复且不probe',async()=>{
 const initialRules=ruleFixture(),initial=await fixture({dnr:initialRules.dnr});
 assert.equal((await initial.send({action:'saveProvider',config:originConfig,key:'local-test-key'})).ok,true);
 const w=await fixture({seed:{local:structuredClone(initial.storage.local.data),session:{}},permission:false});
 assert.equal((await w.send({action:'status'})).value.state,'PERMISSION_REQUIRED');
 const granted=ruleFixture();w.chrome.declarativeNetRequest=granted.dnr;w.chrome.permissions.contains=async()=>true;
 await w.chrome.permissions.onAdded.fire({permissions:['declarativeNetRequestWithHostAccess']});
 assert.equal((await w.send({action:'status'})).value.state,'ready');
 assert.equal(granted.rules.has(891020),true);assert.equal(w.calls.length,0,'permission recovery must not probe');
 assert.equal((await w.send({action:'activateProvider',id:initial.storage.local.data.aiProvidersV8.activeId})).ok,true);
 assert.equal(w.calls.length,1,'only the explicit recheck probes');
});

 test('cancel during worker preparation acknowledges immediately and prevents a queued save from starting',async()=>{
 let resume;const storageGate=new Promise(r=>resume=r);const w=await fixture({storageGate});
 const pending=w.send({action:'saveProvider',config:cfg,key:'synthetic-key'});
 const cancel=w.send({action:'cancelProviderCheck'});
 const result=await Promise.race([cancel,new Promise(r=>setTimeout(()=>r({blocked:true}),40))]);
 resume();await cancel;const saved=await pending;
 assert.equal(result.blocked,undefined,'cancellation must not wait for worker initialization');
 assert.equal(saved.error,'CANCELLED');assert.equal(w.calls.length,0);
 });

test('configuration phases are operation-scoped and diagnostics never include credentials or raw responses',async()=>{
 const w=await fixture();const saved=await w.send({action:'saveProvider',operationId:'operation-one',config:cfg,key:'synthetic-key'});assert.equal(saved.ok,true);
 const events=w.progress.filter(p=>p.m.action==='providerProgress').map(p=>p.m);assert.deepEqual([...new Set(events.map(e=>e.stage))],['background','rules','model','commit']);assert.ok(events.every(e=>e.operationId==='operation-one'&&Number.isFinite(e.elapsedMs)));assert.equal(JSON.stringify(events).includes('synthetic-key'),false);
});
test('every English request progress frame carries the validated language',async()=>{
 const w=await fixture({current:true}),state=(await w.send({action:'status'})).value;
 const result=await w.send({action:'generate',instance:'english',requestId:'english-request',connectionId:state.connectionId,input,mode:'article',outputLanguage:'en'},w.x);assert.equal(result.ok,true);
 const frames=w.progress.filter(p=>p.m.action==='generationProgress');assert.ok(frames.some(p=>p.m.stage==='request'));assert.ok(frames.every(p=>p.m.outputLanguage==='en'));
});
