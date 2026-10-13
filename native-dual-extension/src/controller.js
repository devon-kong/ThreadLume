export function statusURL(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || !['x.com','twitter.com'].includes(u.hostname) || u.username || u.password || u.port || !/^\/[\w]+\/status\/\d+\/?$/.test(u.pathname)) return null;
    return `${u.origin}${u.pathname.replace(/\/$/,'')}`;
  } catch { return null; }
}
export function pairURL(value) {
  try {const u=new URL(value);u.pathname=u.pathname.replace(/\/(photo|video)\/\d+\/?$/, '');return statusURL(u.href);}catch{return null;}
}
const geometry = w => Object.fromEntries(['left','top','width','height'].map(k=>[k,w[k]]));
export function createController(api) {
  const read = async () => (await api.storage.session.get('pair')).pair || null;
  const save = pair => api.storage.session.set({pair});
  const get = id => api.tabs.get(id).catch(()=>null);
  const ping = async p => { if(p) await Promise.allSettled([p.left,p.right].filter(Number.isInteger).map(id=>api.tabs.sendMessage(id,{type:'refresh'}))); };
  const matches = (t,p) => t && pairURL(t.pendingUrl || t.url) === p.url;
  async function restore(p) {
    if(p.mode==='windows' && p.applied) {
      const w=await api.windows.get(p.windowId).catch(()=>null);
      if(w && w.state==='normal' && Object.keys(p.applied).every(k=>w[k]===p.applied[k])) await api.windows.update(p.windowId,p.original).catch(()=>{});
    }
  }
  async function release(p, closeRight=false) {
    // Clear ownership first: duplicate close requests cannot delete another tab.
    await save(null);
    // Removing an owned right tab naturally ends its split. Never unsplit a
    // saved ID: the user may have replaced its other member since creation.
    if(closeRight && matches(await get(p.right),p)) await api.tabs.remove(p.right).catch(()=>{});
    await restore(p);await ping(p);
  }
  async function current() {
    const p=await read();if(!p)return null;
    const left=await get(p.left),right=await get(p.right);
    const moved=left?.windowId!==p.windowId || (p.rightWindowId!=null && right?.windowId!==p.rightWindowId);
    const unsplit=p.mode==='split' && [left,right].some(t=>typeof t?.splitViewId==='number' && t.splitViewId!==p.splitId);
    if(p.pending || moved || unsplit || !matches(left,p) || !matches(right,p)) { await release(p);return null; }
    return p;
  }
  return {
    async open(leftId) {
      const existing=await current();
      if(existing) { if(existing.left===leftId || existing.right===leftId)return existing;throw Error('已有双页阅读；请先结束当前配对。'); }
      const left=await api.tabs.get(leftId),url=statusURL(left.url);
      if(!url)throw Error('请先打开 X 原帖详情页，再建立双页阅读。');
      if(left.pinned || left.groupId>=0 || (left.splitViewId!=null && left.splitViewId>=0))throw Error('请使用未固定、未分组、未分屏的原帖标签页。');
      const split=typeof api.tabs.createSplit==='function' && typeof api.tabs.unsplit==='function';
      const w=await api.windows.get(left.windowId);
      if(w.type!=='normal')throw Error('请在普通浏览器窗口打开原帖。');
      if(!split && (w.state!=='normal' || w.width<1000))throw Error('当前浏览器无自动分屏 API。请将普通窗口调整到至少 1000px 宽后重试并排窗口。');
      const p={left:left.id,right:null,url,windowId:left.windowId,mode:split?'split':'windows',hide:false,pending:true,original:geometry(w)};
      await save(p);
      try {
        if(split) {
          const right=await api.tabs.create({url,windowId:left.windowId,index:left.index+1,active:true});p.right=right.id;p.rightWindowId=left.windowId;await save(p);
          p.splitId=await api.tabs.createSplit([left.id,right.id]);
        } else {
          const width=Math.floor(w.width/2);
          const right=await api.windows.create({url,type:'normal',focused:true,left:w.left+width,top:w.top,width:w.width-width,height:w.height});
          p.rightWindowId=right.id;p.right=right.tabs?.[0]?.id;if(!Number.isInteger(p.right))throw Error('新窗口未返回标签页，未改变左页。');
          p.applied={...p.original,width};await save(p);await api.windows.update(w.id,p.applied);
        }
        p.pending=false;await save(p);await ping(p);return p;
      } catch(e) { await release(p,true);throw e; }
    },
    async role(id) {const p=await current();return p && [p.left,p.right].includes(id)?{role:id===p.left?'left':'right',url:p.url,hide:p.hide,mode:p.mode}:null;},
    async hide(id,value) {const p=await current();if(!p || ![p.left,p.right].includes(id))throw Error('配对已结束。');p.hide=Boolean(value);await save(p);await ping(p);},
    async close(id) {const p=await read();if(p && (id==null || [p.left,p.right].includes(id)))await release(p,true);},
    async reconcile(){await current();}
  };
}
