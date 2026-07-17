import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  DefaultProviderRegistry,
  type OCRProvider,
  type TranslationProvider,
} from '@transynex/core-contracts';
import { loadPlugins } from './plugin-loader.js';

const HELP = `Transynex — CLI (pipeline mínimo offline)

Uso:
  pnpm cli --image <arquivo> --from <idioma> --to <idioma> [opções]
  pnpm cli --health

Opções:
  --image <path>        Imagem de entrada (png/jpeg/webp)
  --from <lang>         Idioma de origem (ex: eng, jpn) — também usado como hint do OCR
  --to <lang>           Idioma de destino (ex: pt)
  --ocr <id>            Provider de OCR      (default: tesseract-ocr)
  --translator <id>     Provider de tradução (default: ollama-translation)
  --out <path>          Grava o resultado JSON neste arquivo
  --health              Só roda o health check de todos os providers
`;

const { values } = parseArgs({
  options: {
    image: { type: 'string' },
    from: { type: 'string' },
    to: { type: 'string' },
    ocr: { type: 'string', default: 'tesseract-ocr' },
    translator: { type: 'string', default: 'ollama-translation' },
    out: { type: 'string' },
    health: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});

if (values.help || (!values.health && (!values.image || !values.from || !values.to))) {
  console.log(HELP);
  process.exit(values.help ? 0 : 1);
}

const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Config por provider viria do banco (ProviderConfig) no backend; na fase CLI,
// de variáveis de ambiente.
const providerConfigs: Record<string, Record<string, unknown>> = {
  'storage-local': { baseDir: process.env.TRANSYNEX_STORAGE_DIR ?? './storage' },
  'tesseract-ocr': {
    languages: values.from ? [values.from] : undefined,
    cachePath: process.env.TRANSYNEX_MODELS_DIR ?? './models/tesseract',
  },
  'ollama-translation': {
    baseUrl: process.env.OLLAMA_URL,
    model: process.env.OLLAMA_MODEL,
  },
  libretranslate: { baseUrl: process.env.LIBRETRANSLATE_URL },
};

const registry = new DefaultProviderRegistry();
const storage = await loadPlugins(registry, path.join(appDir, 'plugins.json'), providerConfigs);

if (values.health) {
  const results = await registry.healthCheckAll();
  for (const [id, r] of Object.entries(results)) {
    const status = r.healthy ? 'ok' : 'FALHA';
    console.log(`${status.padEnd(6)} ${id}${r.message ? ` — ${r.message}` : ''}`);
  }
  process.exit(Object.values(results).every((r) => r.healthy) ? 0 : 1);
}

const ocr = registry.get<OCRProvider>('ocr', values.ocr!);
const translator = registry.get<TranslationProvider>('translation', values.translator!);

const translatorHealth = await translator.healthCheck();
if (!translatorHealth.healthy) {
  console.error(`Tradutor "${values.translator}" indisponível: ${translatorHealth.message}`);
  process.exit(1);
}

// 1. Upload: copia a imagem para o storage
const pageId = `page-${Date.now()}`;
const imageRef = `pages/${pageId}${path.extname(values.image!)}`;
await storage.save(imageRef, await fs.readFile(values.image!));
console.log(`[1/3] Imagem salva no storage: ${imageRef}`);

// 2. OCR
const ocrResult = await ocr.recognize({ pageId, imageRef, languageHint: [values.from!] });
console.log(`[2/3] OCR (${values.ocr}): ${ocrResult.regions.length} regiões em ${ocrResult.processingTimeMs}ms`);
if (ocrResult.regions.length === 0) {
  console.error('Nenhum texto reconhecido na imagem.');
  process.exit(1);
}

// 3. Tradução em lote (página inteira de uma vez)
const translations = await translator.translateBatch(
  ocrResult.regions.map((r) => ({
    text: r.text,
    sourceLanguage: values.from!,
    targetLanguage: values.to!,
  })),
);
console.log(`[3/3] Tradução (${values.translator}): ${translations.length} regiões traduzidas\n`);

const result = {
  pageId,
  imageRef,
  sourceLanguage: values.from,
  targetLanguage: values.to,
  providers: { ocr: values.ocr, translation: values.translator },
  regions: ocrResult.regions.map((region, i) => ({
    ...region,
    translatedText: translations[i].translatedText,
  })),
};

for (const region of result.regions) {
  console.log(`  "${region.text}"`);
  console.log(`  → "${region.translatedText}"  (confiança OCR: ${(region.confidence * 100).toFixed(0)}%)\n`);
}

if (values.out) {
  await fs.writeFile(values.out, JSON.stringify(result, null, 2));
  console.log(`Resultado gravado em ${values.out}`);
}

await ocr.dispose?.();
