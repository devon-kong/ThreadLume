// Pure binding policy. Never accepts a caller-supplied rule or request headers.
import {fail} from './protocol.js';
import {normalizeEndpoint} from './custom-provider.js';
export const DNR_PERMISSION='declarativeNetRequestWithHostAccess';
export const ORIGIN_ENDPOINT='https://maas-api.ai-yuanjing.com/openapi/compatible-mode/v1/chat/completions';
export const protocolConfig=c=>({...(c.id!==undefined?{id:c.id}:{}),name:c.name,protocol:c.protocol,baseURL:c.baseURL,model:c.model,rememberKey:c.rememberKey,...(c.stream!==undefined?{stream:c.stream}:{})});
export function resolveTransportPolicy(normalized){return Object.freeze({id:normalized.endpoint===ORIGIN_ENDPOINT?'yuanjing-origin':'standard',version:1});}
export function providerPermissions(baseURL){const n=normalizeEndpoint(baseURL),p=resolveTransportPolicy(n);return {origins:[n.permission],...(p.id==='yuanjing-origin'?{permissions:[DNR_PERMISSION]}:{})};}
export function createBindingDescriptor(config,keyRef){
 const n=normalizeEndpoint(config.baseURL),p=resolveTransportPolicy(n);
 return Object.freeze({schema:1,providerId:config.id,configVersion:config.version,protocol:config.protocol,baseURL:n.baseURL,endpoint:n.endpoint,permission:n.permission,model:config.model,policyId:p.id,policyVersion:p.version,keyRef,keyLocation:config.rememberKey?'local':'session',...(config.stream?{stream:true}:{})});
}
export function validateBindingDescriptor(d,c){
 const expected=createBindingDescriptor(c,c.keyRef??d?.keyRef);
 if(!d||typeof d!=='object'||Object.keys(d).length!==Object.keys(expected).length||Object.keys(expected).some(k=>d[k]!==expected[k])||typeof d.keyRef!=='string'||!/^[\w-]{1,100}$/.test(d.keyRef))fail('CUSTOM_BINDING_INVALID');
 return Object.freeze({...d});
}
export function descriptorPermissions(d){return {origins:[d.permission],...(d.policyId==='yuanjing-origin'?{permissions:[DNR_PERMISSION]}:{})};}
