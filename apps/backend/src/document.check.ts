// Self-check: pnpm --filter @transynex/backend exec tsx src/document.check.ts
// (precisa do poppler-utils: pdftotext + pdftohtml)
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { extractPdfParagraphs } from './document.js';

// PDF mínimo escrito à mão: parágrafo A, imagem 2x2, parágrafo B — e uma
// imagem cobrindo a página toda (fundo de scan com OCR), que deve ser ignorada.
// Sem xref: o poppler reconstrói a tabela.
const text = (y: number, s: string) => `BT /F1 12 Tf 72 ${y} Td (${s}) Tj ET`;
const content = [
  'q 612 0 0 792 0 0 cm /Bg Do Q',
  text(720, 'Primeiro paragrafo com texto suficiente para contar como documento.'),
  'q 200 0 0 100 72 500 cm /Im Do Q',
  text(300, 'Segundo paragrafo, abaixo da imagem, tambem com bastante texto.'),
].join('\n');
const pixels = Buffer.alloc(2 * 2 * 3, 0x80).toString('latin1');
const image =
  `<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${pixels.length} >>\nstream\n${pixels}\nendstream`;
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> /XObject << /Im 6 0 R /Bg 7 0 R >> >> >>',
  `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  image,
  image,
];
const pdf = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'document-check-')), 'input.pdf');
await fs.writeFile(pdf, Buffer.from(
  `%PDF-1.4\n${objects.map((o, i) => `${i + 1} 0 obj\n${o}\nendobj\n`).join('')}trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\n%%EOF\n`,
  'latin1',
));

const saved: string[] = [];
const pages = await extractPdfParagraphs(pdf, async ({ ext, pageNumber }) => {
  const ref = `img-${pageNumber}-${saved.length}${ext}`;
  saved.push(ref);
  return ref;
});

assert.ok(pages, 'PDF com texto não pode cair no OCR');
const [page] = pages;
assert.equal(saved.length, 1, 'fundo de página inteira deve ser ignorado');
assert.equal(page!.paragraphs.length, 3);
assert.match(page!.paragraphs[0]!, /^Primeiro/);
assert.equal(page!.paragraphs[1], '', 'imagem entre os dois parágrafos');
assert.match(page!.paragraphs[2]!, /^Segundo/);
assert.equal(page!.imageRefs?.[0], undefined);
assert.equal(page!.imageRefs?.[1], saved[0]);

// Sem saveImage, nada muda em relação ao fluxo só-texto.
const textOnly = await extractPdfParagraphs(pdf);
assert.equal(textOnly![0]!.paragraphs.length, 2);
assert.equal(textOnly![0]!.imageRefs, undefined);

console.log('document.check OK');
