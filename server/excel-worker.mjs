import { parentPort, workerData } from 'node:worker_threads';
import * as XLSX from 'xlsx';
import { makeParticipants, MAX_ROWS } from './participants.mjs';

try {
  const bytes = Buffer.from(workerData.bytes);
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const ole = bytes.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex'));
  if (!zip && !ole) throw new Error('Загрузите настоящий Excel в формате XLSX или XLS');
  const book = XLSX.read(bytes, { type: 'buffer', sheets: [0, 1], sheetRows: MAX_ROWS + 2, dense: true, cellFormula: true, cellHTML: false, cellStyles: false, bookVBA: false });
  let result;
  search: for (const sheetName of book.SheetNames.slice(0, 2)) {
    const sheet = book.Sheets[sheetName];
    if (!sheet) continue;
    for (let column = 0; column < 10; column++) {
      const header = sheet['!data']?.[0]?.[column];
      const name = String(header?.v ?? '').trim().toLowerCase();
      if (header?.f || !['аккаунт', 'имя пользователя'].includes(name)) continue;
      const range = XLSX.utils.decode_range(sheet['!fullref'] || sheet['!ref'] || 'A1');
      if (range.e.r > MAX_ROWS) throw new Error('На выбранном листе больше 50 000 строк — разделите файл');
      const values = [];
      for (let row = 1; row <= range.e.r; row++) {
        const cell = sheet['!data']?.[row]?.[column];
        if (cell?.f || cell?.t === 'e') throw new Error(`В строке ${row + 1} выбранного столбца формула или ошибка — замените её текстовым значением`);
        values.push(cell?.v ?? '');
      }
      result = makeParticipants(values, true, { inputKind: 'excel', sourceFile: workerData.filename, sheetName, column: XLSX.utils.encode_col(column), header: String(header.v).trim() });
      break search;
    }
  }
  if (!result) throw new Error('Не найден столбец «Аккаунт» или «Имя пользователя» в первой строке столбцов A–J первых двух листов');
  parentPort.postMessage({ result });
} catch (error) {
  parentPort.postMessage({ error: error.message || 'Не удалось прочитать Excel' });
}
