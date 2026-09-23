/**
 * Builds render geometry from the column-stack die grid.
 *
 * Every segment is a box (one column wide). To keep the triangle count and overdraw low:
 *  - side faces are emitted only where the neighbouring column does not hide them
 *    (opaque next to opaque is hidden; the cut plane and air are always visible);
 *  - top faces are emitted only where the next segment up is air or a see-through group,
 *    and are merged into runs along x.
 * Output is split into groups (silicon/poly, dielectrics, metals, resist) so each can use
 * its own material, and dielectrics can switch to a ghosted "x-ray" look.
 *
 * Pure (no three.js): it runs in a worker (mesh.worker.ts) as well as on the main thread;
 * deviceGeometry.ts turns its arrays into three.js geometry.
 */
import type { Grid } from '../../sim/grid';
import { M } from '../../sim/materials';
import { matColor } from '../../ui/palette';

export type Group = 'semi' | 'diel' | 'metal' | 'resist' | 'glow';

/** Device-space scale: world units per grid unit, vertical exaggeration, substrate clip. */
export const DEV = { s: 0.05, zs: 1.3, zMin: -13 };

export function groupOf(mat: number): Group {
  if (mat === M.W || mat === M.CU) return 'metal';
  if (mat === M.RES) return 'resist';
  if (mat === M.OX || mat === M.NIT || mat === M.ILD || mat === M.CAP || mat === M.PASS) return 'diel';
  return 'semi';
}

export interface MeshOptions {
  /** First row (gu, y) included — rows in front of it are cut away. */
  yMin: number;
  yMax?: number;
  xray: boolean;
  /** World units per gu (horizontal). */
  s: number;
  /** Vertical exaggeration. */
  zs: number;
  /** Hide these groups entirely (e.g. dielectrics in the final circuit view). */
  hide?: Partial<Record<Group, boolean>>;
  /** Clip the substrate below this height (gu). */
  zMin?: number;
  /** Segment indices (column*K + k) to draw in the glowing "current path" group. */
  glow?: Set<number>;
}

const GLOW_COLOR = [0.16, 0.85, 0.52];
const CHANNEL_DEPTH = 0.9; // gu of silicon drawn as the conducting inversion layer

/** Grows typed arrays in place: no temporary arrays per quad (the mesher emits many thousands). */
class Buf {
  pos = new Float32Array(3 * 4 * 1024);
  nor = new Float32Array(3 * 4 * 1024);
  col = new Float32Array(3 * 4 * 1024);
  idx = new Uint32Array(6 * 1024);
  quads = 0;
  private grow() {
    const g = <T extends Float32Array | Uint32Array>(a: T): T => {
      const b = new (a.constructor as { new (n: number): T })(a.length * 2);
      b.set(a);
      return b;
    };
    this.pos = g(this.pos);
    this.nor = g(this.nor);
    this.col = g(this.col);
    this.idx = g(this.idx);
  }
  /** One quad: corners a, b, c, d (x, y, z each), normal n, colour. */
  quad(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    dx: number, dy: number, dz: number,
    nx: number, ny: number, nz: number,
    color: number[],
  ) {
    if ((this.quads + 1) * 6 > this.idx.length) this.grow();
    const v = this.quads * 12;
    const p = this.pos;
    p[v] = ax; p[v + 1] = ay; p[v + 2] = az;
    p[v + 3] = bx; p[v + 4] = by; p[v + 5] = bz;
    p[v + 6] = cx; p[v + 7] = cy; p[v + 8] = cz;
    p[v + 9] = dx; p[v + 10] = dy; p[v + 11] = dz;
    const n = this.nor;
    const c = this.col;
    for (let i = 0; i < 4; i++) {
      n[v + i * 3] = nx; n[v + i * 3 + 1] = ny; n[v + i * 3 + 2] = nz;
      c[v + i * 3] = color[0]; c[v + i * 3 + 1] = color[1]; c[v + i * 3 + 2] = color[2];
    }
    const base = this.quads * 4;
    const q = this.quads * 6;
    const x = this.idx;
    x[q] = base; x[q + 1] = base + 1; x[q + 2] = base + 2;
    x[q + 3] = base; x[q + 4] = base + 2; x[q + 5] = base + 3;
    this.quads++;
  }
  arrays(): MeshArrays {
    const nv = this.quads * 12;
    return { pos: this.pos.slice(0, nv), nor: this.nor.slice(0, nv), col: this.col.slice(0, nv), idx: this.idx.slice(0, this.quads * 6) };
  }
}

export interface MeshArrays {
  pos: Float32Array;
  nor: Float32Array;
  col: Float32Array;
  idx: Uint32Array;
}

export type DeviceArrays = Record<Group, MeshArrays>;

/** sRGB hex → linear RGB, exactly as three.js' Color does (colour-managed). */
function hexToLinear(hex: string): number[] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  const lin = (c: number) => (c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4));
  return [lin(((n >> 16) & 255) / 255), lin(((n >> 8) & 255) / 255), lin((n & 255) / 255)];
}

const colorCache = new Map<number, number[]>();
/** Each distinct colour array gets a small id (top-face runs are keyed by it). */
const colorIds = new Map<number[], number>([[GLOW_COLOR, 0]]);
function linearColor(mat: number, tag: number, dose: number): number[] {
  const dq = mat === M.RES ? Math.round(dose * 10) / 10 : 0;
  const key = (mat * 256 + tag) * 64 + Math.round(dq * 10);
  let c = colorCache.get(key);
  if (!c) {
    c = hexToLinear(matColor(mat, tag, dq));
    // (colours equal in value share an id, as string keys of their values would)
    let same = -1;
    for (const [arr, id] of colorIds) if (arr[0] === c[0] && arr[1] === c[1] && arr[2] === c[2]) same = id;
    colorIds.set(c, same >= 0 ? same : colorIds.size);
    colorCache.set(key, c);
  }
  return c;
}

const GROUP_ID: Record<Group, number> = { semi: 0, diel: 1, metal: 2, resist: 3, glow: 4 };

export function buildDeviceArrays(g: Grid, o: MeshOptions): DeviceArrays {
  const bufs: Record<Group, Buf> = { semi: new Buf(), diel: new Buf(), metal: new Buf(), resist: new Buf(), glow: new Buf() };
  const glow = o.glow;
  const K = g.K;
  const j0 = Math.max(0, Math.floor(o.yMin / g.dy));
  const j1 = Math.min(g.ny, o.yMax !== undefined ? Math.ceil(o.yMax / g.dy) : g.ny);
  const s = o.s;
  const zs = o.zs;
  const cx = (g.nx * g.dx) / 2;
  const cy = (g.ny * g.dy) / 2;
  const X = (xg: number) => (xg - cx) * s;
  const Z = (yg: number) => -(yg - cy) * s; // world z (toward the viewer for small y)
  const Y = (zg: number) => zg * zs * s;
  const hidden = (grp: Group) => !!o.hide?.[grp];
  const see = (mat: number) => {
    const grp = groupOf(mat);
    return hidden(grp) || (o.xray && grp === 'diel');
  };

  // Visible z-intervals of a segment's face towards column d, written to `iv` (pairs); returns
  // how many. (Scratch buffers instead of arrays per call: this runs for every face.)
  const zMin = o.zMin ?? -Infinity;
  let iv = new Float64Array(64);
  let tmp = new Float64Array(64);
  const visibleIntervals = (c: number, k: number, d: number): number => {
    const z0 = Math.max(zMin, g.base(c, k));
    const z1 = g.top[c * K + k];
    const myMat = g.mat[c * K + k];
    const myTag = g.tag[c * K + k];
    const mySee = see(myMat);
    if (z1 <= z0) return 0;
    iv[0] = z0;
    iv[1] = z1;
    let n = 1;
    if (d < 0) return n;
    const nd = g.n[d];
    for (let m = 0; m < nd && n; m++) {
      const b0 = g.base(d, m);
      const b1 = g.top[d * K + m];
      if (b1 <= z0 || b0 >= z1) continue;
      const nm = g.mat[d * K + m];
      const nSee = see(nm);
      const hides = mySee ? nSee && nm === myMat && g.tag[d * K + m] === myTag : !nSee;
      if (!hides) continue;
      if (tmp.length < 4 * n + 4) tmp = new Float64Array(8 * n + 8);
      let t = 0;
      for (let q = 0; q < n; q++) {
        const a = iv[2 * q];
        const b = iv[2 * q + 1];
        if (b1 <= a || b0 >= b) {
          if (b - a > 1e-4) {
            tmp[2 * t] = a;
            tmp[2 * t + 1] = b;
            t++;
          }
          continue;
        }
        if (b0 > a && b0 - a > 1e-4) {
          tmp[2 * t] = a;
          tmp[2 * t + 1] = b0;
          t++;
        }
        if (b1 < b && b - b1 > 1e-4) {
          tmp[2 * t] = b1;
          tmp[2 * t + 1] = b;
          t++;
        }
      }
      const sw = iv;
      iv = tmp;
      tmp = sw;
      n = t;
    }
    return n;
  };

  // Top faces merged along x: key → open run (numeric keys: group, colour and height)
  type Run = { i0: number; i1: number; j: number; z: number; color: number[]; grp: Group; seen: number };
  for (let j = j0; j < j1; j++) {
    const open = new Map<number, Run>();
    const za = Z(j * g.dy);
    const zb = Z((j + 1) * g.dy);
    const flush = (key: number) => {
      const r = open.get(key)!;
      open.delete(key);
      const x0 = X(r.i0 * g.dx);
      const x1 = X(r.i1 * g.dx);
      const y = Y(r.z);
      bufs[r.grp].quad(x0, y, za, x1, y, za, x1, y, zb, x0, y, zb, 0, 1, 0, r.color);
    };
    for (let i = 0; i < g.nx; i++) {
      const c = j * g.nx + i;
      const n = g.n[c];
      for (let k = 0; k < n; k++) {
        const idx = c * K + k;
        const mat = g.mat[idx];
        const grp = groupOf(mat);
        if (hidden(grp) || g.top[idx] <= zMin) continue;
        const top = k === n - 1;
        const nextSee = !top && see(g.mat[idx + 1]);
        const mySee = see(mat);
        if (!(top || (nextSee && !mySee) || (mySee && nextSee && g.mat[idx + 1] !== mat))) continue;
        const lit = glow?.has(idx) ?? false;
        const color = lit ? GLOW_COLOR : linearColor(mat, g.tag[idx], g.dose[c]);
        const z = g.top[idx];
        const outGrp: Group = lit ? 'glow' : grp;
        const key = ((colorIds.get(color) ?? 0) * 8 + GROUP_ID[outGrp]) * 131072 + (Math.round(z * 1000) + 65536);
        const r = open.get(key);
        if (r && r.i1 === i) {
          r.i1 = i + 1;
          r.seen = i;
        } else {
          if (r) flush(key);
          open.set(key, { i0: i, i1: i + 1, j, z, color, grp: outGrp, seen: i });
        }
      }
      for (const [key, r] of open) if (r.seen !== i) flush(key);
    }
    for (const key of [...open.keys()]) flush(key);
  }

  // Side faces
  for (let j = j0; j < j1; j++) {
    const za = Z(j * g.dy);
    const zb = Z((j + 1) * g.dy);
    for (let i = 0; i < g.nx; i++) {
      const c = j * g.nx + i;
      const n = g.n[c];
      const x0 = X(i * g.dx);
      const x1 = X((i + 1) * g.dx);
      const npx = i + 1 < g.nx ? c + 1 : -1;
      const nnx = i > 0 ? c - 1 : -1;
      const npy = j + 1 < j1 ? c + g.nx : -1;
      const nny = j > j0 ? c - g.nx : -1;
      for (let k = 0; k < n; k++) {
        const idx = c * K + k;
        const mat = g.mat[idx];
        const grp = groupOf(mat);
        if (hidden(grp)) continue;
        const baseColor = linearColor(mat, g.tag[idx], g.dose[c]);
        const lit = glow?.has(idx) ?? false;
        // A lit silicon channel/well segment glows only in a thin surface layer.
        const segTop = g.top[idx];
        const partial = lit && mat === M.SI && segTop - g.base(c, k) > CHANNEL_DEPTH * 1.5;
        const split = partial ? segTop - CHANNEL_DEPTH : Infinity;
        const put = (dir: number, a: number, bz: number, on: boolean) => {
          const b = bufs[on ? 'glow' : grp];
          const col = on ? GLOW_COLOR : baseColor;
          const ya = Y(a);
          const yb = Y(bz);
          if (dir === 0) b.quad(x1, ya, za, x1, ya, zb, x1, yb, zb, x1, yb, za, 1, 0, 0, col);
          else if (dir === 1) b.quad(x0, ya, zb, x0, ya, za, x0, yb, za, x0, yb, zb, -1, 0, 0, col);
          else if (dir === 2) b.quad(x0, ya, za, x1, ya, za, x1, yb, za, x0, yb, za, 0, 0, 1, col);
          else b.quad(x1, ya, zb, x0, ya, zb, x0, yb, zb, x1, yb, zb, 0, 0, -1, col);
        };
        const emit = (dir: number, d: number) => {
          const m = visibleIntervals(c, k, d);
          for (let q = 0; q < m; q++) {
            const a0 = iv[2 * q];
            const b0 = iv[2 * q + 1];
            if (partial) {
              const lo = Math.min(b0, split);
              const hi = Math.max(a0, split);
              if (lo - a0 > 1e-4) put(dir, a0, lo, false);
              if (b0 - hi > 1e-4) put(dir, hi, b0, true);
            } else put(dir, a0, b0, lit);
          }
        };
        emit(0, npx);
        emit(1, nnx);
        emit(2, nny); // toward the viewer: includes the cut face
        emit(3, npy);
      }
    }
  }
  return {
    semi: bufs.semi.arrays(),
    diel: bufs.diel.arrays(),
    metal: bufs.metal.arrays(),
    resist: bufs.resist.arrays(),
    glow: bufs.glow.arrays(),
  };
}
