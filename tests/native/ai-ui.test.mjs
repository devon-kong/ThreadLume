import {test} from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';
import {createCard} from '../../native-extension/src/ai/card.js';import {DEFAULTS,modesFor,normalizePreferences} from '../../native-extension/src/ai/preferences.js';
test('设置依赖：全关不生成，文章无脑图，Summary 关闭只脑图且保留时间轴偏好',()=>{
 const p={...DEFAULTS,summary:false};assert.equal(p.timeline,true);assert.deepEqual(modesFor({kind:'video'},p),['mindmap']);assert.deepEqual(modesFor({kind:'article'},p),[]);assert.deepEqual(modesFor({kind:'video'},{...p,mindmap:false}),[]);assert.equal(normalizePreferences({theme:'evil'}).theme,'system');
});
test('安全文本/脑图、固定切换不请求、局部重试不丢成功摘要',()=>{
 const d=new JSDOM('<!doctype html>').window.document;let retries=[];
 const c=createCard({document:d,input:{kind:'video',title:'<script>evil</script>'},preferences:DEFAULTS,onRetry:m=>retries.push(m)});d.body.append(c.root);
 c.set('summary','success',{text:'<img src=x onerror=alert(1)>',highlights:[{timestamp:0,chapter:'chapter',bullet_points:[]}]});
 c.set('mindmap','error','INVALID_MINDMAP');assert.equal(d.querySelector('img'),null);assert.ok(d.body.textContent.includes('<img'));
 const tabs=[...d.querySelectorAll('[role="tab"]')];tabs[1].click();assert.deepEqual(retries,[]);[...d.querySelectorAll('button')].find(b=>b.textContent==='重试脑图').click();assert.deepEqual(retries,['mindmap']);
 c.set('mindmap','success',{text:'map',tree:[{text:'<script>evil</script>',children:[]}]});assert.equal(d.querySelector('script'),null);
 tabs[0].click();assert.ok(d.body.textContent.includes('<img'));assert.equal(c.snapshot().states.summary,'success');
});
test('展开脑图：Esc 在 X 的 document 快捷键前只关弹窗，销毁移除 capture 监听',()=>{
 const w=new JSDOM('<!doctype html><html data-peek-lad="on"><body></body></html>',{url:'https://x.com/a/status/123'}).window,d=w.document;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 let xKeys=0;d.addEventListener('keydown',e=>{if(e.key==='Escape'){xKeys++;e.preventDefault();e.stopImmediatePropagation();}});
 const c=createCard({document:d,input:{kind:'video',title:'test'},preferences:DEFAULTS,onRetry:()=>{}});d.body.append(c.root);
 c.set('mindmap','success',{text:'map',tree:[{text:'root',children:[]}]});d.querySelectorAll('[role=tab]')[1].click();
 for(let i=0;i<3;i++){
  const trigger=[...c.root.querySelectorAll('button')].find(b=>b.textContent==='展开 ↗');trigger.focus();trigger.click();const dialog=d.querySelector('dialog');assert.equal(dialog.open,true);
  dialog.querySelector('button').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  assert.equal(d.querySelector('dialog'),null);assert.equal(d.activeElement,trigger);assert.equal(xKeys,0);assert.equal(d.documentElement.dataset.peekLad,'on');assert.equal(w.location.pathname,'/a/status/123');
 }
 c.destroy();d.body.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert.equal(xKeys,1);w.close();
});
