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
 */
import * as THREE from 'three';
import type { Grid } from '../../sim/grid';
import { M } from '../../sim/materials';
import { matColor } from '../../ui/palette';

export type Group = 'semi' | 'diel' | 'metal' | 'resist' | 'glow';

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

class Buf {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  quad(a: number[], b: number[], c: number[], d: number[], n: number[], color: number[]) {
    const base = this.pos.length / 3;
    this.pos.push(...a, ...b, ...c, ...d);
    for (let i = 0; i < 4; i++) {
      this.nor.push(n[0], n[1], n[2]);
      this.col.push(color[0], color[1], color[2]);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const colorCache = new Map<string, number[]>();
function linearColor(mat: number, tag: number, dose: number): number[] {
  const dq = mat === M.RES ? Math.round(dose * 10) / 10 : 0;
  const key = `${mat}:${tag}:${dq}`;
  let c = colorCache.get(key);
  if (!c) {
    const col = new THREE.Color(matColor(mat, tag, dq));
    col.convertSRGBToLinear();
    c = [col.r, col.g, col.b];
    colorCache.set(key, c);
  }
  return c;
}

export function buildDeviceGeometry(g: Grid, o: MeshOptions): Record<Group, THREE.BufferGeometry> {
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

  // For a segment in column c, return visible z-intervals of its face towards column d.
  const zMin = o.zMin ?? -Infinity;
  const visibleIntervals = (c: number, k: number, d: number): [number, number][] => {
    const z0 = Math.max(zMin, g.base(c, k));
    const z1 = g.top[c * K + k];
    const myMat = g.mat[c * K + k];
    const myTag = g.tag[c * K + k];
    const mySee = see(myMat);
    if (z1 <= z0) return [];
    let parts: [number, number][] = [[z0, z1]];
    if (d < 0) return parts;
    const nd = g.n[d];
    for (let m = 0; m < nd && parts.length; m++) {
      const b0 = g.base(d, m);
      const b1 = g.top[d * K + m];
      if (b1 <= z0 || b0 >= z1) continue;
      const nm = g.mat[d * K + m];
      const nSee = see(nm);
      const hides = mySee ? nSee && nm === myMat && g.tag[d * K + m] === myTag : !nSee;
      if (!hides) continue;
      const next: [number, number][] = [];
      for (const [a, b] of parts) {
        if (b1 <= a || b0 >= b) {
          next.push([a, b]);
          continue;
        }
        if (b0 > a) next.push([a, b0]);
        if (b1 < b) next.push([b1, b]);
      }
      parts = next.filter(([a, b]) => b - a > 1e-4);
    }
    return parts;
  };

  // Top faces merged along x: key → open run
  type Run = { i0: number; i1: number; j: number; z: number; color: number[]; grp: Group };
  for (let j = j0; j < j1; j++) {
    const open = new Map<string, Run>();
    const flush = (key: string) => {
      const r = open.get(key)!;
      open.delete(key);
      const x0 = X(r.i0 * g.dx);
      const x1 = X(r.i1 * g.dx);
      const za = Z(r.j * g.dy);
      const zb = Z((r.j + 1) * g.dy);
      const y = Y(r.z);
      bufs[r.grp].quad([x0, y, za], [x1, y, za], [x1, y, zb], [x0, y, zb], [0, 1, 0], r.color);
    };
    for (let i = 0; i < g.nx; i++) {
      const c = j * g.nx + i;
      const n = g.n[c];
      const present = new Set<string>();
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
        const key = `${outGrp}|${color.join(',')}|${z.toFixed(3)}`;
        present.add(key);
        const r = open.get(key);
        if (r && r.i1 === i) r.i1 = i + 1;
        else {
          if (r) flush(key);
          open.set(key, { i0: i, i1: i + 1, j, z, color, grp: outGrp });
        }
      }
      for (const key of [...open.keys()]) if (!present.has(key)) flush(key);
    }
    for (const key of [...open.keys()]) flush(key);
  }

  // Side faces
  for (let j = j0; j < j1; j++) {
    for (let i = 0; i < g.nx; i++) {
      const c = j * g.nx + i;
      const n = g.n[c];
      const x0 = X(i * g.dx);
      const x1 = X((i + 1) * g.dx);
      const za = Z(j * g.dy);
      const zb = Z((j + 1) * g.dy);
      const nbr = {
        px: i + 1 < g.nx ? c + 1 : -1,
        nx: i > 0 ? c - 1 : -1,
        py: j + 1 < j1 ? c + g.nx : -1,
        ny: j > j0 ? c - g.nx : -1,
      };
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
        const emit = (dir: 'px' | 'nx' | 'py' | 'ny', d: number) => {
          for (const [a0, b0] of visibleIntervals(c, k, d)) {
            const pieces: [number, number, boolean][] = partial
              ? ([
                  [a0, Math.min(b0, split), false],
                  [Math.max(a0, split), b0, true],
                ] as [number, number, boolean][]).filter(([x, y]) => y - x > 1e-4)
              : [[a0, b0, lit]];
            for (const [a, bz, on] of pieces) {
              const b = bufs[on ? 'glow' : grp];
              const col = on ? GLOW_COLOR : baseColor;
              if (dir === 'px') b.quad([x1, Y(a), za], [x1, Y(a), zb], [x1, Y(bz), zb], [x1, Y(bz), za], [1, 0, 0], col);
              else if (dir === 'nx') b.quad([x0, Y(a), zb], [x0, Y(a), za], [x0, Y(bz), za], [x0, Y(bz), zb], [-1, 0, 0], col);
              else if (dir === 'ny') b.quad([x0, Y(a), za], [x1, Y(a), za], [x1, Y(bz), za], [x0, Y(bz), za], [0, 0, 1], col);
              else b.quad([x1, Y(a), zb], [x0, Y(a), zb], [x0, Y(bz), zb], [x1, Y(bz), zb], [0, 0, -1], col);
            }
          }
        };
        emit('px', nbr.px);
        emit('nx', nbr.nx);
        emit('ny', nbr.ny); // toward the viewer: includes the cut face
        emit('py', nbr.py);
      }
    }
  }
  return {
    semi: bufs.semi.geometry(),
    diel: bufs.diel.geometry(),
    metal: bufs.metal.geometry(),
    resist: bufs.resist.geometry(),
    glow: bufs.glow.geometry(),
  };
}
