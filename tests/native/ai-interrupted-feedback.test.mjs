import {test} from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';import {build} from 'esbuild';import {DEFAULTS as PRODUCT_DEFAULTS} from '../../native-extension/src/ai/preferences.js';
// Existing Chinese fixtures remain explicit; ThreadLume defaults are tested separately.
const DEFAULTS={...PRODUCT_DEFAULTS,uiLanguage:'zh-CN',outputLanguage:'zh-CN'};

const code=(await build({stdin:{contents:'import {initAIReader} from "./native-extension/src/ai/controller.js";initAIReader();',resolveDir:process.cwd()},bundle:true,write:false,format:'iife'})).outputFiles[0].text;
const wait=ms=>new Promise(r=>setTimeout(r,ms));async function until(f){for(let i=0;i<160&&!f();i++)await wait(5);assert.ok(f(),'bounded UI checkpoint');}
const result=mode=>mode==='mindmap'?{text:'Cached mindmap',tree:[{text:'CACHED MAP',children:[{text:'CHILD',children:[]}]}]}:{text:'CACHED SUMMARY',highlights:[]};
function reader({first='summary',alloff=false,holdCache=false}={}){
 const d=new JSDOM('<html data-peek-lad="on" data-peek-lad-state="active"><body><div data-testid="primaryColumn"><div data-testid="cellInnerDiv"><article data-testid="tweet"><a href="/a/status/123"><time>now</time></a><div data-testid="tweetText">Video fixture</div><video></video><div role="group"><button data-testid="reply">Reply 1</button><button data-testid="like">Like 2</button></div></article></div></div></body></html>',{url:'https://x.com/a/status/123',runScripts:'dangerously'}),w=d.window,calls=[],cached=[],pending=[],changed=[];let prefs={...DEFAULTS,defaultView:first,...(alloff?{summary:false,mindmap:false}:{})},partition='p1',state='ready';w.innerWidth=1200;
 const v=w.document.querySelector('video');Object.defineProperty(v,'duration',{value:10});Object.defineProperty(v,'textTracks',{value:[{kind:'subtitles',mode:'disabled',language:'en',cues:[{startTime:0,endTime:9,text:'caption'}]}]});
 w.chrome={runtime:{id:'ours',onMessage:{addListener:f=>changed.push(f)},sendMessage:async m=>{calls.push(m);if(m.action==='preferences')return {ok:true,value:prefs};if(m.action==='status')return {ok:true,value:{state,connectionId:partition}};if(m.action==='cached'){if(holdCache)return new Promise(resolve=>cached.push({m,resolve}));return {ok:true,value:m.mode===first?null:result(m.mode)};}if(m.action==='generate')return new Promise(resolve=>pending.push({m,resolve}));return {ok:true,value:null};}}};
 const preferences=p=>{prefs={...prefs,...p};for(const f of changed)f({ns:'peek-ai-v7',action:'stateChanged',preferences:prefs,connectionChanged:false},{id:'ours'});};
 w.eval(code);return {w,calls,cached,pending,preferences,state:value=>{state=value;for(const f of changed)f({ns:'peek-ai-v7',action:'stateChanged',preferences:prefs,connectionChanged:true},{id:'ours'});},partition:p=>{partition=p;w.dispatchEvent(new w.Event('focus'));},disconnect:()=>{state='DISCONNECTED';for(const f of changed)f({ns:'peek-ai-v7',action:'stateChanged',preferences:prefs,connectionChanged:true},{id:'ours'});},exit:()=>{w.document.documentElement.removeAttribute('data-peek-lad');w.document.documentElement.dataset.peekLadState='idle';},close:()=>w.close()};
}

// Restoring loading-only feedback must fail for pending cache and queued waiting.
for(const phase of ['cache','waiting','loading'])for(const state of ['DISCONNECTED','PERMISSION_REQUIRED','CONTEXT_CHANGED','LOGIN_REQUIRED','VERIFICATION_REQUIRED'])test(`A2 ${phase}/${state}: end unfinished feedback, preserve success and recover`,async()=>{
 const r=reader({holdCache:phase!=='loading'}),{w}=r;try{
 await until(()=>phase==='loading'?r.pending.length===1:r.cached.length===2);
 if(phase==='waiting'){for(const p of r.cached)p.resolve({ok:true,value:null});await until(()=>r.pending.length===1);}
 const card=w.document.getElementById('peek-ai-card'),video=w.document.querySelector('video'),success=w.document.querySelector('#pk-ai-view-mindmap').firstChild;
 const body=card.querySelector('.pk-ai-body');w.document.getElementById('pk-ai-tab-mindmap').click();body.scrollTop=71;
 const branch=card.querySelector('.pk-ai-node[aria-expanded]');branch?.click();
 card.querySelector('#pk-ai-fold').click();
 const requests=r.calls.filter(x=>x.action==='generate').length;
 r.state(state);await wait(25);
 const unfinished=phase==='loading'?['summary']:['summary','mindmap'];
 for(const mode of unfinished){const panel=w.document.getElementById('pk-ai-view-'+mode);assert.doesNotMatch(panel.textContent,/等待生成|正在整理/);assert.ok(panel.textContent.includes('前往设置'));if(state==='PERMISSION_REQUIRED')assert.match(panel.textContent,/授权/);if(['DISCONNECTED','CONTEXT_CHANGED','LOGIN_REQUIRED','VERIFICATION_REQUIRED'].includes(state))assert.match(panel.textContent,/桥接已停用/);}
 assert.equal(w.document.getElementById('peek-ai-card'),card);assert.equal(w.document.querySelector('video'),video);if(phase==='loading')assert.equal(body.scrollTop,71);assert.ok(card.classList.contains('pk-ai-collapsed'));
 if(phase==='loading'){assert.equal(w.document.querySelector('#pk-ai-view-mindmap').firstChild,success);assert.ok(branch,'successful map must exercise a real collapsible branch');assert.equal(branch.getAttribute('aria-expanded'),'false');}
 for(const p of r.cached)p.resolve({ok:true,value:result(p.m.mode)});for(const p of r.pending)p.resolve({ok:true,value:{text:'LATE OLD',highlights:[]}});await wait(20);
 assert.equal(card.textContent.includes('LATE OLD'),false);assert.equal(r.calls.filter(x=>x.action==='generate').length,requests);
 // Connection partition change is the authorized automatic recovery trigger.
 r.state('ready');r.partition('p2');await until(()=>phase==='loading'?r.pending.length>requests:r.cached.length>=4);
 if(phase!=='loading')for(const p of r.cached.slice(2))p.resolve({ok:true,value:result(p.m.mode)});
 else r.pending.at(-1).resolve({ok:true,value:result('summary')});
 await until(()=>w.document.querySelector('#peek-ai-card').textContent.includes('CACHED SUMMARY'));
 }finally{r.close();}
});
