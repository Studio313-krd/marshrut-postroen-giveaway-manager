// Executed in the page. Scroll the INNER pane located from comment permalinks.
export function inspectCommentPane({code,reset=false,advance=false}={}) {
  const links=[...document.querySelectorAll('a[href*="/c/"]')].filter(a=>{try{return new URL(a.href).pathname.match(/^\/(?:p|reel)\/([^/]+)\/c\//)?.[1]===code;}catch{return false;}});
  const candidates=new Map();
  for(const link of links)for(let node=link.parentElement;node&&node!==document.body;node=node.parentElement){
    const style=getComputedStyle(node),rect=node.getBoundingClientRect();
    if(/auto|scroll|overlay/.test(style.overflowY)&&node.clientHeight>=100&&rect.width>=180&&node.scrollHeight>node.clientHeight+2)candidates.set(node,(candidates.get(node)||0)+1);
  }
  let pane=[...candidates].sort(([a,ac],[b,bc])=>bc-ac||a.scrollHeight-b.scrollHeight)[0]?.[0];
  if(!pane)pane=[...document.querySelectorAll('.x5yr21d.xw2csxc.x1odjw0f.x1n2onr6')].find(n=>links.some(a=>n.contains(a))&&n.clientHeight>=100);
  if(!pane)return{found:false,visibleComments:links.length};
  for(const old of document.querySelectorAll('[data-mp-comment-scroll]'))if(old!==pane)old.removeAttribute('data-mp-comment-scroll');
  pane.setAttribute('data-mp-comment-scroll','true');const before=pane.scrollTop;
  if(reset)pane.scrollTop=0;
  else if(advance){const max=pane.scrollHeight-pane.clientHeight;pane.scrollTop=Math.min(max,before+Math.max(80,pane.clientHeight*.72));}
  const rect=pane.getBoundingClientRect(),top=pane.scrollTop,height=pane.scrollHeight,viewport=pane.clientHeight;
  const loading=[...pane.querySelectorAll('[role="progressbar"],[aria-busy="true"],[data-visualcompletion="loading-state"]')].some(n=>n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden');
  return{found:true,top,height,viewport,loading,bottom:height-viewport-top<=3,moved:Math.abs(top-before)>1,visibleComments:links.length,x:Math.max(0,Math.min(innerWidth-1,rect.left+rect.width/2)),y:Math.max(0,Math.min(innerHeight-1,rect.top+rect.height/2))};
}
export function findReplyControls({code}={}) {
  const pane=document.querySelector('[data-mp-comment-scroll]');if(!pane)return[];
  const pattern=/^(?:view|show|load)(?:\s+all|\s+more)?\s+(?:\d+\s+)?repl(?:y|ies)(?:\s*\(\d+\)|\s+\d+)?$|^(?:посмотреть|показать|загрузить|смотреть)(?:\s+все|\s+ещ[её])?\s+(?:\d+\s+)?ответ(?:ы|ов|а)?(?:\s*\(\d+\)|\s+\d+)?$/i;
  const result=[];
  for(const element of pane.querySelectorAll('button,[role="button"],span')){
    const text=element.textContent.trim();if(!pattern.test(text)||!element.getClientRects().length)continue;
    const button=element.closest('button,[role="button"]')||element;
    if(result.some(item=>item.element===button||item.element.contains(button)))continue;
    let container=button.parentElement,parentId='';
    for(let depth=0;container&&container!==pane&&depth<9;depth++,container=container.parentElement){const anchor=[...container.querySelectorAll('a[href*="/c/"]')].find(a=>a.getAttribute('href').includes('/'+code+'/c/'));if(anchor){parentId=anchor.getAttribute('href').match(/\/c\/(\d+)/)?.[1]||'';break;}}
    result.push({element:button,parentId,text});
  }
  return result.map((item,index)=>{item.element.setAttribute('data-mp-replies',String(index));return{index,parentId:item.parentId,text:item.text};});
}
export function hasTerminalComment(rows,owner){return rows.some(row=>row.username===owner&&/^КАК ПРАВИЛЬНО ПОСТРОИТЬ СВОЙ МАРШРУТ/u.test(row.text)&&row.text.includes('Полные правила конкурса'));}
export function completionEvidence({count,reportedCount,terminalCommentSeen,atBottom,stablePasses,pendingReplies=0,stopped=false,loginRequired=false,loading=false,hasNextPage=false}){
  const reachedEnd=!!atBottom&&stablePasses>=4&&pendingReplies===0&&!stopped&&!loginRequired&&!loading&&!hasNextPage;
  const countMatches=Number.isInteger(reportedCount)&&count>=reportedCount;
  return{reachedEnd,terminalCommentSeen:!!terminalCommentSeen,countMatches,completeness:loginRequired||stopped||!reachedEnd||(Number.isInteger(reportedCount)&&!countMatches)?'partial':'unverified'};
}
