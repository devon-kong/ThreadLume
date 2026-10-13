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
      case 'open': if(popup)return controller.open(message.tabId);break;
      case 'role': return controller.role(popup?message.tabId:tab);
      case 'hide': return controller.hide(popup?message.tabId:tab,message.value);
      case 'close': return controller.close(popup?message.tabId:tab);
    }
  }).then(value=>reply({ok:true,value}),error=>reply({ok:false,error:error.message}));
  return true;
});
chrome.tabs.onRemoved.addListener(()=>{void serial(()=>controller.reconcile());});
chrome.tabs.onUpdated.addListener((_id,change)=>{if(change.url || change.splitViewId!==undefined)void serial(()=>controller.reconcile());});

chrome.tabs.onAttached.addListener(()=>{void serial(()=>controller.reconcile());});
