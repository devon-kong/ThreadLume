import vm from 'node:vm';
import {build} from 'esbuild';
export const code=(await build({entryPoints:['native-extension/src/ai/background.js'],bundle:true,write:false,format:'iife'})).outputFiles[0].text;
export const event=()=>{const handlers=[];return {handlers,addListener:f=>handlers.push(f),removeListener:f=>{const i=handlers.indexOf(f);if(i>=0)handlers.splice(i,1);},fire:async(...args)=>{for(const f of [...handlers])await f(...args);}};};
export const area=(seed={})=>{const data=structuredClone(seed);return {data,get:async key=>typeof key==='string'?{[key]:data[key]}:structuredClone(data),set:async v=>Object.assign(data,structuredClone(v)),remove:async key=>{delete data[key];},setAccessLevel:async()=>{}};};
export const input={kind:'article',focusId:'123',url:'https://x.com/a/status/123',title:'Title',text:'Body'};
export const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
export async function worker({connect=false,read,seed,hostSession='host-session',hostVerified=false}={}){
 const storage={local:area(seed?.local),session:area(seed?.session)},requests=[],created=[],removed=[],ports=[],pages=new Map(),documents=new Map([['doc',input.url]]);
 let count=90;
 const chrome={storage,action:{onClicked:event()},runtime:{id:'ours',onMessage:event(),onStartup:event(),openOptionsPage:async()=>{}},permissions:{contains:async()=>true,onRemoved:event(),onAdded:event()},scripting:{executeScript:async()=>{throw Error('No webpage injection');}},tabs:{onUpdated:event(),onRemoved:event(),onActivated:event(),query:async()=>[...pages.values()],get:async id=>pages.get(id)||null,update:async(id)=>pages.get(id),create:async o=>{created.push(o);const tab={id:count++,url:o.url,status:'complete'};pages.set(tab.id,tab);return tab;},remove:async id=>{removed.push(id);pages.delete(id);},sendMessage:async(id,m)=>m.action==='confirmFocus'?{url:documents.get('doc'),focusId:documents.get('doc')?.match(/status\/(\d+)/)?.[1],instance:m.instance}:null}};
 chrome.runtime.connect=()=>{
  const port={onMessage:event(),onDisconnect:event(),disconnect(){this.onDisconnect.fire();},postMessage(m){
   requests.push(m);
   const reply=value=>port.onMessage.fire({...value,session:hostSession,requestId:m.requestId});
   if(m.op==='cancel'){reply({type:'error',code:'CANCELLED'});return;}
   Promise.resolve().then(async()=>{
    const value=read?await read(m):null;
    if(value?.code)return reply({type:'error',...value});
    const result=value||{status:200,finished:true,text:m.op==='probe'?'OK':'Article summary',kind:m.kind||'video',mode:m.mode,highlights:[]};
    reply({type:'result',result});
   });
  }};
  ports.push(port);queueMicrotask(()=>port.onMessage.fire({type:'hello',version:3,session:hostSession,verified:hostVerified}));return port;
 };
 vm.runInNewContext(code,{chrome,fetch:()=>{throw Error('Doubao must not HTTP fetch');},crypto,URL,URLSearchParams,performance,structuredClone,TextDecoder,TextEncoder,btoa,AbortController,AbortSignal,DOMException,setTimeout,clearTimeout});
 const settings={id:'ours',url:'chrome-extension://ours/settings.html'},source={id:'ours',url:input.url,tab:{id:1},frameId:0,documentId:'doc'};
 let partition='';
 const message=(m,sender=source)=>new Promise(resolve=>{const accepted=chrome.runtime.onMessage.handlers[0]({ns:'peek-ai-v7',...(['generate','cached'].includes(m.action)?{connectionId:partition}:{}),...m},sender,r=>{if(r.value?.connectionId)partition=r.value.connectionId;resolve(r);});if(!accepted)resolve({rejected:true});});
 if(connect){const result=await message({action:'capture'},settings);if(!result.ok)throw Error(JSON.stringify(result));}
 return {chrome,storage,requests,created,removed,ports,pages,documents,message,settings,source,generate:(extra={})=>message({action:'generate',instance:crypto.randomUUID(),input,mode:'article',...extra}),status:()=>message({action:'status'},settings)};
}
