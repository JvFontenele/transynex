<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useAuthStore } from './stores/auth';
import { useJobsStore } from './stores/jobs';

// O socket conecta após login/restore (auth store), não no mount.
const jobs = useJobsStore();
const auth = useAuthStore();
const router = useRouter();

async function logout() {
  await auth.logout();
  router.push({ name: 'login' });
}

const nav = [
  { to: '/', label: 'Dashboard' },
  { to: '/projects', label: 'Projetos' },
  { to: '/queue', label: 'Fila' },
  { to: '/plugins', label: 'Plugins' },
  { to: '/settings', label: 'Configurações' },
];
</script>

<template>
  <div class="min-h-screen bg-slate-950 text-slate-100">
    <div class="flex">
      <aside class="w-56 min-h-screen border-r border-slate-800 bg-slate-900/60 p-4">
        <RouterLink to="/" class="block mb-6">
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
            class="block rounded-md px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
            exact-active-class="bg-slate-800 text-white font-medium"
          >
            {{ item.label }}
          </RouterLink>
        </nav>
        <div class="mt-6 flex items-center gap-2 px-3 text-xs text-slate-500">
          <span
            class="h-2 w-2 rounded-full"
            :class="jobs.connected ? 'bg-emerald-400' : 'bg-rose-500'"
          />
          {{ jobs.connected ? 'Conectado' : 'Desconectado' }}
        </div>
        <div v-if="auth.user" class="mt-4 px-3 text-xs text-slate-500">
          <p class="truncate" :title="auth.user.email">{{ auth.user.email }}</p>
          <button class="mt-1 text-sky-400 hover:underline" @click="logout">Sair</button>
        </div>
      </aside>
      <main class="flex-1 p-8">
        <RouterView />
      </main>
    </div>
  </div>
</template>
