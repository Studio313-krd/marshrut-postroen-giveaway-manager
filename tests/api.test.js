import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { digest, permutation } from '../server/domain.js';
import { commentsWorkbook } from '../server/excel.js';

test('HTTP import → review → freeze → idempotent draw → audit, restart and CSRF protection',async t=>{
  const dir=mkdtempSync(resolve('data','test-api-'));const port=14310;const base=`http://127.0.0.1:${port}`;let output='';
  let child=spawn(process.execPath,['server/index.js'],{env:{...process.env,NODE_ENV:'test',AUTH_DISABLED:'true',PUBLIC_URL:'http://127.0.0.1:14310',PORT:String(port),CONTEST_DATA_DIR:dir},stdio:['ignore','pipe','pipe'],windowsHide:true});
  child.stderr.on('data',d=>output+=d);child.stdout.on('data',d=>output+=d);
  t.after(()=>child.kill());
  async function ready(){for(let i=0;i<600;i++){try{const r=await fetch(base+'/api/session');if(r.ok)return(await r.json()).csrf;}catch{}await delay(50);}throw new Error(output||'Server unavailable');}
  let csrf=await ready();
  async function req(path,method='GET',body,headers={}){const response=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json','X-CSRF-Token':csrf,...headers},body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json();return{status:response.status,data};}
  assert.equal((await req('/contests','POST',{name:'Denied'}, {'X-CSRF-Token':'wrong'})).status,403);
  assert.equal((await req('/contests','GET',undefined,{'Origin':'https://evil.example'})).status,403);
  let {data:c}=await req('/demo','POST',{});const path='/contests/'+c.id;
  const source=await commentsWorkbook([{username:'alice',text:'hi'}]);
  const bad=await req(path+'/import','POST',{base64:source.toString('base64'),filename:'source.xlsx'});assert.equal(bad.status,200);assert.equal(bad.data.comments.length,1);
  assert.equal((await req('/collector')).status,404);assert.equal((await req(path+'/collect','POST',{})).status,404);
  assert.equal((await req(path+'/freeze','POST',{acknowledged:true})).status,400);
  const newDemo=await req('/demo','POST',{});c=newDemo.data;const p='/contests/'+c.id;
  assert.equal((await req(p+'/freeze','POST',{acknowledged:false})).status,400);
  const frozen=await req(p+'/freeze','POST',{acknowledged:true});assert.equal(frozen.status,200);assert.equal(frozen.data.draw.seed,undefined);assert.equal(digest(frozen.data.snapshot.payload),frozen.data.snapshot.hash);
  assert.equal((await req(p,'PATCH',{name:'Cannot edit'})).status,409);
  assert.equal((await req(p+'/import','POST',{content:[{username:'alice',text:'hi'}]})).status,409);
  const concurrent=await Promise.all([req(p+'/draw','POST',{expectedRank:1}),req(p+'/draw','POST',{expectedRank:1})]);assert.deepEqual(concurrent[0].data.result,concurrent[1].data.result);assert.equal((await req(p)).data.draw.results.length,1);
  for(let rank=2;rank<=10;rank++)assert.equal((await req(p+'/draw','POST',{expectedRank:rank})).status,200);
  const final=(await req(p)).data;assert.equal(new Set(final.draw.results.map(r=>r.username)).size,10);assert.equal(digest(final.draw.seed),final.draw.commitment);
  assert.deepEqual(final.draw.results.map(r=>r.username),permutation(final.snapshot.payload.participants.map(r=>r.username),final.draw.seed,final.snapshot.hash).slice(0,10));
  const audit=await fetch(base+'/api'+p+'/export/audit');assert.equal(audit.status,200);assert.equal((await audit.json()).draw.seed,final.draw.seed);
  const who=final.draw.results[0].username;
  assert.equal((await req(p+'/review','POST',{username:who,status:'confirmed',checks:{like:true}})).status,400);
  assert.equal((await req(p+'/review','POST',{username:who,status:'confirmed',checks:{like:true,follow:true,save:true,share:true},note:'checked'})).status,200);
  const csv=await fetch(base+'/api'+p+'/export/results');assert.match(await csv.text(),/confirmed/);
  await new Promise(resolve=>{child.once('exit',resolve);child.kill();});
  child=spawn(process.execPath,['server/index.js'],{env:{...process.env,NODE_ENV:'test',AUTH_DISABLED:'true',PUBLIC_URL:'http://127.0.0.1:14310',PORT:String(port),CONTEST_DATA_DIR:dir},stdio:'ignore',windowsHide:true});csrf=await ready();
  const persisted=(await req(p)).data;assert.deepEqual(persisted.draw,final.draw);assert.equal(persisted.reviews[who].status,'confirmed');
});
