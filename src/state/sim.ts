/**
 * React bindings for the process model: the engine singleton and hooks that select the
 * simulated state for the current step and animation progress.
 */
import { useMemo, useSyncExternalStore } from 'react';
import { STEPS, type StepContent } from '../content/steps';
import { Engine } from '../sim/engine';
import { FLOW, type StepId } from '../sim/flow';
import { opCountAt, type Plan } from '../sim/history';
import type { Choices, SimState } from '../sim/types';
import { waferMaps } from '../sim/waferMapClient';
import type { WaferMapResult } from '../sim/waferMap';
import { useApp, useClock } from './store';

export const engine = new Engine(80);

export function useStep(): { index: number; id: StepId; content: StepContent } {
  const index = useApp((s) => s.step);
  const id = FLOW[index].id;
  return { index, id, content: STEPS[id] };
}

export function usePlan(): Plan {
  const choices = useApp((s) => s.choices);
  return useMemo(() => engine.plan(choices), [choices]);
}

/** Number of micro-operations applied at the current animation progress. */
export function useOpCount(): number {
  const plan = usePlan();
  const step = useApp((s) => s.step);
  const at = STEPS[FLOW[step].id].at;
  return useClock((c) => opCountAt(plan, step, c.progress, at));
}

/** The simulated state at the current step and animation progress. */
export function useSimState(): SimState {
  const plan = usePlan();
  const n = useOpCount();
  return useMemo(() => engine.replayer.stateAt(plan, n), [plan, n]);
}

export function useStateAtStepEnd(stepIndex: number): SimState {
  const plan = usePlan();
  return useMemo(() => engine.replayer.stateAt(plan, plan.steps[stepIndex].end), [plan, stepIndex]);
}

export function useStateAtStepStart(stepIndex: number): SimState {
  const plan = usePlan();
  return useMemo(() => engine.replayer.stateAt(plan, plan.steps[stepIndex].start), [plan, stepIndex]);
}

/** Key identifying the current simulated state (changes only when geometry changes). */
export function useStateKey(): string {
  const plan = usePlan();
  const n = useOpCount();
  return plan.prefix[n];
}

export function useWaferMap(choices: Choices, enabled = true): WaferMapResult | undefined {
  const sub = useMemo(() => (fn: () => void) => waferMaps.subscribe(fn), []);
  const res = useSyncExternalStore(sub, () => waferMaps.get(choices));
  if (enabled && !res) waferMaps.request(choices);
  return res;
}

export function useStepById(id: StepId): number {
  return FLOW.findIndex((s) => s.id === id);
}
