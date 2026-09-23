/**
 * `/apple-touch-icon.png` — the mark, for a home screen.
 *
 * iOS declines the SVG favicon and it puts whatever it does take straight
 * onto the wallpaper, with nothing behind it: three process inks drawn on
 * transparency would land as three inks on black, and the overlaps this mark
 * is built from would go with it. So the same file is rasterised onto its own
 * white ground, at the one size Apple asks for.
 *
 * Drawn here rather than committed beside the SVG, for the reason the social
 * cards are drawn: two copies of one mark drift, and only one of them is the
 * one anybody edits.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import type { APIRoute } from 'astro';
import sharp from 'sharp';

/** What Apple asks for, and what every smaller size is resampled from. */
const SIZE = 180;

/**
 * How much of that the mark is given.
 *
 * iOS rounds the corners of whatever it is handed, and this mark is a disc
 * that runs to all four edges of its own viewBox — drawn edge to edge, the
 * fringe that is the whole point of it is the first thing the mask takes off.
 * The margin is the home screen's own, not the icon's.
 */
const INSET = 12;

export const GET: APIRoute = async () => {
  const svg = await readFile(join(process.cwd(), 'public', 'favicon.svg'));

  const png = await sharp(svg, { density: 384 })
    .resize(SIZE - INSET * 2, SIZE - INSET * 2, { fit: 'contain', background: '#ffffff' })
    .extend({ top: INSET, bottom: INSET, left: INSET, right: INSET, background: '#ffffff' })
    .flatten({ background: '#ffffff' })
    .png()
    .toBuffer();

  return new Response(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
};
