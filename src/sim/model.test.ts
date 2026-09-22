import { describe, expect, it } from 'vitest';
import { Engine } from './engine';
import { extract } from './electrical';
import { STEP_INDEX } from './flow';
import { buildPlan, opCountAt, replayFresh, Replayer } from './history';
import { M, RES } from './materials';
import { applyOp, cloneState, ETCH, initialState, type Op } from './ops';
import { thicknessProfile } from './metrology';
import { computeWaferMap } from './waferMap';
import { DEFAULT_CHOICES, type Choices } from './types';
import { FULL_DIE_COUNT, INCOMING_PARTICLES, particleKills } from './dies';
import { LAYOUT } from './layout';

const engine = new Engine(120);
const choices = (c: Partial<Choices> = {}): Choices => ({ ...DEFAULT_CHOICES, ...c });

/** Build a simple wafer: silicon, oxide and poly, then coat resist. */
function coatedWafer() {
  const s = initialState();
  const ops: Op[] = [
    { kind: 'receive' },
    { kind: 'oxidize', t: 0.5, nm: 3, label: 'Gate oxide' },
    { kind: 'deposit', mat: M.POLY, tag: 0, t: 4, mode: 'conformal', nm: 150, label: 'Poly' },
    { kind: 'prime' },
    { kind: 'coat', recipe: 'fine', tRel: 1, edgeRise: 0.015, mask: 'poly', purpose: 'gate' },
    { kind: 'softbake' },
  ];
  for (const op of ops) applyOp(s, op);
  return s;
}

const colAt = (g: ReturnType<typeof initialState>['grid'], x: number, y = 28) => g.col(Math.floor(x / g.dx), Math.floor(y / g.dy));

describe('positive resist', () => {
  it('removes exposed resist on development and keeps unexposed resist', () => {
    const s = coatedWafer();
    applyOp(s, { kind: 'expose', mask: 'poly', recipe: 'fine', doseRel: 1, dx: 0, dy: 0 });
    // Exposure changes resist chemistry only: the stack heights are untouched.
    const g = s.grid;
    const underGate = colAt(g, 25); // under chrome (gate line)
    const open = colAt(g, 16); // clear area over the source
    expect(g.topMat(open)).toBe(M.RES);
    expect(g.dose[open]).toBeGreaterThan(g.dose[underGate] * 10);
    applyOp(s, { kind: 'peb' });
    applyOp(s, { kind: 'develop', recipe: 'fine' });
    expect(g.topMat(open)).toBe(M.POLY); // exposed → dissolved
    expect(g.topMat(underGate)).toBe(M.RES); // unexposed → remains
    expect(g.topTag(underGate)).toBe(RES.DEVELOPED);
  });

  it('exposure never changes anything below the resist', () => {
    const s = coatedWafer();
    const before = cloneState(s);
    applyOp(s, { kind: 'expose', mask: 'poly', recipe: 'fine', doseRel: 2.6, dx: 0, dy: 0 });
    const g = s.grid;
    const b = before.grid;
    for (let c = 0; c < g.columns; c++) {
      expect(g.n[c]).toBe(b.n[c]);
      for (let k = 0; k < g.n[c]; k++) {
        expect(g.mat[c * g.K + k]).toBe(b.mat[c * g.K + k]);
        expect(g.top[c * g.K + k]).toBeCloseTo(b.top[c * g.K + k], 5);
      }
    }
  });
});

describe('lithography before etch', () => {
  it('etching without an opened resist mask removes no polysilicon', () => {
    const s = coatedWafer();
    applyOp(s, { kind: 'etch', recipe: 'gate' });
    const poly = thicknessProfile(s.grid, M.POLY);
    expect(Math.min(...poly)).toBeCloseTo(4, 3);
  });

  it('after develop, the etch removes polysilicon only where resist was removed', () => {
    const s = coatedWafer();
    for (const op of [
      { kind: 'expose', mask: 'poly', recipe: 'fine', doseRel: 1, dx: 0, dy: 0 },
      { kind: 'peb' },
      { kind: 'develop', recipe: 'fine' },
      { kind: 'etch', recipe: 'gate' },
    ] as Op[])
      applyOp(s, op);
    const g = s.grid;
    expect(g.findTop(colAt(g, 16), M.POLY)).toBe(-1); // opened → poly gone
    expect(g.findTop(colAt(g, 25), M.POLY)).toBeGreaterThan(-1); // protected → poly remains
    expect(ETCH.gate.rates[M.OX]).toBeLessThan(0.05); // etch stops on the gate oxide
    expect(g.topMat(colAt(g, 16))).toBe(M.OX);
  });

  it('in the full flow, develop precedes etch for every patterned layer', () => {
    const plan = buildPlan(DEFAULT_CHOICES);
    let lastDevelop = -1;
    let lastStrip = -1;
    plan.ops.forEach((op, i) => {
      if (op.kind === 'develop') lastDevelop = i;
      if (op.kind === 'etch' || op.kind === 'implant') {
        expect(lastDevelop).toBeGreaterThan(lastStrip); // a fresh developed mask exists
      }
      if (op.kind === 'strip') lastStrip = i;
    });
  });
});

describe('deterministic replay and seek', () => {
  it('cached seeks match a fresh replay at every step boundary', () => {
    const plan = buildPlan(choices({ dose: 3, overlay: 2 }));
    const r = new Replayer(20);
    // seek forward, backward, and out of order
    const order = [30, 5, 18, 36, 12, 19, 0, 25, 36, 7];
    for (const i of order) {
      const n = plan.steps[i].end;
      expect(r.stateAt(plan, n).grid.fingerprint()).toBe(replayFresh(plan, n).grid.fingerprint());
    }
  });

  it('mid-step progress maps to a deterministic op count', () => {
    const plan = buildPlan(DEFAULT_CHOICES);
    const i = STEP_INDEX['sti-etch'];
    const a = opCountAt(plan, i, 0.5);
    const b = opCountAt(plan, i, 0.5);
    expect(a).toBe(b);
    expect(a).toBeGreaterThan(plan.steps[i].start);
    expect(a).toBeLessThan(plan.steps[i].end);
  });

  it('changing a later choice leaves earlier states identical', () => {
    const p1 = buildPlan(choices({ overlay: 0 }));
    const p2 = buildPlan(choices({ overlay: 5 }));
    const k = p1.steps[STEP_INDEX['contact-align']].end;
    expect(p1.prefix[k]).toBe(p2.prefix[k]);
    const later = p1.steps[STEP_INDEX['contact-print']].end;
    expect(p1.prefix[later]).not.toBe(p2.prefix[later]);
  });
});

describe('inverter truth table', () => {
  it('default recipe: IN=0 → OUT=1, IN=1 → OUT=0, low leakage', () => {
    const e = engine.electrical(DEFAULT_CHOICES);
    expect(e.wired).toBe(true);
    expect(e.out).toEqual({ in0: 1, in1: 0 });
    expect(e.shorts).toEqual([]);
    expect(e.iddqOk).toBe(true);
    expect(e.pass).toBe(true);
    const types = e.transistors.map((t) => t.type).sort();
    expect(types).toEqual(['nmos', 'pmos']);
    for (const t of e.transistors) {
      expect(t.gateNet).toBe('IN');
      expect(t.length).toBeCloseTo(6, 0);
    }
  });

  it('is not wired before the second metal level exists', () => {
    const s = engine.after(DEFAULT_CHOICES, 'metal1');
    expect(s.wafer.metalLevels).toBe(1);
    expect(extract(s.grid).wired).toBe(false);
    expect(extract(engine.after(DEFAULT_CHOICES, 'metal2').grid).wired).toBe(true);
  });
});

describe('overlay', () => {
  it('connects within the margin and fails beyond it', () => {
    for (const o of [-3, -1, 0, 2, 3]) expect(engine.electrical(choices({ overlay: o })).pass).toBe(true);
    for (const o of [-5, -4, 4, 6]) {
      const e = engine.electrical(choices({ overlay: o }));
      expect(e.pass).toBe(false);
      expect(e.shorts.some(([a, b]) => a === 'IN' || b === 'IN')).toBe(true);
      expect(engine.diagnosis(choices({ overlay: o })).cause).toBe('overlay');
    }
  });

  it('overlay metrology measures the applied shift from the developed pattern', () => {
    expect(engine.contactOverlay(choices({ overlay: 3 })).dx).toBeCloseTo(3, 1);
    expect(engine.contactOverlay(choices({ overlay: 0 })).inSpec).toBe(true);
    expect(engine.contactOverlay(choices({ overlay: 3 })).inSpec).toBe(false);
  });
});

describe('exposure dose and spin speed', () => {
  it('far under-dose leaves resist and polysilicon behind and shorts the circuit', () => {
    const c = choices({ dose: 0 });
    expect(engine.resistResidue(c)).toBeGreaterThan(1);
    const d = engine.diagnosis(c);
    expect(d.pass).toBe(false);
    expect(d.cause).toBe('residue');
    expect(d.restoreChoice).toBe('dose');
  });

  it('far over-dose shrinks the gates until leakage fails', () => {
    const c = choices({ dose: 4 });
    expect(engine.polyGates(c).worstRel).toBeLessThan(0.8);
    const d = engine.diagnosis(c);
    expect(d.pass).toBe(false);
    expect(d.cause).toBe('short-gate');
  });

  it('more dose never makes the gate lines wider', () => {
    let prev = Infinity;
    for (let d = 0; d < 5; d++) {
      const cd = engine.polyGates(choices({ dose: d })).nmos.cd;
      expect(cd).toBeLessThanOrEqual(prev + 1e-6);
      prev = cd;
    }
  });

  it('nominal gate CD is on target', () => {
    expect(engine.polyGates(DEFAULT_CHOICES).worstRel).toBeGreaterThan(0.95);
    expect(engine.polyGates(DEFAULT_CHOICES).worstRel).toBeLessThan(1.05);
  });

  it('very slow spin fails at the thick wafer edge; very fast spin fails at the centre', () => {
    const slow = choices({ spin: 0 });
    expect(engine.diagnosis(slow).pass).toBe(true);
    const mapSlow = computeWaferMap(engine, slow);
    expect(mapSlow.byCause.residue ?? 0).toBeGreaterThan(0);
    const fast = choices({ spin: 1 });
    expect(engine.diagnosis(fast).cause).toBe('short-gate');
  });
});

describe('wafer map', () => {
  it('default recipe yields every full die', () => {
    const m = computeWaferMap(engine, DEFAULT_CHOICES);
    expect(m.tested).toBe(FULL_DIE_COUNT);
    expect(m.passed).toBe(m.tested);
    expect(m.yourDie.verdict).toBe('pass');
  });

  it('skipping the clean kills exactly the dies hit by killer particles', () => {
    const m = computeWaferMap(engine, choices({ clean: false }));
    const expected = new Set(INCOMING_PARTICLES.map(particleKills).filter((k) => k.kills && k.die).map((k) => k.die!.id));
    expect(expected.size).toBeGreaterThan(0);
    expect(m.byCause.particle).toBe(expected.size);
    expect(m.yourDie.verdict).toBe('pass');
  });

  it('an overlay just inside the margin fails only dies where magnification adds to it', () => {
    const m = computeWaferMap(engine, choices({ overlay: 3 }));
    expect(m.passed).toBeGreaterThan(0);
    expect(m.passed).toBeLessThan(m.tested);
    expect(m.yourDie.verdict).toBe('pass');
  });
});

describe('layout sanity', () => {
  it('contacts sit inside their active areas with the documented margin', () => {
    const c = LAYOUT.contacts.nSource;
    expect(c[0] - LAYOUT.nActive[0]).toBe(4);
    expect(LAYOUT.nGate[0] - c[2]).toBe(4);
  });
});

describe('isolation module', () => {
  it('the nitride strip leaves no nitride anywhere, even at rounded active-area corners', () => {
    const s = engine.stepEnd(DEFAULT_CHOICES, STEP_INDEX['sti-fill']);
    const g = s.grid;
    let nitride = 0;
    for (let c = 0; c < g.columns; c++) for (let k = 0; k < g.n[c]; k++) if (g.mat[c * g.K + k] === M.NIT) nitride++;
    expect(nitride).toBe(0);
  });
});
