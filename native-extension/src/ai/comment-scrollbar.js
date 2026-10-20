// Presentation control only. Window remains X's virtualizer scroll source.
export function attachCommentScrollbar(document){
 const win=document.defaultView,root=document.documentElement,raf=win.requestAnimationFrame?.bind(win)||(f=>win.setTimeout(f,16)),cancel=win.cancelAnimationFrame?.bind(win)||win.clearTimeout.bind(win);
 let bar=null,thumb=null,frame=0,scrollFrame=0,wanted=0,closed=false,drag=null,observedCard=null,observedColumn=null;
 const active=()=>root.getAttribute('data-peek-lad')==='on'&&root.getAttribute('data-peek-lad-state')==='active'&&win.innerWidth>=980&&!document.querySelector('[data-testid="swipe-to-dismiss"]');
 const range=()=>Math.max(0,Math.max(root.scrollHeight,document.body?.scrollHeight||0)-win.innerHeight);
 const remove=()=>{bar?.remove();bar=thumb=null;drag=null;cancel(scrollFrame);scrollFrame=0;root.removeAttribute('data-peek-internal-scrollbar');};
 const scroll=top=>{wanted=Math.max(0,Math.min(range(),top));if(!scrollFrame)scrollFrame=raf(()=>{scrollFrame=0;if(!closed&&active())win.scrollTo({top:wanted,left:win.scrollX,behavior:'instant'});});};
 const pointer=e=>{if(!drag||drag.id!==e.pointerId||!bar)return;const b=bar.getBoundingClientRect(),t=thumb.getBoundingClientRect();scroll((e.clientY-b.top-drag.offset)/Math.max(1,b.height-t.height)*range());};
 function create(){
  bar=document.createElement('div');bar.id='peek-comment-scrollbar';bar.setAttribute('role','scrollbar');bar.setAttribute('aria-label','滚动评论，范围为当前已加载内容');bar.setAttribute('aria-orientation','vertical');bar.setAttribute('aria-valuemin','0');bar.tabIndex=0;thumb=document.createElement('div');thumb.className='pk-comment-thumb';bar.append(thumb);document.body.append(bar);
  bar.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();drag={id:e.pointerId,offset:e.target===thumb?e.clientY-thumb.getBoundingClientRect().top:thumb.getBoundingClientRect().height/2};bar.focus({preventScroll:true});bar.setPointerCapture?.(e.pointerId);if(e.target!==thumb)pointer(e);});bar.addEventListener('pointermove',pointer);const end=e=>{if(drag?.id===e.pointerId)drag=null;};bar.addEventListener('pointerup',end);bar.addEventListener('pointercancel',end);bar.addEventListener('lostpointercapture',end);
  bar.addEventListener('keydown',e=>{if(e.altKey||e.ctrlKey||e.metaKey)return;const size=bar.clientHeight||parseFloat(bar.style.height),delta={ArrowDown:48,ArrowUp:-48,PageDown:size*.85,PageUp:-size*.85}[e.key];if(delta!==undefined||['Home','End'].includes(e.key)){e.preventDefault();scroll(e.key==='Home'?0:e.key==='End'?range():(scrollFrame?wanted:win.scrollY)+delta);}});
 }
 function update(){frame=0;if(closed)return;try{
  if(!active()){remove();return;}const col=document.querySelector('[data-testid="primaryColumn"]');if(!col){remove();return;}
  if(!bar)create();const card=document.getElementById('peek-ai-card'),box=card?.getBoundingClientRect(),top=box?.width>0?box.bottom+16:76,bottom=win.innerHeight-24,h=Math.max(0,bottom-top),right=box?.width>0?box.right:win.innerWidth-16,max=range(),t=Math.min(h,Math.max(28,h*win.innerHeight/(max+win.innerHeight)));
  if(h<44){remove();return;}
  Object.assign(bar.style,{top:top+'px',left:(right-15)+'px',height:h+'px'});Object.assign(thumb.style,{height:t+'px',transform:`translateY(${(h-t)*Math.max(0,Math.min(max,win.scrollY))/Math.max(1,max)}px)`});bar.setAttribute('aria-valuemax',String(Math.round(max)));bar.setAttribute('aria-valuenow',String(Math.round(Math.max(0,Math.min(max,win.scrollY)))));root.setAttribute('data-peek-internal-scrollbar','');
  if(card!==observedCard){if(observedCard)resize?.unobserve(observedCard);observedCard=card;if(card)resize?.observe(card);}if(col!==observedColumn){if(observedColumn)resize?.unobserve(observedColumn);observedColumn=col;resize?.observe(col);}
 }catch{remove();}}
 const schedule=()=>{if(!closed&&!frame)frame=raf(update);};
 const resize=win.ResizeObserver?new win.ResizeObserver(schedule):null;resize?.observe(root);
 const observer=new win.MutationObserver(records=>{if(records.some(r=>r.target!==bar&&r.target!==thumb&&(!bar||!bar.contains(r.target))&&!(r.type==='attributes'&&r.attributeName==='data-peek-internal-scrollbar')))schedule();});
 observer.observe(root,{attributes:true,attributeFilter:['data-peek-lad','data-peek-lad-state'],childList:true,subtree:true});
 win.addEventListener('scroll',schedule,{passive:true});win.addEventListener('resize',schedule);schedule();
 return ()=>{closed=true;cancel(frame);remove();resize?.disconnect();observer.disconnect();win.removeEventListener('scroll',schedule);win.removeEventListener('resize',schedule);};
}
