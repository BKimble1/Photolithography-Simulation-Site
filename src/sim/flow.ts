/**
 * The illustrative process flow: 37 learner-facing steps in five chapters, each expanding
 * into micro-operations on the process model. Chapter grouping is pedagogical; within the
 * flow every operation happens in a physically consistent order (lithography → develop →
 * etch/implant → strip), and the wafer's state accumulates from one step to the next.
 *
 * This is a teaching flow for a two-transistor inverter, not a production recipe. Real
 * FEOL flows add many steps (liners, spacers, extension implants, silicide, metal gates…).
 */

import type { MaskId } from './layout';
import { M } from './materials';
import type { Op, ResistRecipe } from './ops';
import { DOSE_LEVELS, type Choices, type DieContext, CENTER_DIE, type Film } from './types';

export type ChapterId = 'wafer' | 'transistors' | 'pattern' | 'connect' | 'test';

export const CHAPTERS: { id: ChapterId; index: number; name: string; title: string }[] = [
  { id: 'wafer', index: 1, name: 'Wafer', title: 'Wafer' },
  { id: 'transistors', index: 2, name: 'Transistors', title: 'Transistors' },
  { id: 'pattern', index: 3, name: 'Pattern', title: 'Patterning' },
  { id: 'connect', index: 4, name: 'Connect', title: 'Connecting' },
  { id: 'test', index: 5, name: 'Test', title: 'Testing' },
];

export type StepId =
  | 'arrive'
  | 'transfer'
  | 'scan'
  | 'clean'
  | 'diemap'
  | 'padox'
  | 'sti-etch'
  | 'sti-fill'
  | 'wells'
  | 'anneal'
  | 'gatestack'
  | 'prime'
  | 'coat'
  | 'softbake'
  | 'reticle'
  | 'align'
  | 'expose'
  | 'peb'
  | 'develop'
  | 'adi'
  | 'gate-etch'
  | 'strip'
  | 'sd'
  | 'pmd'
  | 'contact-align'
  | 'contact-print'
  | 'contact-etch'
  | 'contact-fill'
  | 'metal1'
  | 'metal2'
  | 'passivate'
  | 'inspect'
  | 'probe'
  | 'dice'
  | 'attach'
  | 'bond'
  | 'final';

export interface FlowStep {
  id: StepId;
  chapter: ChapterId;
  ops: (c: Choices, die: DieContext) => Op[];
}

// ───────────────────────────── experiment models ─────────────────────────────

/**
 * Spin coating, qualitatively: film thickness scales roughly with 1/√(spin speed), and
 * slow spins leave a less uniform film that thickens toward the wafer edge.
 * `v` is the 0..1 slider value; 0.5 is the recipe's nominal speed.
 */
export function spinModel(v: number): { speedRel: number; tRel: number; edgeRise: number } {
  const speedRel = v < 0.5 ? Math.exp(Math.log(0.45) * (1 - 2 * v)) : Math.exp(Math.log(3.0) * (2 * v - 1));
  const tRel = 1 / Math.sqrt(speedRel);
  const edgeRise = 0.015 + 0.4 * Math.pow(Math.max(0, 1 - speedRel), 1.5);
  return { speedRel, tRel, edgeRise };
}

export function doseRel(level: number): number {
  const i = Math.max(0, Math.min(DOSE_LEVELS.length - 1, Math.round(level)));
  return DOSE_LEVELS[i].rel;
}

// ───────────────────────────── op helpers ─────────────────────────────

/** A compressed lithography cycle, used for every layer except the detailed gate layer. */
function litho(mask: MaskId, recipe: ResistRecipe, purpose: string, dx = 0): Op[] {
  return [
    { kind: 'prime' },
    { kind: 'coat', recipe, tRel: 1, edgeRise: 0.015, mask, purpose },
    { kind: 'softbake' },
    { kind: 'expose', mask, recipe, doseRel: 1, dx, dy: 0 },
    { kind: 'peb' },
    { kind: 'develop', recipe },
  ];
}

const film = (mat: Film['mat'], nm: number, label: string): Film => ({ mat, nm, label });

const F = {
  pad: film(M.OX, 12, 'Pad oxide'),
  nit: film(M.NIT, 120, 'Nitride'),
  gox: film(M.OX, 3, 'Gate oxide'),
  poly: film(M.POLY, 150, 'Polysilicon'),
  pmd: film(M.OX, 650, 'Pre-metal dielectric'),
  w: film(M.W, 60, 'Tungsten'),
  imd1: film(M.ILD, 250, 'Dielectric'),
  cu1: film(M.CU, 180, 'Copper'),
  cap: film(M.CAP, 30, 'Cap'),
  imd2: film(M.ILD, 550, 'Dielectric'),
  cu2: film(M.CU, 300, 'Copper'),
  pass: film(M.PASS, 700, 'Passivation'),
};

// ───────────────────────────── the flow ─────────────────────────────

export const FLOW: FlowStep[] = [
  // ── Chapter 1 · Wafer ──
  { id: 'arrive', chapter: 'wafer', ops: () => [{ kind: 'receive' }] },
  { id: 'transfer', chapter: 'wafer', ops: () => [] },
  { id: 'scan', chapter: 'wafer', ops: () => [{ kind: 'scan' }] },
  { id: 'clean', chapter: 'wafer', ops: (c) => [{ kind: 'clean', enabled: c.clean }] },
  { id: 'diemap', chapter: 'wafer', ops: () => [] },

  // ── Chapter 2 · Transistors ──
  {
    id: 'padox',
    chapter: 'transistors',
    ops: () => [
      { kind: 'oxidize', t: 0.5, nm: 12, label: 'Pad oxide' },
      { kind: 'deposit', mat: M.NIT, tag: 0, t: 1.6, mode: 'conformal', nm: 120, label: 'Nitride' },
    ],
  },
  {
    id: 'sti-etch',
    chapter: 'transistors',
    ops: () => [
      ...litho('active', 'fine', 'isolation'),
      { kind: 'etch', recipe: 'sti' },
      { kind: 'strip' },
      { kind: 'films', films: [F.pad, F.nit], surface: 'Nitride islands between trenches', pattern: 1 },
    ],
  },
  {
    id: 'sti-fill',
    chapter: 'transistors',
    ops: () => [
      { kind: 'deposit', mat: M.OX, tag: 1, t: 2.4, mode: 'planar', nm: 500, label: 'Fill oxide' },
      { kind: 'cmp', stop: M.NIT, stopTag: -1, over: 0, label: 'Polish down to the nitride' },
      { kind: 'wetEtch', mat: M.NIT, t: 3, label: 'Nitride strip' },
      { kind: 'films', films: [F.pad], surface: 'Silicon islands in oxide trenches', pattern: 1 },
    ],
  },
  {
    id: 'wells',
    chapter: 'transistors',
    ops: () => [
      ...litho('nwell', 'implant', 'n-well'),
      { kind: 'implant', target: 'nwell', species: 'Phosphorus', range: 15, depth: 14 },
      { kind: 'strip' },
      ...litho('pwell', 'implant', 'p-well'),
      { kind: 'implant', target: 'pwell', species: 'Boron', range: 15, depth: 14 },
      { kind: 'strip' },
      { kind: 'films', films: [F.pad], surface: 'Wells implanted', pattern: 3 },
    ],
  },
  { id: 'anneal', chapter: 'transistors', ops: () => [{ kind: 'anneal', drive: 1.5, label: 'Well anneal' }] },
  {
    id: 'gatestack',
    chapter: 'transistors',
    ops: () => [
      { kind: 'wetEtch', mat: M.OX, t: 0.7, label: 'Strip pad oxide' },
      { kind: 'oxidize', t: 0.5, nm: 3, label: 'Gate oxide' },
      { kind: 'deposit', mat: M.POLY, tag: 0, t: 4, mode: 'conformal', nm: 150, label: 'Polysilicon' },
      { kind: 'films', films: [F.gox, F.poly], surface: 'Polysilicon over gate oxide', pattern: 3 },
    ],
  },

  // ── Chapter 3 · Pattern (the gate layer, in full detail) ──
  {
    id: 'prime',
    chapter: 'pattern',
    ops: (c) => [...(c.gateReworks > 0 ? [{ kind: 'rework', mask: 'poly', n: c.gateReworks } as Op] : []), { kind: 'prime' }],
  },
  {
    id: 'coat',
    chapter: 'pattern',
    ops: (c, die) => {
      const sp = spinModel(c.spin);
      return [{ kind: 'coat', recipe: 'fine', tRel: sp.tRel * die.thicknessMul, edgeRise: sp.edgeRise, mask: 'poly', purpose: 'gate' }];
    },
  },
  { id: 'softbake', chapter: 'pattern', ops: () => [{ kind: 'softbake' }] },
  { id: 'reticle', chapter: 'pattern', ops: () => [] },
  { id: 'align', chapter: 'pattern', ops: () => [] },
  {
    id: 'expose',
    chapter: 'pattern',
    ops: (c) => [{ kind: 'expose', mask: 'poly', recipe: 'fine', doseRel: doseRel(c.dose), dx: 0, dy: 0 }],
  },
  { id: 'peb', chapter: 'pattern', ops: () => [{ kind: 'peb' }] },
  { id: 'develop', chapter: 'pattern', ops: () => [{ kind: 'develop', recipe: 'fine' }] },
  { id: 'adi', chapter: 'pattern', ops: () => [{ kind: 'inspect', what: 'gate-adi' }] },
  { id: 'gate-etch', chapter: 'pattern', ops: () => [{ kind: 'etch', recipe: 'gate' }] },
  {
    id: 'strip',
    chapter: 'pattern',
    ops: () => [
      { kind: 'strip' },
      { kind: 'films', films: [F.gox], surface: 'Polysilicon gates on silicon', pattern: 4 },
    ],
  },

  // ── Chapter 4 · Connect ──
  {
    id: 'sd',
    chapter: 'connect',
    ops: () => [
      ...litho('nselect', 'sd', 'n+ implant'),
      { kind: 'implant', target: 'n+', species: 'Arsenic', range: 3, depth: 2.5 },
      { kind: 'strip' },
      ...litho('pselect', 'sd', 'p+ implant'),
      { kind: 'implant', target: 'p+', species: 'Boron', range: 3, depth: 2.5 },
      { kind: 'strip' },
      { kind: 'anneal', drive: 0, label: 'Activation anneal' },
      { kind: 'films', films: [F.gox], surface: 'Transistors complete', pattern: 6 },
    ],
  },
  {
    id: 'pmd',
    chapter: 'connect',
    ops: () => [
      { kind: 'deposit', mat: M.OX, tag: 2, t: 7, mode: 'planar', nm: 900, label: 'Pre-metal dielectric' },
      { kind: 'cmp', stop: null, stopTag: -1, over: 0, plane: 10, label: 'Planarise the dielectric' },
      { kind: 'films', films: [F.pmd], surface: 'Flat oxide over the transistors', pattern: 6 },
    ],
  },
  {
    id: 'contact-align',
    chapter: 'connect',
    ops: (c) => [
      ...(c.contactReworks > 0 ? [{ kind: 'rework', mask: 'contact', n: c.contactReworks } as Op] : []),
      { kind: 'prime' },
      { kind: 'coat', recipe: 'fine', tRel: 1, edgeRise: 0.015, mask: 'contact', purpose: 'contacts' },
      { kind: 'softbake' },
    ],
  },
  {
    id: 'contact-print',
    chapter: 'connect',
    ops: (c, die) => [
      { kind: 'expose', mask: 'contact', recipe: 'fine', doseRel: 1, dx: c.overlay + die.overlayExtra, dy: 0 },
      { kind: 'peb' },
      { kind: 'develop', recipe: 'fine' },
      { kind: 'inspect', what: 'contact-adi' },
    ],
  },
  {
    id: 'contact-etch',
    chapter: 'connect',
    ops: () => [
      { kind: 'etch', recipe: 'contact' },
      { kind: 'strip' },
      { kind: 'films', films: [F.pmd], surface: 'Contact holes through the oxide', pattern: 7 },
    ],
  },
  {
    id: 'contact-fill',
    chapter: 'connect',
    ops: () => [
      { kind: 'deposit', mat: M.W, tag: 0, t: 1.5, mode: 'planar', nm: 300, label: 'Tungsten' },
      { kind: 'cmp', stop: M.OX, stopTag: 2, over: 0, label: 'Polish off excess tungsten' },
      { kind: 'films', films: [F.pmd, F.w], surface: 'Tungsten plugs in oxide', pattern: 7 },
    ],
  },
  {
    id: 'metal1',
    chapter: 'connect',
    ops: () => [
      { kind: 'deposit', mat: M.ILD, tag: 1, t: 4, mode: 'conformal', nm: 250, label: 'Dielectric' },
      ...litho('metal1', 'fine', 'metal 1'),
      { kind: 'etch', recipe: 'm1' },
      { kind: 'strip' },
      { kind: 'deposit', mat: M.CU, tag: 1, t: 1.5, mode: 'planar', nm: 600, label: 'Copper' },
      { kind: 'cmp', stop: M.ILD, stopTag: 1, over: 0, label: 'Polish off excess copper' },
      { kind: 'films', films: [F.pmd, F.imd1, F.cu1], surface: 'Copper wires inlaid in dielectric', pattern: 8 },
      { kind: 'deposit', mat: M.CAP, tag: 0, t: 0.5, mode: 'conformal', nm: 30, label: 'Cap' },
    ],
  },
  {
    id: 'metal2',
    chapter: 'connect',
    ops: () => [
      { kind: 'deposit', mat: M.ILD, tag: 2, t: 10, mode: 'conformal', nm: 550, label: 'Dielectric' },
      ...litho('via1', 'fine', 'via 1'),
      { kind: 'etch', recipe: 'via' },
      { kind: 'strip' },
      ...litho('metal2', 'fine', 'metal 2'),
      { kind: 'etch', recipe: 'm2' },
      { kind: 'strip' },
      { kind: 'deposit', mat: M.CU, tag: 2, t: 1.5, mode: 'planar', nm: 800, label: 'Copper' },
      { kind: 'cmp', stop: M.ILD, stopTag: 2, over: 0, label: 'Polish off excess copper' },
      {
        kind: 'films',
        films: [F.pmd, F.imd1, F.cu1, F.cap, F.imd2, F.cu2],
        surface: 'Two levels of copper wiring',
        pattern: 10,
      },
    ],
  },
  {
    id: 'passivate',
    chapter: 'connect',
    ops: () => [
      { kind: 'deposit', mat: M.PASS, tag: 0, t: 2, mode: 'conformal', nm: 700, label: 'Passivation' },
      {
        kind: 'films',
        films: [F.pmd, F.imd1, F.cu1, F.cap, F.imd2, F.cu2, F.pass],
        surface: 'Sealed, with pad openings',
        pattern: 11,
      },
    ],
  },

  // ── Chapter 5 · Test ──
  { id: 'inspect', chapter: 'test', ops: () => [{ kind: 'inspect', what: 'final' }] },
  { id: 'probe', chapter: 'test', ops: () => [{ kind: 'backend', patch: { probed: true } }] },
  { id: 'dice', chapter: 'test', ops: () => [{ kind: 'backend', patch: { diced: true, surface: 'Diced dies on tape' } }] },
  { id: 'attach', chapter: 'test', ops: () => [{ kind: 'backend', patch: { packaged: 'attached' } }] },
  {
    id: 'bond',
    chapter: 'test',
    ops: () => [
      { kind: 'backend', patch: { packaged: 'bonded' } },
      { kind: 'backend', patch: { packaged: 'molded' } },
    ],
  },
  { id: 'final', chapter: 'test', ops: () => [] },
];

export const STEP_INDEX: Record<StepId, number> = Object.fromEntries(FLOW.map((s, i) => [s.id, i])) as Record<
  StepId,
  number
>;

export function chapterOf(stepIndex: number): ChapterId {
  return FLOW[Math.max(0, Math.min(FLOW.length - 1, stepIndex))].chapter;
}

export function chapterSteps(ch: ChapterId): number[] {
  return FLOW.map((s, i) => (s.chapter === ch ? i : -1)).filter((i) => i >= 0);
}

export { CENTER_DIE };
