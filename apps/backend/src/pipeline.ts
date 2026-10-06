import path from 'node:path';
import type { Queue } from 'bullmq';
import type { Project } from '@prisma/client';
import type { AppContext } from './context.js';
import type { QueueJobData } from './queue.js';

// Upload e execução do pipeline, compartilhados pelas rotas de projeto, pelo
// envio rápido (/quick) e pelo worker (auto-run após a extração).

export const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/tiff']);
export const EXTRACT_MIMES = new Set([
  'application/pdf',
  'application/zip',
  'application/x-cbz',
  'application/vnd.comicbook+zip',
]);

/** EPUB só faz sentido como documento (texto corrido), nunca como imagem. */
export const EPUB_MIME = 'application/epub+zip';

export interface RunOptions {
  ocrProviderId?: string;
  translationProviderId?: string;
  renderProviderId?: string;
  /** Preserva regiões manuais/editadas pelo usuário (default true). */
  preserveManual?: boolean;
  /** Só DOCUMENT: refaz também os parágrafos já traduzidos. */
  retranslate?: boolean;
  /** Só DOCUMENT: traduz também as imagens embutidas (OCR → tradução → render). */
  translateImages?: boolean;
}

export interface UploadedFile {
  filename: string;
  mimetype: string;
  buffer: Buffer;
}

type Result = { code: number; body: Record<string, unknown> };

// Fallback: default configurado na tela de Plugins, depois o built-in
export const defaultProviderFor = async (ctx: AppContext, type: string, fallback: string) =>
  (await ctx.prisma.providerConfig.findFirst({ where: { type, isDefault: true } }))?.providerId ??
  fallback;

export const isSupportedMime = (mime: string) =>
  IMAGE_MIMES.has(mime) || EXTRACT_MIMES.has(mime) || mime === EPUB_MIME;

/**
 * Salva o arquivo no projeto. Imagens soltas viram Page direto; PDF/CBZ/ZIP
 * (e todo upload de projeto DOCUMENT) disparam um job de extração.
 * `autoRun` faz o worker enfileirar a tradução assim que a extração terminar.
 */
export async function ingestFile(
  ctx: AppContext,
  queue: Queue<QueueJobData>,
  project: Project,
  file: UploadedFile,
  autoRun?: RunOptions,
): Promise<Result> {
  const isImage = IMAGE_MIMES.has(file.mimetype);
  if (!isSupportedMime(file.mimetype)) {
    return { code: 415, body: { error: `Tipo não suportado: ${file.mimetype}` } };
  }
  if (file.mimetype === EPUB_MIME && project.kind !== 'DOCUMENT') {
    return { code: 415, body: { error: 'EPUB só é aceito em projetos de documento' } };
  }

  const sourceFile = await ctx.prisma.sourceFile.create({
    data: {
      projectId: project.id,
      fileName: file.filename,
      mimeType: file.mimetype,
      fileRef: '',
      sizeBytes: file.buffer.length,
      status: 'extracting',
    },
  });

  const ext = path.extname(file.filename) || '';
  const fileRef = `projects/${project.id}/source/${sourceFile.id}${ext}`;
  await ctx.storage.save(fileRef, file.buffer);
  await ctx.prisma.sourceFile.update({ where: { id: sourceFile.id }, data: { fileRef } });

  const createPage = () =>
    ctx.prisma.page.count({ where: { projectId: project.id } }).then((order) =>
      ctx.prisma.page.create({
        data: { projectId: project.id, sourceFileId: sourceFile.id, order, sourceImageRef: fileRef },
      }),
    );

  // Projeto de documento: todo upload passa por um job de extração de
  // parágrafos (camada de texto do PDF ou, se for scan, OCR). Imagens soltas
  // também ganham uma Page, porque o fallback de OCR lê a partir dela.
  if (project.kind === 'DOCUMENT') {
    if (isImage) await createPage();
    const job = await ctx.prisma.job.create({
      data: { projectId: project.id, type: 'extraction', status: 'queued' },
    });
    await queue.add(
      'extract-doc',
      {
        kind: 'extract-doc',
        jobId: job.id,
        projectId: project.id,
        sourceFileId: sourceFile.id,
        sourceLanguage: project.sourceLanguage,
        ocrProviderId:
          autoRun?.ocrProviderId ?? (await defaultProviderFor(ctx, 'ocr', 'tesseract-ocr')),
        autoRun,
      },
      { attempts: 2 },
    );
    return { code: 202, body: { sourceFileId: sourceFile.id, jobId: job.id } };
  }

  if (isImage) {
    const page = await createPage();
    await ctx.prisma.sourceFile.update({
      where: { id: sourceFile.id },
      data: { status: 'extracted' },
    });
    if (autoRun) await enqueueRun(ctx, queue, project, autoRun);
    return { code: 201, body: { sourceFileId: sourceFile.id, pageId: page.id } };
  }

  const job = await ctx.prisma.job.create({
    data: { projectId: project.id, type: 'extraction', status: 'queued' },
  });
  await queue.add(
    'extract',
    { kind: 'extract', jobId: job.id, projectId: project.id, sourceFileId: sourceFile.id, autoRun },
    { attempts: 2 },
  );
  return { code: 202, body: { sourceFileId: sourceFile.id, jobId: job.id } };
}

/** Enfileira OCR→tradução→render (IMAGE) ou tradução dos parágrafos (DOCUMENT). */
export async function enqueueRun(
  ctx: AppContext,
  queue: Queue<QueueJobData>,
  project: Project,
  opts: RunOptions = {},
): Promise<Result> {
  const ocrProviderId =
    opts.ocrProviderId ?? (await defaultProviderFor(ctx, 'ocr', 'tesseract-ocr'));
  const translationProviderId =
    opts.translationProviderId ??
    (await defaultProviderFor(ctx, 'translation', 'libretranslate'));

  // Página → job 'page' (OCR → tradução → render). Serve as páginas de HQ e
  // as imagens embutidas de um documento.
  const enqueuePages = async (pages: { id: string }[]): Promise<string[]> => {
    const renderProviderId =
      opts.renderProviderId ?? (await defaultProviderFor(ctx, 'render', 'canvas-render'));
    const jobIds: string[] = [];
    for (const page of pages) {
      const job = await ctx.prisma.job.create({
        data: { projectId: project.id, pageId: page.id, type: 'ocr', status: 'queued' },
      });
      await queue.add(
        'page',
        {
          kind: 'page',
          jobId: job.id,
          projectId: project.id,
          pageId: page.id,
          sourceLanguage: project.sourceLanguage,
          targetLanguage: project.targetLanguage,
          ocrProviderId,
          translationProviderId,
          renderProviderId,
          // Default: preservar marcações manuais do usuário
          preserveManual: opts.preserveManual ?? true,
        },
        { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
      );
      jobIds.push(job.id);
    }
    return jobIds;
  };

  // Documento: um job de tradução por arquivo, sobre os parágrafos extraídos.
  if (project.kind === 'DOCUMENT') {
    const files = await ctx.prisma.sourceFile.findMany({
      where: { projectId: project.id, documentBlocks: { some: { pageId: null } } },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (files.length === 0) {
      return {
        code: 400,
        body: { error: 'Nenhum texto extraído ainda — envie um arquivo e aguarde a extração' },
      };
    }
    await ctx.prisma.project.update({ where: { id: project.id }, data: { status: 'PROCESSING' } });
    const jobIds: string[] = [];
    for (const file of files) {
      const job = await ctx.prisma.job.create({
        data: { projectId: project.id, type: 'translation', status: 'queued' },
      });
      await queue.add(
        'translate-doc',
        {
          kind: 'translate-doc',
          jobId: job.id,
          projectId: project.id,
          sourceFileId: file.id,
          sourceLanguage: project.sourceLanguage,
          targetLanguage: project.targetLanguage,
          translationProviderId,
          retranslate: opts.retranslate ?? false,
        },
        { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
      );
      jobIds.push(job.id);
    }
    if (opts.translateImages) {
      // Como no texto: sem `retranslate`, só as imagens ainda não traduzidas.
      // ponytail: imagem sem texto nunca ganha render e é reanalisada a cada run.
      const imagePages = await ctx.prisma.page.findMany({
        where: {
          projectId: project.id,
          documentBlocks: { some: {} },
          ...(opts.retranslate ? {} : { renderedImageRef: null }),
        },
        select: { id: true },
        orderBy: { order: 'asc' },
      });
      jobIds.push(...(await enqueuePages(imagePages)));
    }
    return { code: 202, body: { jobIds } };
  }

  const pages = await ctx.prisma.page.findMany({
    where: { projectId: project.id },
    orderBy: { order: 'asc' },
  });
  if (pages.length === 0) return { code: 400, body: { error: 'Projeto sem páginas' } };

  await ctx.prisma.project.update({ where: { id: project.id }, data: { status: 'PROCESSING' } });
  return { code: 202, body: { jobIds: await enqueuePages(pages) } };
}
