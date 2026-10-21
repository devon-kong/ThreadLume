import {test} from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';
import {createCard} from '../../native-extension/src/ai/card.js';import {DEFAULTS} from '../../native-extension/src/ai/preferences.js';
test('English controls and live Chinese switch retain user content, result identity and request count',()=>{
 const d=new JSDOM('<!doctype html>').window.document;let requests=0;
 const c=createCard({document:d,input:{kind:'article',title:'摘要'},preferences:DEFAULTS,onSelect:()=>requests++});d.body.append(c.root);
 c.set('article','success',{text:'摘要',providerName:'摘要',highlights:[]});const prose=d.querySelector('.pk-ai-summary');
 assert.ok(d.body.textContent.includes('Summary'));assert.ok(d.body.textContent.includes('Article insights'));assert.equal(prose.textContent,'摘要');
 c.updatePreferences({...DEFAULTS,uiLanguage:'zh-CN'});assert.ok(d.body.textContent.includes('长文解读'));assert.equal(d.querySelector('.pk-ai-summary'),prose);assert.equal(prose.textContent,'摘要');assert.equal(requests,0);
 c.updatePreferences(DEFAULTS);assert.ok(d.body.textContent.includes('Article insights'));assert.equal(prose.textContent,'摘要');c.destroy();
});

test('English settings expose onboarding and disabled Doubao without probing; language saves preserve focus',async()=>{
 const {build}=await import('esbuild');const {normalizePreferences}=await import('../../native-extension/src/ai/preferences.js');
 const bundle=(await build({entryPoints:['native-extension/src/ai/settings.js'],bundle:true,write:false,format:'iife'})).outputFiles[0].text;
 const w=new JSDOM('<main id="peek-settings"></main>',{url:'https://fixture.test',runScripts:'dangerously'}).window;let prefs={...DEFAULTS};const calls=[];
 w.matchMedia=()=>({matches:false,addEventListener(){}});w.chrome={runtime:{id:'ours',getManifest:()=>({version:'0.12.0'}),sendMessage:async m=>{calls.push(m.action);if(m.action==='preferences')return {ok:true,value:prefs};if(m.action==='providers')return {ok:true,value:{activeId:'doubao',services:[]}};if(m.action==='status')return {ok:true,value:{state:'AI_NOT_CONFIGURED'}};if(m.action==='savePreferences'){prefs=normalizePreferences(m.preferences);return {ok:true,value:prefs};}return {ok:false,error:'INVALID_MESSAGE'};}}};
 const until=async f=>{for(let i=0;i<100&&!f();i++)await new Promise(r=>setTimeout(r,5));assert.ok(f());};
 try{w.eval(bundle);await until(()=>w.document.getElementById('pk-provider-add'));const d=w.document;
 assert.equal(d.documentElement.lang,'en');assert.equal(d.getElementById('pk-provider-add').textContent,'Add AI service');assert.equal(d.getElementById('pk-provider-doubao').disabled,true);
 d.getElementById('pk-provider-doubao').click();w.dispatchEvent(new w.Event('focus'));
 const language=d.getElementById('pk-uiLanguage-zh-CN');language.focus();language.click();await until(()=>d.documentElement.lang==='zh-CN');
 assert.equal(d.getElementById('pk-provider-add').textContent,'添加 AI 服务');assert.equal(d.activeElement,language);assert.equal(prefs.outputLanguage,'en');
 assert.equal(calls.some(a=>['generate','connect','check','capture','openSetup'].includes(a)),false);
 }finally{w.close();}
});

for(const initial of ['success','loading','streaming','extracting'])test(`settings output-language notification replaces ${initial} output once, cancels old ownership and rejects stale results`,async()=>{
 const {build}=await import('esbuild');
 const bundle=(await build({stdin:{contents:'import {initAIReader} from "./native-extension/src/ai/controller.js";initAIReader();',resolveDir:process.cwd()},bundle:true,write:false,format:'iife'})).outputFiles[0].text;
 const w=new JSDOM('<html data-peek-lad="on" data-peek-lad-state="active"><body><div data-testid="primaryColumn"><div data-testid="cellInnerDiv"><article><a href="/a/status/123"><time>now</time></a><div data-testid="tweetText">'+('source '.repeat(200))+'</div></article></div></div></body></html>',{url:'https://x.com/a/status/123',runScripts:'dangerously',pretendToBeVisual:true}).window;
 const handlers=[],calls=[],pending=[];let prefs={...DEFAULTS};w.innerWidth=1200;
 w.chrome={runtime:{id:'ours',onMessage:{addListener:f=>handlers.push(f)},sendMessage:async m=>{calls.push(m);if(m.action==='preferences')return {ok:true,value:prefs};if(m.action==='status')return {ok:true,value:{state:'ready',connectionId:'same'}};if(m.action==='generate')return new Promise(resolve=>pending.push({m,resolve}));return {ok:true,value:null};}}};
 const until=async f=>{for(let i=0;i<80&&!f();i++)await new Promise(r=>setTimeout(r,10));assert.ok(f(),'expected controller state');};
 const notify=m=>handlers.forEach(f=>f({ns:'peek-ai-v7',...m},{id:'ours'}));
 try{w.eval(bundle);if(initial==='extracting'){await new Promise(r=>setTimeout(r,100));assert.equal(w.document.querySelector('#peek-ai-card'),null);prefs={...prefs,outputLanguage:'zh-CN'};notify({action:'stateChanged',preferences:prefs,connectionChanged:false});await until(()=>pending.length===1);assert.equal(pending[0].m.outputLanguage,'zh-CN');assert.equal(w.document.querySelector('#pk-ai-language').getAttribute('aria-label'),'Output language: Simplified Chinese');return;}await until(()=>pending.length===1);const old=pending[0];
 if(initial==='success'){old.resolve({ok:true,value:{text:'Old English result',highlights:[]}});await until(()=>w.document.body.textContent.includes('Old English result'));}
 if(initial==='streaming'){notify({action:'generationProgress',mode:'article',outputLanguage:'en',instance:old.m.instance,connectionId:'same',requestId:old.m.requestId,sequence:1,stage:'partial',text:'Old partial result'});await until(()=>w.document.body.textContent.includes('Old partial result'));}
 prefs={...prefs,outputLanguage:'zh-CN'};notify({action:'stateChanged',preferences:prefs,connectionChanged:false});await until(()=>pending.length===2);
 assert.equal(pending[1].m.outputLanguage,'zh-CN');assert.notEqual(pending[1].m.instance,old.m.instance);assert.ok(calls.some(m=>m.action==='cancel'&&m.instance===old.m.instance));assert.equal(w.document.querySelector('#pk-ai-language').getAttribute('aria-label'),'Output language: Simplified Chinese');assert.equal(w.document.body.textContent.includes('Old English result'),false);
 old.resolve({ok:true,value:{text:'STALE',highlights:[]}});pending[1].resolve({ok:true,value:{text:'新的中文结果',highlights:[]}});await until(()=>w.document.body.textContent.includes('新的中文结果'));assert.equal(w.document.body.textContent.includes('STALE'),false);
 prefs={...prefs,uiLanguage:'zh-CN'};notify({action:'stateChanged',preferences:prefs,connectionChanged:false});w.dispatchEvent(new w.Event('focus'));await new Promise(r=>setTimeout(r,40));assert.equal(pending.length,2);assert.equal(calls.some(m=>m.action==='setOutputLanguage'),false);
 }finally{w.close();}
});

test('live UI language updates error recovery, output-language labels and map accessibility without translating model text',()=>{
 const d=new JSDOM('<!doctype html>').window.document;let settings=0,requests=0;
 const c=createCard({document:d,input:{kind:'article',title:'摘要'},preferences:DEFAULTS,onSettings:()=>settings++,onSelect:()=>requests++});d.body.append(c.root);
 c.set('article','error','AI_NOT_CONFIGURED');assert.ok(d.querySelector('.pk-ai-error').textContent.includes('Add AI service'));
 d.querySelector('.pk-ai-error button').click();assert.equal(settings,1);
 c.set('mindmap','success',{tree:[{text:'摘要',children:[{text:'正文'}]}]});const node=d.querySelector('.pk-ai-node');
 c.updatePreferences({...DEFAULTS,uiLanguage:'zh-CN'});
 assert.ok(d.querySelector('.pk-ai-error').textContent.includes('添加 AI 服务'));assert.equal(d.querySelector('#pk-ai-language').getAttribute('aria-label'),'输出语言：English');
 assert.ok(d.querySelector('.pk-ai-map').getAttribute('aria-label').startsWith('思维导图'));assert.ok(node.getAttribute('aria-label').includes('收起'));assert.equal(node.querySelector('.pk-ai-node-label').textContent,'摘要');
 c.updatePreferences(DEFAULTS);assert.equal(d.querySelector('.pk-ai-node'),node);assert.ok(node.getAttribute('aria-label').includes('Collapse'));assert.equal(requests,0);c.destroy();
});
