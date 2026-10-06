import path from 'node:path';
import AdmZip from 'adm-zip';
import { DOMParser } from 'linkedom';
import type { DocumentPage } from './document.js';

// EPUB → parágrafos (DocumentBlock) e de volta (EPUB traduzido).
//
// Cada parágrafo ganha um locator "spineIdx:blockIdx": índice do capítulo no
// spine + posição entre os blocos-folha do capítulo. O leitor do frontend
// (EpubReaderView) aplica a MESMA regra (BLOCK_SELECTOR + leafBlocks) no DOM
// renderizado pelo epub.js para trocar o texto pela tradução — mudou aqui,
// mude lá.

export const BLOCK_SELECTOR = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,dt,dd';

const normalize = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim();

/** Blocos com texto que não contêm outro bloco (evita contar <li><p> duas vezes). */
export function leafBlocks(doc: { querySelectorAll(s: string): Iterable<unknown> }): Element[] {
  return ([...doc.querySelectorAll(BLOCK_SELECTOR)] as Element[]).filter(
    (el) => normalize(el.textContent) && !el.querySelector(BLOCK_SELECTOR),
  );
}

interface Chapter {
  /** Caminho do XHTML dentro do zip */
  entry: string;
  spineIndex: number;
}

const xml = (s: string) => new DOMParser().parseFromString(s, 'text/xml');

/** Capítulos na ordem do spine (container.xml → OPF → manifest/spine). */
function chapters(zip: AdmZip): Chapter[] {
  const container = zip.readAsText('META-INF/container.xml');
  const opfPath = xml(container).querySelector('rootfile')?.getAttribute('full-path');
  if (!opfPath) throw new Error('EPUB inválido: container.xml sem rootfile');
  const opf = xml(zip.readAsText(opfPath));
  const base = path.posix.dirname(opfPath);

  const hrefs = new Map<string, string>();
  for (const item of opf.querySelectorAll('manifest > item')) {
    hrefs.set(item.getAttribute('id') ?? '', item.getAttribute('href') ?? '');
  }
  return [...opf.querySelectorAll('spine > itemref')].flatMap((ref, spineIndex) => {
    const href = hrefs.get(ref.getAttribute('idref') ?? '');
    if (!href) return [];
    const entry = path.posix.normalize(path.posix.join(base, decodeURIComponent(href)));
    return [{ entry, spineIndex }];
  });
}

/** Parágrafos por capítulo; `pageNumber` = capítulo (1-based). */
export function extractEpubParagraphs(buffer: Buffer): DocumentPage[] {
  const zip = new AdmZip(buffer);
  return chapters(zip).flatMap(({ entry, spineIndex }) => {
    if (!zip.getEntry(entry)) return [];
    const blocks = leafBlocks(xml(zip.readAsText(entry)));
    if (blocks.length === 0) return [];
    return [
      {
        pageNumber: spineIndex + 1,
        paragraphs: blocks.map((el) => normalize(el.textContent)),
        locators: blocks.map((_, i) => `${spineIndex}:${i}`),
      },
    ];
  });
}

/**
 * Reescreve o EPUB original com as traduções (locator → texto).
 * ponytail: troca o textContent do bloco inteiro, então itálico/negrito no
 * meio do parágrafo se perdem; mapear por nó de texto se isso incomodar.
 */
export function buildTranslatedEpub(buffer: Buffer, translations: Map<string, string>): Buffer {
  // noSort: o adm-zip ordena as entradas ao gravar, e a spec exige o
  // "mimetype" como primeira entrada do zip.
  const zip = new AdmZip(buffer, { noSort: true });
  for (const { entry, spineIndex } of chapters(zip)) {
    if (!zip.getEntry(entry)) continue;
    const doc = xml(zip.readAsText(entry));
    let changed = false;
    leafBlocks(doc).forEach((el, i) => {
      const text = translations.get(`${spineIndex}:${i}`);
      if (text) {
        el.textContent = text;
        changed = true;
      }
    });
    if (changed) zip.updateFile(entry, Buffer.from(doc.toString(), 'utf8'));
  }
  return zip.toBuffer();
}
