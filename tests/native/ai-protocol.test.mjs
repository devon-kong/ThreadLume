import {test} from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {md5,buildResource,buildRequest,parseSSE,parseMindmap,validateInput} from '../../native-extension/src/ai/protocol.js';
const input={kind:'video',focusId:'123',url:'https://x.com/a/status/123',title:'真实标题',text:'00:00:01 中文字幕',duration:30,cues:[{start:1,end:5,text:'中文字幕'}]};
test('UTF8 MD5 / resource / 文章视频协议区别',()=>{
 for(const s of ['', 'abc','中文字幕','x'.repeat(1000)])assert.equal(md5(s),createHash('md5').update(s).digest('hex'));
 const r=buildResource(input);assert.equal(r.resource_content.type,2);assert.equal(Buffer.from(r.base64_data,'base64').toString(),input.text);assert.equal(r.resource_content.extra.origin_url,input.url);
 for(const [mode,type,scene] of [['summary',2508,0],['mindmap',2540,0],['article',2502,15]]){const b=buildRequest('resource',mode,input);assert.equal(b.messages[0].content_type,type);assert.equal(JSON.parse(b.messages[0].content).scene_id,scene);assert.equal(b.completion_option.need_create_conversation,false);}
 assert.equal(buildResource({...input,kind:'article'}).resource_content.type,1);
});
const event=(type,data)=>`data: ${JSON.stringify({event_type:type,event_data:JSON.stringify(data)})}\n\n`;
test('SSE FIN 必须、ERR 优先、按 section_index 合并、缺失细项有效',()=>{
 const text=event(2001,{message:{content:'{"text":"概要"}',meta_infos:[{type:-5,info:JSON.stringify({final:{section:[{section_index:4,chapter:'第四章',timestamp:2000}],timeline:[{section_index:4,bullet_points:[]}]}})}]}})+event(2003,{});
 const r=parseSSE(text,'summary',30);assert.equal(r.finished,true);assert.equal(r.highlights[0].chapter,'第四章');assert.deepEqual(r.highlights[0].bullet_points,[]);
 assert.throws(()=>parseSSE(text.replace(event(2003,{}),''),'summary',30),/NO_FIN/);
 assert.throws(()=>parseSSE(event(2005,{code:710022004,error_detail:{message:'secret challenge'}})+text,'summary',30),e=>e.code==='VERIFICATION_REQUIRED'&&!e.message.includes('secret'));
 assert.throws(()=>parseSSE(event(2001,{message:{content:'{"text":"x"}',meta_infos:[{type:-5,info:JSON.stringify({final:{section:[{timestamp:90000,chapter:'bad'}]}})}]}})+event(2003,{}),'summary',30),/INVALID_TIMELINE/);
});
test('脑图安全结构、有界节点，禁止把危险源当 HTML；输入严格固定 X URL 归属',()=>{
 const tree=parseMindmap('```mindmap\n## **Root**\n- child <img onerror=alert(1)>\n  - nested\n```');assert.equal(tree[0].text,'Root');assert.equal(tree[0].children[0].children[0].text,'nested');
 assert.throws(()=>parseMindmap('no fenced map'),/INVALID_MINDMAP/);assert.throws(()=>parseMindmap('```mindmap\n'+ '- a\n'.repeat(501)+'```'),/MINDMAP_LIMIT/);
 assert.equal(validateInput(input).focusId,'123');assert.throws(()=>validateInput({...input,url:'https://evil.test/123'}),/INVALID_INPUT/);assert.throws(()=>validateInput({...input,focusId:'999'}),/INVALID_INPUT/);
});
