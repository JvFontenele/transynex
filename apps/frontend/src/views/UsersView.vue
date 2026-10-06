<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { PlusIcon } from '@lucide/vue';
import { api, type Role, type User } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { timeAgo } from '@/lib/labels';
import EmptyState from '@/components/EmptyState.vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const ROLE_OPTIONS: { value: Role; label: string; hint: string }[] = [
  { value: 'ADMIN', label: 'Admin', hint: 'Tudo, incluindo usuários e configurações' },
  { value: 'EDITOR', label: 'Editor', hint: 'Cria e edita os próprios projetos' },
  { value: 'VIEWER', label: 'Leitor', hint: 'Somente leitura de todos os projetos' },
];

const auth = useAuthStore();
const queryClient = useQueryClient();
const users = useQuery({ queryKey: ['users'], queryFn: api.listUsers });

const error = ref('');
const refresh = () => {
  error.value = '';
  queryClient.invalidateQueries({ queryKey: ['users'] });
};
const onError = (e: unknown) => {
  error.value = e instanceof Error ? e.message : 'Erro inesperado';
};

// Criação
const showForm = ref(false);
const form = reactive({ email: '', password: '', role: 'EDITOR' as Role });
const create = useMutation({
  mutationFn: () => api.createUser({ ...form }),
  onSuccess: () => {
    form.email = '';
    form.password = '';
    form.role = 'EDITOR';
    showForm.value = false;
    refresh();
  },
  onError,
});

const changeRole = useMutation({
  mutationFn: ({ id, role }: { id: string; role: Role }) => api.updateUser(id, { role }),
  onSuccess: refresh,
  onError,
});

// Redefinição de senha por admin (sem exigir a senha atual do usuário)
const resettingId = ref<string | null>(null);
const resetPassword = ref('');
const reset = useMutation({
  mutationFn: () => api.updateUser(resettingId.value!, { password: resetPassword.value }),
  onSuccess: () => {
    resettingId.value = null;
    resetPassword.value = '';
    refresh();
  },
  onError,
});

// Exclusão em duas etapas, mesmo padrão da tela de projetos
const confirmingDelete = ref<string | null>(null);
const remove = useMutation({
  mutationFn: (id: string) => api.deleteUser(id),
  onSuccess: () => {
    confirmingDelete.value = null;
    refresh();
  },
  onError,
});

function onDeleteClick(id: string) {
  if (confirmingDelete.value === id) remove.mutate(id);
  else confirmingDelete.value = id;
}

const isSelf = (u: User) => u.id === auth.user?.id;
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Usuários</h1>
        <p class="text-sm text-muted-foreground">Contas com acesso e seus papéis.</p>
      </div>
      <div class="flex gap-2">
        <Button :variant="showForm ? 'outline' : 'default'" @click="showForm = !showForm">
          <PlusIcon v-if="!showForm" data-icon="inline-start" />
          {{ showForm ? 'Cancelar' : 'Novo usuário' }}
        </Button>
      </div>
    </div>

    <Alert v-if="error" variant="destructive">
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <Card v-if="showForm">
      <CardHeader>
        <CardTitle>Novo usuário</CardTitle>
        <CardDescription>
          Admin: tudo · Editor: cria e edita os próprios projetos · Leitor: somente leitura
        </CardDescription>
      </CardHeader>
      <form @submit.prevent="create.mutate()">
        <CardContent>
          <FieldGroup class="grid gap-4 sm:grid-cols-[1fr_1fr_10rem]">
            <Field>
              <FieldLabel for="user-email">Email</FieldLabel>
              <Input id="user-email" v-model="form.email" type="email" required />
            </Field>
            <Field>
              <FieldLabel for="user-password">Senha (mín. 8 caracteres)</FieldLabel>
              <Input
                id="user-password"
                v-model="form.password"
                type="password"
                required
                minlength="8"
                autocomplete="new-password"
              />
            </Field>
            <Field>
              <FieldLabel for="user-role">Papel</FieldLabel>
              <Select v-model="form.role">
                <SelectTrigger id="user-role" class="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem v-for="r in ROLE_OPTIONS" :key="r.value" :value="r.value" :title="r.hint">
                      {{ r.label }}
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter class="mt-4 justify-end">
          <Button type="submit" :disabled="create.isPending.value">
            <Spinner v-if="create.isPending.value" data-icon="inline-start" />
            Criar
          </Button>
        </CardFooter>
      </form>
    </Card>

    <EmptyState v-if="users.data.value && users.data.value.length === 0" title="Nenhum usuário" />

    <div v-else-if="users.data.value" class="rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Email</TableHead>
            <TableHead>Papel</TableHead>
            <TableHead>Projetos</TableHead>
            <TableHead>Criado</TableHead>
            <TableHead class="text-right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="u in users.data.value" :key="u.id">
            <TableCell>
              <div class="flex items-center gap-2">
                {{ u.email }}
                <Badge v-if="isSelf(u)" variant="secondary">você</Badge>
              </div>
            </TableCell>
            <TableCell>
              <Select
                :model-value="u.role"
                :disabled="changeRole.isPending.value"
                @update:model-value="(v) => changeRole.mutate({ id: u.id, role: v as Role })"
              >
                <SelectTrigger size="sm" class="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem v-for="r in ROLE_OPTIONS" :key="r.value" :value="r.value">
                      {{ r.label }}
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </TableCell>
            <TableCell class="text-muted-foreground">{{ u._count?.projects ?? 0 }}</TableCell>
            <TableCell class="text-muted-foreground">{{ timeAgo(u.createdAt) }}</TableCell>
            <TableCell class="text-right">
              <form
                v-if="resettingId === u.id"
                class="inline-flex items-center gap-1.5"
                @submit.prevent="reset.mutate()"
              >
                <Input
                  v-model="resetPassword"
                  type="password"
                  required
                  minlength="8"
                  placeholder="Nova senha"
                  autocomplete="new-password"
                  class="h-7 w-36"
                />
                <Button type="submit" size="sm">OK</Button>
                <Button type="button" variant="ghost" size="sm" @click="resettingId = null">
                  Cancelar
                </Button>
              </form>
              <div v-else class="inline-flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  @click="
                    resettingId = u.id;
                    resetPassword = '';
                  "
                >
                  Redefinir senha
                </Button>
                <Button
                  v-if="!isSelf(u)"
                  :variant="confirmingDelete === u.id ? 'destructive' : 'ghost'"
                  size="sm"
                  @click="onDeleteClick(u.id)"
                >
                  {{ confirmingDelete === u.id ? 'Confirmar exclusão?' : 'Excluir' }}
                </Button>
              </div>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <div v-else class="flex flex-col gap-2">
      <Skeleton v-for="i in 4" :key="i" class="h-10" />
    </div>
  </div>
</template>
