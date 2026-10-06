<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useQueryClient } from '@tanstack/vue-query';
import { ArrowRightIcon, FileIcon } from '@lucide/vue';
import { toast } from 'vue-sonner';
import { api } from '@/api';
import EmptyState from '@/components/EmptyState.vue';
import LanguageSelect from '@/components/LanguageSelect.vue';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { useStoredLangs } from '@/lib/utils';

// Aberta por apps externos (app de arquivo do Cloudreve):
// /import?src=<url temporária do arquivo>&name=<nome do arquivo>
const route = useRoute();
const router = useRouter();
const queryClient = useQueryClient();

const src = computed(() => String(route.query.src ?? ''));
const name = computed(() => String(route.query.name ?? ''));
const { from, to } = useStoredLangs();
const sending = ref<'run' | 'create' | null>(null);

async function send(run: boolean) {
  if (sending.value) return;
  if (!from.value || !to.value) {
    toast.error('Escolha os idiomas de origem e destino');
    return;
  }
  sending.value = run ? 'run' : 'create';
  try {
    const { projectId } = await api.quickImport(src.value, name.value, from.value, to.value, run);
    queryClient.invalidateQueries({ queryKey: ['projects'] });
    toast.success(run ? `"${name.value}" importado — traduzindo` : `Projeto criado a partir de "${name.value}"`);
    router.replace(`/projects/${projectId}`);
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Falha na importação');
  } finally {
    sending.value = null;
  }
}
</script>

<template>
  <EmptyState v-if="!src" title="Nada para importar" hint="Abra esta tela a partir de um arquivo no Cloudreve." />
  <Card v-else class="mx-auto max-w-xl">
    <CardHeader>
      <CardTitle>Importar arquivo</CardTitle>
      <CardDescription class="flex items-center gap-2">
        <FileIcon class="size-4 shrink-0" />
        <span class="truncate">{{ name || src }}</span>
      </CardDescription>
    </CardHeader>
    <CardContent class="flex flex-wrap items-end gap-3">
      <Field class="w-full sm:w-48">
        <FieldLabel>De</FieldLabel>
        <LanguageSelect v-model="from" />
      </Field>
      <ArrowRightIcon class="mb-2.5 hidden text-muted-foreground sm:block" />
      <Field class="w-full sm:w-48">
        <FieldLabel>Para</FieldLabel>
        <LanguageSelect v-model="to" />
      </Field>
    </CardContent>
    <CardFooter class="flex flex-wrap justify-end gap-2">
      <Button variant="outline" :disabled="!!sending" @click="send(false)">
        <Spinner v-if="sending === 'create'" />
        Só criar projeto
      </Button>
      <Button :disabled="!!sending" @click="send(true)">
        <Spinner v-if="sending === 'run'" />
        Traduzir agora
      </Button>
    </CardFooter>
  </Card>
</template>
