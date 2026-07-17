import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import {
  DefaultProviderRegistry,
  type ProviderRegistry,
  type StorageProvider,
} from '@transynex/core-contracts';
import { loadPlugins } from '@transynex/core';

export interface AppContext {
  prisma: PrismaClient;
  registry: ProviderRegistry;
  storage: StorageProvider;
  redisUrl: string;
}

const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Config por provider: na fase atual vem de env; quando a tela de
// Configurações existir, passa a vir da tabela ProviderConfig.
function providerConfigs(): Record<string, Record<string, unknown>> {
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

export async function createContext(): Promise<AppContext> {
  const prisma = new PrismaClient();
  const registry = new DefaultProviderRegistry();
  const storage = await loadPlugins(
    registry,
    path.join(appDir, 'plugins.json'),
    providerConfigs(),
  );
  return {
    prisma,
    registry,
    storage,
    redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  };
}
