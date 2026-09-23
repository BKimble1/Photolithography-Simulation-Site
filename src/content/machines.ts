/**
 * The machines the fab explorer can visit: a name, one sentence about the job it does, where
 * it stands, and every lesson that uses it (several machines are revisited for later layers —
 * a fab is not a one-pass assembly line).
 */

import { FLOW, type StepId } from '../sim/flow';
import type { MachineId } from '../state/nav';
import { STEPS } from './steps';

export interface MachineInfo {
  id: MachineId;
  name: string;
  job: string;
  /** Fabrication (clean room) or the downstream test and packaging area. */
  area: 'fab' | 'backend';
}

export const MACHINE_INFO: Record<MachineId, MachineInfo> = {
  foup: {
    id: 'foup',
    name: 'Load port and wafer handling',
    job: 'Opens the sealed wafer pod at the tool and lets a robot carry wafers inside a small, filtered enclosure.',
    area: 'fab',
  },
  inspect: {
    id: 'inspect',
    name: 'Wafer inspection',
    job: 'Sweeps a laser across the wafer and maps the light scattered by particles and defects.',
    area: 'fab',
  },
  wetclean: {
    id: 'wetclean',
    name: 'Single-wafer clean',
    job: 'Sprays cleaning chemicals and rinse water onto a spinning wafer to lift off particles and residues.',
    area: 'fab',
  },
  furnace: {
    id: 'furnace',
    name: 'Vertical furnace',
    job: 'Heats a batch of wafers in a quartz tube to grow oxide, deposit nitride or anneal implants.',
    area: 'fab',
  },
  implant: {
    id: 'implant',
    name: 'Ion implanter',
    job: 'Accelerates dopant ions and fires them into the wafer to change how the silicon conducts.',
    area: 'fab',
  },
  depo: {
    id: 'depo',
    name: 'Deposition cluster',
    job: 'Grows thin films such as polysilicon and oxide on the wafer from reactive gases.',
    area: 'fab',
  },
  track: {
    id: 'track',
    name: 'Coater/developer track',
    job: 'Primes, coats, bakes and develops photoresist, working alongside the scanner.',
    area: 'fab',
  },
  scanner: {
    id: 'scanner',
    name: 'DUV scanner (193 nm)',
    job: 'Projects the reticle pattern onto the resist, shrinking it four times, one field at a time.',
    area: 'fab',
  },
  etch: {
    id: 'etch',
    name: 'Plasma etch cluster',
    job: 'Uses a plasma to remove material wherever the resist leaves it uncovered, and to strip resist.',
    area: 'fab',
  },
  cmp: {
    id: 'cmp',
    name: 'CMP polisher',
    job: 'Polishes the wafer flat with a rotating pad and slurry, removing the excess film.',
    area: 'fab',
  },
  metrology: {
    id: 'metrology',
    name: 'CD-SEM',
    job: 'Measures pattern sizes with a scanning electron microscope before anything permanent happens.',
    area: 'fab',
  },
  prober: {
    id: 'prober',
    name: 'Wafer prober',
    job: 'Touches probe needles to each die and runs an electrical test.',
    area: 'backend',
  },
  dicing: {
    id: 'dicing',
    name: 'Dicing saw',
    job: 'Cuts the finished wafer into separate dies along the scribe streets.',
    area: 'backend',
  },
  package: {
    id: 'package',
    name: 'Die attach and wire bonder',
    job: 'Places a good die in its package, links its pads to the leads with fine wires and seals it.',
    area: 'backend',
  },
  testbench: {
    id: 'testbench',
    name: 'Final test',
    job: 'Checks the packaged chip electrically: set the input, read the output.',
    area: 'backend',
  },
};

/** The lesson a machine's demonstration plays (its most characteristic job). */
export const DEMO_STEP: Record<MachineId, StepId> = {
  foup: 'transfer',
  inspect: 'scan',
  wetclean: 'clean',
  furnace: 'padox',
  implant: 'wells',
  depo: 'gatestack',
  track: 'coat',
  scanner: 'expose',
  etch: 'gate-etch',
  cmp: 'sti-fill',
  metrology: 'adi',
  prober: 'probe',
  dicing: 'dice',
  package: 'bond',
  testbench: 'final',
};

/** Lessons (step indices) that use a machine, in journey order. */
export function lessonsFor(id: MachineId): number[] {
  const out: number[] = [];
  FLOW.forEach((f, i) => {
    const sc = STEPS[f.id].scene;
    const st = sc === 'wafer' ? 'inspect' : sc;
    if (st === id) out.push(i);
  });
  return out;
}

/** The machine used by a step's scene (the wafer view lives in the inspection tool). */
export function machineOfStep(i: number): MachineId | null {
  const sc = STEPS[FLOW[i].id].scene;
  if (sc === 'fab') return null;
  return (sc === 'wafer' ? 'inspect' : sc) as MachineId;
}
