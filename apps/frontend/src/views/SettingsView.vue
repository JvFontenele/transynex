<script setup lang="ts">
import { computed } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { api } from '@/api';
import { PROVIDER_TYPE_LABELS } from '@/lib/labels';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';

const queryClient = useQueryClient();
const providers = useQuery({ queryKey: ['providers'], queryFn: api.listProviders });

// Só tipos com pelo menos um provider instalado
const types = computed(() =>
  Object.entries(providers.data.value ?? {}).filter(([, list]) => list.length > 0),
);

const setDefault = useMutation({
  mutationFn: (providerId: string) => api.setDefaultProvider(providerId),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['providers'] }),
});

function currentDefault(list: { id: string; isDefault: boolean }[]): string {
  return list.find((p) => p.isDefault)?.id ?? '';
}

function onChange(id: unknown) {
  if (typeof id === 'string' && id) setDefault.mutate(id);
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Configurações</h1>
        <p class="text-sm text-muted-foreground">
          Provider padrão usado por etapa do pipeline quando o projeto não especifica outro.
        </p>
      </div>
    </div>

    <Card class="max-w-2xl">
      <CardHeader>
        <CardTitle>Providers padrão</CardTitle>
        <CardDescription>
          A configuração individual de cada plugin (URLs, modelos, chaves de API) fica na tela
          <RouterLink to="/plugins" class="text-foreground underline underline-offset-4">Plugins</RouterLink>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div v-if="providers.isPending.value" class="flex flex-col gap-3">
          <Skeleton v-for="i in 3" :key="i" class="h-8" />
        </div>
        <FieldGroup v-else>
          <Field v-for="[type, list] in types" :key="type" orientation="horizontal">
            <FieldLabel :for="`default-${type}`">{{ PROVIDER_TYPE_LABELS[type] ?? type }}</FieldLabel>
            <Select
              :model-value="currentDefault(list) || undefined"
              :disabled="setDefault.isPending.value"
              @update:model-value="onChange"
            >
              <SelectTrigger :id="`default-${type}`" class="w-44 sm:w-64">
                <SelectValue placeholder="— sem padrão definido —" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem v-for="p in list" :key="p.id" :value="p.id">{{ p.name }}</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        </FieldGroup>
      </CardContent>
    </Card>

    <Alert v-if="setDefault.error.value" variant="destructive" class="max-w-2xl">
      <AlertDescription>{{ setDefault.error.value.message }}</AlertDescription>
    </Alert>
  </div>
</template>
