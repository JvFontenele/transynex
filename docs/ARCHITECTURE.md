# Transynex — Arquitetura de Providers

> **Transynex** — The Open Translation Orchestrator (Trans = tradução, Syn = sinergia/sinapse, Nex = nexus/hub).

Design das interfaces centrais do sistema, antes de qualquer implementação. Escopo desta fase: contratos de Provider, orquestração de pipeline, sistema de jobs, contratos de API e schema de banco. Providers concretos usados como referência de validação do design (apenas assinatura/estrutura, sem implementação): `LocalStorageProvider`, `TesseractOCRProvider`, `OllamaTranslationProvider` e `LibreTranslateProvider` — todos offline, cobrindo o objetivo central do projeto.

---

## 1. Princípio central

Todo componente substituível do sistema (OCR, tradução, inpainting, renderização, exportação, storage) implementa uma interface comum. O núcleo da aplicação (orquestrador, API, fila) nunca importa uma implementação concreta — apenas resolve providers via um `ProviderRegistry` a partir de um `providerId` configurado por projeto/pipeline.

```
Core (Orchestrator, API, Jobs)
        │
        ▼  resolve por id
ProviderRegistry
        │
        ▼  implementa
Provider (interface base)
   ├── OCRProvider
   ├── TranslationProvider
   ├── InpaintingProvider
   ├── RenderProvider
   ├── ExportProvider
   └── StorageProvider
```

Regra de ouro: **o Core nunca faz `import` de um pacote de provider específico.** Providers são descobertos e registrados dinamicamente (plugin loading), o Core só conhece as interfaces em `packages/core-contracts`.

Exceção deliberada: a **extração de páginas** (PDF/CBZ/ZIP → imagens de página) é um serviço do Core, não um provider. Ela roda antes do pipeline, tem pouquíssima variação de implementação (pdf.js/sharp/unzip) e transformá-la em provider adicionaria abstração sem benefício. Se um dia surgir necessidade real (ex: extração via FrankYomik), promove-se a `ExtractionProvider` sem quebrar nada, pois ela já roda como job isolado.

---

## 2. Provider base

Todo provider, independente do tipo, expõe metadata, configuração e health check — necessário para o Dashboard, tela de Plugins e tela de Configurações do spec.

```typescript
type ProviderType =
  | 'ocr'
  | 'translation'
  | 'inpainting'
  | 'render'
  | 'export'
  | 'storage';

interface ProviderMetadata {
  id: string;                  // slug único e estável, ex: "tesseract-ocr"
  name: string;                // nome de exibição
  version: string;             // semver do plugin
  author: string;
  description: string;
  type: ProviderType;
  configSchema: JSONSchema7;   // usado para gerar o form de configuração na UI
  requiresGPU?: boolean;
  requiresNetwork?: boolean;   // true = requer INTERNET (API externa); serviços HTTP locais (Ollama, LibreTranslate) declaram false
}

interface HealthCheckResult {
  healthy: boolean;
  message?: string;
  latencyMs?: number;
  checkedAt: string;           // ISO 8601
}

interface Provider {
  readonly metadata: ProviderMetadata;
  configure(config: Record<string, unknown>): Promise<void>;
  healthCheck(): Promise<HealthCheckResult>;
  dispose?(): Promise<void>;   // liberar recursos (ex: modelo carregado em memória)
}
```

`configSchema` é o contrato-chave da UI dinâmica de Plugins: a tela "Plugins" do menu principal renderiza um formulário a partir desse JSON Schema, sem precisar de código específico por provider.

---

## 3. Interfaces por tipo de Provider

### 3.1 OCRProvider

```typescript
interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface OCRRegion {
  id: string;
  boundingBox: BoundingBox;    // coordenadas em px relativas à imagem da página
  text: string;
  confidence: number;          // 0–1
  languageDetected?: string;   // ISO 639-1
  readingOrder?: number;       // ordem de leitura (relevante para mangá RTL)
  orientation?: 'horizontal' | 'vertical';
}

interface OCRInput {
  pageId: string;
  imageRef: string;            // StorageRef, não Buffer — evita acoplar OCR a I/O de storage
  languageHint?: string[];
}

interface OCRResult {
  pageId: string;
  regions: OCRRegion[];
  rawOutput?: unknown;         // payload bruto do provider, para debug/auditoria
  processingTimeMs: number;
}

interface OCRProvider extends Provider {
  recognize(input: OCRInput): Promise<OCRResult>;
  supportedLanguages(): Promise<string[]>;
}
```

Decisão de design: `imageRef` (string) em vez de `Buffer` — o provider busca o binário via `StorageProvider` injetado, então rodar OCR remoto (ex: Google Vision) não exige transferir a imagem inteira pelo orquestrador.

Decisão de design (descoberta na integração real): **o sistema usa ISO 639-1 como código canônico de idioma** em todas as interfaces (`languageHint`, `sourceLanguage`, `targetLanguage`). Cada provider converte internamente para seu formato nativo — Tesseract mapeia `en → eng`, `ja → jpn` etc.; LibreTranslate já usa 639-1 nativamente. Sem isso, trocar de provider quebraria a configuração de idiomas do projeto.

### 3.2 TranslationProvider

```typescript
interface TranslationInput {
  text: string;
  sourceLanguage: string | 'auto';
  targetLanguage: string;
  context?: string;                      // texto vizinho, para desambiguação
  glossary?: Record<string, string>;     // termos fixos do projeto (v2: memória de tradução)
}

interface TranslationResult {
  translatedText: string;
  detectedSourceLanguage?: string;
  confidence?: number;
  raw?: unknown;
}

interface TranslationProvider extends Provider {
  translate(input: TranslationInput): Promise<TranslationResult>;
  translateBatch(inputs: TranslationInput[]): Promise<TranslationResult[]>;
  supportedLanguagePairs(): Promise<Array<{ source: string; target: string }>>;
}
```

`translateBatch` é obrigatório na interface (não opcional): providers de LLM (Ollama, Gemini) se beneficiam de agrupar os balões de uma página inteira numa única chamada, com contexto compartilhado — isso deve ser decisão do provider, não do orquestrador.

### 3.3 InpaintingProvider

```typescript
interface InpaintingInput {
  pageId: string;
  imageRef: string;
  maskRegions: BoundingBox[];   // derivado das OCRRegion da etapa anterior
}

interface InpaintingResult {
  pageId: string;
  imageRef: string;             // nova imagem, já salva via StorageProvider
  processingTimeMs: number;
}

interface InpaintingProvider extends Provider {
  inpaint(input: InpaintingInput): Promise<InpaintingResult>;
}
```

Etapa opcional no pipeline (conforme spec) — se ausente, o `RenderProvider` recebe a imagem original.

### 3.4 RenderProvider

```typescript
interface TextBlock {
  regionId: string;
  boundingBox: BoundingBox;
  text: string;                 // texto já traduzido
  fontFamily?: string;
  fontSizeHint?: number;        // provider pode recalcular para caber no box
  color?: string;
  strokeColor?: string;
  alignment?: 'left' | 'center' | 'right';
  verticalAlignment?: 'top' | 'middle' | 'bottom';
}

interface RenderInput {
  pageId: string;
  baseImageRef: string;         // saída do inpainting, ou original se etapa pulada
  textBlocks: TextBlock[];
}

interface RenderResult {
  pageId: string;
  imageRef: string;
  format: 'png' | 'jpeg' | 'webp';
}

interface RenderProvider extends Provider {
  render(input: RenderInput): Promise<RenderResult>;
}
```

Responsabilidades do provider (do spec): quebra de linha, escolha de fonte, centralização, contorno, posicionamento — tudo encapsulado aqui, o Core só monta `TextBlock[]` a partir de OCR + tradução.

### 3.5 ExportProvider

```typescript
type ExportFormat = 'png' | 'jpeg' | 'webp' | 'pdf' | 'docx' | 'markdown' | 'txt' | 'cbz' | 'zip';

interface ExportPageInput {
  pageId: string;
  imageRef?: string;            // para formatos de imagem/PDF/CBZ
  text?: string;                 // para formatos de texto (docx/markdown/txt)
}

interface ExportInput {
  projectId: string;
  pages: ExportPageInput[];
  format: ExportFormat;
  options?: Record<string, unknown>;
}

interface ExportResult {
  fileRef: string;               // já persistido via StorageProvider
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

interface ExportProvider extends Provider {
  export(input: ExportInput): Promise<ExportResult>;
  supportedFormats(): ExportFormat[];
}
```

### 3.6 StorageProvider

```typescript
interface StorageProvider extends Provider {
  save(path: string, data: Buffer | NodeJS.ReadableStream): Promise<string>;  // retorna StorageRef
  read(ref: string): Promise<Buffer>;
  readStream(ref: string): Promise<NodeJS.ReadableStream>;
  delete(ref: string): Promise<void>;
  exists(ref: string): Promise<boolean>;
  getSignedUrl(ref: string, expiresInSeconds?: number): Promise<string>;
}
```

`StorageProvider` é injetado nos demais providers (não usado diretamente pelo Core na maioria dos casos) — isso permite trocar `local` → `S3`/`MinIO`/`Nextcloud` sem tocar OCR, tradução, etc.

---

## 4. Registry e descoberta de plugins

```typescript
interface ProviderRegistry {
  register(provider: Provider): void;
  unregister(providerId: string): void;
  get<T extends Provider>(type: ProviderType, id: string): T;
  list(type: ProviderType): ProviderMetadata[];
  healthCheckAll(): Promise<Record<string, HealthCheckResult>>;
}

// Contrato de um pacote de plugin instalável em plugins/
interface PluginManifest {
  metadata: ProviderMetadata;
  // `storage` é o StorageProvider padrão do sistema, já resolvido no boot.
  // Bootstrap em duas fases: primeiro registram-se os providers de storage
  // (cujo factory ignora o argumento), depois os demais tipos recebem o
  // storage default configurado.
  factory: (storage: StorageProvider) => Provider | Promise<Provider>;
}
```

Instalar um plugin = colocar um pacote em `plugins/` que exporta um `PluginManifest`. O núcleo varre o diretório no boot e chama `registry.register(...)` — nenhuma alteração de código no Core, conforme exigência do spec ("instalação de novos plugins não deve exigir alterações no núcleo").

---

## 5. Orquestrador de Pipeline

```typescript
interface PipelineStep {
  providerType: ProviderType;
  providerId: string;
  config?: Record<string, unknown>;
  optional?: boolean;           // ex: inpainting
}

interface PipelineDefinition {
  id: string;
  projectId: string;
  name: string;
  steps: PipelineStep[];        // ordem de execução
}

interface PipelineContext {
  projectId: string;
  pageId: string;
  sourceLanguage: string;
  targetLanguage: string;
  artifacts: Partial<Record<ProviderType, unknown>>;  // saída acumulada de cada step
}

// Assinatura do worker de cada step: recebe o contexto acumulado,
// devolve o contexto com seu artifact adicionado.
type StepExecutor = (step: PipelineStep, ctx: PipelineContext) => Promise<PipelineContext>;

interface PipelineOrchestrator {
  run(pipeline: PipelineDefinition, pageId: string): Promise<void>;  // enfileira jobs encadeados
  runProject(pipeline: PipelineDefinition): Promise<void>;           // fan-out para todas as páginas
}
```

Execução real: cada `PipelineStep` vira um job BullMQ; o encadeamento usa BullMQ Flows (job pai = página completa, filhos = steps em sequência, com `parentId` conectando saída→entrada). O `PipelineContext` serializado é o payload que trafega entre jobs: cada worker desserializa o contexto do job anterior, executa seu step via `StepExecutor` e grava o contexto atualizado no resultado do job. Como `artifacts` carrega apenas `StorageRef`s e metadados (nunca binários), o payload permanece pequeno. Isso dá progresso por etapa, retry por etapa (o contexto de entrada do step é imutável), e paralelismo entre páginas.

---

## 6. Sistema de Jobs

```typescript
type JobType = 'extraction' | 'ocr' | 'translation' | 'inpainting' | 'render' | 'export' | 'plugin-health' | 'model-download';
type JobStatus = 'queued' | 'active' | 'completed' | 'failed' | 'retrying' | 'cancelled';

interface JobRecord {
  id: string;
  projectId: string;
  pageId?: string;
  pipelineStepIndex?: number;
  type: JobType;
  status: JobStatus;
  progress: number;             // 0–100
  attempts: number;
  maxAttempts: number;
  error?: string;
  etaSeconds?: number;
  startedAt?: string;
  finishedAt?: string;
}

interface JobLogEntry {
  jobId: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}
```

Publicado em tempo real via Socket.IO (`job:progress`, `job:completed`, `job:failed`) para alimentar a tela "Fila" e o Dashboard sem polling.

---

## 7. Contratos de API (REST, alto nível)

Prefixo `/api/v1`. Documentado via OpenAPI/Swagger no backend (Fastify).

| Recurso | Endpoints |
|---|---|
| Auth | `POST /auth/login`, `POST /auth/refresh` |
| Projects | `GET/POST /projects`, `GET/PATCH/DELETE /projects/:id` |
| Uploads | `POST /projects/:id/uploads` (multipart → cria `SourceFile` + job `extraction`), `GET /projects/:id/files` |
| Pages | `GET /projects/:id/pages`, `GET /pages/:id` |
| Regions (correção) | `GET /pages/:id/regions`, `PATCH /regions/:id` (editar `sourceText`/`translatedText`/`boundingBox`), `POST /pages/:id/regions`, `DELETE /regions/:id` |
| Pipelines | `GET/POST /projects/:id/pipelines`, `POST /pipelines/:id/run` |
| Jobs | `GET /jobs`, `GET /jobs/:id`, `GET /jobs/:id/logs`, `POST /jobs/:id/cancel` |
| Providers | `GET /providers`, `GET /providers/:type`, `POST /providers/:id/configure`, `GET /providers/:id/health` |
| Plugins | `GET /plugins`, `POST /plugins/install`, `DELETE /plugins/:id` |
| Exports | `POST /projects/:id/export`, `GET /projects/:id/exports`, `GET /exports/:id/download` |
| Files | `GET /files/:token` (serve binários com token assinado — backend do `getSignedUrl` do storage local) |
| Dashboard | `GET /dashboard/metrics` (CPU/GPU/RAM/disco/filas) |
| Config | `GET/PATCH /config` (idioma padrão, providers padrão, diretórios, GPU/CPU) |

Todos os endpoints de escrita retornam o recurso atualizado; endpoints de execução assíncrona (`POST /projects/:id/uploads`, `/pipelines/:id/run`, `/projects/:id/export`) retornam `202 Accepted` + `jobId` para acompanhamento via `GET /jobs/:id` ou Socket.IO.

Os endpoints de Regions cobrem a etapa **Correção** do fluxo geral do spec: o usuário revisa o OCR antes da tradução e/ou revisa a tradução antes da renderização. Um `PATCH /regions/:id` após a renderização marca a página como "suja" (`Page.renderedImageRef = null`), exigindo re-render — regra aplicada no service, não no client.

---

## 8. Schema de banco (Prisma, rascunho)

```prisma
model User {
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String
  role         String   @default("admin")  // RBAC completo fica para o futuro (spec)
  createdAt    DateTime @default(now())

  projects     Project[]
}

model Project {
  id            String   @id @default(cuid())
  ownerId       String
  owner         User     @relation(fields: [ownerId], references: [id])
  name          String
  sourceLanguage String
  targetLanguage String
  status        ProjectStatus @default(DRAFT)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  sourceFiles   SourceFile[]
  pages         Page[]
  pipelines     Pipeline[]
  jobs          Job[]
  exports       ExportArtifact[]
}

enum ProjectStatus {
  DRAFT
  PROCESSING
  READY
  ERROR
}

model SourceFile {
  id         String   @id @default(cuid())
  projectId  String
  project    Project  @relation(fields: [projectId], references: [id])
  fileName   String
  mimeType   String   // pdf, cbz, cbr, zip, png, jpeg, webp, tiff
  fileRef    String   // StorageRef do arquivo original enviado
  sizeBytes  Int
  status     String   @default("pending")  // pending | extracting | extracted | error
  createdAt  DateTime @default(now())

  pages      Page[]
}

model Page {
  id               String   @id @default(cuid())
  projectId        String
  project          Project  @relation(fields: [projectId], references: [id])
  sourceFileId     String
  sourceFile       SourceFile @relation(fields: [sourceFileId], references: [id])
  order            Int
  sourceImageRef   String   // StorageRef da imagem da página extraída
  inpaintedImageRef String? // saída do inpainting (se etapa habilitada)
  renderedImageRef String?  // saída da renderização; null = página "suja", precisa re-render

  ocrRegions       OcrRegion[]

  @@index([projectId, order])
}

model OcrRegion {
  id             String  @id @default(cuid())
  pageId         String
  page           Page    @relation(fields: [pageId], references: [id])
  boundingBox    Json     // BoundingBox
  sourceText     String
  translatedText String?
  confidence     Float
  readingOrder   Int?
  orientation    String?  // 'horizontal' | 'vertical'

  @@index([pageId])
}

model Pipeline {
  id         String   @id @default(cuid())
  projectId  String
  project    Project  @relation(fields: [projectId], references: [id])
  name       String
  steps      Json      // PipelineStep[]
  createdAt  DateTime @default(now())
}

model Job {
  id                String    @id @default(cuid())
  projectId         String
  project           Project   @relation(fields: [projectId], references: [id])
  pageId            String?
  pipelineStepIndex Int?
  type              String    // JobType
  status            String    // JobStatus
  progress          Int       @default(0)
  attempts          Int       @default(0)
  maxAttempts       Int       @default(3)
  error             String?
  startedAt         DateTime?
  finishedAt        DateTime?

  @@index([projectId, status])
}

model ProviderConfig {
  id          String   @id @default(cuid())
  providerId  String   @unique     // slug do provider
  type        String                // ProviderType
  config      Json                  // valida contra o JSONSchema do provider
  isDefault   Boolean  @default(false)
  updatedAt   DateTime @updatedAt

  // No máximo um default por tipo — aplicado via índice parcial em migração SQL
  // (Prisma não expressa unique condicional):
  // CREATE UNIQUE INDEX provider_default_per_type
  //   ON "ProviderConfig"(type) WHERE "isDefault";
}

model ApiCredential {
  id          String   @id @default(cuid())
  providerId  String   @unique   // provider dono da credencial
  encrypted   Bytes                // AES-256-GCM; chave vem de env MASTER_KEY, nunca do banco
  iv          Bytes
  updatedAt   DateTime @updatedAt
}

model ExportArtifact {
  id         String   @id @default(cuid())
  projectId  String
  project    Project  @relation(fields: [projectId], references: [id])
  format     String
  fileRef    String
  sizeBytes  Int
  createdAt  DateTime @default(now())
}
```

Chaves de API de providers pagos (Gemini, OpenAI, DeepL) ficam exclusivamente em `ApiCredential`, criptografadas em repouso — nunca em `ProviderConfig.config` em texto puro. O `configSchema` do provider marca campos sensíveis (`"format": "secret"`) para a UI saber que devem ser gravados via `ApiCredential` e nunca ecoados de volta ao client.

---

## 9. Validação do design com providers de referência

Sem implementar, só verificando que a interface é suficiente:

- **`LocalStorageProvider`** (`storage`): `save`/`read`/`delete` mapeiam 1:1 para `fs.promises` sobre `storage/projects/:projectId/...`; `getSignedUrl` pode retornar uma URL assinada por um token JWT de curta duração servida por uma rota `GET /files/:token` do próprio backend (não precisa de infra extra tipo S3 pré-signed).
- **`TesseractOCRProvider`** (`ocr`): `recognize` chama o binário/wrapper `tesseract` (ou `node-tesseract-ocr`) com o buffer lido via `StorageProvider.read(imageRef)`; `supportedLanguages()` lista os `.traineddata` instalados; `requiresGPU: false`, `requiresNetwork: false` — compatível com o objetivo de execução 100% offline.
- **`OllamaTranslationProvider`** (`translation`): `translate` monta um prompt com instrução de tradução + `context` + `glossary` e chama `POST /api/chat` do Ollama local; `translateBatch` agrupa todas as regiões da página num único prompt numerado (contexto compartilhado entre balões — exatamente o cenário que justificou `translateBatch` ser obrigatório) e desmonta a resposta pela numeração. `configSchema`: URL do Ollama, nome do modelo, temperatura, prompt template.
- **`LibreTranslateProvider`** (`translation`): `translate` → `POST /translate`; `translateBatch` → mesma rota com `q` em array (suportado nativamente); `supportedLanguagePairs()` → `GET /languages` mapeia 1:1. `configSchema`: URL da instância, API key opcional.

A validação dos dois providers de tradução expôs dois ajustes de contrato, já aplicados:

1. **`supportedLanguagePairs()` não é enumerável para LLMs** — um modelo do Ollama traduz qualquer par, não há lista finita. Convenção adotada: o provider pode retornar `[{ source: '*', target: '*' }]` (curinga); a UI então mostra campos livres de idioma em vez de dropdown restrito.
2. **`requiresNetwork` significa "requer internet", não "faz chamada de rede"** — Ollama e LibreTranslate são serviços HTTP locais (mesmo host/rede Docker) e declaram `requiresNetwork: false`, permanecendo elegíveis para o modo offline. Apenas providers que dependem de API externa (Gemini, DeepL…) declaram `true`.

Nenhum provider exigiu método adicional na interface — sinal de que o contrato está no nível certo de abstração.

---

## 10. Próximos passos sugeridos

1. Revisar este documento e ajustar interfaces antes de gerar código.
2. Decidir estrutura de monorepo (`apps/backend`, `apps/frontend`, `packages/core-contracts`, `plugins/*`).
3. Escolher entre gerar o esqueleto do repo ou implementar primeiro o pipeline mínimo offline (`LocalStorageProvider` + `TesseractOCRProvider` + `OllamaTranslationProvider`/`LibreTranslateProvider` + orquestrador via CLI), antes de tocar no frontend.
