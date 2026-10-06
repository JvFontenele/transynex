<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { PlusIcon, Trash2Icon } from '@lucide/vue';
import { api, type ProjectKind } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { languageName, PROJECT_KIND_LABELS, timeAgo } from '@/lib/labels';
import StatusBadge from '@/components/StatusBadge.vue';
import EmptyState from '@/components/EmptyState.vue';
import LanguageSelect from '@/components/LanguageSelect.vue';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  CardAction,
} from '@/components/ui/card';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

// VIEWER é somente-leitura: esconde criar/excluir (o backend também bloqueia)
const auth = useAuthStore();
const queryClient = useQueryClient();
const projects = useQuery({ queryKey: ['projects'], queryFn: api.listProjects });

const showForm = ref(false);
const form = reactive({
  name: '',
  kind: 'IMAGE' as ProjectKind,
  sourceLanguage: 'en',
  targetLanguage: 'pt-BR',
});

// O tipo define o pipeline e a tela do projeto — não muda depois de criado.
const KINDS: Array<{ value: ProjectKind; label: string; hint: string }> = [
  {
    value: 'IMAGE',
    label: 'Imagem / Mangá',
    hint: 'A tradução é desenhada de volta na página.',
  },
  {
    value: 'DOCUMENT',
    label: 'Documento',
    hint: 'Lê o texto do PDF e mostra a tradução em texto corrido.',
  },
];

const create = useMutation({
  mutationFn: () => api.createProject({ ...form }),
  onSuccess: () => {
    form.name = '';
    showForm.value = false;
    queryClient.invalidateQueries({ queryKey: ['projects'] });
  },
});

// Exclusão em duas etapas: primeiro clique arma, segundo confirma.
const confirmingDelete = ref<string | null>(null);
const remove = useMutation({
  mutationFn: (id: string) => api.deleteProject(id),
  onSuccess: () => {
    confirmingDelete.value = null;
    queryClient.invalidateQueries({ queryKey: ['projects'] });
  },
});

function onDeleteClick(id: string) {
  if (confirmingDelete.value === id) remove.mutate(id);
  else confirmingDelete.value = id;
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Projetos</h1>
        <p class="text-sm text-muted-foreground">Mangás, quadrinhos e documentos em tradução.</p>
      </div>
      <div class="flex gap-2">
        <Button
          v-if="auth.canEdit"
          :variant="showForm ? 'outline' : 'default'"
          @click="showForm = !showForm"
        >
          <PlusIcon v-if="!showForm" data-icon="inline-start" />
          {{ showForm ? 'Cancelar' : 'Novo projeto' }}
        </Button>
      </div>
    </div>

    <Card v-if="showForm">
      <CardHeader>
        <CardTitle>Novo projeto</CardTitle>
        <CardDescription>O tipo define o pipeline e não muda depois de criado.</CardDescription>
      </CardHeader>
      <form @submit.prevent="create.mutate()">
        <CardContent>
          <FieldGroup>
            <ToggleGroup
              type="single"
              variant="outline"
              :spacing="2"
              class="grid w-full sm:grid-cols-2"
              :model-value="form.kind"
              @update:model-value="(v) => v && (form.kind = v as ProjectKind)"
            >
              <ToggleGroupItem
                v-for="k in KINDS"
                :key="k.value"
                :value="k.value"
                class="h-auto flex-col items-start gap-0.5 p-3 text-left whitespace-normal"
              >
                <span>{{ k.label }}</span>
                <span class="text-xs font-normal text-muted-foreground">{{ k.hint }}</span>
              </ToggleGroupItem>
            </ToggleGroup>

            <div class="grid gap-4 sm:grid-cols-[1fr_11rem_11rem]">
              <Field>
                <FieldLabel for="project-name">Nome do projeto</FieldLabel>
                <Input
                  id="project-name"
                  v-model="form.name"
                  required
                  autofocus
                  :placeholder="form.kind === 'DOCUMENT' ? 'Ex: Manual do equipamento' : 'Ex: Mangá capítulo 12'"
                />
              </Field>
              <Field>
                <FieldLabel>Traduzir de</FieldLabel>
                <LanguageSelect v-model="form.sourceLanguage" />
              </Field>
              <Field>
                <FieldLabel>Para</FieldLabel>
                <LanguageSelect v-model="form.targetLanguage" />
              </Field>
            </div>
            <FieldError v-if="create.error.value">{{ create.error.value.message }}</FieldError>
          </FieldGroup>
        </CardContent>
        <CardFooter class="mt-4 justify-end">
          <Button type="submit" :disabled="create.isPending.value">
            <Spinner v-if="create.isPending.value" data-icon="inline-start" />
            {{ create.isPending.value ? 'Criando…' : 'Criar' }}
          </Button>
        </CardFooter>
      </form>
    </Card>

    <div v-if="projects.isPending.value" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <Skeleton v-for="i in 3" :key="i" class="h-32 rounded-xl" />
    </div>

    <div v-else-if="projects.data.value?.length" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <RouterLink
        v-for="p in projects.data.value"
        :key="p.id"
        :to="`/projects/${p.id}`"
        class="group rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <Card class="h-full transition-colors group-hover:bg-muted/40">
          <CardHeader>
            <CardTitle class="leading-tight">{{ p.name }}</CardTitle>
            <CardDescription>
              {{ PROJECT_KIND_LABELS[p.kind] ?? p.kind }} ·
              {{ languageName(p.sourceLanguage) }} → {{ languageName(p.targetLanguage) }}
            </CardDescription>
            <CardAction><StatusBadge :status="p.status" /></CardAction>
          </CardHeader>
          <CardContent
            class="mt-auto flex min-h-7 items-center justify-between gap-2 text-xs text-muted-foreground"
          >
            <span v-if="p.kind === 'DOCUMENT'">criado {{ timeAgo(p.createdAt) }}</span>
            <span v-else>{{ p._count?.pages ?? 0 }} página(s) · criado {{ timeAgo(p.createdAt) }}</span>
            <Button
              v-if="auth.canEdit"
              :variant="confirmingDelete === p.id ? 'destructive' : 'ghost'"
              :size="confirmingDelete === p.id ? 'sm' : 'icon-sm'"
              :class="confirmingDelete === p.id ? '' : 'opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100'"
              :aria-label="confirmingDelete === p.id ? undefined : 'Excluir projeto'"
              :disabled="remove.isPending.value"
              @click.prevent="onDeleteClick(p.id)"
              @mouseleave="confirmingDelete === p.id && (confirmingDelete = null)"
            >
              <template v-if="confirmingDelete === p.id">Confirmar exclusão?</template>
              <Trash2Icon v-else />
            </Button>
          </CardContent>
        </Card>
      </RouterLink>
    </div>

    <EmptyState
      v-else-if="projects.isSuccess.value"
      title="Nenhum projeto ainda"
      hint="Crie um projeto para começar a traduzir mangás, quadrinhos e documentos."
    >
      <Button v-if="auth.canEdit" @click="showForm = true">
        <PlusIcon data-icon="inline-start" />
        Criar primeiro projeto
      </Button>
    </EmptyState>
  </div>
</template>
