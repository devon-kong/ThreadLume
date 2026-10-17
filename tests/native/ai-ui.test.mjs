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
