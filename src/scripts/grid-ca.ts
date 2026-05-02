import * as THREE from 'three';

// Two grids running Game of Life in parallel.
//   Base   (GRID_W × GRID_H): drives whether a cell is "split" or merged.
//   Sub    (SUB_W  × SUB_H ): drives the actual content (color + char).
// "Split" base cells render their 4 sub-cells; "merged" cells render
// a single big cell using the top-left sub-cell's content.
export const GRID_W = 48;
export const GRID_H = 24;
export const SUB_W = GRID_W * 2;
export const SUB_H = GRID_H * 2;

// Independent rolls when a sub-cell is hit.
const COLOR_P = 0.30;
const CHAR_P  = 0.55;

const PATTERNS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  // glider
  [[0, 0], [1, 0], [2, 0], [2, 1], [1, 2]],
  // blinker
  [[0, 0], [1, 0], [2, 0]],
  // beacon
  [[0, 0], [1, 0], [0, 1], [3, 2], [2, 3], [3, 3]],
  // toad
  [[1, 0], [2, 0], [3, 0], [0, 1], [1, 1], [2, 1]],
  // block
  [[0, 0], [1, 0], [0, 1], [1, 1]],
  // r-pentomino (chaotic)
  [[1, 0], [2, 0], [0, 1], [1, 1], [1, 2]],
];

const idxBase = (x: number, y: number) => y * GRID_W + x;
const idxSub = (x: number, y: number) => y * SUB_W + x;
const wrap = (v: number, m: number) => ((v % m) + m) % m;
const r255 = () => 1 + ((Math.random() * 255) | 0);

// Title cells (BOBBY MEYER) live on a fixed row of the base grid and are
// always rendered merged so the masthead never fragments.
const TITLE_ROW = Math.floor(GRID_H / 2);
const TITLE_X_MIN = Math.floor(GRID_W / 2) - 5;
const TITLE_X_MAX = Math.floor(GRID_W / 2) + 5;
const isTitleBase = (x: number, y: number) =>
  y === TITLE_ROW && x >= TITLE_X_MIN && x <= TITLE_X_MAX;

export class GridLife {
  // Base GoL (48 × 24) — alive bit means "split".
  private baseAlive: Uint8Array;
  private baseNext: Uint8Array;

  // Sub GoL (96 × 48) — drives content via hits.
  private subAlive: Uint8Array;
  private subNext: Uint8Array;
  private subColor: Uint8Array;
  private subChar: Uint8Array;
  private subEverHit: Uint8Array;

  readonly baseData: Uint8Array;
  readonly subData: Uint8Array;
  readonly baseTexture: THREE.DataTexture;
  readonly subTexture: THREE.DataTexture;

  private tickCount = 0;
  private readonly spawnEvery = 14;

  constructor() {
    const NB = GRID_W * GRID_H;
    const NS = SUB_W * SUB_H;

    this.baseAlive = new Uint8Array(NB);
    this.baseNext = new Uint8Array(NB);
    this.subAlive = new Uint8Array(NS);
    this.subNext = new Uint8Array(NS);
    this.subColor = new Uint8Array(NS);
    this.subChar = new Uint8Array(NS);
    this.subEverHit = new Uint8Array(NS);

    this.baseData = new Uint8Array(NB * 4);
    this.subData = new Uint8Array(NS * 4);

    // Sparse random initial states.
    for (let i = 0; i < NB; i++) this.baseAlive[i] = Math.random() < 0.18 ? 1 : 0;
    for (let i = 0; i < NS; i++) this.subAlive[i] = Math.random() < 0.14 ? 1 : 0;

    // Title cells stay merged regardless of GoL.
    for (let x = TITLE_X_MIN; x <= TITLE_X_MAX; x++) {
      this.baseAlive[idxBase(x, TITLE_ROW)] = 0;
    }

    this.baseTexture = new THREE.DataTexture(this.baseData, GRID_W, GRID_H, THREE.RGBAFormat);
    this.subTexture = new THREE.DataTexture(this.subData, SUB_W, SUB_H, THREE.RGBAFormat);
    for (const t of [this.baseTexture, this.subTexture]) {
      t.minFilter = THREE.NearestFilter;
      t.magFilter = THREE.NearestFilter;
      t.wrapS = THREE.ClampToEdgeWrapping;
      t.wrapT = THREE.ClampToEdgeWrapping;
      t.flipY = false;
    }

    this.writeTextures();
  }

  tick(): void {
    this.stepBase();
    this.stepSub();

    this.tickCount++;
    if (this.tickCount % this.spawnEvery === 0) this.spawnPattern();

    this.writeTextures();
  }

  // ---- internal -----------------------------------------------------------

  private stepBase(): void {
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        if (isTitleBase(x, y)) {
          this.baseNext[idxBase(x, y)] = 0;
          continue;
        }
        const n = this.countBaseN(x, y);
        const a = this.baseAlive[idxBase(x, y)];
        this.baseNext[idxBase(x, y)] =
          a === 1 ? (n === 2 || n === 3 ? 1 : 0) : (n === 3 ? 1 : 0);
      }
    }
    const tmp = this.baseAlive;
    this.baseAlive = this.baseNext;
    this.baseNext = tmp;
  }

  private stepSub(): void {
    for (let y = 0; y < SUB_H; y++) {
      for (let x = 0; x < SUB_W; x++) {
        const n = this.countSubN(x, y);
        const a = this.subAlive[idxSub(x, y)];
        this.subNext[idxSub(x, y)] =
          a === 1 ? (n === 2 || n === 3 ? 1 : 0) : (n === 3 ? 1 : 0);
      }
    }
    for (let i = 0; i < this.subAlive.length; i++) {
      if (this.subAlive[i] !== this.subNext[i]) {
        this.subEverHit[i] = 1;
        this.subColor[i] = Math.random() < COLOR_P ? r255() : 0;
        this.subChar[i]  = Math.random() < CHAR_P  ? r255() : 0;
      }
    }
    const tmp = this.subAlive;
    this.subAlive = this.subNext;
    this.subNext = tmp;
  }

  private countBaseN(x: number, y: number): number {
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        n += this.baseAlive[idxBase(wrap(x + dx, GRID_W), wrap(y + dy, GRID_H))];
      }
    }
    return n;
  }

  private countSubN(x: number, y: number): number {
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        n += this.subAlive[idxSub(wrap(x + dx, SUB_W), wrap(y + dy, SUB_H))];
      }
    }
    return n;
  }

  private spawnPattern(): void {
    const p = PATTERNS[(Math.random() * PATTERNS.length) | 0];
    const ox = (Math.random() * SUB_W) | 0;
    const oy = (Math.random() * SUB_H) | 0;
    for (const [dx, dy] of p) {
      this.subAlive[idxSub(wrap(ox + dx, SUB_W), wrap(oy + dy, SUB_H))] = 1;
    }
  }

  private writeTextures(): void {
    // baseData: R = isSplit (alive), GBA reserved.
    for (let i = 0; i < this.baseAlive.length; i++) {
      const j = i * 4;
      this.baseData[j + 0] = this.baseAlive[i] ? 255 : 0;
      this.baseData[j + 1] = 0;
      this.baseData[j + 2] = 0;
      this.baseData[j + 3] = 255;
    }
    this.baseTexture.needsUpdate = true;

    // subData: R=color, G=char, B=everHit, A=alive.
    for (let i = 0; i < this.subAlive.length; i++) {
      const j = i * 4;
      this.subData[j + 0] = this.subColor[i];
      this.subData[j + 1] = this.subChar[i];
      this.subData[j + 2] = this.subEverHit[i] ? 255 : 0;
      this.subData[j + 3] = this.subAlive[i] ? 255 : 0;
    }
    this.subTexture.needsUpdate = true;
  }
}
