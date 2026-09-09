import {assert,normalizeComments,digest,event} from './domain.js';

export function importSource(c,parsed,filename) {
  assert(!c.snapshot,'Список зафиксирован; заменять исходный файл уже нельзя.',409);
  // Keep every Excel row, including repeated authors, repeated external IDs and
  // identical comments. Only the manager/AI evaluates competition eligibility.
  const comments=normalizeComments(parsed.rows.map((row,index)=>({...row,id:`xlsx-row-${index+1}`})),{preserveText:true,allowEmptyText:true});
  c.comments=comments;c.source={kind:'excel',label:String(filename||'comments.xlsx').slice(0,200),at:new Date().toISOString(),completeness:'unverified',count:comments.length,accounts:new Set(comments.map(c=>c.username)).size,sheet:parsed.sheet,columns:parsed.columns};
  c.workflow='external';c.prompt='';c.selectedComments=[];c.selection=null;c.overrides={};c.acknowledged=false;c.sourceAccepted=false;
  event(c,'comments_imported',{...c.source,hash:digest(comments)});
  return c;
}
