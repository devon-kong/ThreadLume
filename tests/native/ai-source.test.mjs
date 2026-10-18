import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {collectCaptions, readFocalContent, transcriptOf, seekNative} from '../../native-extension/src/ai/content-source.js';
function video(mode='disabled',cues=null){
 const win=new JSDOM('').window, v=new win.EventTarget(), list=new win.EventTarget();
 const track={kind:'subtitles',language:'en',label:'English',mode,cues};
 Object.assign(list,{0:track,length:1});Object.assign(v,{textTracks:list,duration:150,paused:true,currentTime:0,isConnected:true,querySelectorAll:()=>[]});
 return {v,list,track,Event:win.Event};
}
test('字幕：disabled 暂设 hidden，全量 cues 后恢复，绝不 play',async()=>{
 const {v,track,list,Event}=video();
 const p=collectCaptions(v,{timeoutMs:120,settleMs:5});
 assert.equal(track.mode,'hidden');
 track.cues=[{startTime:24.3,endTime:40,text:' A\n B '},{startTime:45,endTime:110.433,text:'last'}];list.dispatchEvent(new Event('change'));
 const r=await p;assert.equal(r.cues.length,2);assert.equal(r.cues[1].end,110.433);assert.equal(track.mode,'disabled');assert.equal(v.paused,true);assert.equal(v.currentTime,0);
 assert.equal(transcriptOf(r.cues),'00:00:24 A B\n00:00:45 last');
});
test('字幕：showing 不改、超时/取消清理，用户 CC 新选择不覆盖',async()=>{
 const a=video('showing',[{startTime:0,endTime:1,text:'visible'}]);await collectCaptions(a.v,{settleMs:1});assert.equal(a.track.mode,'showing');
 const b=video();assert.equal(await collectCaptions(b.v,{timeoutMs:10}),null);assert.equal(b.track.mode,'disabled');
 const c=video(),abort=new AbortController();const p=collectCaptions(c.v,{signal:abort.signal});abort.abort();await assert.rejects(p,{name:'AbortError'});assert.equal(c.track.mode,'disabled');
 const d=video();const q=collectCaptions(d.v,{timeoutMs:15});d.track.mode='showing';d.list.dispatchEvent(new d.Event('change'));await q;assert.equal(d.track.mode,'showing');
});
test('字幕：无轨、空轨均 null；多轨优先用户 showing',async()=>{
 const a=video();a.list.length=0;assert.equal(await collectCaptions(a.v,{timeoutMs:10}),null);
 const b=video('disabled',[]);assert.equal(await collectCaptions(b.v,{timeoutMs:10}),null);
 const c=video('disabled',[{startTime:0,endTime:1,text:'English'}]);c.list[1]={kind:'captions',mode:'showing',language:'zh',cues:[{startTime:0,endTime:1,text:'中文'}]};c.list.length=2;
 const r=await collectCaptions(c.v,{settleMs:1});assert.equal(r.language,'zh');assert.equal(c.track.mode,'disabled');
});
function doc(body){return new JSDOM(`<div data-testid="cellInnerDiv"><article data-testid="tweet"><a href="/a/status/123"><time>now</time></a>${body}</article></div>`,{url:'https://x.com/a/status/123'}).window.document;}
test('归属：短帖/引用 Article 不生成，完整焦点 Article 与长正文可用',async()=>{
 let d=doc('<div data-testid="tweetText">short</div>');assert.equal(await readFocalContent('123',{document:d,timeoutMs:5}),null);
 d=doc('<div role="link"><div data-testid="twitterArticleReadView"><h1 data-testid="twitter-article-title">quoted</h1><div data-testid="twitterArticleRichTextView">quoted body</div></div></div>');assert.equal(await readFocalContent('123',{document:d,timeoutMs:5}),null);
 d=doc('<div data-testid="twitterArticleReadView"><h1 data-testid="twitter-article-title">title</h1><div data-testid="twitterArticleRichTextView">complete body</div></div>');
 const r=await readFocalContent('123',{document:d,timeoutMs:20,settleMs:1});assert.equal(r.kind,'article');assert.equal(r.text,'title\n\ncomplete body');
 d=doc(`<div data-testid="tweetText">${'长'.repeat(1000)}</div>`);assert.equal((await readFocalContent('123',{document:d,settleMs:1})).kind,'article');
 d=doc(`<div data-testid="tweetText">${'长'.repeat(1000)}</div><button data-testid="tweet-text-show-more-link">Show more</button>`);assert.equal(await readFocalContent('123',{document:d,timeoutMs:5}),null);
});
test('切帖拒绝旧焦点、seek 保留暂停且限制有效时点',async()=>{
 const d=doc('<div data-testid="tweetText">short</div>');assert.equal(await readFocalContent('999',{document:d,timeoutMs:5}),null);
 const {v}=video();assert.equal(seekNative(v,50000),true);assert.equal(v.currentTime,50);assert.equal(v.paused,true);assert.equal(seekNative(v,200000),false);
});
test('用户 CC 显示再隐藏：即使结束仍hidden，不能恢复覆盖新选择',async()=>{
 const d=video();const p=collectCaptions(d.v,{timeoutMs:15});d.list.dispatchEvent(new d.Event('change'));d.track.mode='showing';d.list.dispatchEvent(new d.Event('change'));d.track.mode='hidden';d.list.dispatchEvent(new d.Event('change'));await p;assert.equal(d.track.mode,'hidden');
});

test('字幕：排队/其他轨change不冒充用户改变选中轨，仍恢复disabled',async()=>{
 const d=video('disabled',[{startTime:0,endTime:1,text:'native caption'}]);
 const other={kind:'captions',language:'fr',mode:'disabled',cues:[]};d.list[1]=other;d.list.length=2;
 const pending=collectCaptions(d.v,{timeoutMs:100,settleMs:5});
 // A queued notification and another track's mode change can arrive while
 // the selected track still has our temporary hidden mode.
 d.list.dispatchEvent(new d.Event('change'));
 other.mode='showing';d.list.dispatchEvent(new d.Event('change'));
 const result=await pending;
 assert.equal(result.cues[0].text,'native caption');
 assert.equal(d.track.mode,'disabled');assert.equal(other.mode,'showing');
 assert.equal(d.v.paused,true);assert.equal(d.v.currentTime,0);
});

test('字幕：取消后重入不被旧读取排队的mode通知阻止恢复',async()=>{
 const d=video('disabled',[{startTime:0,endTime:1,text:'native caption'}]);
 let mode='disabled';
 Object.defineProperty(d.track,'mode',{get:()=>mode,set:value=>{
   if(value===mode)return;mode=value;
   setTimeout(()=>d.list.dispatchEvent(new d.Event('change')),0);
 }});
 const abort=new AbortController();
 const first=collectCaptions(d.v,{signal:abort.signal,settleMs:15});
 abort.abort();
 const second=collectCaptions(d.v,{settleMs:15});
 await assert.rejects(first,{name:'AbortError'});
 assert.equal((await second).cues.length,1);
 assert.equal(d.track.mode,'disabled');
 assert.equal(d.v.paused,true);assert.equal(d.v.currentTime,0);
});

test('字幕：暂停的非活跃区间异步填入cues无cuechange也可取得',async()=>{
 const d=video();
 const pending=collectCaptions(d.v,{timeoutMs:350,settleMs:5});
 // TextTrack cues are not observable mutations; adding cues outside the
 // current active range need not produce cuechange or a track-element load.
 setTimeout(()=>{d.track.cues=[{startTime:24.3,endTime:110.433,text:'all native cues'}];},15);
 const result=await pending;
 assert.equal(result?.cues.length,1);assert.equal(d.track.mode,'disabled');
 assert.equal(d.v.paused,true);assert.equal(d.v.currentTime,0);
});

test('字幕：用户原生CC点击即使仍为hidden也释放临时模式所有权',async()=>{
 for(const [target,expected] of [['captions','hidden'],['play','disabled']]){
  const d=video('disabled',[{startTime:0,endTime:1,text:'native captions'}]);
  const controls=new JSDOM('<div data-testid="videoPlayer"><button data-testid="captions">CC</button><button data-testid="play">Play</button></div>').window.document;
  d.v.closest=()=>controls.querySelector('[data-testid="videoPlayer"]');
  const pending=collectCaptions(d.v,{timeoutMs:100,settleMs:15});
  controls.querySelector('[data-testid="'+target+'"]').click();
  await pending;assert.equal(d.track.mode,expected);
  assert.equal(d.v.paused,true);assert.equal(d.v.currentTime,0);
 }
});
