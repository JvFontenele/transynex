<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useQuery } from '@tanstack/vue-query';
import { useColorMode, useEventListener, useLocalStorage } from '@vueuse/core';
import ePub, { type Book, type Contents, type Rendition } from 'epubjs';
import type { NavItem } from 'epubjs/types/navigation';
import {
  ArrowLeftIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PencilLineIcon,
  Settings2Icon,
} from '@lucide/vue';
import { api, type DocumentBlock } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

// Leitor de EPUB: abre o livro original (layout, imagens e estilos do próprio
// EPUB) e troca o texto de cada bloco pela tradução no momento de exibir.
// A correspondência é pelo locator "capítulo:bloco" gerado no backend
// (apps/backend/src/epub.ts) — BLOCK_SELECTOR e leafBlocks precisam bater.
const BLOCK_SELECTOR = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,dt,dd';
const normalize = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim();
function leafBlocks(doc: Document): HTMLElement[] {
  return [...doc.querySelectorAll<HTMLElement>(BLOCK_SELECTOR)].filter(
    (el) => normalize(el.textContent) && !el.querySelector(BLOCK_SELECTOR),
  );
}

const route = useRoute();
const auth = useAuthStore();
const projectId = computed(() => route.params.id as string);
const { state: colorMode } = useColorMode();

const project = useQuery({
  queryKey: ['project', projectId],
  queryFn: () => api.getProject(projectId.value),
});
const blocks = useQuery({
  queryKey: ['blocks', projectId],
  queryFn: () => api.listBlocks(projectId.value),
  refetchInterval: (q) =>
    (q.state.data as DocumentBlock[] | undefined)?.some((b) => b.translatedText === null)
      ? 5000
      : false,
});

const epubFile = computed(() =>
  project.data.value?.sourceFiles?.find((f) => f.mimeType === 'application/epub+zip'),
);
const translations = computed(() => {
  const map = new Map<string, string>();
  for (const b of blocks.data.value ?? []) {
    if (b.sourceFileId === epubFile.value?.id && b.locator && b.translatedText) {
      map.set(b.locator, b.translatedText);
    }
  }
  return map;
});
const translatedCount = computed(() => translations.value.size);

// Preferências (por navegador)
const bilingual = useLocalStorage('epub-bilingual', false);
const flow = useLocalStorage<'paginated' | 'scrolled-doc'>('epub-flow', 'paginated');
const fontSize = useLocalStorage('epub-font-size', 100);
const lastCfi = useLocalStorage<string | null>(() => `epub-loc-${projectId.value}`, null);

const viewer = ref<HTMLElement>();
const book = shallowRef<Book>();
const rendition = shallowRef<Rendition>();
const toc = ref<NavItem[]>([]);
const chapter = ref({ index: 0, total: 0, href: '' });
const error = ref('');
const loading = ref(true);

function applyTranslations(contents: Contents) {
  const index = (contents as unknown as { sectionIndex: number }).sectionIndex;
  leafBlocks(contents.document).forEach((el, i) => {
    const text = translations.value.get(`${index}:${i}`);
    if (!text) return;
    if (bilingual.value) {
      // Original esmaecido, tradução logo abaixo no mesmo tipo de bloco.
      const copy = el.cloneNode(false) as HTMLElement;
      copy.removeAttribute('id');
      copy.textContent = text;
      el.style.opacity = '0.55';
      el.after(copy);
    } else {
      el.textContent = text;
    }
  });
}

function themeColors() {
  const css = getComputedStyle(document.body);
  return { color: css.color, background: css.backgroundColor };
}

// (Re)cria a rendition na posição atual: chamada ao abrir e quando mudam
// traduções, modo bilíngue, fluxo ou tema.
async function render() {
  if (!book.value || !viewer.value) return;
  const at = rendition.value?.location?.start?.cfi ?? lastCfi.value ?? undefined;
  rendition.value?.destroy();
  const r = book.value.renderTo(viewer.value, {
    width: '100%',
    height: '100%',
    flow: flow.value,
    spread: 'auto',
    allowScriptedContent: false,
  });
  r.hooks.content.register(applyTranslations);
  const { color, background } = themeColors();
  r.themes.default({
    body: { color: `${color} !important`, background: `${background} !important` },
    a: { color: `${color} !important` },
  });
  r.themes.fontSize(`${fontSize.value}%`);
  r.on('relocated', (loc: { start: { cfi: string; index: number; href: string } }) => {
    lastCfi.value = loc.start.cfi;
    chapter.value = {
      index: loc.start.index,
      total: book.value?.spine ? (book.value.spine as unknown as { length: number }).length : 0,
      href: loc.start.href,
    };
  });
  r.on('keyup', onKey);
  rendition.value = r;
  try {
    await r.display(at);
  } catch {
    await r.display();
  }
}

async function open(url: string) {
  loading.value = true;
  error.value = '';
  try {
    const data = await (await fetch(url)).arrayBuffer();
    book.value?.destroy();
    book.value = ePub(data);
    await book.value.ready;
    toc.value = book.value.navigation?.toc ?? [];
    await render();
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Não foi possível abrir o EPUB';
  } finally {
    loading.value = false;
  }
}

watch(
  () => epubFile.value?.fileUrl,
  (url, old) => {
    // A URL assinada muda a cada refetch do projeto; só reabre se trocou o arquivo.
    if (url && !old) open(url);
  },
  { immediate: true },
);
watch([translatedCount, bilingual, flow, colorMode], () => {
  if (book.value) render();
});
watch(fontSize, (v) => rendition.value?.themes.fontSize(`${v}%`));

const prev = () => rendition.value?.prev();
const next = () => rendition.value?.next();
function onKey(e: KeyboardEvent) {
  if (e.key === 'ArrowLeft') prev();
  else if (e.key === 'ArrowRight') next();
}
useEventListener('keyup', onKey);

const currentTocHref = computed(
  () => toc.value.find((t) => chapter.value.href && t.href.split('#')[0] === chapter.value.href)?.href,
);
function goTo(href: unknown) {
  if (typeof href === 'string') rendition.value?.display(href);
}

onBeforeUnmount(() => {
  rendition.value?.destroy();
  book.value?.destroy();
});
</script>

<template>
  <div class="flex h-svh flex-col bg-background">
    <header class="flex h-14 shrink-0 items-center gap-2 border-b px-2 sm:px-4">
      <Button variant="ghost" size="icon-sm" aria-label="Voltar ao projeto" as-child>
        <RouterLink :to="{ name: 'project-detail', params: { id: projectId } }">
          <ArrowLeftIcon />
        </RouterLink>
      </Button>
      <div class="flex min-w-0 flex-col leading-tight">
        <h1 class="truncate text-sm font-medium">{{ project.data.value?.name ?? '…' }}</h1>
        <span class="truncate text-xs text-muted-foreground">
          {{ translatedCount }}/{{ blocks.data.value?.length ?? 0 }} parágrafos traduzidos
          <template v-if="chapter.total">· seção {{ chapter.index + 1 }}/{{ chapter.total }}</template>
        </span>
      </div>

      <div class="ml-auto flex items-center gap-1">
        <Select v-if="toc.length" :model-value="currentTocHref" @update:model-value="goTo">
          <SelectTrigger size="sm" class="hidden w-48 md:flex" aria-label="Sumário">
            <SelectValue placeholder="Sumário" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem v-for="t in toc" :key="t.id" :value="t.href">
                {{ t.label.trim() }}
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <Button v-if="auth.canEdit" variant="ghost" size="sm" as-child>
          <RouterLink
            :to="{ name: 'document-reader', params: { id: projectId }, query: { review: '1' } }"
            title="Corrigir a tradução parágrafo a parágrafo"
          >
            <PencilLineIcon data-icon="inline-start" />
            <span class="hidden sm:inline">Revisar</span>
          </RouterLink>
        </Button>
        <Popover>
          <PopoverTrigger as-child>
            <Button variant="ghost" size="icon-sm" aria-label="Exibição">
              <Settings2Icon />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" class="w-72">
            <FieldGroup>
              <Field orientation="horizontal">
                <Switch id="epub-bilingual" v-model="bilingual" />
                <Label for="epub-bilingual">Bilíngue (original + tradução)</Label>
              </Field>
              <Field>
                <FieldLabel>Leitura</FieldLabel>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  :model-value="flow"
                  @update:model-value="(v) => v && (flow = v as 'paginated' | 'scrolled-doc')"
                >
                  <ToggleGroupItem value="paginated">Páginas</ToggleGroupItem>
                  <ToggleGroupItem value="scrolled-doc">Rolagem</ToggleGroupItem>
                </ToggleGroup>
              </Field>
              <Field>
                <FieldLabel>Tamanho da fonte · {{ fontSize }}%</FieldLabel>
                <div class="flex gap-2">
                  <Button variant="outline" size="sm" @click="fontSize = Math.max(70, fontSize - 10)">
                    A−
                  </Button>
                  <Button variant="outline" size="sm" @click="fontSize = Math.min(200, fontSize + 10)">
                    A+
                  </Button>
                </div>
              </Field>
            </FieldGroup>
          </PopoverContent>
        </Popover>
      </div>
    </header>

    <div class="relative min-h-0 flex-1">
      <div ref="viewer" class="mx-auto size-full max-w-5xl px-2 sm:px-10" />
      <template v-if="flow === 'paginated' && !loading && !error">
        <Button
          variant="ghost"
          size="icon"
          class="absolute top-1/2 left-1 -translate-y-1/2"
          aria-label="Página anterior"
          @click="prev"
        >
          <ChevronLeftIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          class="absolute top-1/2 right-1 -translate-y-1/2"
          aria-label="Próxima página"
          @click="next"
        >
          <ChevronRightIcon />
        </Button>
      </template>
      <div v-if="loading && epubFile && !error" class="absolute inset-0 flex items-center justify-center">
        <Spinner />
      </div>
      <div v-if="error || (project.isSuccess.value && !epubFile)" class="absolute inset-0 p-8">
        <Alert variant="destructive" class="mx-auto max-w-xl">
          <AlertDescription>
            {{ error || 'Este projeto não tem um arquivo EPUB.' }}
          </AlertDescription>
        </Alert>
      </div>
    </div>
  </div>
</template>
