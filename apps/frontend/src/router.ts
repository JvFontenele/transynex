import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from './stores/auth';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('./views/LoginView.vue'),
      meta: { public: true },
    },
    { path: '/', name: 'dashboard', component: () => import('./views/DashboardView.vue') },
    { path: '/projects', name: 'projects', component: () => import('./views/ProjectsView.vue') },
    {
      path: '/projects/:id',
      name: 'project-detail',
      component: () => import('./views/ProjectDetailView.vue'),
    },
    {
      // Modo leitura imersivo (sem sidebar): páginas traduzidas empilhadas
      path: '/projects/:id/read',
      name: 'reader',
      component: () => import('./views/ReaderView.vue'),
      meta: { immersive: true },
    },
    {
      path: '/projects/:id/pages/:pageId',
      name: 'page-editor',
      component: () => import('./views/PageEditorView.vue'),
    },
    { path: '/queue', name: 'queue', component: () => import('./views/QueueView.vue') },
    { path: '/plugins', name: 'plugins', component: () => import('./views/PluginsView.vue') },
    {
      // Configura providers e chaves de API — só ADMIN
      path: '/settings',
      name: 'settings',
      component: () => import('./views/SettingsView.vue'),
      meta: { adminOnly: true },
    },
    {
      path: '/users',
      name: 'users',
      component: () => import('./views/UsersView.vue'),
      meta: { adminOnly: true },
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
