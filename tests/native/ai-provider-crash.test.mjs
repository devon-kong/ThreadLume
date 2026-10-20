import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ProviderStore} from '../../native-extension/src/ai/provider-store.js';
const config={name:'Service',protocol:'chat-completions',baseURL:'https://api.example.test/v1',model:'old-model',rememberKey:true};
const area=seed=>{const data=structuredClone(seed||{});return {data,get:async k=>typeof k==='string'?{[k]:structuredClone(data[k])}:structuredClone(data),set:async values=>Object.assign(data,structuredClone(values)),remove:async keys=>{for(const k of Array.isArray(keys)?keys:[keys])delete data[k];}};};
const storage=seed=>({local:area(seed?.local),session:area(seed?.session)});
const snapshot=s=>({local:structuredClone(s.local.data),session:structuredClone(s.session.data)});
const store=s=>new ProviderStore({storage:s,probe:async()=>{}});
async function seed(rememberKey){const s=storage(),p=store(s);await p.save({...config,rememberKey},'old-key');return snapshot(s);}
// A write never returns once the selected boundary is reached. No exception,
// abort or finally is allowed to make the crashed instance repair its snapshot.
async function crashAt(seed,n,side,operation){
 const s=storage(seed),p=store(s);await p.init();let count=0,checkpoint;
 const reached=new Promise(r=>checkpoint=r),forever=new Promise(()=>{});
 for(const a of [s.local,s.session])for(const method of ['set','remove']){
  const original=a[method];a[method]=async(...args)=>{const stop=++count===n;if(stop&&side==='before'){checkpoint(snapshot(s));await forever;}await original(...args);if(stop&&side==='after'){checkpoint(snapshot(s));await forever;}};
 }
 const pending=operation(p);
 const result=await Promise.race([reached.then(seed=>({seed})),pending.then(()=>({done:true}),error=>({done:true,error}))]);
 return result;
}
test('each persistence boundary survives worker death without old finally: all Key retention transitions',async()=>{
 for(const from of [true,false])for(const to of [true,false]){
  const initial=await seed(from);let boundaries=0,finished=false;
  for(let n=1;n<24;n++){
   let done=false;
   for(const side of ['before','after']){
    const r=await crashAt(initial,n,side,p=>p.save({...config,id:p.active().id,model:'new-model',rememberKey:to},'new-key'));
    if(r.done){assert.ifError(r.error);done=true;break;}boundaries++;
    const s=storage(r.seed),restored=store(s);let probes=0;restored.probe=async()=>{probes++;};await restored.init();
    const c=restored.active();assert.ok(['old-model','new-model'].includes(c.model));
    assert.equal(restored.keyFor(c),c.model==='old-model'?'old-key':'new-key',`${from}->${to} write ${n}/${side}`);
    assert.equal(c.binding.configVersion,c.version);assert.equal(c.binding.keyRef,c.keyRef);assert.equal(c.binding.model,c.model);
    assert.equal(restored.bindingState(),'ready');assert.equal(probes,0);
   }
   if(done){finished=true;break;}
  }
  assert.ok(finished,'must exhaust every persistence boundary');
  assert.ok(boundaries>=4,'must exercise staging and pointer boundaries');
 }
});
test('candidate Key staging never overwrites Key read by still-current old binding',async()=>{
 const s=storage(),p=store(s);await p.save(config,'old-key');const old=p.active(),set=s.local.set;
 let checked=false;
 s.local.set=async values=>{await set(values);if(!values.aiProvidersV8){checked=true;assert.equal(p.keyFor(old),'old-key');}};
 await p.save({...config,id:old.id,model:'new-model'},'new-key');assert.ok(checked);assert.equal(p.keyFor(p.active()),'new-key');
});
test('restoration rejects mismatched descriptor, Key version and missing session Key without probes or fallback',async()=>{
 for(const rememberKey of [true,false]){
  const initial=await seed(rememberKey);
  for(const kind of ['descriptor','key-version','key-ref','missing']){
   const s=storage(initial),registry=s.local.data.aiProvidersV8,c=registry.services[0];
   if(kind==='descriptor')c.binding.configVersion='wrong-version';
   else {
    const area=c.rememberKey?s.local:s.session;
    const entry=Object.values(area.data).find(v=>v?.keyRef===c.keyRef&&typeof v.secret==='string');assert.ok(entry);
    if(kind==='key-version')entry.configVersion='wrong-version';
    if(kind==='key-ref')entry.keyRef='different-ref';
    if(kind==='missing')for(const [k,v] of Object.entries(area.data))if(v===entry)delete area.data[k];
   }
   let probes=0;const restored=new ProviderStore({storage:s,probe:async()=>{probes++;}});await restored.init();
   assert.notEqual(restored.bindingState(),'ready');assert.equal(restored.keyFor(restored.active()),null);assert.equal(restored.list().activeId,c.id);assert.equal(probes,0);
  }
 }
});

test('legacy migration death at every write leaves old source or consistent versioned records; no dying finally',async()=>{
 const initial={local:{aiProvidersV8:{schema:1,activeId:'one',services:[{...config,id:'one',version:'v1',checkedAt:1},{...config,id:'two',version:'v2',rememberKey:false,checkedAt:1}]},aiProviderKeysV8:{one:'local-key'}},session:{aiProviderKeysV8:{two:'session-key'}}};let boundaries=0,finished=false;
 for(let n=1;n<20;n++){
  let done=false;
  for(const side of ['before','after']){
   const s=storage(initial);let count=0,checkpoint;const reached=new Promise(r=>checkpoint=r),forever=new Promise(()=>{});
   for(const a of [s.local,s.session])for(const method of ['set','remove']){const original=a[method];a[method]=async(...args)=>{const stop=++count===n;if(stop&&side==='before'){checkpoint();await forever;}await original(...args);if(stop&&side==='after'){checkpoint();await forever;}};}
   const old=store(s),pending=old.init();const completed=await Promise.race([reached.then(()=>false),pending.then(()=>true)]);if(completed){done=true;break;}boundaries++;
   const restored=store(storage(snapshot(s)));await restored.init();assert.equal(restored.ownedKey(restored.active()),'local-key');assert.equal(restored.ownedKey(restored.registry.services.find(c=>c.id==='two')),'session-key');assert.equal(restored.bindingState(),'CUSTOM_REBIND_REQUIRED');assert.equal(restored.keyFor(restored.active()),null);
  }
  if(done){finished=true;break;}
 }
 assert.ok(finished,'must exhaust migration persistence boundaries');
 assert.ok(boundaries>=10);
});

test('failed old-local-Key deletion after retention switch blocks ready and retries safely on restart',async()=>{
 const s=storage(),p=store(s);await p.save(config,'old-key');const old=p.active(),remove=s.local.remove;
 s.local.remove=async key=>{if(key.endsWith(old.keyRef))throw Error('storage unavailable');return remove(key);};
 await p.save({...config,id:old.id,rememberKey:false},'session-key');assert.equal(p.bindingState(),'CUSTOM_KEY_CLEANUP_REQUIRED');assert.equal(p.keyFor(p.active()),null);
 const restored=store(storage(snapshot(s)));await restored.init();assert.equal(restored.bindingState(),'ready');assert.equal(restored.keyFor(restored.active()),'session-key');
});

test('failed cancelled-candidate Key cleanup blocks current service until restart cleans the orphan',async()=>{
 const s=storage(),p=store(s);await p.save(config,'old-key');const stop=new AbortController(),set=s.local.set,remove=s.local.remove;
 s.local.set=async v=>{await set(v);if(Object.keys(v).some(k=>k.startsWith('aiProviderKeyV9:')))stop.abort();};s.local.remove=async()=>{throw Error('unavailable');};
 await assert.rejects(p.save({...config,id:p.active().id,model:'candidate'},'candidate-key',{signal:stop.signal}));assert.equal(p.bindingState(),'CUSTOM_KEY_CLEANUP_REQUIRED');assert.equal(p.keyFor(p.active()),null);
 s.local.remove=remove;const restored=store(storage(snapshot(s)));await restored.init();assert.equal(restored.keyFor(restored.active()),'old-key');assert.equal(JSON.stringify(restored.storage.local.data).includes('candidate-key'),false);
});
test('legacy crashed ID-only session Key cannot be relabelled as verified for an old endpoint',async()=>{
 const s=storage({local:{aiProvidersV8:{schema:1,activeId:'one',services:[{...config,id:'one',version:'old-version',rememberKey:false,checkedAt:1}]}},session:{aiProviderKeysV8:{one:'new-key-from-crashed-candidate'}}});let probes=0;const p=new ProviderStore({storage:s,probe:async()=>{probes++;}});await p.init();assert.equal(p.bindingState(),'CUSTOM_REBIND_REQUIRED');assert.equal(p.keyFor(p.active()),null);assert.equal(p.list().services[0].hasKey,true);assert.equal(probes,0);
});

test('cancel/revoke rollback at every persistence boundary also survives death without finally',async()=>{
 for(const reason of ['cancel','revoke'])for(const from of [true,false])for(const to of [true,false]){
  const initial=await seed(from);let boundaries=0,finished=false;
  for(let n=1;n<24;n++){
   let done=false;
   for(const side of ['before','after']){
    const r=await crashAt(initial,n,side,p=>{
     const stop=new AbortController(),set=p.storage[to?'local':'session'].set;
     if(reason==='cancel')p.storage[to?'local':'session'].set=async v=>{await set(v);if(Object.keys(v).some(k=>k.startsWith('aiProviderKeyV9:')))stop.abort();};
     else{let checks=0;p.verifyPermission=async()=>++checks<2;}
     return p.save({...config,id:p.active().id,model:'candidate',rememberKey:to},'candidate-key',{signal:stop.signal});
    });
    if(r.done){assert.ok(['CANCELLED','PERMISSION_REQUIRED'].includes(r.error?.code));done=true;break;}boundaries++;
    const restored=store(storage(r.seed));let probes=0;restored.probe=async()=>{probes++;};await restored.init();const c=restored.active();assert.equal(restored.bindingState(),'ready');assert.equal(restored.keyFor(c),c.model==='old-model'?'old-key':'candidate-key');assert.equal(c.binding.configVersion,c.version);assert.equal(probes,0);
   }
   if(done){finished=true;break;}
  }
  assert.ok(finished,'every persistence boundary must be exhausted');assert.ok(boundaries>=4);
 }
});
