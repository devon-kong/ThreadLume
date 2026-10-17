import {test} from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';import {build} from 'esbuild';
import {DEFAULTS} from '../../native-extension/src/ai/preferences.js';
const bundle=await build({stdin:{contents:'import {initAIReader} from "./native-extension/src/ai/controller.js"; initAIReader();',resolveDir:process.cwd()},bundle:true,write:false,format:'iife'});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<80&&!fn();i++)await wait(25);assert.ok(fn(),'expected state within 2 seconds');}
test('集成：短帖无卡片零生成；同帖输入变化取消旧任务，迟到结果不回填；关闭清理',async()=>{
 const dom=new JSDOM('<!doctype html><html data-peek-lad="on" data-peek-lad-state="active"><body><div id="peek-reader-topbar"></div><div data-testid="primaryColumn"><section role="region"><div data-testid="cellInnerDiv"><article data-testid="tweet"><a href="/a/status/123"><time>now</time></a><div data-testid="tweetText">short</div></article></div></section></div></body></html>',{url:'https://x.com/a/status/123',runScripts:'dangerously'});
 const w=dom.window,calls=[],pending=[];w.innerWidth=1200;
 w.chrome={runtime:{id:'ours',sendMessage:async m=>{calls.push(m);if(m.action==='preferences')return {ok:true,value:DEFAULTS};if(m.action==='generate')return new Promise(resolve=>pending.push({m,resolve}));return {ok:true,value:null};}}};
 w.eval(bundle.outputFiles[0].text);await wait(50);assert.equal(w.document.getElementById('peek-ai-card'),null);assert.equal(calls.some(m=>m.action==='generate'),false);
 const body=w.document.querySelector('[data-testid="tweetText"]');body.textContent='长'.repeat(1000);await until(()=>pending.length===1);
 const first=pending[0],oldInstance=first.m.instance;body.textContent='新'.repeat(1000);await until(()=>pending.length===2);
 assert.ok(calls.some(m=>m.action==='cancel'&&m.instance===oldInstance));assert.notEqual(pending[1].m.instance,oldInstance);
 first.resolve({ok:true,value:{text:'OLD_RESULT',highlights:[]}});await wait(20);assert.equal(w.document.body.textContent.includes('OLD_RESULT'),false);
 pending[1].resolve({ok:true,value:{text:'NEW_RESULT',highlights:[]}});await until(()=>w.document.body.textContent.includes('NEW_RESULT'));
 w.document.documentElement.removeAttribute('data-peek-lad');await until(()=>!w.document.getElementById('peek-ai-card'));dom.window.close();
});
