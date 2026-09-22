/**
 * Wafer map: a pass/fail result for every die, from real process runs.
 *
 * Dies differ in three ways: the local resist thickness (radial spin-coat profile), the local
 * overlay (a small wafer-scale magnification term added to the learner's offset) and
 * particles (if the clean was skipped). Dies that share the same (quantised) thickness and
 * overlay share one full simulation of the die, so every verdict comes from the same model
 * that drives the 3D view. The yield number is a toy: it is not predictive of real fabs.
 */

import { DIES, INCOMING_PARTICLES, overlayFromMagnification, particleKills, radialThickness, YOUR_DIE } from './dies';
import type { CauseId } from './diagnose';
import type { Engine } from './engine';
import { spinModel } from './flow';
import type { Choices, DieContext } from './types';

export type DieVerdict = 'pass' | 'fail' | 'edge';

export interface DieResult {
  id: number;
  verdict: DieVerdict;
  cause: CauseId | 'edge';
  thicknessMul: number;
  overlay: number;
}

export interface WaferMapResult {
  dies: DieResult[];
  tested: number;
  passed: number;
  yieldPct: number;
  /** How many full simulations were run (buckets). */
  runs: number;
  byCause: Partial<Record<CauseId, number>>;
  yourDie: DieResult;
}

const q = (v: number, step: number) => Math.round(v / step) * step;

export function dieContext(dieId: number, c: Choices): DieContext {
  const d = DIES[dieId];
  const sp = spinModel(c.spin);
  return {
    thicknessMul: q(radialThickness(d.r, sp.edgeRise), 0.02),
    overlayExtra: q(overlayFromMagnification(d.x), 0.5),
  };
}

export function computeWaferMap(engine: Engine, c: Choices): WaferMapResult {
  const killed = new Set<number>();
  if (!c.clean) {
    for (const p of INCOMING_PARTICLES) {
      const k = particleKills(p);
      if (k.kills && k.die) killed.add(k.die.id);
    }
  }
  const bucket = new Map<string, { pass: boolean; cause: CauseId }>();
  let runs = 0;
  const results: DieResult[] = DIES.map((d) => {
    const ctx = dieContext(d.id, c);
    const overlay = c.overlay + ctx.overlayExtra;
    if (!d.full) return { id: d.id, verdict: 'edge', cause: 'edge', thicknessMul: ctx.thicknessMul, overlay };
    const key = `${ctx.thicknessMul.toFixed(2)}|${ctx.overlayExtra.toFixed(1)}`;
    let v = bucket.get(key);
    if (!v) {
      const dg = engine.diagnosis(c, ctx);
      v = { pass: dg.pass, cause: dg.cause };
      bucket.set(key, v);
      runs++;
    }
    if (killed.has(d.id)) return { id: d.id, verdict: 'fail', cause: 'particle', thicknessMul: ctx.thicknessMul, overlay };
    return { id: d.id, verdict: v.pass ? 'pass' : 'fail', cause: v.cause, thicknessMul: ctx.thicknessMul, overlay };
  });
  const tested = results.filter((r) => r.verdict !== 'edge').length;
  const passed = results.filter((r) => r.verdict === 'pass').length;
  const byCause: Partial<Record<CauseId, number>> = {};
  for (const r of results) if (r.verdict === 'fail') byCause[r.cause as CauseId] = (byCause[r.cause as CauseId] ?? 0) + 1;
  return {
    dies: results,
    tested,
    passed,
    yieldPct: tested ? (passed / tested) * 100 : 0,
    runs,
    byCause,
    yourDie: results[YOUR_DIE],
  };
}
