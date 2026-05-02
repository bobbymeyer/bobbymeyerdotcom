import * as THREE from 'three';

// Logical grid covered by the CA. Should be wide enough to fill any
// likely viewport at the chosen DENSITY. id.y == 0 in the shader maps
// to grid_y == GRID_H/2.
export const GRID_W = 48;
export const GRID_H = 24;
export const MAX_SIZE = 5;
const TITLE_ROW = Math.floor(GRID_H / 2); // never modified, reserved for the BOBBY MEYER row

interface Cell {
  x: number; // anchor in grid coords [0, GRID_W)
  y: number; // anchor in grid coords [0, GRID_H)
  size: number; // 1..MAX_SIZE — square edge length in fine cells
  seed: number; // 0..255 — drives content selection in the shader
}

const rand255 = () => (Math.random() * 256) | 0;

export class GridCA {
  private cells: Cell[] = [];
  // occupancy[y * GRID_W + x] = index into cells, or -1 if empty.
  private occupancy = new Int32Array(GRID_W * GRID_H).fill(-1);
  readonly data = new Uint8Array(GRID_W * GRID_H * 4);
  readonly texture: THREE.DataTexture;

  constructor() {
    this.texture = new THREE.DataTexture(this.data, GRID_W, GRID_H, THREE.RGBAFormat);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.flipY = false;
    this.texture.needsUpdate = true;

    this.reset();
    // Warm up so the initial frame already has variety.
    for (let i = 0; i < 80; i++) this.step();
    this.writeTexture();
  }

  /** Reset to a uniform field of 1×1 cells. */
  reset(): void {
    this.cells = [];
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        this.cells.push({ x, y, size: 1, seed: rand255() });
      }
    }
    this.rebuildOccupancy();
  }

  /** One CA tick: apply a small number of grow/split operations. */
  tick(): void {
    const ops = 1 + ((Math.random() * 3) | 0); // 1..3 ops per tick
    for (let i = 0; i < ops; i++) this.step();
    this.writeTexture();
  }

  // ---- internal -------------------------------------------------------------

  private step(): void {
    if (this.cells.length === 0) return;
    let idx = (Math.random() * this.cells.length) | 0;
    // Skip title-row cells; they stay 1×1 forever.
    let attempts = 0;
    while (this.cells[idx].y === TITLE_ROW && attempts < 8) {
      idx = (Math.random() * this.cells.length) | 0;
      attempts++;
    }
    if (this.cells[idx].y === TITLE_ROW) return;

    if (Math.random() < 0.55) {
      if (!this.tryGrow(idx)) this.trySplit(idx);
    } else {
      if (!this.trySplit(idx)) this.tryGrow(idx);
    }
  }

  private rebuildOccupancy(): void {
    this.occupancy.fill(-1);
    for (let i = 0; i < this.cells.length; i++) {
      const c = this.cells[i];
      for (let dy = 0; dy < c.size; dy++) {
        for (let dx = 0; dx < c.size; dx++) {
          this.occupancy[(c.y + dy) * GRID_W + (c.x + dx)] = i;
        }
      }
    }
  }

  /**
   * Try to grow cell[i] to size+1 by consuming the L-strip on its top and
   * right (the new (2*size + 1) fine cells). Only succeeds if all consumed
   * cells are in-bounds, currently 1×1, and not in the title row.
   */
  private tryGrow(i: number): boolean {
    const cell = this.cells[i];
    if (cell.size >= MAX_SIZE) return false;

    const newSize = cell.size + 1;
    const ax = cell.x;
    const ay = cell.y;

    // After growing, the new cell occupies [ax, ax+newSize) × [ay, ay+newSize).
    if (ax + newSize > GRID_W || ay + newSize > GRID_H) return false;
    if (ay <= TITLE_ROW && TITLE_ROW < ay + newSize) return false;

    const consumed: number[] = [];
    // Top row at y = ay + cell.size, x in [ax, ax+newSize)
    for (let dx = 0; dx < newSize; dx++) {
      const occ = this.occupancy[(ay + cell.size) * GRID_W + (ax + dx)];
      if (occ === -1) return false;
      const c = this.cells[occ];
      if (c.size !== 1 || c.y === TITLE_ROW) return false;
      consumed.push(occ);
    }
    // Right column at x = ax + cell.size, y in [ay, ay+cell.size)
    for (let dy = 0; dy < cell.size; dy++) {
      const occ = this.occupancy[(ay + dy) * GRID_W + (ax + cell.size)];
      if (occ === -1) return false;
      const c = this.cells[occ];
      if (c.size !== 1 || c.y === TITLE_ROW) return false;
      consumed.push(occ);
    }

    cell.size = newSize;
    cell.seed = rand255();
    const removeSet = new Set(consumed);
    this.cells = this.cells.filter((_, idx) => !removeSet.has(idx));
    this.rebuildOccupancy();
    return true;
  }

  /**
   * Replace cell[i] (size N) with N² fresh 1×1 cells. No-op for size 1.
   */
  private trySplit(i: number): boolean {
    const cell = this.cells[i];
    if (cell.size <= 1) return false;
    const ax = cell.x;
    const ay = cell.y;
    const sz = cell.size;
    this.cells.splice(i, 1);
    for (let dy = 0; dy < sz; dy++) {
      for (let dx = 0; dx < sz; dx++) {
        this.cells.push({ x: ax + dx, y: ay + dy, size: 1, seed: rand255() });
      }
    }
    this.rebuildOccupancy();
    return true;
  }

  /**
   * Fill the GPU-uploadable byte array. Per-fragment encoding: each grid
   * cell stores its offset within its containing CA cell (R, G), the
   * containing cell's size (B), and the cell's seed (A).
   */
  private writeTexture(): void {
    const data = this.data;
    for (let i = 0; i < this.cells.length; i++) {
      const c = this.cells[i];
      for (let dy = 0; dy < c.size; dy++) {
        for (let dx = 0; dx < c.size; dx++) {
          const idx = ((c.y + dy) * GRID_W + (c.x + dx)) * 4;
          data[idx + 0] = dx;
          data[idx + 1] = dy;
          data[idx + 2] = c.size;
          data[idx + 3] = c.seed;
        }
      }
    }
    this.texture.needsUpdate = true;
  }
}
