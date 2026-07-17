import { Queue, Worker, type Job as BullJob } from 'bullmq';
import type { Server as SocketServer } from 'socket.io';
import type {
  OCRProvider,
  OCRRegion,
  TranslationProvider,
} from '@transynex/core-contracts';
import type { AppContext } from './context.js';

const QUEUE_NAME = 'pipeline';

export interface PipelineJobData {
  jobId: string; // id do Job no banco
  projectId: string;
  pageId: string;
  sourceLanguage: string;
  targetLanguage: string;
  ocrProviderId: string;
  translationProviderId: string;
}

function connection(redisUrl: string) {
  const url = new URL(redisUrl);
  return { host: url.hostname, port: Number(url.port || 6379) };
}

export function createQueue(ctx: AppContext): Queue<PipelineJobData> {
  return new Queue(QUEUE_NAME, { connection: connection(ctx.redisUrl) });
}

// MVP: um job BullMQ por página executa OCR → tradução em sequência,
// com progresso por etapa. A migração para BullMQ Flows (um job por step,
// conforme ARCHITECTURE.md §5) fica para quando houver inpainting/render.
export function createWorker(ctx: AppContext, io: SocketServer): Worker<PipelineJobData> {
  const worker = new Worker<PipelineJobData>(
    QUEUE_NAME,
    async (job: BullJob<PipelineJobData>) => {
      const { jobId, pageId, sourceLanguage, targetLanguage } = job.data;

      const setProgress = async (progress: number, status = 'active') => {
        await ctx.prisma.job.update({
          where: { id: jobId },
          data: { status, progress, ...(progress === 0 ? { startedAt: new Date() } : {}) },
        });
        io.emit('job:progress', { jobId, pageId, progress, status });
      };

      await setProgress(0);

      const page = await ctx.prisma.page.findUniqueOrThrow({ where: { id: pageId } });
      const ocr = ctx.registry.get<OCRProvider>('ocr', job.data.ocrProviderId);
      const translator = ctx.registry.get<TranslationProvider>(
        'translation',
        job.data.translationProviderId,
      );

      // Etapa 1: OCR (0% → 50%)
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
      await setProgress(50);

      // Etapa 2: tradução em lote (50% → 100%)
      if (ocrResult.regions.length > 0) {
        const translations = await translator.translateBatch(
          ocrResult.regions.map((r) => ({
            text: r.text,
            sourceLanguage,
            targetLanguage,
          })),
        );
        await ctx.prisma.$transaction(
          ocrResult.regions.map((r, i) =>
            ctx.prisma.ocrRegion.update({
              where: { id: r.id },
              data: { translatedText: translations[i].translatedText },
            }),
          ),
        );
      }

      await ctx.prisma.job.update({
        where: { id: jobId },
        data: { status: 'completed', progress: 100, finishedAt: new Date() },
      });
      io.emit('job:completed', { jobId, pageId, regions: ocrResult.regions.length });
    },
    { connection: connection(ctx.redisUrl), concurrency: 2 },
  );

  worker.on('failed', async (job, err) => {
    if (!job) return;
    const { jobId, pageId } = job.data;
    await ctx.prisma.job.update({
      where: { id: jobId },
      data: {
        status: job.attemptsMade >= (job.opts.attempts ?? 1) ? 'failed' : 'retrying',
        attempts: job.attemptsMade,
        error: err.message,
        finishedAt: new Date(),
      },
    });
    io.emit('job:failed', { jobId, pageId, error: err.message });
  });

  return worker;
}
