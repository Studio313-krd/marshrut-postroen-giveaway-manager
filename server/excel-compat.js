import JSZip from 'jszip';
import { SaxesParser } from 'saxes';

const spreadsheetNS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const packageNS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const relationshipNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const xmlNS = 'http://www.w3.org/XML/1998/namespace';
const xmlnsNS = 'http://www.w3.org/2000/xmlns/';
const parts = /^xl\/(?:workbook\.xml|styles\.xml|sharedStrings\.xml|worksheets\/sheet\d+\.xml|_rels\/workbook\.xml\.rels|worksheets\/_rels\/sheet\d+\.xml\.rels)$/;
const escapeText = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\r', '&#13;');
const escapeAttribute = text => escapeText(text).replaceAll('"', '&quot;').replaceAll('\n', '&#10;').replaceAll('\t', '&#9;');

// ExcelJS 4.4 matches literal tag names, so valid OpenXML such as x:workbook
// produces an undefined workbook model (exceljs/exceljs#1437). Normalize names
// by namespace URI, not by a hardcoded prefix or by replacing cell contents.
function normalizeNamespaces(xml) {
  const parser = new SaxesParser({ xmlns: true });
  const output = ['<?xml version="1.0" encoding="UTF-8"?>'];
  const stack = [];
  const prefixes = new Map([[relationshipNS, 'r'], [xmlNS, 'xml']]);
  let changed = false;

  parser.on('doctype', () => { throw new Error('DOCTYPE is not supported in XLSX.'); });
  parser.on('opentag', tag => {
    const bindings = Object.create(stack.at(-1)?.bindings || { '': '', xml: xmlNS });
    const declarations = new Map();
    for (const attribute of Object.values(tag.attributes)) {
      if (attribute.uri !== xmlnsNS) continue;
      bindings[attribute.name === 'xmlns' ? '' : attribute.local] = attribute.value;
      declarations.set(attribute.name, attribute.value);
    }
    const qualify = (node, attribute = false) => {
      let prefix = '';
      if (node.uri && (attribute || ![spreadsheetNS, packageNS].includes(node.uri))) {
        if (!prefixes.has(node.uri)) {
          let candidate = node.prefix;
          let index = prefixes.size;
          while (!candidate || [...prefixes.values()].includes(candidate) || (bindings[candidate] && bindings[candidate] !== node.uri)) candidate = `ns${index++}`;
          prefixes.set(node.uri, candidate);
        }
        prefix = prefixes.get(node.uri);
      }
      if ((!attribute || node.uri) && bindings[prefix] !== node.uri) {
        bindings[prefix] = node.uri;
        declarations.set(prefix ? `xmlns:${prefix}` : 'xmlns', node.uri);
      }
      const name = prefix ? `${prefix}:${node.local}` : node.local;
      if (name !== node.name) changed = true;
      return name;
    };
    const name = qualify(tag);
    const attributes = Object.values(tag.attributes)
      .filter(attribute => attribute.uri !== xmlnsNS)
      .map(attribute => [qualify(attribute, true), attribute.value]);
    output.push('<', name);
    for (const [key, value] of [...declarations, ...attributes]) output.push(' ', key, '="', escapeAttribute(value), '"');
    output.push(tag.isSelfClosing ? '/>' : '>');
    stack.push({ name, bindings });
  });
  parser.on('closetag', tag => {
    const { name } = stack.pop();
    if (!tag.isSelfClosing) output.push('</', name, '>');
  });
  parser.on('text', text => output.push(escapeText(text)));
  // ExcelJS does not consume CDATA events; equivalent escaped text preserves it.
  parser.on('cdata', text => { changed = true; output.push(escapeText(text)); });
  parser.on('comment', text => output.push('<!--', text, '-->'));
  parser.on('processinginstruction', ({ target, body }) => output.push('<?', target, body ? ' ' + body : '', '?>'));
  parser.write(xml).close();
  return changed ? output.join('') : xml;
}

// Called only inside the memory/time-limited worker, after ZIP size validation.
// The upload itself remains untouched and can still be archived byte for byte.
export async function compatibleWorkbook(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  if (!zip.file('xl/workbook.xml')) throw new Error('Missing workbook.');
  let changed = false;
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || !parts.test(name)) continue;
    const xml = await entry.async('string');
    const normalized = normalizeNamespaces(xml);
    if (normalized !== xml) { zip.file(name, normalized); changed = true; }
  }
  return changed ? zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }) : buffer;
}
