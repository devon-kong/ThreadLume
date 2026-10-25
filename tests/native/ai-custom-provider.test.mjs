import {test} from 'node:test';
import assert from 'node:assert/strict';

import * as custom from '../../native-extension/src/ai/custom-provider.js';
const config={name:'My service',protocol:'chat-completions',baseURL:'https://api.example.test/v1',model:'user-model',rememberKey:true};
const article={kind:'article',focusId:'123',url:'https://x.com/a/status/123',title:'Article',text:'A useful article.'};
const video={kind:'video',focusId:'123',url:article.url,title:'Video',duration:12,cues:[{start:1.25,end:3,text:'First cue'},{start:7.125,end:11,text:'Second cue'}],text:'00:00:01 First cue\n00:00:07 Second cue'};
const envelope=(content,finish_reason='stop')=>({id:'ignored',choices:[{index:0,message:{role:'assistant',content:typeof content==='string'?content:JSON.stringify(content)},finish_reason}],usage:{total_tokens:5}});
const throwsCode=(fn,code)=>assert.throws(fn,e=>e.code===code&&e.message===code);

test('custom protocol exposes its pure integration contracts',()=>{
  for(const key of ['normalizeEndpoint','validateProviderConfig','buildChatRequest','parseChatResponse','probeChatResponse','customError'])assert.equal(typeof custom[key],'function',key);
  assert.equal(typeof custom.PROMPT_VERSION,'string');
});

test('URL canonicalization deduplicates endpoint and derives origin-scoped permission without port',()=>{
  const want={baseURL:'https://api.example.test:9443/v1',endpoint:'https://api.example.test:9443/v1/chat/completions',origin:'https://api.example.test:9443',permission:'https://api.example.test/*'};
  for(const url of ['https://API.example.test:9443/v1/',' https://api.example.test:9443/v1/chat/completions/ '])assert.deepEqual(custom.normalizeEndpoint(url),want);
  assert.deepEqual(custom.normalizeEndpoint('https://api.example.test'),{baseURL:'https://api.example.test',endpoint:'https://api.example.test/chat/completions',origin:'https://api.example.test',permission:'https://api.example.test/*'});
});

test('URL rejects insecure schemes, credentials and every query or fragment including empty markers',()=>{
  for(const url of [null,'','http://api.example.test','javascript:alert(1)','https://u:secret@api.example.test/v1','https://@api.example.test','https://api.example.test/v1?q=x','https://api.example.test/v1?','https://api.example.test/#','https://api.example.test/#x','https://api.example.test/\npath','https://api.example.test\\v1'])throwsCode(()=>custom.normalizeEndpoint(url),'CUSTOM_INVALID_URL');
});

test('URL refuses wildcard and malformed hosts before deriving any Chrome host grant',()=>{
  for(const host of ['*','*.example.com','%2a','%2A.example.com','foo*bar.example.com','foo%2abar.example.com','.','..','.example.com','example..com','-bad.example','bad-.example','bad_host.example','a'.repeat(64)+'.example',Array.from({length:5},()=> 'a'.repeat(60)).join('.')])throwsCode(()=>custom.normalizeEndpoint(`https://${host}/v1`),'CUSTOM_INVALID_URL');
});

test('host validation preserves concrete HTTPS domains, IPs, local hosts and normalized international names',()=>{
  for(const [url,permission] of [['https://127.0.0.1:8443/v1','https://127.0.0.1/*'],['https://[::1]:8443/v1','https://[::1]/*'],['https://localhost:8443/v1','https://localhost/*'],['https://例子.测试/v1','https://xn--fsqu00a.xn--0zwm56d/*'],['https://api.example.test./v1','https://api.example.test./*'],['https://api.example.test/a*b','https://api.example.test/*']])assert.equal(custom.normalizeEndpoint(url).permission,permission);
});

test('config requires a user-supplied name, model and single protocol and rejects transport/key fields',()=>{
  assert.deepEqual(custom.validateProviderConfig({...config,id:'custom_123',baseURL:config.baseURL+'/chat/completions/'}),{id:'custom_123',...config});
  assert.equal(custom.validateProviderConfig({...config,rememberKey:undefined}).rememberKey,true);
  for(const bad of [{...config,name:''},{...config,model:''},{...config,protocol:'responses'},{...config,rememberKey:'yes'},{...config,id:'../bad'},{...config,apiKey:'SECRET'},{...config,headers:{}},{...config,url:config.baseURL},{...config,body:{}}])throwsCode(()=>custom.validateProviderConfig(bad),'CUSTOM_INVALID_CONFIG');
});

test('request uses only common nonstream Chat Completions fields and structured source data',()=>{
  const request=custom.buildChatRequest(config,video,'summary');
  assert.deepEqual(Object.keys(request).sort(),['max_tokens','messages','model','stream']);
  assert.equal(request.model,'user-model');assert.equal(request.stream,false);
  assert.equal(request.messages.length,2);assert.equal(request.messages[0].role,'system');assert.equal(request.messages[1].role,'user');
  const source=JSON.parse(request.messages[1].content);
  assert.deepEqual(source,{kind:'video',title:'Video',cues:[{cue:1,text:'First cue'},{cue:2,text:'Second cue'}]});
  assert.match(request.messages[0].content,/bullet_points/);assert.match(request.messages[0].content,/cue/);
  assert.equal(JSON.stringify(request).includes('SECRET'),false);
  throwsCode(()=>custom.buildChatRequest(config,article,'invalid'),'CUSTOM_INVALID_INPUT');
  throwsCode(()=>custom.buildChatRequest(config,{...video,text:'wrong transcript'},'summary'),'CUSTOM_INVALID_INPUT');
});

test('probe request never includes current article and accepts only a stopped exact OK response',()=>{
  const request=custom.buildChatRequest(config,{...article,text:'PRIVATE ARTICLE'},'probe');
  assert.equal(JSON.stringify(request).includes('PRIVATE ARTICLE'),false);assert.equal(request.max_tokens<=256,true);
  assert.equal(custom.probeChatResponse(envelope(' OK ')),true);
  throwsCode(()=>custom.probeChatResponse(envelope('OK, connected')),'CUSTOM_INVALID_RESPONSE');
  throwsCode(()=>custom.probeChatResponse(envelope('OK','length')),'CUSTOM_TRUNCATED');
});

test('article normalized result contains only existing UI result fields',()=>{
  assert.deepEqual(custom.parseChatResponse(envelope({text:'Clear summary'}),'article',article),{text:'Clear summary',highlights:[],timestampUnit:'milliseconds',finished:true});
  assert.deepEqual(custom.parseChatResponse(envelope({text:'Summary'}),'summary',article).highlights,[]);
});

test('video summary maps 1-based cue references to original fractional cue start milliseconds',()=>{
  const result=custom.parseChatResponse(envelope({text:'Overview',highlights:[{cue:1,chapter:'Start',bullet_points:[{cue:2,point:'Second idea'}]}]}),'summary',video);
  assert.deepEqual(result,{text:'Overview',highlights:[{timestamp:1250,chapter:'Start',bullet_points:[{timestamp:7125,point:'Second idea'}]}],timestampUnit:'milliseconds',finished:true});
  for(const cue of [0,3,1.5,'1'])throwsCode(()=>custom.parseChatResponse(envelope({text:'Overview',highlights:[{cue,chapter:'Start',bullet_points:[]}]}),'summary',video),'CUSTOM_INVALID_RESPONSE');
});

test('schema rejects extra fields, missing arrays, nontext values, markdown wrapping and unsupported response forms',()=>{
  for(const body of [{text:'ok',html:'<script>secret</script>'},{text:42},{text:'ok',tree:[]},[],{text:'ok',highlights:[]}])throwsCode(()=>custom.parseChatResponse(envelope(body),'article',article),'CUSTOM_INVALID_RESPONSE');
  for(const body of [{text:'ok'},{text:'ok',highlights:[{cue:1,chapter:'a'}]},{text:'ok',highlights:[{cue:1,chapter:'a',bullet_points:[],timestamp:123}]}])throwsCode(()=>custom.parseChatResponse(envelope(body),'summary',video),'CUSTOM_INVALID_RESPONSE');
  for(const content of ['```json\n{"text":"ok"}\n```','not JSON'])throwsCode(()=>custom.parseChatResponse(envelope(content),'article',article),'CUSTOM_INVALID_RESPONSE');
  const tools=envelope({text:'ok'});tools.choices[0].message.tool_calls=[];
  throwsCode(()=>custom.parseChatResponse(tools,'article',article),'CUSTOM_INVALID_RESPONSE');
  throwsCode(()=>custom.parseChatResponse({choices:[]},'article',article),'CUSTOM_INVALID_RESPONSE');
  throwsCode(()=>custom.parseChatResponse({...envelope({text:'ok'}),error:{message:'SECRET'}},'article',article),'CUSTOM_INVALID_RESPONSE');
});

test('empty and truncated outputs have explicit fixed errors and never expose response text',()=>{
  for(const content of ['', '   ',{text:''},{text:'   '}])throwsCode(()=>custom.parseChatResponse(envelope(content),'article',article),'CUSTOM_EMPTY_OUTPUT');
  throwsCode(()=>custom.parseChatResponse(envelope('{SECRET','length'),'article',article),'CUSTOM_TRUNCATED');
  throwsCode(()=>custom.parseChatResponse(envelope('SECRET','tool_calls'),'article',article),'CUSTOM_INVALID_RESPONSE');
  throwsCode(()=>custom.parseChatResponse(envelope({text:'a'.repeat(12001)}),'article',article),'CUSTOM_INVALID_RESPONSE');
});

test('mindmap keeps text inert and enforces node schema, depth, node count and individual text limits',()=>{
  const tree=[{text:'<img onerror=alert(1)>',children:[{text:'Child',children:[]}]}];
  assert.deepEqual(custom.parseChatResponse(envelope({text:'Overview',tree}),'mindmap',article),{text:'Overview',tree,highlights:[],timestampUnit:'milliseconds',finished:true});
  let deep={text:'leaf',children:[]};for(let i=0;i<8;i++)deep={text:'node',children:[deep]};
  for(const invalid of [[],[{text:'x'}],[{text:'x',children:[],url:'https://evil.test'}],[deep],Array.from({length:201},()=>({text:'x',children:[]})),[{text:'a'.repeat(1001),children:[]}]])throwsCode(()=>custom.parseChatResponse(envelope({text:'Overview',tree:invalid}),'mindmap',article),'CUSTOM_INVALID_RESPONSE');
});

test('timeline chapters, points and aggregate text are bounded without truncation',()=>{
  const h={cue:1,chapter:'Chapter',bullet_points:[]};
  for(const highlights of [Array.from({length:101},()=>h),[{...h,chapter:'a'.repeat(1001)}],[{...h,bullet_points:Array.from({length:21},()=>({cue:1,point:'Point'}))}],Array.from({length:26},()=>({...h,bullet_points:Array.from({length:20},()=>({cue:1,point:'Point'}))}))])throwsCode(()=>custom.parseChatResponse(envelope({text:'Summary',highlights}),'summary',video),'CUSTOM_INVALID_RESPONSE');
  const highlights=[{...h,bullet_points:Array.from({length:20},()=>({cue:1,point:'a'.repeat(1000)}))}];
  throwsCode(()=>custom.parseChatResponse(envelope({text:'a'.repeat(4000),highlights}),'summary',video),'CUSTOM_INVALID_RESPONSE');
});

test('oversized articles and cue payloads are explicitly refused before constructing requests',()=>{
  for(const text of ['a'.repeat(48001),'文'.repeat(35000)])throwsCode(()=>custom.buildChatRequest(config,{...article,text},'article'),'CUSTOM_LOCAL_INPUT_TOO_LONG');
  const cues=Array.from({length:3000},()=>({start:0,end:1,text:'caption'}));
  throwsCode(()=>custom.buildChatRequest(config,{...video,cues,text:cues.map(()=>'00:00:00 caption').join('\n')},'summary'),'CUSTOM_LOCAL_INPUT_TOO_LONG');
});

test('HTTP error mapping returns only fixed categories regardless of remote secrets',()=>{
  for(const [status,body,want] of [[401,{error:{message:'SECRET'}},'CUSTOM_AUTH'],[403,{},'CUSTOM_FORBIDDEN'],[404,{error:{code:'model_not_found',message:'SECRET'}},'CUSTOM_MODEL_UNAVAILABLE'],[429,{error:{code:'insufficient_quota'}},'CUSTOM_QUOTA'],[429,{error:{message:'SECRET'}},'CUSTOM_RATE_LIMITED'],[503,{},'CUSTOM_SERVER'],[0,{},'CUSTOM_NETWORK'],[408,{},'CUSTOM_TIMEOUT'],[400,{error:{code:'context_length_exceeded'}},'CUSTOM_INPUT_TOO_LONG'],[400,{error:{code:'invalid_api_key'}},'CUSTOM_AUTH'],[400,{error:{message:'SECRET'}},'CUSTOM_REQUEST_REJECTED']])assert.equal(custom.customError(status,body),want);
});

test('HTTP404 without a recognized model error names the endpoint failure instead of guessing a model issue',()=>{
  for(const body of [undefined,{},'<html>SECRET</html>',{error:{code:'unknown',message:'SECRET'}}])assert.equal(custom.customError(404,body),'CUSTOM_ENDPOINT_NOT_FOUND');
  assert.equal(custom.customError(404,{error:{code:'model_not_found'}}),'CUSTOM_MODEL_UNAVAILABLE');
});

// Real Comet probe returned HTTP400 + invalid_request_error for an invalid model.
// A rejected request is distinct from a successful but malformed completion.
test('HTTP400/422 request validation errors guide configuration checks without exposing remote text',()=>{
  for(const status of [400,422]){
    for(const body of [{error:{code:'invalid_request_error',type:'invalid_request_error',message:'SECRET'}},undefined,'<html>SECRET</html>'])
      assert.equal(custom.customError(status,body),'CUSTOM_REQUEST_REJECTED');
  }
  assert.equal(custom.customError(400,{error:{code:'invalid_model'}}),'CUSTOM_MODEL_UNAVAILABLE');
  assert.equal(custom.customError(400,{error:{code:'invalid_api_key'}}),'CUSTOM_AUTH');
});
