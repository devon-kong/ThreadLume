import {fail} from './protocol.js';
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
export async function readChatStream(response,{signal,onEvent=()=>{},mode}={}){
 if(!response.headers?.get('content-type')?.toLowerCase().includes('text/event-stream')||!response.body?.getReader)fail('CUSTOM_STREAM_UNSUPPORTED');
 const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
 const decode=(value,options)=>{try{return decoder.decode(value,options);}catch{fail('CUSTOM_INVALID_RESPONSE');}};
 let line='',lines=[],skipLF=false,content='',finish=null,done=false,bytes=0,first=false,preview='';
 const abort=()=>{reader.cancel().catch(()=>{});};
 signal?.addEventListener('abort',abort,{once:true});
 const check=()=>{if(signal?.aborted)throw signal.reason||new DOMException('Cancelled','AbortError');};
 function frame(block){
  const data=block.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).replace(/^ /,'')).join('\n');
  if(!data)return;
  if(done)fail('CUSTOM_INVALID_RESPONSE');
  if(data==='[DONE]'){done=true;return;}
  let e;try{e=JSON.parse(data);}catch{fail('CUSTOM_INVALID_RESPONSE');}
  if(!e||e.error||!Array.isArray(e.choices))fail('CUSTOM_INVALID_RESPONSE');
  if(!e.choices.length)return; // standard usage-only terminal event
  if(e.choices.length!==1)fail('CUSTOM_INVALID_RESPONSE');
  const c=e.choices[0],d=c.delta;
  if(c.index!==0||!d||typeof d!=='object'||Array.isArray(d)||d.tool_calls||d.function_call||d.refusal||d.role&&d.role!=='assistant'||finish!==null)fail('CUSTOM_INVALID_RESPONSE');
  if(d.content!==undefined&&d.content!==null){
   if(typeof d.content!=='string')fail('CUSTOM_INVALID_RESPONSE');
   content+=d.content;if(content.length>60000)fail('CUSTOM_INVALID_RESPONSE');
   if(mode!=='mindmap'&&mode!=='probe'){
    const text=previewText(content);if(text&&text!==preview){preview=text;onEvent({stage:'partial',text});}
   }
  }
  if(c.finish_reason!==null&&c.finish_reason!==undefined){
   if(c.finish_reason==='length')fail('CUSTOM_TRUNCATED');
   if(c.finish_reason!=='stop')fail('CUSTOM_INVALID_RESPONSE');finish=c.finish_reason;
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
   bytes+=chunk.value.byteLength;if(bytes>2000000)fail('CUSTOM_INVALID_RESPONSE');
   if(!first){first=true;onEvent({stage:'firstByte'});}
   consume(decode(chunk.value,{stream:true}));
  }
  if(line)lines.push(line);
  if(lines.length)frame(lines.join('\n'));
  if(!done||finish!=='stop')fail('CUSTOM_INVALID_RESPONSE');
  return {choices:[{finish_reason:'stop',message:{role:'assistant',content}}]};
 }finally{
  signal?.removeEventListener('abort',abort);
  // A malformed/aborted stream must not keep consuming data in the background.
  reader.cancel().catch(()=>{});reader.releaseLock();
 }
}
