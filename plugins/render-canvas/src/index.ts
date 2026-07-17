import { createCanvas, loadImage, type SKRSContext2D } from '@napi-rs/canvas';
import type {
  BoundingBox,
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
  version: '0.2.0',
  author: 'Transynex',
  description:
    'Cobre o texto original com a cor amostrada do fundo e desenha a tradução por cima (Skia): ' +
    'medição real de glifos, quebra de linha com hifenização, contorno em fundos irregulares e ' +
    'alinhamento por bloco.',
  type: 'render',
  requiresGPU: false,
  requiresNetwork: false,
  configSchema: {
    type: 'object',
    properties: {
      fontFamily: { type: 'string', default: 'DejaVu Sans' },
      // 'auto' amostra a cor do fundo ao redor de cada bloco
      backgroundColor: { type: 'string', default: 'auto' },
      // 'auto' escolhe preto ou branco pelo contraste com o fundo
      textColor: { type: 'string', default: 'auto' },
      padding: { type: 'number', default: 4 },
    },
  },
};

const LINE_HEIGHT_RATIO = 1.25;
const MIN_FONT_SIZE = 9;
const MAX_FONT_SIZE = 48;
// Largura da faixa de pixels amostrada ao redor do bloco
const SAMPLE_BAND = 3;
// Dispersão (desvio absoluto mediano por canal) acima da qual o fundo é
// tratado como irregular e o texto ganha contorno
const BUSY_THRESHOLD = 24;

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function rgbToCss([r, g, b]: Rgb): string {
  return `rgb(${r},${g},${b})`;
}

function luminance([r, g, b]: Rgb): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

interface BackgroundSample {
  color: Rgb;
  // true quando os pixels ao redor variam demais (retícula, arte, gradiente)
  busy: boolean;
}

// Amostra uma faixa fina de pixels imediatamente fora do bounding box — a
// caixa do OCR abraça o texto, então o entorno tende a ser só o fundo do
// balão. A mediana por canal resiste a pixels de borda/traço.
function sampleBackground(
  ctx: SKRSContext2D,
  box: BoundingBox,
  imageWidth: number,
  imageHeight: number,
): BackgroundSample {
  const outer = {
    left: Math.max(0, Math.floor(box.x) - SAMPLE_BAND),
    top: Math.max(0, Math.floor(box.y) - SAMPLE_BAND),
    right: Math.min(imageWidth, Math.ceil(box.x + box.width) + SAMPLE_BAND),
    bottom: Math.min(imageHeight, Math.ceil(box.y + box.height) + SAMPLE_BAND),
  };

  const strips: Array<{ x: number; y: number; w: number; h: number }> = [
    { x: outer.left, y: outer.top, w: outer.right - outer.left, h: SAMPLE_BAND },
    { x: outer.left, y: outer.bottom - SAMPLE_BAND, w: outer.right - outer.left, h: SAMPLE_BAND },
    { x: outer.left, y: outer.top, w: SAMPLE_BAND, h: outer.bottom - outer.top },
    { x: outer.right - SAMPLE_BAND, y: outer.top, w: SAMPLE_BAND, h: outer.bottom - outer.top },
  ];

  const r: number[] = [];
  const g: number[] = [];
  const b: number[] = [];
  for (const s of strips) {
    if (s.w <= 0 || s.h <= 0) continue;
    const { data } = ctx.getImageData(s.x, s.y, s.w, s.h);
    for (let i = 0; i < data.length; i += 4) {
      r.push(data[i]);
      g.push(data[i + 1]);
      b.push(data[i + 2]);
    }
  }
  if (r.length === 0) return { color: [255, 255, 255], busy: false };

  const color: Rgb = [median(r), median(g), median(b)];
  const spread =
    median(r.map((v) => Math.abs(v - color[0]))) +
    median(g.map((v) => Math.abs(v - color[1]))) +
    median(b.map((v) => Math.abs(v - color[2])));
  return { color, busy: spread / 3 > BUSY_THRESHOLD };
}

// Quebra uma linha pela largura real medida; palavras maiores que o box são
// partidas por caractere (com hífen apenas entre letras ASCII, para não
// hifenizar CJK).
function wrapText(ctx: SKRSContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  const pushWord = (word: string) => {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
      return;
    }
    if (current) {
      lines.push(current);
      current = '';
    }
    if (ctx.measureText(word).width <= maxWidth) {
      current = word;
      return;
    }
    // Palavra sozinha não cabe: parte por caractere
    let chunk = '';
    for (const ch of word) {
      const withHyphen = /[a-z]$/i.test(chunk) && /^[a-z]/i.test(ch);
      const candidateChunk = chunk + ch;
      const measured = withHyphen ? `${candidateChunk}-` : candidateChunk;
      if (ctx.measureText(measured).width <= maxWidth || !chunk) {
        chunk = candidateChunk;
      } else {
        lines.push(withHyphen ? `${chunk}-` : chunk);
        chunk = ch;
      }
    }
    current = chunk;
  };

  for (const word of words) pushWord(word);
  if (current) lines.push(current);
  return lines;
}

interface FittedText {
  fontSize: number;
  lines: string[];
}

// Maior corpo de fonte cujo texto quebrado cabe no box, medindo os glifos
// reais da fonte que será usada no desenho.
function fitText(
  ctx: SKRSContext2D,
  text: string,
  fontFamily: string,
  boxWidth: number,
  boxHeight: number,
  maxFontSize: number,
): FittedText {
  const setFont = (size: number) => {
    ctx.font = `${size}px "${fontFamily}"`;
  };
  for (let fontSize = maxFontSize; fontSize >= MIN_FONT_SIZE; fontSize--) {
    setFont(fontSize);
    const lines = wrapText(ctx, text, boxWidth);
    const fitsHeight = lines.length * fontSize * LINE_HEIGHT_RATIO <= boxHeight;
    const fitsWidth = lines.every((l) => ctx.measureText(l).width <= boxWidth);
    if (fitsHeight && fitsWidth) return { fontSize, lines };
  }
  setFont(MIN_FONT_SIZE);
  return { fontSize: MIN_FONT_SIZE, lines: wrapText(ctx, text, boxWidth) };
}

function roundedRect(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

export class CanvasRenderProvider implements RenderProvider {
  readonly metadata = metadata;
  private fontFamily = 'DejaVu Sans';
  private backgroundColor = 'auto';
  private textColor = 'auto';
  private padding = 4;

  constructor(private storage: StorageProvider) {}

  async configure(config: Record<string, unknown>): Promise<void> {
    if (typeof config.fontFamily === 'string') this.fontFamily = config.fontFamily;
    if (typeof config.backgroundColor === 'string') this.backgroundColor = config.backgroundColor;
    if (typeof config.textColor === 'string') this.textColor = config.textColor;
    if (typeof config.padding === 'number') this.padding = config.padding;
  }

  private drawBlock(
    ctx: SKRSContext2D,
    block: TextBlock,
    imageWidth: number,
    imageHeight: number,
  ): void {
    const { x, y, width, height } = block.boundingBox;
    const pad = this.padding;
    const inner = {
      x: x + pad,
      y: y + pad,
      width: Math.max(1, width - pad * 2),
      height: Math.max(1, height - pad * 2),
    };

    // Fundo: cor amostrada do entorno do bloco, ou a configurada
    const sample =
      this.backgroundColor === 'auto'
        ? sampleBackground(ctx, block.boundingBox, imageWidth, imageHeight)
        : { color: hexToRgb(this.backgroundColor) ?? ([255, 255, 255] as Rgb), busy: false };
    ctx.fillStyle = this.backgroundColor === 'auto' ? rgbToCss(sample.color) : this.backgroundColor;
    roundedRect(ctx, x, y, width, height, 4);
    ctx.fill();

    const fontFamily = block.fontFamily ?? this.fontFamily;
    const maxFontSize = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, block.fontSizeHint ?? MAX_FONT_SIZE));
    const { fontSize, lines } = fitText(ctx, block.text, fontFamily, inner.width, inner.height, maxFontSize);
    ctx.font = `${fontSize}px "${fontFamily}"`;

    // Cor do texto: explícita no bloco, configurada, ou por contraste com o fundo
    const darkBackground = luminance(sample.color) < 140;
    const fillColor =
      block.color ?? (this.textColor === 'auto' ? (darkBackground ? '#ffffff' : '#111111') : this.textColor);

    // Contorno: explícito no bloco, ou automático quando o fundo é irregular
    // (o retângulo amostrado pode não se misturar perfeitamente)
    const strokeColor =
      block.strokeColor ?? (sample.busy ? (darkBackground ? '#111111' : '#ffffff') : null);

    const lineHeight = fontSize * LINE_HEIGHT_RATIO;
    const totalTextHeight = lines.length * lineHeight;

    const vAlign = block.verticalAlignment ?? 'middle';
    const startY =
      vAlign === 'top'
        ? inner.y
        : vAlign === 'bottom'
          ? inner.y + inner.height - totalTextHeight
          : inner.y + (inner.height - totalTextHeight) / 2;

    const align = block.alignment ?? 'center';
    ctx.textAlign = align;
    const textX =
      align === 'left' ? inner.x : align === 'right' ? inner.x + inner.width : inner.x + inner.width / 2;

    ctx.textBaseline = 'top';
    for (const [i, line] of lines.entries()) {
      // Centraliza a linha dentro do line-height (o baseline 'top' desenha colado)
      const lineY = startY + i * lineHeight + (lineHeight - fontSize) / 2;
      if (strokeColor) {
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = Math.max(2, fontSize / 7);
        ctx.lineJoin = 'round';
        ctx.strokeText(line, textX, lineY);
      }
      ctx.fillStyle = fillColor;
      ctx.fillText(line, textX, lineY);
    }
  }

  async render(input: RenderInput): Promise<RenderResult> {
    const base = await this.storage.read(input.baseImageRef);
    const image = await loadImage(base);
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);

    for (const block of input.textBlocks) {
      this.drawBlock(ctx, block, image.width, image.height);
    }

    const rendered = await canvas.encode('png');
    const dir = input.baseImageRef.split('/').slice(0, -2).join('/');
    const imageRef = `${dir}/rendered/${input.pageId}.png`;
    await this.storage.save(imageRef, rendered);

    return { pageId: input.pageId, imageRef, format: 'png' };
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      // Desenha e codifica um canvas mínimo para validar o binding Skia
      const canvas = createCanvas(4, 4);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 4, 4);
      await canvas.encode('png');
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
