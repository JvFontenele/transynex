import path from 'node:path';
import sharp from 'sharp';
import type { FastifyInstance } from 'fastify';
import type { Queue } from 'bullmq';
import type {
  ExportFormat,
  OCRProvider,
  RenderProvider,
  TranslationProvider,
} from '@transynex/core-contracts';
import type { Prisma } from '@prisma/client';
import type { AppContext } from './context.js';
import { actorOf, type Actor, type AuthHelpers } from './auth.js';
import { decryptSecrets, encryptSecrets } from './secrets.js';
import type { QueueJobData } from './queue.js';

const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/tiff']);
const EXTRACT_MIMES = new Set([
  'application/pdf',
  'application/zip',
  'application/x-cbz',
  'application/vnd.comicbook+zip',
]);
const EXPORT_FORMATS = new Set<string>(['pdf', 'cbz', 'zip', 'txt', 'markdown']);

export function registerRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  queue: Queue<QueueJobData>,
  auth: AuthHelpers,
): void {
  // Anexa URLs assinadas às imagens da página (<img src> não envia
  // Authorization, então o acesso é por token na própria URL).
  const withImageUrls = <T extends { sourceImageRef: string; renderedImageRef: string | null }>(
    page: T,
  ) => ({
    ...page,
    sourceImageUrl: auth.fileUrlFor(page.sourceImageRef),
    renderedImageUrl: page.renderedImageRef ? auth.fileUrlFor(page.renderedImageRef) : null,
  });
  // Escopo por dono (ARCHITECTURE §acessos): ADMIN e VIEWER enxergam todos
  // os projetos; EDITOR só os próprios. Recursos fora do escopo respondem
  // 404 (não vazar existência). Mutações de VIEWER já são barradas pelo
  // hook global em auth.ts.
  const projectScope = (a: Actor): Prisma.ProjectWhereInput =>
    a.role === 'EDITOR' ? { ownerId: a.sub } : {};

  const scopedProject = (a: Actor, id: string) =>
    ctx.prisma.project.findFirst({ where: { id, ...projectScope(a) } });

  // --- Projects ---------------------------------------------------------

  app.post<{ Body: { name: string; sourceLanguage: string; targetLanguage: string } }>(
    '/api/v1/projects',
    async (req, reply) => {
      const { name, sourceLanguage, targetLanguage } = req.body;
      if (!name || !sourceLanguage || !targetLanguage) {
        return reply.code(400).send({ error: 'name, sourceLanguage e targetLanguage são obrigatórios' });
      }
      const project = await ctx.prisma.project.create({
        data: { name, sourceLanguage, targetLanguage, ownerId: actorOf(req).sub },
      });
      return reply.code(201).send(project);
    },
  );

  app.get('/api/v1/projects', async (req) =>
    ctx.prisma.project.findMany({
      where: projectScope(actorOf(req)),
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { pages: true, jobs: true } } },
    }),
  );

  app.get<{ Params: { id: string } }>('/api/v1/projects/:id', async (req, reply) => {
    const project = await ctx.prisma.project.findFirst({
      where: { id: req.params.id, ...projectScope(actorOf(req)) },
      include: { sourceFiles: true, _count: { select: { pages: true } } },
    });
    if (!project) return reply.code(404).send({ error: 'Projeto não encontrado' });
    return project;
  });

  app.delete<{ Params: { id: string } }>('/api/v1/projects/:id', async (req, reply) => {
    const project = await scopedProject(actorOf(req), req.params.id);
    if (!project) return reply.code(404).send({ error: 'Projeto não encontrado' });
    await ctx.prisma.project.delete({ where: { id: project.id } });
    return reply.code(204).send();
  });

  // --- Uploads ----------------------------------------------------------
  // Imagens viram Page direto; PDF/CBZ/ZIP disparam um job 'extraction'.

  app.post<{ Params: { id: string } }>('/api/v1/projects/:id/uploads', async (req, reply) => {
    const project = await scopedProject(actorOf(req), req.params.id);
    if (!project) return reply.code(404).send({ error: 'Projeto não encontrado' });

    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'Nenhum arquivo enviado' });
    const isImage = IMAGE_MIMES.has(file.mimetype);
    if (!isImage && !EXTRACT_MIMES.has(file.mimetype)) {
      return reply.code(415).send({ error: `Tipo não suportado: ${file.mimetype}` });
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

    const ext = path.extname(file.filename) || '';
    const fileRef = `projects/${project.id}/source/${sourceFile.id}${ext}`;
    await ctx.storage.save(fileRef, buffer);
    await ctx.prisma.sourceFile.update({ where: { id: sourceFile.id }, data: { fileRef } });

    if (isImage) {
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
        data: { status: 'extracted' },
      });
      return reply.code(201).send({ sourceFileId: sourceFile.id, pageId: page.id });
    }

    const job = await ctx.prisma.job.create({
      data: { projectId: project.id, type: 'extraction', status: 'queued' },
    });
    await queue.add(
      'extract',
      { kind: 'extract', jobId: job.id, projectId: project.id, sourceFileId: sourceFile.id },
      { attempts: 2 },
    );
    return reply.code(202).send({ sourceFileId: sourceFile.id, jobId: job.id });
  });

  // --- Pages e Regions (correção) ----------------------------------------

  // Qualquer mutação de região invalida a renderização da página
  // (regra do ARCHITECTURE.md §7).
  const dirtyPage = (pageId: string) =>
    ctx.prisma.page.update({ where: { id: pageId }, data: { renderedImageRef: null } });

  // Fallback: default configurado na tela de Configurações, depois o built-in
  const defaultProviderFor = async (type: string, fallback: string) =>
    (await ctx.prisma.providerConfig.findFirst({ where: { type, isDefault: true } }))
      ?.providerId ?? fallback;

  const isValidBoundingBox = (box: unknown): box is { x: number; y: number; width: number; height: number } => {
    if (typeof box !== 'object' || box === null) return false;
    const b = box as Record<string, unknown>;
    return ['x', 'y', 'width', 'height'].every(
      (k) => typeof b[k] === 'number' && Number.isFinite(b[k] as number),
    );
  };

  app.get<{ Params: { id: string } }>('/api/v1/projects/:id/pages', async (req, reply) => {
    if (!(await scopedProject(actorOf(req), req.params.id))) {
      return reply.code(404).send({ error: 'Projeto não encontrado' });
    }
    const pages = await ctx.prisma.page.findMany({
      where: { projectId: req.params.id },
      orderBy: { order: 'asc' },
      include: { ocrRegions: { orderBy: { readingOrder: 'asc' } } },
    });
    return pages.map(withImageUrls);
  });

  // Reordenação: recebe a lista completa de ids na nova ordem.
  app.post<{ Params: { id: string }; Body: { pageIds: string[] } }>(
    '/api/v1/projects/:id/pages/reorder',
    async (req, reply) => {
      if (!(await scopedProject(actorOf(req), req.params.id))) {
        return reply.code(404).send({ error: 'Projeto não encontrado' });
      }
      const pageIds = req.body?.pageIds;
      if (!Array.isArray(pageIds) || pageIds.some((id) => typeof id !== 'string')) {
        return reply.code(400).send({ error: 'pageIds inválido: esperado array de ids' });
      }
      const pages = await ctx.prisma.page.findMany({
        where: { projectId: req.params.id },
        select: { id: true },
      });
      const existing = new Set(pages.map((p) => p.id));
      if (
        pageIds.length !== existing.size ||
        new Set(pageIds).size !== pageIds.length ||
        pageIds.some((id) => !existing.has(id))
      ) {
        return reply
          .code(400)
          .send({ error: 'pageIds deve conter exatamente todas as páginas do projeto' });
      }
      await ctx.prisma.$transaction(
        pageIds.map((id, order) => ctx.prisma.page.update({ where: { id }, data: { order } })),
      );
      const updated = await ctx.prisma.page.findMany({
        where: { projectId: req.params.id },
        orderBy: { order: 'asc' },
        include: { ocrRegions: { orderBy: { readingOrder: 'asc' } } },
      });
      return updated.map(withImageUrls);
    },
  );

  app.get<{ Params: { id: string } }>('/api/v1/pages/:id', async (req, reply) => {
    const page = await ctx.prisma.page.findFirst({
      where: { id: req.params.id, project: projectScope(actorOf(req)) },
      include: { ocrRegions: { orderBy: { readingOrder: 'asc' } } },
    });
    if (!page) return reply.code(404).send({ error: 'Página não encontrada' });
    return withImageUrls(page);
  });

  app.post<{
    Params: { id: string };
    Body: { boundingBox: object; sourceText?: string; translatedText?: string };
  }>('/api/v1/pages/:id/regions', async (req, reply) => {
    const page = await ctx.prisma.page.findFirst({
      where: { id: req.params.id, project: projectScope(actorOf(req)) },
    });
    if (!page) return reply.code(404).send({ error: 'Página não encontrada' });
    if (!isValidBoundingBox(req.body?.boundingBox)) {
      return reply.code(400).send({ error: 'boundingBox inválido: esperado {x, y, width, height} numéricos' });
    }

    const last = await ctx.prisma.ocrRegion.aggregate({
      where: { pageId: page.id },
      _max: { readingOrder: true },
    });
    const region = await ctx.prisma.ocrRegion.create({
      data: {
        pageId: page.id,
        boundingBox: req.body.boundingBox,
        sourceText: req.body.sourceText ?? '',
        translatedText: req.body.translatedText,
        confidence: 1,
        readingOrder: (last._max.readingOrder ?? -1) + 1,
        manual: true,
      },
    });
    await dirtyPage(page.id);
    return reply.code(201).send(region);
  });

  app.patch<{
    Params: { id: string };
    Body: { sourceText?: string; translatedText?: string; boundingBox?: object };
  }>('/api/v1/regions/:id', async (req, reply) => {
    const region = await ctx.prisma.ocrRegion.findFirst({
      where: { id: req.params.id, page: { project: projectScope(actorOf(req)) } },
    });
    if (!region) return reply.code(404).send({ error: 'Região não encontrada' });
    if (req.body.boundingBox !== undefined && !isValidBoundingBox(req.body.boundingBox)) {
      return reply.code(400).send({ error: 'boundingBox inválido: esperado {x, y, width, height} numéricos' });
    }

    const updated = await ctx.prisma.ocrRegion.update({
      where: { id: region.id },
      data: {
        sourceText: req.body.sourceText,
        translatedText: req.body.translatedText,
        boundingBox: req.body.boundingBox,
        // Toda edição do usuário vira marcação preservada em re-runs
        manual: true,
      },
    });
    await dirtyPage(region.pageId);
    return updated;
  });

  app.delete<{ Params: { id: string } }>('/api/v1/regions/:id', async (req, reply) => {
    const region = await ctx.prisma.ocrRegion.findFirst({
      where: { id: req.params.id, page: { project: projectScope(actorOf(req)) } },
    });
    if (!region) return reply.code(404).send({ error: 'Região não encontrada' });
    await ctx.prisma.ocrRegion.delete({ where: { id: region.id } });
    await dirtyPage(region.pageId);
    return reply.code(204).send();
  });

  // Reanalisa uma região marcada manualmente: recorta a imagem original na
  // bounding box, roda OCR só no recorte e traduz o texto encontrado.
  app.post<{ Params: { id: string } }>('/api/v1/regions/:id/reanalyze', async (req, reply) => {
    const region = await ctx.prisma.ocrRegion.findFirst({
      where: { id: req.params.id, page: { project: projectScope(actorOf(req)) } },
      include: { page: { include: { project: true } } },
    });
    if (!region) return reply.code(404).send({ error: 'Região não encontrada' });
    const { page } = region;
    const { project } = page;

    const box = region.boundingBox as { x: number; y: number; width: number; height: number };
    const source = await ctx.storage.read(page.sourceImageRef);
    const meta = await sharp(source).metadata();
    if (!meta.width || !meta.height) {
      return reply.code(500).send({ error: 'Imagem da página sem dimensões' });
    }
    // Clampa a bbox aos limites da imagem (o editor permite encostar na borda)
    const left = Math.min(Math.max(Math.round(box.x), 0), meta.width - 1);
    const top = Math.min(Math.max(Math.round(box.y), 0), meta.height - 1);
    const width = Math.max(Math.min(Math.round(box.width), meta.width - left), 1);
    const height = Math.max(Math.min(Math.round(box.height), meta.height - top), 1);
    const crop = await sharp(source).extract({ left, top, width, height }).png().toBuffer();

    // OCR providers recebem um StorageRef, então o recorte passa por um
    // arquivo temporário (sobrescrito a cada reanálise, apagado no fim).
    const cropRef = `projects/${project.id}/tmp/region-${region.id}.png`;
    await ctx.storage.save(cropRef, crop);
    try {
      const ocr = ctx.registry.get<OCRProvider>(
        'ocr',
        await defaultProviderFor('ocr', 'tesseract-ocr'),
      );
      const ocrResult = await ocr.recognize({
        pageId: page.id,
        imageRef: cropRef,
        languageHint: [project.sourceLanguage],
      });
      const text = ocrResult.regions
        .sort((a, b) => (a.readingOrder ?? 0) - (b.readingOrder ?? 0))
        .map((r) => r.text)
        .join(' ')
        .trim();
      if (!text) {
        return reply
          .code(422)
          .send({ error: 'O OCR não encontrou texto nessa região. Digite o texto manualmente.' });
      }

      const translator = ctx.registry.get<TranslationProvider>(
        'translation',
        await defaultProviderFor('translation', 'libretranslate'),
      );
      const translated = await translator.translate({
        text,
        sourceLanguage: project.sourceLanguage,
        targetLanguage: project.targetLanguage,
      });

      const updated = await ctx.prisma.ocrRegion.update({
        where: { id: region.id },
        data: { sourceText: text, translatedText: translated.translatedText, manual: true },
      });
      await dirtyPage(page.id);
      return updated;
    } finally {
      await ctx.storage.delete(cropRef).catch(() => {});
    }
  });

  // Re-renderiza a página a partir das regiões atuais (editadas pelo usuário),
  // sem refazer OCR/tradução — refazer o pipeline apagaria as edições.
  app.post<{ Params: { id: string } }>('/api/v1/pages/:id/render', async (req, reply) => {
    const page = await ctx.prisma.page.findFirst({
      where: { id: req.params.id, project: projectScope(actorOf(req)) },
      include: { ocrRegions: { orderBy: { readingOrder: 'asc' } } },
    });
    if (!page) return reply.code(404).send({ error: 'Página não encontrada' });

    const renderer = ctx.registry.get<RenderProvider>(
      'render',
      await defaultProviderFor('render', 'canvas-render'),
    );

    const textBlocks = page.ocrRegions
      .map((r) => ({
        regionId: r.id,
        boundingBox: r.boundingBox as { x: number; y: number; width: number; height: number },
        text: (r.translatedText ?? r.sourceText).trim(),
      }))
      .filter((b) => b.text.length > 0);

    const rendered = await renderer.render({
      pageId: page.id,
      baseImageRef: page.inpaintedImageRef ?? page.sourceImageRef,
      textBlocks,
    });
    const updated = await ctx.prisma.page.update({
      where: { id: page.id },
      data: { renderedImageRef: rendered.imageRef },
      include: { ocrRegions: { orderBy: { readingOrder: 'asc' } } },
    });
    return withImageUrls(updated);
  });

  // --- Pipeline run -------------------------------------------------------

  app.post<{
    Params: { id: string };
    Body:
      | {
          ocrProviderId?: string;
          translationProviderId?: string;
          renderProviderId?: string;
          preserveManual?: boolean;
        }
      | undefined;
  }>('/api/v1/projects/:id/run', async (req, reply) => {
    const project = await scopedProject(actorOf(req), req.params.id);
    if (!project) return reply.code(404).send({ error: 'Projeto não encontrado' });

    const ocrProviderId =
      req.body?.ocrProviderId ?? (await defaultProviderFor('ocr', 'tesseract-ocr'));
    const translationProviderId =
      req.body?.translationProviderId ??
      (await defaultProviderFor('translation', 'libretranslate'));

    const pages = await ctx.prisma.page.findMany({
      where: { projectId: project.id },
      orderBy: { order: 'asc' },
    });
    if (pages.length === 0) return reply.code(400).send({ error: 'Projeto sem páginas' });

    await ctx.prisma.project.update({
      where: { id: project.id },
      data: { status: 'PROCESSING' },
    });

    const renderProviderId =
      req.body?.renderProviderId ?? (await defaultProviderFor('render', 'canvas-render'));
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
          preserveManual: req.body?.preserveManual ?? true,
        },
        { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
      );
      jobIds.push(job.id);
    }

    return reply.code(202).send({ jobIds });
  });

  // --- Exportação -----------------------------------------------------------

  app.post<{ Params: { id: string }; Body: { format: string } }>(
    '/api/v1/projects/:id/export',
    async (req, reply) => {
      const project = await scopedProject(actorOf(req), req.params.id);
      if (!project) return reply.code(404).send({ error: 'Projeto não encontrado' });
      const { format } = req.body;
      if (!EXPORT_FORMATS.has(format)) {
        return reply.code(400).send({ error: `Formato inválido: ${format}` });
      }
      const job = await ctx.prisma.job.create({
        data: { projectId: project.id, type: 'export', status: 'queued' },
      });
      await queue.add(
        'export',
        {
          kind: 'export',
          jobId: job.id,
          projectId: project.id,
          format: format as ExportFormat,
          exportProviderId: 'basic-export',
        },
        { attempts: 2 },
      );
      return reply.code(202).send({ jobId: job.id });
    },
  );

  app.get<{ Params: { id: string } }>('/api/v1/projects/:id/exports', async (req, reply) => {
    if (!(await scopedProject(actorOf(req), req.params.id))) {
      return reply.code(404).send({ error: 'Projeto não encontrado' });
    }
    const artifacts = await ctx.prisma.exportArtifact.findMany({
      where: { projectId: req.params.id },
      orderBy: { createdAt: 'desc' },
    });
    return artifacts.map((a) => ({ ...a, downloadUrl: auth.exportDownloadUrlFor(a.id) }));
  });

  // Fora do hook global de auth: o acesso é pelo token assinado em ?t=
  // (links de download não enviam Authorization).
  app.get<{ Params: { id: string }; Querystring: { t?: string } }>(
    '/api/v1/exports/:id/download',
    async (req, reply) => {
      try {
        const payload = app.jwt.verify<{ artifactId: string; scope: string }>(req.query.t ?? '');
        if (payload.scope !== 'export' || payload.artifactId !== req.params.id) throw new Error();
      } catch {
        return reply.code(401).send({ error: 'Não autenticado' });
      }
      const artifact = await ctx.prisma.exportArtifact.findUnique({ where: { id: req.params.id } });
      if (!artifact) return reply.code(404).send({ error: 'Exportação não encontrada' });
      const stream = await ctx.storage.readStream(artifact.fileRef);
      return reply
        .header('content-disposition', `attachment; filename="${path.basename(artifact.fileRef)}"`)
        .send(stream);
    },
  );

  // --- Arquivos (preview de imagens) -----------------------------------------
  // O token é um JWT assinado contendo o StorageRef (ARCHITECTURE.md §7);
  // emitido pelo backend via auth.fileUrlFor nos payloads de pages.

  app.get<{ Params: { token: string } }>('/api/v1/files/:token', async (req, reply) => {
    let ref: string;
    try {
      const payload = app.jwt.verify<{ ref: string; scope: string }>(req.params.token);
      if (payload.scope !== 'file' || typeof payload.ref !== 'string') throw new Error();
      ref = payload.ref;
    } catch {
      return reply.code(401).send({ error: 'Não autenticado' });
    }
    if (!(await ctx.storage.exists(ref))) {
      return reply.code(404).send({ error: 'Arquivo não encontrado' });
    }
    const ext = path.extname(ref).toLowerCase();
    const mime =
      { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[
        ext
      ] ?? 'application/octet-stream';
    return reply.header('content-type', mime).send(await ctx.storage.readStream(ref));
  });

  // --- Jobs ----------------------------------------------------------------

  app.get<{ Querystring: { projectId?: string } }>('/api/v1/jobs', async (req) =>
    ctx.prisma.job.findMany({
      where: {
        ...(req.query.projectId ? { projectId: req.query.projectId } : {}),
        project: projectScope(actorOf(req)),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
  );

  app.get<{ Params: { id: string } }>('/api/v1/jobs/:id', async (req, reply) => {
    const job = await ctx.prisma.job.findFirst({
      where: { id: req.params.id, project: projectScope(actorOf(req)) },
    });
    if (!job) return reply.code(404).send({ error: 'Job não encontrado' });
    return job;
  });

  // --- Providers -------------------------------------------------------------

  const PROVIDER_TYPES = ['ocr', 'translation', 'inpainting', 'render', 'export', 'storage'] as const;

  const findMetadata = (providerId: string) => {
    for (const type of PROVIDER_TYPES) {
      const meta = ctx.registry.list(type).find((m) => m.id === providerId);
      if (meta) return meta;
    }
    return null;
  };

  // Campos do configSchema marcados com format:'secret' vão para
  // ApiCredential (criptografados) e nunca são ecoados ao client.
  const secretFields = (meta: { configSchema: unknown }): string[] => {
    const props = (meta.configSchema as { properties?: Record<string, { format?: string }> })
      ?.properties;
    return Object.entries(props ?? {})
      .filter(([, s]) => s.format === 'secret')
      .map(([k]) => k);
  };

  // Metadata + config persistida (sem secrets; só indica quais estão definidos)
  const describeProvider = async (meta: ReturnType<typeof findMetadata> & object) => {
    const [row, cred] = await Promise.all([
      ctx.prisma.providerConfig.findUnique({ where: { providerId: meta.id } }),
      ctx.prisma.apiCredential.findUnique({ where: { providerId: meta.id } }),
    ]);
    let definedSecrets: string[] = [];
    if (cred) {
      try {
        definedSecrets = Object.keys(
          decryptSecrets(Buffer.from(cred.encrypted), Buffer.from(cred.iv)),
        );
      } catch {
        // chave trocada: credencial ilegível, tratada como não definida
      }
    }
    return {
      ...meta,
      config: (row?.config as Record<string, unknown> | null) ?? {},
      isDefault: row?.isDefault ?? false,
      definedSecrets,
    };
  };

  app.get('/api/v1/providers', async () => {
    const out: Record<string, unknown[]> = {};
    for (const type of PROVIDER_TYPES) {
      out[type] = await Promise.all(ctx.registry.list(type).map(describeProvider));
    }
    return out;
  });

  app.post<{ Params: { id: string }; Body: { config: Record<string, unknown> } }>(
    '/api/v1/providers/:id/configure',
    async (req, reply) => {
      // Config de providers inclui chaves de API — só ADMIN mexe.
      if (actorOf(req).role !== 'ADMIN') {
        return reply.code(403).send({ error: 'Apenas administradores' });
      }
      const meta = findMetadata(req.params.id);
      if (!meta) return reply.code(404).send({ error: 'Provider não encontrado' });
      const incoming = req.body?.config;
      if (typeof incoming !== 'object' || incoming === null) {
        return reply.code(400).send({ error: 'config é obrigatório' });
      }

      const secretKeys = new Set(secretFields(meta));
      const plain: Record<string, unknown> = {};
      const newSecrets: Record<string, string> = {};
      for (const [k, v] of Object.entries(incoming)) {
        if (secretKeys.has(k)) {
          // string vazia/ausente = manter o secret atual
          if (typeof v === 'string' && v !== '') newSecrets[k] = v;
        } else if (v !== '' && v !== null && v !== undefined) {
          plain[k] = v;
        }
      }

      await ctx.prisma.providerConfig.upsert({
        where: { providerId: meta.id },
        create: { providerId: meta.id, type: meta.type, config: plain as Prisma.InputJsonObject },
        update: { config: plain as Prisma.InputJsonObject },
      });

      if (Object.keys(newSecrets).length > 0) {
        const cred = await ctx.prisma.apiCredential.findUnique({
          where: { providerId: meta.id },
        });
        let existing: Record<string, string> = {};
        if (cred) {
          try {
            existing = decryptSecrets(Buffer.from(cred.encrypted), Buffer.from(cred.iv));
          } catch {
            // chave trocada: descarta credenciais antigas
          }
        }
        const { encrypted, iv } = encryptSecrets({ ...existing, ...newSecrets });
        const bytes = { encrypted: new Uint8Array(encrypted), iv: new Uint8Array(iv) };
        await ctx.prisma.apiCredential.upsert({
          where: { providerId: meta.id },
          create: { providerId: meta.id, ...bytes },
          update: bytes,
        });
      }

      // Aplica no provider vivo, sem exigir restart
      const provider = ctx.registry.get(meta.type, meta.id);
      await provider.configure(await ctx.effectiveConfig(meta.id));

      return describeProvider(meta);
    },
  );

  app.post<{ Params: { id: string } }>('/api/v1/providers/:id/default', async (req, reply) => {
    if (actorOf(req).role !== 'ADMIN') {
      return reply.code(403).send({ error: 'Apenas administradores' });
    }
    const meta = findMetadata(req.params.id);
    if (!meta) return reply.code(404).send({ error: 'Provider não encontrado' });
    await ctx.prisma.$transaction([
      ctx.prisma.providerConfig.updateMany({
        where: { type: meta.type, isDefault: true },
        data: { isDefault: false },
      }),
      ctx.prisma.providerConfig.upsert({
        where: { providerId: meta.id },
        create: { providerId: meta.id, type: meta.type, config: {}, isDefault: true },
        update: { isDefault: true },
      }),
    ]);
    return describeProvider(meta);
  });

  app.get('/api/v1/providers/health', async () => ctx.registry.healthCheckAll());
}
