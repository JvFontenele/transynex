import type {
  HealthCheckResult,
  LanguagePair,
  PluginManifest,
  ProviderMetadata,
  TranslationInput,
  TranslationProvider,
  TranslationResult,
} from '@transynex/core-contracts';

const metadata: ProviderMetadata = {
  id: 'libretranslate',
  name: 'LibreTranslate',
  version: '0.1.0',
  author: 'Transynex',
  description: 'Tradução via instância LibreTranslate self-hosted (Argos Translate).',
  type: 'translation',
  requiresGPU: false,
  requiresNetwork: false,
  configSchema: {
    type: 'object',
    properties: {
      baseUrl: { type: 'string', default: 'http://localhost:5000' },
      apiKey: { type: 'string', format: 'secret' },
    },
  },
};

interface LTLanguage {
  code: string;
  targets: string[];
}

export class LibreTranslateProvider implements TranslationProvider {
  readonly metadata = metadata;
  private baseUrl = 'http://localhost:5000';
  private apiKey?: string;

  async configure(config: Record<string, unknown>): Promise<void> {
    if (typeof config.baseUrl === 'string') this.baseUrl = config.baseUrl.replace(/\/$/, '');
    if (typeof config.apiKey === 'string' && config.apiKey) this.apiKey = config.apiKey;
  }

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, ...(this.apiKey ? { api_key: this.apiKey } : {}) }),
    });
    if (!res.ok) {
      throw new Error(`LibreTranslate respondeu ${res.status}: ${await res.text()}`);
    }
    return (await res.json()) as T;
  }

  async translate(input: TranslationInput): Promise<TranslationResult> {
    const body = await this.post<{
      translatedText: string;
      detectedLanguage?: { language: string; confidence: number };
    }>('/translate', {
      q: input.text,
      source: input.sourceLanguage === 'auto' ? 'auto' : input.sourceLanguage,
      target: input.targetLanguage,
      format: 'text',
    });
    return {
      translatedText: body.translatedText,
      detectedSourceLanguage: body.detectedLanguage?.language,
      confidence: body.detectedLanguage ? body.detectedLanguage.confidence / 100 : undefined,
    };
  }

  // A API aceita `q` como array e devolve as traduções na mesma ordem.
  async translateBatch(inputs: TranslationInput[]): Promise<TranslationResult[]> {
    if (inputs.length === 0) return [];
    const { sourceLanguage, targetLanguage } = inputs[0];
    const body = await this.post<{ translatedText: string[] }>('/translate', {
      q: inputs.map((i) => i.text),
      source: sourceLanguage === 'auto' ? 'auto' : sourceLanguage,
      target: targetLanguage,
      format: 'text',
    });
    return body.translatedText.map((translatedText) => ({ translatedText }));
  }

  async supportedLanguagePairs(): Promise<LanguagePair[]> {
    const res = await fetch(`${this.baseUrl}/languages`);
    if (!res.ok) throw new Error(`LibreTranslate respondeu ${res.status}`);
    const languages = (await res.json()) as LTLanguage[];
    return languages.flatMap((lang) =>
      lang.targets.map((target) => ({ source: lang.code, target })),
    );
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      const res = await fetch(`${this.baseUrl}/languages`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return {
        healthy: true,
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
      };
    } catch (err) {
      return {
        healthy: false,
        message: `LibreTranslate inacessível em ${this.baseUrl}: ${err instanceof Error ? err.message : err}`,
        checkedAt: new Date().toISOString(),
      };
    }
  }
}

export const manifest: PluginManifest = {
  metadata,
  factory: () => new LibreTranslateProvider(),
};
