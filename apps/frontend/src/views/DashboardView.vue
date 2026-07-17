<script setup lang="ts">
import { computed } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { api } from '../api';
import { languageName, PROVIDER_TYPE_LABELS, timeAgo } from '../lib/labels';
import StatusBadge from '../components/StatusBadge.vue';
import EmptyState from '../components/EmptyState.vue';

const providers = useQuery({ queryKey: ['providers'], queryFn: api.listProviders });
const health = useQuery({
  queryKey: ['providers-health'],
  queryFn: api.providersHealth,
  refetchInterval: 15000,
});
const projects = useQuery({ queryKey: ['projects'], queryFn: api.listProjects });
const jobs = useQuery({ queryKey: ['jobs'], queryFn: () => api.listJobs(), refetchInterval: 10000 });

const activeJobs = computed(
  () =>
    jobs.data.value?.filter((j) => j.status === 'active' || j.status === 'queued').length ?? null,
);
const failedJobs = computed(
  () => jobs.data.value?.filter((j) => j.status === 'failed').length ?? null,
);
const recentProjects = computed(() => projects.data.value?.slice(0, 5) ?? []);
</script>

<template>
  <div>
    <div class="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-2xl font-semibold">Dashboard</h2>
      <RouterLink
        to="/projects"
        class="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium hover:bg-sky-500"
      >
        + Novo projeto
      </RouterLink>
    </div>

    <div class="mb-8 grid gap-4 sm:grid-cols-3">
      <RouterLink
        to="/projects"
        class="rounded-lg border border-slate-800 bg-slate-900/60 p-4 transition hover:border-sky-800"
      >
        <p class="text-sm text-slate-400">Projetos</p>
        <p class="text-3xl font-bold">{{ projects.data.value?.length ?? '—' }}</p>
      </RouterLink>
      <RouterLink
        to="/queue"
        class="rounded-lg border border-slate-800 bg-slate-900/60 p-4 transition hover:border-sky-800"
      >
        <p class="text-sm text-slate-400">Em processamento</p>
        <p class="text-3xl font-bold" :class="activeJobs ? 'text-sky-400' : ''">
          {{ activeJobs ?? '—' }}
        </p>
      </RouterLink>
      <RouterLink
        to="/queue"
        class="rounded-lg border border-slate-800 bg-slate-900/60 p-4 transition hover:border-sky-800"
      >
        <p class="text-sm text-slate-400">Jobs com falha</p>
        <p class="text-3xl font-bold" :class="failedJobs ? 'text-rose-400' : ''">
          {{ failedJobs ?? '—' }}
        </p>
      </RouterLink>
    </div>

    <div class="grid gap-8 lg:grid-cols-2">
      <!-- Projetos recentes -->
      <section>
        <h3 class="mb-3 text-lg font-medium">Projetos recentes</h3>
        <div v-if="recentProjects.length" class="space-y-2">
          <RouterLink
            v-for="p in recentProjects"
            :key="p.id"
            :to="`/projects/${p.id}`"
            class="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/60 p-3 transition hover:border-sky-800"
          >
            <div class="min-w-0">
              <p class="truncate font-medium">{{ p.name }}</p>
              <p class="text-xs text-slate-500">
                {{ languageName(p.sourceLanguage) }} → {{ languageName(p.targetLanguage) }} ·
                {{ p._count?.pages ?? 0 }} página(s) · {{ timeAgo(p.createdAt) }}
              </p>
            </div>
            <StatusBadge :status="p.status" />
          </RouterLink>
        </div>
        <EmptyState
          v-else-if="projects.isSuccess.value"
          title="Nenhum projeto ainda"
          hint="Crie o primeiro em Projetos."
        />
      </section>

      <!-- Saúde dos providers -->
      <section>
        <h3 class="mb-3 text-lg font-medium">Providers</h3>
        <div v-if="providers.data.value" class="space-y-4">
          <div v-for="(list, type) in providers.data.value" :key="type">
            <template v-if="list.length">
              <p class="mb-2 text-xs uppercase tracking-wide text-slate-500">
                {{ PROVIDER_TYPE_LABELS[type] ?? type }}
              </p>
              <div class="space-y-2">
                <div
                  v-for="p in list"
                  :key="p.id"
                  class="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2.5"
                >
                  <div class="min-w-0">
                    <p class="truncate text-sm font-medium">
                      {{ p.name }}
                      <span
                        v-if="p.isDefault"
                        class="ml-1.5 rounded bg-sky-950 px-1.5 py-0.5 text-[10px] font-medium text-sky-400"
                      >
                        padrão
                      </span>
                    </p>
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
            </template>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
