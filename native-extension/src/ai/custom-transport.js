import {createLongContentRunner} from './long-content.js';
import {assertBudget,requestTokens,estimateTokens} from './request-budget.js';
import {reportedUsage} from './usage.js';
import {diagnosticCall} from './setup-diagnostics.js';
// This module is imported by the extension worker only; never by X or settings.
import {AIError,fail} from './protocol.js';
import {normalizeEndpoint,prepareChatBuilder,parseChatResponse,probeChatResponse,customError} from './custom-provider.js';
import {readChatStream,STREAM_FAILURE_STAGES} from './chat-stream.js';
import {protocolConfig} from './transport-policy.js';
export function createCustomTransport({hasPermission,fetchImpl=globalThis.fetch,timeoutMs=300000,onStage=()=>{}}){
 function bind(descriptor,buildBody,assertCurrent=()=>{},trace){
 const contextTokens=descriptor.contextTokens??32768,runner=createLongContentRunner(buildBody,contextTokens);
 async function request(key,input,mode,signal,onEvent=()=>{},outputLanguage,prepared){
  if(signal?.aborted)fail('CANCELLED');
  assertCurrent(mode);const {endpoint,permission}=descriptor;
  if(mode==='probe')onStage('transport_permission');if(!await diagnosticCall(mode==='probe'?trace:null,'transport_permission',()=>hasPermission(permission,descriptor)))fail('PERMISSION_REQUIRED');
  assertCurrent(mode);
  if(signal?.aborted)fail('CANCELLED');
  const body=assertBudget(prepared?.body||buildBody(input,mode,outputLanguage),contextTokens),deadline=AbortSignal.timeout(timeoutMs),combined=signal?AbortSignal.any([signal,deadline]):deadline;
  let payload = body;
  if (endpoint === 'https://api.openai.com/v1/chat/completions') {
   // Keep the planner's budget, using OpenAI's current wire parameter.
   const {max_tokens, ...requestBody} = body;
   payload = {...requestBody, max_completion_tokens: max_tokens};
   if (mode !== 'probe') payload.response_format = {type: 'json_object'};
  }
  let responsePhase='invalidEnvelope',measurement={},outcome='error',measurementPublished=false;
  const started=performance.now(),requestStats={index:prepared?.index||1,phase:prepared?.phase||(mode==='probe'?'probe':'single'),status:'running',elapsedMs:0,inputTokens:requestTokens(body),inputSource:'estimated',outputTokens:null,outputSource:'unknown',reasoningTokens:null,cachedInputTokens:null,outputComplete:false};
  function publishMeasurement(status){
   if(measurementPublished)return;measurementPublished=true;
   const usage=measurement.usage||{};
   if(usage.inputTokens!==undefined){requestStats.inputTokens=usage.inputTokens;requestStats.inputSource='reported';}
   if(usage.outputTokens!==undefined){requestStats.outputTokens=usage.outputTokens;requestStats.outputSource='reported';}
   else if(measurement.content){requestStats.outputTokens=estimateTokens(measurement.content);requestStats.outputSource='estimated';}
   requestStats.reasoningTokens=usage.reasoningTokens??null;requestStats.cachedInputTokens=usage.cachedInputTokens??null;
   requestStats.status=status;requestStats.elapsedMs=Math.max(0,Math.round(performance.now()-started));requestStats.outputComplete=measurement.complete===true;
   onEvent({stage:'usage',request:requestStats});
  }
  try{
   assertCurrent(mode);onEvent({stage:'usage',request:{...requestStats}});if(mode==='probe')onStage('request');onEvent({stage:'request'});const response=await diagnosticCall(mode==='probe'?trace:null,'request',()=>fetchImpl(endpoint,{method:'POST',credentials:'omit',redirect:'error',headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},body:JSON.stringify(payload),signal:combined}));
   if(signal?.aborted)fail('CANCELLED');if(deadline.aborted)fail('CUSTOM_TIMEOUT');
   // Do not surface service text (may echo keys, headers, prompts or HTML).
   if(mode==='probe')onStage('response');onEvent({stage:'response'});
   if(response.ok&&body.stream){
    responsePhase='invalidStream';const envelope=await readChatStream(response,{signal:combined,mode,input,onEvent,outputLanguage,onMeasurement:value=>{measurement=value;if(combined.aborted)publishMeasurement(signal?.aborted?'cancelled':'error');}});
    if(signal?.aborted)fail('CANCELLED');if(deadline.aborted)fail('CUSTOM_TIMEOUT');assertCurrent(mode);
    responsePhase='invalidSchema';const result=prepared?prepared.parse(envelope):mode==='probe'?probeChatResponse(envelope):parseChatResponse(envelope,mode,input,outputLanguage);outcome='success';onEvent({stage:'parsed'});return result;
   }
   const text=await diagnosticCall(mode==='probe'?trace:null,'response_body',()=>response.text());if(signal?.aborted)fail('CANCELLED');if(deadline.aborted)fail('CUSTOM_TIMEOUT');
   if(text.length>2000000)fail('CUSTOM_INVALID_RESPONSE');
   let envelope;try{envelope=JSON.parse(text);}catch{if(response.ok)fail('CUSTOM_INVALID_RESPONSE');}
   const content=envelope?.choices?.[0]?.message?.content;
   measurement={content:typeof content==='string'?content.slice(0,60000):'',usage:reportedUsage(envelope?.usage),complete:response.ok&&envelope?.choices?.[0]?.finish_reason==='stop'&&typeof content==='string'&&content.length<=60000};
   if(!response.ok)fail(customError(response.status,envelope??(text.length<=8192?text:undefined)));
   responsePhase='invalidSchema';const result=prepared?prepared.parse(envelope):mode==='probe'?probeChatResponse(envelope):parseChatResponse(envelope,mode,input,outputLanguage);outcome='success';onEvent({stage:'parsed'});return result;
  }catch(e){
   if(signal?.aborted)outcome='cancelled';
   if(signal?.aborted)throw new AIError('CANCELLED');
   if(deadline.aborted||e?.name==='TimeoutError')throw new AIError('CUSTOM_TIMEOUT');
   if(e instanceof AIError){if(e.code==='CUSTOM_INVALID_RESPONSE'){if(STREAM_FAILURE_STAGES.has(e.validationPhase))onEvent({stage:'invalidStream'});onEvent({stage:(['invalidJSON','invalidEnvelope'].includes(e.validationPhase)||STREAM_FAILURE_STAGES.has(e.validationPhase))?e.validationPhase:responsePhase});}throw e;}
   throw new AIError('CUSTOM_NETWORK');
  }finally{
   publishMeasurement(outcome);
  }
 }
 return {clear:()=>runner.clear(),probe:(key,signal,onEvent)=>request(key,null,'probe',signal,onEvent),generate:(key,input,mode,signal,onEvent=()=>{},outputLanguage='zh-CN')=>{
  assertCurrent(mode);
  let index=0;
  return runner.generate(input,mode,outputLanguage,signal,event=>{assertCurrent(mode);onEvent(event);},(body,options)=>request(key,options.input,mode,options.signal,event=>{if(options.phase==='single'||event.stage!=='partial')onEvent(event);},outputLanguage,{body,parse:options.parse,phase:options.phase,index:++index}));
 }};
 }
 // Compatibility entry points for direct protocol consumers. Production binds
 // once and calls the returned executor, never these raw-config wrappers.
 const standalone=config=>bind({...normalizeEndpoint(config.baseURL),contextTokens:config.contextTokens??32768},prepareChatBuilder(protocolConfig(config)));
 return {bind,probe:(config,key,signal)=>standalone(config).probe(key,signal),generate:(config,key,input,mode,signal,onEvent,outputLanguage)=>standalone(config).generate(key,input,mode,signal,onEvent,outputLanguage)};
}
