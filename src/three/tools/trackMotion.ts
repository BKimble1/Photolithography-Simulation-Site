/**
 * The coater/developer track's transfer robot, as pure functions of lesson progress (no
 * rendering here, so the continuity of each hand-over can be tested): where the robot, its
 * fork, the chucks and lift pins, and the learner's wafer are at progress p of each lesson.
 * See Track.tsx.
 */
import type { StepId } from '../../sim/flow';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const seg = (p: number, a: number, b: number) => clamp01((p - a) / (b - a));
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * A robot axis move: constant acceleration over the first quarter, cruise, constant
 * deceleration over the last quarter (a trapezoidal velocity profile, as axis controllers
 * run). Its peak speed is 4/3 of the average, where a cubic ease-in-out peaks at 3×.
 */
export function trapezoid(t: number, a = 0.25): number {
  const x = clamp01(t);
  const v = 1 / (1 - a);
  if (x < a) return (v * x * x) / (2 * a);
  if (x > 1 - a) return 1 - (v * (1 - x) * (1 - x)) / (2 * a);
  return v * (a / 2 + (x - a));
}

export const MOD_X = { bake: -0.7, coat: 0, develop: 0.7, prime: 1.4 } as const;
export type Mod = keyof typeof MOD_X;
export const DECK_Y = 0.88;
/** The carrier block (wafers come out of their pod here) and the scanner interface block. */
export const CARRIER_X = 1.95;
export const IFACE_X = -1.15;
/** Wafer centre on the retracted fork: the robot runs along the front of the modules. */
export const FORK_Z = 0.3;
/** Wafer height at rest: on a hot plate's proximity pins, or on a spin chuck in its cup. */
export const REST: Record<Mod, number> = { bake: DECK_Y + 0.031, prime: DECK_Y + 0.031, coat: DECK_Y + 0.052, develop: DECK_Y + 0.052 };
/** Wafer height for an exchange: lifted on pins, or the chuck raised above the cup's rim. */
export const XCHG: Record<Mod, number> = { bake: REST.bake + 0.014, prime: REST.prime + 0.014, coat: REST.coat + 0.075, develop: REST.develop + 0.075 };

/** Where a lesson's wafer comes from and which module it is processed in. */
export interface Route {
  /** Where the robot waits at the start (where the previous lesson here parked it). */
  start: number;
  /** x of the source: a module (the wafer lies there) or an end block (it arrives on the fork). */
  from: number;
  fromMod: Mod | null;
  to: Mod;
  /** Where the robot parks after placing the wafer (clear of the module's view). */
  park: number;
  /** Share of the lesson the transfer takes. */
  window: number;
}

/** After placing, the robot backs off to the side, out of the camera's way. */
const parkBy = (m: Mod) => MOD_X[m] - 0.42;

export const ROUTES: Partial<Record<StepId, Route>> = {
  prime: { start: CARRIER_X, from: CARRIER_X, fromMod: null, to: 'prime', park: parkBy('prime'), window: 0.16 },
  coat: { start: parkBy('prime'), from: MOD_X.prime, fromMod: 'prime', to: 'coat', park: parkBy('coat'), window: 0.2 },
  softbake: { start: parkBy('coat'), from: MOD_X.coat, fromMod: 'coat', to: 'bake', park: parkBy('bake'), window: 0.26 },
  peb: { start: IFACE_X, from: IFACE_X, fromMod: null, to: 'bake', park: parkBy('bake'), window: 0.14 },
  develop: { start: parkBy('bake'), from: MOD_X.bake, fromMod: 'bake', to: 'develop', park: parkBy('develop'), window: 0.22 },
};

const ramp = (u: number, a: number, b: number) => ease(seg(u, a, b));
/** A robot axis moving over [a, b] of the transfer (trapezoidal velocity). */
const axis = (u: number, a: number, b: number) => trapezoid(seg(u, a, b));

/**
 * The robot and wafer at progress p of a lesson: carriage x, fork reach (z) and height, where
 * the wafer is, and how far each module's chuck or pins are raised for the exchange.
 */
export interface XferFrame {
  x: number;
  forkZ: number;
  forkY: number;
  /** Wafer centre (bottom face) in the tool frame. */
  wafer: [number, number, number];
  onFork: boolean;
  lift: Record<Mod, number>;
}

export function transfer(r: Route, p: number, out: XferFrame): XferFrame {
  const u = seg(p, 0, r.window);
  const dst = r.to;
  const lift = out.lift;
  lift.bake = lift.coat = lift.develop = lift.prime = 0;
  // (backing off to park may run on past the transfer's share of the lesson: the robot is
  // only leaving, and squeezed into the last tenth it would dash off at several metres a second)
  const park = trapezoid(seg(p / r.window, 0.9, 1.2));
  if (r.fromMod) {
    const src = r.fromMod;
    // approach; pick: raise the wafer, slide the fork under it, lift it off, withdraw. The
    // chuck or pins rise while the robot approaches and go down as soon as the fork holds the
    // wafer, each an axis move of its own (a spin chuck's 75 mm would otherwise be a jerk)
    const approach = trapezoid(seg(u, 0, 0.12));
    lift[src] = axis(u, 0, 0.12) * (1 - axis(u, 0.3, 0.5));
    const reach1 = axis(u, 0.12, 0.21) * (1 - axis(u, 0.26, 0.34));
    const take = ramp(u, 0.21, 0.26);
    // carry (the fork's height follows to the next exchange height), then place; the chuck
    // goes down once the fork is out from under the wafer
    const go = trapezoid(seg(u, 0.34, 0.68));
    lift[dst] = axis(u, 0.4, 0.66) * (1 - axis(u, 0.87, 1));
    const reach2 = axis(u, 0.68, 0.77) * (1 - axis(u, 0.82, 0.9));
    const put = ramp(u, 0.77, 0.82);
    out.x = u < 0.34 ? lerp(r.start, r.from, approach) : u < 0.9 ? lerp(r.from, MOD_X[dst], go) : lerp(MOD_X[dst], r.park, park);
    out.forkZ = lerp(FORK_Z, 0, Math.max(reach1, reach2));
    const ySrc = XCHG[src] - 0.006 + 0.008 * take;
    const yDst = XCHG[dst] + 0.002 - 0.008 * put;
    out.forkY = u < 0.34 ? ySrc : u < 0.68 ? lerp(ySrc, XCHG[dst] + 0.002, go) : yDst;
    // the wafer changes hands where the rising fork reaches the chuck's height, and again where
    // the lowering fork comes down to the next chuck's: never a step in its path
    const picked = u >= 0.21 && (u >= 0.34 || ySrc >= XCHG[src]);
    const placed = u >= 0.77 && yDst <= XCHG[dst];
    out.onFork = picked && !placed;
    if (!picked) out.wafer = [MOD_X[src], lerp(REST[src], XCHG[src], lift[src]), 0];
    else if (out.onFork) out.wafer = [out.x, out.forkY, out.forkZ];
    else out.wafer = [MOD_X[dst], lerp(REST[dst], XCHG[dst], lift[dst]), 0];
  } else {
    // the wafer arrives on the fork from the carrier block or the scanner interface
    const go = trapezoid(seg(u, 0, 0.42));
    lift[dst] = axis(u, 0.2, 0.38) * (1 - axis(u, 0.8, 0.95));
    const reach = axis(u, 0.42, 0.58) * (1 - axis(u, 0.66, 0.8));
    const put = ramp(u, 0.58, 0.66);
    out.x = u < 0.9 ? lerp(r.from, MOD_X[dst], go) : lerp(MOD_X[dst], r.park, park);
    out.forkZ = lerp(FORK_Z, 0, reach);
    out.forkY = XCHG[dst] + 0.002 - 0.008 * put;
    out.onFork = !(u >= 0.58 && out.forkY <= XCHG[dst]);
    out.wafer = out.onFork ? [out.x, out.forkY, out.forkZ] : [MOD_X[dst], lerp(REST[dst], XCHG[dst], lift[dst]), 0];
  }
  return out;
}

export const makeFrame = (): XferFrame => ({ x: 0, forkZ: FORK_Z, forkY: DECK_Y + 0.06, wafer: [0, 0, 0], onFork: false, lift: { bake: 0, coat: 0, develop: 0, prime: 0 } });

/**
 * A spin profile (ramp up, hold, ramp down) as an angle at progress p, integrated analytically
 * (time in seconds = p·dur). The top speed is nudged (by less than a few per cent) so the
 * spin stops on a whole number of turns: the robot then picks the wafer up exactly as it lay
 * before the spin, and the next lesson starts from the same picture.
 */
export function spinProfile(up0: number, up1: number, down0: number, down1: number, w: number, dur: number) {
  const a0 = up0 * dur,
    a1 = up1 * dur,
    b0 = down0 * dur,
    b1 = down1 * dur;
  const total = (a1 - a0) / 2 + (b0 - a1) + (b1 - b0) / 2;
  const turns = Math.max(1, Math.round((w * total) / (Math.PI * 2)));
  const wMax = (turns * Math.PI * 2) / total;
  return (p: number) => {
    const t = p * dur;
    let ang = 0;
    if (t > a0) ang += ((Math.min(t, a1) - a0) ** 2 / (2 * (a1 - a0))) * wMax;
    if (t > a1) ang += (Math.min(t, b0) - a1) * wMax;
    if (t > b0) {
      const tt = Math.min(t, b1) - b0;
      ang += wMax * tt - (tt * tt * wMax) / (2 * (b1 - b0));
    }
    return ang;
  };
}

