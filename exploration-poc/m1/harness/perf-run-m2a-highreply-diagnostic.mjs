// Focused same-tab highReply diagnostic after the main 24-window gate failed.
// This dataset supplements that failure; it must never replace it.
// Run through ego-browser nodejs stdin. Same-session, alternating M1-R/M2-A,
// trusted SPA clicks, no account writes. Keeps historical evidence intact.
// Preflight: temporarily disable other Peek extensions in chrome://extensions;
// restore their original state after testing. Never run alongside PoC v5.
const ROOT = '/Users/devon/claude/peek-main';
const fs = await import('node:fs/promises');
const { execFileSync } = await import('node:child_process');
const { build } = await import(`${ROOT}/node_modules/esbuild/lib/main.js`);
const base = 'dfb94f74be6fa8968e06ec675245cce3cf0f015a';
const temp = await fs.mkdtemp('/tmp/peek-m1r-paired-');
for (const path of execFileSync('git', ['ls-tree', '-r', '--name-only', base, 'native-extension/src'], {cwd:ROOT,encoding:'utf8'}).trim().split('\n')) {
  const dest = `${temp}/${path}`;
  await fs.mkdir(dest.slice(0,dest.lastIndexOf('/')), {recursive:true});
  await fs.writeFile(dest, execFileSync('git', ['show', `${base}:${path}`], {cwd:ROOT}));
}
const baseline = await build({entryPoints:[`${temp}/native-extension/src/main.js`],bundle:true,format:'iife',platform:'browser',target:'chrome100',write:false});
const current = await fs.readFile(`${ROOT}/dist-extension-native/content.js`, 'utf8');
const css = await fs.readFile(`${ROOT}/dist-extension-native/content.css`, 'utf8');
const brand = await fs.readFile(`${ROOT}/dist-extension-native/vendor/brand/icon.js`, 'utf8');
const { createHash } = await import('node:crypto');
const sourceHash = createHash('sha256').update(current).digest('hex');
const samples = [
  ['short','gefei55','2109450990575611958'],
  ['highReply','XiaoJi0403','2109146979972403349'],
  ['long','z35001116','2107948362414866685'],
  ['video','thinkszyg','2109309251533570509'],
];
// A structural DOM candidate, NOT proof of GraphQL reply ancestry. No
// recommendation headings, unknown modules, ads, or bodyless cells qualify.
function installRecorder() {
  function ownId(cell) {
    const art=cell?.querySelector('article[data-testid="tweet"]');
    const a=art && [...art.querySelectorAll('a[href]')].find(a=>a.querySelector('time')&&!a.closest('div[role="link"]')&&/^\/\w+\/status\/\d+\/?$/.test(a.getAttribute('href')));
    return a?.getAttribute('href').match(/\/status\/(\d+)/)?.[1] || null;
  }
  function focal(id) { return [...document.querySelectorAll('[data-testid="primaryColumn"] [data-testid="cellInnerDiv"]')].find(c=>ownId(c)===id); }
  function reply(id) {
    const f=focal(id);
    if(!f?.querySelector('[data-testid="inline_reply_offscreen"], [data-testid="tweetButtonInline"], [data-testid="tweetTextarea_0"]'))return null;
    let c=f.nextElementSibling;
    while(c?.matches('[data-testid="cellInnerDiv"]')&&!c.textContent.trim()&&c.getBoundingClientRect().height===0&&!c.querySelector('article,[role],[data-testid],a,button,input,img,video,svg,h1,h2,h3')) c=c.nextElementSibling;
    if(!c?.matches('[data-testid="cellInnerDiv"]')||c.querySelector('[role="heading"],h1,h2,h3,[data-testid="placementTracking"],[data-testid="promotedIndicator"]')) return null;
    const cid=ownId(c); if(!cid||cid===id) return null;
    const text=c.querySelector('article [data-testid="tweetText"]');
    return text?.textContent.trim()?{cell:c,text,id:cid}:null;
  }
  let r=null;
  window.__pairedArm=(id)=>{r={id,clickAt:null,t1:null,t2Dom:null,t2Visible:null,escAt:null,closed:null,feed:null,anchorBefore:null,frames:[],frameCount:0,maxFrameGap:0,cf:null,visibility:null};};
  window.__pairedRead=()=>r;
  addEventListener('click',e=>{
    if(!r||r.clickAt!==null)return;
    if(ownId(e.target.closest('[data-testid="cellInnerDiv"]'))!==r.id)return;
    r.clickAt=performance.now();r.anchorBefore=focal(r.id)?.getBoundingClientRect().top??null;
    requestAnimationFrame(tick);
  },true);
  addEventListener('keydown',e=>{if(e.key==='Escape'&&r?.clickAt!==null&&r&&!r.escAt)r.escAt=performance.now();},true);
  function tick(now) {
    if(!r||r.clickAt===null)return;
    const p=document.getElementById('peek-native-pane');
    if(r.t1===null&&p?.dataset.statusId===r.id&&p.querySelector('.peek-native-text')?.textContent.trim()&&!p.querySelector('.peek-native-unknown'))r.t1=now-r.clickAt;
    if(location.pathname.includes('/status/'+r.id)&&p){
      const q=reply(r.id);
      if(q){
        if(r.t2Dom===null)r.t2Dom=now-r.clickAt;
        const rect=q.text.getBoundingClientRect();
        const visible=Math.max(0,Math.min(rect.bottom,innerHeight)-Math.max(rect.top,53));
        if(visible>=Math.min(rect.height,20)&&rect.height>0&&r.t2Visible===null)r.t2Visible=now-r.clickAt;
        r.visibility={replyId:q.id,bodyTop:rect.top,bodyVisiblePx:visible,bodyHeight:rect.height,viewport:innerHeight};
      }
      r.cf=JSON.parse(document.documentElement.getAttribute('data-peek-cf')||'null');
    }
    if(r.escAt!==null){
      if(!p&&r.closed===null)r.closed=now-r.escAt;
      if(!location.pathname.includes('/status/')){
        const c=focal(r.id);
        if(c){
          if(r.feed===null)r.feed=now-r.escAt;
          const f={t:now-r.escAt,top:c.getBoundingClientRect().top,y:scrollY};
          if(r.lastFrameAt)r.maxFrameGap=Math.max(r.maxFrameGap,now-r.lastFrameAt);
          r.lastFrameAt=now;r.frameCount++;
          const prev=r.frames.at(-1);
          if(!prev||prev.top!==f.top||prev.y!==f.y||f.t-prev.t>=100)r.frames.push(f);
        }
      }
      if(now-r.escAt>3200)return;
    }
    if(now-r.clickAt<25000)requestAnimationFrame(tick);
  }
}
const task=await taskSpace(17);
const page=await task.newPage();
const pages={m1r:page,m2a:page};
await page.cdp('Network.enable');
let injectionId=null;
await page.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
await page.cdp('Page.addScriptToEvaluateOnNewDocument',{source:`(${installRecorder.toString()})();`});
await page.cdp('Page.addScriptToEvaluateOnNewDocument',{source:"performance.setResourceTimingBufferSize(2000);addEventListener('click',()=>performance.clearResourceTimings(),{capture:true,once:true});"});
const records=[];
const out=`${ROOT}/docs/m2-a/evidence/highreply-diagnostic.json`;
await fs.writeFile(out,JSON.stringify({base,sourceHash,method:'alternating same-session SPA, rAF, structural DOM reply candidate',records},null,2));
console.log('PAIRED pages',Object.fromEntries(Object.entries(pages).map(([k,p])=>[k,p.label])));
for(let round=1;round<=3;round++)for(const [sample,author,id] of samples.filter(s=>s[0]==='highReply'))for(const kind of round%2?['m1r','m2a']:['m2a','m1r']){
  const page=pages[kind];
  const meta={kind,sample,round};
  try{
    if(injectionId)await page.cdp('Page.removeScriptToEvaluateOnNewDocument',{identifier:injectionId});
    const cssBoot=`(()=>{const inj=()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(css)};(document.head||document.documentElement).append(s)};if(document.documentElement)inj();else document.addEventListener('DOMContentLoaded',inj,{once:true})})();`;
    const code=kind==='m1r'?baseline.outputFiles[0].text:current;
    injectionId=(await page.cdp('Page.addScriptToEvaluateOnNewDocument',{worldName:'peek-paired-native',source:`window.__PEEK_NATIVE_TEST__=true;${brand}\n${cssBoot}\n${code}`})).identifier;
    await page.cdp('Page.bringToFront');await page.goto(`https://x.com/${author}`);
    await page.waitForSelector('[data-testid="primaryColumn"] article',{timeout:15000});
    let coords=null;
    for(let i=0;i<40;i++){
      coords=await page.evaluate(id=>{
        const a=[...document.querySelectorAll(`[data-testid="primaryColumn"] a[href="/${location.pathname.split('/')[1]}/status/${id}"]`)].find(a=>a.querySelector('time')&&!a.closest('div[role="link"]'));
        if(a){const r=a.getBoundingClientRect();if(r.top>80&&r.bottom<innerHeight-80)return{x:r.x+r.width/2,y:r.y+r.height/2};if(r.top<80){scrollBy(0,r.top-150);return null;}}
        scrollBy(0,450);return null;
      },id);
      if(coords)break;await page.waitForTimeout(400);
    }
    if(!coords)throw Error('sample not found in bounded profile search');
    await page.events(); // discard profile navigation traffic before click
    await page.evaluate(id=>{window.__pairedArm(id);window.__pairedRead().timeOrigin=performance.timeOrigin;},id);
    await page.cdp('Input.dispatchMouseEvent',{type:'mouseMoved',...coords});
    await page.cdp('Input.dispatchMouseEvent',{type:'mousePressed',...coords,button:'left',clickCount:1});
    await page.cdp('Input.dispatchMouseEvent',{type:'mouseReleased',...coords,button:'left',clickCount:1});
    await page.waitForFunction(id=>location.pathname.includes('/status/'+id)&&document.getElementById('peek-native-pane')?.dataset.statusId===id,id,{timeout:10000});
    await page.waitForTimeout(6800); // bounded hydration/CF window; no manual scroll before reading visibility
    const owner=await page.evaluate(()=>({count:document.querySelectorAll('#peek-native-pane').length,brand:document.querySelector('.peek-native-brand')?.textContent}));
    if(owner.count!==1 || owner.brand!=='Peek')throw Error('Conflicting or missing reader: '+JSON.stringify(owner));
    const reading=await page.evaluate(()=>{
      const r=window.__pairedRead();
      r.tweetDetailRequests=performance.getEntriesByType('resource').filter(e=>e.name.includes('/TweetDetail')&&e.startTime>=r.clickAt).map(e=>({start:e.startTime-r.clickAt,end:e.responseEnd-r.clickAt,duration:e.duration}));
      return r;
    });
    const events=await page.events();
    const requests=new Map();
    for(const e of events){
      const p=e.params||{};
      if(e.method==='Network.requestWillBeSent' && p.request?.url?.split('?')[0].endsWith('/TweetDetail')){
        requests.set(p.requestId,{operation:'TweetDetail',startFromClick:(p.wallTime-reading.timeOrigin/1000)*1000-reading.clickAt,start:p.timestamp});
      }
      const req=requests.get(p.requestId);
      if(!req)continue;
      if(e.method==='Network.responseReceived'){req.responseFromClick=req.startFromClick+(p.timestamp-req.start)*1000;req.httpStatus=p.response?.status;}
      if(e.method==='Network.loadingFinished')req.finishFromClick=req.startFromClick+(p.timestamp-req.start)*1000;
    }
    // Persist only operation name and timing/status, never request URLs,
    // query values, headers, bodies, IDs, or browser credentials.
    reading.network=[...requests.values()].map(({start,...safe})=>safe);
    await page.cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode:27});
    await page.cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode:27});
    await page.waitForTimeout(3400);
    const rec=await page.evaluate(()=>window.__pairedRead());
    records.push({...meta,readerOwner:owner,...rec,network:reading.network,visibility:reading.visibility,cf:reading.cf,finalDelta:rec.frames.length?rec.frames.at(-1).top-rec.anchorBefore:null});
    console.log(JSON.stringify({...meta,t1:rec.t1,t2Dom:rec.t2Dom,t2Visible:rec.t2Visible,cf:reading.cf,closed:rec.closed,feed:rec.feed,finalDelta:records.at(-1).finalDelta}));
  }catch(e){records.push({...meta,error:String(e.message)});console.log('ERROR',meta,String(e.message));}
  await fs.writeFile(out,JSON.stringify({base,sourceHash,method:'same-tab alternating highReply diagnostic, passive CDP TweetDetail timing only, no request URLs/headers/bodies',records},null,2));
}
await page.close();
console.log('DONE',records.length,out);
