import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as policy from '../../native-extension/src/ai/transport-policy.js';
import * as protocol from '../../native-extension/src/ai/custom-provider.js';
const cfg={id:'one',version:'v1',name:'Name',model:'chosen',baseURL:'https://api.example.test/v1',protocol:'chat-completions',rememberKey:true};
const endpoint='https://maas-api.ai-yuanjing.com/openapi/compatible-mode/v1/chat/completions';
test('binding selects only exact verified endpoint, independent of model or service name',()=>{
 assert.equal(policy.resolveTransportPolicy(protocol.normalizeEndpoint(endpoint)).id,'yuanjing-origin');
 for(const url of ['https://other.ai-yuanjing.com/openapi/compatible-mode/v1',endpoint.replace('.com/','.com:9443/'),endpoint.replace('/v1/','/v2/'),'https://api.example.test'])assert.equal(policy.resolveTransportPolicy(protocol.normalizeEndpoint(url)).id,'standard');
 const d=policy.createBindingDescriptor(cfg,'ref1');assert.equal(d.policyId,'standard');assert.equal(d.configVersion,'v1');assert.equal(d.keyRef,'ref1');
 assert.deepEqual(policy.validateBindingDescriptor(d,cfg),d);
 for(const patch of [{policyVersion:999},{policyId:'unknown'},{model:'wrong'},{endpoint:'https://evil.test/chat/completions'},{configVersion:'v2'},{keyLocation:'session'}])assert.throws(()=>policy.validateBindingDescriptor({...d,...patch},cfg),/CUSTOM_BINDING_INVALID/);
});
test('prepared builder validates config once, retains request contract and input limits',()=>{
 assert.equal(typeof protocol.prepareChatBuilder,'function');const {version,...raw}=cfg;const build=protocol.prepareChatBuilder(raw),input={kind:'article',focusId:'123',url:'https://x.com/a/status/123',title:'Title',text:'Full body'};
 for(const mode of ['probe','article'])assert.deepEqual(build(mode==='probe'?null:input,mode),protocol.buildChatRequest(raw,mode==='probe'?null:input,mode));
});
