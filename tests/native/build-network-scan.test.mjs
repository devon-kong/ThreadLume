import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hasXHRAccess} from '../../scripts/network-identifiers.mjs';
test('worker scan distinguishes vocabulary from executable or computed XHR access',()=>{
 assert.equal(hasXHRAccess('const words=[" XMLHttpRequest", "A word"];'),false);
 for(const code of ['new XMLHttpRequest();','const xhr=globalThis.XMLHttpRequest;','window["XMLHttpRequest"]();'])assert.equal(hasXHRAccess(code),true);
 assert.throws(()=>hasXHRAccess('invalid {'));
});
