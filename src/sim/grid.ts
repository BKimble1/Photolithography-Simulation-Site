/**
 * Column-stack representation of one (greatly magnified, schematic) inverter cell.
 *
 * The cell is a regular grid of columns in x/y. Each column holds up to K segments stacked
 * bottom-to-top; a segment is (material, top z, tag) and its bottom is the previous
 * segment's top (or zBase for the first). Process operations mutate these stacks.
 * `dose` holds, per column, the light absorbed by the resist at the top of that column
 * (its latent image) between exposure and development.
 *
 * Units are schematic "grid units" (gu): x runs 0..96 gu across the cell at 0.5 gu per
 * column, y runs 0..64 gu at 1 gu per row. Heights are also gu. Nothing here is to scale
 * with a real process; relative relationships (what covers what, what is thicker) are kept.
 */

import { M } from './materials';

export const GRID = {
  NX: 192,
  NY: 64,
  DX: 0.5,
  DY: 1,
  K: 16,
  Z_BASE: -18,
  /** Physical extent of the cell in gu. */
  WIDTH: 96,
  DEPTH: 64,
} as const;

const EPS = 1e-4;

export class Grid {
  readonly nx: number;
  readonly ny: number;
  readonly K: number;
  readonly dx: number;
  readonly dy: number;
  readonly zBase: number;
  n: Uint8Array;
  mat: Uint8Array;
  tag: Uint8Array;
  top: Float32Array;
  dose: Float32Array;

  constructor(nx: number, ny: number, K: number, dx: number, dy: number, zBase: number, init = true) {
    this.nx = nx;
    this.ny = ny;
    this.K = K;
    this.dx = dx;
    this.dy = dy;
    this.zBase = zBase;
    const cols = nx * ny;
    this.n = init ? new Uint8Array(cols) : (undefined as unknown as Uint8Array);
    this.mat = init ? new Uint8Array(cols * K) : (undefined as unknown as Uint8Array);
    this.tag = init ? new Uint8Array(cols * K) : (undefined as unknown as Uint8Array);
    this.top = init ? new Float32Array(cols * K) : (undefined as unknown as Float32Array);
    this.dose = init ? new Float32Array(cols) : (undefined as unknown as Float32Array);
  }

  static create(): Grid {
    return new Grid(GRID.NX, GRID.NY, GRID.K, GRID.DX, GRID.DY, GRID.Z_BASE);
  }

  clone(): Grid {
    const g = new Grid(this.nx, this.ny, this.K, this.dx, this.dy, this.zBase, false);
    g.n = this.n.slice();
    g.mat = this.mat.slice();
    g.tag = this.tag.slice();
    g.top = this.top.slice();
    g.dose = this.dose.slice();
    return g;
  }

  get columns(): number {
    return this.nx * this.ny;
  }

  col(i: number, j: number): number {
    return j * this.nx + i;
  }

  /** Centre x (gu) of column index i. */
  xOf(i: number): number {
    return (i + 0.5) * this.dx;
  }

  /** Centre y (gu) of row index j. */
  yOf(j: number): number {
    return (j + 0.5) * this.dy;
  }

  count(c: number): number {
    return this.n[c];
  }

  base(c: number, k: number): number {
    return k === 0 ? this.zBase : this.top[c * this.K + k - 1];
  }

  surface(c: number): number {
    const n = this.n[c];
    return n === 0 ? this.zBase : this.top[c * this.K + n - 1];
  }

  topMat(c: number): number {
    const n = this.n[c];
    return n === 0 ? M.AIR : this.mat[c * this.K + n - 1];
  }

  topTag(c: number): number {
    const n = this.n[c];
    return n === 0 ? 0 : this.tag[c * this.K + n - 1];
  }

  thickness(c: number, k: number): number {
    return this.top[c * this.K + k] - this.base(c, k);
  }

  /** Append a segment of the given thickness, merging with an identical segment below. */
  push(c: number, mat: number, thickness: number, tag = 0): void {
    if (thickness <= EPS) return;
    const K = this.K;
    const n = this.n[c];
    const base = c * K;
    const z = (n === 0 ? this.zBase : this.top[base + n - 1]) + thickness;
    if (n > 0) {
      const k = base + n - 1;
      if (this.mat[k] === mat && this.tag[k] === tag) {
        this.top[k] = z;
        return;
      }
    }
    if (n >= K) throw new Error(`Column ${c} overflow (K=${K})`);
    this.mat[base + n] = mat;
    this.tag[base + n] = tag;
    this.top[base + n] = z;
    this.n[c] = n + 1;
  }

  pop(c: number): void {
    if (this.n[c] > 0) this.n[c] -= 1;
  }

  /** Remove everything above height z (cutting the segment that straddles it). */
  truncate(c: number, z: number): void {
    const K = this.K;
    const base = c * K;
    let n = this.n[c];
    while (n > 0) {
      const b = n === 1 ? this.zBase : this.top[base + n - 2];
      if (b >= z - EPS) {
        n -= 1;
        continue;
      }
      if (this.top[base + n - 1] > z) this.top[base + n - 1] = z;
      break;
    }
    this.n[c] = n;
  }

  /**
   * Split the segment straddling height z into two identical segments meeting at z.
   * Returns the index of the upper part, or -1 if z coincides with a boundary / is outside.
   */
  split(c: number, z: number): number {
    const K = this.K;
    const base = c * K;
    const n = this.n[c];
    for (let k = 0; k < n; k++) {
      const b = k === 0 ? this.zBase : this.top[base + k - 1];
      const t = this.top[base + k];
      if (z > b + EPS && z < t - EPS) {
        if (n >= K) throw new Error(`Column ${c} overflow on split`);
        for (let m = n; m > k; m--) {
          this.mat[base + m] = this.mat[base + m - 1];
          this.tag[base + m] = this.tag[base + m - 1];
          this.top[base + m] = this.top[base + m - 1];
        }
        this.top[base + k] = z;
        this.n[c] = n + 1;
        return k + 1;
      }
    }
    return -1;
  }

  /** Merge vertically adjacent segments with identical properties (after tag rewrites). */
  compact(c: number): void {
    const K = this.K;
    const base = c * K;
    let n = this.n[c];
    let w = 0;
    for (let r = 0; r < n; r++) {
      const ri = base + r;
      if (w > 0) {
        const wi = base + w - 1;
        if (this.mat[wi] === this.mat[ri] && this.tag[wi] === this.tag[ri]) {
          this.top[wi] = this.top[ri];
          continue;
        }
      }
      const wi = base + w;
      if (wi !== ri) {
        this.mat[wi] = this.mat[ri];
        this.tag[wi] = this.tag[ri];
        this.top[wi] = this.top[ri];
      }
      w++;
    }
    n = w;
    this.n[c] = n;
  }

  /** Remove segment k, shifting everything above it down by its thickness. */
  removeAt(c: number, k: number): void {
    const K = this.K;
    const base = c * K;
    const n = this.n[c];
    const th = this.thickness(c, k);
    for (let m = k; m < n - 1; m++) {
      this.mat[base + m] = this.mat[base + m + 1];
      this.tag[base + m] = this.tag[base + m + 1];
      this.top[base + m] = this.top[base + m + 1] - th;
    }
    this.n[c] = n - 1;
  }

  /** Index of the topmost segment of a material, or -1. */
  findTop(c: number, mat: number): number {
    const base = c * this.K;
    for (let k = this.n[c] - 1; k >= 0; k--) if (this.mat[base + k] === mat) return k;
    return -1;
  }

  /** Topmost silicon segment index, or -1. */
  siTopIndex(c: number): number {
    return this.findTop(c, M.SI);
  }

  /** A stable fingerprint of the grid contents (used for determinism tests). */
  fingerprint(): string {
    let h1 = 0x811c9dc5 | 0;
    let h2 = 0x01000193 | 0;
    const mix = (v: number) => {
      h1 = Math.imul(h1 ^ v, 0x01000193);
      h2 = Math.imul(h2 ^ (v >>> 3), 0x5bd1e995);
    };
    for (let c = 0; c < this.columns; c++) {
      const n = this.n[c];
      mix(n);
      const base = c * this.K;
      for (let k = 0; k < n; k++) {
        mix(this.mat[base + k]);
        mix(this.tag[base + k]);
        mix(Math.round(this.top[base + k] * 1000));
      }
      mix(Math.round(this.dose[c] * 1000));
    }
    return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
  }
}
