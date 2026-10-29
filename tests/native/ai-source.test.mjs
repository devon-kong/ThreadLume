import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {collectCaptions, inspectFocal, readFocalContent, transcriptOf, seekNative} from '../../native-extension/src/ai/content-source.js';
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

test('完整 Article 内嵌无字幕视频仍读取文章，不读取视频字幕',async()=>{
 const d=doc('<h1 data-testid="twitter-article-title">文章标题</h1><div data-testid="twitterArticleRichTextView">文章正文<video></video><div data-testid="tweetText">嵌入帖文字</div><video></video></div>');
 try{
  for(const v of d.querySelectorAll('video'))Object.defineProperty(v,'textTracks',{get(){throw new Error('Article must not read embedded captions');}});
  const result=await readFocalContent('123',{document:d,settleMs:1,timeoutMs:5});
  assert.equal(result?.kind,'article');assert.equal(result.title,'文章标题');assert.equal(result.text,'文章标题\n\n文章正文\n嵌入帖文字');assert.equal(result.video,undefined);
 }finally{d.defaultView.close();}
});
test('Article 未加载完整时不把内部视频或嵌入长帖提升为主内容',()=>{
 for(const html of ['<h1 data-testid="twitter-article-title">标题</h1><video></video>','<div data-testid="twitterArticleRichTextView"><video></video><div data-testid="tweetText">'+ '内'.repeat(1000)+'</div></div>']){
  const d=doc(html);try{assert.equal(inspectFocal(d,'123'),null);}finally{d.defaultView.close();}
 }
});
test('普通视频帖仍走字幕，引用 Article 不覆盖原帖视频类型',()=>{
 const d=doc('<div data-testid="tweetText">视频帖</div><video></video><div role="link"><h1 data-testid="twitter-article-title">引用标题</h1><div data-testid="twitterArticleRichTextView">引用正文</div></div>');
 try{const result=inspectFocal(d,'123');assert.equal(result.kind,'video');assert.equal(result.video,d.querySelector('video'));}finally{d.defaultView.close();}
});
test('Article body ignores video controls and embedded engagement while retaining source edits',()=>{
 const d=doc('<h1 data-testid="twitter-article-title">Title</h1><div data-testid="twitterArticleRichTextView"><p>First paragraph</p><article data-testid="tweet"><div data-testid="tweetText">Embedded source</div><div data-testid="videoPlayer"><video></video><span id="time">1:55</span></div><div role="group"><span id="count">20</span></div></article><p id="prose">Last paragraph</p></div>');
 try{const before=inspectFocal(d,'123');assert.equal(before.body,'First paragraph\nEmbedded source\nLast paragraph');d.getElementById('time').textContent='1:54';d.getElementById('count').textContent='21';assert.equal(inspectFocal(d,'123').text,before.text);d.getElementById('prose').textContent='Edited paragraph';assert.notEqual(inspectFocal(d,'123').text,before.text);}finally{d.defaultView.close();}
});
test('hidden Article descendants do not enter content or invalidate its identity',()=>{
 const d=doc('<h1 data-testid="twitter-article-title">Title</h1><div data-testid="twitterArticleRichTextView"><p>Visible source</p><span hidden id="hidden">Private duplicate</span></div>');try{const before=inspectFocal(d,'123');assert.equal(before.body,'Visible source');d.getElementById('hidden').textContent='Changed duplicate';assert.equal(inspectFocal(d,'123').text,before.text);}finally{d.defaultView.close();}
});

test('native cue markup is removed before length validation without changing cue timing or player state',async()=>{
 const {buildChatRequest}=await import('../../native-extension/src/ai/custom-provider.js');
 const document=new JSDOM('').window.document;
 const cues=Array.from({length:600},(_,i)=>({startTime:i/5,endTime:(i+1)/5,text:`<X-word-ms ms=${'100,'.repeat(35)} index=${i+1} character_ranges=0-4,5-10>word ${i}</X-word-ms>`,getCueAsHTML(){const fragment=document.createDocumentFragment();fragment.textContent=`word ${i}`;return fragment;}}));
 const f=video('showing',cues),result=await collectCaptions(f.v,{settleMs:1});
 assert.equal(result.cues.length,600);assert.deepEqual(result.cues[0],{start:0,end:.2,text:'word 0'});assert.deepEqual(result.cues.at(-1),{start:119.8,end:120,text:'word 599'});
 assert.match(cues[0].text,/X-word-ms/);assert.equal(f.v.paused,true);assert.equal(f.v.currentTime,0);
 const input={kind:'video',title:'Title',url:'https://x.com/a/status/123',focusId:'123',duration:150,cues:result.cues,text:transcriptOf(result.cues)};
 const cfg={name:'Test',protocol:'chat-completions',baseURL:'https://example.test/v1',model:'test'};
 for(const mode of ['summary','mindmap']){const body=buildChatRequest(cfg,input,mode,'en');assert.doesNotMatch(body.messages[1].content,/X-word-ms|character_ranges/);assert.equal(JSON.parse(body.messages[1].content).cues.length,600);}
});
test('cue native fragments preserve readable entities, newlines and Chinese; empty text is filtered',async()=>{
 const d=new JSDOM('').window.document,fragment=text=>{const f=d.createDocumentFragment();f.textContent=text;return f;};
 const f=video('showing',[{startTime:0,endTime:2,text:'<b>中文 &amp; text</b>\nsecond',getCueAsHTML:()=>fragment('中文 & text\nsecond')},{startTime:2,endTime:3,text:'<c.empty></c>',getCueAsHTML:()=>fragment('')}]);
 const result=await collectCaptions(f.v,{settleMs:1});assert.equal(result.cues.length,1);assert.equal(result.cues[0].text,'中文 & text\nsecond');assert.equal(transcriptOf(result.cues),'00:00:00 中文 & text second');
});
test('cue fallback uses a temporary native VTTCue, or preserves text if parsing is unavailable',async()=>{
 const previous=globalThis.VTTCue;let constructed=0;
 try{
  globalThis.VTTCue=class{constructor(start,end,text){assert.equal(start,0);assert.equal(end,2);assert.equal(text,'<b>safe</b>');constructed++;}getCueAsHTML(){return {textContent:'safe'};}};
  const f=video('showing',[{startTime:0,endTime:2,text:'<b>safe</b>',getCueAsHTML(){throw Error('unavailable')}}]);assert.equal((await collectCaptions(f.v,{settleMs:1})).cues[0].text,'safe');assert.ok(constructed>0);
  globalThis.VTTCue=undefined;const raw='literal <value> & text';const g=video('showing',[{startTime:0,endTime:1,text:raw}]);assert.equal((await collectCaptions(g.v,{settleMs:1})).cues[0].text,raw);
 }finally{if(previous===undefined)delete globalThis.VTTCue;else globalThis.VTTCue=previous;}
});

test('named source track wins over anonymous rolling display without changing user modes',async()=>{
 const d=video('hidden',[{startTime:0,endTime:1,text:'Start'},{startTime:140,endTime:149,text:'End'}]);
 const rolling={kind:'captions',language:'',mode:'showing',cues:[{startTime:0,endTime:1,text:'Start'}]};d.list[1]=rolling;d.list.length=2;
 const result=await collectCaptions(d.v,{settleMs:1});assert.equal(result.cues.length,2);assert.equal(result.completion,'available-cues-snapshot');assert.equal(rolling.mode,'showing');assert.equal(d.track.mode,'hidden');
});

test('disabled named track loads before anonymous rolling display can be selected',async()=>{
 const d=video('disabled',null),rolling={kind:'captions',language:'',mode:'showing',cues:[{startTime:0,endTime:1,text:'Current line'}]};d.list[1]=rolling;d.list.length=2;
 let mode='disabled';Object.defineProperty(d.track,'mode',{get:()=>mode,set:value=>{mode=value;if(value==='hidden')setTimeout(()=>{d.track.cues=[{startTime:0,endTime:1,text:'Start'},{startTime:140,endTime:149,text:'End'}];d.list.dispatchEvent(new d.Event('change'));},1);}});
 const result=await collectCaptions(d.v,{timeoutMs:100,settleMs:5});assert.equal(result.cues.length,2);assert.equal(result.language,'en');assert.equal(d.track.mode,'disabled');assert.equal(rolling.mode,'showing');
});
