import { defineStore } from 'pinia';
import { io, type Socket } from 'socket.io-client';

interface JobEvent {
  jobId: string;
  pageId?: string;
  progress?: number;
  status?: string;
  error?: string;
}

// Estado em tempo real dos jobs, alimentado pelo Socket.IO do backend.
// As views combinam isto com o snapshot vindo de GET /jobs.
export const useJobsStore = defineStore('jobs', {
  state: () => ({
    live: {} as Record<string, { progress: number; status: string; error?: string }>,
    connected: false,
    socket: null as Socket | null,
  }),
  actions: {
    connect() {
      if (this.socket) return;
      const socket = io();
      socket.on('connect', () => (this.connected = true));
      socket.on('disconnect', () => (this.connected = false));
      socket.on('job:progress', (e: JobEvent) => {
        this.live[e.jobId] = { progress: e.progress ?? 0, status: e.status ?? 'active' };
      });
      socket.on('job:completed', (e: JobEvent) => {
        this.live[e.jobId] = { progress: 100, status: 'completed' };
      });
      socket.on('job:failed', (e: JobEvent) => {
        this.live[e.jobId] = {
          progress: this.live[e.jobId]?.progress ?? 0,
          status: 'failed',
          error: e.error,
        };
      });
      this.socket = socket;
    },
  },
});
