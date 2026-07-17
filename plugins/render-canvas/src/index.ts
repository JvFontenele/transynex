import sharp from 'sharp';
import type {
  HealthCheckResult,
  PluginManifest,
  ProviderMetadata,
  RenderInput,
  RenderProvider,
  RenderResult,
  StorageProvider,
  TextBlock,
} from '@transynex/core-contracts';

const metadata: ProviderMetadata = {
  id: 'canvas-render',
  name: 'Renderizador Canvas',
  version: '0.1.0',
  author: 'Transynex',
  description:
    'Cobre o texto original com um retângulo de fundo e desenha a tradução por cima (sharp + SVG): quebra de linha, ajuste de corpo e centralização.',
  type: 'render',
  requiresGPU: false,
  requiresNetwork: false,
  configSchema: {
    type: 'object',
    properties: {
      fontFamily: { type: 'string', default: 'DejaVu Sans' },
      backgroundColor: { type: 'string', default: '#ffffff' },
      textColor: { type: 'string', default: '#111111' },
      padding: { type: 'number', default: 4 },
    },
  },
};

// Largura média de um caractere em relação ao corpo da fonte (aproximação
// suficiente para caber no balão; fontes sans variam pouco disso).
const CHAR_WIDTH_RATIO = 0.56;
const LINE_HEIGHT_RATIO = 1.25;
const MIN_FONT_SIZE = 9;
const MAX_FONT_SIZE = 48;

function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// Maior corpo de fonte cujo texto quebrado cabe no box.
function fitText(
  text: string,
  boxWidth: number,
  boxHeight: number,
): { fontSize: number; lines: string[] } {
  for (let fontSize = MAX_FONT_SIZE; fontSize >= MIN_FONT_SIZE; fontSize--) {
    const maxChars = Math.max(1, Math.floor(boxWidth / (fontSize * CHAR_WIDTH_RATIO)));
    const lines = wrapText(text, maxChars);
    const fits =
      lines.length * fontSize * LINE_HEIGHT_RATIO <= boxHeight &&
      Math.max(...lines.map((l) => l.length)) <= maxChars;
    if (fits) return { fontSize, lines };
  }
  return {
    fontSize: MIN_FONT_SIZE,
    lines: wrapText(text, Math.max(1, Math.floor(boxWidth / (MIN_FONT_SIZE * CHAR_WIDTH_RATIO)))),
  };
}

export class CanvasRenderProvider implements RenderProvider {
  readonly metadata = metadata;
  private fontFamily = 'DejaVu Sans';
  private backgroundColor = '#ffffff';
  private textColor = '#111111';
  private padding = 4;

  constructor(private storage: StorageProvider) {}

  async configure(config: Record<string, unknown>): Promise<void> {
    if (typeof config.fontFamily === 'string') this.fontFamily = config.fontFamily;
    if (typeof config.backgroundColor === 'string') this.backgroundColor = config.backgroundColor;
    if (typeof config.textColor === 'string') this.textColor = config.textColor;
    if (typeof config.padding === 'number') this.padding = config.padding;
  }

  private blockToSvg(block: TextBlock): string {
    const { x, y, width, height } = block.boundingBox;
    const pad = this.padding;
    const inner = { width: width - pad * 2, height: height - pad * 2 };
    const { fontSize, lines } = fitText(block.text, inner.width, inner.height);
    const lineHeight = fontSize * LINE_HEIGHT_RATIO;
    const totalTextHeight = lines.length * lineHeight;
    const startY = y + pad + (inner.height - totalTextHeight) / 2 + fontSize;
    const centerX = x + width / 2;

    const tspans = lines
      .map(
        (line, i) =>
          `<tspan x="${centerX}" y="${(startY + i * lineHeight).toFixed(1)}">${escapeXml(line)}</tspan>`,
      )
      .join('');

    return (
      `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="4" fill="${this.backgroundColor}"/>` +
      `<text font-family="${this.fontFamily}" font-size="${fontSize}" fill="${block.color ?? this.textColor}" text-anchor="middle">${tspans}</text>`
    );
  }

  async render(input: RenderInput): Promise<RenderResult> {
    const base = await this.storage.read(input.baseImageRef);
    const image = sharp(base);
    const { width, height } = await image.metadata();
    if (!width || !height) throw new Error('Imagem base sem dimensões');

    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
        input.textBlocks.map((b) => this.blockToSvg(b)).join('') +
        '</svg>',
    );

    const rendered = await image.composite([{ input: svg }]).png().toBuffer();
    const dir = input.baseImageRef.split('/').slice(0, -2).join('/');
    const imageRef = `${dir}/rendered/${input.pageId}.png`;
    await this.storage.save(imageRef, rendered);

    return { pageId: input.pageId, imageRef, format: 'png' };
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      // Renderiza um pixel para validar sharp + libvips
      await sharp({ create: { width: 1, height: 1, channels: 3, background: '#fff' } })
        .png()
        .toBuffer();
      return { healthy: true, latencyMs: Date.now() - start, checkedAt: new Date().toISOString() };
    } catch (err) {
      return {
        healthy: false,
        message: err instanceof Error ? err.message : String(err),
        checkedAt: new Date().toISOString(),
      };
    }
  }
}

export const manifest: PluginManifest = {
  metadata,
  factory: (storage) => new CanvasRenderProvider(storage),
};
