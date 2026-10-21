import {test} from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';import {attachCommentScrollbar} from '../../native-extension/src/ai/comment-scrollbar.js';
test('internal scrollbar follows card geometry, scrolls only on user input and cleans up when native reader exits',async()=>{
 const w=new JSDOM('<html data-peek-lad="on" data-peek-lad-state="active"><body><div data-testid="primaryColumn"></div><section id="peek-ai-card"></section></body></html>',{pretendToBeVisual:true}).window,d=w.document;w.innerWidth=1200;w.innerHeight=800;Object.defineProperty(d.documentElement,'scrollHeight',{configurable:true,value:3000});let y=100,calls=0;Object.defineProperty(w,'scrollY',{get:()=>y});w.scrollTo=({top})=>{y=top;calls++;};const card=d.getElementById('peek-ai-card');card.getBoundingClientRect=()=>({left:632,right:1184,bottom:388,width:552,height:320});
 const cleanup=attachCommentScrollbar(d);await new Promise(r=>setTimeout(r,25));const bar=d.getElementById('peek-comment-scrollbar');assert.ok(bar);assert.equal(bar.style.top,'404px');assert.equal(calls,0);bar.dispatchEvent(new w.KeyboardEvent('keydown',{key:'PageDown',bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,25));assert.equal(calls,1);assert.ok(y>100);
 card.remove();await new Promise(r=>setTimeout(r,25));assert.equal(d.getElementById('peek-comment-scrollbar'),bar);assert.equal(bar.style.top,'76px');assert.equal(calls,1);
 d.documentElement.dataset.peekLadState='idle';await new Promise(r=>setTimeout(r,25));assert.equal(d.getElementById('peek-comment-scrollbar'),null);assert.equal(d.documentElement.hasAttribute('data-peek-internal-scrollbar'),false);cleanup();w.close();
});
test('comment viewport survives removal of AI card and scrollbar fades after scrolling',async()=>{
 const w=new JSDOM('<html data-peek-lad="on" data-peek-lad-state="active"><body><div data-testid="primaryColumn"></div><section id="peek-ai-card"></section></body></html>',{pretendToBeVisual:true}).window,d=w.document;w.innerWidth=1200;w.innerHeight=800;Object.defineProperty(d.documentElement,'scrollHeight',{value:3000});
 const col=d.querySelector('[data-testid=primaryColumn]');col.getBoundingClientRect=()=>({left:0,top:-100,width:1200,height:3000});const card=d.getElementById('peek-ai-card');card.getBoundingClientRect=()=>({left:632,right:1184,bottom:388,width:552,height:320});
 const cleanup=attachCommentScrollbar(d);await new Promise(r=>setTimeout(r,60));const bar=d.getElementById('peek-comment-scrollbar');assert.equal(col.hasAttribute('data-peek-ai-viewport'),true);assert.equal(bar.hasAttribute('data-visible'),false);
 w.dispatchEvent(new w.Event('scroll'));assert.equal(bar.hasAttribute('data-visible'),true);await new Promise(r=>setTimeout(r,1000));assert.equal(bar.hasAttribute('data-visible'),false);
 card.remove();await new Promise(r=>setTimeout(r,60));assert.equal(col.hasAttribute('data-peek-ai-viewport'),true);assert.equal(d.documentElement.style.getPropertyValue('--peek-comments-track-top'),'68px');
 cleanup();assert.equal(col.hasAttribute('data-peek-ai-viewport'),false);w.close();
});
test('leaving reader releases observed column before a SPA replacement',async()=>{
 const w=new JSDOM('<html data-peek-lad="on" data-peek-lad-state="active"><body><div data-testid="primaryColumn"></div></body></html>',{pretendToBeVisual:true}).window,d=w.document;w.innerWidth=1200;const observers=[];w.ResizeObserver=class{constructor(){this.nodes=new Set();observers.push(this)}observe(n){this.nodes.add(n)}unobserve(n){this.nodes.delete(n)}disconnect(){this.nodes.clear()}};const watched={has:n=>observers.some(o=>o.nodes.has(n))};
 const col=d.querySelector('[data-testid=primaryColumn]');col.getBoundingClientRect=()=>({left:0,top:0,width:1200,height:3000});const cleanup=attachCommentScrollbar(d);await new Promise(r=>setTimeout(r,60));assert.ok(watched.has(col));d.documentElement.dataset.peekLadState='idle';await new Promise(r=>setTimeout(r,60));assert.equal(watched.has(col),false);cleanup();w.close();
});

test('card resize positions the scrollbar in the same frame regardless of observer order',async()=>{
 const w=new JSDOM('<html data-peek-lad="on" data-peek-lad-state="active"><body><div data-testid="primaryColumn"></div><section id="peek-ai-card"></section></body></html>').window,d=w.document;
 w.innerWidth=1200;w.innerHeight=800;let bottom=388,sequence=0;const jobs=new Map(),observers=[];
 w.requestAnimationFrame=f=>{jobs.set(++sequence,f);return sequence};w.cancelAnimationFrame=id=>jobs.delete(id);
 w.ResizeObserver=class{constructor(f){observers.push(f)}observe(){}unobserve(){}disconnect(){}};
 d.getElementById('peek-ai-card').getBoundingClientRect=()=>({left:632,right:1184,bottom,width:552,height:bottom-68});
 const flush=()=>{const current=[...jobs.values()];jobs.clear();for(const f of current)f();};
 const cleanup=attachCommentScrollbar(d);flush();await Promise.resolve();flush();
 assert.equal(d.getElementById('peek-comment-scrollbar').style.top,'404px');
 bottom=136;for(const f of observers)f();flush();
 assert.equal(d.getElementById('peek-comment-scrollbar').style.top,'152px');assert.equal(jobs.size,0);
 cleanup();w.close();
});

test('native reader exit and lightbox release the tail presentation marker',async()=>{
 const w=new JSDOM('<html data-peek-lad="on" data-peek-lad-state="active"><body><div data-testid="primaryColumn"><div data-testid="cellInnerDiv"><article data-testid="tweet">Reply</article></div><div data-testid="cellInnerDiv" id="tail"><div class="r-4d76ec" style="height:200px"><div class="r-4d76ec" style="height:200px"></div></div></div></div></body></html>',{pretendToBeVisual:true}).window,d=w.document;
 w.innerWidth=1200;const cleanup=attachCommentScrollbar(d),tail=d.getElementById('tail');
 await new Promise(r=>setTimeout(r,40));assert.equal(tail.getAttribute('data-peek-comment-tail'),'empty');
 const lightbox=d.createElement('div');lightbox.dataset.testid='swipe-to-dismiss';d.body.append(lightbox);
 await new Promise(r=>setTimeout(r,40));assert.equal(tail.hasAttribute('data-peek-comment-tail'),false);
 lightbox.remove();await new Promise(r=>setTimeout(r,40));assert.equal(tail.getAttribute('data-peek-comment-tail'),'empty');
 d.documentElement.dataset.peekLadState='idle';await new Promise(r=>setTimeout(r,40));assert.equal(tail.hasAttribute('data-peek-comment-tail'),false);
 cleanup();w.close();
});
