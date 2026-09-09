import ExcelJS from 'exceljs';
import { parentPort,workerData } from 'node:worker_threads';
try {
  const book=new ExcelJS.Workbook();await book.xlsx.load(Buffer.from(workerData.buffer));
  if(workerData.mode==='source') {
    const plain=cell=>{const v=cell.value;if(v==null)return '';if(typeof v==='string')return v;if(v?.richText)return v.richText.map(x=>x.text).join('');if(v?.hyperlink&&typeof v.text==='string')return v.text;throw Error(`Ячейка ${cell.address}: аккаунт и комментарий должны быть текстом без формул.`);};
    const header=cell=>plain(cell).normalize('NFKC').trim().toLowerCase().replace(/[_\s]+/g,' ');
    const candidates=[];
    for(const sheet of book.worksheets){const users=[],texts=[];sheet.getRow(1).eachCell(cell=>{let h;try{h=header(cell);}catch{return;}if(['аккаунт','имя пользователя','username','user name'].includes(h))users.push(cell.col);if(['комментарий','текст комментария','comment','comment text','text'].includes(h))texts.push(cell.col);});if(users.length&&texts.length){if(users.length!==1||texts.length!==1)throw Error('В файле несколько столбцов аккаунта или комментария. Оставьте по одному.');candidates.push({sheet,user:users[0],text:texts[0]});}}
    if(candidates.length!==1)throw Error(candidates.length?'Найдено несколько листов с комментариями. Загрузите файл с одним таким листом.':'Не найдены столбцы «Имя пользователя» и «Текст комментария» либо «Аккаунт» и «Комментарий» в первой строке.');
    const {sheet,user,text}=candidates[0];if(sheet.rowCount>100001)throw Error('Максимум 100 000 строк.');
    const rows=[];sheet.eachRow((row,index)=>{if(index===1)return;const username=plain(row.getCell(user)),comment=plain(row.getCell(text));if(!username&&!comment){if(row.values.slice(1).some(v=>v!=null&&v!==''))throw Error(`Строка ${index}: не указан аккаунт автора.`);return;}if(!username.trim())throw Error(`Строка ${index}: не указан аккаунт автора.`);rows.push({username,text:comment});});
    if(!rows.length)throw Error('В файле нет комментариев.');
    parentPort.postMessage({rows,sheet:sheet.name,columns:{username:plain(sheet.getRow(1).getCell(user)),text:plain(sheet.getRow(1).getCell(text))}});
  } else {
  if(book.worksheets.length!==1)throw new Error('Нужен один лист со столбцами «Аккаунт» и «Комментарий».');
  const sheet=book.worksheets[0];
  const value=cell=>{const v=cell.value;if(v===null)return '';if(typeof v==='string')return v;if(v?.richText)return v.richText.map(x=>x.text).join('');throw new Error(`Ячейка ${cell.address}: используйте текст без формул и ссылок.`);};
  if(value(sheet.getCell('A1')).trim()!=='Аккаунт'||value(sheet.getCell('B1')).trim()!=='Комментарий')throw new Error('Первые два столбца должны называться «Аккаунт» и «Комментарий».');
  if(sheet.getRow(1).values.slice(3).some(v=>v!=null&&v!==''))throw new Error('В Excel должно быть ровно два столбца.');
  const rows=[];sheet.eachRow((row,index)=>{
    if(index===1)return;
    if(row.cellCount>2&&row.values.slice(3).some(x=>x!==null&&x!==undefined&&x!==''))throw new Error('В Excel должно быть ровно два столбца.');
    const username=value(row.getCell(1)),text=value(row.getCell(2));if(!username&&!text)return;
    if(!username.trim()||!text.trim())throw new Error(`Строка ${index}: заполните аккаунт и комментарий.`);
    rows.push({username,text});if(rows.length>100000)throw new Error('Максимум 100 000 строк.');
  });if(!rows.length)throw new Error('В файле нет участников.');parentPort.postMessage({rows});
  }
}catch(error){parentPort.postMessage({error:error.message});}
