<script setup lang="ts">
import { computed, ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { api } from '@/api';
import { JOB_STATUS_LABELS, JOB_TYPE_LABELS, timeAgo } from '@/lib/labels';
import StatusBadge from '@/components/StatusBadge.vue';
import EmptyState from '@/components/EmptyState.vue';
import { useJobsStore } from '@/stores/jobs';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

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
  <div class="flex flex-col gap-6">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Fila de processamento</h1>
        <p class="text-sm text-muted-foreground">Jobs do pipeline, atualizados ao vivo.</p>
      </div>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        :spacing="1"
        class="flex-wrap"
        :model-value="statusFilter ?? 'all'"
        @update:model-value="(v) => (statusFilter = !v || v === 'all' ? null : String(v))"
      >
        <ToggleGroupItem value="all">Todos ({{ merged.length }})</ToggleGroupItem>
        <ToggleGroupItem v-for="s in FILTERS" :key="s" :value="s">
          {{ JOB_STATUS_LABELS[s] }} ({{ counts[s] ?? 0 }})
        </ToggleGroupItem>
      </ToggleGroup>
    </div>

    <div v-if="jobs.isPending.value" class="flex flex-col gap-2">
      <Skeleton v-for="i in 5" :key="i" class="h-10" />
    </div>

    <div v-else-if="filtered.length" class="rounded-xl border">
      <Table class="min-w-xl">
        <TableHeader>
          <TableRow>
            <TableHead>Etapa</TableHead>
            <TableHead>Projeto</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Progresso</TableHead>
            <TableHead>Quando</TableHead>
            <TableHead>Erro</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="j in filtered" :key="j.id">
            <TableCell>{{ JOB_TYPE_LABELS[j.type] ?? j.type }}</TableCell>
            <TableCell>
              <RouterLink
                v-if="projectName[j.projectId]"
                :to="`/projects/${j.projectId}`"
                class="font-medium underline-offset-4 hover:underline"
              >
                {{ projectName[j.projectId] }}
              </RouterLink>
              <span v-else class="font-mono text-xs text-muted-foreground">{{ j.projectId.slice(-8) }}</span>
            </TableCell>
            <TableCell><StatusBadge :status="j.status" /></TableCell>
            <TableCell class="w-44">
              <Progress :model-value="Math.min(Math.max(j.progress, 0), 100)" />
            </TableCell>
            <TableCell class="text-xs text-muted-foreground">
              {{ timeAgo(j.finishedAt ?? j.createdAt) }}
            </TableCell>
            <TableCell class="max-w-64 text-xs text-destructive" :title="j.error ?? ''">
              <p class="truncate">{{ j.error ?? '' }}</p>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <EmptyState
      v-else-if="jobs.isSuccess.value"
      :title="statusFilter ? 'Nenhum job com esse status' : 'Nenhum job na fila'"
      hint="Os jobs aparecem aqui quando você envia arquivos ou clica em Traduzir num projeto."
    />
  </div>
</template>
