import * as THREE from 'three';

// Two grids running Game of Life in parallel.
//   Base   (GRID_W × GRID_H): drives whether a cell is "split" or merged.
//   Sub    (SUB_W  × SUB_H ): drives the actual content (color + char).
// "Split" base cells render their 4 sub-cells; "merged" cells render
// a single big cell using the top-left sub-cell's content.
// Big enough to back a 24px-cell grid on any reasonable viewport
// (160 cells wide handles up to ~3840px, 32 tall handles up to ~768px).
export const GRID_W = 160;
export const GRID_H = 32;
export const SUB_W = GRID_W * 2;
export const SUB_H = GRID_H * 2;

// Each GoL hit first rolls blank vs content (BLANK_P chance of blank).
// If content, the color and character layers then roll independently.
const BLANK_P = 2 / 3;
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

// Title cells (BOBBY MEYER + the gap) live on a fixed row and column
// range. They're always rendered merged so the masthead never fragments.
// We pin a 3-row band so both the single-line layout (id.y == 0) and
// the stacked layout (id.y == ±1) are protected without needing to
// know the active layout.
const TITLE_ROW = Math.floor(GRID_H / 2);
const TITLE_X_MIN = Math.floor(GRID_W / 2) - 5;
const TITLE_X_MAX = Math.floor(GRID_W / 2) + 5;
const isTitleBase = (x: number, y: number) =>
  y >= TITLE_ROW - 1
  && y <= TITLE_ROW + 1
  && x >= TITLE_X_MIN
  && x <= TITLE_X_MAX;

// Reveal sequence starts with just the title row + one ring around it.
// Once BOBBY MEYER is fully revealed, the radius grows outward.
const INITIAL_REVEAL_RADIUS = 1;
const REVEAL_EXPAND_EVERY = 1;
const REVEAL_EXPAND_STEP  = 2;
const REVEAL_EXPAND_DELAY = 3;
const REVEAL_RADIUS_MAX   = 90;

export class GridLife {
  // Current state.
  private baseAlive: Uint8Array;
  private baseNext: Uint8Array;
  private subAlive: Uint8Array;
  private subNext: Uint8Array;
  private subColor: Uint8Array;
  private subChar: Uint8Array;
  private subEverHit: Uint8Array;

  // Snapshot of state right before the current tick — uploaded as the
  // "previous" textures so the shader can cross-fade between ticks.
  private baseAlivePrev: Uint8Array;
  private subColorPrev: Uint8Array;
  private subCharPrev: Uint8Array;
  private subEverHitPrev: Uint8Array;

  readonly baseData: Uint8Array;
  readonly subData: Uint8Array;
  readonly baseDataPrev: Uint8Array;
  readonly subDataPrev: Uint8Array;
  readonly baseTexture: THREE.DataTexture;
  readonly subTexture: THREE.DataTexture;
  readonly baseTexturePrev: THREE.DataTexture;
  readonly subTexturePrev: THREE.DataTexture;

  private tickCount = 0;
  private readonly spawnEvery = 10;

  // Reveal sequence state.
  private revealRadius = INITIAL_REVEAL_RADIUS;
  private titleRevealed = false;
  private ticksAfterReveal = 0;
  private stacked = false;
  // Two pre-computed anchor sets so we can switch layouts without
  // touching titleRevealed bookkeeping.
  private singleAnchors: ReadonlyArray<readonly [number, number]>;
  private stackedAnchors: ReadonlyArray<readonly [number, number]>;
  private get titleAnchors(): ReadonlyArray<readonly [number, number]> {
    return this.stacked ? this.stackedAnchors : this.singleAnchors;
  }

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

    this.baseAlivePrev = new Uint8Array(NB);
    this.subColorPrev = new Uint8Array(NS);
    this.subCharPrev = new Uint8Array(NS);
    this.subEverHitPrev = new Uint8Array(NS);

    this.baseData = new Uint8Array(NB * 4);
    this.subData = new Uint8Array(NS * 4);
    this.baseDataPrev = new Uint8Array(NB * 4);
    this.subDataPrev = new Uint8Array(NS * 4);

    // Single-line anchors (B O B B Y _ M E Y E R on TITLE_ROW).
    const single: Array<[number, number]> = [];
    for (let baseX = TITLE_X_MIN; baseX <= TITLE_X_MAX; baseX++) {
      const idX = baseX - GRID_W / 2;
      if (idX === 0) continue;
      single.push([baseX * 2, TITLE_ROW * 2]);
    }
    this.singleAnchors = single;

    // Stacked anchors: BOBBY on TITLE_ROW + 1, MEYER on TITLE_ROW - 1,
    // both at id.x ∈ [-2, 2] → baseX ∈ [GRID_W/2 - 2, GRID_W/2 + 2].
    const stackedList: Array<[number, number]> = [];
    const cx = Math.floor(GRID_W / 2);
    for (let dx = -2; dx <= 2; dx++) {
      stackedList.push([(cx + dx) * 2, (TITLE_ROW + 1) * 2]); // BOBBY row
      stackedList.push([(cx + dx) * 2, (TITLE_ROW - 1) * 2]); // MEYER row
    }
    this.stackedAnchors = stackedList;

    // Seed life only inside the initial reveal area.
    this.seedActiveRegion();

    this.baseTexture = new THREE.DataTexture(this.baseData, GRID_W, GRID_H, THREE.RGBAFormat);
    this.subTexture = new THREE.DataTexture(this.subData, SUB_W, SUB_H, THREE.RGBAFormat);
    this.baseTexturePrev = new THREE.DataTexture(this.baseDataPrev, GRID_W, GRID_H, THREE.RGBAFormat);
    this.subTexturePrev = new THREE.DataTexture(this.subDataPrev, SUB_W, SUB_H, THREE.RGBAFormat);
    for (const t of [this.baseTexture, this.subTexture, this.baseTexturePrev, this.subTexturePrev]) {
      t.minFilter = THREE.NearestFilter;
      t.magFilter = THREE.NearestFilter;
      t.wrapS = THREE.ClampToEdgeWrapping;
      t.wrapT = THREE.ClampToEdgeWrapping;
      t.flipY = false;
    }

    this.writeTextures();
    // Initialise prev textures to current — first frame has no fade.
    this.baseDataPrev.set(this.baseData);
    this.subDataPrev.set(this.subData);
    this.baseTexturePrev.needsUpdate = true;
    this.subTexturePrev.needsUpdate = true;
  }

  /** The shader picks layout from viewport width; the JS side mirrors
   *  it so titleAnchors / titleRevealed point at the right cells. */
  setStackedTitle(stacked: boolean): void {
    if (this.stacked === stacked) return;
    this.stacked = stacked;
    // Re-evaluate the reveal flag against the new anchor set.
    this.titleRevealed = this.checkTitleRevealed();
  }

  tick(): void {
    // Snapshot current state into prev arrays so the shader can lerp
    // between the just-finished frame's image and the upcoming one.
    this.baseAlivePrev.set(this.baseAlive);
    this.subColorPrev.set(this.subColor);
    this.subCharPrev.set(this.subChar);
    this.subEverHitPrev.set(this.subEverHit);
    this.writePrevTextures();

    this.stepBase();
    this.stepSub();
    this.clampInactive();

    if (!this.titleRevealed) {
      // Nudge the reveal along with the occasional forced hit on a still-dark
      // title anchor, so the masthead is guaranteed to finish appearing.
      if (Math.random() < 0.25) this.forceRevealOneTitleAnchor();
      if (this.checkTitleRevealed()) this.titleRevealed = true;
    } else {
      this.ticksAfterReveal++;
      if (
        this.ticksAfterReveal > REVEAL_EXPAND_DELAY
        && this.ticksAfterReveal % REVEAL_EXPAND_EVERY === 0
      ) {
        this.expandRadius();
      }
    }

    this.tickCount++;
    if (this.tickCount % this.spawnEvery === 0) this.spawnPattern();

    this.writeTextures();
  }

  // ---- reveal mask --------------------------------------------------------

  private isBaseActive(x: number, y: number): boolean {
    const vDist = Math.abs(y - TITLE_ROW);
    const hDist = Math.max(0, x - TITLE_X_MAX, TITLE_X_MIN - x);
    return Math.max(vDist, hDist) <= this.revealRadius;
  }
  private isSubActive(x: number, y: number): boolean {
    return this.isBaseActive(x >> 1, y >> 1);
  }

  private seedActiveRegion(): void {
    for (let y = 0; y < SUB_H; y++) {
      for (let x = 0; x < SUB_W; x++) {
        if (this.isSubActive(x, y) && Math.random() < 0.32) {
          this.subAlive[idxSub(x, y)] = 1;
        }
      }
    }
  }

  private clampInactive(): void {
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        if (!this.isBaseActive(x, y)) this.baseAlive[idxBase(x, y)] = 0;
      }
    }
    for (let y = 0; y < SUB_H; y++) {
      for (let x = 0; x < SUB_W; x++) {
        if (!this.isSubActive(x, y)) this.subAlive[idxSub(x, y)] = 0;
      }
    }
  }

  private checkTitleRevealed(): boolean {
    for (const [x, y] of this.titleAnchors) {
      if (!this.subEverHit[idxSub(x, y)]) return false;
    }
    return true;
  }

  private forceRevealOneTitleAnchor(): void {
    const dark: Array<readonly [number, number]> = [];
    for (const a of this.titleAnchors) {
      if (!this.subEverHit[idxSub(a[0], a[1])]) dark.push(a);
    }
    if (dark.length === 0) return;
    const [x, y] = dark[(Math.random() * dark.length) | 0];
    this.rollHit(idxSub(x, y));
  }

  /** Standard hit: 50% blank, otherwise independent color + char rolls. */
  private rollHit(i: number): void {
    this.subEverHit[i] = 1;
    if (Math.random() < BLANK_P) {
      this.subColor[i] = 0;
      this.subChar[i] = 0;
      return;
    }
    this.subColor[i] = Math.random() < COLOR_P ? r255() : 0;
    this.subChar[i]  = Math.random() < CHAR_P  ? r255() : 0;
  }

  private expandRadius(): void {
    if (this.revealRadius >= REVEAL_RADIUS_MAX) return;
    const prev = this.revealRadius;
    this.revealRadius = Math.min(prev + REVEAL_EXPAND_STEP, REVEAL_RADIUS_MAX);
    // Sprinkle life across every newly-included ring so GoL has something
    // to chew on as the active region grows.
    for (let y = 0; y < SUB_H; y++) {
      for (let x = 0; x < SUB_W; x++) {
        if (!this.isSubActive(x, y)) continue;
        const bx = x >> 1, by = y >> 1;
        const vDist = Math.abs(by - TITLE_ROW);
        const hDist = Math.max(0, bx - TITLE_X_MAX, TITLE_X_MIN - bx);
        const dist = Math.max(vDist, hDist);
        if (dist > prev && dist <= this.revealRadius && Math.random() < 0.22) {
          this.subAlive[idxSub(x, y)] = 1;
        }
      }
    }
  }

  // ---- standard GoL update -----------------------------------------------

  private stepBase(): void {
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        if (isTitleBase(x, y) || !this.isBaseActive(x, y)) {
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
        if (!this.isSubActive(x, y)) {
          this.subNext[idxSub(x, y)] = 0;
          continue;
        }
        const n = this.countSubN(x, y);
        const a = this.subAlive[idxSub(x, y)];
        this.subNext[idxSub(x, y)] =
          a === 1 ? (n === 2 || n === 3 ? 1 : 0) : (n === 3 ? 1 : 0);
      }
    }
    for (let i = 0; i < this.subAlive.length; i++) {
      if (this.subAlive[i] !== this.subNext[i]) this.rollHit(i);
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
    let ox = 0, oy = 0, found = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      ox = (Math.random() * SUB_W) | 0;
      oy = (Math.random() * SUB_H) | 0;
      if (this.isSubActive(ox, oy)) { found = true; break; }
    }
    if (!found) return;
    for (const [dx, dy] of p) {
      const sx = wrap(ox + dx, SUB_W);
      const sy = wrap(oy + dy, SUB_H);
      if (this.isSubActive(sx, sy)) {
        this.subAlive[idxSub(sx, sy)] = 1;
      }
    }
  }

  private writeTextures(): void {
    for (let i = 0; i < this.baseAlive.length; i++) {
      const j = i * 4;
      this.baseData[j + 0] = this.baseAlive[i] ? 255 : 0;
      this.baseData[j + 1] = 0;
      this.baseData[j + 2] = 0;
      this.baseData[j + 3] = 255;
    }
    this.baseTexture.needsUpdate = true;

    for (let i = 0; i < this.subAlive.length; i++) {
      const j = i * 4;
      this.subData[j + 0] = this.subColor[i];
      this.subData[j + 1] = this.subChar[i];
      this.subData[j + 2] = this.subEverHit[i] ? 255 : 0;
      this.subData[j + 3] = this.subAlive[i] ? 255 : 0;
    }
    this.subTexture.needsUpdate = true;
  }

  private writePrevTextures(): void {
    for (let i = 0; i < this.baseAlivePrev.length; i++) {
      const j = i * 4;
      this.baseDataPrev[j + 0] = this.baseAlivePrev[i] ? 255 : 0;
      this.baseDataPrev[j + 1] = 0;
      this.baseDataPrev[j + 2] = 0;
      this.baseDataPrev[j + 3] = 255;
    }
    this.baseTexturePrev.needsUpdate = true;

    for (let i = 0; i < this.subColorPrev.length; i++) {
      const j = i * 4;
      this.subDataPrev[j + 0] = this.subColorPrev[i];
      this.subDataPrev[j + 1] = this.subCharPrev[i];
      this.subDataPrev[j + 2] = this.subEverHitPrev[i] ? 255 : 0;
      this.subDataPrev[j + 3] = 0;
    }
    this.subTexturePrev.needsUpdate = true;
  }
}
