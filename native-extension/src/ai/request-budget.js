// Trusted-background-only: never import the tokenizer into settings or X.
import {countTokens} from 'gpt-tokenizer/encoding/cl100k_base';
import {fail} from './protocol.js';
export const ESTIMATOR_VERSION='cl100k-4.1.0-literal-v1';
const literal={allowedSpecial:new Set(),disallowedSpecial:new Set()};
export const estimateTokens=text=>countTokens(text,literal);
export function budgetFor(contextTokens=32768){
 if(!Number.isSafeInteger(contextTokens)||contextTokens<4096||contextTokens>2000000)fail('CUSTOM_INVALID_CONTEXT');
 return {contextTokens,outputTokens:Math.min(8192,Math.floor(contextTokens/4)),margin:Math.max(512,Math.ceil(contextTokens*.2))};
}
export const requestTokens=body=>32+body.messages.reduce((sum,m)=>sum+32+estimateTokens(m.role)+estimateTokens(m.content),0);
export function fitsBudget(body,contextTokens){const b=budgetFor(contextTokens);return requestTokens(body)+body.max_tokens+b.margin<=b.contextTokens;}
export function assertBudget(body,contextTokens){if(!fitsBudget(body,contextTokens))fail('CUSTOM_CONTEXT_BUDGET');return body;}
