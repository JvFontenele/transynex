// Self-check: pnpm --filter @transynex/backend exec tsx src/epub.check.ts
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { buildTranslatedEpub, extractEpubParagraphs } from './epub.js';

const zip = new AdmZip(undefined, { noSort: true });
zip.addFile('mimetype', Buffer.from('application/epub+zip'));
zip.getEntry('mimetype')!.header.method = 0; // STORED, exigido pela spec
zip.addFile(
  'META-INF/container.xml',
  Buffer.from(
    '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  ),
);
zip.addFile(
  'OEBPS/content.opf',
  Buffer.from(
    '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><manifest><item id="c1" href="text/ch%201.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c2"/><itemref idref="c1"/></spine></package>',
  ),
);
const page = (body: string) =>
  Buffer.from(`<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>${body}</body></html>`);
zip.addFile('OEBPS/text/ch2.xhtml', page('<h1>Chapter Two</h1><p>First   <em>line</em>.</p><p> </p>'));
zip.addFile('OEBPS/text/ch 1.xhtml', page('<ul><li><p>Nested</p></li><li>Item</li></ul>'));
const epub = zip.toBuffer();

// Spine manda a ordem (ch2 antes de ch1), href com %20 resolve, vazios somem,
// <li><p> conta uma vez só.
const pages = extractEpubParagraphs(epub);
assert.deepEqual(pages, [
  { pageNumber: 1, paragraphs: ['Chapter Two', 'First line.'], locators: ['0:0', '0:1'] },
  { pageNumber: 2, paragraphs: ['Nested', 'Item'], locators: ['1:0', '1:1'] },
]);

const out = buildTranslatedEpub(
  epub,
  new Map([
    ['0:1', 'Primeira linha.'],
    ['1:1', 'Item traduzido'],
  ]),
);
const back = extractEpubParagraphs(out);
assert.deepEqual(back[0]!.paragraphs, ['Chapter Two', 'Primeira linha.']);
assert.deepEqual(back[1]!.paragraphs, ['Nested', 'Item traduzido']);
const first = new AdmZip(out).getEntries()[0]!;
assert.equal(first.entryName, 'mimetype');
assert.equal(first.header.method, 0);
console.log('epub ok');
