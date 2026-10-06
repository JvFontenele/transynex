import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { Queue, Worker, type Job as BullJob } from 'bullmq';
import type { Server as SocketServer } from 'socket.io';
import type {
  ExportFormat,
  ExportProvider,
  OCRProvider,
  OCRRegion,
  RenderProvider,
  TranslationProvider,
} from '@transynex/core-contracts';
import type { AppContext } from './context.js';
import { extractPages } from './extraction.js';
import {
  chunkForTranslation,
  extractPdfParagraphs,
  paragraphsFromLines,
  type DocumentPage,
  type SaveImage,
} from './document.js';
import { buildTranslatedEpub, extractEpubParagraphs } from './epub.js';
import { enqueueRun, EPUB_MIME, type RunOptions } from './pipeline.js';

const QUEUE_NAME = 'transynex';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Considera que uma detecção do OCR "pertence" a uma região manual quando
// mais de 30% da área dela cai dentro da caixa manual — nesse caso a
// detecção é descartada para não duplicar o texto sob a marcação do usuário.
function overlapsBox(a: Box, b: Box): boolean {
  const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const area = a.width * a.height;
  return area > 0 && ix * iy > 0.3 * area;
}

export interface PageJobData {
  kind: 'page';
  jobId: string;
  projectId: string;
  pageId: string;
  sourceLanguage: string;
  targetLanguage: string;
  ocrProviderId: string;
  translationProviderId: string;
  renderProviderId: string;
  /** Preserva regiões manuais/editadas pelo usuário (default true). */
  preserveManual?: boolean;
}

export interface ExtractJobData {
  kind: 'extract';
  jobId: string;
  projectId: string;
  sourceFileId: string;
  /** Envio rápido: enfileira a tradução ao terminar a extração. */
  autoRun?: RunOptions;
}

export interface ExportJobData {
  kind: 'export';
  jobId: string;
  projectId: string;
  format: ExportFormat;
  exportProviderId: string;
}

/** Projeto DOCUMENT: extrai parágrafos do arquivo (camada de texto ou OCR). */
export interface ExtractDocJobData {
  kind: 'extract-doc';
  jobId: string;
  projectId: string;
  sourceFileId: string;
  /** Usado só no fallback de OCR (PDF escaneado). */
  sourceLanguage: string;
  ocrProviderId: string;
  autoRun?: RunOptions;
}

/** Projeto DOCUMENT: traduz os parágrafos de um arquivo em lotes. */
export interface TranslateDocJobData {
  kind: 'translate-doc';
  jobId: string;
  projectId: string;
  sourceFileId: string;
  sourceLanguage: string;
  targetLanguage: string;
  translationProviderId: string;
  /** true = descarta as traduções existentes e refaz tudo. */
  retranslate?: boolean;
}

export type QueueJobData =
  | PageJobData
  | ExtractJobData
  | ExportJobData
  | ExtractDocJobData
  | TranslateDocJobData;

function connection(redisUrl: string) {
  const url = new URL(redisUrl);
  return { host: url.hostname, port: Number(url.port || 6379) };
}

export function createQueue(ctx: AppContext): Queue<QueueJobData> {
  return new Queue(QUEUE_NAME, { connection: connection(ctx.redisUrl) });
}

// Quando não resta job pendente do projeto, define READY (ou ERROR se
// algum falhou definitivamente). Sem isso o projeto fica PROCESSING para sempre.
async function settleProjectStatus(ctx: AppContext, projectId: string): Promise<void> {
  const pending = await ctx.prisma.job.count({
    where: { projectId, status: { in: ['queued', 'active', 'retrying'] } },
  });
  if (pending > 0) return;
  const failed = await ctx.prisma.job.count({ where: { projectId, status: 'failed' } });
  await ctx.prisma.project.update({
    where: { id: projectId },
    data: { status: failed > 0 ? 'ERROR' : 'READY' },
  });
}

export function createWorker(
  ctx: AppContext,
  io: SocketServer,
  queue: Queue<QueueJobData>,
): Worker<QueueJobData> {
  // Antes do complete(): os jobs novos já contam como pendentes e o projeto
  // não "pisca" READY entre a extração e a tradução.
  const autoRun = async (projectId: string, opts?: RunOptions) => {
    if (!opts) return;
    const project = await ctx.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    await enqueueRun(ctx, queue, project, opts);
  };

  const setProgress = async (jobId: string, progress: number, extra: object = {}) => {
    await ctx.prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'active',
        progress,
        ...(progress === 0 ? { startedAt: new Date() } : {}),
        ...extra,
      },
    });
    io.emit('job:progress', { jobId, progress, status: 'active' });
  };

  const complete = async (jobId: string, projectId: string, payload: object = {}) => {
    await ctx.prisma.job.update({
      where: { id: jobId },
      data: { status: 'completed', progress: 100, finishedAt: new Date() },
    });
    io.emit('job:completed', { jobId, ...payload });
    await settleProjectStatus(ctx, projectId);
  };

  // MVP: o pipeline de uma página roda num único job (OCR → tradução →
  // render) com progresso por etapa. Migração para BullMQ Flows (um job
  // por step, ARCHITECTURE.md §5) fica para quando houver inpainting.
  const processPage = async (data: PageJobData) => {
    const { jobId, pageId, sourceLanguage, targetLanguage } = data;
    await setProgress(jobId, 0);

    const page = await ctx.prisma.page.findUniqueOrThrow({ where: { id: pageId } });
    const ocr = ctx.registry.get<OCRProvider>('ocr', data.ocrProviderId);
    const translator = ctx.registry.get<TranslationProvider>(
      'translation',
      data.translationProviderId,
    );
    const renderer = ctx.registry.get<RenderProvider>('render', data.renderProviderId);

    // Regiões manuais/editadas são preservadas por padrão; só o "resto"
    // (detecções automáticas) é apagado e refeito.
    const preserve = data.preserveManual ?? true;
    const manualRegions = preserve
      ? await ctx.prisma.ocrRegion.findMany({ where: { pageId, manual: true } })
      : [];
    await ctx.prisma.ocrRegion.deleteMany({
      where: preserve ? { pageId, manual: false } : { pageId },
    });

    // Etapa 1: OCR (→40%)
    const ocrResult = await ocr.recognize({
      pageId,
      imageRef: page.sourceImageRef,
      languageHint: [sourceLanguage],
    });
    // Descarta detecções que caem sob uma marcação manual (evita duplicar
    // texto) e gera ids novos (os ids do provider podem colidir com regiões
    // preservadas de runs anteriores).
    const baseOrder = manualRegions.reduce((m, r) => Math.max(m, (r.readingOrder ?? -1) + 1), 0);
    const newRegions = ocrResult.regions
      .filter(
        (r) =>
          !manualRegions.some((m) => overlapsBox(r.boundingBox, m.boundingBox as unknown as Box)),
      )
      .map((r: OCRRegion) => ({ ...r, id: randomUUID() }));
    await ctx.prisma.ocrRegion.createMany({
      data: newRegions.map((r) => ({
        id: r.id,
        pageId,
        boundingBox: r.boundingBox as object,
        sourceText: r.text,
        confidence: r.confidence,
        readingOrder: baseOrder + (r.readingOrder ?? 0),
        orientation: r.orientation,
      })),
    });
    await setProgress(jobId, 40);

    // Etapa 2: tradução em lote (→80%). Traduz as detecções novas e também
    // regiões manuais que ainda não têm tradução (marcadas mas não traduzidas).
    const manualToTranslate = manualRegions.filter(
      (m) => !m.translatedText && m.sourceText.trim().length > 0,
    );
    const toTranslate = [
      ...newRegions.map((r) => ({ id: r.id, text: r.text })),
      ...manualToTranslate.map((m) => ({ id: m.id, text: m.sourceText })),
    ];
    if (toTranslate.length > 0) {
      const results = await translator.translateBatch(
        toTranslate.map((r) => ({ text: r.text, sourceLanguage, targetLanguage })),
      );
      await ctx.prisma.$transaction(
        toTranslate.map((r, i) =>
          ctx.prisma.ocrRegion.update({
            where: { id: r.id },
            data: { translatedText: results[i]?.translatedText },
          }),
        ),
      );
    }
    await setProgress(jobId, 80);

    // Etapa 3: renderização (→100%) com todas as regiões da página
    // (preservadas + novas), já com as traduções aplicadas.
    const allRegions = await ctx.prisma.ocrRegion.findMany({
      where: { pageId },
      orderBy: { readingOrder: 'asc' },
    });
    const textBlocks = allRegions
      .map((r) => ({
        regionId: r.id,
        boundingBox: r.boundingBox as unknown as Box,
        text: (r.translatedText ?? r.sourceText).trim(),
      }))
      .filter((b) => b.text.length > 0);
    if (textBlocks.length > 0) {
      const rendered = await renderer.render({
        pageId,
        baseImageRef: page.inpaintedImageRef ?? page.sourceImageRef,
        textBlocks,
      });
      await ctx.prisma.page.update({
        where: { id: pageId },
        data: { renderedImageRef: rendered.imageRef },
      });
    }
    // Página re-traduzida precisa ser revisada de novo
    await ctx.prisma.page.update({ where: { id: pageId }, data: { reviewedAt: null } });

    await complete(jobId, data.projectId, { pageId, regions: allRegions.length });
  };

  // Os extratores (poppler, adm-zip) trabalham sobre um caminho: o arquivo do
  // storage é copiado em streaming para o tmp, sem passar pela memória.
  const withLocalCopy = async <T>(ref: string, fn: (filePath: string) => Promise<T>): Promise<T> => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'transynex-src-'));
    try {
      const filePath = path.join(dir, `input${path.extname(ref)}`);
      await pipeline(await ctx.storage.readStream(ref), createWriteStream(filePath));
      return await fn(filePath);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  };

  // Salva cada página assim que é extraída (o arquivo nunca fica inteiro na memória).
  const extractToPages = async (
    sourceFile: { id: string; projectId: string; mimeType: string },
    filePath: string,
  ): Promise<number> => {
    const { id: sourceFileId, projectId } = sourceFile;
    const baseOrder = await ctx.prisma.page.count({ where: { projectId } });
    return extractPages(filePath, sourceFile.mimeType, async (page, i) => {
      const pageRef = `projects/${projectId}/pages/${sourceFileId}-${i}${page.ext}`;
      await ctx.storage.save(pageRef, page.buffer);
      await ctx.prisma.page.create({
        data: { projectId, sourceFileId, order: baseOrder + i, sourceImageRef: pageRef },
      });
    });
  };

  const processExtract = async (data: ExtractJobData) => {
    const { jobId, projectId, sourceFileId } = data;
    await setProgress(jobId, 0);

    const sourceFile = await ctx.prisma.sourceFile.findUniqueOrThrow({
      where: { id: sourceFileId },
    });
    const pageCount = await withLocalCopy(sourceFile.fileRef, (filePath) =>
      extractToPages(sourceFile, filePath),
    );
    await ctx.prisma.sourceFile.update({
      where: { id: sourceFileId },
      data: { status: 'extracted' },
    });

    await autoRun(projectId, data.autoRun);
    await complete(jobId, projectId, { sourceFileId, pages: pageCount });
  };

  // --- Fluxo DOCUMENT (texto corrido) -------------------------------------

  // Fallback para PDF sem camada de texto (scan) e para imagens/CBZ enviados
  // num projeto de documento: rasteriza (se ainda não houver páginas), roda OCR
  // e agrupa as linhas em parágrafos. As linhas NÃO viram OcrRegion — no fluxo
  // de documento não há render sobre a imagem, e persistir regiões faria a tela
  // de imagem mostrar um estado que não existe.
  const ocrDocumentPages = async (
    data: ExtractDocJobData,
    sourceFile: { id: string; projectId: string; mimeType: string },
    filePath: string,
  ): Promise<DocumentPage[]> => {
    let pages = await ctx.prisma.page.findMany({
      where: { sourceFileId: sourceFile.id },
      orderBy: { order: 'asc' },
    });

    if (pages.length === 0) {
      await extractToPages(sourceFile, filePath);
      pages = await ctx.prisma.page.findMany({
        where: { sourceFileId: sourceFile.id },
        orderBy: { order: 'asc' },
      });
    }

    if (pages.length === 0) return [];

    const ocr = ctx.registry.get<OCRProvider>('ocr', data.ocrProviderId);
    const out: DocumentPage[] = [];
    for (const [i, page] of pages.entries()) {
      const result = await ocr.recognize({
        pageId: page.id,
        imageRef: page.sourceImageRef,
        languageHint: [data.sourceLanguage],
      });
      out.push({
        pageNumber: i + 1,
        paragraphs: paragraphsFromLines(
          result.regions.map((r) => ({ text: r.text, boundingBox: r.boundingBox })),
        ),
      });
      // OCR é a parte lenta: reporta progresso até 80%, o resto é banco.
      await setProgress(data.jobId, Math.round(((i + 1) / pages.length) * 80));
    }
    return out;
  };

  const processExtractDoc = async (data: ExtractDocJobData) => {
    const { jobId, projectId, sourceFileId } = data;
    await setProgress(jobId, 0);

    const sourceFile = await ctx.prisma.sourceFile.findUniqueOrThrow({
      where: { id: sourceFileId },
    });
    // Idempotente: um retry (ou re-extração) refaz os parágrafos do arquivo.
    // As Pages das imagens embutidas saem junto (cascade apaga os blocos);
    // as de scan não têm bloco e são reaproveitadas pelo OCR.
    await ctx.prisma.page.deleteMany({ where: { sourceFileId, documentBlocks: { some: {} } } });
    await ctx.prisma.documentBlock.deleteMany({ where: { sourceFileId } });

    let imageCount = 0;
    const saveImage: SaveImage = async ({ buffer, ext }) => {
      const ref = `projects/${projectId}/doc-images/${sourceFileId}-${imageCount++}${ext}`;
      await ctx.storage.save(ref, buffer);
      return ref;
    };

    let origin = sourceFile.mimeType === EPUB_MIME ? 'epub' : 'text-layer';
    const pages = await withLocalCopy(sourceFile.fileRef, async (filePath) => {
      const extracted =
        sourceFile.mimeType === EPUB_MIME
          ? extractEpubParagraphs(await fs.readFile(filePath))
          : sourceFile.mimeType === 'application/pdf'
            ? await extractPdfParagraphs(filePath, saveImage)
            : null;
      if (extracted) return extracted;
      origin = 'ocr';
      return ocrDocumentPages(data, sourceFile, filePath);
    });
    await setProgress(jobId, 90);

    const baseOrder = await ctx.prisma.documentBlock.count({ where: { projectId } });
    const paragraphs = pages.flatMap((p) =>
      p.paragraphs.map((sourceText, i) => ({
        pageNumber: p.pageNumber,
        sourceText,
        locator: p.locators?.[i] ?? null,
        imageRef: p.imageRefs?.[i],
      })),
    );
    // Cada imagem vira uma Page: traduzi-la é o mesmo job 'page' do fluxo de HQ.
    const pageIds = new Map<number, string>();
    for (const [i, p] of paragraphs.entries()) {
      if (!p.imageRef) continue;
      const page = await ctx.prisma.page.create({
        data: { projectId, sourceFileId, order: baseOrder + i, sourceImageRef: p.imageRef },
      });
      pageIds.set(i, page.id);
    }
    await ctx.prisma.documentBlock.createMany({
      data: paragraphs.map((p, i) => ({
        projectId,
        sourceFileId,
        pageNumber: p.pageNumber,
        order: baseOrder + i,
        sourceText: p.sourceText,
        locator: p.locator,
        origin,
        pageId: pageIds.get(i) ?? null,
      })),
    });
    await ctx.prisma.sourceFile.update({
      where: { id: sourceFileId },
      data: { status: 'extracted' },
    });

    await autoRun(projectId, data.autoRun);
    await complete(jobId, projectId, { sourceFileId, blocks: paragraphs.length, images: pageIds.size, origin });
  };

  const processTranslateDoc = async (data: TranslateDocJobData) => {
    const { jobId, projectId, sourceFileId, sourceLanguage, targetLanguage } = data;
    await setProgress(jobId, 0);

    const translator = ctx.registry.get<TranslationProvider>(
      'translation',
      data.translationProviderId,
    );
    if (data.retranslate) {
      await ctx.prisma.documentBlock.updateMany({
        where: { sourceFileId, pageId: null },
        data: { translatedText: null, reviewedAt: null },
      });
    }

    // Só o que falta: um retry retoma de onde parou em vez de retraduzir tudo.
    const blocks = await ctx.prisma.documentBlock.findMany({
      // Blocos-imagem (pageId) são traduzidos pelo job 'page', não aqui.
      where: { sourceFileId, translatedText: null, pageId: null },
      orderBy: { order: 'asc' },
    });

    let done = 0;
    for (const chunk of chunkForTranslation(blocks)) {
      const results = await translator.translateBatch(
        chunk.map((b) => ({ text: b.sourceText, sourceLanguage, targetLanguage })),
      );
      await ctx.prisma.$transaction(
        chunk.map((b, i) =>
          ctx.prisma.documentBlock.update({
            where: { id: b.id },
            data: { translatedText: results[i]?.translatedText ?? null },
          }),
        ),
      );
      done += chunk.length;
      await setProgress(jobId, Math.min(99, Math.round((done / blocks.length) * 100)));
    }

    await complete(jobId, projectId, { sourceFileId, translated: done });
  };

  const processExport = async (data: ExportJobData) => {
    const { jobId, projectId, format } = data;
    await setProgress(jobId, 0);

    const project = await ctx.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    if (project.kind === 'DOCUMENT') return processExportDocument(data);

    const exporter = ctx.registry.get<ExportProvider>('export', data.exportProviderId);
    const pages = await ctx.prisma.page.findMany({
      where: { projectId },
      orderBy: { order: 'asc' },
      include: { ocrRegions: { orderBy: { readingOrder: 'asc' } } },
    });

    const result = await exporter.export({
      projectId,
      format,
      pages: pages.map((p) => ({
        pageId: p.id,
        // Exporta a versão traduzida quando existir; senão a original
        imageRef: p.renderedImageRef ?? p.sourceImageRef,
        text: p.ocrRegions.map((r) => r.translatedText ?? r.sourceText).join('\n'),
      })),
    });

    const artifact = await ctx.prisma.exportArtifact.create({
      data: { projectId, format, fileRef: result.fileRef, sizeBytes: result.sizeBytes },
    });

    await complete(jobId, projectId, { artifactId: artifact.id, format });
  };

  // Documento: TXT/Markdown dos parágrafos (tradução, ou original onde falta)
  // e EPUB = livro original reescrito com as traduções.
  const processExportDocument = async (data: ExportJobData) => {
    const { jobId, projectId, format } = data;
    // ponytail: TXT/Markdown levam só o texto; embutir as imagens pede um
    // formato com anexos (zip/EPUB gerado).
    const blocks = await ctx.prisma.documentBlock.findMany({
      where: { projectId, pageId: null },
      orderBy: { order: 'asc' },
    });
    const text = (b: (typeof blocks)[number]) => b.translatedText ?? b.sourceText;

    let buffer: Buffer;
    if (format === 'epub') {
      // ponytail: projeto com vários EPUBs exporta só o primeiro; um zip por livro se precisar.
      const file = await ctx.prisma.sourceFile.findFirst({
        where: { projectId, mimeType: EPUB_MIME },
        orderBy: { createdAt: 'asc' },
      });
      if (!file) throw new Error('Projeto sem EPUB de origem para exportar');
      const translations = new Map(
        blocks
          .filter((b) => b.sourceFileId === file.id && b.locator && b.translatedText)
          .map((b) => [b.locator!, b.translatedText!]),
      );
      buffer = buildTranslatedEpub(await ctx.storage.read(file.fileRef), translations);
    } else if (format === 'markdown') {
      buffer = Buffer.from(
        blocks
          .map((b, i) =>
            i === 0 || blocks[i - 1]!.pageNumber !== b.pageNumber
              ? `## ${b.origin === 'epub' ? 'Capítulo' : 'Página'} ${b.pageNumber}\n\n${text(b)}`
              : text(b),
          )
          .join('\n\n'),
        'utf8',
      );
    } else if (format === 'txt') {
      buffer = Buffer.from(blocks.map(text).join('\n\n'), 'utf8');
    } else {
      throw new Error(`Formato não suportado para documento: ${format}`);
    }

    const ext = format === 'markdown' ? 'md' : format;
    const fileRef = `projects/${projectId}/exports/export-${Date.now()}.${ext}`;
    await ctx.storage.save(fileRef, buffer);
    const artifact = await ctx.prisma.exportArtifact.create({
      data: { projectId, format, fileRef, sizeBytes: buffer.length },
    });
    await complete(jobId, projectId, { artifactId: artifact.id, format });
  };

  const worker = new Worker<QueueJobData>(
    QUEUE_NAME,
    async (job: BullJob<QueueJobData>) => {
      switch (job.data.kind) {
        case 'page':
          return processPage(job.data);
        case 'extract':
          return processExtract(job.data);
        case 'export':
          return processExport(job.data);
        case 'extract-doc':
          return processExtractDoc(job.data);
        case 'translate-doc':
          return processTranslateDoc(job.data);
      }
    },
    { connection: connection(ctx.redisUrl), concurrency: 2 },
  );

  worker.on('failed', async (job, err) => {
    if (!job) return;
    const { jobId, projectId } = job.data;
    try {
      // updateMany não lança P2025 quando o Job foi apagado do banco mas o
      // job BullMQ sobreviveu no Redis (ex: retry pendente de um boot antigo)
      // — sem isso, um job órfão derruba o processo inteiro.
      await ctx.prisma.job.updateMany({
        where: { id: jobId },
        data: {
          status: job.attemptsMade >= (job.opts.attempts ?? 1) ? 'failed' : 'retrying',
          attempts: job.attemptsMade,
          error: err.message,
          finishedAt: new Date(),
        },
      });
      io.emit('job:failed', { jobId, error: err.message });
      await settleProjectStatus(ctx, projectId);
    } catch (e) {
      console.error('Falha ao registrar job com erro', jobId, e);
    }
  });

  return worker;
}
