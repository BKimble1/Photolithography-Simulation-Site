/**
 * Facade used by the UI: one Replayer, memoised plans, and cached derived results
 * (electrical test, metrology, diagnosis) keyed by the plan prefix they depend on.
 */

import { diagnose, type Diagnosis } from './diagnose';
import { extract, type ElectricalResult } from './electrical';
import { STEP_INDEX, spinModel, type StepId } from './flow';
import { buildPlan, opCountAt, Replayer, type Plan } from './history';
import {
  contactGateTouches,
  measureContactOverlay,
  measurePolyGates,
  measureResistGates,
  resistResidue,
  type GateMetrology,
  type OverlayMeasurement,
} from './metrology';
import { RESIST_RECIPES } from './ops';
import { CENTER_DIE, type Choices, type DieContext, type SimState } from './types';

export function choicesKey(c: Choices, die: DieContext = CENTER_DIE): string {
  return `${c.clean ? 1 : 0}|${c.spin.toFixed(3)}|${c.dose}|${c.overlay}|${c.gateReworks}|${c.contactReworks}|${die.thicknessMul.toFixed(3)}|${die.overlayExtra.toFixed(3)}`;
}

export class Engine {
  readonly replayer: Replayer;
  private plans = new Map<string, Plan>();
  private derived = new Map<string, unknown>();

  constructor(capacity = 72) {
    this.replayer = new Replayer(capacity);
  }

  plan(c: Choices, die: DieContext = CENTER_DIE): Plan {
    const key = choicesKey(c, die);
    let p = this.plans.get(key);
    if (!p) {
      p = buildPlan(c, die);
      this.plans.set(key, p);
      if (this.plans.size > 40) this.plans.delete(this.plans.keys().next().value as string);
    }
    return p;
  }

  /** State at a step and animation progress (0 = step start, 1 = step end). */
  stateAt(c: Choices, stepIndex: number, progress: number, at?: number[]): SimState {
    const p = this.plan(c);
    return this.replayer.stateAt(p, opCountAt(p, stepIndex, progress, at));
  }

  stepStart(c: Choices, stepIndex: number): SimState {
    const p = this.plan(c);
    return this.replayer.stateAt(p, p.steps[stepIndex].start);
  }

  stepEnd(c: Choices, stepIndex: number, die: DieContext = CENTER_DIE): SimState {
    const p = this.plan(c, die);
    return this.replayer.stateAt(p, p.steps[stepIndex].end);
  }

  after(c: Choices, id: StepId, die: DieContext = CENTER_DIE): SimState {
    return this.stepEnd(c, STEP_INDEX[id], die);
  }

  private memo<T>(key: string, fn: () => T): T {
    if (this.derived.has(key)) return this.derived.get(key) as T;
    const v = fn();
    this.derived.set(key, v);
    if (this.derived.size > 400) this.derived.delete(this.derived.keys().next().value as string);
    return v;
  }

  /** Electrical test of the finished die (after passivation). */
  electrical(c: Choices, die: DieContext = CENTER_DIE): ElectricalResult {
    const p = this.plan(c, die);
    const end = p.steps[STEP_INDEX.passivate].end;
    return this.memo('elec:' + p.prefix[end], () => extract(this.replayer.stateAt(p, end).grid));
  }

  resistGates(c: Choices, die: DieContext = CENTER_DIE): GateMetrology {
    const p = this.plan(c, die);
    const end = p.steps[STEP_INDEX.develop].end;
    const s = this.replayer.stateAt(p, end);
    const tRef = RESIST_RECIPES.fine.t * spinModel(c.spin).tRel * die.thicknessMul * 0.96;
    return this.memo('rg:' + p.prefix[end], () => measureResistGates(s.grid, tRef));
  }

  resistResidue(c: Choices, die: DieContext = CENTER_DIE): number {
    const p = this.plan(c, die);
    const end = p.steps[STEP_INDEX.develop].end;
    return this.memo('rr:' + p.prefix[end], () => resistResidue(this.replayer.stateAt(p, end).grid));
  }

  polyGates(c: Choices, die: DieContext = CENTER_DIE): GateMetrology {
    const p = this.plan(c, die);
    const end = p.steps[STEP_INDEX['gate-etch']].end;
    return this.memo('pg:' + p.prefix[end], () => measurePolyGates(this.replayer.stateAt(p, end).grid));
  }

  contactOverlay(c: Choices, die: DieContext = CENTER_DIE): OverlayMeasurement {
    const p = this.plan(c, die);
    const end = p.steps[STEP_INDEX['contact-print']].end;
    return this.memo('ov:' + p.prefix[end], () => measureContactOverlay(this.replayer.stateAt(p, end).grid));
  }

  contactTouches(c: Choices, die: DieContext = CENTER_DIE) {
    const p = this.plan(c, die);
    const end = p.steps[STEP_INDEX['contact-fill']].end;
    return this.memo('ct:' + p.prefix[end], () => contactGateTouches(this.replayer.stateAt(p, end).grid));
  }

  diagnosis(c: Choices, die: DieContext = CENTER_DIE): Diagnosis {
    return diagnose({
      touching: this.contactTouches(c, die),
      electrical: this.electrical(c, die),
      gate: this.polyGates(c, die),
      resistResidue: this.resistResidue(c, die),
      overlay: this.contactOverlay(c, die),
      choices: c,
    });
  }
}
