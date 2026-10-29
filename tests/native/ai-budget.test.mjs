import {test} from 'node:test';
import assert from 'node:assert/strict';
import {estimateTokens,requestTokens,budgetFor,assertBudget} from '../../native-extension/src/ai/request-budget.js';
test('offline estimator treats special-token spellings as literal source and handles scripts',()=>{
 for(const text of ['Hello world','中文 mixed 👩🏽‍💻','<|endoftext|>'])assert.ok(estimateTokens(text)>0);
 assert.equal(estimateTokens(''),0);
});
test('complete message framing, reserve and safety margin are counted once at exact boundary',()=>{
 assert.deepEqual(budgetFor(32768),{contextTokens:32768,outputTokens:8192,margin:6554});
 assert.deepEqual(budgetFor(4096),{contextTokens:4096,outputTokens:1024,margin:820});
 const body={messages:[{role:'system',content:'Rules'},{role:'user',content:'Source'}],max_tokens:256};
 assert.equal(requestTokens(body),96+estimateTokens('system')+estimateTokens('Rules')+estimateTokens('user')+estimateTokens('Source'));
 assert.doesNotThrow(()=>assertBudget(body,4096));
 assert.throws(()=>assertBudget({...body,max_tokens:4096},4096),e=>e.code==='CUSTOM_CONTEXT_BUDGET');
});
