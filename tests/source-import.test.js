import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { readSourceWorkbook,commentsWorkbook } from '../server/excel.js';
import { importSource } from '../server/source-import.js';
import { newContest,acceptSelection,freeze,digest } from '../server/domain.js';
import { createPrompt } from '../server/prompt.js';

function externalBook(){const b=new ExcelJS.Workbook(),s=b.addWorksheet('Comments');s.addRow(['ID','Имя пользователя','URL профиля','Верифицирован','Текст комментария','Лайки','Дата','Ответ','ID родителя']);return {b,s};}
const parse=b=>b.xlsx.writeBuffer().then(v=>readSourceWorkbook(Buffer.from(v)));
test('external nine-column workbook preserves all rows, duplicates, replies, whitespace, emoji and empty text',async()=>{
  const {b,s}=externalBook();
  s.addRow(['same','alice','https://example.invalid',false,'  Арт-зона → фудкорт → dj сеты @friend\n❤️  ',0,'','Нет']);
  s.addRow(['same','alice','',false,'  Арт-зона → фудкорт → dj сеты @friend\n❤️  ',0,'','Да','same']);
  s.addRow(['3','bob','',false,'',0]);b.addWorksheet('Metadata').addRow(['Export information']);
  const parsed=await parse(b),c=newContest();importSource(c,parsed,'manager.xlsx');
  assert.equal(c.comments.length,3);assert.equal(c.source.accounts,2);assert.equal(c.comments[0].text,s.getCell('E2').value);assert.equal(c.comments[1].text,c.comments[0].text);assert.equal(c.comments[2].text,'');assert.equal(new Set(c.comments.map(r=>r.id)).size,3);
  const exported=await readSourceWorkbook(await commentsWorkbook(c.comments));assert.deepEqual(exported.rows,parsed.rows);assert.equal(c.source.completeness,'unverified');
});
test('source header aliases and displayed hyperlink text work without retrieving linked content',async()=>{
  const {b,s}=externalBook();s.getCell('B1').value=' USERNAME ';s.getCell('E1').value='Comment Text';s.addRow(['1',{text:'alice',hyperlink:'https://example.invalid/profile'},'',false,{richText:[{text:'Hello '},{text:'🌍'}]}]);
  assert.deepEqual((await parse(b)).rows,[{username:'alice',text:'Hello 🌍'}]);
});
test('bad source files cannot silently lose rows or evaluate formulas',async()=>{
  const {b,s}=externalBook();s.addRow(['1','alice','',false,{formula:'1+1',result:2}]);await assert.rejects(()=>parse(b),/без формул/);
  s.getCell('E2').value='hello';s.getCell('B2').value='';await assert.rejects(()=>parse(b),/аккаунт/);
  s.getCell('E2').value='';await assert.rejects(()=>parse(b),/аккаунт/);
  s.getCell('B2').value='alice';b.addWorksheet('Other comments').addRow(['Аккаунт','Комментарий']);await assert.rejects(()=>parse(b),/несколько листов/);
});
test('source replacement invalidates prompt and selection and cannot change a frozen contest',async()=>{
  const c=newContest(),parsed={rows:[{username:'alice',text:'  Hello\n🌍  '},{username:'bob',text:'Hello'}],sheet:'Comments'};
  importSource(c,parsed,'first.xlsx');c.conditions='Любой комментарий';c.prompt=createPrompt(c);acceptSelection(c,parsed.rows,'selected.xlsx');
  assert.equal(c.selectedComments[0].text,parsed.rows[0].text);assert.throws(()=>acceptSelection(c,[{username:'alice',text:'Hello\n🌍'}],'bad.xlsx'),/не совпадает/);
  importSource(c,parsed,'replacement.xlsx');assert.equal(c.conditions,'Любой комментарий');assert.equal(c.prompt,'');assert.equal(c.selection,null);assert.deepEqual(c.selectedComments,[]);
  c.prompt=createPrompt(c);acceptSelection(c,parsed.rows,'selected.xlsx');c.winnerCount=1;c.reserveCount=0;c.acknowledged=true;
  const sourceHash=digest(c.comments);c.comments[0].text='different';assert.throws(()=>freeze(c),/исходному файлу/);c.comments[0].text=parsed.rows[0].text;assert.equal(digest(c.comments),sourceHash);
  freeze(c);assert.throws(()=>importSource(c,parsed,'other.xlsx'),/зафиксирован/);
});

test('prompt describes the original GramLens workbook and never requires a reel or conversion',async()=>{
  const {b,s}=externalBook();s.addRow(['1','alice','',false,'Hello',8]);const c=newContest();importSource(c,await parse(b),'Comments export.xlsx');c.conditions='Написать комментарий и поставить лайк';
  const prompt=createPrompt(c);assert.equal(c.reelUrl,'');assert.match(prompt,/Comments export.xlsx/);assert.match(prompt,/Имя пользователя/);assert.match(prompt,/Текст комментария/);assert.match(prompt,/«Лайки» в выгрузке — лайки комментария/);assert.match(prompt,/РОВНО ДВУМЯ столбцами/);assert(!/Рилс:|подготовлен сервисом|скачанн/.test(prompt));
});
