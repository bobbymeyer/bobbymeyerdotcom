/** Mid-century splash colors — one per post. */
export const POST_PALETTE = {
  vermillion: '#E03A2B',
  orange: '#F15A24',
  yellow: '#F5C400',
  green: '#3D9970',
  teal: '#00A3A0',
  blue: '#2F6FED',
  violet: '#5B4BB7',
  magenta: '#E83A75',
  cobalt: '#0047AB',
  rust: '#B7410E',
} as const;

export type PostColor = (typeof POST_PALETTE)[keyof typeof POST_PALETTE];

export const POST_COLOR_VALUES = Object.values(POST_PALETTE) as [PostColor, ...PostColor[]];

export const POST_COLOR_LIST = POST_COLOR_VALUES.map(
  (hex) => `\`${hex}\` (${paletteName(hex)})`,
).join(', ');

function paletteName(hex: PostColor): string {
  const entry = Object.entries(POST_PALETTE).find(([, value]) => value === hex);
  return entry?.[0] ?? hex;
}
