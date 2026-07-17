import { defineStore } from 'pinia';
import { api, setAuthToken, setRefreshHandler, type AuthUser } from '../api';
import { useJobsStore } from './jobs';

// Access token só em memória (nada em localStorage); o cookie httpOnly de
// refresh recupera a sessão após F5 via tryRestore().
export const useAuthStore = defineStore('auth', {
  state: () => ({
    accessToken: null as string | null,
    user: null as AuthUser | null,
    restored: false,
  }),
  getters: {
    isAuthenticated: (s) => s.accessToken !== null,
  },
  actions: {
    _apply(accessToken: string, user: AuthUser) {
      this.accessToken = accessToken;
      this.user = user;
      setAuthToken(accessToken);
      setRefreshHandler(() => this.refresh());
      useJobsStore().connect(accessToken);
    },

    async login(email: string, password: string) {
      const res = await api.login(email, password);
      this._apply(res.accessToken, res.user);
    },

    async refresh(): Promise<boolean> {
      try {
        const res = await api.refresh();
        this._apply(res.accessToken, res.user);
        return true;
      } catch {
        return false;
      }
    },

    // Chamado pelo guard de rota no primeiro acesso da sessão.
    async tryRestore(): Promise<boolean> {
      if (this.accessToken) return true;
      if (this.restored) return false;
      this.restored = true;
      return this.refresh();
    },

    async logout() {
      await api.logout().catch(() => {});
      this.accessToken = null;
      this.user = null;
      setAuthToken(null);
      useJobsStore().disconnect();
    },
  },
});
