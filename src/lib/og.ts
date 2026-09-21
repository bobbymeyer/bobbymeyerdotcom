/**
 * The picture a link to this site unfurls into.
 *
 * Every card is drawn here at build time and written to `/og/<slug>.png`:
 * 1200×630, the size every platform crops to, and a PNG, because Twitter,
 * Facebook, LinkedIn, Slack and iMessage all decline to render an SVG in a
 * preview — which is what five of the eight splashes on this site are. Laying
 * them onto a raster card is the whole reason this file exists.
 *
 * The card is the site's own layout at a distance: the wordmark and its three
 * process dots, the title set large, the summary under it, and the project's
 * splash filling the right-hand third over its own ink. Left-aligned, like
 * everything else here.
 *
 * Satori lays the card out and hands back SVG; sharp rasterises it. The
 * splash is flattened to a PNG *first*, because it may itself be an SVG and
 * nesting one inside another is the sort of thing that renders on your
 * machine and not on the build.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import satori from 'satori';
import sharp from 'sharp';
import { DOMAIN, HANDLE, LEDE, NAME } from '@/site';
import { POST_PALETTE } from '@/palette';

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

/** The splash column, and the height it is cropped to. */
const FIELD_WIDTH = 430;

const PUBLIC_DIR = join(process.cwd(), 'public');
const FONT_DIR = join(process.cwd(), 'src', 'assets', 'fonts');

/** Process inks, as the site header mixes them. */
const INKS = ['#00aeef', '#ec008c', '#fff200'];

export interface OgCard {
  title: string;
  summary: string;
  /** A public-rooted path, as `ProjectDef.splash` spells it. */
  splash?: string;
  /** The ink behind the splash. */
  bg?: string;
}

type Font = { name: string; data: Buffer; weight: 400 | 600 | 800; style: 'normal' };

let fonts: Promise<Font[]> | null = null;

/**
 * Archivo, as static instances.
 *
 * The browser gets the variable woff2 in `public/fonts`; Satori gets these,
 * because it wants a weight per file and does not decompress woff2.
 */
function loadFonts(): Promise<Font[]> {
  fonts ??= Promise.all(
    ([400, 600, 800] as const).map(async (weight) => ({
      name: 'Archivo',
      data: await readFile(join(FONT_DIR, `Archivo-${weight}.ttf`)),
      weight,
      style: 'normal' as const,
    })),
  );
  return fonts;
}

/**
 * Emoji, taken off.
 *
 * Titles here open with one — 🐼, 🌳 — and Satori has no glyph for it without
 * an emoji font bundled or a network fetch per character at build time.
 * Neither is worth it for a card whose right-hand third is already the
 * project's own artwork, so the words go on the card and the emoji does not.
 */
function withoutEmoji(text: string): string {
  return text
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}]/gu, '')
    .replace(/[️‍]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The splash, flattened to a PNG of exactly the field it fills.
 *
 * Painted over the project's ink rather than beside it: a splash may be an
 * SVG with transparent ground, and on the site that ground is the colour.
 */
async function fieldPng(splash: string | undefined, bg: string): Promise<string> {
  const field = sharp({
    create: {
      width: FIELD_WIDTH,
      height: OG_HEIGHT,
      channels: 4,
      background: bg,
    },
  });

  if (!splash) return dataUri(await field.png().toBuffer());

  // `density` is what makes an SVG rasterise at the size asked for rather
  // than at whatever its intrinsic box happens to be.
  const art = await sharp(join(PUBLIC_DIR, splash), { density: 300 })
    .resize(FIELD_WIDTH, OG_HEIGHT, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer();

  return dataUri(await field.composite([{ input: art }]).png().toBuffer());
}

function dataUri(png: Buffer): string {
  return `data:image/png;base64,${png.toString('base64')}`;
}

/** One process dot. */
function dot(color: string) {
  return {
    type: 'div',
    props: {
      style: {
        width: 18,
        height: 18,
        borderRadius: 9,
        backgroundColor: color,
        marginRight: -6,
      },
    },
  };
}

/**
 * The card.
 *
 * Satori is Yoga underneath, so every box holding more than one child says
 * `display: flex` — there is no block layout to fall back on.
 */
export async function ogImage(card: OgCard): Promise<Buffer> {
  const bg = card.bg ?? POST_PALETTE.paper;
  const field = await fieldPng(card.splash, bg);
  const title = withoutEmoji(card.title);

  const svg = await satori(
    {
      type: 'div',
      props: {
        style: {
          display: 'flex',
          width: OG_WIDTH,
          height: OG_HEIGHT,
          backgroundColor: '#ffffff',
          fontFamily: 'Archivo',
          color: '#000000',
        },
        children: [
          {
            type: 'div',
            props: {
              style: {
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                width: OG_WIDTH - FIELD_WIDTH,
                padding: 64,
              },
              children: [
                // The lockup: three inks and the handle.
                {
                  type: 'div',
                  props: {
                    style: { display: 'flex', alignItems: 'center' },
                    children: [
                      {
                        type: 'div',
                        props: {
                          style: { display: 'flex', marginRight: 18 },
                          children: INKS.map(dot),
                        },
                      },
                      {
                        type: 'div',
                        props: {
                          style: { fontSize: 26, fontWeight: 600, letterSpacing: '-0.025em' },
                          children: HANDLE,
                        },
                      },
                    ],
                  },
                },
                // The name of the thing, and what it is.
                {
                  type: 'div',
                  props: {
                    style: { display: 'flex', flexDirection: 'column' },
                    children: [
                      {
                        type: 'div',
                        props: {
                          style: {
                            fontSize: title.length > 22 ? 62 : 76,
                            fontWeight: 800,
                            letterSpacing: '-0.03em',
                            lineHeight: 1.05,
                          },
                          children: title,
                        },
                      },
                      {
                        type: 'div',
                        props: {
                          style: {
                            marginTop: 20,
                            fontSize: 30,
                            fontWeight: 400,
                            lineHeight: 1.4,
                            color: '#444444',
                          },
                          children: card.summary,
                        },
                      },
                    ],
                  },
                },
                {
                  type: 'div',
                  props: {
                    style: { fontSize: 24, fontWeight: 400, color: '#777777' },
                    children: DOMAIN,
                  },
                },
              ],
            },
          },
          {
            type: 'img',
            props: { src: field, width: FIELD_WIDTH, height: OG_HEIGHT },
          },
        ],
      },
    },
    { width: OG_WIDTH, height: OG_HEIGHT, fonts: await loadFonts() },
  );

  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * The card for every page that is not a project — the index, about, contact,
 * the 404. The field is the site's own mark, which is the one splash here
 * that belongs to no single project.
 */
export const SITE_CARD: OgCard = {
  title: NAME,
  summary: LEDE,
  splash: '/posts/bobbymeyerdotcom/splash.svg',
  bg: POST_PALETTE.paper,
};
