import ExcelJS from 'exceljs';
import yauzl from 'yauzl';
import { Worker } from 'node:worker_threads';
import { assert } from './domain.js';

export async function commentsWorkbook(comments) {
  const book=new ExcelJS.Workbook();book.creator='Маршрут Построен';
  const sheet=book.addWorksheet('Комментарии',{views:[{state:'frozen',ySplit:1}]});
  sheet.columns=[{header:'Аккаунт',key:'username',width:30},{header:'Комментарий',key:'text',width:110}];
  for(const row of comments)sheet.addRow({username:String(row.username),text:String(row.text)});
  sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};
  sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFDB2A00'}};
  sheet.getColumn(1).numFmt='@';sheet.getColumn(2).numFmt='@';
  sheet.getColumn(2).alignment={wrapText:true,vertical:'top'};
  sheet.autoFilter='A1:B1';return Buffer.from(await book.xlsx.writeBuffer());
}
function validateZip(buffer) {
  return new Promise((resolve,reject)=>yauzl.fromBuffer(buffer,{lazyEntries:true},(error,zip)=>{
    if(error)return reject(new Error('Нужен корректный Excel .xlsx.'));
    let size=0,count=0;zip.on('error',reject);zip.on('end',resolve);
    zip.on('entry',entry=>{size+=entry.uncompressedSize;count++;
      if(size>40*1024*1024||count>2000){zip.close();reject(new Error('Excel слишком большой после распаковки. Максимум 40 МБ.'));return;}zip.readEntry();
    });zip.readEntry();
  }));
}
async function parseWorkbook(buffer,mode) {
  assert(buffer.length>0&&buffer.length<=10*1024*1024,'Excel: максимум 10 МБ.');await validateZip(buffer);
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./excel-worker.js',import.meta.url),{workerData:{buffer,mode},resourceLimits:{maxOldGenerationSizeMb:192}});
    const timer=setTimeout(()=>{worker.terminate();reject(new Error('Excel не удалось прочитать за 15 секунд.'));},15000);
    worker.once('message',data=>{clearTimeout(timer);data.error?reject(new Error(data.error)):resolve(data);});
    worker.once('error',error=>{clearTimeout(timer);reject(error);});
    worker.once('exit',code=>{clearTimeout(timer);if(code)reject(new Error('Не удалось прочитать Excel.'));});
  });
}
async function readExcel(buffer,mode){try{return await parseWorkbook(buffer,mode);}catch(error){error.status??=400;throw error;}}
export async function readWorkbook(buffer){return(await readExcel(buffer,'selection')).rows;}
export async function readSourceWorkbook(buffer){return readExcel(buffer,'source');}
