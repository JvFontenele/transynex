<script setup lang="ts">
import { computed } from 'vue';
import { ArrowRightIcon } from '@lucide/vue';
import type { DocumentBlock } from '@/api';
import EmptyState from '@/components/EmptyState.vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

// Resumo do texto extraído de um projeto DOCUMENT + prévia dos primeiros
// parágrafos. A leitura completa fica no leitor (/projects/:id/text).
const props = defineProps<{
  projectId: string;
  blocks: DocumentBlock[];
  loading: boolean;
}>();

const PREVIEW = 8;

// Blocos-imagem não contam como parágrafo
const textBlocks = computed(() => props.blocks.filter((b) => !b.image));
const imageCount = computed(() => props.blocks.length - textBlocks.value.length);
const translatedCount = computed(() => textBlocks.value.filter((b) => b.translatedText).length);
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
  <Card v-if="blocks.length">
    <CardHeader>
      <CardTitle>Texto extraído</CardTitle>
      <div class="flex flex-wrap gap-1.5">
        <Badge variant="secondary">{{ textBlocks.length }} parágrafo(s) · {{ pageCount }} página(s)</Badge>
        <Badge v-if="imageCount" variant="secondary">{{ imageCount }} imagem(ns)</Badge>
        <Badge
          variant="secondary"
          :title="
            origins.has('ocr')
              ? 'O PDF não tinha camada de texto: o texto veio do OCR das páginas rasterizadas'
              : 'Texto lido direto do PDF, sem OCR'
          "
        >
          {{ originLabel }}
        </Badge>
        <Badge :variant="translatedCount === textBlocks.length ? 'success' : 'warning'">
          {{ translatedCount }} traduzido(s)
        </Badge>
      </div>
      <CardAction>
        <Button variant="outline" size="sm" as-child>
          <RouterLink :to="{ name: 'document-reader', params: { id: projectId } }">
            Abrir leitura completa
            <ArrowRightIcon data-icon="inline-end" />
          </RouterLink>
        </Button>
      </CardAction>
    </CardHeader>

    <CardContent class="flex flex-col">
      <template v-for="(b, i) in preview" :key="b.id">
        <Separator v-if="i > 0" />
        <div v-if="b.image" class="grid gap-x-6 gap-y-1 py-3 sm:grid-cols-2">
          <img :src="b.image.sourceImageUrl" alt="Imagem original" loading="lazy" class="max-h-48 rounded-md border" />
          <img
            v-if="b.image.renderedImageUrl"
            :src="b.image.renderedImageUrl"
            alt="Imagem traduzida"
            loading="lazy"
            class="max-h-48 rounded-md border"
          />
          <p v-else class="italic text-muted-foreground">imagem sem tradução</p>
        </div>
        <div v-else class="grid gap-x-6 gap-y-1 py-3 sm:grid-cols-2">
          <p class="text-muted-foreground">{{ b.sourceText }}</p>
          <p :class="b.translatedText ? '' : 'italic text-muted-foreground'">
            {{ b.translatedText ?? 'sem tradução ainda' }}
          </p>
        </div>
      </template>
    </CardContent>

    <CardFooter v-if="rest > 0" class="justify-center">
      <Button variant="link" size="sm" as-child>
        <RouterLink :to="{ name: 'document-reader', params: { id: projectId } }">
          …e mais {{ rest }} parágrafo(s) — ler tudo
        </RouterLink>
      </Button>
    </CardFooter>
  </Card>

  <EmptyState
    v-else-if="!loading"
    title="Nenhum texto extraído ainda"
    hint="Envie um PDF na área acima. Se o arquivo tiver camada de texto, o texto é lido direto; se for escaneado, cai no OCR automaticamente."
  />
</template>
