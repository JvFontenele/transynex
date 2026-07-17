<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useQuery } from '@tanstack/vue-query';
import { api } from '../api';
import EmptyState from '../components/EmptyState.vue';

// Modo leitura: só as páginas já traduzidas (renderizadas), empilhadas na
// vertical como um leitor de mangá/webtoon. Não substitui a tela do projeto.
const route = useRoute();
const projectId = computed(() => route.params.id as string);

const project = useQuery({
  queryKey: ['project', projectId],
  queryFn: () => api.getProject(projectId.value),
});
const pages = useQuery({
  queryKey: ['pages', projectId],
  queryFn: () => api.listPages(projectId.value),
});

// Todas as páginas na ordem de leitura: usa a traduzida quando existe e a
// original no lugar das que ainda não foram traduzidas.
const readingPages = computed(() =>
  (pages.data.value ?? []).map((p) => ({
    id: p.id,
    order: p.order,
    src: p.renderedImageUrl ?? p.sourceImageUrl,
    translated: p.renderedImageUrl !== null,
  })),
);
const translatedCount = computed(() => readingPages.value.filter((p) => p.translated).length);

// Largura de leitura ajustável (persistida entre sessões)
const WIDTHS = [
  { key: 'narrow', label: 'Estreito', class: 'max-w-xl' },
  { key: 'normal', label: 'Normal', class: 'max-w-3xl' },
  { key: 'wide', label: 'Largo', class: 'max-w-5xl' },
] as const;
const width = ref(localStorage.getItem('reader-width') ?? 'normal');
function setWidth(key: string) {
  width.value = key;
  localStorage.setItem('reader-width', key);
}
const widthClass = computed(
  () => WIDTHS.find((w) => w.key === width.value)?.class ?? 'max-w-3xl',
);
</script>

<template>
  <div class="min-h-screen">
    <!-- Barra fixa do leitor -->
    <header
      class="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-800 bg-slate-950/90 px-4 py-2.5 backdrop-blur"
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
      <span v-if="readingPages.length" class="text-xs text-slate-500">
        {{ translatedCount }} de {{ readingPages.length }} página(s) traduzida(s)
      </span>
      <div class="ml-auto flex gap-1">
        <button
          v-for="w in WIDTHS"
          :key="w.key"
          class="rounded-md border px-2.5 py-1 text-xs transition"
          :class="
            width === w.key
              ? 'border-sky-600 bg-sky-600/15 text-sky-300'
              : 'border-slate-700 text-slate-400 hover:border-slate-500'
          "
          @click="setWidth(w.key)"
        >
          {{ w.label }}
        </button>
      </div>
    </header>

    <!-- Páginas empilhadas: traduzidas + originais no lugar das pendentes -->
    <div v-if="readingPages.length" class="mx-auto py-6" :class="widthClass">
      <div v-for="page in readingPages" :key="page.id" class="relative">
        <img
          :src="page.src"
          :alt="`Página ${page.order + 1}`"
          class="block w-full"
          loading="lazy"
        />
        <span
          v-if="!page.translated"
          class="absolute right-2 top-2 rounded-full bg-slate-950/80 px-2 py-0.5 text-[11px] text-amber-400"
          title="Esta página ainda não foi traduzida — exibindo a original"
        >
          original
        </span>
      </div>
      <p class="py-8 text-center text-sm text-slate-600">
        Fim · {{ readingPages.length }} página(s)
      </p>
    </div>

    <div v-else-if="pages.isSuccess.value" class="mx-auto max-w-xl py-16">
      <EmptyState
        title="Este projeto ainda não tem páginas"
        hint="Envie arquivos no projeto — as páginas aparecem aqui em modo leitura."
      >
        <RouterLink
          :to="{ name: 'project-detail', params: { id: projectId } }"
          class="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium hover:bg-sky-500"
        >
          Ir para o projeto
        </RouterLink>
      </EmptyState>
    </div>

    <p v-else-if="pages.isError.value" class="p-8 text-rose-400">
      {{ pages.error.value?.message }}
    </p>
    <p v-else class="p-8 text-slate-500">Carregando…</p>
  </div>
</template>
