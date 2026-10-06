import type {
  BoundingBox,
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
  id: 'paddle-ocr',
  name: 'PaddleOCR',
  version: '0.1.0',
  author: 'Transynex',
  description:
    'OCR via PaddleOCR (PP-OCRv5) rodando como serviço HTTP (services/paddle-ocr). Melhor que o Tesseract em HQ/mangá e texto vertical.',
  type: 'ocr',
  requiresGPU: false,
  requiresNetwork: true,
  configSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'URL do serviço paddle-ocr',
        default: 'http://localhost:8866',
      },
      minConfidence: {
        type: 'number',
        description: 'Confiança mínima (0–1) para aceitar uma linha',
        default: 0.5,
      },
    },
  },
};

// ISO 639-1 (canônico no sistema) → código de idioma do PaddleOCR.
const ISO_TO_PADDLE: Record<string, string> = {
  ja: 'japan',
  ko: 'korean',
  zh: 'ch',
  'zh-CN': 'ch',
  'zh-TW': 'chinese_cht',
  'pt-BR': 'pt',
  'pt-PT': 'pt',
};

export function toPaddleLang(code: string): string {
  return ISO_TO_PADDLE[code] ?? code.split('-')[0]!;
}

export function polygonToBox(polygon: number[][]): BoundingBox {
  const xs = polygon.map((p) => p[0]!);
  const ys = polygon.map((p) => p[1]!);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(Math.max(...xs) - x),
    height: Math.round(Math.max(...ys) - y),
  };
}

interface PaddleLine {
  polygon: number[][];
  text: string;
  score: number;
}

export class PaddleOCRProvider implements OCRProvider {
  readonly metadata = metadata;
  private url = 'http://localhost:8866';
  private minConfidence = 0.5;

  constructor(private storage: StorageProvider) {}

  async configure(config: Record<string, unknown>): Promise<void> {
    if (typeof config.url === 'string' && config.url) this.url = config.url.replace(/\/$/, '');
    if (typeof config.minConfidence === 'number') {
      this.minConfidence = Math.min(Math.max(config.minConfidence, 0), 1);
    }
  }

  async recognize(input: OCRInput): Promise<OCRResult> {
    const start = Date.now();
    const image = await this.storage.read(input.imageRef);
    const form = new FormData();
    form.append('image', new Blob([new Uint8Array(image)]), 'page');
    form.append('lang', toPaddleLang(input.languageHint?.[0] ?? 'en'));

    const res = await fetch(`${this.url}/ocr`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`paddle-ocr ${res.status}: ${await res.text()}`);
    const { lines } = (await res.json()) as { lines: PaddleLine[] };

    const regions: OCRRegion[] = [];
    for (const line of lines) {
      if (line.score < this.minConfidence || !/[\p{L}\p{N}]/u.test(line.text)) continue;
      const boundingBox = polygonToBox(line.polygon);
      regions.push({
        id: `${input.pageId}-r${regions.length}`,
        boundingBox,
        text: line.text.trim(),
        confidence: line.score,
        readingOrder: regions.length,
        // Coluna alta e estreita = texto vertical (mangá)
        orientation: boundingBox.height > boundingBox.width * 1.5 ? 'vertical' : 'horizontal',
      });
    }
    return { pageId: input.pageId, regions, processingTimeMs: Date.now() - start };
  }

  async supportedLanguages(): Promise<string[]> {
    return ['en', 'ja', 'ko', 'zh', 'pt', 'es', 'fr', 'de', 'it', 'ru', 'ar'];
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      const res = await fetch(`${this.url}/health`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { healthy: true, latencyMs: Date.now() - start, checkedAt: new Date().toISOString() };
    } catch (err) {
      return {
        healthy: false,
        message: `Serviço paddle-ocr inacessível em ${this.url}: ${err instanceof Error ? err.message : String(err)}`,
        checkedAt: new Date().toISOString(),
      };
    }
  }
}

export const manifest: PluginManifest = {
  metadata,
  factory: (storage) => new PaddleOCRProvider(storage),
};
