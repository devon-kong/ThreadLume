import {test} from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';import {build} from 'esbuild';import {DEFAULTS} from '../../native-extension/src/ai/preferences.js';
const code=(await build({stdin:{contents:'import {initAIReader} from "./native-extension/src/ai/controller.js";initAIReader();',resolveDir:process.cwd()},bundle:true,write:false,format:'iife'})).outputFiles[0].text;
const wait=ms=>new Promise(r=>setTimeout(r,ms));async function until(f){for(let i=0;i<160&&!f();i++)await wait(5);assert.ok(f(),'bounded UI checkpoint');}
const result=mode=>mode==='mindmap'?{text:'Cached mindmap',tree:[{text:'CACHED MAP',children:[]}]}:{text:'CACHED SUMMARY',highlights:[]};
function reader({first='summary',alloff=false,holdCache=false}={}){
 const d=new JSDOM('<html data-peek-lad="on" data-peek-lad-state="active"><body><div data-testid="primaryColumn"><div data-testid="cellInnerDiv"><article data-testid="tweet"><a href="/a/status/123"><time>now</time></a><div data-testid="tweetText">Video fixture</div><video></video><div role="group"><button data-testid="reply">Reply 1</button><button data-testid="like">Like 2</button></div></article></div></div></body></html>',{url:'https://x.com/a/status/123',runScripts:'dangerously'}),w=d.window,calls=[],cached=[],pending=[],changed=[];let prefs={...DEFAULTS,defaultView:first,...(alloff?{summary:false,mindmap:false}:{})},partition='p1',state='ready';w.innerWidth=1200;
 const v=w.document.querySelector('video');Object.defineProperty(v,'duration',{value:10});Object.defineProperty(v,'textTracks',{value:[{kind:'subtitles',mode:'disabled',language:'en',cues:[{startTime:0,endTime:9,text:'caption'}]}]});
 w.chrome={runtime:{id:'ours',onMessage:{addListener:f=>changed.push(f)},sendMessage:async m=>{calls.push(m);if(m.action==='preferences')return {ok:true,value:prefs};if(m.action==='status')return {ok:true,value:{state,connectionId:partition}};if(m.action==='cached'){if(holdCache)return new Promise(resolve=>cached.push({m,resolve}));return {ok:true,value:m.mode===first?null:result(m.mode)};}if(m.action==='generate')return new Promise(resolve=>pending.push({m,resolve}));return {ok:true,value:null};}}};
 const preferences=p=>{prefs={...prefs,...p};for(const f of changed)f({ns:'peek-ai-v7',action:'stateChanged',preferences:prefs,connectionChanged:false},{id:'ours'});};
 w.eval(code);return {w,calls,cached,pending,preferences,partition:p=>{partition=p;w.dispatchEvent(new w.Event('focus'));},disconnect:()=>{state='DISCONNECTED';for(const f of changed)f({ns:'peek-ai-v7',action:'stateChanged',preferences:prefs,connectionChanged:true},{id:'ours'});},exit:()=>{w.document.documentElement.removeAttribute('data-peek-lad');w.document.documentElement.dataset.peekLadState='idle';},close:()=>w.close()};
}
for(const first of ['summary','mindmap'])for(const outcome of ['pending','TIMEOUT','NETWORK_ERROR'])test(`F3 ${first} ${outcome}: opposite cached view reads immediately without extra generation`,async()=>{
 const r=reader({first}),{w}=r,other=first==='summary'?'mindmap':'summary';try{
 await until(()=>r.pending.length===1);const card=w.document.getElementById('peek-ai-card');w.document.getElementById('pk-ai-tab-'+other).click();
 await until(()=>card.textContent.includes(other==='summary'?'CACHED SUMMARY':'CACHED MAP'));
 if(outcome!=='pending'){r.pending[0].resolve({ok:false,error:outcome});await wait(20);}
 for(let i=0;i<3;i++){w.document.getElementById('pk-ai-tab-'+first).click();w.document.getElementById('pk-ai-tab-'+other).click();}
 assert.equal(w.document.getElementById('peek-ai-card'),card);assert.equal(r.calls.filter(m=>m.action==='generate').length,1);assert.equal(r.pending[0].m.mode,first);assert.ok(card.textContent.includes(other==='summary'?'CACHED SUMMARY':'CACHED MAP'));
 }finally{r.close();}
});
for(const action of ['post','input','partition','disconnect','close','disable','off-on'])test(`F3 cache ownership: ${action} while cache read pending rejects late old data`,async()=>{
 const r=reader({holdCache:true}),{w}=r;try{
 await until(()=>r.cached.length===2);const old=[...r.cached];
 if(action==='post'){w.history.pushState({},'', '/a/status/456');w.document.querySelector('a').href='/a/status/456';w.dispatchEvent(new w.Event('focus'));}
 if(action==='input')w.document.querySelector('[data-testid="tweetText"]').textContent='Changed input';
 if(action==='partition')r.partition('p2');if(action==='disconnect')r.disconnect();
 if(action==='close')r.exit();
 if(action==='disable')r.preferences({summary:false,mindmap:false});
 if(action==='off-on'){r.preferences({mindmap:false});r.preferences({mindmap:true});}
 await wait(40);for(const job of old)job.resolve({ok:true,value:result(job.m.mode)});await wait(40);
 assert.equal(w.document.body.textContent.includes('CACHED MAP'),false);if(action!=='off-on')assert.equal(w.document.body.textContent.includes('CACHED SUMMARY'),false);
 assert.equal(r.calls.filter(m=>m.action==='generate'&&m.instance===old[0].m.instance).length,0);
 }finally{r.close();}
});
for(const initial of ['off','on'])for(const action of ['exit','narrow','dynamic'])test(`F1 ${initial}/${action}: owned DOM cleans with or without current; repeated entry is unique`,async()=>{
 const r=reader({alloff:initial==='off'}),{w}=r;try{
 await until(()=>w.document.querySelector('[data-peek-feishu]'));if(action==='dynamic'){r.preferences({summary:false,mindmap:false});await wait(30);}
 for(let i=0;i<3;i++){
 if(action==='narrow'){w.innerWidth=900;w.dispatchEvent(new w.Event('resize'));}else r.exit();await wait(30);
 assert.equal(w.document.querySelectorAll('[data-peek-feishu]').length,0);assert.equal(w.document.querySelector('#peek-ai-card'),null);assert.equal(w.document.documentElement.hasAttribute('data-peek-ai-card'),false);assert.equal(w.document.documentElement.style.getPropertyValue('--peek-ai-space'),'');
 assert.equal(w.document.querySelectorAll('[data-testid="reply"],[data-testid="like"]').length,2);
 w.innerWidth=1200;w.document.documentElement.dataset.peekLad='on';w.document.documentElement.dataset.peekLadState='active';w.dispatchEvent(new w.Event('resize'));await until(()=>w.document.querySelector('[data-peek-feishu]'));assert.equal(w.document.querySelectorAll('[data-peek-feishu]').length,1);
 }
 assert.equal(r.calls.some(m=>/feishu/i.test(m.action)),false);
 }finally{r.close();}
});
test('F3 disconnect ends pending generation feedback without rebuilding successful cached content',async()=>{
 const r=reader(),{w}=r;try{
 await until(()=>r.pending.length===1);const card=w.document.getElementById('peek-ai-card');r.disconnect();await wait(30);r.pending[0].resolve({ok:false,error:'CANCELLED'});await wait(30);
 assert.equal(w.document.getElementById('peek-ai-card'),card);assert.equal(card.textContent.includes('正在生成'),false);assert.equal(card.textContent.includes('正在整理'),false);assert.ok(card.textContent.includes('连接'));
 w.document.getElementById('pk-ai-tab-mindmap').click();assert.ok(card.textContent.includes('CACHED MAP'));assert.equal(r.calls.filter(m=>m.action==='generate').length,1);
 }finally{r.close();}
});
test('F3 a stalled default cache read cannot block the opposite cached result',async()=>{
 const r=reader({holdCache:true}),{w}=r;try{
 await until(()=>r.cached.length===2);r.cached.find(x=>x.m.mode==='mindmap').resolve({ok:true,value:result('mindmap')});
 w.document.getElementById('pk-ai-tab-mindmap').click();await until(()=>w.document.body.textContent.includes('CACHED MAP'));assert.equal(r.pending.length,0);
 r.cached.find(x=>x.m.mode==='summary').resolve({ok:true,value:null});await until(()=>r.pending.length===1);assert.equal(r.pending[0].m.mode,'summary');
 }finally{r.close();}
});
test('F3 two cache misses retain default-first serial generation and switching adds no calls',async()=>{
 const r=reader({holdCache:true,first:'mindmap'}),{w}=r;try{
 await until(()=>r.cached.length===2);for(const job of r.cached)job.resolve({ok:true,value:null});await until(()=>r.pending.length===1);
 w.document.getElementById('pk-ai-tab-summary').click();w.document.getElementById('pk-ai-tab-mindmap').click();assert.equal(r.pending.length,1);assert.equal(r.pending[0].m.mode,'mindmap');
 r.pending[0].resolve({ok:false,error:'TIMEOUT'});await until(()=>r.pending.length===2);assert.equal(r.pending[1].m.mode,'summary');
 r.pending[1].resolve({ok:true,value:result('summary')});await wait(20);assert.equal(r.calls.filter(x=>x.action==='generate').length,2);
 }finally{r.close();}
});
