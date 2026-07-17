<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query';
import { api } from '../api';

const providers = useQuery({ queryKey: ['providers'], queryFn: api.listProviders });
const health = useQuery({
  queryKey: ['providers-health'],
  queryFn: api.providersHealth,
  refetchInterval: 15000,
});
const projects = useQuery({ queryKey: ['projects'], queryFn: api.listProjects });
const jobs = useQuery({ queryKey: ['jobs'], queryFn: () => api.listJobs(), refetchInterval: 10000 });

const typeLabels: Record<string, string> = {
  ocr: 'OCR',
  translation: 'Tradução',
  storage: 'Armazenamento',
};
</script>

<template>
  <div>
    <h2 class="text-2xl font-semibold mb-6">Dashboard</h2>

    <div class="grid grid-cols-3 gap-4 mb-8">
      <div class="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
        <p class="text-sm text-slate-400">Projetos</p>
        <p class="text-3xl font-bold">{{ projects.data.value?.length ?? '—' }}</p>
      </div>
      <div class="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
        <p class="text-sm text-slate-400">Jobs (últimos 100)</p>
        <p class="text-3xl font-bold">{{ jobs.data.value?.length ?? '—' }}</p>
      </div>
      <div class="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
        <p class="text-sm text-slate-400">Jobs com falha</p>
        <p class="text-3xl font-bold text-rose-400">
          {{ jobs.data.value?.filter((j) => j.status === 'failed').length ?? '—' }}
        </p>
      </div>
    </div>

    <h3 class="text-lg font-medium mb-3">Providers</h3>
    <div v-if="providers.data.value" class="space-y-4">
      <div v-for="(list, type) in providers.data.value" :key="type">
        <p class="text-sm text-slate-400 mb-2">{{ typeLabels[type] ?? type }}</p>
        <div class="grid grid-cols-2 gap-3">
          <div
            v-for="p in list"
            :key="p.id"
            class="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/60 p-3"
          >
            <div>
              <p class="font-medium">{{ p.name }}</p>
              <p class="text-xs text-slate-500">{{ p.id }} · v{{ p.version }}</p>
            </div>
            <span
              v-if="health.data.value"
              class="rounded-full px-2 py-0.5 text-xs"
              :class="
                health.data.value[p.id]?.healthy
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : 'bg-rose-500/15 text-rose-400'
              "
              :title="health.data.value[p.id]?.message"
            >
              {{ health.data.value[p.id]?.healthy ? 'online' : 'offline' }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
