<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { api, type BoundingBox, type OcrRegion } from '../api';

const route = useRoute();
const projectId = computed(() => route.params.id as string);
const pageId = computed(() => route.params.pageId as string);
const queryClient = useQueryClient();

const page = useQuery({
  queryKey: ['page', pageId],
  queryFn: () => api.getPage(pageId.value),
});

function invalidate() {
  queryClient.invalidateQueries({ queryKey: ['page', pageId] });
  queryClient.invalidateQueries({ queryKey: ['pages', projectId] });
}

const updateRegion = useMutation({
  mutationFn: (vars: {
    id: string;
    data: { sourceText?: string; translatedText?: string; boundingBox?: BoundingBox };
  }) => api.updateRegion(vars.id, vars.data),
  onSuccess: invalidate,
});
const createRegion = useMutation({
  mutationFn: (box: BoundingBox) => api.createRegion(pageId.value, { boundingBox: box }),
  onSuccess: (region) => {
    invalidate();
    selectedId.value = region.id;
    mode.value = 'select';
    // Região desenhada à mão nasce vazia: já dispara OCR + tradução do recorte
    autoReanalyzed.add(region.id);
    reanalyzeRegion.mutate(region.id);
  },
});
const deleteRegion = useMutation({
  mutationFn: (id: string) => api.deleteRegion(id),
  onSuccess: () => {
    selectedId.value = null;
    invalidate();
  },
});
// OCR + tradução no recorte da região selecionada (preenche os textos)
const reanalyzeRegion = useMutation({
  mutationFn: (id: string) => api.reanalyzeRegion(id),
  onSuccess: (region) => {
    formSource.value = region.sourceText;
    formTranslated.value = region.translatedText ?? '';
    invalidate();
  },
});
// Re-renderiza a partir das regiões atuais (editar qualquer região invalida
// a imagem traduzida no backend; este botão a regenera sem refazer OCR).
const renderPage = useMutation({
  mutationFn: () => api.renderPage(pageId.value),
  onSuccess: () => {
    invalidate();
    showRendered.value = true;
  },
});

// --- Estado do editor -----------------------------------------------------

const showRendered = ref(false);
const mode = ref<'select' | 'draw'>('select');
const selectedId = ref<string | null>(null);
const natural = ref({ width: 0, height: 0 });
const imgWrapper = ref<HTMLDivElement>();

const regions = computed(() => page.data.value?.ocrRegions ?? []);
const selected = computed(() => regions.value.find((r) => r.id === selectedId.value) ?? null);

// Formulário do painel lateral (sincronizado com a seleção)
const formSource = ref('');
const formTranslated = ref('');
// Captação automática ao selecionar uma região ainda sem texto (uma vez por
// região, para não repetir OCR a cada clique).
const autoReanalyzed = new Set<string>();
watch(selected, (r) => {
  formSource.value = r?.sourceText ?? '';
  formTranslated.value = r?.translatedText ?? '';
  if (r && !r.sourceText && !autoReanalyzed.has(r.id) && !reanalyzeRegion.isPending.value) {
    autoReanalyzed.add(r.id);
    reanalyzeRegion.mutate(r.id);
  }
});

function onImgLoad(e: Event) {
  const img = e.target as HTMLImageElement;
  natural.value = { width: img.naturalWidth, height: img.naturalHeight };
}

// bbox em px da imagem → style em % (escala automaticamente com o wrapper)
function boxStyle(box: BoundingBox) {
  const { width, height } = natural.value;
  if (!width || !height) return { display: 'none' };
  return {
    left: `${(box.x / width) * 100}%`,
    top: `${(box.y / height) * 100}%`,
    width: `${(box.width / width) * 100}%`,
    height: `${(box.height / height) * 100}%`,
  };
}

// --- Drag / resize / draw (Pointer Events) --------------------------------

type DragState =
  | { kind: 'move'; regionId: string; startX: number; startY: number; origin: BoundingBox }
  | { kind: 'resize'; regionId: string; handle: string; startX: number; startY: number; origin: BoundingBox }
  | { kind: 'draw'; startX: number; startY: number };

const drag = ref<DragState | null>(null);
// bbox otimista durante o gesto; commit só no pointerup
const draft = ref<{ regionId: string | null; box: BoundingBox } | null>(null);
const MIN_DRAW_PX = 8;

function toImageCoords(e: PointerEvent): { x: number; y: number } {
  const rect = imgWrapper.value!.getBoundingClientRect();
  const { width, height } = natural.value;
  const x = ((e.clientX - rect.left) / rect.width) * width;
  const y = ((e.clientY - rect.top) / rect.height) * height;
  return { x: Math.min(Math.max(x, 0), width), y: Math.min(Math.max(y, 0), height) };
}

function displayBox(r: OcrRegion): BoundingBox {
  return draft.value?.regionId === r.id ? draft.value.box : r.boundingBox;
}

function onWrapperPointerDown(e: PointerEvent) {
  if (!natural.value.width) return;
  if (mode.value === 'draw') {
    const p = toImageCoords(e);
    drag.value = { kind: 'draw', startX: p.x, startY: p.y };
    draft.value = { regionId: null, box: { x: p.x, y: p.y, width: 0, height: 0 } };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  } else {
    selectedId.value = null;
  }
}

function onRegionPointerDown(e: PointerEvent, r: OcrRegion) {
  if (mode.value === 'draw') return;
  e.stopPropagation();
  selectedId.value = r.id;
  const p = toImageCoords(e);
  drag.value = { kind: 'move', regionId: r.id, startX: p.x, startY: p.y, origin: { ...r.boundingBox } };
  draft.value = { regionId: r.id, box: { ...r.boundingBox } };
  imgWrapper.value!.setPointerCapture(e.pointerId);
  e.preventDefault();
}

function onHandlePointerDown(e: PointerEvent, r: OcrRegion, handle: string) {
  e.stopPropagation();
  const p = toImageCoords(e);
  drag.value = { kind: 'resize', regionId: r.id, handle, startX: p.x, startY: p.y, origin: { ...r.boundingBox } };
  draft.value = { regionId: r.id, box: { ...r.boundingBox } };
  imgWrapper.value!.setPointerCapture(e.pointerId);
  e.preventDefault();
}

function onPointerMove(e: PointerEvent) {
  const d = drag.value;
  if (!d) return;
  const p = toImageCoords(e);
  const dx = p.x - d.startX;
  const dy = p.y - d.startY;
  const { width: iw, height: ih } = natural.value;

  if (d.kind === 'draw') {
    draft.value = { regionId: null, box: normalize(d.startX, d.startY, p.x, p.y) };
    return;
  }
  if (d.kind === 'move') {
    const box = d.origin;
    draft.value = {
      regionId: d.regionId,
      box: {
        x: Math.min(Math.max(box.x + dx, 0), iw - box.width),
        y: Math.min(Math.max(box.y + dy, 0), ih - box.height),
        width: box.width,
        height: box.height,
      },
    };
    return;
  }
  // resize: recalcula as bordas afetadas pelo handle (nw/ne/sw/se)
  const o = d.origin;
  let x1 = o.x;
  let y1 = o.y;
  let x2 = o.x + o.width;
  let y2 = o.y + o.height;
  if (d.handle.includes('w')) x1 += dx;
  if (d.handle.includes('e')) x2 += dx;
  if (d.handle.includes('n')) y1 += dy;
  if (d.handle.includes('s')) y2 += dy;
  draft.value = { regionId: d.regionId, box: normalize(x1, y1, x2, y2) };
}

function normalize(x1: number, y1: number, x2: number, y2: number): BoundingBox {
  return {
    x: Math.round(Math.min(x1, x2)),
    y: Math.round(Math.min(y1, y2)),
    width: Math.round(Math.abs(x2 - x1)),
    height: Math.round(Math.abs(y2 - y1)),
  };
}

function onPointerUp() {
  const d = drag.value;
  const df = draft.value;
  drag.value = null;
  if (!d || !df) return;

  if (d.kind === 'draw') {
    draft.value = null;
    if (df.box.width >= MIN_DRAW_PX && df.box.height >= MIN_DRAW_PX) {
      createRegion.mutate(df.box);
    }
    return;
  }
  const moved =
    df.box.x !== d.origin.x ||
    df.box.y !== d.origin.y ||
    df.box.width !== d.origin.width ||
    df.box.height !== d.origin.height;
  if (moved) {
    // draft permanece até o refetch para não "pular" de volta
    updateRegion.mutate(
      { id: d.regionId, data: { boundingBox: df.box } },
      { onSettled: () => (draft.value = null) },
    );
  } else {
    draft.value = null;
  }
}

function saveTexts() {
  if (!selected.value) return;
  updateRegion.mutate({
    id: selected.value.id,
    data: { sourceText: formSource.value, translatedText: formTranslated.value },
  });
}

function onKeydown(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement).tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (e.key === 'Delete' && selectedId.value) deleteRegion.mutate(selectedId.value);
  if (e.key === 'Escape') {
    selectedId.value = null;
    mode.value = 'select';
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown));
onUnmounted(() => window.removeEventListener('keydown', onKeydown));

const imageSrc = computed(() => {
  const p = page.data.value;
  if (!p) return '';
  return (showRendered.value && p.renderedImageUrl) || p.sourceImageUrl;
});

const HANDLES = ['nw', 'ne', 'sw', 'se'] as const;
const handleStyle: Record<string, string> = {
  nw: 'left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize',
  ne: 'right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize',
  sw: 'left-0 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize',
  se: 'right-0 bottom-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize',
};
</script>

<template>
  <div v-if="page.data.value">
    <!-- Header fixo com as ações do editor -->
    <div
      class="sticky top-0 z-20 -mx-8 -mt-8 mb-6 border-b border-slate-800 bg-slate-950/90 px-8 py-3 backdrop-blur"
    >
      <div class="flex items-center gap-3">
        <RouterLink
          :to="{ name: 'project-detail', params: { id: projectId } }"
          class="text-sm text-sky-400 hover:underline"
        >
          ← Voltar ao projeto
        </RouterLink>
        <h2 class="text-lg font-semibold">Página {{ page.data.value.order + 1 }}</h2>
        <div class="ml-auto flex items-center gap-2">
          <button
            class="rounded-md px-3 py-1.5 text-sm"
            :class="
              mode === 'draw'
                ? 'bg-sky-600 hover:bg-sky-500'
                : 'border border-slate-700 hover:border-sky-600'
            "
            @click="mode = mode === 'draw' ? 'select' : 'draw'"
          >
            {{ mode === 'draw' ? 'Desenhando… (Esc cancela)' : '+ Nova região' }}
          </button>
          <button
            v-if="regions.length"
            :disabled="renderPage.isPending.value"
            class="rounded-md border border-slate-700 px-3 py-1.5 text-sm hover:border-sky-600 disabled:opacity-50"
            @click="renderPage.mutate()"
          >
            {{ renderPage.isPending.value ? 'Renderizando…' : 'Renderizar tradução' }}
          </button>
          <button
            v-if="page.data.value.renderedImageRef"
            class="rounded-md border border-slate-700 px-3 py-1.5 text-sm hover:border-sky-600"
            @click="showRendered = !showRendered"
          >
            {{ showRendered ? 'Ver original' : 'Ver traduzida' }}
          </button>
        </div>
      </div>
    </div>

    <div class="flex gap-6">
    <!-- Coluna principal: imagem + overlay -->
    <div class="min-w-0 flex-1">
      <div
        ref="imgWrapper"
        class="relative inline-block max-w-full select-none touch-none"
        :class="mode === 'draw' ? 'cursor-crosshair' : ''"
        @pointerdown="onWrapperPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
      >
        <img
          :src="imageSrc"
          class="block max-w-full rounded-lg border border-slate-800"
          draggable="false"
          @load="onImgLoad"
        />

        <!-- Regiões -->
        <div
          v-for="r in regions"
          :key="r.id"
          class="absolute border-2"
          :class="[
            r.id === selectedId
              ? 'z-10 border-sky-400 bg-sky-400/15'
              : 'border-rose-500/70 bg-rose-500/5 hover:bg-rose-500/15',
            mode === 'draw' ? 'pointer-events-none' : 'cursor-move',
          ]"
          :style="boxStyle(displayBox(r))"
          @pointerdown="onRegionPointerDown($event, r)"
        >
          <template v-if="r.id === selectedId">
            <div
              v-for="h in HANDLES"
              :key="h"
              class="absolute h-2.5 w-2.5 rounded-sm border border-slate-900 bg-sky-400"
              :class="handleStyle[h]"
              @pointerdown="onHandlePointerDown($event, r, h)"
            />
          </template>
        </div>

        <!-- Retângulo sendo desenhado -->
        <div
          v-if="draft && draft.regionId === null"
          class="pointer-events-none absolute border-2 border-dashed border-sky-400 bg-sky-400/10"
          :style="boxStyle(draft.box)"
        />
      </div>
    </div>

    <!-- Painel lateral -->
    <aside class="w-80 shrink-0">
      <div class="sticky top-20 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
        <template v-if="selected">
          <h3 class="mb-3 text-sm font-medium text-slate-300">Região selecionada</h3>
          <label class="mb-1 block text-xs text-slate-500">Texto original</label>
          <textarea
            v-model="formSource"
            rows="3"
            class="mb-3 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
          />
          <label class="mb-1 block text-xs text-slate-500">Tradução</label>
          <textarea
            v-model="formTranslated"
            rows="3"
            class="mb-3 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
          />
          <div class="flex items-center gap-2">
            <button
              :disabled="updateRegion.isPending.value"
              class="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium hover:bg-sky-500 disabled:opacity-50"
              @click="saveTexts"
            >
              Salvar
            </button>
            <button
              :disabled="deleteRegion.isPending.value"
              class="rounded-md border border-rose-700 px-3 py-1.5 text-sm text-rose-400 hover:bg-rose-950 disabled:opacity-50"
              @click="deleteRegion.mutate(selected.id)"
            >
              Excluir
            </button>
          </div>
          <button
            :disabled="reanalyzeRegion.isPending.value"
            class="mt-2 w-full rounded-md border border-slate-700 px-3 py-1.5 text-sm hover:border-sky-600 disabled:opacity-50"
            @click="reanalyzeRegion.mutate(selected.id)"
          >
            {{
              reanalyzeRegion.isPending.value
                ? 'Analisando…'
                : 'Reanalisar região (OCR + tradução)'
            }}
          </button>
          <p v-if="reanalyzeRegion.error.value" class="mt-2 text-xs text-rose-400">
            {{ reanalyzeRegion.error.value.message }}
          </p>
          <p class="mt-3 text-xs text-slate-600">
            Confiança: {{ (selected.confidence * 100).toFixed(0) }}% · Arraste a caixa para mover,
            cantos para redimensionar. Delete exclui.
          </p>
        </template>
        <template v-else>
          <h3 class="mb-2 text-sm font-medium text-slate-300">Nenhuma região selecionada</h3>
          <p class="text-xs text-slate-500">
            Clique numa caixa sobre a imagem para editar o texto, ou use "+ Nova região" para
            desenhar uma nova.
          </p>
          <p v-if="!regions.length" class="mt-2 text-xs text-slate-600">
            Esta página ainda não tem regiões de OCR.
          </p>
        </template>
        <p v-if="updateRegion.error.value" class="mt-3 text-xs text-rose-400">
          {{ updateRegion.error.value.message }}
        </p>
        <p v-if="renderPage.error.value" class="mt-3 text-xs text-rose-400">
          {{ renderPage.error.value.message }}
        </p>
      </div>
    </aside>
    </div>
  </div>
  <p v-else-if="page.isError.value" class="text-rose-400">{{ page.error.value?.message }}</p>
  <p v-else class="text-slate-500">Carregando…</p>
</template>
