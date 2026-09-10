import { Worker } from 'node:worker_threads';
import { MAX_EXCEL_BYTES } from './participants.mjs';
export function parseExcel(bytes, filename) {
  if (!bytes.length || bytes.length > MAX_EXCEL_BYTES) throw new Error('Выберите Excel размером до 20 МБ');
  if (!/\.(xlsx|xls)$/i.test(filename || '') || filename.length > 255) throw new Error('Поддерживаются файлы XLSX и XLS');
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./excel-worker.mjs', import.meta.url), { workerData: { bytes, filename }, resourceLimits: { maxOldGenerationSizeMb: 192 } });
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('Не удалось прочитать Excel за 20 секунд — уменьшите файл')); }, 20_000);
    worker.once('message', value => { clearTimeout(timer); worker.terminate(); value.error ? reject(new Error(value.error)) : resolve(value.result); });
    worker.once('error', () => { clearTimeout(timer); reject(new Error('Excel слишком сложный или повреждён — сохраните упрощённую копию')); });
    worker.once('exit', code => { clearTimeout(timer); if (code !== 0) reject(new Error('Не удалось обработать Excel')); });
  });
}
