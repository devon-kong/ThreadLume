const root='/Users/devon/.codex/worktrees/peek-native-m2b0-left-carrier/peek-main';const fs=await import('node:fs/promises');const {installCarrier,inspectLayout}=await import(`${root}/exploration-poc/m2-b0/probe.mjs`);const t=await taskSpace(19),p=t.page('p1');const records=[];
for(const [sample,author,id] of [['short','gefei55','2109450990575611958'],['photo','KinGao476942','2109792240776421482'],['article','wlzh','2109433207318081885'],['highReply','XiaoJi0403','2109146979972403349'],['long','z35001116','2107948362414866685']]){
 try{
 await p.goto(`https://x.com/${author}/status/${id}`);await p.waitForSelector('[data-testid="tweetTextarea_0"]',{timeout:20000});
 const native=await p.evaluate(inspectLayout);const initial=await p.evaluate(installCarrier,{mode:'a'});await p.waitForTimeout(400);
 const left=await p.evaluate(()=>{window.__m2b0.article.scrollTop=400;return window.__m2b0.state();});
 await p.evaluate(()=>window.__m2b0.article.scrollTop=0);
 records.push({sample,native,initial,left,after:await p.evaluate(()=>window.__m2b0.state())});
 }catch(e){records.push({sample,error:'Sample navigation or hydration failed; excluded'});}
 await fs.writeFile(`${root}/docs/m2-b0/evidence/content-matrix.json`,JSON.stringify(records,null,2));console.log({sample,content:records.at(-1).native?.content,error:records.at(-1).error});
}
