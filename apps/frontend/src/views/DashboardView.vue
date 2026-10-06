<script setup lang="ts">
import { computed } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { api } from '@/api';
import { languageName, PROVIDER_TYPE_LABELS, timeAgo } from '@/lib/labels';
import { cn } from '@/lib/utils';
import StatusBadge from '@/components/StatusBadge.vue';
import EmptyState from '@/components/EmptyState.vue';
import QuickUpload from '@/components/QuickUpload.vue';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';

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
  <div class="flex flex-col gap-6">
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">Início</h1>
      <p class="text-sm text-muted-foreground">Envie um arquivo para traduzir ou acompanhe o que já está em andamento.</p>
    </div>

    <QuickUpload />

    <div class="grid gap-4 sm:grid-cols-3">
      <RouterLink
        v-for="s in [
          { to: '/projects', label: 'Projetos', value: projects.data.value?.length, tone: '' },
          {
            to: '/queue',
            label: 'Em processamento',
            value: activeJobs,
            tone: activeJobs ? 'text-info' : '',
          },
          {
            to: '/queue',
            label: 'Jobs com falha',
            value: failedJobs,
            tone: failedJobs ? 'text-destructive' : '',
          },
        ]"
        :key="s.label"
        :to="s.to"
        class="group rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <Card class="h-full transition-colors group-hover:bg-muted/50">
          <CardHeader>
            <CardDescription>{{ s.label }}</CardDescription>
            <CardTitle :class="cn('text-3xl font-semibold tabular-nums', s.tone)">
              {{ s.value ?? '—' }}
            </CardTitle>
          </CardHeader>
        </Card>
      </RouterLink>
    </div>

    <div class="grid gap-6 lg:grid-cols-2">
      <!-- Projetos recentes -->
      <Card>
        <CardHeader>
          <CardTitle>Projetos recentes</CardTitle>
        </CardHeader>
        <CardContent>
          <div v-if="recentProjects.length" class="flex flex-col">
            <template v-for="(p, i) in recentProjects" :key="p.id">
              <Separator v-if="i > 0" />
              <RouterLink
                :to="`/projects/${p.id}`"
                class="-mx-2 flex items-center justify-between gap-3 rounded-lg p-2 transition-colors hover:bg-muted/50"
              >
                <div class="min-w-0">
                  <p class="truncate font-medium">{{ p.name }}</p>
                  <p class="text-xs text-muted-foreground">
                    {{ languageName(p.sourceLanguage) }} → {{ languageName(p.targetLanguage) }} ·
                    {{ p._count?.pages ?? 0 }} página(s) · {{ timeAgo(p.createdAt) }}
                  </p>
                </div>
                <StatusBadge :status="p.status" />
              </RouterLink>
            </template>
          </div>
          <EmptyState
            v-else-if="projects.isSuccess.value"
            title="Nenhum projeto ainda"
            hint="Crie o primeiro em Projetos."
          />
          <div v-else class="flex flex-col gap-2">
            <Skeleton v-for="n in 3" :key="n" class="h-12" />
          </div>
        </CardContent>
      </Card>

      <!-- Saúde dos providers -->
      <Card>
        <CardHeader>
          <CardTitle>Providers</CardTitle>
        </CardHeader>
        <CardContent>
          <div v-if="providers.data.value" class="flex flex-col gap-4">
            <template v-for="(list, type) in providers.data.value" :key="type">
              <div v-if="list.length" class="flex flex-col gap-2">
                <p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {{ PROVIDER_TYPE_LABELS[type] ?? type }}
                </p>
                <div class="flex flex-col gap-2">
                  <div
                    v-for="p in list"
                    :key="p.id"
                    class="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                  >
                    <div class="flex min-w-0 items-center gap-1.5">
                      <p class="truncate text-sm font-medium">{{ p.name }}</p>
                      <Badge v-if="p.isDefault" variant="secondary">padrão</Badge>
                    </div>
                    <Badge
                      v-if="health.data.value"
                      :variant="health.data.value[p.id]?.healthy ? 'success' : 'destructive'"
                      :title="health.data.value[p.id]?.message"
                    >
                      {{ health.data.value[p.id]?.healthy ? 'online' : 'offline' }}
                    </Badge>
                  </div>
                </div>
              </div>
            </template>
          </div>
          <div v-else class="flex flex-col gap-2">
            <Skeleton v-for="n in 3" :key="n" class="h-10" />
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
</template>
