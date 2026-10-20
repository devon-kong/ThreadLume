import {send,errorText} from './client.js';
import {DEFAULTS,normalizePreferences} from './preferences.js';
import {el,button} from './dom.js';
import {normalizeEndpoint,validateProviderConfig} from './custom-provider.js';
import {providerPermissions} from './transport-policy.js';
const d=document,root=d.getElementById('peek-settings');let prefs={...DEFAULTS},connection={state:'DISCONNECTED'},busy=false,notice='',undo=null,lastFailed=null,saveQueue=Promise.resolve(),saveRevision=0,pendingSaves=0,refreshRevision=0,confirmedPrefs={...DEFAULTS},providers={activeId:'doubao',services:[]},providerBusy=false,providerRevision=0,providerDialog=null;
const providerDrafts=new Map();
let setupOperation=null,setupStage='';
const SETUP_LABELS={permission:'正在请求域名授权…',background:'正在准备后台…',rules:'正在准备网络规则…',model:'正在检测模型…',commit:'正在保存配置…'};
function beginSetup(){setupOperation=crypto.randomUUID();showSetup('permission');return setupOperation;}
function showSetup(stage){setupStage=SETUP_LABELS[stage]||'';const node=d.getElementById('pk-provider-phase');if(node)node.textContent=setupStage;const submit=d.getElementById('pk-provider-submit');if(submit?.disabled)submit.textContent=setupStage||'正在检测…';}
chrome.runtime.onMessage?.addListener((m,sender)=>{if(sender.id!==chrome.runtime.id||sender.tab||m?.ns!=='peek-ai-v7'||m.action!=='providerProgress'||m.operationId!==setupOperation||!Object.hasOwn(SETUP_LABELS,m.stage))return;showSetup(m.stage);});
function applyTheme(){d.documentElement.dataset.peekAiTheme=prefs.theme==='system'?(connection.xTheme||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')):prefs.theme;}
function toggle(name,label,description,disabled=false){
 const input=el(d,'input',{type:'checkbox',id:'pk-pref-'+name,'aria-label':label,...(disabled?{disabled:true}:{})});input.checked=prefs[name];input.addEventListener('change',()=>save({...prefs,[name]:input.checked}));
 return el(d,'label',{class:'pk-settings-row',for:input.id},el(d,'span',{},el(d,'strong',{text:label}),el(d,'small',{text:description})),input);
}
function identified(node,id){node.id=id;return node;}
function segmented(name,options){const group=el(d,'div',{class:'pk-segment','role':'group','aria-label':name==='theme'?'外观':'视频优先展示'});for(const [value,label] of options){const b=button(d,label,()=>save({...prefs,[name]:value}));b.id='pk-'+name+'-'+value;b.setAttribute('aria-pressed',String(prefs[name]===value));group.append(b);}return group;}
async function save(next){
 ++refreshRevision;const revision=++saveRevision;pendingSaves++;prefs=normalizePreferences(next);notice='正在保存…';applyTheme();render();
 saveQueue=saveQueue.then(async()=>{
  try{const saved=await send('savePreferences',{preferences:next});confirmedPrefs=saved;if(revision===saveRevision){prefs=saved;notice='更改已自动保存';lastFailed=null;}}
  catch{if(revision===saveRevision){prefs={...confirmedPrefs};notice=errorText('SAVE_FAILED');lastFailed=next;}}
  finally{pendingSaves--;applyTheme();render();}
 });return saveQueue;
}
async function connectionAction(action){
 if(busy)return;const keepCustom=providers.activeId!=='doubao';++refreshRevision;busy=true;notice='';render();
 try{
  if(action==='connect'||action==='openSetup'){
   const granted=await chrome.permissions.request({origins:['https://www.doubao.com/*']});if(!granted)throw Error('PERMISSION_REQUIRED');
  }
  connection=await send(action);const list=await send('providers');if(list?.services)providers=list;
 }catch(e){if(!keepCustom)connection={...connection,state:e.message};notice=errorText(e.message);}
 finally{busy=false;render();}
}
// Provider configuration lives only in this trusted settings document. Drafts
// stay in memory so a denied grant, failed probe or Escape never loses edits.
function providerSection(){
 const custom=providers.services.find(s=>s.id===providers.activeId);
 const state=busy||providerBusy?'CHECKING':connection.state,ready=state==='ready';
 const stateLabel=ready?'✓ 已连接':state==='CHECKING'?'◌ 检测中':['DISCONNECTED','PERMISSION_REQUIRED'].includes(state)?'○ 未连接':state==='LOGIN_REQUIRED'?'需要登录':state==='VERIFICATION_REQUIRED'?'请求被拒绝':state==='NEEDS_INITIALIZATION'?'需要初始化':'连接中断';
 const menu=el(d,'details',{id:'pk-provider-menu',class:'pk-provider-menu'},el(d,'summary',{'aria-label':'选择 AI 服务'},el(d,'span',{id:'pk-provider-current',text:custom?.name||'豆包'}),el(d,'span',{'aria-hidden':true,text:'⌄'})));
 const options=el(d,'div',{class:'pk-provider-options'});
 const choose=(id,label,description,action)=>{const b=identified(button(d,'',()=>{d.getElementById('pk-provider-menu').open=false;action();}),'pk-provider-'+id);b.disabled=busy||providerBusy;b.setAttribute('aria-pressed',String(providers.activeId===id));b.append(el(d,'strong',{text:label}),el(d,'small',{text:description}));options.append(b);return b;};
 choose('doubao','豆包','浏览器账号连接',()=>connectionAction(providers.activeId==='doubao'&&connection.state==='ready'?'check':'openSetup'));
 for(const service of providers.services){
  const option=choose(service.id,service.name,service.model+(service.id===providers.activeId?' · 当前使用':''),()=>activateProvider(service.id));option.classList.add('pk-provider-option-main');
  const edit=identified(button(d,'编辑',()=>openProviderDialog(providers.services.find(s=>s.id===service.id))),'pk-provider-edit-'+service.id);edit.classList.add('pk-provider-option-edit');edit.disabled=busy||providerBusy;edit.setAttribute('aria-label','编辑 '+service.name);
  options.append(el(d,'div',{class:'pk-provider-option-row'},option,edit));
 }
 const add=identified(button(d,'＋ 添加 AI 服务',()=>openProviderDialog()),'pk-provider-add');add.disabled=busy||providerBusy;options.append(add);menu.append(options);
 const selector=el(d,'div',{class:'pk-provider-selector'},el(d,'strong',{text:'AI 服务'}),menu);
 const details=el(d,'div',{class:'pk-connection-name'},el(d,'div',{},el(d,'strong',{text:custom?.model||'豆包'}),el(d,'span',{class:ready?'pk-connected':'pk-connection-state',text:stateLabel})),el(d,'small',{text:custom?'Chat Completions · OpenAI 兼容':ready?'使用当前浏览器的登录状态，无需常驻豆包网页':'连接浏览器已登录的豆包，自动生成摘要与脑图'}));
 const row=el(d,'div',{class:'pk-connection-row'},details);
 let primary;
 if(providerBusy)primary=button(d,'取消检测',cancelProviderCheck);
 else if(busy)primary=button(d,'取消检测',()=>send('cancelCheck').catch(()=>{}));
 else if(connection.setupOpen)primary=button(d,'完成后检测',()=>connectionAction('capture'));
 else if(custom)primary=button(d,'重新检测',()=>activateProvider(providers.activeId));
 else if(ready)primary=button(d,'重新检测',()=>connectionAction('check'));
 else primary=button(d,['LOGIN_REQUIRED','VERIFICATION_REQUIRED','NEEDS_INITIALIZATION'].includes(state)?'打开豆包网页':'连接豆包',()=>connectionAction(['LOGIN_REQUIRED','VERIFICATION_REQUIRED','NEEDS_INITIALIZATION'].includes(state)?'openSetup':'connect'));
 primary.id='pk-connection-'+(busy||providerBusy?'cancel':connection.setupOpen?'capture':custom?'check-'+custom.id:ready?'check':['LOGIN_REQUIRED','VERIFICATION_REQUIRED','NEEDS_INITIALIZATION'].includes(state)?'setup':'connect');row.append(primary);
 const more=el(d,'details',{class:'pk-settings-more'},el(d,'summary',{id:'pk-more','aria-label':'更多连接操作',text:'···'}));
 if(custom)more.append(identified(button(d,'编辑服务',()=>openProviderDialog(providers.services.find(s=>s.id===providers.activeId))),'pk-provider-edit'));
 else more.append(identified(button(d,'断开连接',()=>connectionAction('disconnect')),'pk-disconnect'));
 row.append(more);
 const blocked=custom&&!ready&&state!=='CHECKING';
 const foot=providerBusy?(setupStage||'等待服务响应。')+' 取消后保留原连接与本次草稿。':blocked?errorText(state)+(state==='CUSTOM_KEY_REQUIRED'?' 请编辑服务，重新输入后检测。':''):custom?new URL(custom.baseURL).host+' · '+(custom.rememberKey?'密钥已保存在此设备':'密钥仅在本次浏览器会话保存'):'当前字幕或正文会发送至豆包。切换服务会保留此连接。';
 return el(d,'section',{id:'pk-connection-card',class:'pk-settings-card'},selector,row,...(custom&&connection.setupOpen?[el(d,'p',{class:'pk-ai-muted',text:'豆包连接页已打开。完成登录或验证后，请点击「完成后检测」；成功前继续使用当前服务。'})]:[]),el(d,'div',{class:'pk-connection-foot'},el(d,'span',{id:providerBusy?'pk-provider-phase':undefined,text:foot}),el(d,'span',{text:connection.checkedAt?'最近检测：'+new Date(connection.checkedAt).toLocaleString():''})));
}
// The atomic save/activate ACK is the final success boundary. Later read-only
// status requests cannot re-open cancellation or turn a committed success red.
function acceptProviderList(list){
 ++refreshRevision;providers=list;const active=list.services.find(s=>s.id===list.activeId);
 connection={...connection,state:'ready',providerId:active.id,providerName:active.name,connectionId:`custom:${active.id}:${active.version}`,checkedAt:active.checkedAt||null,setupOpen:false};
}
function refreshCommittedStatus(){
 const revision=refreshRevision;
 send('status').then(state=>{if(revision!==refreshRevision||state?.providerId!==providers.activeId||providerBusy||providerDialog)return;connection=state;render();}).catch(()=>{});
}
// Updating unpacked files does not reload Chrome's in-memory Manifest. Check
// before the gesture-bound request so a stale grant ceiling has a clear remedy.
function requestProviderPermission(baseURL){
 const request=providerPermissions(baseURL),permission=request.origins[0];
 const hosts=chrome.runtime.getManifest().optional_host_permissions||[];
 if(!hosts.includes('https://*/*')&&!hosts.includes(permission))throw Error('CUSTOM_EXTENSION_RELOAD_REQUIRED');
 if(request.permissions?.some(p=>!chrome.runtime.getManifest().optional_permissions?.includes(p)))throw Error('CUSTOM_EXTENSION_RELOAD_REQUIRED');
 return chrome.permissions.request(request);
}
async function activateProvider(id){
 if(providerBusy||busy)return;const operationId=beginSetup(),revision=++providerRevision;++refreshRevision;providerBusy=true;notice='';render();
 try{const service=providers.services.find(s=>s.id===id);const permission=requestProviderPermission(service.baseURL);if(!await permission)throw Error('CUSTOM_PERMISSION_REQUIRED');if(revision!==providerRevision)return;const list=await send('activateProvider',{id,operationId});if(revision!==providerRevision)return;acceptProviderList(list);providerBusy=false;notice='连接成功，已启用服务';render();refreshCommittedStatus();}
 catch(e){if(revision===providerRevision)notice=errorText(e.message);}
 finally{if(revision===providerRevision){providerBusy=false;render();}}
}
function cancelProviderCheck(){setupOperation=null;++providerRevision;providerBusy=false;notice='已取消检测，保留原服务与草稿。';send('cancelProviderCheck').catch(()=>{});render();}
function openProviderDialog(service){
 if(providerDialog||providerBusy||busy)return;++refreshRevision;
 const draftId=service?.id||'new',prior=d.activeElement,draft=providerDrafts.get(draftId)||{name:service?.name||'',baseURL:service?.baseURL||'',model:service?.model||'',key:'',rememberKey:service?.rememberKey!==false,stream:service?.stream===true};
 const dialog=el(d,'dialog',{id:'pk-provider-dialog',class:'pk-provider-dialog','aria-labelledby':'pk-provider-title'}),form=el(d,'form',{id:'pk-provider-form',novalidate:true});providerDialog=dialog;
 const close=identified(button(d,'×',()=>dismiss()),'pk-provider-close');close.setAttribute('aria-label','关闭服务设置');
 form.append(el(d,'header',{},el(d,'div',{},el(d,'h2',{id:'pk-provider-title',text:service?'编辑 AI 服务':'添加 AI 服务'}),el(d,'p',{class:'pk-ai-muted',text:'连接兼容 API，选择你习惯的模型。'})),close));
 const field=(name,label,type='text')=>{const input=el(d,'input',{id:'pk-provider-'+name,type,autocomplete:'off',...(name==='key'?{'data-lpignore':'true'}:{})});input.value=draft[name];const wrap=el(d,'label',{class:'pk-provider-field',for:input.id},el(d,'span',{text:label}),input);return {input,wrap};};
 const name=field('name','服务名称'),url=field('baseURL','API 地址（Base URL）','url'),model=field('model','模型名称'),key=field('key',service?.hasKey?'替换 API Key（留空保留已有 Key）':'API Key','password');
 name.input.maxLength=80;model.input.maxLength=200;url.input.maxLength=2048;key.input.setAttribute('autocomplete','new-password');key.input.placeholder=service?.hasKey?'输入新 Key 以替换':'输入 API Key';
 const endpoint=el(d,'small',{id:'pk-provider-endpoint',class:'pk-ai-muted'}),protocol=el(d,'div',{class:'pk-provider-field'},el(d,'span',{text:'调用方式'}),el(d,'p',{class:'pk-provider-protocol',text:'Chat Completions · OpenAI 兼容'}));
 form.append(name.wrap,url.wrap,endpoint,el(d,'div',{class:'pk-provider-columns'},protocol,model.wrap));
 if(service)form.append(el(d,'div',{class:'pk-provider-mask'},el(d,'span',{text:service.hasKey?'已保存 API Key：':'未保存 API Key'}),el(d,'span',{id:'pk-provider-key-mask',text:service.hasKey?'••••••••':''})));
 form.append(key.wrap);
 const remember=el(d,'input',{id:'pk-provider-rememberKey',type:'checkbox'});remember.checked=draft.rememberKey;
 form.append(el(d,'label',{class:'pk-provider-remember',for:remember.id},remember,el(d,'span',{text:'记住在此设备'})),el(d,'small',{class:'pk-ai-muted',text:'保存在浏览器本地存储，并非系统钥匙串加密。关闭后，Key 只在本次浏览器会话内保存。'}),el(d,'p',{class:'pk-ai-muted',text:'保存时会请求访问此 API 域名，并发送一条最小测试请求，不发送当前文章。连接成功后，当前字幕或正文仅发送至你选择的服务。'}));
 const stream=el(d,'input',{id:'pk-provider-stream',type:'checkbox'});stream.checked=draft.stream===true;form.append(el(d,'label',{class:'pk-provider-remember',for:stream.id},stream,el(d,'span',{text:'渐进显示摘要与脑图（流式）'})),el(d,'small',{class:'pk-ai-muted',text:'更早开始阅读；保存时验证服务的流式兼容性。失败不自动重发，关闭后恢复完整结果方式。'}));
 const error=el(d,'p',{id:'pk-provider-error',class:'pk-provider-error',role:'alert'}),cancel=identified(button(d,'取消',()=>dismiss()),'pk-provider-cancel'),submit=el(d,'button',{id:'pk-provider-submit',type:'submit',class:'pk-provider-primary',text:'保存、检测并启用'});form.append(error,el(d,'footer',{},cancel,submit));dialog.append(form);d.body.append(dialog);
 const capture=()=>{const value={name:name.input.value,baseURL:url.input.value,model:model.input.value,key:key.input.value,rememberKey:remember.checked,stream:stream.checked};providerDrafts.set(draftId,value);return value;};
 const preview=()=>{capture();try{endpoint.textContent='请求地址：'+normalizeEndpoint(url.input.value).endpoint+(providerPermissions(url.input.value).permissions?'。此服务需额外网络规则权限，仅在该准确 API 地址移除 Origin 请求头。':'');}catch{endpoint.textContent=url.input.value?'仅支持 HTTPS Base URL，不含账号、查询参数或片段。':'填写服务商提供的 Base URL；请求路径会自动规范化。';}};
 form.addEventListener('input',preview);form.addEventListener('change',capture);preview();
 let checking=false,revision=0;
 const setChecking=value=>{checking=value;for(const node of form.querySelectorAll('input,button[type=submit]'))node.disabled=value;submit.textContent=value?'正在检测…':'保存、检测并启用';cancel.textContent=value?'取消检测':'取消';};
 function dismiss(){capture();setupOperation=null;++revision;if(checking)send('cancelProviderCheck').catch(()=>{});dialog.close();}
 const keydown=event=>{if(!dialog.open)return;if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();dismiss();}else if(event.key==='Tab'){const nodes=[...dialog.querySelectorAll('button,input')].filter(n=>!n.disabled),first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&d.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&d.activeElement===last){event.preventDefault();first.focus();}}};
 window.addEventListener('keydown',keydown,true);dialog.addEventListener('cancel',e=>{e.preventDefault();dismiss();});dialog.addEventListener('close',()=>{window.removeEventListener('keydown',keydown,true);dialog.remove();providerDialog=null;if(prior?.isConnected)prior.focus({preventScroll:true});},{once:true});
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(checking)return;const value=capture();let config,normalized;
  try{config=validateProviderConfig({...(service?{id:service.id}:{}),name:value.name,protocol:'chat-completions',baseURL:value.baseURL,model:value.model,rememberKey:value.rememberKey,stream:value.stream});normalized=normalizeEndpoint(value.baseURL);if(!value.key&&!service?.hasKey)throw Error('CUSTOM_KEY_REQUIRED');}
  catch(e){error.textContent=errorText(e.code||e.message);return;}
  const token=++revision;setChecking(true);const operationId=beginSetup();error.textContent='';
  // This call must remain before the first await, within the submit gesture.
  try{const permission=requestProviderPermission(config.baseURL);const granted=await permission;if(token!==revision)return;if(!granted)throw Error('CUSTOM_PERMISSION_REQUIRED');const list=await send('saveProvider',{config,operationId,...(value.key?{key:value.key}:{})});if(token!==revision)return;acceptProviderList(list);providerDrafts.delete(draftId);key.input.value='';checking=false;notice='连接成功，已启用服务';dialog.close();render();refreshCommittedStatus();}
  catch(e){if(token===revision)error.textContent=errorText(e.message);}
  finally{if(token===revision&&dialog.isConnected)setChecking(false);}
 });
 dialog.showModal();name.input.focus();
}
// Reconcile the extension-owned settings tree, retaining controls and their
// listeners by semantic identity. Save ACKs update today's active node; they
// never remember or refocus the control that started an older save.
function patchChildren(parent,template){
 const key=n=>n.nodeType===1?n.id:'';
 const compatible=(a,b)=>a&&a.nodeType===b.nodeType&&a.nodeName===b.nodeName&&key(a)===key(b);
 let index=0;
 for(const next of [...template.childNodes]){
  const at=parent.childNodes[index];
  const old=key(next)?[...parent.childNodes].find(n=>key(n)===key(next)):at;
  if(!compatible(old,next)){parent.insertBefore(next,at||null);index++;continue;}
  if(old!==at)parent.insertBefore(old,at||null);
  if(old.nodeType===3){if(old.data!==next.data)old.data=next.data;}
  else{
   for(const attr of [...old.attributes])if(!next.hasAttribute(attr.name)&&!(old.tagName==='DETAILS'&&attr.name==='open'))old.removeAttribute(attr.name);
   for(const attr of next.attributes)if(old.getAttribute(attr.name)!==attr.value)old.setAttribute(attr.name,attr.value);
   if(old.tagName==='INPUT')old.checked=next.checked;
   patchChildren(old,next);
  }
  index++;
 }
 while(parent.childNodes.length>index)parent.lastChild.remove();
}
function render(){
 const active=root.contains(d.activeElement)?d.activeElement:null,view=d.createDocumentFragment();
 view.append(el(d,'h1',{text:'设置'}),el(d,'p',{class:'pk-ai-muted',text:'让 Peek 按你的习惯阅读'}));
 view.append(providerSection());
 const intelligence=el(d,'section',{id:'pk-intelligence',class:'pk-settings-card'},el(d,'h2',{text:'智能阅读'}),toggle('summary','摘要','优先生成当前视图，普通短帖不生成'),toggle('timeline','视频时间轴',prefs.summary?'在 摘要 下方展示章节':'开启 摘要 后可使用',!prefs.summary),toggle('mindmap','思维导图','选择脑图视图时生成，已有结果直接显示'));
 const defaultRow=el(d,'div',{class:'pk-settings-row pk-settings-divider'},el(d,'strong',{text:'视频优先展示'}));
 if(prefs.summary&&prefs.mindmap)defaultRow.append(segmented('defaultView',[['summary','摘要'],['mindmap','思维导图']]));else defaultRow.append(el(d,'small',{text:prefs.summary?'摘要 · 唯一已开启视图':prefs.mindmap?'思维导图 · 唯一已开启视图':'全部关闭 · 不生成 AI 内容'}));
 intelligence.append(defaultRow);view.append(intelligence);
 view.append(el(d,'section',{id:'pk-appearance',class:'pk-settings-card'},el(d,'div',{class:'pk-settings-row'},el(d,'span',{},el(d,'strong',{text:'外观'}),el(d,'small',{text:'跟随 X，或使用独立主题'})),segmented('theme',[['system','跟随 X'],['light','浅色'],['dark','深色']]))));
 view.append(el(d,'section',{id:'pk-feishu',class:'pk-settings-card'},el(d,'div',{class:'pk-settings-row'},el(d,'span',{},el(d,'strong',{text:'飞书收藏'}),el(d,'small',{text:'将喜欢的内容收藏到飞书'})),el(d,'span',{class:'pk-ai-muted',text:'即将开放'}))));
 const reset=button(d,'恢复默认',()=>{undo={...prefs};save({...DEFAULTS});});
 reset.id='pk-reset';
 const bottom=el(d,'div',{id:'pk-bottom',class:'pk-settings-bottom'},el(d,'span',{'role':'status',text:notice||'更改自动保存'}),reset);
 if(undo)bottom.append(identified(button(d,'撤销',()=>{const previous=undo;undo=null;save(previous);}),'pk-undo'));if(lastFailed)bottom.append(identified(button(d,'重试保存',()=>save(lastFailed)),'pk-retry-save'));view.append(bottom);
 if(notice)view.append(el(d,'p',{id:'pk-notice',class:'pk-settings-notice',text:notice}));
 view.append(el(d,'p',{id:'pk-privacy',class:'pk-settings-privacy',text:'当前字幕或完整长文仅发送至当前启用的 AI 服务。豆包使用浏览器已有会话；自定义服务使用你配置的 Key。切换保留其他连接；失败不会自动换服务。'}));
 const diagnostics=el(d,'details',{id:'pk-diagnostics',class:'pk-settings-diagnostics'},el(d,'summary',{id:'pk-diagnostics-toggle',text:'验收信息（不保活）'}),el(d,'pre',{text:JSON.stringify({version:chrome.runtime.getManifest().version,state:connection.state,diagnostics:connection.diagnostics},null,2)}));view.append(diagnostics);
 patchChildren(root,view);
 if(active&&(!active.isConnected||active.disabled||d.activeElement!==active)){
  const fallback=active.id==='pk-pref-timeline'?'pk-pref-summary':active.id.startsWith('pk-defaultView-')?(prefs.summary?'pk-pref-summary':'pk-pref-mindmap'):'pk-reset';
  const same=d.getElementById(active.id),target=same&&!same.disabled?same:d.getElementById(fallback);
  target?.focus({preventScroll:true});
 }
}
async function refresh(){if(busy||providerBusy||providerDialog||pendingSaves)return;const revision=++refreshRevision;try{const [saved,state,list]=await Promise.all([send('preferences'),send('status'),send('providers').catch(()=>null)]);if(revision!==refreshRevision||busy||providerBusy||providerDialog)return;connection=state;if(list?.services)providers=list;if(!pendingSaves){prefs=saved;confirmedPrefs={...saved};}applyTheme();render();}catch(e){if(revision!==refreshRevision||busy)return;notice=errorText(e.message);render();}}
window.addEventListener('focus',refresh);matchMedia('(prefers-color-scheme: dark)').addEventListener('change',applyTheme);
refresh();
