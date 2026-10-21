import {el,button} from './dom.js';
// Path-derived branch colors survive child-first streaming and final hydration.
const COLORS=['#3975d5','#238768','#bc781d','#8659c5','#168795','#bc5577'];
function branchColor(id){
 const parts=id.split('.');
 const numeric=parts.slice(0,2).every(p=>/^\d+$/.test(p));
 const index=numeric?Number(parts[0])*3+Number(parts[1]||0):[...parts.slice(0,2).join('.')].reduce((n,c)=>(n*31+c.charCodeAt(0))%997,0);
 return COLORS[index%COLORS.length];
}
export function initialExpandedDepth(tree,budget=24){
 const count=(nodes,depth)=>nodes.reduce((n,item)=>n+1+(depth>0?count(item.children||[],depth-1):0),0);
 for(const depth of [2,1,0])if(count(tree,depth)<=budget)return depth;
 return 0;
}
export function createMindmap(document,{expandedDepth=1}={}){
 const root=el(document,'div',{class:'pk-ai-map',tabindex:'0','aria-label':'思维导图：拖动平移，使用缩放按钮或 Ctrl 加滚轮缩放'}),layer=el(document,'div',{class:'pk-ai-map-layer'}),svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
 svg.setAttribute('aria-hidden','true');layer.append(svg);root.append(layer);
 const nodes=new Map(),edges=new Map(),expanded=new Map();let tree=[],camera={x:24,y:24,scale:1},drag=null,first=true,width=0,height=0,closed=false;
 const apply=()=>{layer.style.transform=`translate(${camera.x}px,${camera.y}px) scale(${camera.scale})`;};
 const fit=()=>{
  first=false;const w=root.clientWidth||640,h=root.clientHeight||280;
  const scale=Math.max(.01,Math.min(1,(w-48)/Math.max(1,width),(h-48)/Math.max(1,height)));
  camera={x:Math.max(24,(w-width*scale)/2),y:Math.max(24,(h-height*scale)/2),scale};apply();
 };
 function update(next){
  if(closed)return;tree=next;const alive=new Set(),lines=new Set();width=0;
  function measure(n,path,depth){
   const id=n.id||path;alive.add(id);let item=nodes.get(id);
   if(!item){
    const label=el(document,'span',{class:'pk-ai-node-label'}),toggle=el(document,'span',{class:'pk-ai-node-toggle','aria-hidden':'true'});
    const node=button(document,'',()=>{if(!item.children.length)return;expanded.set(id,node.getAttribute('aria-expanded')!=='true');update(tree);},'pk-ai-node');
    node.dataset.nodeId=id;node.append(label,toggle);layer.append(node);item={node,labelNode:label,toggle,children:[]};nodes.set(id,item);
   }
   const children=n.children||[],level=id.split('.').length-1,open=expanded.has(id)?expanded.get(id):level<expandedDepth;
   item.children=children;item.node.dataset.depth=String(level);item.node.style.setProperty('--pk-branch',branchColor(id));
   item.node.dataset.branch=id.split('.').slice(0,2).join('.');item.node.hidden=false;
   const textWidth=[...n.text].reduce((sum,c)=>sum+(/[\u0000-\u00ff]/.test(c)?7:14),0);
   const nodeWidth=Math.max(level===0?160:128,Math.min(level===0?240:224,textWidth+32+(children.length?30:0)));
   if(item.label!==n.text||item.w!==nodeWidth){item.labelNode.textContent=n.text;item.node.title=n.text;item.label=n.text;item.measured=false;}
   if(children.length){item.node.setAttribute('aria-expanded',String(open));item.node.setAttribute('aria-label',`${n.text}，${open?'收起':'展开'} ${children.length} 个子主题`);}
   else{item.node.removeAttribute('aria-expanded');item.node.setAttribute('aria-label',n.text);}
   const marker=children.length?(open?'−':String(children.length)):'';
   if(item.toggle.textContent!==marker){item.toggle.textContent=marker;item.measured=false;}
   item.toggle.hidden=!children.length;
   if(!item.measured){
    Object.assign(item.node.style,{width:nodeWidth+'px',height:'auto'});
    const measured=item.node.scrollHeight;
    item.h=Math.max(44,Math.min(240,measured?measured+2:Math.ceil(textWidth/Math.max(80,nodeWidth-52))*21+20));item.measured=measured>0;
   }
   item.w=nodeWidth;item.id=id;item.depth=depth;
   item.visibleChildren=children.length&&open?children.map((c,i)=>measure(c,id+'.'+i,depth+1)):[];
   item.childrenHeight=item.visibleChildren.reduce((sum,c)=>sum+c.total,0)+Math.max(0,item.visibleChildren.length-1)*18;
   item.total=Math.max(item.h,item.childrenHeight);return item;
  }
  function place(item,x,top){
   item.x=x;item.y=top+(item.total-item.h)/2;
   Object.assign(item.node.style,{left:x+'px',top:item.y+'px',height:item.h+'px',width:item.w+'px'});width=Math.max(width,x+item.w);
   let childTop=top+(item.total-item.childrenHeight)/2;
   for(const child of item.visibleChildren){place(child,x+item.w+48,childTop);childTop+=child.total+18;lines.add(item.id+'>'+child.id);}
  }
  let cursor=0;for(const [i,n] of tree.entries()){const item=measure(n,String(i),0);place(item,0,cursor);cursor+=item.total+28;}height=Math.max(0,cursor-28);
  for(const [id,item] of nodes)item.node.hidden=!alive.has(id);
  for(const key of lines){
   const [a,b]=key.split('>'),start=nodes.get(a),end=nodes.get(b);let path=edges.get(key);
   if(!path){path=document.createElementNS(svg.namespaceURI,'path');svg.append(path);edges.set(key,path);}
   const x=start.x+start.w,y=start.y+start.h/2,ey=end.y+end.h/2,mid=(x+end.x)/2;
   path.setAttribute('d',`M ${x} ${y} C ${mid} ${y}, ${mid} ${ey}, ${end.x} ${ey}`);
   path.dataset.target=b;path.dataset.branch=end.node.dataset.branch;path.style.setProperty('--pk-branch',end.node.style.getPropertyValue('--pk-branch'));
  }
  for(const [key,path] of edges)if(!lines.has(key)){path.remove();edges.delete(key);}
  svg.setAttribute('width',String(width));svg.setAttribute('height',String(height));Object.assign(layer.style,{width:width+'px',height:height+'px'});
  if(first&&tree.length&&(!tree[0].id||!tree[0].id.includes('.'))&&root.clientHeight>0){
   const main=nodes.get(tree[0].id||'0');first=false;camera={x:Math.max(24,((root.clientWidth||640)-width)/2),y:(root.clientHeight||280)/2-main.y-main.h/2,scale:1};
  }apply();
 }
 const pointerDown=e=>{if(e.button!==0||e.target.closest('button'))return;first=false;drag={id:e.pointerId,x:e.clientX,y:e.clientY,cx:camera.x,cy:camera.y};root.setPointerCapture?.(e.pointerId);};
 const pointerMove=e=>{if(!drag||drag.id!==e.pointerId)return;camera.x=drag.cx+e.clientX-drag.x;camera.y=drag.cy+e.clientY-drag.y;apply();};
 const pointerUp=e=>{if(drag?.id===e.pointerId)drag=null;};
 const zoom=delta=>{first=false;const scale=Math.max(.01,Math.min(2.5,camera.scale+delta)),x=(root.clientWidth||640)/2,y=(root.clientHeight||280)/2;camera={x:x-(x-camera.x)*scale/camera.scale,y:y-(y-camera.y)*scale/camera.scale,scale};apply();};
 const wheel=e=>{if(!e.ctrlKey&&!e.metaKey)return;e.preventDefault();zoom(e.deltaY<0?.1:-.1);};
 const key=e=>{if(e.target!==root)return;const delta={ArrowLeft:[30,0],ArrowRight:[-30,0],ArrowUp:[0,30],ArrowDown:[0,-30]}[e.key];if(delta){e.preventDefault();first=false;camera.x+=delta[0];camera.y+=delta[1];apply();}};
 root.addEventListener('pointerdown',pointerDown);root.addEventListener('pointermove',pointerMove);root.addEventListener('pointerup',pointerUp);root.addEventListener('pointercancel',pointerUp);root.addEventListener('wheel',wheel,{passive:false});root.addEventListener('keydown',key);
 return {root,update,zoom,fit,snapshot:()=>({...camera}),destroy(){closed=true;root.remove();nodes.clear();edges.clear();expanded.clear();tree=[];}};
}
