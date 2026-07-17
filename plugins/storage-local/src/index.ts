import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  HealthCheckResult,
  PluginManifest,
  ProviderMetadata,
  StorageProvider,
} from '@hub/core-contracts';

const metadata: ProviderMetadata = {
  id: 'storage-local',
  name: 'Armazenamento local',
  version: '0.1.0',
  author: 'AI Translation Hub',
  description: 'Armazena arquivos no sistema de arquivos local.',
  type: 'storage',
  requiresGPU: false,
  requiresNetwork: false,
  configSchema: {
    type: 'object',
    properties: {
      baseDir: {
        type: 'string',
        description: 'Diretório raiz de armazenamento',
        default: './storage',
      },
    },
  },
};

export class LocalStorageProvider implements StorageProvider {
  readonly metadata = metadata;
  private baseDir = path.resolve('./storage');

  async configure(config: Record<string, unknown>): Promise<void> {
    if (typeof config.baseDir === 'string') {
      this.baseDir = path.resolve(config.baseDir);
    }
    await fs.mkdir(this.baseDir, { recursive: true });
  }

  // Refs são caminhos relativos ao baseDir; resolve() barra path traversal.
  private resolve(ref: string): string {
    const abs = path.resolve(this.baseDir, ref);
    if (!abs.startsWith(this.baseDir + path.sep) && abs !== this.baseDir) {
      throw new Error(`Ref inválida (fora do baseDir): ${ref}`);
    }
    return abs;
  }

  async save(ref: string, data: Buffer | NodeJS.ReadableStream): Promise<string> {
    const abs = this.resolve(ref);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    if (Buffer.isBuffer(data)) {
      await fs.writeFile(abs, data);
    } else {
      const { writeFile } = await import('node:fs/promises');
      const chunks: Buffer[] = [];
      for await (const chunk of data) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      await writeFile(abs, Buffer.concat(chunks));
    }
    return ref;
  }

  async read(ref: string): Promise<Buffer> {
    return fs.readFile(this.resolve(ref));
  }

  async readStream(ref: string): Promise<NodeJS.ReadableStream> {
    return createReadStream(this.resolve(ref));
  }

  async delete(ref: string): Promise<void> {
    await fs.rm(this.resolve(ref), { force: true });
  }

  async exists(ref: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(ref));
      return true;
    } catch {
      return false;
    }
  }

  // Na fase CLI não há servidor HTTP: a "URL assinada" é uma file:// URL.
  // No backend, esta implementação passa a emitir GET /files/:token.
  async getSignedUrl(ref: string): Promise<string> {
    return pathToFileURL(this.resolve(ref)).href;
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      await fs.access(this.baseDir);
      return {
        healthy: true,
        latencyMs: Date.now() - start,
        checkedAt: new Date().toISOString(),
      };
    } catch (err) {
      return {
        healthy: false,
        message: `baseDir inacessível: ${this.baseDir}`,
        checkedAt: new Date().toISOString(),
      };
    }
  }
}

export const manifest: PluginManifest = {
  metadata,
  factory: () => new LocalStorageProvider(),
};
