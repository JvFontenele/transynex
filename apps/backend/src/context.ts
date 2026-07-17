import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import {
  DefaultProviderRegistry,
  type ProviderRegistry,
  type StorageProvider,
} from '@transynex/core-contracts';
import { loadPlugins } from '@transynex/core';
import { decryptSecrets } from './secrets.js';

export interface AppContext {
  prisma: PrismaClient;
  registry: ProviderRegistry;
  storage: StorageProvider;
  redisUrl: string;
  /** Config efetiva (env ← ProviderConfig ← ApiCredential) por providerId. */
  effectiveConfig(providerId: string): Promise<Record<string, unknown>>;
}

const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Defaults por env; a tabela ProviderConfig (tela de Plugins) sobrepõe
// campo a campo, e ApiCredential fornece os campos secretos.
function envConfigs(): Record<string, Record<string, unknown>> {
  return {
    'storage-local': { baseDir: process.env.TRANSYNEX_STORAGE_DIR ?? './storage' },
    'tesseract-ocr': { cachePath: process.env.TRANSYNEX_MODELS_DIR ?? './models/tesseract' },
    'ollama-translation': {
      baseUrl: process.env.OLLAMA_URL,
      model: process.env.OLLAMA_MODEL,
    },
    libretranslate: { baseUrl: process.env.LIBRETRANSLATE_URL },
  };
}

async function storedConfig(
  prisma: PrismaClient,
  providerId: string,
): Promise<Record<string, unknown>> {
  const [row, cred] = await Promise.all([
    prisma.providerConfig.findUnique({ where: { providerId } }),
    prisma.apiCredential.findUnique({ where: { providerId } }),
  ]);
  const config = (row?.config as Record<string, unknown> | null) ?? {};
  const secrets = cred ? decryptSecrets(Buffer.from(cred.encrypted), Buffer.from(cred.iv)) : {};
  return { ...config, ...secrets };
}

export async function createContext(): Promise<AppContext> {
  const prisma = new PrismaClient();
  const registry = new DefaultProviderRegistry();

  const env = envConfigs();
  const stored = await prisma.providerConfig.findMany();
  const merged: Record<string, Record<string, unknown>> = { ...env };
  for (const row of stored) {
    merged[row.providerId] = {
      ...env[row.providerId],
      ...(await storedConfig(prisma, row.providerId)),
    };
  }

  const storage = await loadPlugins(registry, path.join(appDir, 'plugins.json'), merged);
  return {
    prisma,
    registry,
    storage,
    redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
    effectiveConfig: async (providerId) => ({
      ...env[providerId],
      ...(await storedConfig(prisma, providerId)),
    }),
  };
}
