import {pairURL,statusURL} from './controller.js';

// Read the actually clicked semantic target. X remains responsible for navigation.
export function clickIntent(event, pageURL) {
  if (!event.isTrusted || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || pairURL(pageURL)) return null;
  const target = event.target?.closest ? event.target : event.target?.parentElement;
  const article = target?.closest('article[data-testid="tweet"]');
  if (!article || target.closest('button,[role="button"],input,textarea,[contenteditable="true"],video,[data-testid="tweetPhoto"],[data-testid="videoPlayer"],[data-testid="card.wrapper"]')) return null;
  if (target.ownerDocument.getSelection()?.toString()) return null;
  const anchor = target.closest('a[href]');
  if (anchor) {
    const url = statusURL(anchor.href);
    return url ? {url} : null;
  }
  const quote = target.closest('div[role="link"]');
  if (quote && article.contains(quote)) {
    const link = [...quote.querySelectorAll('a[href]')].map(a => statusURL(a.href)).find(Boolean);
    return {url:link || null}; // No private lookup: follow X's eventual quote destination.
  }
  const permalink = [...article.querySelectorAll('a[href]')].find(a => a.querySelector('time') && !a.closest('div[role="link"]'));
  const url = statusURL(permalink?.href);
  return url ? {url} : null;
}

export function installEntry({win,send,onRoute,onError}) {
  let followTimer = null, routeTimer = null, generation = 0;
  async function follow(token, deadline) {
    if (token !== generation || Date.now() >= deadline) return;
    const response = await send({type:'follow-open'}).catch(error => ({ok:false,error:error.message}));
    if (token !== generation) return;
    if (!response.ok) { onError(response.error); return; }
    if (response.value?.state === 'opened') { onRoute(); return; }
    if (response.value?.state === 'waiting') followTimer = win.setTimeout(() => follow(token,deadline),200);
  }
  function click(event) {
    // Refresh the visible detail-page launcher after native SPA navigation.
    win.clearTimeout(routeTimer);
    routeTimer = win.setTimeout(onRoute,200);
    const intent = clickIntent(event,win.location.href);
    if (!intent) return;
    const token = ++generation;
    win.clearTimeout(followTimer);
    void send({type:'prepare-open',url:intent.url}).then(response => {
      if (token !== generation) return;
      if (!response.ok) { onError(response.error); return; }
      void follow(token,Date.now()+10000);
    }).catch(error => onError(error.message));
  }
  function cancel() {generation++;win.clearTimeout(followTimer);win.clearTimeout(routeTimer);}
  win.document.addEventListener('click',click,true);
  win.addEventListener('popstate',onRoute);
  win.addEventListener('pagehide',cancel);
  return () => {
    cancel();win.document.removeEventListener('click',click,true);
    win.removeEventListener('popstate',onRoute);win.removeEventListener('pagehide',cancel);
  };
}
