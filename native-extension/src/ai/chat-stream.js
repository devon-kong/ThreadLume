import {AIError,fail} from './protocol.js';
export const STREAM_FAILURE_STAGES=new Set(['invalidStreamBytes','invalidStreamIncomplete','invalidStreamContent','invalidStreamJSON','invalidStreamEnvelope','invalidStreamSequence','invalidStreamFinish','invalidStreamEncoding']);
const invalidStream=phase=>{const error=new AIError('CUSTOM_INVALID_RESPONSE');error.validationPhase=phase;throw error;};
import {cueTimestamp} from './source-references.js';
import {validPreview} from './preview.js';
// Decode only a leading top-level text string. The preview remains provisional;
// the normal schema validator alone may accept a finished result.
export function previewText(content){
 const match=content.match(/^\s*\{\s*"text"\s*:\s*"/);if(!match)return '';
 let out='',i=match[0].length;
 while(i<content.length){
  const c=content[i++];
  if(c==='"')break;
  if(c==='\\'){
   const escaped=content[i++];if(!escaped)break;
   if(escaped==='u'){
    const hex=content.slice(i,i+4);if(hex.length<4)break;if(!/^[0-9a-f]{4}$/i.test(hex))return '';
    out+=String.fromCharCode(parseInt(hex,16));i+=4;
   }else{
    const escapes={'"':'"','\\':'\\','/':'/','b':'\b','f':'\f','n':'\n','r':'\r','t':'\t'};
    if(!Object.hasOwn(escapes,escaped))return '';out+=escapes[escaped];
   }
  }else{if(c.charCodeAt(0)<32)return '';out+=c;}
 }
 // Do not expose a split surrogate or unbounded draft.
 return out.replace(/[\uD800-\uDBFF]$/,'').slice(0,12000);
}
// Parse actual closed JSON objects only. An unfinished parent never gets
// synthetic closing delimiters: its closed descendants may appear as a forest.
export function structuredPreview(content,mode,input,outputLanguage='zh-CN'){
 const result={version:1,outputLanguage,text:previewText(content),highlights:[],tree:[]};
 if(typeof content!=='string'||content.length>60000)return result;
 const closed=[];let i=0;
 const skip=()=>{while(/\s/.test(content[i]||'x'))i++;};
 const incomplete=()=>{throw 0;};
 function string(){const start=i++;while(i<content.length){if(content[i]==='\\'){i+=2;continue;}if(content[i++]==='"')return JSON.parse(content.slice(start,i));}incomplete();}
 function value(path,depth){
  if(depth>24)throw 0;skip();const start=i,c=content[i];
  if(c==='"')return string();
  if(c==='{'||c==='['){
   i++;skip();const array=c==='[',end=array?']':'}',out=array?[]:{};let index=0;const seen=new Set();
   if(content[i]===end){i++;if(!array)closed.push({path,value:out});return out;}
   while(i<content.length){
    skip();let key=index++;
    if(!array){if(content[i]!=='"')throw 0;key=string();if(seen.has(key)||['__proto__','constructor','prototype'].includes(key))throw 0;seen.add(key);skip();if(content[i++]!==':')throw 0;}
    out[key]=value([...path,key],depth+1);skip();
    if(content[i]===end){i++;if(!array)closed.push({path,value:out});return out;}
    if(content[i++]!==',')throw 0;
   }incomplete();
  }
  const match=content.slice(i).match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=[\s,}\]])/);if(!match)throw 0;i+=match[0].length;return JSON.parse(match[0]);
 }
 try{value([],0);}catch{/* Incomplete prefix is never promoted to a final result. */}
 const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
 const label=value=>{if(typeof value!=='string'||!value.trim()||value.length>1000)throw 0;return value.trim();};
 const timestamp=cue=>cueTimestamp(input,cue);
 if(input)for(const entry of closed){
  const path=entry.path;
  try{
   if(mode==='mindmap'&&path[0]==='tree'&&path.length%2===0&&path.every((p,j)=>j%2?Number.isInteger(p):p===(j===0?'tree':'children'))){
    const id=path.filter((_,j)=>j%2).join('.');let count=0;
    const node=(n,key,depth)=>{if(depth>8||++count>200||!exact(n,['text','children'])||!Array.isArray(n.children))throw 0;return {id:key,text:label(n.text),children:n.children.map((c,j)=>node(c,key+'.'+j,depth+1))};};
    const parsed=node(entry.value,id,id.split('.').length);
    result.tree=result.tree.filter(n=>!n.id.startsWith(id+'.'));result.tree.push(parsed);
   }else if(mode==='summary'&&path[0]==='highlights'&&path.length===2){
    const h=entry.value;if(!exact(h,['cue','chapter','bullet_points'])||!Array.isArray(h.bullet_points)||h.bullet_points.length>20)throw 0;
    result.highlights.push({timestamp:timestamp(h.cue),chapter:label(h.chapter),bullet_points:h.bullet_points.map(p=>{if(!exact(p,['cue','point']))throw 0;return {timestamp:timestamp(p.cue),point:label(p.point)};})});
   }
  }catch{/* Closed but schema-invalid objects stay invisible. */}
 }
 if(!validPreview(result,outputLanguage))return {version:1,outputLanguage,text:result.text,highlights:[],tree:[]};
 return result;
}
export async function readChatStream(response,{signal,onEvent=()=>{},mode,input,outputLanguage='zh-CN'}={}){
 if(!response.headers?.get('content-type')?.toLowerCase().includes('text/event-stream')||!response.body?.getReader)fail('CUSTOM_STREAM_UNSUPPORTED');
 const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
 const decode=(value,options)=>{try{return decoder.decode(value,options);}catch{invalidStream('invalidStreamEncoding');}};
 let line='',lines=[],skipLF=false,content='',finish=null,done=false,bytes=0,first=false,preview='';
 const abort=()=>{reader.cancel().catch(()=>{});};
 signal?.addEventListener('abort',abort,{once:true});
 const check=()=>{if(signal?.aborted)throw signal.reason||new DOMException('Cancelled','AbortError');};
 function frame(block){
  const data=block.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).replace(/^ /,'')).join('\n');
  if(!data)return;
  if(done)invalidStream('invalidStreamSequence');
  if(data==='[DONE]'){done=true;return;}
  let e;try{e=JSON.parse(data);}catch{invalidStream('invalidStreamJSON');}
  if(!e||e.error||!Array.isArray(e.choices))invalidStream('invalidStreamEnvelope');
  if(!e.choices.length)return; // standard usage-only terminal event
  if(e.choices.length!==1)invalidStream('invalidStreamEnvelope');
  const c=e.choices[0],d=c.delta;
  if(c.index!==0||!d||typeof d!=='object'||Array.isArray(d)||d.tool_calls||d.function_call||d.refusal||d.role&&d.role!=='assistant'||finish!==null)invalidStream('invalidStreamSequence');
  if(d.content!==undefined&&d.content!==null){
   if(typeof d.content!=='string')invalidStream('invalidStreamContent');
   content+=d.content;if(content.length>60000)invalidStream('invalidStreamContent');
   if(mode!=='probe'){
    const data=structuredPreview(content,mode,input,outputLanguage),signature=JSON.stringify(data);if(signature!==preview&&(data.text||data.tree.length||data.highlights.length)){preview=signature;onEvent({stage:'partial',text:data.text,preview:data});}
   }
  }
  if(c.finish_reason!==null&&c.finish_reason!==undefined){
   if(c.finish_reason==='length')fail('CUSTOM_TRUNCATED');
   if(c.finish_reason!=='stop')invalidStream('invalidStreamFinish');finish=c.finish_reason;
  }
 }
 function consume(text){
  // SSE permits CR, LF and CRLF. Consume a CR immediately so a completed
  // event need not wait for another chunk; swallow only its optional LF.
  for(const c of text){
   if(skipLF){skipLF=false;if(c==='\n')continue;}
   if(c==='\r'||c==='\n'){
    if(line){lines.push(line);line='';}
    else{frame(lines.join('\n'));lines=[];}
    skipLF=c==='\r';
   }else line+=c;
  }
 }
 try{
  check();
  while(!done){
   const chunk=await reader.read();check();
   if(chunk.done){consume(decode());break;}
   // Wire framing/reasoning metadata is not the final text. Keep both bounded.
   bytes+=chunk.value.byteLength;if(bytes>8*1024*1024)invalidStream('invalidStreamBytes');
   if(!first){first=true;onEvent({stage:'firstByte'});}
   consume(decode(chunk.value,{stream:true}));
  }
  if(line)lines.push(line);
  if(lines.length)frame(lines.join('\n'));
  if(!done||finish!=='stop')invalidStream('invalidStreamIncomplete');
  return {choices:[{finish_reason:'stop',message:{role:'assistant',content}}]};
 }finally{
  signal?.removeEventListener('abort',abort);
  // A malformed/aborted stream must not keep consuming data in the background.
  reader.cancel().catch(()=>{});reader.releaseLock();
 }
}
