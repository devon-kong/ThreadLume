// Standard native DOM / TextTrack only. No network or alternate player.
const abortError = () => new DOMException('Cancelled', 'AbortError');
const textOf = n => (n?.innerText ?? n?.textContent ?? '').trim();
export function transcriptOf(cues) {
  return cues.map(c => `${clock(c.start)} ${c.text.trim().replace(/\s+/g,' ')}`).join('\n');
}
export function clock(seconds) {
  const s=Math.max(0,Math.floor(seconds));
  return [Math.floor(s/3600),Math.floor(s/60)%60,s%60].map(n=>String(n).padStart(2,'0')).join(':');
}
export function seekNative(video, milliseconds) {
  if(!video?.isConnected || !Number.isFinite(milliseconds) || milliseconds<0 || !Number.isFinite(video.duration) || milliseconds>video.duration*1000)return false;
  video.currentTime=milliseconds/1000; // Never calls play/pause.
  return true;
}
export function collectCaptions(video,{signal,timeoutMs=8000,settleMs=500,isCurrent=()=>true}={}) {
  return new Promise((resolve,reject)=>{
    if(signal?.aborted)return reject(abortError());
    let selected=null,changed=false,userChanged=false,done=false,stableTimer=null,signature='';
    const list=video.textTracks, cleanups=[];
    const listen=(node,event,fn)=>{node?.addEventListener?.(event,fn);cleanups.push(()=>node?.removeEventListener?.(event,fn));};
    const finish=(value,error)=>{
      if(done)return;done=true;clearTimeout(timer);clearTimeout(stableTimer);cleanups.forEach(f=>f());
      if(changed&&!userChanged&&selected?.mode==='hidden')selected.mode='disabled';
      if(error)reject(error);else resolve(value);
    };
    const snapshot=()=>Array.from(selected?.cues||[]).map(c=>({start:c.startTime,end:c.endTime,text:String(c.text||'')})).filter(c=>Number.isFinite(c.start)&&Number.isFinite(c.end)&&c.start>=0&&c.end>=c.start&&c.text.trim());
    const check=()=>{
      if(done)return;
      if(!isCurrent()||!video.isConnected)return finish(null,abortError());
      if(!selected){
        const tracks=Array.from(list||[]).filter(t=>['subtitles','captions'].includes(t.kind));
        tracks.sort((a,b)=>Number(b.mode==='showing')-Number(a.mode==='showing')||Number(/^zh/i.test(b.language))-Number(/^zh/i.test(a.language))||String(a.language).localeCompare(String(b.language)));
        selected=tracks[0];
        if(!selected)return;
        if(selected.mode==='disabled'){changed=true;selected.mode='hidden';}
        listen(selected,'cuechange',check);
      }
      const cues=snapshot();if(!cues.length||!Number.isFinite(video.duration)||video.duration<=0)return;
      const sig=JSON.stringify(cues);
      if(sig===signature)return;signature=sig;clearTimeout(stableTimer);
      const element=Array.from(video.querySelectorAll?.('track')||[]).find(e=>e.track===selected);
      // readyState 2 is the native all-file load signal. Tracks created by X
      // without a track element expose a snapshot only; never label that as a
      // universal proof of transcript completeness. Live acceptance compares
      // the sample's full expected cues independently.
      stableTimer=setTimeout(()=>{
        if(!isCurrent()||!video.isConnected)return finish(null,abortError());
        const latest=snapshot();if(JSON.stringify(latest)!==signature){signature='';check();return;}
        finish({cues:latest,language:selected.language||'',duration:video.duration,completion:element?.readyState===2?'native-loaded':'available-cues-snapshot'});
      },element?.readyState===2?0:settleMs);
    };
    // List notifications may be queued by a cancelled reader or another track.
    // Only an observed departure from our hidden mode relinquishes ownership;
    // keep that decision if the user later switches back to hidden.
    const onChange=()=>{if(selected&&changed&&selected.mode!=='hidden')userChanged=true;check();};
    const timer=setTimeout(()=>finish(null),timeoutMs);
    // X may append non-active cues without cuechange or a <track> load event.
    // Sample only during this bounded foreground read; finish always clears it.
    const sampleTimer=setInterval(check,100);cleanups.push(()=>clearInterval(sampleTimer));
    listen(list,'addtrack',check);listen(list,'change',onChange);listen(list,'removetrack',()=>finish(null));
    // X renders its own captions with mode=hidden too. A native CC click is
    // therefore user intent even if the standard mode never changes value.
    const captionButton=video.closest?.('[data-testid="videoPlayer"]')?.querySelector('[data-testid="captions"]');
    listen(captionButton,'click',()=>{if(changed)userChanged=true;});
    for(const event of ['loadedmetadata','loadeddata','durationchange'])listen(video,event,check);
    for(const element of video.querySelectorAll?.('track')||[])listen(element,'load',check);
    listen(signal,'abort',()=>finish(null,abortError()));
    check();
  });
}
export function focalArticle(document,focusId) {
  if(!new RegExp(`/status/${focusId}(?:/|$)`).test(document.location.pathname))return null;
  const cells=Array.from(document.querySelectorAll('[data-testid="cellInnerDiv"]'));
  const matches=cells.filter(cell=>Array.from(cell.querySelectorAll('a[href] time')).some(time=>{
    const a=time.closest('a');return !a.closest('div[role="link"]')&&new RegExp(`/status/${focusId}(?:$|[?#/])`).test(a.getAttribute('href')||'');
  }));
  if(matches.length!==1)return null;
  return matches[0].querySelector('article[data-testid="tweet"], article');
}
export function inspectFocal(document,focusId) {
  const article=focalArticle(document,focusId);if(!article)return null;
  const owned=selector=>Array.from(article.querySelectorAll(selector)).filter(n=>!n.closest('div[role="link"], [data-testid="card.wrapper"]'));
  const url=`${document.location.origin}${document.location.pathname.replace(/\/(photo|video)\/\d+.*$/,'')}`;
  const bodies=owned('[data-testid="twitterArticleRichTextView"]');
  const titles=owned('[data-testid="twitter-article-title"]');
  if(bodies.length===1&&titles.length===1&&textOf(bodies[0])&&textOf(titles[0])){
    const title=textOf(titles[0]),body=textOf(bodies[0]);
    return {kind:'article',text:`${title}\n\n${body}`,body,title,url,focusId,article};
  }
  // Article embeds can contain videos and tweetText. The outer article owns
  // the input; incomplete hydration must not turn an embed into the source.
  if(bodies.length||titles.length)return null;
  const video=owned('video')[0];
  const postText=textOf(owned('[data-testid="tweetText"]')[0]);
  if(video)return {kind:'video',video,article,url,title:postText.slice(0,200)||'X 视频',focusId};
  if(Array.from(postText).length>=1000&&!owned('[data-testid="tweet-text-show-more-link"], a[href*="show-more"]').length&&!postText.endsWith('…'))
    return {kind:'article',text:postText,title:postText.split('\n')[0].slice(0,160),url,focusId,article};
  return null;
}
export async function readFocalContent(focusId,{document=globalThis.document,signal,timeoutMs=8000,settleMs=500,isCurrent=()=>true}={}) {
  const initial=inspectFocal(document,focusId);
  if(initial?.kind==='video'){
    const captions=await collectCaptions(initial.video,{signal,timeoutMs,settleMs,isCurrent:()=>isCurrent()&&focalArticle(document,focusId)===initial.article});
    return captions?{...initial,...captions,text:transcriptOf(captions.cues)}:null;
  }
  if(initial?.kind==='article'){
    await new Promise((resolve,reject)=>{const t=setTimeout(()=>{signal?.removeEventListener('abort',cancel);resolve();},settleMs);function cancel(){clearTimeout(t);reject(abortError());}if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true});});
    if(!isCurrent()||signal?.aborted)throw abortError();
    const after=inspectFocal(document,focusId);
    return after?.kind==='article'&&after.article===initial.article&&after.text===initial.text?after:null;
  }
  // The controller observes native hydration for a bounded window. A short
  // post is not eligible and must not create a placeholder or request.
  return null;
}
