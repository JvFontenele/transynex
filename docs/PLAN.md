# Transynex — Plano de implementação

Estado em 2026-08-03: o fluxo de imagem funciona ponta a ponta (upload → extração
→ OCR → tradução → render → export), com auth JWT, papéis ADMIN/EDITOR/VIEWER,
editor de páginas, modo leitura, Socket.IO de jobs, telas de Plugins/Configurações
/Usuários e deploy Docker. A Fase 1 (UX) está essencialmente concluída — só falta
o filtro por projeto na Fila. Este plano cobre o que falta em relação ao
[ARCHITECTURE.md](./ARCHITECTURE.md), em fases ordenadas por impacto/custo.

## Vertente B — Projetos de documento (texto corrido)

Segundo fluxo, paralelo ao de imagem: `Project.kind = DOCUMENT` lê o texto do PDF
e mostra **só a tradução, em texto corrido** (ver [ARCHITECTURE §11](./ARCHITECTURE.md#11-projetos-de-documento-texto-corrido)).

Pronto: tipo na criação do projeto, extração via `pdftotext -bbox-layout` com
fallback automático para OCR em PDF escaneado, `DocumentBlock` (parágrafos),
tradução em lotes por arquivo (incremental, com opção de refazer), leitor de
texto corrido com modo bilíngue e cópia da tradução.

Falta nesta vertente:

- **Editar parágrafo** (`PATCH /blocks/:id`) — hoje o leitor é somente-leitura;
  o modo bilíngue serve para revisar, mas não para corrigir.
- **Exportar** o documento traduzido (txt/markdown/DOCX): o `export-basic` monta
  a partir de `Page`, precisa de um caminho a partir de `DocumentBlock`.
- **Reordenar/remover arquivo** do documento (hoje a ordem é a de upload).
- **Glossário por projeto** — mais valioso aqui que no fluxo de mangá, porque
  documento longo repete terminologia.

## Fase 1 — UX do frontend (em andamento)

Refatoração das telas para ficarem mais amigáveis, sem mudança de backend:

- Componentes compartilhados (`StatusBadge`, `ProgressBar`, `EmptyState`) e
  helpers de rótulos (idiomas com nome legível, tipos/status de job em pt-BR,
  formatação de tamanho/data).
- **Projetos**: seleção de idioma com nomes (não códigos crus), grade de cards,
  confirmação antes de excluir, empty state com call-to-action.
- **Detalhe do projeto**: dropzone com arrastar-e-soltar, páginas em grade de
  miniaturas com status visual (sem OCR / traduzida / precisa re-render) em vez
  de imagens gigantes + tabela por página, seções claras (enviar → traduzir →
  revisar → exportar).
- **Fila**: rótulos em pt-BR, filtro por status/projeto, horários relativos.
- **Dashboard**: atalhos de ação, projetos recentes, jobs ativos ao vivo.
- **Login/Plugins/Configurações**: polimento visual e de textos.

## Fase 2 — Controle de jobs

- Backend: `POST /jobs/:id/cancel` (BullMQ `job.remove()`/flag de cancelamento
  checada pelo worker) e `GET /jobs/:id/logs` (novo modelo `JobLogEntry` no
  Prisma; workers gravam logs por etapa).
- Frontend: botão cancelar + drawer de logs na Fila.

## Fase 3 — Configuração global e edição de projeto

- `GET/PATCH /config` (idioma padrão de novos projetos, diretório de storage,
  limites de concorrência dos workers) + seção na tela Configurações.
- `PATCH /projects/:id` (renomear, trocar par de idiomas) + edição inline na UI.

## Fase 4 — Dashboard de métricas

- `GET /dashboard/metrics`: CPU/RAM/disco via `os`/`systeminformation`,
  profundidade das filas BullMQ, contagens de jobs por status.
- Cards de métricas no Dashboard com atualização periódica.

## Fase 5 — Pipelines persistidos

- CRUD de `Pipeline` (modelo já existe no schema): `GET/POST
  /projects/:id/pipelines`, `POST /pipelines/:id/run`; o run ad-hoc atual
  (`POST /projects/:id/run`) passa a criar/usar um pipeline default.
- UI: editor simples de steps (ordem, provider por etapa, step opcional).

## Fase 6 — Inpainting

- Primeiro plugin `InpaintingProvider` (ex: OpenCV inpaint via sharp/wasm, ou
  serviço LaMa local) preenchendo `Page.inpaintedImageRef`.
- Step opcional no pipeline entre tradução e render (o render já usa
  `inpaintedImageRef ?? sourceImageRef`, nada muda lá).

## Fase 7 — Gestão de plugins via UI

- `POST /plugins/install` (upload de pacote → valida manifest → registra) e
  `DELETE /plugins/:id`, com persistência de plugins habilitados.
- Ações de instalar/remover na tela Plugins.

## Fase 8 — Providers externos e formatos extras

- Providers de nuvem usando a infra de `ApiCredential` já pronta: tradução
  (Gemini/DeepL) e OCR (Google Vision) — todos `requiresNetwork: true`.
- Export DOCX no export-basic (spec lista o formato; hoje há pdf/cbz/zip/txt/md).

## Futuro (v2, conforme spec)

- Glossário / memória de tradução por projeto.
- StorageProvider S3/MinIO.

## Dívidas transversais (não cobertas pelas fases)

- **Zero testes**: nenhum runner configurado, nenhum `*.test.ts`. As heurísticas
  de parágrafo (`document.ts`) e o agrupamento de regiões são os candidatos mais
  óbvios a teste, por serem puros e cheios de casos de borda.
- **Sem OpenAPI/Swagger**, embora o ARCHITECTURE §7 afirme que existe.
- **Sem README**: quem clona o repo não tem instruções de subir (pnpm, migrate,
  bootstrap do admin, traineddata do Tesseract, `poppler-utils`).
- O índice parcial `provider_default_per_type` do §8 nunca foi criado (a
  unicidade do default é garantida só na transação de `routes.ts`).
