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
  boundingBox: BoundingBox;
  sourceText: string;
  translatedText: string | null;
  confidence: number;
  readingOrder: number | null;
  orientation: string | null;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Page {
  id: string;
  projectId: string;
  order: number;
  sourceImageRef: string;
  renderedImageRef: string | null;
  // URLs assinadas emitidas pelo backend (<img src> não envia Authorization)
  sourceImageUrl: string;
  renderedImageUrl: string | null;
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

export interface ConfigField {
  type?: string;
  format?: string;
  default?: unknown;
  description?: string;
  enum?: unknown[];
}

export interface ProviderMetadata {
  id: string;
  name: string;
  version: string;
  author?: string;
  description: string;
  type: string;
  requiresGPU?: boolean;
  requiresNetwork?: boolean;
  configSchema?: { properties?: Record<string, ConfigField> };
}

// Metadata + estado persistido (GET /providers)
export interface ProviderInfo extends ProviderMetadata {
  config: Record<string, unknown>;
  isDefault: boolean;
  definedSecrets: string[];
}

export interface HealthCheckResult {
  healthy: boolean;
  message?: string;
  latencyMs?: number;
}

const BASE = '/api/v1';

// Token de acesso injetado pelo auth store (setter evita ciclo de import
// api.ts ↔ store Pinia).
let accessToken: string | null = null;
let refreshHandler: (() => Promise<boolean>) | null = null;

export function setAuthToken(token: string | null) {
  accessToken = token;
}
export function setRefreshHandler(fn: () => Promise<boolean>) {
  refreshHandler = fn;
}

async function request<T>(path: string, init?: RequestInit, retried = false): Promise<T> {
  const headers = new Headers(init?.headers);
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (res.status === 401 && !retried && refreshHandler && !path.startsWith('/auth/')) {
    if (await refreshHandler()) return request<T>(path, init, true);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Erro ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export interface AuthUser {
  id: string;
  email: string;
  role: string;
}

export interface LoginResponse {
  accessToken: string;
  fileToken: string;
  user: AuthUser;
}

export const api = {
  login: (email: string, password: string) =>
    request<LoginResponse>('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    }),
  refresh: () => request<LoginResponse>('/auth/refresh', { method: 'POST', credentials: 'include' }),
  logout: () => request<void>('/auth/logout', { method: 'POST', credentials: 'include' }),

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
  getPage: (pageId: string) => request<Page>(`/pages/${pageId}`),
  renderPage: (pageId: string) => request<Page>(`/pages/${pageId}/render`, { method: 'POST' }),

  createRegion: (
    pageId: string,
    data: { boundingBox: BoundingBox; sourceText?: string; translatedText?: string },
  ) =>
    request<OcrRegion>(`/pages/${pageId}/regions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    }),

  updateRegion: (
    regionId: string,
    data: { sourceText?: string; translatedText?: string; boundingBox?: BoundingBox },
  ) =>
    request<OcrRegion>(`/regions/${regionId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    }),

  deleteRegion: (regionId: string) => request<void>(`/regions/${regionId}`, { method: 'DELETE' }),

  // OCR + tradução só no recorte da região (para regiões marcadas à mão)
  reanalyzeRegion: (regionId: string) =>
    request<OcrRegion>(`/regions/${regionId}/reanalyze`, { method: 'POST' }),

  run: (
    projectId: string,
    body: {
      ocrProviderId?: string;
      translationProviderId?: string;
      // false = descarta também as regiões manuais e refaz tudo do zero
      preserveManual?: boolean;
    },
  ) =>
    request<{ jobIds: string[] }>(`/projects/${projectId}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),

  listJobs: (projectId?: string) =>
    request<Job[]>(`/jobs${projectId ? `?projectId=${projectId}` : ''}`),

  listProviders: () => request<Record<string, ProviderInfo[]>>('/providers'),
  providersHealth: () => request<Record<string, HealthCheckResult>>('/providers/health'),
  configureProvider: (providerId: string, config: Record<string, unknown>) =>
    request<ProviderInfo>(`/providers/${providerId}/configure`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ config }),
    }),
  setDefaultProvider: (providerId: string) =>
    request<ProviderInfo>(`/providers/${providerId}/default`, { method: 'POST' }),

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
  // URL assinada emitida pelo backend
  downloadUrl: string;
}
