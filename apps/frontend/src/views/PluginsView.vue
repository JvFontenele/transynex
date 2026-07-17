<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { api, type ConfigField, type ProviderInfo } from '../api';
import { PROVIDER_TYPE_LABELS } from '../lib/labels';

const queryClient = useQueryClient();
const providers = useQuery({ queryKey: ['providers'], queryFn: api.listProviders });
const health = useQuery({
  queryKey: ['providers-health'],
  queryFn: api.providersHealth,
  refetchInterval: 15000,
});

// Form aberto por provider: valores editados a partir do configSchema
const open = ref<string | null>(null);
const form = reactive<Record<string, unknown>>({});

function fields(p: ProviderInfo): Array<[string, ConfigField]> {
  return Object.entries(p.configSchema?.properties ?? {});
}

function toggle(p: ProviderInfo) {
  if (open.value === p.id) {
    open.value = null;
    return;
  }
  open.value = p.id;
  Object.keys(form).forEach((k) => delete form[k]);
  for (const [key, field] of fields(p)) {
    // secrets nunca são ecoados: campo começa vazio (vazio = manter atual)
    form[key] = field.format === 'secret' ? '' : (p.config[key] ?? '');
  }
}

const save = useMutation({
  mutationFn: (providerId: string) => api.configureProvider(providerId, { ...form }),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['providers'] });
    queryClient.invalidateQueries({ queryKey: ['providers-health'] });
  },
});

const setDefault = useMutation({
  mutationFn: (providerId: string) => api.setDefaultProvider(providerId),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['providers'] }),
});
</script>

<template>
  <div>
    <h2 class="mb-1 text-2xl font-semibold">Plugins</h2>
    <p class="mb-6 text-sm text-slate-500">
      Providers instalados por etapa do pipeline. Configure URLs, modelos e chaves de cada um aqui.
    </p>

    <div v-for="(list, type) in providers.data.value" :key="type" class="mb-8">
      <template v-if="list.length">
        <h3 class="mb-3 text-sm font-medium uppercase tracking-wide text-slate-500">
          {{ PROVIDER_TYPE_LABELS[type] ?? type }}
        </h3>
        <div class="space-y-3">
          <div
            v-for="p in list"
            :key="p.id"
            class="rounded-lg border border-slate-800 bg-slate-900/60"
          >
            <div class="flex items-center gap-3 p-4">
              <span
                class="h-2 w-2 shrink-0 rounded-full"
                :class="health.data.value?.[p.id]?.healthy ? 'bg-emerald-400' : 'bg-rose-500'"
                :title="health.data.value?.[p.id]?.message"
              />
              <div class="min-w-0">
                <p class="font-medium">
                  {{ p.name }}
                  <span class="ml-1 text-xs font-normal text-slate-500">v{{ p.version }}</span>
                  <span
                    v-if="p.isDefault"
                    class="ml-2 rounded bg-sky-950 px-1.5 py-0.5 text-[10px] font-medium text-sky-400"
                  >
                    padrão
                  </span>
                  <span
                    v-if="p.requiresNetwork"
                    class="ml-1 rounded bg-amber-950 px-1.5 py-0.5 text-[10px] text-amber-400"
                  >
                    requer internet
                  </span>
                </p>
                <p class="truncate text-xs text-slate-500">{{ p.description }}</p>
              </div>
              <div class="ml-auto flex shrink-0 items-center gap-2">
                <button
                  v-if="!p.isDefault"
                  :disabled="setDefault.isPending.value"
                  class="rounded-md border border-slate-700 px-2.5 py-1 text-xs hover:border-sky-600 disabled:opacity-50"
                  @click="setDefault.mutate(p.id)"
                >
                  Tornar padrão
                </button>
                <button
                  v-if="fields(p).length"
                  class="rounded-md border border-slate-700 px-2.5 py-1 text-xs hover:border-sky-600"
                  @click="toggle(p)"
                >
                  {{ open === p.id ? 'Fechar' : 'Configurar' }}
                </button>
              </div>
            </div>

            <!-- Form dinâmico gerado do configSchema -->
            <form
              v-if="open === p.id"
              class="border-t border-slate-800 p-4"
              @submit.prevent="save.mutate(p.id)"
            >
              <div class="grid gap-4 sm:grid-cols-2">
                <div v-for="[key, field] in fields(p)" :key="key">
                  <label class="mb-1 block text-xs text-slate-500">
                    {{ key }}
                    <span v-if="field.description" class="text-slate-600">
                      — {{ field.description }}</span
                    >
                  </label>
                  <select
                    v-if="field.enum"
                    v-model="form[key]"
                    class="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                  >
                    <option v-for="opt in field.enum" :key="String(opt)" :value="opt">
                      {{ opt }}
                    </option>
                  </select>
                  <input
                    v-else-if="field.type === 'boolean'"
                    v-model="form[key]"
                    type="checkbox"
                    class="h-4 w-4 accent-sky-500"
                  />
                  <input
                    v-else-if="field.type === 'number' || field.type === 'integer'"
                    v-model.number="form[key]"
                    type="number"
                    step="any"
                    :placeholder="field.default != null ? String(field.default) : ''"
                    class="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                  />
                  <input
                    v-else
                    v-model="form[key]"
                    :type="field.format === 'secret' ? 'password' : 'text'"
                    :placeholder="
                      field.format === 'secret'
                        ? p.definedSecrets.includes(key)
                          ? '••••• (definido — deixe vazio para manter)'
                          : 'não definido'
                        : field.default != null
                          ? String(field.default)
                          : ''
                    "
                    autocomplete="off"
                    class="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                  />
                </div>
              </div>
              <div class="mt-4 flex items-center gap-3">
                <button
                  :disabled="save.isPending.value"
                  class="rounded-md bg-sky-600 px-4 py-1.5 text-sm font-medium hover:bg-sky-500 disabled:opacity-50"
                >
                  {{ save.isPending.value ? 'Salvando…' : 'Salvar' }}
                </button>
                <p v-if="save.error.value" class="text-xs text-rose-400">
                  {{ save.error.value.message }}
                </p>
              </div>
            </form>
          </div>
        </div>
      </template>
    </div>

    <p v-if="providers.isPending.value" class="text-slate-500">Carregando…</p>
  </div>
</template>
