import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { FILM } from '../content/film';
import { STEPS } from '../content/steps';
import { STEP_INDEX } from '../sim/flow';
import narration from '../content/narration.json';
import { buildTimeline, cueAt, inputAt, locate, progressOf, type FilmManifest } from './timeline';

const manifest = JSON.parse(readFileSync(`public/narration/${narration.version}/manifest.json`, 'utf8')) as FilmManifest;
const tl = buildTimeline(manifest);

describe('film timeline', () => {
  test('the built narration matches the script and the film definition', () => {
    expect(manifest.version).toBe(narration.version);
    expect(manifest.segments.map((s) => s.id)).toEqual(narration.segments.map((s) => s.id));
    expect(tl.segments.map((s) => s.def.id)).toEqual(FILM.map((f) => f.id));
    for (const seg of manifest.segments) {
      const script = narration.segments.find((s) => s.id === seg.id)!;
      expect(seg.cues.map((c) => c.text)).toEqual(script.cues.map((c) => c.text));
    }
  });

  test('the film runs between ten and fifteen minutes, every step in order', () => {
    expect(tl.duration).toBeGreaterThan(10 * 60 * 0.95);
    expect(tl.duration).toBeLessThan(15 * 60);
    const steps = tl.segments.filter((s) => s.stepIndex !== null).map((s) => s.stepIndex);
    expect(steps).toEqual(steps.slice().sort((a, b) => a! - b!));
    expect(new Set(steps).size).toBe(Object.keys(STEPS).length);
  });

  test('time maps monotonically onto segments and step progress', () => {
    let lastSeg = -1;
    let lastGap = false;
    const lastP = new Map<number, number>();
    for (let t = 0; t <= tl.duration; t += 0.25) {
      const loc = locate(tl, t);
      expect(loc.seg.index * 2 + (loc.inGap ? 1 : 0)).toBeGreaterThanOrEqual(lastSeg * 2 + (lastGap ? 1 : 0));
      lastSeg = loc.seg.index;
      lastGap = loc.inGap;
      for (const s of tl.segments) {
        if (s.stepIndex === null) continue;
        const p = progressOf(tl, s.stepIndex, t);
        expect(p).toBeGreaterThanOrEqual(lastP.get(s.stepIndex) ?? 0);
        expect(p).toBeLessThanOrEqual(1);
        lastP.set(s.stepIndex, p);
      }
    }
    for (const s of tl.segments) if (s.stepIndex !== null) expect(progressOf(tl, s.stepIndex, tl.duration)).toBe(1);
  });

  test('process changes happen while the sentence describing them is spoken', () => {
    const during = (stepId: keyof typeof STEP_INDEX, opP: number, cueId: string) => {
      const seg = tl.segments.find((s) => s.def.id === stepId)!;
      const cue = seg.cues.find((c) => c.id === cueId)!;
      // film time at which the step reaches the op's progress
      let t = seg.start;
      while (progressOf(tl, STEP_INDEX[stepId], t) < opP && t < seg.start + seg.dur) t += 0.01;
      expect(t, `${stepId} @${opP} vs “${cue.text}”`).toBeGreaterThanOrEqual(cue.start);
      expect(t, `${stepId} @${opP} vs “${cue.text}”`).toBeLessThanOrEqual(cue.end);
    };
    during('develop', STEPS.develop.at![0], 'dissolve');
    during('expose', STEPS.expose.at![0], 'latent');
    during('gate-etch', STEPS['gate-etch'].at![0], 'carve');
    during('coat', STEPS.coat.at![0], 'rim');
    during('strip', STEPS.strip.at![0], 'ash');
    during('scan', STEPS.scan.at?.[0] ?? 0.5, 'map');
  });

  test('captions follow the narration and the final switch flips on cue', () => {
    const seg = tl.segments.find((s) => s.def.id === 'develop')!;
    const cue = seg.cues[1];
    expect(cueAt(tl, (cue.start + cue.end) / 2)?.text).toBe(cue.text);
    const fin = tl.segments.find((s) => s.def.id === 'final')!;
    const low = fin.cues.find((c) => c.id === 'low')!;
    const high = fin.cues.find((c) => c.id === 'high')!;
    expect(inputAt(tl, low.start + 0.5)).toBe(0);
    expect(inputAt(tl, high.start + 0.5)).toBe(1);
  });
});
