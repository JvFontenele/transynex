<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import {
  ArrowLeftIcon,
  CheckIcon,
  CircleCheckIcon,
  CircleIcon,
  CopyIcon,
  PencilLineIcon,
} from '@lucide/vue';
import { toast } from 'vue-sonner';
import { api, type DocumentBlock } from '@/api';
import { languageName } from '@/lib/labels';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';
import EmptyState from '@/components/EmptyState.vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Toggle } from '@/components/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

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
    (query.state.data as DocumentBlock[] | undefined)?.some(
      (b) => !b.image && b.translatedText === null,
    )
      ? 5000
      : false,
});

// Contagens e cópia são sobre o texto; blocos-imagem só aparecem na leitura.
const textBlocks = computed(() => blocks.data.value?.filter((b) => !b.image) ?? []);
const total = computed(() => textBlocks.value.length);
const translatedCount = computed(
  () => textBlocks.value.filter((b) => b.translatedText !== null).length,
);
const reviewedCount = computed(() => textBlocks.value.filter((b) => b.reviewedAt).length);

// --- Revisão no leitor ---------------------------------------------------------
// Clicar num parágrafo edita a tradução ali mesmo; o ✓ marca como revisado.
const auth = useAuthStore();
const queryClient = useQueryClient();
const review = ref(auth.canEdit && route.query.review === '1');
const editingId = ref<string | null>(null);
const draft = ref('');
const saving = ref(false);

function replaceBlock(updated: DocumentBlock) {
  queryClient.setQueryData<DocumentBlock[]>(['blocks', projectId], (list) =>
    list?.map((b) => (b.id === updated.id ? updated : b)),
  );
}
function startEdit(block: DocumentBlock) {
  if (!review.value || block.image) return;
  editingId.value = block.id;
  draft.value = block.translatedText ?? '';
}
async function saveBlock(block: DocumentBlock) {
  saving.value = true;
  try {
    replaceBlock(await api.updateBlock(block.id, { translatedText: draft.value }));
    editingId.value = null;
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Falha ao salvar');
  } finally {
    saving.value = false;
  }
}
async function toggleReviewed(block: DocumentBlock) {
  try {
    replaceBlock(await api.updateBlock(block.id, { reviewed: !block.reviewedAt }));
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Falha ao marcar revisão');
  }
}

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
  const text = textBlocks.value
    .map((b) => b.translatedText ?? b.sourceText)
    .join('\n\n');
  await navigator.clipboard.writeText(text);
  toast.success('Tradução copiada');
  copied.value = true;
  setTimeout(() => (copied.value = false), 2000);
}
</script>

<template>
  <div class="min-h-svh bg-background">
    <header
      class="sticky top-0 z-20 flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-background/80 px-4 py-2 backdrop-blur"
    >
      <Button variant="ghost" size="sm" as-child>
        <RouterLink :to="{ name: 'project-detail', params: { id: projectId } }">
          <ArrowLeftIcon data-icon="inline-start" />
          Voltar ao projeto
        </RouterLink>
      </Button>
      <h1 class="min-w-0 truncate text-sm font-medium">
        {{ project.data.value?.name ?? '…' }}
      </h1>
      <span v-if="total" class="text-xs text-muted-foreground">
        {{ translatedCount }} de {{ total }} parágrafo(s) traduzido(s)
        <template v-if="review">· {{ reviewedCount }} revisado(s)</template>
      </span>

      <div class="ml-auto flex flex-wrap items-center gap-3">
        <Toggle
          v-if="auth.canEdit && total"
          v-model="review"
          variant="outline"
          size="sm"
          aria-label="Modo revisão"
        >
          <PencilLineIcon />
          Revisar
        </Toggle>
        <div
          class="flex items-center gap-2"
          :title="
            bilingual ? 'Mostrando original e tradução' : 'Mostrar o original ao lado da tradução'
          "
        >
          <Switch
            id="doc-bilingual"
            size="sm"
            :model-value="bilingual"
            @update:model-value="toggleBilingual"
          />
          <Label for="doc-bilingual" class="text-xs">Bilíngue</Label>
        </div>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          aria-label="Largura de leitura"
          title="Largura de leitura (indisponível no modo bilíngue)"
          :disabled="bilingual"
          :model-value="bilingual ? undefined : width"
          @update:model-value="(v) => v && setWidth(v as string)"
        >
          <ToggleGroupItem v-for="w in WIDTHS" :key="w.key" :value="w.key">
            {{ w.label }}
          </ToggleGroupItem>
        </ToggleGroup>
        <Button v-if="total" variant="outline" size="sm" @click="copyTranslation">
          <CheckIcon v-if="copied" data-icon="inline-start" />
          <CopyIcon v-else data-icon="inline-start" />
          {{ copied ? 'Copiado' : 'Copiar tradução' }}
        </Button>
      </div>
    </header>

    <div v-if="total" class="mx-auto px-4 py-8" :class="widthClass">
      <p v-if="project.data.value" class="mb-6 text-xs text-muted-foreground">
        {{ languageName(project.data.value.sourceLanguage) }} →
        {{ languageName(project.data.value.targetLanguage) }}
      </p>

      <template v-for="{ block, startsPage } in entries" :key="block.id">
        <div
          v-if="startsPage"
          class="mb-4 mt-8 flex items-center gap-3 text-[11px] uppercase tracking-wide text-muted-foreground first:mt-0"
        >
          <Separator class="flex-1" />
          página {{ block.pageNumber }}
          <Separator class="flex-1" />
        </div>

        <!-- Imagem embutida: a traduzida (render) quando houver -->
        <figure
          v-if="block.image"
          :class="bilingual ? 'mb-5 grid items-start gap-x-8 gap-y-1 sm:grid-cols-2' : 'mb-5'"
        >
          <img
            v-if="bilingual"
            :src="block.image.sourceImageUrl"
            alt="Imagem original"
            loading="lazy"
            class="max-w-full rounded-md border"
          />
          <img
            v-if="!bilingual || block.image.renderedImageUrl"
            :src="block.image.renderedImageUrl ?? block.image.sourceImageUrl"
            :alt="block.image.renderedImageUrl ? 'Imagem traduzida' : 'Imagem do documento'"
            loading="lazy"
            :class="cn('max-w-full rounded-md border', !bilingual && 'mx-auto')"
          />
          <p v-else class="text-[15px] italic text-muted-foreground">imagem sem tradução</p>
          <figcaption v-if="review" class="text-right sm:col-span-2">
            <Button variant="link" size="sm" as-child>
              <RouterLink
                :to="{ name: 'page-editor', params: { id: projectId, pageId: block.image.id } }"
              >
                Editar texto da imagem
              </RouterLink>
            </Button>
          </figcaption>
        </figure>

        <!-- Bilíngue: original à esquerda, tradução à direita -->
        <div v-else :class="bilingual ? 'mb-5 grid gap-x-8 gap-y-1 sm:grid-cols-2' : 'mb-5'">
          <p v-if="bilingual" class="text-[15px] leading-relaxed text-muted-foreground">
            {{ block.sourceText }}
          </p>

          <form
            v-if="editingId === block.id"
            class="flex flex-col gap-2"
            @submit.prevent="saveBlock(block)"
          >
            <Textarea
              v-model="draft"
              autofocus
              aria-label="Tradução do parágrafo"
              @keydown.esc="editingId = null"
              @keydown.enter.ctrl.prevent="saveBlock(block)"
              @keydown.enter.meta.prevent="saveBlock(block)"
            />
            <div class="flex items-center justify-end gap-2">
              <span class="mr-auto text-xs text-muted-foreground">Ctrl+Enter salva · Esc cancela</span>
              <Button type="button" size="sm" variant="ghost" @click="editingId = null">
                Cancelar
              </Button>
              <Button type="submit" size="sm" :disabled="saving">Salvar</Button>
            </div>
          </form>

          <div v-else class="flex items-start gap-1">
            <!-- Só tradução: parágrafos sem tradução caem no original, marcados -->
            <p
              :class="
                cn(
                  'flex-1 leading-relaxed',
                  bilingual ? 'text-[15px]' : 'text-[17px]',
                  block.translatedText ? 'text-foreground' : 'text-muted-foreground',
                  bilingual && !block.translatedText && 'italic',
                  review && '-mx-1.5 cursor-text rounded-md px-1.5 hover:bg-muted/60',
                )
              "
              @click="startEdit(block)"
            >
              <template v-if="bilingual">{{ block.translatedText ?? 'sem tradução ainda' }}</template>
              <template v-else>
                {{ block.translatedText ?? block.sourceText }}
                <Badge
                  v-if="!block.translatedText"
                  as="span"
                  variant="warning"
                  class="ml-1 align-middle"
                  title="Este parágrafo ainda não foi traduzido — exibindo o original"
                >
                  original
                </Badge>
              </template>
            </p>
            <Button
              v-if="review && block.translatedText"
              size="icon-sm"
              variant="ghost"
              :aria-label="block.reviewedAt ? 'Desmarcar revisado' : 'Marcar como revisado'"
              :title="block.reviewedAt ? 'Revisado' : 'Marcar como revisado'"
              @click="toggleReviewed(block)"
            >
              <CircleCheckIcon v-if="block.reviewedAt" class="text-success" />
              <CircleIcon v-else class="text-muted-foreground" />
            </Button>
          </div>
        </div>
      </template>

      <p class="py-8 text-center text-sm text-muted-foreground">
        Fim · {{ total }} parágrafo(s)
      </p>
    </div>

    <div v-else-if="blocks.isSuccess.value" class="mx-auto max-w-xl px-4 py-16">
      <EmptyState
        title="Nenhum texto extraído ainda"
        hint="Envie um PDF no projeto — o texto aparece aqui em leitura corrida assim que a extração terminar."
      >
        <Button as-child>
          <RouterLink :to="{ name: 'project-detail', params: { id: projectId } }">
            Ir para o projeto
          </RouterLink>
        </Button>
      </EmptyState>
    </div>

    <div v-else-if="blocks.isError.value" class="mx-auto max-w-xl p-8">
      <Alert variant="destructive">
        <AlertDescription>{{ blocks.error.value?.message }}</AlertDescription>
      </Alert>
    </div>
    <div v-else class="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-8">
      <Skeleton v-for="i in 6" :key="i" class="h-16 w-full" />
    </div>
  </div>
</template>
