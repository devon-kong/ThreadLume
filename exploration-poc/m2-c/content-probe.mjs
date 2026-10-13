// Actual bundled content.js with runtime-message harness; NOT real MV3 installation.
import {readFile,writeFile} from 'node:fs/promises';
const root='/Users/devon/.codex/worktrees/peek-native-m2b0-left-carrier/peek-main/';
const task=await taskSpace(21),p=task.page('p1');
const code=await readFile(root+'dist-extension-native-dual/content.js','utf8');
const records=[];
for(const [width,height] of [[1440,900],[1280,800],[1000,760]]){
 await p.cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
 await p.reload();await p.waitForSelector('[data-testid="tweetTextarea_0"]',{timeout:20000});
 await p.evaluate(({code})=>{
  const h=window.__c1Harness={role:{role:'right',url:location.origin+location.pathname,mode:'windows',hide:false},listeners:[]};
  const runtime={sendMessage:async m=>{if(m.type==='hide'){h.role.hide=m.value;h.listeners.forEach(fn=>fn({type:'refresh'}));}return {ok:true,value:h.role};},onMessage:{addListener:fn=>h.listeners.push(fn)}};
  new Function('chrome',code)({runtime});
  h.set=async hide=>{h.role={...h.role,hide};h.listeners.forEach(fn=>fn({type:'refresh'}));};
  h.sample=()=>{const a=[...document.querySelectorAll('article[data-testid="tweet"]')].find(a=>[...a.querySelectorAll('a[href] time')].some(t=>t.parentElement.pathname===location.pathname));const composer=document.querySelector('[data-testid="tweetTextarea_0"]');return {y:scrollY,focalPresent:!!a,focalHidden:a?getComputedStyle(a).display==='none':null,composerPresent:!!composer,composerTop:composer?Math.round(composer.getBoundingClientRect().top):null,markedCount:document.querySelectorAll('[data-peek-dual-hidden]').length,nativeArticles:document.querySelectorAll('article[data-testid="tweet"]').length,controls:!!document.getElementById('peek-dual-controls')};};
 },{code});
 await p.evaluate(()=>new Promise(r=>setTimeout(r,1000)));
 records.push({width,height,stage:'base',...await p.evaluate(()=>window.__c1Harness.sample())});
 await p.evaluate(()=>window.__c1Harness.set(true));
 await p.waitForFunction(()=>!!document.querySelector('[data-peek-dual-hidden]'));
 records.push({width,height,stage:'hidden',...await p.evaluate(()=>window.__c1Harness.sample())});
 await p.mouse.move(Math.floor(width/2),Math.floor(height/2));await p.mouse.wheel(0,6400,{label:'scroll native reply list'});await p.evaluate(()=>new Promise(r=>setTimeout(r,1200)));
 records.push({width,height,stage:'deep',...await p.evaluate(()=>window.__c1Harness.sample())});
 await p.evaluate(()=>scrollTo(0,0));await p.evaluate(()=>new Promise(r=>setTimeout(r,1200)));
 records.push({width,height,stage:'remounted',...await p.evaluate(()=>window.__c1Harness.sample())});
 await p.evaluate(()=>window.__c1Harness.set(false));await p.evaluate(()=>new Promise(r=>setTimeout(r,300)));
 records.push({width,height,stage:'unhidden',...await p.evaluate(()=>window.__c1Harness.sample())});
 await p.evaluate(()=>{const h=window.__c1Harness;h.role=null;h.listeners.forEach(fn=>fn({type:'refresh'}));});
 await p.evaluate(()=>new Promise(r=>setTimeout(r,100)));
 records.push({width,height,stage:'cleanup',...await p.evaluate(()=>{const s=window.__c1Harness.sample();delete window.__c1Harness;return {...s,styleRemaining:!!document.getElementById('peek-dual-hide-style')};})});
}
await p.cdp('Emulation.clearDeviceMetricsOverride');
await writeFile(root+'docs/m2-c/evidence/c1-content-video-repair.json',JSON.stringify({kind:'real X / injected bundled content, mocked runtime; NOT MV3 or split',records},null,2)+'\n');console.log(records);
