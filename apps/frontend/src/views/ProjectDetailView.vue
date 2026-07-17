<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { api, type Page } from '../api';
import { formatBytes, languageName, timeAgo } from '../lib/labels';
import StatusBadge from '../components/StatusBadge.vue';
import ProgressBar from '../components/ProgressBar.vue';
import EmptyState from '../components/EmptyState.vue';
import { useJobsStore } from '../stores/jobs';

const route = useRoute();
const projectId = computed(() => route.params.id as string);
const queryClient = useQueryClient();
const jobsStore = useJobsStore();

const project = useQuery({
  queryKey: ['project', projectId],
  queryFn: () => api.getProject(projectId.value),
});
const pages = useQuery({
  queryKey: ['pages', projectId],
  queryFn: () => api.listPages(projectId.value),
});
const providers = useQuery({ queryKey: ['providers'], queryFn: api.listProviders });

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
watch(
  () => providers.data.value,
  (p) => {
    const list = p?.translation ?? [];
    if (list.length && !list.some((t) => t.id === translator.value)) {
      translator.value = (list.find((t) => t.isDefault) ?? list[0]).id;
    }
  },
  { immediate: true },
);

const runningJobIds = ref<string[]>([]);
// Preservar regiões criadas/editadas à mão ao re-rodar o pipeline
const preserveManual = ref(true);
const run = useMutation({
  mutationFn: () =>
    api.run(projectId.value, {
      translationProviderId: translator.value,
      preserveManual: preserveManual.value,
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

const exportFormat = ref('pdf');
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

// --- Estado por página / revisão de textos --------------------------------

function pageState(p: Page): { label: string; tone: string } {
  if (!p.ocrRegions.length) return { label: 'Sem OCR', tone: 'bg-slate-500/15 text-slate-400' };
  if (p.renderedImageUrl) return { label: 'Traduzida', tone: 'bg-emerald-500/15 text-emerald-400' };
  return { label: 'Aguardando render', tone: 'bg-amber-500/15 text-amber-400' };
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

// Página cujos textos estão abertos para revisão rápida (null = fechado)
const reviewPageId = ref<string | null>(null);
const reviewPage = computed(
  () => pages.data.value?.find((p) => p.id === reviewPageId.value) ?? null,
);

const editing = ref<string | null>(null);
const editText = ref('');
const saveRegion = useMutation({
  mutationFn: ({ id, text }: { id: string; text: string }) =>
    api.updateRegion(id, { translatedText: text }),
  onSuccess: () => {
    editing.value = null;
    queryClient.invalidateQueries({ queryKey: ['pages', projectId] });
  },
});
</script>

<template>
  <div v-if="project.data.value">
    <!-- Cabeçalho -->
    <div class="mb-6">
      <RouterLink to="/projects" class="text-xs text-slate-500 hover:text-sky-400">
        ← Projetos
      </RouterLink>
      <div class="mt-1 flex flex-wrap items-center gap-3">
        <h2 class="text-2xl font-semibold">{{ project.data.value.name }}</h2>
        <StatusBadge :status="project.data.value.status" />
        <span class="text-sm text-slate-500">
          {{ languageName(project.data.value.sourceLanguage) }} →
          {{ languageName(project.data.value.targetLanguage) }}
        </span>
      </div>
    </div>

    <!-- Barra de ações: traduzir + exportar -->
    <div
      class="mb-6 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-slate-800 bg-slate-900/60 p-4"
    >
      <select
        v-model="translator"
        title="Provider de tradução"
        class="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
      >
        <option v-for="t in providers.data.value?.translation ?? []" :key="t.id" :value="t.id">
          {{ t.name }}
        </option>
      </select>
      <label
        class="flex cursor-pointer items-center gap-1.5 text-xs text-slate-400"
        title="Regiões que você criou ou editou no editor são mantidas; só as detecções automáticas são refeitas. Desmarque para refazer tudo do zero."
      >
        <input v-model="preserveManual" type="checkbox" class="accent-sky-500" />
        Manter minhas marcações
      </label>
      <button
        :disabled="run.isPending.value || running.length > 0 || !pages.data.value?.length"
        class="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium hover:bg-sky-500 disabled:opacity-50"
        :title="!pages.data.value?.length ? 'Envie arquivos primeiro' : ''"
        @click="run.mutate()"
      >
        {{ running.length > 0 ? 'Processando…' : 'Traduzir tudo' }}
      </button>
      <p v-if="run.error.value" class="text-xs text-rose-400">{{ run.error.value.message }}</p>

      <div class="ml-auto flex flex-wrap items-center gap-2">
        <span class="text-sm text-slate-400">Exportar</span>
        <select
          v-model="exportFormat"
          class="rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm"
        >
          <option value="pdf">PDF</option>
          <option value="cbz">CBZ</option>
          <option value="zip">ZIP (imagens)</option>
          <option value="txt">TXT (só texto)</option>
          <option value="markdown">Markdown</option>
        </select>
        <button
          :disabled="doExport.isPending.value || exporting !== null || !pages.data.value?.length"
          class="rounded-md border border-slate-700 px-3 py-1.5 text-sm hover:border-sky-600 disabled:opacity-50"
          @click="doExport.mutate()"
        >
          {{ exporting ? 'Exportando…' : 'Exportar' }}
        </button>
        <RouterLink
          v-if="pages.data.value?.length"
          :to="{ name: 'reader', params: { id: projectId } }"
          class="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:border-sky-600"
          :title="`Leitura contínua — ${translatedCount} de ${pages.data.value.length} página(s) traduzida(s)`"
        >
          Modo leitura
        </RouterLink>
      </div>
    </div>

    <!-- Progresso do pipeline -->
    <div v-if="running.length > 0" class="mb-6 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
      <div class="mb-1.5 flex justify-between text-xs text-slate-400">
        <span>Traduzindo {{ running.length }} página(s)…</span>
        <span>{{ overallProgress }}%</span>
      </div>
      <ProgressBar :progress="overallProgress" />
    </div>

    <!-- Downloads recentes -->
    <div v-if="exports.data.value?.length" class="mb-6 flex flex-wrap items-center gap-2">
      <span class="text-xs text-slate-500">Downloads:</span>
      <a
        v-for="e in exports.data.value.slice(0, 6)"
        :key="e.id"
        :href="e.downloadUrl"
        class="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-sky-400 hover:border-sky-600"
        :title="`Gerado ${timeAgo(e.createdAt)}`"
      >
        ⬇ {{ e.format.toUpperCase() }} · {{ formatBytes(e.sizeBytes) }}
      </a>
    </div>

    <!-- Dropzone -->
    <div
      class="mb-8 rounded-lg border-2 border-dashed p-6 text-center transition"
      :class="dragOver ? 'border-sky-500 bg-sky-500/5' : 'border-slate-700'"
      @dragover.prevent="dragOver = true"
      @dragleave="dragOver = false"
      @drop.prevent="onDrop"
    >
      <input
        ref="fileInput"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/tiff,application/pdf,.cbz,.zip"
        multiple
        class="hidden"
        @change="onFileChange"
      />
      <p class="text-sm text-slate-400">
        Arraste arquivos aqui ou
        <button class="text-sky-400 hover:underline" @click="fileInput?.click()">
          escolha no computador
        </button>
      </p>
      <p class="mt-1 text-xs text-slate-600">PNG, JPEG, WEBP, TIFF, PDF, CBZ ou ZIP</p>
      <p v-if="upload.isPending.value" class="mt-2 text-xs text-sky-400">Enviando…</p>
      <p v-if="upload.error.value" class="mt-2 text-xs text-rose-400">
        {{ upload.error.value.message }}
      </p>
    </div>

    <!-- Grade de páginas -->
    <template v-if="pages.data.value?.length">
      <h3 class="mb-3 text-lg font-medium">Páginas</h3>
      <div class="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        <div
          v-for="(page, idx) in pages.data.value"
          :key="page.id"
          class="group overflow-hidden rounded-lg border border-slate-800 bg-slate-900/60 transition hover:border-sky-800"
        >
          <RouterLink
            :to="{ name: 'page-editor', params: { id: projectId, pageId: page.id } }"
            title="Abrir no editor"
          >
            <div class="relative aspect-3/4 overflow-hidden bg-slate-950">
              <img
                :src="page.renderedImageUrl ?? page.sourceImageUrl"
                class="h-full w-full object-cover object-top transition group-hover:scale-[1.02]"
                loading="lazy"
              />
              <span
                class="absolute left-2 top-2 rounded-full px-2 py-0.5 text-[11px]"
                :class="pageState(page).tone"
              >
                {{ pageState(page).label }}
              </span>
            </div>
          </RouterLink>
          <div class="flex items-center justify-between px-2.5 py-2 text-xs">
            <span class="flex items-center gap-1 text-slate-400">
              <button
                class="rounded px-1 text-slate-600 opacity-0 transition hover:bg-slate-800 hover:text-slate-200 group-hover:opacity-100 disabled:invisible"
                :disabled="idx === 0 || reorder.isPending.value"
                title="Mover para antes"
                @click="movePage(page.id, -1)"
              >
                ◀
              </button>
              Página {{ idx + 1 }}
              <button
                class="rounded px-1 text-slate-600 opacity-0 transition hover:bg-slate-800 hover:text-slate-200 group-hover:opacity-100 disabled:invisible"
                :disabled="idx === (pages.data.value?.length ?? 0) - 1 || reorder.isPending.value"
                title="Mover para depois"
                @click="movePage(page.id, 1)"
              >
                ▶
              </button>
            </span>
            <button
              v-if="page.ocrRegions.length"
              class="text-sky-400 hover:underline"
              @click="reviewPageId = reviewPageId === page.id ? null : page.id"
            >
              {{ reviewPageId === page.id ? 'fechar textos' : `${page.ocrRegions.length} textos` }}
            </button>
            <span v-else class="text-slate-600">sem textos</span>
          </div>
        </div>
      </div>

      <!-- Revisão rápida de textos da página selecionada -->
      <div
        v-if="reviewPage"
        class="mb-8 rounded-lg border border-slate-800 bg-slate-900/60 p-4"
      >
        <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 class="text-sm font-medium">
            Textos da página {{ reviewPage.order + 1 }}
            <span class="ml-2 text-xs font-normal text-slate-500">
              clique numa tradução para corrigir
            </span>
          </h3>
          <RouterLink
            :to="{ name: 'page-editor', params: { id: projectId, pageId: reviewPage.id } }"
            class="text-xs text-sky-400 hover:underline"
          >
            Abrir no editor visual →
          </RouterLink>
        </div>
        <div class="overflow-x-auto">
        <table class="w-full min-w-lg text-sm">
          <thead>
            <tr class="border-b border-slate-800 text-left text-xs text-slate-500">
              <th class="py-2 pr-4 font-normal">Original</th>
              <th class="py-2 pr-4 font-normal">Tradução</th>
              <th class="py-2 font-normal">Confiança</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="r in reviewPage.ocrRegions"
              :key="r.id"
              class="border-b border-slate-800/50 align-top"
            >
              <td class="py-2 pr-4 text-slate-300">{{ r.sourceText }}</td>
              <td class="py-2 pr-4">
                <div v-if="editing === r.id" class="flex gap-2">
                  <input
                    v-model="editText"
                    class="flex-1 rounded border border-sky-600 bg-slate-950 px-2 py-1"
                    autofocus
                    @keyup.enter="saveRegion.mutate({ id: r.id, text: editText })"
                    @keyup.esc="editing = null"
                  />
                  <button
                    class="text-xs text-sky-400"
                    :disabled="saveRegion.isPending.value"
                    @click="saveRegion.mutate({ id: r.id, text: editText })"
                  >
                    salvar
                  </button>
                </div>
                <button
                  v-else
                  class="text-left hover:text-sky-300"
                  :class="r.translatedText ? '' : 'italic text-slate-600'"
                  @click="
                    editing = r.id;
                    editText = r.translatedText ?? '';
                  "
                >
                  {{ r.translatedText ?? 'sem tradução' }}
                </button>
              </td>
              <td class="py-2 text-xs text-slate-500">{{ (r.confidence * 100).toFixed(0) }}%</td>
            </tr>
          </tbody>
        </table>
        </div>
      </div>
    </template>

    <EmptyState
      v-else-if="pages.isSuccess.value"
      title="Nenhuma página ainda"
      hint="Envie imagens, um PDF ou um CBZ/ZIP na área acima — as páginas aparecem aqui."
    />
  </div>
  <p v-else-if="project.isError.value" class="text-rose-400">
    {{ project.error.value?.message }}
  </p>
  <p v-else class="text-slate-500">Carregando…</p>
</template>
