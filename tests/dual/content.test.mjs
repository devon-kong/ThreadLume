import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const code=await readFile(new URL('../../dist-extension-native-dual/content.js',import.meta.url),'utf8');
const markup='<div data-testid="cellInnerDiv"><article data-testid="tweet"><a role="link" href="/a/status/123"><time>date</time></a></article><div data-testid="tweetTextarea_0"></div></div>';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function fixture(){
 const dom=new JSDOM(markup,{url:'https://x.com/a/status/123',runScripts:'outside-only',pretendToBeVisual:true});const w=dom.window;let role={role:'right',url:'https://x.com/a/status/123',mode:'split',hide:false};const listeners=[],scrolls=[];
 w.HTMLElement.prototype.getBoundingClientRect=()=>({bottom:600,top:100,height:500});w.scrollTo=p=>scrolls.push(p);
 w.chrome={runtime:{sendMessage:async()=>({ok:true,value:role}),onMessage:{addListener:fn=>listeners.push(fn)}}};w.eval(code);
 return {dom,w,scrolls,set:async value=>{role=value;listeners.forEach(fn=>fn({type:'refresh'}));await delay(35);}};
}
test('one positioning, photo route preserves user scroll; hiding remounts and cleanup',async()=>{
 const f=fixture();try{
 await delay(800);assert.equal(f.scrolls.length,1);
 f.w.history.pushState({},'', '/a/status/123/photo/1');await delay(550);f.w.history.pushState({},'','/a/status/123');await delay(800);assert.equal(f.scrolls.length,1);
 await f.set({role:'right',url:'https://x.com/a/status/123',mode:'split',hide:true});assert.equal(f.w.document.querySelectorAll('[data-peek-dual-hidden]').length,1);assert.equal(f.scrolls.length,2);
 f.w.document.querySelector('[data-testid="cellInnerDiv"]').outerHTML=markup;await delay(50);assert.equal(f.w.document.querySelectorAll('[data-peek-dual-hidden]').length,1);
 assert.equal(f.w.document.querySelector('[data-testid="tweetTextarea_0"]').closest('[data-peek-dual-hidden]'),null);
 await f.set(null);assert.equal(f.w.document.querySelectorAll('[data-peek-dual-hidden],#peek-dual-controls,#peek-dual-hide-style').length,0);
 }finally{f.dom.window.close();}
});
test('focal permalink without same-cell detail composer never positions or hides',async()=>{
 const f=fixture();try{f.w.document.querySelector('[data-testid="tweetTextarea_0"]').remove();await f.set({role:'right',url:'https://x.com/a/status/123',mode:'split',hide:true});await delay(800);assert.equal(f.scrolls.length,0);assert.equal(f.w.document.querySelectorAll('[data-peek-dual-hidden]').length,0);}finally{f.dom.window.close();}
});
test('hide already enabled uses visible composer top, not hidden article rect',async()=>{
 const f=fixture();try{
 f.w.HTMLElement.prototype.getBoundingClientRect=function(){return this.matches('article[data-peek-dual-hidden]')?{top:0,bottom:0,height:0}:{top:100,bottom:600,height:500};};
 await f.set({role:'right',url:'https://x.com/a/status/123',mode:'split',hide:true});await delay(800);assert.equal(f.scrolls.length,1);assert.equal(f.scrolls[0].top,48);
 }finally{f.dom.window.close();}
});
