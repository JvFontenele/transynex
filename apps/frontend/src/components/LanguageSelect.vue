<script setup lang="ts">
import { computed } from 'vue';
import { LANGUAGES } from '../lib/labels';

// Select de idioma com nomes legíveis + opção "Outro…" que vira campo livre
// (LLMs traduzem qualquer par, então códigos fora da lista são válidos).
const model = defineModel<string>({ required: true });

const isKnown = computed(() => LANGUAGES.some((l) => l.code === model.value));
</script>

<template>
  <div class="flex gap-1.5">
    <select
      :value="isKnown ? model : '__other'"
      class="w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm outline-none focus:border-sky-500"
      @change="
        model =
          ($event.target as HTMLSelectElement).value === '__other'
            ? ''
            : ($event.target as HTMLSelectElement).value
      "
    >
      <option v-for="l in LANGUAGES" :key="l.code" :value="l.code">{{ l.name }}</option>
      <option value="__other">Outro…</option>
    </select>
    <input
      v-if="!isKnown"
      v-model="model"
      required
      placeholder="código"
      size="5"
      title="Código ISO 639-1, ex: vi, th, id"
      class="rounded-md border border-slate-700 bg-slate-950 px-2 py-2 text-sm outline-none focus:border-sky-500"
    />
  </div>
</template>
