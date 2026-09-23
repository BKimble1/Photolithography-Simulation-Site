/**
 * What the stage director publishes for the page (scale, space, free look, travel) and the
 * commands the page can give it. Kept free of three.js so the page's own code stays small.
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
}

export const useStageInfo = create<StageInfo>(() => ({ scale: 'fab', space: 'world', freeLook: false, flying: false }));

export function publish(p: StageInfo) {
  const cur = useStageInfo.getState();
  if (cur.scale !== p.scale || cur.space !== p.space || cur.freeLook !== p.freeLook || cur.flying !== p.flying) useStageInfo.setState(p);
}

/** Commands the DOM UI can give the director. */
export const directorCommands = {
  /** Hand the camera back to the guided view (Learn, Explore demo) or reset the view (Explore). */
  recentre: () => {},
};

/** The machine the story is at (lighting and shadows follow it). */
export const stageFocus: { station: MachineId | null } = { station: null };

