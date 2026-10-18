import {test} from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';import {build} from 'esbuild';import {DEFAULTS} from '../../native-extension/src/ai/preferences.js';
const bundle=await build({entryPoints:['native-extension/src/ai/settings.js'],bundle:true,write:false,format:'iife'}),wait=ms=>new Promise(r=>setTimeout(r,ms));
test('设置：交错保存的旧 ACK 不能覆盖新偏好，失败回滚到最后已确认状态',async()=>{
 const dom=new JSDOM('<!doctype html><main id="peek-settings"></main>',{url:'https://settings.test',runScripts:'dangerously'}),w=dom.window,pending=[];
 w.matchMedia=()=>({matches:false,addEventListener(){}});w.chrome={runtime:{id:'ours',getManifest:()=>({version:'test'}),sendMessage:async m=>{
  if(m.action==='preferences')return {ok:true,value:DEFAULTS};if(m.action==='status')return {ok:true,value:{state:'DISCONNECTED'}};
  if(m.action==='savePreferences')return new Promise(resolve=>pending.push({m,resolve}));
 }}};
 w.eval(bundle.outputFiles[0].text);await wait(10);w.document.getElementById('pk-pref-summary').click();await wait(1);w.document.getElementById('pk-pref-mindmap').click();
 pending[0].resolve({ok:true,value:pending[0].m.preferences});await wait(5);
 assert.equal(w.document.getElementById('pk-pref-mindmap').checked,false);
 [...w.document.querySelectorAll('button')].find(n=>n.textContent==='浅色').click();pending[1].resolve({ok:true,value:pending[1].m.preferences});await wait(5);
 assert.equal(pending[2].m.preferences.mindmap,false);pending[2].resolve({ok:false,error:'INTERNAL_ERROR'});await wait(5);
 assert.equal(w.document.getElementById('pk-pref-mindmap').checked,false);assert.ok(w.document.body.textContent.includes('保存失败'));dom.window.close();
});

test('设置：登录或验证阻断时只读打开与focus不自动探测，仅完成后检测触发',async()=>{
 for(const state of ['LOGIN_REQUIRED','VERIFICATION_REQUIRED']){
  const dom=new JSDOM('<main id="peek-settings"></main>',{url:'https://settings.test',runScripts:'dangerously'}),w=dom.window;let captures=0;
  w.matchMedia=()=>({matches:false,addEventListener(){}});
  w.chrome={runtime:{id:'ours',getManifest:()=>({version:'test'}),sendMessage:async m=>{if(m.action==='preferences')return {ok:true,value:DEFAULTS};if(m.action==='status')return {ok:true,value:{state,setupOpen:true}};if(m.action==='capture'){captures++;return {ok:false,error:state};}return {ok:true,value:null};}}};
  try{w.eval(bundle.outputFiles[0].text);await wait(10);w.dispatchEvent(new w.Event('focus'));await wait(10);assert.equal(captures,0);[...w.document.querySelectorAll('button')].find(b=>b.textContent==='完成后检测').click();await wait(10);assert.equal(captures,1);}finally{dom.window.close();}
 }
});

test('设置：连接验证失败后旧focus状态不得覆盖阻断并再次自动capture',async()=>{
 for(const state of ['LOGIN_REQUIRED','VERIFICATION_REQUIRED']){
  const dom=new JSDOM('<main id="peek-settings"></main>',{url:'https://settings.test',runScripts:'dangerously'}),w=dom.window;let captures=0,statuses=0,oldStatus;
  w.matchMedia=()=>({matches:false,addEventListener(){}});
  w.chrome={runtime:{id:'ours',getManifest:()=>({version:'test'}),sendMessage:async m=>{if(m.action==='preferences')return {ok:true,value:DEFAULTS};if(m.action==='status'){if(++statuses===1)return {ok:true,value:{state,setupOpen:true}};return new Promise(resolve=>{oldStatus=resolve;});}if(m.action==='capture'){captures++;return {ok:false,error:state};}return {ok:true,value:null};}}};
  try{w.eval(bundle.outputFiles[0].text);await wait(10);w.dispatchEvent(new w.Event('focus'));await wait(5);[...w.document.querySelectorAll('button')].find(b=>b.textContent==='完成后检测').click();await wait(10);oldStatus({ok:true,value:{state:'NEEDS_INITIALIZATION',setupOpen:true}});await wait(15);assert.equal(captures,1);assert.ok(w.document.body.textContent.includes(state==='LOGIN_REQUIRED'?'需要登录':'请求被拒绝'));}finally{dom.window.close();}
 }
});


test('设置：保存期间的focus不能读取旧偏好并覆盖保存ACK',async()=>{
 const dom=new JSDOM('<main id="peek-settings"></main>',{url:'https://settings.test',runScripts:'dangerously'}),w=dom.window;let reads=0,saveAck,staleRead;
 w.matchMedia=()=>({matches:false,addEventListener(){}});
 w.chrome={runtime:{id:'ours',getManifest:()=>({version:'test'}),sendMessage:async m=>{
  if(m.action==='preferences'){if(++reads===1)return {ok:true,value:DEFAULTS};return new Promise(resolve=>{staleRead=resolve;});}
  if(m.action==='status')return {ok:true,value:{state:'DISCONNECTED'}};
  if(m.action==='savePreferences')return new Promise(resolve=>{saveAck=()=>resolve({ok:true,value:m.preferences});});
 }}};
 try{w.eval(bundle.outputFiles[0].text);await wait(10);w.document.getElementById('pk-pref-summary').click();await wait(5);w.dispatchEvent(new w.Event('focus'));await wait(5);saveAck();await wait(5);staleRead?.({ok:true,value:DEFAULTS});await wait(10);assert.equal(w.document.getElementById('pk-pref-summary').checked,false);assert.equal(reads,1);}finally{dom.window.close();}
});

test('设置布局合同：所有卡片水平内边距一致，按钮/更多/开关保留44像素命中区',async()=>{
 const {readFile}=await import('node:fs/promises'),css=await readFile('native-extension/ai.css','utf8');
 const dom=new JSDOM('<html><head><style>'+css+'</style></head><body class="pk-settings-page"><main id="peek-settings"></main></body></html>',{url:'https://fixture.test',runScripts:'dangerously'}),w=dom.window;
 w.matchMedia=()=>({matches:false,addEventListener(){}});w.chrome={runtime:{id:'ours',getManifest:()=>({version:'test'}),sendMessage:async m=>({ok:true,value:m.action==='preferences'?DEFAULTS:{state:'VERIFICATION_REQUIRED',setupOpen:false}})}};
 try{w.eval(bundle.outputFiles[0].text);await wait(15);const cards=[...w.document.querySelectorAll('.pk-settings-card')];assert.equal(cards.length,4);for(const card of cards){assert.equal(w.getComputedStyle(card).paddingLeft,'24px');assert.equal(w.getComputedStyle(card).paddingRight,'24px');}for(const control of w.document.querySelectorAll('button,.pk-settings-more>summary,input[type=checkbox]')){const style=w.getComputedStyle(control);assert.ok(Math.max(parseFloat(style.width)||0,parseFloat(style.minWidth)||0)>=44,control.outerHTML);assert.ok(Math.max(parseFloat(style.height)||0,parseFloat(style.minHeight)||0)>=44,control.outerHTML);}}finally{w.close();}
});
