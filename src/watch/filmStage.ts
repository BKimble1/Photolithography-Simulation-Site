/**
 * What the stage shows while Watch is playing: the film's presentation (canonical run, media
 * clock) and the machines it needs mounted. Filled in by the Watch module when it loads.
 */
import { create } from 'zustand';
import type { StationMount } from '../three/stage/context';
import type { Presentation } from '../state/presentation';

export interface FilmStage {
  pres: Presentation;
  mounts: StationMount[];
}

export const useFilmStage = create<{ stage: FilmStage | null }>(() => ({ stage: null }));

export function useFilmPresentation(): FilmStage | null {
  return useFilmStage((s) => s.stage);
}
