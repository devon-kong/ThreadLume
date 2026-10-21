// Collapse only X's observed, empty 200px terminal spacer. X measures the cell
// again itself. A separate CSS bound removes stale empty list extent while this
// exact terminal signature is present; native inline size/state stays untouched.
export function attachCommentTail(column){
 const win=column.ownerDocument.defaultView,marker='data-peek-comment-tail';
 const listMarker='data-peek-comment-list',size='--peek-comment-list-height';
 let owned=null,watched=null,bound=null,observedList=null,nativeGeometry='',blockedList=null,blockedTransform='',closed=false,queued=false,epoch=0,proofFrame=0;
 const raf=win.requestAnimationFrame?.bind(win)||(f=>win.setTimeout(f,16)),cancel=win.cancelAnimationFrame?.bind(win)||win.clearTimeout.bind(win);
 const restoreBound=()=>{
  resize?.disconnect();
  if(!bound)return;const {list,value,prior,priority}=bound;bound=null;
  if(list.getAttribute(listMarker)==='trimmed')list.removeAttribute(listMarker);
  if(list.style.getPropertyValue(size)===value){if(prior)list.style.setProperty(size,prior,priority);else list.style.removeProperty(size);}
 };
 const restore=()=>{restoreBound();if(owned?.getAttribute(marker)==='empty')owned.removeAttribute(marker);owned=null;};
 const plain=node=>node?.tagName==='DIV'&&[...node.attributes].every(a=>a.name==='class'||a.name==='style');
 const emptySpacer=cell=>{
  if(cell.tagName!=='DIV'||[...cell.attributes].some(a=>!['class','style','id','data-testid',marker].includes(a.name)))return false;
  if(cell.childElementCount!==1||cell.textContent.trim())return false;
  const wrapper=cell.firstElementChild,leaf=wrapper?.firstElementChild;
  if(!plain(wrapper)||wrapper.childElementCount!==1||!plain(leaf)||leaf.childNodes.length)return false;
  if(!wrapper.classList.contains('r-4d76ec')||!leaf.classList.contains('r-4d76ec'))return false;
  return [wrapper,leaf].every(node=>{
   const style=win.getComputedStyle(node);
   return style.height==='200px'&&(!style.backgroundImage||style.backgroundImage==='none')&&(!style.animationName||style.animationName==='none');
  });
 };
 const boundList=tail=>{
  const list=tail.parentElement,children=[...list.children],rect=list.getBoundingClientRect(),end=tail.getBoundingClientRect().bottom;
  if(blockedList===list){if(tail.style.transform===blockedTransform)return;blockedList=null;}
  // This is deliberately specific to the observed end spacer, never a general
  // "last rendered item" clamp. Any added content releases it before rechecking.
  if((list.hasAttribute(listMarker)&&(list!==bound?.list||list.getAttribute(listMarker)!=='trimmed'))||win.getComputedStyle(list).position!=='relative'||!/^\d+(?:\.\d+)?px$/.test(list.style.minHeight)||children.some(cell=>cell.dataset.testid!=='cellInnerDiv'||win.getComputedStyle(cell).position!=='absolute'||cell.getBoundingClientRect().bottom>end+.5)||!Number.isFinite(end-rect.top)||end-rect.top<=0){restoreBound();return;}
  if(bound?.list!==list){restoreBound();bound={list,value:'',prior:list.style.getPropertyValue(size),priority:list.style.getPropertyPriority(size)};for(const cell of children)resize?.observe(cell);}
  const value=`${Math.round((end-rect.top)*1000)/1000}px`;
  if(list.style.getPropertyValue(size)!==value)list.style.setProperty(size,value);
  bound.value=value;list.setAttribute(listMarker,'trimmed');
 };
 const update=()=>{
  queued=false;if(closed)return;
  const cells=[...column.querySelectorAll('[data-testid="cellInnerDiv"]')],tail=cells.at(-1);
  if(tail!==watched){attributes.disconnect();watched=tail;if(tail)attributes.observe(tail,{attributes:true,subtree:true});}
  if(tail?.parentElement!==observedList){nativeStyles.disconnect();observedList=tail?.parentElement;blockedList=null;if(observedList){nativeGeometry=geometry(observedList);nativeStyles.observe(observedList,{attributes:true,attributeFilter:['style']});}}
  const hasReply=cells.slice(0,-1).some(cell=>[...cell.querySelectorAll('article[data-testid="tweet"]')].some(article=>!article.closest('[data-peek-lad-focal]')));
  const matches=column.isConnected&&tail&&tail.parentElement.lastElementChild===tail&&hasReply&&(!tail.hasAttribute(marker)||tail===owned&&tail.getAttribute(marker)==='empty')&&emptySpacer(tail);
  if(owned&&(!matches||owned!==tail))restore();
  if(matches&&!owned){owned=tail;tail.setAttribute(marker,'empty');}
  if(matches)boundList(tail);
 };
 const schedule=()=>{if(!closed&&!queued){queued=true;win.queueMicrotask(update);}};
 const geometry=list=>JSON.stringify([...list.style].filter(key=>key!==size&&key!=='pointer-events').map(key=>[key,list.style.getPropertyValue(key)]));
 const resize=win.ResizeObserver?new win.ResizeObserver(()=>{epoch++;schedule();}):null;
 const nativeStyles=new win.MutationObserver(()=>{
  const next=geometry(observedList);if(next===nativeGeometry)return;nativeGeometry=next;
  // A native total-size change may precede DOM insertion. Give X its full range
  // until content or the terminal offset changes; never infer completion here.
  epoch++;restoreBound();blockedList=observedList;blockedTransform=watched?.style.transform;schedule();
 });
 const attributes=new win.MutationObserver(()=>{epoch++;schedule();}),content=new win.MutationObserver(records=>{
  epoch++;
  if(records.some(record=>record.type==='childList'&&record.target===observedList))blockedList=null;
  restoreBound();schedule();
 });
 const onScrollEnd=()=>{
  if(closed||!blockedList||!owned)return;
  cancel(proofFrame);const list=blockedList,tail=owned,version=epoch;
  const max=()=>Math.max(column.ownerDocument.documentElement.scrollHeight,column.ownerDocument.body?.scrollHeight||0)-win.innerHeight;
  const cells=[...list.children],boxes=()=>JSON.stringify(cells.map(cell=>{const rect=cell.getBoundingClientRect();return [rect.top,rect.bottom,rect.width,rect.height];}));
  const limit=max(),y=win.scrollY,width=win.innerWidth,height=win.innerHeight,measured=boxes();
  const valid=()=>!closed&&blockedList===list&&owned===tail&&tail.isConnected&&version===epoch&&win.innerWidth===width&&win.innerHeight===height&&limit>0&&Math.abs(y-limit)<1&&Math.abs(win.scrollY-y)<1&&Math.abs(max()-limit)<1&&cells.length===list.children.length&&cells.every((cell,index)=>cell===list.children[index])&&boxes()===measured;
  // A completed native scroll and two unchanged rendering frames witness the
  // full original range before releasing a stale-height guard. No scroll is set.
  proofFrame=raf(()=>{proofFrame=0;if(valid())proofFrame=raf(()=>{proofFrame=0;if(valid()){blockedList=null;schedule();}});});
 };
 win.addEventListener('scrollend',onScrollEnd,{passive:true});
 content.observe(column,{childList:true,characterData:true,subtree:true});update();
 return ()=>{closed=true;cancel(proofFrame);win.removeEventListener('scrollend',onScrollEnd);attributes.disconnect();content.disconnect();nativeStyles.disconnect();restore();};
}
