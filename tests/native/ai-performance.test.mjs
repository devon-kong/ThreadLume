import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AIService} from '../../native-extension/src/ai/service.js';
import {ProviderStore} from '../../native-extension/src/ai/provider-store.js';
import {createMetrics} from '../../native-extension/src/ai/metrics.js';
test('presentation-qualified measurements use v3 without relabeling persisted v2 samples',()=>{
 const m=createMetrics();
 m.start('owner','new',{kind:'article',mode:'article',provider:'custom'});
 assert.equal(m.snapshot()[0].measurementVersion,4);
 m.restore([{owner:'owner',row:{measurementVersion:2,requestId:'old',kind:'article',mode:'article',provider:'custom',operation:'cache',cache:'hit',visibilityInterrupted:false,firstReadableMs:24}}]);
 assert.equal(m.snapshot()[1].measurementVersion,2);
 assert.equal(m.snapshot()[1].firstReadableMs,24);
 m.display('owner','new',{displayMs:10,visibilityInterrupted:true});
 m.display('owner','new',{displayMs:20,visibilityInterrupted:false});
 const next=createMetrics();next.restore([{owner:'owner',row:m.snapshot()[0]}]);
 assert.equal(next.snapshot()[0].measurementVersion,4);
 assert.equal(next.snapshot()[0].visibilityInterrupted,true);
 assert.equal(next.snapshot()[0].displayMs,10);
});
const area=()=>{const data={};return {data,get:async k=>typeof k==='string'?{[k]:structuredClone(data[k])}:structuredClone(data),set:async v=>Object.assign(data,structuredClone(v)),remove:async k=>delete data[k]};};
const input={kind:'article',focusId:'123',url:'https://x.com/a/status/123',title:'private title',text:'private source'};
async function fixture(request){const storage={local:area(),session:area()};const providers=new ProviderStore({storage,probe:async()=>{}});const service=new AIService({storage,providers,requestCustom:request});await service.init();await providers.save({name:'generic',protocol:'chat-completions',baseURL:'https://normal.example.test/v1',model:'normal'},'private-key');return {service,storage};}
test('public generation timings cover any custom provider, de-duplication, cache and display without source or credentials',async()=>{
 let release,calls=0;const f=await fixture(async(...args)=>{calls++;const emit=args[6];emit({stage:'request'});emit({stage:'response'});emit({stage:'firstByte'});emit({stage:'partial',text:'draft'});await new Promise(r=>release=r);emit({stage:'parsed'});return {text:'final',finished:true,highlights:[]};});
 const events=[];const one=f.service.generate('a',input,'article',{requestId:'req-a',contentMs:501,onProgress:e=>events.push(e)});one.catch(()=>{});
 for(let i=0;i<50&&!release;i++)await new Promise(r=>setTimeout(r,1));
 assert.ok(release,'transport receives a lifecycle observer');
 const two=f.service.generate('b',input,'article',{requestId:'req-b',onProgress:e=>events.push(e)});
 await new Promise(r=>setTimeout(r,10));release();await Promise.all([one,two]);
 await f.service.generate('c',input,'article',{requestId:'req-c'});
 const rows=f.service.performanceSnapshot();
 assert.equal(calls,1);assert.ok(rows.some(r=>r.cache==='hit'));assert.ok(rows.some(r=>r.cache==='shared'));
 const row=rows.find(r=>r.requestId==='req-a');assert.equal(row.contentMs,501);
 for(const key of ['queued','request','response','firstByte','parsed','cacheSaved','done'])assert.equal(typeof row.stages[key],'number',key);
 assert.ok(events.some(e=>e.stage==='partial'));
 assert.equal(f.service.recordDisplay('wrong','req-a',{displayMs:5}),false);
 assert.equal(f.service.recordDisplay('a','req-a',{displayMs:8,firstReadableMs:3}),true);
 assert.equal(f.service.performanceSnapshot().find(r=>r.requestId==='req-a').displayMs,8);
 const json=JSON.stringify(f.service.performanceSnapshot());for(const privateValue of ['private title','private source','private-key','draft','final','https://'])assert.equal(json.includes(privateValue),false);
 assert.equal(JSON.stringify(f.storage.local.data.aiCache).includes('stages'),false);
});
test('worker reconstruction preserves numeric timing in session only, without reopening network work',async()=>{
 const f=await fixture(async()=>({text:'private output',finished:true,highlights:[]}));
 await f.service.generate('owner',input,'article',{requestId:'persisted',contentMs:500});
 await new Promise(r=>setTimeout(r,0));await f.service.metricsWrite;
 assert.equal(f.storage.local.data.aiPerformanceV12,undefined);
 assert.ok(f.storage.session.data.aiPerformanceV12.length);
 assert.equal(JSON.stringify(f.storage.session.data.aiPerformanceV12).includes('private'),false);
 const next=new AIService({storage:f.storage,requestCustom:()=>{throw Error('no probe');}});await next.init();
 const record=next.performanceSnapshot().find(r=>r.requestId==='persisted');assert.equal(record.outcome,'success');assert.equal(record.contentMs,500);
 assert.equal(next.recordDisplay('owner','persisted',{displayMs:123}),true);
});
test('measurement initialization does not let an admitted request survive an off-on preference change',async()=>{
 let requests=0;const f=await fixture(async()=>{requests++;return {text:'must not generate',highlights:[]};});
 const pending=f.service.generate('before-toggle',input,'article');pending.catch(()=>{});
 const off=f.service.savePreferences({summary:false}),on=f.service.savePreferences({summary:true});
 await Promise.all([off,on]);await assert.rejects(pending,/Cancelled|CANCELLED/);assert.equal(requests,0);
});
