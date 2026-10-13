import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {findFocal,setHidden} from '../../native-dual-extension/src/focal.js';
test('match main permalink only; preserve composer, node identity and restore',()=>{
 const dom=new JSDOM('<div data-testid="cellInnerDiv"><article data-testid="tweet"><a role="link" href="/a/status/123"><time>now</time></a><div role="link"><a href="/b/status/456"><time>quote</time></a></div><video></video></article><div data-testid="tweetTextarea_0"></div></div>',{url:'https://x.com/a/status/123'});
 const d=dom.window.document,a=findFocal(d,d.location.href),parent=a.parentNode,video=a.querySelector('video');
 assert.equal(findFocal(d,'https://x.com/b/status/456'),null);setHidden(a,true);assert.ok(a.hasAttribute('data-peek-dual-hidden'));assert.equal(parent.hasAttribute('data-peek-dual-hidden'),false);assert.equal(d.querySelector('[data-testid="tweetTextarea_0"]').closest('[data-peek-dual-hidden]'),null);assert.equal(a.parentNode,parent);assert.equal(a.querySelector('video'),video);setHidden(a,false);assert.equal(a.hasAttribute('data-peek-dual-hidden'),false);dom.window.close();
});
