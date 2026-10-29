import {parse} from 'acorn';
// Vocabulary strings with a leading space are data, not access to the XHR API.
// Still reject bare identifiers, property references and computed string access.
export function hasXHRAccess(code){
 const stack=[parse(code,{ecmaVersion:'latest',sourceType:'script'})];
 while(stack.length){const node=stack.pop();
  if(node.type==='Identifier'&&node.name==='XMLHttpRequest'||node.type==='Literal'&&node.value==='XMLHttpRequest')return true;
  for(const value of Object.values(node))if(Array.isArray(value)){for(const item of value)if(item?.type)stack.push(item);}else if(value?.type)stack.push(value);
 }
 return false;
}
