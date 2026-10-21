import {test} from 'node:test';import assert from 'node:assert/strict';
import {modesFor,DEFAULTS as PRODUCT_DEFAULTS} from '../../native-extension/src/ai/preferences.js';
// Existing Chinese fixtures remain explicit; ThreadLume defaults are tested separately.
const DEFAULTS={...PRODUCT_DEFAULTS,uiLanguage:'zh-CN',outputLanguage:'zh-CN'};

import {buildChatRequest} from '../../native-extension/src/ai/custom-provider.js';
import {buildRequest} from '../../native-extension/src/ai/protocol.js';
import {AIService} from '../../native-extension/src/ai/service.js';
const article={kind:'article',focusId:'123',url:'https://x.com/a/status/123',title:'Title',text:'Full body'};
const config={name:'Service',protocol:'chat-completions',baseURL:'https://api.example.test',model:'test',rememberKey:true};
test('article exposes summary first and mindmap on demand, including mindmap-only preference',()=>{
 assert.deepEqual(modesFor(article,DEFAULTS),['article','mindmap']);assert.deepEqual(modesFor(article,{...DEFAULTS,summary:false}),['mindmap']);
});
test('output language is a strict enum; custom and fixed requests support English and article mindmap',()=>{
 assert.match(buildChatRequest(config,article,'mindmap','en').messages[0].content,/in English/);
 assert.throws(()=>buildChatRequest(config,article,'article','fr'),/INVALID_LANGUAGE/);
 const request=JSON.parse(buildRequest('resource','mindmap',article,'en').messages[0].content);assert.equal(request.language,'en');assert.match(request.text,/English/);
});
test('result protocol and language isolate keys without changing provider binding',()=>{
 const s=new AIService({storage:{}});s.connection.partition='p';const zh=s.key(article,'article','zh-CN'),en=s.key(article,'article','en');assert.notEqual(zh,en);assert.match(zh,/reading-v13/);assert.equal(s.connection.partition,'p');
});
import * as streaming from '../../native-extension/src/ai/chat-stream.js';
test('structured preview emits closed child nodes before enclosing root, never guessed or broken objects',()=>{
 assert.equal(typeof streaming.structuredPreview,'function');
 const prefix='{"text":"概述","tree":[{"text":"主题","children":[{"text":"孩子\\u4e2d","children":[]}';
 const p=streaming.structuredPreview(prefix,'mindmap',article,'zh-CN');assert.equal(p.version,1);assert.equal(p.tree[0].text,'孩子中');assert.equal(p.tree[0].id,'0.0');
 const full=streaming.structuredPreview(prefix+']}]}' ,'mindmap',article,'zh-CN');assert.equal(full.tree[0].children[0].id,'0.0');
 assert.equal(streaming.structuredPreview('{"text":"x","tree":[{"text":"half','mindmap',article).tree.length,0);
 assert.equal(streaming.structuredPreview('{"text":"x","tree":[{"text":"bad","children":[],"evil":1}]','mindmap',article).tree.length,0);
});
test('structured chapter preview validates cue references and closed points before publishing',()=>{
 assert.equal(typeof streaming.structuredPreview,'function');const video={...article,kind:'video',text:'00:00:02 a',duration:10,cues:[{start:2,end:3,text:'a'}]};
 const prefix='{"text":"A\\u4e2d","highlights":[{"cue":1,"chapter":"First","bullet_points":[]}';
 assert.equal(streaming.structuredPreview(prefix,'summary',video,'en').highlights[0].timestamp,2000);
 assert.equal(streaming.structuredPreview(prefix.replace('"cue":1','"cue":99'),'summary',video,'en').highlights.length,0);
});
import * as protocol from '../../native-extension/src/ai/protocol.js';
test('Doubao incomplete business stream can preview complete map lines but cannot finish or cache',()=>{
 const event=(type,data)=>'data: '+JSON.stringify({event_type:type,event_data:data})+'\n\n';
 const source=event(2001,{message:{content:JSON.stringify({text:'```mindmap\n## Topic\n- Detail\n- unfin'})}});
 assert.equal(typeof protocol.previewSSE,'function');assert.equal(protocol.previewSSE(source,'mindmap',article,'en').tree[0].text,'Topic');
 assert.throws(()=>protocol.parseSSE(source,'mindmap'),/NO_FIN/);
 assert.equal(protocol.previewSSE(source,'mindmap',article,'en').tree[0].children.length,1);
});
test('preview node validation never re-reads or serializes the full source for each closed node',()=>{
 let reads=0;const source={...article,get text(){reads++;return 'source '.repeat(6000);}};
 const content=JSON.stringify({text:'overview',tree:Array.from({length:150},(_,i)=>({text:'node '+i,children:[]}))});const p=streaming.structuredPreview(content,'mindmap',source);assert.equal(p.tree.length,150);assert.ok(reads<=1,`source read ${reads} times`);
});
test('custom summary requests an overview followed by separate bullet lines in both languages',()=>{
 for(const language of ['zh-CN','en'])assert.match(buildChatRequest(config,article,'article',language).messages[0].content,/one-sentence overview.*newline.*bullet/i);
});
import {parseChatResponse} from '../../native-extension/src/ai/custom-provider.js';
import {createCustomTransport} from '../../native-extension/src/ai/custom-transport.js';
const responseFor=data=>({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(data)}}]});
test('obviously wrong language is rejected, while names and short mixed labels are allowed',()=>{
 const chinese='这是关于通过全球编程活动获得免费开发者服务的说明，参加者需要注册并完成活动任务。'.repeat(4);
 const english='Participants register for the event and complete the required activities to receive developer benefits. '.repeat(4);
 assert.throws(()=>parseChatResponse(responseFor({text:chinese}),'article',article,'en'),/CUSTOM_LANGUAGE_MISMATCH/);
 assert.throws(()=>parseChatResponse(responseFor({text:english}),'article',article,'zh-CN'),/CUSTOM_LANGUAGE_MISMATCH/);
 assert.equal(parseChatResponse(responseFor({text:english+'中文名字'}),'article',article,'en').finished,true);
 assert.equal(parseChatResponse(responseFor({text:'React API 与 GitHub'}),'article',article,'zh-CN').finished,true);
 assert.throws(()=>parseChatResponse(responseFor({text:'Overview',tree:[{text:chinese,children:[]}]}),'mindmap',article,'en'),/CUSTOM_LANGUAGE_MISMATCH/);
});
test('custom transport propagates language check in both response modes without retry',async()=>{
 for(const stream of [false,true]){
  let requests=0;const payload={text:'这是中文回答，虽然用户明确要求使用英文输出，但服务没有遵循要求。'.repeat(6)};
  const envelope=responseFor(payload);const content=envelope.choices[0].message.content;
  const wire=stream?`data: ${JSON.stringify({choices:[{index:0,delta:{content},finish_reason:null}]})}\n\ndata: ${JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`:JSON.stringify(envelope);
  const transport=createCustomTransport({hasPermission:async()=>true,fetchImpl:async()=>{requests++;return new Response(wire,{headers:{'Content-Type':stream?'text/event-stream':'application/json'}});}});
  await assert.rejects(transport.generate({...config,stream},'test-only',article,'article',undefined,undefined,'en'),/CUSTOM_LANGUAGE_MISMATCH/);assert.equal(requests,1);
 }
});
test('mindmap request keeps compatible field order but removes the invisible prose bullet summary',()=>{
 for(const language of ['zh-CN','en']){const prompt=buildChatRequest(config,article,'mindmap',language).messages[0].content;assert.match(prompt,/Put the text field FIRST, followed immediately by tree/);assert.match(prompt,/single brief overview/);assert.doesNotMatch(prompt,/3–5 separate bullet/);}
 const prefix='{"tree":[{"text":"Root","children":[{"text":"Early node","children":[]}';const preview=streaming.structuredPreview(prefix,'mindmap',article,'en');assert.equal(preview.text,'');assert.equal(preview.tree[0].text,'Early node');
});
test('tree-first stream validates final text and Chinese nodes across every byte split',async()=>{
 const event=(delta,finish_reason=null)=>`data: ${JSON.stringify({choices:[{index:0,delta,finish_reason}]})}\n\n`;
 const first='{"tree":[{"text":"主题","children":[{"text":"孩子中","children":[]}',last=']}],"text":"总述"}';
 const bytes=new TextEncoder().encode(event({content:first})+event({content:last})+event({},'stop')+'data: [DONE]\n\n');
 for(let i=1;i<bytes.length;i++){const events=[],body=new ReadableStream({start(c){c.enqueue(bytes.slice(0,i));c.enqueue(bytes.slice(i));c.close();}}),envelope=await streaming.readChatStream(new Response(body,{headers:{'Content-Type':'text/event-stream'}}),{mode:'mindmap',input:article,outputLanguage:'zh-CN',onEvent:e=>events.push(e)});const result=parseChatResponse(envelope,'mindmap',article,'zh-CN');assert.equal(result.text,'总述');assert.equal(result.tree[0].children[0].text,'孩子中');assert.ok(events.some(e=>e.preview?.tree.length&&e.preview.text===''));}
});
test('invalid responses expose only a fixed validation phase, never response text',async()=>{
 const cases=[['invalidJSON',responseFor('{')],['invalidSchema',responseFor({unexpected:'PRIVATE_RESPONSE_MARKER'})],['invalidEnvelope',{choices:[]}]];
 cases[0][1].choices[0].message.content='{PRIVATE_RESPONSE_MARKER';
 for(const [phase,body] of cases){const events=[],transport=createCustomTransport({hasPermission:async()=>true,fetchImpl:async()=>new Response(JSON.stringify(body))});await assert.rejects(transport.generate(config,'test-only',article,'article',undefined,e=>events.push(e)),/CUSTOM_INVALID_RESPONSE/);assert.ok(events.some(e=>e.stage===phase));assert.equal(JSON.stringify(events).includes('PRIVATE_RESPONSE_MARKER'),false);}
 const events=[],transport=createCustomTransport({hasPermission:async()=>true,fetchImpl:async()=>new Response('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}})});await assert.rejects(transport.generate({...config,stream:true},'test-only',article,'article',undefined,e=>events.push(e)),/CUSTOM_INVALID_RESPONSE/);assert.ok(events.some(e=>e.stage==='invalidStream'));
});
