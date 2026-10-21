import {test} from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';import {build} from 'esbuild';
import {DEFAULTS} from '../../native-extension/src/ai/preferences.js';
const bundle=await build({stdin:{contents:'import {initAIReader} from "./native-extension/src/ai/controller.js"; initAIReader();',resolveDir:process.cwd()},bundle:true,write:false,format:'iife'});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<80&&!fn();i++)await wait(25);assert.ok(fn(),'expected state within 2 seconds');}
test('集成：短帖无卡片零生成；同帖输入变化取消旧任务，迟到结果不回填；关闭清理',async()=>{
 const dom=new JSDOM('<!doctype html><html data-peek-lad="on" data-peek-lad-state="active"><body><div id="peek-reader-topbar"></div><div data-testid="primaryColumn"><section role="region"><div data-testid="cellInnerDiv"><article data-testid="tweet"><a href="/a/status/123"><time>now</time></a><div data-testid="tweetText">short</div></article></div></section></div></body></html>',{url:'https://x.com/a/status/123',runScripts:'dangerously'});
 const w=dom.window,calls=[],pending=[];w.innerWidth=1200;
 w.chrome={storage:{onChanged:{addListener(){}}},runtime:{id:'ours',onMessage:{addListener(){}},sendMessage:async m=>{calls.push(m);if(m.action==='preferences')return {ok:true,value:DEFAULTS};if(m.action==='generate')return new Promise(resolve=>pending.push({m,resolve}));return {ok:true,value:null};}}};
 w.eval(bundle.outputFiles[0].text);await wait(50);assert.equal(w.document.getElementById('peek-ai-card'),null);assert.equal(calls.some(m=>m.action==='generate'),false);
 const body=w.document.querySelector('[data-testid="tweetText"]');body.textContent='长'.repeat(1000);await until(()=>pending.length===1);
 const first=pending[0],oldInstance=first.m.instance;body.textContent='新'.repeat(1000);await until(()=>pending.length===2);
 assert.ok(calls.some(m=>m.action==='cancel'&&m.instance===oldInstance));assert.notEqual(pending[1].m.instance,oldInstance);
 first.resolve({ok:true,value:{text:'OLD_RESULT',highlights:[]}});await wait(20);assert.equal(w.document.body.textContent.includes('OLD_RESULT'),false);
 pending[1].resolve({ok:true,value:{text:'NEW_RESULT',highlights:[]}});await until(()=>w.document.body.textContent.includes('NEW_RESULT'));
 w.document.documentElement.removeAttribute('data-peek-lad');await until(()=>!w.document.getElementById('peek-ai-card'));dom.window.close();
});
test('集成：同连接失败不会因返回焦点自动重发；仅局部重试按钮触发',async()=>{
 const dom=new JSDOM('<!doctype html><html data-peek-lad="on" data-peek-lad-state="active"><body><div id="peek-reader-topbar"></div><div data-testid="primaryColumn"><div data-testid="cellInnerDiv"><article><a href="/a/status/123"><time>now</time></a><div data-testid="tweetText">'+('长'.repeat(1000))+'</div></article></div></div></body></html>',{url:'https://x.com/a/status/123',runScripts:'dangerously'});
 const w=dom.window;w.innerWidth=1200;let requests=0;
 w.chrome={storage:{onChanged:{addListener(){}}},runtime:{id:'ours',onMessage:{addListener(){}},sendMessage:async m=>{if(m.action==='preferences')return {ok:true,value:DEFAULTS};if(m.action==='status')return {ok:true,value:{state:'ready',connectionId:'same'}};if(m.action==='generate'){requests++;return {ok:false,error:'NETWORK_ERROR'};}return {ok:true,value:null};}}};
 try {w.eval(bundle.outputFiles[0].text);await until(()=>w.document.body.textContent.includes('重试摘要'));assert.equal(requests,1);
 for(let i=0;i<3;i++){w.dispatchEvent(new w.Event('focus'));await wait(20);}assert.equal(requests,1);
 [...w.document.querySelectorAll('button')].find(b=>b.textContent==='重试摘要').click();await until(()=>requests===2);} finally {dom.window.close();}
});

test('集成：较旧开启响应不能覆盖较新全关偏好并启动生成',async()=>{
 const dom=new JSDOM('<!doctype html><html data-peek-lad="on" data-peek-lad-state="active"><body><div id="peek-reader-topbar"></div><div data-testid="primaryColumn"><div data-testid="cellInnerDiv"><article><a href="/a/status/123"><time>now</time></a><div data-testid="tweetText">'+('长'.repeat(1000))+'</div></article></div></div></body></html>',{url:'https://x.com/a/status/123',runScripts:'dangerously'});
 const w=dom.window,prefs=[];w.innerWidth=1200;let requests=0;
 w.chrome={storage:{onChanged:{addListener(){}}},runtime:{id:'ours',onMessage:{addListener(){}},sendMessage:async m=>{
  if(m.action==='preferences')return new Promise(resolve=>prefs.push(resolve));
  if(m.action==='status')return {ok:true,value:{state:'ready',connectionId:'same'}};
  if(m.action==='generate'){requests++;return {ok:true,value:{text:'unexpected',highlights:[]}};}
  return {ok:true,value:null};
 }}};
 try {
  w.eval(bundle.outputFiles[0].text);await until(()=>prefs.length===1);
  w.dispatchEvent(new w.Event('focus'));await until(()=>prefs.length===2);
  prefs[1]({ok:true,value:{...DEFAULTS,summary:false,mindmap:false}});await wait(25);
  prefs[0]({ok:true,value:DEFAULTS});await wait(650);
  assert.equal(requests,0);assert.equal(w.document.getElementById('peek-ai-card'),null);
 }finally{dom.window.close();}
});

test('集成：关闭或失活后未完成的偏好读取不得启动生成',async()=>{
 for(const deactivate of [w=>w.document.documentElement.removeAttribute('data-peek-lad'),w=>w.document.documentElement.dataset.peekLadState='idle',w=>{w.innerWidth=800;w.dispatchEvent(new w.Event('resize'));}]){
  const dom=new JSDOM('<html data-peek-lad="on" data-peek-lad-state="active"><body><div data-testid="primaryColumn"><div data-testid="cellInnerDiv"><article><a href="/a/status/123"><time>now</time></a><div data-testid="tweetText">'+('长'.repeat(1000))+'</div></article></div></div></body></html>',{url:'https://x.com/a/status/123',runScripts:'dangerously'});
  const w=dom.window;w.innerWidth=1200;let resolvePrefs,requests=0;
  w.chrome={storage:{onChanged:{addListener(){}}},runtime:{id:'ours',onMessage:{addListener(){}},sendMessage:async m=>{if(m.action==='preferences')return new Promise(resolve=>{resolvePrefs=resolve;});if(m.action==='status')return {ok:true,value:{state:'ready',connectionId:'same'}};if(m.action==='generate')requests++;return {ok:true,value:null};}}};
  try{w.eval(bundle.outputFiles[0].text);await until(()=>resolvePrefs);deactivate(w);await wait(20);resolvePrefs({ok:true,value:DEFAULTS});await wait(650);assert.equal(requests,0);assert.equal(w.document.getElementById('peek-ai-card'),null);}finally{dom.window.close();}
 }
});

test('集成：有效宽度resize不能丢弃在途的全关偏好刷新',async()=>{
 const dom=new JSDOM('<html data-peek-lad="on" data-peek-lad-state="active"><body><div data-testid="primaryColumn"><div data-testid="cellInnerDiv"><article><a href="/a/status/123"><time>now</time></a><div data-testid="tweetText">'+('长'.repeat(1000))+'</div></article></div></div></body></html>',{url:'https://x.com/a/status/123',runScripts:'dangerously'});
 const w=dom.window;w.innerWidth=1200;let resolvePrefs,requests=0,hold=false;
 w.chrome={storage:{onChanged:{addListener(){}}},runtime:{id:'ours',onMessage:{addListener(){}},sendMessage:async m=>{if(m.action==='preferences')return hold?new Promise(resolve=>{resolvePrefs=resolve;}):{ok:true,value:DEFAULTS};if(m.action==='status')return {ok:true,value:{state:'ready',connectionId:'same'}};if(m.action==='generate'){requests++;return {ok:true,value:{text:'summary',highlights:[]}};}return {ok:true,value:null};}}};
 try{w.eval(bundle.outputFiles[0].text);await until(()=>requests===1);hold=true;w.dispatchEvent(new w.Event('focus'));await until(()=>resolvePrefs);w.dispatchEvent(new w.Event('resize'));await wait(25);resolvePrefs({ok:true,value:{...DEFAULTS,summary:false,mindmap:false}});await wait(25);assert.equal(w.document.getElementById('peek-ai-card'),null);w.document.querySelector('[data-testid="tweetText"]').textContent='新'.repeat(1000);await wait(1000);assert.equal(requests,1);assert.equal(w.document.getElementById('peek-ai-card'),null);}finally{dom.window.close();}
});

test('集成：焦点确认只响应自有后台及当前活跃实例，SPA/关闭后旧实例不可确认',async()=>{
 const dom=new JSDOM('<html data-peek-lad="on" data-peek-lad-state="active"><body><div data-testid="primaryColumn"><div data-testid="cellInnerDiv"><article><a href="/a/status/123"><time>now</time></a><div data-testid="tweetText">'+('长'.repeat(1000))+'</div></article></div></div></body></html>',{url:'https://x.com/a/status/123',runScripts:'dangerously'});
 const w=dom.window,handlers=[],requests=[];w.innerWidth=1200;
 w.chrome={storage:{onChanged:{addListener(){}}},runtime:{id:'ours',onMessage:{addListener:f=>handlers.push(f)},sendMessage:async m=>{if(m.action==='preferences')return {ok:true,value:DEFAULTS};if(m.action==='status')return {ok:true,value:{state:'ready',connectionId:'same'}};if(m.action==='generate'){requests.push(m);return {ok:true,value:{text:'summary',highlights:[]}};}return {ok:true,value:null};}}};
 const confirm=(instance,sender={id:'ours'})=>{let value='NO_RESPONSE';for(const f of handlers)f({ns:'peek-ai-v7',action:'confirmFocus',instance},sender,v=>{value=v;});return value;};
 try{w.eval(bundle.outputFiles[0].text);await until(()=>requests.length===1);const first=requests[0];assert.deepEqual(JSON.parse(JSON.stringify(confirm(first.instance))),{focusId:'123',instance:first.instance,url:'https://x.com/a/status/123'});assert.equal(confirm(first.instance,{id:'evil'}),'NO_RESPONSE');assert.equal(confirm(first.instance,{id:'ours',tab:{id:1}}),'NO_RESPONSE');assert.equal(confirm('wrong'),null);w.document.documentElement.dataset.peekLadState='idle';assert.equal(confirm(first.instance),null);w.document.documentElement.dataset.peekLadState='active';w.innerWidth=900;assert.equal(confirm(first.instance),null);w.innerWidth=1200;
 w.history.pushState({},'', '/a/status/456');assert.equal(confirm(first.instance),null);w.document.querySelector('a').href='/a/status/456';w.document.documentElement.dataset.peekLadState='idle';await wait(10);w.document.documentElement.dataset.peekLadState='active';await until(()=>requests.length===2);assert.equal(confirm(first.instance),null);assert.equal(confirm(requests[1].instance).focusId,'456');w.document.documentElement.removeAttribute('data-peek-lad');await wait(10);assert.equal(confirm(requests[1].instance),null);
 }finally{w.close();}
});

test('偏好合同：后台脱敏通知立即收起全关卡片，迟到结果不回填，无需重新focus',async()=>{
 const dom=new JSDOM('<html data-peek-lad="on" data-peek-lad-state="active"><body><div data-testid="primaryColumn"><div data-testid="cellInnerDiv"><article><a href="/a/status/123"><time>now</time></a><div data-testid="tweetText">'+('长'.repeat(1000))+'</div></article></div></div></body></html>',{url:'https://x.com/a/status/123',runScripts:'dangerously'});
 const w=dom.window,changed=[],calls=[];let prefs={...DEFAULTS},release;w.innerWidth=1200;
 w.chrome={runtime:{id:'ours',onMessage:{addListener:f=>changed.push(f)},sendMessage:async m=>{calls.push(m.action);if(m.action==='preferences')return {ok:true,value:prefs};if(m.action==='status')return {ok:true,value:{state:'ready',connectionId:'same'}};if(m.action==='generate')return new Promise(r=>release=r);return {ok:true,value:null};}}};
 try{w.eval(bundle.outputFiles[0].text);await until(()=>release);prefs={...DEFAULTS,summary:false,mindmap:false};for(const f of changed)f({ns:'peek-ai-v7',action:'stateChanged',preferences:prefs,connectionChanged:false},{id:'ours'});await wait(30);assert.equal(w.document.getElementById('peek-ai-card'),null);assert.ok(calls.includes('cancel'));release({ok:true,value:{text:'late',highlights:[]}});await wait(25);assert.equal(w.document.body.textContent.includes('late'),false);assert.equal(calls.filter(x=>x==='generate').length,1);}finally{w.close();}
});

test('偏好合同：单模式后台通知关闭不取消另一模式、不重建当前卡片，关闭模式迟到不回填',async()=>{
 const dom=new JSDOM('<html data-peek-lad="on" data-peek-lad-state="active"><body><div data-testid="primaryColumn"><div data-testid="cellInnerDiv"><article><a href="/a/status/123"><time>now</time></a><div data-testid="tweetText">Video</div><video></video></article></div></div></body></html>',{url:'https://x.com/a/status/123',runScripts:'dangerously'});
 const w=dom.window,changed=[],calls=[],pending=new Map();let prefs={...DEFAULTS};w.innerWidth=1200;
 const video=w.document.querySelector('video');Object.defineProperty(video,'duration',{value:10});Object.defineProperty(video,'textTracks',{value:[{kind:'subtitles',language:'en',mode:'disabled',cues:[{startTime:0,endTime:9,text:'caption'}]}]});
 w.chrome={runtime:{id:'ours',onMessage:{addListener:f=>changed.push(f)},sendMessage:async m=>{calls.push(m);if(m.action==='preferences')return {ok:true,value:prefs};if(m.action==='status')return {ok:true,value:{state:'ready',connectionId:'same'}};if(m.action==='generate')return new Promise(r=>pending.set(m.mode,r));return {ok:true,value:null};}}};
 try{w.eval(bundle.outputFiles[0].text);await until(()=>pending.has('summary'));const card=w.document.getElementById('peek-ai-card');prefs={...DEFAULTS,summary:false};for(const f of changed)f({ns:'peek-ai-v7',action:'stateChanged',preferences:prefs,connectionChanged:false},{id:'ours'});pending.get('summary')({ok:true,value:{text:'late summary',highlights:[]}});await until(()=>pending.has('mindmap'));assert.equal(w.document.getElementById('peek-ai-card'),card);assert.equal(calls.filter(m=>m.action==='cancel').length,0);
 pending.get('mindmap')({ok:true,value:{text:'map',tree:[{text:'kept map',children:[]}]}});await until(()=>w.document.body.textContent.includes('kept map'));assert.equal(card.textContent.includes('late summary'),false);assert.equal(card.querySelector('[role=tab][aria-selected=true]').textContent,'脑图');assert.equal(calls.filter(m=>m.action==='generate').length,2);
 }finally{w.close();}
});

test('后台通知来源：拒绝其他扩展/内容脚本通知，可信后台全关无需 storage API',async()=>{const w=new JSDOM('<html data-peek-lad="on" data-peek-lad-state="active"><body><div data-testid="primaryColumn"><div data-testid="cellInnerDiv"><article><a href="/a/status/123"><time>now</time></a><div data-testid="tweetText">'+('长'.repeat(1000))+'</div></article></div></div></body></html>',{url:'https://x.com/a/status/123',runScripts:'dangerously'}).window,handlers=[];w.innerWidth=1200;let prefs=DEFAULTS;w.chrome={runtime:{id:'ours',onMessage:{addListener:f=>handlers.push(f)},sendMessage:async m=>({ok:true,value:m.action==='preferences'?prefs:m.action==='status'?{state:'ready',connectionId:'same'}:m.action==='generate'?{text:'Summary',highlights:[]}:null})}};try{w.eval(bundle.outputFiles[0].text);await until(()=>w.document.body.textContent.includes('Summary'));const card=w.document.getElementById('peek-ai-card'),message={ns:'peek-ai-v7',action:'stateChanged',preferences:{...DEFAULTS,summary:false,mindmap:false},connectionChanged:false};for(const sender of [{id:'evil'},{id:'ours',tab:{id:1}}])for(const handler of handlers)handler(message,sender);await wait(10);assert.equal(w.document.getElementById('peek-ai-card'),card);prefs=message.preferences;for(const handler of handlers)handler(message,{id:'ours'});assert.equal(w.document.getElementById('peek-ai-card'),null);}finally{w.close();}});
test('Article player mutations preserve card, scroll position and completed result without regenerating',async()=>{
 const dom=new JSDOM('<html data-peek-lad="on" data-peek-lad-state="active"><body><div data-testid="primaryColumn"><div data-testid="cellInnerDiv"><article><a href="/a/status/123"><time>now</time></a><h1 data-testid="twitter-article-title">Title</h1><div data-testid="twitterArticleRichTextView"><p>Source paragraph</p><div data-testid="videoPlayer"><video></video><span id="clock">1:55</span></div><div role="group" id="counts">20</div></div></article></div></div></body></html>',{url:'https://x.com/a/status/123',runScripts:'dangerously'});
 const w=dom.window;w.innerWidth=1200;let requests=0;w.chrome={runtime:{id:'ours',onMessage:{addListener(){}},sendMessage:async m=>{if(m.action==='preferences')return {ok:true,value:DEFAULTS};if(m.action==='status')return {ok:true,value:{state:'ready',connectionId:'same'}};if(m.action==='generate'){requests++;return {ok:true,value:{text:'Stable summary',highlights:[]}};}return {ok:true,value:null};}}};
 try{w.eval(bundle.outputFiles[0].text);await until(()=>w.document.body.textContent.includes('Stable summary'));const card=w.document.getElementById('peek-ai-card'),body=card.querySelector('.pk-ai-body');body.scrollTop=35;w.document.getElementById('clock').textContent='1:54';w.document.getElementById('counts').textContent='21';await wait(950);assert.equal(w.document.getElementById('peek-ai-card'),card);assert.equal(body.scrollTop,35);assert.equal(requests,1);}finally{w.close();}
});
