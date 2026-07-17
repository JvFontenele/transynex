<script setup lang="ts">
import { computed } from 'vue';
import { JOB_STATUS_LABELS, PROJECT_STATUS_LABELS, STATUS_TONES } from '../lib/labels';

const props = defineProps<{ status: string }>();

const label = computed(
  () => JOB_STATUS_LABELS[props.status] ?? PROJECT_STATUS_LABELS[props.status] ?? props.status,
);
const tone = computed(() => STATUS_TONES[props.status] ?? 'bg-slate-500/15 text-slate-400');
</script>

<template>
  <span class="whitespace-nowrap rounded-full px-2 py-0.5 text-xs" :class="tone">{{ label }}</span>
</template>
