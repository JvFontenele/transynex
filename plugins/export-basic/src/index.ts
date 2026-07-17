import AdmZip from 'adm-zip';
import { PDFDocument } from 'pdf-lib';
import type {
  ExportFormat,
  ExportInput,
  ExportPageInput,
  ExportProvider,
  ExportResult,
  HealthCheckResult,
  PluginManifest,
  ProviderMetadata,
  StorageProvider,
} from '@transynex/core-contracts';

const metadata: ProviderMetadata = {
  id: 'basic-export',
  name: 'Exportador básico',
  version: '0.1.0',
  author: 'Transynex',
  description: 'Exporta para PDF, CBZ, ZIP, TXT e Markdown a partir das páginas do projeto.',
  type: 'export',
  requiresGPU: false,
  requiresNetwork: false,
  configSchema: { type: 'object', properties: {} },
};

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  cbz: 'application/vnd.comicbook+zip',
  zip: 'application/zip',
  txt: 'text/plain',
  markdown: 'text/markdown',
};

export class BasicExportProvider implements ExportProvider {
  readonly metadata = metadata;

  constructor(private storage: StorageProvider) {}

  async configure(): Promise<void> {}

  supportedFormats(): ExportFormat[] {
    return ['pdf', 'cbz', 'zip', 'txt', 'markdown'];
  }

  async export(input: ExportInput): Promise<ExportResult> {
    const { format, projectId, pages } = input;
    let buffer: Buffer;
    switch (format) {
      case 'pdf':
        buffer = await this.buildPdf(pages);
        break;
      case 'cbz':
      case 'zip':
        buffer = await this.buildZip(pages);
        break;
      case 'txt':
        buffer = Buffer.from(pages.map((p) => p.text ?? '').join('\n\n'), 'utf8');
        break;
      case 'markdown':
        buffer = Buffer.from(
          pages.map((p, i) => `## Página ${i + 1}\n\n${p.text ?? ''}`).join('\n\n'),
          'utf8',
        );
        break;
      default:
        throw new Error(`Formato não suportado: ${format}`);
    }

    const ext = format === 'markdown' ? 'md' : format;
    const fileName = `export-${Date.now()}.${ext}`;
    const fileRef = `projects/${projectId}/exports/${fileName}`;
    await this.storage.save(fileRef, buffer);

    return { fileRef, fileName, mimeType: MIME[format], sizeBytes: buffer.length };
  }

  private async pageImages(pages: ExportPageInput[]): Promise<Buffer[]> {
    const refs = pages.map((p) => p.imageRef).filter((r): r is string => Boolean(r));
    if (refs.length === 0) throw new Error('Nenhuma página com imagem para exportar');
    return Promise.all(refs.map((ref) => this.storage.read(ref)));
  }

  private async buildPdf(pages: ExportPageInput[]): Promise<Buffer> {
    const doc = await PDFDocument.create();
    for (const image of await this.pageImages(pages)) {
      // PNG (renderizadas) ou JPEG (originais de CBZ) — detecta pela assinatura
      const embedded = image[0] === 0x89
        ? await doc.embedPng(image)
        : await doc.embedJpg(image);
      const page = doc.addPage([embedded.width, embedded.height]);
      page.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height });
    }
    return Buffer.from(await doc.save());
  }

  private async buildZip(pages: ExportPageInput[]): Promise<Buffer> {
    const zip = new AdmZip();
    const images = await this.pageImages(pages);
    const pad = String(images.length).length;
    images.forEach((image, i) => {
      const ext = image[0] === 0x89 ? 'png' : 'jpg';
      zip.addFile(`${String(i + 1).padStart(pad, '0')}.${ext}`, image);
    });
    return zip.toBuffer();
  }

  async healthCheck(): Promise<HealthCheckResult> {
    return { healthy: true, latencyMs: 0, checkedAt: new Date().toISOString() };
  }
}

export const manifest: PluginManifest = {
  metadata,
  factory: (storage) => new BasicExportProvider(storage),
};
