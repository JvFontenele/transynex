import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import AdmZip from 'adm-zip';

const execFileAsync = promisify(execFile);

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.tiff', '.tif']);

export interface ExtractedPage {
  buffer: Buffer;
  ext: string; // com ponto, ex: ".png"
}

// Extração de páginas é serviço do Core, não provider (ARCHITECTURE.md §1).
// Entrega uma página por vez ao `onPage`: um PDF/CBZ de centenas de páginas
// nunca fica inteiro na memória. Retorna a quantidade de páginas.
export async function extractPages(
  buffer: Buffer,
  mimeType: string,
  onPage: (page: ExtractedPage, index: number) => Promise<void>,
): Promise<number> {
  if (mimeType === 'application/pdf') return extractPdf(buffer, onPage);
  if (
    mimeType === 'application/zip' ||
    mimeType === 'application/x-cbz' ||
    mimeType === 'application/vnd.comicbook+zip'
  ) {
    return extractZip(buffer, onPage);
  }
  throw new Error(`Extração não suportada para ${mimeType}`);
}

type OnPage = (page: ExtractedPage, index: number) => Promise<void>;

async function extractPdf(buffer: Buffer, onPage: OnPage): Promise<number> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'transynex-pdf-'));
  try {
    const pdfPath = path.join(dir, 'input.pdf');
    await fs.writeFile(pdfPath, buffer);
    // pdftoppm escreve em disco; aqui só uma página por vez é lida para a memória.
    await execFileAsync('pdftoppm', ['-png', '-r', '150', pdfPath, path.join(dir, 'page')]);
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.png')).sort(naturalCompare);
    if (files.length === 0) throw new Error('PDF sem páginas extraíveis');
    for (const [i, f] of files.entries()) {
      await onPage({ buffer: await fs.readFile(path.join(dir, f)), ext: '.png' }, i);
    }
    return files.length;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function extractZip(buffer: Buffer, onPage: OnPage): Promise<number> {
  const zip = new AdmZip(buffer);
  const entries = zip
    .getEntries()
    .filter((e) => !e.isDirectory && IMAGE_EXTS.has(path.extname(e.entryName).toLowerCase()))
    // __MACOSX e arquivos ocultos não são páginas
    .filter((e) => !e.entryName.split('/').some((part) => part.startsWith('.') || part === '__MACOSX'))
    .sort((a, b) => naturalCompare(a.entryName, b.entryName));
  if (entries.length === 0) throw new Error('Arquivo sem imagens');
  // Descompacta uma entrada por vez (getData sob demanda)
  for (const [i, e] of entries.entries()) {
    await onPage({ buffer: e.getData(), ext: path.extname(e.entryName).toLowerCase() }, i);
  }
  return entries.length;
}

// "page2" < "page10" (ordenação natural, essencial para capítulos de mangá)
function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}
