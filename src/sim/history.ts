/**
 * Operation history and deterministic replay.
 *
 * A Plan is the full list of micro-operations for a set of choices (and die context).
 * Every prefix of a plan has a content hash, so two plans that share their first N ops
 * (e.g. the same flow with a different overlay offset later on) share cached states.
 * `stateAt(plan, n)` returns the state after the first n ops by replaying forward from the
 * nearest cached checkpoint; the result never depends on what was computed before.
 */

import { FLOW, type StepId } from './flow';
import { applyOp, cloneState, initialState, opKey, type Op } from './ops';
import { hashString } from './rng';
import { CENTER_DIE, type Choices, type DieContext, type SimState } from './types';

export interface PlanStep {
  index: number;
  id: StepId;
  /** Op range [start, end) belonging to this step. */
  start: number;
  end: number;
}

export interface Plan {
  ops: Op[];
  /** prefix[n] identifies the state after the first n ops. */
  prefix: string[];
  steps: PlanStep[];
}

export function buildPlan(choices: Choices, die: DieContext = CENTER_DIE): Plan {
  const ops: Op[] = [];
  const steps: PlanStep[] = [];
  FLOW.forEach((s, index) => {
    const start = ops.length;
    ops.push(...s.ops(choices, die));
    steps.push({ index, id: s.id, start, end: ops.length });
  });
  const prefix: string[] = ['∅'];
  for (let i = 0; i < ops.length; i++) prefix.push(hashString(prefix[i] + '|' + opKey(ops[i])));
  return { ops, prefix, steps };
}

/** Number of ops applied when `progress` (0..1) of a step's animation has played. */
export function opCountAt(plan: Plan, stepIndex: number, progress: number, at?: number[]): number {
  const st = plan.steps[stepIndex];
  const n = st.end - st.start;
  if (n === 0) return st.start;
  if (progress >= 1) return st.end;
  if (progress <= 0) return st.start;
  // Ops apply at evenly spaced moments by default, or at the step's own reveal times.
  let applied = 0;
  for (let k = 0; k < n; k++) {
    const t = at?.[k] ?? (k + 1) / (n + 1);
    if (progress >= t) applied = k + 1;
  }
  return st.start + applied;
}

export class Replayer {
  private cache = new Map<string, SimState>();
  private readonly capacity: number;
  hits = 0;
  misses = 0;

  constructor(capacity = 64) {
    this.capacity = capacity;
  }

  private put(key: string, s: SimState): void {
    if (this.cache.has(key)) this.cache.delete(key);
    this.cache.set(key, s);
    while (this.cache.size > this.capacity) {
      const oldest = this.cache.keys().next().value as string;
      this.cache.delete(oldest);
    }
  }

  private get(key: string): SimState | undefined {
    const s = this.cache.get(key);
    if (s) {
      // refresh LRU position
      this.cache.delete(key);
      this.cache.set(key, s);
    }
    return s;
  }

  /**
   * State after the first `n` ops of `plan`. The returned object is shared with the cache:
   * treat it as read-only.
   */
  stateAt(plan: Plan, n: number): SimState {
    n = Math.max(0, Math.min(plan.ops.length, n));
    const exact = this.get(plan.prefix[n]);
    if (exact) {
      this.hits++;
      return exact;
    }
    this.misses++;
    let m = n;
    let from: SimState | undefined;
    while (m > 0) {
      from = this.cache.get(plan.prefix[m]);
      if (from) break;
      m--;
    }
    const s = from ? cloneState(from) : initialState();
    const boundaries = new Set(plan.steps.map((st) => st.end));
    for (let i = m; i < n; i++) {
      applyOp(s, plan.ops[i]);
      const k = i + 1;
      if (k < n && boundaries.has(k) && !this.cache.has(plan.prefix[k])) this.put(plan.prefix[k], cloneState(s));
    }
    this.put(plan.prefix[n], s);
    return s;
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

/** Replay a plan from scratch without any cache (reference for determinism tests). */
export function replayFresh(plan: Plan, n: number): SimState {
  const s = initialState();
  for (let i = 0; i < n; i++) applyOp(s, plan.ops[i]);
  return s;
}
