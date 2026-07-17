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
export async function extractPages(buffer: Buffer, mimeType: string): Promise<ExtractedPage[]> {
  if (mimeType === 'application/pdf') return extractPdf(buffer);
  if (
    mimeType === 'application/zip' ||
    mimeType === 'application/x-cbz' ||
    mimeType === 'application/vnd.comicbook+zip'
  ) {
    return extractZip(buffer);
  }
  throw new Error(`Extração não suportada para ${mimeType}`);
}

async function extractPdf(buffer: Buffer): Promise<ExtractedPage[]> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'transynex-pdf-'));
  try {
    const pdfPath = path.join(dir, 'input.pdf');
    await fs.writeFile(pdfPath, buffer);
    await execFileAsync('pdftoppm', ['-png', '-r', '150', pdfPath, path.join(dir, 'page')]);
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.png')).sort(naturalCompare);
    if (files.length === 0) throw new Error('PDF sem páginas extraíveis');
    return Promise.all(
      files.map(async (f) => ({ buffer: await fs.readFile(path.join(dir, f)), ext: '.png' })),
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function extractZip(buffer: Buffer): ExtractedPage[] {
  const zip = new AdmZip(buffer);
  const entries = zip
    .getEntries()
    .filter((e) => !e.isDirectory && IMAGE_EXTS.has(path.extname(e.entryName).toLowerCase()))
    // __MACOSX e arquivos ocultos não são páginas
    .filter((e) => !e.entryName.split('/').some((part) => part.startsWith('.') || part === '__MACOSX'))
    .sort((a, b) => naturalCompare(a.entryName, b.entryName));
  if (entries.length === 0) throw new Error('Arquivo sem imagens');
  return entries.map((e) => ({
    buffer: e.getData(),
    ext: path.extname(e.entryName).toLowerCase(),
  }));
}

// "page2" < "page10" (ordenação natural, essencial para capítulos de mangá)
function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}
