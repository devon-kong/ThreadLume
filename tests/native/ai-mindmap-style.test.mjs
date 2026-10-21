import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createMindmap,initialExpandedDepth} from '../../native-extension/src/ai/mindmap.js';
function fixture(options){
 const w=new JSDOM('<body></body>',{pretendToBeVisual:true}).window;
 const map=createMindmap(w.document,options);w.document.body.append(map.root);
 Object.defineProperties(map.root,{clientWidth:{value:800},clientHeight:{value:400}});
 return {w,map,node:id=>map.root.querySelector(`[data-node-id="${id}"]`),close(){map.destroy();w.close();}};
}
const tree=[{text:'主题',children:[{text:'起源',children:[{text:'历史脉络',children:[]}]},{text:'发展',children:[{text:'未来方向',children:[]}]}]}];
test('branch lines and descendants share a distinct visible color, including the first branch',()=>{
 const f=fixture();try{
  f.map.update(tree);f.node('0.0').click();f.node('0.1').click();
  const color=n=>n.style.getPropertyValue('--pk-branch');
  assert.ok(color(f.node('0.0')));assert.notEqual(color(f.node('0.0')),color(f.node('0.1')));
  assert.equal(color(f.node('0.0.0')),color(f.node('0.0')));
  assert.equal(color(f.node('0.1.0')),color(f.node('0.1')));
  for(const edge of f.map.root.querySelectorAll('path'))assert.equal(edge.style.getPropertyValue('--pk-branch'),color(f.node(edge.dataset.target)));
 }finally{f.close();}
});
test('early child previews keep branch color and node identity when their parent arrives',()=>{
 const f=fixture();try{f.map.update([{id:'0.1',text:'发展',children:[]}]);const n=f.node('0.1'),color=n.style.getPropertyValue('--pk-branch');assert.ok(color);f.map.update(tree);assert.equal(f.node('0.1'),n);assert.equal(n.style.getPropertyValue('--pk-branch'),color);}finally{f.close();}
});
test('collapsed branches reveal hidden child count and leaves do not pretend to be expandable',()=>{
 const f=fixture();try{f.map.update(tree);assert.match(f.node('0.0').getAttribute('aria-label'),/Expand.*1/);assert.equal(f.node('0.0').getAttribute('aria-expanded'),'false');f.node('0.0').click();assert.match(f.node('0.0').getAttribute('aria-label'),/Collapse/);assert.equal(f.node('0.0.0').hasAttribute('aria-expanded'),false);}finally{f.close();}
});
test('fit centers a compact diagram in both axes and long labels get more room than short labels',()=>{
 const f=fixture();try{f.map.update([{text:'主题',children:[{text:'短',children:[]},{text:'A longer label that needs more room',children:[]}]}]);assert.ok(parseFloat(f.node('0.1').style.width)>parseFloat(f.node('0.0').style.width));f.map.fit();const layer=f.map.root.querySelector('.pk-ai-map-layer'),c=f.map.snapshot();assert.ok(Math.abs(c.x+(parseFloat(layer.style.width)*c.scale)/2-400)<1);assert.ok(Math.abs(c.y+(parseFloat(layer.style.height)*c.scale)/2-200)<1);}finally{f.close();}
});
test('tall parent labels reserve vertical room without overlapping neighboring roots',()=>{
 const f=fixture();try{Object.defineProperty(f.w.HTMLElement.prototype,'scrollHeight',{configurable:true,get(){return this.dataset.nodeId==='0'?180:44;}});f.map.update([{text:'Tall topic',children:[{text:'one',children:[]}]},{text:'Second topic',children:[]}]);const a=f.node('0'),b=f.node('1');assert.ok(parseFloat(a.style.top)>=0);assert.ok(parseFloat(b.style.top)>=parseFloat(a.style.top)+parseFloat(a.style.height)+16);}finally{f.close();}
});
test('expanded reader can show another level without changing inline collapse state',()=>{
 const inline=fixture(),full=fixture({expandedDepth:2});try{inline.map.update(tree);full.map.update(tree);assert.equal(inline.node('0.0').getAttribute('aria-expanded'),'false');assert.equal(full.node('0.0').getAttribute('aria-expanded'),'true');assert.ok(full.node('0.0.0'));}finally{inline.close();full.close();}
});
test('fit includes every root of a tall map instead of clipping at a minimum scale',()=>{
 const f=fixture({expandedDepth:2});try{
  f.map.update(Array.from({length:2},(_,i)=>({text:'Root '+i,children:Array.from({length:10},(_,j)=>({text:'Detail '+j,children:[]}))})));f.map.fit();
  const c=f.map.snapshot(),layer=f.map.root.querySelector('.pk-ai-map-layer');assert.ok(c.y+parseFloat(layer.style.height)*c.scale<=376);assert.ok(c.y>=24);
 }finally{f.close();}
});

test('large expanded dialogs start with readable collapsed branches while small maps show detail',()=>{
 assert.equal(initialExpandedDepth(tree),2);
 const large=[{text:'Root',children:Array.from({length:9},(_,i)=>({text:'Theme '+i,children:Array.from({length:5},()=>({text:'Detail',children:[]}))}))}];
 assert.equal(initialExpandedDepth(large),1);
 assert.equal(initialExpandedDepth(Array.from({length:6},()=>large[0])),0);
});
