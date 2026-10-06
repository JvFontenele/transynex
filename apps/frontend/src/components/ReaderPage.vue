<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { useQueryClient } from '@tanstack/vue-query';
import { CheckIcon, CircleIcon } from '@lucide/vue';
import { toast } from 'vue-sonner';
import { api, type OcrRegion, type Page } from '@/api';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';

// Uma página do leitor de HQ. Em modo revisão sobrepõe as regiões de texto:
// clicar abre a edição da tradução, salvar re-renderiza a página sozinho.
// fill = ocupa a largura do container (modo rolagem); senão encolhe à imagem.
const props = defineProps<{ page: Page; review: boolean; imgClass?: string; fill?: boolean }>();

const queryClient = useQueryClient();
const invalidate = () => queryClient.invalidateQueries({ queryKey: ['pages', props.page.projectId] });

const src = computed(() => props.page.renderedImageUrl ?? props.page.sourceImageUrl);
const translated = computed(() => props.page.renderedImageUrl !== null);

// Caixas em % do tamanho natural da imagem: acompanham qualquer zoom/largura.
const natural = ref<{ w: number; h: number } | null>(null);
function onLoad(e: Event) {
  const img = e.target as HTMLImageElement;
  natural.value = { w: img.naturalWidth, h: img.naturalHeight };
}
function boxStyle(r: OcrRegion) {
  const n = natural.value!;
  const b = r.boundingBox;
  return {
    left: `${(b.x / n.w) * 100}%`,
    top: `${(b.y / n.h) * 100}%`,
    width: `${(b.width / n.w) * 100}%`,
    height: `${(b.height / n.h) * 100}%`,
  };
}

const openId = ref<string | null>(null);
const draft = ref('');
const saving = ref(false);
const rendering = ref(false);

function onOpen(r: OcrRegion, open: boolean) {
  openId.value = open ? r.id : null;
  if (open) draft.value = r.translatedText ?? '';
}

// Várias correções seguidas viram um único render.
let renderTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(async () => {
    rendering.value = true;
    try {
      await api.renderPage(props.page.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao renderizar');
    } finally {
      rendering.value = false;
      invalidate();
    }
  }, 800);
}
onBeforeUnmount(() => clearTimeout(renderTimer));

async function save(r: OcrRegion) {
  saving.value = true;
  try {
    await api.updateRegion(r.id, { translatedText: draft.value });
    openId.value = null;
    scheduleRender();
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Falha ao salvar');
  } finally {
    saving.value = false;
  }
}

async function toggleReviewed() {
  try {
    await api.reviewPage(props.page.id, !props.page.reviewedAt);
    invalidate();
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Falha ao marcar revisão');
  }
}
</script>

<template>
  <div :class="cn('relative max-w-full', fill ? 'mx-auto w-full' : 'w-fit')">
    <img
      :src="src"
      :alt="`Página ${page.order + 1}`"
      :class="cn('block', imgClass)"
      loading="lazy"
      draggable="false"
      @load="onLoad"
    />

    <Badge
      v-if="!translated && !rendering"
      variant="warning"
      class="absolute top-2 right-2 bg-background/80 backdrop-blur"
      title="Esta página ainda não foi traduzida — exibindo a original"
    >
      original
    </Badge>
    <Badge v-if="rendering" variant="secondary" class="absolute top-2 right-2">
      <Spinner />
      renderizando
    </Badge>

    <template v-if="review && natural">
      <Popover
        v-for="r in page.ocrRegions"
        :key="r.id"
        :open="openId === r.id"
        @update:open="(o) => onOpen(r, o)"
      >
        <PopoverTrigger as-child>
          <button
            type="button"
            :aria-label="`Editar: ${r.translatedText ?? r.sourceText}`"
            :class="
              cn(
                'absolute rounded-sm border-2 transition-colors',
                openId === r.id
                  ? 'border-info bg-info/20'
                  : 'border-info/60 bg-info/5 hover:bg-info/15',
              )
            "
            :style="boxStyle(r)"
          />
        </PopoverTrigger>
        <PopoverContent class="w-80">
          <form class="flex flex-col gap-2" @submit.prevent="save(r)">
            <p class="text-xs text-muted-foreground">{{ r.sourceText || '(sem texto original)' }}</p>
            <Textarea
              v-model="draft"
              autofocus
              rows="3"
              aria-label="Tradução"
              @keydown.enter.ctrl.prevent="save(r)"
              @keydown.enter.meta.prevent="save(r)"
            />
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs text-muted-foreground">Ctrl+Enter salva</span>
              <Button type="submit" size="sm" :disabled="saving">
                <Spinner v-if="saving" data-icon="inline-start" />
                Salvar
              </Button>
            </div>
          </form>
        </PopoverContent>
      </Popover>
    </template>

    <div v-if="review" class="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-2">
      <Button
        size="sm"
        :variant="page.reviewedAt ? 'default' : 'secondary'"
        class="shadow-md"
        @click="toggleReviewed"
      >
        <CheckIcon v-if="page.reviewedAt" data-icon="inline-start" />
        <CircleIcon v-else data-icon="inline-start" />
        {{ page.reviewedAt ? 'Revisada' : 'Marcar como revisada' }}
      </Button>
    </div>
  </div>
</template>
