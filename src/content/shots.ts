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

/** Hand-directed tracks. Steps without one get a default built from their scene and view. */
export const SHOTS: Partial<Record<StepId, Key[]>> = {};

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
