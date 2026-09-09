import test from 'node:test';
import assert from 'node:assert/strict';
import {extractComments,commentPageInfo,InstagramCollector} from '../server/collector.js';
import {collectedImport} from '../server/collection-import.js';

test('Polaris comment connections preserve text and expose pagination independently of reply cursors',()=>{
  const body={data:{xig_polaris_media:{comments_connection:{edges:[{node:{pk:'1',user:{username:'alice'},text:'Фудкорт → DJ → концерт @friend ❤️',edge_threaded_comments:{edges:[{node:{pk:'2',user:{username:'bob'},text:'Иду!'}}],page_info:{has_next_page:false}}}}],page_info:{has_next_page:true}}}}};
  assert.deepEqual(extractComments(body).map(r=>[r.id,r.parentId]),[['1',''],['2','1']]);assert.deepEqual(commentPageInfo(body),{hasNextPage:true});body.data.xig_polaris_media.comments_connection.page_info.has_next_page=false;assert.deepEqual(commentPageInfo(body),{hasNextPage:false});assert.equal(commentPageInfo({data:{experiments:[]}}),null);
});
test('a partial retry retains previously collected comments and includes new IDs without filtering authors',()=>{
  const prior=[{id:'1',username:'alice',text:'first'},{id:'2',username:'alice',text:'second'}];
  const result=collectedImport(prior,[{id:'1',username:'alice',text:'edited'},{id:'3',username:'owner',text:'rules'}],{kind:'browser',completeness:'partial',reportedCount:335});assert.equal(result.comments.length,3);assert.equal(result.comments.find(c=>c.id==='1').text,'edited');assert.equal(result.comments.find(c=>c.id==='2').text,'second');assert.equal(result.source.retainedCount,1);assert.equal(result.source.lastCollectionCount,2);
  assert.equal(collectedImport(prior,[{id:'3',username:'owner',text:'rules'}],{kind:'json'}).comments.length,1);
});
test('Instagram rate limiting pauses collection and stops the page instead of retrying background requests',async()=>{
  const collector=new InstagramCollector('data/test-collector');let handler,closed=false;
  const job={reelUrl:'https://www.instagram.com/reel/Dcv1u1Jo1QE/',comments:new Map(),page:{on:(_,fn)=>handler=fn,close:async()=>{closed=true;}},status:'collecting'};
  collector.watchResponses(job);handler({url:()=> 'https://www.instagram.com/ajax/bulk-route-definitions/',request:()=>({postData:()=>''}),status:()=>429});await Promise.allSettled([...collector.responseTasks]);assert.equal(job.status,'paused');assert.equal(job.accessLimited,true);assert.equal(job.stop,true);assert.equal(closed,true);
});
