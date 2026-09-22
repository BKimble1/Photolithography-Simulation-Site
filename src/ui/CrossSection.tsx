import { memo, useMemo } from 'react';
import type { Grid } from '../sim/grid';
import { CUT_Y } from '../sim/layout';
import { DOP, M } from '../sim/materials';
import { matColor } from './palette';

export const VEX = 1.3; // vertical exaggeration of the schematic section

export interface XsecProps {
  grid: Grid;
  y?: number;
  zRange?: [number, number];
  labels?: boolean;
  title?: string;
  className?: string;
  /** Optional overlay rectangles in gu (e.g. predicted contact positions). */
  overlays?: { x0: number; x1: number; z0: number; z1: number; color: string; dashed?: boolean }[];
}

interface Run {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  color: string;
}

export function autoRange(grids: Grid[], y = CUT_Y): [number, number] {
  let top = -Infinity;
  for (const g of grids) {
    const j = Math.floor(y / g.dy);
    for (let i = 0; i < g.nx; i++) top = Math.max(top, g.surface(g.col(i, j)));
  }
  const zTop = Math.max(6, top + 3);
  const zBot = Math.max(-18, Math.min(-12, zTop - 46));
  return [zBot, zTop];
}

function runsFor(g: Grid, y: number, zBot: number, zTop: number): Run[] {
  const j = Math.floor(y / g.dy);
  const open = new Map<string, Run>();
  const out: Run[] = [];
  for (let i = 0; i < g.nx; i++) {
    const c = g.col(i, j);
    const x0 = i * g.dx;
    const seen = new Set<string>();
    for (let k = 0; k < g.n[c]; k++) {
      const z0 = Math.max(g.base(c, k), zBot);
      const z1 = Math.min(g.top[c * g.K + k], zTop);
      if (z1 <= z0 + 1e-4) continue;
      const color = matColor(g.mat[c * g.K + k], g.tag[c * g.K + k], g.dose[c]);
      const key = `${color}|${z0.toFixed(2)}|${z1.toFixed(2)}`;
      seen.add(key);
      const r = open.get(key);
      if (r && Math.abs(r.x1 - x0) < 1e-6) r.x1 = x0 + g.dx;
      else {
        if (r) out.push(r);
        open.set(key, { x0, x1: x0 + g.dx, z0, z1, color });
      }
    }
    for (const [key, r] of open) {
      if (!seen.has(key)) {
        out.push(r);
        open.delete(key);
      }
    }
  }
  for (const r of open.values()) out.push(r);
  return out;
}

interface Label {
  x: number;
  z: number;
  text: string;
  light?: boolean;
  small?: boolean;
  anchor?: 'start' | 'middle' | 'end';
}

function segAt(g: Grid, x: number, y: number, z: number): { mat: number; tag: number } | null {
  const c = g.col(Math.min(g.nx - 1, Math.floor(x / g.dx)), Math.min(g.ny - 1, Math.floor(y / g.dy)));
  for (let k = 0; k < g.n[c]; k++) if (z > g.base(c, k) && z <= g.top[c * g.K + k]) return { mat: g.mat[c * g.K + k], tag: g.tag[c * g.K + k] };
  return null;
}

function topOf(g: Grid, x: number, y: number, mat: number): { z0: number; z1: number } | null {
  const c = g.col(Math.min(g.nx - 1, Math.floor(x / g.dx)), Math.floor(y / g.dy));
  for (let k = g.n[c] - 1; k >= 0; k--) if (g.mat[c * g.K + k] === mat) return { z0: g.base(c, k), z1: g.top[c * g.K + k] };
  return null;
}

export function sectionLabels(g: Grid, y: number): Label[] {
  const L: Label[] = [];
  const siTop = (x: number) => {
    const c = g.col(Math.floor(x / g.dx), Math.floor(y / g.dy));
    const k = g.siTopIndex(c);
    return k >= 0 ? { z: g.top[c * g.K + k], tag: g.tag[c * g.K + k] } : null;
  };
  // wells / substrate
  const pw = segAt(g, 24, y, -9);
  const nw = segAt(g, 72, y, -9);
  if (pw?.tag === DOP.PWELL) L.push({ x: 24, z: -9.5, text: 'p-well', light: true });
  if (nw?.tag === DOP.NWELL) L.push({ x: 72, z: -9.5, text: 'n-well', light: true });
  if (pw?.tag === DOP.PSUB && nw?.tag === DOP.PSUB) L.push({ x: 48, z: -9.5, text: 'p-type silicon', light: true });
  // isolation
  const sti = topOf(g, 48, y, M.OX);
  if (sti && sti.z0 < -3) L.push({ x: 48, z: (Math.max(sti.z0, -7) + Math.min(sti.z1, 0)) / 2, text: 'isolation oxide', small: true });
  // sources & drains
  const sd: [number, string][] = [
    [16, 'n+ source'],
    [34, 'n+ drain'],
    [62, 'p+ drain'],
    [80, 'p+ source'],
  ];
  for (const [x, t] of sd) {
    const s = siTop(x);
    if (s && (s.tag === DOP.NPLUS || s.tag === DOP.PPLUS)) L.push({ x, z: s.z - 1.6, text: t, light: true, small: true });
  }
  // gates or blanket poly
  const pg = topOf(g, 25, y, M.POLY);
  const pOpen = topOf(g, 16, y, M.POLY);
  if (pg && !pOpen) {
    L.push({ x: 25, z: pg.z1 + 1.8, text: 'gate', small: true });
    const pg2 = topOf(g, 71, y, M.POLY);
    if (pg2) L.push({ x: 71, z: pg2.z1 + 1.8, text: 'gate', small: true });
    const s = siTop(16);
    if (s && s.tag === DOP.NPLUS) {
      L.push({ x: 25, z: -5, text: 'NMOS', light: true, small: true });
      L.push({ x: 71, z: -5, text: 'PMOS', light: true, small: true });
    }
  } else if (pg && pOpen) {
    L.push({ x: 8, z: (pg.z0 + pg.z1) / 2, text: 'polysilicon', light: true, small: true, anchor: 'start' });
  }
  // resist
  let best = 0;
  let bx = -1;
  let bz = 0;
  for (const x of [8, 16, 25, 34, 48, 62, 71, 80, 90]) {
    const r = topOf(g, x, y, M.RES);
    if (r && r.z1 - r.z0 > best) {
      best = r.z1 - r.z0;
      bx = x;
      bz = (r.z0 + r.z1) / 2;
    }
  }
  if (bx >= 0 && best > 1.2) L.push({ x: bx, z: bz, text: 'resist', light: true, small: true });
  // blanket nitride / pad oxide
  const nit = topOf(g, 25, y, M.NIT);
  if (nit && !topOf(g, 48, y, M.OX)?.z0) L.push({ x: 25, z: nit.z1 + 1.4, text: 'nitride', small: true });
  // contacts & metals
  const w = topOf(g, 16, y, M.W);
  if (w) L.push({ x: 16, z: (w.z0 + w.z1) / 2, text: 'contact', light: true, small: true });
  const cu1 = topOf(g, 16, y, M.CU);
  if (cu1) {
    L.push({ x: 16, z: cu1.z1 + 1.6, text: 'M1 · GND', small: true });
    const o = topOf(g, 48, y, M.CU);
    if (o) L.push({ x: 48, z: o.z1 + 1.6, text: 'OUT', small: true });
    L.push({ x: 80, z: cu1.z1 + 1.6, text: 'VDD', small: true });
  }
  return L;
}

function CrossSectionImpl({ grid, y = CUT_Y, zRange, labels = true, title, className, overlays }: XsecProps) {
  const [zBot, zTop] = useMemo(() => zRange ?? autoRange([grid], y), [grid, y, zRange]);
  const runs = useMemo(() => runsFor(grid, y, zBot, zTop), [grid, y, zBot, zTop]);
  const labs = useMemo(() => (labels ? sectionLabels(grid, y) : []), [grid, y, labels]);
  const W = grid.nx * grid.dx;
  const H = (zTop - zBot) * VEX;
  const sy = (z: number) => (zTop - z) * VEX;
  return (
    <svg className={'xsec ' + (className ?? '')} viewBox={`-2 -2 ${W + 4} ${H + 6}`} role="img" aria-label={title ?? 'Schematic cross-section of the inverter cell'}>
      {title && <title>{title}</title>}
      <rect x={-2} y={-2} width={W + 4} height={H + 6} fill="#fbfbfa" />
      {runs.map((r, i) => (
        <rect key={i} x={r.x0} y={sy(r.z1)} width={r.x1 - r.x0 + 0.02} height={(r.z1 - r.z0) * VEX + 0.02} fill={r.color} />
      ))}
      {/* substrate continues below */}
      <path
        d={`M0 ${H} ${Array.from({ length: 24 }, (_, i) => `L${((i + 0.5) * W) / 24} ${H + (i % 2 ? 0 : 1.4)}`).join(' ')} L${W} ${H}`}
        fill="none"
        stroke="#fbfbfa"
        strokeWidth={1.2}
      />
      {overlays?.map((o, i) => (
        <rect
          key={'o' + i}
          x={o.x0}
          y={sy(o.z1)}
          width={o.x1 - o.x0}
          height={(o.z1 - o.z0) * VEX}
          fill={o.color}
          fillOpacity={0.22}
          stroke={o.color}
          strokeWidth={0.35}
          strokeDasharray={o.dashed ? '1 0.8' : undefined}
        />
      ))}
      {labs.map((l, i) => (
        <text
          key={'l' + i}
          x={l.x}
          y={sy(l.z)}
          fontSize={l.small ? 2.3 : 2.7}
          textAnchor={l.anchor ?? 'middle'}
          dominantBaseline="middle"
          fill={l.light ? '#ffffff' : '#1a1c20'}
          stroke={l.light ? 'rgba(0,0,0,0.35)' : '#fbfbfa'}
          strokeWidth={l.light ? 0.25 : 0.7}
          paintOrder="stroke"
          fontWeight={500}
        >
          {l.text}
        </text>
      ))}
    </svg>
  );
}

export const CrossSection = memo(CrossSectionImpl);
