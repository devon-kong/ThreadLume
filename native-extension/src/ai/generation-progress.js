// Only bounded stage data crosses from the worker to the reader.
export function taskProgressEvent(e){
 if(!e||!['plan','segment','integrate'].includes(e.stage)||!Number.isInteger(e.total)||e.total<1||e.total>8)return null;
 const out={stage:e.stage,total:e.total};
 if(e.stage==='plan'){if(!Number.isInteger(e.requests)||![1,e.total+1].includes(e.requests))return null;out.requests=e.requests;}
 if(e.stage==='segment'){
  if(!Number.isInteger(e.completed)||e.completed<0||e.completed>e.total)return null;out.completed=e.completed;
  if(e.text!==undefined){if(typeof e.text!=='string'||e.text.length>12000)return null;out.text=e.text;}
 }
 return out;
}
