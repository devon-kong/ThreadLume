// Deliberately bounded Markdown subset. Model text is never parsed as HTML;
// unsupported syntax stays text and cannot create links, scripts or assets.
const rendered=new WeakMap();
function inline(document,parent,text,depth=0){
 if(depth>8){parent.append(document.createTextNode(text));return;}
 const pattern=/\\([\\`*_{}\[\]()#+.!>-])|`([^`\n]+)`|\*\*(.+?)\*\*|__(.+?)__|\*([^*\n]+)\*|_([^_\n]+)_/g;
 let from=0,match;
 while((match=pattern.exec(text))){
  parent.append(document.createTextNode(text.slice(from,match.index)));
  if(match[1])parent.append(document.createTextNode(match[1]));
  else{const tag=match[2]?'code':match[3]||match[4]?'strong':'em',node=document.createElement(tag),value=match[2]||match[3]||match[4]||match[5]||match[6];if(tag==='code')node.textContent=value;else inline(document,node,value,depth+1);parent.append(node);}
  from=pattern.lastIndex;
 }
 parent.append(document.createTextNode(text.slice(from)));
}
function blocks(text){
 const lines=text.replace(/\r\n?/g,'\n').split('\n'),result=[];
 for(let i=0;i<lines.length;){
  const line=lines[i];if(!line.trim()){i++;continue;}
  const fence=line.match(/^\s*(`{3,}|~{3,})/);
  if(fence){const raw=[line],body=[];i++;while(i<lines.length&&!new RegExp('^\\s*'+fence[1][0]+'{'+fence[1].length+',}\\s*$').test(lines[i])){raw.push(lines[i]);body.push(lines[i++]);}if(i<lines.length)raw.push(lines[i++]);result.push({tag:'pre',raw:raw.join('\n'),text:body.join('\n')});continue;}
  const heading=line.match(/^(#{1,6})\s+(.+)$/);
  if(heading){result.push({tag:'h'+Math.min(6,heading[1].length+2),raw:line,text:heading[2]});i++;continue;}
  if(/^\s*>\s?/.test(line)){const raw=[];while(i<lines.length&&/^\s*>\s?/.test(lines[i]))raw.push(lines[i++]);result.push({tag:'blockquote',raw:raw.join('\n'),text:raw.map(l=>l.replace(/^\s*>\s?/,'' )).join('\n')});continue;}
  const list=line.match(/^\s*(?:([-+*•])|(\d+)[.)])\s+(.+)$/);
  if(list){const tag=list[2]?'ol':'ul',raw=[],items=[];let next;
   while(i<lines.length&&(next=lines[i].match(/^\s*(?:([-+*•])|(\d+)[.)])\s+(.+)$/))&&(next[2]?'ol':'ul')===tag){raw.push(lines[i++]);items.push(next[3]);}
   result.push({tag,raw:raw.join('\n'),items,start:list[2]});continue;
  }
  // Each source line is a paragraph: completed lines retain DOM identity when
  // the streaming tail grows, preserving reading position and text selection.
  result.push({tag:'p',raw:line,text:line});i++;
 }
 return result;
}
export function renderMarkdown(document,target,text){
 const previous=rendered.get(target)||[],next=blocks(text),cache=[];
 next.forEach((block,index)=>{
  const old=previous[index];let node=old?.tag===block.tag&&old.raw===block.raw?old.node:null;
  if(!node){node=document.createElement(block.tag);
   if(block.tag==='pre'){const code=document.createElement('code');code.textContent=block.text;node.append(code);}
   else if(block.items){if(block.tag==='ol'&&block.start!=='1')node.setAttribute('start',block.start);for(const item of block.items){const li=document.createElement('li');inline(document,li,item);node.append(li);}}
   else inline(document,node,block.text);
  }
  if(target.children[index]!==node){if(target.children[index])target.children[index].replaceWith(node);else target.append(node);}
  cache.push({...block,node});
 });
 while(target.children.length>next.length)target.lastElementChild.remove();rendered.set(target,cache);
}
