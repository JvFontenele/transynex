// Contratos centrais do Transynex — ver docs/ARCHITECTURE.md.
// O Core (orquestrador, API, jobs) só conhece este pacote; nunca importa
// uma implementação concreta de provider.

export type ProviderType =
  | 'ocr'
  | 'translation'
  | 'inpainting'
  | 'render'
  | 'export'
  | 'storage';

// Subconjunto de JSON Schema suficiente para gerar forms de configuração na UI.
export type ConfigSchema = Record<string, unknown>;

export interface ProviderMetadata {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  type: ProviderType;
  configSchema: ConfigSchema;
  requiresGPU?: boolean;
  // true = requer INTERNET (API externa); serviços HTTP locais declaram false.
  requiresNetwork?: boolean;
}

export interface HealthCheckResult {
  healthy: boolean;
  message?: string;
  latencyMs?: number;
  checkedAt: string;
}

export interface Provider {
  readonly metadata: ProviderMetadata;
  configure(config: Record<string, unknown>): Promise<void>;
  healthCheck(): Promise<HealthCheckResult>;
  dispose?(): Promise<void>;
}

// ---------------------------------------------------------------------------
// OCR

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OCRRegion {
  id: string;
  boundingBox: BoundingBox;
  text: string;
  confidence: number; // 0–1
  languageDetected?: string;
  readingOrder?: number;
  orientation?: 'horizontal' | 'vertical';
}

export interface OCRInput {
  pageId: string;
  imageRef: string;
  languageHint?: string[];
}

export interface OCRResult {
  pageId: string;
  regions: OCRRegion[];
  rawOutput?: unknown;
  processingTimeMs: number;
}

export interface OCRProvider extends Provider {
  recognize(input: OCRInput): Promise<OCRResult>;
  supportedLanguages(): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// Tradução

export interface TranslationInput {
  text: string;
  sourceLanguage: string | 'auto';
  targetLanguage: string;
  context?: string;
  glossary?: Record<string, string>;
}

export interface TranslationResult {
  translatedText: string;
  detectedSourceLanguage?: string;
  confidence?: number;
  raw?: unknown;
}

export interface LanguagePair {
  source: string; // '*' = qualquer (LLMs)
  target: string;
}

export interface TranslationProvider extends Provider {
  translate(input: TranslationInput): Promise<TranslationResult>;
  translateBatch(inputs: TranslationInput[]): Promise<TranslationResult[]>;
  supportedLanguagePairs(): Promise<LanguagePair[]>;
}

// ---------------------------------------------------------------------------
// Inpainting

export interface InpaintingInput {
  pageId: string;
  imageRef: string;
  maskRegions: BoundingBox[];
}

export interface InpaintingResult {
  pageId: string;
  imageRef: string;
  processingTimeMs: number;
}

export interface InpaintingProvider extends Provider {
  inpaint(input: InpaintingInput): Promise<InpaintingResult>;
}

// ---------------------------------------------------------------------------
// Renderização

export interface TextBlock {
  regionId: string;
  boundingBox: BoundingBox;
  text: string;
  fontFamily?: string;
  fontSizeHint?: number;
  color?: string;
  strokeColor?: string;
  alignment?: 'left' | 'center' | 'right';
  verticalAlignment?: 'top' | 'middle' | 'bottom';
}

export interface RenderInput {
  pageId: string;
  baseImageRef: string;
  textBlocks: TextBlock[];
}

export interface RenderResult {
  pageId: string;
  imageRef: string;
  format: 'png' | 'jpeg' | 'webp';
}

export interface RenderProvider extends Provider {
  render(input: RenderInput): Promise<RenderResult>;
}

// ---------------------------------------------------------------------------
// Exportação

export type ExportFormat =
  | 'png'
  | 'jpeg'
  | 'webp'
  | 'pdf'
  | 'docx'
  | 'markdown'
  | 'txt'
  | 'cbz'
  | 'zip';

export interface ExportPageInput {
  pageId: string;
  imageRef?: string;
  text?: string;
}

export interface ExportInput {
  projectId: string;
  pages: ExportPageInput[];
  format: ExportFormat;
  options?: Record<string, unknown>;
}

export interface ExportResult {
  fileRef: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface ExportProvider extends Provider {
  export(input: ExportInput): Promise<ExportResult>;
  supportedFormats(): ExportFormat[];
}

// ---------------------------------------------------------------------------
// Armazenamento

export interface StorageProvider extends Provider {
  save(path: string, data: Buffer | NodeJS.ReadableStream): Promise<string>;
  read(ref: string): Promise<Buffer>;
  readStream(ref: string): Promise<NodeJS.ReadableStream>;
  delete(ref: string): Promise<void>;
  exists(ref: string): Promise<boolean>;
  getSignedUrl(ref: string, expiresInSeconds?: number): Promise<string>;
}

// ---------------------------------------------------------------------------
// Plugin

export interface PluginManifest {
  metadata: ProviderMetadata;
  // Recebe o StorageProvider padrão do sistema (bootstrap em duas fases:
  // providers de storage são registrados primeiro e ignoram o argumento).
  factory: (storage: StorageProvider) => Provider | Promise<Provider>;
}
