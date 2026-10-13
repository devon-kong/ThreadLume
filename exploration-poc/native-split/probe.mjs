export function installSplitProbe() {
  window.__peekSplitProbe?.undo();
  const id=location.pathname.match(/\/status\/(\d+)/)?.[1];
  const article=[...document.querySelectorAll('article[data-testid="tweet"]')].find(a=>[...a.querySelectorAll('a:has(time)')].some(l=>l.pathname.match(/\/status\/(\d+)/)?.[1]===id));
  const cell=article?.closest('[data-testid="cellInnerDiv"]');
  if(!cell || !id) throw new Error('Focal detail article missing');
  const parent=article.parentElement;
  const style=document.createElement('style'); style.id='peek-split-probe-style';
  article.dataset.peekSplitFocal=''; cell.dataset.peekSplitCell='';
  style.textContent=`
    #peek-native-pane {display:none!important}
    [data-peek-split-cell] {transform:none!important}
    [data-peek-split-focal] {position:fixed!important;left:0!important;top:54px!important;bottom:0!important;width:52vw!important;box-sizing:border-box!important;overflow-y:auto!important;overscroll-behavior:contain!important;z-index:59!important;background:rgb(255,255,255)!important;border-right:1px solid #ddd!important}
    [data-peek-split-focal] [data-testid="tweetText"] {font-size:15px!important;line-height:20px!important}
  `;
  document.head.append(style); window.scrollTo(0,0);
  const probe={id,article,cell,parent,style,undo(){style.remove();article.removeAttribute('data-peek-split-focal');cell.removeAttribute('data-peek-split-cell');delete window.__peekSplitProbe;},state(){const r=article.getBoundingClientRect();return {id,connected:article.isConnected,sameParent:article.parentElement===parent,scrollY,articleScroll:article.scrollTop,articleRect:{x:r.x,y:r.y,width:r.width,height:r.height},articleHeight:article.scrollHeight,cellHeight:cell.getBoundingClientRect().height,cells:document.querySelectorAll('[data-testid="cellInnerDiv"]').length,video:article.querySelector('video')?{time:article.querySelector('video').currentTime,paused:article.querySelector('video').paused}:null};}};
  window.__peekSplitProbe=probe;return probe.state();
}

// EXPERIMENT ONLY: depends on undocumented X / React internals. No network,
// credentials, account writes, cloned nodes, or reparenting. Reload is the
// recovery boundary; production would require route and shape guards.
export function installRetentionProbe() {
  const probe=window.__peekSplitProbe;
  if(!probe?.article.isConnected) throw new Error('Install before focal unmount');
  const cell=probe.cell;
  let fiber=cell[Object.keys(cell).find(k=>k.startsWith('__reactFiber'))];
  while(fiber&&!fiber.stateNode?._getFinalRenderedItems) fiber=fiber.return;
  const v=fiber?.stateNode;
  if(!v||!Array.isArray(v.props.list))throw new Error('Unsupported virtualizer');
  const entry=v._getFinalRenderedItems().find(x=>v._cells.get(x.item.id)?.getElement()===cell);
  if(!entry) throw new Error('Cannot map focal cell to virtual entry');
  const original=v._getFinalRenderedItems;
  v._getFinalRenderedItems=function(...args){
    const items=original.apply(this,args);
    if(location.pathname.match(/\/status\/(\d+)/)?.[1]!==probe.id)return items;
    if(items.some(x=>x.item.id===entry.item.id))return items;
    const currentItem=this.props.list.find(x=>x.id===entry.item.id);
    return currentItem?[{...entry,item:currentItem,offset:0,visible:true},...items]:items;
  };
  const undo=probe.undo;
  probe.undo=()=>{v._getFinalRenderedItems=original;v.forceUpdate();undo();};
  probe.retention={entryId:entry.item.id};
  return probe.retention;
}

export function armPreviewCleanup() {
  const probe=window.__peekSplitProbe;
  if(!probe) throw new Error('No preview');
  const observer=new MutationObserver(()=>{
    if(location.pathname.match(/\/status\/(\d+)/)?.[1]!==probe.id || !document.getElementById('peek-native-pane')) probe.undo();
  });
  const undo=probe.undo;
  probe.undo=()=>{observer.disconnect();undo();};
  observer.observe(document.body,{subtree:true,childList:true});
  return {cleanup:'route change or reader removal; reload fully resets the page'};
}
