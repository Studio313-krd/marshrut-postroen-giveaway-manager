import test from 'node:test';
import assert from 'node:assert/strict';
import { newContest, normalizeComments, parseCSV, evaluate, configure, freeze, drawNext, publicContest, permutation, digest, review, reelURL } from '../server/domain.js';
import { demoContest } from '../server/demo.js';

function contest(rows){const c=newContest();c.comments=normalizeComments(rows);return c;}
const valid='Арт-зона, лекторий, фудкорт. @my_friend';
test('three distinct locations and friend; punctuation and case normalize',()=>{
  const c=contest([{username:'@ALICE',text:'АРТ-ЗОНА, лекторий, фуд-корт. @friend.'}]);
  assert.equal(evaluate(c).stats.eligible,1);assert.equal(c.comments[0].username,'alice');
  assert.deepEqual(evaluate(c).rows[0].friends,['friend']);
});
test('location aliases do not create multiple locations or match substrings',()=>{
  const c=contest([{username:'alice',text:'Фудкорт, фуд-корт, фуд корт @friend'},{username:'bob',text:'неартзона, нелекторий, фудкорт @friend'}]);
  assert.equal(evaluate(c).stats.eligible,0);assert.equal(evaluate(c).rows[0].locations.length,1);assert.equal(evaluate(c).rows[1].locations.length,1);
});
test('repeat comments exclude the entire account, even with manual override',()=>{
  const c=contest([{id:1,username:'alice',text:valid},{id:2,username:'ALICE',text:'Ещё один'}]);c.overrides.alice={eligible:true,reason:'test'};
  assert.equal(evaluate(c).stats.eligible,0);assert.equal(evaluate(c).rows[0].count,2);
});
test('deduplicated export records do not disqualify an account',()=>{
  const c=contest([{id:'same',username:'alice',text:valid},{id:'same',username:'ALICE',text:valid}]);assert.equal(c.comments.length,1);assert.equal(evaluate(c).stats.eligible,1);
  assert.throws(()=>normalizeComments([{id:'same',username:'alice',text:valid},{id:'same',username:'bob',text:valid}]),/Конфликт/);
});
test('identical comments without platform IDs remain separate comments',()=>{
  const c=contest([{username:'alice',text:valid},{username:'alice',text:valid}]);assert.equal(c.comments.length,2);assert.equal(evaluate(c).stats.eligible,0);
});
test('first-comment rule uses dates and does not pick the most convenient valid comment',()=>{
  const c=contest([{id:2,username:'alice',text:valid,timestamp:'2026-01-02'},{id:1,username:'alice',text:'Нет условий',timestamp:'2026-01-01'}]);c.duplicatePolicy='first';assert.equal(evaluate(c).stats.eligible,0);assert.equal(evaluate(c).rows[0].comment.id,'1');
});
test('replies count toward repeat comments; owner/self/location mentions are not friends',()=>{
  const c=contest([{id:1,username:'alice',text:'Арт-зона лекторий фудкорт @alice @marshrut_postroen.media @venue'},{id:2,username:'alice',text:'Спасибо',parentId:'1'},{id:3,username:'marshrut_postroen.media',text:valid}]);
  c.locations[0].aliases.push('@venue');assert.equal(evaluate(c).stats.accounts,1);assert.equal(evaluate(c).rows[0].count,2);assert.equal(evaluate(c).stats.eligible,0);assert.equal(evaluate(c).rows[0].friends.length,0);
});
test('reply-only accounts cannot enter even through a manual override',()=>{
  const c=contest([{id:1,username:'alice',text:valid,parentId:'parent'}]);c.overrides.alice={eligible:true,reason:'test'};assert.equal(evaluate(c).stats.eligible,0);
});
test('dates/programme labels and email addresses do not count as locations or mentions',()=>{
  const c=contest([{username:'alice',text:'Гранд-открытие, основной день, лекторий mail@friend.com'},{username:'bob',text:'Арт-зона лекторий фудкорт @abcdefghijklmnopqrstuvwxyz123456789'}]);assert.equal(evaluate(c).stats.eligible,0);
});
test('reel example and attached Cyrillic preposition are accepted, concert aliases count once',()=>{
  const c=contest([{username:'alice',text:'На фудкорте, лекторий, концерт Сироткина в амфитеатре С@friend'},{username:'bob',text:'DJ сеты, фудкорт, Сироткин @friend'},{username:'charlie',text:'Сироткин концерт амфитеатр @friend'}]);const rows=evaluate(c).rows;
  assert.equal(rows[0].locations.length,3);assert.equal(rows[0].eligible,true);assert.equal(rows[1].eligible,true);assert.equal(rows[2].locations.length,1);assert.equal(rows[2].eligible,false);
});
test('CSV supports multiline text, BOM and quoted separators',()=>{
  const rows=parseCSV('\uFEFFusername;text;id\r\nalice;"Арт-зона; лекторий\nфудкорт @friend, ""привет""";1\r\n');assert.equal(rows.length,1);assert.match(rows[0].text,/\n/);assert.match(rows[0].text,/"привет"/);assert.equal(normalizeComments(rows).length,1);assert.throws(()=>parseCSV('username,text\na,"oops'),/кавычка/);
});
test('configuration rejects overlapping alias dictionaries and unsafe URLs',()=>{
  const c=newContest();assert.throws(()=>configure(c,{locations:[{name:'A place',aliases:['same']},{name:'B place',aliases:['same']}]}),/повторяется/);
  assert.throws(()=>reelURL('https://instagram.com.evil.test/reel/123/'));assert.throws(()=>reelURL('https://127.0.0.1/reel/123/'));assert.equal(reelURL('https://www.instagram.com/reel/Dcv1u1Jo1QE/?stkn=test'),'https://www.instagram.com/reel/Dcv1u1Jo1QE/');
});
test('freeze requires attestation and at least ten; draws unique, deterministic, committed and locked',()=>{
  const c=demoContest();assert.throws(()=>freeze(c),/Подтвердите/);c.acknowledged=true;freeze(c);
  assert.equal(digest(c.snapshot.payload),c.snapshot.hash);assert.equal(publicContest(c).draw.seed,undefined);
  assert.throws(()=>configure(c,{name:'Change'}),/зафиксирован/);
  const order=permutation(c.snapshot.payload.participants.map(r=>r.username),c.draw.seed,c.snapshot.hash);
  for(let i=0;i<10;i++)assert.equal(drawNext(c).username,order[i]);
  assert.equal(new Set(c.draw.results.map(r=>r.username)).size,10);assert.equal(c.draw.results.filter(r=>r.group==='primary').length,5);assert.equal(publicContest(c).draw.seed,c.draw.seed);assert.throws(()=>drawNext(c),/определены/);
  const tiny=contest([{username:'alice',text:valid}]);tiny.acknowledged=true;assert.throws(()=>freeze(tiny),/минимум 10/);
});
test('known partial collection cannot be drawn even with organizer attestation',()=>{
  const c=demoContest();c.acknowledged=true;c.source.completeness='partial';assert.throws(()=>freeze(c),/расхождение/);
});
test('permutation reference vector prevents accidental algorithm changes',()=>{
  const users=Array.from({length:15},(_,i)=>'user_'+i);const seed='ab'.repeat(32);const hash=digest('snapshot');const result=permutation(users,seed,hash);
  assert.deepEqual(result,permutation(users,seed,hash));assert.notDeepEqual(result,permutation(users,'cd'.repeat(32),hash));assert.deepEqual([...result].sort(),[...users].sort());
});
test('verification cannot confirm unchecked conditions or reject without reason',()=>{
  const c=demoContest();c.acknowledged=true;freeze(c);const r=drawNext(c);
  assert.throws(()=>review(c,r.username,{status:'confirmed',checks:{like:true}}),/всех условий/);assert.throws(()=>review(c,r.username,{status:'rejected',note:''}),/причину/);
  review(c,r.username,{status:'confirmed',checks:{like:true,follow:true,save:true,share:true},note:'Скриншоты получены'});assert.equal(c.reviews[r.username].status,'confirmed');
});
