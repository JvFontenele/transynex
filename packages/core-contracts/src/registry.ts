import type {
  HealthCheckResult,
  Provider,
  ProviderMetadata,
  ProviderType,
} from './types.js';

export interface ProviderRegistry {
  register(provider: Provider): void;
  unregister(providerId: string): void;
  get<T extends Provider>(type: ProviderType, id: string): T;
  list(type: ProviderType): ProviderMetadata[];
  healthCheckAll(): Promise<Record<string, HealthCheckResult>>;
}

export class DefaultProviderRegistry implements ProviderRegistry {
  private providers = new Map<string, Provider>();

  register(provider: Provider): void {
    const { id } = provider.metadata;
    if (this.providers.has(id)) {
      throw new Error(`Provider já registrado: ${id}`);
    }
    this.providers.set(id, provider);
  }

  unregister(providerId: string): void {
    this.providers.delete(providerId);
  }

  get<T extends Provider>(type: ProviderType, id: string): T {
    const provider = this.providers.get(id);
    if (!provider) {
      const available = this.list(type).map((m) => m.id);
      throw new Error(
        `Provider "${id}" (${type}) não encontrado. Disponíveis: ${available.join(', ') || 'nenhum'}`,
      );
    }
    if (provider.metadata.type !== type) {
      throw new Error(
        `Provider "${id}" é do tipo "${provider.metadata.type}", esperado "${type}"`,
      );
    }
    return provider as T;
  }

  list(type: ProviderType): ProviderMetadata[] {
    return [...this.providers.values()]
      .filter((p) => p.metadata.type === type)
      .map((p) => p.metadata);
  }

  async healthCheckAll(): Promise<Record<string, HealthCheckResult>> {
    const entries = await Promise.all(
      [...this.providers.values()].map(async (p): Promise<[string, HealthCheckResult]> => {
        try {
          return [p.metadata.id, await p.healthCheck()];
        } catch (err) {
          return [
            p.metadata.id,
            {
              healthy: false,
              message: err instanceof Error ? err.message : String(err),
              checkedAt: new Date().toISOString(),
            },
          ];
        }
      }),
    );
    return Object.fromEntries(entries);
  }
}
