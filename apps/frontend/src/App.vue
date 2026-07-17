<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router';
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

// Ícones inline (paths de 24x24, stroke) para não adicionar dependência.
const nav = [
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
    to: '/settings',
    label: 'Configurações',
    icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7-3a7 7 0 0 1-.1 1.2l2 1.6-2 3.4-2.4-1a7 7 0 0 1-2 1.2L14 21h-4l-.5-2.6a7 7 0 0 1-2-1.2l-2.4 1-2-3.4 2-1.6A7 7 0 0 1 5 12a7 7 0 0 1 .1-1.2l-2-1.6 2-3.4 2.4 1a7 7 0 0 1 2-1.2L10 3h4l.5 2.6a7 7 0 0 1 2 1.2l2.4-1 2 3.4-2 1.6c.06.4.1.8.1 1.2z',
  },
];
</script>

<template>
  <div class="min-h-screen bg-slate-950 text-slate-100">
    <div class="flex">
      <aside
        v-if="!route.meta.public && !route.meta.immersive"
        class="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r border-slate-800 bg-slate-900/60 p-4"
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
            class="flex items-center justify-between gap-2 border-t border-slate-800 px-3 pt-3 text-xs text-slate-500"
          >
            <p class="truncate" :title="auth.user.email">{{ auth.user.email }}</p>
            <button class="shrink-0 text-sky-400 hover:underline" @click="logout">Sair</button>
          </div>
        </div>
      </aside>

      <main class="min-w-0 flex-1" :class="route.meta.immersive ? '' : 'p-8'">
        <RouterView />
      </main>
    </div>
  </div>
</template>
