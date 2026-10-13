// Bounded two-document experiment, NOT simultaneous Split View acceptance.
const root='/Users/devon/.codex/worktrees/peek-native-m2b0-left-carrier/peek-main';const fs=await import('node:fs/promises');const {observePairPage,resourceSummary}=await import(`${root}/exploration-poc/m2-c/observe.mjs`);const t=await taskSpace(20),left=t.page('p1'),right=t.page('p2');
const timeline=()=>{const rows=[];const t0=performance.now();let timer;const sample=()=>{if(rows.length>=40){clearInterval(timer);return;}const s=window.__m2c.sample();rows.push({dt:performance.now()-t0,visibility:s.visibility,y:s.y,connected:s.focalConnected,video:s.video});};sample();timer=setInterval(sample,500);window.__m2c.timeline=rows;window.__m2c.stop=()=>clearInterval(timer);};
const records=[];
for(const [sample,url] of [['video','https://x.com/thinkszyg/status/2109309251533570509'],['article','https://x.com/wlzh/status/2109433207318081885']]){
 try{
 for(const page of [left,right]){await page.goto(url);await page.waitForSelector('[data-testid="tweetTextarea_0"]',{timeout:15000});if(sample==='video')await page.waitForSelector('video',{timeout:10000});}
 const l0=await left.evaluate(observePairPage),r0=await right.evaluate(observePairPage);
 if(sample==='video')await left.evaluate(()=>{window.__m2c.video.scrollIntoView({block:'center'});});
 await left.evaluate(timeline);
 const stages=[];
 // Right starts just below its own native focal article, preserving composer.
 const positioned=await right.evaluate(()=>{const a=window.__m2c.focal;scrollBy(0,a.getBoundingClientRect().bottom-54);return window.__m2c.sample();});
 for(const y of [800,1600,2800,4200,5800,8000]){await right.evaluate(y=>scrollTo(0,y),y);await right.waitForTimeout(800);stages.push({requested:y,...await right.evaluate(()=>window.__m2c.sample())});}
 // Reading the left Page may activate it; timeline was collected independently
 // while right was operated. Never use final visibility as simultaneous proof.
 const lEnd=await left.evaluate(()=>{window.__m2c.stop();return{state:window.__m2c.sample(),timeline:window.__m2c.timeline};});
 const resourceLeft=await left.evaluate(resourceSummary),resourceRight=await right.evaluate(resourceSummary);
 records.push({sample,l0,r0,positioned,stages,lEnd,resourceLeft,resourceRight});
 }catch{records.push({sample,error:'Navigation or DOM observation failed; no raw URL/title retained'});}
 await fs.writeFile(`${root}/docs/m2-c/evidence/document-isolation.json`,JSON.stringify(records,null,2));console.log(records.map(r=>({sample:r.sample,error:r.error,leftConnected:r.lEnd?.state.focalConnected,leftSame:r.lEnd?.state.sameFocal,rightLast:r.stages?.at(-1),visibility:r.lEnd?.timeline.map(x=>x.visibility)})));
}
