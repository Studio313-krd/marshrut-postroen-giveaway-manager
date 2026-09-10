import JSZip from 'jszip';

const mainNS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const relNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const packageNS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const escape = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll('\r', '&#13;');

// Independent of ExcelJS's writer: reproduces the namespace-prefixed OpenXML
// structure used by the reported ChatGPT file, with synthetic participants only.
export async function openXmlWorkbook(rows, { prefix = 'x', stringType = 'str', sheetCount = 1, formula = false, hyperlink = false } = {}) {
  const zip = new JSZip();
  const name = local => prefix ? `${prefix}:${local}` : local;
  const ns = prefix ? `xmlns:${prefix}="${mainNS}"` : `xmlns="${mainNS}"`;
  const strings = [];
  const cells = [['Аккаунт', 'Комментарий'], ...rows.map(row => [row.username, row.text])];
  const cell = (value, row, col) => {
    const address = `${col === 0 ? 'A' : 'B'}${row + 1}`;
    if (formula && address === 'B2') return `<${name('c')} r="B2"><${name('f')}>1+1</${name('f')}><${name('v')}>2</${name('v')}></${name('c')}>`;
    let content;
    if (stringType === 'inlineStr') content = `<${name('is')}><${name('t')} xml:space="preserve">${escape(value)}</${name('t')}></${name('is')}>`;
    else {
      const text = stringType === 's' ? strings.push(value) - 1 : escape(value);
      content = `<${name('v')}>${text}</${name('v')}>`;
    }
    return `<${name('c')} r="${address}" s="0" t="${stringType}">${content}</${name('c')}>`;
  };
  const data = cells.map((row, i) => `<${name('row')} r="${i + 1}">${row.map((value, col) => cell(value, i, col)).join('')}</${name('row')}>`).join('');
  const links = hyperlink ? `<${name('hyperlinks')}><${name('hyperlink')} ref="B2" rel:id="link1"/></${name('hyperlinks')}>` : '';
  const sheets = Array.from({ length: sheetCount }, (_, i) => i + 1);
  for (const i of sheets) zip.file(`xl/worksheets/sheet${i}.xml`, `<${name('worksheet')} ${ns} xmlns:rel="${relNS}"><${name('sheetData')}>${data}</${name('sheetData')}>${links}</${name('worksheet')}>`);
  if (hyperlink) zip.file('xl/worksheets/_rels/sheet1.xml.rels', `<pkg:Relationships xmlns:pkg="${packageNS}"><pkg:Relationship Id="link1" Type="${relNS}/hyperlink" Target="https://example.invalid/" TargetMode="External"/></pkg:Relationships>`);
  zip.file('xl/styles.xml', `<${name('styleSheet')} ${ns}><${name('cellXfs')} count="1"><${name('xf')} numFmtId="49"/></${name('cellXfs')}></${name('styleSheet')}>`);
  zip.file('xl/sharedStrings.xml', `<${name('sst')} ${ns}>${strings.map(value => `<${name('si')}><${name('t')} xml:space="preserve">${escape(value)}</${name('t')}></${name('si')}>`).join('')}</${name('sst')}>`);
  zip.file('xl/workbook.xml', `<${name('workbook')} ${ns} xmlns:rel="${relNS}"><${name('sheets')}>${sheets.map(i => `<${name('sheet')} name="Участники ${i}" sheetId="${i}" rel:id="sheet${i}"/>`).join('')}</${name('sheets')}></${name('workbook')}>`);
  zip.file('xl/_rels/workbook.xml.rels', `<pkg:Relationships xmlns:pkg="${packageNS}">${sheets.map(i => `<pkg:Relationship Id="sheet${i}" Type="${relNS}/worksheet" Target="/xl/worksheets/sheet${i}.xml"/>`).join('')}<pkg:Relationship Id="styles" Type="${relNS}/styles" Target="/xl/styles.xml"/><pkg:Relationship Id="strings" Type="${relNS}/sharedStrings" Target="/xl/sharedStrings.xml"/></pkg:Relationships>`);
  zip.file('_rels/.rels', `<Relationships xmlns="${packageNS}"><Relationship Id="book" Type="${relNS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file('[Content_Types].xml', `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>${sheets.map(i => `<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
