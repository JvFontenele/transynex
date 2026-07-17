<script setup lang="ts">
import { computed } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { api } from '../api';

const queryClient = useQueryClient();
const providers = useQuery({ queryKey: ['providers'], queryFn: api.listProviders });

const typeLabels: Record<string, string> = {
  ocr: 'OCR',
  translation: 'Tradução',
  inpainting: 'Inpainting',
  render: 'Renderização',
  export: 'Exportação',
  storage: 'Armazenamento',
};

// Só tipos com pelo menos um provider instalado
const types = computed(() =>
  Object.entries(providers.data.value ?? {}).filter(([, list]) => list.length > 0),
);

const setDefault = useMutation({
  mutationFn: (providerId: string) => api.setDefaultProvider(providerId),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['providers'] }),
});

function currentDefault(list: { id: string; isDefault: boolean }[]): string {
  return list.find((p) => p.isDefault)?.id ?? '';
}

function onChange(e: Event) {
  const id = (e.target as HTMLSelectElement).value;
  if (id) setDefault.mutate(id);
}
</script>

<template>
  <div>
    <h2 class="mb-1 text-2xl font-semibold">Configurações</h2>
    <p class="mb-6 text-sm text-slate-500">
      Provider padrão usado por etapa do pipeline quando o projeto não especifica outro.
    </p>

    <div class="max-w-xl space-y-4">
      <div
        v-for="[type, list] in types"
        :key="type"
        class="flex items-center gap-4 rounded-lg border border-slate-800 bg-slate-900/60 p-4"
      >
        <span class="w-36 shrink-0 text-sm text-slate-400">{{ typeLabels[type] ?? type }}</span>
        <select
          :value="currentDefault(list)"
          :disabled="setDefault.isPending.value"
          class="flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm disabled:opacity-50"
          @change="onChange"
        >
          <option value="" disabled>— sem padrão definido —</option>
          <option v-for="p in list" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </div>
    </div>

    <p v-if="setDefault.error.value" class="mt-4 text-sm text-rose-400">
      {{ setDefault.error.value.message }}
    </p>
    <p class="mt-6 text-xs text-slate-600">
      A configuração individual de cada plugin (URLs, modelos, chaves de API) fica na tela
      <RouterLink to="/plugins" class="text-sky-400 hover:underline">Plugins</RouterLink>.
    </p>
  </div>
</template>
