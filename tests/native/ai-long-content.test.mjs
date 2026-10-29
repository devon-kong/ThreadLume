import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planGeneration,parseNotes,createLongContentRunner} from '../../native-extension/src/ai/long-content.js';
import {prepareChatBuilder,parseChatResponse} from '../../native-extension/src/ai/custom-provider.js';
import {fitsBudget} from '../../native-extension/src/ai/request-budget.js';
import {transcriptOf} from '../../native-extension/src/ai/content-source.js';
const config={name:'Test',protocol:'chat-completions',baseURL:'https://example.test',model:'custom',contextTokens:8192};
const build=prepareChatBuilder(config);
const make=(n=240)=>{const cues=Array.from({length:n},(_,i)=>({start:i*2+.123,end:i*2+1,text:`Finding ${i}: Revenue grew by 17 percent only if costs stayed below 900 dollars. This is not a guarantee. `}));return {kind:'video',focusId:'123',url:'https://x.com/a/status/123',title:'Talk',duration:n*2+10,cues,text:transcriptOf(cues)};};
const envelope=data=>({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(data)}}]});
test('planner keeps short sources single and covers every long-source ID exactly once with bounded overlap',()=>{
 const short=planGeneration(build,config.contextTokens,make(2),'summary','en');assert.equal(short.kind,'single');
 const source=make(),plan=planGeneration(build,config.contextTokens,source,'summary','en');assert.equal(plan.kind,'segmented');assert.ok(plan.chunks.length>=2&&plan.chunks.length<=8);
 assert.deepEqual(plan.chunks.flatMap(c=>c.core.map(u=>u[0])),Array.from({length:240},(_,i)=>i+1));
 for(const c of plan.chunks){assert.ok(fitsBudget(c.body,8192));assert.ok(c.before.length<=2&&c.after.length<=2);}
 const boundary=plan.chunks[1].core[0][0];assert.ok(plan.chunks[0].after.some(u=>u[0]===boundary));assert.ok(plan.chunks[1].before.some(u=>u[0]===boundary-1));
});
test('oversized single cue and too many chunks fail before any request',()=>{
 assert.throws(()=>planGeneration(build,8192,make(10000),'summary','en'),e=>e.code==='CUSTOM_LONG_CONTENT_LIMIT');
 const source=make(1);source.cues[0].text='important condition '.repeat(10000);source.text=transcriptOf(source.cues);
 assert.throws(()=>planGeneration(build,8192,source,'summary','en'),e=>e.code==='CUSTOM_CONTEXT_BUDGET');
});
test('notes accept only core references and reject extra fields, truncation and oversized content',()=>{
 const plan=planGeneration(build,8192,make(),'summary','en'),c=plan.chunks[1],id=c.core[0][0];
 assert.deepEqual(parseNotes(envelope({points:[{text:'Revenue has conditions',refs:[id]}]}),c),{points:[{text:'Revenue has conditions',refs:[id]}]});
 for(const data of [{points:[{text:'bad',refs:[1]}]},{points:[{text:'x'.repeat(10000),refs:[id]}]},{points:[],secret:'x'}])assert.throws(()=>parseNotes(envelope(data),c));
 const truncated=envelope({points:[]});truncated.choices[0].finish_reason='length';assert.throws(()=>parseNotes(truncated,c));
});
test('runner serially maps then reduces, reuses complete notes for map, and preserves global late timestamps',async()=>{
 const runner=createLongContentRunner(build,8192),input=make(),calls=[];
 const send=async(body,{parse,phase})=>{calls.push({body,phase});assert.ok(fitsBudget(body,8192));
  const data=JSON.parse(body.messages[1].content);
  if(phase==='segment')return parse(envelope({points:[{text:'Conditions retained',refs:[data.core.at(-1)[0]]}]}));
  return parse(envelope(phase==='integrate'&&body.messages[0].content.includes('tree')?{text:'Overview',tree:[{text:'Topic',children:[]}]}:{text:'Overview',highlights:[{cue:data.notes.at(-1).points[0].refs[0],chapter:'End',bullet_points:[]}]}));
 };
 const result=await runner.generate(input,'summary','en',undefined,()=>{},send);
 assert.equal(result.highlights[0].timestamp,478123);const count=calls.length;assert.ok(count>=3&&count<=9);
 await runner.generate(input,'mindmap','en',undefined,()=>{},send);assert.equal(calls.length,count+1);
});
test('abort after segment blocks every later dispatch and never caches partial notes',async()=>{
 const runner=createLongContentRunner(build,8192),input=make(),abort=new AbortController();let calls=0;
 const send=async(body,{parse})=>{calls++;const id=JSON.parse(body.messages[1].content).core[0][0];abort.abort();return parse(envelope({points:[{text:'Partial',refs:[id]}]}));};
 await assert.rejects(runner.generate(input,'summary','en',abort.signal,()=>{},send));assert.equal(calls,1);assert.equal(runner.cacheSize(),0);
});
test('final references must have appeared in verified notes even if globally valid',()=>{
 assert.throws(()=>parseChatResponse(envelope({text:'Overview',highlights:[{cue:2,chapter:'No evidence',bullet_points:[]}]}),'summary',make(3),'en',{allowedRefs:new Set([1])}));
});

test('planner splits long article paragraphs without losing Unicode characters',()=>{
 const text=('甲乙👩🏽‍💻 sentence without paragraph breaks '.repeat(500)),input={kind:'article',focusId:'123',url:'https://x.com/a/status/123',title:'Article',text};
 const plan=planGeneration(build,8192,input,'article','zh-CN');assert.equal(plan.kind,'segmented');assert.equal(plan.chunks.flatMap(c=>c.core.map(u=>u[1])).join(''),text);
});
test('planning freezes a detached source snapshot and reducer rejects oversized actual notes',()=>{
 const input=make(),plan=planGeneration(build,8192,input,'summary','en');input.cues[0].start=999;
 assert.equal(plan.source.cues[0].start,.123);assert.equal(Object.isFrozen(plan.source.cues),true);
 assert.throws(()=>plan.reduce([{points:[{text:'huge source '.repeat(50000),refs:[1]}]}]),e=>e.code==='CUSTOM_CONTEXT_BUDGET');
});
test('failure after a successful segment stops and never remembers the partial set',async()=>{
 const runner=createLongContentRunner(build,8192);let calls=0;const events=[];
 await assert.rejects(runner.generate(make(),'summary','en',undefined,e=>events.push(e),async(body,{parse})=>{
  if(++calls===2)throw Error('simulated failure');return parse(envelope({points:[{text:'First verified note',refs:[1]}]}));
 }));assert.equal(calls,2);assert.equal(runner.cacheSize(),0);assert.ok(events.some(e=>e.text?.includes('First verified note')));
});
test('task deadline aborts current stage and blocks all later stages',async()=>{
 const runner=createLongContentRunner(build,8192,{taskTimeoutMs:5});let calls=0;const keep=setTimeout(()=>{},100);
 try{await assert.rejects(runner.generate(make(),'summary','en',undefined,()=>{},async(_,options)=>{calls++;return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));}),e=>e.code==='CUSTOM_TASK_TIMEOUT');assert.equal(calls,1);}finally{clearTimeout(keep);}
});
test('complete notes expire and final failure remains explicit without rerunning map automatically',async()=>{
 let now=0,calls=0;const runner=createLongContentRunner(build,8192,{now:()=>now});
 const send=async(body,{parse,phase})=>{calls++;if(phase==='integrate')throw Error('integration failure');const data=JSON.parse(body.messages[1].content);return parse(envelope({points:[{text:'Note',refs:[data.core[0][0]]}]}));};
 await assert.rejects(runner.generate(make(),'summary','en',undefined,()=>{},send));assert.equal(runner.cacheSize(),1);const first=calls;
 await assert.rejects(runner.generate(make(),'summary','en',undefined,()=>{},send));assert.equal(calls,first+1);
 now=600000;assert.equal(runner.cacheSize(),0);
});

test('segment output reserve is independent of the visible note allowance for reasoning models',()=>{
 const config={name:'Test',protocol:'chat-completions',baseURL:'https://example.test',model:'reasoning-model',contextTokens:16384};
 const plan=planGeneration(prepareChatBuilder(config),16384,make(550),'summary','en');assert.equal(plan.kind,'segmented');
 for(const chunk of plan.chunks){assert.equal(chunk.body.max_tokens,4096);assert.ok(fitsBudget(chunk.body,16384));}
});
