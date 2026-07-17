<script setup lang="ts">
defineProps<{ title: string; hint?: string }>();
</script>

<template>
  <div
    class="rounded-lg border border-dashed border-slate-800 bg-slate-900/30 px-6 py-10 text-center"
  >
    <p class="text-slate-400">{{ title }}</p>
    <p v-if="hint" class="mt-1 text-sm text-slate-600">{{ hint }}</p>
    <div v-if="$slots.default" class="mt-4">
      <slot />
    </div>
  </div>
</template>
