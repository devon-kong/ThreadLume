// X keeps its document scrolling and native list ownership. The comment surface
// and its hit-test frame use viewport coordinates, so compositor scrolling never
// needs a JS correction to keep the four rounded corners in place.
export function attachCommentViewport(document,card){
 const win=document.defaultView,col=document.querySelector('[data-testid="primaryColumn"]');
 if(!win||!col)return ()=>{};
 const root=document.documentElement,marker='data-peek-ai-viewport';
 const priorMarker=col.getAttribute(marker),saved=new Map(),owned=new Map();
 const boundary=document.createElement('div');boundary.id='peek-comment-boundary';boundary.setAttribute('aria-hidden','true');document.body.append(boundary);
 let closed=false,frame=0,observedCard=null;
 const request=win.requestAnimationFrame?.bind(win)||(f=>win.setTimeout(f,16));
 const cancel=win.cancelAnimationFrame?.bind(win)||win.clearTimeout.bind(win);
 const write=(key,value)=>{
  if(!saved.has(key))saved.set(key,{value:root.style.getPropertyValue(key),priority:root.style.getPropertyPriority(key)});
  if(root.style.getPropertyValue(key)!==value)root.style.setProperty(key,value);
  owned.set(key,value);
 };
 const n=v=>Math.round(v*1000)/1000,px=v=>`${n(v)}px`;
 const update=()=>{
  cancel(frame);frame=0;
  if(closed||!col.isConnected||win.innerWidth<980)return;
  const current=typeof card==='function'?card():card;
  if(current!==observedCard){if(observedCard)resize?.unobserve?.(observedCard);observedCard=current;if(current)resize?.observe(current);}
  const style=win.getComputedStyle(root),inset=parseFloat(style.getPropertyValue('--peek-reader-inset'))||16;
  const gap=parseFloat(style.getPropertyValue('--peek-reader-gap'))||8,barTop=parseFloat(style.getPropertyValue('--peek-reader-top'))||52;
  const hasCard=current?.isConnected&&!current.hidden;
  const box=hasCard?current.getBoundingClientRect():{left:win.innerWidth*.52+gap,right:win.innerWidth-inset,bottom:barTop+inset,width:win.innerWidth*.48-inset-gap,height:1};
  // A native lightbox hides the card with CSS. Keep the previous geometry;
  // CSS releases both surface and frame synchronously while the lightbox owns it.
  if(box.width<=0||box.height<=0)return;
  const top=Math.min(box.bottom+(hasCard?gap:0),win.innerHeight-inset),bottom=win.innerHeight-inset;
  const left=box.left,right=box.right;
  // Cover the whole gutter up to the focal card's right edge. Starting halfway
  // through it exposes the focal shadow as a hard vertical seam behind both cards.
  const frameLeft=left-gap*2;
  const radius=Math.max(0,Math.min(parseFloat(style.getPropertyValue('--peek-reader-radius'))||16,(right-left)/2,(bottom-top)/2));
  const r=n(radius);
  // A fixed outer frame with a rounded hole. Unlike a clip on primaryColumn,
  // this never changes with scrollY. The hole also lets native pointer events
  // through; the painted perimeter blocks clicks on concealed native content.
  const path=`path(evenodd, "M ${n(frameLeft)} ${n(barTop)} H ${win.innerWidth} V ${win.innerHeight} H ${n(frameLeft)} Z M ${n(left+radius)} ${n(top)} H ${n(right-radius)} A ${r} ${r} 0 0 1 ${n(right)} ${n(top+radius)} V ${n(bottom-radius)} A ${r} ${r} 0 0 1 ${n(right-radius)} ${n(bottom)} H ${n(left+radius)} A ${r} ${r} 0 0 1 ${n(left)} ${n(bottom-radius)} V ${n(top+radius)} A ${r} ${r} 0 0 1 ${n(left+radius)} ${n(top)} Z")`;
  if(boundary.style.clipPath!==path)boundary.style.clipPath=path;
  write('--peek-comments-left',px(left));
  write('--peek-comments-width',px(right-left));
  write('--peek-comments-height',px(Math.max(0,bottom-top)));
  write('--peek-comments-track-top',px(Math.max(0,top)));
  col.setAttribute(marker,'');
 };
 const schedule=()=>{if(!closed&&!frame)frame=request(update);};
 const resize=typeof win.ResizeObserver==='function'?new win.ResizeObserver(schedule):null;
 win.addEventListener('resize',schedule);
 // The caller may append the AI card just after construction.
 win.queueMicrotask(()=>{if(!closed)update();});
 const release=()=>{
  if(closed)return;closed=true;cancel(frame);frame=0;boundary.remove();
  win.removeEventListener('resize',schedule);resize?.disconnect();
  for(const [key,prior] of saved){if(root.style.getPropertyValue(key)!==owned.get(key))continue;
   if(prior.value)root.style.setProperty(key,prior.value,prior.priority);else root.style.removeProperty(key);
  }
  if(col.getAttribute(marker)===''){if(priorMarker===null)col.removeAttribute(marker);else col.setAttribute(marker,priorMarker);}
 };
 release.update=update;return release;
}
