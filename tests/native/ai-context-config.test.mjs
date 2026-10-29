import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateProviderConfig} from '../../native-extension/src/ai/custom-provider.js';
import {protocolConfig,createBindingDescriptor,validateBindingDescriptor} from '../../native-extension/src/ai/transport-policy.js';
const base={id:'service',name:'Service',protocol:'chat-completions',baseURL:'https://example.test/v1',model:'custom-model',rememberKey:true};
test('legacy model configs get a usable default and explicit budgets survive all projections',()=>{
 assert.equal(validateProviderConfig(base).contextTokens,32768);
 for(const contextTokens of [4096,65536,2000000])assert.equal(validateProviderConfig(protocolConfig({...base,contextTokens})).contextTokens,contextTokens);
 for(const contextTokens of [null,'32768',0,4095,2000001,1.5,NaN])assert.throws(()=>validateProviderConfig({...base,contextTokens}),e=>e.code==='CUSTOM_INVALID_CONTEXT');
});
test('budget belongs to immutable binding and legacy descriptors only restore the default budget',()=>{
 const c={...base,version:'version',keyRef:'key',contextTokens:65536};
 const d=createBindingDescriptor(c,c.keyRef);assert.equal(d.schema,2);assert.equal(d.contextTokens,65536);
 assert.deepEqual(validateBindingDescriptor(d,c),d);
 assert.throws(()=>validateBindingDescriptor(d,{...c,contextTokens:32768}));
 const legacy={...d,schema:1};delete legacy.contextTokens;
 assert.deepEqual(validateBindingDescriptor(legacy,{...c,contextTokens:32768}),legacy);
 assert.throws(()=>validateBindingDescriptor(legacy,c));
});

test('editing context rotates generation identity and preserves owned key on failure',async()=>{
 const {ProviderStore}=await import('../../native-extension/src/ai/provider-store.js');
 const area=()=>{const data={};return {get:async()=>structuredClone(data),set:async v=>Object.assign(data,structuredClone(v)),remove:async k=>delete data[k]};};
 let broken=false;const store=new ProviderStore({storage:{local:area(),session:area()},probe:async()=>{if(broken)throw Error('CUSTOM_NETWORK');}});
 const {id,...raw}=base;await store.save(raw,'secret');const first=store.active();
 await store.save({...raw,id:first.id,contextTokens:65536});const next=store.active();
 assert.notEqual(first.version,next.version);assert.equal(store.keyFor(next),'secret');assert.equal(store.list().services[0].contextTokens,65536);
 broken=true;await assert.rejects(store.save({...raw,id:first.id,contextTokens:4096}));assert.equal(store.active(),next);
});

test('long valid source can construct compact tuples and parse results independently of request budget',async()=>{
 const {buildChatRequest,parseChatResponse}=await import('../../native-extension/src/ai/custom-provider.js');
 const cues=Array.from({length:1570},(_,i)=>({start:i*2+.125,end:i*2+1,text:'A complete source sentence with important conditions.'}));
 const {transcriptOf}=await import('../../native-extension/src/ai/content-source.js');
 const input={kind:'video',focusId:'123',url:'https://x.com/a/status/123',title:'Video',duration:4000,cues,text:transcriptOf(cues)};
 const request=buildChatRequest(base,input,'summary');
 assert.deepEqual(JSON.parse(request.messages[1].content).cues[1569],[1570,cues[1569].text]);
 const response={choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({text:'Overview',highlights:[{cue:1570,chapter:'End',bullet_points:[]}]})}}]};
 assert.equal(parseChatResponse(response,'summary',input).highlights[0].timestamp,3138125);
});
