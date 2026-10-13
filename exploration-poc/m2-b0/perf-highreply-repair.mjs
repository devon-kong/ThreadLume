// Fixed 3 alternating pairs; same visible tab; no request interception/CDP Network.
// ResourceTiming is sanitized in-page. No URL/header/body serialization.
const root='/Users/devon/.codex/worktrees/peek-native-m2b0-left-carrier/peek-main';
const fs=await import('node:fs/promises'),cp=await import('node:child_process');
const {build}=await import(`${root}/node_modules/esbuild/lib/main.js`);
const {installCarrier}=await import(`${root}/exploration-poc/m2-b0/probe.mjs`);
const temp=await fs.mkdtemp('/tmp/peek-m2b0-');
const ref='1e6cc72c3cf39925276c9fe055c7b40b640bddfd';
for(const path of cp.execFileSync('git',['ls-tree','-r','--name-only',ref,'native-extension/src'],{cwd:root,encoding:'utf8'}).trim().split('\n')){const dest=`${temp}/${path}`;await fs.mkdir(dest.slice(0,dest.lastIndexOf('/')),{recursive:true});await fs.writeFile(dest,cp.execFileSync('git',['show',`${ref}:${path}`],{cwd:root}));}
const m2a=(await build({entryPoints:[`${temp}/native-extension/src/main.js`],bundle:true,format:'iife',write:false})).outputFiles[0].text;
const m1r=await fs.readFile(`${root}/dist-extension-native/content.js`,'utf8'),css=await fs.readFile(`${root}/dist-extension-native/content.css`,'utf8');
function recorder({kind,probeSource}){
 const id='2109146979972403349';let r=null,raf=0,obs=null;
 const focal=()=>[...document.querySelectorAll('[data-testid="primaryColumn"] article')].find(a=>[...a.querySelectorAll('a:has(time)')].some(l=>l.pathname.endsWith('/status/'+id)));
 const visible=(e,right=false)=>{if(!e)return false;const b=e.getBoundingClientRect();return b.height>0&&Math.min(b.bottom,innerHeight)-Math.max(b.top,54)>=Math.min(20,b.height)&&b.right>0&&b.left<innerWidth&&(!right||b.x>=innerWidth*.5);};
 window.__perfArm=()=>{r={kind,armedAt:performance.now(),start:null,t1:null,t2aCandidate:null,t2bCandidate:null,t3:null,closeAt:null,t4:null,replyId:null,longTasks:[],resources:[],maxFrameGap:0,probeFailure:null};performance.clearResourceTimings();performance.setResourceTimingBufferSize(2000);};
 window.__perfRead=()=>{if(!r)return null;return {...r,resources:performance.getEntriesByType('resource').filter(e=>e.startTime>=r.armedAt).map(e=>{let u;try{u=new URL(e.name)}catch{return null}let category='other',operation=null;if(u.hostname==='x.com'&&u.pathname.includes('/graphql/')){category='native-graphql';operation=u.pathname.split('/').at(-1);}else if(u.hostname==='x.com'&&u.pathname.startsWith('/i/api/'))category='native-rest';else if(/video\.twimg\.com$/.test(u.hostname))category='media';else if(/pbs\.twimg\.com$/.test(u.hostname))category='image';return{category,operation,start:e.startTime-r.start,responseStart:e.responseStart-r.start,end:e.responseEnd-r.start,duration:e.duration};}).filter(Boolean),paneCount:document.querySelectorAll('#peek-native-pane').length,videoInstances:document.querySelectorAll('video').length,probeFailure:window.__m2b0?.state().reason||null};};
 window.__perfClose=()=>{r.closeAt=performance.now();};window.__perfStop=()=>{cancelAnimationFrame(raf);obs?.disconnect();};
 addEventListener('click',e=>{if(!r||r.start!==null||!e.target.closest(`a[href$="/status/${id}"]`))return;r.start=performance.now();obs=new PerformanceObserver(entries=>{for(const x of entries.getEntries())r.longTasks.push({start:x.startTime-r.start,duration:x.duration});});obs.observe({type:'longtask'});raf=requestAnimationFrame(tick);},true);
 let last=null;
 function tick(now){if(!r?.start)return;if(last)r.maxFrameGap=Math.max(r.maxFrameGap,now-last);last=now;
 const a=focal(),cell=a?.closest('[data-testid="cellInnerDiv"]'),detail=cell?.querySelector('[data-testid="tweetTextarea_0"],[data-testid="inline_reply_offscreen"]')&&location.pathname.includes('/status/'+id);
 if(kind==='m2b0'&&detail&&!window.__m2b0){try{(0,eval)(`(${probeSource})({mode:'a'})`);}catch{r.probeFailure='install-error';}}
 const text=(kind==='m1r'||kind==='m2a')?document.querySelector('#peek-native-pane .peek-native-text'):detail?a?.querySelector('[data-testid="tweetText"]'):null;
 if(r.t1===null&&visible(text))r.t1=now-r.start;
 if(detail){if(r.t3===null&&visible(a?.querySelector('[data-testid="like"]')))r.t3=now-r.start;
 // Conservative adjacent article is still only a structural candidate, not a
 // proven reply ancestry. Never call this confirmed T2 without separate evidence.
 let next=cell.nextElementSibling;while(next?.matches('[data-testid="cellInnerDiv"]')&&!next.textContent.trim()&&next.getBoundingClientRect().height===0&&!next.querySelector('article,[role],[data-testid],a,button,img,video'))next=next.nextElementSibling;const reply=next?.querySelector('article'),body=reply?.querySelector('[data-testid="tweetText"]');
 if(body&&!next.querySelector('[role="heading"],[data-testid="promotedIndicator"]')){r.replyId=reply.querySelector('a:has(time)')?.pathname.match(/status\/(\d+)/)?.[1]||null;if(r.t2aCandidate===null)r.t2aCandidate=now-r.start;if(r.t2bCandidate===null&&visible(body,kind!=='native'))r.t2bCandidate=now-r.start;}}
 if(r.closeAt!==null&&!location.pathname.includes('/status/')&&a&&visible(a)){if(r.t4===null)r.t4=now-r.closeAt;}
 if(now-r.start<22000)raf=requestAnimationFrame(tick);
 }
}
const t=await taskSpace(19),p=t.page('p1');await p.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
const records=[],scripts=[];
const schedule=[['m1r','m2a'],['m2a','m1r'],['m1r','m2a']];
for(let round=1;round<=3;round++)for(const kind of schedule[round-1]){
 try{
 for(const identifier of scripts.splice(0))await p.cdp('Page.removeScriptToEvaluateOnNewDocument',{identifier});
 scripts.push((await p.cdp('Page.addScriptToEvaluateOnNewDocument',{source:`(${recorder})(${JSON.stringify({kind,probeSource:installCarrier.toString()})})`})).identifier);
 if(kind==='m1r'||kind==='m2a')scripts.push((await p.cdp('Page.addScriptToEvaluateOnNewDocument',{worldName:'m2b0-perf',source:`(()=>{const add=()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(css)};(document.head||document.documentElement).append(s)};if(document.documentElement)add();else document.addEventListener('DOMContentLoaded',add,{once:true})})();${kind==='m1r'?m1r:m2a}`})).identifier);
 await p.goto('https://x.com/XiaoJi0403');await p.waitForSelector('[data-testid="primaryColumn"] article',{timeout:15000});
 let coords=null;for(let i=0;i<30;i++){coords=await p.evaluate(()=>{const a=[...document.querySelectorAll('a[href="/XiaoJi0403/status/2109146979972403349"]')].find(a=>a.querySelector('time'));if(a){const r=a.getBoundingClientRect();if(r.top>80&&r.bottom<innerHeight-80)return{x:r.x+r.width/2,y:r.y+r.height/2};scrollBy(0,r.top-150);}else scrollBy(0,500);return null;});if(coords)break;await p.waitForTimeout(300);}
 if(!coords)throw Error('Fixed sample unavailable in 30 profile scroll steps');
 await p.evaluate(()=>window.__perfArm());await p.click('a[href="/XiaoJi0403/status/2109146979972403349"]:has(time)');await p.waitForFunction(()=>location.pathname.includes('/status/2109146979972403349'),undefined,{timeout:10000});await p.waitForTimeout(4500);
 const reading=await p.evaluate(()=>window.__perfRead());await p.evaluate(()=>window.__perfClose());
 if(kind==='m1r'||kind==='m2a')await p.keyboard.press('Escape');else await p.click('button[aria-label="返回"]');
 await p.waitForTimeout(1800);const closed=await p.evaluate(()=>window.__perfRead());await p.evaluate(()=>window.__perfStop());records.push({round,kind,...reading,t4:closed.t4});
 console.log({round,kind,t1:reading.t1,t2:reading.t2aCandidate,t2b:reading.t2bCandidate,t4:closed.t4});
 }catch(e){records.push({round,kind,error:'Navigation or observation failed; excluded'});console.log({round,kind,error:'Navigation or observation failed; excluded'});}
 await fs.writeFile(`${root}/docs/m2-b0/evidence/highreply-instrument-repair.json`,JSON.stringify({method:'same tab SPA rAF; fixed 6 diagnostic windows after empty-cell instrumentation repair; original 12 retained; passive ResourceTiming; T2 structural candidate only; non-M1/A close via X back button',records},null,2));
}
for(const identifier of scripts)await p.cdp('Page.removeScriptToEvaluateOnNewDocument',{identifier});await p.goto('https://x.com/XiaoJi0403/status/2109146979972403349');await fs.rm(temp,{recursive:true,force:true});
