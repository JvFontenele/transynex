<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useQuery } from '@tanstack/vue-query';
import { useEventListener, useLocalStorage } from '@vueuse/core';
import {
  ArrowLeftIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Columns2Icon,
  PencilLineIcon,
  RectangleVerticalIcon,
  Rows3Icon,
  Settings2Icon,
  SquarePenIcon,
} from '@lucide/vue';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { cn } from '@/lib/utils';
import EmptyState from '@/components/EmptyState.vue';
import ReaderPage from '@/components/ReaderPage.vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { Toggle } from '@/components/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

// Leitor de HQ: rolagem contínua (webtoon), página única ou página dupla,
// com sentido de leitura LTR/RTL (mangá). Em modo revisão, cada balão é
// editável direto na página e a página re-renderiza sozinha.
const route = useRoute();
const auth = useAuthStore();
const projectId = computed(() => route.params.id as string);

const project = useQuery({
  queryKey: ['project', projectId],
  queryFn: () => api.getProject(projectId.value),
  refetchInterval: (q) => (q.state.data?.status === 'PROCESSING' ? 5000 : false),
});
const pages = useQuery({
  queryKey: ['pages', projectId],
  queryFn: () => api.listPages(projectId.value),
  // Envio rápido abre o leitor com o pipeline ainda rodando: atualiza sozinho.
  refetchInterval: () => (project.data.value?.status === 'PROCESSING' ? 5000 : false),
});

const list = computed(() => pages.data.value ?? []);
const translatedCount = computed(() => list.value.filter((p) => p.renderedImageUrl).length);
const reviewedCount = computed(() => list.value.filter((p) => p.reviewedAt).length);

// Preferências de exibição (por navegador)
type Mode = 'scroll' | 'single' | 'double';
const mode = useLocalStorage<Mode>('reader-mode', 'scroll');
const rtl = useLocalStorage('reader-rtl', false);
const fit = useLocalStorage<'height' | 'width'>('reader-fit', 'height');
const width = useLocalStorage('reader-width', 'normal');
const WIDTHS = [
  { key: 'narrow', label: 'Estreito', class: 'max-w-xl' },
  { key: 'normal', label: 'Normal', class: 'max-w-3xl' },
  { key: 'wide', label: 'Largo', class: 'max-w-5xl' },
  { key: 'full', label: 'Tela', class: 'max-w-none' },
];
const widthClass = computed(() => WIDTHS.find((w) => w.key === width.value)?.class ?? 'max-w-3xl');

const review = ref(auth.canEdit && route.query.review === '1');

// --- Navegação paginada -----------------------------------------------------
const step = computed(() => (mode.value === 'double' ? 2 : 1));
const index = ref(Number(route.query.page ?? 0) || 0);
const spread = computed(() => list.value.slice(index.value, index.value + step.value));
const lastStart = computed(() => Math.max(0, list.value.length - 1));

function go(delta: number) {
  index.value = Math.min(Math.max(index.value + delta * step.value, 0), lastStart.value);
}
// "Próxima" fica do lado em que se lê: direita em LTR, esquerda em RTL.
const goLeft = () => go(rtl.value ? 1 : -1);
const goRight = () => go(rtl.value ? -1 : 1);

// Página dupla começa em índice par para manter os pares estáveis.
watch(mode, (m) => {
  if (m === 'double') index.value -= index.value % 2;
});

useEventListener('keydown', (e: KeyboardEvent) => {
  const t = e.target as HTMLElement;
  if (mode.value === 'scroll' || t.closest('input, textarea, [contenteditable]')) return;
  if (e.key === 'ArrowLeft') goLeft();
  else if (e.key === 'ArrowRight') goRight();
  else if (e.key === 'PageDown' || e.key === ' ') go(1);
  else if (e.key === 'PageUp') go(-1);
  else return;
  e.preventDefault();
});

// Na rolagem, ?page=N leva direto à página (ex: vindo do botão Revisar).
watch(
  () => list.value.length,
  async (n, old) => {
    if (!n || old || mode.value !== 'scroll' || !index.value) return;
    await nextTick();
    document.getElementById(`page-${index.value}`)?.scrollIntoView();
  },
  { immediate: true },
);

const pagedImgClass = computed(() =>
  fit.value === 'height' ? 'max-h-[calc(100svh-3.5rem)] w-auto max-w-full' : 'w-full',
);
const editorLink = computed(() => {
  const p = mode.value === 'scroll' ? null : spread.value[0];
  return p ? { name: 'page-editor', params: { id: projectId.value, pageId: p.id } } : null;
});
</script>

<template>
  <div class="min-h-svh bg-background">
    <header
      class="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/80 px-2 backdrop-blur sm:px-4"
    >
      <Button variant="ghost" size="icon-sm" aria-label="Voltar ao projeto" as-child>
        <RouterLink :to="{ name: 'project-detail', params: { id: projectId } }">
          <ArrowLeftIcon />
        </RouterLink>
      </Button>
      <div class="flex min-w-0 flex-col leading-tight">
        <h1 class="truncate text-sm font-medium">{{ project.data.value?.name ?? '…' }}</h1>
        <span v-if="list.length" class="truncate text-xs text-muted-foreground">
          {{ translatedCount }}/{{ list.length }} traduzidas
          <template v-if="review">· {{ reviewedCount }}/{{ list.length }} revisadas</template>
        </span>
      </div>

      <div class="ml-auto flex items-center gap-1">
        <template v-if="mode !== 'scroll' && list.length">
          <Button variant="ghost" size="icon-sm" aria-label="Página à esquerda" @click="goLeft">
            <ChevronLeftIcon />
          </Button>
          <span class="min-w-14 text-center text-xs text-muted-foreground tabular-nums">
            {{ index + 1 }}<template v-if="spread.length > 1">–{{ index + spread.length }}</template>
            / {{ list.length }}
          </span>
          <Button variant="ghost" size="icon-sm" aria-label="Página à direita" @click="goRight">
            <ChevronRightIcon />
          </Button>
        </template>

        <Button v-if="review && editorLink" variant="ghost" size="sm" as-child class="hidden sm:inline-flex">
          <RouterLink :to="editorLink">
            <SquarePenIcon data-icon="inline-start" />
            Editor avançado
          </RouterLink>
        </Button>
        <Toggle
          v-if="auth.canEdit"
          v-model="review"
          variant="outline"
          size="sm"
          aria-label="Modo revisão"
        >
          <PencilLineIcon />
          <span class="hidden sm:inline">Revisar</span>
        </Toggle>

        <Popover>
          <PopoverTrigger as-child>
            <Button variant="ghost" size="icon-sm" aria-label="Exibição">
              <Settings2Icon />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" class="w-72">
            <FieldGroup>
              <Field>
                <FieldLabel>Modo</FieldLabel>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  :model-value="mode"
                  @update:model-value="(v) => v && (mode = v as Mode)"
                >
                  <ToggleGroupItem value="scroll"><Rows3Icon />Rolagem</ToggleGroupItem>
                  <ToggleGroupItem value="single"><RectangleVerticalIcon />Página</ToggleGroupItem>
                  <ToggleGroupItem value="double"><Columns2Icon />Dupla</ToggleGroupItem>
                </ToggleGroup>
              </Field>
              <Field v-if="mode !== 'scroll'">
                <FieldLabel>Sentido de leitura</FieldLabel>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  :model-value="rtl ? 'rtl' : 'ltr'"
                  @update:model-value="(v) => v && (rtl = v === 'rtl')"
                >
                  <ToggleGroupItem value="ltr">Ocidental →</ToggleGroupItem>
                  <ToggleGroupItem value="rtl">← Mangá</ToggleGroupItem>
                </ToggleGroup>
              </Field>
              <Field v-if="mode !== 'scroll'">
                <FieldLabel>Ajuste</FieldLabel>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  :model-value="fit"
                  @update:model-value="(v) => v && (fit = v as 'height' | 'width')"
                >
                  <ToggleGroupItem value="height">Altura da tela</ToggleGroupItem>
                  <ToggleGroupItem value="width">Largura</ToggleGroupItem>
                </ToggleGroup>
              </Field>
              <Field v-else>
                <FieldLabel>Largura</FieldLabel>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  :model-value="width"
                  @update:model-value="(v) => v && (width = v as string)"
                >
                  <ToggleGroupItem v-for="w in WIDTHS" :key="w.key" :value="w.key">
                    {{ w.label }}
                  </ToggleGroupItem>
                </ToggleGroup>
              </Field>
            </FieldGroup>
          </PopoverContent>
        </Popover>
      </div>
    </header>

    <template v-if="list.length">
      <!-- Rolagem contínua -->
      <div v-if="mode === 'scroll'" class="mx-auto flex flex-col py-4" :class="widthClass">
        <ReaderPage
          v-for="(page, i) in list"
          :id="`page-${i}`"
          :key="page.id"
          :page="page"
          :review="review"
          fill
          img-class="w-full"
        />
        <p class="py-8 text-center text-sm text-muted-foreground">Fim · {{ list.length }} página(s)</p>
      </div>

      <!-- Paginado: página única ou dupla -->
      <div
        v-else
        class="relative flex min-h-[calc(100svh-3.5rem)] items-start justify-center"
        :class="fit === 'height' && 'items-center'"
      >
        <div :class="cn('flex w-full justify-center', rtl && 'flex-row-reverse')">
          <div
            v-for="(page, i) in spread"
            :key="page.id"
            :class="
              cn(
                'flex min-w-0',
                spread.length > 1 ? 'basis-1/2' : 'w-full justify-center',
                spread.length > 1 && (i === 0) !== rtl ? 'justify-end' : 'justify-start',
              )
            "
          >
            <ReaderPage :page="page" :review="review" :img-class="pagedImgClass" />
          </div>
        </div>
        <!-- Áreas de clique laterais para virar página (fora do modo revisão) -->
        <template v-if="!review">
          <button
            type="button"
            class="absolute inset-y-0 left-0 w-1/4 cursor-w-resize"
            aria-label="Página à esquerda"
            @click="goLeft"
          />
          <button
            type="button"
            class="absolute inset-y-0 right-0 w-1/4 cursor-e-resize"
            aria-label="Página à direita"
            @click="goRight"
          />
        </template>
      </div>
    </template>

    <div v-else-if="pages.isSuccess.value" class="mx-auto max-w-xl px-4 py-16">
      <EmptyState
        :title="
          project.data.value?.status === 'PROCESSING'
            ? 'Preparando as páginas…'
            : 'Este projeto ainda não tem páginas'
        "
        hint="Envie arquivos no projeto — as páginas aparecem aqui em modo leitura."
      >
        <Button as-child>
          <RouterLink :to="{ name: 'project-detail', params: { id: projectId } }">
            Ir para o projeto
          </RouterLink>
        </Button>
      </EmptyState>
    </div>

    <div v-else-if="pages.isError.value" class="mx-auto max-w-xl p-8">
      <Alert variant="destructive">
        <AlertDescription>{{ pages.error.value?.message }}</AlertDescription>
      </Alert>
    </div>
    <div v-else class="mx-auto flex max-w-3xl flex-col gap-4 py-6">
      <Skeleton class="aspect-2/3 w-full" />
    </div>
  </div>
</template>
