import {identifyTree,validPreview} from './preview.js';
// Protocol adapted from the handoff's independently verified adapter.
// This module has no transport and never accepts arbitrary endpoint metadata.
export class AIError extends Error {constructor(code){super(code);this.code=code;}}
export const fail=code=>{throw new AIError(code);};
export function md5(text){
 const bytes=new TextEncoder().encode(text),len=bytes.length;
 const data=new Uint8Array(((len+8>>>6)+1)*64);data.set(bytes);data[len]=128;
 const view=new DataView(data.buffer);view.setUint32(data.length-8,len*8,true);view.setUint32(data.length-4,Math.floor(len/0x20000000),true);
 let a=0x67452301,b=0xefcdab89,c=0x98badcfe,d=0x10325476;
 const shifts=[7,12,17,22,5,9,14,20,4,11,16,23,6,10,15,21];
 for(let at=0;at<data.length;at+=64){let A=a,B=b,C=c,D=d;
  for(let i=0;i<64;i++){let f,g;if(i<16){f=(B&C)|(~B&D);g=i;}else if(i<32){f=(D&B)|(~D&C);g=(5*i+1)%16;}else if(i<48){f=B^C^D;g=(3*i+5)%16;}else{f=C^(B|~D);g=7*i%16;}
   const n=(A+f+Math.floor(Math.abs(Math.sin(i+1))*4294967296)+view.getUint32(at+g*4,true))|0,s=shifts[(i>>>4)*4+i%4];
   A=D;D=C;C=B;B=(B+((n<<s)|(n>>>(32-s))))|0;
  }a=(a+A)|0;b=(b+B)|0;c=(c+C)|0;d=(d+D)|0;
 }
 return [a,b,c,d].map(x=>[0,8,16,24].map(s=>((x>>>s)&255).toString(16).padStart(2,'0')).join('')).join('');
}
export function validateInput(input){
 if(!input||!['video','article'].includes(input.kind)||!/^\d{1,25}$/.test(input.focusId)||typeof input.title!=='string'||!input.title.trim()||input.title.length>500||typeof input.text!=='string'||!input.text.trim()||new TextEncoder().encode(input.text).length>1500000)fail('INVALID_INPUT');
 let u;try{u=new URL(input.url);}catch{fail('INVALID_INPUT');}
 if(u.protocol!=='https:'||!['x.com','twitter.com'].includes(u.hostname)||u.username||u.password||u.search||u.hash||!new RegExp(`^/[^/]+/status/${input.focusId}$`).test(u.pathname))fail('INVALID_INPUT');
 if(input.kind==='video'){
  if(!Number.isFinite(input.duration)||input.duration<=0||input.duration>86400||!Array.isArray(input.cues)||!input.cues.length||input.cues.length>20000)fail('INVALID_INPUT');
  if(input.cues.some(c=>!Number.isFinite(c.start)||!Number.isFinite(c.end)||c.start<0||c.end<c.start||c.end>input.duration+1||typeof c.text!=='string'||!c.text.trim()))fail('INVALID_INPUT');
  const transcript=input.cues.map(c=>{const s=Math.floor(c.start);return [Math.floor(s/3600),Math.floor(s/60)%60,s%60].map(n=>String(n).padStart(2,'0')).join(':')+' '+c.text.trim().replace(/\s+/g,' ');}).join('\n');
  if(transcript!==input.text)fail('INVALID_INPUT');
 }
 return {kind:input.kind,focusId:input.focusId,url:u.href,title:input.title,text:input.text,...(input.kind==='video'?{duration:input.duration,cues:input.cues.map(c=>({start:c.start,end:c.end,text:c.text}))}:{})};
}
export function buildResource(input){
 const bytes=new TextEncoder().encode(input.text);let binary='';for(const b of bytes)binary+=String.fromCharCode(b);
 return {resource_content:{type:input.kind==='video'?2:1,title:input.title,fingerprint:md5(input.text),uri:'',extra:{origin_url:input.url}},base64_data:btoa(binary)};
}
export const RESULT_VERSION='reading-v13';
export function validateLanguage(value='zh-CN'){if(!['zh-CN','en'].includes(value))fail('INVALID_LANGUAGE');return value;}
export function buildRequest(resourceId,mode,input,outputLanguage='zh-CN'){
 if(!resourceId||!['summary','mindmap','article'].includes(mode))fail('INVALID_MODE');
 const {title,url}=input,language=validateLanguage(outputLanguage)==='en'?'en':'zh';
 const content=mode==='summary'?{text:url,language,scene_id:0,title,url,with_tag:false,resource_id:resourceId,need_timeline:true}
  :mode==='mindmap'?{text:language==='en'?'Create an English mindmap of the supplied content, preserving main themes and details.':'根据所给内容生成简体中文思维导图，保留主要主题和关键细节。',language,resource_id:resourceId,scene_id:0}
  :{text:'',language,url,title,scene_id:15,resource_id:resourceId};
 return {messages:[{content_type:mode==='summary'?2508:mode==='mindmap'?2540:2502,content:JSON.stringify(content),attachments:[],references:[]}],completion_option:completionOptions(),reply_id:'0',conversation_id:'0',section_id:'0',local_message_id:crypto.randomUUID(),local_conversation_id:'0'};
}
export function completionOptions(){return {is_regen:false,with_suggest:false,need_create_conversation:false,is_replace:false,is_delete:false,memory_type:2,launch_stage:1,event_id:'0',origin:'https://www.doubao.com'};}
export function classifyBusiness(code){
 if([710022004,710022002].includes(Number(code)))return 'VERIFICATION_REQUIRED';
 if([401,403,1001,1003].includes(Number(code)))return 'LOGIN_REQUIRED';
 return 'SERVICE_REJECTED';
}
// Intentionally export only bounded numeric metadata and fixed classes. Never
// return response text, error_detail, challenge payloads or request parameters.
export function businessDiagnostics(text){
 try{for(const block of text.replace(/\r\n?/g,'\n').split(/\n\n/)){
  const raw=block.split(/\r?\n/).filter(x=>x.startsWith('data:')).map(x=>x.slice(5).trimStart()).join('\n');if(!raw)continue;
  const e=JSON.parse(raw),data=typeof e.event_data==='string'?JSON.parse(e.event_data):e.event_data;
  if(e.event_type!==2005&&!(!e.event_type&&e.code))continue;
  const code=Number(data?.code||e.code),message=data?.error_detail?.message||data?.message||e.message;
  const value=typeof message==='string'?message:'';
  const messageClass=/验证|校验|verify|captcha/i.test(value)?'verification':/额度|限流|频率|quota|rate.limit/i.test(value)?'limit':/登录|login|sign.in/i.test(value)?'login':/服务.*问题|服务.*异常|开小差|something went wrong/i.test(value)?'service_problem':'unclassified';
  return {businessEvent:e.event_type===2005?2005:0,...(Number.isSafeInteger(code)&&code>=0&&code<1e10?{businessCode:code}:{}),messageClass};
 }}catch{/* Diagnostics must not change transport/parser behavior. */}
 return {};
}
export function parseSSE(text,mode='article',duration=Infinity,{partial=false}={}){
 let finished=false,output='';const events=[],sections=new Map(),timeline=new Map();
 try{
  for(const block of text.replace(/\r\n?/g,'\n').split(/\n\n/)){
   const raw=block.split(/\r?\n/).filter(x=>x.startsWith('data:')).map(x=>x.slice(5).trimStart()).join('\n');if(!raw)continue;
   const e=JSON.parse(raw),data=typeof e.event_data==='string'?JSON.parse(e.event_data):e.event_data;
   if(e.event_type===2005||(!e.event_type&&e.code))fail(classifyBusiness(data?.code||e.code));
   if(!e.event_type)fail('INVALID_STREAM');events.push(e.event_type);if(e.event_type===2003)finished=true;
   const message=data?.message;
   if(message?.content){const content=typeof message.content==='string'?JSON.parse(message.content):message.content;if(typeof content.text==='string')output=data.is_delta?output+content.text:content.text;}
   for(const meta of message?.meta_infos||[])if(meta.type===-5){
    const info=JSON.parse(meta.info),s=info.final?.section??info.inc?.section,t=info.final?.timeline??info.inc?.timeline;
    if(Array.isArray(s))for(const [i,item] of s.entries()){const key=item.section_index??i;sections.set(key,{...sections.get(key),...item});}
    if(Array.isArray(t))for(const item of t)timeline.set(item.section_index,{...timeline.get(item.section_index),...item});
   }
  }
 }catch(e){if(e instanceof AIError)throw e;fail('INVALID_STREAM');}
 if(!finished&&!partial)fail('NO_FIN');if(!partial&&(!output.trim()||output.length>200000))fail('EMPTY_OUTPUT');
 const highlights=[...sections].sort(([a],[b])=>a-b).map(([index,s])=>({...s,...timeline.get(index)}));
 if(mode==='summary'&&!partial)for(const h of highlights){for(const point of [h,...(h.bullet_points||[])])if(!Number.isFinite(point.timestamp)||point.timestamp<0||point.timestamp>duration*1000)fail('INVALID_TIMELINE');}
 const result={finished,eventTypes:[...new Set(events)],text:output,highlights,timestampUnit:'milliseconds'};
 if(mode==='mindmap')result.tree=parseMindmap(output,{partial});
 return result;
}
export function parseMindmap(text,{partial=false}={}){
 let source=text.match(/```mindmap[^\S\n]*\n([\s\S]*?)(?:```|$)/i)?.[1];
 if(!partial)source=text.match(/```mindmap\s*([\s\S]*?)```/i)?.[1]?.trim();
 else if(source)source=source.slice(0,source.lastIndexOf('\n')+1);
 if(!source){if(partial)return [];fail('INVALID_MINDMAP');}
 const roots=[],stack=[];let count=0;
 for(const line of source.split('\n')){
  if(!line.trim()||/^\s*mindmap\s*$/i.test(line))continue;
  const header=line.match(/^(#{1,6})\s+(.*)$/),bullet=line.match(/^(\s*)[-*+]\s+(.*)$/);
  let depth=header?header[1].length-2:bullet?1+Math.floor(bullet[1].replace(/\t/g,'  ').length/2):Math.floor((line.match(/^\s*/)[0].length)/2);
  const value=(header?.[2]??bullet?.[2]??line.trim()).replace(/^root\(\((.*)\)\)$/,'$1').replace(/\*\*/g,'').slice(0,2000);
  if(!value)continue;if(++count>500||depth>24)fail('MINDMAP_LIMIT');depth=Math.max(0,depth);
  const node={text:value,children:[]};while(stack.length&&stack.at(-1).depth>=depth)stack.pop();
  (stack.length?stack.at(-1).node.children:roots).push(node);stack.push({node,depth});
 }
 if(!roots.length)fail('INVALID_MINDMAP');return roots;
}

export function previewSSE(text,mode,input,outputLanguage='zh-CN'){
 const empty={version:1,outputLanguage,text:'',highlights:[],tree:[]};
 try{
  const normalized=text.replace(/\r\n?/g,'\n'),boundary=normalized.lastIndexOf('\n\n');if(boundary<0)return empty;
  const data=parseSSE(normalized.slice(0,boundary+2),mode,input?.duration,{partial:true});
  const preview={...empty,text:mode==='mindmap'?'':data.text.slice(0,12000),tree:identifyTree(data.tree||[]),highlights:[]};
  if(mode==='summary')for(const h of data.highlights){
   const valid=p=>Number.isFinite(p.timestamp)&&p.timestamp>=0&&p.timestamp<=(input?.duration||0)*1000;
   if(!valid(h)||typeof (h.chapter||h.title)!=='string')continue;
   preview.highlights.push({timestamp:h.timestamp,chapter:h.chapter||h.title,bullet_points:(h.bullet_points||[]).filter(p=>valid(p)&&typeof (p.point||p.text)==='string').map(p=>({timestamp:p.timestamp,point:p.point||p.text}))});
  }
  return validPreview(preview,outputLanguage)?preview:empty;
 }catch{return empty;}
}
