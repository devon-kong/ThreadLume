const root='/Users/devon/.codex/worktrees/peek-native-m2b0-left-carrier/peek-main';const fs=await import('node:fs/promises');const {installCarrier}=await import(`${root}/exploration-poc/m2-b0/probe.mjs`);const t=await taskSpace(19),p=t.page('p1');
await p.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});await p.goto('https://x.com/thinkszyg/status/2109309251533570509');await p.waitForSelector('[data-testid="tweetTextarea_0"]',{timeout:20000});await p.waitForSelector('video',{timeout:10000});
// Exact M1-R built content, isolated world. Probe touches DOM only.
const ctx=(await p.cdp('Page.createIsolatedWorld',{frameId:(await p.cdp('Page.getFrameTree')).frameTree.frame.id,worldName:'m2b0-baseline'})).executionContextId;
const css=await fs.readFile(`${root}/dist-extension-native/content.css`,'utf8'),code=await fs.readFile(`${root}/dist-extension-native/content.js`,'utf8');
await p.cdp('Runtime.evaluate',{contextId:ctx,expression:`(()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.append(s)})();${code}`});await p.waitForSelector('#peek-native-pane');
const states=[{step:'install',...await p.evaluate(installCarrier,{mode:'b'})}];
for(const y of [0,800,1600,2800,4200,5800]){await p.evaluate(y=>scrollTo(0,y),y);await p.waitForTimeout(700);const s=await p.evaluate(()=>window.__m2b0.state());states.push({target:y,...s});if(!s.active)break;}
await fs.writeFile(`${root}/docs/m2-b0/evidence/b-media-deep.json`,JSON.stringify(states,null,2));console.log(states.map(s=>({y:s.windowScroll,connected:s.connected,video:s.videoConnected,same:s.sameVideo,reason:s.reason})));
await p.reload();
