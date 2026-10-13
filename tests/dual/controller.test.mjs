import test from 'node:test';
import assert from 'node:assert/strict';
import { createController, statusURL } from '../../native-dual-extension/src/controller.js';
function mock(split = true) {
  let saved = {}, next = 2, nextWindow = 2;
  const tabs = new Map([[1, { id:1, windowId:1, index:0, pinned:false, groupId:-1, url:'https://x.com/a/status/123' }]]);
  const removed = [], bounds = new Map([[1,{id:1,type:'normal',state:'normal',left:0,top:0,width:1440,height:900}]]);
  const api = { storage:{session:{get:async()=>saved,set:async v=>{saved={...saved,...structuredClone(v)}}}},
    tabs:{get:async id=>{if(!tabs.has(id))throw Error('gone');return {...tabs.get(id)}},create:async p=>{const t={...p,id:next++};tabs.set(t.id,t);return t},remove:async id=>{removed.push(id);tabs.delete(id)},sendMessage:async()=>({screen:{left:51,top:25,width:1749,height:1100}}),...(split?{createSplit:async()=>7,unsplit:async()=>{}}:{})},
    windows:{get:async id=>({...bounds.get(id)}),update:async(id,v)=>{bounds.set(id,{...bounds.get(id),...v})},create:async p=>{const id=nextWindow++;const t={id:next++,windowId:id,url:p.url};tabs.set(t.id,t);bounds.set(id,{id,...p});return {id,tabs:[t]}}}};
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
test('fallback creates two popup carriers and leaves source bounds and tab intact',async()=>{
 const m=mock(false),c=createController(m.api);const p=await c.open(1);assert.equal(p.mode,'popups');assert.equal(p.source,1);assert.notEqual(p.left,1);assert.equal(m.tabs.size,3);assert.equal(m.bounds.get(1).width,1440);
 for(const id of [p.leftWindowId,p.rightWindowId])assert.equal(m.bounds.get(id).type,'popup');
 await c.close(1);assert.deepEqual(m.removed,[p.left,p.right]);assert.ok(m.tabs.has(1));assert.equal(m.bounds.get(1).width,1440);
});
test('popup close preserves reused carrier while closing still-owned peer',async()=>{
 const m=mock(false),c=createController(m.api),p=await c.open(1);m.tabs.get(p.right).url='https://x.com/home';await c.close(1);assert.deepEqual(m.removed,[p.left]);assert.ok(m.tabs.has(p.right));assert.ok(m.tabs.has(1));
});
test('second popup failure rolls back first and preserves source',async()=>{
 const m=mock(false),create=m.api.windows.create;let count=0;m.api.windows.create=async p=>{if(++count===2)throw Error('second failed');return create(p)};
 await assert.rejects(createController(m.api).open(1),/second failed/);assert.deepEqual(m.removed,[2]);assert.ok(m.tabs.has(1));assert.equal(m.state().pair,null);
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
test('native click intent survives worker recreation and opens once after target route',async()=>{
 const m=mock();m.tabs.get(1).url='https://x.com/home';let c=createController(m.api);await c.prepare(1,'https://x.com/a/status/123');c=createController(m.api);
 assert.equal((await c.followIntent(1)).state,'waiting');m.tabs.get(1).url='https://x.com/a/status/123';assert.equal((await c.followIntent(1)).state,'opened');assert.equal((await c.followIntent(1)).state,'idle');assert.equal(m.tabs.size,2);
});
test('intent for known post does not open unrelated native destination or another tab',async()=>{
 const m=mock(),c=createController(m.api);await c.prepare(1,'https://x.com/a/status/123');m.tabs.get(1).url='https://x.com/b/status/456';assert.equal((await c.followIntent(1)).state,'waiting');assert.equal((await c.followIntent(99)).state,'idle');assert.equal(m.tabs.size,1);
});
test('fallback refuses ignored popup geometry and closes both owned carriers',async()=>{
 const m=mock(false),create=m.api.windows.create;m.api.windows.create=async p=>{const w=await create(p);m.bounds.get(w.id).width=900;return w};const c=createController(m.api);
 await assert.rejects(c.open(1),/无法建立真正并排/);assert.deepEqual(m.removed,[2,3]);assert.equal(m.state().pair,null);assert.equal(m.bounds.get(1).width,1440);
});
test('expired native click intent is consumed without opening pages',async()=>{
 const m=mock(),c=createController(m.api);await c.prepare(1,'https://x.com/a/status/123');m.state().intent.expires=0;assert.equal((await c.followIntent(1)).state,'idle');assert.equal(m.tabs.size,1);
});

test('source re-open is idempotent only while source still targets the paired post',async()=>{
 const m=mock(false),c=createController(m.api),p=await c.open(1);assert.equal((await c.open(1)).left,p.left);m.tabs.get(1).url='https://x.com/b/status/456';await assert.rejects(c.open(1),/先结束/);assert.equal(m.tabs.size,3);
});
test('interrupted pending popup pair with null IDs clears safely under synchronous validation',async()=>{
 const m=mock(false);await m.api.storage.session.set({pair:{mode:'popups',pending:true,left:null,right:null,url:'https://x.com/a/status/123'}});m.api.tabs.get=id=>{if(!Number.isInteger(id))throw Error('invalid tab id');return Promise.reject(Error('gone'))};assert.equal(await createController(m.api).role(1),null);assert.equal(m.state().pair,null);
});
