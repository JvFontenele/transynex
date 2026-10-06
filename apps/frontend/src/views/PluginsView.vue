<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { api, type ConfigField, type ProviderInfo } from '@/api';
import { PROVIDER_TYPE_LABELS } from '@/lib/labels';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

const queryClient = useQueryClient();
const providers = useQuery({ queryKey: ['providers'], queryFn: api.listProviders });
const health = useQuery({
  queryKey: ['providers-health'],
  queryFn: api.providersHealth,
  refetchInterval: 15000,
});

// Form aberto por provider: valores editados a partir do configSchema
const open = ref<string | null>(null);
const form = reactive<Record<string, unknown>>({});

function fields(p: ProviderInfo): Array<[string, ConfigField]> {
  return Object.entries(p.configSchema?.properties ?? {});
}

function toggle(p: ProviderInfo) {
  if (open.value === p.id) {
    open.value = null;
    return;
  }
  open.value = p.id;
  Object.keys(form).forEach((k) => delete form[k]);
  for (const [key, field] of fields(p)) {
    // secrets nunca são ecoados: campo começa vazio (vazio = manter atual)
    form[key] = field.format === 'secret' ? '' : (p.config[key] ?? '');
  }
}

const save = useMutation({
  mutationFn: (providerId: string) => api.configureProvider(providerId, { ...form }),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['providers'] });
    queryClient.invalidateQueries({ queryKey: ['providers-health'] });
  },
});

const setDefault = useMutation({
  mutationFn: (providerId: string) => api.setDefaultProvider(providerId),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['providers'] }),
});
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Plugins</h1>
        <p class="text-sm text-muted-foreground">
          Providers instalados por etapa do pipeline. Configure URLs, modelos e chaves de cada um aqui.
        </p>
      </div>
    </div>

    <div v-if="providers.isPending.value" class="flex flex-col gap-3">
      <Skeleton v-for="i in 3" :key="i" class="h-20 rounded-xl" />
    </div>

    <template v-for="(list, type) in providers.data.value" :key="type">
      <section v-if="list.length" class="flex flex-col gap-3">
        <h2 class="text-sm font-medium text-muted-foreground">
          {{ PROVIDER_TYPE_LABELS[type] ?? type }}
        </h2>
        <Card v-for="p in list" :key="p.id">
          <CardHeader>
            <CardTitle class="flex flex-wrap items-center gap-2">
              <span
                :class="cn('size-2 shrink-0 rounded-full', health.data.value?.[p.id]?.healthy ? 'bg-success' : 'bg-destructive')"
                :title="health.data.value?.[p.id]?.message"
              />
              {{ p.name }}
              <span class="text-xs font-normal text-muted-foreground">v{{ p.version }}</span>
              <Badge v-if="p.isDefault">padrão</Badge>
              <Badge v-if="p.requiresNetwork" variant="warning">requer internet</Badge>
            </CardTitle>
            <CardDescription class="truncate">{{ p.description }}</CardDescription>
            <CardAction class="flex flex-wrap justify-end gap-2">
              <Button
                v-if="!p.isDefault"
                variant="outline"
                size="sm"
                :disabled="setDefault.isPending.value"
                @click="setDefault.mutate(p.id)"
              >
                Tornar padrão
              </Button>
              <Button
                v-if="fields(p).length"
                :variant="open === p.id ? 'secondary' : 'outline'"
                size="sm"
                @click="toggle(p)"
              >
                {{ open === p.id ? 'Fechar' : 'Configurar' }}
              </Button>
            </CardAction>
          </CardHeader>

          <!-- Form dinâmico gerado do configSchema -->
          <form v-if="open === p.id" @submit.prevent="save.mutate(p.id)">
            <CardContent class="flex flex-col gap-4">
              <Separator />
              <div class="grid gap-4 sm:grid-cols-2">
                <Field v-for="[key, field] in fields(p)" :key="key">
                  <FieldLabel :for="`${p.id}-${key}`" class="font-mono">{{ key }}</FieldLabel>
                  <Select
                    v-if="field.enum"
                    :model-value="form[key] as string"
                    @update:model-value="(v) => (form[key] = v)"
                  >
                    <SelectTrigger :id="`${p.id}-${key}`" class="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem
                          v-for="opt in field.enum"
                          :key="String(opt)"
                          :value="opt as string"
                        >
                          {{ opt }}
                        </SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <Switch
                    v-else-if="field.type === 'boolean'"
                    :id="`${p.id}-${key}`"
                    :model-value="form[key] === true"
                    @update:model-value="(v) => (form[key] = v)"
                  />
                  <Input
                    v-else-if="field.type === 'number' || field.type === 'integer'"
                    :id="`${p.id}-${key}`"
                    :model-value="form[key] as number"
                    type="number"
                    step="any"
                    :placeholder="field.default != null ? String(field.default) : ''"
                    @update:model-value="(v) => (form[key] = v)"
                  />
                  <Input
                    v-else
                    :id="`${p.id}-${key}`"
                    :model-value="form[key] as string"
                    :type="field.format === 'secret' ? 'password' : 'text'"
                    :placeholder="
                      field.format === 'secret'
                        ? p.definedSecrets.includes(key)
                          ? '••••• (definido — deixe vazio para manter)'
                          : 'não definido'
                        : field.default != null
                          ? String(field.default)
                          : ''
                    "
                    autocomplete="off"
                    @update:model-value="(v) => (form[key] = v)"
                  />
                  <FieldDescription v-if="field.description">{{ field.description }}</FieldDescription>
                </Field>
              </div>
              <FieldError v-if="save.error.value">{{ save.error.value.message }}</FieldError>
            </CardContent>
            <CardFooter class="mt-4 justify-end">
              <Button type="submit" :disabled="save.isPending.value">
                <Spinner v-if="save.isPending.value" data-icon="inline-start" />
                {{ save.isPending.value ? 'Salvando…' : 'Salvar' }}
              </Button>
            </CardFooter>
          </form>
        </Card>
      </section>
    </template>
  </div>
</template>
