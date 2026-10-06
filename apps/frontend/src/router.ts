import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from './stores/auth';

declare module 'vue-router' {
  interface RouteMeta {
    public?: boolean;
    immersive?: boolean;
    adminOnly?: boolean;
    title?: string;
    // Editor precisa de largura total (sem max-w do layout)
    wide?: boolean;
  }
}

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('./views/LoginView.vue'),
      meta: { public: true },
    },
    { path: '/', name: 'dashboard', component: () => import('./views/DashboardView.vue'), meta: { title: 'Início' } },
    { path: '/projects', name: 'projects', component: () => import('./views/ProjectsView.vue'), meta: { title: 'Projetos' } },
    {
      path: '/projects/:id',
      name: 'project-detail',
      component: () => import('./views/ProjectDetailView.vue'),
      meta: { title: 'Projeto' },
    },
    {
      // Modo leitura imersivo (sem sidebar): páginas traduzidas empilhadas
      path: '/projects/:id/read',
      name: 'reader',
      component: () => import('./views/ReaderView.vue'),
      meta: { immersive: true },
    },
    {
      // Leitura de projeto DOCUMENT: tradução em texto corrido (± bilíngue)
      path: '/projects/:id/text',
      name: 'document-reader',
      component: () => import('./views/DocumentReaderView.vue'),
      meta: { immersive: true },
    },
    {
      // Leitura de EPUB: o livro original com o texto trocado pela tradução
      path: '/projects/:id/book',
      name: 'book-reader',
      component: () => import('./views/EpubReaderView.vue'),
      meta: { immersive: true },
    },
    {
      path: '/projects/:id/pages/:pageId',
      name: 'page-editor',
      component: () => import('./views/PageEditorView.vue'),
      meta: { title: 'Editor de página', wide: true },
    },
    {
      path: '/account',
      name: 'account',
      component: () => import('./views/AccountView.vue'),
      meta: { title: 'Minha conta' },
    },
    { path: '/queue', name: 'queue', component: () => import('./views/QueueView.vue'), meta: { title: 'Fila' } },
    { path: '/plugins', name: 'plugins', component: () => import('./views/PluginsView.vue'), meta: { title: 'Plugins' } },
    {
      // Configura providers e chaves de API — só ADMIN
      path: '/settings',
      name: 'settings',
      component: () => import('./views/SettingsView.vue'),
      meta: { adminOnly: true, title: 'Configurações' },
    },
    {
      path: '/users',
      name: 'users',
      component: () => import('./views/UsersView.vue'),
      meta: { adminOnly: true, title: 'Usuários' },
    },
  ],
});

router.beforeEach(async (to) => {
  if (to.meta.public) return true;
  const auth = useAuthStore();
  if (!(await auth.tryRestore())) return { name: 'login', query: { redirect: to.fullPath } };
  if (to.meta.adminOnly && !auth.isAdmin) return { name: 'dashboard' };
  return true;
});
