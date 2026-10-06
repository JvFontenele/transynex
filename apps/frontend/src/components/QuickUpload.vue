<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useQueryClient } from '@tanstack/vue-query';
import { ArrowRightIcon, UploadIcon } from '@lucide/vue';
import { toast } from 'vue-sonner';
import { api } from '@/api';
import LanguageSelect from '@/components/LanguageSelect.vue';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { cn, useStoredLangs } from '@/lib/utils';

// Envio rápido: um arquivo vira um projeto implícito e já entra na fila.
const router = useRouter();
const queryClient = useQueryClient();

const { from, to } = useStoredLangs();

const ACCEPT = 'image/png,image/jpeg,image/webp,image/tiff,application/pdf,.cbz,.zip,.epub';
const dragging = ref(false);
const sending = ref(false);
const input = ref<HTMLInputElement>();

async function send(file: File | undefined) {
  if (!file || sending.value) return;
  if (!from.value || !to.value) {
    toast.error('Escolha os idiomas de origem e destino');
    return;
  }
  sending.value = true;
  try {
    const { projectId } = await api.quickUpload(file, from.value, to.value);
    queryClient.invalidateQueries({ queryKey: ['projects'] });
    toast.success(`"${file.name}" enviado — traduzindo`);
    router.push(`/projects/${projectId}`);
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Falha no envio');
  } finally {
    sending.value = false;
    if (input.value) input.value.value = '';
  }
}

function onDrop(e: DragEvent) {
  dragging.value = false;
  send(e.dataTransfer?.files[0]);
}
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>Traduzir um arquivo</CardTitle>
      <CardDescription>
        Imagem, HQ (CBZ/ZIP), PDF ou EPUB. Sem precisar criar projeto antes — ele é criado e traduzido
        automaticamente.
      </CardDescription>
    </CardHeader>
    <CardContent class="flex flex-col gap-4">
      <div class="flex flex-wrap items-end gap-3">
        <Field class="w-full sm:w-56">
          <FieldLabel>De</FieldLabel>
          <LanguageSelect v-model="from" />
        </Field>
        <ArrowRightIcon class="mb-2.5 hidden text-muted-foreground sm:block" />
        <Field class="w-full sm:w-56">
          <FieldLabel>Para</FieldLabel>
          <LanguageSelect v-model="to" />
        </Field>
      </div>
      <button
        type="button"
        :class="
          cn(
            'flex min-h-36 flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-6 text-center transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
            dragging && 'border-primary bg-muted/50',
          )
        "
        :disabled="sending"
        @click="input?.click()"
        @dragover.prevent="dragging = true"
        @dragleave="dragging = false"
        @drop.prevent="onDrop"
      >
        <Spinner v-if="sending" />
        <UploadIcon v-else class="text-muted-foreground" />
        <span class="text-sm font-medium">
          {{ sending ? 'Enviando…' : 'Arraste um arquivo ou clique para escolher' }}
        </span>
        <span class="text-xs text-muted-foreground">PNG, JPEG, WEBP, TIFF, PDF, CBZ, ZIP, EPUB</span>
      </button>
      <input
        ref="input"
        type="file"
        class="hidden"
        :accept="ACCEPT"
        @change="send(($event.target as HTMLInputElement).files?.[0])"
      />
      <div class="flex justify-end">
        <Button variant="link" size="sm" as-child>
          <RouterLink to="/projects">Prefere organizar em projetos? Criar projeto</RouterLink>
        </Button>
      </div>
    </CardContent>
  </Card>
</template>
