import {test} from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';
import {createSourceSearch} from '../../native-extension/src/ai/source-search.js';
test('source search maps repeated and cross-node text with Range, never changes native nodes',()=>{
 const w=new JSDOM('<article><div data-testid="twitterArticleRichTextView">Hello <b>World</b>. hello world.</div><aside>comment world</aside></article>').window,d=w.document,article=d.querySelector('article'),original=article.innerHTML;
 const search=createSourceSearch({kind:'article',article},d);const matches=search.find('LO wo');assert.equal(matches.length,2);assert.equal(matches[0].range.toString(),'lo World'.slice(0,5));assert.equal(search.find('comment').length,0);assert.equal(article.innerHTML,original);
 article.querySelector('b').textContent='Changed';assert.equal(search.valid(),false);assert.equal(search.find('world').length,0);search.destroy();w.close();
});
test('subtitle search is literal, case-insensitive and only seeks without playing',()=>{
 const w=new JSDOM('<video></video>').window,d=w.document,video=d.querySelector('video');Object.defineProperty(video,'duration',{value:20});video.play=video.pause=()=>assert.fail('must not change playback');
 const s=createSourceSearch({kind:'video',video,cues:[{start:3,text:'Hello [world]'}]},d);assert.equal(s.find('[').length,1);assert.equal(s.find('WORLD').length,1);assert.equal(s.activate(0),true);assert.equal(video.currentTime,3);assert.equal(s.find('none').length,0);s.destroy();w.close();
});
test('new search remaps equivalent native text nodes without reusing stale ranges or accepting changed content',()=>{
 const w=new JSDOM('<article><div data-testid="twitterArticleRichTextView">Hello <b>World</b></div></article>').window,d=w.document,article=d.querySelector('article'),root=article.firstElementChild,s=createSourceSearch({kind:'article',article},d);const first=s.find('world')[0].range;
 root.innerHTML='Hello <span>World</span>';assert.equal(s.activate(0),false);const fresh=s.find('world');assert.equal(fresh.length,1);assert.notEqual(fresh[0].range.startContainer,first.startContainer);assert.equal(fresh[0].range.toString(),'World');
 root.textContent='Different content';assert.equal(s.find('Different').length,0);s.destroy();root.textContent='Hello World';assert.equal(s.find('World').length,0);w.close();
});
test('article search remains valid through player and engagement updates',()=>{
 const w=new JSDOM('<article><div data-testid="twitterArticleRichTextView"><p>Stable source</p><article data-testid="tweet"><div data-testid="tweetText">Embedded text</div><div data-testid="videoPlayer"><span id="clock">1:55</span></div><div role="group" id="counts">20</div></article></div></article>').window,d=w.document,s=createSourceSearch({kind:'article',article:d.querySelector('article')},d);
 try{assert.equal(s.find('Embedded').length,1);d.getElementById('clock').textContent='1:54';d.getElementById('counts').textContent='21';assert.equal(s.valid(),true);assert.equal(s.find('1:54').length,0);assert.equal(s.find('Embedded')[0].range.toString(),'Embedded');}finally{s.destroy();w.close();}
});
