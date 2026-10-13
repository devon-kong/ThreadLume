export function findFocal(doc,url) {
  const id=new URL(url).pathname.match(/\/status\/(\d+)/)?.[1];
  if(!id)return null;
  return [...doc.querySelectorAll('article[data-testid="tweet"]')].find(article=>
    [...article.querySelectorAll('a[href]')].some(a=>{
      if(!a.querySelector('time') || a.closest('article')!==article || a.closest('div[role="link"]'))return false;
      try{return new URL(a.href,doc.location.href).pathname.match(/^\/\w+\/status\/(\d+)\/?$/)?.[1]===id;}catch{return false;}
    })) || null;
}
export function setHidden(article,hidden) {
  if(!article)return;
  if(hidden)article.setAttribute('data-peek-dual-hidden','');
  else article.removeAttribute('data-peek-dual-hidden');
}

export function detailComposer(article) {
  const cell=article?.closest('[data-testid="cellInnerDiv"]');
  const composer=cell?.querySelector('[data-testid="tweetTextarea_0"], [data-testid="inline_reply_offscreen"]');
  return composer && !article.contains(composer) ? composer : null;
}
