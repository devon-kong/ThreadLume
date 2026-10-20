// This module is imported by the extension worker only; never by X or settings.
import {AIError,fail} from './protocol.js';
import {normalizeEndpoint,prepareChatBuilder,parseChatResponse,probeChatResponse,customError} from './custom-provider.js';
import {readChatStream} from './chat-stream.js';
import {protocolConfig} from './transport-policy.js';
export function createCustomTransport({hasPermission,fetchImpl=globalThis.fetch,timeoutMs=120000,onStage=()=>{}}){
 function bind(descriptor,buildBody,assertCurrent=()=>{}){
 async function request(key,input,mode,signal,onEvent=()=>{},outputLanguage){
  if(signal?.aborted)fail('CANCELLED');
  assertCurrent(mode);const {endpoint,permission}=descriptor;
  if(mode==='probe')onStage('transport_permission');if(!await hasPermission(permission,descriptor))fail('PERMISSION_REQUIRED');
  assertCurrent(mode);
  if(signal?.aborted)fail('CANCELLED');
  const body=buildBody(input,mode,outputLanguage),deadline=AbortSignal.timeout(timeoutMs),combined=signal?AbortSignal.any([signal,deadline]):deadline;
  let responsePhase='invalidEnvelope';
  try{
   assertCurrent(mode);if(mode==='probe')onStage('request');onEvent({stage:'request'});const response=await fetchImpl(endpoint,{method:'POST',credentials:'omit',redirect:'error',headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},body:JSON.stringify(body),signal:combined});
   if(signal?.aborted)fail('CANCELLED');if(deadline.aborted)fail('CUSTOM_TIMEOUT');
   // Do not surface service text (may echo keys, headers, prompts or HTML).
   if(mode==='probe')onStage('response');onEvent({stage:'response'});
   if(response.ok&&body.stream){
    responsePhase='invalidStream';const envelope=await readChatStream(response,{signal:combined,mode,input,onEvent,outputLanguage});
    if(signal?.aborted)fail('CANCELLED');if(deadline.aborted)fail('CUSTOM_TIMEOUT');assertCurrent(mode);
    responsePhase='invalidSchema';const result=mode==='probe'?probeChatResponse(envelope):parseChatResponse(envelope,mode,input,outputLanguage);onEvent({stage:'parsed'});return result;
   }
   const text=await response.text();if(signal?.aborted)fail('CANCELLED');if(deadline.aborted)fail('CUSTOM_TIMEOUT');
   if(text.length>2000000)fail('CUSTOM_INVALID_RESPONSE');
   let envelope;try{envelope=JSON.parse(text);}catch{if(response.ok)fail('CUSTOM_INVALID_RESPONSE');}
   if(!response.ok)fail(customError(response.status,envelope??(text.length<=8192?text:undefined)));
   responsePhase='invalidSchema';const result=mode==='probe'?probeChatResponse(envelope):parseChatResponse(envelope,mode,input,outputLanguage);onEvent({stage:'parsed'});return result;
  }catch(e){
   if(signal?.aborted)throw new AIError('CANCELLED');
   if(deadline.aborted||e?.name==='TimeoutError')throw new AIError('CUSTOM_TIMEOUT');
   if(e instanceof AIError){if(e.code==='CUSTOM_INVALID_RESPONSE')onEvent({stage:['invalidJSON','invalidEnvelope'].includes(e.validationPhase)?e.validationPhase:responsePhase});throw e;}
   throw new AIError('CUSTOM_NETWORK');
  }
 }
 return {probe:(key,signal)=>request(key,null,'probe',signal),generate:(key,input,mode,signal,onEvent,outputLanguage)=>request(key,input,mode,signal,onEvent,outputLanguage)};
 }
 // Compatibility entry points for direct protocol consumers. Production binds
 // once and calls the returned executor, never these raw-config wrappers.
 const standalone=config=>bind(normalizeEndpoint(config.baseURL),prepareChatBuilder(protocolConfig(config)));
 return {bind,probe:(config,key,signal)=>standalone(config).probe(key,signal),generate:(config,key,input,mode,signal,onEvent,outputLanguage)=>standalone(config).generate(key,input,mode,signal,onEvent,outputLanguage)};
}
