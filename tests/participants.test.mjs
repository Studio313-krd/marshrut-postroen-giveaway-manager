import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { parseExcel } from '../server/excel.mjs';
import { parseText, createParticipantStore } from '../server/participants.mjs';
import { participantName } from '../shared/names.mjs';
import { fixture } from './fixtures.mjs';

function workbook(sheets, bookType = 'xlsx') {
  const book = XLSX.utils.book_new();
  sheets.forEach((rows, i) => XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), `Лист ${i + 1}`));
  return XLSX.write(book, { type: 'buffer', bookType });
}

test('Excel takes the first matching header in sheet order then columns A–J, ignoring case', async () => {
  const first = await parseExcel(workbook([[['ИМЯ ПОЛЬЗОВАТЕЛЯ', 'аКкАуНт'], ['first', 'ignored']], [['Аккаунт'], ['also_ignored']]]), 'test.xlsx');
  assert.deepEqual(first.participants, ['first']); assert.equal(first.column, 'A'); assert.equal(first.sheetName, 'Лист 1');
  const second = await parseExcel(workbook([[['Описание'], ['info']], [[...Array(9).fill(''), '  АкКаУнТ  '], [...Array(9).fill(''), '@second']]]), 'test.xlsx');
  assert.deepEqual(second.participants, ['second']); assert.equal(second.column, 'J'); assert.equal(second.sheetName, 'Лист 2');
  const xls = await parseExcel(workbook([[['имя пользователя'], ['legacy']]], 'xls'), 'test.XLS');
  assert.deepEqual(xls.participants, ['legacy']);
});

test('headers on the third sheet, eleventh column or second row are not accepted', async () => {
  for (const sheets of [
    [[['No']], [['No']], [['Аккаунт'], ['third']]],
    [[[...Array(10).fill(''), 'Аккаунт'], [...Array(10).fill(''), 'eleventh']]],
    [[['Title'], ['Аккаунт'], ['later']]],
    [[['username'], ['unsupported']]],
  ]) await assert.rejects(parseExcel(workbook(sheets), 'test.xlsx'), /Не найден столбец/);
});

test('Excel reads all 1200 entries, skips empty cells, and merges duplicate Instagram identities', async () => {
  const rows = [['АККАУНТ'], ...Array.from({ length: 1200 }, (_, i) => [`user_${i}`]), [], [' @USER_0 ']];
  const parsed = await parseExcel(workbook([rows]), 'many.xlsx');
  assert.equal(parsed.participants.length, 1200); assert.equal(parsed.rows, 1201); assert.equal(parsed.duplicates, 1); assert.equal(parsed.isInstagram, true);
});

test('invalid files, empty matching columns, formula names and empty text fail without partial results', async () => {
  await assert.rejects(parseExcel(Buffer.from('Аккаунт\nuser'), 'fake.xlsx'), /настоящий Excel/);
  await assert.rejects(parseExcel(workbook([[['Аккаунт']]]), 'empty.xlsx'), /нет участников/);
  await assert.rejects(parseExcel(workbook([[['Аккаунт'], [{ t: 's', v: 'cached', f: 'HYPERLINK("https://example.com","cached")' }]]]), 'formula.xlsx'), /формула/);
  assert.throws(() => parseText('\n \r\n', false), /нет участников/);
  assert.throws(() => parseText('@', true), /одним знаком/);
});

test('text preserves Unicode names, supports 300+ rows and controls @ without double-prefixing', () => {
  const lines = Array.from({ length: 750 }, (_, i) => `Участник ${i + 1}`);
  const names = parseText(lines.join('\r\n') + '\n\nУчастник 1', false);
  assert.deepEqual(names.participants, lines); assert.equal(names.duplicates, 1);
  const accounts = parseText('@Alice\nALICE\nbob\n', true);
  assert.deepEqual(accounts.participants, ['Alice', 'bob']); assert.equal(accounts.duplicates, 1);
  assert.equal(participantName('Анна Иванова', false), 'Анна Иванова');
  assert.equal(participantName('@alice', true), '@alice');
  assert.equal(participantName('alice', true), '@alice');
  assert.notEqual(parseText('alice', false).sourceHash, parseText('alice', true).sourceHash);
  assert.equal(parseText(fixture.participants.join('\n'), true).sourceHash, fixture.sourceHash);
});

test('participant imports persist across restarts, archive previous pools, and reject stale tabs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'giveaway-pools-'));
  const file = join(directory, 'participants.json');
  await writeFile(file, JSON.stringify(fixture));
  try {
    const store = await createParticipantStore({ file, directory });
    const next = parseText('Анна\nМихаил\nОлег', false);
    await store.replace(next, fixture.sourceHash);
    assert.equal(store.current().sourceHash, next.sourceHash);
    assert.deepEqual((await store.read(fixture.sourceHash)).participants, fixture.participants);
    await assert.rejects(store.replace(parseText('someone', true), fixture.sourceHash), /другой вкладке/);
    const restarted = await createParticipantStore({ file, directory });
    assert.deepEqual(restarted.current(), next);
    await restarted.replace(await restarted.read(fixture.sourceHash), next.sourceHash);
    assert.equal(restarted.current().sourceHash, fixture.sourceHash);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
