import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {clickIntent} from '../../native-dual-extension/src/entry.js';
const dom=new JSDOM('<article data-testid="tweet"><a href="/alice"><span id="author">Alice</span></a><a href="/alice/status/123"><time id="time">now</time></a><div id="body">body</div><button id="like">like</button><a href="https://example.com" id="external">site</a><div data-testid="tweetPhoto" id="photo"></div><div role="link" id="quote"><span id="quoted">quoted body</span></div></article>',{url:'https://x.com/home'});
const doc=dom.window.document;
const event=id=>({target:doc.getElementById(id),button:0,isTrusted:true});
test('list body and permalink arm native navigation; never prevent it',()=>{
 assert.deepEqual(clickIntent(event('body'),doc.location.href),{url:'https://x.com/alice/status/123'});
 assert.deepEqual(clickIntent(event('time'),doc.location.href),{url:'https://x.com/alice/status/123'});
});
test('ignore actions, author/external links, media, modifiers, synthetic clicks and detail pages',()=>{
 for(const id of ['like','author','external','photo'])assert.equal(clickIntent(event(id),doc.location.href),null);
 assert.equal(clickIntent({...event('body'),metaKey:true},doc.location.href),null);
 assert.equal(clickIntent({...event('body'),isTrusted:false},doc.location.href),null);
 assert.equal(clickIntent(event('body'),'https://x.com/alice/status/123'),null);
});
test('quote without permalink follows actual native destination, never assumes outer tweet',()=>{
 assert.deepEqual(clickIntent(event('quoted'),doc.location.href),{url:null});
});
