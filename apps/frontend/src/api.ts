// Cliente da API REST do backend (/api/v1). Tipos espelham o schema Prisma.

export interface Project {
  id: string;
  name: string;
  sourceLanguage: string;
  targetLanguage: string;
  status: 'DRAFT' | 'PROCESSING' | 'READY' | 'ERROR';
  createdAt: string;
  _count?: { pages: number; jobs: number };
}

export interface OcrRegion {
  id: string;
  pageId: string;
  boundingBox: { x: number; y: number; width: number; height: number };
  sourceText: string;
  translatedText: string | null;
  confidence: number;
  readingOrder: number | null;
}

export interface Page {
  id: string;
  projectId: string;
  order: number;
  sourceImageRef: string;
  renderedImageRef: string | null;
  ocrRegions: OcrRegion[];
}

export interface Job {
  id: string;
  projectId: string;
  pageId: string | null;
  type: string;
  status: string;
  progress: number;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface ProviderMetadata {
  id: string;
  name: string;
  version: string;
  description: string;
  type: string;
}

export interface HealthCheckResult {
  healthy: boolean;
  message?: string;
  latencyMs?: number;
}

const BASE = '/api/v1';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Erro ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  listProjects: () => request<Project[]>('/projects'),
  getProject: (id: string) => request<Project>(`/projects/${id}`),
  createProject: (data: { name: string; sourceLanguage: string; targetLanguage: string }) =>
    request<Project>('/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    }),
  deleteProject: (id: string) => request<void>(`/projects/${id}`, { method: 'DELETE' }),

  upload: (projectId: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<{ sourceFileId: string; pageId: string }>(`/projects/${projectId}/uploads`, {
      method: 'POST',
      body: form,
    });
  },

  listPages: (projectId: string) => request<Page[]>(`/projects/${projectId}/pages`),

  updateRegion: (regionId: string, data: { sourceText?: string; translatedText?: string }) =>
    request<OcrRegion>(`/regions/${regionId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    }),

  run: (projectId: string, body: { ocrProviderId?: string; translationProviderId?: string }) =>
    request<{ jobIds: string[] }>(`/projects/${projectId}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),

  listJobs: (projectId?: string) =>
    request<Job[]>(`/jobs${projectId ? `?projectId=${projectId}` : ''}`),

  listProviders: () => request<Record<string, ProviderMetadata[]>>('/providers'),
  providersHealth: () => request<Record<string, HealthCheckResult>>('/providers/health'),

  exportProject: (projectId: string, format: string) =>
    request<{ jobId: string }>(`/projects/${projectId}/export`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ format }),
    }),
  listExports: (projectId: string) =>
    request<ExportArtifact[]>(`/projects/${projectId}/exports`),
};

export interface ExportArtifact {
  id: string;
  format: string;
  sizeBytes: number;
  createdAt: string;
}

export function fileUrl(ref: string): string {
  return `${BASE}/files?ref=${encodeURIComponent(ref)}`;
}

export function downloadUrl(artifactId: string): string {
  return `${BASE}/exports/${artifactId}/download`;
}
