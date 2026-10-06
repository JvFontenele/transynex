import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { FastifyInstance, FastifyRequest } from 'fastify';
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
import {
  defaultProviderFor as defaultProviderForCtx,
  enqueueRun,
  EPUB_MIME,
  IMAGE_MIMES,
  ingestFile,
  isSupportedMime,
  type RunOptions,
  type UploadedFile,
} from './pipeline.js';

const EXPORT_FORMATS = new Set<string>(['pdf', 'cbz', 'zip', 'txt', 'markdown']);
const DOC_EXPORT_FORMATS = new Set<string>(['txt', 'markdown', 'epub']);

// Importação por URL (ex: app de arquivo do Cloudreve): o backend só baixa de
// origens listadas em IMPORT_ORIGINS — lista fechada evita SSRF.
const IMPORT_ORIGINS = (process.env.IMPORT_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim().replace(/\/+$/, ''))
  .filter(Boolean);
const MAX_IMPORT_BYTES = 100 * 1024 * 1024; // mesmo limite do multipart (main.ts)
// Servidores de arquivo costumam mandar application/octet-stream: a extensão manda.
const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.cbz': 'application/x-cbz',
  '.epub': EPUB_MIME,
};

/** Arquivo do multipart (`file`) ou, em JSON `{ url, filename? }`, baixado da URL. */
async function readUpload(
  req: FastifyRequest,
): Promise<{ file: UploadedFile } | { code: number; error: string }> {
  if (req.isMultipart()) {
    const file = await req.file();
    if (!file) return { code: 400, error: 'Nenhum arquivo enviado' };
    // Clientes genéricos (ex: tarefa do Cloudreve) mandam application/octet-stream
    const mimetype = isSupportedMime(file.mimetype)
      ? file.mimetype
      : (MIME_BY_EXT[path.extname(file.filename).toLowerCase()] ?? file.mimetype);
    return { file: { filename: file.filename, mimetype, buffer: await file.toBuffer() } };
  }
  const { url, filename } = (req.body ?? {}) as { url?: string; filename?: string };
  if (!url) return { code: 400, error: 'Nenhum arquivo enviado' };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { code: 400, error: 'URL inválida' };
  }
  if (!IMPORT_ORIGINS.includes(parsed.origin)) {
    return { code: 403, error: `Origem não liberada (IMPORT_ORIGINS): ${parsed.origin}` };
  }
  const res = await fetch(parsed).catch(() => null);
  if (!res?.ok) return { code: 502, error: `Falha ao baixar o arquivo (${res ? `HTTP ${res.status}` : 'sem resposta'})` };
  if (Number(res.headers.get('content-length')) > MAX_IMPORT_BYTES) {
    return { code: 413, error: 'Arquivo maior que 100 MB' };
  }
  const name = filename || decodeURIComponent(parsed.pathname.split('/').pop() || 'arquivo');
  const mimetype =
    MIME_BY_EXT[path.extname(name).toLowerCase()] ?? res.headers.get('content-type')?.split(';')[0] ?? '';
  return { file: { filename: name, mimetype, buffer: Buffer.from(await res.arrayBuffer()) } };
}

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

  app.post<{
    Body: { name: string; sourceLanguage: string; targetLanguage: string; kind?: string };
  }>('/api/v1/projects', async (req, reply) => {
    const { name, sourceLanguage, targetLanguage } = req.body;
    if (!name || !sourceLanguage || !targetLanguage) {
      return reply.code(400).send({ error: 'name, sourceLanguage e targetLanguage são obrigatórios' });
    }
    // Default IMAGE mantém o comportamento de clientes antigos que não mandam kind.
    const kind = req.body.kind ?? 'IMAGE';
    if (kind !== 'IMAGE' && kind !== 'DOCUMENT') {
      return reply.code(400).send({ error: `kind inválido: ${kind}` });
    }
    const project = await ctx.prisma.project.create({
      data: { name, kind, sourceLanguage, targetLanguage, ownerId: actorOf(req).sub },
    });
    return reply.code(201).send(project);
  });

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
    // URL assinada do original: o leitor de EPUB abre o livro direto dela.
    return {
      ...project,
      sourceFiles: project.sourceFiles.map((f) => ({
        ...f,
        fileUrl: f.fileRef ? auth.fileUrlFor(f.fileRef) : null,
      })),
    };
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

    const upload = await readUpload(req);
    if ('error' in upload) return reply.code(upload.code).send({ error: upload.error });
    const { code, body } = await ingestFile(ctx, queue, project, upload.file);
    return reply.code(code).send(body);
  });

  // --- Envio rápido -------------------------------------------------------
  // Um arquivo, sem criar projeto antes: o projeto é criado implicitamente
  // (nome = arquivo), recebe o upload e roda o pipeline sozinho.
  // Idiomas e kind vão na query para não depender da ordem dos campos multipart.
  // `run=0` só cria o projeto, sem traduzir.

  app.post<{
    Querystring: {
      sourceLanguage?: string;
      targetLanguage?: string;
      kind?: 'IMAGE' | 'DOCUMENT';
      run?: string;
    } & RunOptions;
  }>('/api/v1/quick', async (req, reply) => {
    const { sourceLanguage, targetLanguage, kind: forcedKind, run, ...runOptions } = req.query;
    if (!sourceLanguage || !targetLanguage) {
      return reply.code(400).send({ error: 'sourceLanguage e targetLanguage são obrigatórios' });
    }
    if (forcedKind !== undefined && forcedKind !== 'IMAGE' && forcedKind !== 'DOCUMENT') {
      return reply.code(400).send({ error: `kind inválido: ${forcedKind}` });
    }
    const upload = await readUpload(req);
    if ('error' in upload) return reply.code(upload.code).send({ error: upload.error });
    const { file } = upload;
    if (!isSupportedMime(file.mimetype)) {
      return reply.code(415).send({ error: `Tipo não suportado: ${file.mimetype}` });
    }
    // PDF/EPUB tendem a ser documento (texto corrido); imagens e CBZ/ZIP, HQ.
    const kind: 'IMAGE' | 'DOCUMENT' =
      forcedKind ??
      (file.mimetype === 'application/pdf' || file.mimetype === EPUB_MIME ? 'DOCUMENT' : 'IMAGE');
    const project = await ctx.prisma.project.create({
      data: {
        name: path.parse(file.filename).name || file.filename,
        kind,
        sourceLanguage,
        targetLanguage,
        ownerId: actorOf(req).sub,
      },
    });
    const { code, body } = await ingestFile(ctx, queue, project, file, run === '0' ? undefined : runOptions);
    if (code >= 400) {
      await ctx.prisma.project.delete({ where: { id: project.id } });
      return reply.code(code).send(body);
    }
    return reply.code(201).send({ projectId: project.id, kind, ...body });
  });

  // --- Tradução avulsa (sem estado) ----------------------------------------
  // Para extensão/integrações: OCR + tradução de uma imagem, resposta síncrona,
  // nada persiste no banco. `render=1` devolve também a imagem traduzida (PNG
  // em data URL).

  app.post<{
    Querystring: {
      sourceLanguage?: string;
      targetLanguage?: string;
      render?: string;
      ocrProviderId?: string;
      translationProviderId?: string;
    };
  }>('/api/v1/translate/image', async (req, reply) => {
    const { sourceLanguage, targetLanguage } = req.query;
    if (!sourceLanguage || !targetLanguage) {
      return reply.code(400).send({ error: 'sourceLanguage e targetLanguage são obrigatórios' });
    }
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'Nenhum arquivo enviado' });
    if (!IMAGE_MIMES.has(file.mimetype)) {
      return reply.code(415).send({ error: `Tipo não suportado: ${file.mimetype}` });
    }

    // Providers recebem StorageRef: a imagem passa por um arquivo temporário.
    const id = randomUUID();
    // (o renderer grava em <avô>/rendered/<pageId>.png → tmp/translate/rendered/<id>.png)
    const imageRef = `tmp/translate/source/${id}${path.extname(file.filename) || '.png'}`;
    await ctx.storage.save(imageRef, await file.toBuffer());
    let renderedRef: string | null = null;
    try {
      const ocr = ctx.registry.get<OCRProvider>(
        'ocr',
        req.query.ocrProviderId ?? (await defaultProviderFor('ocr', 'tesseract-ocr')),
      );
      const translator = ctx.registry.get<TranslationProvider>(
        'translation',
        req.query.translationProviderId ??
          (await defaultProviderFor('translation', 'libretranslate')),
      );
      const { regions } = await ocr.recognize({
        pageId: id,
        imageRef,
        languageHint: [sourceLanguage],
      });
      const translated = regions.length
        ? await translator.translateBatch(
            regions.map((r) => ({ text: r.text, sourceLanguage, targetLanguage })),
          )
        : [];
      const out = regions.map((r, i) => ({
        boundingBox: r.boundingBox,
        orientation: r.orientation,
        confidence: r.confidence,
        text: r.text,
        translation: translated[i]?.translatedText ?? null,
      }));

      let image: string | null = null;
      if (req.query.render === '1' || req.query.render === 'true') {
        const renderer = ctx.registry.get<RenderProvider>(
          'render',
          await defaultProviderFor('render', 'canvas-render'),
        );
        const rendered = await renderer.render({
          pageId: id,
          baseImageRef: imageRef,
          textBlocks: out
            .map((r, i) => ({
              regionId: String(i),
              boundingBox: r.boundingBox,
              text: (r.translation ?? r.text).trim(),
            }))
            .filter((b) => b.text.length > 0),
        });
        renderedRef = rendered.imageRef;
        image = `data:image/png;base64,${(await ctx.storage.read(renderedRef)).toString('base64')}`;
      }
      return { regions: out, image };
    } finally {
      await ctx.storage.delete(imageRef).catch(() => {});
      if (renderedRef) await ctx.storage.delete(renderedRef).catch(() => {});
    }
  });

  // --- Pages e Regions (correção) ----------------------------------------

  // Qualquer mutação de região invalida a renderização da página
  // (regra do ARCHITECTURE.md §7).
  // Também desfaz a revisão: o que foi revisado não é mais o que está lá.
  const dirtyPage = (pageId: string) =>
    ctx.prisma.page.update({
      where: { id: pageId },
      data: { renderedImageRef: null, reviewedAt: null },
    });

  const defaultProviderFor = (type: string, fallback: string) =>
    defaultProviderForCtx(ctx, type, fallback);

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

  // Revisão no leitor: marca/desmarca a página como revisada.
  app.post<{ Params: { id: string }; Body: { reviewed?: boolean } }>(
    '/api/v1/pages/:id/review',
    async (req, reply) => {
      const page = await ctx.prisma.page.findFirst({
        where: { id: req.params.id, project: projectScope(actorOf(req)) },
      });
      if (!page) return reply.code(404).send({ error: 'Página não encontrada' });
      const updated = await ctx.prisma.page.update({
        where: { id: page.id },
        data: { reviewedAt: req.body?.reviewed === false ? null : new Date() },
        include: { ocrRegions: { orderBy: { readingOrder: 'asc' } } },
      });
      return withImageUrls(updated);
    },
  );

  // --- Documento (texto corrido) -------------------------------------------

  // Parágrafos do projeto na ordem de leitura: alimenta o leitor de texto
  // corrido e o modo bilíngue.
  app.get<{ Params: { id: string } }>('/api/v1/projects/:id/blocks', async (req, reply) => {
    if (!(await scopedProject(actorOf(req), req.params.id))) {
      return reply.code(404).send({ error: 'Projeto não encontrado' });
    }
    const blocks = await ctx.prisma.documentBlock.findMany({
      where: { projectId: req.params.id },
      orderBy: { order: 'asc' },
      include: { page: { select: { id: true, sourceImageRef: true, renderedImageRef: true } } },
    });
    // Bloco-imagem: URLs da imagem original e da traduzida (render), se houver.
    return blocks.map(({ page, ...b }) => ({
      ...b,
      image: page && withImageUrls(page),
    }));
  });

  // Edição/revisão de um parágrafo no leitor de documento. Editar o texto
  // desfaz a revisão, a menos que o mesmo pedido marque como revisado.
  app.patch<{ Params: { id: string }; Body: { translatedText?: string; reviewed?: boolean } }>(
    '/api/v1/blocks/:id',
    async (req, reply) => {
      const block = await ctx.prisma.documentBlock.findFirst({
        where: { id: req.params.id, project: projectScope(actorOf(req)) },
      });
      if (!block) return reply.code(404).send({ error: 'Parágrafo não encontrado' });
      const { translatedText, reviewed } = req.body ?? {};
      if (translatedText !== undefined && typeof translatedText !== 'string') {
        return reply.code(400).send({ error: 'translatedText deve ser texto' });
      }
      const reviewedAt =
        reviewed === true ? new Date() : reviewed === false || translatedText !== undefined ? null : undefined;
      return ctx.prisma.documentBlock.update({
        where: { id: block.id },
        data: { translatedText, reviewedAt },
      });
    },
  );

  // --- Pipeline run -------------------------------------------------------

  app.post<{ Params: { id: string }; Body: RunOptions | undefined }>(
    '/api/v1/projects/:id/run',
    async (req, reply) => {
      const project = await scopedProject(actorOf(req), req.params.id);
      if (!project) return reply.code(404).send({ error: 'Projeto não encontrado' });
      const { code, body } = await enqueueRun(ctx, queue, project, req.body ?? {});
      return reply.code(code).send(body);
    },
  );

  // --- Exportação -----------------------------------------------------------

  app.post<{ Params: { id: string }; Body: { format: string } }>(
    '/api/v1/projects/:id/export',
    async (req, reply) => {
      const project = await scopedProject(actorOf(req), req.params.id);
      if (!project) return reply.code(404).send({ error: 'Projeto não encontrado' });
      const { format } = req.body;
      // Documento exporta texto (e o EPUB reescrito); imagem exporta páginas.
      const allowed = project.kind === 'DOCUMENT' ? DOC_EXPORT_FORMATS : EXPORT_FORMATS;
      if (!allowed.has(format)) {
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
