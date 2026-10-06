<script setup lang="ts">
import { ref } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { CopyIcon, KeyRoundIcon, PlusIcon, Trash2Icon } from '@lucide/vue';
import { toast } from 'vue-sonner';
import { api } from '@/api';
import { timeAgo } from '@/lib/labels';
import EmptyState from '@/components/EmptyState.vue';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const queryClient = useQueryClient();
const keys = useQuery({ queryKey: ['api-keys'], queryFn: api.listApiKeys });

const name = ref('');
// O segredo só existe na resposta da criação; some ao sair da tela.
const created = ref<string | null>(null);

const create = useMutation({
  mutationFn: () => api.createApiKey(name.value.trim()),
  onSuccess: (res) => {
    created.value = res.key;
    name.value = '';
    queryClient.invalidateQueries({ queryKey: ['api-keys'] });
  },
  onError: (e) => toast.error(e instanceof Error ? e.message : 'Erro ao criar chave'),
});

const remove = useMutation({
  mutationFn: (id: string) => api.deleteApiKey(id),
  onSuccess: () => {
    toast.success('Chave revogada');
    queryClient.invalidateQueries({ queryKey: ['api-keys'] });
  },
  onError: (e) => toast.error(e instanceof Error ? e.message : 'Erro ao revogar'),
});

async function copy(text: string) {
  await navigator.clipboard.writeText(text);
  toast.success('Copiado');
}

const curlExample = `curl -H "Authorization: Bearer <sua-chave>" \\
  -F image=@pagina.png \\
  "${location.origin}/api/v1/translate/image?sourceLanguage=ja&targetLanguage=pt-BR&render=1"`;
</script>

<template>
  <div class="flex flex-col gap-6">
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">Minha conta</h1>
      <p class="text-sm text-muted-foreground">
        Chaves de API para usar o Transynex de fora: extensão de navegador, scripts e integrações.
      </p>
    </div>

    <Alert v-if="created">
      <KeyRoundIcon />
      <AlertTitle>Copie a chave agora — ela não será mostrada de novo</AlertTitle>
      <AlertDescription class="flex flex-wrap items-center gap-2">
        <code class="rounded bg-muted px-2 py-1 font-mono text-xs break-all">{{ created }}</code>
        <Button size="sm" variant="outline" @click="copy(created)">
          <CopyIcon data-icon="inline-start" />
          Copiar
        </Button>
      </AlertDescription>
    </Alert>

    <Card>
      <CardHeader>
        <CardTitle>Chaves de API</CardTitle>
        <CardDescription>
          A chave age com as suas permissões. Revogue as que não usar mais.
        </CardDescription>
      </CardHeader>
      <CardContent class="flex flex-col gap-4">
        <form class="flex flex-wrap items-end gap-2" @submit.prevent="name.trim() && create.mutate()">
          <Field class="w-full sm:w-72">
            <FieldLabel for="key-name">Nome</FieldLabel>
            <Input id="key-name" v-model="name" placeholder="ex: extensão do Chrome" required />
          </Field>
          <Button type="submit" :disabled="create.isPending.value">
            <PlusIcon data-icon="inline-start" />
            Criar chave
          </Button>
        </form>

        <div v-if="keys.isLoading.value" class="flex flex-col gap-2">
          <Skeleton v-for="n in 2" :key="n" class="h-10" />
        </div>
        <EmptyState v-else-if="!keys.data.value?.length" title="Nenhuma chave criada" />
        <Table v-else>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Chave</TableHead>
              <TableHead>Último uso</TableHead>
              <TableHead>Criada</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="k in keys.data.value" :key="k.id">
              <TableCell class="font-medium">{{ k.name }}</TableCell>
              <TableCell class="font-mono text-xs text-muted-foreground">{{ k.prefix }}…</TableCell>
              <TableCell class="text-muted-foreground">
                {{ k.lastUsedAt ? timeAgo(k.lastUsedAt) : 'nunca' }}
              </TableCell>
              <TableCell class="text-muted-foreground">{{ timeAgo(k.createdAt) }}</TableCell>
              <TableCell class="text-right">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Revogar chave"
                  :disabled="remove.isPending.value"
                  @click="remove.mutate(k.id)"
                >
                  <Trash2Icon />
                </Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
      <CardFooter class="flex flex-col items-start gap-2">
        <p class="text-sm font-medium">Exemplo: traduzir uma imagem</p>
        <pre class="w-full overflow-x-auto rounded-lg bg-muted p-3 text-xs">{{ curlExample }}</pre>
      </CardFooter>
    </Card>
  </div>
</template>
