const status=document.querySelector('#status');
for(const type of ['open','close'])document.querySelector(`#${type}`).onclick=async()=>{
  const buttons=[...document.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
  try{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});const result=await chrome.runtime.sendMessage({type,tabId:tab?.id});status.textContent=result.ok?(type==='open'?`已建立${result.value.mode==='split'?'浏览器分屏':'并排窗口'}。右页可切换隐藏原帖。`:'配对已结束。'):result.error;}catch(e){status.textContent=e.message;}finally{buttons.forEach(b=>b.disabled=false);}
};
