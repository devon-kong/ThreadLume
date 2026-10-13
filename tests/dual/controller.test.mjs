import test from 'node:test';
import assert from 'node:assert/strict';
import { createController, statusURL } from '../../native-dual-extension/src/controller.js';
function mock(split = true) {
  let saved = {}, next = 2;
  const tabs = new Map([[1, { id:1, windowId:1, index:0, pinned:false, groupId:-1, url:'https://x.com/a/status/123' }]]);
  const removed = [], bounds = new Map([[1,{id:1,type:'normal',state:'normal',left:0,top:0,width:1440,height:900}]]);
  const api = { storage:{session:{get:async()=>saved,set:async v=>{saved={...saved,...structuredClone(v)}}}},
    tabs:{get:async id=>{if(!tabs.has(id))throw Error('gone');return {...tabs.get(id)}},create:async p=>{const t={...p,id:next++};tabs.set(t.id,t);return t},remove:async id=>{removed.push(id);tabs.delete(id)},sendMessage:async()=>{},...(split?{createSplit:async()=>7,unsplit:async()=>{}}:{})},
    windows:{get:async id=>({...bounds.get(id)}),update:async(id,v)=>{bounds.set(id,{...bounds.get(id),...v})},create:async p=>{const t={id:next++,windowId:2,url:p.url};tabs.set(t.id,t);bounds.set(2,{id:2,...p});return {id:2,tabs:[t]}}}};
  return {api,tabs,removed,bounds,state:()=>saved};
}
test('validate only public exact status routes',()=>{
 assert.equal(statusURL('https://x.com/a/status/123?x=1'),'https://x.com/a/status/123');
 for(const u of ['https://evil.test/a/status/123','https://x.com/i/api/graphql/123','https://x.com/a/status/123/photo/1','https://u:p@x.com/a/status/123']) assert.equal(statusURL(u),null);
});
test('split pair is idempotent and survives controller recreation',async()=>{
 const m=mock();let c=createController(m.api);const p=await c.open(1);assert.equal(p.mode,'split');assert.equal((await c.open(1)).right,p.right);assert.equal(m.tabs.size,2);
 c=createController(m.api);assert.equal((await c.role(p.right)).role,'right');await c.close();assert.deepEqual(m.removed,[p.right]);assert.ok(m.tabs.has(1));
});
test('fallback windows restore unchanged source bounds',async()=>{
 const m=mock(false),c=createController(m.api);const p=await c.open(1);assert.equal(p.mode,'windows');assert.equal(m.bounds.get(1).width,720);await c.close();assert.equal(m.bounds.get(1).width,1440);
});
test('preserve user resized window and right page reused for another route',async()=>{
 const m=mock(false),c=createController(m.api),p=await c.open(1);m.bounds.get(1).width=650;m.tabs.get(p.right).url='https://x.com/home';await c.close();assert.deepEqual(m.removed,[]);assert.equal(m.bounds.get(1).width,650);
});
test('route drift releases without closing either page',async()=>{
 const m=mock(),c=createController(m.api),p=await c.open(1);m.tabs.get(p.right).url='https://x.com/b/status/456';assert.equal(await c.role(p.right),null);assert.equal(m.tabs.size,2);assert.equal(m.state().pair,null);
});
test('split failure rolls back owned page only',async()=>{
 const m=mock();m.api.tabs.createSplit=async()=>{throw Error('split failed')};const c=createController(m.api);await assert.rejects(c.open(1),/split failed/);assert.deepEqual(m.removed,[2]);assert.ok(m.tabs.has(1));assert.equal(m.state().pair,null);
});
test('new right navigation pending is owned; native photo overlay preserves pair',async()=>{
 const m=mock();const original=m.api.tabs.create;m.api.tabs.create=async p=>{const t=await original(p);t.pendingUrl=t.url;delete t.url;return t;};
 const c=createController(m.api),p=await c.open(1);assert.equal((await c.role(1)).role,'left');
 m.tabs.get(p.right).url='https://x.com/a/status/123/photo/1';delete m.tabs.get(p.right).pendingUrl;assert.equal((await c.role(p.right)).role,'right');
});
test('pending unrelated navigation prevents closing owned right tab',async()=>{
 const m=mock(),c=createController(m.api),p=await c.open(1);m.tabs.get(p.right).pendingUrl='https://example.org/';await c.close();assert.deepEqual(m.removed,[]);
});
test('user unsplits or moves right tab: release only, never close either',async()=>{
 for(const change of [{splitViewId:-1},{windowId:99}]){const m=mock(),c=createController(m.api),p=await c.open(1);Object.assign(m.tabs.get(p.right),change);assert.equal(await c.role(1),null);assert.deepEqual(m.removed,[]);}
});
