import {readChatStream} from '../../native-extension/src/ai/chat-stream.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCustomTransport} from '../../native-extension/src/ai/custom-transport.js';
import {buildChatRequest,validateProviderConfig} from '../../native-extension/src/ai/custom-provider.js';
import {createBindingDescriptor,validateBindingDescriptor} from '../../native-extension/src/ai/transport-policy.js';
const config={name:'Any compatible service',protocol:'chat-completions',baseURL:'https://api.example.test/v1',model:'model',stream:true};
const input={kind:'article',focusId:'123',url:'https://x.com/a/status/123',title:'title',text:'source'};
const event=(delta,finish_reason=null)=>`data: ${JSON.stringify({choices:[{index:0,delta,finish_reason}]})}\r\n\r\n`;
const stream=(text,chunkSize=3)=>new Response(new ReadableStream({start(c){const bytes=new TextEncoder().encode(text);for(let i=0;i<bytes.length;i+=chunkSize)c.enqueue(bytes.slice(i,i+chunkSize));c.close();}}),{headers:{'content-type':'text/event-stream'}});
for(const [name,newlines] of [['CR',['\r']],['LF',['\n']],['CRLF',['\r\n']],['mixed',['\r','\r\n','\n']]])test(`SSE ${name} line endings survive one-byte chunks and multiline data`,async()=>{
 const lines=[': keepalive','data: {"choices":','data: [{"index":0,"delta":{"content":"{\\"text\\":\\"中文\\"}"},"finish_reason":null}]}','','data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}','','data: [DONE]',''];
 const body=lines.map((line,i)=>line+newlines[i%newlines.length]).join('');
 const t=createCustomTransport({hasPermission:async()=>true,fetchImpl:async()=>stream(body,1)});
 assert.equal((await t.generate(config,'key',input,'article')).text,'中文');
});
test('stream is explicit, descriptor-bound, absent on old configs; terse output does not lower hard safety cap',()=>{
 assert.equal(validateProviderConfig(config).stream,true);
 assert.equal(buildChatRequest(config,input,'article').stream,true);
 assert.equal(buildChatRequest(config,null,'probe').stream,true);
 const c={...config,id:'p',version:'v',keyRef:'k',rememberKey:true},d=createBindingDescriptor(c,'k');
 assert.equal(d.stream,true);assert.throws(()=>validateBindingDescriptor(d,{...c,stream:false}),/CUSTOM_BINDING_INVALID/);
 assert.equal(buildChatRequest({...config,stream:false},input,'article').stream,false);
 assert.equal(buildChatRequest(config,input,'article').max_tokens,8192);
 assert.match(buildChatRequest(config,input,'article').messages[0].content,/3.?5|3–5/);
});
test('standard SSE with split UTF8 and JSON escapes yields safe partial text before final validation',async()=>{
 const events=[],parts=['{"text":"中文','\\nquote: \\"','yes\\"','"}'];
 const body=parts.map(content=>event({content})).join('')+event({},'stop')+'data: [DONE]\r\n\r\n';
 let request;
 const transport=createCustomTransport({hasPermission:async()=>true,fetchImpl:async(_,o)=>{request=JSON.parse(o.body);return stream(body);}});
 const result=await transport.generate(config,'secret',input,'article',undefined,e=>events.push(e));
 assert.equal(request.stream,true);assert.equal(result.text,'中文\nquote: "yes"');
 assert.ok(events.some(e=>e.stage==='partial'&&e.text==='中文'));
 assert.ok(events.findIndex(e=>e.stage==='partial')<events.findIndex(e=>e.stage==='parsed'));
 assert.ok(events.some(e=>e.stage==='firstByte'));
 assert.equal(JSON.stringify(events).includes('secret'),false);
});
test('stream probe checks OK in the selected mode; no silent fallback on incompatible response',async()=>{
 let calls=0;const t=createCustomTransport({hasPermission:async()=>true,fetchImpl:async()=>{calls++;return stream(event({role:'assistant',content:'OK'})+event({},'stop')+'data: [DONE]\n\n');}});
 assert.equal(await t.probe(config,'key'),true);assert.equal(calls,1);
 const incompatible=createCustomTransport({hasPermission:async()=>true,fetchImpl:async()=>{calls++;return new Response('{"choices":[]}',{headers:{'content-type':'application/json'}});}});
 await assert.rejects(incompatible.generate(config,'key',input,'article'),/CUSTOM_STREAM_UNSUPPORTED/);assert.equal(calls,2);
});
for(const [name,body,code] of [
 ['truncated',event({content:'{"text":"draft'})+event({},'length')+'data: [DONE]\n\n','CUSTOM_TRUNCATED'],
 ['missing completion',event({content:'{"text":"draft"}'}),'CUSTOM_INVALID_RESPONSE'],
 ['tools',event({tool_calls:[{}]})+event({},'stop')+'data: [DONE]\n\n','CUSTOM_INVALID_RESPONSE'],
 ['malformed JSON',event({content:'{"text":"draft",bad}'})+event({},'stop')+'data: [DONE]\n\n','CUSTOM_INVALID_RESPONSE'],
 ['server error','data: {"error":{"message":"secret"}}\n\n','CUSTOM_INVALID_RESPONSE']
])test(`SSE ${name} fails closed`,async()=>{const t=createCustomTransport({hasPermission:async()=>true,fetchImpl:async()=>stream(body)});await assert.rejects(t.generate(config,'key',input,'article'),e=>e.code===code&&!e.message.includes('secret'));});
test('aborting stalled SSE cancels reader and rejects promptly without late progress',async()=>{
 let cancelled=false;const a=new AbortController(),events=[];
 const body=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(event({content:'{"text":"draft'})));},cancel(){cancelled=true;}});
 const t=createCustomTransport({hasPermission:async()=>true,fetchImpl:async()=>new Response(body,{headers:{'content-type':'text/event-stream'}})});
 const pending=t.generate(config,'key',input,'article',a.signal,e=>events.push(e));pending.catch(()=>{});
 await new Promise(r=>setTimeout(r,10));a.abort();
 await assert.rejects(pending,/CANCELLED/);assert.equal(cancelled,true);
 const n=events.length;await new Promise(r=>setTimeout(r,10));assert.equal(events.length,n);
});
test('a nonsettling body cancellation cannot hold the serial generation queue',async()=>{
 const a=new AbortController(),body=new ReadableStream({cancel:()=>new Promise(()=>{})});
 const t=createCustomTransport({hasPermission:async()=>true,fetchImpl:async()=>new Response(body,{headers:{'content-type':'text/event-stream'}})});
 const pending=t.generate(config,'key',input,'article',a.signal);pending.catch(()=>{});await new Promise(r=>setTimeout(r,5));a.abort();
 const result=await Promise.race([pending.then(()=> 'success',e=>e.code),new Promise(r=>setTimeout(()=>r('STALLED'),100))]);
 assert.equal(result,'CANCELLED');
});
test('valid DONE completes without waiting for the server to close its socket',async()=>{
 const body=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(event({content:'{"text":"done"}'})+event({},'stop')+'data: [DONE]\n\n'));},cancel:()=>new Promise(()=>{})});
 const t=createCustomTransport({hasPermission:async()=>true,fetchImpl:async()=>new Response(body,{headers:{'content-type':'text/event-stream'}})});
 const pending=t.generate(config,'key',input,'article');pending.catch(()=>{});
 const result=await Promise.race([pending,new Promise(r=>setTimeout(()=>r('STALLED'),100))]);assert.equal(result.text,'done');
});
test('all split points preserve closed Chinese map nodes and reject erroneous terminal events',async()=>{
 const input={kind:'article',focusId:'123',url:'https://x.com/a/status/123',title:'标题',text:'正文'};
 const content='{"text":"概述","tree":[{"text":"根","children":[{"text":"子\\u4e2d","children":[]}]}]}';
 const event=(text,finish=null)=>'data: '+JSON.stringify({choices:[{index:0,delta:text===null?{}:{content:text},finish_reason:finish}]})+'\n\n';
 const payload=event(content.slice(0,-4))+event(content.slice(-4))+event(null,'stop')+'data: [DONE]\n\n',bytes=new TextEncoder().encode(payload);
 for(let at=1;at<bytes.length;at++){const events=[];const response=new Response(new ReadableStream({start(c){c.enqueue(bytes.slice(0,at));c.enqueue(bytes.slice(at));c.close();}}),{headers:{'content-type':'text/event-stream'}});const result=await readChatStream(response,{mode:'mindmap',input,onEvent:e=>events.push(e)});assert.equal(result.choices[0].message.content,content);assert.ok(events.some(e=>e.preview?.tree.length));}
});

test('bounded reasoning streams may have large repeated metadata while final text remains small',async()=>{
 const reasoning=`data: ${JSON.stringify({id:'event-'+ 'm'.repeat(1000),choices:[{index:0,delta:{reasoning_content:'reason'},finish_reason:null}]})}\n\n`;
 const body=reasoning.repeat(2000)+event({content:'{"text":"Complete"}'})+event({},'stop')+'data: [DONE]\n\n';
 assert.ok(new TextEncoder().encode(body).length>2000000);
 const result=await readChatStream(stream(body,8192),{mode:'article',input});assert.equal(result.choices[0].message.content,'{"text":"Complete"}');
});
test('stream diagnostics distinguish incomplete termination from oversized content without exporting bodies',async()=>{
 await assert.rejects(readChatStream(stream(event({content:'{"text":"small"}'}),2048),{mode:'article',input}),e=>e.code==='CUSTOM_INVALID_RESPONSE'&&e.validationPhase==='invalidStreamIncomplete');
 await assert.rejects(readChatStream(stream(event({content:'x'.repeat(60001)}),65536),{mode:'article',input}),e=>e.code==='CUSTOM_INVALID_RESPONSE'&&e.validationPhase==='invalidStreamContent');
});

test('wire limit remains bounded independently of decoded content',async()=>{
 const response=new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(8*1024*1024+1));c.close();}}),{headers:{'content-type':'text/event-stream'}});
 await assert.rejects(readChatStream(response,{mode:'article',input}),e=>e.code==='CUSTOM_INVALID_RESPONSE'&&e.validationPhase==='invalidStreamBytes');
});
