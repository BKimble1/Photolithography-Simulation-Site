/**
 * The Watch film, as data: which step each narration segment shows, and how the process
 * advances against the words. The narration text itself lives in content/narration.json (the
 * input of tools/narration); the measured audio timings come from the built manifest.
 *
 * Within a segment the step's progress runs from 0 to 1 over the segment, piecewise linearly
 * through `sync` points: `sync.dissolve = 0.45` means "when the cue 'dissolve' starts, the
 * step is at 45 %". Points are placed a little before each process change (the `at` times in
 * content/steps.ts), so the change happens while the sentence describing it is being spoken.
 *
 * The camera follows the same shot tracks as the lessons (content/shots.ts). Between segments
 * the film inserts silent moves: along the aisle to the next machine, or a short reframe
 * within the same machine.
 */
import type { StepId } from '../sim/flow';

export interface FilmSegment {
  /** The narration segment id (content/narration.json). */
  id: string;
  /** The step shown; null for the opening and closing views of the bay. */
  step: StepId | null;
  /** Step progress at the start of named cues. */
  sync?: Record<string, number>;
  /** Show the explanatory light / beam path overlay during this segment. */
  lightPath?: boolean;
  /** Final test: the input switch position from a cue onwards. */
  input?: Record<string, 0 | 1>;
}

export const FILM: FilmSegment[] = [
  { id: 'intro', step: null },
  { id: 'arrive', step: 'arrive', sync: { ours: 0.7 } },
  { id: 'transfer', step: 'transfer', sync: { notch: 0.45 } },
  { id: 'scan', step: 'scan', sync: { map: 0.45 }, lightPath: true },
  { id: 'clean', step: 'clean', sync: { buried: 0.62 } },
  { id: 'diemap', step: 'diemap', sync: { ours: 0.4, fields: 0.6 } },
  { id: 'padox', step: 'padox', sync: { oxide: 0.25, nitride: 0.72 } },
  { id: 'sti-etch', step: 'sti-etch', sync: { litho: 0.08, etch: 0.46 } },
  { id: 'sti-fill', step: 'sti-fill', sync: { fill: 0.1, polish: 0.45, moat: 0.93 } },
  { id: 'wells', step: 'wells', sync: { phos: 0.12, boron: 0.5, invisible: 0.9 } },
  { id: 'anneal', step: 'anneal', sync: { active: 0.45 } },
  { id: 'gatestack', step: 'gatestack', sync: { oxide: 0.3, poly: 0.72, switch: 0.9 } },
  { id: 'prime', step: 'prime', sync: { prime: 0.3 } },
  { id: 'coat', step: 'coat', sync: { spin: 0.25, rim: 0.7 } },
  { id: 'softbake', step: 'softbake' },
  { id: 'reticle', step: 'reticle', sync: { chrome: 0.55 } },
  { id: 'align', step: 'align', sync: { correct: 0.5 }, lightPath: true },
  { id: 'expose', step: 'expose', sync: { shrink: 0.35, latent: 0.74 }, lightPath: true },
  { id: 'peb', step: 'peb' },
  { id: 'develop', step: 'develop', sync: { dissolve: 0.42, lines: 0.75 } },
  { id: 'adi', step: 'adi', sync: { rework: 0.55 } },
  { id: 'gate-etch', step: 'gate-etch', sync: { carve: 0.5, gates: 0.85 } },
  { id: 'strip', step: 'strip', sync: { cycle: 0.74 } },
  { id: 'sd', step: 'sd', sync: { self: 0.55, done: 0.92 } },
  { id: 'pmd', step: 'pmd', sync: { bury: 0.3 } },
  { id: 'contact-align', step: 'contact-align', sync: { drift: 0.5 } },
  { id: 'contact-print', step: 'contact-print' },
  { id: 'contact-etch', step: 'contact-etch' },
  { id: 'contact-fill', step: 'contact-fill', sync: { plugs: 0.42 } },
  { id: 'metal1', step: 'metal1', sync: { damascene: 0.3, join: 0.8 } },
  { id: 'metal2', step: 'metal2', sync: { many: 0.8 } },
  { id: 'passivate', step: 'passivate' },
  { id: 'inspect', step: 'inspect' },
  { id: 'probe', step: 'probe', sync: { map: 0.55 } },
  { id: 'dice', step: 'dice' },
  { id: 'attach', step: 'attach' },
  { id: 'bond', step: 'bond', sync: { mould: 0.8 } },
  { id: 'final', step: 'final', input: { here: 0, low: 0, high: 1, gate: 1 } },
  { id: 'outro', step: null },
];

/** Chapter markers on the film's seek bar: the first segment of each chapter. */
export const FILM_CHAPTERS: { title: string; segment: string }[] = [
  { title: 'Wafer', segment: 'arrive' },
  { title: 'Transistors', segment: 'padox' },
  { title: 'Patterning', segment: 'prime' },
  { title: 'Connecting', segment: 'sd' },
  { title: 'Testing', segment: 'inspect' },
];
