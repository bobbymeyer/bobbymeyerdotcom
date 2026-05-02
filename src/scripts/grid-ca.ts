import * as THREE from 'three';

// Grid dimensions. Wide enough to cover any likely viewport at the
// shader's DENSITY. Toroidal wrap for the GoL update.
export const GRID_W = 48;
export const GRID_H = 24;

// A handful of seed patterns. We periodically drop one of these into a
// random spot on the board so the simulation doesn't burn out.
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

const idx = (x: number, y: number) => y * GRID_W + x;
const wrap = (v: number, m: number) => ((v % m) + m) % m;

export class GridLife {
  private alive: Uint8Array;
  private next: Uint8Array;
  private seed: Uint8Array; // 0 = unrevealed (paper). 1..255 = placement seed.
  readonly data: Uint8Array;
  readonly texture: THREE.DataTexture;
  private tickCount = 0;
  private readonly spawnEvery = 14;

  constructor() {
    const N = GRID_W * GRID_H;
    this.alive = new Uint8Array(N);
    this.next = new Uint8Array(N);
    this.seed = new Uint8Array(N); // all start unrevealed
    this.data = new Uint8Array(N * 4);

    // Sparse random initial state.
    for (let i = 0; i < N; i++) {
      this.alive[i] = Math.random() < 0.16 ? 1 : 0;
    }

    this.texture = new THREE.DataTexture(this.data, GRID_W, GRID_H, THREE.RGBAFormat);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.flipY = false;
    this.writeTexture();
  }

  /** Advance one Game-of-Life generation and roll placements for any hit cells. */
  tick(): void {
    // Standard Conway rules with toroidal wrap.
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        const n = this.countNeighbors(x, y);
        const a = this.alive[idx(x, y)];
        this.next[idx(x, y)] = a === 1 ? (n === 2 || n === 3 ? 1 : 0) : (n === 3 ? 1 : 0);
      }
    }

    // Any cell whose state changed is a "hit" — re-roll its placement seed.
    // Pachinko: revealing the cell or shuffling what it shows.
    for (let i = 0; i < this.alive.length; i++) {
      if (this.alive[i] !== this.next[i]) {
        this.seed[i] = 1 + ((Math.random() * 255) | 0);
      }
    }

    const tmp = this.alive;
    this.alive = this.next;
    this.next = tmp;

    this.tickCount++;
    if (this.tickCount % this.spawnEvery === 0) this.spawnPattern();

    this.writeTexture();
  }

  private countNeighbors(x: number, y: number): number {
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        n += this.alive[idx(wrap(x + dx, GRID_W), wrap(y + dy, GRID_H))];
      }
    }
    return n;
  }

  private spawnPattern(): void {
    const p = PATTERNS[(Math.random() * PATTERNS.length) | 0];
    const ox = (Math.random() * GRID_W) | 0;
    const oy = (Math.random() * GRID_H) | 0;
    for (const [dx, dy] of p) {
      this.alive[idx(wrap(ox + dx, GRID_W), wrap(oy + dy, GRID_H))] = 1;
    }
  }

  private writeTexture(): void {
    const N = GRID_W * GRID_H;
    for (let i = 0; i < N; i++) {
      const j = i * 4;
      this.data[j + 0] = this.seed[i];           // 0 = paper, else placement seed
      this.data[j + 1] = this.alive[i] ? 255 : 0; // GoL state (currently unused by shader, kept for future ghost effects)
      this.data[j + 2] = 0;
      this.data[j + 3] = 255;
    }
    this.texture.needsUpdate = true;
  }
}
