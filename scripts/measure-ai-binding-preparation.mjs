// Standalone no-network comparison against the exact handoff transport sources.
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir,cpus} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {createCustomTransport} from '../native-extension/src/ai/custom-transport.js';
import {prepareChatBuilder} from '../native-extension/src/ai/custom-provider.js';
import {createBindingDescriptor} from '../native-extension/src/ai/transport-policy.js';
const baseline='741180a79f41ab6775ed1953541c2d3f0b381726',dir=mkdtempSync(join(tmpdir(),'peek-binding-perf-'));
try{
 writeFileSync(join(dir,'package.json'),' {"type":"module"}');
 for(const name of ['custom-transport.js','custom-provider.js','protocol.js'])writeFileSync(join(dir,name),execFileSync('git',['show',`${baseline}:native-extension/src/ai/${name}`]));
 const {createCustomTransport:legacyFactory}=await import(pathToFileURL(join(dir,'custom-transport.js')).href);
 const config={id:'perf',name:'Performance fixture',protocol:'chat-completions',baseURL:'https://api.example.test/v1',model:'user-model',rememberKey:false};
 const input={kind:'article',focusId:'123',url:'https://x.com/a/status/123',title:'Fixture',text:'A fixed offline comparison input. '.repeat(30)};
 const options={hasPermission:async()=>true,fetchImpl:async()=>({ok:true,status:200,text:async()=>' {"choices":[{"finish_reason":"stop","message":{"role":"assistant","content":"{\\"text\\":\\"Summary\\"}"}}]}'})};
 const legacy=legacyFactory(options),bound=createCustomTransport(options).bind(createBindingDescriptor({...config,version:'v1'},'perf-ref'),prepareChatBuilder(config));
 const runA=()=>legacy.generate(config,'synthetic-performance-key',input,'article'),runB=()=>bound.generate('synthetic-performance-key',input,'article');
 for(let i=0;i<500;i++){await runA();await runB();}
 const a=[],b=[],rounds=20,perRound=100;
 const sample=async fn=>{const start=performance.now();for(let i=0;i<perRound;i++)await fn();return (performance.now()-start)/perRound;};
 for(let round=0;round<rounds;round++){if(round%2){b.push(await sample(runB));a.push(await sample(runA));}else{a.push(await sample(runA));b.push(await sample(runB));}}
 const stats=values=>{const v=values.toSorted((x,y)=>x-y);return {medianMs:v[Math.floor(v.length/2)],p95Ms:v[Math.min(v.length-1,Math.ceil(v.length*.95)-1)]};};
 console.log(JSON.stringify({scope:'offline transport preparation + fixed response parsing; no network/model/reader preview measurement',baseline,node:process.version,platform:process.platform,arch:process.arch,cpu:cpus()[0].model,rounds,perRound,warmupPerPath:500,legacy:stats(a),bound:stats(b),rawBatchMeanMsPerRequest:{legacy:a,bound:b}},null,2));
}finally{rmSync(dir,{recursive:true,force:true});}
