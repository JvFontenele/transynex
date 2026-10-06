<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const email = ref('');
const password = ref('');
const error = ref('');
const pending = ref(false);

async function submit() {
  pending.value = true;
  error.value = '';
  try {
    await auth.login(email.value, password.value);
    router.push((route.query.redirect as string) ?? '/');
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Falha no login';
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <div class="flex min-h-svh items-center justify-center bg-muted p-4">
    <Card class="w-full max-w-sm">
      <CardHeader class="text-center">
        <CardTitle class="text-2xl tracking-tight">
          Trans<span class="text-primary">ynex</span>
        </CardTitle>
        <CardDescription>The Open Translation Orchestrator</CardDescription>
      </CardHeader>
      <CardContent>
        <form @submit.prevent="submit">
          <FieldGroup>
            <Field>
              <FieldLabel for="login-email">E-mail</FieldLabel>
              <Input
                id="login-email"
                v-model="email"
                type="email"
                required
                autofocus
                autocomplete="username"
              />
            </Field>
            <Field>
              <FieldLabel for="login-password">Senha</FieldLabel>
              <Input
                id="login-password"
                v-model="password"
                type="password"
                required
                autocomplete="current-password"
              />
            </Field>
            <Field>
              <Button type="submit" :disabled="pending">
                <Spinner v-if="pending" data-icon="inline-start" />
                {{ pending ? 'Entrando…' : 'Entrar' }}
              </Button>
              <FieldError v-if="error">{{ error }}</FieldError>
            </Field>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  </div>
</template>
