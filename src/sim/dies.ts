/**
 * Wafer-scale geometry: 300 mm wafer, die grid, exposure fields, particles.
 *
 * The die size is chosen so that 2 × 2 dies fill one 26 mm × 33 mm scanner exposure field
 * (the standard maximum field on the wafer for DUV and EUV scanners). Coordinates are mm
 * with the origin at the wafer centre; the notch is at −y.
 */

import type { Particle } from './types';
import { mulberry32 } from './rng';

export const WAFER = {
  radius: 150,
  edgeExclusion: 3,
  thicknessUm: 775,
  dieW: 13,
  dieH: 16.5,
  fieldDiesX: 2,
  fieldDiesY: 2,
  /** Scribe street each side of a die's active area (mm), drawn schematically. */
  scribe: 0.25,
  /** Border inside the die that holds pads and seal ring rather than circuitry (mm). */
  padRing: 1.2,
} as const;

export interface Die {
  id: number;
  col: number;
  row: number;
  /** Centre in mm. */
  x: number;
  y: number;
  /** Distance of the centre from the wafer centre, mm. */
  r: number;
  /** Fully inside the usable area (tested); otherwise a partial edge die. */
  full: boolean;
  field: number;
}

export interface Field {
  id: number;
  x: number; // centre
  y: number;
  w: number;
  h: number;
  /** Exposure order (serpentine). */
  order: number;
}

function buildDies(): { dies: Die[]; fields: Field[]; yourDie: number } {
  const { radius, edgeExclusion, dieW, dieH, fieldDiesX, fieldDiesY } = WAFER;
  const usable = radius - edgeExclusion;
  const dies: Die[] = [];
  const n = 14;
  // Grid anchored so that a field corner sits on the wafer centre.
  for (let row = -n; row < n; row++) {
    for (let col = -n; col < n; col++) {
      const x0 = col * dieW;
      const y0 = row * dieH;
      const corners = [
        [x0, y0],
        [x0 + dieW, y0],
        [x0, y0 + dieH],
        [x0 + dieW, y0 + dieH],
      ];
      const inside = corners.filter(([cx, cy]) => Math.hypot(cx, cy) <= usable).length;
      const touches = corners.some(([cx, cy]) => Math.hypot(cx, cy) < radius);
      if (!touches && inside === 0) continue;
      const cx = x0 + dieW / 2;
      const cy = y0 + dieH / 2;
      // Skip slivers that barely overlap the wafer.
      if (Math.hypot(cx, cy) > radius + Math.min(dieW, dieH) * 0.2) continue;
      const fcol = Math.floor(col / fieldDiesX);
      const frow = Math.floor(row / fieldDiesY);
      dies.push({
        id: dies.length,
        col,
        row,
        x: cx,
        y: cy,
        r: Math.hypot(cx, cy),
        full: inside === 4,
        field: (frow + n) * 100 + (fcol + n),
      });
    }
  }
  // Fields that contain at least one die touching the wafer.
  const fieldMap = new Map<number, Field>();
  for (const d of dies) {
    if (fieldMap.has(d.field)) continue;
    const fcol = Math.floor(d.col / fieldDiesX);
    const frow = Math.floor(d.row / fieldDiesY);
    const w = dieW * fieldDiesX;
    const h = dieH * fieldDiesY;
    fieldMap.set(d.field, { id: d.field, x: fcol * w + w / 2, y: frow * h + h / 2, w, h, order: 0 });
  }
  const fields = [...fieldMap.values()];
  // Serpentine exposure order: rows bottom→top, alternating direction.
  const rows = [...new Set(fields.map((f) => f.y))].sort((a, b) => a - b);
  let order = 0;
  rows.forEach((y, ri) => {
    const inRow = fields.filter((f) => f.y === y).sort((a, b) => (ri % 2 === 0 ? a.x - b.x : b.x - a.x));
    for (const f of inRow) f.order = order++;
  });
  fields.sort((a, b) => a.order - b.order);
  const yourDie = dies.find((d) => d.col === 0 && d.row === 0)!.id;
  return { dies, fields, yourDie };
}

const built = buildDies();
export const DIES: readonly Die[] = built.dies;
export const FIELDS: readonly Field[] = built.fields;
/** The die whose inverter the learner follows (just up-right of the wafer centre). */
export const YOUR_DIE = built.yourDie;
export const FULL_DIE_COUNT = DIES.filter((d) => d.full).length;

/** The incoming particles found by the surface scan (fixed seed → same every run). */
export const INCOMING_PARTICLES: readonly Particle[] = (() => {
  const rand = mulberry32(20260922);
  const out: Particle[] = [];
  const your = DIES[YOUR_DIE];
  let guard = 0;
  while (out.length < 9 && guard++ < 1000) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * (WAFER.radius - 6);
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    // Keep your die (and its immediate neighbours) clear so the followed die stays comparable.
    if (Math.abs(x - your.x) < WAFER.dieW * 1.6 && Math.abs(y - your.y) < WAFER.dieH * 1.6) continue;
    out.push({ id: out.length, x, y, sizeUm: 0.15 + rand() * 0.6 });
  }
  return out;
})();

export function dieAt(x: number, y: number): Die | undefined {
  const col = Math.floor(x / WAFER.dieW);
  const row = Math.floor(y / WAFER.dieH);
  return DIES.find((d) => d.col === col && d.row === row);
}

/**
 * Is a particle a killer for the die it lands on? The toy critical-area rule: it must land
 * inside the circuit region (not in the scribe street or pad ring) and be larger than a
 * size threshold. Real kill ratios depend on layer, feature density and defect type.
 */
export function particleKills(p: Particle): { die: Die | undefined; kills: boolean } {
  const die = dieAt(p.x, p.y);
  if (!die || !die.full) return { die, kills: false };
  const lx = Math.abs(p.x - die.x);
  const ly = Math.abs(p.y - die.y);
  const inner = lx < WAFER.dieW / 2 - WAFER.padRing && ly < WAFER.dieH / 2 - WAFER.padRing;
  return { die, kills: inner && p.sizeUm >= 0.2 };
}

/**
 * Radial resist thickness profile from spin coating, relative to the wafer-centre value.
 * Slower spins leave a film that thickens toward the edge; the edge bead itself is removed
 * by edge-bead removal (EBR) and lies outside the usable area. Qualitative only.
 */
export function radialThickness(r: number, edgeRise: number): number {
  const u = Math.min(1, r / (WAFER.radius - WAFER.edgeExclusion));
  return 1 + edgeRise * u ** 3;
}

/** Wafer-scale overlay contribution (a small magnification term), schematic units. */
export function overlayFromMagnification(x: number): number {
  // ±1 unit at the extreme left/right edge of the usable area.
  return x / (WAFER.radius - WAFER.edgeExclusion);
}
