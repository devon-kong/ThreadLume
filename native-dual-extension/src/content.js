import {installEntry} from './entry.js';
import {pairURL,statusURL} from './controller.js';
import {findFocal,setHidden,detailComposer} from './focal.js';
let role=null,marked=null,host=null,observer=null,timer=null,raf=0,stopped=false,positioned=false,path=location.pathname,routeTimer=null,settleTimer=null,stableSince=0,lastHeight=-1,locateAfterHide=false,entryError='',entryErrorPath='';
const send=message=>chrome.runtime.sendMessage(message);
function stopAuto(){stopped=true;}
function cleanup(){
  setHidden(marked,false);marked=null;clearTimeout(settleTimer);settleTimer=null;host?.remove();host=null;
  observer?.disconnect();observer=null;clearTimeout(timer);timer=null;cancelAnimationFrame(raf);raf=0;clearInterval(routeTimer);routeTimer=null;document.querySelector('#peek-dual-hide-style')?.remove();
  for(const type of ['wheel','touchstart','keydown','pointerdown'])window.removeEventListener(type,stopAuto,true);
}
function update(){
  raf=0;if(!role || pairURL(location.href)!==role.url)return;
  if(role.role!=='right')return;
  const candidate=findFocal(document,role.url);
  const article=detailComposer(candidate)?candidate:null;
  if(marked!==article){setHidden(marked,false);marked=article;}
  setHidden(article,role.hide);
  if(article && locateAfterHide){
    locateAfterHide=false;positioned=true;stopped=true;
    window.scrollTo({top:Math.max(0,detailComposer(article).getBoundingClientRect().top+window.scrollY-52),behavior:'instant'});
  }
  if(article && !positioned && !stopped){
    const rect=(role.hide?detailComposer(article):article).getBoundingClientRect();
    if(rect.height!==lastHeight){lastHeight=rect.height;stableSince=performance.now();}
    const ready=role.hide || ([...article.querySelectorAll('img')].filter(img=>img.loading!=='lazy').every(img=>img.complete) && [...article.querySelectorAll('video')].every(v=>v.readyState>=1));
    if(performance.now()-stableSince>=600 && ready){
      window.scrollTo({top:Math.max(0,(role.hide?rect.top:rect.bottom)+window.scrollY-52),behavior:'instant'});positioned=true;
    }else{clearTimeout(settleTimer);settleTimer=setTimeout(schedule,120);}
  }
}
function schedule(){if(!raf)raf=requestAnimationFrame(update);}
function launcher(error='') {
  if(role)return;
  if(error){entryError=error;entryErrorPath=location.pathname;}
  if(entryErrorPath!==location.pathname){entryError='';entryErrorPath='';}
  error=entryError;
  host?.remove();host=null;
  if(!statusURL(location.href) && !error)return;
  host=document.createElement('div');host.id='peek-dual-launcher';
  host.style.cssText='position:fixed;top:4px;right:12px;z-index:2147483646';
  const shadow=host.attachShadow({mode:'open'});
  shadow.innerHTML='<style>:host{font:13px system-ui}button{font:inherit;color:#fff;background:#17212b;border:1px solid #657786;border-radius:8px;padding:9px 12px;cursor:pointer}span{display:block;max-width:300px;padding:8px;color:#fff;background:#17212b}</style><button>Peek 双页</button><span role="status"></span>';
  shadow.querySelector('span').textContent=error;shadow.querySelector('span').hidden=!error;
  shadow.querySelector('button').onclick=async()=>{
    const button=shadow.querySelector('button');button.disabled=true;button.textContent='正在打开…';
    const result=await send({type:'open'}).catch(e=>({ok:false,error:e.message}));
    if(!result.ok){launcher(result.error);return;}
    await refresh();
  };
  document.documentElement.append(host);
}
async function refresh(){
  const response=await send({type:'role'}).catch(()=>null);const next=response?.value || null;
  if(JSON.stringify(next)===JSON.stringify(role)){if(!role)launcher(response?.ok===false?response.error:'');return;}
  const samePair=role && next && role.url===next.url && role.role===next.role;
  locateAfterHide=Boolean(samePair && positioned && !role.hide && next.hide);
  cleanup();role=next;if(!role){launcher(response?.ok===false?response.error:'');return;}
  if(!samePair){positioned=false;stopped=false;stableSince=0;lastHeight=-1;}
  const style=document.createElement('style');style.id='peek-dual-hide-style';style.textContent='article[data-peek-dual-hidden]{display:none!important}';document.documentElement.append(style);
  path=location.pathname;routeTimer=setInterval(()=>{if(location.pathname!==path){path=location.pathname;if(pairURL(location.href)!==role?.url){cleanup();role=null;void refresh();}}},500);
  host=document.createElement('div');host.id='peek-dual-controls';
  host.style.cssText='position:fixed;top:4px;right:12px;z-index:2147483646';
  const shadow=host.attachShadow({mode:'open'});
  shadow.innerHTML='<style>:host{font:13px system-ui;color:#fff}div{display:flex;align-items:center;gap:8px;background:#17212b;padding:8px;border:1px solid #657786;border-radius:10px}button{font:inherit;color:inherit;background:#263849;border:1px solid #657786;border-radius:5px;padding:4px;cursor:pointer}label{display:flex;gap:4px}</style><div><span></span><label><input type="checkbox">隐藏右页原帖（实验）</label><button>结束双页</button></div>';
  shadow.querySelector('span').textContent=`Peek · ${role.role==='left'?'原帖':'评论'} · ${role.mode==='split'?'浏览器分屏':'并排窗口'}`;
  const checkbox=shadow.querySelector('input');checkbox.checked=role.hide;
  checkbox.onchange=async()=>{const r=await send({type:'hide',value:checkbox.checked});if(!r.ok){checkbox.checked=!checkbox.checked;shadow.querySelector('span').textContent=r.error;}};
  shadow.querySelector('button').onclick=()=>{void send({type:'close'});};
  document.documentElement.append(host);
  for(const type of ['wheel','touchstart','keydown','pointerdown'])window.addEventListener(type,stopAuto,{capture:true,passive:true});
  observer=new MutationObserver(schedule);observer.observe(document.body,{childList:true,subtree:true});
  timer=setTimeout(()=>{stopped=true;if(!positioned && role?.role==='right')shadow.querySelector('span').textContent='Peek · 自动定位未完成，请手动滚动';if(!role?.hide){observer?.disconnect();observer=null;}},10000);
  update();
}
chrome.runtime.onMessage.addListener((m,_sender,reply)=>{
  if(m.type==='refresh')void refresh();
  if(m.type==='open-error')launcher(m.error);
  if(m.type==='status'){reply({role:role?.role || null,mode:role?.mode || null,hide:role?.hide || false,controls:!!document.getElementById('peek-dual-controls'),launcher:!!document.getElementById('peek-dual-launcher'),viewport:[innerWidth,innerHeight],visibility:document.visibilityState,y:scrollY,nativeArticles:document.querySelectorAll('article[data-testid="tweet"]').length,players:document.querySelectorAll('video').length,hiddenArticles:document.querySelectorAll('[data-peek-dual-hidden]').length});}
});
installEntry({win:window,send,onRoute:()=>{void refresh();},onError:error=>launcher(error)});
window.addEventListener('pagehide',()=>{cleanup();role=null;});
window.addEventListener('pageshow',()=>{void refresh();});
void refresh();
