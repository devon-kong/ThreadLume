import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {attachCommentTail} from '../../native-extension/src/ai/comment-tail.js';

const marker='data-peek-comment-tail';
function fixture(){
 const w=new JSDOM('<body><style>.empty{height:200px}</style><div data-testid="primaryColumn"><div data-testid="cellInnerDiv"><article data-peek-lad-focal></article></div><div data-testid="cellInnerDiv"><article data-testid="tweet">Reply</article></div><div data-testid="cellInnerDiv" id="tail"><div class="empty r-4d76ec"><div class="empty r-4d76ec"></div></div></div></div></body>').window;
 const col=w.document.querySelector('[data-testid="primaryColumn"]'),tail=w.document.getElementById('tail');
 return {w,col,tail,close(){w.close()}};
}
const tick=()=>new Promise(r=>setTimeout(r,0));

test('only the empty 200px terminal spacer is collapsed, retaining native nodes and styles',()=>{
 const r=fixture();try{
 const leaf=r.tail.firstElementChild.firstElementChild,reply=r.col.querySelector('[data-testid="tweet"]'),html=r.tail.innerHTML;
 const release=attachCommentTail(r.col);
 assert.equal(r.tail.getAttribute(marker),'empty');
 assert.equal(r.tail.innerHTML,html);assert.equal(r.tail.firstElementChild.firstElementChild,leaf);assert.equal(r.col.querySelector('[data-testid="tweet"]'),reply);
 assert.equal(r.tail.getAttribute('style'),null);release();assert.equal(r.tail.hasAttribute(marker),false);
 }finally{r.close()}
});

for(const kind of ['text','loading','cell-loading','button','different-height','no-reply','not-terminal','foreign-marker'])test(`does not collapse ${kind}`,()=>{
 const r=fixture();try{
 const leaf=r.tail.firstElementChild.firstElementChild;
 if(kind==='text')leaf.textContent='More replies';
 if(kind==='loading')leaf.setAttribute('role','progressbar');
 if(kind==='cell-loading')r.tail.setAttribute('role','progressbar');
 if(kind==='button')leaf.append(r.w.document.createElement('button'));
 if(kind==='different-height')leaf.style.height='180px';
 if(kind==='no-reply')r.col.querySelector('[data-testid="tweet"]').remove();
 if(kind==='not-terminal')r.col.append(r.w.document.createElement('div'));
 if(kind==='foreign-marker')r.tail.setAttribute(marker,'foreign');
 const release=attachCommentTail(r.col);
 assert.equal(r.tail.getAttribute(marker),kind==='foreign-marker'?'foreign':null);release();
 }finally{r.close()}
});

test('new content, semantic attributes and appended replies release the collapsed tail',async()=>{
 const r=fixture();try{
 const release=attachCommentTail(r.col),leaf=r.tail.firstElementChild.firstElementChild;
 leaf.textContent='New reply';await tick();assert.equal(r.tail.hasAttribute(marker),false);
 leaf.textContent='';await tick();assert.equal(r.tail.getAttribute(marker),'empty');
 leaf.setAttribute('aria-label','Loading');await tick();assert.equal(r.tail.hasAttribute(marker),false);
 leaf.removeAttribute('aria-label');await tick();assert.equal(r.tail.getAttribute(marker),'empty');
 r.tail.setAttribute('aria-label','Loading');await tick();assert.equal(r.tail.hasAttribute(marker),false);
 r.tail.removeAttribute('aria-label');await tick();assert.equal(r.tail.getAttribute(marker),'empty');
 r.col.append(r.w.document.createElement('div'));await tick();assert.equal(r.tail.hasAttribute(marker),false);
 release();
 }finally{r.close()}
});

test('cleanup cancels pending work and preserves a foreign marker change',async()=>{
 const r=fixture();try{
 const release=attachCommentTail(r.col);r.tail.setAttribute(marker,'foreign');release();await tick();assert.equal(r.tail.getAttribute(marker),'foreign');
 }finally{r.close()}
});

function listGeometry(r){
 r.col.style.cssText='position:relative;min-height:1200px';
 for(const cell of r.col.children)cell.style.position='absolute';
 r.col.getBoundingClientRect=()=>({top:0,bottom:1200});
 r.tail.style.transform='translateY(500px)';
 r.tail.getBoundingClientRect=()=>({top:500,bottom:516,height:16});
}

test('the exact empty tail bounds stale list extent without overwriting X inline height',async()=>{
 const r=fixture();try{
 listGeometry(r);const release=attachCommentTail(r.col);await tick();
 assert.equal(r.col.getAttribute('data-peek-comment-list'),'trimmed');assert.equal(r.col.style.getPropertyValue('--peek-comment-list-height'),'516px');assert.equal(r.col.style.minHeight,'1200px');
 r.tail.firstElementChild.firstElementChild.textContent='Arriving reply';await tick();
 assert.equal(r.col.hasAttribute('data-peek-comment-list'),false);assert.equal(r.col.style.getPropertyValue('--peek-comment-list-height'),'');assert.equal(r.col.style.minHeight,'1200px');
 release();
 }finally{r.close()}
});

test('native size growth releases the list bound until content or terminal offset changes',async()=>{
 const r=fixture();try{
 listGeometry(r);const release=attachCommentTail(r.col);await tick();
 r.col.style.minHeight='1500px';await tick();assert.equal(r.col.hasAttribute('data-peek-comment-list'),false);assert.equal(r.col.style.minHeight,'1500px');
 await tick();assert.equal(r.col.hasAttribute('data-peek-comment-list'),false,'no automatic clamp over unseen native content');
 r.col.querySelector('[data-testid="tweet"]').firstChild.data='Reply updated';await tick();
 assert.equal(r.col.hasAttribute('data-peek-comment-list'),false,'ordinary text updates cannot clear the native growth guard');
 r.tail.style.transform='translateY(600px)';r.tail.getBoundingClientRect=()=>({top:600,bottom:616,height:16});await tick();
 assert.equal(r.col.getAttribute('data-peek-comment-list'),'trimmed');assert.equal(r.col.style.getPropertyValue('--peek-comment-list-height'),'616px');
 release();assert.equal(r.col.style.minHeight,'1500px');assert.equal(r.col.hasAttribute('data-peek-comment-list'),false);
 }finally{r.close()}
});

test('a rendered cell extending below the tail prevents any list bound',()=>{
 const r=fixture();try{
 listGeometry(r);r.col.firstElementChild.getBoundingClientRect=()=>({bottom:900});
 const release=attachCommentTail(r.col);assert.equal(r.col.hasAttribute('data-peek-comment-list'),false);release();
 }finally{r.close()}
});

test('a native end witness needs two stable frames and rejects a late native growth',async()=>{
 const r=fixture();try{
 listGeometry(r);const frames=new Map();let sequence=0;
 r.w.requestAnimationFrame=f=>{frames.set(++sequence,f);return sequence};r.w.cancelAnimationFrame=id=>frames.delete(id);
 const flush=()=>{const jobs=[...frames.values()];frames.clear();for(const f of jobs)f();};
 Object.defineProperty(r.col.ownerDocument.documentElement,'scrollHeight',{value:1500,writable:true});r.w.innerHeight=800;r.w.scrollY=700;
 const release=attachCommentTail(r.col);await tick();r.col.style.minHeight='1500px';await tick();
 r.w.dispatchEvent(new r.w.Event('scrollend'));flush();assert.equal(r.col.hasAttribute('data-peek-comment-list'),false);
 r.col.style.minHeight='1800px';r.col.ownerDocument.documentElement.scrollHeight=1800;r.w.scrollY=1000;await tick();flush();await tick();
 assert.equal(r.col.hasAttribute('data-peek-comment-list'),false,'late native growth invalidates the first witness');
 r.w.dispatchEvent(new r.w.Event('scrollend'));flush();assert.equal(r.col.hasAttribute('data-peek-comment-list'),false);flush();await tick();
 assert.equal(r.col.getAttribute('data-peek-comment-list'),'trimmed');release();assert.equal(frames.size,0);
 }finally{r.close()}
});

test('a size change without DOM mutation invalidates the native end witness',async()=>{
 const r=fixture();try{
 listGeometry(r);const jobs=new Map();let sequence=0,bottom=400;
 r.w.requestAnimationFrame=f=>{jobs.set(++sequence,f);return sequence};r.w.cancelAnimationFrame=id=>jobs.delete(id);
 const flush=()=>{const current=[...jobs.values()];jobs.clear();for(const f of current)f();};
 r.col.firstElementChild.getBoundingClientRect=()=>({top:0,bottom,width:500,height:bottom});
 Object.defineProperty(r.col.ownerDocument.documentElement,'scrollHeight',{value:1500});r.w.innerHeight=800;r.w.scrollY=700;
 const release=attachCommentTail(r.col);await tick();r.col.style.minHeight='1500px';await tick();
 r.w.dispatchEvent(new r.w.Event('scrollend'));flush();bottom=450;flush();await tick();
 assert.equal(r.col.hasAttribute('data-peek-comment-list'),false);release();
 }finally{r.close()}
});
