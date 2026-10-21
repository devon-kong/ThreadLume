import {excludedArticleText} from './article-text.js';
import {seekNative} from './content-source.js';
// Ephemeral source-only index. Range references never wrap or move native DOM.
export function createSourceSearch(input,document){
 let entries=[],matches=[],closed=false;const win=document.defaultView,highlight='peek-source-match';
 function snapshot(){const result=[];if(input.kind==='video')return (input.cues||[]).map(c=>({text:c.text,time:c.start}));
 if(input.article){
  let roots=[...input.article.querySelectorAll('[data-testid="twitter-article-title"], [data-testid="twitterArticleRichTextView"]')];
  if(!roots.length)roots=[...input.article.querySelectorAll('[data-testid="tweetText"]')];
  for(const root of roots.filter(n=>!n.closest('div[role="link"], [data-testid="card.wrapper"]'))){
   const walker=document.createTreeWalker(root,win.NodeFilter.SHOW_TEXT),nodes=[];let text='',node;
   while((node=walker.nextNode())){if(node.parentElement?.closest('script,style,[hidden]')||excludedArticleText(node,root))continue;nodes.push({node,start:text.length,value:node.data});text+=node.data;}
   result.push({text,nodes});
  }
 }
 return result;}
 entries=snapshot();
 const valid=()=>!closed&&(input.kind==='video'?!!input.video?.isConnected:!!input.article?.isConnected&&entries.every(e=>e.nodes.every(n=>n.node.isConnected&&n.node.data===n.value)));
 const clear=()=>win.CSS?.highlights?.delete(highlight);
 return {
  valid,
  find(query){clear();matches=[];
   // X may replace spans without changing the loaded source. A new user query
   // may remap identical text, but old ranges never survive that replacement.
   if(!closed&&input.kind==='article'&&input.article?.isConnected&&!valid()){const next=snapshot();if(next.length===entries.length&&next.every((e,i)=>e.text===entries[i].text))entries=next;}
   if(!valid()||!query)return matches;query=query.replace(/[A-Z]/g,c=>c.toLowerCase());
   for(const e of entries){const text=e.text.replace(/[A-Z]/g,c=>c.toLowerCase());let from=0,index;
    while(matches.length<500&&(index=text.indexOf(query,from))>=0){from=index+Math.max(1,query.length);const m={context:e.text.slice(Math.max(0,index-35),Math.min(e.text.length,from+55)),time:e.time};
     if(e.nodes){const a=e.nodes.find(n=>n.start+n.value.length>index),b=e.nodes.find(n=>n.start+n.value.length>=from);if(!a||!b)continue;const range=document.createRange();range.setStart(a.node,index-a.start);range.setEnd(b.node,from-b.start);m.range=range;}
     matches.push(m);
    }
   }return matches;
  },
  activate(index){if(!valid()){matches=[];clear();return false;}const match=matches[index];if(!match)return false;
   if(input.kind==='video')return seekNative(input.video,match.time*1000);
   const range=match.range;if(win.Highlight&&win.CSS?.highlights)win.CSS.highlights.set(highlight,new win.Highlight(range));
   const rect=range.getBoundingClientRect?.();if(rect){let node=range.startContainer.parentElement;while(node&&node!==document.body){if(node.scrollHeight>node.clientHeight+1&&/auto|scroll/.test(win.getComputedStyle(node).overflowY)){const box=node.getBoundingClientRect();node.scrollBy({top:rect.top-box.top-node.clientHeight/3,behavior:'auto'});break;}node=node.parentElement;}}
   return true;
  },
  destroy(){closed=true;clear();entries=[];matches=[];}
 };
}
