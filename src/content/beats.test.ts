import { describe, expect, test } from 'vitest';
import { FLOW } from '../sim/flow';
import { DEFAULT_CHOICES } from '../sim/types';
import { beatIndexAt, beatText, BEATS } from './beats';

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const runs = [
  { choices: DEFAULT_CHOICES, pass: true },
  { choices: { ...DEFAULT_CHOICES, clean: false }, pass: false },
];

describe('beats', () => {
  test('every step has captions, in order, starting at the beginning', () => {
    for (const f of FLOW) {
      const list = BEATS[f.id];
      expect(list.length, f.id).toBeGreaterThan(0);
      expect(list[0].p, f.id).toBe(0);
      for (let i = 1; i < list.length; i++) expect(list[i].p, f.id).toBeGreaterThan(list[i - 1].p);
      expect(list[list.length - 1].p, f.id).toBeLessThan(1);
    }
  });

  test('each caption is one short idea: 12 to 24 words', () => {
    for (const f of FLOW)
      for (const b of BEATS[f.id])
        for (const run of runs) {
          const t = beatText(b, run);
          const n = words(t);
          expect(n, `${f.id}: “${t}”`).toBeGreaterThanOrEqual(12);
          expect(n, `${f.id}: “${t}”`).toBeLessThanOrEqual(24);
        }
  });

  test('the caption on screen follows progress', () => {
    expect(beatIndexAt('coat', 0)).toBe(0);
    expect(beatIndexAt('coat', 0.5)).toBe(1);
    expect(beatIndexAt('coat', 1)).toBe(BEATS.coat.length - 1);
  });
});
