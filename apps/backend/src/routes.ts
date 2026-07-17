import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Queue } from 'bullmq';
import type { AppContext } from './context.js';
import type { PipelineJobData } from './queue.js';

const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/tiff']);

export function registerRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  queue: Queue<PipelineJobData>,
): void {
  // --- Projects ---------------------------------------------------------

  app.post<{ Body: { name: string; sourceLanguage: string; targetLanguage: string } }>(
    '/api/v1/projects',
    async (req, reply) => {
      const { name, sourceLanguage, targetLanguage } = req.body;
      if (!name || !sourceLanguage || !targetLanguage) {
        return reply.code(400).send({ error: 'name, sourceLanguage e targetLanguage são obrigatórios' });
      }
      const project = await ctx.prisma.project.create({
        data: { name, sourceLanguage, targetLanguage },
      });
      return reply.code(201).send(project);
    },
  );

  app.get('/api/v1/projects', async () =>
    ctx.prisma.project.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { pages: true, jobs: true } } },
    }),
  );

  app.get<{ Params: { id: string } }>('/api/v1/projects/:id', async (req, reply) => {
    const project = await ctx.prisma.project.findUnique({
      where: { id: req.params.id },
      include: { sourceFiles: true, _count: { select: { pages: true } } },
    });
    if (!project) return reply.code(404).send({ error: 'Projeto não encontrado' });
    return project;
  });

  app.delete<{ Params: { id: string } }>('/api/v1/projects/:id', async (req, reply) => {
    await ctx.prisma.project.delete({ where: { id: req.params.id } });
    return reply.code(204).send();
  });

  // --- Uploads ----------------------------------------------------------
  // MVP: aceita imagens; cada imagem vira um SourceFile já "extracted" com
  // uma Page. Extração de PDF/CBZ entra como job 'extraction' na sequência.

  app.post<{ Params: { id: string } }>('/api/v1/projects/:id/uploads', async (req, reply) => {
    const project = await ctx.prisma.project.findUnique({ where: { id: req.params.id } });
    if (!project) return reply.code(404).send({ error: 'Projeto não encontrado' });

    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'Nenhum arquivo enviado' });
    if (!IMAGE_MIMES.has(file.mimetype)) {
      return reply.code(415).send({ error: `Tipo não suportado nesta fase: ${file.mimetype}` });
    }

    const buffer = await file.toBuffer();
    const sourceFile = await ctx.prisma.sourceFile.create({
      data: {
        projectId: project.id,
        fileName: file.filename,
        mimeType: file.mimetype,
        fileRef: '',
        sizeBytes: buffer.length,
        status: 'extracting',
      },
    });

    const ext = path.extname(file.filename) || '.png';
    const fileRef = `projects/${project.id}/source/${sourceFile.id}${ext}`;
    await ctx.storage.save(fileRef, buffer);

    const pageCount = await ctx.prisma.page.count({ where: { projectId: project.id } });
    const page = await ctx.prisma.page.create({
      data: {
        projectId: project.id,
        sourceFileId: sourceFile.id,
        order: pageCount,
        sourceImageRef: fileRef,
      },
    });
    await ctx.prisma.sourceFile.update({
      where: { id: sourceFile.id },
      data: { fileRef, status: 'extracted' },
    });

    return reply.code(201).send({ sourceFileId: sourceFile.id, pageId: page.id });
  });

  // --- Pages e Regions (correção) ----------------------------------------

  app.get<{ Params: { id: string } }>('/api/v1/projects/:id/pages', async (req) =>
    ctx.prisma.page.findMany({
      where: { projectId: req.params.id },
      orderBy: { order: 'asc' },
      include: { ocrRegions: { orderBy: { readingOrder: 'asc' } } },
    }),
  );

  app.patch<{
    Params: { id: string };
    Body: { sourceText?: string; translatedText?: string; boundingBox?: object };
  }>('/api/v1/regions/:id', async (req, reply) => {
    const region = await ctx.prisma.ocrRegion.findUnique({ where: { id: req.params.id } });
    if (!region) return reply.code(404).send({ error: 'Região não encontrada' });

    const updated = await ctx.prisma.ocrRegion.update({
      where: { id: region.id },
      data: {
        sourceText: req.body.sourceText,
        translatedText: req.body.translatedText,
        boundingBox: req.body.boundingBox,
      },
    });
    // Editar região invalida a renderização da página (regra do ARCHITECTURE.md §7).
    await ctx.prisma.page.update({
      where: { id: region.pageId },
      data: { renderedImageRef: null },
    });
    return updated;
  });

  // --- Pipeline run -------------------------------------------------------

  app.post<{
    Params: { id: string };
    Body: { ocrProviderId?: string; translationProviderId?: string } | undefined;
  }>('/api/v1/projects/:id/run', async (req, reply) => {
    const project = await ctx.prisma.project.findUnique({ where: { id: req.params.id } });
    if (!project) return reply.code(404).send({ error: 'Projeto não encontrado' });

    const ocrProviderId = req.body?.ocrProviderId ?? 'tesseract-ocr';
    const translationProviderId = req.body?.translationProviderId ?? 'libretranslate';

    const pages = await ctx.prisma.page.findMany({
      where: { projectId: project.id },
      orderBy: { order: 'asc' },
    });
    if (pages.length === 0) return reply.code(400).send({ error: 'Projeto sem páginas' });

    await ctx.prisma.project.update({
      where: { id: project.id },
      data: { status: 'PROCESSING' },
    });

    const jobIds: string[] = [];
    for (const page of pages) {
      const job = await ctx.prisma.job.create({
        data: { projectId: project.id, pageId: page.id, type: 'ocr', status: 'queued' },
      });
      await queue.add(
        'page',
        {
          jobId: job.id,
          projectId: project.id,
          pageId: page.id,
          sourceLanguage: project.sourceLanguage,
          targetLanguage: project.targetLanguage,
          ocrProviderId,
          translationProviderId,
        },
        { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
      );
      jobIds.push(job.id);
    }

    return reply.code(202).send({ jobIds });
  });

  // --- Jobs ----------------------------------------------------------------

  app.get<{ Querystring: { projectId?: string } }>('/api/v1/jobs', async (req) =>
    ctx.prisma.job.findMany({
      where: req.query.projectId ? { projectId: req.query.projectId } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
  );

  app.get<{ Params: { id: string } }>('/api/v1/jobs/:id', async (req, reply) => {
    const job = await ctx.prisma.job.findUnique({ where: { id: req.params.id } });
    if (!job) return reply.code(404).send({ error: 'Job não encontrado' });
    return job;
  });

  // --- Providers -------------------------------------------------------------

  app.get('/api/v1/providers', async () => ({
    ocr: ctx.registry.list('ocr'),
    translation: ctx.registry.list('translation'),
    storage: ctx.registry.list('storage'),
  }));

  app.get('/api/v1/providers/health', async () => ctx.registry.healthCheckAll());
}
