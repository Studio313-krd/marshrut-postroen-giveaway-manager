// Runs in the Instagram page. Uses stable comment permalinks and semantic text,
// with no dependency on Instagram's generated CSS class names.
export function readDOMComments(code) {
  const rows=[];
  for(const time of document.querySelectorAll('a[href*="/c/"] time')) {
    const link=time.closest('a');const match=new URL(link.href).pathname.match(/^\/(?:p|reel)\/([^/]+)\/c\/(\d+)\/?$/);
    if(!match||match[1]!==code)continue;
    let header=time.parentElement;
    for(let i=0;i<5&&header;i++,header=header.parentElement){
      const author=Array.from(header.querySelectorAll('a[href]')).find(a=>/^\/[a-zA-Z0-9_.]+\/$/.test(a.getAttribute('href')||'')&&!a.textContent.trim().startsWith('@'));
      const sibling=header.nextElementSibling;
      if(!author||!sibling||header.querySelectorAll('time').length!==1)continue;
      const text=sibling.innerText?.trim();if(!text||/^(Нравится|Ответить|Like|Reply)$/.test(text))continue;
      const user=author.getAttribute('href').split('/')[1];
      const ownItem=header.closest('li');const parentItem=ownItem?.parentElement?.closest('li');
      const parentLink=parentItem?.querySelector('a[href*="/c/"]');const parentId=parentLink?.getAttribute('href')?.match(/\/c\/(\d+)/)?.[1]||'';
      rows.push({id:match[2],username:user,text,timestamp:time.getAttribute('datetime')||'',parentId});break;
    }
  }
  return rows;
}
