import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Página do documento com seus parágrafos já reconstruídos. */
export interface DocumentPage {
  /** 1-based, como o usuário conta as páginas do PDF. */
  pageNumber: number;
  paragraphs: string[];
  /** EPUB: posição de cada parágrafo no XHTML ("capítulo:bloco"), para reescrever/ler. */
  locators?: string[];
}

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
 */
export async function extractPdfParagraphs(buffer: Buffer): Promise<DocumentPage[] | null> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'transynex-doc-'));
  try {
    const pdfPath = path.join(dir, 'input.pdf');
    await fs.writeFile(pdfPath, buffer);
    const { stdout } = await execFileAsync(
      'pdftotext',
      ['-bbox-layout', pdfPath, '-'],
      // Documentos longos passam fácil do maxBuffer default (1 MB)
      { maxBuffer: 256 * 1024 * 1024 },
    );

    const pages = parseBboxLayout(stdout);
    if (pages.length === 0) return null;

    // Um scan pode ter texto residual (marca d'água, cabeçalho carimbado) em
    // toda página. Só aceitamos a camada de texto quando a maioria das páginas
    // tem volume de texto compatível com um documento de verdade.
    const pagesWithText = pages.filter(
      (p) => letterCount(p.paragraphs.join(' ')) >= MIN_LETTERS_PER_PAGE,
    ).length;
    if (pagesWithText * 2 < pages.length) return null;

    return pages;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

// Tags que interessam no XHTML do -bbox-layout; o resto (doc, flow, head…) é
// ignorado. Evita uma dependência de parser XML para uma estrutura tão fixa.
const BBOX_TOKEN = /<page\b|<block\b|<line\b([^>]*)>|<word\b[^>]*>([\s\S]*?)<\/word>/g;

function parseBboxLayout(xml: string): DocumentPage[] {
  const pages: DocumentPage[] = [];
  let lines: TextLine[] = [];
  let current: TextLine | null = null;

  // Um bloco do poppler já é um candidato a parágrafo, mas pode conter vários
  // (quando o espaçamento é apertado): a fronteira de bloco força o corte e a
  // geometria das linhas corta o que sobrar dentro dele.
  const flushBlock = () => {
    if (lines.length === 0) return;
    const page = pages.at(-1);
    if (page) page.paragraphs.push(...paragraphsFromLines(lines));
    lines = [];
    current = null;
  };

  for (const match of xml.matchAll(BBOX_TOKEN)) {
    const [tag, lineAttrs, word] = match;
    if (tag.startsWith('<page')) {
      flushBlock();
      pages.push({ pageNumber: pages.length + 1, paragraphs: [] });
    } else if (tag.startsWith('<block')) {
      flushBlock();
    } else if (lineAttrs !== undefined) {
      current = { text: '', boundingBox: boxFromAttrs(lineAttrs) };
      lines.push(current);
    } else if (word !== undefined && current) {
      const text = decodeEntities(word);
      current.text = current.text ? `${current.text} ${text}` : text;
    }
  }
  flushBlock();

  return pages;
}

function boxFromAttrs(attrs: string): TextLine['boundingBox'] {
  const num = (name: string) =>
    Number(new RegExp(`${name}="(-?[0-9.]+)"`).exec(attrs)?.[1] ?? '0');
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
  const usable = lines.filter((l) => l.text.trim().length > 0);
  if (usable.length === 0) return [];

  const median = medianHeight(usable);
  const paragraphs: string[] = [];
  let current: TextLine[] = [];

  const flush = () => {
    if (current.length === 0) return;
    const text = joinWrappedLines(current.map((l) => l.text.trim()).join('\n'));
    if (isMeaningfulText(text)) paragraphs.push(text);
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
