import {attachCommentViewport} from '../../native-extension/src/ai/comment-viewport.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createCard} from '../../native-extension/src/ai/card.js';
import {DEFAULTS} from '../../native-extension/src/ai/preferences.js';

function fixture(){
 const dom=new JSDOM('<html data-peek-lad="on"><body><div data-testid="primaryColumn"><article data-peek-lad-focal><video></video></article><div data-testid="cellInnerDiv">Native reply</div></div></body></html>',{url:'https://x.com/a/status/123'});
 const w=dom.window,document=w.document,col=document.querySelector('[data-testid=primaryColumn]');
 let top=-250,height=360,frames=new Map(),sequence=0,resize;
 Object.defineProperty(w,'innerWidth',{value:1200,writable:true});Object.defineProperty(w,'innerHeight',{value:800,writable:true});
 col.getBoundingClientRect=()=>({left:0,top,width:1200,height:3000});
 w.requestAnimationFrame=f=>{frames.set(++sequence,f);return sequence};w.cancelAnimationFrame=id=>frames.delete(id);
 w.ResizeObserver=class{constructor(f){resize=f}observe(){}disconnect(){}};
 const card=createCard({document,input:{kind:'video',title:'Native video',video:document.querySelector('video')},preferences:DEFAULTS,onRetry(){},onSettings(){}});
 card.root.getBoundingClientRect=()=>({left:640,right:1184,top:68,bottom:68+height,width:544,height});
 document.body.append(card.root);
 const release=attachCommentViewport(document,card.root),destroy=card.destroy;card.destroy=()=>{release();destroy();};
 return {w,document,col,card,dom,frames,scroll(y){top=-y;w.dispatchEvent(new w.Event('scroll'));},collapse(){height=68;card.root.querySelector('.pk-ai-icon').click();resize?.();},flush(){const jobs=[...frames.values()];frames.clear();for(const f of jobs)f();},close(){card.destroy();dom.window.close()}};
}

test('native comments have a viewport below the fixed AI card, updated on document scroll without replacing nodes',async()=>{
 const r=fixture();try{
 const focal=r.document.querySelector('article'),reply=r.document.querySelector('[data-testid=cellInnerDiv]');
 await Promise.resolve();r.flush();
 assert.equal(r.col.hasAttribute('data-peek-ai-viewport'),true,'a fixed clipping boundary must exist, not just scrolling padding');
 assert.equal(r.col.style.getPropertyValue('--peek-comments-top'),'686px');
 assert.equal(r.col.style.getPropertyValue('--peek-comments-bottom'),'1034px');
 assert.equal(r.document.documentElement.style.getPropertyValue('--peek-comments-track-top'),'436px');
 r.scroll(600);r.scroll(650);assert.equal(r.frames.size,1,'scroll measurements coalesce per animation frame');r.flush();
 assert.equal(r.col.style.getPropertyValue('--peek-comments-top'),'1086px');
 assert.equal(r.col.style.getPropertyValue('--peek-comments-bottom'),'1434px');
 assert.equal(r.document.querySelector('article'),focal);assert.equal(r.document.querySelector('[data-testid=cellInnerDiv]'),reply);
 assert.equal(r.col.scrollTop,0,'window remains the X virtualizer scroll source');
 }finally{r.close()}
});

test('collapse and resize update comment boundary; teardown restores styles and cancels queued work',async()=>{
 const r=fixture();try{
 await Promise.resolve();r.flush();r.collapse();r.flush();
 assert.equal(r.document.documentElement.style.getPropertyValue('--peek-comments-track-top'),'144px');
 r.w.innerHeight=600;r.w.dispatchEvent(new r.w.Event('resize'));r.flush();assert.equal(r.col.style.getPropertyValue('--peek-comments-bottom'),'834px');
 r.scroll(700);r.card.destroy();r.flush();
 assert.equal(r.col.hasAttribute('data-peek-ai-viewport'),false);assert.equal(r.col.style.getPropertyValue('--peek-comments-top'),'');assert.equal(r.document.documentElement.style.getPropertyValue('--peek-comments-track-top'),'');
 r.scroll(800);assert.equal(r.frames.size,0,'closed card leaves no scroll work');
 }finally{r.close()}
});

test('comment corners follow the card radius and the shared gap, including after a size change',async()=>{
 const r=fixture();try{
 r.document.documentElement.style.setProperty('--peek-reader-radius','24px');r.document.documentElement.style.setProperty('--peek-reader-gap','12px');
 await Promise.resolve();r.flush();
 assert.match(r.col.style.getPropertyValue('--peek-comments-clip'),/A 24 24 /,'visible contents must clip with the same rounded corners');
 assert.equal(r.document.documentElement.style.getPropertyValue('--peek-comments-track-top'),'440px');
 r.document.documentElement.style.setProperty('--peek-reader-gap','8px');r.w.dispatchEvent(new r.w.Event('resize'));r.flush();
 assert.equal(r.document.documentElement.style.getPropertyValue('--peek-comments-track-top'),'436px');
 }finally{r.close()}
});
