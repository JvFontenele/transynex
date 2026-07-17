<script setup lang="ts">
import { computed } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { api } from '../api';
import { useJobsStore } from '../stores/jobs';

const jobsStore = useJobsStore();
const jobs = useQuery({
  queryKey: ['jobs'],
  queryFn: () => api.listJobs(),
  refetchInterval: 10000,
});

// Snapshot do banco + eventos ao vivo do Socket.IO por cima.
const merged = computed(() =>
  (jobs.data.value ?? []).map((j) => ({
    ...j,
    ...(jobsStore.live[j.id] ?? {}),
  })),
);

const statusColors: Record<string, string> = {
  queued: 'bg-slate-500/15 text-slate-400',
  active: 'bg-sky-500/15 text-sky-400',
  completed: 'bg-emerald-500/15 text-emerald-400',
  failed: 'bg-rose-500/15 text-rose-400',
  retrying: 'bg-amber-500/15 text-amber-400',
};
</script>

<template>
  <div>
    <h2 class="text-2xl font-semibold mb-6">Fila</h2>
    <table v-if="merged.length" class="w-full text-sm">
      <thead>
        <tr class="border-b border-slate-800 text-left text-xs text-slate-500">
          <th class="py-2 pr-4 font-normal">Job</th>
          <th class="py-2 pr-4 font-normal">Tipo</th>
          <th class="py-2 pr-4 font-normal">Status</th>
          <th class="py-2 pr-4 font-normal">Progresso</th>
          <th class="py-2 font-normal">Erro</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="j in merged" :key="j.id" class="border-b border-slate-800/50">
          <td class="py-2 pr-4 font-mono text-xs text-slate-400">{{ j.id.slice(-8) }}</td>
          <td class="py-2 pr-4">{{ j.type }}</td>
          <td class="py-2 pr-4">
            <span class="rounded-full px-2 py-0.5 text-xs" :class="statusColors[j.status]">
              {{ j.status }}
            </span>
          </td>
          <td class="py-2 pr-4 w-48">
            <div class="h-1.5 rounded bg-slate-800">
              <div
                class="h-1.5 rounded transition-all"
                :class="j.status === 'failed' ? 'bg-rose-500' : 'bg-sky-500'"
                :style="{ width: `${j.progress}%` }"
              />
            </div>
          </td>
          <td class="py-2 text-xs text-rose-400">{{ j.error ?? '' }}</td>
        </tr>
      </tbody>
    </table>
    <p v-else-if="jobs.isSuccess.value" class="text-slate-500">Nenhum job na fila.</p>
  </div>
</template>
