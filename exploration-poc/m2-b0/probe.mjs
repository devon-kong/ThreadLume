// Disposable CSS-only architecture probe. Never imported into shipped builds.
// Does not patch X, retain virtualizer entries, clone or reparent native nodes.
export function installCarrier({mode='a',innerScroll=false}={}) {
  if(!['a','b'].includes(mode))throw Error('Unknown mode');
  if(window.__m2b0?.state().active)throw Error('Probe already active');
  const id=location.pathname.match(/\/status\/(\d+)/)?.[1];
  const article=[...document.querySelectorAll('[data-testid="primaryColumn"] article[data-testid="tweet"]')].find(a=>[...a.querySelectorAll('a:has(time)')].some(l=>l.pathname.match(/\/status\/(\d+)/)?.[1]===id&&!l.closest('div[role="link"]')));
  const cell=article?.closest('[data-testid="cellInnerDiv"]'), section=cell?.closest('section');
  if(!id||!cell||!section||!cell.querySelector('[data-testid="tweetTextarea_0"],[data-testid="inline_reply_offscreen"],[data-testid="tweetButtonInline"]'))throw Error('Hydrated focal detail missing');
  const media=article.querySelector('[data-testid="videoPlayer"]'),video=media?.querySelector('video');
  if(mode==='b'&&!media)throw Error('Native media missing');
  const parent=article.parentNode,mediaParent=media?.parentNode,cellParent=cell.parentNode;
  const start=performance.now(),originalScroll=[scrollX,scrollY],owned=[];
  const mark=(el,key)=>{if(!el)return;owned.push([el,key,el.getAttribute(key)]);el.setAttribute(key,'');};
  mark(article,'data-m2b0-focal');mark(cell,'data-m2b0-cell');mark(section,'data-m2b0-section');mark(media,'data-m2b0-media');mark(document.documentElement,'data-m2b0-root');
  const style=document.createElement('style');style.id='m2b0-style';
  const bg=getComputedStyle(document.body).backgroundColor;
  style.textContent=`
    html[data-m2b0-root] [data-testid="sidebarColumn"],html[data-m2b0-root] header[role="banner"]{display:none!important}
    html[data-m2b0-root] main{width:100%!important;align-items:flex-start!important}
    html[data-m2b0-root] [data-testid="primaryColumn"]{width:100vw!important;max-width:100vw!important;min-width:0!important}
    html[data-m2b0-root] [data-testid="cellInnerDiv"]{margin-left:52vw!important;width:48vw!important}
    [data-m2b0-cell]{transform:none!important}
    [data-m2b0-focal]{position:fixed!important;left:0!important;top:54px!important;bottom:0!important;width:52vw!important;box-sizing:border-box!important;overflow-y:auto!important;overscroll-behavior:contain!important;z-index:10!important;background:${bg}!important;border-right:1px solid #888!important}
    ${mode==='b'?`[data-m2b0-focal]{visibility:hidden!important;overflow:visible!important;pointer-events:none!important}
    [data-m2b0-media]{visibility:visible!important;pointer-events:auto!important;position:fixed!important;left:16px!important;top:360px!important;width:calc(52vw - 32px)!important;max-height:calc(100vh - 380px)!important;z-index:61!important}
    #peek-native-pane .peek-native-rich-note,#peek-native-pane .peek-native-actions{display:none!important}`:''}
    ${innerScroll?'[data-m2b0-section]{height:calc(100vh - 54px)!important;overflow-y:auto!important;overscroll-behavior:contain!important}':''}
  `;
  document.head.append(style);
  let active=true,reason=null,endedAt=null;
  const rect=e=>{if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};};
  const state=()=>({mode,innerScroll,active,reason,installMs:installedMs,endedAfterMs:endedAt,viewport:[innerWidth,innerHeight],windowScroll:scrollY,sectionScroll:section.scrollTop,sectionHeight:section.scrollHeight,articleScroll:article.scrollTop,articleHeight:article.scrollHeight,articleClient:article.clientHeight,connected:article.isConnected,sameParent:article.parentNode===parent,cellConnected:cell.isConnected,sameCellParent:cell.parentNode===cellParent,rect:rect(article),mediaRect:rect(media),sameMediaParent:media?media.parentNode===mediaParent:null,sameVideo:video?article.querySelector('video')===video:null,videoConnected:video?.isConnected??null,video:video?{paused:video.paused,time:video.currentTime,ready:video.readyState,muted:video.muted,dimensions:[video.videoWidth,video.videoHeight]}:null,nativeVideos:document.querySelectorAll('video').length,visibleArticles:[...document.querySelectorAll('[data-testid="primaryColumn"] article')].filter(a=>{const r=a.getBoundingClientRect();return r.bottom>54&&r.top<innerHeight}).length,liveCells:cellParent.querySelectorAll('[data-testid="cellInnerDiv"]').length});
  const check=()=>{if(!active)return;if(location.pathname.match(/\/status\/(\d+)/)?.[1]!==id)undo('route-changed');else if(!article.isConnected)undo('focal-unmounted');};
  const observer=new MutationObserver(check);
  const onKey=e=>{if(e.key!=='Escape'||document.fullscreenElement||document.querySelector('[role="dialog"],[role="menu"],[data-testid="HoverCard"]')||e.target?.closest?.('[contenteditable="true"],input,textarea'))return;undo('escape');};
  function undo(why='explicit') {if(!active)return;active=false;reason=why;endedAt=performance.now()-start;observer.disconnect();removeEventListener('popstate',check);removeEventListener('keydown',onKey,true);navigationTarget?.removeEventListener('navigatesuccess',check);style.remove();for(const [el,k,v] of owned){if(v===null)el.removeAttribute(k);else el.setAttribute(k,v);}if(why==='explicit'||why==='escape')scrollTo(...originalScroll);}
  const navigationTarget=window.navigation;
  observer.observe(document.body,{subtree:true,childList:true});addEventListener('popstate',check);addEventListener('keydown',onKey,true);navigationTarget?.addEventListener('navigatesuccess',check);
  const installedMs=performance.now()-start;
  // Probe-only references allow identity measurement; they never keep a React
  // subtree mounted. A detached reference is evidence of failure, not retention.
  window.__m2b0={state,undo,article,section,video};
  return state();
}

// Sanitized structural data only: no text, URLs, React properties or auth.
export function inspectLayout(){
  const id=location.pathname.match(/\/status\/(\d+)/)?.[1];
  const a=[...document.querySelectorAll('[data-testid="primaryColumn"] article')].find(a=>[...a.querySelectorAll('a:has(time)')].some(l=>l.pathname.match(/\/status\/(\d+)/)?.[1]===id));
  const rect=e=>{const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height];};
  const chain=e=>{const out=[];for(;e;e=e.parentElement){const s=getComputedStyle(e);out.push({tag:e.tagName,testid:e.dataset.testid||null,role:e.getAttribute('role'),position:s.position,transform:s.transform,overflow:[s.overflowX,s.overflowY],contain:s.contain,filter:s.filter,display:s.display,rect:rect(e),scroll:[e.scrollTop,e.scrollHeight,e.clientHeight]});}return out;};
  const cell=a?.closest('[data-testid="cellInnerDiv"]');
  return {viewport:[innerWidth,innerHeight],scrollElement:document.scrollingElement.tagName,windowScroll:scrollY,extensionPanes:document.querySelectorAll('#peek-native-pane').length,focal:chain(a),video:chain(a?.querySelector('video')),cells:cell?[...cell.parentElement.children].slice(0,12).map(e=>({testid:e.dataset.testid,article:!!e.querySelector('article'),composer:!!e.querySelector('[data-testid="tweetTextarea_0"],[data-testid="inline_reply_offscreen"]'),rect:rect(e)})):[],content:a?{textChars:a.querySelector('[data-testid="tweetText"]')?.textContent.length||0,photos:a.querySelectorAll('[data-testid="tweetPhoto"] img').length,videos:a.querySelectorAll('video').length,articleChars:a.querySelector('[data-testid="twitterArticleRichTextView"]')?.textContent.length||0,articleImages:a.querySelectorAll('[data-testid="twitterArticleRichTextView"] img').length,quoteCards:a.querySelectorAll('div[role="link"]').length,poll:!!a.querySelector('[data-testid="poll"]'),actions:[...a.querySelectorAll('button[data-testid]')].map(e=>e.dataset.testid)}:null};
}
