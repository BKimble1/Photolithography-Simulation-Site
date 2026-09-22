/**
 * Display colours for materials. Physical materials use muted, plausible colours; doping
 * tints and the latent image are illustrative highlights (real doped silicon looks the same
 * as undoped silicon, and a latent image is invisible) and are marked as such in legends.
 */
import { DOP, M, RES } from '../sim/materials';

export const SI_COLORS: Record<number, string> = {
  [DOP.PSUB]: '#4b4e56',
  [DOP.PWELL]: '#5d4d41',
  [DOP.NWELL]: '#3b5467',
  [DOP.NPLUS]: '#3c7ad4',
  [DOP.PPLUS]: '#de873a',
};

export const RESIST = '#7566f2';
export const RESIST_LATENT = '#c9c2ff';

export function matColor(mat: number, tag: number, dose = 0): string {
  switch (mat) {
    case M.SI:
      return SI_COLORS[tag] ?? SI_COLORS[DOP.PSUB];
    case M.OX:
      return tag === 1 ? '#cfd7e0' : tag === 2 ? '#e2e6ea' : '#dde2e8';
    case M.NIT:
      return '#b7c8b0';
    case M.POLY:
      return '#bf5a6c';
    case M.RES:
      if (tag === RES.EXPOSED || tag === RES.PEB) return mix(RESIST, RESIST_LATENT, latentAmount(dose, tag));
      return RESIST;
    case M.W:
      return '#8b929c';
    case M.CU:
      return '#c47f4c';
    case M.ILD:
      return tag === 2 ? '#edf0f3' : '#e8ecf0';
    case M.CAP:
      return '#a9b8c8';
    case M.PASS:
      return '#cad6cc';
    default:
      return '#999';
  }
}

/** How strongly to tint exposed resist (illustrative latent image). */
export function latentAmount(dose: number, tag: number): number {
  const k = tag === RES.PEB ? 1 : 0.8;
  return Math.max(0, Math.min(1, (dose - 0.35) / 1.4)) * k;
}

export function mix(a: string, b: string, t: number): string {
  const pa = parse(a);
  const pb = parse(b);
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}

function parse(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Legend entries for the device view and cross-section. */
export const LEGEND_PHYSICAL: { label: string; color: string; mat: number }[] = [
  { label: 'Silicon', color: SI_COLORS[DOP.PSUB], mat: M.SI },
  { label: 'Oxide', color: '#dde2e8', mat: M.OX },
  { label: 'Nitride', color: '#b7c8b0', mat: M.NIT },
  { label: 'Polysilicon gate', color: '#bf5a6c', mat: M.POLY },
  { label: 'Photoresist', color: RESIST, mat: M.RES },
  { label: 'Tungsten contact', color: '#8b929c', mat: M.W },
  { label: 'Copper wiring', color: '#c47f4c', mat: M.CU },
  { label: 'Inter-metal dielectric', color: '#e8ecf0', mat: M.ILD },
  { label: 'Cap / passivation', color: '#a9b8c8', mat: M.CAP },
];

export const LEGEND_HIGHLIGHT: { label: string; color: string }[] = [
  { label: 'p-well (tint)', color: SI_COLORS[DOP.PWELL] },
  { label: 'n-well (tint)', color: SI_COLORS[DOP.NWELL] },
  { label: 'n+ source/drain (tint)', color: SI_COLORS[DOP.NPLUS] },
  { label: 'p+ source/drain (tint)', color: SI_COLORS[DOP.PPLUS] },
  { label: 'Latent image (invisible in reality)', color: RESIST_LATENT },
];
