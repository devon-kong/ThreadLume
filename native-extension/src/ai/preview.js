// Bounded data-only wire format. No model-provided HTML, styles or identifiers.
export const PREVIEW_VERSION=1;
export function identifyTree(tree,prefix=''){
 return tree.map((n,i)=>{const id=prefix?`${prefix}.${i}`:String(i);return {id,text:n.text,children:identifyTree(n.children||[],id)};});
}
export function validPreview(p,language){
 if(!p||p.version!==PREVIEW_VERSION||!['zh-CN','en'].includes(p.outputLanguage)||language&&p.outputLanguage!==language||typeof p.text!=='string'||p.text.length>12000||!Array.isArray(p.highlights)||p.highlights.length>100||!Array.isArray(p.tree))return false;
 if(JSON.stringify(p).length>60000)return false;
 let count=0,total=p.text.length;const ids=new Set();
 const node=(n,depth)=>{
  if(!n||depth>8||++count>200||typeof n.id!=='string'||!/^\d+(\.\d+){0,7}$/.test(n.id)||ids.has(n.id)||typeof n.text!=='string'||!n.text.trim()||n.text.length>1000||!Array.isArray(n.children))return false;
  ids.add(n.id);total+=n.text.length;return n.children.every(c=>node(c,depth+1));
 };
 if(!p.tree.every(n=>node(n,1)))return false;
 let points=0;
 for(const h of p.highlights){if(!h||!Number.isFinite(h.timestamp)||h.timestamp<0||typeof h.chapter!=='string'||h.chapter.length>1000||!Array.isArray(h.bullet_points)||h.bullet_points.length>20)return false;total+=h.chapter.length;
  for(const b of h.bullet_points){if(++points>500||!Number.isFinite(b.timestamp)||b.timestamp<0||typeof b.point!=='string'||b.point.length>1000)return false;total+=b.point.length;}
 }
 return total<=24000;
}
