import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

/** Página do documento com seus parágrafos já reconstruídos. */
export interface DocumentPage {
  /** 1-based, como o usuário conta as páginas do PDF. */
  pageNumber: number;
  paragraphs: string[];
  /** EPUB: posição de cada parágrafo no XHTML ("capítulo:bloco"), para reescrever/ler. */
  locators?: string[];
  /** PDF: StorageRef da imagem quando o "parágrafo" é uma imagem embutida (texto vazio). */
  imageRefs?: (string | undefined)[];
}

/** Grava uma imagem extraída e devolve o StorageRef dela. */
export type SaveImage = (image: { buffer: Buffer; ext: string; pageNumber: number }) => Promise<string>;

/**
 * Um parágrafo com menos que isso é ruído de camada de texto (número de
 * página, marca d'água, cabeçalho) — usado só para decidir se o PDF tem
 * camada de texto de verdade ou é um scan.
 */
const MIN_LETTERS_PER_PAGE = 40;

/**
 * Extrai a camada de texto de um PDF via `pdftotext` (poppler, já presente na
 * imagem do backend para o `pdftoppm`).
 *
 * Usa `-bbox-layout` em vez do modo texto: o modo texto não marca fim de
 * parágrafo (só quebra de página), então parágrafos consecutivos sairiam
 * colados num bloco só. O `-bbox-layout` devolve a análise de layout do poppler
 * (páginas → blocos → linhas → palavras, com coordenadas), e o corte de
 * parágrafo é decidido pela mesma geometria usada no caminho de OCR.
 *
 * Retorna `null` quando o PDF não tem camada de texto utilizável (PDF
 * escaneado) — nesse caso o chamador cai para rasterizar + OCR.
 *
 * Com `saveImage`, as imagens embutidas entram no meio dos parágrafos, na
 * altura em que aparecem na página.
 */
export async function extractPdfParagraphs(
  buffer: Buffer,
  saveImage?: SaveImage,
): Promise<DocumentPage[] | null> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'transynex-doc-'));
  try {
    const pdfPath = path.join(dir, 'input.pdf');
    await fs.writeFile(pdfPath, buffer);
    // Lido em streaming: o XHTML do -bbox-layout tem uma tag por linha e, num
    // livro grande, passa de centenas de MB — nunca vira uma string só.
    const pages = await parseBboxLayout(spawnLines('pdftotext', ['-bbox-layout', pdfPath, '-']));
    if (pages.length === 0) return null;

    // Um scan pode ter texto residual (marca d'água, cabeçalho carimbado) em
    // toda página. Só aceitamos a camada de texto quando a maioria das páginas
    // tem volume de texto compatível com um documento de verdade.
    const pagesWithText = pages.filter(
      (p) => letterCount(p.paragraphs.map((q) => q.text).join(' ')) >= MIN_LETTERS_PER_PAGE,
    ).length;
    if (pagesWithText * 2 < pages.length) return null;

    // Imagem é bônus: se o pdftohtml falhar, o texto continua valendo.
    const images = saveImage
      ? await listPdfImages(pdfPath, dir).catch((e) => {
          console.warn('Falha ao extrair imagens do PDF; seguindo só com o texto', e);
          return new Map<number, PdfImage[]>();
        })
      : new Map<number, PdfImage[]>();

    const out: DocumentPage[] = [];
    for (const page of pages) {
      const pending = images.get(page.pageNumber) ?? [];
      const paragraphs: string[] = [];
      const imageRefs: (string | undefined)[] = [];
      const emitImagesAbove = async (top: number) => {
        while (pending.length > 0 && pending[0]!.top <= top) {
          const img = pending.shift()!;
          imageRefs[paragraphs.length] = await saveImage!({
            buffer: await fs.readFile(img.file),
            ext: path.extname(img.file),
            pageNumber: page.pageNumber,
          });
          paragraphs.push('');
        }
      };
      // ponytail: posição pela altura na página; em layout de duas colunas a
      // imagem da coluna direita entra antes do texto da esquerda abaixo dela.
      for (const p of page.paragraphs) {
        await emitImagesAbove(p.top);
        paragraphs.push(p.text);
      }
      await emitImagesAbove(Infinity);
      out.push({
        pageNumber: page.pageNumber,
        paragraphs,
        ...(imageRefs.length > 0 ? { imageRefs } : {}),
      });
    }
    return out;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** Linhas do stdout de um comando, em streaming; lança se ele sair com erro. */
async function* spawnLines(cmd: string, args: string[]): AsyncGenerator<string> {
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] });
  const exited = once(child, 'close');
  exited.catch(() => {}); // ENOENT antes do await não vira unhandledRejection
  yield* readline.createInterface({ input: child.stdout });
  const [code] = await exited;
  if (code !== 0) throw new Error(`${cmd} saiu com código ${code}`);
}

interface PdfImage {
  top: number;
  /** Arquivo temporário escrito pelo pdftohtml */
  file: string;
}

// Imagens menores que isso (em pt²) são ícone, marcador ou fio decorativo.
const MIN_IMAGE_AREA = 50 * 50;
// Imagem cobrindo quase a página toda é o fundo de um PDF escaneado com
// camada de texto (OCR embutido) — repeti-la seria duplicar a página.
const MAX_IMAGE_PAGE_COVERAGE = 0.85;

/**
 * Imagens embutidas por página via `pdftohtml -xml` (poppler): grava cada
 * imagem em `dir` e lista a posição dela. Com `-zoom 1` as coordenadas saem em
 * pontos, as mesmas do `-bbox-layout` do pdftotext.
 */
async function listPdfImages(pdfPath: string, dir: string): Promise<Map<number, PdfImage[]>> {
  const byPage = new Map<number, PdfImage[]>();
  let pageNumber = 0;
  let pageArea = Infinity;
  const lines = spawnLines('pdftohtml', [
    '-xml', '-stdout', '-zoom', '1', '-q', pdfPath, path.join(dir, 'img'),
  ]);
  for await (const line of lines) {
    if (line.startsWith('<page ')) {
      pageNumber = numAttr(line, 'number');
      pageArea = numAttr(line, 'width') * numAttr(line, 'height') || Infinity;
    } else if (line.startsWith('<image ')) {
      const area = numAttr(line, 'width') * numAttr(line, 'height');
      const file = /src="([^"]+)"/.exec(line)?.[1];
      if (!file || area < MIN_IMAGE_AREA || area > MAX_IMAGE_PAGE_COVERAGE * pageArea) continue;
      const list = byPage.get(pageNumber) ?? [];
      list.push({ top: numAttr(line, 'top'), file: decodeEntities(file) });
      byPage.set(pageNumber, list);
    }
  }
  for (const list of byPage.values()) list.sort((a, b) => a.top - b.top);
  return byPage;
}

const numAttr = (attrs: string, name: string) =>
  Number(new RegExp(`\\b${name}="(-?[0-9.]+)"`).exec(attrs)?.[1] ?? '0');

// Tags que interessam no XHTML do -bbox-layout; o resto (doc, flow, head…) é
// ignorado. Evita uma dependência de parser XML para uma estrutura tão fixa.
const BBOX_TOKEN = /<page\b|<block\b|<line\b([^>]*)>|<word\b[^>]*>([\s\S]*?)<\/word>/g;

interface LayoutPage {
  pageNumber: number;
  paragraphs: Paragraph[];
}

async function parseBboxLayout(lines: AsyncIterable<string>): Promise<LayoutPage[]> {
  const pages: LayoutPage[] = [];
  let blockLines: TextLine[] = [];
  let current: TextLine | null = null;

  // Um bloco do poppler já é um candidato a parágrafo, mas pode conter vários
  // (quando o espaçamento é apertado): a fronteira de bloco força o corte e a
  // geometria das linhas corta o que sobrar dentro dele.
  const flushBlock = () => {
    if (blockLines.length === 0) return;
    const page = pages.at(-1);
    if (page) page.paragraphs.push(...paragraphsWithTop(blockLines));
    blockLines = [];
    current = null;
  };

  for await (const xmlLine of lines) {
    for (const match of xmlLine.matchAll(BBOX_TOKEN)) {
      const [tag, lineAttrs, word] = match;
      if (tag.startsWith('<page')) {
        flushBlock();
        pages.push({ pageNumber: pages.length + 1, paragraphs: [] });
      } else if (tag.startsWith('<block')) {
        flushBlock();
      } else if (lineAttrs !== undefined) {
        current = { text: '', boundingBox: boxFromAttrs(lineAttrs) };
        blockLines.push(current);
      } else if (word !== undefined && current) {
        const text = decodeEntities(word);
        current.text = current.text ? `${current.text} ${text}` : text;
      }
    }
  }
  flushBlock();

  return pages;
}

function boxFromAttrs(attrs: string): TextLine['boundingBox'] {
  const num = (name: string) => numAttr(attrs, name);
  const xMin = num('xMin');
  const yMin = num('yMin');
  return { x: xMin, y: yMin, width: num('xMax') - xMin, height: num('yMax') - yMin };
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Junta as linhas de um parágrafo quebrado pela largura da página, desfazendo
 * a hifenização de fim de linha ("exem-\nplo" → "exemplo").
 */
function joinWrappedLines(chunk: string): string {
  const lines = chunk
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  let out = '';
  for (const line of lines) {
    if (out === '') out = line;
    else if (/\p{L}-$/u.test(out)) out = out.slice(0, -1) + line;
    else out += ` ${line}`;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** Descarta números de página, réguas e sobras sem nenhuma letra. */
function isMeaningfulText(text: string): boolean {
  return text.length > 0 && /\p{L}/u.test(text);
}

function letterCount(text: string): number {
  return text.match(/\p{L}/gu)?.length ?? 0;
}

/** Linha de texto com posição — vem do OCR ou do -bbox-layout do pdftotext. */
export interface TextLine {
  text: string;
  boundingBox: { x: number; y: number; width: number; height: number };
}

/**
 * Agrupa linhas em parágrafos pela geometria. As linhas chegam na ordem de
 * leitura de quem as produziu (o OCR e o poppler já resolvem colunas), então
 * nunca reordenamos: só decidimos onde cortar o parágrafo.
 */
export function paragraphsFromLines(lines: TextLine[]): string[] {
  return paragraphsWithTop(lines).map((p) => p.text);
}

/** Parágrafo com a altura (y) da primeira linha — para intercalar imagens. */
interface Paragraph {
  text: string;
  top: number;
}

function paragraphsWithTop(lines: TextLine[]): Paragraph[] {
  const usable = lines.filter((l) => l.text.trim().length > 0);
  if (usable.length === 0) return [];

  const median = medianHeight(usable);
  const paragraphs: Paragraph[] = [];
  let current: TextLine[] = [];

  const flush = () => {
    if (current.length === 0) return;
    const text = joinWrappedLines(current.map((l) => l.text.trim()).join('\n'));
    if (isMeaningfulText(text)) paragraphs.push({ text, top: current[0]!.boundingBox.y });
    current = [];
  };

  for (const line of usable) {
    const prev = current.at(-1);
    if (prev) {
      const gap = line.boundingBox.y - (prev.boundingBox.y + prev.boundingBox.height);
      // Espaçamento maior que ~¾ de linha = parágrafo novo; recuo de primeira
      // linha (indentação de livro) também.
      const indent = line.boundingBox.x - current[0].boundingBox.x;
      if (gap > 0.75 * median || indent > median) flush();
    }
    current.push(line);
  }
  flush();

  return paragraphs;
}

function medianHeight(lines: TextLine[]): number {
  const heights = lines.map((l) => l.boundingBox.height).sort((a, b) => a - b);
  return heights[Math.floor(heights.length / 2)] || 1;
}

/**
 * Divide os parágrafos em lotes de tradução: o provider recebe vários de uma
 * vez (contexto compartilhado, menos chamadas), mas sem estourar o prompt.
 */
export function chunkForTranslation<T extends { sourceText: string }>(
  blocks: T[],
  maxItems = 15,
  maxChars = 4000,
): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let chars = 0;

  for (const block of blocks) {
    const size = block.sourceText.length;
    if (current.length > 0 && (current.length >= maxItems || chars + size > maxChars)) {
      chunks.push(current);
      current = [];
      chars = 0;
    }
    current.push(block);
    chars += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
