/**
 * A presentation is "what the 3D scenes are showing": which step, at what progress, for which
 * run of choices, with which overlays. Learn, Watch and Explore demonstrations each provide one,
 * so the same scenes, process model and labels serve all three without sharing run state:
 *
 *  - Learn   → the learner's run and lesson clock (the store).
 *  - Watch   → the canonical successful run, driven by the film's media clock.
 *  - Demo    → the canonical run at a machine's representative step, on a local preview clock.
 *  - Parked  → a machine the camera may pass while the story is elsewhere (idle, no wafer).
 *  - Frozen  → any of the above, held on the last frame it showed: the machine the story has
 *              just left stays exactly as it was until it is out of view.
 *
 * Components outside a provider (the DOM UI) fall back to the learning run.
 */

import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import type { Choices } from '../sim/types';
import { useApp, useClock } from './store';

export interface ProgressSource {
  /** Step progress 0..1, read inside render loops. */
  get: () => number;
  subscribe: (fn: () => void) => () => void;
}

export interface Presentation {
  kind: 'learn' | 'watch' | 'demo' | 'parked';
  stepIndex: number;
  choices: Choices;
  progress: ProgressSource;
  lightPath: boolean;
  xray: boolean;
  cutaway: boolean;
  finalInput: 0 | 1;
  /** Freeze decorative motion (fans, flicker) and use cuts instead of camera moves. */
  reducedMotion: boolean;
  /** In-scene controls (e.g. the test-bench switch) act only when this is set. */
  setFinalInput?: (v: 0 | 1) => void;
  /** An idle machine the story is not at: it shows no learner wafer. */
  parked?: boolean;
  /** Held on the last frame it showed (the story has moved on; see stage/handover.ts). */
  frozen?: boolean;
}

const Ctx = createContext<Presentation | null>(null);

export function PresentationProvider({ value, children }: { value: Presentation; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePresentation(): Presentation | null {
  return useContext(Ctx);
}

/** The lesson clock as a progress source. */
export const learnProgress: ProgressSource = {
  get: () => useClock.getState().progress,
  subscribe: (fn) => useClock.subscribe((s, p) => s.progress !== p.progress && fn()),
};

/** A progress source that never changes (e.g. a still frame). */
export function fixedProgress(p: number): ProgressSource {
  return { get: () => p, subscribe: () => () => {} };
}

/** Build the Learn presentation from the store (used by the stage while in Learn). */
export function useLearnPresentation(): Presentation {
  const stepIndex = useApp((s) => s.step);
  const choices = useApp((s) => s.choices);
  const lightPath = useApp((s) => s.lightPath);
  const xray = useApp((s) => s.xray);
  const cutaway = useApp((s) => s.cutaway);
  const finalInput = useApp((s) => s.finalInput);
  const reducedMotion = useApp((s) => s.reducedMotion);
  const setFinalInput = useApp((s) => s.setFinalInput);
  return useMemo(
    () => ({ kind: 'learn', stepIndex, choices, progress: learnProgress, lightPath, xray, cutaway, finalInput, reducedMotion, setFinalInput }),
    [stepIndex, choices, lightPath, xray, cutaway, finalInput, reducedMotion, setFinalInput],
  );
}

// ───────────────────────────── hooks for scenes ─────────────────────────────

export function useProgressSource(): ProgressSource {
  return usePresentation()?.progress ?? learnProgress;
}

/** React-visible progress (re-renders on every change; prefer useProgressFrame in scenes). */
export function useProgressValue(): number {
  const src = useProgressSource();
  return useSyncExternalStore(src.subscribe, src.get, src.get);
}

/** The run choices the current presentation shows (learner's, or the canonical run). */
export function useRunChoices(): Choices {
  const pres = usePresentation();
  const learn = useApp((s) => s.choices);
  return pres ? pres.choices : learn;
}

export function useOverlay(k: 'lightPath' | 'xray' | 'cutaway'): boolean {
  const pres = usePresentation();
  const learn = useApp((s) => s[k]);
  return pres ? pres[k] : learn;
}

export function useFinalInput(): [0 | 1, ((v: 0 | 1) => void) | undefined] {
  const pres = usePresentation();
  const learn = useApp((s) => s.finalInput);
  const set = useApp((s) => s.setFinalInput);
  return pres ? [pres.finalInput, pres.setFinalInput] : [learn, set];
}

export function useReducedMotion(): boolean {
  const pres = usePresentation();
  const learn = useApp((s) => s.reducedMotion);
  return pres ? pres.reducedMotion : learn;
}
