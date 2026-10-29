import {test} from 'node:test';import assert from 'node:assert/strict';
import {createCustomTransport} from '../../native-extension/src/ai/custom-transport.js';
const config={id:'custom',name:'测试',protocol:'chat-completions',baseURL:'https://api.example.test/v1',model:'chosen',rememberKey:true};
const input={kind:'article',focusId:'123',url:'https://x.com/a/status/123',title:'Title',text:'Full article'};
const envelope=text=>({choices:[{finish_reason:'stop',message:{role:'assistant',content:text}}]});
const response=(body,status=200)=>({ok:status>=200&&status<300,status,text:async()=>JSON.stringify(body)});
test('自定义后台仅请求保存服务的固定POST，最小检测不含文章、拒绝Cookie和重定向',async()=>{
 const calls=[],transport=createCustomTransport({hasPermission:async origin=>origin==='https://api.example.test/*',fetchImpl:async(url,options)=>{calls.push({url,options});return response(envelope(calls.length===1?'OK':'{"text":"摘要"}'));}});
 assert.equal(await transport.probe(config,'test-secret',new AbortController().signal),true);assert.equal((await transport.generate(config,'test-secret',input,'article',new AbortController().signal)).text,'摘要');
 for(const c of calls){assert.equal(c.url,'https://api.example.test/v1/chat/completions');assert.equal(c.options.credentials,'omit');assert.equal(c.options.redirect,'error');assert.equal(c.options.method,'POST');assert.equal(c.options.headers.Authorization,'Bearer test-secret');const b=JSON.parse(c.options.body);assert.equal(b.model,'chosen');assert.equal(b.response_format,undefined);assert.equal(b.tools,undefined);}
 assert.equal(calls[0].options.body.includes('Full article'),false);
});
test('权限未授予/取消零请求；HTTP/网络/超时为固定类别，不泄露报文',async()=>{
 let calls=0;const denied=createCustomTransport({hasPermission:async()=>false,fetchImpl:async()=>{calls++;}});await assert.rejects(denied.probe(config,'key'),/PERMISSION_REQUIRED/);assert.equal(calls,0);
 const abort=new AbortController();abort.abort();const cancelled=createCustomTransport({hasPermission:async()=>true,fetchImpl:async()=>{calls++;}});await assert.rejects(cancelled.probe(config,'key',abort.signal),/CANCELLED/);assert.equal(calls,0);
 for(const [status,code] of [[401,'CUSTOM_AUTH'],[403,'CUSTOM_FORBIDDEN'],[404,'CUSTOM_ENDPOINT_NOT_FOUND'],[429,'CUSTOM_RATE_LIMITED'],[500,'CUSTOM_SERVER']]){
  const transport=createCustomTransport({hasPermission:async()=>true,fetchImpl:async()=>response({error:{message:'private report'}},status)});await assert.rejects(transport.probe(config,'key'),e=>e.code===code&&!e.message.includes('private'));
 }
 const network=createCustomTransport({hasPermission:async()=>true,fetchImpl:async()=>{throw new TypeError('secret in raw failure');}});await assert.rejects(network.probe(config,'key'),e=>e.code==='CUSTOM_NETWORK'&&!e.message.includes('secret'));
 const timeout=createCustomTransport({hasPermission:async()=>true,timeoutMs:5,fetchImpl:async(_,o)=>new Promise((_,reject)=>{o.signal.addEventListener('abort',()=>reject(o.signal.reason),{once:true});})});
 const keep=setTimeout(()=>{},30);try{await assert.rejects(timeout.probe(config,'key'),/CUSTOM_TIMEOUT/);}finally{clearTimeout(keep);}
});

test('403 CORS 明确分类，普通403不臆测原因且不泄露服务报文',async()=>{for(const [text,expected] of [['Invalid CORS request','CUSTOM_ORIGIN_REJECTED'],['  Invalid CORS request\n','CUSTOM_ORIGIN_REJECTED'],['Forbidden: private echoed credential','CUSTOM_FORBIDDEN']]){const transport=createCustomTransport({hasPermission:async()=>true,fetchImpl:async()=>({ok:false,status:403,text:async()=>text})});await assert.rejects(transport.probe(config,'test-secret'),e=>e.code===expected&&!e.message.includes('private')&&!e.message.includes('credential'));}});

test('最小检测兼容先消耗少量预算再输出 OK 的模型，仍校验正常结束',async()=>{let request;const transport=createCustomTransport({hasPermission:async()=>true,fetchImpl:async(_,options)=>{request=JSON.parse(options.body);return response({choices:[{finish_reason:request.max_tokens<=8?'length':'stop',message:{role:'assistant',content:request.max_tokens<=8?'':'OK'}}]});}});assert.equal(await transport.probe(config,'test-secret'),true);assert.ok(request.max_tokens<=256,'探测预算保持有界');assert.equal(request.messages.some(m=>m.content.includes('Full article')),false);});

test('long content is preplanned before fetch, each request is budgeted and aborted segments never retry',async()=>{
 const long={...input,text:'A fact with a condition, not a guarantee. '.repeat(1800)},calls=[];
 const small={...config,contextTokens:8192};
 const transport=createCustomTransport({hasPermission:async()=>true,fetchImpl:async(_,o)=>{
  const body=JSON.parse(o.body);calls.push(body);const source=JSON.parse(body.messages[1].content);
  return response(envelope(JSON.stringify(source.core?{points:[{text:'Conditions matter',refs:[source.core[0][0]]}]}:{text:'Overview'})));
 }});
 assert.equal((await transport.generate(small,'key',long,'article',undefined,()=>{},'en')).text,'Overview');
 assert.ok(calls.length>1&&calls.length<=9);
 const {fitsBudget}=await import('../../native-extension/src/ai/request-budget.js');calls.forEach(b=>assert.ok(fitsBudget(b,8192)));
});
