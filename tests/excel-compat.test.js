import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { readWorkbook, readSourceWorkbook, commentsWorkbook } from '../server/excel.js';
import { compatibleWorkbook } from '../server/excel-compat.js';
import { openXmlWorkbook } from './helpers/openxml.js';

const rows = [{ username: 'alice', text: '  Арт-зона & DJ <x:t>не тег</x:t> @friend\n❤️\r\n  ' }, { username: 'bob', text: '=это текст, а не формула\t"🌍"' }];

for (const [prefix, stringType] of [['x', 'str'], ['sheetml', 'inlineStr'], ['ns0', 's'], ['', 'str']]) {
  test(`reads namespaced OpenXML (${prefix || 'default'}, ${stringType}) without altering cell text`, async () => {
    const input = await openXmlWorkbook(rows, { prefix, stringType });
    const before = Buffer.from(input);
    assert.deepEqual(await readWorkbook(input), rows);
    assert.deepEqual((await readSourceWorkbook(input)).rows, rows);
    assert.deepEqual(input, before);
  });
}

test('prefixed formulas, hyperlinks and multiple sheets still fail selection validation', async () => {
  await assert.rejects(readWorkbook(await openXmlWorkbook(rows, { formula: true })), /текст без формул/);
  await assert.rejects(readSourceWorkbook(await openXmlWorkbook(rows, { formula: true })), /без формул/);
  await assert.rejects(readWorkbook(await openXmlWorkbook(rows, { hyperlink: true })), /без формул и ссылок/);
  await assert.rejects(readWorkbook(await openXmlWorkbook(rows, { sheetCount: 2 })), /один лист/);
});

test('namespace normalization uses URIs and preserves rich text and CDATA', async () => {
  const zip = await JSZip.loadAsync(await openXmlWorkbook(rows, { stringType: 'inlineStr' }));
  const sheet = await zip.file('xl/worksheets/sheet1.xml').async('string');
  zip.file('xl/worksheets/sheet1.xml', sheet.replace(/<x:c r="B2"[^>]*>.*?<\/x:c>/s,
    '<x:c r="B2" t="inlineStr"><x:is><s:r xmlns:s="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><s:t xml:space="preserve"><![CDATA[  <x:t> & ❤️ ]]></s:t></s:r><x:r><x:t>конец</x:t></x:r></x:is></x:c>'));
  const parsed = await readWorkbook(await zip.generateAsync({ type: 'nodebuffer' }));
  assert.equal(parsed[0].text, '  <x:t> & ❤️ конец');
});

test('malformed workbook XML produces an actionable error instead of an internal TypeError', async () => {
  for (const xml of ['<broken', '<x:workbook xmlns:x="urn:not-spreadsheet"/>', '<!DOCTYPE workbook><workbook/>']) {
    const zip = await JSZip.loadAsync(await openXmlWorkbook(rows));
    zip.file('xl/workbook.xml', xml);
    await assert.rejects(readWorkbook(await zip.generateAsync({ type: 'nodebuffer' })), error => {
      assert.equal(error.status, 400);
      assert.match(error.message, /Не удалось прочитать структуру Excel/);
      assert.doesNotMatch(error.message, /undefined|TypeError/);
      return true;
    });
  }
});

test('standard ExcelJS files do not need repackaging', async () => {
  const input = await commentsWorkbook(rows);
  assert.equal(await compatibleWorkbook(input) === input, true);
});
