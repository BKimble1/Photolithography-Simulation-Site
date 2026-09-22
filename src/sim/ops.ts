/**
 * Process operations. Each operation is plain data (so the history can be hashed, replayed
 * and compared) and `applyOp` mutates a SimState in place. Replaying the same list of
 * operations from the initial state always produces the same state.
 *
 * Physics is schematic and qualitative on purpose; see ACCURACY.md for what each
 * approximation keeps and what it leaves out.
 */

import { Grid } from './grid';
import type { MaskId } from './layout';
import { DOP, M, RES, type MatId } from './materials';
import { aerialImage, blur, type Raster } from './optics';
import type { Film, SimState, WaferSummary } from './types';
import { INCOMING_PARTICLES } from './dies';

// ───────────────────────────────── resist model ─────────────────────────────────

/** Resist recipes per purpose: nominal thickness (gu), illustrative nm for colour. */
export const RESIST_RECIPES = {
  fine: { t: 6, nm: 240, label: 'thin positive resist' },
  implant: { t: 19, nm: 1400, label: 'thick implant resist' },
  sd: { t: 9, nm: 700, label: 'implant resist' },
} as const;
export type ResistRecipe = keyof typeof RESIST_RECIPES;

/** Fraction of light absorbed on the way through a nominal-thickness film (αt). */
export const RESIST_ABSORBANCE = 0.3;
/** Development contrast (steepness of dissolution rate vs. dose). */
export const RESIST_CONTRAST = 9;
/** The developer, in its fixed time, can dissolve this multiple of the nominal thickness. */
export const DEV_CAPACITY = 1.45;
const R_MIN = 0.004; // dissolution rate of unexposed resist relative to fully exposed

/** Dissolution rate (relative, 0..1) of chemically amplified positive resist vs. dose. */
export function dissolutionRate(dose: number): number {
  if (dose <= 0) return R_MIN;
  const s = 1 / (1 + Math.pow(1 / dose, RESIST_CONTRAST));
  return R_MIN + (1 - R_MIN) * s;
}

/**
 * How deep the developer clears in its fixed time for a column with surface dose E0 in a
 * film of thickness t (nominal tNom). Light is attenuated with depth (Beer–Lambert), so
 * the bottom of a thick or under-dosed film dissolves last.
 */
export function clearedDepthExact(E0: number, t: number, tNom: number): number {
  const alpha = RESIST_ABSORBANCE / tNom;
  const tDev = DEV_CAPACITY * tNom; // developer time × max rate, in gu
  const steps = 40;
  const dz = t / steps;
  let time = 0;
  for (let s = 0; s < steps; s++) {
    const z = (s + 0.5) * dz;
    const rate = dissolutionRate(E0 * Math.exp(-alpha * z));
    const need = dz / rate;
    if (time + need > tDev) {
      // Partial last slab.
      return s * dz + (tDev - time) * rate;
    }
    time += need;
  }
  return t;
}

// In units of tNom the result depends only on (E0, t/tNom), so tabulate it once.
const LUT_E_MAX = 12;
const LUT_E_N = 240;
const LUT_R_MAX = 4;
const LUT_R_N = 100;
let LUT: Float32Array | null = null;
function buildLut(): Float32Array {
  const lut = new Float32Array((LUT_E_N + 1) * (LUT_R_N + 1));
  for (let i = 0; i <= LUT_E_N; i++) {
    const e = (i / LUT_E_N) * LUT_E_MAX;
    for (let j = 0; j <= LUT_R_N; j++) {
      const r = (j / LUT_R_N) * LUT_R_MAX;
      lut[i * (LUT_R_N + 1) + j] = clearedDepthExact(e, r, 1);
    }
  }
  return lut;
}

/** Fast tabulated version of clearedDepthExact (bilinear interpolation). */
export function clearedDepth(E0: number, t: number, tNom: number): number {
  if (!LUT) LUT = buildLut();
  const r = t / tNom;
  if (E0 >= LUT_E_MAX || r >= LUT_R_MAX) return clearedDepthExact(E0, t, tNom);
  const fe = (Math.max(0, E0) / LUT_E_MAX) * LUT_E_N;
  const fr = (r / LUT_R_MAX) * LUT_R_N;
  const i = Math.floor(fe);
  const j = Math.floor(fr);
  const ae = fe - i;
  const ar = fr - j;
  const W = LUT_R_N + 1;
  const v00 = LUT[i * W + j];
  const v01 = LUT[i * W + j + 1];
  const v10 = LUT[(i + 1) * W + j];
  const v11 = LUT[(i + 1) * W + j + 1];
  const v = (v00 * (1 - ar) + v01 * ar) * (1 - ae) + (v10 * (1 - ar) + v11 * ar) * ae;
  return Math.min(t, v * tNom);
}

/**
 * Dose-to-size: the surface dose at which, where the aerial image is at half intensity,
 * the developer removes half of a nominal film — so line edges (measured at half height,
 * as a CD-SEM does) print where the mask draws them.
 */
export function doseToSize(tNom: number): number {
  let lo = 0.2;
  let hi = 20;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const d = clearedDepthExact(mid * 0.5, tNom, tNom);
    if (d >= tNom * 0.5) hi = mid;
    else lo = mid;
  }
  return hi;
}

const DOSE_TO_SIZE: Record<ResistRecipe, number> = {
  fine: doseToSize(RESIST_RECIPES.fine.t),
  implant: doseToSize(RESIST_RECIPES.implant.t),
  sd: doseToSize(RESIST_RECIPES.sd.t),
};

// ───────────────────────────────── op vocabulary ─────────────────────────────────

export interface EtchRecipe {
  name: string;
  /** Etch rate per material relative to the main target (0 = etch stop). */
  rates: Partial<Record<MatId, number>>;
  /** Etch time expressed in gu of the main target material. */
  time: number;
}

export const ETCH: Record<string, EtchRecipe> = {
  sti: { name: 'Trench etch', rates: { [M.NIT]: 1, [M.OX]: 1, [M.SI]: 1, [M.RES]: 0.35 }, time: 8.3 },
  gate: { name: 'Gate etch', rates: { [M.POLY]: 1, [M.RES]: 0.8, [M.OX]: 0.02, [M.SI]: 1 }, time: 5.6 },
  contact: {
    name: 'Contact etch',
    rates: { [M.OX]: 1, [M.RES]: 0.3, [M.POLY]: 0.03, [M.SI]: 0.03, [M.NIT]: 0.5 },
    time: 12.2,
  },
  m1: { name: 'Trench etch', rates: { [M.ILD]: 1, [M.OX]: 1, [M.RES]: 0.3, [M.W]: 0.02 }, time: 4.3 },
  via: { name: 'Via etch', rates: { [M.ILD]: 1, [M.CAP]: 1, [M.RES]: 0.25, [M.CU]: 0 }, time: 11.2 },
  m2: { name: 'Trench etch', rates: { [M.ILD]: 1, [M.CAP]: 1, [M.RES]: 0.25, [M.CU]: 0 }, time: 5 },
};

export type Op =
  | { kind: 'receive' }
  | { kind: 'scan' }
  | { kind: 'clean'; enabled: boolean }
  | { kind: 'oxidize'; t: number; nm: number; label: string }
  | { kind: 'deposit'; mat: MatId; tag: number; t: number; mode: 'conformal' | 'planar'; nm: number; label: string }
  | { kind: 'prime' }
  | { kind: 'coat'; recipe: ResistRecipe; tRel: number; edgeRise: number; mask: MaskId; purpose: string }
  | { kind: 'softbake' }
  | { kind: 'expose'; mask: MaskId; recipe: ResistRecipe; doseRel: number; dx: number; dy: number }
  | { kind: 'peb' }
  | { kind: 'develop'; recipe: ResistRecipe }
  | { kind: 'inspect'; what: string }
  | { kind: 'etch'; recipe: keyof typeof ETCH }
  | { kind: 'wetEtch'; mat: MatId; t: number; label: string }
  | { kind: 'strip' }
  | { kind: 'implant'; target: 'nwell' | 'pwell' | 'n+' | 'p+'; species: string; range: number; depth: number }
  | { kind: 'anneal'; drive: number; label: string }
  | { kind: 'cmp'; stop: MatId | null; stopTag: number; over: number; plane?: number; label: string }
  | { kind: 'rework'; mask: MaskId; n: number }
  | { kind: 'films'; films: Film[]; surface: string; pattern?: number }
  | { kind: 'backend'; patch: Partial<Pick<WaferSummary, 'probed' | 'diced' | 'packaged' | 'surface'>> };

export type OpKind = Op['kind'];

export function opKey(op: Op): string {
  return JSON.stringify(op);
}

// ───────────────────────────────── initial state ─────────────────────────────────

export function initialWafer(): WaferSummary {
  return {
    films: [],
    resist: null,
    masks: [],
    pattern: 0,
    particles: [],
    particlesBuried: false,
    primed: false,
    wellsDone: false,
    activated: false,
    metalLevels: 0,
    copperTop: false,
    tungstenTop: false,
    passivated: false,
    probed: false,
    diced: false,
    packaged: 'none',
    surface: 'Empty',
  };
}

export function initialState(): SimState {
  const g = Grid.create();
  return { grid: g, wafer: initialWafer() };
}

// ───────────────────────────────── helpers ─────────────────────────────────

function forEachColumn(g: Grid, fn: (c: number) => void): void {
  const n = g.columns;
  for (let c = 0; c < n; c++) fn(c);
}

/** Raster of the current surface height. */
function surfaceRaster(g: Grid): Raster {
  const data = new Float32Array(g.columns);
  for (let c = 0; c < g.columns; c++) data[c] = g.surface(c);
  return { nx: g.nx, ny: g.ny, data };
}

function pushFilm(w: WaferSummary, f: Film): void {
  const last = w.films[w.films.length - 1];
  if (last && last.mat === f.mat && last.label === f.label) last.nm += f.nm;
  else w.films.push({ ...f });
}

// ───────────────────────────────── operations ─────────────────────────────────

function receive(s: SimState): void {
  const g = s.grid;
  forEachColumn(g, (c) => {
    g.n[c] = 0;
    g.push(c, M.SI, -g.zBase, DOP.PSUB);
  });
  s.wafer = initialWafer();
  s.wafer.particles = INCOMING_PARTICLES.map((p) => ({ ...p }));
  s.wafer.surface = 'Polished silicon';
}

function oxidize(s: SimState, t: number, nm: number, label: string): void {
  const g = s.grid;
  const K = g.K;
  forEachColumn(g, (c) => {
    const n = g.n[c];
    if (n === 0) return;
    const topIdx = c * K + n - 1;
    const topMat = g.mat[topIdx];
    if (topMat === M.SI) {
      g.top[topIdx] -= 0.44 * t; // silicon consumed
      g.push(c, M.OX, t, 0);
    } else if (topMat === M.OX && n >= 2 && g.mat[topIdx - 1] === M.SI && g.thickness(c, n - 1) < 1.2) {
      // Oxidant diffuses through a thin oxide and keeps converting silicon.
      g.top[topIdx - 1] -= 0.44 * t;
      g.top[topIdx] += 0.56 * t;
    }
    // Nitride, thick oxide and polysilicon are left alone (nitride masks oxidation).
  });
  pushFilm(s.wafer, { mat: M.OX, nm, label });
}

function deposit(s: SimState, op: Extract<Op, { kind: 'deposit' }>): void {
  const g = s.grid;
  if (op.mode === 'conformal') {
    forEachColumn(g, (c) => g.push(c, op.mat, op.t, op.tag));
  } else {
    let hmax = -Infinity;
    forEachColumn(g, (c) => (hmax = Math.max(hmax, g.surface(c))));
    const H = hmax + op.t;
    forEachColumn(g, (c) => g.push(c, op.mat, H - g.surface(c), op.tag));
  }
  pushFilm(s.wafer, { mat: op.mat, nm: op.nm, label: op.label });
}

function coat(s: SimState, op: Extract<Op, { kind: 'coat' }>): void {
  const g = s.grid;
  const rec = RESIST_RECIPES[op.recipe];
  const t = rec.t * op.tRel;
  // Spin-on films partially planarise: the resist surface follows a smoothed version of
  // the topography underneath, so resist is thicker in low areas and thinner over bumps.
  const smooth = blur(surfaceRaster(g), 2.2);
  forEachColumn(g, (c) => {
    const surf = g.surface(c);
    const target = Math.max(smooth.data[c], surf) + t;
    const th = Math.max(t * 0.35, target - surf);
    g.push(c, M.RES, th, RES.COATED);
    g.dose[c] = 0;
  });
  s.wafer.resist = {
    phase: 'coated',
    tRel: op.tRel,
    edgeRise: op.edgeRise,
    nm: rec.nm * op.tRel,
    mask: op.mask,
    purpose: op.purpose,
  };
}

function forEachResist(g: Grid, fn: (idx: number, c: number, k: number) => void): void {
  const K = g.K;
  forEachColumn(g, (c) => {
    const n = g.n[c];
    for (let k = 0; k < n; k++) {
      const idx = c * K + k;
      if (g.mat[idx] === M.RES) fn(idx, c, k);
    }
  });
}

function softbake(s: SimState): void {
  const g = s.grid;
  // Solvent leaves the film: it densifies and shrinks slightly.
  const K = g.K;
  forEachColumn(g, (c) => {
    const n = g.n[c];
    if (n === 0) return;
    const idx = c * K + n - 1;
    if (g.mat[idx] !== M.RES) return;
    g.top[idx] -= g.thickness(c, n - 1) * 0.04;
    g.tag[idx] = RES.BAKED;
  });
  if (s.wafer.resist) {
    s.wafer.resist.phase = 'baked';
    s.wafer.resist.tRel *= 0.96;
    s.wafer.resist.nm *= 0.96;
  }
}

function expose(s: SimState, op: Extract<Op, { kind: 'expose' }>): void {
  const g = s.grid;
  const dose = DOSE_TO_SIZE[op.recipe] * op.doseRel;
  const img = aerialImage(op.mask, op.dx, op.dy);
  // Exposure changes only the resist: photoacid forms where light arrives. Nothing below
  // the resist is touched.
  forEachResist(g, (idx, c) => {
    g.dose[c] = dose * img.data[c];
    g.tag[idx] = RES.EXPOSED;
  });
  s.wafer.masks.push(op.mask);
  if (s.wafer.resist) {
    s.wafer.resist.phase = 'exposed';
    s.wafer.resist.mask = op.mask;
  }
}

function peb(s: SimState): void {
  const g = s.grid;
  // Post-exposure bake: the photoacid catalyses deprotection and diffuses a little,
  // slightly smoothing the latent image.
  const b = blur({ nx: g.nx, ny: g.ny, data: g.dose }, 0.35);
  g.dose.set(b.data);
  forEachResist(g, (idx) => {
    g.tag[idx] = RES.PEB;
  });
  if (s.wafer.resist) s.wafer.resist.phase = 'peb';
}

function develop(s: SimState, op: Extract<Op, { kind: 'develop' }>): void {
  const g = s.grid;
  const tNom = RESIST_RECIPES[op.recipe].t;
  const K = g.K;
  forEachColumn(g, (c) => {
    const n = g.n[c];
    if (n === 0) return;
    const idx = c * K + n - 1;
    if (g.mat[idx] !== M.RES) return;
    const th = g.thickness(c, n - 1);
    // Positive tone: the developer dissolves resist where the dose made it soluble.
    const d = clearedDepth(g.dose[c], th, tNom);
    if (d >= th - 1e-3) g.pop(c);
    else {
      g.top[idx] -= d;
      g.tag[idx] = RES.DEVELOPED;
    }
  });
  if (s.wafer.resist) s.wafer.resist.phase = 'developed';
}

function etch(s: SimState, recipe: EtchRecipe): void {
  const g = s.grid;
  const K = g.K;
  // Anisotropic plasma etch: each column is attacked from the top only. Every material has
  // its own rate; resist is a slow-etching mask; a zero rate is an etch stop.
  forEachColumn(g, (c) => {
    let time = recipe.time;
    while (time > 1e-6 && g.n[c] > 0) {
      const k = g.n[c] - 1;
      const idx = c * K + k;
      const rate = recipe.rates[g.mat[idx] as MatId] ?? 0;
      if (rate <= 0) break;
      const th = g.thickness(c, k);
      const can = time * rate;
      if (can >= th) {
        g.pop(c);
        time -= th / rate;
      } else {
        g.top[idx] -= can;
        time = 0;
      }
    }
  });
  s.wafer.pattern += 1;
}

function wetEtch(s: SimState, mat: MatId, t: number): void {
  const g = s.grid;
  const K = g.K;
  // Vertical pass: dissolve the exposed target from the top of each column.
  const openLo = new Float32Array(g.columns).fill(Infinity);
  const openHi = new Float32Array(g.columns).fill(-Infinity);
  forEachColumn(g, (c) => {
    let left = t;
    const from = g.surface(c);
    while (left > 1e-6 && g.n[c] > 0) {
      const k = g.n[c] - 1;
      const idx = c * K + k;
      if (g.mat[idx] !== mat) break;
      const th = g.thickness(c, k);
      if (left >= th) {
        g.pop(c);
        left -= th;
      } else {
        g.top[idx] -= left;
        left = 0;
      }
    }
    const to = g.surface(c);
    if (to < from - 1e-6) {
      openLo[c] = to;
      openHi[c] = from;
    }
  });
  // Lateral pass: a wet etch is isotropic, so a buried sliver of the target that touches a
  // freshly opened neighbour is undercut and dissolved too (the thin film above settles).
  const { nx, ny } = g;
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const c = g.col(i, j);
      for (let k = g.n[c] - 2; k >= 0; k--) {
        const idx = c * K + k;
        if (g.mat[idx] !== mat || g.thickness(c, k) > t) continue;
        const b = g.base(c, k);
        const top = g.top[idx];
        const touches = [
          [i - 1, j],
          [i + 1, j],
          [i, j - 1],
          [i, j + 1],
        ].some(([a, bb]) => {
          if (a < 0 || bb < 0 || a >= nx || bb >= ny) return false;
          const n = g.col(a, bb);
          return openLo[n] < top && openHi[n] > b;
        });
        if (touches) g.removeAt(c, k);
      }
    }
}

function strip(s: SimState): void {
  const g = s.grid;
  forEachColumn(g, (c) => {
    while (g.n[c] > 0 && g.topMat(c) === M.RES) g.pop(c);
  });
  s.wafer.resist = null;
}

const STOPPING: Partial<Record<number, number>> = {
  [M.RES]: 0.9,
  [M.OX]: 1,
  [M.NIT]: 1.25,
  [M.POLY]: 1,
  [M.ILD]: 0.9,
};

function combineDoping(old: number, target: 'nwell' | 'pwell' | 'n+' | 'p+'): number {
  switch (target) {
    case 'nwell':
      return old === DOP.PSUB || old === DOP.PWELL ? DOP.NWELL : old;
    case 'pwell':
      return old === DOP.PSUB ? DOP.PWELL : old;
    case 'n+':
      return old === DOP.PPLUS ? old : DOP.NPLUS;
    case 'p+':
      return old === DOP.NPLUS ? old : DOP.PPLUS;
  }
}

function implant(s: SimState, op: Extract<Op, { kind: 'implant' }>): void {
  const g = s.grid;
  const K = g.K;
  forEachColumn(g, (c) => {
    const si = g.siTopIndex(c);
    if (si < 0) return;
    // Ions lose energy in every film above the silicon.
    let stop = 0;
    for (let k = g.n[c] - 1; k > si; k--) {
      const idx = c * K + k;
      stop += g.thickness(c, k) * (STOPPING[g.mat[idx]] ?? 1);
    }
    if (stop >= op.range) return; // blocked by resist, gate or thick oxide
    const depth = Math.min(op.depth, op.range - stop);
    const siTop = g.top[c * K + si];
    const zLow = siTop - depth;
    g.split(c, zLow);
    for (let k = 0; k < g.n[c]; k++) {
      const idx = c * K + k;
      if (g.mat[idx] !== M.SI) continue;
      const b = g.base(c, k);
      if (b >= zLow - 1e-4 && g.top[idx] <= siTop + 1e-4) g.tag[idx] = combineDoping(g.tag[idx], op.target);
    }
    g.compact(c);
  });
  if (op.target === 'nwell' || op.target === 'pwell') s.wafer.wellsDone = true;
  s.wafer.pattern += 1;
}

function anneal(s: SimState, drive: number): void {
  const g = s.grid;
  const K = g.K;
  if (drive > 0) {
    // Well drive-in: dopants diffuse deeper into the lightly doped substrate.
    forEachColumn(g, (c) => {
      for (let k = 1; k < g.n[c]; k++) {
        const idx = c * K + k;
        const below = idx - 1;
        if (g.mat[idx] !== M.SI || g.mat[below] !== M.SI) continue;
        const wt = g.tag[idx];
        if ((wt === DOP.NWELL || wt === DOP.PWELL) && g.tag[below] === DOP.PSUB) {
          const z = g.base(c, k) - drive;
          const at = g.split(c, z);
          if (at >= 0) g.tag[c * K + at] = wt;
          g.compact(c);
          break;
        }
      }
    });
  }
  s.wafer.activated = true;
}

function cmp(s: SimState, stop: MatId | null, stopTag: number, over: number, fixed?: number): void {
  const g = s.grid;
  let plane = fixed ?? -Infinity;
  if (stop !== null) forEachColumn(g, (c) => {
    const base = c * g.K;
    for (let k = g.n[c] - 1; k >= 0; k--) {
      if (g.mat[base + k] === stop && (stopTag < 0 || g.tag[base + k] === stopTag)) {
        plane = Math.max(plane, g.top[base + k]);
        break;
      }
    }
  });
  if (!Number.isFinite(plane)) return;
  const z = plane - over;
  forEachColumn(g, (c) => g.truncate(c, z));
}

export function applyOp(s: SimState, op: Op): void {
  const w = s.wafer;
  switch (op.kind) {
    case 'receive':
      receive(s);
      break;
    case 'scan':
      break;
    case 'clean':
      if (op.enabled) w.particles = [];
      else w.particlesBuried = false;
      w.surface = op.enabled ? 'Clean silicon' : 'Silicon with particles';
      break;
    case 'oxidize':
      oxidize(s, op.t, op.nm, op.label);
      if (w.particles.length) w.particlesBuried = true;
      break;
    case 'deposit':
      deposit(s, op);
      if (w.particles.length) w.particlesBuried = true;
      break;
    case 'prime':
      w.primed = true;
      break;
    case 'coat':
      coat(s, op);
      break;
    case 'softbake':
      softbake(s);
      break;
    case 'expose':
      expose(s, op);
      break;
    case 'peb':
      peb(s);
      break;
    case 'develop':
      develop(s, op);
      break;
    case 'inspect':
      break;
    case 'etch':
      etch(s, ETCH[op.recipe]);
      break;
    case 'wetEtch':
      wetEtch(s, op.mat, op.t);
      break;
    case 'strip':
      strip(s);
      break;
    case 'implant':
      implant(s, op);
      break;
    case 'anneal':
      anneal(s, op.drive);
      break;
    case 'cmp':
      cmp(s, op.stop, op.stopTag, op.over, op.plane);
      break;
    case 'rework':
      break;
    case 'films':
      w.films = op.films.map((f) => ({ ...f }));
      w.surface = op.surface;
      if (op.pattern !== undefined) w.pattern = op.pattern;
      w.copperTop = op.films.length > 0 && op.films[op.films.length - 1].mat === M.CU;
      w.tungstenTop = op.films.length > 0 && op.films[op.films.length - 1].mat === M.W;
      w.metalLevels = Math.max(w.metalLevels, op.films.filter((f) => f.mat === M.CU).length);
      w.passivated = op.films.some((f) => f.mat === M.PASS);
      break;
    case 'backend':
      Object.assign(w, op.patch);
      break;
  }
}

export function cloneState(s: SimState): SimState {
  return {
    grid: s.grid.clone(),
    wafer: structuredClone(s.wafer),
  };
}
