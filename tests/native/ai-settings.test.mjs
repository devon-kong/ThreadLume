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
