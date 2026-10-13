import {createController} from './controller.js';
const controller=createController(chrome);
let queue=Promise.resolve();
function serial(job){const result=queue.then(job);queue=result.catch(()=>{});return result;}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(sender.id!==chrome.runtime.id)return;
  const tab=sender.tab?.id;
  const popup=sender.url===chrome.runtime.getURL('popup.html');
  if(!popup && (!Number.isInteger(tab) || sender.frameId!==0))return;
  serial(async()=>{
    switch(message.type){
      case 'open': return controller.open(popup?message.tabId:tab);
      case 'prepare-open': if(!popup)return controller.prepare(tab,message.url);break;
      case 'follow-open': if(!popup)return controller.followIntent(tab);break;
      case 'role': if(!popup)await controller.followIntent(tab);return controller.role(popup?message.tabId:tab);
      case 'hide': return controller.hide(popup?message.tabId:tab,message.value);
      case 'close': return controller.close(popup?message.tabId:tab);
    }
  }).then(value=>reply({ok:true,value}),error=>reply({ok:false,error:error.message}));
  return true;
});
chrome.tabs.onRemoved.addListener(()=>{void serial(()=>controller.reconcile());});
chrome.tabs.onUpdated.addListener((id,change)=>{if(change.url || change.splitViewId!==undefined)void serial(async()=>{await controller.reconcile();if(change.url)await controller.followIntent(id);}).catch(error=>{void chrome.tabs.sendMessage(id,{type:'open-error',error:error.message}).catch(()=>{});});});

chrome.tabs.onAttached.addListener(()=>{void serial(()=>controller.reconcile());});
