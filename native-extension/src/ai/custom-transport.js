// This module is imported by the extension worker only; never by X or settings.
import {AIError,fail} from './protocol.js';
import {normalizeEndpoint,buildChatRequest,parseChatResponse,probeChatResponse,customError} from './custom-provider.js';
export function createCustomTransport({hasPermission,fetchImpl=globalThis.fetch,timeoutMs=120000}){
 async function request(config,key,input,mode,signal){
  if(signal?.aborted)fail('CANCELLED');
  const {endpoint,permission}=normalizeEndpoint(config.baseURL);
  if(!await hasPermission(permission))fail('PERMISSION_REQUIRED');
  if(signal?.aborted)fail('CANCELLED');
  const body=buildChatRequest({id:config.id,name:config.name,protocol:config.protocol,baseURL:config.baseURL,model:config.model,rememberKey:config.rememberKey},input,mode),deadline=AbortSignal.timeout(timeoutMs),combined=signal?AbortSignal.any([signal,deadline]):deadline;
  try{
   const response=await fetchImpl(endpoint,{method:'POST',credentials:'omit',redirect:'error',headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},body:JSON.stringify(body),signal:combined});
   if(signal?.aborted)fail('CANCELLED');if(deadline.aborted)fail('CUSTOM_TIMEOUT');
   // Do not surface service text (may echo keys, headers, prompts or HTML).
   const text=await response.text();if(signal?.aborted)fail('CANCELLED');if(deadline.aborted)fail('CUSTOM_TIMEOUT');
   if(text.length>2000000)fail('CUSTOM_INVALID_RESPONSE');
   let envelope;try{envelope=JSON.parse(text);}catch{if(response.ok)fail('CUSTOM_INVALID_RESPONSE');}
   if(!response.ok)fail(customError(response.status,envelope??(text.length<=8192?text:undefined)));
   return mode==='probe'?probeChatResponse(envelope):parseChatResponse(envelope,mode,input);
  }catch(e){
   if(signal?.aborted)throw new AIError('CANCELLED');
   if(deadline.aborted||e?.name==='TimeoutError')throw new AIError('CUSTOM_TIMEOUT');
   if(e instanceof AIError)throw e;
   throw new AIError('CUSTOM_NETWORK');
  }
 }
 return {probe:(config,key,signal)=>request(config,key,null,'probe',signal),generate:(config,key,input,mode,signal)=>request(config,key,input,mode,signal)};
}
