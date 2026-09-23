/**
 * Directed camera tracks, one per step, as keyframes in step progress p (0..1). A key says
 * "by p, the camera arrives at this framing"; between keys the camera moves. Because the
 * track is a function of p only, scrubbing, replaying and Watch's media clock all produce the
 * same shot at the same moment.
 *
 * Visual grammar (see IMPLEMENTATION.md): establish the equipment and locate the wafer →
 * follow the mechanical action → approach the wafer surface → pick out your die → reveal the
 * magnified cross-section → hold → come back out before moving elsewhere.
 *
 * Framings:
 *   machine the whole machine from the aisle, framed from its footprint (establishing shot)
 *   shot    a named framing of the step's machine (tools/poses/<tool>.ts: POSE, variants, shots)
 *   wafer   'top' = the whole wafer where it is right now; 'die' = close over your die
 *   fab     the machine's place in the bay ('overview' = the whole bay)
 *   device  the magnified, schematic cross-section of one inverter cell
 */

import type { StepId } from '../sim/flow';
import { FLOW } from '../sim/flow';
import type { MachineId } from '../state/nav';
import { STEPS } from './steps';

export type CamRef =
  | { kind: 'machine'; station?: MachineId }
  | { kind: 'shot'; name: string; station?: MachineId }
  | { kind: 'wafer'; framing: 'top' | 'die'; station?: MachineId }
  | { kind: 'fab'; station?: MachineId | 'overview' }
  | { kind: 'device'; framing: 'section' | 'top' | 'wide' };

export interface Key {
  p: number;
  cam: CamRef;
}

const shot = (name: string, station?: MachineId): CamRef => ({ kind: 'shot', name, station });
const waferTop: CamRef = { kind: 'wafer', framing: 'top' };
const die: CamRef = { kind: 'wafer', framing: 'die' };
const section: CamRef = { kind: 'device', framing: 'section' };

const machine: CamRef = { kind: 'machine' };
const tool = shot('establish');

/**
 * Hand-directed tracks. Steps without one get a default built from their scene and view.
 *
 * Most need one because part of the step happens in other tools. The etch cluster, the
 * implanter and the polisher hold the wafer only for their own part of the step (the
 * lithography, deposition or etch before it happens elsewhere and is shown in the
 * cross-section), so the camera stays with the layers until the wafer arrives, comes out to the
 * machine for its action, then goes back down (through the wafer when it can be seen) to show
 * what changed. The furnace, the hot plate and the ash chamber enclose the wafer while they
 * work, so the camera goes down to the layers before they close, or from the machine itself.
 */
export const SHOTS: Partial<Record<StepId, Key[]>> = {
  // lithography 0.02–0.42 elsewhere; into the load lock 0.43, onto the chuck by 0.61; the trench
  // etch ends at 0.72, the resist ash at 0.9
  'sti-etch': [
    { p: 0, cam: section },
    { p: 0.44, cam: section },
    { p: 0.5, cam: tool },
    { p: 0.58, cam: tool },
    { p: 0.64, cam: die },
    { p: 0.69, cam: section },
  ],
  // first mask elsewhere (0.02–0.2); in the implanter 0.195–0.405 (beam 0.27–0.33); the second
  // mask and implant are then seen in the layers
  wells: [
    { p: 0, cam: section },
    { p: 0.17, cam: section },
    { p: 0.23, cam: tool },
    { p: 0.35, cam: tool },
    { p: 0.41, cam: section },
  ],
  // the same two mask-and-implant cycles again, in the same implanter: shown in the layers
  sd: [{ p: 0, cam: section }],
  // the boat is sealed in the tube 0.28–0.82; activation at 0.6
  anneal: [
    { p: 0, cam: tool },
    { p: 0.5, cam: tool },
    { p: 0.58, cam: section },
  ],
  // the wafer reaches the ash chamber by 0.32; the oxygen plasma (0.36–0.615) fills it with glow
  strip: [
    { p: 0, cam: tool },
    { p: 0.3, cam: tool },
    { p: 0.4, cam: section },
  ],
  // tungsten deposited at 0.35; wafer in the cup by 0.45; polish 0.55–0.75; back in the cup by 0.83
  'contact-fill': [
    { p: 0, cam: section },
    { p: 0.4, cam: section },
    { p: 0.47, cam: die },
    { p: 0.54, cam: tool },
    { p: 0.78, cam: tool },
    { p: 0.88, cam: die },
    { p: 0.95, cam: section },
  ],
  // dielectric, lithography, trench etch and strip, then copper at 0.7, all seen in the layers;
  // the wafer is already polishing (0.71–0.85) when the camera comes out; back in the cup by 0.915
  metal1: [
    { p: 0, cam: section },
    { p: 0.73, cam: section },
    { p: 0.79, cam: machine },
    { p: 0.83, cam: tool },
    { p: 0.87, cam: tool },
    { p: 0.925, cam: die },
    { p: 0.965, cam: section },
  ],
  // The track's robot carries the wafer on from the module the last lesson left it in: the
  // camera holds on the pick-up, then follows the wafer to the next module (the transfer
  // windows are in tools/Track.tsx: ROUTES).
  coat: [
    { p: 0, cam: shot('prime') },
    { p: 0.04, cam: shot('prime') },
    { p: 0.08, cam: shot('coat') },
  ],
  softbake: [
    { p: 0, cam: shot('coat') },
    { p: 0.055, cam: shot('coat') },
    { p: 0.11, cam: shot('bake') },
  ],
  // back from the scanner: onto the hot plate, then down into the layers before the lid closes
  peb: [
    { p: 0, cam: shot('bake') },
    { p: 0.16, cam: waferTop },
    { p: 0.21, cam: die },
    { p: 0.28, cam: section },
  ],
  develop: [
    { p: 0, cam: shot('bake') },
    { p: 0.045, cam: shot('bake') },
    { p: 0.09, cam: shot('develop') },
    { p: 0.27, cam: waferTop },
    { p: 0.37, cam: die },
    { p: 0.47, cam: section },
  ],
  // the second level repeats the loop; its copper and polish land 0.06 apart, so the dual-damascene
  // fill is shown where it can be seen, in the layers, and the polisher (seen twice already) is not
  // revisited
  metal2: [{ p: 0, cam: section }],
};

/** First process operation time in a step (the moment the wafer changes). */
function firstOp(id: StepId): number {
  const at = STEPS[id].at;
  if (at && at.length) return at[0];
  return 0.5;
}

/** Default direction for a step, derived from its round-one view. */
export function defaultTrack(id: StepId): Key[] {
  const c = STEPS[id];
  const variantShot = shot(c.variant ?? 'establish');
  switch (c.view) {
    case 'fab':
      return [{ p: 0, cam: { kind: 'fab' } }];
    case 'wafer':
      return [
        { p: 0, cam: variantShot },
        { p: 0.2, cam: waferTop },
      ];
    case 'device': {
      // Arrive in the cross-section shortly before the step's first change to the wafer.
      const pDev = Math.max(0.28, Math.min(0.55, firstOp(id) - 0.08));
      return [
        { p: 0, cam: variantShot },
        { p: pDev - 0.2, cam: waferTop },
        { p: pDev - 0.1, cam: die },
        { p: pDev, cam: section },
      ];
    }
    default:
      return [{ p: 0, cam: variantShot }];
  }
}

export function trackFor(id: StepId): Key[] {
  return SHOTS[id] ?? defaultTrack(id);
}

export function trackForIndex(i: number): Key[] {
  return trackFor(FLOW[i].id);
}

export const FRAMINGS = { shot, waferTop, die, section };
