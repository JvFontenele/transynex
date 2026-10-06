<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import {
  ArrowLeftIcon,
  BookOpenIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  LanguagesIcon,
  PencilLineIcon,
  UploadIcon,
} from '@lucide/vue';
import { api, type Page } from '@/api';
import {
  formatBytes,
  languageName,
  PROJECT_KIND_LABELS,
  timeAgo,
  type StatusVariant,
} from '@/lib/labels';
import { cn } from '@/lib/utils';
import StatusBadge from '@/components/StatusBadge.vue';
import EmptyState from '@/components/EmptyState.vue';
import DocumentTextPanel from '@/components/DocumentTextPanel.vue';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { useAuthStore } from '@/stores/auth';
import { useJobsStore } from '@/stores/jobs';

const route = useRoute();
const projectId = computed(() => route.params.id as string);
const queryClient = useQueryClient();
const jobsStore = useJobsStore();
const auth = useAuthStore();

const project = useQuery({
  queryKey: ['project', projectId],
  queryFn: () => api.getProject(projectId.value),
});
// Projeto de documento: o conteúdo são parágrafos, não páginas renderizadas.
const isDocument = computed(() => project.data.value?.kind === 'DOCUMENT');
const pages = useQuery({
  queryKey: ['pages', projectId],
  queryFn: () => api.listPages(projectId.value),
});
const blocks = useQuery({
  queryKey: ['blocks', projectId],
  queryFn: () => api.listBlocks(projectId.value),
  enabled: isDocument,
});
const providers = useQuery({ queryKey: ['providers'], queryFn: api.listProviders });

const hasEpub = computed(
  () => project.data.value?.sourceFiles?.some((f) => f.mimeType === 'application/epub+zip') ?? false,
);

// "Tem o que traduzir?" — páginas no fluxo de imagem, parágrafos no de documento.
const hasContent = computed(() =>
  isDocument.value ? (blocks.data.value?.length ?? 0) > 0 : (pages.data.value?.length ?? 0) > 0,
);

// --- Upload (input + arrastar e soltar) -----------------------------------

const fileInput = ref<HTMLInputElement>();
const dragOver = ref(false);

const upload = useMutation({
  mutationFn: (file: File) => api.upload(projectId.value, file),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pages', projectId] }),
});

function sendFiles(files: FileList | File[]) {
  [...files].forEach((f) => upload.mutate(f));
}

function onFileChange(e: Event) {
  const files = (e.target as HTMLInputElement).files;
  if (files) sendFiles(files);
  if (fileInput.value) fileInput.value.value = '';
}

function onDrop(e: DragEvent) {
  dragOver.value = false;
  if (e.dataTransfer?.files.length) sendFiles(e.dataTransfer.files);
}

// --- Pipeline (traduzir) --------------------------------------------------

const translator = ref('libretranslate');
const ocr = ref('');
watch(
  () => providers.data.value,
  (p) => {
    const list = p?.translation ?? [];
    if (list.length && !list.some((t) => t.id === translator.value)) {
      translator.value = (list.find((t) => t.isDefault) ?? list[0]).id;
    }
    const ocrs = p?.ocr ?? [];
    if (ocrs.length && !ocrs.some((o) => o.id === ocr.value)) {
      ocr.value = (ocrs.find((o) => o.isDefault) ?? ocrs[0]).id;
    }
  },
  { immediate: true },
);

const runningJobIds = ref<string[]>([]);
// Preservar regiões criadas/editadas à mão ao re-rodar o pipeline
const preserveManual = ref(true);
// Documento: por padrão só traduz o que falta; marcar refaz tudo.
const retranslate = ref(false);
const run = useMutation({
  mutationFn: () =>
    api.run(projectId.value, {
      ocrProviderId: ocr.value || undefined,
      translationProviderId: translator.value,
      preserveManual: preserveManual.value,
      retranslate: retranslate.value,
    }),
  onSuccess: (data) => (runningJobIds.value = data.jobIds),
});

// Recarrega as páginas quando qualquer job termina (run, extração de
// PDF/CBZ…). O snapshot vem sempre do banco; o evento só dispara o refetch.
let seenCompleted = 0;
jobsStore.$subscribe(() => {
  const completed = Object.values(jobsStore.live).filter(
    (j) => j.status === 'completed' || j.status === 'failed',
  ).length;
  if (completed > seenCompleted) {
    seenCompleted = completed;
    queryClient.invalidateQueries({ queryKey: ['pages', projectId] });
    queryClient.invalidateQueries({ queryKey: ['blocks', projectId] });
    queryClient.invalidateQueries({ queryKey: ['project', projectId] });
  }
  const done = runningJobIds.value.filter(
    (id) => jobsStore.live[id]?.status === 'completed' || jobsStore.live[id]?.status === 'failed',
  );
  if (done.length > 0 && done.length === runningJobIds.value.length) {
    runningJobIds.value = [];
  }
});

const running = computed(() =>
  runningJobIds.value.map((id) => jobsStore.live[id]).filter(Boolean),
);
const overallProgress = computed(() => {
  if (!running.value.length) return 0;
  return Math.round(
    running.value.reduce((sum, j) => sum + j.progress, 0) / running.value.length,
  );
});

// --- Exportação -----------------------------------------------------------

const exportFormats = computed(() =>
  isDocument.value
    ? [
        ...(hasEpub.value ? [{ value: 'epub', label: 'EPUB traduzido' }] : []),
        { value: 'txt', label: 'TXT' },
        { value: 'markdown', label: 'Markdown' },
      ]
    : [
        { value: 'pdf', label: 'PDF' },
        { value: 'cbz', label: 'CBZ' },
        { value: 'zip', label: 'ZIP (imagens)' },
        { value: 'txt', label: 'TXT (só texto)' },
        { value: 'markdown', label: 'Markdown' },
      ],
);
const exportFormat = ref('pdf');
// Formato padrão = o primeiro válido para o tipo do projeto
watch(exportFormats, (list) => {
  if (!list.some((f) => f.value === exportFormat.value)) exportFormat.value = list[0]!.value;
}, { immediate: true });
const exports = useQuery({
  queryKey: ['exports', projectId],
  queryFn: () => api.listExports(projectId.value),
});
const exporting = ref<string | null>(null);
const doExport = useMutation({
  mutationFn: () => api.exportProject(projectId.value, exportFormat.value),
  onSuccess: (data) => (exporting.value = data.jobId),
});
jobsStore.$subscribe(() => {
  if (exporting.value && jobsStore.live[exporting.value]?.status === 'completed') {
    exporting.value = null;
    queryClient.invalidateQueries({ queryKey: ['exports', projectId] });
  }
});

// --- Estado por página -----------------------------------------------------

function pageState(p: Page): { label: string; variant: StatusVariant } {
  if (!p.ocrRegions.length) return { label: 'Sem OCR', variant: 'secondary' };
  if (p.reviewedAt) return { label: 'Revisada', variant: 'success' };
  if (p.renderedImageUrl) return { label: 'Traduzida', variant: 'info' };
  return { label: 'Aguardando render', variant: 'warning' };
}

// Reordenação: move a página uma posição e envia a lista completa na nova ordem
const reorder = useMutation({
  mutationFn: (pageIds: string[]) => api.reorderPages(projectId.value, pageIds),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pages', projectId] }),
});

function movePage(pageId: string, delta: -1 | 1) {
  const list = pages.data.value;
  if (!list || reorder.isPending.value) return;
  const ids = list.map((p) => p.id);
  const from = ids.indexOf(pageId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= ids.length) return;
  [ids[from], ids[to]] = [ids[to], ids[from]];
  reorder.mutate(ids);
}

const translatedCount = computed(
  () => pages.data.value?.filter((p) => p.renderedImageUrl).length ?? 0,
);

</script>

<template>
  <div v-if="project.data.value" class="flex flex-col gap-6">
    <!-- Cabeçalho -->
    <div class="flex flex-col gap-2">
      <Button variant="ghost" size="sm" as-child class="-ml-2 w-fit text-muted-foreground">
        <RouterLink to="/projects">
          <ArrowLeftIcon data-icon="inline-start" />
          Projetos
        </RouterLink>
      </Button>
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="flex min-w-0 flex-col gap-2">
          <h1 class="text-2xl font-semibold tracking-tight break-words">
            {{ project.data.value.name }}
          </h1>
          <div class="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <StatusBadge :status="project.data.value.status" />
            <Badge
              variant="outline"
              :title="
                isDocument
                  ? 'Tradução em texto corrido a partir do texto do arquivo'
                  : 'Tradução desenhada de volta na página'
              "
            >
              {{ PROJECT_KIND_LABELS[project.data.value.kind] ?? project.data.value.kind }}
            </Badge>
            <span>
              {{ languageName(project.data.value.sourceLanguage) }} →
              {{ languageName(project.data.value.targetLanguage) }}
            </span>
          </div>
        </div>
        <div class="flex flex-wrap gap-2">
          <Button v-if="isDocument && hasContent" variant="outline" as-child>
            <RouterLink
              :to="{ name: hasEpub ? 'book-reader' : 'document-reader', params: { id: projectId } }"
              :title="
                hasEpub
                  ? 'Ler o livro com a tradução aplicada'
                  : 'Ler a tradução em texto corrido (com opção de ver o original ao lado)'
              "
            >
              <BookOpenIcon data-icon="inline-start" />
              Ler tradução
            </RouterLink>
          </Button>
          <Button v-else-if="!isDocument && pages.data.value?.length" variant="outline" as-child>
            <RouterLink
              :to="{ name: 'reader', params: { id: projectId } }"
              :title="`Leitura contínua — ${translatedCount} de ${pages.data.value.length} página(s) traduzida(s)`"
            >
              <BookOpenIcon data-icon="inline-start" />
              Modo leitura
            </RouterLink>
          </Button>
          <Button v-if="auth.canEdit && hasContent" variant="outline" as-child>
            <RouterLink
              :to="{
                name: isDocument ? 'document-reader' : 'reader',
                params: { id: projectId },
                query: { review: '1' },
              }"
              title="Ler e corrigir a tradução direto no leitor"
            >
              <PencilLineIcon data-icon="inline-start" />
              Revisar
            </RouterLink>
          </Button>
          <!-- span carrega o title: botão desabilitado não recebe hover -->
          <span
            class="inline-flex"
            :title="
              hasContent
                ? ''
                : isDocument
                  ? 'Envie um PDF e aguarde a extração do texto'
                  : 'Envie arquivos primeiro'
            "
          >
            <Button
              :disabled="run.isPending.value || running.length > 0 || !hasContent"
              @click="run.mutate()"
            >
              <Spinner v-if="run.isPending.value || running.length > 0" data-icon="inline-start" />
              <LanguagesIcon v-else data-icon="inline-start" />
              {{
                running.length > 0
                  ? 'Processando…'
                  : isDocument
                    ? 'Traduzir documento'
                    : 'Traduzir tudo'
              }}
            </Button>
          </span>
        </div>
      </div>
    </div>

    <!-- Tradução + exportação -->
    <div class="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Tradução</CardTitle>
          <CardDescription>Provider e opções usados ao traduzir.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field v-if="!isDocument">
              <FieldLabel for="ocr">OCR</FieldLabel>
              <Select v-model="ocr">
                <SelectTrigger id="ocr" class="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem v-for="o in providers.data.value?.ocr ?? []" :key="o.id" :value="o.id">
                      {{ o.name }}
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel for="translator">Provider de tradução</FieldLabel>
              <Select v-model="translator">
                <SelectTrigger id="translator" class="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem
                      v-for="t in providers.data.value?.translation ?? []"
                      :key="t.id"
                      :value="t.id"
                    >
                      {{ t.name }}
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field
              v-if="!isDocument"
              orientation="horizontal"
              title="Regiões que você criou ou editou no editor são mantidas; só as detecções automáticas são refeitas. Desmarque para refazer tudo do zero."
            >
              <Checkbox id="preserve-manual" v-model="preserveManual" />
              <FieldLabel for="preserve-manual" class="font-normal">
                Manter minhas marcações
              </FieldLabel>
            </Field>
            <Field
              v-else
              orientation="horizontal"
              title="Por padrão só os parágrafos ainda sem tradução são enviados ao provider. Marque para descartar as traduções atuais e refazer o documento inteiro."
            >
              <Checkbox id="retranslate" v-model="retranslate" />
              <FieldLabel for="retranslate" class="font-normal">
                Refazer traduções existentes
              </FieldLabel>
            </Field>
            <!-- Progresso do pipeline -->
            <div v-if="running.length > 0" class="flex flex-col gap-2">
              <div class="flex justify-between text-sm text-muted-foreground">
                <span v-if="isDocument">Traduzindo {{ running.length }} arquivo(s)…</span>
                <span v-else>Traduzindo {{ running.length }} página(s)…</span>
                <span class="tabular-nums">{{ overallProgress }}%</span>
              </div>
              <Progress :model-value="overallProgress" />
            </div>
            <p v-if="run.error.value" class="text-sm text-destructive">
              {{ run.error.value.message }}
            </p>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Exportação</CardTitle>
          <CardDescription>Gere o arquivo final e baixe as exportações recentes.</CardDescription>
        </CardHeader>
        <CardContent class="flex flex-col gap-4">
          <Field>
            <FieldLabel for="export-format">Formato</FieldLabel>
            <div class="flex gap-2">
              <Select v-model="exportFormat">
                <SelectTrigger id="export-format" class="min-w-0 flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem v-for="f in exportFormats" :key="f.value" :value="f.value">
                      {{ f.label }}
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                :disabled="doExport.isPending.value || exporting !== null || !hasContent"
                @click="doExport.mutate()"
              >
                <Spinner v-if="exporting" data-icon="inline-start" />
                {{ exporting ? 'Exportando…' : 'Exportar' }}
              </Button>
            </div>
          </Field>

          <!-- Downloads recentes -->
          <div v-if="exports.data.value?.length" class="flex flex-col gap-2">
            <p class="text-xs font-medium text-muted-foreground">Downloads</p>
            <div class="flex flex-wrap gap-2">
              <Button
                v-for="e in exports.data.value.slice(0, 6)"
                :key="e.id"
                variant="secondary"
                size="sm"
                as-child
              >
                <a :href="e.downloadUrl" :title="`Gerado ${timeAgo(e.createdAt)}`">
                  <DownloadIcon data-icon="inline-start" />
                  {{ e.format.toUpperCase() }} · {{ formatBytes(e.sizeBytes) }}
                </a>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>

    <!-- Dropzone -->
    <div
      :class="
        cn(
          'flex flex-col items-center gap-1 rounded-xl border-2 border-dashed p-6 text-center transition-colors',
          dragOver && 'border-primary bg-muted/50',
        )
      "
      @dragover.prevent="dragOver = true"
      @dragleave="dragOver = false"
      @drop.prevent="onDrop"
    >
      <input
        ref="fileInput"
        type="file"
        :accept="
          isDocument
            ? 'application/pdf,.epub,image/png,image/jpeg,image/webp,image/tiff'
            : 'image/png,image/jpeg,image/webp,image/tiff,application/pdf,.cbz,.zip'
        "
        multiple
        class="hidden"
        @change="onFileChange"
      />
      <UploadIcon class="mb-1 size-5 text-muted-foreground" />
      <p class="text-sm text-muted-foreground">
        Arraste arquivos aqui ou
        <Button variant="link" class="h-auto p-0" @click="fileInput?.click()">
          escolha no computador
        </Button>
      </p>
      <p v-if="isDocument" class="text-xs text-muted-foreground">
        PDF (com texto ou escaneado) ou EPUB. PDF sem camada de texto passa por OCR automaticamente.
      </p>
      <p v-else class="text-xs text-muted-foreground">PNG, JPEG, WEBP, TIFF, PDF, CBZ ou ZIP</p>
      <p
        v-if="upload.isPending.value"
        class="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"
      >
        <Spinner class="size-3" />
        Enviando…
      </p>
      <p v-if="upload.error.value" class="mt-1 text-xs text-destructive">
        {{ upload.error.value.message }}
      </p>
    </div>

    <!-- Documento: parágrafos extraídos, sem grade de páginas -->
    <DocumentTextPanel
      v-if="isDocument"
      :project-id="projectId"
      :blocks="blocks.data.value ?? []"
      :loading="blocks.isLoading.value"
    />

    <!-- Grade de páginas -->
    <template v-else-if="pages.data.value?.length">
      <Card>
        <CardHeader>
          <CardTitle>Páginas</CardTitle>
          <CardDescription>
            {{ translatedCount }} de {{ pages.data.value.length }} traduzida(s)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            <div
              v-for="(page, idx) in pages.data.value"
              :key="page.id"
              class="group flex flex-col overflow-hidden rounded-lg border bg-background transition-colors hover:border-ring"
            >
              <RouterLink
                :to="{ name: 'page-editor', params: { id: projectId, pageId: page.id } }"
                title="Abrir no editor"
              >
                <div class="relative aspect-3/4 overflow-hidden bg-muted">
                  <img
                    :src="page.renderedImageUrl ?? page.sourceImageUrl"
                    :alt="`Página ${idx + 1}`"
                    class="size-full object-cover object-top transition-transform group-hover:scale-[1.02]"
                    loading="lazy"
                  />
                  <span class="absolute top-2 left-2 rounded-4xl bg-background/90 shadow-sm">
                    <Badge :variant="pageState(page).variant">{{ pageState(page).label }}</Badge>
                  </span>
                </div>
              </RouterLink>
              <div class="flex flex-wrap items-center justify-between gap-1 px-1.5 py-1.5 text-xs">
                <span class="flex items-center gap-0.5 text-muted-foreground">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    class="disabled:invisible sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                    :disabled="idx === 0 || reorder.isPending.value"
                    title="Mover para antes"
                    aria-label="Mover para antes"
                    @click="movePage(page.id, -1)"
                  >
                    <ChevronLeftIcon />
                  </Button>
                  <span class="whitespace-nowrap">Página {{ idx + 1 }}</span>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    class="disabled:invisible sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                    :disabled="idx === (pages.data.value?.length ?? 0) - 1 || reorder.isPending.value"
                    title="Mover para depois"
                    aria-label="Mover para depois"
                    @click="movePage(page.id, 1)"
                  >
                    <ChevronRightIcon />
                  </Button>
                </span>
                <Button
                  v-if="page.ocrRegions.length && auth.canEdit"
                  variant="link"
                  size="xs"
                  class="h-auto px-1"
                  as-child
                >
                  <RouterLink
                    :to="{ name: 'reader', params: { id: projectId }, query: { review: '1', page: idx } }"
                  >
                    revisar
                  </RouterLink>
                </Button>
                <span v-else-if="!page.ocrRegions.length" class="px-1 text-muted-foreground">
                  sem textos
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

    </template>

    <EmptyState
      v-else-if="pages.isSuccess.value"
      title="Nenhuma página ainda"
      hint="Envie imagens, um PDF ou um CBZ/ZIP na área acima — as páginas aparecem aqui."
    />
  </div>
  <Alert v-else-if="project.isError.value" variant="destructive">
    <AlertTitle>Não foi possível carregar o projeto</AlertTitle>
    <AlertDescription>{{ project.error.value?.message }}</AlertDescription>
  </Alert>
  <div v-else class="flex flex-col gap-6" aria-busy="true">
    <span class="sr-only">Carregando…</span>
    <div class="flex flex-col gap-2">
      <Skeleton class="h-4 w-20" />
      <Skeleton class="h-8 w-64 max-w-full" />
      <Skeleton class="h-5 w-48" />
    </div>
    <div class="grid gap-6 lg:grid-cols-2">
      <Skeleton class="h-48 rounded-xl" />
      <Skeleton class="h-48 rounded-xl" />
    </div>
    <Skeleton class="h-28 rounded-xl" />
  </div>
</template>
