import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
export const MAX_ROWS = 50_000;
export const MAX_TEXT_BYTES = 12 * 1024 * 1024;
export const MAX_EXCEL_BYTES = 20 * 1024 * 1024;

export function makeParticipants(values, isInstagram, metadata = {}) {
  if (typeof isInstagram !== 'boolean') throw new Error('Выберите способ отображения имён');
  if (values.length > MAX_ROWS) throw new Error('В списке может быть до 50 000 строк');
  const participants = [], seen = new Set();
  let rows = 0, duplicates = 0;
  for (const value of values) {
    let name = String(value ?? '').trim();
    if (!name) continue;
    rows++;
    if (isInstagram) name = name.replace(/^@+/, '').trim();
    if (!name) throw new Error('Строка с одним знаком @ не содержит имени участника');
    if (/[\u0000-\u001f\u007f]/.test(name)) throw new Error('Каждое имя должно занимать одну строку без управляющих символов');
    if ([...name].length > 200) throw new Error('Имя участника должно быть не длиннее 200 символов');
    const key = isInstagram ? name.toLowerCase() : name;
    if (seen.has(key)) { duplicates++; continue; }
    seen.add(key); participants.push(name);
  }
  if (!participants.length) throw new Error('В списке нет участников — добавьте хотя бы одно имя');
  const identity = isInstagram ? participants.join('\n') : JSON.stringify({ participants, isInstagram });
  return { ...metadata, participants, isInstagram, sourceHash: createHash('sha256').update(identity).digest('hex'), rows, duplicates, importedAt: new Date().toISOString() };
}

export function parseText(text, isInstagram) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_TEXT_BYTES) throw new Error('Список слишком большой');
  return makeParticipants(text.replace(/\r\n?/g, '\n').split('\n'), isInstagram, { sourceFile: 'Список из текста', inputKind: 'text' });
}

export async function createParticipantStore({ file, directory }) {
  const lists = join(directory, 'lists');
  await mkdir(lists, { recursive: true });
  let current = JSON.parse(await readFile(file, 'utf8'));
  current = { isInstagram: true, inputKind: 'excel', ...current };
  if (!/^[a-f0-9]{64}$/.test(current.sourceHash) || !Array.isArray(current.participants) || !current.participants.length) throw new Error('Invalid participant file');
  async function atomic(path, value) {
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
    await rename(temporary, path);
  }
  await atomic(join(lists, `${current.sourceHash}.json`), current);
  let queue = Promise.resolve();
  return {
    current: () => current,
    async read(hash) {
      if (!/^[a-f0-9]{64}$/.test(hash || '')) throw new Error('Не удалось определить список записи');
      return hash === current.sourceHash ? current : JSON.parse(await readFile(join(lists, `${hash}.json`), 'utf8'));
    },
    replace(next, expectedHash) {
      const operation = queue.then(async () => {
        if (expectedHash !== current.sourceHash) { const error = new Error('Список изменился в другой вкладке — обновите страницу'); error.status = 409; throw error; }
        await atomic(join(lists, `${next.sourceHash}.json`), next);
        await atomic(file, next);
        current = next;
        return next;
      });
      queue = operation.catch(() => {});
      return operation;
    },
  };
}
