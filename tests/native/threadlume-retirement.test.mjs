import {test} from 'node:test';
import assert from 'node:assert/strict';
import {worker,input} from './helpers/retirement-worker-fixture.mjs';
import {AIService} from '../../native-extension/src/ai/service.js';
import {DEFAULTS,normalizePreferences} from '../../native-extension/src/ai/preferences.js';

test('fresh worker has no AI provider and never creates pages or connects another extension',async()=>{
 const w=await worker({connect:false});
 assert.equal((await w.status()).value.state,'AI_NOT_CONFIGURED');
 for(const action of ['connect','capture','check','openSetup','disconnect'])assert.equal((await w.message({action},w.settings)).error,'DOUBAO_UNAVAILABLE');
 await w.chrome.runtime.onStartup.fire();
 assert.equal(w.ports.length,0);assert.equal(w.requests.length,0);assert.equal(w.created.length,0);
});
test('old Doubao state is retained but never restored or used for generation/cache',async()=>{
 const seed={local:{aiProvidersV8:{schema:2,activeId:'doubao',services:[]},aiDoubaoBridgeConnectionV1:{enabled:true,partition:'old'},aiConnection:{enabled:true,partition:'web'},aiCache:{}},session:{aiDoubaoBridgeContextV1:{partition:'old',params:{session:'old'}},aiContext:{partition:'web',params:{aid:'497858'}},aiBlock:{partition:'web',code:'LOGIN_REQUIRED'}}};
 const w=await worker({connect:false,seed,hostVerified:true});
 assert.equal((await w.status()).value.state,'DOUBAO_UNAVAILABLE');
 assert.equal((await w.generate({outputLanguage:'en'})).error,'DOUBAO_UNAVAILABLE');
 assert.equal((await w.message({action:'cached',instance:'old-read',input,mode:'article',outputLanguage:'en'})).error,'DOUBAO_UNAVAILABLE');
 for(const [key,value] of Object.entries(seed.local))assert.deepEqual(w.storage.local.data[key],value);
 for(const [key,value] of Object.entries(seed.session))assert.deepEqual(w.storage.session.data[key],value);
 assert.equal(w.ports.length,0);assert.equal(w.created.length,0);assert.equal(w.requests.length,0);
 const restarted=await worker({connect:false,seed:{local:w.storage.local.data,session:w.storage.session.data}});
 assert.equal((await restarted.status()).value.state,'DOUBAO_UNAVAILABLE');assert.equal(restarted.ports.length,0);
});
test('production service with no legacy transport cannot execute the legacy request branch',async()=>{
 const w=await worker({connect:false});const s=new AIService({storage:w.storage});
 await assert.rejects(s.connect({aid:'497858'}),/DOUBAO_UNAVAILABLE/);
 await assert.rejects(s.generate('owner',input,'article'),/AI_NOT_CONFIGURED/);
});
test('language preferences default independently to English and validate persisted values',()=>{
 assert.equal(DEFAULTS.uiLanguage,'en');assert.equal(DEFAULTS.outputLanguage,'en');
 const p=normalizePreferences({uiLanguage:'zh-CN',outputLanguage:'en',summary:false,theme:'dark'});
 assert.equal(p.uiLanguage,'zh-CN');assert.equal(p.outputLanguage,'en');assert.equal(p.summary,false);assert.equal(p.theme,'dark');
 assert.equal(normalizePreferences({uiLanguage:'<script>',outputLanguage:'fr'}).outputLanguage,'en');
});
test('reader can persist only an output language, never general preferences',async()=>{
 const w=await worker({connect:false});
 assert.equal((await w.message({action:'savePreferences',preferences:{summary:false}})).rejected,true);
 assert.equal((await w.message({action:'setOutputLanguage',outputLanguage:'en',preferences:{summary:false}})).error,'INVALID_MESSAGE');
 assert.equal((await w.message({action:'setOutputLanguage',outputLanguage:'fr'})).error,'INVALID_LANGUAGE');
 const result=await w.message({action:'setOutputLanguage',outputLanguage:'zh-CN'});
 assert.equal(result.ok,true);assert.equal(w.storage.local.data.aiPreferences.outputLanguage,'zh-CN');
 assert.equal(w.storage.local.data.aiPreferences.summary,true);assert.equal(w.ports.length,0);
});
