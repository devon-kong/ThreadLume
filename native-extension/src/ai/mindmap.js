import {el,button} from './dom.js';
// Stable path keys are shared by closed-node previews and the final tree.
export function createMindmap(document){
 const root=el(document,'div',{class:'pk-ai-map',tabindex:'0','aria-label':'思维导图：拖动平移，使用缩放按钮或 Ctrl 加滚轮缩放'}),layer=el(document,'div',{class:'pk-ai-map-layer'}),svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
 svg.setAttribute('aria-hidden','true');layer.append(svg);root.append(layer);
 const nodes=new Map(),edges=new Map(),expanded=new Map();let tree=[],camera={x:16,y:16,scale:1},drag=null,first=true,width=0,height=0,closed=false;
 const apply=()=>{layer.style.transform=`translate(${camera.x}px,${camera.y}px) scale(${camera.scale})`;};
 const fit=()=>{first=false;camera={x:16,y:16,scale:Math.max(.65,Math.min(1,((root.clientWidth||640)-32)/Math.max(1,width),((root.clientHeight||280)-32)/Math.max(1,height)))};apply();};
 function update(next){
  if(closed)return;tree=next;const alive=new Set(),lines=new Set();let cursor=0; width=0;
  function layout(n,id,depth,parent){
   id=n.id||id;alive.add(id);let item=nodes.get(id);
   if(!item){const node=button(document,'',()=>{expanded.set(id,node.getAttribute('aria-expanded')!=='true');update(tree);},'pk-ai-node');node.dataset.nodeId=id;layer.append(node);item={node};nodes.set(id,item);}
   const children=n.children||[],open=expanded.has(id)?expanded.get(id):id.split('.').length<2;
   if(item.label!==n.text){item.node.textContent=n.text;item.node.title=n.text;item.label=n.text;item.measured=false;}item.node.setAttribute('aria-expanded',String(!!children.length&&open));
   item.node.dataset.branch=String(Number(id.split('.')[1]||id.split('.')[0])%4);
   item.node.hidden=false;
   // Labels have a fixed CSS width/font. Re-measure only new or changed text;
   // hidden-layout estimates remain provisional until a real height is available.
   if(!item.measured){Object.assign(item.node.style,{width:'180px',height:'auto'});const measured=item.node.scrollHeight;item.h=Math.max(44,Math.min(240,measured?measured+2:Math.ceil([...n.text].length/12)*19+22));item.measured=measured>0;}
   const nodeHeight=item.h,top=cursor,x=depth*220;
   if(children.length&&open)for(let i=0;i<children.length;i++)layout(children[i],id+'.'+i,depth+1,id);else cursor+=nodeHeight+24;
   const y=children.length&&open?(top+cursor-24-nodeHeight)/2:top;item.x=x;item.y=y;item.h=nodeHeight;
   Object.assign(item.node.style,{left:x+'px',top:y+'px',height:nodeHeight+'px',width:'180px'});width=Math.max(width,x+180);
   if(parent)lines.add(parent+'>'+id);return item;
  }
  tree.forEach((n,i)=>layout(n,String(i),0,null));height=cursor;
  for(const [id,item] of nodes){item.node.hidden=!alive.has(id);}
  for(const key of lines){const [a,b]=key.split('>'),start=nodes.get(a),end=nodes.get(b);let path=edges.get(key);if(!path){path=document.createElementNS(svg.namespaceURI,'path');svg.append(path);edges.set(key,path);}path.setAttribute('d',`M ${start.x+180} ${start.y+start.h/2} H ${end.x-20} V ${end.y+end.h/2} H ${end.x}`);path.setAttribute('data-branch',end.node.dataset.branch);}
  for(const [key,path] of edges)if(!lines.has(key)){path.remove();edges.delete(key);}
  svg.setAttribute('width',String(width));svg.setAttribute('height',String(height));Object.assign(layer.style,{width:width+'px',height:height+'px'});
  if(first&&tree.length&&(!tree[0].id||!tree[0].id.includes('.'))&&root.clientHeight>0){const main=nodes.get(tree[0].id||'0');first=false;camera={x:16,y:(root.clientHeight||280)/2-main.y-main.h/2,scale:1};}apply();
 }
 const pointerDown=e=>{if(e.button!==0||e.target.closest('button'))return;first=false;drag={id:e.pointerId,x:e.clientX,y:e.clientY,cx:camera.x,cy:camera.y};root.setPointerCapture?.(e.pointerId);};
 const pointerMove=e=>{if(!drag||drag.id!==e.pointerId)return;camera.x=drag.cx+e.clientX-drag.x;camera.y=drag.cy+e.clientY-drag.y;apply();};
 const pointerUp=e=>{if(drag?.id===e.pointerId)drag=null;};
 const zoom=delta=>{first=false;camera.scale=Math.max(.4,Math.min(2.5,camera.scale+delta));apply();};
 const wheel=e=>{if(!e.ctrlKey&&!e.metaKey)return;e.preventDefault();zoom(e.deltaY<0?.1:-.1);};
 const key=e=>{if(e.target!==root)return;const delta={ArrowLeft:[30,0],ArrowRight:[-30,0],ArrowUp:[0,30],ArrowDown:[0,-30]}[e.key];if(delta){e.preventDefault();first=false;camera.x+=delta[0];camera.y+=delta[1];apply();}};
 root.addEventListener('pointerdown',pointerDown);root.addEventListener('pointermove',pointerMove);root.addEventListener('pointerup',pointerUp);root.addEventListener('pointercancel',pointerUp);root.addEventListener('wheel',wheel,{passive:false});root.addEventListener('keydown',key);
 return {root,update,zoom,fit,snapshot:()=>({...camera}),destroy(){closed=true;root.remove();nodes.clear();edges.clear();expanded.clear();tree=[];}};
}
