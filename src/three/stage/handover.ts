/**
 * Hand-overs between what the machines showed and what they show next, shared by the stage
 * (which decides what each mounted machine presents) and the director (which draws them).
 *
 *  - The learner has one wafer. It is shown by one machine at a time, its owner; the director
 *    moves ownership to the next machine partway through the camera move (while the camera is
 *    between the two), so the wafer is never on screen twice.
 *  - A machine the story has just left keeps showing its last frame, frozen, until it is out
 *    of view (the stage releases it then).
 *  - When the same machine has to show something its animation cannot bridge (going back a
 *    lesson, jumping, leaving a lesson half-way), its last frame stays on screen until the
 *    director has captured the picture; the director then dissolves from that picture to the
 *    new one.
 */
import { create } from 'zustand';
import type { MachineId } from '../../state/nav';

export interface SwapGate {
  id: MachineId;
  /** The director has captured the outgoing picture: the machine may switch. */
  captured: boolean;
  /** The machine has drawn its new presentation (the dissolve may start). */
  committed: boolean;
}

export const handover = {
  /** The machine showing the learner's wafer (null: every machine may show it). */
  owner: null as MachineId | null,
  /** A same-machine change waiting for (or being dissolved by) the director. */
  swap: null as SwapGate | null,
};

/** Bumped to make the stage recompute its mounts (a frozen machine released, a swap captured). */
export const useMountEpoch = create(() => ({ n: 0 }));

export function remount(): void {
  useMountEpoch.setState((s) => ({ n: s.n + 1 }));
}
