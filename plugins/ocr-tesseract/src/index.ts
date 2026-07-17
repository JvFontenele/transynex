import { createWorker, type Worker } from 'tesseract.js';
import type {
  HealthCheckResult,
  OCRInput,
  OCRProvider,
  OCRRegion,
  OCRResult,
  PluginManifest,
  ProviderMetadata,
  StorageProvider,
} from '@transynex/core-contracts';

const metadata: ProviderMetadata = {
  id: 'tesseract-ocr',
  name: 'Tesseract OCR',
  version: '0.1.0',
  author: 'Transynex',
  description: 'OCR offline via tesseract.js (WASM). Baixa traineddata na primeira execução e cacheia localmente.',
  type: 'ocr',
  requiresGPU: false,
  requiresNetwork: false,
  configSchema: {
    type: 'object',
    properties: {
      languages: {
        type: 'array',
        items: { type: 'string' },
        description: 'Idiomas dos traineddata (ex: ["eng", "jpn", "por"])',
        default: ['eng'],
      },
      cachePath: {
        type: 'string',
        description: 'Diretório de cache dos traineddata',
        default: './models/tesseract',
      },
    },
  },
};

export class TesseractOCRProvider implements OCRProvider {
  readonly metadata = metadata;
  private languages = ['eng'];
  private cachePath = './models/tesseract';
  private worker: Worker | null = null;

  constructor(private storage: StorageProvider) {}

  async configure(config: Record<string, unknown>): Promise<void> {
    if (Array.isArray(config.languages) && config.languages.length > 0) {
      this.languages = config.languages.map(String);
    }
    if (typeof config.cachePath === 'string') {
      this.cachePath = config.cachePath;
    }
    await this.worker?.terminate();
    this.worker = null;
  }

  private async getWorker(langs: string[]): Promise<Worker> {
    if (!this.worker) {
      this.worker = await createWorker(langs, undefined, {
        cachePath: this.cachePath,
      });
    }
    return this.worker;
  }

  async recognize(input: OCRInput): Promise<OCRResult> {
    const start = Date.now();
    const langs = input.languageHint?.length ? input.languageHint : this.languages;
    const worker = await this.getWorker(langs);
    const image = await this.storage.read(input.imageRef);

    const { data } = await worker.recognize(image, {}, { blocks: true });

    const regions: OCRRegion[] = [];
    let order = 0;
    for (const block of data.blocks ?? []) {
      for (const paragraph of block.paragraphs) {
        for (const line of paragraph.lines) {
          const text = line.text.trim();
          if (!text) continue;
          regions.push({
            id: `${input.pageId}-r${order}`,
            boundingBox: {
              x: line.bbox.x0,
              y: line.bbox.y0,
              width: line.bbox.x1 - line.bbox.x0,
              height: line.bbox.y1 - line.bbox.y0,
            },
            text,
            confidence: line.confidence / 100,
            readingOrder: order,
            orientation: 'horizontal',
          });
          order++;
        }
      }
    }

    return {
      pageId: input.pageId,
      regions,
      processingTimeMs: Date.now() - start,
    };
  }

  async supportedLanguages(): Promise<string[]> {
    return this.languages;
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      await this.getWorker(this.languages);
      return {
        healthy: true,
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
      };
    } catch (err) {
      return {
        healthy: false,
        message: err instanceof Error ? err.message : String(err),
        checkedAt: new Date().toISOString(),
      };
    }
  }

  async dispose(): Promise<void> {
    await this.worker?.terminate();
    this.worker = null;
  }
}

export const manifest: PluginManifest = {
  metadata,
  factory: (storage) => new TesseractOCRProvider(storage),
};
