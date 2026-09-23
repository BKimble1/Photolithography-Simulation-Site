/**
 * Watch registers its shot evaluator here, so the director can frame the film without
 * importing the film module (which is loaded only when someone presses Watch).
 */
import type { MachineId } from '../../state/nav';
import type { CamSample } from './tracks';

export const filmBridge: {
  sample: ((out: CamSample) => boolean) | null;
  /** The machine the film is at right now (it holds the learner's wafer). */
  station: MachineId | null;
  /** The viewport aspect (width / height), kept up to date by the director. */
  aspect: number;
} = { sample: null, station: null, aspect: 1.6 };

/** The film's camera for the current media time; false when no film is loaded. */
export function filmSample(out: CamSample): boolean {
  return filmBridge.sample ? filmBridge.sample(out) : false;
}
