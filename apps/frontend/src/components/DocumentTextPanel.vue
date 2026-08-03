<script setup lang="ts">
import { computed } from 'vue';
import type { DocumentBlock } from '../api';
import EmptyState from '../components/EmptyState.vue';

// Resumo do texto extraído de um projeto DOCUMENT + prévia dos primeiros
// parágrafos. A leitura completa fica no leitor (/projects/:id/text).
const props = defineProps<{
  projectId: string;
  blocks: DocumentBlock[];
  loading: boolean;
}>();

const PREVIEW = 8;

const translatedCount = computed(() => props.blocks.filter((b) => b.translatedText).length);
const preview = computed(() => props.blocks.slice(0, PREVIEW));
const rest = computed(() => Math.max(0, props.blocks.length - PREVIEW));
const pageCount = computed(() => new Set(props.blocks.map((b) => b.pageNumber)).size);

// Todos os blocos de um arquivo têm a mesma origem; o projeto pode misturar
// arquivos com camada de texto e arquivos escaneados.
const origins = computed(() => new Set(props.blocks.map((b) => b.origin)));
const originLabel = computed(() => {
  if (origins.value.size > 1) return 'Camada de texto + OCR';
  if (origins.value.has('ocr')) return 'OCR (arquivo escaneado)';
  return 'Camada de texto do PDF';
});
</script>

<template>
  <div v-if="blocks.length">
    <div class="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
      <h3 class="text-lg font-medium">Texto extraído</h3>
      <span class="rounded-full bg-slate-500/15 px-2 py-0.5 text-[11px] text-slate-400">
        {{ blocks.length }} parágrafo(s) · {{ pageCount }} página(s)
      </span>
      <span
        class="rounded-full bg-slate-500/15 px-2 py-0.5 text-[11px] text-slate-400"
        :title="
          origins.has('ocr')
            ? 'O PDF não tinha camada de texto: o texto veio do OCR das páginas rasterizadas'
            : 'Texto lido direto do PDF, sem OCR'
        "
      >
        {{ originLabel }}
      </span>
      <span
        class="rounded-full px-2 py-0.5 text-[11px]"
        :class="
          translatedCount === blocks.length
            ? 'bg-emerald-500/15 text-emerald-400'
            : 'bg-amber-500/15 text-amber-400'
        "
      >
        {{ translatedCount }} traduzido(s)
      </span>
      <RouterLink
        :to="{ name: 'document-reader', params: { id: projectId } }"
        class="ml-auto text-xs text-sky-400 hover:underline"
      >
        Abrir leitura completa →
      </RouterLink>
    </div>

    <div class="mb-8 overflow-hidden rounded-lg border border-slate-800 bg-slate-900/60">
      <div
        v-for="b in preview"
        :key="b.id"
        class="grid gap-x-6 gap-y-1 border-b border-slate-800/50 p-3 text-sm last:border-b-0 sm:grid-cols-2"
      >
        <p class="text-slate-500">{{ b.sourceText }}</p>
        <p :class="b.translatedText ? 'text-slate-200' : 'italic text-slate-600'">
          {{ b.translatedText ?? 'sem tradução ainda' }}
        </p>
      </div>
      <RouterLink
        v-if="rest > 0"
        :to="{ name: 'document-reader', params: { id: projectId } }"
        class="block bg-slate-950/40 p-3 text-center text-xs text-sky-400 hover:underline"
      >
        …e mais {{ rest }} parágrafo(s) — ler tudo
      </RouterLink>
    </div>
  </div>

  <EmptyState
    v-else-if="!loading"
    title="Nenhum texto extraído ainda"
    hint="Envie um PDF na área acima. Se o arquivo tiver camada de texto, o texto é lido direto; se for escaneado, cai no OCR automaticamente."
  />
</template>
