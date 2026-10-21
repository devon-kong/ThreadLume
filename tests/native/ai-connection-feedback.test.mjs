import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
import {DEFAULTS} from '../../native-extension/src/ai/preferences.js';
import {worker} from './helpers/doubao-worker-fixture.mjs';
const bundle=(await build({entryPoints:['native-extension/src/ai/settings.js'],bundle:true,write:false,format:'iife'})).outputFiles[0].text;
const tick=()=>new Promise(r=>setTimeout(r,0));
async function until(fn){for(let i=0;i<80&&!fn();i++)await tick();assert.ok(fn());}
test('open settings immediately reflect trusted connection changes without focus or model probes',async()=>{
 const w=new JSDOM('<main id="peek-settings"></main>',{url:'https://fixture.test',runScripts:'dangerously'}).window;
 let state='ready',reads=0;const listeners=[],actions=[];
 w.matchMedia=()=>({matches:false,addEventListener(){}});
 w.chrome={runtime:{id:'ours',onMessage:{addListener:f=>listeners.push(f)},getManifest:()=>({version:'test'}),sendMessage:async m=>{
  actions.push(m.action);if(m.action==='status'){reads++;return {ok:true,value:{state}};}
  return {ok:true,value:m.action==='preferences'?DEFAULTS:{activeId:'doubao',services:[]}};
 }}};
 try{
  w.eval(bundle);await until(()=>w.document.querySelector('.pk-connected'));
  state='BRIDGE_CLOSED';const before=reads;
  for(const sender of [{id:'other'},{id:'ours',tab:{id:1}}])for(const f of listeners)f({ns:'peek-ai-v7',action:'stateChanged',connectionChanged:true},sender);
  await tick();assert.equal(reads,before);
  for(const f of listeners)f({ns:'peek-ai-v7',action:'stateChanged',connectionChanged:true},{id:'ours'});
  await until(()=>!w.document.querySelector('.pk-connected'));assert.match(w.document.querySelector('.pk-connection-foot').textContent,/关闭|重载/);
  assert.equal(actions.some(a=>['capture','connect','check','openSetup'].includes(a)),false);
 }finally{w.close();}
});
test('worker notifies trusted extension settings as well as content scripts when the bridge session is invalidated',async()=>{
 const w=await worker();const messages=[];
 w.chrome.runtime.sendMessage=async message=>{messages.push(message);};
 await w.ports[0].onMessage.fire({type:'invalidated',code:'BRIDGE_CHANGED'});await until(()=>messages.some(m=>m.action==='stateChanged'&&m.connectionChanged));
 assert.notEqual((await w.status()).value.state,'ready');assert.equal(w.requests.filter(m=>m.op==='probe').length,1);
 for(const m of messages){assert.equal(m.ns,'peek-ai-v7');assert.equal(m.connectionChanged,true);assert.equal(m.key,undefined);assert.equal(m.context,undefined);}
});
