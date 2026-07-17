<script setup lang="ts">
defineProps<{ progress: number; failed?: boolean }>();
</script>

<template>
  <div class="h-1.5 w-full rounded bg-slate-800">
    <div
      class="h-1.5 rounded transition-all"
      :class="failed ? 'bg-rose-500' : 'bg-sky-500'"
      :style="{ width: `${Math.min(Math.max(progress, 0), 100)}%` }"
    />
  </div>
</template>
