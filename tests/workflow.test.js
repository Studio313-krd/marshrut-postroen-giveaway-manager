import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { newContest,normalizeComments,acceptSelection,configure,freeze,drawNext,publicContest,digest,totalPlaces } from '../server/domain.js';
import { createPrompt } from '../server/prompt.js';
import { commentsWorkbook,readWorkbook } from '../server/excel.js';
const fixture=()=>{const c=newContest();c.workflow='external';c.conditions='Три локации, отметить друга';c.prompt=createPrompt(c);c.comments=normalizeComments(Array.from({length:12},(_,i)=>({id:String(i),username:'user_'+i,text:i?'Любой текст @friend':'Плед зона, фуд-корт, концееерт @friend\n❤️'})));return c;};
test('Excel exports every source comment unchanged, including duplicate accounts and formula-looking text',async()=>{
  const rows=[{username:'user',text:'=HYPERLINK("x")\n❤️'},{username:'user',text:'Арт-зона, dj сеты, фудкорт @friend'},{username:'marshrut_postroen.media',text:'Правила конкурса'}];
  const data=await commentsWorkbook(rows);const book=new ExcelJS.Workbook();await book.xlsx.load(data);
  assert.equal(book.worksheets.length,1);assert.equal(book.worksheets[0].getCell('B2').type,ExcelJS.ValueType.String);assert.deepEqual(await readWorkbook(data),rows);
});
test('Excel rejects formulas, empty rows with missing cells, invalid headers and multiple sheets',async()=>{
  const book=new ExcelJS.Workbook(),s=book.addWorksheet('Data');s.addRow(['Аккаунт','Комментарий']);s.addRow(['alice',{formula:'1+1',result:2}]);
  const buffer=Buffer.from(await book.xlsx.writeBuffer());await assert.rejects(()=>readWorkbook(buffer),/текст без формул/);
  s.getCell('B2').value='';await assert.rejects(()=>book.xlsx.writeBuffer().then(b=>readWorkbook(Buffer.from(b))),/заполните/);
  book.addWorksheet('Other');await assert.rejects(()=>book.xlsx.writeBuffer().then(b=>readWorkbook(Buffer.from(b))),/один лист/);
});
test('selected Excel governs admission; old location matcher does not filter it; duplicate and invented rows are rejected',()=>{
  const c=fixture();acceptSelection(c,c.comments,'selected.xlsx');assert.equal(c.selectedComments.length,12);
  assert.throws(()=>acceptSelection(c,[{...c.comments[0],id:null},{...c.comments[0],id:null}],'bad'),/повторяется/);
  assert.throws(()=>acceptSelection(c,[{username:'unknown',text:'hello'}],'bad'),/не совпадает/);
  assert.throws(()=>acceptSelection(c,[{...c.comments[0],text:'AI paraphrased'}],'bad'),/не совпадает/);
});
test('changed conditions invalidate selection; prompt follows changed rules; configurable places are committed and unique',()=>{
  const c=fixture();acceptSelection(c,c.comments,'selected.xlsx');const old=createPrompt(c);configure(c,{conditions:'Написать любимую песню'});assert.equal(c.selection,null);assert.notEqual(createPrompt(c),old);
  c.prompt=createPrompt(c);acceptSelection(c,c.comments,'selected.xlsx');configure(c,{winnerCount:2,reserveCount:1,manualChecks:'Подписка'});c.acknowledged=true;freeze(c);
  assert.equal(totalPlaces(c),3);assert.equal(c.snapshot.payload.winnerCount,2);assert.equal(publicContest(c).draw.seed,undefined);
  const results=Array.from({length:3},()=>drawNext(c));assert.deepEqual(results.map(r=>r.group),['primary','primary','reserve']);assert.equal(new Set(results.map(r=>r.username)).size,3);assert.equal(digest(publicContest(c).draw.seed),c.draw.commitment);assert.throws(()=>drawNext(c),/определены/);
});
test('partial source requires separate attestation and zero reserves is supported',()=>{
  const c=fixture();acceptSelection(c,c.comments,'selected.xlsx');configure(c,{winnerCount:1,reserveCount:0});c.source={completeness:'partial',reportedCount:333};c.acknowledged=true;assert.throws(()=>freeze(c),/расхождение/);c.sourceAccepted=true;freeze(c);assert.equal(totalPlaces(c),1);assert.equal(drawNext(c).group,'primary');
});
