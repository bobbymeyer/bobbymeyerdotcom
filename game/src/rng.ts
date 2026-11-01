/**
 * A seeded RNG whose whole state is one 32-bit integer, so it can live inside
 * the game state and travel with it. Same seed, same run, every time.
 *
 * mulberry32: small, fast, and good enough for shuffling cards.
 */

export type RngState = number;

/** Returns the next float in [0, 1) and the state to use after it. */
export function next(state: RngState): [number, RngState] {
  const s = (state + 0x6d2b79f5) | 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, s];
}

/** Fisher–Yates, returning a new array and the advanced state. */
export function shuffle<T>(items: readonly T[], state: RngState): [T[], RngState] {
  const out = items.slice();
  let s = state;
  for (let i = out.length - 1; i > 0; i--) {
    let r: number;
    [r, s] = next(s);
    const j = Math.floor(r * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return [out, s];
}
