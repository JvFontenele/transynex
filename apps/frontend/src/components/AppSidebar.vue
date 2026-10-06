<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useColorMode } from '@vueuse/core';
import {
  ChevronsUpDownIcon,
  CogIcon,
  FolderIcon,
  HouseIcon,
  KeyRoundIcon,
  ListTodoIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  PlugIcon,
  SunIcon,
  UserIcon,
  UsersIcon,
} from '@lucide/vue';
import { toast } from 'vue-sonner';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { useJobsStore } from '@/stores/jobs';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

const jobs = useJobsStore();
const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const { setOpenMobile } = useSidebar();
const { store: colorMode } = useColorMode();

watch(() => route.fullPath, () => setOpenMobile(false));

const allNav = [
  { to: '/', label: 'Início', icon: HouseIcon },
  { to: '/projects', label: 'Projetos', icon: FolderIcon },
  { to: '/queue', label: 'Fila', icon: ListTodoIcon },
  { to: '/plugins', label: 'Plugins', icon: PlugIcon },
  { to: '/users', label: 'Usuários', icon: UsersIcon, adminOnly: true },
  { to: '/settings', label: 'Configurações', icon: CogIcon, adminOnly: true },
];
const nav = computed(() => allNav.filter((item) => !item.adminOnly || auth.isAdmin));

function isActive(to: string) {
  return to === '/' ? route.path === '/' : route.path.startsWith(to);
}

async function logout() {
  await auth.logout();
  router.push({ name: 'login' });
}

const showPassword = ref(false);
const currentPassword = ref('');
const newPassword = ref('');
const passwordError = ref('');

async function changePassword() {
  passwordError.value = '';
  try {
    await api.changePassword(currentPassword.value, newPassword.value);
    currentPassword.value = '';
    newPassword.value = '';
    showPassword.value = false;
    toast.success('Senha alterada');
  } catch (e) {
    passwordError.value = e instanceof Error ? e.message : 'Erro ao trocar senha';
  }
}
</script>

<template>
  <Sidebar collapsible="icon">
    <SidebarHeader>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" as-child>
            <RouterLink to="/">
              <div
                class="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground"
              >
                T
              </div>
              <div class="grid flex-1 text-left leading-tight">
                <span class="truncate font-semibold">Transynex</span>
                <span class="truncate text-xs text-muted-foreground">Translation Orchestrator</span>
              </div>
            </RouterLink>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarHeader>

    <SidebarContent>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem v-for="item in nav" :key="item.to">
              <SidebarMenuButton as-child :is-active="isActive(item.to)" :tooltip="item.label">
                <RouterLink :to="item.to">
                  <component :is="item.icon" />
                  <span>{{ item.label }}</span>
                </RouterLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>

    <SidebarFooter>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            size="sm"
            :tooltip="jobs.connected ? 'Tempo real ativo' : 'Desconectado'"
            class="text-muted-foreground"
          >
            <span
              class="size-2 shrink-0 rounded-full"
              :class="jobs.connected ? 'bg-success' : 'bg-destructive'"
            />
            <span>{{ jobs.connected ? 'Tempo real ativo' : 'Desconectado' }}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem v-if="auth.user">
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <SidebarMenuButton size="lg">
                <Avatar class="size-8 rounded-lg">
                  <AvatarFallback class="rounded-lg">
                    {{ auth.user.email.slice(0, 2).toUpperCase() }}
                  </AvatarFallback>
                </Avatar>
                <div class="grid flex-1 text-left text-sm leading-tight">
                  <span class="truncate">{{ auth.user.email }}</span>
                  <span class="truncate text-xs text-muted-foreground">{{ auth.user.role }}</span>
                </div>
                <ChevronsUpDownIcon class="ml-auto" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" class="w-56">
              <DropdownMenuLabel class="flex items-center gap-2">
                <span class="truncate">{{ auth.user.email }}</span>
                <Badge variant="secondary">{{ auth.user.role }}</Badge>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <SunIcon />
                    Tema
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuRadioGroup v-model="colorMode">
                      <DropdownMenuRadioItem value="light"><SunIcon />Claro</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="dark"><MoonIcon />Escuro</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="auto">
                        <MonitorIcon />Sistema
                      </DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuItem @select="router.push('/account')">
                  <UserIcon />
                  Minha conta e chaves de API
                </DropdownMenuItem>
                <DropdownMenuItem @select="showPassword = true">
                  <KeyRoundIcon />
                  Trocar senha
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem @select="logout">
                  <LogOutIcon />
                  Sair
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
    <SidebarRail />
  </Sidebar>

  <Dialog v-model:open="showPassword">
    <DialogContent class="sm:max-w-sm">
      <form class="flex flex-col gap-4" @submit.prevent="changePassword">
        <DialogHeader>
          <DialogTitle>Trocar senha</DialogTitle>
          <DialogDescription>A nova senha precisa ter pelo menos 8 caracteres.</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel for="current-password">Senha atual</FieldLabel>
            <Input
              id="current-password"
              v-model="currentPassword"
              type="password"
              required
              autocomplete="current-password"
            />
          </Field>
          <Field :data-invalid="!!passwordError || undefined">
            <FieldLabel for="new-password">Nova senha</FieldLabel>
            <Input
              id="new-password"
              v-model="newPassword"
              type="password"
              required
              minlength="8"
              autocomplete="new-password"
              :aria-invalid="!!passwordError || undefined"
            />
            <FieldError v-if="passwordError">{{ passwordError }}</FieldError>
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button type="button" variant="outline" @click="showPassword = false">Cancelar</Button>
          <Button type="submit">Salvar</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
