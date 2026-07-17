import fs from 'node:fs/promises';
import type {
  PluginManifest,
  Provider,
  ProviderRegistry,
  StorageProvider,
} from '@transynex/core-contracts';

interface PluginsConfig {
  plugins: string[];
  defaultStorage: string;
}

// Carrega plugins por import() dinâmico a partir de plugins.json — o Core
// nunca importa um provider estaticamente (regra do ARCHITECTURE.md).
// Bootstrap em duas fases: storage primeiro, depois os demais recebendo
// o storage default.
export async function loadPlugins(
  registry: ProviderRegistry,
  configPath: string,
  providerConfigs: Record<string, Record<string, unknown>> = {},
): Promise<StorageProvider> {
  const config: PluginsConfig = JSON.parse(await fs.readFile(configPath, 'utf8'));

  const manifests: PluginManifest[] = [];
  for (const pkg of config.plugins) {
    const mod = (await import(pkg)) as { manifest?: PluginManifest };
    if (!mod.manifest) throw new Error(`Pacote "${pkg}" não exporta um PluginManifest`);
    manifests.push(mod.manifest);
  }

  const configureAndRegister = async (m: PluginManifest, storage: StorageProvider) => {
    const provider: Provider = await m.factory(storage);
    await provider.configure(providerConfigs[m.metadata.id] ?? {});
    registry.register(provider);
    return provider;
  };

  // Fase 1: storage (factory ignora o argumento — passa um placeholder nulo tipado)
  const storageManifests = manifests.filter((m) => m.metadata.type === 'storage');
  if (storageManifests.length === 0) throw new Error('Nenhum plugin de storage configurado');
  for (const m of storageManifests) {
    await configureAndRegister(m, null as unknown as StorageProvider);
  }
  const defaultStorage = registry.get<StorageProvider>('storage', config.defaultStorage);

  // Fase 2: demais tipos
  for (const m of manifests.filter((m) => m.metadata.type !== 'storage')) {
    await configureAndRegister(m, defaultStorage);
  }

  return defaultStorage;
}
