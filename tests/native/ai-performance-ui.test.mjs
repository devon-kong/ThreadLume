import {test} from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';import {build} from 'esbuild';
import {createCard} from '../../native-extension/src/ai/card.js';import {DEFAULTS as PRODUCT_DEFAULTS} from '../../native-extension/src/ai/preferences.js';
// Existing Chinese fixtures remain explicit; ThreadLume defaults are tested separately.
const DEFAULTS={...PRODUCT_DEFAULTS,uiLanguage:'zh-CN',outputLanguage:'zh-CN'};

const wait=ms=>new Promise(r=>setTimeout(r,ms));async function until(f){for(let i=0;i<100&&!f();i++)await wait(10);assert.ok(f(),'bounded checkpoint');}
const code=(await build({stdin:{contents:'import {initAIReader} from "./native-extension/src/ai/controller.js";initAIReader();',resolveDir:process.cwd()},bundle:true,write:false,format:'iife'})).outputFiles[0].text;
function reader({cached=false,deferCache=false}={}){
 const w=new JSDOM('<html data-peek-lad="on" data-peek-lad-state="active"><body><div data-testid="primaryColumn"><div data-testid="cellInnerDiv"><article data-testid="tweet"><a href="/a/status/123"><time>now</time></a><div data-testid="tweetText">Video</div><video></video></article></div></div><button id="comment">Comment</button></body></html>',{url:'https://x.com/a/status/123',runScripts:'dangerously',pretendToBeVisual:true}).window;
 w.innerWidth=1200;const video=w.document.querySelector('video');Object.defineProperty(video,'duration',{value:10});Object.defineProperty(video,'textTracks',{value:[{kind:'subtitles',language:'en',mode:'disabled',cues:[{startTime:0,endTime:9,text:'caption'}]}]});
 const calls=[],pending=[],listeners=[],cachePending=[];
 w.chrome={runtime:{id:'ours',onMessage:{addListener:f=>listeners.push(f)},sendMessage:async m=>{calls.push(m);if(m.action==='preferences')return {ok:true,value:DEFAULTS};if(m.action==='status')return {ok:true,value:{state:'ready',connectionId:'one'}};if(m.action==='cached'){if(deferCache)return new Promise(resolve=>cachePending.push({m,resolve}));if(cached)return {ok:true,value:m.mode==='mindmap'?{text:'map',tree:[{text:'topic',children:[]}]}:{text:'summary',highlights:[]}};}if(m.action==='generate')return new Promise(resolve=>pending.push({m,resolve}));return {ok:true,value:null};}}};
 const progress=(job,text,overrides={},sender={id:'ours'})=>listeners.forEach(f=>f({ns:'peek-ai-v7',action:'generationProgress',instance:job.m.instance,requestId:job.m.requestId,connectionId:'one',mode:job.m.mode,sequence:1,stage:'partial',text,...overrides},sender,()=>{}));
 w.eval(code);return {w,calls,pending,progress,cachePending};
}
const displayOf=(r,request)=>r.calls.find(m=>m.action==='displayed'&&m.requestId===request.requestId&&m.displayMs!==undefined);
function visibility(w,hidden){Object.defineProperty(w.document,'hidden',{configurable:true,value:hidden});w.document.dispatchEvent(new w.Event('visibilitychange'));}
test('cache reads hidden before resolving are excluded from uninterrupted display measurements',async()=>{
 const r=reader({deferCache:true}),{w}=r;try{
  await until(()=>r.cachePending.length===2);const job=r.cachePending.find(p=>p.m.mode==='summary');
  visibility(w,true);visibility(w,false);
  job.resolve({ok:true,value:{text:'summary',highlights:[]}});
  await until(()=>displayOf(r,job.m));assert.equal(displayOf(r,job.m).visibilityInterrupted,true);
 }finally{w.close();}
});
test('prefetched hidden cache views do not masquerade as foreground latency',async()=>{
 const r=reader({cached:true}),{w}=r;try{
  await until(()=>r.calls.some(m=>m.action==='displayed'&&m.displayMs!==undefined));
  const summary=r.calls.find(m=>m.action==='cached'&&m.mode==='summary'),map=r.calls.find(m=>m.action==='cached'&&m.mode==='mindmap');
  assert.equal(displayOf(r,summary).visibilityInterrupted,false);
  visibility(w,true);visibility(w,false);w.document.getElementById('pk-ai-tab-mindmap').click();
  await until(()=>displayOf(r,map));assert.equal(displayOf(r,map).visibilityInterrupted,true);
  assert.equal(r.calls.some(m=>m.action==='displayed'&&m.requestId===summary.requestId&&m.visibilityInterrupted),false,'already displayed sample remains valid');
 }finally{w.close();}
});
test('completed unselected result is marked interrupted even while the document stays visible',async()=>{
 const r=reader(),{w}=r;try{
  await until(()=>r.pending.length===1);const job=r.pending[0];
  w.document.getElementById('pk-ai-tab-mindmap').click();job.resolve({ok:true,value:{text:'summary',highlights:[]}});
  await wait(30);assert.equal(displayOf(r,job.m),undefined);
  w.document.getElementById('pk-ai-tab-summary').click();await until(()=>displayOf(r,job.m));
  assert.equal(w.document.hidden,false);assert.equal(displayOf(r,job.m).visibilityInterrupted,true);
 }finally{w.close();}
});
test('collapse during generation and expand after completion records one interrupted display',async()=>{
 const r=reader(),{w}=r;try{
  await until(()=>r.pending.length===1);const job=r.pending[0],fold=w.document.getElementById('pk-ai-fold');
  fold.click();job.resolve({ok:true,value:{text:'summary',highlights:[]}});await wait(30);
  assert.equal(displayOf(r,job.m),undefined);fold.click();await until(()=>displayOf(r,job.m));
  assert.equal(displayOf(r,job.m).visibilityInterrupted,true);
  fold.click();fold.click();await wait(30);
  assert.equal(r.calls.filter(m=>m.action==='displayed'&&m.requestId===job.m.requestId&&m.displayMs!==undefined).length,1);
 }finally{w.close();}
});
test('default-only generation, selection starts other view once, stop blocks focus/selection and rejects late progress',async()=>{
 const r=reader(),{w}=r;try{
  await until(()=>r.pending.length===1);r.pending[0].resolve({ok:true,value:{text:'done summary',highlights:[]}});
  await wait(50);assert.equal(r.pending.length,1,'hidden mindmap is not generated automatically');
  w.document.getElementById('pk-ai-tab-mindmap').click();await until(()=>r.pending.length===2);
  const map=r.pending[1];w.document.getElementById('pk-ai-stop').click();
  w.document.getElementById('pk-ai-tab-summary').click();w.document.getElementById('pk-ai-tab-mindmap').click();w.dispatchEvent(new w.Event('focus'));await wait(40);
  assert.equal(r.pending.length,2);r.progress(map,'LATE');map.resolve({ok:true,value:{text:'LATE',tree:[{text:'LATE',children:[]}]}});
  await wait(30);assert.equal(w.document.body.textContent.includes('LATE'),false);assert.ok(w.document.body.textContent.includes('done summary'));
 }finally{w.close();}
});
test('stream events are source/request/connection/sequence guarded and keep text node, scroll and focus stable',async()=>{
 const r=reader(),{w}=r;try{
  await until(()=>r.pending.length===1);const job=r.pending[0];
  r.progress(job,'EVIL',{}, {id:'other'});r.progress(job,'WRONG',{requestId:'wrong'});r.progress(job,'OLD',{connectionId:'old'});
  assert.equal(w.document.body.textContent.includes('EVIL'),false);assert.equal(w.document.body.textContent.includes('WRONG'),false);
  r.progress(job,'draft one');await wait(25);const node=w.document.querySelector('.pk-ai-draft');assert.ok(node);const body=w.document.querySelector('.pk-ai-body');body.scrollTop=52;
  w.document.getElementById('comment').focus();r.progress(job,'draft two',{sequence:2});await wait(25);
  assert.equal(w.document.querySelector('.pk-ai-draft'),node);assert.equal(body.scrollTop,52);assert.equal(w.document.activeElement.id,'comment');
  r.progress(job,'OLD ORDER',{sequence:1});assert.equal(node.textContent,'draft two');
  job.resolve({ok:false,error:'CUSTOM_TIMEOUT'});await wait(30);assert.ok(w.document.body.textContent.includes('未完成'));assert.ok(w.document.body.textContent.includes('draft two'));
 }finally{w.close();}
});
test('card repairs: full outline copy, settings-only recovery, stable retry focus and fold semantics',async()=>{
 const w=new JSDOM('<body></body>',{url:'https://x.com'}).window,d=w.document;let copied='';
 const old=globalThis.navigator;Object.defineProperty(globalThis,'navigator',{value:{clipboard:{writeText:async text=>{copied=text;}}},configurable:true});
 let card;try{
  card=createCard({document:d,input:{kind:'video',completion:'available-cues-snapshot'},preferences:DEFAULTS,onRetry:m=>card.set(m,'queued'),onSettings:()=>{}});d.body.append(card.root);
  card.set('mindmap','success',{text:'overview',tree:[{text:'root',children:[{text:'leaf',children:[]}]}]});d.getElementById('pk-ai-tab-mindmap').click();
  [...d.querySelectorAll('button')].find(n=>n.textContent==='复制大纲').click();await wait(0);assert.equal(copied,'- root\n  - leaf');
  assert.ok(d.body.textContent.includes('当前可用字幕'));
  const fold=[...d.querySelectorAll('button')].find(n=>n.textContent==='收起 AI 辅助');assert.equal(fold.getAttribute('aria-expanded'),'true');fold.click();assert.equal(fold.getAttribute('aria-expanded'),'false');
  card.set('summary','error','CUSTOM_AUTH');d.getElementById('pk-ai-tab-summary').click();
  assert.ok(d.getElementById('pk-ai-view-summary').textContent.includes('编辑服务'));assert.equal(d.getElementById('pk-ai-view-summary').textContent.includes('重试摘要'),false);
  card.set('summary','error','CUSTOM_NETWORK');const retry=[...d.querySelectorAll('button')].find(n=>n.textContent==='重试摘要');retry.focus();retry.click();assert.equal(d.activeElement.id,'pk-ai-tab-summary');
 }finally{card?.destroy();w.close();Object.defineProperty(globalThis,'navigator',{value:old,configurable:true});}
});
test('unrelated comment mutations do not rescan focal cells; source changes still invalidate immediately',async()=>{
 const r=reader(),{w}=r;try{
  await until(()=>r.pending.length===1);
  const column=w.document.querySelector('[data-testid="primaryColumn"]'),comment=w.document.createElement('div');comment.textContent='comment';column.append(comment);await wait(20);
  let scans=0;const query=w.document.querySelectorAll.bind(w.document);w.document.querySelectorAll=selector=>{if(selector==='[data-testid="cellInnerDiv"]')scans++;return query(selector);};
  for(let i=0;i<20;i++){comment.firstChild.data='comment '+i;await wait(5);}
  const measured=scans;console.log(JSON.stringify({unrelatedMutations:20,focalScans:measured}));
  assert.ok(measured<=1,`expected <=1 focal scan, got ${measured}`);
  const old=r.pending[0];w.document.querySelector('[data-testid="tweetText"]').textContent='new title';
  await wait(10);assert.ok(r.calls.some(m=>m.action==='cancel'&&m.instance===old.m.instance));
 }finally{w.close();}
});
test('first visible fragment is not counted as first readable sentence',async()=>{
 const r=reader(),{w}=r;try{
  await until(()=>r.pending.length===1);const job=r.pending[0];
  r.progress(job,'首字');await wait(30);
  const first=r.calls.filter(m=>m.action==='displayed'&&m.firstVisibleMs!==undefined);assert.equal(first.length,1);assert.equal(typeof first[0].firstVisibleMs,'number');assert.equal(first[0].firstReadableMs,undefined);
  r.progress(job,'这是一句可供阅读的摘要。'.repeat(5),{sequence:2});await wait(30);
  const readable=r.calls.filter(m=>m.action==='displayed').at(-1);assert.equal(typeof readable.firstReadableMs,'number');assert.ok(readable.firstReadableMs>=readable.firstVisibleMs);
 }finally{w.close();}
});
test('finishing or failing a readable stream preserves the user reading position',()=>{
 const w=new JSDOM('<body></body>',{url:'https://x.com'}).window,d=w.document;
 const card=createCard({document:d,input:{kind:'article'},preferences:DEFAULTS,onRetry:()=>{},onSettings:()=>{}});d.body.append(card.root);
 try{for(const outcome of ['success','error']){
  card.set('article','queued');card.progress('article','A long draft\n'.repeat(100));const body=d.querySelector('.pk-ai-body');body.scrollTop=90;
  card.set('article',outcome,outcome==='success'?{text:'A long final\n'.repeat(100),highlights:[]}:'CUSTOM_TIMEOUT');
  assert.equal(body.scrollTop,90);
 }}finally{card.destroy();w.close();}
});
test('switch language cancels old ownership, reads language cache and generates only current view; late old result stays hidden',async()=>{
 const r=reader(),{w}=r;try{
  await until(()=>r.pending.length===1);const old=r.pending[0];w.document.getElementById('pk-ai-language').click();w.document.getElementById('pk-ai-language-en').click();await until(()=>r.pending.length===2);
  const next=r.pending[1];assert.equal(next.m.outputLanguage,'en');assert.equal(next.m.mode,'summary');assert.notEqual(next.m.instance,old.m.instance);assert.ok(r.calls.some(m=>m.action==='cancel'&&m.instance===old.m.instance));
  old.resolve({ok:true,value:{text:'OLD CHINESE',highlights:[]}});r.progress(old,'OLD PARTIAL');next.resolve({ok:true,value:{text:'English result',highlights:[]}});await wait(30);assert.equal(w.document.body.textContent.includes('OLD CHINESE'),false);assert.ok(w.document.body.textContent.includes('English result'));
 }finally{w.close();}
});
test('English selection survives source rebuild and accepts English request stage',async()=>{
 const r=reader(),{w}=r;try{
  await until(()=>r.pending.length===1);w.document.getElementById('pk-ai-language').click();w.document.getElementById('pk-ai-language-en').click();await until(()=>r.pending.length===2);const english=r.pending[1];r.progress(english,'',{stage:'request',outputLanguage:'en'});assert.match(w.document.querySelector('.pk-ai-toolbar [role=status]').textContent,/生成中/);
  w.document.querySelector('[data-testid="tweetText"]').textContent='Changed title';await until(()=>r.pending.length===3);const fresh=r.pending[2];assert.equal(fresh.m.outputLanguage,'en');assert.equal(w.document.getElementById('pk-ai-language').getAttribute('aria-label'),'输出语言：English');
  r.progress(fresh,'English node',{outputLanguage:'en',preview:{version:1,outputLanguage:'en',text:'English node',tree:[],highlights:[]}});await wait(25);assert.match(w.document.querySelector('.pk-ai-draft').textContent,/English node/);
 }finally{w.close();}
});
test('mindmap timing ignores hidden summary text and starts only when a visible node arrives',async()=>{
 const r=reader(),{w}=r;try{
  await until(()=>r.pending.length===1);w.document.getElementById('pk-ai-tab-mindmap').click();await until(()=>r.pending.length===2);const map=r.pending[1],text='Hidden prose. '.repeat(20);
  r.progress(map,text,{preview:{version:1,outputLanguage:'zh-CN',text,tree:[],highlights:[]}});await wait(30);w.dispatchEvent(new w.Event('focus'));await wait(20);
  assert.equal(r.calls.filter(m=>m.action==='displayed'&&m.requestId===map.m.requestId&&m.firstVisibleMs!==undefined).length,0);
  assert.equal(r.calls.filter(m=>m.action==='displayed'&&m.requestId===map.m.requestId&&m.renderMs!==undefined).length,0);
  r.progress(map,text,{sequence:2,preview:{version:1,outputLanguage:'zh-CN',text,tree:[{id:'0',text:'主题',children:[]}],highlights:[]}});await wait(30);
  const visible=r.calls.find(m=>m.action==='displayed'&&m.requestId===map.m.requestId&&m.firstReadableMs!==undefined);assert.ok(visible);assert.ok(w.document.querySelector('.pk-ai-node'));
 }finally{w.close();}
});
