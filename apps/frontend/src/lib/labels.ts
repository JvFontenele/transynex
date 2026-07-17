// Rótulos e formatação compartilhados entre as telas (pt-BR).

// Idiomas mais comuns para os selects de projeto (ISO 639-1 → nome).
export const LANGUAGES: Array<{ code: string; name: string }> = [
  { code: 'ja', name: 'Japonês' },
  { code: 'en', name: 'Inglês' },
  { code: 'pt-BR', name: 'Português (Brasil)' },
  { code: 'pt-PT', name: 'Português (Portugal)' },
  { code: 'es', name: 'Espanhol' },
  { code: 'zh', name: 'Chinês' },
  { code: 'ko', name: 'Coreano' },
  { code: 'fr', name: 'Francês' },
  { code: 'de', name: 'Alemão' },
  { code: 'it', name: 'Italiano' },
  { code: 'ru', name: 'Russo' },
  { code: 'ar', name: 'Árabe' },
  { code: 'nl', name: 'Holandês' },
  { code: 'pl', name: 'Polonês' },
  { code: 'tr', name: 'Turco' },
];

export function languageName(code: string): string {
  // 'pt' cru aparece em projetos criados antes da separação BR/PT
  if (code === 'pt') return 'Português';
  return LANGUAGES.find((l) => l.code === code)?.name ?? code;
}

export const JOB_TYPE_LABELS: Record<string, string> = {
  extraction: 'Extração de páginas',
  ocr: 'OCR',
  translation: 'Tradução',
  inpainting: 'Inpainting',
  render: 'Renderização',
  export: 'Exportação',
  'plugin-health': 'Health check',
  'model-download': 'Download de modelo',
};

export const JOB_STATUS_LABELS: Record<string, string> = {
  queued: 'Na fila',
  active: 'Executando',
  completed: 'Concluído',
  failed: 'Falhou',
  retrying: 'Tentando de novo',
  cancelled: 'Cancelado',
};

export const PROJECT_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Rascunho',
  PROCESSING: 'Processando',
  READY: 'Pronto',
  ERROR: 'Erro',
};

export const PROVIDER_TYPE_LABELS: Record<string, string> = {
  ocr: 'OCR',
  translation: 'Tradução',
  inpainting: 'Inpainting',
  render: 'Renderização',
  export: 'Exportação',
  storage: 'Armazenamento',
};

// Tom visual por status (badge). Chaves cobrem status de job e de projeto.
export const STATUS_TONES: Record<string, string> = {
  queued: 'bg-slate-500/15 text-slate-400',
  active: 'bg-sky-500/15 text-sky-400',
  completed: 'bg-emerald-500/15 text-emerald-400',
  failed: 'bg-rose-500/15 text-rose-400',
  retrying: 'bg-amber-500/15 text-amber-400',
  cancelled: 'bg-slate-500/15 text-slate-500',
  DRAFT: 'bg-slate-500/15 text-slate-400',
  PROCESSING: 'bg-amber-500/15 text-amber-400',
  READY: 'bg-emerald-500/15 text-emerald-400',
  ERROR: 'bg-rose-500/15 text-rose-400',
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// "há 5 min", "há 2 h", "ontem"…
export function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.round(diffMs / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'ontem' : `há ${d} dias`;
}
