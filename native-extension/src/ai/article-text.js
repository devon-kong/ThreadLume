// Read semantic text only. Player chrome and embedded-post metadata change
// while scrolling; neither belongs to the article's content identity.
const UI='script,style,[hidden],button,[role="button"],[role="group"],[role="slider"],[role="progressbar"],video,audio,[data-testid="videoPlayer"],[data-testid="videoComponent"],[data-testid="tweetPhoto"],[data-testid="tweet-text-show-more-link"]';
const BLOCK='p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,[data-block="true"],[data-testid="tweetText"]';
export function excludedArticleText(node,root){
 const element=node.nodeType===1?node:node.parentElement;
 for(let p=element;p&&p!==root;p=p.parentElement){
  if(p.matches(UI))return true;
  if(p.matches('article[data-testid="tweet"]')&&!element.closest('[data-testid="tweetText"]'))return true;
 }
 return false;
}
export function readArticleText(root){
 if(!root)return '';
 const parts=[];
 const visit=node=>{
  if(node.nodeType===3){parts.push(node.data);return;}
  if(node.nodeType!==1||node.matches(UI))return;
  if(node.tagName==='BR'){parts.push('\n');return;}
  if(node!==root&&node.matches('article[data-testid="tweet"]')){
   parts.push('\n');for(const text of node.querySelectorAll('[data-testid="tweetText"]'))if(text.closest('article[data-testid="tweet"]')===node)visit(text);parts.push('\n');return;
  }
  const block=node!==root&&node.matches(BLOCK);if(block)parts.push('\n');
  for(const child of node.childNodes)visit(child);
  if(block)parts.push('\n');
 };
 visit(root);
 return parts.join('').replace(/[\t\r\f ]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{2,}/g,'\n').trim();
}
