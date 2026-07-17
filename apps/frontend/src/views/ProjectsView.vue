<script setup lang="ts">
import { reactive } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { api } from '../api';

const queryClient = useQueryClient();
const projects = useQuery({ queryKey: ['projects'], queryFn: api.listProjects });

const form = reactive({ name: '', sourceLanguage: 'en', targetLanguage: 'pt' });

const create = useMutation({
  mutationFn: () => api.createProject({ ...form }),
  onSuccess: () => {
    form.name = '';
    queryClient.invalidateQueries({ queryKey: ['projects'] });
  },
});

const remove = useMutation({
  mutationFn: (id: string) => api.deleteProject(id),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
});

const statusColors: Record<string, string> = {
  DRAFT: 'bg-slate-500/15 text-slate-400',
  PROCESSING: 'bg-amber-500/15 text-amber-400',
  READY: 'bg-emerald-500/15 text-emerald-400',
  ERROR: 'bg-rose-500/15 text-rose-400',
};
</script>

<template>
  <div>
    <h2 class="text-2xl font-semibold mb-6">Projetos</h2>

    <form
      class="mb-8 flex items-end gap-3 rounded-lg border border-slate-800 bg-slate-900/60 p-4"
      @submit.prevent="create.mutate()"
    >
      <label class="flex-1 text-sm">
        <span class="mb-1 block text-slate-400">Nome</span>
        <input
          v-model="form.name"
          required
          placeholder="Ex: Mangá capítulo 12"
          class="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-sky-500"
        />
      </label>
      <label class="text-sm">
        <span class="mb-1 block text-slate-400">De</span>
        <input
          v-model="form.sourceLanguage"
          required
          size="4"
          class="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-sky-500"
        />
      </label>
      <label class="text-sm">
        <span class="mb-1 block text-slate-400">Para</span>
        <input
          v-model="form.targetLanguage"
          required
          size="4"
          class="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-sky-500"
        />
      </label>
      <button
        type="submit"
        :disabled="create.isPending.value"
        class="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium hover:bg-sky-500 disabled:opacity-50"
      >
        Criar projeto
      </button>
    </form>
    <p v-if="create.error.value" class="mb-4 text-sm text-rose-400">
      {{ create.error.value.message }}
    </p>

    <div v-if="projects.data.value?.length" class="space-y-2">
      <RouterLink
        v-for="p in projects.data.value"
        :key="p.id"
        :to="`/projects/${p.id}`"
        class="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/60 p-4 hover:border-slate-700"
      >
        <div>
          <p class="font-medium">{{ p.name }}</p>
          <p class="text-xs text-slate-500">
            {{ p.sourceLanguage }} → {{ p.targetLanguage }} · {{ p._count?.pages ?? 0 }} página(s)
          </p>
        </div>
        <div class="flex items-center gap-3">
          <span class="rounded-full px-2 py-0.5 text-xs" :class="statusColors[p.status]">
            {{ p.status }}
          </span>
          <button
            class="text-xs text-slate-500 hover:text-rose-400"
            @click.prevent="remove.mutate(p.id)"
          >
            excluir
          </button>
        </div>
      </RouterLink>
    </div>
    <p v-else-if="projects.isSuccess.value" class="text-slate-500">
      Nenhum projeto ainda — crie o primeiro acima.
    </p>
  </div>
</template>
