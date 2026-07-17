<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { api, downloadUrl, fileUrl } from '../api';
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

const translator = ref('libretranslate');
const fileInput = ref<HTMLInputElement>();

const upload = useMutation({
  mutationFn: (file: File) => api.upload(projectId.value, file),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pages', projectId] }),
});

function onFileChange(e: Event) {
  const files = (e.target as HTMLInputElement).files;
  if (files) [...files].forEach((f) => upload.mutate(f));
  if (fileInput.value) fileInput.value.value = '';
}

const runningJobIds = ref<string[]>([]);
const run = useMutation({
  mutationFn: () => api.run(projectId.value, { translationProviderId: translator.value }),
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

// Exportação
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

// Edição inline de tradução (etapa de correção)
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
    <div class="mb-6 flex items-center justify-between">
      <div>
        <h2 class="text-2xl font-semibold">{{ project.data.value.name }}</h2>
        <p class="text-sm text-slate-500">
          {{ project.data.value.sourceLanguage }} → {{ project.data.value.targetLanguage }}
        </p>
      </div>
      <div class="flex items-center gap-3">
        <select
          v-model="translator"
          class="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
        >
          <option
            v-for="t in providers.data.value?.translation ?? []"
            :key="t.id"
            :value="t.id"
          >
            {{ t.name }}
          </option>
        </select>
        <button
          :disabled="run.isPending.value || running.length > 0 || !pages.data.value?.length"
          class="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium hover:bg-sky-500 disabled:opacity-50"
          @click="run.mutate()"
        >
          {{ running.length > 0 ? 'Processando…' : 'Traduzir' }}
        </button>
      </div>
    </div>

    <div v-if="running.length > 0" class="mb-6 space-y-2">
      <div
        v-for="(j, i) in running"
        :key="i"
        class="rounded-lg border border-slate-800 bg-slate-900/60 p-3"
      >
        <div class="mb-1 flex justify-between text-xs text-slate-400">
          <span>Página {{ i + 1 }}</span>
          <span>{{ j.progress }}%</span>
        </div>
        <div class="h-1.5 rounded bg-slate-800">
          <div
            class="h-1.5 rounded bg-sky-500 transition-all"
            :style="{ width: `${j.progress}%` }"
          />
        </div>
      </div>
    </div>

    <div class="mb-8 rounded-lg border border-dashed border-slate-700 p-6 text-center">
      <input
        ref="fileInput"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/tiff,application/pdf,.cbz,.zip"
        multiple
        class="hidden"
        @change="onFileChange"
      />
      <button class="text-sm text-sky-400 hover:underline" @click="fileInput?.click()">
        Enviar arquivos (PNG, JPEG, WEBP, TIFF, PDF, CBZ, ZIP)
      </button>
      <p v-if="upload.isPending.value" class="mt-2 text-xs text-slate-500">Enviando…</p>
      <p v-if="upload.error.value" class="mt-2 text-xs text-rose-400">
        {{ upload.error.value.message }}
      </p>
    </div>

    <div
      class="mb-8 flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/60 p-4"
    >
      <span class="text-sm text-slate-400">Exportar como</span>
      <select
        v-model="exportFormat"
        class="rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm"
      >
        <option value="pdf">PDF</option>
        <option value="cbz">CBZ</option>
        <option value="zip">ZIP</option>
        <option value="txt">TXT</option>
        <option value="markdown">Markdown</option>
      </select>
      <button
        :disabled="doExport.isPending.value || exporting !== null || !pages.data.value?.length"
        class="rounded-md bg-slate-700 px-3 py-1.5 text-sm hover:bg-slate-600 disabled:opacity-50"
        @click="doExport.mutate()"
      >
        {{ exporting ? 'Exportando…' : 'Exportar' }}
      </button>
      <div class="ml-auto flex gap-2">
        <a
          v-for="e in exports.data.value?.slice(0, 5)"
          :key="e.id"
          :href="downloadUrl(e.id)"
          class="rounded-md border border-slate-700 px-2 py-1 text-xs text-sky-400 hover:border-sky-600"
        >
          ⬇ {{ e.format }} ({{ (e.sizeBytes / 1024).toFixed(0) }} KB)
        </a>
      </div>
    </div>

    <div v-for="page in pages.data.value" :key="page.id" class="mb-6">
      <h3 class="mb-2 text-sm font-medium text-slate-400">Página {{ page.order + 1 }}</h3>
      <div class="mb-3 flex gap-4">
        <figure class="w-1/2">
          <img
            :src="fileUrl(page.sourceImageRef)"
            class="w-full rounded-lg border border-slate-800"
            loading="lazy"
          />
          <figcaption class="mt-1 text-center text-xs text-slate-600">Original</figcaption>
        </figure>
        <figure v-if="page.renderedImageRef" class="w-1/2">
          <img
            :src="fileUrl(page.renderedImageRef)"
            class="w-full rounded-lg border border-slate-800"
            loading="lazy"
          />
          <figcaption class="mt-1 text-center text-xs text-slate-600">Traduzida</figcaption>
        </figure>
      </div>
      <table v-if="page.ocrRegions.length" class="w-full text-sm">
        <thead>
          <tr class="border-b border-slate-800 text-left text-xs text-slate-500">
            <th class="py-2 pr-4 font-normal">Original</th>
            <th class="py-2 pr-4 font-normal">Tradução (clique para editar)</th>
            <th class="py-2 font-normal">Confiança</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="r in page.ocrRegions"
            :key="r.id"
            class="border-b border-slate-800/50 align-top"
          >
            <td class="py-2 pr-4 text-slate-300">{{ r.sourceText }}</td>
            <td class="py-2 pr-4">
              <div v-if="editing === r.id" class="flex gap-2">
                <input
                  v-model="editText"
                  class="flex-1 rounded border border-sky-600 bg-slate-950 px-2 py-1"
                  @keyup.enter="saveRegion.mutate({ id: r.id, text: editText })"
                  @keyup.esc="editing = null"
                />
                <button
                  class="text-xs text-sky-400"
                  @click="saveRegion.mutate({ id: r.id, text: editText })"
                >
                  salvar
                </button>
              </div>
              <button
                v-else
                class="text-left hover:text-sky-300"
                :class="r.translatedText ? '' : 'text-slate-600 italic'"
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
      <p v-else class="text-xs text-slate-600">Sem OCR ainda — clique em Traduzir.</p>
    </div>
    <p v-if="pages.isSuccess.value && !pages.data.value?.length" class="text-slate-500">
      Nenhuma página — envie imagens acima.
    </p>
  </div>
</template>
