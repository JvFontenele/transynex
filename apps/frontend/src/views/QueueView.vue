<script setup lang="ts">
import { computed, ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { api } from '../api';
import { JOB_STATUS_LABELS, JOB_TYPE_LABELS, timeAgo } from '../lib/labels';
import StatusBadge from '../components/StatusBadge.vue';
import ProgressBar from '../components/ProgressBar.vue';
import EmptyState from '../components/EmptyState.vue';
import { useJobsStore } from '../stores/jobs';

const jobsStore = useJobsStore();
const jobs = useQuery({
  queryKey: ['jobs'],
  queryFn: () => api.listJobs(),
  refetchInterval: 10000,
});
const projects = useQuery({ queryKey: ['projects'], queryFn: api.listProjects });

const projectName = computed(() => {
  const map: Record<string, string> = {};
  for (const p of projects.data.value ?? []) map[p.id] = p.name;
  return map;
});

// Snapshot do banco + eventos ao vivo do Socket.IO por cima.
const merged = computed(() =>
  (jobs.data.value ?? []).map((j) => ({
    ...j,
    ...(jobsStore.live[j.id] ?? {}),
  })),
);

const statusFilter = ref<string | null>(null);
const filtered = computed(() =>
  statusFilter.value ? merged.value.filter((j) => j.status === statusFilter.value) : merged.value,
);

const counts = computed(() => {
  const c: Record<string, number> = {};
  for (const j of merged.value) c[j.status] = (c[j.status] ?? 0) + 1;
  return c;
});

const FILTERS = ['active', 'queued', 'completed', 'failed'];
</script>

<template>
  <div>
    <div class="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-2xl font-semibold">Fila de processamento</h2>
      <div class="flex gap-1.5">
        <button
          class="rounded-full border px-3 py-1 text-xs transition"
          :class="
            statusFilter === null
              ? 'border-sky-600 bg-sky-600/15 text-sky-300'
              : 'border-slate-700 text-slate-400 hover:border-slate-500'
          "
          @click="statusFilter = null"
        >
          Todos ({{ merged.length }})
        </button>
        <button
          v-for="s in FILTERS"
          :key="s"
          class="rounded-full border px-3 py-1 text-xs transition"
          :class="
            statusFilter === s
              ? 'border-sky-600 bg-sky-600/15 text-sky-300'
              : 'border-slate-700 text-slate-400 hover:border-slate-500'
          "
          @click="statusFilter = statusFilter === s ? null : s"
        >
          {{ JOB_STATUS_LABELS[s] }} ({{ counts[s] ?? 0 }})
        </button>
      </div>
    </div>

    <div v-if="filtered.length" class="overflow-x-auto">
    <table class="w-full min-w-xl text-sm">
      <thead>
        <tr class="border-b border-slate-800 text-left text-xs text-slate-500">
          <th class="py-2 pr-4 font-normal">Etapa</th>
          <th class="py-2 pr-4 font-normal">Projeto</th>
          <th class="py-2 pr-4 font-normal">Status</th>
          <th class="py-2 pr-4 font-normal">Progresso</th>
          <th class="py-2 pr-4 font-normal">Quando</th>
          <th class="py-2 font-normal">Erro</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="j in filtered" :key="j.id" class="border-b border-slate-800/50">
          <td class="py-2.5 pr-4">{{ JOB_TYPE_LABELS[j.type] ?? j.type }}</td>
          <td class="py-2.5 pr-4">
            <RouterLink
              v-if="projectName[j.projectId]"
              :to="`/projects/${j.projectId}`"
              class="text-sky-400 hover:underline"
            >
              {{ projectName[j.projectId] }}
            </RouterLink>
            <span v-else class="font-mono text-xs text-slate-500">{{ j.projectId.slice(-8) }}</span>
          </td>
          <td class="py-2.5 pr-4"><StatusBadge :status="j.status" /></td>
          <td class="w-44 py-2.5 pr-4">
            <ProgressBar :progress="j.progress" :failed="j.status === 'failed'" />
          </td>
          <td class="whitespace-nowrap py-2.5 pr-4 text-xs text-slate-500">
            {{ timeAgo(j.finishedAt ?? j.createdAt) }}
          </td>
          <td class="max-w-64 py-2.5 text-xs text-rose-400" :title="j.error ?? ''">
            <p class="truncate">{{ j.error ?? '' }}</p>
          </td>
        </tr>
      </tbody>
    </table>
    </div>

    <EmptyState
      v-else-if="jobs.isSuccess.value"
      :title="statusFilter ? 'Nenhum job com esse status' : 'Nenhum job na fila'"
      hint="Os jobs aparecem aqui quando você envia arquivos ou clica em Traduzir num projeto."
    />
  </div>
</template>
