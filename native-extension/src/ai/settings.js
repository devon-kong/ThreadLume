import {send,errorText} from './client.js';
import {DEFAULTS,normalizePreferences} from './preferences.js';
import {el,button} from './dom.js';
const d=document,root=d.getElementById('peek-settings');let prefs={...DEFAULTS},connection={state:'DISCONNECTED'},busy=false,notice='',undo=null,lastFailed=null,saveQueue=Promise.resolve(),autoCaptured=false,saveRevision=0,pendingSaves=0,refreshRevision=0,confirmedPrefs={...DEFAULTS};
function applyTheme(){d.documentElement.dataset.peekAiTheme=prefs.theme==='system'?(connection.xTheme||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')):prefs.theme;}
function toggle(name,label,description,disabled=false){
 const input=el(d,'input',{type:'checkbox',id:'pk-pref-'+name,'aria-label':label,...(disabled?{disabled:true}:{})});input.checked=prefs[name];input.addEventListener('change',()=>save({...prefs,[name]:input.checked}));
 return el(d,'label',{class:'pk-settings-row',for:input.id},el(d,'span',{},el(d,'strong',{text:label}),el(d,'small',{text:description})),input);
}
function segmented(name,options){const group=el(d,'div',{class:'pk-segment','role':'group','aria-label':name==='theme'?'外观':'视频优先展示'});for(const [value,label] of options){const b=button(d,label,()=>save({...prefs,[name]:value}));b.setAttribute('aria-pressed',String(prefs[name]===value));group.append(b);}return group;}
async function save(next){
 ++refreshRevision;const revision=++saveRevision;pendingSaves++;prefs=normalizePreferences(next);notice='正在保存…';applyTheme();render();
 saveQueue=saveQueue.then(async()=>{
  try{const saved=await send('savePreferences',{preferences:next});confirmedPrefs=saved;if(revision===saveRevision){prefs=saved;notice='更改已自动保存';lastFailed=null;}}
  catch{if(revision===saveRevision){prefs={...confirmedPrefs};notice=errorText('SAVE_FAILED');lastFailed=next;}}
  finally{pendingSaves--;applyTheme();render();}
 });return saveQueue;
}
async function connectionAction(action){
 if(busy)return;++refreshRevision;busy=true;notice='';render();
 try{
  if(action==='connect'){
   const granted=await chrome.permissions.request({origins:['https://www.doubao.com/*']});if(!granted)throw Error('PERMISSION_REQUIRED');
  }
  connection=await send(action);autoCaptured=false;
 }catch(e){connection={...connection,state:e.message};notice=errorText(e.message);}
 finally{busy=false;render();}
}
function render(){
 const active=d.activeElement?.id;root.replaceChildren();
 root.append(el(d,'h1',{text:'设置'}),el(d,'p',{class:'pk-ai-muted',text:'让 Peek 按你的习惯阅读'}));
 const state=busy?'CHECKING':connection.state,ready=state==='ready';
 const stateLabel=ready?'✓ 已连接':state==='CHECKING'?'◌ 检测中':['DISCONNECTED','PERMISSION_REQUIRED'].includes(state)?'○ 未连接':state==='LOGIN_REQUIRED'?'需要登录':state==='VERIFICATION_REQUIRED'?'请求被拒绝':state==='NEEDS_INITIALIZATION'?'需要初始化':'连接中断';
 const details=el(d,'div',{class:'pk-connection-name'},el(d,'div',{},el(d,'strong',{text:'豆包'}),el(d,'span',{class:ready?'pk-connected':'pk-connection-state',text:stateLabel})),el(d,'small',{text:ready?'使用当前浏览器的登录状态，无需常驻豆包网页':state==='CHECKING'?'正在确认连接与生成响应…':'连接浏览器已登录的豆包，自动生成摘要与脑图'}));
 const row=el(d,'div',{class:'pk-connection-row'},el(d,'span',{class:'pk-connection-icon',text:'↗','aria-hidden':true}),details);
 let primary;
 if(busy)primary=button(d,'取消检测',async()=>{await send('cancelCheck').catch(()=>{});});
 else if(connection.setupOpen)primary=button(d,'完成后检测',()=>connectionAction('capture'));
 else if(ready)primary=button(d,'重新检测',()=>connectionAction('check'));
 else primary=button(d,['LOGIN_REQUIRED','VERIFICATION_REQUIRED','NEEDS_INITIALIZATION'].includes(state)?'打开豆包网页':'连接豆包',()=>connectionAction(['LOGIN_REQUIRED','VERIFICATION_REQUIRED','NEEDS_INITIALIZATION'].includes(state)?'openSetup':'connect'));
 row.append(primary);
 const more=el(d,'details',{class:'pk-settings-more'},el(d,'summary',{'aria-label':'更多连接操作',text:'···'}),button(d,'断开连接',()=>connectionAction('disconnect')));row.append(more);
 const section=el(d,'section',{class:'pk-settings-card'},row,el(d,'div',{class:'pk-connection-foot'},el(d,'span',{text:connection.checkedAt?'最近检测：'+new Date(connection.checkedAt).toLocaleString():'首次连接可能需要打开一次豆包'}),el(d,'span',{text:'仅在启用自动总结时发送当前阅读内容'})));
 root.append(section);
 const intelligence=el(d,'section',{class:'pk-settings-card'},el(d,'h2',{text:'智能阅读'}),toggle('summary','Summary','自动总结视频与长文，普通短帖不生成'),toggle('timeline','视频时间轴',prefs.summary?'在 Summary 下方展示章节':'开启 Summary 后可使用',!prefs.summary),toggle('mindmap','思维导图','自动生成视频脑图，可与 Summary 随时切换'));
 const defaultRow=el(d,'div',{class:'pk-settings-row pk-settings-divider'},el(d,'strong',{text:'视频优先展示'}));
 if(prefs.summary&&prefs.mindmap)defaultRow.append(segmented('defaultView',[['summary','Summary'],['mindmap','思维导图']]));else defaultRow.append(el(d,'small',{text:prefs.summary?'Summary · 唯一已开启视图':prefs.mindmap?'思维导图 · 唯一已开启视图':'全部关闭 · 不生成 AI 内容'}));
 intelligence.append(defaultRow);root.append(intelligence);
 root.append(el(d,'section',{class:'pk-settings-card pk-settings-row'},el(d,'span',{},el(d,'strong',{text:'外观'}),el(d,'small',{text:'跟随 X，或使用独立主题'})),segmented('theme',[['system','跟随 X'],['light','浅色'],['dark','深色']])));
 root.append(el(d,'section',{class:'pk-settings-card pk-settings-row'},el(d,'span',{},el(d,'strong',{text:'飞书收藏'}),el(d,'small',{text:'将喜欢的内容收藏到飞书'})),el(d,'span',{class:'pk-ai-muted',text:'即将开放'})));
 const reset=button(d,'恢复默认',()=>{undo={...prefs};save({...DEFAULTS});});
 const bottom=el(d,'div',{class:'pk-settings-bottom'},el(d,'span',{'role':'status',text:notice||'更改自动保存'}),reset);
 if(undo)bottom.append(button(d,'撤销',()=>{const previous=undo;undo=null;save(previous);}));if(lastFailed)bottom.append(button(d,'重试保存',()=>save(lastFailed)));root.append(bottom);
 if(notice)root.append(el(d,'p',{class:'pk-settings-notice',text:notice}));
 root.append(el(d,'p',{class:'pk-settings-privacy',text:'当前字幕或完整长文会发送至豆包。浏览器自动携带已有会话；Peek 不读取或导入账号凭据。断开保留已有结果。豆包响应与额度由其服务决定。'}));
 const diagnostics=el(d,'details',{class:'pk-settings-diagnostics'},el(d,'summary',{text:'验收信息（不保活）'}),el(d,'pre',{text:JSON.stringify({version:chrome.runtime.getManifest().version,state:connection.state,diagnostics:connection.diagnostics},null,2)}));root.append(diagnostics);
 if(active)d.getElementById(active)?.focus();
}
async function refresh(){if(busy||pendingSaves)return;const revision=++refreshRevision;try{const [saved,state]=await Promise.all([send('preferences'),send('status')]);if(revision!==refreshRevision||busy)return;connection=state;if(!pendingSaves){prefs=saved;confirmedPrefs={...saved};}applyTheme();render();if(connection.setupOpen&&!['LOGIN_REQUIRED','VERIFICATION_REQUIRED'].includes(connection.state)&&!busy&&!autoCaptured){autoCaptured=true;await connectionAction('capture');autoCaptured=true;}}catch(e){if(revision!==refreshRevision||busy)return;notice=errorText(e.message);render();}}
window.addEventListener('focus',refresh);matchMedia('(prefers-color-scheme: dark)').addEventListener('change',applyTheme);
refresh();
