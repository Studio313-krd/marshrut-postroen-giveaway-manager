import ExcelJS from 'exceljs';
import { parentPort,workerData } from 'node:worker_threads';
try {
  const book=new ExcelJS.Workbook();await book.xlsx.load(Buffer.from(workerData));
  if(book.worksheets.length!==1)throw new Error('Нужен один лист со столбцами «Аккаунт» и «Комментарий».');
  const sheet=book.worksheets[0];
  const value=cell=>{const v=cell.value;if(v===null)return '';if(typeof v==='string')return v;if(v?.richText)return v.richText.map(x=>x.text).join('');throw new Error(`Ячейка ${cell.address}: используйте текст без формул и ссылок.`);};
  if(value(sheet.getCell('A1')).trim()!=='Аккаунт'||value(sheet.getCell('B1')).trim()!=='Комментарий')throw new Error('Первые два столбца должны называться «Аккаунт» и «Комментарий».');
  const rows=[];sheet.eachRow((row,index)=>{
    if(index===1)return;
    if(row.cellCount>2&&row.values.slice(3).some(x=>x!==null&&x!==undefined&&x!==''))throw new Error('В Excel должно быть ровно два столбца.');
    const username=value(row.getCell(1)),text=value(row.getCell(2));if(!username&&!text)return;
    if(!username.trim()||!text.trim())throw new Error(`Строка ${index}: заполните аккаунт и комментарий.`);
    rows.push({username,text});if(rows.length>100000)throw new Error('Максимум 100 000 строк.');
  });if(!rows.length)throw new Error('В файле нет участников.');parentPort.postMessage({rows});
}catch(error){parentPort.postMessage({error:error.message});}
