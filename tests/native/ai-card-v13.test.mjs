import {readFileSync} from 'node:fs';
import {test} from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';import {createCard} from '../../native-extension/src/ai/card.js';import {DEFAULTS as PRODUCT_DEFAULTS} from '../../native-extension/src/ai/preferences.js';
// Existing Chinese fixtures remain explicit; ThreadLume defaults are tested separately.
const DEFAULTS={...PRODUCT_DEFAULTS,uiLanguage:'zh-CN',outputLanguage:'zh-CN'};

test('article toolbar exposes source search, language and on-demand mindmap without altering surrounding native cards',()=>{
 const w=new JSDOM('<article><div data-testid="twitterArticleRichTextView">Native <b>source</b></div></article><aside id="comments">original</aside>',{pretendToBeVisual:true}).window,d=w.document,article=d.querySelector('article'),native=article.innerHTML;let languages=[],selections=[];
 const c=createCard({document:d,input:{kind:'article',article,title:'Title'},preferences:DEFAULTS,onLanguage:l=>languages.push(l),onSelect:m=>selections.push(m)});d.body.append(c.root);
 assert.ok(d.getElementById('pk-ai-search'));d.getElementById('pk-ai-search').click();const input=d.getElementById('pk-ai-search-input');input.value='source';input.dispatchEvent(new w.Event('input'));assert.match(d.querySelector('.pk-ai-search-results').textContent,/Native source/);
 d.getElementById('pk-ai-language').click();d.getElementById('pk-ai-language-en').click();assert.deepEqual(languages,['en']);d.getElementById('pk-ai-tab-mindmap').click();assert.deepEqual(selections,['mindmap']);assert.equal(article.innerHTML,native);assert.equal(d.getElementById('comments').textContent,'original');c.destroy();w.close();
});
test('progress and final result retain expanded chapter identity and focused control',()=>{
 const w=new JSDOM('<body></body>',{pretendToBeVisual:true}).window,d=w.document,c=createCard({document:d,input:{kind:'video'},preferences:DEFAULTS});d.body.append(c.root);c.set('summary','queued');
 const preview={version:1,outputLanguage:'zh-CN',text:'Overview',tree:[],highlights:[{timestamp:0,chapter:'One',bullet_points:[]}]};c.progress('summary',preview.text,preview);c.flushProgress?.();const chapter=d.querySelector('.pk-ai-chapter');assert.ok(chapter);chapter.open=true;const control=chapter.querySelector('button');control.focus();c.set('summary','success',preview);assert.equal(d.querySelector('.pk-ai-chapter'),chapter);assert.equal(chapter.open,true);assert.equal(d.activeElement,control);c.destroy();w.close();
});
test('render timing reports actual content render only and identifies its mode',()=>{
 const w=new JSDOM('<body></body>').window,d=w.document,timings=[],c=createCard({document:d,input:{kind:'article'},preferences:DEFAULTS,onRender:(ms,mode)=>timings.push({ms,mode})});d.body.append(c.root);c.set('article','queued');c.flushProgress();assert.equal(timings.length,0);c.set('article','success',{text:'Final',highlights:[]});assert.equal(timings.length,1);assert.equal(timings[0].mode,'article');assert.equal(typeof timings[0].ms,'number');c.destroy();w.close();
});
test('switching cached views announces the selected result rather than the last completed task',()=>{
 const w=new JSDOM('<body></body>').window,d=w.document,c=createCard({document:d,input:{kind:'article'},preferences:DEFAULTS});d.body.append(c.root);
 c.set('article','success',{text:'Summary',highlights:[]});c.set('mindmap','success',{text:'Overview',tree:[{text:'Root',children:[]}]});
 d.getElementById('pk-ai-tab-mindmap').click();assert.equal(d.querySelector('.pk-ai-toolbar [role="status"]').textContent,'已完成');
 d.getElementById('pk-ai-tab-article').click();assert.equal(d.querySelector('.pk-ai-toolbar [role="status"]').textContent,'已完成');
 c.set('mindmap','error','CUSTOM_TIMEOUT');assert.equal(d.querySelector('.pk-ai-toolbar [role="status"]').textContent,'已完成');c.destroy();w.close();
});
test('invalid generated output stays failed and offers an explicit local retry without automatic resend',()=>{
 const w=new JSDOM('<body></body>').window,d=w.document,calls=[],c=createCard({document:d,input:{kind:'article'},preferences:DEFAULTS,onRetry:mode=>calls.push(mode)});d.body.append(c.root);c.set('mindmap','error','CUSTOM_INVALID_RESPONSE');d.getElementById('pk-ai-tab-mindmap').click();assert.equal(calls.length,0);const retry=[...d.querySelectorAll('#pk-ai-view-mindmap button')].find(n=>n.textContent==='重试脑图');assert.ok(retry);assert.equal(retry.parentElement.className,'pk-ai-error');retry.click();assert.deepEqual(calls,['mindmap']);c.destroy();w.close();
});
test('mindmap failure places recovery before the preview and makes its body scrollable',()=>{
 const w=new JSDOM('<head><style>'+readFileSync('native-extension/ai.css','utf8')+'</style></head><body></body>',{pretendToBeVisual:true}).window,d=w.document,c=createCard({document:d,input:{kind:'article'},preferences:DEFAULTS});d.body.append(c.root);d.getElementById('pk-ai-tab-mindmap').click();c.set('mindmap','loading');c.progress('mindmap','Overview',{version:1,outputLanguage:'zh-CN',text:'Overview',tree:[{id:'0',text:'Partial',children:[]}],highlights:[]});c.flushProgress();c.set('mindmap','error','CUSTOM_INVALID_RESPONSE');const panel=d.getElementById('pk-ai-view-mindmap'),error=panel.querySelector('.pk-ai-error'),map=panel.querySelector('.pk-ai-map');assert.equal(panel.dataset.state,'error');assert.ok(error.compareDocumentPosition(map)&w.Node.DOCUMENT_POSITION_FOLLOWING);assert.equal(w.getComputedStyle(d.querySelector('.pk-ai-body')).overflow,'auto');c.destroy();w.close();
});
test('language menu floats without resizing content and closes on outside input and Escape',()=>{
 const w=new JSDOM('<body><button id="outside">Outside</button></body>',{pretendToBeVisual:true}).window,d=w.document,changes=[],c=createCard({document:d,input:{kind:'article'},preferences:DEFAULTS,onLanguage:l=>changes.push(l)});d.body.append(c.root);
 const trigger=d.getElementById('pk-ai-language'),panel=d.querySelector('.pk-ai-language-panel');trigger.click();
 assert.equal(panel.getAttribute('role'),'menu');assert.equal(d.activeElement.dataset.language,'zh-CN');
 panel.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));assert.equal(d.activeElement.dataset.language,'en');d.activeElement.click();
 assert.deepEqual(changes,['en']);assert.equal(d.getElementById('pk-ai-language-en').getAttribute('aria-checked'),'true');
 trigger.click();d.getElementById('outside').dispatchEvent(new w.Event('pointerdown',{bubbles:true}));assert.equal(panel.hidden,true);
 trigger.click();panel.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(panel.hidden,true);assert.equal(d.activeElement,trigger);c.destroy();w.close();
});
test('compact header reports selected view state and marks incomplete previews only once',()=>{
 const w=new JSDOM('<body></body>').window,d=w.document,c=createCard({document:d,input:{kind:'article'},preferences:DEFAULTS});d.body.append(c.root);
 try{const status=c.root.querySelector('.pk-ai-toolbar [role=status]');assert.ok(status);c.set('article','loading');assert.equal(status.textContent,'生成中');c.progress('article','Partial');c.flushProgress();assert.equal(status.textContent,'生成中 · 未完成');c.set('article','success',{text:'Done',highlights:[]});assert.equal(status.textContent,'已完成');c.set('mindmap','loading');assert.equal(status.textContent,'已完成');assert.ok(c.root.querySelector('footer #pk-ai-stop'));c.stop();d.getElementById('pk-ai-tab-mindmap').click();assert.equal(status.textContent,'已停止');}finally{c.destroy();w.close();}
});
test('summary renders safe Markdown across streaming chunks and preserves completed block identity',()=>{
 const w=new JSDOM('<body></body>').window,d=w.document,c=createCard({document:d,input:{kind:'article'},preferences:DEFAULTS});d.body.append(c.root);
 try{c.set('article','loading');c.progress('article','# Heading\n\n**Bold** and *italic*\n\n- item\n- second');c.flushProgress();const text=d.querySelector('.pk-ai-draft'),heading=text.querySelector('h3');assert.ok(heading);assert.equal(text.querySelector('strong').textContent,'Bold');assert.equal(text.querySelector('em').textContent,'italic');assert.equal(text.querySelectorAll('li').length,2);
 c.progress('article','# Heading\n\n**Bold** and *italic*\n\n- item\n- second\n\n> quote\n\n```js\n<img src=x onerror=alert(1)>\n```');c.flushProgress();assert.equal(text.querySelector('h3'),heading);assert.ok(text.querySelector('blockquote'));assert.match(text.querySelector('pre code').textContent,/<img/);assert.equal(text.querySelector('img'),null);
 c.set('article','success',{text:'<script>alert(1)</script>\n\n`inline` and **closed**',highlights:[]});assert.equal(text.querySelector('script'),null);assert.equal(text.querySelector('code').textContent,'inline');assert.equal(text.querySelector('strong').textContent,'closed');}finally{c.destroy();w.close();}
});
