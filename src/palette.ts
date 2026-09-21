/**
 * Mid-century splash colors — one per project.
 *
 * `paper` is the odd one out and is not a colour so much as the absence of
 * one: the unprinted sheet. A splash that draws process inks has to sit on
 * it, because subtractive colour is a statement about what the ink takes out
 * of the light the paper sends back, and on a tinted ground it stops being
 * true.
 */
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
  paper: '#FFFFFF',
} as const;

export type PostColor = (typeof POST_PALETTE)[keyof typeof POST_PALETTE];
