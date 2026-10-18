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

test('视图合同：另一模式开始/成功/失败不重建当前脑图，切换保留节点/滚动，重试只影响目标',()=>{
 const dom=new JSDOM('<!doctype html><html><body></body></html>'),d=dom.window.document;
 try{
  const c=createCard({document:d,input:{kind:'video',title:'Fixture'},preferences:{...DEFAULTS,defaultView:'mindmap'},onRetry(){}});d.body.append(c.root);
  c.set('mindmap','success',{text:'Map',tree:[{text:'Root',children:[{text:'Child',children:[]}]}]});const branch=d.querySelector('button.pk-ai-node'),body=d.querySelector('.pk-ai-body');branch.click();branch.focus();body.scrollTop=73;body.scrollLeft=45;
  for(const [state,value] of [['loading',undefined],['success',{text:'Summary',highlights:[]}],['error','NETWORK_ERROR']]){c.set('summary',state,value);assert.equal(d.querySelector('button.pk-ai-node'),branch);assert.equal(branch.getAttribute('aria-expanded'),'false');assert.equal(d.activeElement,branch);assert.equal(body.scrollTop,73);assert.equal(body.scrollLeft,45);}
  const tabs=[...d.querySelectorAll('[role=tab]')];tabs[0].click();body.scrollTop=31;body.scrollLeft=5;tabs[1].click();assert.equal(body.scrollTop,73);assert.equal(body.scrollLeft,45);assert.equal(d.querySelector('button.pk-ai-node'),branch);assert.equal(branch.getAttribute('aria-expanded'),'false');tabs[0].click();assert.equal(body.scrollTop,31);assert.equal(body.scrollLeft,5);
  c.set('mindmap','loading');assert.ok(d.body.textContent.includes('重试摘要'));c.destroy();const fresh=createCard({document:d,input:{kind:'video',title:'Another'},preferences:{...DEFAULTS,defaultView:'mindmap'},onRetry(){}});d.body.append(fresh.root);fresh.set('mindmap','success',{text:'Map',tree:[{text:'Root',children:[{text:'Child',children:[]}]}]});assert.equal(d.querySelector('button.pk-ai-node').getAttribute('aria-expanded'),'true');assert.equal(d.querySelector('.pk-ai-body').scrollTop,0);fresh.destroy();
 }finally{dom.window.close();}
});

test('结果来源：按实际视图显示服务名称，安全文本，旧缓存标为豆包',()=>{const w=new JSDOM('<body></body>').window,d=w.document,c=createCard({document:d,input:{kind:'video',title:'fixture'},preferences:DEFAULTS,onRetry(){}});try{d.body.append(c.root);c.set('summary','success',{text:'Summary',highlights:[],providerId:'custom-a',providerName:'<img src=x> 自定义'});assert.equal(d.querySelector('img'),null);assert.ok(c.root.querySelector('footer').textContent.includes('<img src=x> 自定义'));c.set('mindmap','success',{text:'Map',tree:[{text:'Root',children:[]}]});d.getElementById('pk-ai-tab-mindmap').click();assert.ok(c.root.querySelector('footer').textContent.includes('豆包'));d.getElementById('pk-ai-tab-summary').click();assert.ok(c.root.querySelector('footer').textContent.includes('自定义'));}finally{c.destroy();w.close();}});
