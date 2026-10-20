// Session-only numeric diagnostics. Never accept arbitrary metadata or text.
const STAGES=new Set(['admitted','queued','executing','request','response','firstByte','uploadStart','uploadDone','parsed','cacheStart','cacheSaved','done']);
export const elapsedNumber=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=600000?Math.round(value*10)/10:undefined;
export function createMetrics({clock=()=>performance.now(),limit=60,onChange=()=>{}}={}){
 const rows=[];
 const exportRows=()=>rows.map(({owner,row})=>({owner,row:{...row,stages:{...row.stages}}}));
 const changed=()=>onChange(exportRows());
 function start(owner,requestId,{kind,mode,provider,providerId,configVersion,contentMs,inputCharacters,operation='generate'}={}){
  const row={measurementVersion:3,requestId,kind,mode,provider,operation,cache:'miss',stages:{}},started=clock();
  const entry={owner,row};rows.push(entry);if(rows.length>limit)rows.shift();
  if(elapsedNumber(contentMs)!==undefined)row.contentMs=elapsedNumber(contentMs);
  if(Number.isSafeInteger(inputCharacters)&&inputCharacters>=0)row.inputCharacters=inputCharacters;
  for(const [key,value] of Object.entries({providerId,configVersion}))if(typeof value==='string'&&/^[\w-]{1,100}$/.test(value))row[key]=value;
  changed();
  return {mark(stage){if(STAGES.has(stage)&&row.stages[stage]===undefined){row.stages[stage]=elapsedNumber(clock()-started);changed();}},
   job(id){row.jobId=id;changed();},
   output(count){if(Number.isSafeInteger(count)&&count>=0){row.outputCharacters=count;changed();}},
   cache(value){if(['hit','miss','shared'].includes(value)){row.cache=value;changed();}},
   finish(outcome){row.outcome=['success','cancelled','error'].includes(outcome)?outcome:'error';this.mark('done');}};
 }
 return {start,snapshot:()=>rows.map(({row})=>({...row,stages:{...row.stages}})),
  restore(saved){
   if(!Array.isArray(saved))return;
   for(const entry of saved.slice(-limit)){
    const r=entry?.row;
    if(typeof entry?.owner!=='string'||entry.owner.length>250||!r||typeof r.requestId!=='string'||!/^[\w-]{1,100}$/.test(r.requestId)||!['video','article'].includes(r.kind)||!['article','summary','mindmap'].includes(r.mode)||!['custom','doubao'].includes(r.provider)||!['cache','generate'].includes(r.operation)||!['hit','miss','shared'].includes(r.cache))continue;
    const row={measurementVersion:[2,3].includes(r.measurementVersion)?r.measurementVersion:1,requestId:r.requestId,kind:r.kind,mode:r.mode,provider:r.provider,operation:r.operation,cache:r.cache,stages:{},outcome:['success','error','cancelled'].includes(r.outcome)?r.outcome:'interrupted'};
    for(const key of ['contentMs','displayMs','firstVisibleMs','firstReadableMs','inputCharacters','outputCharacters'])if(elapsedNumber(r[key])!==undefined)row[key]=elapsedNumber(r[key]);
    if(row.measurementVersion===1&&row.firstReadableMs!==undefined){row.firstVisibleMs=row.firstReadableMs;delete row.firstReadableMs;}
    if(typeof r.visibilityInterrupted==='boolean')row.visibilityInterrupted=r.visibilityInterrupted;
    if(typeof r.jobId==='string'&&/^[\w-]{1,100}$/.test(r.jobId))row.jobId=r.jobId;
    for(const key of ['providerId','configVersion'])if(typeof r[key]==='string'&&/^[\w-]{1,100}$/.test(r[key]))row[key]=r[key];
    for(const key of STAGES)if(elapsedNumber(r.stages?.[key])!==undefined)row.stages[key]=elapsedNumber(r.stages[key]);
    rows.push({owner:entry.owner,row});
   }
   if(rows.length>limit)rows.splice(0,rows.length-limit);
  },
  display(owner,id,value){const entry=rows.findLast(e=>e.owner===owner&&e.row.requestId===id);if(!entry)return false;
   let dirty=false;for(const key of ['displayMs','firstVisibleMs','firstReadableMs'])if(elapsedNumber(value?.[key])!==undefined&&entry.row[key]===undefined){entry.row[key]=elapsedNumber(value[key]);dirty=true;}
   if(typeof value?.visibilityInterrupted==='boolean'&&entry.row.visibilityInterrupted!==true&&entry.row.visibilityInterrupted!==value.visibilityInterrupted){entry.row.visibilityInterrupted=value.visibilityInterrupted;dirty=true;}
   if(dirty)changed();return true;}};
}
