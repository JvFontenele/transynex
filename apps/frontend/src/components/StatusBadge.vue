<script setup lang="ts">
import { computed } from 'vue';
import { Badge } from '@/components/ui/badge';
import { JOB_STATUS_LABELS, PROJECT_STATUS_LABELS, STATUS_VARIANTS } from '@/lib/labels';

const props = defineProps<{ status: string }>();

const label = computed(
  () => JOB_STATUS_LABELS[props.status] ?? PROJECT_STATUS_LABELS[props.status] ?? props.status,
);
</script>

<template>
  <Badge :variant="STATUS_VARIANTS[status] ?? 'secondary'">{{ label }}</Badge>
</template>
