import {test} from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';
import {createMindmap} from '../../native-extension/src/ai/mindmap.js';
test('incremental SVG map preserves node identity, focus, collapsed branch and manual camera through final update',()=>{
 const w=new JSDOM('<body></body>',{pretendToBeVisual:true}).window,d=w.document,map=createMindmap(d);d.body.append(map.root);
 const tree=[{text:'Root',children:[{text:'Branch',children:[{text:'Leaf',children:[]}]}]}];map.update(tree);const root=map.root.querySelector('[data-node-id="0"]');root.focus();root.click();map.zoom(.2);const camera=map.snapshot();
 map.update([...tree,{text:'New',children:[]}]);assert.equal(map.root.querySelector('[data-node-id="0"]'),root);assert.equal(d.activeElement,root);assert.equal(root.getAttribute('aria-expanded'),'false');assert.deepEqual(map.snapshot(),camera);assert.ok(map.root.querySelector('svg'));map.destroy();w.close();
});
import {readFileSync} from 'node:fs';
test('expanded dialog uses computed hidden visibility and measured multiline node height',()=>{
 const w=new JSDOM('<head><style>'+readFileSync('native-extension/ai.css','utf8')+'</style></head><body><dialog class="pk-ai-map-dialog" open></dialog></body>',{pretendToBeVisual:true}).window,d=w.document,map=createMindmap(d);d.querySelector('dialog').append(map.root);Object.defineProperty(w.HTMLElement.prototype,'scrollHeight',{configurable:true,get(){return this.classList.contains('pk-ai-node')?160:0;}});map.update([{text:'Root',children:[{text:'A lengthy multiline child',children:[]}]}]);const child=map.root.querySelector('[data-node-id="0.0"]');assert.ok(parseFloat(child.style.height)>=160);map.root.querySelector('[data-node-id="0"]').click();assert.equal(child.hidden,true);assert.equal(w.getComputedStyle(child).display,'none');map.destroy();w.close();
});
test('initial tall mindmap keeps readable scale and centers its first main node; manual camera wins over later roots',()=>{
 const w=new JSDOM('<body></body>').window,d=w.document,map=createMindmap(d);d.body.append(map.root);Object.defineProperty(map.root,'clientHeight',{value:110});Object.defineProperty(map.root,'clientWidth',{value:560});
 map.update([{text:'Main topic',children:Array.from({length:12},(_,i)=>({text:'Branch '+i,children:[]}))}]);const node=map.root.querySelector('[data-node-id="0"]'),camera=map.snapshot();assert.equal(camera.scale,1);const center=parseFloat(node.style.top)+parseFloat(node.style.height)/2+camera.y;assert.ok(center>=0&&center<=110);map.destroy();
 const progressive=createMindmap(d);d.body.append(progressive.root);progressive.update([{id:'0.0',text:'Early child',children:[]}]);progressive.zoom(.2);const manual=progressive.snapshot();progressive.update([{id:'0',text:'Root',children:[{id:'0.0',text:'Early child',children:[]}]}]);assert.deepEqual(progressive.snapshot(),manual);progressive.destroy();w.close();
});
test('cached hidden map defers initial framing until its actual viewport is visible',()=>{
 const w=new JSDOM('<body></body>').window,d=w.document,map=createMindmap(d);d.body.append(map.root);let visible=false;Object.defineProperty(map.root,'clientHeight',{get:()=>visible?110:0});const tree=[{text:'Root',children:Array.from({length:5},(_,i)=>({text:'Child '+i,children:[]}))}];map.update(tree);visible=true;map.update(tree);const n=map.root.querySelector('[data-node-id="0"]');assert.equal(parseFloat(n.style.top)+parseFloat(n.style.height)/2+map.snapshot().y,55);map.destroy();w.close();
});
test('unchanged map labels retain text nodes and avoid repeated geometry reads during incremental growth',()=>{
 const w=new JSDOM('<body></body>').window,d=w.document,map=createMindmap(d);d.body.append(map.root);let reads=0;Object.defineProperty(w.HTMLElement.prototype,'scrollHeight',{configurable:true,get(){if(this.classList.contains('pk-ai-node')){reads++;return 44;}return 0;}});const tree=[{text:'Root',children:[{text:'First',children:[]}]}];map.update(tree);const node=map.root.querySelector('[data-node-id="0.0"]'),text=node.firstChild;reads=0;map.update([{text:'Root',children:[...tree[0].children,{text:'Second',children:[]}]}]);assert.equal(node.firstChild,text);assert.equal(reads,1);map.destroy();w.close();
});
test('early child previews do not force a viewport read before a main node is ready to frame',()=>{
 const w=new JSDOM('<body></body>').window,d=w.document,map=createMindmap(d);d.body.append(map.root);let reads=0;Object.defineProperty(map.root,'clientHeight',{get(){reads++;return 110;}});map.update([{id:'0.0',text:'Early child',children:[]}]);assert.equal(reads,0);map.destroy();w.close();
});
test('trackpad pans both axes without scrolling ancestors, while pinch still zooms',()=>{
 const w=new JSDOM('<body></body>').window,map=createMindmap(w.document);w.document.body.append(map.root);const before=map.snapshot();
 const move=new w.WheelEvent('wheel',{deltaX:70,deltaY:-45,bubbles:true,cancelable:true});map.root.dispatchEvent(move);
 assert.equal(move.defaultPrevented,true);assert.deepEqual(map.snapshot(),{x:before.x-70,y:before.y+45,scale:before.scale});
 map.root.dispatchEvent(new w.WheelEvent('wheel',{deltaY:-10,ctrlKey:true,cancelable:true}));assert.ok(map.snapshot().scale>before.scale);map.destroy();w.close();
});
