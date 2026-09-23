import { describe, expect, it } from 'vitest';
import { STEPS } from '../../content/steps';
import { BRIDGED } from '../tools';
import { FORK_Z, makeFrame, ROUTES, spinProfile, transfer } from '../tools/trackMotion';
import { handoverAt, type Leg } from './flights';
import { initialTier } from './quality';
import { evalTrack, makeSample } from './tracks';
import type { Key } from '../../content/shots';

const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('track: one wafer, carried', () => {
  it('each lesson on the track starts where the previous one left the wafer and the robot', () => {
    for (const pair of BRIDGED) {
      const [a, b] = pair.split('>');
      const ra = ROUTES[a as keyof typeof ROUTES];
      const rb = ROUTES[b as keyof typeof ROUTES];
      if (!ra || !rb) continue;
      const end = transfer(ra, 1, makeFrame());
      const start = transfer(rb, 0, makeFrame());
      expect(dist(end.wafer, start.wafer), `${pair}: the wafer`).toBeLessThan(1e-9);
      expect(Math.abs(end.x - start.x), `${pair}: the robot`).toBeLessThan(1e-9);
      expect(end.forkZ).toBe(FORK_Z);
      expect(start.forkZ).toBe(FORK_Z);
      for (const m of ['bake', 'coat', 'develop', 'prime'] as const) {
        expect(end.lift[m]).toBe(0);
        expect(start.lift[m]).toBe(0);
      }
    }
  });

  it('the wafer never moves faster than a robot plausibly carries it (no jumps)', () => {
    for (const [id, r] of Object.entries(ROUTES)) {
      const dur = STEPS[id as keyof typeof STEPS].duration;
      const dp = 1 / (30 * dur); // one frame at 30 fps
      const f = makeFrame();
      let prev = transfer(r!, 0, f).wafer.slice();
      let worst = 0;
      for (let p = dp; p <= r!.window + 2 * dp; p += dp) {
        const w = transfer(r!, p, f).wafer.slice();
        worst = Math.max(worst, dist(prev, w));
        prev = w;
      }
      // metres per 1/30 s: 0.09 m is 2.7 m/s at the very peak of the fastest carry
      expect(worst, `${id}: fastest wafer step per frame`).toBeLessThan(0.09);
    }
  });

  it('spins stop on a whole number of turns, with the speed nudged by a few per cent at most', () => {
    for (const w of [5, 5 + 7 * 0.45, 5 + 7 * 3, 10]) {
      const f = spinProfile(0.31, 0.39, 0.84, 0.97, w, 12);
      const turns = f(1) / (2 * Math.PI);
      expect(Math.abs(turns - Math.round(turns))).toBeLessThan(1e-9);
      // the nominal spin would have turned this far
      const nominal = f(1);
      const total = 12 * ((0.39 - 0.31) / 2 + (0.84 - 0.39) + (0.97 - 0.84) / 2) * w;
      expect(Math.abs(nominal - total) / total).toBeLessThan(0.08);
    }
  });
});

describe('camera tracks', () => {
  const sec: Key['cam'] = { kind: 'device', framing: 'section' };
  const top: Key['cam'] = { kind: 'device', framing: 'top' };
  const wide: Key['cam'] = { kind: 'device', framing: 'wide' };
  const at = (track: Key[], p: number) => {
    const s = makeSample();
    evalTrack(track, p, { station: null }, s);
    return s.a.pos.toArray();
  };

  it('a run of moves passes through its middle framing on time, without stopping', () => {
    const track: Key[] = [
      { p: 0, cam: sec },
      { p: 0.4, cam: top },
      { p: 0.8, cam: wide },
    ];
    const mid = at(track, 0.4);
    const topPose = at([{ p: 0, cam: top }], 0.5);
    expect(dist(mid, topPose)).toBeLessThan(1e-6);
    const h = 1e-4;
    const vIn = dist(at(track, 0.4 - h), mid) / h;
    const vOut = dist(mid, at(track, 0.4 + h)) / h;
    expect(vIn).toBeGreaterThan(0.5); // still moving at the key
    expect(Math.abs(vIn - vOut) / vIn).toBeLessThan(0.02); // velocity continuous
    // and it starts and ends at rest
    expect(dist(at(track, 0), at(track, h)) / h).toBeLessThan(0.05);
    expect(dist(at(track, 0.8 - h), at(track, 0.8)) / h).toBeLessThan(0.05);
  });

  it('two keys with the same framing hold it', () => {
    const track: Key[] = [
      { p: 0, cam: sec },
      { p: 0.5, cam: sec },
      { p: 0.8, cam: top },
    ];
    expect(dist(at(track, 0.1), at(track, 0.45))).toBeLessThan(1e-9);
    // the move after a hold starts from rest
    const h = 1e-4;
    expect(dist(at(track, 0.5), at(track, 0.5 + h)) / h).toBeLessThan(0.05);
  });
});

describe('hand-over and quality', () => {
  it('the wafer changes hands halfway along the first move between machines', () => {
    const leg = (dur: number, between = false): Leg => ({ dur, between, eval: () => {} });
    expect(handoverAt([leg(1.1), leg(2, true), leg(0.35), leg(1)])).toBeCloseTo(2.1);
    expect(handoverAt([leg(1), leg(1)])).toBeCloseTo(1);
  });

  it('the starting tier follows what the device says about itself', () => {
    expect(initialTier('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))', 8, 16, false, 1)).toBe('low');
    expect(initialTier('Apple GPU', 6, undefined, true, 3)).toBe('medium');
    expect(initialTier('ANGLE (NVIDIA GeForce RTX 3060)', 12, 16, false, 1)).toBe('high');
    expect(initialTier('Mali-G52', 2, 2, true, 2)).toBe('low');
  });
});
