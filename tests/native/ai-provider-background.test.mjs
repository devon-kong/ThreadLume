// Executes the actual worker bundle with browser I/O doubles. No credentials/network.
import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {build} from 'esbuild';
const source=(await build({entryPoints:['native-extension/src/ai/background.js'],bundle:true,write:false,format:'iife'})).outputFiles[0].text;
const evt=()=>{const handlers=[];return {handlers,addListener:f=>handlers.push(f),removeListener:f=>{const n=handlers.indexOf(f);if(n>=0)handlers.splice(n,1);},fire:async(...args)=>{for(const f of [...handlers])await f(...args);}};};
const area=seed=>{const data=structuredClone(seed||{}),access=[];return {data,access,get:async k=>typeof k==='string'?{[k]:data[k]}:structuredClone(data),set:async v=>Object.assign(data,structuredClone(v)),remove:async k=>delete data[k],setAccessLevel:async v=>access.push(v)};};
const cfg={name:'用户服务',protocol:'chat-completions',baseURL:'https://api.example.test/v1',model:'model-user',rememberKey:true};
const input={kind:'article',focusId:'123',url:'https://x.com/a/status/123',title:'Title',text:'Full body'};
const fixture=async({current=false,read,permission=true}={})=>{
 const saved={...cfg,id:'custom-one',version:'version-one',checkedAt:1},storage={local:area({aiConnection:{enabled:true,partition:'bean'},...(current?{aiProvidersV8:{schema:1,activeId:saved.id,services:[saved]},aiProviderKeysV8:{[saved.id]:'synthetic-key'}}:{})}),session:area()},calls=[],created=[],notified=[];
 const chrome={storage,runtime:{id:'ours',onMessage:evt(),onStartup:evt(),openOptionsPage:async()=>{}},action:{onClicked:evt()},permissions:{contains:async()=>permission,onRemoved:evt()},tabs:{onUpdated:evt(),onRemoved:evt(),onActivated:evt(),query:async()=>[{id:1,url:input.url}],get:async()=>null,create:async options=>{created.push(options);return {id:9,url:options.url,status:'complete'};},remove:async()=>{},sendMessage:async(id,m)=>{if(m.action==='stateChanged'){notified.push(m);return null;}return {focusId:'123',url:input.url,instance:m.instance};}},scripting:{executeScript:async()=>[]}};
 // Avoid unrelated Doubao startup when no custom has yet been saved.
 if(!current)storage.local.data.aiConnection.enabled=false;
 const fetch=async(url,options)=>{calls.push({url,options});if(read)return read(url,options);const probe=JSON.parse(options.body).messages.at(-1).content==='Reply exactly OK.';return {ok:true,status:200,text:async()=>JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:probe?'OK':'{"text":"结果"}'}}]})};};
 const context=vm.createContext({chrome,fetch,crypto,URL,URLSearchParams,AbortSignal,AbortController,DOMException,TextEncoder,btoa,setTimeout,clearTimeout});vm.runInContext(source,context);const wire=vm.runInContext('JSON.parse',context);await new Promise(r=>setTimeout(r,10));
 const settings={id:'ours',url:'chrome-extension://ours/settings.html'},x={id:'ours',url:input.url,tab:{id:1},documentId:'doc',frameId:0};
 const send=(m,sender=settings)=>new Promise(resolve=>{if(!chrome.runtime.onMessage.handlers[0](wire(JSON.stringify({ns:'peek-ai-v7',...m})),sender,resolve))resolve({rejected:true});});
 return {chrome,storage,calls,created,notified,settings,x,send};
};
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
test('实际后台：切豆包成功探测后的清理等待中取消，不提前启用豆包',async()=>{
 const w=await fixture({current:true,read:async()=>beanOK});w.storage.session.data.aiSetup=9;w.chrome.tabs.get=async()=>({id:9,url:'https://www.doubao.com/chat/',status:'complete'});w.chrome.scripting.executeScript=async()=>[{result:{params:{aid:'497858'}}}];
 const remove=w.storage.session.remove;let release,entered=false;w.storage.session.remove=async k=>{if(k==='aiSetup'&&!entered){entered=true;await new Promise(r=>release=r);}return remove(k);};
 const p=w.send({action:'capture'});while(!entered)await new Promise(r=>setTimeout(r,0));assert.equal((await w.send({action:'providers'})).value.activeId,'custom-one');const stopped=w.send({action:'cancelCheck'});release();await stopped;assert.equal((await p).error,'CANCELLED');assert.equal((await w.send({action:'providers'})).value.activeId,'custom-one');
});
test('实际后台：豆包/自定义检测互斥，旧检测不能覆盖较新的选择',async()=>{
 let release;const w=await fixture({current:true,read:()=>new Promise(r=>release=r)});const old=w.send({action:'saveProvider',config:cfg,key:'candidate-key'});while(!release)await new Promise(r=>setTimeout(r,0));assert.equal((await w.send({action:'check'})).error,'CUSTOM_CHECK_IN_PROGRESS');await w.send({action:'cancelProviderCheck'});release({ok:true,status:200,text:async()=>'{"choices":[{"finish_reason":"stop","message":{"role":"assistant","content":"OK"}}]}'});assert.equal((await old).error,'CANCELLED');assert.equal((await w.send({action:'providers'})).value.activeId,'custom-one');
 let beanRelease;const bean=await fixture({current:true,read:()=>new Promise(r=>beanRelease=r)});bean.storage.session.data.aiSetup=9;bean.chrome.tabs.get=async()=>({id:9,url:'https://www.doubao.com/chat/',status:'complete'});bean.chrome.scripting.executeScript=async()=>[{result:{params:{aid:'497858'}}}];const capture=bean.send({action:'capture'});while(!beanRelease)await new Promise(r=>setTimeout(r,0));assert.equal((await bean.send({action:'saveProvider',config:cfg,key:'candidate-key'})).error,'CUSTOM_CHECK_IN_PROGRESS');beanRelease(beanOK);assert.equal((await capture).ok,true);assert.equal((await bean.send({action:'providers'})).value.activeId,'doubao');
});
test('实际后台：无tabs权限及Tab.url字段仍通知自有内容脚本，不依赖URL筛选',async()=>{
 const w=await fixture({current:true});w.chrome.tabs.query=async options=>options.url?[]:[{id:1},{id:2}];const before=w.notified.length;await w.send({action:'savePreferences',preferences:{summary:false,mindmap:false}});await new Promise(r=>setTimeout(r,10));assert.equal(w.notified.length-before,2);for(const message of w.notified.slice(before)){assert.equal(message.action,'stateChanged');assert.equal(message.preferences.summary,false);assert.equal(JSON.stringify(message).includes('synthetic-key'),false);}
});
