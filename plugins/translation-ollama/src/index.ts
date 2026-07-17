import type {
  HealthCheckResult,
  LanguagePair,
  PluginManifest,
  ProviderMetadata,
  TranslationInput,
  TranslationProvider,
  TranslationResult,
} from '@hub/core-contracts';

const metadata: ProviderMetadata = {
  id: 'ollama-translation',
  name: 'Ollama',
  version: '0.1.0',
  author: 'AI Translation Hub',
  description: 'Tradução via LLM local servido pelo Ollama.',
  type: 'translation',
  requiresGPU: false,
  requiresNetwork: false,
  configSchema: {
    type: 'object',
    properties: {
      baseUrl: { type: 'string', default: 'http://localhost:11434' },
      model: { type: 'string', default: 'qwen2.5:7b' },
      temperature: { type: 'number', default: 0.2 },
    },
    required: ['model'],
  },
};

interface ChatResponse {
  message?: { content?: string };
}

export class OllamaTranslationProvider implements TranslationProvider {
  readonly metadata = metadata;
  private baseUrl = 'http://localhost:11434';
  private model = 'qwen2.5:7b';
  private temperature = 0.2;

  async configure(config: Record<string, unknown>): Promise<void> {
    if (typeof config.baseUrl === 'string') this.baseUrl = config.baseUrl.replace(/\/$/, '');
    if (typeof config.model === 'string') this.model = config.model;
    if (typeof config.temperature === 'number') this.temperature = config.temperature;
  }

  private async chat(system: string, user: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        options: { temperature: this.temperature },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!res.ok) {
      throw new Error(`Ollama respondeu ${res.status}: ${await res.text()}`);
    }
    const body = (await res.json()) as ChatResponse;
    const content = body.message?.content;
    if (!content) throw new Error('Resposta do Ollama sem conteúdo');
    return content.trim();
  }

  private systemPrompt(source: string, target: string, glossary?: Record<string, string>): string {
    let prompt =
      `Você é um tradutor profissional. Traduza do idioma "${source}" para "${target}". ` +
      'Preserve o tom e o registro do original. Responda APENAS com a tradução, sem explicações.';
    if (glossary && Object.keys(glossary).length > 0) {
      const terms = Object.entries(glossary)
        .map(([k, v]) => `"${k}" → "${v}"`)
        .join('; ');
      prompt += ` Use obrigatoriamente estas traduções fixas: ${terms}.`;
    }
    return prompt;
  }

  async translate(input: TranslationInput): Promise<TranslationResult> {
    const system = this.systemPrompt(input.sourceLanguage, input.targetLanguage, input.glossary);
    const user = input.context
      ? `Contexto (não traduzir): ${input.context}\n\nTexto: ${input.text}`
      : input.text;
    const translatedText = await this.chat(system, user);
    return { translatedText };
  }

  // Página inteira num único prompt numerado: o LLM traduz com contexto
  // compartilhado entre balões — a razão de translateBatch ser obrigatório.
  async translateBatch(inputs: TranslationInput[]): Promise<TranslationResult[]> {
    if (inputs.length === 0) return [];
    if (inputs.length === 1) return [await this.translate(inputs[0])];

    const { sourceLanguage, targetLanguage, glossary } = inputs[0];
    const system =
      this.systemPrompt(sourceLanguage, targetLanguage, glossary) +
      ' O texto vem em linhas numeradas ("1. ...", "2. ..."). Responda com as mesmas linhas numeradas, ' +
      'uma tradução por linha, sem linhas extras.';
    const user = inputs.map((inp, i) => `${i + 1}. ${inp.text}`).join('\n');

    const raw = await this.chat(system, user);
    const byNumber = new Map<number, string>();
    for (const line of raw.split('\n')) {
      const match = line.match(/^\s*(\d+)[.)]\s*(.*)$/);
      if (match) byNumber.set(Number(match[1]), match[2].trim());
    }

    // Linhas que o modelo não devolveu numeradas caem no fallback unitário.
    return Promise.all(
      inputs.map(async (inp, i) => {
        const translated = byNumber.get(i + 1);
        if (translated !== undefined && translated !== '') {
          return { translatedText: translated } satisfies TranslationResult;
        }
        return this.translate(inp);
      }),
    );
  }

  async supportedLanguagePairs(): Promise<LanguagePair[]> {
    return [{ source: '*', target: '*' }];
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { models?: Array<{ name: string }> };
      const hasModel = body.models?.some((m) => m.name === this.model);
      return {
        healthy: true,
        message: hasModel ? undefined : `Modelo "${this.model}" não encontrado no Ollama`,
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
      };
    } catch (err) {
      return {
        healthy: false,
        message: `Ollama inacessível em ${this.baseUrl}: ${err instanceof Error ? err.message : err}`,
        checkedAt: new Date().toISOString(),
      };
    }
  }
}

export const manifest: PluginManifest = {
  metadata,
  factory: () => new OllamaTranslationProvider(),
};
