import {normalizeComments} from './domain.js';

// A stalled retry must not discard comments already saved for this contest.
export function collectedImport(previous,rows,source){
  const incoming=normalizeComments(rows);
  if(source?.kind!=='browser'||source.completeness!=='partial'||!previous.length)return{comments:incoming,source};
  const byId=new Map(incoming.map(row=>[row.id,row]));
  const retained=previous.filter(row=>!byId.has(row.id));
  return{comments:[...incoming,...retained],source:{...source,lastCollectionCount:incoming.length,retainedCount:retained.length}};
}
