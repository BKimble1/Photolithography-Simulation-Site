/**
 * What the stage director publishes for the page (scale, space, free look, travel, loading)
 * and the commands the page can give it. Kept free of three.js so the page's own code stays
 * small.
 */
import { create } from 'zustand';
import type { MachineId } from '../../state/nav';
import type { ScaleId } from '../../state/store';

export type Space = 'world' | 'device';

export interface StageInfo {
  scale: ScaleId;
  space: Space;
  /** The learner has taken the camera; offer a way back to the guided view. */
  freeLook: boolean;
  /** The camera is travelling (or waiting for its destination to load). */
  flying: boolean;
  /** The machine the camera is waiting for (its detailed model is still loading), if any. */
  loading: MachineId | null;
  /** A machine whose detailed model failed to load (the camera shows its exterior instead). */
  failed: MachineId | null;
  /** The first picture has been drawn with its machine loaded (the page may reveal the stage). */
  shown: boolean;
}

export const useStageInfo = create<StageInfo>(() => ({ scale: 'fab', space: 'world', freeLook: false, flying: false, loading: null, failed: null, shown: false }));

export function publish(p: StageInfo) {
  const cur = useStageInfo.getState();
  if (
    cur.scale !== p.scale ||
    cur.space !== p.space ||
    cur.freeLook !== p.freeLook ||
    cur.flying !== p.flying ||
    cur.loading !== p.loading ||
    cur.failed !== p.failed ||
    cur.shown !== p.shown
  )
    useStageInfo.setState(p);
}

/** Commands the DOM UI can give the director. */
export const directorCommands = {
  /** Hand the camera back to the guided view (Learn, Explore demo) or reset the view (Explore). */
  recentre: () => {},
  /** Try loading a machine's detailed model again after a failure. */
  retry: (_id: MachineId) => {},
};

/** The machine the story is at (lighting and shadows follow it). */
export const stageFocus: { station: MachineId | null } = { station: null };
