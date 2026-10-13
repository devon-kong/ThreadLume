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
  const get = async id => {if(!Number.isInteger(id))return null;try{return await api.tabs.get(id);}catch{return null;}};
  const ping = async p => { if(p) await Promise.allSettled([p.left,p.right].filter(Number.isInteger).map(id=>api.tabs.sendMessage(id,{type:'refresh'}))); };
  const matches = (t,p) => t && pairURL(t.pendingUrl || t.url) === p.url;
  async function release(p, closeOwned=false, reason='close') {
    // Clear ownership before closing. Never remove the user's source page or
    // a carrier the user has navigated or moved out of its owned window.
    await api.storage.session.set({pair:null,lastRelease:{reason,at:Date.now()}});
    if(closeOwned) for(const [id,windowId] of (p.mode==='popups'?[[p.left,p.leftWindowId],[p.right,p.rightWindowId]]:[[p.right,p.rightWindowId]])) {
      const tab=await get(id);
      if(matches(tab,p) && tab.windowId===windowId)await api.tabs.remove(id).catch(()=>{});
    }
    await ping(p);
  }
  async function current() {
    const p=await read();if(!p)return null;
    const left=await get(p.left),right=await get(p.right);
    const moved=left?.windowId!==(p.leftWindowId ?? p.windowId) || (p.rightWindowId!=null && right?.windowId!==p.rightWindowId);
    const unsplit=p.mode==='split' && [left,right].some(t=>typeof t?.splitViewId==='number' && t.splitViewId!==p.splitId);
    if(p.pending || moved || unsplit || !matches(left,p) || !matches(right,p)) { await release(p,false,p.pending?'pending':moved?'moved':unsplit?'unsplit':'route');return null; }
    return p;
  }
  return {
    async prepare(id,url) {
      if(url != null && !statusURL(url))throw Error('无法确认点击的帖子地址。');
      await api.storage.session.set({intent:{id,url:url ? statusURL(url) : null,expires:Date.now()+10000}});
    },
    async followIntent(id) {
      const intent=(await api.storage.session.get('intent')).intent;
      if(!intent || intent.id!==id)return {state:'idle'};
      if(intent.expires<=Date.now()) {await api.storage.session.set({intent:null});return {state:'idle'};}
      const tab=await get(id),url=statusURL(tab?.url);
      if(!url || (intent.url && url!==intent.url))return {state:'waiting'};
      // Consume before creating pages; repeated navigation messages cannot duplicate a pair.
      await api.storage.session.set({intent:null});
      return {state:'opened',pair:await this.open(id)};
    },
    async open(leftId) {
      const existing=await current();
      if(existing) { if([existing.source,existing.left,existing.right].includes(leftId) && matches(await get(leftId),existing))return existing;throw Error('已有双页阅读；请先结束当前配对。'); }
      const left=await api.tabs.get(leftId),url=statusURL(left.url);
      if(!url)throw Error('请先打开 X 原帖详情页，再建立双页阅读。');
      if(left.pinned || left.groupId>=0 || (left.splitViewId!=null && left.splitViewId>=0))throw Error('请使用未固定、未分组、未分屏的原帖标签页。');
      const split=typeof api.tabs.createSplit==='function' && typeof api.tabs.unsplit==='function';
      const w=await api.windows.get(left.windowId);
      if(w.type!=='normal')throw Error('请在普通浏览器窗口打开原帖。');

      const p={source:left.id,left:split?left.id:null,right:null,url,windowId:left.windowId,mode:split?'split':'popups',hide:false,pending:true};
      await save(p);
      try {
        if(split) {
          const right=await api.tabs.create({url,windowId:left.windowId,index:left.index+1,active:true});p.right=right.id;p.rightWindowId=left.windowId;await save(p);
          p.splitId=await api.tabs.createSplit([left.id,right.id]);
        } else {
          // Ego normal windows are Spaces in one shell. Public popup windows
          // are independent visible windows; never resize the user's shell.
          const report=await api.tabs.sendMessage(left.id,{type:'status'}).catch(()=>null);
          const screen=report?.screen;
          const valid=screen && ['left','top','width','height'].every(k=>Number.isFinite(screen[k])) && screen.width>=1000 && screen.width<=10000 && screen.height>=500 && screen.height<=10000;
          const area=valid?screen:geometry(w);
          if(area.width<1000 || area.height<500)throw Error('可用桌面区域不足以显示双页。');
          const gap=8,width=Math.floor((area.width-gap)/2);
          const requestedLeft={left:area.left,top:area.top,width,height:area.height};
          const requestedRight={left:area.left+width+gap,top:area.top,width:area.width-width-gap,height:area.height};
          for(const [side,bounds] of [['left',requestedLeft],['right',requestedRight]]) {
            const carrier=await api.windows.create({url,type:'popup',focused:true,...bounds});
            p[side+'WindowId']=carrier.id;p[side]=carrier.tabs?.[0]?.id;await save(p);
            if(!Number.isInteger(p[side]))throw Error('原生窗口未返回标签页。');
          }
          const placedLeft=await api.windows.get(p.leftWindowId),placedRight=await api.windows.get(p.rightWindowId);
          const positioned=(actual,requested)=>Object.keys(requested).every(k=>Math.abs(actual[k]-requested[k])<=2);
          if(!positioned(placedLeft,requestedLeft) || !positioned(placedRight,requestedRight))throw Error('当前浏览器无法建立真正并排的原生窗口。已保留原页面。');

        }
        p.pending=false;await save(p);await ping(p);return p;
      } catch(e) { await release(p,true,'creation-failed');throw e; }
    },
    async role(id) {const p=await current();return p && [p.left,p.right].includes(id)?{role:id===p.left?'left':'right',url:p.url,hide:p.hide,mode:p.mode}:null;},
    async hide(id,value) {const p=await current();if(!p || ![p.left,p.right].includes(id))throw Error('配对已结束。');p.hide=Boolean(value);await save(p);await ping(p);},
    async close(id) {const p=await read();if(p && (id==null || [p.source,p.left,p.right].includes(id)))await release(p,true);},
    async reconcile(){await current();}
  };
}
