/**
 * Metrology on the simulated die: what a CD-SEM, an overlay tool or a defect review would
 * report. Measurements are taken from the state itself (e.g. the developed resist profile),
 * not from the learner's settings.
 */

import { Grid } from './grid';
import { CONTACT_MARGIN, CUT_Y, LAYOUT, MASKS, type Rect } from './layout';
import { DOP, M } from './materials';
import { rasterizeRects } from './optics';

export interface CdResult {
  /** Width of the line at half height, gu (NaN if no line). */
  cd: number;
  /** cd relative to the designed width. */
  rel: number;
  /** Largest leftover thickness in areas that should be fully clear, gu. */
  residue: number;
  /** Thickness at the line centre, gu. */
  height: number;
}

function segmentThickness(g: Grid, c: number, mat: number): number {
  const base = c * g.K;
  let t = 0;
  for (let k = 0; k < g.n[c]; k++) if (g.mat[base + k] === mat) t += g.thickness(c, k);
  return t;
}

/** Profile of a material's total thickness along x at row y. */
export function thicknessProfile(g: Grid, mat: number, y = CUT_Y): Float32Array {
  const j = Math.floor(y / g.dy);
  const out = new Float32Array(g.nx);
  for (let i = 0; i < g.nx; i++) out[i] = segmentThickness(g, g.col(i, j), mat);
  return out;
}

/**
 * CD of a line of `mat` centred at xCenter (gu), measured at half of `ref` thickness,
 * with linear interpolation between columns. Residue is measured in `clearZones`.
 */
function lineCd(
  g: Grid,
  mat: number,
  xCenter: number,
  drawn: number,
  ref: number,
  clearZones: [number, number][],
  y = CUT_Y,
): CdResult {
  const prof = thicknessProfile(g, mat, y);
  const ic = Math.floor(xCenter / g.dx);
  const half = ref * 0.5;
  const height = prof[ic];
  let residue = 0;
  for (const [x0, x1] of clearZones)
    for (let i = Math.floor(x0 / g.dx); i < Math.ceil(x1 / g.dx); i++) residue = Math.max(residue, prof[i]);
  if (height < half) return { cd: 0, rel: 0, residue, height };
  let l = ic;
  while (l > 0 && prof[l - 1] >= half) l--;
  let r = ic;
  while (r < g.nx - 1 && prof[r + 1] >= half) r++;
  // interpolate edges (column centres at (i+0.5)*dx)
  const edge = (inside: number, outside: number) => {
    const a = prof[inside];
    const b = prof[outside];
    const f = a === b ? 0.5 : (a - half) / (a - b);
    return (inside + 0.5 + (outside - inside) * f) * g.dx;
  };
  const xl = l > 0 ? edge(l, l - 1) : 0;
  const xr = r < g.nx - 1 ? edge(r, r + 1) : g.nx * g.dx;
  const cd = xr - xl;
  return { cd, rel: cd / drawn, residue, height };
}

const nGateX = (LAYOUT.nGate[0] + LAYOUT.nGate[2]) / 2;
const pGateX = (LAYOUT.pGate[0] + LAYOUT.pGate[2]) / 2;
const gateDrawn = LAYOUT.nGate[2] - LAYOUT.nGate[0];
// Where resist/poly must be gone after the gate layer: source/drain areas at the cut.
const gateClear: [number, number][] = [
  [12, 20],
  [30, 38],
  [58, 66],
  [76, 84],
];

export interface GateMetrology {
  nmos: CdResult;
  pmos: CdResult;
  /** Worst-case relative CD across both gates. */
  worstRel: number;
  residue: number;
}

/** After development: measure the resist lines that will become gates. */
export function measureResistGates(g: Grid, refThickness: number): GateMetrology {
  const nmos = lineCd(g, M.RES, nGateX, gateDrawn, refThickness, gateClear);
  const pmos = lineCd(g, M.RES, pGateX, gateDrawn, refThickness, gateClear);
  return summarize(nmos, pmos);
}

/** After etch: measure the polysilicon gates. */
export function measurePolyGates(g: Grid): GateMetrology {
  const nmos = lineCd(g, M.POLY, nGateX, gateDrawn, 4, gateClear);
  const pmos = lineCd(g, M.POLY, pGateX, gateDrawn, 4, gateClear);
  return summarize(nmos, pmos);
}

function summarize(nmos: CdResult, pmos: CdResult): GateMetrology {
  const worstRel = Math.abs(nmos.rel - 1) > Math.abs(pmos.rel - 1) ? nmos.rel : pmos.rel;
  return { nmos, pmos, worstRel, residue: Math.max(nmos.residue, pmos.residue) };
}

/** Thickest resist left anywhere in the source/drain openings (scum), gu. */
export function resistResidue(g: Grid): number {
  return Math.max(...gateClear.map(([a, b]) => maxIn(thicknessProfile(g, M.RES), a, b, g.dx)));
}

function maxIn(p: Float32Array, x0: number, x1: number, dx: number): number {
  let m = 0;
  for (let i = Math.floor(x0 / dx); i < Math.ceil(x1 / dx); i++) m = Math.max(m, p[i]);
  return m;
}

// ───────────────────────────── contacts & overlay ─────────────────────────────

export type ContactName = keyof typeof LAYOUT.contacts;

export const CONTACT_LABELS: Record<ContactName, string> = {
  nSource: 'NMOS source',
  nDrain: 'NMOS drain',
  pDrain: 'PMOS drain',
  pSource: 'PMOS source',
  gate: 'Gate',
};

export interface ContactLanding {
  name: ContactName;
  label: string;
  /** Fraction of the contact footprint landing on its intended target. */
  onTarget: number;
  /** The contact reaches (or touches) a gate it should stay clear of. */
  touchesGate: boolean;
  ok: boolean;
}

function shiftRect(r: Rect, dx: number): Rect {
  return [r[0] + dx, r[1], r[2] + dx, r[3]];
}

/**
 * Predict where each contact lands for an overlay offset dx, against the current wafer
 * (active areas, gates). Used for the alignment preview and the knowledge check reveal.
 */
export function predictContacts(dx: number): ContactLanding[] {
  const out: ContactLanding[] = [];
  const gates = [LAYOUT.nGate, LAYOUT.pGate];
  const polyAll = [LAYOUT.nGate, LAYOUT.pGate, LAYOUT.strap, LAYOUT.polyPad];
  for (const name of Object.keys(LAYOUT.contacts) as ContactName[]) {
    const r = shiftRect(LAYOUT.contacts[name], dx);
    const area = (r[2] - r[0]) * (r[3] - r[1]);
    let onTarget = 0;
    let touchesGate = false;
    if (name === 'gate') {
      for (const p of polyAll) onTarget += overlapArea(r, p);
      onTarget = Math.min(1, onTarget / area);
    } else {
      const active = name.startsWith('n') ? LAYOUT.nActive : LAYOUT.pActive;
      // on diffusion = inside active and not under a gate
      let a = overlapArea(r, active);
      for (const gt of gates) a -= overlapArea(r, gt);
      onTarget = Math.max(0, a / area);
      // touching: within less than one column of a gate edge, or overlapping it
      for (const gt of gates) {
        const grown: Rect = [gt[0] - 0.25, gt[1], gt[2] + 0.25, gt[3]];
        if (overlapArea(r, grown) > 0) touchesGate = true;
      }
    }
    const ok = name === 'gate' ? onTarget > 0.5 : !touchesGate && onTarget > 0.25;
    out.push({ name, label: CONTACT_LABELS[name], onTarget, touchesGate, ok });
  }
  return out;
}

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const h = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  return w * h;
}

export interface OverlayMeasurement {
  /** Measured x offset of the developed contact openings vs. design, gu. */
  dx: number;
  /** |dx| as a fraction of the contact-to-gate margin. */
  ofMargin: number;
  /** Within the metrology control limit (tighter than the kill margin). */
  inSpec: boolean;
}

/** Overlay control limit as a fraction of the margin (guard band before failure). */
export const OVERLAY_SPEC = 0.5;

/**
 * Measure overlay like an overlay tool: find the centroid of the developed contact
 * openings in the S/D contact row and compare with the design centroid.
 */
export function measureContactOverlay(g: Grid): OverlayMeasurement {
  const design = rasterizeRects(MASKS.contact.rects.slice(0, 4));
  const j0 = Math.floor(26 / g.dy);
  const j1 = Math.floor(30 / g.dy);
  let sx = 0;
  let sw = 0;
  let dxs = 0;
  let dws = 0;
  for (let j = j0; j < j1; j++) {
    for (let i = 0; i < g.nx; i++) {
      const c = g.col(i, j);
      const open = g.topMat(c) !== M.RES ? 1 : 0;
      const x = g.xOf(i);
      sx += open * x;
      sw += open;
      dxs += design.data[c] * x;
      dws += design.data[c];
    }
  }
  if (sw === 0 || dws === 0) return { dx: NaN, ofMargin: NaN, inSpec: false };
  const dx = sx / sw - dxs / dws;
  const ofMargin = Math.abs(dx) / CONTACT_MARGIN;
  return { dx, ofMargin, inSpec: ofMargin <= OVERLAY_SPEC + 1e-6 };
}

// ───────────────────────────── layer stack summary ─────────────────────────────

export interface StackLayer {
  key: string;
  label: string;
  mat: number;
  tag: number;
  thickness: number;
}

/** Bottom → top materials in one column (for the layer inset / tooltips). */
export function columnStack(g: Grid, xGu: number, yGu: number): StackLayer[] {
  const c = g.col(Math.min(g.nx - 1, Math.floor(xGu / g.dx)), Math.min(g.ny - 1, Math.floor(yGu / g.dy)));
  const out: StackLayer[] = [];
  const base = c * g.K;
  for (let k = 0; k < g.n[c]; k++) {
    const m = g.mat[base + k];
    const t = g.tag[base + k];
    out.push({ key: `${m}:${t}`, label: stackLabel(m, t), mat: m, tag: t, thickness: g.thickness(c, k) });
  }
  return out;
}

export function stackLabel(mat: number, tag: number): string {
  switch (mat) {
    case M.SI:
      return (
        { [DOP.PSUB]: 'Silicon', [DOP.PWELL]: 'p-well', [DOP.NWELL]: 'n-well', [DOP.NPLUS]: 'n+ silicon', [DOP.PPLUS]: 'p+ silicon' } as Record<
          number,
          string
        >
      )[tag];
    case M.OX:
      return tag === 1 ? 'Trench oxide' : tag === 2 ? 'Pre-metal oxide' : 'Oxide';
    case M.NIT:
      return 'Nitride';
    case M.POLY:
      return 'Polysilicon';
    case M.RES:
      return 'Resist';
    case M.W:
      return 'Tungsten';
    case M.CU:
      return tag === 2 ? 'Copper (M2)' : 'Copper (M1)';
    case M.ILD:
      return 'Dielectric';
    case M.CAP:
      return 'Cap';
    case M.PASS:
      return 'Passivation';
    default:
      return 'Material';
  }
}

/**
 * Contacts whose tungsten actually touches polysilicon it should not (found in the grid,
 * so it includes effects such as wider-than-drawn gates eating into the margin).
 */
export function contactGateTouches(g: Grid): ContactName[] {
  const K = g.K;
  const hit = new Set<ContactName>();
  const gc = LAYOUT.contacts.gate;
  const nearGateContact = (x: number, y: number) => x > gc[0] - 6 && x < gc[2] + 6 && y > gc[1] - 6 && y < gc[3] + 6;
  const names = (Object.keys(LAYOUT.contacts) as ContactName[]).filter((n) => n !== 'gate');
  const nearest = (x: number, y: number): ContactName => {
    let best = names[0];
    let bd = Infinity;
    for (const n of names) {
      const r = LAYOUT.contacts[n];
      const d = Math.hypot((r[0] + r[2]) / 2 - x, (r[1] + r[3]) / 2 - y);
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  };
  for (let j = 0; j < g.ny; j++) {
    for (let i = 0; i < g.nx; i++) {
      const c = g.col(i, j);
      const x = g.xOf(i);
      const y = g.yOf(j);
      if (nearGateContact(x, y)) continue;
      for (let k = 0; k < g.n[c]; k++) {
        if (g.mat[c * K + k] !== M.W) continue;
        const z0 = g.base(c, k);
        const z1 = g.top[c * K + k];
        let touch = k > 0 && g.mat[c * K + k - 1] === M.POLY;
        const nbrs = [i > 0 ? c - 1 : -1, i < g.nx - 1 ? c + 1 : -1, j > 0 ? c - g.nx : -1, j < g.ny - 1 ? c + g.nx : -1];
        for (const d of nbrs) {
          if (d < 0 || touch) continue;
          for (let m = 0; m < g.n[d]; m++) {
            if (g.mat[d * K + m] !== M.POLY) continue;
            if (Math.min(z1, g.top[d * K + m]) - Math.max(z0, g.base(d, m)) > 0.05) touch = true;
          }
        }
        if (touch) hit.add(nearest(x, y));
      }
    }
  }
  return [...hit];
}
