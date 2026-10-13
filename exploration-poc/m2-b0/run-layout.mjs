// Run: ego-browser nodejs < exploration-poc/m2-b0/run-layout.mjs
// Uses the single task space established in this investigation.
const root='/Users/devon/.codex/worktrees/peek-native-m2b0-left-carrier/peek-main';
const fs=await import('node:fs/promises');
const {installCarrier,inspectLayout}=await import(`${root}/exploration-poc/m2-b0/probe.mjs`);
const t=await taskSpace(19),p=t.page('p1');
const out=`${root}/docs/m2-b0/evidence`;
const records=[];
for(const [width,height,innerScroll] of [[1440,900,true],[1280,800,false],[1000,800,false]]){
 await p.cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
 await p.goto('https://x.com/thinkszyg/status/2109309251533570509');
 await p.waitForSelector('[data-testid="tweetTextarea_0"]',{timeout:20000});await p.waitForSelector('video',{timeout:10000});
 const native=await p.evaluate(inspectLayout);
 const initial=await p.evaluate(installCarrier,{mode:'a',innerScroll});
 await p.evaluate(()=>{scrollTo(0,0);window.__m2b0.article.scrollTop=200;});
 const states=[];for(const y of [0,800,1600,2800,4200,5800]){
  await p.evaluate(({y,innerScroll})=>{if(innerScroll)window.__m2b0.section.scrollTop=y;else scrollTo(0,y);},{y,innerScroll});
  await p.waitForTimeout(700);const s=await p.evaluate(()=>window.__m2b0.state());states.push({target:y,...s});if(!s.active)break;
 }
 const beforeUndo=await p.evaluate(()=>({state:window.__m2b0.state(),listHeight:window.__m2b0.section.querySelector('[data-testid="cellInnerDiv"]')?.parentElement.getBoundingClientRect().height}));
 await p.evaluate(()=>window.__m2b0.undo());
 const cleanup=await p.evaluate(()=>({styles:document.querySelectorAll('#m2b0-style').length,markers:document.querySelectorAll('[data-m2b0-root],[data-m2b0-focal],[data-m2b0-cell],[data-m2b0-section],[data-m2b0-media]').length,state:window.__m2b0.state()}));
 records.push({width,height,innerScroll,native,initial,states,beforeUndo,cleanup});
 await fs.writeFile(`${out}/a-layout-matrix.json`,JSON.stringify(records,null,2));
 console.log({width,innerScroll,states:states.map(s=>({y:s.windowScroll,section:s.sectionScroll,connected:s.connected,visible:s.visibleArticles,cells:s.liveCells,reason:s.reason}))});
}
