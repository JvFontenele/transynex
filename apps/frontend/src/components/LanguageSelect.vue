<script setup lang="ts">
import { computed } from 'vue';
import { LANGUAGES } from '@/lib/labels';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// Select de idioma com nomes legíveis + opção "Outro…" que vira campo livre
// (LLMs traduzem qualquer par, então códigos fora da lista são válidos).
const model = defineModel<string>({ required: true });

const isKnown = computed(() => LANGUAGES.some((l) => l.code === model.value));
</script>

<template>
  <div class="flex gap-1.5">
    <Select
      :model-value="isKnown ? model : '__other'"
      @update:model-value="(v) => (model = v === '__other' ? '' : String(v))"
    >
      <SelectTrigger class="w-full min-w-0">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem v-for="l in LANGUAGES" :key="l.code" :value="l.code">{{ l.name }}</SelectItem>
          <SelectItem value="__other">Outro…</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
    <Input
      v-if="!isKnown"
      v-model="model"
      required
      placeholder="código"
      title="Código ISO 639-1, ex: vi, th, id"
      class="w-20 shrink-0"
    />
  </div>
</template>
