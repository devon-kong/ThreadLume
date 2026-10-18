// Keep X's document as the native virtualizer's scroll source. Clip only the
// right-hand conversation to the space below our fixed card; the left focal
// article stays inside the uncut part of the same column. No DOM moves/copies,
// synthetic scrolling or MAIN/list-internal changes.
export function attachCommentViewport(document,card){
 const win=document.defaultView,col=document.querySelector('[data-testid="primaryColumn"]');
 if(!win||!col)return ()=>{};
 const root=document.documentElement,marker='data-peek-ai-viewport';
 const priorMarker=col.getAttribute(marker),saved=new Map(),owned=new Map();
 let closed=false,frame=0;
 const request=win.requestAnimationFrame?.bind(win)||(f=>win.setTimeout(f,16));
 const cancel=win.cancelAnimationFrame?.bind(win)||win.clearTimeout.bind(win);
 const write=(node,key,value)=>{
  const id=key; // Each property belongs to exactly one of the two nodes.
  if(!saved.has(id))saved.set(id,{node,value:node.style.getPropertyValue(key),priority:node.style.getPropertyPriority(key)});
  if(node.style.getPropertyValue(key)!==value)node.style.setProperty(key,value);
  owned.set(id,value);
 };
 const px=n=>`${Math.round(n*1000)/1000}px`;
 const update=()=>{
  frame=0;
  if(closed||!card.isConnected||!col.isConnected||win.innerWidth<980)return;
  const box=card.getBoundingClientRect(),column=col.getBoundingClientRect();
  // A native lightbox temporarily hides the card via CSS. Keep the last good
  // geometry; CSS releases the clip while that lightbox owns the screen.
  if(box.width<=0||box.height<=0||column.width<=0)return;
  const gap=parseFloat(win.getComputedStyle(root).getPropertyValue('--peek-reader-gap'))||8;
  const top=Math.min(box.bottom+gap,win.innerHeight-16),bottom=win.innerHeight-16;
  const left=box.left-column.left,right=box.right-column.left,t=top-column.top,b=bottom-column.top;
  const radius=Math.max(0,Math.min(parseFloat(win.getComputedStyle(card).borderTopLeftRadius)||16,(right-left)/2,(b-t)/2));
  const n=v=>Math.round(v*1000)/1000,r=n(radius),x=n(left),y=n(t),end=n(right),low=n(b);
  // Two clockwise subpaths form a union: uncut left pane + rounded replies.
  // The path is extension-generated geometry, never provider/model text.
  const path=`path("M 0 0 H ${x} V ${n(Math.max(column.height,b))} H 0 Z M ${n(left+radius)} ${y} H ${n(right-radius)} A ${r} ${r} 0 0 1 ${end} ${n(t+radius)} V ${n(b-radius)} A ${r} ${r} 0 0 1 ${n(right-radius)} ${low} H ${n(left+radius)} A ${r} ${r} 0 0 1 ${x} ${n(b-radius)} V ${n(t+radius)} A ${r} ${r} 0 0 1 ${n(left+radius)} ${y} Z")`;
  write(col,'--peek-comments-clip',path);
  write(col,'--peek-comments-left',px(box.left-column.left));
  write(col,'--peek-comments-right',px(box.right-column.left));
  write(col,'--peek-comments-top',px(top-column.top));
  write(col,'--peek-comments-bottom',px(bottom-column.top));
  write(root,'--peek-comments-track-top',px(Math.max(0,top)));
  col.setAttribute(marker,'');
 };
 const schedule=()=>{if(!closed&&!frame)frame=request(update);};
 win.addEventListener('scroll',schedule,{passive:true});win.addEventListener('resize',schedule);
 const resize=typeof win.ResizeObserver==='function'?new win.ResizeObserver(schedule):null;
 resize?.observe(card);resize?.observe(col);resize?.observe(root);
 // The card is appended by the caller immediately after construction.
 win.queueMicrotask(schedule);
 return ()=>{
  if(closed)return;closed=true;cancel(frame);frame=0;
  win.removeEventListener('scroll',schedule);win.removeEventListener('resize',schedule);resize?.disconnect();
  for(const [key,prior] of saved){if(prior.node.style.getPropertyValue(key)!==owned.get(key))continue;
   if(prior.value)prior.node.style.setProperty(key,prior.value,prior.priority);else prior.node.style.removeProperty(key);
  }
  if(col.getAttribute(marker)===''){if(priorMarker===null)col.removeAttribute(marker);else col.setAttribute(marker,priorMarker);}
 };
}
