/**
 * Material and tag vocabulary for the process model.
 *
 * Materials are small integers so the die grid can live in typed arrays. Silicon carries a
 * doping tag; resist carries a chemical-state tag. Everything here is schematic: the model
 * tracks which material sits where and its electrical role, not real composition.
 */

export const M = {
  AIR: 0,
  SI: 1, // crystalline silicon (substrate); doping lives in the tag
  OX: 2, // silicon dioxide: thermal oxide, STI fill, pre-metal dielectric
  NIT: 3, // silicon nitride: STI hard mask / passivation
  POLY: 4, // in-situ doped polysilicon gate electrode
  RES: 5, // photoresist (positive tone)
  W: 6, // tungsten contact plug
  CU: 7, // copper interconnect (damascene)
  ILD: 8, // inter-metal dielectric (low-k oxide)
  CAP: 9, // dielectric cap / etch-stop over copper
  PASS: 10, // passivation (nitride/oxide stack)
} as const;
export type MatId = (typeof M)[keyof typeof M];

/** Doping tags for silicon segments. */
export const DOP = {
  PSUB: 0, // lightly p-doped starting wafer
  PWELL: 1,
  NWELL: 2,
  NPLUS: 3, // heavily n-doped source/drain
  PPLUS: 4, // heavily p-doped source/drain
} as const;
export type DopingTag = (typeof DOP)[keyof typeof DOP];

/** Chemical state of a resist segment. */
export const RES = {
  COATED: 0, // wet film straight off the spin coater
  BAKED: 1, // soft-baked: solvent driven out
  EXPOSED: 2, // latent image: photoacid where light arrived (aux = absorbed dose)
  PEB: 3, // post-exposure bake: acid-catalysed deprotection (solubility switched)
  DEVELOPED: 4, // developer has removed the soluble resist
} as const;
export type ResistTag = (typeof RES)[keyof typeof RES];

export type ElecClass = 'metal' | 'poly' | 'n+' | 'p+' | 'body' | 'insulator';

export interface MaterialInfo {
  id: MatId;
  key: string;
  name: string;
  /** Short label used in cross-section call-outs. */
  short: string;
  /** Role in plain words, used in legends. */
  role: string;
}

export const MATERIALS: Record<MatId, MaterialInfo> = {
  [M.AIR]: { id: M.AIR, key: 'air', name: 'Air', short: 'Air', role: '' },
  [M.SI]: { id: M.SI, key: 'si', name: 'Silicon', short: 'Silicon', role: 'Crystal the transistors are built in' },
  [M.OX]: { id: M.OX, key: 'ox', name: 'Silicon dioxide', short: 'Oxide', role: 'Insulator' },
  [M.NIT]: { id: M.NIT, key: 'nit', name: 'Silicon nitride', short: 'Nitride', role: 'Hard mask and polish stop' },
  [M.POLY]: { id: M.POLY, key: 'poly', name: 'Polysilicon', short: 'Poly gate', role: 'Gate electrode (conductor)' },
  [M.RES]: { id: M.RES, key: 'res', name: 'Photoresist', short: 'Resist', role: 'Temporary light-sensitive stencil' },
  [M.W]: { id: M.W, key: 'w', name: 'Tungsten', short: 'Tungsten', role: 'Contact plug (conductor)' },
  [M.CU]: { id: M.CU, key: 'cu', name: 'Copper', short: 'Copper', role: 'Wiring (conductor)' },
  [M.ILD]: { id: M.ILD, key: 'ild', name: 'Inter-metal dielectric', short: 'Dielectric', role: 'Insulator between wires' },
  [M.CAP]: { id: M.CAP, key: 'cap', name: 'Dielectric cap', short: 'Cap', role: 'Etch stop and copper barrier' },
  [M.PASS]: { id: M.PASS, key: 'pass', name: 'Passivation', short: 'Passivation', role: 'Protective top coat' },
};

export const DOPING_INFO: Record<DopingTag, { name: string; short: string; type: 'p' | 'n' }> = {
  [DOP.PSUB]: { name: 'p-type substrate', short: 'p-substrate', type: 'p' },
  [DOP.PWELL]: { name: 'p-well', short: 'p-well', type: 'p' },
  [DOP.NWELL]: { name: 'n-well', short: 'n-well', type: 'n' },
  [DOP.NPLUS]: { name: 'n+ source/drain', short: 'n+', type: 'n' },
  [DOP.PPLUS]: { name: 'p+ source/drain', short: 'p+', type: 'p' },
};

/** Electrical class of a segment, used by the connectivity extraction. */
export function elecClass(mat: number, tag: number): ElecClass {
  switch (mat) {
    case M.W:
    case M.CU:
      return 'metal';
    case M.POLY:
      return 'poly';
    case M.SI:
      if (tag === DOP.NPLUS) return 'n+';
      if (tag === DOP.PPLUS) return 'p+';
      return 'body';
    default:
      return 'insulator';
  }
}

export function isDielectric(mat: number): boolean {
  return mat === M.OX || mat === M.NIT || mat === M.ILD || mat === M.CAP || mat === M.PASS;
}
