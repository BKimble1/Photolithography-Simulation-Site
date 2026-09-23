/**
 * The fab explorer's demonstrations: a machine's representative lesson, played on the
 * canonical successful run by a local preview clock. Nothing here touches the learning run.
 */
import { create } from 'zustand';
import { DEMO_STEP } from '../content/machines';
import { STEP_INDEX } from '../sim/flow';
import type { MachineId } from './nav';
import type { ProgressSource } from './presentation';

export interface DemoState {
  machine: MachineId | null;
  stepIndex: number;
  progress: number;
  playing: boolean;
  /** Seconds left to hold on the finished frame before the demonstration loops. */
  hold: number;
  start: (id: MachineId) => void;
  stop: () => void;
  toggle: () => void;
  set: (p: number) => void;
}

export const useDemo = create<DemoState>((set, get) => ({
  machine: null,
  stepIndex: 0,
  progress: 0,
  playing: false,
  hold: 0,
  start: (id) => set({ machine: id, stepIndex: STEP_INDEX[DEMO_STEP[id]], progress: 0, playing: true, hold: 0 }),
  stop: () => set({ machine: null, playing: false, progress: 0 }),
  toggle: () => {
    const s = get();
    set({ playing: !s.playing, progress: s.progress >= 1 ? 0 : s.progress, hold: 0 });
  },
  set: (p) => set({ progress: Math.max(0, Math.min(1, p)), playing: false }),
}));

export const demoProgress: ProgressSource = {
  get: () => useDemo.getState().progress,
  subscribe: (fn) => useDemo.subscribe((s, p) => s.progress !== p.progress && fn()),
};
