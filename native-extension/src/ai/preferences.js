export const DEFAULTS=Object.freeze({summary:true,timeline:true,mindmap:true,defaultView:'summary',theme:'system'});
export function normalizePreferences(value={}){
 const p={...DEFAULTS};
 for(const k of ['summary','timeline','mindmap'])if(typeof value[k]==='boolean')p[k]=value[k];
 if(['summary','mindmap'].includes(value.defaultView))p.defaultView=value.defaultView;
 if(['system','light','dark'].includes(value.theme))p.theme=value.theme;
 return p;
}
export function modesFor(input,p){return input.kind==='article'?[...(p.summary?['article']:[]),...(p.mindmap?['mindmap']:[])]:p.summary&&p.mindmap?(p.defaultView==='mindmap'?['mindmap','summary']:['summary','mindmap']):p.summary?['summary']:p.mindmap?['mindmap']:[];}
