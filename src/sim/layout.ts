/**
 * Layout of the illustrative two-transistor CMOS inverter cell (schematic, not a real PDK).
 *
 * Coordinates are grid units (gu) in the cell: x 0..96 (left → right), y 0..64 (front → back).
 * The NMOS sits on the left in a p-well, the PMOS on the right in an n-well, so a single
 * cut along x at y = CUT_Y passes through both transistors, their contacts and the first
 * two wiring levels — the classic textbook inverter cross-section.
 *
 * Rectangles are [x0, y0, x1, y1) in gu.
 */

export type Rect = readonly [number, number, number, number];

export type MaskId =
  | 'active'
  | 'nwell'
  | 'pwell'
  | 'poly'
  | 'nselect'
  | 'pselect'
  | 'contact'
  | 'metal1'
  | 'via1'
  | 'metal2';

/**
 * Tone of a reticle as seen by positive resist:
 *  - 'clear': the drawn shapes are transparent openings; light passes there, so the
 *    resist there is exposed and removed by the developer (e.g. contact holes, trenches).
 *  - 'dark': the drawn shapes are chrome; everything else is clear, so resist survives
 *    only on the drawn shapes (e.g. gate lines, active areas protected from trench etch).
 */
export type MaskTone = 'clear' | 'dark';

export interface MaskDef {
  id: MaskId;
  name: string;
  /** What the pattern defines, in plain words. */
  purpose: string;
  tone: MaskTone;
  rects: readonly Rect[];
  /** Mask bias in gu added to each side of drawn shapes on the reticle (simple OPC). */
  bias: number;
  /** Order in which the layer is patterned in the flow (1-based). */
  order: number;
}

export const CUT_Y = 28; // y of the default cross-section (through the S/D contacts)

export const LAYOUT = {
  pwell: [0, 0, 48, 64] as Rect,
  nwell: [48, 0, 96, 64] as Rect,
  nActive: [10, 16, 40, 40] as Rect,
  pActive: [56, 12, 86, 44] as Rect,
  nGate: [22, 12, 28, 52] as Rect,
  pGate: [68, 8, 74, 52] as Rect,
  strap: [22, 46, 74, 52] as Rect,
  polyPad: [42, 42, 54, 54] as Rect,
  contacts: {
    nSource: [14, 26, 18, 30] as Rect,
    nDrain: [32, 26, 36, 30] as Rect,
    pDrain: [60, 26, 64, 30] as Rect,
    pSource: [78, 26, 82, 30] as Rect,
    gate: [46, 46, 50, 50] as Rect,
  },
  m1: {
    gnd: [12, 2, 20, 34] as Rect,
    out: [30, 24, 66, 32] as Rect,
    vdd: [76, 24, 84, 62] as Rect,
    in: [44, 44, 52, 52] as Rect,
  },
  v1: {
    gnd: [14, 3, 18, 7] as Rect,
    out: [46, 26, 50, 30] as Rect,
    vdd: [78, 57, 82, 61] as Rect,
    in: [46, 46, 50, 50] as Rect,
  },
  m2: {
    gnd: [0, 1, 96, 9] as Rect,
    vdd: [0, 55, 96, 63] as Rect,
    out: [40, 22, 56, 34] as Rect,
    in: [40, 40, 56, 52] as Rect,
  },
  nSelect: [6, 10, 46, 44] as Rect,
  pSelect: [52, 6, 90, 48] as Rect,
} as const;

/** Where the probe (and later the package) connects: points on the top wiring level. */
export const PINS = {
  VDD: { x: 48, y: 59 },
  GND: { x: 48, y: 5 },
  IN: { x: 48, y: 44 },
  OUT: { x: 48, y: 25 },
} as const;
export type PinName = keyof typeof PINS;

const L = LAYOUT;

export const MASKS: Record<MaskId, MaskDef> = {
  active: {
    id: 'active',
    name: 'Active',
    purpose: 'Where transistors live; everything else becomes isolation trench',
    tone: 'dark',
    rects: [L.nActive, L.pActive],
    bias: 0,
    order: 1,
  },
  nwell: {
    id: 'nwell',
    name: 'N-well',
    purpose: 'Opens the PMOS side for a phosphorus implant',
    tone: 'clear',
    rects: [L.nwell],
    bias: 0,
    order: 2,
  },
  pwell: {
    id: 'pwell',
    name: 'P-well',
    purpose: 'Opens the NMOS side for a boron implant',
    tone: 'clear',
    rects: [L.pwell],
    bias: 0,
    order: 3,
  },
  poly: {
    id: 'poly',
    name: 'Gate',
    purpose: 'Gate lines of both transistors and the strap that joins them',
    tone: 'dark',
    rects: [L.nGate, L.pGate, L.strap, L.polyPad],
    bias: 0,
    order: 4,
  },
  nselect: {
    id: 'nselect',
    name: 'N+ implant',
    purpose: 'Opens the NMOS for its source/drain implant',
    tone: 'clear',
    rects: [L.nSelect],
    bias: 0,
    order: 5,
  },
  pselect: {
    id: 'pselect',
    name: 'P+ implant',
    purpose: 'Opens the PMOS for its source/drain implant',
    tone: 'clear',
    rects: [L.pSelect],
    bias: 0,
    order: 6,
  },
  contact: {
    id: 'contact',
    name: 'Contact',
    purpose: 'Holes down to source, drain and gate',
    tone: 'clear',
    rects: Object.values(L.contacts),
    bias: 0.5,
    order: 7,
  },
  metal1: {
    id: 'metal1',
    name: 'Metal 1',
    purpose: 'Trenches for the first copper wires',
    tone: 'clear',
    rects: Object.values(L.m1),
    bias: 0.25,
    order: 8,
  },
  via1: {
    id: 'via1',
    name: 'Via 1',
    purpose: 'Holes that join metal 1 to metal 2',
    tone: 'clear',
    rects: Object.values(L.v1),
    bias: 0.5,
    order: 9,
  },
  metal2: {
    id: 'metal2',
    name: 'Metal 2',
    purpose: 'Trenches for the second copper wires',
    tone: 'clear',
    rects: Object.values(L.m2),
    bias: 0.25,
    order: 10,
  },
};

export const MASK_ORDER: MaskId[] = (Object.keys(MASKS) as MaskId[]).sort(
  (a, b) => MASKS[a].order - MASKS[b].order,
);

/**
 * Contact-to-gate spacing in gu: a contact shifted by this much touches the gate.
 * Every S/D contact has the same spacing to its gate and to the isolation edge.
 */
export const CONTACT_MARGIN = 4;
