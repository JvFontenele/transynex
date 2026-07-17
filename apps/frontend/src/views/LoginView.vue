<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const email = ref('');
const password = ref('');
const error = ref('');
const pending = ref(false);

async function submit() {
  pending.value = true;
  error.value = '';
  try {
    await auth.login(email.value, password.value);
    router.push((route.query.redirect as string) ?? '/');
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Falha no login';
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center">
    <div class="w-full max-w-sm">
      <div class="mb-6 text-center">
        <h1 class="text-3xl font-bold tracking-tight">
          Trans<span class="text-sky-400">ynex</span>
        </h1>
        <p class="mt-1 text-sm text-slate-500">The Open Translation Orchestrator</p>
      </div>

      <form
        class="rounded-lg border border-slate-800 bg-slate-900/60 p-6"
        @submit.prevent="submit"
      >
        <label class="mb-1 block text-xs text-slate-500">E-mail</label>
        <input
          v-model="email"
          type="email"
          required
          autofocus
          autocomplete="username"
          class="mb-3 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-sky-500"
        />
        <label class="mb-1 block text-xs text-slate-500">Senha</label>
        <input
          v-model="password"
          type="password"
          required
          autocomplete="current-password"
          class="mb-4 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-sky-500"
        />

        <button
          :disabled="pending"
          class="w-full rounded-md bg-sky-600 px-4 py-2 text-sm font-medium hover:bg-sky-500 disabled:opacity-50"
        >
          {{ pending ? 'Entrando…' : 'Entrar' }}
        </button>
        <p v-if="error" class="mt-3 text-sm text-rose-400">{{ error }}</p>
      </form>
    </div>
  </div>
</template>
