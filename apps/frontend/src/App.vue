<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from './api';
import { useAuthStore } from './stores/auth';
import { useJobsStore } from './stores/jobs';

// O socket conecta após login/restore (auth store), não no mount.
const jobs = useJobsStore();
const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

async function logout() {
  await auth.logout();
  router.push({ name: 'login' });
}

// Menu lateral vira drawer em telas pequenas.
const sidebarOpen = ref(false);
watch(() => route.fullPath, () => (sidebarOpen.value = false));

// Troca de senha (modal simples, sem dependência de UI lib)
const showPassword = ref(false);
const currentPassword = ref('');
const newPassword = ref('');
const passwordError = ref('');
const passwordOk = ref(false);

async function changePassword() {
  passwordError.value = '';
  passwordOk.value = false;
  try {
    await api.changePassword(currentPassword.value, newPassword.value);
    passwordOk.value = true;
    currentPassword.value = '';
    newPassword.value = '';
    setTimeout(() => (showPassword.value = false), 1200);
  } catch (e) {
    passwordError.value = e instanceof Error ? e.message : 'Erro ao trocar senha';
  }
}

// Ícones inline (paths de 24x24, stroke) para não adicionar dependência.
const allNav: { to: string; label: string; icon: string; adminOnly?: boolean }[] = [
  {
    to: '/',
    label: 'Dashboard',
    icon: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z',
  },
  {
    to: '/projects',
    label: 'Projetos',
    icon: 'M4 6a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6z',
  },
  {
    to: '/queue',
    label: 'Fila',
    icon: 'M4 6h16M4 12h16M4 18h10',
  },
  {
    to: '/plugins',
    label: 'Plugins',
    icon: 'M12 3v4m0 0a3 3 0 1 0 3 3m-3-3a3 3 0 1 1-3 3m9 0h-4m-8 0H3m9 4v4',
  },
  {
    to: '/users',
    label: 'Usuários',
    icon: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.9M15 3.1a4 4 0 0 1 0 7.8M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0z',
    adminOnly: true,
  },
  {
    to: '/settings',
    label: 'Configurações',
    icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7-3a7 7 0 0 1-.1 1.2l2 1.6-2 3.4-2.4-1a7 7 0 0 1-2 1.2L14 21h-4l-.5-2.6a7 7 0 0 1-2-1.2l-2.4 1-2-3.4 2-1.6A7 7 0 0 1 5 12a7 7 0 0 1 .1-1.2l-2-1.6 2-3.4 2.4 1a7 7 0 0 1 2-1.2L10 3h4l.5 2.6a7 7 0 0 1 2 1.2l2.4-1 2 3.4-2 1.6c.06.4.1.8.1 1.2z',
    adminOnly: true,
  },
];

const nav = computed(() => allNav.filter((item) => !item.adminOnly || auth.isAdmin));
</script>

<template>
  <div class="min-h-screen bg-slate-950 text-slate-100">
    <!-- Topbar mobile com hamburger -->
    <header
      v-if="!route.meta.public && !route.meta.immersive"
      class="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-800 bg-slate-950/90 px-4 py-3 backdrop-blur lg:hidden"
    >
      <button
        class="rounded-md p-1.5 text-slate-300 hover:bg-slate-800"
        aria-label="Abrir menu"
        @click="sidebarOpen = true"
      >
        <svg
          viewBox="0 0 24 24"
          class="h-5 w-5"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
        >
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      <RouterLink to="/" class="text-lg font-bold tracking-tight">
        Trans<span class="text-sky-400">ynex</span>
      </RouterLink>
    </header>

    <div class="flex">
      <!-- Backdrop do drawer mobile -->
      <div
        v-if="sidebarOpen && !route.meta.public && !route.meta.immersive"
        class="fixed inset-0 z-40 bg-black/60 lg:hidden"
        @click="sidebarOpen = false"
      />

      <aside
        v-if="!route.meta.public && !route.meta.immersive"
        class="fixed inset-y-0 left-0 z-50 flex h-screen w-56 shrink-0 flex-col border-r border-slate-800 bg-slate-900 p-4 transition-transform duration-200 lg:sticky lg:top-0 lg:z-auto lg:translate-x-0 lg:bg-slate-900/60 lg:transition-none"
        :class="sidebarOpen ? 'translate-x-0' : '-translate-x-full'"
      >
        <RouterLink to="/" class="mb-6 block">
          <h1 class="text-xl font-bold tracking-tight">
            Trans<span class="text-sky-400">ynex</span>
          </h1>
          <p class="text-[11px] text-slate-500">The Open Translation Orchestrator</p>
        </RouterLink>

        <nav class="space-y-1">
          <RouterLink
            v-for="item in nav"
            :key="item.to"
            :to="item.to"
            class="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
            exact-active-class="bg-slate-800 text-white font-medium"
          >
            <svg
              viewBox="0 0 24 24"
              class="h-4 w-4 shrink-0 text-slate-500"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path :d="item.icon" />
            </svg>
            {{ item.label }}
          </RouterLink>
        </nav>

        <div class="mt-auto space-y-3 pt-6">
          <div
            class="flex items-center gap-2 px-3 text-xs text-slate-500"
            :title="
              jobs.connected
                ? 'Recebendo atualizações de jobs em tempo real'
                : 'Sem conexão em tempo real — os dados podem demorar a atualizar'
            "
          >
            <span
              class="h-2 w-2 rounded-full"
              :class="jobs.connected ? 'bg-emerald-400' : 'bg-rose-500'"
            />
            {{ jobs.connected ? 'Tempo real ativo' : 'Desconectado' }}
          </div>
          <div
            v-if="auth.user"
            class="space-y-1 border-t border-slate-800 px-3 pt-3 text-xs text-slate-500"
          >
            <p class="truncate" :title="auth.user.email">{{ auth.user.email }}</p>
            <div class="flex items-center justify-between gap-2">
              <span class="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                {{ auth.user.role }}
              </span>
              <span class="flex gap-2">
                <button class="text-slate-400 hover:underline" @click="showPassword = true">
                  Senha
                </button>
                <button class="text-sky-400 hover:underline" @click="logout">Sair</button>
              </span>
            </div>
          </div>
        </div>
      </aside>

      <main class="min-w-0 flex-1" :class="route.meta.immersive ? '' : 'p-4 sm:p-8'">
        <RouterView />
      </main>
    </div>

    <!-- Modal de troca de senha -->
    <div
      v-if="showPassword"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      @click.self="showPassword = false"
    >
      <form
        class="w-80 max-w-full space-y-3 rounded-lg border border-slate-800 bg-slate-900 p-5"
        @submit.prevent="changePassword"
      >
        <h2 class="text-sm font-semibold">Trocar senha</h2>
        <input
          v-model="currentPassword"
          type="password"
          required
          placeholder="Senha atual"
          autocomplete="current-password"
          class="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-sky-500"
        />
        <input
          v-model="newPassword"
          type="password"
          required
          minlength="8"
          placeholder="Nova senha (mín. 8 caracteres)"
          autocomplete="new-password"
          class="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-sky-500"
        />
        <p v-if="passwordError" class="text-xs text-rose-400">{{ passwordError }}</p>
        <p v-if="passwordOk" class="text-xs text-emerald-400">Senha alterada!</p>
        <div class="flex justify-end gap-2 text-sm">
          <button
            type="button"
            class="rounded px-3 py-1.5 text-slate-400 hover:bg-slate-800"
            @click="showPassword = false"
          >
            Cancelar
          </button>
          <button type="submit" class="rounded bg-sky-600 px-3 py-1.5 font-medium hover:bg-sky-500">
            Salvar
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
