import * as THREE from 'three';

export const ATLAS_GLYPHS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const ATLAS_COLS = 6;
export const ATLAS_ROWS = 6;

export interface AtlasOptions {
  /** Pixel size of each cell. */
  cellSize?: number;
  /** Glyph render size in pixels (smaller than cellSize → padding around the glyph). */
  glyphSize?: number;
  /** CSS font family stack. */
  fontFamily?: string;
  /** CSS font weight. */
  fontWeight?: string | number;
}

export function makeFontAtlas(opts: AtlasOptions = {}): THREE.CanvasTexture {
  const cellSize = opts.cellSize ?? 128;
  const glyphSize = opts.glyphSize ?? 92;
  const fontFamily = opts.fontFamily ?? '"Space Grotesk", system-ui, sans-serif';
  const fontWeight = opts.fontWeight ?? 700;

  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_COLS * cellSize;
  canvas.height = ATLAS_ROWS * cellSize;

  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#fff';
  ctx.font = `${fontWeight} ${glyphSize}px ${fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let i = 0; i < ATLAS_GLYPHS.length; i++) {
    const col = i % ATLAS_COLS;
    const row = (i / ATLAS_COLS) | 0;
    const cx = col * cellSize + cellSize / 2;
    const cy = row * cellSize + cellSize / 2;
    ctx.fillText(ATLAS_GLYPHS[i], cx, cy);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

/** Wait for the requested font to actually be available before atlasing. */
export async function whenFontReady(family = 'Space Grotesk', weight = '700', sizePx = 64): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  try {
    await document.fonts.load(`${weight} ${sizePx}px "${family}"`);
    await document.fonts.ready;
  } catch {
    // best effort — fall through to whatever the system gives us
  }
}
