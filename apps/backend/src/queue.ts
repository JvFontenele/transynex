import path from 'node:path';
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

const QUEUE_NAME = 'transynex';

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
}

export interface ExtractJobData {
  kind: 'extract';
  jobId: string;
  projectId: string;
  sourceFileId: string;
}

export interface ExportJobData {
  kind: 'export';
  jobId: string;
  projectId: string;
  format: ExportFormat;
  exportProviderId: string;
}

export type QueueJobData = PageJobData | ExtractJobData | ExportJobData;

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

export function createWorker(ctx: AppContext, io: SocketServer): Worker<QueueJobData> {
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

    // Etapa 1: OCR (→40%)
    const ocrResult = await ocr.recognize({
      pageId,
      imageRef: page.sourceImageRef,
      languageHint: [sourceLanguage],
    });
    await ctx.prisma.ocrRegion.deleteMany({ where: { pageId } });
    await ctx.prisma.ocrRegion.createMany({
      data: ocrResult.regions.map((r: OCRRegion) => ({
        id: r.id,
        pageId,
        boundingBox: r.boundingBox as object,
        sourceText: r.text,
        confidence: r.confidence,
        readingOrder: r.readingOrder,
        orientation: r.orientation,
      })),
    });
    await setProgress(jobId, 40);

    // Etapa 2: tradução em lote (→80%)
    let translations: string[] = [];
    if (ocrResult.regions.length > 0) {
      const results = await translator.translateBatch(
        ocrResult.regions.map((r) => ({ text: r.text, sourceLanguage, targetLanguage })),
      );
      translations = results.map((t) => t.translatedText);
      await ctx.prisma.$transaction(
        ocrResult.regions.map((r, i) =>
          ctx.prisma.ocrRegion.update({
            where: { id: r.id },
            data: { translatedText: translations[i] },
          }),
        ),
      );
    }
    await setProgress(jobId, 80);

    // Etapa 3: renderização (→100%)
    if (ocrResult.regions.length > 0) {
      const rendered = await renderer.render({
        pageId,
        baseImageRef: page.inpaintedImageRef ?? page.sourceImageRef,
        textBlocks: ocrResult.regions.map((r, i) => ({
          regionId: r.id,
          boundingBox: r.boundingBox,
          text: translations[i] ?? r.text,
        })),
      });
      await ctx.prisma.page.update({
        where: { id: pageId },
        data: { renderedImageRef: rendered.imageRef },
      });
    }

    await complete(jobId, data.projectId, { pageId, regions: ocrResult.regions.length });
  };

  const processExtract = async (data: ExtractJobData) => {
    const { jobId, projectId, sourceFileId } = data;
    await setProgress(jobId, 0);

    const sourceFile = await ctx.prisma.sourceFile.findUniqueOrThrow({
      where: { id: sourceFileId },
    });
    const buffer = await ctx.storage.read(sourceFile.fileRef);
    const extracted = await extractPages(buffer, sourceFile.mimeType);
    await setProgress(jobId, 50);

    const baseOrder = await ctx.prisma.page.count({ where: { projectId } });
    for (const [i, page] of extracted.entries()) {
      const pageRef = `projects/${projectId}/pages/${sourceFileId}-${i}${page.ext}`;
      await ctx.storage.save(pageRef, page.buffer);
      await ctx.prisma.page.create({
        data: {
          projectId,
          sourceFileId,
          order: baseOrder + i,
          sourceImageRef: pageRef,
        },
      });
    }
    await ctx.prisma.sourceFile.update({
      where: { id: sourceFileId },
      data: { status: 'extracted' },
    });

    await complete(jobId, projectId, { sourceFileId, pages: extracted.length });
  };

  const processExport = async (data: ExportJobData) => {
    const { jobId, projectId, format } = data;
    await setProgress(jobId, 0);

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
      }
    },
    { connection: connection(ctx.redisUrl), concurrency: 2 },
  );

  worker.on('failed', async (job, err) => {
    if (!job) return;
    const { jobId, projectId } = job.data;
    await ctx.prisma.job.update({
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
  });

  return worker;
}
