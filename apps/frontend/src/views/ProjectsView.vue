<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { api } from '../api';
import { useAuthStore } from '../stores/auth';
import { languageName, timeAgo } from '../lib/labels';
import StatusBadge from '../components/StatusBadge.vue';
import EmptyState from '../components/EmptyState.vue';
import LanguageSelect from '../components/LanguageSelect.vue';

// VIEWER é somente-leitura: esconde criar/excluir (o backend também bloqueia)
const auth = useAuthStore();
const queryClient = useQueryClient();
const projects = useQuery({ queryKey: ['projects'], queryFn: api.listProjects });

const showForm = ref(false);
const form = reactive({ name: '', sourceLanguage: 'en', targetLanguage: 'pt-BR' });

const create = useMutation({
  mutationFn: () => api.createProject({ ...form }),
  onSuccess: () => {
    form.name = '';
    showForm.value = false;
    queryClient.invalidateQueries({ queryKey: ['projects'] });
  },
});

// Exclusão em duas etapas: primeiro clique arma, segundo confirma.
const confirmingDelete = ref<string | null>(null);
const remove = useMutation({
  mutationFn: (id: string) => api.deleteProject(id),
  onSuccess: () => {
    confirmingDelete.value = null;
    queryClient.invalidateQueries({ queryKey: ['projects'] });
  },
});

function onDeleteClick(id: string) {
  if (confirmingDelete.value === id) remove.mutate(id);
  else confirmingDelete.value = id;
}
</script>

<template>
  <div>
    <div class="mb-6 flex items-center justify-between">
      <h2 class="text-2xl font-semibold">Projetos</h2>
      <button
        v-if="auth.canEdit"
        class="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium hover:bg-sky-500"
        @click="showForm = !showForm"
      >
        {{ showForm ? 'Cancelar' : '+ Novo projeto' }}
      </button>
    </div>

    <form
      v-if="showForm"
      class="mb-8 rounded-lg border border-slate-800 bg-slate-900/60 p-4"
      @submit.prevent="create.mutate()"
    >
      <div class="flex flex-wrap items-end gap-3">
        <label class="min-w-48 flex-1 text-sm">
          <span class="mb-1 block text-slate-400">Nome do projeto</span>
          <input
            v-model="form.name"
            required
            autofocus
            placeholder="Ex: Mangá capítulo 12"
            class="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-sky-500"
          />
        </label>
        <label class="w-44 text-sm">
          <span class="mb-1 block text-slate-400">Traduzir de</span>
          <LanguageSelect v-model="form.sourceLanguage" />
        </label>
        <label class="w-44 text-sm">
          <span class="mb-1 block text-slate-400">Para</span>
          <LanguageSelect v-model="form.targetLanguage" />
        </label>
        <button
          type="submit"
          :disabled="create.isPending.value"
          class="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium hover:bg-sky-500 disabled:opacity-50"
        >
          {{ create.isPending.value ? 'Criando…' : 'Criar' }}
        </button>
      </div>
      <p v-if="create.error.value" class="mt-3 text-sm text-rose-400">
        {{ create.error.value.message }}
      </p>
    </form>

    <div v-if="projects.data.value?.length" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <RouterLink
        v-for="p in projects.data.value"
        :key="p.id"
        :to="`/projects/${p.id}`"
        class="group rounded-lg border border-slate-800 bg-slate-900/60 p-4 transition hover:border-sky-800"
      >
        <div class="mb-2 flex items-start justify-between gap-2">
          <p class="font-medium leading-tight">{{ p.name }}</p>
          <StatusBadge :status="p.status" />
        </div>
        <p class="text-xs text-slate-500">
          {{ languageName(p.sourceLanguage) }} → {{ languageName(p.targetLanguage) }}
        </p>
        <div class="mt-3 flex items-center justify-between text-xs text-slate-500">
          <span>{{ p._count?.pages ?? 0 }} página(s) · criado {{ timeAgo(p.createdAt) }}</span>
          <button
            v-if="auth.canEdit"
            class="opacity-0 transition group-hover:opacity-100"
            :class="
              confirmingDelete === p.id
                ? 'rounded bg-rose-600 px-2 py-0.5 font-medium text-white opacity-100'
                : 'text-slate-500 hover:text-rose-400'
            "
            :disabled="remove.isPending.value"
            @click.prevent="onDeleteClick(p.id)"
            @mouseleave="confirmingDelete === p.id && (confirmingDelete = null)"
          >
            {{ confirmingDelete === p.id ? 'Confirmar exclusão?' : 'excluir' }}
          </button>
        </div>
      </RouterLink>
    </div>

    <EmptyState
      v-else-if="projects.isSuccess.value"
      title="Nenhum projeto ainda"
      hint="Crie um projeto para começar a traduzir mangás, quadrinhos e documentos."
    >
      <button
        v-if="auth.canEdit"
        class="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium hover:bg-sky-500"
        @click="showForm = true"
      >
        + Criar primeiro projeto
      </button>
    </EmptyState>
  </div>
</template>
