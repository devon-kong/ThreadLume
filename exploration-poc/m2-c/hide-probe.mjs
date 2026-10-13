// Run with ego-browser nodejs; visible X DOM only, no requests or account actions.
import {readFile,writeFile} from 'node:fs/promises';
const root='/Users/devon/.codex/worktrees/peek-native-m2b0-left-carrier/peek-main/';
const task=await taskSpace(21),p=task.page('p1');
const focal=await readFile(root+'native-dual-extension/src/focal.js','utf8');
await p.waitForSelector('article[data-testid="tweet"]',{timeout:20000});
await p.evaluate(`${focal.replaceAll('export ', '')}\nwindow.__c1Hide={findFocal,setHidden};`);
console.log(await p.evaluate(()=>{
 const q=window.__c1Hide;q.a=q.findFocal(document,location.href);q.cell=q.a?.closest('[data-testid="cellInnerDiv"]');q.v=q.a?.querySelector('video');q.composer=document.querySelector('[data-testid="tweetTextarea_0"]');q.seen=new Set();
 q.sample=()=>{for(const a of document.querySelectorAll('article a[href] time'))q.seen.add(a.parentElement.getAttribute('href'));const rect=n=>n?.isConnected?{top:Math.round(n.getBoundingClientRect().top),height:Math.round(n.getBoundingClientRect().height)}:null;return {y:scrollY,articleConnected:q.a?.isConnected,article:rect(q.a),cell:rect(q.cell),composerConnected:q.composer?.isConnected,composer:rect(q.composer),hidden:q.a?getComputedStyle(q.a).display:null,videoConnected:q.v?.isConnected,videoPaused:q.v?.paused,videoReady:q.v?.readyState,nativeArticles:document.querySelectorAll('article[data-testid="tweet"]').length,seenPermalinks:q.seen.size,viewport:[innerWidth,innerHeight]};};
 q.records=[{stage:'baseline',...q.sample()}];q.style=document.createElement('style');q.style.textContent='article[data-peek-dual-hidden]{display:none!important}';document.head.append(q.style);q.setHidden(q.a,true);
 return q.records[0];
}));
await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
console.log(await p.evaluate(()=>{const q=window.__c1Hide;const r={stage:'hidden',...q.sample()};q.records.push(r);return r;}));
for(const y of [1200,3200,6400]){
 await p.evaluate(y=>window.scrollTo(0,y),y);
 await p.evaluate(()=>new Promise(resolve=>setTimeout(resolve,1200)));
 console.log(await p.evaluate(()=>{const q=window.__c1Hide;const r={stage:'deep',...q.sample()};q.records.push(r);return r;}));
}
await p.evaluate(()=>{scrollTo(0,0);const q=window.__c1Hide;q.setHidden(q.a,false);q.style.remove();});
await p.evaluate(()=>new Promise(resolve=>setTimeout(resolve,1200)));
const data=await p.evaluate(()=>{const q=window.__c1Hide;q.records.push({stage:'restored',...q.sample(),currentFocal:!!q.findFocal(document,location.href)});const data=q.records;delete window.__c1Hide;return data;});
await writeFile(root+'docs/m2-c/evidence/c1-hide-video.json',JSON.stringify({kind:'DOM CSS injection, NOT installed MV3',records:data},null,2)+'\n');
console.log(data.at(-1));
