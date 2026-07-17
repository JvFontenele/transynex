<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { api, type Role, type User } from '../api';
import { useAuthStore } from '../stores/auth';
import { timeAgo } from '../lib/labels';
import EmptyState from '../components/EmptyState.vue';

const ROLE_OPTIONS: { value: Role; label: string; hint: string }[] = [
  { value: 'ADMIN', label: 'Admin', hint: 'Tudo, incluindo usuários e configurações' },
  { value: 'EDITOR', label: 'Editor', hint: 'Cria e edita os próprios projetos' },
  { value: 'VIEWER', label: 'Leitor', hint: 'Somente leitura de todos os projetos' },
];

const auth = useAuthStore();
const queryClient = useQueryClient();
const users = useQuery({ queryKey: ['users'], queryFn: api.listUsers });

const error = ref('');
const refresh = () => {
  error.value = '';
  queryClient.invalidateQueries({ queryKey: ['users'] });
};
const onError = (e: unknown) => {
  error.value = e instanceof Error ? e.message : 'Erro inesperado';
};

// Criação
const showForm = ref(false);
const form = reactive({ email: '', password: '', role: 'EDITOR' as Role });
const create = useMutation({
  mutationFn: () => api.createUser({ ...form }),
  onSuccess: () => {
    form.email = '';
    form.password = '';
    form.role = 'EDITOR';
    showForm.value = false;
    refresh();
  },
  onError,
});

const changeRole = useMutation({
  mutationFn: ({ id, role }: { id: string; role: Role }) => api.updateUser(id, { role }),
  onSuccess: refresh,
  onError,
});

// Redefinição de senha por admin (sem exigir a senha atual do usuário)
const resettingId = ref<string | null>(null);
const resetPassword = ref('');
const reset = useMutation({
  mutationFn: () => api.updateUser(resettingId.value!, { password: resetPassword.value }),
  onSuccess: () => {
    resettingId.value = null;
    resetPassword.value = '';
    refresh();
  },
  onError,
});

// Exclusão em duas etapas, mesmo padrão da tela de projetos
const confirmingDelete = ref<string | null>(null);
const remove = useMutation({
  mutationFn: (id: string) => api.deleteUser(id),
  onSuccess: () => {
    confirmingDelete.value = null;
    refresh();
  },
  onError,
});

function onDeleteClick(id: string) {
  if (confirmingDelete.value === id) remove.mutate(id);
  else confirmingDelete.value = id;
}

const isSelf = (u: User) => u.id === auth.user?.id;
</script>

<template>
  <div>
    <div class="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-2xl font-semibold">Usuários</h2>
      <button
        class="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium hover:bg-sky-500"
        @click="showForm = !showForm"
      >
        {{ showForm ? 'Cancelar' : '+ Novo usuário' }}
      </button>
    </div>

    <p v-if="error" class="mb-4 rounded-md border border-rose-800 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
      {{ error }}
    </p>

    <form
      v-if="showForm"
      class="mb-8 rounded-lg border border-slate-800 bg-slate-900/60 p-4"
      @submit.prevent="create.mutate()"
    >
      <div class="flex flex-wrap items-end gap-3">
        <label class="min-w-48 flex-1 text-sm">
          <span class="mb-1 block text-slate-400">Email</span>
          <input
            v-model="form.email"
            type="email"
            required
            class="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-sky-500"
          />
        </label>
        <label class="min-w-48 flex-1 text-sm">
          <span class="mb-1 block text-slate-400">Senha (mín. 8 caracteres)</span>
          <input
            v-model="form.password"
            type="password"
            required
            minlength="8"
            autocomplete="new-password"
            class="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-sky-500"
          />
        </label>
        <label class="text-sm">
          <span class="mb-1 block text-slate-400">Papel</span>
          <select
            v-model="form.role"
            class="rounded border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-sky-500"
          >
            <option v-for="r in ROLE_OPTIONS" :key="r.value" :value="r.value" :title="r.hint">
              {{ r.label }}
            </option>
          </select>
        </label>
        <button
          type="submit"
          :disabled="create.isPending.value"
          class="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium hover:bg-sky-500 disabled:opacity-50"
        >
          Criar
        </button>
      </div>
      <p class="mt-2 text-xs text-slate-500">
        Admin: tudo · Editor: cria e edita os próprios projetos · Leitor: somente leitura
      </p>
    </form>

    <EmptyState v-if="users.data.value && users.data.value.length === 0" title="Nenhum usuário" />

    <div v-else-if="users.data.value" class="overflow-x-auto rounded-lg border border-slate-800">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-800 bg-slate-900/60 text-xs uppercase text-slate-500">
          <tr>
            <th class="px-4 py-3">Email</th>
            <th class="px-4 py-3">Papel</th>
            <th class="px-4 py-3">Projetos</th>
            <th class="px-4 py-3">Criado</th>
            <th class="px-4 py-3 text-right">Ações</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-800/60">
          <tr v-for="u in users.data.value" :key="u.id" class="hover:bg-slate-900/40">
            <td class="px-4 py-3">
              {{ u.email }}
              <span v-if="isSelf(u)" class="ml-1 text-xs text-slate-500">(você)</span>
            </td>
            <td class="px-4 py-3">
              <select
                :value="u.role"
                :disabled="changeRole.isPending.value"
                class="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs outline-none focus:border-sky-500"
                @change="
                  changeRole.mutate({ id: u.id, role: ($event.target as HTMLSelectElement).value as Role })
                "
              >
                <option v-for="r in ROLE_OPTIONS" :key="r.value" :value="r.value">
                  {{ r.label }}
                </option>
              </select>
            </td>
            <td class="px-4 py-3 text-slate-400">{{ u._count?.projects ?? 0 }}</td>
            <td class="px-4 py-3 text-slate-400">{{ timeAgo(u.createdAt) }}</td>
            <td class="px-4 py-3 text-right">
              <template v-if="resettingId === u.id">
                <form class="inline-flex items-center gap-2" @submit.prevent="reset.mutate()">
                  <input
                    v-model="resetPassword"
                    type="password"
                    required
                    minlength="8"
                    placeholder="Nova senha"
                    autocomplete="new-password"
                    class="w-36 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs outline-none focus:border-sky-500"
                  />
                  <button type="submit" class="text-xs text-sky-400 hover:underline">OK</button>
                  <button
                    type="button"
                    class="text-xs text-slate-500 hover:underline"
                    @click="resettingId = null"
                  >
                    Cancelar
                  </button>
                </form>
              </template>
              <template v-else>
                <button
                  class="mr-3 text-xs text-slate-400 hover:underline"
                  @click="
                    resettingId = u.id;
                    resetPassword = '';
                  "
                >
                  Redefinir senha
                </button>
                <button
                  v-if="!isSelf(u)"
                  class="text-xs hover:underline"
                  :class="confirmingDelete === u.id ? 'font-medium text-rose-400' : 'text-slate-400'"
                  @click="onDeleteClick(u.id)"
                >
                  {{ confirmingDelete === u.id ? 'Confirmar exclusão?' : 'Excluir' }}
                </button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p v-else class="text-sm text-slate-500">Carregando…</p>
  </div>
</template>
