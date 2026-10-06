<script setup lang="ts">
import { useRoute } from 'vue-router';
import { useColorMode } from '@vueuse/core';
import 'vue-sonner/style.css';
import AppSidebar from '@/components/AppSidebar.vue';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { Toaster } from '@/components/ui/sonner';

// O socket conecta após login/restore (auth store), não no mount.
const route = useRoute();
// Aplica a classe .dark/.light no <html> (padrão: segue o sistema).
useColorMode();
</script>

<template>
  <!-- Até o guard resolver a 1ª rota, meta vem vazio: não desenha layout nenhum -->
  <template v-if="!route.matched.length" />
  <RouterView v-else-if="route.meta.public || route.meta.immersive" />
  <SidebarProvider v-else>
    <AppSidebar />
    <SidebarInset>
      <header
        class="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur"
      >
        <SidebarTrigger class="-ml-1" />
        <Separator orientation="vertical" class="mr-2 data-[orientation=vertical]:h-4 data-[orientation=vertical]:self-center" />
        <span class="text-sm text-muted-foreground">{{ route.meta.title ?? '' }}</span>
      </header>
      <main
        class="mx-auto w-full min-w-0 flex-1 p-4 sm:p-6 lg:p-8"
        :class="route.meta.wide ? '' : 'max-w-6xl'"
      >
        <RouterView />
      </main>
    </SidebarInset>
  </SidebarProvider>
  <Toaster rich-colors position="top-right" />
</template>
