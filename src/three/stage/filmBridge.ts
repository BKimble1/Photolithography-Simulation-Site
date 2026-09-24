/**
 * Watch registers its shot evaluator here, so the director can frame the film without
 * importing the film module (which is loaded only when someone presses Watch).
 */
import type { MachineId } from '../../state/nav';
import type { CamSample } from './tracks';

export const filmBridge: {
  sample: ((out: CamSample) => boolean) | null;
  /** The film's camera at any film time (what playing up to a time has left on screen is worked
   * out from it after a seek: see the Director's housings). */
  sampleAt: ((t: number, out: CamSample) => boolean) | null;
  /** The machine the film is at, at any film time. */
  stationAt: ((t: number) => MachineId | null) | null;
  /** The film's clock (seconds of film time). */
  time: (() => number) | null;
  /** How many times the film has been sought (its picture jumps: the stage catches up). */
  seeks: (() => number) | null;
  /** Bring the film's stage (presentations, mounts) up to the film's clock now. */
  sync: (() => void) | null;
  /** The machine the film is at right now (it holds the learner's wafer). */
  station: MachineId | null;
  /** In a move between segments, the machine at its other end (the move is planned with both). */
  otherEnd: MachineId | null;
  /** The machine of a move that starts within a few seconds (a seek waits for it: see Director). */
  soon: MachineId | null;
  /** The presentation the film shows right now (the stage's tree follows it: see stageCommit). */
  pres: object | null;
  /** The viewport aspect (width / height), kept up to date by the director. */
  aspect: number;
} = { sample: null, sampleAt: null, stationAt: null, time: null, seeks: null, sync: null, station: null, otherEnd: null, soon: null, pres: null, aspect: 1.6 };

/** The film's camera for the current media time; false when no film is loaded. */
export function filmSample(out: CamSample): boolean {
  return filmBridge.sample ? filmBridge.sample(out) : false;
}

/**
 * The presentation the stage's tree has committed (set by the stage after every commit). The
 * tree catches up with a change of presentation a frame later than the camera can: React
 * commits between frames.
 */
export const stageCommit: { pres: object | null } = { pres: null };
