/**
 * React bindings for the process model: the engine singleton and hooks that select the
 * simulated state for the presented step and progress. Inside the 3D stage these read the
 * active presentation (Learn, Watch or an Explore demonstration); in the DOM UI they read the
 * learning run.
 */
import { useMemo, useSyncExternalStore } from 'react';
import { STEPS, type StepContent } from '../content/steps';
import { Engine } from '../sim/engine';
import { FLOW, type StepId } from '../sim/flow';
import { opCountAt, type Plan } from '../sim/history';
import type { Choices, SimState } from '../sim/types';
import { waferMaps } from '../sim/waferMapClient';
import type { WaferMapResult } from '../sim/waferMap';
import { usePresentation, useProgressSource, useRunChoices } from './presentation';
import { useApp } from './store';

export const engine = new Engine(96);

export function useStep(): { index: number; id: StepId; content: StepContent } {
  const pres = usePresentation();
  const learnIndex = useApp((s) => s.step);
  const index = pres ? pres.stepIndex : learnIndex;
  const id = FLOW[index].id;
  return { index, id, content: STEPS[id] };
}

export function usePlan(): Plan {
  const choices = useRunChoices();
  return useMemo(() => engine.plan(choices), [choices]);
}

/** Number of micro-operations applied at the current progress of the presented step. */
export function useOpCount(): number {
  const plan = usePlan();
  const { index } = useStep();
  const at = STEPS[FLOW[index].id].at;
  const src = useProgressSource();
  const get = () => opCountAt(plan, index, src.get(), at);
  return useSyncExternalStore(src.subscribe, get, get);
}

/** The simulated state at the presented step and progress. */
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
