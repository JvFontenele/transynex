<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useQuery } from '@tanstack/vue-query';
import { api, type DocumentBlock } from '../api';
import { languageName } from '../lib/labels';
import EmptyState from '../components/EmptyState.vue';

// Leitor de documento: os parágrafos traduzidos em texto corrido, sem imagem.
// Modo bilíngue põe o original ao lado para revisão.
const route = useRoute();
const projectId = computed(() => route.params.id as string);

const project = useQuery({
  queryKey: ['project', projectId],
  queryFn: () => api.getProject(projectId.value),
});
const blocks = useQuery({
  queryKey: ['blocks', projectId],
  queryFn: () => api.listBlocks(projectId.value),
  // Enquanto faltar tradução, provavelmente há job rodando: atualiza sozinho.
  refetchInterval: (query) =>
    (query.state.data as DocumentBlock[] | undefined)?.some((b) => b.translatedText === null)
      ? 5000
      : false,
});

const total = computed(() => blocks.data.value?.length ?? 0);
const translatedCount = computed(
  () => blocks.data.value?.filter((b) => b.translatedText !== null).length ?? 0,
);
// Marca a troca de página do arquivo original para servir de referência.
const entries = computed(() =>
  (blocks.data.value ?? []).map((block, i, all) => ({
    block,
    startsPage: i === 0 || all[i - 1].pageNumber !== block.pageNumber,
  })),
);

const bilingual = ref(localStorage.getItem('doc-reader-bilingual') === '1');
function toggleBilingual() {
  bilingual.value = !bilingual.value;
  localStorage.setItem('doc-reader-bilingual', bilingual.value ? '1' : '0');
}

const WIDTHS = [
  { key: 'narrow', label: 'Estreito', class: 'max-w-2xl' },
  { key: 'normal', label: 'Normal', class: 'max-w-3xl' },
  { key: 'wide', label: 'Largo', class: 'max-w-5xl' },
] as const;
const width = ref(localStorage.getItem('doc-reader-width') ?? 'normal');
function setWidth(key: string) {
  width.value = key;
  localStorage.setItem('doc-reader-width', key);
}
// No modo bilíngue as duas colunas precisam de mais espaço que a largura escolhida.
const widthClass = computed(() => {
  if (bilingual.value) return 'max-w-6xl';
  return WIDTHS.find((w) => w.key === width.value)?.class ?? 'max-w-3xl';
});

// Copiar a tradução inteira: o caso de uso mais comum antes de existir export.
const copied = ref(false);
async function copyTranslation() {
  const text = (blocks.data.value ?? [])
    .map((b) => b.translatedText ?? b.sourceText)
    .join('\n\n');
  await navigator.clipboard.writeText(text);
  copied.value = true;
  setTimeout(() => (copied.value = false), 2000);
}
</script>

<template>
  <div class="min-h-screen">
    <header
      class="sticky top-0 z-20 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-800 bg-slate-950/90 px-4 py-2.5 backdrop-blur"
    >
      <RouterLink
        :to="{ name: 'project-detail', params: { id: projectId } }"
        class="text-sm text-sky-400 hover:underline"
      >
        ← Voltar ao projeto
      </RouterLink>
      <h2 class="truncate text-sm font-medium text-slate-300">
        {{ project.data.value?.name ?? '…' }}
      </h2>
      <span v-if="total" class="text-xs text-slate-500">
        {{ translatedCount }} de {{ total }} parágrafo(s) traduzido(s)
      </span>

      <div class="ml-auto flex flex-wrap items-center gap-1">
        <button
          class="rounded-md border px-2.5 py-1 text-xs transition"
          :class="
            bilingual
              ? 'border-sky-600 bg-sky-600/15 text-sky-300'
              : 'border-slate-700 text-slate-400 hover:border-slate-500'
          "
          :title="
            bilingual
              ? 'Mostrando original e tradução'
              : 'Mostrar o original ao lado da tradução'
          "
          @click="toggleBilingual"
        >
          Bilíngue
        </button>
        <button
          v-for="w in WIDTHS"
          :key="w.key"
          class="rounded-md border px-2.5 py-1 text-xs transition disabled:opacity-40"
          :class="
            width === w.key && !bilingual
              ? 'border-sky-600 bg-sky-600/15 text-sky-300'
              : 'border-slate-700 text-slate-400 hover:border-slate-500'
          "
          :disabled="bilingual"
          title="Largura de leitura (indisponível no modo bilíngue)"
          @click="setWidth(w.key)"
        >
          {{ w.label }}
        </button>
        <button
          v-if="total"
          class="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-400 transition hover:border-sky-600"
          @click="copyTranslation"
        >
          {{ copied ? 'Copiado ✓' : 'Copiar tradução' }}
        </button>
      </div>
    </header>

    <div v-if="total" class="mx-auto px-4 py-8" :class="widthClass">
      <p v-if="project.data.value" class="mb-6 text-xs text-slate-600">
        {{ languageName(project.data.value.sourceLanguage) }} →
        {{ languageName(project.data.value.targetLanguage) }}
      </p>

      <template v-for="{ block, startsPage } in entries" :key="block.id">
        <p
          v-if="startsPage"
          class="mb-4 mt-8 flex items-center gap-3 text-[11px] uppercase tracking-wide text-slate-600 first:mt-0"
        >
          <span class="h-px flex-1 bg-slate-800" />
          página {{ block.pageNumber }}
          <span class="h-px flex-1 bg-slate-800" />
        </p>

        <!-- Bilíngue: original à esquerda, tradução à direita -->
        <div v-if="bilingual" class="mb-5 grid gap-x-8 gap-y-1 sm:grid-cols-2">
          <p class="text-[15px] leading-relaxed text-slate-500">{{ block.sourceText }}</p>
          <p
            class="text-[15px] leading-relaxed"
            :class="block.translatedText ? 'text-slate-200' : 'italic text-slate-600'"
          >
            {{ block.translatedText ?? 'sem tradução ainda' }}
          </p>
        </div>

        <!-- Só tradução: parágrafos sem tradução caem no original, marcados -->
        <p
          v-else
          class="mb-5 text-[17px] leading-relaxed"
          :class="block.translatedText ? 'text-slate-200' : 'text-slate-500'"
        >
          {{ block.translatedText ?? block.sourceText }}
          <span
            v-if="!block.translatedText"
            class="ml-1 align-middle text-[11px] text-amber-500/80"
            title="Este parágrafo ainda não foi traduzido — exibindo o original"
          >
            (original)
          </span>
        </p>
      </template>

      <p class="py-8 text-center text-sm text-slate-600">
        Fim · {{ total }} parágrafo(s)
      </p>
    </div>

    <div v-else-if="blocks.isSuccess.value" class="mx-auto max-w-xl py-16">
      <EmptyState
        title="Nenhum texto extraído ainda"
        hint="Envie um PDF no projeto — o texto aparece aqui em leitura corrida assim que a extração terminar."
      >
        <RouterLink
          :to="{ name: 'project-detail', params: { id: projectId } }"
          class="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium hover:bg-sky-500"
        >
          Ir para o projeto
        </RouterLink>
      </EmptyState>
    </div>

    <p v-else-if="blocks.isError.value" class="p-8 text-rose-400">
      {{ blocks.error.value?.message }}
    </p>
    <p v-else class="p-8 text-slate-500">Carregando…</p>
  </div>
</template>
