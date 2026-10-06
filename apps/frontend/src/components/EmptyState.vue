<script setup lang="ts">
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';

defineProps<{ title: string; hint?: string }>();
</script>

<template>
  <Empty class="border border-dashed">
    <EmptyHeader>
      <EmptyTitle>{{ title }}</EmptyTitle>
      <EmptyDescription v-if="hint">{{ hint }}</EmptyDescription>
    </EmptyHeader>
    <EmptyContent v-if="$slots.default">
      <slot />
    </EmptyContent>
  </Empty>
</template>
